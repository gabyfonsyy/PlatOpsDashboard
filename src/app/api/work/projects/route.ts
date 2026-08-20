import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { handle } from "@/lib/work-route";
import { createProject, updateProject } from "@/lib/work-store";
import { PROJECT_STATUSES } from "@/lib/work";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const name = String(body.name ?? "").trim();
    if (!name) throw new Error("A project needs a name.");
    const project = await createProject(email, { name, status: body.status as string | undefined });
    revalidatePath("/my-work");
    return project;
  });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return handle(async (email) => {
    const id = String(body.project_id ?? "").trim();
    if (!id) throw new Error("project_id is required.");
    if (body.status !== undefined && !PROJECT_STATUSES.includes(String(body.status) as never)) {
      throw new Error(`Invalid status: ${String(body.status)}`);
    }
    const patch: Record<string, unknown> = {};
    for (const k of ["name", "status", "notes"]) if (body[k] !== undefined) patch[k] = body[k];
    const project = await updateProject(email, id, patch);
    revalidatePath("/my-work");
    return project;
  });
}
