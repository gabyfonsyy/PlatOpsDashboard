/**
 * Read-only lookup over the `Final List` tab of the Site Monitoring workbook — per-client
 * operational data (domain, database, App Pool, SSO/Keycloak) used for fast P1 incident triage.
 *
 * Deliberately no create/update/delete: the sheet is the source of truth, maintained outside this
 * app, and the dashboard is a read-and-investigate surface only (see References page's Impacted
 * Clients panel, which is frontend-only scratch state and never writes back here).
 *
 * The three feature-flag columns (FF 46/34/67) never leave this function — only the derived
 * `ecosystem` value is returned, so a raw flag can't end up rendered or logged on the frontend
 * by accident.
 */
var SiteMonitoringApi = {
  list: function () {
    const sheet = getSiteMonitoringSpreadsheet_().getSheetByName('Final List');
    if (!sheet) throw new Error("Site Monitoring sheet has no 'Final List' tab.");
    const rows = sheetToObjects_(sheet);

    return rows.map(function (r) {
      // The header row wraps these three onto two lines in the sheet, so sheetToObjects_ keys
      // them with a literal '\n', not a space — confirmed via the (now removed) debugRow_ dump.
      const ff46 = String(r['FF 46\n(FutureDatedResignationApi)'] || '').trim();
      const ff34 = String(r['FF 34\n(Future Dated Resignation - Direct)'] || '').trim();
      const ff67 = String(r['FF 67\n(EcosystemDashboardEnabled)'] || '').trim();
      const ecosystem = ff46 === 'Yes' && ff34 === 'No' && ff67 === 'Yes' ? 'Yes' : 'No';

      return {
        clientId: String(r['Client ID'] || '').trim(),
        clientName: String(r['Client Name'] || '').trim(),
        domainName: String(r['Domain Name'] || '').trim(),
        databaseName: String(r['Database Name'] || '').trim(),
        clientStatus: String(r['Client Status'] || '').trim(),
        databaseServer: String(r['Database Server'] || '').trim(),
        appPoolName: String(r['App Pool Name'] || '').trim(),
        sso: String(r['SSO'] || '').trim(),
        keycloakInstance: String(r['Keycloak Instance'] || '').trim(),
        keycloakRealm: String(r['Keycloak Realm'] || '').trim(),
        ecosystem: ecosystem,
        ecosystemUrl: String(r['Ecosystem URL'] || '').trim(),
      };
    }).filter(function (c) { return c.clientId !== ''; });
  },
};
