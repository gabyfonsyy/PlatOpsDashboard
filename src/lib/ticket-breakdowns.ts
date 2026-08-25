import { getSupabaseClient, fetchAllRows } from "@/lib/supabase";
import {
  getTeams,
  backlogAgingAssignee,
  backlogAgingAssigneeLabel,
  excludedIssueTypes,
  isExcludedIssueType,
  type TeamConfig,
} from "@/lib/teams";
import { resolvePeriodToDateRange } from "@/lib/period-range";
import { toManilaDateString } from "@/lib/manila-date";

/**
 * Labels stripped out of every Product+Label analysis AND every ticket list on these pages.
 *
 * All of them are workflow/automation bookkeeping — they record what a process did to a ticket,
 * not what the ticket was about. Left in, they dominate the rankings (they are applied broadly and
 * near-randomly with respect to subject matter) and bury the labels that actually classify work.
 * Requested by Gaby 2026-08-24, extended 2026-08-25.
 *
 * This one list is the single source of truth: `meaningfulLabels` is applied both to the ranking
 * tables and to the Labels column of every ticket table (via toTicket), and ComboTable's caption
 * renders from it — so adding a label here takes effect everywhere at once and the prose cannot
 * drift from the behaviour.
 *
 * Distinct from the "-ops" department-tag filter in lib/lead-cycle-time.ts, which drops team tags
 * (se-ops, hr-ops). Both exclusions answer "is this label a classification of the work?" — they
 * just catch different kinds of non-answer.
 */
export const ANALYSIS_EXCLUDED_LABELS = [
  "automation-done",
  "ffup-1",
  "ffup-2",
  "autoclose-nonresponse",
  "crf",
  "jira_escalated",
  "update-companypolicy",
  "expedite",
  // Added 2026-08-25 — same rationale: alerting, routing and triage bookkeeping.
  "p1-alerted",
  "acc-d1se",
  "decode",
  "routed-secops",
  "triage-complete",
];

/**
 * How many tickets a drill-down list carries. Was 25, raised 2026-08-25 when the ticket tables
 * became filterable: a filter over the 25 most recent rows searches almost nothing, and the point
 * of the filter is finding a specific ticket in the month. The tables say "showing N of M" when
 * this cap actually bites, so a truncated list never reads as a complete one.
 */
export const BREAKDOWN_TICKET_LIMIT = 500;

const EXCLUDED_LABEL_SET = new Set(ANALYSIS_EXCLUDED_LABELS.map((l) => l.toLowerCase()));

