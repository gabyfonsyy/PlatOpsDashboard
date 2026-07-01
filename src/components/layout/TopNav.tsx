"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import Image from "next/image";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/leave", label: "Leave" },
  { href: "/rto", label: "RTO" },
  { href: "/projects", label: "Projects" },
];

export function TopNav({ teamTabs = [] as { key: string; label: string }[] }) {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <header className="bg-white border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-sprout-500 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
              <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 7h7v7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="font-semibold text-neutral-900 text-sm hidden sm:inline">Platform Ops</span>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto">
          {teamTabs.map((t) => (
            <Link key={t.key} href={`/${t.key}`} className={cn("tab", pathname === `/${t.key}` && "tab-active")}>
              {t.label}
            </Link>
          ))}
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className={cn("tab", pathname === item.href && "tab-active")}>
              {item.label}
            </Link>
          ))}
        </nav>

        {session?.user && (
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="flex items-center gap-2 shrink-0">
            {session.user.image ? (
              <Image src={session.user.image} alt="" width={28} height={28} className="rounded-full" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-sprout-100 flex items-center justify-center text-sprout-700 text-xs font-semibold">
                {session.user.name?.[0] ?? "?"}
              </div>
            )}
          </button>
        )}
      </div>
    </header>
  );
}
