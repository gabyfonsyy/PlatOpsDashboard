"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { RefreshDataButton } from "@/components/layout/RefreshDataButton";

const NAV_ITEMS = [
  { href: "/leave", label: "Leave" },
  { href: "/rto", label: "RTO" },
  { href: "/projects", label: "Projects" },
  { href: "/incident-logs", label: "Incident Logs" },
  { href: "/monitoring", label: "Ticket Monitoring" },
];

export function TopNav({ teamTabs = [] as { key: string; label: string }[] }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [teamsOpen, setTeamsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Teams menu = the cross-team Overview plus one entry per configured team.
  const teamMenu = [
    { label: "Overview", href: "/" },
    ...teamTabs.map((t) => ({ label: t.label, href: `/${t.key}` })),
  ];

  // Highlight the Teams pill on the overview or any team route (incl. /<team>/performance).
  const teamKeys = teamTabs.map((t) => t.key);
  const isTeamsActive =
    pathname === "/" || teamKeys.some((k) => pathname === `/${k}` || pathname.startsWith(`/${k}/`));

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
      <header className="sticky top-0 z-20 bg-white/70 backdrop-blur-xl border-b border-neutral-200/60">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sprout-400 to-sprout-600 shadow-glow flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
                <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 7h7v7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="font-serif font-medium text-neutral-900 text-sm hidden sm:inline">Platform Ops</span>
          </div>

          <div className="flex items-center gap-4 shrink-0">
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

      {/* Floating pill nav — lives outside the header, centered, straddling the boundary */}
      <div className="relative z-30 -mt-5 flex justify-center px-6 pointer-events-none">
        <nav className="pill-nav pointer-events-auto">
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setTeamsOpen((o) => !o)}
              className={cn("pill", isTeamsActive && "pill-active")}
              aria-haspopup="menu"
              aria-expanded={teamsOpen}
            >
              Teams
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
                      <span>{item.label}</span>
                      {active && <Check className="w-4 h-4 shrink-0" />}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} className={cn("pill", active && "pill-active")}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
