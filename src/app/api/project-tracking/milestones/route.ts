import { createSupabaseCrudRouteHandlers } from "@/lib/supabase-crud-route";
import { createMilestone, deleteMilestone, updateMilestone } from "@/lib/project-tracking-store";

export const { POST, PATCH, DELETE } = createSupabaseCrudRouteHandlers({
  create: createMilestone,
  update: updateMilestone,
  remove: deleteMilestone,
});
