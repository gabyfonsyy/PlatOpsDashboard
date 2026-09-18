"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { shiftReviewPeriod, type ReviewMode } from "@/lib/review-periods";

const MODES: { value: ReviewMode; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
];

/**
 * Weekly/Monthly/Quarterly switch + <- Previous / Next -> navigation. `periodStart` is the CURRENT
 * period's own start date (a Monday / month-1st / quarter-1st, per lib/review-periods.ts) — the
 * one value that fully identifies where we are, so shifting just needs shiftReviewPeriod and a URL
 * push, no re-derivation from "today".
 */
export function ReviewModeSelector({
  mode,
  periodStart,
  currentLabel,
}: {
  mode: ReviewMode;
  periodStart: string;
  currentLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function push(nextMode: ReviewMode, nextPeriod?: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", nextMode);
    if (nextPeriod) params.set("period", nextPeriod);
    else params.delete("period");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-3", isPending && "opacity-60")}>
      <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => push(m.value)}
            disabled={isPending}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-wait",
              mode === m.value ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => push(mode, shiftReviewPeriod(mode, periodStart, -1).current.start)}
          disabled={isPending}
          className="btn-ghost p-1.5 disabled:cursor-wait"
          aria-label="Previous period"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-neutral-700 min-w-[12rem] text-center inline-flex items-center justify-center gap-1.5">
          {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400" />}
          {currentLabel}
        </span>
        <button
          onClick={() => push(mode, shiftReviewPeriod(mode, periodStart, 1).current.start)}
          disabled={isPending}
          className="btn-ghost p-1.5 disabled:cursor-wait"
          aria-label="Next period"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
