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
 * seven of them share one bar, and the straddle in TopNav breaks when that bar gets wide.
 */

export type PageKey =
  | "home"
  | "teams"
  | "overview"
  | "leave"
  | "rto"
  | "projects"
  | "incidents"
  | "monitoring";

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
    // Pill trimmed, heading kept whole — same split as Off-Orbit / Off-Orbit Logs above. At the
    // full name the playful bar measures ~58px wider than the width the header straddle was
    // designed around, and that overlap is a documented breakage (see TopNav). The page's own
    // heading says "Critical Signals"; the pill has to fit next to six others.
    nav: { serious: "Incident Logs", playful: "Signals" },
    title: { serious: "Incident Logs", playful: "Critical Signals" },
  },
  monitoring: {
    nav: { serious: "Ticket Monitoring", playful: "Telemetry" },
    title: { serious: "Ticket Monitoring", playful: "Telemetry" },
  },
};
