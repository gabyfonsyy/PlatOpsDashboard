"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { TeamConfig } from "@/lib/teams";
import { teamLabel, cn } from "@/lib/utils";

/**
 * Segmented team switch for the portfolio view — same URL-merge mechanism as RtoTeamFilter
 * (a client component so this merges into the existing URL params rather than replacing them),
 * styled as pills rather than a select since there are only ever a handful of teams and which one
 * is active should be legible without opening a dropdown.
 */
export function TeamPills({ teams, team }: { teams: TeamConfig[]; team: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("team", value);
    else params.delete("team");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  const options = [{ team_key: "", team_name: "All Teams" }, ...teams];

  return (
    <div
      role="group"
      aria-label="Team"
      className={cn(
        "inline-flex items-center gap-1 rounded-lg p-0.5 bg-neutral-100/70 w-fit transition-opacity",
        isPending && "opacity-60"
      )}
    >
      {options.map((t) => (
        <button
          key={t.team_key || "all"}
          type="button"
          onClick={() => onChange(t.team_key)}
          disabled={isPending}
          aria-pressed={team === t.team_key}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:cursor-wait",
            team === t.team_key
              ? "bg-surface-raised text-neutral-900 shadow-sm"
              : "text-neutral-500 hover:text-neutral-800"
          )}
        >
          {t.team_key ? teamLabel(t.team_name) : t.team_name}
        </button>
      ))}
      {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400 mx-1" />}
    </div>
  );
}
