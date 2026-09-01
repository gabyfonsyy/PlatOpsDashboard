import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import { getTeams, excludedIssueTypes, isExcludedIssueType } from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { toManilaDateString } from "@/lib/manila-date";
import { basisFor } from "@/lib/lead-cycle-time";
import { escalationTargets, BREAKDOWN_TICKET_LIMIT, type CountRow } from "@/lib/ticket-breakdowns";
import {
  automationLabelSet,
  hasAutomationLabel,
  sanitizeAutomationLabels,
  KNOWN_AUTOMATION_LABELS,
} from "@/lib/automation-labels";

/**
 * Assigned SE values that mean "a bot did this, not a person".
 *
 * A list rather than a single string so a second automation account can be added without
 * touching the query or the filter logic. Matched case/whitespace-insensitively in JS, and
 * pushed into the SQL `or` filter below so the query still only returns candidate rows.
 */
export const AUTOMATION_ASSIGNED_SE_NAMES = ["Automation for Jira"];

// KNOWN_AUTOMATION_LABELS now lives in lib/automation-labels.ts — it is needed by the browser
// editor as well as by this server-only module, and it stopped being cosmetic when it began
// selecting tickets. Re-exported so callers have one import for the report and its inputs.
export { KNOWN_AUTOMATION_LABELS };

/**
 * Statuses whose tickets are dropped from this report entirely.
 *
 * Gaby's call, 2026-09-01. An Archived or Rejected ticket is one nobody ever did the work on, so
 * its lead time measures how long it sat before being written off — not how long automated work
 * takes. Measured on ST's 2026 data the exclusion removes 88 of 222 tickets and **every one of
 * them is from the blank-Assigned-SE half** (73 Archived + 15 Rejected, zero bot-owned), which is
 * exactly the untagged-and-abandoned noise that half was carrying.
 *
 * Scoped to this report on purpose — it does not change Ticket Volume, FCR, Escalation or Backlog
 * Aging, all of which still count a rejected ticket as resolved.
 */
export const EXCLUDED_STATUSES = ["Archived", "Rejected"];

const EXCLUDED_STATUS_SET = new Set(EXCLUDED_STATUSES.map((v) => v.trim().toLowerCase()));

/** Case/whitespace-insensitive, so a Jira rename to "archived" cannot silently re-include it. */
export function isExcludedStatus(status: string | null | undefined): boolean {
  return EXCLUDED_STATUS_SET.has((status || "").trim().toLowerCase());
}

const AUTOMATION_SE_SET = new Set(AUTOMATION_ASSIGNED_SE_NAMES.map((n) => n.trim().toLowerCase()));

/**
 * Nobody on the team owns this ticket: Assigned SE is blank, or it is an automation account.
 *
 * Assigned SE (customfield_10189) is the basis, never the Jira assignee — the same rule as every
 * other SE metric (see backlogAgingAssignee in lib/teams.ts). 133 ST tickets have "Automation for
 * Jira" as their Jira *assignee* while a real person owns them as Assigned SE; those are a person's
 * work that a bot happened to transition, and this rule correctly does not catch them.
 */
export function isUnownedTicket(row: { assigned_se: string | null }): boolean {
  const se = (row.assigned_se || "").trim();
  if (se === "") return true;
  return AUTOMATION_SE_SET.has(se.toLowerCase());
}

/**
 * An automated ticket: nobody owns it, OR it carries a catalogued automation label.
 *
 * The label clause is Gaby's 2026-09-01 change — adding a label to the catalogue is meant to pull
 * its tickets into the records and the computations, not just badge them. It means a ticket with a
 * real Assigned SE can now be in this population, which is deliberate: an automation raised it, and
 * someone picking it up afterwards does not make it manual work. The page says how many arrived
 * this way (`includedByLabelOnlyCount`) so a person's name in an "automated" list is never a
 * surprise.
 */
export function isAutomatedTicket(
  row: { assigned_se: string | null; labels: string | null },
  automationLabels: Set<string>
): boolean {
  return isUnownedTicket(row) || hasAutomationLabel(row.labels, automationLabels);
}

/**
 * The Jira assignee, but only when it tells you something the reporter does not.
 *
 * A blank Assigned SE is a tagging gap, and the useful question is "who should have been tagged".
 * Jira's assignee answers that only when it is someone OTHER than the person who raised the ticket
 * — CA tickets are routinely auto-assigned to their own reporter, and repeating that name under
 * "(none)" is pure noise. Measured on ST 2026: 41 of 50 blank-SE tickets had assignee == reporter,
 * 1 had no assignee at all, and only 8 named a different person (all real SEs who worked the ticket
 * without being tagged as Assigned SE). Gaby asked for the equal case suppressed, 2026-09-01.
 *
 * Compared case- and whitespace-insensitively, since these are two free-text display-name columns
 * from the same Jira instance and an exact-match test would leak rows on capitalisation alone.
 */
