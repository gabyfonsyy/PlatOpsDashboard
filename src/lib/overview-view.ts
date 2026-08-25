import type { VoiceMode } from "@/lib/ai-voice";

/**
 * The Overview's two registers.
 *
 * ── What actually differs ──────────────────────────────────────────────────────────────────────
 * Labels, section order, and the voice layer the AI briefing is written in. Nothing else. Both
 * modes call the same `getOverview`, read the same modules, compute the same numbers and link to
 * the same pages — so a figure can never say one thing in Professional and another in Gaby.
 *
 * ── The register follows the THEME ─────────────────────────────────────────────────────────────
 * Gaby's View theme (`adhd`) reads the Gaby register; Light and Dark read Professional. There is
 * no separate control, deliberately: the app already ties the AI's voice to the theme everywhere
 * else through voiceForTheme, and a second switch that could disagree with the theme picker is one
 * more thing to reason about for no gain.
 *
 * The theme lives in localStorage, which the server cannot read — and this page picks which cached
 * assessment to fetch during the SERVER render. That is what THEME_COOKIE exists for: the theme is
 * mirrored into a cookie so the server can see it. The cookie can be stale by exactly one request
 * after a theme change, so the page also self-heals (see AssessmentHeader).
 */
export const OVERVIEW_VIEWS = ["professional", "gaby"] as const;
export type OverviewView = (typeof OVERVIEW_VIEWS)[number];

/**
 * The register a theme implies. `adhd` is the stored key for Gaby's View — see the note on THEMES
 * in lib/theme.ts for why that key was never renamed.
 *
 * Mirrors voiceForTheme in lib/ai-voice.ts exactly, and must keep doing so: they answer the same
 * question ("is this Gaby's register?") for two different layers.
 */
export function viewForTheme(theme: string | undefined): OverviewView {
  return theme === "adhd" ? "gaby" : "professional";
}

/** The AI register each view reads. Snapshots are cached per register — see lib/overview-ai.ts. */
export function voiceForView(view: OverviewView): VoiceMode {
  return view === "gaby" ? "gaby" : "normal";
}

type SectionCopy = {
  title: string;
  subtitle?: string;
};

/**
 * Every string that differs between the modes, in one place.
 *
 * Gaby's labels came from her directly. The instruction attached to them was "do not force humour
 * into every section", which is why the serious sections — the ones about a named person's
 * performance, or an incident — read almost identically in both. A section that has to deliver bad
 * news about a colleague is not the place for a lighter register, and the copy reflects that.
 */
export const VIEW_COPY: Record<
  OverviewView,
  {
    label: string;
    priority: SectionCopy;
    myDay: SectionCopy;
    teamPulse: SectionCopy;
    systemPulse: SectionCopy;
    momentum: SectionCopy;
    watch: SectionCopy;
    stable: SectionCopy;
    focus: SectionCopy;
    operations: SectionCopy;
    assessment: SectionCopy;
    /** Shown when a section genuinely has nothing in it. */
    empty: {
      priority: string;
      watch: string;
      stable: string;
      focus: string;
    };
  }
> = {
  professional: {
    label: "Professional",
    priority: {
      title: "Priority Attention",
      subtitle: "What most deserves your attention today",
    },
    myDay: { title: "My Day", subtitle: "Your tasks and immediate commitments" },
    teamPulse: { title: "Team Pulse", subtitle: "Team activity, workload and coverage" },
    systemPulse: {
      title: "System Pulse",
      subtitle: "How well the system lets the team work",
    },
    momentum: {
      title: "Sustainable Momentum",
      subtitle: "Healthy system, or effort covering for one",
    },
    watch: { title: "Keep an Eye On", subtitle: "Emerging patterns that are not problems yet" },
    stable: {
      title: "Nothing Needs Your Intervention",
      subtitle: "Confirmed healthy — no action required",
    },
    focus: { title: "Recommended Focus", subtitle: "Highest-leverage actions for today" },
    operations: { title: "Projects & Operations", subtitle: "Delivery and operational surfaces" },
    assessment: { title: "Daily Assessment", subtitle: "Generated once per day from every connected module" },
    empty: {
      priority: "Nothing requires your attention right now.",
      watch: "No emerging patterns detected in the available data.",
      stable: "Not enough data to confirm anything as healthy yet.",
      focus: "No specific actions recommended today.",
    },
  },
  gaby: {
    label: "Gaby View",
    priority: {
      title: "Gaby, Look at This",
      subtitle: "The things actually worth your attention today",
    },
    myDay: { title: "Your Day", subtitle: "What you've committed to today" },
    teamPulse: { title: "Team Pulse", subtitle: "What's actually happening with the team" },
    systemPulse: {
      title: "System Pulse",
      subtitle: "Whether the system is helping or the team is compensating for it",
    },
    momentum: {
      title: "Sustainable Momentum",
      subtitle: "Can this pace hold without someone burning out",
    },
    watch: { title: "Keep an Eye On", subtitle: "Not a problem yet — just worth noticing" },
    stable: { title: "Nothing on Fire", subtitle: "You can leave these alone" },
    focus: { title: "Gaby's Next Move", subtitle: "If you only do a couple of things today" },
    operations: { title: "Projects & Operations", subtitle: "What's running and what isn't wired up yet" },
    assessment: { title: "Today's Read", subtitle: "Written once this morning from everything that's connected" },
    empty: {
      priority: "Nothing needs you right now. Genuinely.",
      watch: "Nothing drifting that's worth watching yet.",
      stable: "Not enough data yet to tell you anything is fine.",
      focus: "No moves to recommend — keep going with what's on the board.",
    },
  },
};

/**
 * Section order. Gaby's hierarchy leads with what needs her and ends with what to do; the
 * professional one keeps the operational surfaces higher, where a reader scanning for delivery
 * status expects them.
 */
export const SECTION_ORDER: Record<OverviewView, readonly SectionKey[]> = {
  professional: [
    "priority",
    "myDay",
    "teamPulse",
    "operations",
    "systemPulse",
    "momentum",
    "watch",
    "stable",
    "focus",
  ],
  gaby: [
    "priority",
    "myDay",
    "teamPulse",
    "systemPulse",
    "momentum",
    "watch",
    "stable",
    "focus",
    "operations",
  ],
};

export type SectionKey =
  | "priority"
  | "myDay"
  | "teamPulse"
  | "systemPulse"
  | "momentum"
  | "watch"
  | "stable"
  | "focus"
  | "operations";

/** "Good morning" / "Good afternoon" / "Good evening", Manila time. */
export function greeting(now: Date = new Date()): string {
  const hour = Number(
    now.toLocaleString("en-US", { timeZone: "Asia/Manila", hour: "2-digit", hour12: false })
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
