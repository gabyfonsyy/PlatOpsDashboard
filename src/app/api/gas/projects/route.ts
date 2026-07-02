import { createCrudRouteHandlers } from "@/lib/gas-crud-route";

export const { POST, PATCH, DELETE } = createCrudRouteHandlers("projects");
