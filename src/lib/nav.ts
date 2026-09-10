/**
 * Every page's name, twice.
 *
 * Light and Dark get the plain name — the one a colleague reading over your shoulder needs, and the
 * one that matches the URL, the tables and the API routes. Gaby's View gets the flight-deck name,
 * which is not decoration: the theme is a mission deck, so "Station Logs" for time in the office
 * and "Critical Signals" for the incident log say what the page is *within that frame*, and
 * neither needs translating back.
 *
 * Both strings are rendered into the markup and CSS shows one (see <Copy> and the .copy-serious /
 * .copy-playful rules). That's deliberate over reading the theme in JS: the theme is applied by a
 * pre-hydration script, so a JS-driven label would render the plain name on the server and snap to
 * the playful one on hydration — a visible flicker across the whole nav on every page load. It also
 * means server components can use these names without theme context.
 *
 * `nav` is the pill; `title` is the page's own heading. They differ where the heading has always
 * been longer than the tab ("Leave" / "Leave Tracker"), and the playful pair now differs the same
 * way: the pill says "Off-Orbit" and the heading "Off-Orbit Logs". The pill has to stay short —
 * six top-level destinations share one bar (2026-09-10 nav redesign), and the straddle in TopNav
 * breaks if that bar gets wide again.
 */

export type PageKey =
  | "home"
  | "teams"
  | "overview"
  | "leave"
  | "rto"
  | "projects"
  | "incidents"
  | "monitoring"
  | "references"
  | "capacity"
  | "records";

export type PageName = {
  nav: { serious: string; playful: string };
  title: { serious: string; playful: string };
};

export const PAGE_NAMES: Record<PageKey, PageName> = {
  home: {
    nav: { serious: "My Work", playful: "Mission Control" },
    title: { serious: "My Work", playful: "Mission Control" },
  },
  teams: {
    nav: { serious: "Teams", playful: "Crew" },
    title: { serious: "Teams", playful: "Crew" },
  },
  overview: {
    nav: { serious: "Overview", playful: "All Hands" },
    title: { serious: "Overview", playful: "All Hands" },
  },
  leave: {
    nav: { serious: "Leave", playful: "Off-Orbit" },
    title: { serious: "Leave Tracker", playful: "Off-Orbit Logs" },
  },
  rto: {
    nav: { serious: "RTO", playful: "Station" },
    title: { serious: "RTO Tracker", playful: "Station Logs" },
  },
  projects: {
    nav: { serious: "Projects", playful: "Missions" },
    title: { serious: "Projects & Initiatives", playful: "Missions" },
  },
  incidents: {
    // `nav` (the Records dropdown row label) reads "Incident Monitoring" per the 2026-09-10 nav
    // correction — it's a Records menu item now, not a top-level pill, so the old pill-width
    // justification for trimming it no longer applies. `title` (the page's own heading) is
    // untouched: this is a nav-label change only, not a page-content change.
    nav: { serious: "Incident Monitoring", playful: "Signals" },
    title: { serious: "Incident Logs", playful: "Critical Signals" },
  },
  monitoring: {
    nav: { serious: "Ticket Monitoring", playful: "Telemetry" },
    title: { serious: "Ticket Monitoring", playful: "Telemetry" },
  },
  references: {
    nav: { serious: "References", playful: "The Archive" },
    title: { serious: "References", playful: "The Archive" },
  },
  capacity: {
    // nav.playful is what the Teams dropdown row actually shows in Gaby's View; title.playful
    // (the Capacity page's own heading) is untouched — this is a nav-label change only.
    nav: { serious: "Capacity", playful: "Team Orbit" },
    title: { serious: "Capacity & Health", playful: "Mission Readiness" },
  },
  records: {
    // A dropdown trigger, not a route of its own — same role PAGE_NAMES.teams already plays.
    nav: { serious: "Records", playful: "Logbook" },
    title: { serious: "Records", playful: "Logbook" },
  },
};
