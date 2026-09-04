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

/**
 * Where signing in lands (see login/page.tsx) and where the brand mark goes back to.
 *
 * It is no longer the FIRST pill — Overview took that spot — but it is still the app's home in
 * every other sense: the page the day is actually run from. The two are deliberately different
 * questions ("what needs me" vs "what am I doing"), which is why both sit at the front of the bar.
 */
const PRIMARY_NAV = { href: "/my-work", page: "home" } as const;

/**
 * The Overview is deliberately NOT on this bar.
 *
 * It briefly was, and before that it was buried in the Teams dropdown. Neither fitted: the bar is
 * for places you go and work, and the Overview is something you consult — usually in the middle of
 * doing something else, which is exactly when navigating away from it is worst. So its entry point
 * is the compass tab on the right edge (OverviewQuickPanel, mounted in the dashboard layout so it
 * is not tangled up with the header's stacking), available on every page, with the full page
 * one click from inside the panel. Removing the pill also gives the bar its width back.
 */

/**
 * My Work's dropdown. References joined it 2026-09-04 rather than getting its own pill — it's a
 * personal, disposable list in the same spirit as My Work's own projects, not a place-you-go on
 * the level of Leave or Projects, and the bar has no room for an eighth pill (see the straddle
 * note below).
 */
const MY_WORK_MENU = [
  { href: "/my-work", page: "home" },
  { href: "/references", page: "references" },
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
  const [myWorkOpen, setMyWorkOpen] = useState(false);
  const myWorkRef = useRef<HTMLDivElement>(null);
  // Easter egg #1: the logo. Counts clicks and pays out on the 5th, then resets. Deliberately
  // attached to a decorative element that does nothing else, so there's no workflow to disrupt.
  const logoClicks = useRef(0);

  // Teams menu = one entry per configured team. The Overview moved out to its own pill when it
  // stopped being a cross-team rollup — see NAV_ITEMS.
  const teamMenu = teamTabs.map((t) => ({ label: t.label, playful: t.label, href: `/${t.key}` }));

  // Highlight the Teams pill on any team route (incl. /<team>/performance), no longer on "/".
  const teamKeys = teamTabs.map((t) => t.key);
  const isTeamsActive = teamKeys.some((k) => pathname === `/${k}` || pathname.startsWith(`/${k}/`));

  // My Work menu = the personal command centre plus References, its dropdown sibling.
  const isMyWorkActive = pathname === PRIMARY_NAV.href || pathname.startsWith("/references");

  // Close on outside click and on navigation.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setTeamsOpen(false);
      if (myWorkRef.current && !myWorkRef.current.contains(e.target as Node)) setMyWorkOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);
  useEffect(() => {
    setTeamsOpen(false);
    setMyWorkOpen(false);
  }, [pathname]);

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

      {/* Floating pill nav — lives outside the header, centered, straddling the boundary.
          The straddle broke at eight pills, when the bar grew wide enough to cover the theme
          switcher. It is back because the Overview pill is gone and the bar is seven again, which
          is the width it was designed at. If a pill is ever added, check this overlap first. */}
      <div className="relative z-30 -mt-5 flex justify-center px-6 pointer-events-none">
        {/* No overflow-x here, deliberately: the Teams dropdown is absolutely positioned INSIDE
            this nav, and a scroll container would clip it shut. Narrow windows overflow the bar
            horizontally, which they did before this too. */}
        <nav className="pill-nav pointer-events-auto">
          <div className="relative" ref={myWorkRef}>
            <button
              onClick={() => setMyWorkOpen((o) => !o)}
              className={cn("pill", isMyWorkActive && "pill-active")}
              aria-haspopup="menu"
              aria-expanded={myWorkOpen}
            >
              <Copy serious={PAGE_NAMES[PRIMARY_NAV.page].nav.serious} playful={PAGE_NAMES[PRIMARY_NAV.page].nav.playful} />
              <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", myWorkOpen && "rotate-180")} />
            </button>
            {myWorkOpen && (
              <div role="menu" className="dropdown-menu">
                {MY_WORK_MENU.map((item) => {
                  const active = pathname === item.href;
                  const name = PAGE_NAMES[item.page].nav;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      className={cn("dropdown-item", active && "dropdown-item-active")}
                    >
                      <span>
                        <Copy serious={name.serious} playful={name.playful} />
                      </span>
                      {active && <Check className="w-4 h-4 shrink-0" />}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

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
