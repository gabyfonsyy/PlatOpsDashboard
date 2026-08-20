"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { INCIDENT_ISSUE_GROUPS, INCIDENT_MONTHS, INCIDENT_PERIODS } from "@/lib/incidents";

/**
 * Team tabs plus a year/month pair, rather than reusing FilterBar: incident logs are read per
 * team and per evaluation period (a month, or a whole year for an annual review), so week and
 * quarter would be noise here, and the team is a first-class axis rather than a route segment
 * the way it is on the metrics dashboards.
 *
 * Same useTransition treatment as FilterBar for the same reason — the GAS round-trip behind this
 * page can take seconds, and without pending feedback a click reads as "nothing happened".
 */
export function IncidentFilters({
  teams,
  availableYears,
  team,
  year,
  period,
  group,
  issueGroups,
  showIssueGroups,
  member,
  availableMembers,
}: {
  teams: { key: string; label: string }[];
  availableYears: string[];
  /** "" means all teams. */
  team: string;
  year: string;
  /** "" = full year, "Q1".."Q4" = quarter, "01".."12" = month. */
  period: string;
  /** "" means all issue-type groups. */
  group: string;
  issueGroups: string[];
  /** Hidden for teams that file a single issue type (DBA/DevOps). */
  showIssueGroups: boolean;
  /** "" means everyone. Filters on who the incident log is against. */
  member: string;
  availableMembers: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function updateParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  // A year the sheet has no rows for yet (e.g. the current year on a fresh install) still has to
  // be selectable, or the filter can't show "this year, nothing logged".
  const years = availableYears.includes(year) ? availableYears : [year, ...availableYears];

  return (
    <div className={cn("flex flex-wrap items-center gap-3 transition-opacity", isPending && "opacity-60")}>
      <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
        <button
          onClick={() => updateParams({ team: undefined })}
          disabled={isPending}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-wait",
            !team ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
          )}
        >
          All teams
        </button>
        {teams.map((t) => (
          <button
            key={t.key}
            onClick={() => updateParams({ team: t.key })}
            disabled={isPending}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-wait",
              team === t.key ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <select
        value={year}
        onChange={(e) => updateParams({ year: e.target.value })}
        disabled={isPending}
        className="form-input w-auto text-sm py-1.5 disabled:cursor-wait"
        aria-label="Year"
      >
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>

      {/* One period control, grouped so a quarter and a month can't both be chosen. */}
      <select
        value={period}
        onChange={(e) => updateParams({ period: e.target.value || undefined })}
        disabled={isPending}
        className="form-input w-auto text-sm py-1.5 disabled:cursor-wait"
        aria-label="Period"
      >
        {INCIDENT_PERIODS.map((p) => (
          <option key={p.value || "full"} value={p.value}>{p.label}</option>
        ))}
        <optgroup label="Month">
          {INCIDENT_MONTHS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </optgroup>
      </select>

      {showIssueGroups && (
        <select
          value={group}
          onChange={(e) => updateParams({ group: e.target.value || undefined })}
          disabled={isPending}
          className="form-input w-auto text-sm py-1.5 disabled:cursor-wait"
          aria-label="Issue type group"
        >
          <option value="">All issue types</option>
          {(issueGroups.length ? issueGroups : [...INCIDENT_ISSUE_GROUPS]).map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      )}

      {/* Only people who actually have a log in this window — a roster-wide list would be mostly
          options that return nothing. */}
      <select
        value={member}
        onChange={(e) => updateParams({ member: e.target.value || undefined })}
        disabled={isPending || availableMembers.length === 0}
        className="form-input w-auto text-sm py-1.5 disabled:cursor-wait"
        aria-label="Platform Ops member"
      >
        <option value="">
          {availableMembers.length ? "All members" : "No members with logs"}
        </option>
        {availableMembers.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>

      {isPending && <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />}
    </div>
  );
}
