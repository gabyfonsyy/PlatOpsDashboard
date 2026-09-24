import { cn } from "@/lib/utils";

/** The thin fill bar used throughout Records — pulled out of `ProjectsTable`/`ProjectDrilldownPanel`
 * so the same markup isn't hand-rolled in every new compact component. */
export function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden", className)}>
      <div className="h-full rounded-full bg-sprout-500" style={{ width: `${clamped}%` }} />
    </div>
  );
}
