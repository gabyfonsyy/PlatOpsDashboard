import { getSupabaseClient } from "@/lib/supabase";
import type {
  InitiativeTicket,
  Project,
  ProjectProgress,
  ProjectTask,
  TicketAssignment,
} from "@/lib/project-tracking";

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
    contributors: Array.isArray(row.contributors) ? row.contributors : [],
    problem_context: row.problem_context ?? "",
    objective: row.objective ?? "",
    expected_outcome: row.expected_outcome ?? "",
    scope: row.scope ?? "",
    out_of_scope: row.out_of_scope ?? "",
    success_metrics: row.success_metrics ?? "",
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
    contributors: [],
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

export async function updateProject(id: string, payload: Partial<Project>): Promise<Project> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ ...projectToRow(payload), updated_at: nowIso() })
    .eq("project_id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Could not update project ${id}: ${error.message}`);
  return rowToProject(data);
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

  const { error: deleteError } = await supabase.from("ticket_project_map").delete().in("issue_key", keys);
  if (deleteError) throw new Error(`Could not update ticket assignments: ${deleteError.message}`);
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
