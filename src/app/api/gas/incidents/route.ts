import { createCrudRouteHandlers } from "@/lib/gas-crud-route";

/** POST/PATCH/DELETE an incident log (INCIDENT_LOGS in GAS). The Jira pull is a separate
 * route — see ./sync — because it isn't a CRUD action on a log record. */
export const { POST, PATCH, DELETE } = createCrudRouteHandlers("incidents");
