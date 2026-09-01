import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { toManilaDateString, minutesBetween } from "@/lib/manila-date";

/**
 * Tool-Assisted Efficiency — does the tooling given to SEs actually shorten the work, and where is
 * the remaining time going?
 *
 * TWO cycle times per ticket, measured separately because they belong to different people and only
 * one of them is something a tool can shorten:
 *
 *   ACTUAL EFFORT   moved out of Backlog/To Do (`first_out_of_backlog_todo`) -> entered For Peer
 *                   Review (`cycle_time_end`). The doer's execution time. This is the original
 *                   metric this page reported, unchanged, so the numbers stay comparable.
 *
 *   PEER REVIEW     time spent IN For Peer Review, from `peer_review_cycles_json` — summed over the
 *                   cycles that exited to On Hold or For Checking. The reviewer's time.
 *
 * Both come from fields JiraSync.gs already stores, so nothing here needs a changelog fetch or a
 * re-sync.
 *
 * The On Hold / For Checking exit rule is not invented here: it is the same business rule
 * lib/peer-review.ts applies, so the two pages can never disagree about which cycles count. A cycle
 * that exits some other way (bounced back to In Progress, cancelled) is recorded by the extractor
 * and excluded here rather than dropped upstream — `peerReviewExcludedCycles` counts them so the
 * exclusion is visible instead of silent.
 *
 * ONE DELIBERATE DIFFERENCE from lib/peer-review.ts: there, a cycle is in scope if the CYCLE was
 * entered inside the period. Here the TICKET is the unit — it is in scope if it was CREATED in the
 * period — so every qualifying cycle on an in-scope ticket counts regardless of when it ran. Mixing
 * the two would mean a ticket's own review time could be partly missing from its own row.
 */

/** The label that marks a ticket as tool-assisted. Matched case-insensitively. */
export const TOOL_ASSISTED_LABEL = "tool-assisted";

export type ToolAssistedCategory = "Company Policies" | "Webconfig" | "Feature Flags" | "Misc";

/**
 * What KIND of work the tool was used for, keyed off the ticket's other labels.
 *
 * Order is precedence: a ticket carrying labels from two groups is filed under the first match, so
 * every ticket lands in exactly one bucket and the counts sum to the tool-assisted total. Misc is
 * the explicit "tool-assisted but nothing above" bucket — it is the backlog of work the tool covers
 * without us having named it yet, so it should be READ, not treated as a rounding error.
 */
export const TOOL_ASSISTED_CATEGORIES: { category: ToolAssistedCategory; labels: string[] }[] = [
  {
    category: "Company Policies",
    labels: [
      "cp-companypolicy",
      "cp-sa",
      "cp-ot",
      "cp-coa",
      "cp-ob",
      "cp-ut",
      "cp-attendance",
      // Added 2026-09-01: it was showing up in Misc on 14 tickets and is a Company Policy label.
      "cp-mirror",
      "update-companypolicy",
    ],
  },
  { category: "Webconfig", labels: ["update-webconfig"] },
  { category: "Feature Flags", labels: ["update-featureflag"] },
];

export const TOOL_ASSISTED_CATEGORY_NAMES: ToolAssistedCategory[] = [
  ...TOOL_ASSISTED_CATEGORIES.map((c) => c.category),
  "Misc",
];

/** Category -> Badge tone, so the three named groups are distinguishable and Misc reads as unfiled. */
export function categoryTone(category: string): "success" | "warning" | "danger" | "neutral" {
  if (category === "Company Policies") return "success";
  if (category === "Webconfig") return "warning";
  if (category === "Feature Flags") return "danger";
  return "neutral";
}

/** Which stage a ticket, an SE or a work type spends most of its time in. */
export type Stage = "Actual effort" | "Peer review";

