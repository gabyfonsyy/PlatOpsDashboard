import { createSupabaseCrudRouteHandlers } from "@/lib/supabase-crud-route";
import { createProject, deleteProject, updateProject } from "@/lib/project-tracking-store";

export const { POST, PATCH, DELETE } = createSupabaseCrudRouteHandlers({
  create: createProject,
  update: updateProject,
  remove: deleteProject,
});
