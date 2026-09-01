/**
 * Incident Logs domain module: the severity rubric, the concern-category taxonomy, and the
 * types both the server page and the client components share.
 *
 * Nothing here imports the GAS client or `next/headers`, so client components can pull the
 * rubric and taxonomy in directly (same reason teamLabel lives in lib/utils.ts).
 */

export type IncidentRole = "Doer" | "Validator";

export const INCIDENT_ROLES: IncidentRole[] = ["Doer", "Validator"];

export type IncidentSeverityCode = "S1" | "S2" | "S3" | "S4";

export type IncidentSeverity = {
  code: IncidentSeverityCode;
  label: string;
  description: string;
  /** Deduction applied to the person's evaluation for this incident. */
  scoreImpact: number;
};

/**
 * Mirrors INCIDENT_SEVERITIES in gas/IncidentsApi.gs, which is the authority: the backend
 * recomputes score_impact from the severity code on every write, so a stale copy here can only
 * ever mislabel the UI, never corrupt a stored score. Keep the two in step when the rubric changes.
 */
export const INCIDENT_SEVERITIES: Record<IncidentSeverityCode, IncidentSeverity> = {
  S1: {
    code: "S1",
    label: "Critical",
    description: "Full production outage; all clients affected",
    scoreImpact: -3,
  },
  S2: {
    code: "S2",
    label: "Major",
    description: "Partial outage or multiple clients impacted",
    scoreImpact: -2,
  },
  S3: {
    code: "S3",
    label: "Minor",
    description: "Single client affected; significant rework or back-and-forths needed",
    scoreImpact: -1.5,
  },
  S4: {
    code: "S4",
    label: "Low",
    description: "Wrong info shared but easily corrected; minimal client impact",
    scoreImpact: -1,
  },
};

export const INCIDENT_SEVERITY_CODES = Object.keys(INCIDENT_SEVERITIES) as IncidentSeverityCode[];

/**
 * A closed taxonomy rather than free-form AI output. The categories are what the evaluation
 * conversation is actually organised around, and an open-ended model would happily emit
 * "Communication", "Comms", and "Communication Skills" as three different things across three
 * tickets — which makes the byCategory rollup meaningless. The AI's job is to CLASSIFY into this
 * list (see the prompt in api/ai/incident-feedback), not to invent labels.
 */