export function assigneeRepairHint(row: {
  assignee_display_name: string | null;
  reporter_display_name: string | null;
}): string {
  const assignee = (row.assignee_display_name || "").trim();
  if (!assignee) return "";
  const reporter = (row.reporter_display_name || "").trim();
  if (reporter && assignee.toLowerCase() === reporter.toLowerCase()) return "";
  return assignee;
}

export type AutomatedTicket = {
  issueKey: string;
  issueType: string;
  product: string;
  /**
   * The RAW label CSV, deliberately unfiltered. The exclusion list is editable in the browser
   * (see AutomatedLabelPanel), so the filtering has to happen client-side — sending pre-filtered
   * labels would make the control unable to put anything back.
   */
  labels: string;
  /** "" when blank, which the table renders as "(none)" — the fact she is looking for. */
  assignedSe: string;
  /**
   * Jira's own assignee beside a blank Assigned SE — a hint about who to tag, never attribution.
   *
   * Blank unless it actually adds something: see assigneeRepairHint. A ticket auto-assigned to the
   * CA who raised it says nothing about who did the work, and 41 of ST's 50 blank-SE tickets in
   * 2026 were exactly that.
   */
  jiraAssignee: string;
  escalation: string;
  leadMinutes: number | null;
  cycleMinutes: number | null;
  createdAt: string;
  resolvedAt: string;
};

/** Lead/cycle stats for one slice of the population. */
export type AutomatedDurationStats = {
  tickets: number;
  leadAvgMinutes: number | null;
  leadMedianMinutes: number | null;
  cycleAvgMinutes: number | null;
  cycleMedianMinutes: number | null;
};

export type AutomatedTicketsReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  /** Every ticket resolved in the period, automated or not — the scorecard's denominator. */
  resolvedInPeriod: number;
  automatedCount: number;
  automatedShare: number | null;
  /**
   * How many of them are in only because of a catalogued automation label — i.e. they DO have an
   * Assigned SE. Stated on the page so a real person's name appearing in an "automated" list is
   * explained rather than puzzling, and so the effect of editing the catalogue is visible.
   */
  includedByLabelOnlyCount: number;
  /** The catalogue this report ran with, echoed back so the page renders what it actually used. */
  automationLabels: string[];
  /**
   * Automated tickets in the period that were dropped for their status. Surfaced rather than
   * silently removed — 88 of 222 on ST's 2026 data is far too large a cut to leave invisible.
   */
  excludedByStatusCount: number;
  /** Rendered into the page's own prose, so the caption cannot drift from EXCLUDED_STATUSES. */
  excludedStatuses: string[];
  overall: AutomatedDurationStats;
  byIssueType: CountRow[];
  byProduct: CountRow[];
  byEscalation: CountRow[];
  // No byLabel here on purpose. The By Label breakdown moved to the client (ByLabelCard) when Gaby
  // asked it to honour her Hidden Labels list, which is a browser preference — see
  // LabelPrefsContext. It is computed from `tickets`, so the numbers are the same population.
  /** What ST Cycle Time measures for this team, for the page's own prose. */
  cycleTimeDescription: string;
  tickets: AutomatedTicket[];
};

