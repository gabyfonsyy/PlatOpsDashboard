import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { toManilaDateString, minutesBetween } from "@/lib/manila-date";
import { ANALYSIS_EXCLUDED_LABELS } from "@/lib/ticket-breakdowns";

/**
 * Tool-Assisted Efficiency — does the tooling given to SEs actually shorten the work, and which of
 * the two stages is it shortening?
 *
 * TWO cycle times per ticket, measured separately because they belong to different people and only
 * one of them is something a tool can shorten:
 *
 *   DOER      moved out of Backlog/To Do (`first_out_of_backlog_todo`) -> entered For Peer Review
 *             (`cycle_time_end`). Execution time. This is the original metric this page reported,
 *             unchanged, so the numbers stay comparable.
 *
 *   REVIEWER  time spent IN For Peer Review, from `peer_review_cycles_json` — summed over the cycles
 *             that exited to On Hold or For Checking.
 *
 *   TOTAL     doer + reviewer. A SUM, not a mean: it answers "how long does one of these take end to
 *             end", which a mean cannot. It replaced an average-of-the-two, which was half the real
 *             elapsed time and read as if it were the whole thing.
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

/**
 * Process labels: they record HOW a ticket was handled — escalated, expedited, followed up, closed
 * for non-response, auto-processed, routed by queue age — not WHAT the work was.
 *
 * Hidden from the Misc category's label line only. Misc's whole purpose is to surface candidate work
 * types for the next category worth naming, and these were crowding out the real candidates: the
 * line led with automation-done, expedite and jira_escalated, none of which describes a piece of
 * work a tool could take over.
 *
 * They do NOT change any count or average. A Misc ticket carrying only process labels still counts
 * in Misc; it simply contributes nothing to the candidate list. The full label set stays on the
 * ticket row's hover title, so nothing is actually hidden from view.
 *
 * Sourced from ANALYSIS_EXCLUDED_LABELS (lib/ticket-breakdowns.ts) rather than a separate list here
 * — as of 2026-09-02 that list is the sitewide default for "process, not subject matter" labels, so
 * this page shouldn't drift from it.
 */

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

/**
 * The four SEs this report attributes execution to. Anyone else in `assigned_se` is off-roster and
 * shows up in `assignedSeIssues` instead of quietly becoming a row — a page that invents SEs from
 * whatever a field happens to contain is how a bot account ends up ranked against people.
 */
export const TOOL_ASSISTED_SE_ROSTER = [
  "Angelo Fajardo",
  "Jasper Razo",
  "Mark Jayson Manosca",
  "Gaby Fonseca",
];

/**
 * The DESIGNATED reviewers — the only three whose peer-review time is counted.
 *
 * Same allowlist, same names and the same reasoning as INCIDENT_VALIDATOR_NAMES_DEFAULT in
 * gas/IncidentsApi.gs, whose attribution id is literally 'peer-review-entry-assignee+allowlist':
 * the reviewer is derived from the CHANGELOG (whoever held the ticket when it entered For Peer
 * Review) and then has to survive the allowlist. Without the second half, the changelog hands back
 * whoever happened to be assigned and the review time lands on someone who never reviewed anything.
 *
 * Note this is three names, not four: Gaby is on the doer roster but is not a designated reviewer,
 * so her review column is empty by design rather than by accident.
 */
export const TOOL_ASSISTED_REVIEWERS = [
  "Angelo Fajardo",
  "Jasper Razo",
  "Mark Jayson Manosca",
];

/** Case- and whitespace-insensitive match returning the CANONICAL spelling, or "" if off-list. */
function canonicalName(name: string | null | undefined, list: string[]): string {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return "";
  return list.find((n) => n.toLowerCase() === wanted) || "";
}

/** Which stage a ticket, an SE or a work type spends most of its time in. */
export type Stage = "Actual effort" | "Peer review";

