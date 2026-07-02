export type LeaveRecord = {
  leave_id: string;
  employee_name: string;
  team_key: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  num_days: number;
  status: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
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

export type ProjectRecord = {
  project_id: string;
  project_name: string;
  owning_team: string;
  owner: string;
  status: "Not Started" | "In Progress" | "Blocked" | "Done";
  start_date: string;
  target_date: string;
  percent_complete: number;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};