const EMPTY: Omit<AutomatedTicketsReport, "team" | "range" | "period" | "issueType"> = {
  resolvedInPeriod: 0, automatedCount: 0, automatedShare: null,
  includedByLabelOnlyCount: 0, automationLabels: [],
  excludedByStatusCount: 0, excludedStatuses: EXCLUDED_STATUSES,
  overall: { tickets: 0, leadAvgMinutes: null, leadMedianMinutes: null, cycleAvgMinutes: null, cycleMedianMinutes: null },
  byIssueType: [], byProduct: [], byEscalation: [], cycleTimeDescription: "", tickets: [],
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

type AutomatedRow = {
  issue_key: string;
  issue_type: string | null;
  status: string | null;
  product: string | null;
  labels: string | null;
  assigned_se: string | null;
  assignee_display_name: string | null;
  reporter_display_name: string | null;
  escalation_value: string | null;
  created: string;
  resolved_datetime: string;
  first_out_of_backlog_todo: string | null;
  cycle_time_start: string | null;
  cycle_time_end: string | null;
};

const SELECT =
  "issue_key,issue_type,status,product,labels,assigned_se,assignee_display_name," +
  "reporter_display_name,escalation_value," +
  "created,resolved_datetime,first_out_of_backlog_todo,cycle_time_start,cycle_time_end";

/**
 * The automation filter as a PostgREST `or` expression — a PREFILTER only.
 *
 * `assigned_se.eq.""` is in there alongside `is.null` on purpose: the sync writes an unset field as
 * NULL today (verified — zero ST rows hold an empty string), but a blank is a blank either way and
 * this page must not start under-counting if that ever changes. Values are quoted because the
 * account names contain spaces.
 *
 * The label clauses use `ilike '%label%'`, which deliberately OVER-matches: `labels` is a comma
 * separated text column, so a ticket labelled `sb-fullsyncsso` satisfies an ilike for
 * `fullsyncsso`. That is safe precisely because this is a prefilter — hasAutomationLabel then
 * narrows to whole tokens in JS. Erring the other way (trying to express token boundaries in SQL)
 * would risk dropping real rows, which is the failure that actually matters here.
 *
 * Every label has been through sanitizeAutomationLabels, so none can contain a character with
 * meaning in this grammar. Do not interpolate an unsanitised label here.
 */
function automationOrFilter(automationLabels: readonly string[]): string {
  return [
    "assigned_se.is.null",
    'assigned_se.eq.""',
    ...AUTOMATION_ASSIGNED_SE_NAMES.map((n) => `assigned_se.eq."${n}"`),
    ...sanitizeAutomationLabels(automationLabels).map((l) => `labels.ilike.*${l}*`),
  ].join(",");
}

/**
 * Coarse UTC prefilter widened a day each side + exact Manila-day check in JS — the same split as
 * lib/ticket-breakdowns.ts and lib/backlog-aging.ts.
 *
 * `automatedOnly` toggles the automation filter and `columns` narrows the payload, so the same
 * query shape serves the drill-down (full rows), the scorecard (three columns) and the
 * period denominator (one column) without three near-identical builders.
 */
function buildResolvedQuery(
  teamKey: string,
  startDate: string,
  endDate: string,
  issueType: string | undefined,
  /** The catalogue to prefilter on, or null for the period denominator (no automation filter). */
  automationLabels: readonly string[] | null,
  columns: string
) {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);
  const excluded = excludedIssueTypes(teamKey);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // `any` for the same reason as lib/lead-cycle-time.ts: conditional re-chaining widens
  // supabase-js's builder generics until TS reports "type instantiation is excessively deep".
  let q: any = getSupabaseClient()
    .from("tickets")
    .select(columns)
    .eq("team_key", teamKey)
    .not("resolved_datetime", "is", null)
    .gte("resolved_datetime", rangeStartUtc.toISOString())
    .lte("resolved_datetime", rangeEndUtc.toISOString());
  if (issueType) q = q.eq("issue_type", issueType);
  if (excluded.length) q = q.not("issue_type", "in", `(${excluded.map((t) => `"${t}"`).join(",")})`);
  if (automationLabels) q = q.or(automationOrFilter(automationLabels));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // MANDATORY, not a nicety. Callers page through this with .range(), and a PostgREST offset is
  // only stable under a deterministic sort — without one, concurrent pages overlap and skip rows
  // outright. Measured on the period denominator here (~8,000 rows, 9 pages): unordered paging
  // returned 8,025 rows holding just 7,346 distinct issue keys — 679 duplicates AND several
  // hundred rows never returned at all, giving a different total on each request. issue_key is
  // the primary key, so this ordering is total. Same fix as fetchSpanRowsParallel in
  // lib/lead-cycle-time.ts, whose docstring warns about exactly this.
  return q.order("issue_key");
}

async function fetchAutomatedRows(
  teamKey: string,
  startDate: string,
  endDate: string,
  automationLabels: readonly string[],
  issueType?: string
): Promise<AutomatedRow[]> {
  return fetchAllRows<AutomatedRow>((from, to) =>
    buildResolvedQuery(teamKey, startDate, endDate, issueType, automationLabels, SELECT).range(from, to)
  );
}

/**
 * Manila-day membership is checked in JS, so a SQL `count` over the widened UTC window would
 * over-count by up to three days of tickets. The denominator therefore walks the resolved dates
 * rather than trusting `count` — one narrow column, and it is the same query the drill-downs
 * already run.
 *
 * This is the one query here that spans many pages (a year is ~8,000 rows), so it is the one that
 * depends on buildResolvedQuery's .order("issue_key") for a stable answer. See the note there.
 */
