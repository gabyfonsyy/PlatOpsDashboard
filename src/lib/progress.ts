import { fetchGas } from "@/lib/gas-client";
import type { ProgressRecord } from "@/lib/types";

/** Per-batch processed-count log (PROJECT_PROGRESS). no-store so a freshly logged batch shows
 * immediately after router.refresh(). Optionally scoped to one project. */
export async function getProjectProgress(
  params: { project_id?: string } = {}
): Promise<ProgressRecord[]> {
  return fetchGas<ProgressRecord[]>("project-progress", { project_id: params.project_id }, { cache: "no-store" });
}
