import { createSupabaseCrudRouteHandlers } from "@/lib/supabase-crud-route";
import { createDependency, deleteDependency, updateDependency } from "@/lib/project-tracking-store";

export const { POST, PATCH, DELETE } = createSupabaseCrudRouteHandlers({
  create: createDependency,
  update: updateDependency,
  remove: deleteDependency,
});
