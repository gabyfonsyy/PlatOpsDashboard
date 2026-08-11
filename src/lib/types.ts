export type LeaveRecord = {
  leave_id: string;
  employee_name: string;
  team_key: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  num_days: number;
  /** "" for full-day leave, or "First Half" / "Second Half" for a half-day. */
  half_day_period: string;
  status: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type LeaveStats = {
  totalRecords: number;
  totalDays: number;
  employeesOnLeave: number;
  halfDayCount: number;
  byType: { type: string; count: number; days: number }[];
  byEmployee: { employee: string; count: number; days: number }[];
};

export type RosterMember = {
  employee_name: string;
  team_key: string;
  role_title: string;
  status: string;
  start_date: string;
  jira_display_name_alias: string;
};

export type RtoRecord = {
  rto_id: string;
  employee_name: string;
  team_key: string;
  date: string;
  attendance_type: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type RtoSummaryRow = {
  employee: string;
  daysInOffice: number;
  daysRemote: number;
  daysAbsent: number;
  totalDays: number;
  compliancePct: number;
};

export type ProjectStatus = "Not Started" | "In Progress" | "Blocked" | "Done";

/** How a project's % complete is tracked and which fields its form shows.
 * "" means an existing row saved before this field existed — resolveDisplayPercent falls back
 * to auto-detecting from whichever fields are filled in until it's next saved through the form. */
export type ProjectTrackingMode = "manual" | "scheduled" | "tasks" | "";

export type ProjectRecord = {
  project_id: string;
  project_name: string;
  owning_team: string;
  /** CSV of team_keys involved (in addition to owning_team). */
  teams_involved: string;
  owner: string;
  status: ProjectStatus;
  /** "manual" (typed-in %), "scheduled" (batch throughput), or "tasks" (checklist). */
  tracking_mode: ProjectTrackingMode;
  start_date: string;
  target_date: string;
  percent_complete: number;
  /** Shared Jira label linking this project to its cod-initiative tickets. */
  jira_label: string;
  /** Batch-projection inputs — blank/"" until the manager fills them in. */
  total_items: number | "";
  batch_size: number | "";
  batches_per_week: number | "";
  /** JSON array of per-week overrides: [{ weekStart: "2026-07-21", items: 500 }]. "" or "[]" when none. */
  weekly_plan_json: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** One logged processing batch (PROJECT_PROGRESS): how many items/DBs a batch processed, on a
 * date, optionally tied to a cod-initiative ticket. Rows sum into a project's actual processed
 * total, which drives % complete + the actual-throughput re-forecast. */
export type ProgressRecord = {
  progress_id: string;
  project_id: string;
  date: string;
  /** Optional link to the cod-initiative ticket for this batch. */
  issue_key: string;
  items_processed: number;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** One checklist item under a project (PROJECT_TASKS) — for projects tracked as discrete tasks
 * (e.g. "Databricks Handover to DBA": Review KT, Handover Session, ...) rather than batch
 * throughput. Its own start/target date lets it render as its own bar on the Gantt timeline. */
export type TaskRecord = {
  task_id: string;
  project_id: string;
  task_name: string;
  /** Optional link to a Jira ticket for this task (issue key, e.g. "DEV-123"). */
  issue_key: string;
  done: boolean;
  start_date: string;
  target_date: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** A manual ticket→project assignment (TICKET_PROJECT_MAP). Manual assignment overrides label match. */
export type TicketAssignment = {
  issue_key: string;
  project_id: string;
  assigned_by: string;
  assigned_at: string;
};

/** One Jira cod-initiative ticket pulled into the INITIATIVE_TICKETS tab (DE/DEV only). */
export type InitiativeTicket = {
  issue_key: string;
  project_key: string;
  summary: string;
  issue_type: string;
  status: string;
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