export type ToolAssistedTicket = {
  issueKey: string;
  issueType: string;
  /**
   * The doer, canonicalised against TOOL_ASSISTED_SE_ROSTER. Empty when `assigned_se` is blank or
   * names someone off-roster — those tickets are listed in `assignedSeIssues` rather than attributed.
   */
  assignee: string;
  /** Exactly what `assigned_se` held, for the data-quality helper to show. */
  assignedSeRaw: string;
  /** Jira's own `assignee` field. NOT used for attribution — only shown as a repair hint. */
  jiraAssignee: string;
  labels: string;
  product: string;
  hasLabel: boolean;
  /** Only set on tool-assisted tickets; the comparison group isn't categorised. */
  category: ToolAssistedCategory | null;
  /** The specific category label matched, e.g. "cp-sa" — what a tool feature would target. */
  primaryLabel: string;
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
  /**
   * Doer + reviewer for this ticket. Null unless it has BOTH — a sum with a missing term would be
   * indistinguishable from a genuinely quick ticket, which is the one error worth refusing to make.
   */
  totalCycleMinutes: number | null;
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
   * Doer average + reviewer average — the typical end-to-end cycle time for the group.
   *
   * Built from the two group averages rather than from per-ticket totals on purpose: the two stages
   * have genuinely different denominators (a ticket can have execution measured with no closed
   * review yet), and averaging per-ticket totals would silently drop every one of those tickets.
   * When only one stage has data, that stage alone is reported rather than nothing.
   */
  combinedAvgMinutes: number | null;
  peerReviewCycleCount: number;
  /** Cycles that ran but exited somewhere other than On Hold / For Checking. */
  peerReviewExcludedCycles: number;
};

