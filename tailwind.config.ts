import type { Config } from "tailwindcss";

/**
 * Every colour is a CSS variable holding space-separated RGB channels, consumed as
 * `rgb(var(--x) / <alpha-value>)` so Tailwind's opacity modifiers (`bg-surface/70`,
 * `text-neutral-900/50`) keep working. The actual values live in globals.css, one block per
 * theme (`:root`, `[data-theme="dark"]`, `[data-theme="adhd"]`).
 *
 * Why this indirection rather than `dark:` variants: the codebase already funnels ~440 colour
 * usages through these two custom scales, and it uses them consistently — `neutral-900` for
 * primary text, `neutral-50/100` for subtle fills, `neutral-200` for borders. Swapping the
 * variables (and inverting the neutral ramp) repaints all of it with no component edits, which
 * is the only way three themes stay maintainable across 76 components.
 */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Space Grotesk", "sans-serif"],
        serif: ["Fraunces", "serif"],
      },
      keyframes: {
        "dropdown-in": {
          "0%": { opacity: "0", transform: "translateY(-6px) scale(0.97)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        // --- ADHD View motion. Short and one-shot: the brief asks for "quiet until interacted
        // with", so nothing here loops except `breathe`, which is slow enough to read as ambient.
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.94) translateY(4px)" },
          "60%": { opacity: "1", transform: "scale(1.015) translateY(0)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        breathe: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-2px)" },
        },
        // Ambient "good news" pulse for a card. Shadow-only on purpose — see the
        // .adhd-happy note in globals.css: a transform on a backdrop-filtered
        // element re-blurs its backdrop every frame, a box-shadow doesn't.
        "glow-breathe": {
          "0%, 100%": { boxShadow: "var(--shadow-card)" },
          "50%": { boxShadow: "var(--shadow-glow-lg)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "sheen-sweep": {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(220%)" },
        },
        "score-flash": {
          "0%": { transform: "scale(1)" },
          "35%": { transform: "scale(1.06)" },
          "100%": { transform: "scale(1)" },
        },
        // Arrival of a floating popup from the bottom-right — the reschedule prompt. Short and
        // one-shot, and the global reduced-motion block already collapses it to nothing.
        "toast-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // A critical signal light, breathing. Slow and shallow: it has to read as "alive and
        // serious", never as an alarm, on a screen someone keeps open all day.
        "signal-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        "dropdown-in": "dropdown-in 0.16s cubic-bezier(0.16, 1, 0.3, 1)",
        "glow-pulse": "glow-pulse 3.5s ease-in-out infinite",
        "pop-in": "pop-in 0.26s cubic-bezier(0.16, 1, 0.3, 1) both",
        breathe: "breathe 6s ease-in-out infinite",
        "glow-breathe": "glow-breathe 6s ease-in-out infinite",
        "fade-in": "fade-in 0.8s ease-out both",
        "sheen-sweep": "sheen-sweep 0.9s cubic-bezier(0.16, 1, 0.3, 1)",
        "score-flash": "score-flash 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        "toast-in": "toast-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both",
        "signal-pulse": "signal-pulse 2.4s ease-in-out infinite",
      },
      boxShadow: {
        // Theme-driven so dark/adhd get their own depth and bloom rather than a light-mode
        // shadow that turns into a grey smudge on a dark background.
        glow: "var(--shadow-glow)",
        "glow-lg": "var(--shadow-glow-lg)",
        card: "var(--shadow-card)",
      },
      colors: {
        /** Page background. */
        canvas: v("canvas"),
        /** Raised surfaces — cards, dialogs, inputs, popovers. */
        surface: v("surface"),
        /**
         * A surface that must read as ABOVE a `neutral-100` fill — the selected pill inside a
         * segmented control. In light mode `surface` (white) already does that; in dark mode
         * `surface` and `neutral-100` land within 5 RGB points of each other, so a plain
         * `bg-surface` pill becomes invisible and the control looks like it has no selection.
         */
        "surface-raised": v("surface-raised"),
        /** Hairlines on raised surfaces. */
        line: v("line"),

        // Accent. Keeps the `sprout` key so every existing sprout-* class repaints in place.
        sprout: {
          50: v("a-50"),
          100: v("a-100"),
          200: v("a-200"),
          300: v("a-300"),
          400: v("a-400"),
          500: v("a-500"),
          600: v("a-600"),
          700: v("a-700"),
          800: v("a-800"),
          900: v("a-900"),
          950: v("a-950"),
        },

        /**
         * Gaby accent — lavender. The second accent, and it means one thing: THIS IS YOURS.
         * Selected states, personal surfaces, the register itself.
         *
         * Deliberately not a status colour. `sprout` is interactive, `ok`/`warn`/`danger` are
         * states, and this is identity — the moment lavender also means "warning" somewhere,
         * neither reading survives anywhere.
         */
        gaby: {
          50: v("g-50"),
          100: v("g-100"),
          200: v("g-200"),
          300: v("g-300"),
          400: v("g-400"),
          500: v("g-500"),
          600: v("g-600"),
          700: v("g-700"),
          800: v("g-800"),
          900: v("g-900"),
        },

        /** A decorative warm point. Never carries meaning — see the star field in globals.css. */
        peach: v("peach"),

        // Neutral ramp. In dark/adhd the ramp is INVERTED (50 = darkest, 900 = lightest) so the
        // existing semantics hold: `text-neutral-900` stays "primary text", `bg-neutral-50`
        // stays "faintest fill", `border-neutral-200` stays "hairline".
        neutral: {
          50: v("n-50"),
          100: v("n-100"),
          200: v("n-200"),
          300: v("n-300"),
          400: v("n-400"),
          500: v("n-500"),
          600: v("n-600"),
          700: v("n-700"),
          800: v("n-800"),
          900: v("n-900"),
          950: v("n-950"),
        },

        // Status colours: only the shades actually used are overridden, so the rest of Tailwind's
        // scales stay untouched. Dark themes need lighter, less saturated status text — pure
        // red-600 on a near-black background is both hard to read and unpleasantly loud.
        red: {
          50: v("danger-50"),
          100: v("danger-100"),
          200: v("danger-200"),
          500: v("danger-500"),
          600: v("danger-600"),
          700: v("danger-700"),
        },
        amber: {
          50: v("warn-50"),
          100: v("warn-100"),
          200: v("warn-200"),
          500: v("warn-500"),
          600: v("warn-600"),
          700: v("warn-700"),
          800: v("warn-800"),
          900: v("warn-900"),
        },
        emerald: {
          100: v("ok-100"),
          500: v("ok-500"),
          700: v("ok-700"),
        },
      },
    },
  },
  plugins: [],
};

export default config;
