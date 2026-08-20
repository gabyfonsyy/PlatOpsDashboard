import { getTeams } from "@/lib/teams";
import { fetchGas } from "@/lib/gas-client";
import { getInitiativeTickets } from "@/lib/initiatives";
import { getTicketAssignments } from "@/lib/ticket-projects";
import { getProjectProgress } from "@/lib/progress";
import { getProjectTasks } from "@/lib/tasks";
import type { ProjectRecord, TaskRecord } from "@/lib/types";
import { ProjectForm } from "@/components/forms/ProjectForm";
import { ProjectsView } from "@/components/forms/ProjectsView";
import { ProgressForm } from "@/components/forms/ProgressForm";
import { ProgressRecordsTable } from "@/components/forms/ProgressRecordsTable";
import type { ProgressTicketOption } from "@/components/forms/progress-fields";
import { BatchCalculator } from "@/components/forms/BatchCalculator";
import { InitiativeTicketsTable } from "@/components/dashboard/InitiativeTicketsTable";
import { PageTitle } from "@/components/ui/PageTitle";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = typeof searchParams.team === "string" ? searchParams.team : undefined;

  const [teams, records, tickets, assignments, progress, tasks] = await Promise.all([
    getTeams().catch(() => []),
    fetchGas<ProjectRecord[]>("projects", { team }, { cache: "no-store" }).catch(() => []),
    getInitiativeTickets().catch(() => []),
    getTicketAssignments().catch(() => []),
    getProjectProgress().catch(() => []),
    getProjectTasks().catch(() => []),
  ]);

  // Resolved linked-ticket count per project: manual assignment wins, else first label match.
  // `ticketProject` also feeds the progress form's ticket dropdown so it can scope by project.
  const manualByKey = new Map(assignments.filter((a) => a.project_id).map((a) => [a.issue_key, a.project_id]));
  const labelledProjects = records.filter((r) => String(r.jira_label || "").trim());
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
  const tasksByProject: Record<string, TaskRecord[]> = {};
  for (const t of tasks) {
    (tasksByProject[t.project_id] ??= []).push(t);
  }

  const projectOptions = records.map((r) => ({
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

      <ProjectForm teams={teams} />

      <ProjectsView
        projects={records}
        teams={teams}
        linkedCount={linkedCount}
        processedByProject={processedByProject}
        tasksByProject={tasksByProject}
        tickets={progressTicketOptions}
        jiraBaseUrl={process.env.JIRA_BASE_URL}
      />

      <section className="flex flex-col gap-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <ProgressForm projects={projectOptions} tickets={progressTicketOptions} />
          <BatchCalculator />
        </div>

        <ProgressRecordsTable
          records={progress}
          projects={projectOptions}
          teams={teams}
          tickets={progressTicketOptions}
          jiraBaseUrl={process.env.JIRA_BASE_URL}
        />
      </section>

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
