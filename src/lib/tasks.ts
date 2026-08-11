import { fetchGas } from "@/lib/gas-client";
import type { TaskRecord } from "@/lib/types";

/** Per-project task checklist (PROJECT_TASKS). no-store so a freshly added/toggled task shows
 * immediately after router.refresh(). Optionally scoped to one project. */
export async function getProjectTasks(
  params: { project_id?: string } = {}
): Promise<TaskRecord[]> {
  return fetchGas<TaskRecord[]>("project-tasks", { project_id: params.project_id }, { cache: "no-store" });
}
