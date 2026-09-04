/**
 * Shape returned by the `site-monitoring` GAS route (SiteMonitoringApi.gs). Read-only — this app
 * never writes back to the source sheet. `ecosystem` is derived server-side from three feature
 * flags that never leave Apps Script (see SiteMonitoringApi.gs for the rule).
 */
export type SiteMonitoringClient = {
  clientId: string;
  clientName: string;
  domainName: string;
  databaseName: string;
  clientStatus: string;
  databaseServer: string;
  appPoolName: string;
  sso: string;
  keycloakInstance: string;
  keycloakRealm: string;
  ecosystem: "Yes" | "No";
  ecosystemUrl: string;
};
