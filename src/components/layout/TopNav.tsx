"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { RefreshDataButton } from "@/components/layout/RefreshDataButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { celebrate } from "@/lib/celebrate";
import { PAGE_NAMES } from "@/lib/nav";
import { Copy } from "@/components/ui/Copy";
import { OverviewQuickPanel } from "@/components/overview/OverviewQuickPanel";

/**
 * Where signing in lands (see login/page.tsx) and where the brand mark goes back to.
 *
 * It is no longer the FIRST pill — Overview took that spot — but it is still the app's home in
 * every other sense: the page the day is actually run from. The two are deliberately different
 * questions ("what needs me" vs "what am I doing"), which is why both sit at the front of the bar.
 */
const PRIMARY_NAV = { href: "/my-work", page: "home" } as const;

/**
 * The two pills before the Teams dropdown. Overview leads: it is the page that answers "what needs
 * me today", so it is the first thing on the bar and the first thing read. It used to live INSIDE
 * the Teams dropdown as the "cross-team rollup", which stopped being true when it became the
 * command centre — it is not about teams at all any more.
 */
const LEADING_NAV = [
  { href: "/", page: "overview" },
  { href: PRIMARY_NAV.href, page: PRIMARY_NAV.page },
] as const;

/** Labels come from lib/nav.ts, which carries both names for every page. */
const NAV_ITEMS = [
  { href: "/leave", page: "leave" },
  { href: "/rto", page: "rto" },
  { href: "/projects", page: "projects" },
  { href: "/incident-logs", page: "incidents" },
  { href: "/monitoring", page: "monitoring" },
] as const;

export function TopNav({ teamTabs = [] as { key: string; label: string }[] }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [teamsOpen, setTeamsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Easter egg #1: the logo. Counts clicks and pays out on the 5th, then resets. Deliberately
  // attached to a decorative element that does nothing else, so there's no workflow to disrupt.
  const logoClicks = useRef(0);

  // Teams menu = one entry per configured team. The Overview moved out to its own pill when it
  // stopped being a cross-team rollup — see NAV_ITEMS.
  const teamMenu = teamTabs.map((t) => ({ label: t.label, playful: t.label, href: `/${t.key}` }));

  // Highlight the Teams pill on any team route (incl. /<team>/performance), no longer on "/".
  const teamKeys = teamTabs.map((t) => t.key);
  const isTeamsActive = teamKeys.some((k) => pathname === `/${k}` || pathname.startsWith(`/${k}/`));

  // Close on outside click and on navigation.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setTeamsOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);
  useEffect(() => setTeamsOpen(false), [pathname]);

  return (
    <>
      {/* Header: brand + account only */}
      <header className="sticky top-0 z-20 bg-surface/70 backdrop-blur-xl border-b border-neutral-200/60">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
          {/* The mark goes home — to Mission Control, not the team Overview. This stopped being a
              chart-viewer a while ago; the thing it actually is now is the place your own day is
              run from, so the logo is an orbit (you in the middle, everything else circling) and
              it navigates rather than just sitting there. */}
          <Link
            href={PRIMARY_NAV.href}
            aria-label={`Platform Ops — ${PAGE_NAMES[PRIMARY_NAV.page].nav.serious}`}
            onClick={(e) => {
              // Easter egg #1: still here. It counts clicks and pays out on the 5th, then resets.
              // No preventDefault — the navigation is the mark's real job and the confetti rides
              // along with it, so the egg can't strand you on the wrong page.
              logoClicks.current += 1;
              if (logoClicks.current >= 5) {
                logoClicks.current = 0;
                celebrate("chaos", { x: e.clientX, y: e.clientY });
              }
            }}
            className="flex items-center gap-2 shrink-0 group"
          >
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-sprout-400 to-sprout-600 shadow-glow flex items-center justify-center transition-transform duration-200 group-active:scale-90">
              <svg
                viewBox="0 0 24 24"
                className="w-5 h-5 text-white transition-transform duration-500 ease-out group-hover:rotate-[25deg]"
              >
                {/* Ring and satellite share one rotation so the dot stays ON the orbit. */}
                <g transform="rotate(-30 12 12)">
                  <ellipse
                    cx="12"
                    cy="12"
                    rx="9.5"
                    ry="4.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    opacity={0.8}
                  />
                  <circle cx="21.5" cy="12" r="1.7" fill="currentColor" />
                </g>
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
            </span>
            <span className="font-serif font-medium text-neutral-900 text-sm hidden sm:inline">Platform Ops</span>
          </Link>

          <div className="flex items-center gap-4 shrink-0">
            {/* Today's overview, without leaving the page you're on. Hides itself on "/". */}
            <OverviewQuickPanel />
            <ThemeToggle />
            <RefreshDataButton />
            {session?.user && (
              <button onClick={() => signOut({ callbackUrl: "/login" })} className="flex items-center gap-2 group">
                {session.user.image ? (
                  <Image
                    src={session.user.image}
                    alt=""
                    width={28}
                    height={28}
                    className="rounded-full ring-2 ring-transparent group-hover:ring-sprout-300 transition-all duration-200"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-sprout-100 flex items-center justify-center text-sprout-700 text-xs font-semibold ring-2 ring-transparent group-hover:ring-sprout-300 transition-all duration-200">
                    {session.user.name?.[0] ?? "?"}
                  </div>
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Floating pill nav, centered under the header.
          It used to be pulled UP by -mt-5 to straddle the header's bottom edge, which looked good
          at six pills and broke at eight: the bar grew wide enough to reach the header's own
          controls and sat on top of the theme switcher. A nav that covers a control is worse than
          a nav that doesn't straddle, so it now sits cleanly below the boundary. */}
      <div className="relative z-30 mt-3 flex justify-center px-6 pointer-events-none">
        {/* No overflow-x here, deliberately: the Teams dropdown is absolutely positioned INSIDE
            this nav, and a scroll container would clip it shut. Narrow windows overflow the bar
            horizontally, which they did before this too. */}
        <nav className="pill-nav pointer-events-auto">
          {LEADING_NAV.map((item) => {
            // "/" is a prefix of every path, so it has to match exactly or it lights up everywhere.
            const active = item.href === "/" ? pathname === "/" : pathname === item.href;
            const name = PAGE_NAMES[item.page].nav;
            return (
              <Link key={item.href} href={item.href} className={cn("pill", active && "pill-active")}>
                <Copy serious={name.serious} playful={name.playful} />
              </Link>
            );
          })}

          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setTeamsOpen((o) => !o)}
              className={cn("pill", isTeamsActive && "pill-active")}
              aria-haspopup="menu"
              aria-expanded={teamsOpen}
            >
              <Copy serious={PAGE_NAMES.teams.nav.serious} playful={PAGE_NAMES.teams.nav.playful} />
              <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", teamsOpen && "rotate-180")} />
            </button>
            {teamsOpen && (
              <div role="menu" className="dropdown-menu">
                {teamMenu.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      className={cn("dropdown-item", active && "dropdown-item-active")}
                    >
                      <span>
                        <Copy serious={item.label} playful={item.playful} />
                      </span>
                      {active && <Check className="w-4 h-4 shrink-0" />}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const name = PAGE_NAMES[item.page].nav;
            return (
              <Link key={item.href} href={item.href} className={cn("pill", active && "pill-active")}>
                <Copy serious={name.serious} playful={name.playful} />
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
