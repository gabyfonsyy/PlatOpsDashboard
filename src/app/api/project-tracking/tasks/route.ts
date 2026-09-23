import { createSupabaseCrudRouteHandlers } from "@/lib/supabase-crud-route";
import { createTask, deleteTask, updateTask } from "@/lib/project-tracking-store";

export const { POST, PATCH, DELETE } = createSupabaseCrudRouteHandlers({
  create: createTask,
  update: updateTask,
  remove: deleteTask,
});
