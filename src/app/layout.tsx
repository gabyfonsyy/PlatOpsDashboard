import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { SpaceField } from "@/components/theme/SpaceField";

export const metadata: Metadata = {
  title: "Platform Operations Dashboard | Sprout",
  description: "Jira metrics, project tracking, leave, and RTO visibility for SE, DBA, and DevOps",
};

/**
 * Applies the stored theme before first paint. Without this the page renders light, then snaps to
 * dark on hydration — a full-page flash on every navigation, which is exactly the thing a
 * dark-mode user notices most. Inlined and synchronous on purpose: it must run before the browser
 * paints, so it can't be a module or a deferred script.
 *
 * Kept deliberately tiny and wrapped in try/catch — if localStorage is blocked it falls through
 * to the CSS default rather than throwing before the app boots.
 */
const THEME_INIT = `(function(){try{var t=localStorage.getItem("platops-theme");if(t==="light"||t==="dark"||t==="adhd"){document.documentElement.dataset.theme=t;document.cookie="platops-theme="+t+";path=/;max-age=31536000;samesite=lax"}}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the script above mutates <html> before React hydrates, so the
    // server and client markup legitimately differ on this one attribute.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        {/* Gaby View's atmosphere. Rendered in every theme and hidden by CSS rather than mounted
            from JS — the theme comes from a pre-hydration script, so a JS gate would pop the whole
            field in after hydration on every load. Hidden spans cost nothing, and this way the sky
            is already there in the first paint it belongs to. */}
        <SpaceField />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