async function countResolvedInPeriod(
  teamKey: string,
  startDate: string,
  endDate: string,
  issueType?: string
): Promise<number> {
  const rows = await fetchAllRows<{ resolved_datetime: string }>((from, to) =>
    buildResolvedQuery(teamKey, startDate, endDate, issueType, null, "resolved_datetime").range(from, to)
  );
  return rows.filter((r) => {
    const iso = toManilaDateString(r.resolved_datetime);
    return iso !== null && iso >= startDate && iso <= endDate;
  }).length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/**
 * Median alongside the mean because these spans are extremely right-skewed: on ST's 2026 automated
 * tickets a mean lead time near a day sits against a median measured in minutes — a handful of
 * tickets that sat for weeks, not a typical automated ticket.
 */
function durationStats(tickets: AutomatedTicket[]): AutomatedDurationStats {
  const lead = tickets.map((t) => t.leadMinutes).filter((m): m is number => m !== null);
  const cycle = tickets.map((t) => t.cycleMinutes).filter((m): m is number => m !== null);
  const avg = (a: number[]) => (a.length ? round2(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const med = (a: number[]) => {
    const m = median(a);
    return m === null ? null : round2(m);
  };
  return {
    tickets: tickets.length,
    leadAvgMinutes: avg(lead),
    leadMedianMinutes: med(lead),
    cycleAvgMinutes: avg(cycle),
    cycleMedianMinutes: med(cycle),
  };
}

function toCountRows(counts: Record<string, number>, denominator: number): CountRow[] {
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count, share: denominator ? round4(count / denominator) : null }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function groupCounts(tickets: AutomatedTicket[], keyFn: (t: AutomatedTicket) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tickets) {
    const key = keyFn(t);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/**
 * Automated tickets resolved in the period, with their lead and cycle times.
 *
 * `automationLabels` is the live catalogue (cookie-backed, see lib/automation-labels.ts) and is
 * part of the DEFINITION here, not a display filter: a ticket carrying one is in the population
 * even if a person owns it.
 *
 * Archived and Rejected tickets are excluded (EXCLUDED_STATUSES); the period DENOMINATOR is not,
 * so `automatedShare` reads "automated work as a share of everything the team resolved" — the same
 * denominator every other card on the team page uses.
 *
 * Scoped to tickets RESOLVED in the period — the same basis the FCR, Escalation and On-Hold
 * drill-downs use, so this page reconciles with the cards beside the one that links here. Note
 * that for a peer-review team (ST) the Cycle Time SCORECARD buckets by cycle_time_end rather than
 * by resolution, so an automated ticket whose review span closed in one month and resolved in the
 * next lands in a different bucket on the two pages. The span FORMULAS are identical either way —
 * both come from basisFor() in lib/lead-cycle-time.ts, deliberately, so the two can never disagree
 * about what a cycle time is.
 */
export async function getAutomatedTicketsReport(
  team: string,
  range: string,
  period: string,
  issueType?: string,
  automationLabels: readonly string[] = KNOWN_AUTOMATION_LABELS
): Promise<AutomatedTicketsReport> {
  const labels = sanitizeAutomationLabels(automationLabels);
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const teamConfig = (await getTeams()).find((t) => t.team_key === team);
    if (!teamConfig) throw new Error(`Unknown team: ${team}`);

    const leadBasis = basisFor("lead", teamConfig.has_peer_review_tracking);
    const cycleBasis = basisFor("cycle", teamConfig.has_peer_review_tracking);
    const labelSet = automationLabelSet(labels);

    const [rawRows, resolvedInPeriod] = await Promise.all([
      fetchAutomatedRows(team, startDate, endDate, labels, issueType),
      countResolvedInPeriod(team, startDate, endDate, issueType),
    ]);

    const inScope = rawRows.filter((r) => {
      if (isExcludedIssueType(team, r.issue_type)) return false;
      // The SQL `or` is a prefilter; this is the definition. One source of truth, and the ilike
      // over-match on labels is narrowed to whole tokens here.
      if (!isAutomatedTicket(r, labelSet)) return false;
      const iso = toManilaDateString(r.resolved_datetime);
      return iso !== null && iso >= startDate && iso <= endDate;
    });

    // Partitioned rather than filtered in SQL so the dropped count is available for free — the
    // page reports what the status exclusion removed instead of quietly shrinking the number.
    const rows = inScope.filter((r) => !isExcludedStatus(r.status));
    const excludedByStatusCount = inScope.length - rows.length;

    const finite = (n: number | null) => (n !== null && isFinite(n) ? round2(n) : null);

    const tickets: AutomatedTicket[] = rows
      .slice()
      .sort((a, b) => (a.resolved_datetime < b.resolved_datetime ? 1 : -1))
      .slice(0, BREAKDOWN_TICKET_LIMIT)
      .map((r) => ({
        issueKey: r.issue_key,
        issueType: r.issue_type || "",
        product: r.product || "(none)",
        labels: r.labels || "",
        assignedSe: (r.assigned_se || "").trim(),
        jiraAssignee: assigneeRepairHint(r),
        escalation: (r.escalation_value || "").trim(),
        leadMinutes: finite(leadBasis.duration(r)),
        cycleMinutes: finite(cycleBasis.duration(r)),
        createdAt: r.created,
        resolvedAt: r.resolved_datetime,
      }));

    return {
      team,
      range,
      period,
      issueType: issueType ?? null,
      resolvedInPeriod,
      automatedCount: rows.length,
      automatedShare: resolvedInPeriod ? round4(rows.length / resolvedInPeriod) : null,
      // Counted on the KEPT rows, so it matches the population the page is showing.
      includedByLabelOnlyCount: rows.filter((r) => !isUnownedTicket(r)).length,
      automationLabels: labels,
      excludedByStatusCount,
      excludedStatuses: EXCLUDED_STATUSES,
      overall: durationStats(tickets),
      byIssueType: toCountRows(groupCounts(tickets, (t) => t.issueType || "(none)"), tickets.length),
      byProduct: toCountRows(groupCounts(tickets, (t) => t.product), tickets.length).slice(0, 10),
      // Same per-target split as the Escalation report: a ticket tagged "DBA, DevOps" counts once
      // for each, since the question is how much automated work each team received.
      byEscalation: (() => {
        const counts: Record<string, number> = {};
        let entries = 0;
        for (const t of tickets) {
          const targets = escalationTargets(t.escalation);
          if (!targets.length) {
            counts["(not escalated)"] = (counts["(not escalated)"] || 0) + 1;
            entries++;
            continue;
          }
          for (const target of targets) {
            counts[target] = (counts[target] || 0) + 1;
            entries++;
          }
        }
        return toCountRows(counts, entries);
      })(),
      cycleTimeDescription: cycleBasis.description,
      tickets,
    };
  } catch {
    return { team, range, period, issueType: issueType ?? null, ...EMPTY, automationLabels: labels };
  }
}

/**
 * Just the count, for the Team Stats scorecard.
 *
 * Five narrow columns rather than the drill-down's full row set — the card needs a number, and
 * this runs on every team-page render. It cannot be a SQL `count`: the automation filter is
 * re-applied in JS (isAutomatedTicket is the definition, the `or` expression only a prefilter) and
 * period membership is an exact Manila-day check, so both have to see the rows. Volume is small by
 * construction — 134 such tickets across all of ST's 2026 once Archived/Rejected are dropped.
 */
export async function getAutomatedTicketCount(
  team: string,
  range: string,
  period: string,
  issueType?: string,
  automationLabels: readonly string[] = KNOWN_AUTOMATION_LABELS
): Promise<number> {
  try {
    const { startDate, endDate } = resolvePeriodToDateRange(range, period);
    const labels = sanitizeAutomationLabels(automationLabels);
    const labelSet = automationLabelSet(labels);
    const rows = await fetchAllRows<{
      assigned_se: string | null;
      labels: string | null;
      issue_type: string | null;
      status: string | null;
      resolved_datetime: string;
    }>((from, to) =>
      buildResolvedQuery(
        team,
        startDate,
        endDate,
        issueType,
        labels,
        "assigned_se,labels,issue_type,status,resolved_datetime"
      ).range(from, to)
    );
    return rows.filter((r) => {
      if (isExcludedIssueType(team, r.issue_type)) return false;
      // Must stay in step with getAutomatedTicketsReport's own filter, or the card and the page it
      // links to disagree about the count. Both read the catalogue from the same cookie.
      if (isExcludedStatus(r.status)) return false;
      if (!isAutomatedTicket(r, labelSet)) return false;
      const iso = toManilaDateString(r.resolved_datetime);
      return iso !== null && iso >= startDate && iso <= endDate;
    }).length;
  } catch {
    return 0;
  }
}
