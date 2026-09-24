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

// Project Tracking's types (ProjectStatus, ProjectRecord, ProgressRecord, TaskRecord,
// TicketAssignment, InitiativeTicket) moved to @/lib/project-tracking as part of its migration
// off this Sheets/GAS-backed shape onto Supabase — see that file (Project, ProjectProgress,
// ProjectTask, TicketAssignment, InitiativeTicket).
