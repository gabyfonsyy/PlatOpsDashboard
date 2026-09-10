"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Menu, X, Clock, Building, FolderKanban, Radar, Siren, Gauge, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { RefreshDataButton } from "@/components/layout/RefreshDataButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { celebrate } from "@/lib/celebrate";
import { PAGE_NAMES, type PageKey } from "@/lib/nav";
import { Copy } from "@/components/ui/Copy";

/**
 * Where signing in lands (see login/page.tsx) and where the brand mark goes back to.
 *
 * It is no longer the FIRST pill — Overview took that spot — but it is still the app's home in
 * every other sense: the page the day is actually run from. The two are deliberately different
 * questions ("what needs me" vs "what am I doing"), which is why both sit at the front of the bar.
 */
const PRIMARY_NAV = { href: "/my-work", page: "home" as PageKey } as const;

const REFERENCES_NAV = { href: "/references", page: "references" as PageKey } as const;

/**
 * 2026-09-10 nav redesign, corrected same-day per her follow-up brief: FOUR top-level
 * destinations only — My Work, Teams, Records, References. Capacity and Incident Logs are NOT
 * top-level anymore; both moved under Teams/Records respectively (see below). This correction
 * also narrows the bar further (4 elements instead of the prior pass's 6), so the straddle-width
 * concern the bar's layout comment used to flag is even further from being a risk.
 */

/**
 * Records' popover contents: Leave, RTO, Projects, Incident Monitoring (moved here from its own
 * top-level pill per her explicit correction), plus Ticket Monitoring — the Account Creation
 * Review control tower, which already lived here from the PREVIOUS pass and isn't mentioned
 * either way in this correction's Records list. Kept rather than dropped: the correction's own
 * instructions are "preserve all existing functionality... unless a change is explicitly
 * requested," and removing its only nav entry was never asked for. Worth confirming with her.
 */
const RECORDS_MENU = [
  { href: "/leave", page: "leave" as PageKey, description: "Leave records & balance", icon: Clock },
  { href: "/rto", page: "rto" as PageKey, description: "Return-to-office records", icon: Building },
  { href: "/projects", page: "projects" as PageKey, description: "Project tracking", icon: FolderKanban },
  { href: "/incident-logs", page: "incidents" as PageKey, description: "Operational incidents & history", icon: Siren },
  { href: "/monitoring", page: "monitoring" as PageKey, description: "Account creation & ticket monitoring", icon: Radar },
] as const;

/** A tiny, restrained Gaby-mode accent — invisible in Light/Dark (see .gaby-sparkle in
 * globals.css), shown only next to the currently active destination, never on every item. */
function GabySparkle() {
  return (
    <span aria-hidden="true" className="gaby-sparkle">
      ✦
    </span>
  );
}

function RecordsMenuItem({
  item,
  pathname,
}: {
  item: (typeof RECORDS_MENU)[number];
  pathname: string;
}) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  const name = PAGE_NAMES[item.page].nav;
  return (
    <Link
      href={item.href}
      role="menuitem"
      aria-current={active ? "page" : undefined}
      className={cn("dropdown-item-rich", active && "dropdown-item-active")}
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium">
          <Copy serious={name.serious} playful={name.playful} />
        </span>
        <span className="block text-xs text-neutral-400 font-normal">{item.description}</span>
      </span>
      {active && <Check className="w-4 h-4 shrink-0 mt-0.5" />}
    </Link>
  );
}

/** The Teams popover's own "Capacity" row — org-level capacity, nested here per her correction
 * (it is no longer a top-level pill). Icon added to match Records' rows, at her request. */
function TeamsCapacityItem({ pathname }: { pathname: string }) {
  const active = pathname === "/capacity" || pathname.includes("/capacity");
  return (
    <Link
      href="/capacity"
      role="menuitem"
      aria-current={active ? "page" : undefined}
      className={cn("dropdown-item-rich", active && "dropdown-item-active")}
    >
      <Gauge className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium">
          <Copy serious={PAGE_NAMES.capacity.nav.serious} playful={PAGE_NAMES.capacity.nav.playful} />
        </span>
        <span className="block text-xs text-neutral-400 font-normal">Team capacity &amp; workload health</span>
      </span>
      {active && <Check className="w-4 h-4 shrink-0 mt-0.5" />}
    </Link>
  );
}