export type ToolAssistedTicket = {
  issueKey: string;
  issueType: string;
  /** The doer — `assigned_se`. Whose time the actual-effort number measures. */
  assignee: string;
  labels: string;
  product: string;
  hasLabel: boolean;
  /** Only set on tool-assisted tickets; the comparison group isn't categorised. */
  category: ToolAssistedCategory | null;
  /** The specific category label matched, e.g. "cp-sa" — what a tool feature would target. */
  primaryLabel: string;
  /**
   * The work-type dimension for the "what should the tool cover next" ranking: the category label
   * when the ticket carries one — INCLUDING tickets that are NOT tool-assisted, which is precisely
   * the coverage gap worth seeing — and the issue type when it doesn't.
   *
   * Not simply "the ticket's first label": most ST tickets carry process labels
   * (autoclose-nonresponse, automation-done, jira_escalated, ffup-1) that record how the ticket was
   * handled, not what the work was. Ranking on those produced a top row of
   * "Sprout HR / autoclose-nonresponse, 1,570 tickets" — true, and actionable by nobody.
   */
  workTypeLabel: string;
  created: string;
  todoExitAt: string | null;
  peerReviewAt: string | null;
  /** Out of To Do -> entered For Peer Review. Null when the ticket never completed that span. */
  actualCycleMinutes: number | null;
  /** Summed time in For Peer Review across qualifying cycles. Null when there were none. */
  peerReviewMinutes: number | null;
  peerReviewCycleCount: number;
  /** Reviewers on the qualifying cycles (reviewerAtEntry), deduped. */
  reviewers: string[];
  /** Mean of the two above — only when the ticket actually has both. */
  avgCycleMinutes: number | null;
  /** Where this ticket's time actually went. Null unless both measures exist. */
  dominantStage: Stage | null;
};

/** One measure over a set of tickets. `count` is how many CONTRIBUTED, not the set size. */
export type Measure = {
  count: number;
  avgMinutes: number | null;
  totalMinutes: number;
  maxMinutes: number | null;
};

export type CycleStats = {
  /** Tickets in the group, including any that contributed to neither measure. */
  ticketCount: number;
  actual: Measure;
  peerReview: Measure;
  /**
   * The average of the two averages — NOT a per-ticket figure and NOT the end-to-end total.
   * Defined this way on purpose: a per-ticket mean would silently drop every ticket missing one of
   * the two measures, and the two measures have genuinely different denominators.
   */
  avgOfTwoMinutes: number | null;
  peerReviewCycleCount: number;
  /** Cycles that ran but exited somewhere other than On Hold / For Checking. */
  peerReviewExcludedCycles: number;
};

export type CategoryBreakdown = {
  category: ToolAssistedCategory;
  stats: CycleStats;
  byIssueType: { issueType: string; stats: CycleStats }[];
  /** Which specific labels showed up in this category, commonest first. */
  labels: { label: string; ticketCount: number }[];
};

export type SeBreakdown = {
  name: string;
  /** Their actual-effort time on tickets they were the assigned SE for. */
  asDoer: Measure;
  /** Their review time on cycles they were the reviewer at entry for. */
  asReviewer: Measure;
  totalMinutes: number;
  /** Where this person's own time concentrates — the thing to talk to them about. */
  dominantStage: Stage | null;
};

export type WorkTypeBreakdown = {
  product: string;
  label: string;
  ticketCount: number;
  toolAssistedCount: number;
  actual: Measure;
  peerReview: Measure;
  totalMinutes: number;
  dominantStage: Stage | null;
};

export type ToolAssistedReport = {
  team: string;
  range: string;
  period: string;
  label: string;
  toolAssisted: CycleStats & { tickets: ToolAssistedTicket[] };
  others: CycleStats;
  /** Fraction faster, per measure. Positive = tool-assisted is quicker. Null = not comparable. */
  fasterBy: { actual: number | null; peerReview: number | null; avgOfTwo: number | null };
  byCategory: CategoryBreakdown[];
  /** Across every in-scope ticket: is the time going into execution or into review? */
  bottleneck: {
    stage: Stage | null;
    actualTotalMinutes: number;
    peerReviewTotalMinutes: number;
    actualShare: number | null;
    peerReviewShare: number | null;
  };
  bySe: SeBreakdown[];
  byWorkType: WorkTypeBreakdown[];
};

const EMPTY_MEASURE: Measure = { count: 0, avgMinutes: null, totalMinutes: 0, maxMinutes: null };

const EMPTY_STATS: CycleStats = {
  ticketCount: 0,
  actual: EMPTY_MEASURE,
  peerReview: EMPTY_MEASURE,
  avgOfTwoMinutes: null,
  peerReviewCycleCount: 0,
  peerReviewExcludedCycles: 0,
};

