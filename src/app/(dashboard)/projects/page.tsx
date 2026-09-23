import { getTeams } from "@/lib/teams";
import {
  getProjects,
  getInitiativeTickets,
  getTicketAssignments,
  getProjectProgress,
  getProjectTasks,
  getPhases,
  getNotes,
  getActivityLog,
  getMilestones,
  getDependencies,
  getRisks,
  getPhaseTickets,
} from "@/lib/project-tracking-store";
import {
  isBlocked,
  type ProjectActivityEntry,
  type ProjectDependency,
  type ProjectMilestone,
  type ProjectNote,
  type ProjectPhase,
  type ProjectPhaseTicket,
  type ProjectRisk,
  type ProjectTask,
} from "@/lib/project-tracking";
import { ProjectForm } from "@/components/forms/ProjectForm";
import { ProjectsView } from "@/components/forms/ProjectsView";
import { ProgressRecordsTable } from "@/components/forms/ProgressRecordsTable";
import type { ProgressTicketOption } from "@/components/forms/progress-fields";
import { ProcessedBatchesPanel } from "@/components/forms/ProcessedBatchesPanel";
import { BatchCalculatorPanel } from "@/components/forms/BatchCalculatorPanel";
import { InitiativeTicketsTable } from "@/components/dashboard/InitiativeTicketsTable";
import { PageTitle } from "@/components/ui/PageTitle";
import { TeamPills } from "@/components/projects/TeamPills";
import { PortfolioSummaryStrip } from "@/components/projects/PortfolioSummaryStrip";
import { ProjectMatrix } from "@/components/projects/ProjectMatrix";
import { AllTeamsPortfolio } from "@/components/projects/AllTeamsPortfolio";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = typeof searchParams.team === "string" ? searchParams.team : undefined;

  const [
    teams,
    allProjects,
    tickets,
    assignments,
    progress,
    tasks,
    phases,
    notes,
    activity,
    milestones,
    dependencies,
    risks,
    phaseTickets,
  ] = await Promise.all([
    getTeams().catch(() => []),
    getProjects({}).catch(() => []),
    getInitiativeTickets().catch(() => []),
    getTicketAssignments().catch(() => []),
    getProjectProgress().catch(() => []),
    getProjectTasks().catch(() => []),
    getPhases().catch(() => []),
    getNotes().catch(() => []),
    getActivityLog().catch(() => []),
    getMilestones().catch(() => []),
    getDependencies().catch(() => []),
    getRisks().catch(() => []),
    getPhaseTickets().catch(() => []),
  ]);

  // The team pills scope the Records table/portfolio widgets below, but the progress log and
  // ticket-linking data span every team regardless of which pill is active — so lookups that
  // resolve a ticket/progress row's OWN project (which may belong to a different team than the
  // one currently selected) always read off the full, unfiltered project list, never `records`.
  const records = team ? allProjects.filter((p) => p.owning_team === team) : allProjects;

  // Resolved linked-ticket count per project: manual assignment wins, else first label match.
  // `ticketProject` also feeds the progress form's ticket dropdown so it can scope by project.
  const manualByKey = new Map(assignments.filter((a) => a.project_id).map((a) => [a.issue_key, a.project_id]));
  const labelledProjects = allProjects.filter((r) => String(r.jira_label || "").trim());
  const linkedCount: Record<string, number> = {};
  const ticketProject = new Map<string, string>();
  for (const t of tickets) {
    const labels = String(t.labels || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const manual = manualByKey.get(t.issue_key);
    const pid = manual ?? labelledProjects.find((p) => labels.includes(p.jira_label.trim().toLowerCase()))?.project_id;
    if (pid) {
      linkedCount[pid] = (linkedCount[pid] ?? 0) + 1;
      ticketProject.set(t.issue_key, pid);
    }
  }

  // Actual items processed per project, summed from the PROJECT_PROGRESS log.
  const processedByProject: Record<string, number> = {};
  for (const p of progress) {
    processedByProject[p.project_id] = (processedByProject[p.project_id] ?? 0) + (Number(p.items_processed) || 0);
  }

  // Task checklist per project, from the PROJECT_TASKS log.
  const tasksByProject: Record<string, ProjectTask[]> = {};
  for (const t of tasks) {
    (tasksByProject[t.project_id] ??= []).push(t);
  }

  // Phases per project, from PROJECT_PHASES (already position-ordered by getPhases).
  const phasesByProject: Record<string, ProjectPhase[]> = {};
  for (const p of phases) {
    (phasesByProject[p.project_id] ??= []).push(p);
  }

  // Notes per project (getNotes is already newest-first) — split into project-level vs
  // phase-level happens in ProjectDrilldownPanel, since both live in the same table/query.
  const notesByProject: Record<string, ProjectNote[]> = {};
  for (const n of notes) {
    (notesByProject[n.project_id] ??= []).push(n);
  }

  // Activity log per project (getActivityLog is already newest-first).
  const activityByProject: Record<string, ProjectActivityEntry[]> = {};
  for (const a of activity) {
    (activityByProject[a.project_id] ??= []).push(a);
  }

  // Milestones/dependencies/risks per project (Phase 5).
  const milestonesByProject: Record<string, ProjectMilestone[]> = {};
  for (const m of milestones) {
    (milestonesByProject[m.project_id] ??= []).push(m);
  }
  const dependenciesByProject: Record<string, ProjectDependency[]> = {};
  for (const d of dependencies) {
    (dependenciesByProject[d.project_id] ??= []).push(d);
  }
  const risksByProject: Record<string, ProjectRisk[]> = {};
  for (const r of risks) {
    (risksByProject[r.project_id] ??= []).push(r);
  }

  // Phase-level ticket links per project (Phase 6) — project-level linking is untouched, this is
  // additional, keyed by project_id here and split by phase_id inside ProjectDrilldownPanel.
  const phaseTicketsByProject: Record<string, ProjectPhaseTicket[]> = {};
  for (const link of phaseTickets) {
    (phaseTicketsByProject[link.project_id] ??= []).push(link);
  }

  // Which projects currently have an active blocker note — derived from `notesByProject`, already
  // in hand, rather than a second query (see `getActiveBlockersForProjects` in the store for the
  // batched-query version, for callers that don't already have every note loaded).
  const blockedProjectIds = new Set(
    allProjects.filter((p) => isBlocked(notesByProject[p.project_id] ?? [])).map((p) => p.project_id)
  );

  const projectOptions = allProjects.map((r) => ({
    project_id: r.project_id,
    project_name: r.project_name,
    owning_team: r.owning_team,
  }));
  const progressTicketOptions: ProgressTicketOption[] = tickets.map((t) => ({
    issue_key: t.issue_key,
    summary: t.summary,
    project_id: ticketProject.get(t.issue_key),
  }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <PageTitle page="projects" />
        <p className="text-sm text-neutral-500 mt-1">
          Log cross-team projects, project batch throughput, and track their Jira cod-initiative tickets.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <TeamPills teams={teams} team={team ?? ""} />
        <PortfolioSummaryStrip projects={records} blockedProjectIds={blockedProjectIds} />
        {team && (
          <ProjectMatrix
            projects={records}
            teams={teams}
            processedByProject={processedByProject}
            tasksByProject={tasksByProject}
            phasesByProject={phasesByProject}
            notesByProject={notesByProject}
            activityByProject={activityByProject}
            milestonesByProject={milestonesByProject}
            dependenciesByProject={dependenciesByProject}
            risksByProject={risksByProject}
            blockedProjectIds={blockedProjectIds}
            phaseTicketsByProject={phaseTicketsByProject}
            allTickets={tickets}
            jiraBaseUrl={process.env.JIRA_BASE_URL}
          />
        )}
        {!team && (
          <AllTeamsPortfolio projects={records} teams={teams} blockedProjectIds={blockedProjectIds} />
        )}
      </div>

      <ProjectForm teams={teams} />

      <ProjectsView
        projects={records}
        teams={teams}
        linkedCount={linkedCount}
        processedByProject={processedByProject}
        tasksByProject={tasksByProject}
        tickets={progressTicketOptions}
        jiraBaseUrl={process.env.JIRA_BASE_URL}
        phasesByProject={phasesByProject}
        notesByProject={notesByProject}
        risksByProject={risksByProject}
        activityByProject={activityByProject}
      />

      {/* Both render nothing in the page flow — each is a fixed edge tab + the SidePanel it
          opens, same mechanism as the "Today" overview tab. */}
      <ProcessedBatchesPanel projects={projectOptions} tickets={progressTicketOptions} />
      <BatchCalculatorPanel />

      <ProgressRecordsTable
        records={progress}
        projects={projectOptions}
        teams={teams}
        tickets={progressTicketOptions}
        jiraBaseUrl={process.env.JIRA_BASE_URL}
      />

      <InitiativeTicketsTable
        tickets={tickets}
        teams={teams}
        projects={records.map((r) => ({
          project_id: r.project_id,
          project_name: r.project_name,
          jira_label: r.jira_label,
          owning_team: r.owning_team,
        }))}
        assignments={assignments}
        jiraBaseUrl={process.env.JIRA_BASE_URL}
      />
    </div>
  );
}
