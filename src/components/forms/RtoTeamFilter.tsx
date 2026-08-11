"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Standalone team filter driving the quick-stat cards + records table below — a client
 * component (not a native GET form) so changing it merges into the existing URL params
 * instead of wiping out the attendance grid's own team/date picks. useTransition gives instant
 * pending feedback on select — see FilterBar.tsx for why that matters given GAS's own latency. */
export function RtoTeamFilter({
  teamOptions,
  team,
}: {
  teamOptions: { value: string; label: string }[];
  team: string;
}) {
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

  return (
    <div className={cn("flex items-center gap-2 transition-opacity", isPending && "opacity-60")}>
      <label className="form-label !mb-0">Team</label>
      <select
        value={team}
        onChange={(e) => onChange(e.target.value)}
        disabled={isPending}
        className="form-input w-auto disabled:cursor-wait"
      >
        <option value="">All Teams</option>
        {teamOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400" />}
    </div>
  );
}
