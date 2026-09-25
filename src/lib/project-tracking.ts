import {
  groupByQuadrant,
  quadrantOf,
  type BriefFieldReview,
  type Quadrant,
  type Triage,
} from "@/lib/work";

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
  /** "The date you'd defend in a review" — distinct from the working `target_date`. "" when unset. */
  committed_date: string;
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
  /** Opt-in: when true, `linked tickets x batch_size` drives processed count instead of manually
   * logged progress rows — see resolveDisplayPercent's caller in page.tsx. */
  batch_actuals_from_tickets: boolean;
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
  /** The charter's own `client_ref`, stamped on first import so a later upload of the SAME (or
   * revised) charter can be matched back to this project and update it instead of creating a
   * duplicate. "" for a project never created from a charter. */
  charter_client_ref: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** The six one-pager text fields, in display order — one source of truth for their key/label
 * pairing, shared by the read-only `ProjectOnePager`, the Add Project flow, and the AI review
 * route, so the three can't quietly drift apart on what "the one-pager" means. */
export type OnePagerFieldKey =
  | "problem_context"
  | "objective"
  | "expected_outcome"
  | "scope"
  | "out_of_scope"
  | "success_metrics";

export const ONE_PAGER_FIELDS: Array<{ key: OnePagerFieldKey; label: string }> = [
  { key: "problem_context", label: "Problem" },
  { key: "objective", label: "Objective" },
  { key: "expected_outcome", label: "Expected Outcome" },
  { key: "scope", label: "Scope" },
  { key: "out_of_scope", label: "Out of Scope" },
  { key: "success_metrics", label: "Success Metrics" },
];

/** AI review of a project's one-pager — reuses `BriefFieldReview` (`{revised, why, asks}`) from
 * My Work's own brief-review feature directly, one per one-pager field. Simpler than that
 * feature's own `BriefReview`: every field here is a single paragraph, so none of them need the
 * baseline/target/by-when metric split or the items/suggested list split those questions get
 * there. */