const EMPTY_REPORT: ToolAssistedReport = {
  team: "ST",
  range: "month",
  period: "",
  label: TOOL_ASSISTED_LABEL,
  toolAssisted: { ...EMPTY_STATS, tickets: [] },
  others: EMPTY_STATS,
  fasterBy: { actual: null, peerReview: null, avgOfTwo: null },
  byCategory: [],
  bottleneck: {
    stage: null,
    actualTotalMinutes: 0,
    peerReviewTotalMinutes: 0,
    actualShare: null,
    peerReviewShare: null,
  },
  bySe: [],
  byWorkType: [],
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Ported from gas/JiraSync.gs's CYCLE_TIME_INVESTIGATION_ISSUE_TYPES/cycleTimeEndStatusForIssueType_ —
// Investigations end at "For Checking"/"For Product Team" instead of "For Peer Review", so
// cycle_time_end wouldn't mean the same thing for those; excluded from this comparison.
const CYCLE_TIME_INVESTIGATION_ISSUE_TYPES = [
  "data generation",
  "external support request",
  "investigation",
  "team viewer",
];

function cycleTimeEndStatusForIssueType(issueType: string | null): string {
  const type = (issueType || "").toLowerCase();
  return CYCLE_TIME_INVESTIGATION_ISSUE_TYPES.includes(type) ? "for checking" : "for peer review";
}

type PeerReviewCycleRaw = {
  enteredAt?: string;
  exitedAt?: string;
  exitedToStatus?: string;
  reviewer?: string;
  reviewerAtEntry?: string;
};

type TicketRow = {
  issue_key: string;
  issue_type: string | null;
  created: string;
  first_out_of_backlog_todo: string | null;
  cycle_time_end: string | null;
  assigned_se: string | null;
  labels: string | null;
  product: string | null;
  peer_review_cycles_json: PeerReviewCycleRaw[] | null;
};

/** Coarse UTC-range prefilter (±1 day for the Manila shift) + exact Manila-day check in JS, same split as the other Phase 4 ports. */
async function fetchStTicketsCreatedBetween(startDate: string, endDate: string): Promise<TicketRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);

  return fetchAllRows<TicketRow>((from, to) =>
    getSupabaseClient()
      .from("tickets")
      .select(
        "issue_key,issue_type,created,first_out_of_backlog_todo,cycle_time_end,assigned_se,labels,product,peer_review_cycles_json"
      )
      .eq("team_key", "ST")
      .gte("created", rangeStartUtc.toISOString())
      .lte("created", rangeEndUtc.toISOString())
      .range(from, to)
  );
}