/** A placeholder row — not a link, nothing to navigate to yet. Rendered inert (no hover state, no
 * href) rather than pointing somewhere fake. Icon added to match Records'/Capacity's rows. */
function IndividualStatsItem() {
  return (
    <div role="menuitem" aria-disabled="true" className="flex items-start gap-3 px-3 py-2.5 rounded-xl opacity-50 cursor-not-allowed select-none">
      <User className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-neutral-600">
          <Copy serious="Individual Stats" playful="Crew Pulse" />
        </span>
        <span className="block text-xs text-neutral-400 font-normal">Coming soon</span>
      </span>
    </div>
  );
}

export function TopNav({ teamTabs = [] as { key: string; label: string }[] }) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const [teamsOpen, setTeamsOpen] = useState(false);
  const teamsRef = useRef<HTMLDivElement>(null);
  const teamsButtonRef = useRef<HTMLButtonElement>(null);

  const [recordsOpen, setRecordsOpen] = useState(false);
  const recordsRef = useRef<HTMLDivElement>(null);
  const recordsButtonRef = useRef<HTMLButtonElement>(null);

  // Mobile/tablet nav: the pill bar is desktop-only (see the xl:flex below). Below `xl` this
  // drawer takes over instead of trying to squeeze or scroll the pill bar.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Teams/Records are expandable SECTIONS on mobile, matching the desktop IA.
  const [mobileTeamsOpen, setMobileTeamsOpen] = useState(false);
  const [mobileRecordsOpen, setMobileRecordsOpen] = useState(false);

  // Easter egg #1: the logo. Counts clicks and pays out on the 5th, then resets. Deliberately
  // attached to a decorative element that does nothing else, so there's no workflow to disrupt.
  const logoClicks = useRef(0);

  const teamMenu = teamTabs.map((t) => ({ label: t.label, playful: t.label, key: t.key, href: `/${t.key}` }));
  const teamKeys = teamTabs.map((t) => t.key);

  // Capacity now lives INSIDE Teams (corrected 2026-09-10), so /capacity and /{team}/capacity
  // both count toward Teams being active, same as any other /{team}/... route.
  function isTeamRoute(key: string, p: string): boolean {
    return p === `/${key}` || p.startsWith(`/${key}/`);
  }
  const isCapacityActive = pathname === "/capacity" || pathname.includes("/capacity");
  const isTeamsActive = teamKeys.some((k) => isTeamRoute(k, pathname)) || isCapacityActive;
  const isRecordsActive = RECORDS_MENU.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const isMyWorkActive = pathname === PRIMARY_NAV.href;
  const isReferencesActive = pathname === REFERENCES_NAV.href || pathname.startsWith("/references/");

  // Close on outside click, on Escape (returning focus to whichever trigger was open), and on
  // navigation.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (teamsRef.current && !teamsRef.current.contains(e.target as Node)) setTeamsOpen(false);
      if (recordsRef.current && !recordsRef.current.contains(e.target as Node)) setRecordsOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (teamsOpen) {
        setTeamsOpen(false);
        teamsButtonRef.current?.focus();
      }
      if (recordsOpen) {
        setRecordsOpen(false);
        recordsButtonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [teamsOpen, recordsOpen]);

  useEffect(() => {
    setTeamsOpen(false);
    setRecordsOpen(false);
    setMobileMenuOpen(false);
    setMobileTeamsOpen(false);
    setMobileRecordsOpen(false);
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
            <button
              onClick={() => setMobileMenuOpen((o) => !o)}
              className="xl:hidden flex items-center justify-center w-8 h-8 rounded-lg text-neutral-500 hover:text-sprout-700 hover:bg-sprout-50 transition-colors"
              aria-label="Toggle navigation menu"
              aria-haspopup="menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
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

      {/* Mobile/tablet drawer — takes over below `xl` (see the hamburger in the header above).
          Mirrors the desktop IA 1:1: My Work, Teams (expandable: Team Stats pills + Capacity +
          Individual Stats), Records (expandable), References. */}
      {mobileMenuOpen && (
        <div className="xl:hidden border-b border-line/70 bg-surface/95 backdrop-blur-xl">
          <nav role="menu" className="max-w-7xl mx-auto px-6 py-3 flex flex-col gap-0.5">
            <Link
              href={PRIMARY_NAV.href}
              role="menuitem"
              aria-current={isMyWorkActive ? "page" : undefined}
              className={cn("dropdown-item", isMyWorkActive && "dropdown-item-active")}
            >
              <span>
                <Copy serious={PAGE_NAMES[PRIMARY_NAV.page].nav.serious} playful={PAGE_NAMES[PRIMARY_NAV.page].nav.playful} />
              </span>
              {isMyWorkActive && <Check className="w-4 h-4 shrink-0" />}
            </Link>

            <button
              onClick={() => setMobileTeamsOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={mobileTeamsOpen}
              className={cn("dropdown-item w-full", isTeamsActive && "dropdown-item-active")}
            >
              <span>
                <Copy serious={PAGE_NAMES.teams.nav.serious} playful={PAGE_NAMES.teams.nav.playful} />
              </span>
              <ChevronDown className={cn("w-4 h-4 shrink-0 transition-transform duration-200", mobileTeamsOpen && "rotate-180")} />
            </button>
            {mobileTeamsOpen && (
              <div className="pl-1 pb-2 pt-1 flex flex-col gap-1.5">
                <p className="px-2 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Team Stats</p>
                <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
                  {teamMenu.length === 0 && (
                    <p className="text-xs text-neutral-400 italic">No teams loaded — try Refresh Data.</p>
                  )}
                  {teamMenu.map((item) => {
                    const selected = isTeamRoute(item.key, pathname);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        aria-current={selected ? "page" : undefined}
                        className={cn("team-pill", selected && "team-pill-active")}
                      >
                        <Copy serious={item.label} playful={item.playful} />
                      </Link>
                    );
                  })}
                </div>
                <div className="h-px bg-line/70 mx-2" />
                <TeamsCapacityItem pathname={pathname} />
                <IndividualStatsItem />
              </div>
            )}

            <button
              onClick={() => setMobileRecordsOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={mobileRecordsOpen}
              className={cn("dropdown-item w-full", isRecordsActive && "dropdown-item-active")}
            >
              <span>
                <Copy serious={PAGE_NAMES.records.nav.serious} playful={PAGE_NAMES.records.nav.playful} />
              </span>
              <ChevronDown className={cn("w-4 h-4 shrink-0 transition-transform duration-200", mobileRecordsOpen && "rotate-180")} />
            </button>
            {mobileRecordsOpen && (
              <div className="pl-1 pb-1 flex flex-col gap-0.5">
                {RECORDS_MENU.map((item) => (
                  <RecordsMenuItem key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            )}

            <Link
              href={REFERENCES_NAV.href}
              role="menuitem"
              aria-current={isReferencesActive ? "page" : undefined}
              className={cn("dropdown-item", isReferencesActive && "dropdown-item-active")}
            >
              <span>
                <Copy serious={PAGE_NAMES[REFERENCES_NAV.page].nav.serious} playful={PAGE_NAMES[REFERENCES_NAV.page].nav.playful} />
              </span>
              {isReferencesActive && <Check className="w-4 h-4 shrink-0" />}
            </Link>
          </nav>
        </div>
      )}

      {/* Floating pill nav — lives outside the header, centered, straddling the boundary.
          FOUR interactive elements only: My Work, Teams, Records, References — corrected
          2026-09-10 to pull Capacity and Incident Logs back off the top level and into Teams/
          Records respectively. Desktop-only (`xl:flex`) — below that the header's hamburger
          drawer takes over instead of squeezing or scrolling this bar (the Teams/Records
          popovers inside it can't tolerate an overflow-x container, see the note below). */}
      <div className="relative z-30 -mt-5 hidden xl:flex justify-center px-6 pointer-events-none">
        {/* No overflow-x here, deliberately: the Teams/Records popovers are absolutely positioned
            INSIDE this nav, and a scroll container would clip them shut. Narrow windows overflow
            the bar horizontally, which they did before this too. */}
        <nav className="pill-nav pointer-events-auto">
          <Link
            href={PRIMARY_NAV.href}
            aria-current={isMyWorkActive ? "page" : undefined}
            className={cn("pill", isMyWorkActive && "pill-active")}
          >
            <Copy serious={PAGE_NAMES[PRIMARY_NAV.page].nav.serious} playful={PAGE_NAMES[PRIMARY_NAV.page].nav.playful} />
            {isMyWorkActive && <GabySparkle />}
          </Link>

          <div className="relative" ref={teamsRef}>
            <button
              ref={teamsButtonRef}
              onClick={() => setTeamsOpen((o) => !o)}
              className={cn("pill", isTeamsActive && "pill-active")}
              aria-haspopup="menu"
              aria-expanded={teamsOpen}
            >
              <Copy serious={PAGE_NAMES.teams.nav.serious} playful={PAGE_NAMES.teams.nav.playful} />
              {isTeamsActive && <GabySparkle />}
              <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", teamsOpen && "rotate-180")} />
            </button>
            {teamsOpen && (
              <div role="menu" className="dropdown-menu dropdown-menu-lg">
                <p className="px-2.5 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  <Copy serious="Team Stats" playful="Team Stats" />
                </p>
                <div className="flex gap-1.5 px-1 pb-2 flex-wrap">
                  {teamMenu.length === 0 && (
                    <p className="px-1.5 text-xs text-neutral-400 italic">No teams loaded — try Refresh Data.</p>
                  )}
                  {teamMenu.map((item) => {
                    const selected = isTeamRoute(item.key, pathname);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        aria-current={selected ? "page" : undefined}
                        className={cn("team-pill", selected && "team-pill-active")}
                      >
                        <Copy serious={item.label} playful={item.playful} />
                      </Link>
                    );
                  })}
                </div>
                <div className="h-px bg-line/70 mx-1.5 mb-1.5" />
                <TeamsCapacityItem pathname={pathname} />
                <IndividualStatsItem />
              </div>
            )}
          </div>

          <div className="relative" ref={recordsRef}>
            <button
              ref={recordsButtonRef}
              onClick={() => setRecordsOpen((o) => !o)}
              className={cn("pill", isRecordsActive && "pill-active")}
              aria-haspopup="menu"
              aria-expanded={recordsOpen}
            >
              <Copy serious={PAGE_NAMES.records.nav.serious} playful={PAGE_NAMES.records.nav.playful} />
              {isRecordsActive && <GabySparkle />}
              <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", recordsOpen && "rotate-180")} />
            </button>
            {recordsOpen && (
              <div role="menu" className="dropdown-menu dropdown-menu-lg">
                <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  <Copy serious="Records" playful="Records" />
                </p>
                {RECORDS_MENU.map((item) => (
                  <RecordsMenuItem key={item.href} item={item} pathname={pathname} />
                ))}
              </div>
            )}
          </div>

          <Link
            href={REFERENCES_NAV.href}
            aria-current={isReferencesActive ? "page" : undefined}
            className={cn("pill", isReferencesActive && "pill-active")}
          >
            <Copy serious={PAGE_NAMES[REFERENCES_NAV.page].nav.serious} playful={PAGE_NAMES[REFERENCES_NAV.page].nav.playful} />
            {isReferencesActive && <GabySparkle />}
          </Link>
        </nav>
      </div>
    </>
  );
}