/** Splits a CSV label cell into usable classification labels, dropping the excluded ones. */
export function meaningfulLabels(labels: string | null | undefined): string[] {
  return (labels || "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !EXCLUDED_LABEL_SET.has(l.toLowerCase()));
}

/**
 * Mirrors isRealEscalation_ in gas/Aggregation.gs EXACTLY, including that it tests the whole field
 * rather than the individual targets: 'N/A', 'CA' and 'SE' mean "handled inside the team", and
 * anything else (including a multi-target value like 'DBA, DevOps') is a real escalation. The
 * scorecard's Escalation Rate is built on this, so drift here desynchronises the card from the
 * page it links to.
 */
export function isRealEscalation(value: string | null | undefined): boolean {
  const v = (value || "").trim();
  return v !== "" && v !== "N/A" && v !== "CA" && v !== "SE";
}

/**
 * Ticket Escalation is a Jira MULTI-SELECT flattened to a comma-separated string, so 'DBA, DevOps'
 * is one ticket raised to two teams. Splitting it is what lets this report give per-team counts:
 * that ticket contributes one entry to DBA and one to DevOps, as Gaby specified. The in-team
 * markers are dropped so they can never show up as an escalation target.
 */
export function escalationTargets(value: string | null | undefined): string[] {
  if (!isRealEscalation(value)) return [];
  return (value || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t !== "N/A" && t !== "CA" && t !== "SE");
}

export type CountRow = { key: string; count: number; share: number | null };
export type ComboRow = { product: string; label: string; count: number };

export type BreakdownTicket = {
  issueKey: string;
  issueType: string;
  assignee: string;
  product: string;
  labels: string;
  resolvedAt: string;
  /** Escalation targets on the escalation report, why-it-counted on FCR; "" elsewhere. */
  detail: string;
  /** Minutes, for the on-hold report; null elsewhere. */
  minutes: number | null;
};

type BreakdownRow = {
  issue_key: string;
  issue_type: string | null;
  resolved_datetime: string;
  fcr_value: string | null;
  escalation_value: string | null;
  product: string | null;
  labels: string | null;
  assigned_se: string | null;
  assigned_cod: string | null;
  total_on_hold_minutes: number | string | null;
  holding_reasons_json: unknown;
};

const SELECT =
  "issue_key,issue_type,resolved_datetime,fcr_value,escalation_value,product,labels,assigned_se,assigned_cod,total_on_hold_minutes,holding_reasons_json";

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toCountRows(counts: Record<string, number>, denominator: number): CountRow[] {
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count, share: denominator ? round4(count / denominator) : null }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * Every report here is scoped to tickets RESOLVED in the period — the same basis the scorecard's
 * FCR and Escalation rates already use (fcr_yes_resolved_on_date and
 * escalation_qualifying_resolved_on_date are both indexed by resolved date in
 * gas/Aggregation.gs's buildResolvedIndex_), so these pages reconcile with the cards linking here.
 *
 * Coarse UTC prefilter widened a day each side, exact Manila-day check in JS — the same split as
 * lib/backlog-aging.ts.
 */
async function fetchResolvedRows(
  teamKey: string,
  startDate: string,
  endDate: string,
  issueType?: string
): Promise<BreakdownRow[]> {
  const rangeStartUtc = new Date(`${startDate}T00:00:00Z`);
  rangeStartUtc.setUTCDate(rangeStartUtc.getUTCDate() - 1);
  const rangeEndUtc = new Date(`${endDate}T00:00:00Z`);
  rangeEndUtc.setUTCDate(rangeEndUtc.getUTCDate() + 2);
  const excluded = excludedIssueTypes(teamKey);

  return fetchAllRows<BreakdownRow>((from, to) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    // `any` for the same reason as lib/lead-cycle-time.ts: conditional re-chaining widens
    // supabase-js's builder generics until TS reports "type instantiation is excessively deep".
    let q: any = getSupabaseClient()
      .from("tickets")
      .select(SELECT)
      .eq("team_key", teamKey)
      .not("resolved_datetime", "is", null)
      .gte("resolved_datetime", rangeStartUtc.toISOString())
      .lte("resolved_datetime", rangeEndUtc.toISOString());
    if (issueType) q = q.eq("issue_type", issueType);
    if (excluded.length) q = q.not("issue_type", "in", `(${excluded.map((t) => `"${t}"`).join(",")})`);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return q.range(from, to);
  });
}

async function loadScope(team: string, range: string, period: string, issueType?: string) {
  const { startDate, endDate } = resolvePeriodToDateRange(range, period);
  const teamConfig = (await getTeams()).find((t) => t.team_key === team);
  if (!teamConfig) throw new Error(`Unknown team: ${team}`);

  const rows = (await fetchResolvedRows(team, startDate, endDate, issueType)).filter((r) => {
    if (isExcludedIssueType(team, r.issue_type)) return false;
    const iso = toManilaDateString(r.resolved_datetime);
    return iso !== null && iso >= startDate && iso <= endDate;
  });
  return { teamConfig, rows };
}

/**
 * Product x Label pair counts. A ticket with 3 labels contributes 3 pairs, one per label.
 *
 * Keeps each pair's parts in the Map value instead of encoding them into the key and splitting
 * them back out: products and labels both routinely contain spaces and hyphens, so any delimiter
 * cheap enough to type is one that can occur in the data.
 */
function productLabelCombos(rows: BreakdownRow[]): ComboRow[] {
  const combos = new Map<string, ComboRow>();
  for (const r of rows) {
    const product = r.product || "(none)";
    for (const label of meaningfulLabels(r.labels)) {
      const key = `${product}|${label}`;
      const existing = combos.get(key);
      if (existing) existing.count++;
      else combos.set(key, { product, label, count: 1 });
    }
  }
  return Array.from(combos.values()).sort(
    (a, b) => b.count - a.count || a.product.localeCompare(b.product) || a.label.localeCompare(b.label)
  );
}

function assigneeCounts(rows: BreakdownRow[], teamConfig: TeamConfig): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const who = backlogAgingAssignee(teamConfig, r) || "(unassigned)";
    counts[who] = (counts[who] || 0) + 1;
  }
  return counts;
}

