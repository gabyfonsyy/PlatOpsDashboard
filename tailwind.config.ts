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
        sans: ["Rubik", "sans-serif"],
      },
      colors: {
        // Sprout brand palette — same tokens as Operations Hub
        sprout: {
          50: "#edfaf2",
          100: "#d4f3e0",
          200: "#ace5c3",
          300: "#76d19f",
          400: "#3eb87a",
          500: "#18a558", // primary brand green
          600: "#108443",
          700: "#0e6b37",
          800: "#0d552d",
          900: "#0b4525",
          950: "#052e17",
        },
        // Neutral palette for UI
        neutral: {
          50: "#f9fafb",
          100: "#f3f4f6",
          200: "#e5e7eb",
          300: "#d1d5db",
          400: "#9ca3af",
          500: "#6b7280",
          600: "#4b5563",
          700: "#374151",
          800: "#1f2937",
          900: "#111827",
          950: "#030712",
        },
      },
    },
  },
  plugins: [],
};

export default config;
