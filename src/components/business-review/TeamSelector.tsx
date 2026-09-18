"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ReviewTeamLabel } from "@/lib/business-review";

const TEAMS: ReviewTeamLabel[] = ["SE", "DBA", "DevOps"];

/**
 * SE / DBA / DevOps switch. Each team gets its own metric set (7 for SE, 4 for DBA/DevOps — see
 * lib/business-review.ts) — this is a hard switch between reports, not a filter on one shared set.
 * Switching team never carries the mode/period navigation state incorrectly: `period` is dropped
 * on team change since a period's own checklist/talking points are scoped to (team, mode, period)
 * together (see lib/review-periods.ts's periodKey) and a stale `period` param would otherwise be
 * silently re-applied to the new team's data.
 */
export function TeamSelector({ team }: { team: ReviewTeamLabel }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function selectTeam(next: ReviewTeamLabel) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("team", next);
    params.delete("period");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className={cn("flex items-center gap-1 bg-neutral-100 rounded-lg p-1", isPending && "opacity-60")}>
      {TEAMS.map((t) => (
        <button
          key={t}
          onClick={() => selectTeam(t)}
          disabled={isPending}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-wait",
            team === t ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
