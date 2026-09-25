import { getSupabaseClient } from "@/lib/supabase";
import {
  healthLabel,
  PHASE_STATUS_META,
  projectQuadrantOf,
  type InitiativeTicket,
  type Project,
  type ProjectActivityEntry,
  type ProjectDependency,
  type ProjectMilestone,
  type ProjectNote,
  type ProjectPhase,
  type ProjectPhaseTicket,
  type ProjectProgress,
  type ProjectRisk,
  type ProjectTask,
  type TicketAssignment,
} from "@/lib/project-tracking";
import { QUADRANT_META } from "@/lib/work";

/**
 * Server-only data access for Records -> Project Tracking, reading/writing the live
 * `projects`/`project_progress`/`project_tasks`/`ticket_project_map`/`initiative_tickets` tables
 * (supabase/schema.sql) — the same tables gas/SupabaseMigration.gs's Phase 2 historical backfill
 * already populates. This is Phase 4 for this feature: cutting the frontend over from Sheets/GAS
 * (fetchGas) to reading/writing Supabase directly, same as every other already-migrated route.
 *
 * Shared team data, not per-user (unlike work-store.ts's My Work functions) — every route calling
 * these still requires a valid session, but rows aren't filtered by whose session it is.
 *
 * Several columns are nullable/typed differently in Postgres than the app's existing wire shape
 * (e.g. `total_items` is a nullable `integer`, but every component still expects `number | ""`
 * exactly as the old Sheets-backed ProjectRecord provided it) — the row<->app conversions below
 * exist so no component needed to change its parsing logic for this migration.
 */

function nowIso() {
  return new Date().toISOString();
}

function numOrBlank(v: unknown): number | "" {
  return v === null || v === undefined || v === "" ? "" : Number(v);
}

function blankToNull(v: number | "" | undefined): number | null {
  return v === "" || v === undefined || v === null ? null : Number(v);
}

/**
 * Writes one activity-log entry. Called from every tracked mutation site (status/health/priority
 * change, phase create/status/target-date change, ticket link/unlink) — never surfaced as its own
 * endpoint, since nothing client-side writes activity directly.
 *
 * Deliberately swallows its own failure rather than throwing: this is a secondary audit trail, and
 * before `project_activity_log` exists (she hasn't run this phase's migration yet), every one of
 * those mutation sites would otherwise start failing an otherwise-successful write just because the
 * new table isn't there yet.
 */
