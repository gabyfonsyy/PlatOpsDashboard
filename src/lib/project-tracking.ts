import { groupByQuadrant, quadrantOf, triageFor, type Quadrant, type Triage } from "@/lib/work";

export type { Quadrant, Triage } from "@/lib/work";

export type ProjectStatus = "Not Started" | "In Progress" | "Blocked" | "Done";

/** Health is a called-out judgment, never derived — unlike the Eisenhower quadrant, nothing in the
 * data can compute "at risk" on its own, so this stays a plain select the owner sets themselves.
 * "" means never set (distinct from "not_started", which is a deliberate call for pre-kickoff work). */
export type ProjectHealth = "on_track" | "at_risk" | "off_track" | "not_started" | "blocked" | "";

export const HEALTH_META: Record<
  Exclude<ProjectHealth, "">,
  { label: string; tone: "success" | "warning" | "danger" | "neutral"; dot: string }
> = {
  on_track: { label: "On Track", tone: "success", dot: "bg-sprout-500" },
  at_risk: { label: "At Risk", tone: "warning", dot: "bg-amber-500" },
  off_track: { label: "Off Track", tone: "danger", dot: "bg-red-500" },
  blocked: { label: "Blocked", tone: "danger", dot: "bg-red-500" },
  not_started: { label: "Not Started", tone: "neutral", dot: "bg-neutral-400" },
};

export function healthLabel(health: ProjectHealth): string {
  return health ? HEALTH_META[health].label : "Unset";
}

/** How a project's % complete is tracked and which fields its form shows. Same semantics as the
 * legacy Sheets-based ProjectRecord.tracking_mode — "" means a pre-migration row saved before
 * this field existed; resolveDisplayPercent (lib/projection.ts) falls back to auto-detecting. */
export type ProjectTrackingMode = "manual" | "scheduled" | "tasks" | "";

/** Mirrors the live `projects` table (supabase/schema.sql). The first block of fields is the
 * Phase 0 migration off Sheets/GAS, field-for-field identical to the old ProjectRecord
 * (src/lib/types.ts, now removed); the Eisenhower/health/one-pager fields below `notes` are
 * Phase 1's own addition (add-project-eisenhower-onepager-columns.sql). */