function groupCounts(rows: BreakdownRow[], keyFn: (r: BreakdownRow) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const key = keyFn(r);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function toTicket(
  r: BreakdownRow,
  teamConfig: TeamConfig,
  detail: string,
  minutes: number | null
): BreakdownTicket {
  return {
    issueKey: r.issue_key,
    issueType: r.issue_type || "",
    assignee: backlogAgingAssignee(teamConfig, r) || "(unassigned)",
    product: r.product || "(none)",
    labels: meaningfulLabels(r.labels).join(", "),
    resolvedAt: r.resolved_datetime,
    detail,
    minutes,
  };
}

const byResolvedDesc = (a: BreakdownRow, b: BreakdownRow) => (a.resolved_datetime < b.resolved_datetime ? 1 : -1);

// ---------------------------------------------------------------- Escalation

export type EscalationReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  assigneeLabel: string;
  resolvedInPeriod: number;
  escalatedTickets: number;
  escalationRate: number | null;
  /** Sum of byTarget counts. Exceeds escalatedTickets whenever tickets go to more than one team. */
  escalationEntries: number;
  multiTargetTickets: number;
  byTarget: CountRow[];
  byProductLabel: ComboRow[];
  byProduct: CountRow[];
  byAssignee: CountRow[];
  byIssueType: CountRow[];
  tickets: BreakdownTicket[];
};

const EMPTY_ESCALATION: Omit<EscalationReport, "team" | "range" | "period" | "issueType"> = {
  assigneeLabel: "Assignee", resolvedInPeriod: 0, escalatedTickets: 0, escalationRate: null,
  escalationEntries: 0, multiTargetTickets: 0, byTarget: [], byProductLabel: [], byProduct: [],
  byAssignee: [], byIssueType: [], tickets: [],
};

export async function getEscalationReport(
  team: string,
  range: string,
  period: string,
  issueType?: string
): Promise<EscalationReport> {
  try {
    const { teamConfig, rows } = await loadScope(team, range, period, issueType);
    const escalated = rows.filter((r) => isRealEscalation(r.escalation_value));

    // One entry PER TARGET: a ticket tagged "DBA, DevOps" is one raise to DBA and one to DevOps,
    // so these counts sum to more than the number of escalated tickets. That is the point — the
    // question this answers is "how much work did each team receive from us", not "how many
    // tickets left".
    const targetCounts: Record<string, number> = {};
    let entries = 0;
    let multi = 0;
    for (const r of escalated) {
      const targets = escalationTargets(r.escalation_value);
      if (targets.length > 1) multi++;
      for (const t of targets) {
        targetCounts[t] = (targetCounts[t] || 0) + 1;
        entries++;
      }
    }

    return {
      team, range, period, issueType: issueType ?? null,
      assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
      resolvedInPeriod: rows.length,
      escalatedTickets: escalated.length,
      escalationRate: rows.length ? round4(escalated.length / rows.length) : null,
      escalationEntries: entries,
      multiTargetTickets: multi,
      byTarget: toCountRows(targetCounts, entries),
      byProductLabel: productLabelCombos(escalated).slice(0, 15),
      byProduct: toCountRows(groupCounts(escalated, (r) => r.product || "(none)"), escalated.length).slice(0, 10),
      byAssignee: toCountRows(assigneeCounts(escalated, teamConfig), escalated.length).slice(0, 10),
      byIssueType: toCountRows(groupCounts(escalated, (r) => r.issue_type || "(none)"), escalated.length).slice(0, 10),
      tickets: escalated
        .slice()
        .sort(byResolvedDesc)
        .slice(0, BREAKDOWN_TICKET_LIMIT)
        .map((r) => toTicket(r, teamConfig, escalationTargets(r.escalation_value).join(", "), null)),
    };
  } catch {
    return { team, range, period, issueType: issueType ?? null, ...EMPTY_ESCALATION };
  }
}

// ---------------------------------------------------------------------- FCR