export async function logActivity(
  projectId: string,
  eventType: string,
  summary: string,
  actorEmail: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("project_activity_log").insert({
    project_id: projectId,
    event_type: eventType,
    summary,
    actor_email: actorEmail,
    metadata,
  });
  if (error) console.error(`Could not log activity (${eventType} on project ${projectId}): ${error.message}`);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToProject(row: any): Project {
  return {
    project_id: row.project_id,
    project_name: row.project_name ?? "",
    owning_team: row.owning_team ?? "",
    teams_involved: row.teams_involved ?? "",
    owner: row.owner ?? "",
    status: row.status ?? "Not Started",
    tracking_mode: row.tracking_mode ?? "",
    start_date: row.start_date ?? "",
    target_date: row.target_date ?? "",
    committed_date: row.committed_date ?? "",
    percent_complete: Number(row.percent_complete) || 0,
    jira_label: row.jira_label ?? "",
    total_items: numOrBlank(row.total_items),
    batch_size: numOrBlank(row.batch_size),
    batches_per_week: numOrBlank(row.batches_per_week),
    weekly_plan_json: JSON.stringify(row.weekly_plan_json ?? []),
    notes: row.notes ?? "",
    urgent: row.urgent ?? null,
    important: row.important ?? null,
    health: row.health ?? "",
    batch_tracking_enabled: row.batch_tracking_enabled === true,
    batch_actuals_from_tickets: row.batch_actuals_from_tickets === true,
    contributors: Array.isArray(row.contributors) ? row.contributors : [],
    problem_context: row.problem_context ?? "",
    objective: row.objective ?? "",
    expected_outcome: row.expected_outcome ?? "",
    scope: row.scope ?? "",
    out_of_scope: row.out_of_scope ?? "",
    success_metrics: row.success_metrics ?? "",
    archived: row.archived === true,
    charter_client_ref: row.charter_client_ref ?? "",
    created_by: row.created_by ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Shapes a partial app-facing Project into a partial DB row — only fields actually present in
 * the payload are touched, so a PATCH with e.g. just {status} doesn't clobber other columns. */
function projectToRow(payload: Partial<Project>): Record<string, unknown> {
  const row: Record<string, unknown> = { ...payload };
  if ("total_items" in payload) row.total_items = blankToNull(payload.total_items);
  if ("batch_size" in payload) row.batch_size = blankToNull(payload.batch_size);
  if ("batches_per_week" in payload) row.batches_per_week = blankToNull(payload.batches_per_week);
  if ("weekly_plan_json" in payload) {
    try {
      row.weekly_plan_json = JSON.parse(payload.weekly_plan_json || "[]");
    } catch {
      row.weekly_plan_json = [];
    }
  }
  delete row.project_id; // never written — DB-generated, pinned separately by update/insert
  return row;
}

export async function getProjects(params: { team?: string } = {}): Promise<Project[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from("projects").select("*").order("created_at", { ascending: true });
  if (params.team) query = query.eq("owning_team", params.team);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load projects: ${error.message}`);
  return (data ?? []).map(rowToProject);
}

export async function createProject(
  email: string,
  payload: Partial<Project>
): Promise<Project> {
  const supabase = getSupabaseClient();
  const now = nowIso();
  const record = {
    teams_involved: "",
    owner: "",
    jira_label: "",
    tracking_mode: "manual",
    health: "",
    batch_tracking_enabled: false,
    batch_actuals_from_tickets: false,
    contributors: [],
    archived: false,
    ...projectToRow(payload),
    status: payload.status || "Not Started",
    percent_complete: payload.percent_complete || 0,
    created_by: email,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from("projects").insert(record).select("*").single();
  if (error) throw new Error(`Could not create project: ${error.message}`);
  return rowToProject(data);
}

export async function updateProject(id: string, payload: Partial<Project>, actorEmail?: string): Promise<Project> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ ...projectToRow(payload), updated_at: nowIso() })
    .eq("project_id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Could not update project ${id}: ${error.message}`);
  const project = rowToProject(data);

  // Activity log, one entry per tracked field actually present in this PATCH — every caller in
  // this app only ever sends one semantic change at a time (a single select/QuadrantSelect firing
  // one PATCH), so this doesn't need to diff against the pre-update row.
  if (actorEmail) {
    if ("status" in payload) {
      await logActivity(id, "status_changed", `Status changed to "${project.status}"`, actorEmail);
    }
    if ("health" in payload) {
      await logActivity(
        id,
        "health_changed",
        project.health ? `Health changed to "${healthLabel(project.health)}"` : "Health cleared",
        actorEmail
      );
    }
    if ("urgent" in payload || "important" in payload) {
      const quadrant = projectQuadrantOf(project);
      await logActivity(
        id,
        "priority_changed",
        quadrant ? `Priority changed to "${QUADRANT_META[quadrant].verb}"` : "Priority cleared (unsorted)",
        actorEmail
      );
    }
  }

  return project;
}

export async function deleteProject(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("projects").delete().eq("project_id", id);
  if (error) throw new Error(`Could not delete project ${id}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Project progress (batch log)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToProgress(row: any): ProjectProgress {
  return {
    progress_id: row.progress_id,
    project_id: row.project_id,
    date: row.date ?? "",
    issue_key: row.issue_key ?? "",
    items_processed: Number(row.items_processed) || 0,
    notes: row.notes ?? "",
    created_by: row.created_by ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getProjectProgress(
  params: { project_id?: string } = {}
): Promise<ProjectProgress[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from("project_progress").select("*").order("date", { ascending: false });
  if (params.project_id) query = query.eq("project_id", params.project_id);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load progress log: ${error.message}`);
  return (data ?? []).map(rowToProgress);
}

export async function addProgress(
  email: string,
  payload: Partial<ProjectProgress>
): Promise<ProjectProgress> {
  const supabase = getSupabaseClient();
  const now = nowIso();
  const { progress_id: _ignored, ...rest } = payload as Partial<ProjectProgress> & { progress_id?: string };
  void _ignored;
  const record = {
    issue_key: "",
    notes: "",
    ...rest,
    items_processed: Number(payload.items_processed) || 0,
    created_by: email,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from("project_progress").insert(record).select("*").single();
  if (error) throw new Error(`Could not log progress: ${error.message}`);
  return rowToProgress(data);
}

export async function updateProgress(
  id: string,
  payload: Partial<ProjectProgress>
): Promise<ProjectProgress> {
  const supabase = getSupabaseClient();
  const { progress_id: _ignored, ...rest } = payload as Partial<ProjectProgress> & { progress_id?: string };
  void _ignored;
  if (rest.items_processed !== undefined) rest.items_processed = Number(rest.items_processed) || 0;
  const { data, error } = await supabase
    .from("project_progress")
    .update({ ...rest, updated_at: nowIso() })
    .eq("progress_id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Could not update progress ${id}: ${error.message}`);
  return rowToProgress(data);
}

export async function deleteProgress(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("project_progress").delete().eq("progress_id", id);
  if (error) throw new Error(`Could not delete progress ${id}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Project tasks (checklist)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTask(row: any): ProjectTask {
  return {
    task_id: row.task_id,
    project_id: row.project_id,
    task_name: row.task_name ?? "",
    issue_key: row.issue_key ?? "",
    done: row.done === true,
    start_date: row.start_date ?? "",
    target_date: row.target_date ?? "",
    notes: row.notes ?? "",
    created_by: row.created_by ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getProjectTasks(
  params: { project_id?: string } = {}
): Promise<ProjectTask[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from("project_tasks").select("*").order("created_at", { ascending: true });
  if (params.project_id) query = query.eq("project_id", params.project_id);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load tasks: ${error.message}`);
  return (data ?? []).map(rowToTask);
}

export async function createTask(
  email: string,
  payload: Partial<ProjectTask>
): Promise<ProjectTask> {
  const supabase = getSupabaseClient();
  const now = nowIso();
  const { task_id: _ignored, ...rest } = payload as Partial<ProjectTask> & { task_id?: string };
  void _ignored;
  const record = {
    start_date: "",
    target_date: "",
    notes: "",
    issue_key: "",
    ...rest,
    done: payload.done === true,
    created_by: email,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from("project_tasks").insert(record).select("*").single();
  if (error) throw new Error(`Could not add task: ${error.message}`);
  return rowToTask(data);
}

export async function updateTask(id: string, payload: Partial<ProjectTask>): Promise<ProjectTask> {
  const supabase = getSupabaseClient();
  const { task_id: _ignored, ...rest } = payload as Partial<ProjectTask> & { task_id?: string };
  void _ignored;
  if (rest.done !== undefined) rest.done = rest.done === true;
  const { data, error } = await supabase
    .from("project_tasks")
    .update({ ...rest, updated_at: nowIso() })
    .eq("task_id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Could not update task ${id}: ${error.message}`);
  return rowToTask(data);
}

export async function deleteTask(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("project_tasks").delete().eq("task_id", id);
  if (error) throw new Error(`Could not delete task ${id}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Manual ticket -> project assignments
// ---------------------------------------------------------------------------

export async function getTicketAssignments(): Promise<TicketAssignment[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("ticket_project_map").select("*");
  if (error) throw new Error(`Could not load ticket assignments: ${error.message}`);
  return (data ?? []).map((r) => ({
    issue_key: r.issue_key,
    project_id: r.project_id,
    assigned_by: r.assigned_by ?? "",
    assigned_at: r.assigned_at,
  }));
}

/** Bulk assign/unassign: one row per key, overwriting any existing row for that key (enforces one
 * project per ticket). An empty/blank project_id UNASSIGNS — the rows for those keys are removed. */
export async function assignTickets(payload: {
  issue_keys: string[];
  project_id: string;
  assigned_by: string;
}): Promise<{ assigned: number; unassigned: number }> {
  const supabase = getSupabaseClient();
  const keys = payload.issue_keys || [];
  const projectId = payload.project_id ? String(payload.project_id) : "";
  if (!keys.length) return { assigned: 0, unassigned: 0 };

  // Read prior assignments first so a move/unassign logs against the project(s) tickets are
  // actually LEAVING, not just the one (if any) they're joining.
  const { data: existingRows } = await supabase
    .from("ticket_project_map")
    .select("issue_key, project_id")
    .in("issue_key", keys);
  const priorProjectByKey = new Map((existingRows ?? []).map((r) => [r.issue_key, r.project_id]));

  const { error: deleteError } = await supabase.from("ticket_project_map").delete().in("issue_key", keys);
  if (deleteError) throw new Error(`Could not update ticket assignments: ${deleteError.message}`);

  // Group by the project each ticket is leaving — excludes a ticket simply re-saved onto the same
  // project it was already on, which isn't really a move.
  const leftProjects = new Map<string, string[]>();
  for (const key of keys) {
    const prior = priorProjectByKey.get(key);
    if (prior && prior !== projectId) {
      if (!leftProjects.has(prior)) leftProjects.set(prior, []);
      leftProjects.get(prior)!.push(key);
    }
  }
  for (const [pid, issueKeys] of Array.from(leftProjects.entries())) {
    await logActivity(pid, "ticket_unlinked", `Unlinked ${issueKeys.join(", ")}`, payload.assigned_by, { issue_keys: issueKeys });
  }

  if (!projectId) return { assigned: 0, unassigned: keys.length };

  const now = nowIso();
  const rows = keys.map((k) => ({
    issue_key: String(k),
    project_id: projectId,
    assigned_by: payload.assigned_by || "",
    assigned_at: now,
  }));
  const { error: insertError } = await supabase.from("ticket_project_map").insert(rows);
  if (insertError) throw new Error(`Could not assign tickets: ${insertError.message}`);
  await logActivity(projectId, "ticket_linked", `Linked ${keys.join(", ")}`, payload.assigned_by, { issue_keys: keys });
  return { assigned: keys.length, unassigned: 0 };
}

// ---------------------------------------------------------------------------
// Jira-synced initiative tickets (read-only from Next.js; written by GAS's syncInitiativeTickets)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToInitiativeTicket(row: any): InitiativeTicket {
  return {
    issue_key: row.issue_key,
    project_key: row.project_key ?? "",
    summary: row.summary ?? "",
    issue_type: row.issue_type ?? "",
    status: row.status ?? "",
    priority: row.priority ?? "",
    labels: row.labels ?? "",
    assignee_display_name: row.assignee_display_name ?? "",
    reporter_display_name: row.reporter_display_name ?? "",
    created: row.created ?? "",
    updated: row.updated ?? "",
    duedate: row.duedate ?? "",
    resolution: row.resolution ?? "",
    resolved_datetime: row.resolved_datetime ?? "",
    last_synced_at: row.last_synced_at ?? "",
  };
}

export async function getInitiativeTickets(
  params: { team?: string; label?: string } = {}
): Promise<InitiativeTicket[]> {
  const supabase = getSupabaseClient();
  // `team` is the team_key (DE/DEV/ST) — matches the old per-team INITIATIVE_TICKETS_<team> tab
  // split exactly, filtered server-side here instead of by which tab got concatenated.
  let query = supabase.from("initiative_tickets").select("*").order("updated", { ascending: false });
  if (params.team) query = query.eq("team_key", params.team);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load initiative tickets: ${error.message}`);
  let rows = (data ?? []).map(rowToInitiativeTicket);
  if (params.label) {
    const label = params.label;
    rows = rows.filter((r) => r.labels.split(",").map((s) => s.trim()).includes(label));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Project phases (Phase 3)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPhase(row: any): ProjectPhase {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name ?? "",
    description: row.description ?? "",
    owner: row.owner ?? "",
    status: row.status ?? "not_started",
    progress: Number(row.progress) || 0,
    start_date: row.start_date ?? "",
    target_date: row.target_date ?? "",
    actual_completion_date: row.actual_completion_date ?? "",
    notes: row.notes ?? "",
    position: Number(row.position) || 0,
    created_by: row.created_by ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getPhases(params: { project_id?: string } = {}): Promise<ProjectPhase[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from("project_phases").select("*").order("position", { ascending: true });
  if (params.project_id) query = query.eq("project_id", params.project_id);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load phases: ${error.message}`);
  return (data ?? []).map(rowToPhase);
}

export async function createPhase(email: string, payload: Partial<ProjectPhase>): Promise<ProjectPhase> {
  const supabase = getSupabaseClient();
  const now = nowIso();
  const { id: _ignored, ...rest } = payload as Partial<ProjectPhase> & { id?: string };
  void _ignored;
  // New phases append to the end unless a position was explicitly given.
  let position = rest.position;
  if (position === undefined && rest.project_id) {
    position = (await getPhases({ project_id: rest.project_id })).length;
  }
  const record = {
    description: "",
    owner: "",
    notes: "",
    status: "not_started",
    progress: 0,
    ...rest,
    position: position ?? 0,
    created_by: email,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from("project_phases").insert(record).select("*").single();
  if (error) throw new Error(`Could not create phase: ${error.message}`);
  const phase = rowToPhase(data);
  await logActivity(phase.project_id, "phase_created", `Phase "${phase.name}" added`, email);
  return phase;
}

export async function updatePhase(id: string, payload: Partial<ProjectPhase>, actorEmail?: string): Promise<ProjectPhase> {
  const supabase = getSupabaseClient();
  const { id: _ignored, ...rest } = payload as Partial<ProjectPhase> & { id?: string };
  void _ignored;
  const { data, error } = await supabase
    .from("project_phases")
    .update({ ...rest, updated_at: nowIso() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Could not update phase ${id}: ${error.message}`);
  const phase = rowToPhase(data);

  if (actorEmail) {
    if ("status" in payload) {
      await logActivity(
        phase.project_id,
        "phase_status_changed",
        `Phase "${phase.name}" status changed to "${PHASE_STATUS_META[phase.status].label}"`,
        actorEmail
      );
    }
    if ("target_date" in payload) {
      await logActivity(
        phase.project_id,
        "phase_target_date_changed",
        `Phase "${phase.name}" target date changed to ${phase.target_date || "none"}`,
        actorEmail
      );
    }
  }

  return phase;
}

export async function deletePhase(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("project_phases").delete().eq("id", id);
  if (error) throw new Error(`Could not delete phase ${id}: ${error.message}`);
}

/** Bulk reorder: `order` is the COMPLETE list of one project's phase ids, in their new order —
 * each phase's `position` becomes its index. A partial list would leave phases not included in it
 * with stale positions relative to the ones that moved, so callers always pass every phase id for
 * that project, never just the ones that moved. */
export async function reorderPhases(order: string[]): Promise<void> {
  const supabase = getSupabaseClient();
  const now = nowIso();
  const { error } = await Promise.all(
    order.map((id, index) =>
      supabase.from("project_phases").update({ position: index, updated_at: now }).eq("id", id)
    )
  ).then((results) => {
    const failed = results.find((r) => r.error);
    return { error: failed?.error };
  });
  if (error) throw new Error(`Could not reorder phases: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Project + phase notes (Phase 4)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToNote(row: any): ProjectNote {
  return {
    id: row.id,
    project_id: row.project_id,
    phase_id: row.phase_id ?? null,
    note_type: row.note_type ?? "update",
    content: row.content ?? "",
    author_email: row.author_email ?? "",
    resolved: row.resolved === true,
    created_at: row.created_at,
  };
}

export async function getNotes(params: { project_id?: string; phase_id?: string } = {}): Promise<ProjectNote[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from("project_notes").select("*").order("created_at", { ascending: false });
  if (params.project_id) query = query.eq("project_id", params.project_id);
  if (params.phase_id) query = query.eq("phase_id", params.phase_id);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load notes: ${error.message}`);
  return (data ?? []).map(rowToNote);
}

export async function addNote(email: string, payload: Partial<ProjectNote>): Promise<ProjectNote> {
  const supabase = getSupabaseClient();
  const { id: _ignored, author_email: _ignoredAuthor, ...rest } = payload as Partial<ProjectNote> & {
    id?: string;
  };
  void _ignored;
  void _ignoredAuthor;
  const record = {
    phase_id: null,
    note_type: "update",
    resolved: false,
    ...rest,
    author_email: email,
    created_at: nowIso(),
  };
  const { data, error } = await supabase.from("project_notes").insert(record).select("*").single();
  if (error) throw new Error(`Could not add note: ${error.message}`);
  const note = rowToNote(data);
  if (note.note_type === "blocker") {
    await logActivity(note.project_id, "blocker_raised", `Blocker raised: "${note.content}"`, email);
  }
  return note;
}

/** Only ever toggles `resolved` — nothing else about a note is editable after it's written,
 * ENFORCED here (not just by convention at the route level): accepting the whole payload would
 * let a caller overwrite `author_email` to itself and then pass deleteNote's author-only check.
 * Not author-restricted like delete: whoever fixed a blocker should be able to resolve it, not
 * just whoever originally raised it. */
export async function updateNote(id: string, payload: Partial<ProjectNote>, actorEmail?: string): Promise<ProjectNote> {
  const supabase = getSupabaseClient();
  const rest: Partial<ProjectNote> = "resolved" in payload ? { resolved: payload.resolved } : {};
  const { data, error } = await supabase.from("project_notes").update(rest).eq("id", id).select("*").single();
  if (error) throw new Error(`Could not update note ${id}: ${error.message}`);
  const note = rowToNote(data);
  if (actorEmail && "resolved" in payload && note.resolved && note.note_type === "blocker") {
    await logActivity(note.project_id, "blocker_resolved", `Blocker resolved: "${note.content}"`, actorEmail);
  }
  return note;
}

/** Author-only, enforced here rather than left to the UI to hide the button — a delete request
 * for someone else's note is rejected outright, not silently ignored. */
export async function deleteNote(id: string, requestorEmail: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: existing, error: fetchError } = await supabase
    .from("project_notes")
    .select("author_email")
    .eq("id", id)
    .single();
  if (fetchError) throw new Error(`Could not delete note ${id}: ${fetchError.message}`);
  if (existing.author_email !== requestorEmail) {
    throw new Error("Only the note's author can delete it.");
  }
  const { error } = await supabase.from("project_notes").delete().eq("id", id);
  if (error) throw new Error(`Could not delete note ${id}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Activity log (Phase 4) — read-only from Next.js; written by logActivity above
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToActivity(row: any): ProjectActivityEntry {
  return {
    id: row.id,
    project_id: row.project_id,
    event_type: row.event_type ?? "",
    summary: row.summary ?? "",
    actor_email: row.actor_email ?? "",
    metadata: row.metadata ?? {},
    created_at: row.created_at,
  };
}

export async function getActivityLog(params: { project_id?: string } = {}): Promise<ProjectActivityEntry[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from("project_activity_log").select("*").order("created_at", { ascending: false });
  if (params.project_id) query = query.eq("project_id", params.project_id);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load activity log: ${error.message}`);
  return (data ?? []).map(rowToActivity);
}

// ---------------------------------------------------------------------------
// Project milestones (Phase 5)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToMilestone(row: any): ProjectMilestone {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name ?? "",
    done: row.done === true,
    target_date: row.target_date ?? "",
    position: Number(row.position) || 0,
    created_by: row.created_by ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getMilestones(params: { project_id?: string } = {}): Promise<ProjectMilestone[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from("project_milestones").select("*").order("position", { ascending: true });
  if (params.project_id) query = query.eq("project_id", params.project_id);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load milestones: ${error.message}`);
  return (data ?? []).map(rowToMilestone);
}

export async function createMilestone(email: string, payload: Partial<ProjectMilestone>): Promise<ProjectMilestone> {
  const supabase = getSupabaseClient();
  const now = nowIso();
  const { id: _ignored, ...rest } = payload as Partial<ProjectMilestone> & { id?: string };
  void _ignored;
  let position = rest.position;
  if (position === undefined && rest.project_id) {
    position = (await getMilestones({ project_id: rest.project_id })).length;
  }
  const record = {
    done: false,
    ...rest,
    position: position ?? 0,
    created_by: email,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from("project_milestones").insert(record).select("*").single();
  if (error) throw new Error(`Could not create milestone: ${error.message}`);
  return rowToMilestone(data);
}

export async function updateMilestone(id: string, payload: Partial<ProjectMilestone>): Promise<ProjectMilestone> {
  const supabase = getSupabaseClient();
  const { id: _ignored, ...rest } = payload as Partial<ProjectMilestone> & { id?: string };
  void _ignored;
  const { data, error } = await supabase
    .from("project_milestones")
    .update({ ...rest, updated_at: nowIso() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Could not update milestone ${id}: ${error.message}`);
  return rowToMilestone(data);
}

export async function deleteMilestone(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("project_milestones").delete().eq("id", id);
  if (error) throw new Error(`Could not delete milestone ${id}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Project dependencies (Phase 5)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToDependency(row: any): ProjectDependency {
  return {
    id: row.id,
    project_id: row.project_id,
    phase_id: row.phase_id ?? null,
    label: row.label ?? "",
    status: row.status ?? "open",
    created_by: row.created_by ?? "",
    created_at: row.created_at,
  };
}

export async function getDependencies(params: { project_id?: string } = {}): Promise<ProjectDependency[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from("project_dependencies").select("*").order("created_at", { ascending: true });
  if (params.project_id) query = query.eq("project_id", params.project_id);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load dependencies: ${error.message}`);
  return (data ?? []).map(rowToDependency);
}

export async function createDependency(email: string, payload: Partial<ProjectDependency>): Promise<ProjectDependency> {
  const supabase = getSupabaseClient();
  const { id: _ignored, ...rest } = payload as Partial<ProjectDependency> & { id?: string };
  void _ignored;
  const record = { phase_id: null, status: "open", ...rest, created_by: email, created_at: nowIso() };
  const { data, error } = await supabase.from("project_dependencies").insert(record).select("*").single();
  if (error) throw new Error(`Could not create dependency: ${error.message}`);
  return rowToDependency(data);
}

export async function updateDependency(id: string, payload: Partial<ProjectDependency>): Promise<ProjectDependency> {
  const supabase = getSupabaseClient();
  const { id: _ignored, ...rest } = payload as Partial<ProjectDependency> & { id?: string };
  void _ignored;
  const { data, error } = await supabase.from("project_dependencies").update(rest).eq("id", id).select("*").single();
  if (error) throw new Error(`Could not update dependency ${id}: ${error.message}`);
  return rowToDependency(data);
}

export async function deleteDependency(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("project_dependencies").delete().eq("id", id);
  if (error) throw new Error(`Could not delete dependency ${id}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Project risks (Phase 5)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRisk(row: any): ProjectRisk {
  return {
    id: row.id,
    project_id: row.project_id,
    risk: row.risk ?? "",
    impact: row.impact ?? "",
    likelihood: row.likelihood ?? "",
    mitigation: row.mitigation ?? "",
    owner: row.owner ?? "",
    status: row.status ?? "open",
    created_by: row.created_by ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getRisks(params: { project_id?: string } = {}): Promise<ProjectRisk[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from("project_risks").select("*").order("created_at", { ascending: true });
  if (params.project_id) query = query.eq("project_id", params.project_id);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load risks: ${error.message}`);
  return (data ?? []).map(rowToRisk);
}

export async function createRisk(email: string, payload: Partial<ProjectRisk>): Promise<ProjectRisk> {
  const supabase = getSupabaseClient();
  const now = nowIso();
  const { id: _ignored, ...rest } = payload as Partial<ProjectRisk> & { id?: string };
  void _ignored;
  const record = {
    mitigation: "",
    owner: "",
    status: "open",
    ...rest,
    created_by: email,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from("project_risks").insert(record).select("*").single();
  if (error) throw new Error(`Could not create risk: ${error.message}`);
  const risk = rowToRisk(data);
  await logActivity(risk.project_id, "risk_added", `Risk added: "${risk.risk}"`, email);
  return risk;
}

export async function updateRisk(id: string, payload: Partial<ProjectRisk>): Promise<ProjectRisk> {
  const supabase = getSupabaseClient();
  const { id: _ignored, ...rest } = payload as Partial<ProjectRisk> & { id?: string };
  void _ignored;
  const { data, error } = await supabase
    .from("project_risks")
    .update({ ...rest, updated_at: nowIso() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Could not update risk ${id}: ${error.message}`);
  return rowToRisk(data);
}

export async function deleteRisk(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("project_risks").delete().eq("id", id);
  if (error) throw new Error(`Could not delete risk ${id}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Active blockers (Phase 5) — batched across many projects, not N+1
// ---------------------------------------------------------------------------

/** Which of the given projects currently have at least one unresolved `note_type: "blocker"`
 * note — one query for the whole set, not one per project. */
export async function getActiveBlockersForProjects(projectIds: string[]): Promise<Set<string>> {
  if (!projectIds.length) return new Set();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("project_notes")
    .select("project_id")
    .eq("note_type", "blocker")
    .eq("resolved", false)
    .in("project_id", projectIds);
  if (error) throw new Error(`Could not load active blockers: ${error.message}`);
  return new Set((data ?? []).map((r) => r.project_id));
}

// ---------------------------------------------------------------------------
// Phase-level ticket links (Phase 6) — additional to, never a replacement for, the project-level
// links on ticket_project_map (InitiativeTicketsTable.tsx), which stays untouched.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPhaseTicket(row: any): ProjectPhaseTicket {
  return {
    id: row.id,
    phase_id: row.phase_id,
    project_id: row.project_id,
    issue_key: row.issue_key,
    assigned_by: row.assigned_by ?? "",
    assigned_at: row.assigned_at,
  };
}

export async function getPhaseTickets(
  params: { phase_id?: string; project_id?: string } = {}
): Promise<ProjectPhaseTicket[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from("project_phase_tickets").select("*").order("assigned_at", { ascending: true });
  if (params.phase_id) query = query.eq("phase_id", params.phase_id);
  if (params.project_id) query = query.eq("project_id", params.project_id);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load phase ticket links: ${error.message}`);
  return (data ?? []).map(rowToPhaseTicket);
}

export async function linkPhaseTicket(
  email: string,
  payload: { phase_id: string; project_id: string; issue_key: string }
): Promise<ProjectPhaseTicket> {
  const supabase = getSupabaseClient();
  const record = { ...payload, assigned_by: email, assigned_at: nowIso() };
  const { data, error } = await supabase
    .from("project_phase_tickets")
    .insert(record)
    .select("*")
    .single();
  if (error) throw new Error(`Could not link ticket to phase: ${error.message}`);
  return rowToPhaseTicket(data);
}

export async function unlinkPhaseTicket(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("project_phase_tickets").delete().eq("id", id);
  if (error) throw new Error(`Could not unlink ticket: ${error.message}`);
}
