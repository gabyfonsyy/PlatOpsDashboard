import type { Config } from "tailwindcss";

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
      },
      animation: {
        "dropdown-in": "dropdown-in 0.16s cubic-bezier(0.16, 1, 0.3, 1)",
        "glow-pulse": "glow-pulse 3.5s ease-in-out infinite",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(168, 124, 214, 0.18), 0 8px 24px -6px rgba(124, 79, 168, 0.35)",
        "glow-lg": "0 0 0 1px rgba(168, 124, 214, 0.22), 0 20px 48px -12px rgba(107, 66, 148, 0.45)",
      },
      colors: {
        // Sprout accent palette — retired the green brand tokens for a lavender/mauve
        // "sci-fi bloom" scheme (retains the `sprout` key so every existing sprout-* class
        // repaints automatically instead of needing a project-wide rename).
        sprout: {
          50: "#faf6fc",
          100: "#f2e7f7",
          200: "#e3cdee",
          300: "#cda8d9",
          400: "#b383c3",
          500: "#9863a8", // primary accent — dusty mauve
          600: "#7d4c8c",
          700: "#643c70",
          800: "#4d2e57",
          900: "#382142",
          950: "#22142a",
        },
        // Neutral palette — gray with a soft purple undertone ("mist") instead of flat gray,
        // so backgrounds/borders/text read as part of the same purple world as the accent.
        neutral: {
          50: "#faf9fc",
          100: "#f3f1f8",
          200: "#e6e1f0",
          300: "#d1c8e0",
          400: "#a89bc0",
          500: "#82749d",
          600: "#655a80",
          700: "#4e4566",
          800: "#39324d",
          900: "#251f38",
          950: "#160f24",
        },
      },
    },
  },
  plugins: [],
};

export default config;
