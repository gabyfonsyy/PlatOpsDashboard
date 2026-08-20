/**
 * Every page's name, twice.
 *
 * Light and Dark get the plain name — the one a colleague reading over your shoulder needs, and the
 * one that matches the URL, the tables and the API routes. Gaby's View gets the flight-deck name,
 * which is not decoration: the theme is a spacecraft, so "Re-entry" for returning to the office and
 * "Black Box" for the incident log say what the page is *within that frame*, and neither needs
 * translating back.
 *
 * Both strings are rendered into the markup and CSS shows one (see <Copy> and the .copy-serious /
 * .copy-playful rules). That's deliberate over reading the theme in JS: the theme is applied by a
 * pre-hydration script, so a JS-driven label would render the plain name on the server and snap to
 * the playful one on hydration — a visible flicker across the whole nav on every page load. It also
 * means server components can use these names without theme context.
 *
 * `nav` is the pill; `title` is the page's own heading. They differ where the heading has always
 * been longer than the tab ("Leave" / "Leave Tracker") — but the playful name is short in both
 * places, because a flight deck doesn't label anything "Tracker".
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
    nav: { serious: "Leave", playful: "Shore Leave" },
    title: { serious: "Leave Tracker", playful: "Shore Leave" },
  },
  rto: {
    nav: { serious: "RTO", playful: "Re-entry" },
    title: { serious: "RTO Tracker", playful: "Re-entry" },
  },
  projects: {
    nav: { serious: "Projects", playful: "Missions" },
    title: { serious: "Projects & Initiatives", playful: "Missions" },
  },
  incidents: {
    nav: { serious: "Incident Logs", playful: "Black Box" },
    title: { serious: "Incident Logs", playful: "Black Box" },
  },
  monitoring: {
    nav: { serious: "Ticket Monitoring", playful: "Radar" },
    title: { serious: "Ticket Monitoring", playful: "Radar" },
  },
};
