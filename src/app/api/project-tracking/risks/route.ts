import { createSupabaseCrudRouteHandlers } from "@/lib/supabase-crud-route";
import { createRisk, deleteRisk, updateRisk } from "@/lib/project-tracking-store";

export const { POST, PATCH, DELETE } = createSupabaseCrudRouteHandlers({
  create: createRisk,
  update: updateRisk,
  remove: deleteRisk,
});
