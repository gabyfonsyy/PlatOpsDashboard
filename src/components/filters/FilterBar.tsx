"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { RangeType, defaultPeriodForRange, formatPeriodLabel, shiftPeriod } from "@/lib/date-ranges";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS: { value: RangeType; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

export function FilterBar({ issueTypes = [] as string[] }: { issueTypes?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const range = (searchParams.get("range") as RangeType) || "month";
  const period = searchParams.get("period") || defaultPeriodForRange(range);
  const issueType = searchParams.get("issueType") || "";

  function updateParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => updateParams({ range: opt.value, period: defaultPeriodForRange(opt.value) })}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              range === opt.value ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => updateParams({ period: shiftPeriod(range, period, -1) })}
          className="btn-ghost p-1.5"
          aria-label="Previous period"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-neutral-700 min-w-[9rem] text-center">
          {formatPeriodLabel(range, period)}
        </span>
        <button
          onClick={() => updateParams({ period: shiftPeriod(range, period, 1) })}
          className="btn-ghost p-1.5"
          aria-label="Next period"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {issueTypes.length > 0 && (
        <select
          value={issueType}
          onChange={(e) => updateParams({ issueType: e.target.value || undefined })}
          className="form-input w-auto text-sm py-1.5"
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
