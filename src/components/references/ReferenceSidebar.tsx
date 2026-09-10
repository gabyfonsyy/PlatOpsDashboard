"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type SidebarSection = { id: string; label: string };

/**
 * Sticky category table-of-contents for the References page. No IntersectionObserver/scroll-spy
 * precedent existed anywhere in this codebase (confirmed before building this) — built from
 * scratch, deliberately simple: one observer watching every section heading currently on the
 * page, picking whichever is nearest the top of the "active band" (just below the sticky app
 * header) as the active category. Clicking calls scrollIntoView — no URL/hash change, no reload.
 */
export function ReferenceSidebar({ sections }: { sections: SidebarSection[] }) {
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);

  useEffect(() => {
    if (sections.length === 0) return;
    const elements = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    // The "active band" is a thin strip just under the sticky header — a heading only counts as
    // intersecting while it's in that strip, which is what makes the active item track "which
    // section's heading just scrolled past the top" rather than "which section merely overlaps
    // the viewport at all" (the latter would light up 2-3 sidebar items at once on a tall page).
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        setActiveId(topMost.target.id);
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (sections.length === 0) return null;

  return (
    <nav aria-label="Reference categories" className="hidden lg:block sticky top-24 self-start w-56 shrink-0">
      <div className="reference-sidebar rounded-2xl border border-[rgb(var(--a-300)/0.3)] bg-surface/80 backdrop-blur-xl backdrop-saturate-150 shadow-glow p-3">
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">References</p>
        <ul className="flex flex-col gap-0.5">
          {sections.map((s) => {
            const active = s.id === activeId;
            return (
              <li key={s.id}>
                <button
                  onClick={() => scrollToSection(s.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "reference-sidebar-item w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors",
                    active
                      ? "reference-sidebar-item-active bg-sprout-50 text-sprout-700 font-medium"
                      : "text-neutral-500 hover:text-sprout-700 hover:bg-sprout-50/60"
                  )}
                >
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
