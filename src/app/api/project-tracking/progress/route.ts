import { createSupabaseCrudRouteHandlers } from "@/lib/supabase-crud-route";
import { addProgress, deleteProgress, updateProgress } from "@/lib/project-tracking-store";

export const { POST, PATCH, DELETE } = createSupabaseCrudRouteHandlers({
  create: addProgress,
  update: updateProgress,
  remove: deleteProgress,
});