export type FcrReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  assigneeLabel: string;
  resolvedInPeriod: number;
  /** fcr_value = 'Yes' — the definition behind the scorecard's FCR Rate. */
  fcrYesTickets: number;
  fcrRate: number | null;
  /** Gaby's definition: handled without leaving the team (CA/SE/N/A/blank) OR FCR = Yes. */
  resolvedBySeTickets: number;
  resolvedBySeRate: number | null;
  /** In the SE-resolved set only because FCR=Yes, despite having been escalated. */
  escalatedButFcrYes: number;
  /**
   * The actual tickets behind that count, so the inconsistency can be corrected in Jira rather
   * than just measured. Escalation targets are kept in `detail` — that is the field that has to
   * be reconciled against FCR = Yes, so it belongs in front of whoever is doing the correcting.
   */
  escalatedButFcrYesTickets: BreakdownTicket[];
  byProductLabel: ComboRow[];
  byProduct: CountRow[];
  byAssignee: CountRow[];
  byIssueType: CountRow[];
  tickets: BreakdownTicket[];
};

const EMPTY_FCR: Omit<FcrReport, "team" | "range" | "period" | "issueType"> = {
  assigneeLabel: "Assignee", resolvedInPeriod: 0, fcrYesTickets: 0, fcrRate: null,
  resolvedBySeTickets: 0, resolvedBySeRate: null, escalatedButFcrYes: 0,
  escalatedButFcrYesTickets: [], byProductLabel: [],
  byProduct: [], byAssignee: [], byIssueType: [], tickets: [],
};

export async function getFcrReport(
  team: string,
  range: string,
  period: string,
  issueType?: string
): Promise<FcrReport> {
  try {
    const { teamConfig, rows } = await loadScope(team, range, period, issueType);
    const isFcrYes = (r: BreakdownRow) => (r.fcr_value || "").trim() === "Yes";

    const fcrYes = rows.filter(isFcrYes);
    // "Resolved by SE" per Gaby: it never left the team, OR it was first-contact resolved anyway.
    const resolvedBySe = rows.filter((r) => !isRealEscalation(r.escalation_value) || isFcrYes(r));
    const escalatedButFcrYesRows = rows.filter((r) => isRealEscalation(r.escalation_value) && isFcrYes(r));

    return {
      team, range, period, issueType: issueType ?? null,
      assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
      resolvedInPeriod: rows.length,
      fcrYesTickets: fcrYes.length,
      fcrRate: rows.length ? round4(fcrYes.length / rows.length) : null,
      resolvedBySeTickets: resolvedBySe.length,
      resolvedBySeRate: rows.length ? round4(resolvedBySe.length / rows.length) : null,
      escalatedButFcrYes: escalatedButFcrYesRows.length,
      escalatedButFcrYesTickets: escalatedButFcrYesRows
        .slice()
        .sort(byResolvedDesc)
        .slice(0, BREAKDOWN_TICKET_LIMIT)
        .map((r) => toTicket(r, teamConfig, escalationTargets(r.escalation_value).join(", "), null)),
      byProductLabel: productLabelCombos(resolvedBySe).slice(0, 15),
      byProduct: toCountRows(groupCounts(resolvedBySe, (r) => r.product || "(none)"), resolvedBySe.length).slice(0, 10),
      byAssignee: toCountRows(assigneeCounts(resolvedBySe, teamConfig), resolvedBySe.length).slice(0, 10),
      byIssueType: toCountRows(groupCounts(resolvedBySe, (r) => r.issue_type || "(none)"), resolvedBySe.length).slice(0, 10),
      tickets: resolvedBySe
        .slice()
        .sort(byResolvedDesc)
        .slice(0, BREAKDOWN_TICKET_LIMIT)
        .map((r) => toTicket(r, teamConfig, isFcrYes(r) ? "FCR = Yes" : "Not escalated", null)),
    };
  } catch {
    return { team, range, period, issueType: issueType ?? null, ...EMPTY_FCR };
  }
}

// ------------------------------------------------------------------ On hold