export const INCIDENT_CATEGORIES = [
  "Technical Skills",
  "Communication Skills",
  "Process Adherence",
  "Attention to Detail",
  "Documentation",
  "Time Management",
  "Client Handling",
  "Escalation Judgment",
  "Collaboration",
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

/**
 * Issue-type groups the view segregates by. Mirrors INCIDENT_ISSUE_GROUPS in gas/IncidentsApi.gs,
 * which is the authority — the group is derived server-side on read and sent down as issue_group,
 * so this copy only drives the filter's option list and the display order.
 *
 * Not the same split as the cycle-time investigation list in gas/JiraSync.gs (which also counts
 * External Support Request and Team Viewer). Independent on purpose.
 */
export const INCIDENT_ISSUE_GROUPS = ["Backend Changes", "Investigation", "Others"] as const;

export type IncidentIssueGroup = (typeof INCIDENT_ISSUE_GROUPS)[number];

/** Group -> Badge tone, so the two real groups are visually distinct and Others reads as neutral. */
export function issueGroupTone(group: string): "success" | "warning" | "neutral" {
  if (group === "Backend Changes") return "success";
  if (group === "Investigation") return "warning";
  return "neutral";
}

/** One Jira ticket the manager tagged with Report Tagging — synced, never written back to. */
export type IncidentTicket = {
  issue_key: string;
  team_key: string;
  project_key: string;
  summary: string;
  issue_type: string;
  status: string;
  /** The team's configured owner (Assigned SE / Assigned COD), falling back to Jira's assignee. */
  doer: string;
  /** Whoever held the ticket when it last left "For Peer Review". Blank for teams without one. */
  validator: string;
  created: string;
  updated: string;
  resolved_datetime: string;
  /** Resolved date, falling back to created — the date the year/month filter counts it under. */
  incident_date: string;
  last_synced_at: string;
  /** Derived server-side from issue_type on every read — see INCIDENT_ISSUE_GROUPS. */
  issue_group?: string;
  /** Manually set validator. Outranks the derivation and survives every sync. */
  validator_override?: string;
  /** What the changelog derivation produced, kept visible under any override. */
  validator_derived?: string;
  /**
   * Set by the sync when Report Tagging has been cleared in Jira on a ticket the sweep could not
   * delete because it already carries logs. Blank on every normal row, and cleared again if the
   * ticket is re-tagged. Its presence means "the manager retracted this; the logs are still here".
   */
  untagged_at?: string;
};

/** One person's log against one incident. A ticket can have a Doer log and a Validator log. */
export type IncidentLog = {
  incident_id: string;
  issue_key: string;
  team_key: string;
  role: IncidentRole;
  employee_name: string;
  severity: IncidentSeverityCode;
  /** Always recomputed backend-side from `severity`; never sent by the form. */
  score_impact: number;
  incident_date: string;
  /** What the manager typed. Kept verbatim alongside the polished version, never overwritten. */
  feedback_raw: string;
  /** The AI's neutral, professional-but-warm rewrite of feedback_raw. */
  feedback_polished: string;
  /** AI-suggested concrete improvements for the person. */
  improvements: string;
  categories: string[];
  /** Inherited from the log's ticket (a log has no issue type of its own). */
  issue_group?: string;
  ai_model: string;
  ai_generated_at: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type IncidentStats = {
  totalTickets: number;
  totalLogs: number;
  /** Tagged in Jira but with no log written yet — the manager's actual to-do count. */
  unloggedTickets: number;
  totalScoreImpact: number;
  bySeverity: { severity: string; label: string; scoreImpact: number; count: number }[];
  byRole: { role: string; count: number }[];
  byEmployee: {
    employee: string;
    team_key: string;
    count: number;
    scoreImpact: number;
    /** Sum of severity magnitudes — what comes off this person's 100. */
    deduction: number;
    /** 100 − deduction. */
    score: number;
    asDoer: number;
    asValidator: number;
  }[];
  /** 100 − (team's total deductions ÷ active roster size). One entry per team in scope. */
  teamScores: {
    team_key: string;
    rosterCount: number;
    logCount: number;
    ticketCount: number;
    /** Tagged tickets with no log yet. Non-zero means the score isn't determined. */
    unloggedTickets: number;
    deductionTotal: number;
    avgDeductionPerMember: number;
    teamScore: number;
    /** False while anything is still awaiting feedback — show the pending count, not a score. */
    scoreReady: boolean;
  }[];
  byCategory: { category: string; count: number }[];
  byIssueGroup: { group: string; tickets: number; logs: number; scoreImpact: number }[];
};

export type IncidentListResult = {
  range: { startDate: string; endDate: string } | null;
  tickets: IncidentTicket[];
  logs: IncidentLog[];
  stats: IncidentStats;
  availableYears: string[];
  /** The fixed floor the sync enforces (INCIDENT_SYNC_START_DATE in gas/IncidentsApi.gs). */
  startDate?: string;
  issueGroups?: string[];
  /** Teams that segregate by issue type at all — DBA/DevOps file one issue type, so they don't. */
  issueGroupTeamKeys?: string[];
  /** Everyone with a log in the current window, for the member filter. */
  availableMembers?: string[];
  /** The designated peer reviewers — the only names allowed in the validator field. */
  validatorNames?: string[];
};

export const EMPTY_INCIDENT_STATS: IncidentStats = {
  totalTickets: 0,
  totalLogs: 0,
  unloggedTickets: 0,
  totalScoreImpact: 0,
  bySeverity: INCIDENT_SEVERITY_CODES.map((code) => ({
    severity: code,
    label: INCIDENT_SEVERITIES[code].label,
    scoreImpact: INCIDENT_SEVERITIES[code].scoreImpact,
    count: 0,
  })),
  byRole: INCIDENT_ROLES.map((role) => ({ role, count: 0 })),
  byEmployee: [],
  byCategory: [],
  teamScores: [],
  byIssueGroup: INCIDENT_ISSUE_GROUPS.map((group) => ({ group, tickets: 0, logs: 0, scoreImpact: 0 })),
};

export const EMPTY_INCIDENT_RESULT: IncidentListResult = {
  range: null,
  tickets: [],
  logs: [],
  stats: EMPTY_INCIDENT_STATS,
  availableYears: [String(new Date().getFullYear())],
};

/** The AI's response shape for a feedback rewrite — see api/ai/incident-feedback. */
export type IncidentFeedbackAssist = {
  polished: string;
  improvements: string;
  categories: string[];
  model: string;
};

/** Deep link to the ticket. baseUrl comes from the server (JIRA_BASE_URL isn't public). */
export function jiraIssueUrl(baseUrl: string, issueKey: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/browse/${issueKey}`;
}

/**
 * Severity -> Badge tone. S1/S2 are red because they are outage-level and should read that way
 * at a glance in a long table; S3 amber; S4 neutral.
 */
export function severityTone(severity: string): "danger" | "warning" | "neutral" {
  if (severity === "S1" || severity === "S2") return "danger";
  if (severity === "S3") return "warning";
  return "neutral";
}

export function severityLabel(severity: string): string {
  return INCIDENT_SEVERITIES[severity as IncidentSeverityCode]?.label ?? severity;
}

export function severityScoreImpact(severity: string): number {
  return INCIDENT_SEVERITIES[severity as IncidentSeverityCode]?.scoreImpact ?? 0;
}

/**
 * A 100-based score for display. Two decimals only when they carry information, so a clean 100
 * reads as "100" and a team average reads as "99.71" rather than "99.7100".
 */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** Signed, 2-decimals-when-needed score for display: -1.5, -3, +0. */
export function formatScoreImpact(value: number): string {
  if (!value) return "0";
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/**
 * Which roles a team can log against. Only teams with a peer-review step (SE) have a validator
 * to hold accountable — for DBA/DevOps every incident belongs to the doer, and offering a
 * Validator option there would invite logs against a person who was never in the loop.
 */
export function rolesForTeam(hasPeerReview: boolean): IncidentRole[] {
  return hasPeerReview ? INCIDENT_ROLES : ["Doer"];
}

/**
 * The person a log should default to for a given role: the ticket's doer or its validator as
 * synced from Jira. Returns "" when the ticket has no validator recorded, which leaves the form's
 * employee field empty for the manager to fill rather than silently attributing it to the doer.
 */
export function defaultEmployeeForRole(ticket: IncidentTicket, role: IncidentRole): string {
  return role === "Validator" ? ticket.validator : ticket.doer;
}

/**
 * The reporting period dropdown: full year, a quarter, or a month. One control rather than
 * separate quarter/month selects, since they are mutually exclusive — see
 * resolveIncidentDateRange_ in gas/IncidentsApi.gs, which resolves the value sent here.
 */
export const INCIDENT_PERIODS: { value: string; label: string }[] = [
  { value: "", label: "Full year" },
  { value: "Q1", label: "Q1 (Jan–Mar)" },
  { value: "Q2", label: "Q2 (Apr–Jun)" },
  { value: "Q3", label: "Q3 (Jul–Sep)" },
  { value: "Q4", label: "Q4 (Oct–Dec)" },
];

/** Month options for the filter, as [value, label] — "" meaning the whole year. */
export const INCIDENT_MONTHS: { value: string; label: string }[] = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];