export type ProjectOnePagerReview = {
  problem_context: BriefFieldReview | null;
  objective: BriefFieldReview | null;
  expected_outcome: BriefFieldReview | null;
  scope: BriefFieldReview | null;
  out_of_scope: BriefFieldReview | null;
  success_metrics: BriefFieldReview | null;
  discarded: string[];
  model: string | null;
  generatedAt?: string;
  fromCache?: boolean;
  unavailable?: string;
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
  completed: number;
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

/** Which phase a project is "in" right now, for a compact overview — the first phase (by
 * position) that isn't `done`, or the last phase if every phase is done, or `null` if there are
 * no phases yet. Simpler than My Work's task-derived version of this idea: a `ProjectPhase`
 * already reports its own status directly, there's no linked-task list to infer it from. */
export function currentPhaseFor(phases: ProjectPhase[]): ProjectPhase | null {
  if (phases.length === 0) return null;
  return phases.find((p) => p.status !== "done") ?? phases[phases.length - 1];
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

// ---------------------------------------------------------------------------- milestones, dependencies, risks (Phase 5)

export type ProjectMilestone = {
  id: string;
  project_id: string;
  name: string;
  done: boolean;
  target_date: string;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export const DEPENDENCY_STATUSES = ["open", "resolved"] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

/** A blocking external dependency — optionally scoped to one phase via `phase_id`, otherwise
 * project-level. Distinct from a blocker note: a dependency is "waiting on something outside this
 * project," a blocker note is "this project itself can't move." */
export type ProjectDependency = {
  id: string;
  project_id: string;
  phase_id: string | null;
  label: string;
  status: DependencyStatus;
  created_by: string;
  created_at: string;
};

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number] | "";

export const RISK_LEVEL_META: Record<Exclude<RiskLevel, "">, { label: string; tone: "success" | "warning" | "danger" }> = {
  low: { label: "Low", tone: "success" },
  medium: { label: "Medium", tone: "warning" },
  high: { label: "High", tone: "danger" },
};

export const RISK_STATUSES = ["open", "mitigated", "closed"] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export type ProjectRisk = {
  id: string;
  project_id: string;
  risk: string;
  impact: RiskLevel;
  likelihood: RiskLevel;
  mitigation: string;
  owner: string;
  status: RiskStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** "Blocked" is derived, never stored on the project itself — a project is blocked exactly when it
 * has an unresolved `note_type: "blocker"` note. Reusing `project_notes` (Phase 4) rather than a
 * dedicated table/flag means resolving the blocker note IS un-blocking the project, with no second
 * place for the two facts to disagree. */
export function isBlocked(notes: Array<Pick<ProjectNote, "note_type" | "resolved">>): boolean {
  return notes.some((n) => n.note_type === "blocker" && !n.resolved);
}

// ---------------------------------------------------------------------------- phase ticket links (Phase 6)

/** A ticket linked to one PHASE specifically — additional to, never a replacement for, the
 * project-level link on `ticket_project_map`/`InitiativeTicketsTable.tsx`, which Phase 6 leaves
 * completely untouched. */
export type ProjectPhaseTicket = {
  id: string;
  phase_id: string;
  project_id: string;
  issue_key: string;
  assigned_by: string;
  assigned_at: string;
};

// ---------------------------------------------------------------------------- stale signals (Phase 6)

/** From the plan's "Health-hint thresholds" decision (Phase 1): visual hints only, NEVER used to
 * auto-set `health` — a human still has to look and decide. */
export const STALE_DAYS = 10;

export type StaleSignal = "approaching_target" | "stale";

/** `label` is a plain string for contexts that can't render markup (a native `title` tooltip);
 * `playful` pairs with it via `<Copy>` wherever the badge itself is rendered. */
export const STALE_SIGNAL_META: Record<StaleSignal, { label: string; playful: string }> = {
  approaching_target: { label: "Approaching target, behind pace", playful: "Closing in on the deadline, behind pace" },
  stale: { label: "No activity in 10+ days", playful: "Gone quiet for 10+ days" },
};

export function isOverdueProject(project: Pick<Project, "target_date" | "status">, today = new Date()): boolean {
  if (!project.target_date || project.status === "Done") return false;
  const target = new Date(`${project.target_date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() < today.getTime();
}

/**
 * `approaching_target`: target date within 14 days AND < 70% complete — on track to miss it.
 * `stale`: nothing logged to the activity log (or, if there's none yet, nothing since the project
 * was created) in `STALE_DAYS` calendar days — the project isn't actively being worked.
 * Archived/Done projects never carry either signal; there's nothing left to warn about.
 */
export function staleSignals(
  project: Pick<Project, "target_date" | "status" | "archived" | "created_at">,
  percentComplete: number,
  latestActivityAt: string | null,
  today = new Date()
): StaleSignal[] {
  if (project.archived || project.status === "Done") return [];
  const signals: StaleSignal[] = [];
  if (isDueSoon(project, today) && percentComplete < 70) signals.push("approaching_target");
  const lastTouched =
    latestActivityAt && latestActivityAt > project.created_at ? latestActivityAt : project.created_at;
  const daysSinceTouched = (today.getTime() - new Date(lastTouched).getTime()) / 86_400_000;
  if (daysSinceTouched >= STALE_DAYS) signals.push("stale");
  return signals;
}

// ---------------------------------------------------------------------------- records filters (Phase 6)

export type ProjectFilterCriteria = {
  status: ProjectStatus | "";
  health: ProjectHealth;
  owner: string;
  quadrant: Quadrant | "unsorted" | "";
  phaseStatus: ProjectPhaseStatus | "no_phases" | "";
  dueDate: "" | "overdue" | "due_soon" | "no_target";
  hasBlocker: boolean;
  hasRisk: boolean;
  hasLinkedTickets: boolean;
  batchEnabled: boolean;
};

export const EMPTY_PROJECT_FILTERS: ProjectFilterCriteria = {
  status: "",
  health: "",
  owner: "",
  quadrant: "",
  phaseStatus: "",
  dueDate: "",
  hasBlocker: false,
  hasRisk: false,
  hasLinkedTickets: false,
  batchEnabled: false,
};

export function isDefaultProjectFilters(criteria: ProjectFilterCriteria): boolean {
  return Object.entries(criteria).every(
    ([key, value]) => value === EMPTY_PROJECT_FILTERS[key as keyof ProjectFilterCriteria]
  );
}

/** Client-side over an already team-scoped in-memory list — see `FiltersBar.tsx`. `context` carries
 * the per-project facts that aren't on `Project` itself (phases, blocker/risk/ticket-link status). */
export function projectMatchesFilters(
  project: Project,
  criteria: ProjectFilterCriteria,
  context: {
    phases: Pick<ProjectPhase, "status">[];
    blocked: boolean;
    hasOpenRisk: boolean;
    linkedTicketCount: number;
  }
): boolean {
  if (criteria.status && project.status !== criteria.status) return false;
  if (criteria.health && project.health !== criteria.health) return false;
  if (criteria.owner && !project.owner.toLowerCase().includes(criteria.owner.trim().toLowerCase())) return false;
  if (criteria.quadrant) {
    const q = projectQuadrantOf(project);
    if (criteria.quadrant === "unsorted" ? q !== null : q !== criteria.quadrant) return false;
  }
  if (criteria.phaseStatus) {
    if (criteria.phaseStatus === "no_phases") {
      if (context.phases.length > 0) return false;
    } else if (!context.phases.some((p) => p.status === criteria.phaseStatus)) {
      return false;
    }
  }
  if (criteria.dueDate) {
    if (criteria.dueDate === "no_target" && project.target_date) return false;
    if (criteria.dueDate === "overdue" && !isOverdueProject(project)) return false;
    if (criteria.dueDate === "due_soon" && !isDueSoon(project)) return false;
  }
  if (criteria.hasBlocker && !context.blocked) return false;
  if (criteria.hasRisk && !context.hasOpenRisk) return false;
  if (criteria.hasLinkedTickets && context.linkedTicketCount === 0) return false;
  if (criteria.batchEnabled && !project.batch_tracking_enabled) return false;
  return true;
}

/** Counts for the team-filtered project list — `active` means not archived and not yet Done,
 * `blocked` reads the workflow `status`, `onTrack`/`atRisk` read the separately-set `health`
 * judgment. */
/** `blockedProjectIds` (Phase 5's `getActiveBlockersForProjects`) is optional so callers from
 * before Phase 5 still work — when given, `blocked` counts a project as blocked by EITHER the
 * workflow `status` or an active blocker note, since a project can be stuck for either reason. */
export function portfolioSummary(projects: Project[], blockedProjectIds?: Set<string>): PortfolioSummary {
  return {
    total: projects.length,
    active: projects.filter((p) => !p.archived && p.status !== "Done").length,
    onTrack: projects.filter((p) => p.health === "on_track").length,
    atRisk: projects.filter((p) => p.health === "at_risk").length,
    blocked: projects.filter((p) => p.status === "Blocked" || blockedProjectIds?.has(p.project_id)).length,
    dueSoon: projects.filter((p) => isDueSoon(p)).length,
    completed: projects.filter((p) => p.status === "Done").length,
  };
}
