"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { RangeType, defaultPeriodForRange, formatPeriodLabel, shiftPeriod } from "@/lib/date-ranges";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS: { value: RangeType; label: string }[] = [
  { value: "year", label: "Year" },
  { value: "quarter", label: "Quarter" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
];

/**
 * useTransition wraps the navigation so `isPending` flips true THE INSTANT a filter is clicked —
 * not once the new data actually arrives. The GAS backend can take anywhere from ~2s to 40s+
 * depending on Apps Script's own load (see gas/README.md troubleshooting notes); without this,
 * clicking a filter gave zero feedback until that entire round-trip finished, which reads as "the
 * page didn't react" even though it's actually just slow. Buttons stay disabled and dim while
 * pending so it's clear a change registered and is in flight, not that nothing happened.
 */
export function FilterBar({ issueTypes = [] as string[] }: { issueTypes?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const range = (searchParams.get("range") as RangeType) || "month";
  const period = searchParams.get("period") || defaultPeriodForRange(range);
  const issueType = searchParams.get("issueType") || "";

  function updateParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-3 transition-opacity", isPending && "opacity-60")}>
      <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => updateParams({ range: opt.value, period: defaultPeriodForRange(opt.value) })}
            disabled={isPending}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-wait",
              range === opt.value ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => updateParams({ period: shiftPeriod(range, period, -1) })}
          disabled={isPending}
          className="btn-ghost p-1.5 disabled:cursor-wait"
          aria-label="Previous period"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-neutral-700 min-w-[9rem] text-center inline-flex items-center justify-center gap-1.5">
          {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400" />}
          {formatPeriodLabel(range, period)}
        </span>
        <button
          onClick={() => updateParams({ period: shiftPeriod(range, period, 1) })}
          disabled={isPending}
          className="btn-ghost p-1.5 disabled:cursor-wait"
          aria-label="Next period"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {issueTypes.length > 0 && (
        <select
          value={issueType}
          onChange={(e) => updateParams({ issueType: e.target.value || undefined })}
          disabled={isPending}
          className="form-input w-auto text-sm py-1.5 disabled:cursor-wait"
        >
          <option value="">All issue types</option>
          {issueTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      )}
    </div>
  );
}