export type OnHoldReport = {
  team: string;
  range: string;
  period: string;
  issueType: string | null;
  assigneeLabel: string;
  resolvedInPeriod: number;
  heldTickets: number;
  heldShare: number | null;
  avgMinutes: number | null;
  medianMinutes: number | null;
  maxMinutes: number | null;
  totalMinutes: number;
  byReason: CountRow[];
  byProduct: CountRow[];
  byAssignee: CountRow[];
  byIssueType: CountRow[];
  tickets: BreakdownTicket[];
};

const EMPTY_ON_HOLD: Omit<OnHoldReport, "team" | "range" | "period" | "issueType"> = {
  assigneeLabel: "Assignee", resolvedInPeriod: 0, heldTickets: 0, heldShare: null, avgMinutes: null,
  medianMinutes: null, maxMinutes: null, totalMinutes: 0, byReason: [], byProduct: [],
  byAssignee: [], byIssueType: [], tickets: [],
};

/**
 * holding_reasons_json is an array of plain reason STRINGS, one per time the ticket went On Hold —
 * e.g. ["Awaiting client feedback","Missing details","Missing details"]. Note this differs from the
 * object-per-cycle shape extractHoldingCyclesWithReasons_ builds in gas/JiraSync.gs; only the
 * reason survives into the Supabase column. The object form is still accepted below so that a
 * future sync writing the richer shape does not silently turn every reason into "(unspecified)" —
 * which is exactly the failure this function had on first write.
 *
 * Counting every entry rather than one per ticket is deliberate: a ticket held three times for
 * three different reasons is three separate facts about why work stalls, which is the question
 * this table answers. That also means these counts are per HOLD, not per ticket.
 */
function holdingReasonCounts(rows: BreakdownRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const entries = Array.isArray(r.holding_reasons_json) ? r.holding_reasons_json : [];
    for (const entry of entries) {
      const raw =
        typeof entry === "string" ? entry : String((entry as { reason?: unknown })?.reason ?? "");
      const reason = raw.trim() || "(unspecified)";
      counts[reason] = (counts[reason] || 0) + 1;
    }
  }
  return counts;
}

export async function getOnHoldReport(
  team: string,
  range: string,
  period: string,
  issueType?: string
): Promise<OnHoldReport> {
  try {
    const { teamConfig, rows } = await loadScope(team, range, period, issueType);
    const held = rows.filter((r) => Number(r.total_on_hold_minutes) > 0);
    const minutes = held.map((r) => Number(r.total_on_hold_minutes)).sort((a, b) => a - b);

    // Median alongside the mean because on-hold time is heavily right-skewed — a handful of
    // tickets parked over a weekend drag the average to somewhere no real ticket sits.
    const median = minutes.length
      ? minutes.length % 2
        ? minutes[(minutes.length - 1) / 2]
        : (minutes[minutes.length / 2 - 1] + minutes[minutes.length / 2]) / 2
      : null;

    return {
      team, range, period, issueType: issueType ?? null,
      assigneeLabel: backlogAgingAssigneeLabel(teamConfig),
      resolvedInPeriod: rows.length,
      heldTickets: held.length,
      heldShare: rows.length ? round4(held.length / rows.length) : null,
      avgMinutes: minutes.length ? round2(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
      medianMinutes: median === null ? null : round2(median),
      maxMinutes: minutes.length ? round2(minutes[minutes.length - 1]) : null,
      totalMinutes: round2(minutes.reduce((a, b) => a + b, 0)),
      // Denominator 0: reason counts are per HOLD CYCLE, not per ticket, so a share of the ticket
      // count would be a ratio between two different populations.
      byReason: toCountRows(holdingReasonCounts(held), 0),
      byProduct: toCountRows(groupCounts(held, (r) => r.product || "(none)"), held.length).slice(0, 10),
      byAssignee: toCountRows(assigneeCounts(held, teamConfig), held.length).slice(0, 10),
      byIssueType: toCountRows(groupCounts(held, (r) => r.issue_type || "(none)"), held.length).slice(0, 10),
      tickets: held
        .slice()
        .sort((a, b) => Number(b.total_on_hold_minutes) - Number(a.total_on_hold_minutes))
        .slice(0, 25)
        .map((r) => toTicket(r, teamConfig, "", Number(r.total_on_hold_minutes))),
    };
  } catch {
    return { team, range, period, issueType: issueType ?? null, ...EMPTY_ON_HOLD };
  }
}