export type CategoryBreakdown = {
  category: ToolAssistedCategory;
  stats: CycleStats;
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

export type ToolAssistedReport = {
  team: string;
  range: string;
  period: string;
  label: string;
  toolAssisted: CycleStats & { tickets: ToolAssistedTicket[] };
  others: CycleStats;
  /** Fraction faster, per measure. Positive = tool-assisted is quicker. Null = not comparable. */
  fasterBy: { actual: number | null; peerReview: number | null; combined: number | null };
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
  /**
   * Tool-assisted tickets left out of `bySe` because their Assigned SE is blank or off-roster.
   *
   * A count, not a list. The full repair table was removed as out of scope, but the number has to
   * survive: without it the SE table silently under-reports and looks complete while doing it.
   */
  unattributedToolAssisted: number;
};

const EMPTY_MEASURE: Measure = { count: 0, avgMinutes: null, totalMinutes: 0, maxMinutes: null };

const EMPTY_STATS: CycleStats = {
  ticketCount: 0,
  actual: EMPTY_MEASURE,
  peerReview: EMPTY_MEASURE,
  combinedAvgMinutes: null,
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
  fasterBy: { actual: null, peerReview: null, combined: null },
  byCategory: [],
  bottleneck: {
    stage: null,
    actualTotalMinutes: 0,
    peerReviewTotalMinutes: 0,
    actualShare: null,
    peerReviewShare: null,
  },
  bySe: [],
  unattributedToolAssisted: 0,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The issue types this page measures: BACKEND EXECUTION work, and nothing else.
 *
 * An explicit allowlist, not "everything except investigations". The comparison group used to be
 * every non-investigation ST ticket, which let unrelated work into it — the tool cannot plausibly
 * affect a Technical Story, so its cycle time is noise in a table about the tool. Naming the five
 * types also means a NEW issue type has to be admitted deliberately instead of appearing in the
 * baseline the day someone first files one.
 *
 * Strictly narrower than the old rule, which matters for correctness: all five end their review path
 * at For Peer Review, so `cycle_time_end` still means the same thing for every ticket here. Anything
 * added to this list MUST also end at For Peer Review (see cycleTimeEndStatusesForIssueType_ in
 * gas/JiraSync.gs) or the doer figure silently changes meaning — Investigations, Data Generation,
 * External Support Request and Team Viewer end at For Checking and must never be added.
 *
 * Measured impact when introduced: tool-assisted 171 -> 171 (nothing lost), comparison group
 * 4,778 -> 4,770 (8 Technical Story tickets).
 */
export const BACKEND_EXECUTION_ISSUE_TYPES = [
  "Backend Changes",
  "Company Policy",
  "Data Deletion",
  "Task",
  "Account Creation",
];

const BACKEND_EXECUTION_LOOKUP = BACKEND_EXECUTION_ISSUE_TYPES.map((t) => t.toLowerCase());

function isBackendExecution(issueType: string | null): boolean {
  return BACKEND_EXECUTION_LOOKUP.indexOf((issueType || "").toLowerCase()) !== -1;
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
  assignee_display_name: string | null;
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
        "issue_key,issue_type,created,first_out_of_backlog_todo,cycle_time_end,assigned_se,assignee_display_name,labels,product,peer_review_cycles_json"
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
    // ticket up at the next stage, not the reviewer at all. Then the allowlist: a changelog name
    // outside the three designated reviewers is dropped rather than credited.
    const reviewer = canonicalName(c.reviewerAtEntry, TOOL_ASSISTED_REVIEWERS);
    if (reviewer) reviewers.add(reviewer);
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
    combinedAvgMinutes:
      actual.avgMinutes !== null && peerReview.avgMinutes !== null
        ? round2(actual.avgMinutes + peerReview.avgMinutes)
        : // With only one stage measured, that stage alone is the whole of what's known. Reporting
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

    const labelCounts: Record<string, number> = {};
    for (const t of inCategory) {
      // The specific matched label is the interesting one; Misc has none by definition, so it
      // reports the raw labels it carried instead — that list is the candidate set for the next
      // category we name, which is why the process labels are stripped out of it.
      const keys = t.primaryLabel
        ? [t.primaryLabel]
        : splitLabels(t.labels).filter(
            (l) => l !== TOOL_ASSISTED_LABEL && ANALYSIS_EXCLUDED_LABELS.indexOf(l) === -1
          );
      for (const key of keys) labelCounts[key] = (labelCounts[key] ?? 0) + 1;
    }

    return {
      category,
      stats: statsFor(inCategory),
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
    // `assignee` is already canonicalised to the roster, so an off-roster or blank Assigned SE
    // contributes nothing here. It is not lost: it is in assignedSeIssues, to be corrected in Jira.
    if (t.actualCycleMinutes !== null && t.assignee) {
      (doerMinutes[t.assignee] ??= []).push(t.actualCycleMinutes);
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

  // The roster is the ROW SOURCE, in its declared order — not "whoever appeared in the data", which
  // is what previously let a bot account be ranked against people. Anyone with nothing in EITHER role
  // for the period is then dropped: on a short period that is most of the roster, and rows of dashes
  // push the people who did the work down the table.
  return TOOL_ASSISTED_SE_ROSTER
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
    .filter((se) => se.asDoer.count > 0 || se.asReviewer.count > 0)
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
}

/**
 * BEFORE vs NOW, per label category — did introducing the tool actually change the numbers for the
 * work it covers?
 *
 * The page's main comparison sets tool-assisted tickets against every other ST ticket, which mixes
 * work types: Company Policy work and Backend Changes are not the same job, so part of any gap is
 * just the mix. This compares like with like — cp-attendance against cp-attendance — and adds the
 * dimension the main comparison cannot have: time.
 *
 * THE CUTOFF IS THE TOOL'S RELEASE DATE, ONE DATE FOR ALL THREE CATEGORIES (TOOL_RELEASED_ON).
 *
 * It was originally DERIVED per category, as the creation date of that category's first tool-assisted
 * ticket. That was wrong, and the way it was wrong is worth keeping written down: first USE is not
 * release. All three categories shipped in July 2026, but Webconfig's first tagged ticket is
 * 2026-08-24 — so the derivation put its cutoff seven weeks late, which silently slid its baseline
 * window to March-August and made its "before" period a different span from the other two.
 *
 * A release date cannot be inferred from usage and has to be stated. `toolFirstUsedOn` is still
 * computed and shown, because the gap between release and first use is real information about
 * adoption — Webconfig sat unused for seven weeks — it just must not drive the arithmetic.
 *
 * THREE groups, not two, and the third is the important one:
 *
 *   before      same-label tickets created before the cutoff. The baseline.
 *   assisted    tool-assisted tickets. "Now, with the tool."
 *   unassisted  same-label tickets created AFTER the cutoff that nobody used the tool on.
 *
 * Without `unassisted` a before/after difference proves nothing: the team could simply have got
 * faster, or the ticket mix could have shifted. `unassisted` is the control group — it lived through
 * the same period without the tool, so "assisted beat before AND beat unassisted" is a claim about
 * the tool, while "both improved equally" is a claim about the period.
 *
 * THE BASELINE COLUMN IGNORES THE PERIOD FILTER; THE OTHER TWO FOLLOW IT. A baseline that moved when
 * you changed the month would not be a baseline — it is fixed at the six months before release. With
 * Tool and Manual are period-scoped like every other section, so the table answers "how is the
 * selected period doing against a fixed reference", which is the question a moving baseline cannot
 * answer at all.
 *
 * THE BASELINE IS A TRAILING WINDOW, not all history, and that is a correctness fix rather than a
 * convenience. All three measures come from changelog extraction, which was only backfilled over a
 * recent window, so 2024 same-label tickets are 0% measurable and 2025 only 1-5%. The few older
 * tickets that DO carry cycle data are not a sample of their period — a 2025 ticket has the data
 * only because something re-synced it recently, which selects for stale and reopened work. Measured:
 * the 23 Company Policies stragglers from 2025 average 0.85d of effort against 2026's 0.32d, and the
 * 4 Feature Flags ones average 3.77d against 0.38d, with median created->updated lags of 263 and 84
 * days versus about 10. None of them has review data at all.
 *
 * Including them inflated the effort baseline and so OVERSTATED the tool's benefit (Feature Flags
 * read as 52% faster on a 0.45d baseline; the dense-coverage baseline is 0.38d, i.e. 47%). A window
 * of the BASELINE_WINDOW_MONTHS immediately before each cutoff excludes them by construction rather
 * than by an arbitrary rule, and is also the fairest reading of "before": the period the tool was
 * actually introduced against.
 */
/**
 * How far back each category's baseline reaches from its own cutoff.
 *
 * Six months is long enough to average out a quiet fortnight and short enough to stay inside the
 * window where changelog coverage is dense (~95% of 2026 same-label tickets are measurable, against
 * 1-5% of 2025's). Widening this is only sound AFTER a changelog backfill over the older years —
 * otherwise it just readmits the selection bias documented above.
 */
export const BASELINE_WINDOW_MONTHS = 6;

/**
 * When the tool was released, for every category — the line between "before" and "with the tool".
 *
 * A real-world fact, so it lives here as a constant rather than being guessed from the data: see the
 * note at the top of this section on why deriving it from first use was wrong. With the 6-month
 * window this makes every category's baseline January-June 2026, which is also how the team thinks
 * about it. Verified against the data: no tool-assisted ST ticket exists before this date (earliest
 * is 2026-07-03), so nothing tagged can leak into the baseline.
 *
 * If a category is ever released separately, this becomes a per-category map — not a derivation.
 */
export const TOOL_RELEASED_ON = "2026-07-01";

/** `iso` shifted back by `months`, as a 'yyyy-MM-dd' string. */
function monthsBefore(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export type BaselineGroup = {
  ticketCount: number;
  actual: Measure;
  peerReview: Measure;
  /** Doer average + reviewer average. See CycleStats.combinedAvgMinutes for why it's built that way. */
  combinedAvgMinutes: number | null;
};

export type BaselineComparison = {
  category: ToolAssistedCategory;
  /** True when the selected period ends before the tool shipped, so both live columns are empty. */
  periodPredatesRelease: boolean;
  /** Creation date of the first tool-assisted ticket in this category, 'yyyy-MM-dd'. */
  toolFirstUsedOn: string;
  /** Start of the baseline window — the cutoff minus BASELINE_WINDOW_MONTHS. */
  baselineWindowFrom: string;
  /**
   * The span the baseline group's tickets actually cover inside that window, earliest to latest.
   * Shown on screen so "before" can never be misread as all history.
   */
  beforeFrom: string;
  beforeTo: string;
  before: BaselineGroup;
  assisted: BaselineGroup;
  unassisted: BaselineGroup;
  /** Improvement fractions, assisted vs baseline. Positive = faster with the tool. */
  improvement: { actual: number | null; peerReview: number | null; combined: number | null };
  /** The same fractions for the control group, so a period-wide shift is visible as such. */
  controlImprovement: { actual: number | null; peerReview: number | null; combined: number | null };
};

type BaselineRow = {
  issue_key: string;
  issue_type: string | null;
  created: string;
  labels: string | null;
  first_out_of_backlog_todo: string | null;
  cycle_time_end: string | null;
  peer_review_cycles_json: PeerReviewCycleRaw[] | null;
};

/**
 * Every ST ticket carrying any category label or the tool-assisted label, across all history.
 *
 * Filtered SERVER-side with an ilike-per-label `or`, which cuts ~40,000 ST tickets down to under
 * 4,000. `labels` is a comma-joined text column rather than an array, so ilike is the only available
 * predicate — it is a prefilter only, and exact label matching still happens in JS below, so a
 * substring collision (cp-ot matching a hypothetical cp-other) cannot produce a wrong figure.
 */
async function fetchBaselineTickets(): Promise<BaselineRow[]> {
  const wanted = [
    ...TOOL_ASSISTED_CATEGORIES.flatMap((c) => c.labels),
    TOOL_ASSISTED_LABEL,
  ];
  const orFilter = wanted.map((l) => `labels.ilike.*${l}*`).join(",");

  return fetchAllRows<BaselineRow>((from, to) =>
    getSupabaseClient()
      .from("tickets")
      .select(
        "issue_key,issue_type,created,labels,first_out_of_backlog_todo,cycle_time_end,peer_review_cycles_json"
      )
      .eq("team_key", "ST")
      .or(orFilter)
      .range(from, to)
  );
}

function baselineGroup(
  rows: { actual: number | null; review: number | null }[]
): BaselineGroup {
  const actual = measure(rows.map((r) => r.actual).filter((v): v is number => v !== null));
  const peerReview = measure(rows.map((r) => r.review).filter((v): v is number => v !== null));
  return {
    ticketCount: rows.length,
    actual,
    peerReview,
    combinedAvgMinutes:
      actual.avgMinutes !== null && peerReview.avgMinutes !== null
        ? round2(actual.avgMinutes + peerReview.avgMinutes)
        : actual.avgMinutes ?? peerReview.avgMinutes,
  };
}

/** Fraction faster than the baseline. Positive = quicker now. Null unless both sides have a figure. */
function improvedBy(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0) return null;
  return (before - now) / before;
}

export async function getToolAssistedBaselineComparison(
  range: string,
  period: string
): Promise<BaselineComparison[]> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const rows = await fetchBaselineTickets();

    // Measured once per ticket, then reused by whichever group it lands in.
    const measured = rows
      .filter((r) => isBackendExecution(r.issue_type))
      .map((r) => {
        const review = peerReviewFor(r.peer_review_cycles_json);
        return {
          created: toManilaDateString(r.created) || "",
          labels: splitLabels(r.labels),
          actual:
            r.first_out_of_backlog_todo && r.cycle_time_end
              ? round2(minutesBetween(r.first_out_of_backlog_todo, r.cycle_time_end))
              : null,
          review: review.minutes,
        };
      })
      // A ticket with neither measure cannot move any average; keeping it would only inflate counts.
      .filter((t) => t.created && (t.actual !== null || t.review !== null));

    const out: BaselineComparison[] = [];

    for (const group of TOOL_ASSISTED_CATEGORIES) {
      const sameLabel = measured.filter((t) => group.labels.some((l) => t.labels.includes(l)));

      // ALL-TIME, not period-scoped: this only decides whether the category has ever used the tool,
      // and supplies the adoption date below. Scoping it would make a category vanish from the table
      // in any month nobody happened to use the tool, which reads as "this category doesn't exist".
      const assistedEver = sameLabel.filter((t) => t.labels.includes(TOOL_ASSISTED_LABEL));
      if (!assistedEver.length) continue;

      // Reported, never used as the cutoff — see the note above.
      const toolFirstUsedOn = assistedEver.reduce(
        (min, t) => (t.created < min ? t.created : min),
        assistedEver[0].created
      );

      const inPeriod = (t: { created: string }) => t.created >= startDate && t.created <= endDate;
      const assisted = assistedEver.filter(inPeriod);

      const baselineWindowFrom = monthsBefore(TOOL_RELEASED_ON, BASELINE_WINDOW_MONTHS);
      // The tool-assisted exclusion is belt and braces: no tagged ticket predates the release, so the
      // date test already covers it, but stating it means the baseline stays clean if that ever
      // changes (a backdated ticket, a corrected created date) instead of quietly absorbing one.
      const before = sameLabel.filter(
        (t) =>
          !t.labels.includes(TOOL_ASSISTED_LABEL) &&
          t.created >= baselineWindowFrom &&
          t.created < TOOL_RELEASED_ON
      );
      const unassisted = sameLabel.filter(
        (t) =>
          t.created >= TOOL_RELEASED_ON && !t.labels.includes(TOOL_ASSISTED_LABEL) && inPeriod(t)
      );

      const beforeStats = baselineGroup(before);
      const assistedStats = baselineGroup(assisted);
      const unassistedStats = baselineGroup(unassisted);

      const beforeDates = before.map((t) => t.created).sort();

      out.push({
        category: group.category,
        periodPredatesRelease: endDate < TOOL_RELEASED_ON,
        toolFirstUsedOn,
        baselineWindowFrom,
        beforeFrom: beforeDates[0] || "",
        beforeTo: beforeDates[beforeDates.length - 1] || "",
        before: beforeStats,
        assisted: assistedStats,
        unassisted: unassistedStats,
        improvement: {
          actual: improvedBy(assistedStats.actual.avgMinutes, beforeStats.actual.avgMinutes),
          peerReview: improvedBy(assistedStats.peerReview.avgMinutes, beforeStats.peerReview.avgMinutes),
          combined: improvedBy(assistedStats.combinedAvgMinutes, beforeStats.combinedAvgMinutes),
        },
        controlImprovement: {
          actual: improvedBy(unassistedStats.actual.avgMinutes, beforeStats.actual.avgMinutes),
          peerReview: improvedBy(
            unassistedStats.peerReview.avgMinutes,
            beforeStats.peerReview.avgMinutes
          ),
          combined: improvedBy(unassistedStats.combinedAvgMinutes, beforeStats.combinedAvgMinutes),
        },
      });
    }

    return out;
  } catch {
    return [];
  }
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
      return isBackendExecution(r.issue_type);
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
        // Canonicalised against the roster: "" here means the ticket is unattributable, so it
        // contributes to no SE row and is counted in `unattributedToolAssisted` instead.
        assignee: canonicalName(r.assigned_se, TOOL_ASSISTED_SE_ROSTER),
        assignedSeRaw: String(r.assigned_se || ""),
        jiraAssignee: String(r.assignee_display_name || ""),
        labels: r.labels || "",
        product: r.product || "",
        hasLabel,
        // Categorising a non-tool-assisted ticket would invite reading the composition table as a
        // breakdown of all work; it is specifically a breakdown of what the TOOL is used for.
        category: hasLabel ? category : null,
        primaryLabel: hasLabel ? primaryLabel : "",
        created: r.created,
        todoExitAt: r.first_out_of_backlog_todo,
        peerReviewAt: r.cycle_time_end,
        actualCycleMinutes,
        peerReviewMinutes: review.minutes,
        peerReviewCycleCount: review.cycleCount,
        reviewers: review.reviewers,
        totalCycleMinutes:
          actualCycleMinutes !== null && review.minutes !== null
            ? round2(actualCycleMinutes + review.minutes)
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
          (b.totalCycleMinutes ?? b.actualCycleMinutes ?? b.peerReviewMinutes ?? 0) -
          (a.totalCycleMinutes ?? a.actualCycleMinutes ?? a.peerReviewMinutes ?? 0)
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
        combined: fasterBy(toolAssistedStats.combinedAvgMinutes, otherStats.combinedAvgMinutes),
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
      // Tool-assisted tickets ONLY. The page is about the tool, and mixing every ST ticket in here
      // made this the one table answering a different question from the rest of the page.
      bySe: buildSeBreakdowns(toolAssistedTickets),
      unattributedToolAssisted: toolAssistedTickets.filter((t) => !t.assignee).length,
    };
  } catch {
    return { ...EMPTY_REPORT, range, period };
  }
}