function splitLabels(labels: string | null): string[] {
  return (labels || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * First category whose labels the ticket carries, plus the specific label that matched. Misc with an
 * empty label when a tool-assisted ticket matches nothing — see TOOL_ASSISTED_CATEGORIES on why
 * that bucket is meaningful rather than leftovers.
 */
function categorise(labelList: string[]): { category: ToolAssistedCategory; primaryLabel: string } {
  for (const group of TOOL_ASSISTED_CATEGORIES) {
    const hit = group.labels.find((l) => labelList.includes(l));
    if (hit) return { category: group.category, primaryLabel: hit };
  }
  return { category: "Misc", primaryLabel: "" };
}

/**
 * Sums the qualifying peer-review cycles on one ticket. Returns nulls rather than zeros when there
 * were none — zero minutes and "never reviewed" are different facts, and averaging the second as if
 * it were the first is what would make a slow reviewer look fast.
 */
function peerReviewFor(cycles: PeerReviewCycleRaw[] | null): {
  minutes: number | null;
  cycleCount: number;
  excludedCycles: number;
  reviewers: string[];
} {
  if (!cycles || !cycles.length) {
    return { minutes: null, cycleCount: 0, excludedCycles: 0, reviewers: [] };
  }

  let total = 0;
  let cycleCount = 0;
  let excludedCycles = 0;
  const reviewers = new Set<string>();

  for (const c of cycles) {
    // An open cycle (still in review) has no duration yet. Not an exclusion — nothing has been
    // decided about it — so it is left out of both counts.
    if (!c.enteredAt || !c.exitedAt) continue;

    const exitedToStatus = (c.exitedToStatus || "").toLowerCase();
    if (exitedToStatus !== "on hold" && exitedToStatus !== "for checking") {
      excludedCycles++;
      continue;
    }

    total += minutesBetween(c.enteredAt, c.exitedAt);
    cycleCount++;
    // reviewerAtEntry ONLY, never `reviewer` — see the attribution note in lib/peer-review.ts:
    // `reviewer` is the assignee when the cycle CLOSED, which is usually the person who picked the
    // ticket up at the next stage, not the reviewer at all.
    reviewers.add(c.reviewerAtEntry || "(unassigned)");
  }

  return {
    minutes: cycleCount ? round2(total) : null,
    cycleCount,
    excludedCycles,
    reviewers: Array.from(reviewers),
  };
}

function measure(values: number[]): Measure {
  if (!values.length) return { ...EMPTY_MEASURE };
  const totalMinutes = values.reduce((sum, v) => sum + v, 0);
  return {
    count: values.length,
    avgMinutes: round2(totalMinutes / values.length),
    totalMinutes: round2(totalMinutes),
    maxMinutes: round2(Math.max(...values)),
  };
}

function statsFor(tickets: ToolAssistedTicket[]): CycleStats {
  const actual = measure(
    tickets.map((t) => t.actualCycleMinutes).filter((v): v is number => v !== null)
  );
  const peerReview = measure(
    tickets.map((t) => t.peerReviewMinutes).filter((v): v is number => v !== null)
  );

  return {
    ticketCount: tickets.length,
    actual,
    peerReview,
    avgOfTwoMinutes:
      actual.avgMinutes !== null && peerReview.avgMinutes !== null
        ? round2((actual.avgMinutes + peerReview.avgMinutes) / 2)
        : // With only one of the two measured, that one IS the average of what's known. Reporting
          // null instead would blank the headline on a period where every ticket is mid-review.
          actual.avgMinutes ?? peerReview.avgMinutes,
    peerReviewCycleCount: tickets.reduce((sum, t) => sum + t.peerReviewCycleCount, 0),
    peerReviewExcludedCycles: 0,
  };
}

/** (other − toolAssisted) ÷ other. Null unless both sides have a number and `other` isn't zero. */
function fasterBy(toolAssisted: number | null, other: number | null): number | null {
  if (toolAssisted === null || other === null || other === 0) return null;
  return (other - toolAssisted) / other;
}

function dominantStageOf(actualMinutes: number | null, reviewMinutes: number | null): Stage | null {
  if (actualMinutes === null || reviewMinutes === null) return null;
  return actualMinutes >= reviewMinutes ? "Actual effort" : "Peer review";
}

/**
 * The same question for a TOTAL, where 0 is a measured fact ("this person reviewed nothing this
 * period") rather than an unknown. Null only when there is no time on either side.
 *
 * Kept separate from dominantStageOf rather than loosening it: on a single ticket a missing review
 * time genuinely is unknown and picking a stage would be a guess, but on an aggregate a real zero on
 * one side is exactly what makes the other side the answer. Conflating the two is what made every
 * reviewer-only SE report "—" — the most obvious "Peer review" rows on the page.
 */
function dominantStageOfTotals(actualMinutes: number, reviewMinutes: number): Stage | null {
  if (!actualMinutes && !reviewMinutes) return null;
  return actualMinutes >= reviewMinutes ? "Actual effort" : "Peer review";
}

function buildCategoryBreakdowns(tickets: ToolAssistedTicket[]): CategoryBreakdown[] {
  return TOOL_ASSISTED_CATEGORY_NAMES.map((category) => {
    const inCategory = tickets.filter((t) => t.category === category);

    const issueTypes = Array.from(new Set(inCategory.map((t) => t.issueType || "(none)")));
    const byIssueType = issueTypes
      .map((issueType) => ({
        issueType,
        stats: statsFor(inCategory.filter((t) => (t.issueType || "(none)") === issueType)),
      }))
      .sort((a, b) => b.stats.ticketCount - a.stats.ticketCount);

    const labelCounts: Record<string, number> = {};
    for (const t of inCategory) {
      // The specific matched label is the interesting one; Misc has none by definition, so it
      // reports the raw labels it carried instead — that list is the candidate set for the next
      // category we name.
      const keys = t.primaryLabel
        ? [t.primaryLabel]
        : splitLabels(t.labels).filter((l) => l !== TOOL_ASSISTED_LABEL);
      for (const key of keys) labelCounts[key] = (labelCounts[key] ?? 0) + 1;
    }

    return {
      category,
      stats: statsFor(inCategory),
      byIssueType,
      labels: Object.entries(labelCounts)
        .map(([label, ticketCount]) => ({ label, ticketCount }))
        .sort((a, b) => b.ticketCount - a.ticketCount),
    };
  }).filter((c) => c.stats.ticketCount > 0);
}

/**
 * Per-SE time split by ROLE, which is the only way the question "is this person slow at the work or
 * slow at reviewing?" has an answer. Doer time is attributed by `assigned_se`; review time by the
 * reviewer at cycle entry. The same person normally appears in both columns.
 */
function buildSeBreakdowns(tickets: ToolAssistedTicket[]): SeBreakdown[] {
  const doerMinutes: Record<string, number[]> = {};
  const reviewerMinutes: Record<string, number[]> = {};

  for (const t of tickets) {
    if (t.actualCycleMinutes !== null) {
      const name = t.assignee || "(unassigned)";
      (doerMinutes[name] ??= []).push(t.actualCycleMinutes);
    }
    if (t.peerReviewMinutes !== null && t.reviewers.length) {
      // Split across reviewers when a ticket had more than one review cycle with different people,
      // so the total across SEs still equals the ticket's review time instead of counting it twice.
      const share = t.peerReviewMinutes / t.reviewers.length;
      for (const reviewer of t.reviewers) {
        (reviewerMinutes[reviewer] ??= []).push(round2(share));
      }
    }
  }

  const names = Array.from(new Set([...Object.keys(doerMinutes), ...Object.keys(reviewerMinutes)]));

  return names
    .map((name) => {
      const asDoer = measure(doerMinutes[name] ?? []);
      const asReviewer = measure(reviewerMinutes[name] ?? []);
      return {
        name,
        asDoer,
        asReviewer,
        totalMinutes: round2(asDoer.totalMinutes + asReviewer.totalMinutes),
        dominantStage: dominantStageOfTotals(asDoer.totalMinutes, asReviewer.totalMinutes),
      };
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
}

/**
 * product + label, over EVERY in-scope ticket rather than just the tool-assisted ones — the point is
 * to find the combinations still eating time, which by definition includes work the tool doesn't
 * cover yet. `toolAssistedCount` is what separates "the tool is slow here" from "there is no tool
 * here", and those two need opposite responses.
 */
function buildWorkTypeBreakdowns(tickets: ToolAssistedTicket[]): WorkTypeBreakdown[] {
  const groups: Record<string, { product: string; label: string; tickets: ToolAssistedTicket[] }> = {};

  for (const t of tickets) {
    const product = t.product || "(no product)";
    // JSON rather than a delimiter string: a product or label containing the delimiter would
    // silently merge two different rows, and there is no separator both safe and readable.
    const key = JSON.stringify([product, t.workTypeLabel]);
    (groups[key] ??= { product, label: t.workTypeLabel, tickets: [] }).tickets.push(t);
  }

  return Object.values(groups)
    .map((g) => {
      const actual = measure(
        g.tickets.map((t) => t.actualCycleMinutes).filter((v): v is number => v !== null)
      );
      const peerReview = measure(
        g.tickets.map((t) => t.peerReviewMinutes).filter((v): v is number => v !== null)
      );
      return {
        product: g.product,
        label: g.label,
        ticketCount: g.tickets.length,
        toolAssistedCount: g.tickets.filter((t) => t.hasLabel).length,
        actual,
        peerReview,
        totalMinutes: round2(actual.totalMinutes + peerReview.totalMinutes),
        dominantStage: dominantStageOfTotals(actual.totalMinutes, peerReview.totalMinutes),
      };
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
}

export async function getToolAssistedCycleTimeReport(
  range: string,
  period: string,
  label?: string
): Promise<ToolAssistedReport> {
  try {
    const normalizedLabel = (label || TOOL_ASSISTED_LABEL).trim().toLowerCase();
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);

    const rows = (await fetchStTicketsCreatedBetween(startDate, endDate)).filter((r) => {
      if (!r.created) return false;
      const createdDate = toManilaDateString(r.created);
      if (!createdDate || createdDate < startDate || createdDate > endDate) return false;
      return cycleTimeEndStatusForIssueType(r.issue_type) === "for peer review";
    });

    let excludedCyclesToolAssisted = 0;
    let excludedCyclesOthers = 0;

    const all: ToolAssistedTicket[] = rows.map((r) => {
      const labelList = splitLabels(r.labels);
      const hasLabel = labelList.includes(normalizedLabel);
      const review = peerReviewFor(r.peer_review_cycles_json);
      const { category, primaryLabel } = categorise(labelList);

      if (hasLabel) excludedCyclesToolAssisted += review.excludedCycles;
      else excludedCyclesOthers += review.excludedCycles;

      const actualCycleMinutes =
        r.first_out_of_backlog_todo && r.cycle_time_end
          ? round2(minutesBetween(r.first_out_of_backlog_todo, r.cycle_time_end))
          : null;

      return {
        issueKey: r.issue_key,
        issueType: r.issue_type || "",
        assignee: r.assigned_se || "(unassigned)",
        labels: r.labels || "",
        product: r.product || "",
        hasLabel,
        // Categorising a non-tool-assisted ticket would invite reading the composition table as a
        // breakdown of all work; it is specifically a breakdown of what the TOOL is used for. The
        // match is still computed for every ticket — workTypeLabel below needs it.
        category: hasLabel ? category : null,
        primaryLabel: hasLabel ? primaryLabel : "",
        workTypeLabel: primaryLabel || r.issue_type || "(no type)",
        created: r.created,
        todoExitAt: r.first_out_of_backlog_todo,
        peerReviewAt: r.cycle_time_end,
        actualCycleMinutes,
        peerReviewMinutes: review.minutes,
        peerReviewCycleCount: review.cycleCount,
        reviewers: review.reviewers,
        avgCycleMinutes:
          actualCycleMinutes !== null && review.minutes !== null
            ? round2((actualCycleMinutes + review.minutes) / 2)
            : null,
        dominantStage: dominantStageOf(actualCycleMinutes, review.minutes),
      };
    });

    // A ticket with neither measure can't appear in any average, and listing it would only pad the
    // table with blank rows. Kept out of both groups so every count on the page means the same thing.
    const measurable = all.filter(
      (t) => t.actualCycleMinutes !== null || t.peerReviewMinutes !== null
    );

    const toolAssistedTickets = measurable
      .filter((t) => t.hasLabel)
      // Longest first: the table is read to find what to fix, not to browse.
      .sort(
        (a, b) =>
          (b.avgCycleMinutes ?? b.actualCycleMinutes ?? b.peerReviewMinutes ?? 0) -
          (a.avgCycleMinutes ?? a.actualCycleMinutes ?? a.peerReviewMinutes ?? 0)
      );
    const otherTickets = measurable.filter((t) => !t.hasLabel);

    const toolAssistedStats = statsFor(toolAssistedTickets);
    const otherStats = statsFor(otherTickets);
    toolAssistedStats.peerReviewExcludedCycles = excludedCyclesToolAssisted;
    otherStats.peerReviewExcludedCycles = excludedCyclesOthers;

    const actualTotalMinutes = round2(
      toolAssistedStats.actual.totalMinutes + otherStats.actual.totalMinutes
    );
    const peerReviewTotalMinutes = round2(
      toolAssistedStats.peerReview.totalMinutes + otherStats.peerReview.totalMinutes
    );
    const grandTotal = actualTotalMinutes + peerReviewTotalMinutes;

    return {
      team: "ST",
      range,
      period,
      label: label || TOOL_ASSISTED_LABEL,
      toolAssisted: { ...toolAssistedStats, tickets: toolAssistedTickets },
      others: otherStats,
      fasterBy: {
        actual: fasterBy(toolAssistedStats.actual.avgMinutes, otherStats.actual.avgMinutes),
        peerReview: fasterBy(toolAssistedStats.peerReview.avgMinutes, otherStats.peerReview.avgMinutes),
        avgOfTwo: fasterBy(toolAssistedStats.avgOfTwoMinutes, otherStats.avgOfTwoMinutes),
      },
      byCategory: buildCategoryBreakdowns(toolAssistedTickets),
      bottleneck: {
        // Totals, not averages: the question is where the hours went, and a stage with a high
        // average but three tickets in it is not where the time is.
        stage: dominantStageOfTotals(actualTotalMinutes, peerReviewTotalMinutes),
        actualTotalMinutes,
        peerReviewTotalMinutes,
        actualShare: grandTotal ? actualTotalMinutes / grandTotal : null,
        peerReviewShare: grandTotal ? peerReviewTotalMinutes / grandTotal : null,
      },
      bySe: buildSeBreakdowns(measurable),
      byWorkType: buildWorkTypeBreakdowns(measurable),
    };
  } catch {
    return { ...EMPTY_REPORT, range, period };
  }
}