export type Project = {
  project_id: string;
  project_name: string;
  owning_team: string;
  /** CSV of team_keys involved (in addition to owning_team). */
  teams_involved: string;
  owner: string;
  status: ProjectStatus;
  tracking_mode: ProjectTrackingMode;
  start_date: string;
  target_date: string;
  percent_complete: number;
  /** Shared Jira label linking this project to its cod-initiative tickets. */
  jira_label: string;
  total_items: number | "";
  batch_size: number | "";
  batches_per_week: number | "";
  /** JSON array of per-week overrides: [{ weekStart: "2026-07-21", items: 500 }]. "" or "[]" when none. */
  weekly_plan_json: string;
  notes: string;
  /** Eisenhower axes (Phase 1) — same model as My Work's, see quadrantOf/triageFor below. Null
   * means "not sorted yet", not "neither". */
  urgent: boolean | null;
  important: boolean | null;
  health: ProjectHealth;
  /** Reveals the batch-input UI (Total Items/Batch Size/Batches per Week/progress log)
   * independently of tracking_mode, which alone still drives % complete — see project-fields.tsx. */
  batch_tracking_enabled: boolean;
  contributors: string[];
  problem_context: string;
  objective: string;
  expected_outcome: string;
  scope: string;
  out_of_scope: string;
  success_metrics: string;
  /** Lifecycle/visibility flag (Phase 2), separate from `status` on purpose — archiving isn't a
   * workflow state, it's "stop showing this as active." */
  archived: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** One logged processing batch (mirrors the live `project_progress` table): how many items/DBs a
 * batch processed, on a date, optionally tied to a cod-initiative ticket. Rows sum into a
 * project's actual processed total, which drives % complete + the actual-throughput re-forecast. */
export type ProjectProgress = {
  progress_id: string;
  project_id: string;
  date: string;
  issue_key: string;
  items_processed: number;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** One checklist item under a project (mirrors the live `project_tasks` table). */
export type ProjectTask = {
  task_id: string;
  project_id: string;
  task_name: string;
  issue_key: string;
  done: boolean;
  start_date: string;
  target_date: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** A manual ticket->project assignment (mirrors the live `ticket_project_map` table). Manual
 * assignment overrides label match. */
export type TicketAssignment = {
  issue_key: string;
  project_id: string;
  assigned_by: string;
  assigned_at: string;
};

/** One Jira cod-initiative ticket (mirrors the live `initiative_tickets` table, primary key
 * (team_key, issue_key) — team_key isn't exposed here since nothing in the app needs it
 * separately from `project_key`, which is the Jira project key, e.g. DE/DEV/ST). */
export type InitiativeTicket = {
  issue_key: string;
  project_key: string;
  summary: string;
  issue_type: string;
  status: string;
  priority: string;
  labels: string;
  assignee_display_name: string;
  reporter_display_name: string;
  created: string;
  updated: string;
  duedate: string;
  resolution: string;
  resolved_datetime: string;
  last_synced_at: string;
};

// ---------------------------------------------------------------------------- eisenhower matrix

/** Thin, `Project`-typed wrappers around `lib/work.ts`'s generic Eisenhower helpers — this feature
 * borrows the UI concept, never the data, so it goes through the same pure functions rather than
 * re-deriving quadrant logic. */
export function projectQuadrantOf(project: Pick<Project, "urgent" | "important">): Quadrant | null {
  return quadrantOf(project);
}

export function projectTriageFor(quadrant: Quadrant | null): Triage {
  return triageFor(quadrant);
}

export function projectMatrixTally(projects: Project[]): {
  cells: Record<Quadrant, Project[]>;
  unsorted: Project[];
} {
  return groupByQuadrant(projects);
}

// ---------------------------------------------------------------------------- portfolio summary

/** How close to its target date counts as "due soon" for the portfolio summary strip — same
 * window as the later stale/approaching-target health hints, so the app doesn't carry two
 * different definitions of "soon". */
export const APPROACHING_TARGET_DAYS = 14;

export function isDueSoon(project: Pick<Project, "target_date" | "status">, today = new Date()): boolean {
  if (!project.target_date || project.status === "Done") return false;
  const target = new Date(`${project.target_date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  const diffDays = (target.getTime() - today.getTime()) / 86_400_000;
  return diffDays >= 0 && diffDays <= APPROACHING_TARGET_DAYS;
}

export type PortfolioSummary = {
  total: number;
  active: number;
  onTrack: number;
  atRisk: number;
  blocked: number;
  dueSoon: number;
};

// ---------------------------------------------------------------------------- phases (Phase 3)

export const PHASE_STATUSES = ["not_started", "in_progress", "blocked", "done"] as const;
export type ProjectPhaseStatus = (typeof PHASE_STATUSES)[number];

export const PHASE_STATUS_META: Record<ProjectPhaseStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  not_started: { label: "Not Started", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "warning" },
  blocked: { label: "Blocked", tone: "danger" },
  done: { label: "Done", tone: "success" },
};

/** One phase of a project (mirrors the live `project_phases` table). Ordered by `position`, which
 * IS the plan — see the note on `lib/work.ts`'s own `ProjectPhase.id` for why order is never
 * re-derived from anything else. A distinct type from that one: this is Records data, its own
 * table, not a jsonb array on `work_projects`. */
export type ProjectPhase = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  owner: string;
  status: ProjectPhaseStatus;
  progress: number;
  start_date: string;
  target_date: string;
  actual_completion_date: string;
  notes: string;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** A phase reads as delayed when it has a target date in the past and isn't Done — Actual
 * Completion Date is what a phase records once it finishes, never used to silently clear this. */
export function isPhaseDelayed(
  phase: Pick<ProjectPhase, "status" | "target_date">,
  today = new Date()
): boolean {
  if (phase.status === "done" || !phase.target_date) return false;
  const target = new Date(`${phase.target_date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() < today.getTime();
}

// ---------------------------------------------------------------------------- notes + activity (Phase 4)

export const NOTE_TYPES = ["update", "decision", "risk", "blocker", "followup"] as const;
export type ProjectNoteType = (typeof NOTE_TYPES)[number];

export const NOTE_TYPE_META: Record<ProjectNoteType, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  update: { label: "Update", tone: "neutral" },
  decision: { label: "Decision", tone: "success" },
  risk: { label: "Risk", tone: "warning" },
  blocker: { label: "Blocker", tone: "danger" },
  followup: { label: "Follow-up", tone: "neutral" },
};

/** A note against a project, or against one of its phases (`phase_id` set). `resolved` only means
 * something for `note_type: "blocker"` today — Phase 5 derives "is this project blocked" from an
 * unresolved blocker note; every other type just leaves it false. */
export type ProjectNote = {
  id: string;
  project_id: string;
  phase_id: string | null;
  note_type: ProjectNoteType;
  content: string;
  author_email: string;
  resolved: boolean;
  created_at: string;
};

/** Known event types the app itself writes — kept as labels for the log to read naturally, not as
 * a closed set: `logActivity` accepts any string, so a future phase can add its own event type
 * without this list needing to grow in lockstep. */
export const ACTIVITY_EVENT_LABELS: Record<string, string> = {
  status_changed: "Status changed",
  health_changed: "Health changed",
  priority_changed: "Priority changed",
  phase_created: "Phase added",
  phase_status_changed: "Phase status changed",
  phase_target_date_changed: "Phase target date changed",
  ticket_linked: "Ticket linked",
  ticket_unlinked: "Ticket unlinked",
  blocker_raised: "Blocker raised",
  blocker_resolved: "Blocker resolved",
  risk_added: "Risk added",
};

/** A human label for an event type — the known ones read naturally, an unrecognised one still
 * renders (title-cased from its snake_case) rather than showing raw plumbing. */
export function activityEventLabel(eventType: string): string {
  if (ACTIVITY_EVENT_LABELS[eventType]) return ACTIVITY_EVENT_LABELS[eventType];
  return eventType
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export type ProjectActivityEntry = {
  id: string;
  project_id: string;
  event_type: string;
  summary: string;
  actor_email: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

/** Counts for the team-filtered project list — `active` means not archived and not yet Done,
 * `blocked` reads the workflow `status`, `onTrack`/`atRisk` read the separately-set `health`
 * judgment. */
export function portfolioSummary(projects: Project[]): PortfolioSummary {
  return {
    total: projects.length,
    active: projects.filter((p) => !p.archived && p.status !== "Done").length,
    onTrack: projects.filter((p) => p.health === "on_track").length,
    atRisk: projects.filter((p) => p.health === "at_risk").length,
    blocked: projects.filter((p) => p.status === "Blocked").length,
    dueSoon: projects.filter((p) => isDueSoon(p)).length,
  };
}
