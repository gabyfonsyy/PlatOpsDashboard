"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { OVERVIEW_VIEWS, VIEW_COOKIE, VIEW_COPY, type OverviewView } from "@/lib/overview-view";
import { cn } from "@/lib/utils";

/**
 * Professional / Gaby View.
 *
 * Writes the choice to a cookie and then navigates with the param, rather than doing either alone:
 * the param is what the SERVER reads to pick which briefing to fetch, and the cookie is what makes
 * the choice survive to the next visit. Without the param the first paint would show the wrong
 * register and snap; without the cookie the page would revert to Professional every morning.
 *
 * A year of expiry because it is a display preference, and one that is annoying to keep re-setting.
 */
export function ViewToggle({ view }: { view: OverviewView }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function choose(next: OverviewView) {
    if (next === view) return;
    document.cookie = `${VIEW_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => {
      router.push(`${pathname}?view=${next}`);
      // The briefing is read on the server, so the new register only arrives with fresh RSC data.
      router.refresh();
    });
  }

  return (
    <div className={cn("pill-nav", pending && "opacity-60")} role="group" aria-label="Overview mode">
      {OVERVIEW_VIEWS.map((v) => (
        <button
          key={v}
          onClick={() => choose(v)}
          className={cn("pill", v === view && "pill-active")}
          aria-pressed={v === view}
        >
          {VIEW_COPY[v].label}
        </button>
      ))}
    </div>
  );
}
