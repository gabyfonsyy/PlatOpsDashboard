"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * "All SE Work | Backend Changes | Investigations" — re-scopes the ENTIRE Cycle Time deep-dive
 * server-side via the `workCategory` URL param (same push/useTransition pattern as FilterBar),
 * not a client-side filter over already-fetched data. Selecting a category changes trend,
 * distribution, breakdowns and longest-work, not just the ticket table — see
 * getCycleTimeDeepDive's `workCategory` parameter.
 *
 * Only rendered for a peer-review team (SE) — the category split doesn't exist for DBA/DevOps.
 */
export function CycleTimeWorkCategoryToggle({
  active,
  labels,
}: {
  active: "all" | "backend" | "investigations";
  labels: { all: string; backend: string; investigations: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const select = (value: "all" | "backend" | "investigations") => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("workCategory");
    else params.set("workCategory", value);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  const options: { key: "all" | "backend" | "investigations"; label: string }[] = [
    { key: "all", label: labels.all },
    { key: "backend", label: labels.backend },
    { key: "investigations", label: labels.investigations },
  ];

  return (
    <div className={cn("flex items-center gap-1 bg-neutral-100 rounded-lg p-1 w-fit transition-opacity", isPending && "opacity-60")}>
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => select(opt.key)}
          disabled={isPending}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-wait whitespace-nowrap",
            active === opt.key ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
