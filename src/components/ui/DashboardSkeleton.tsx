import { Copy } from "@/components/ui/Copy";

/** Shown via loading.tsx while server components re-fetch metrics from the GAS backend. */
export function DashboardSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" role="status">
        <Copy serious="Loading dashboard data…" playful="Checking if production is behaving…" />
      </p>
      <div className="flex flex-col gap-6 animate-pulse">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="space-y-2">
          <div className="h-7 w-48 bg-neutral-200 rounded" />
          <div className="h-4 w-64 bg-neutral-100 rounded" />
        </div>
        <div className="h-9 w-72 bg-neutral-100 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="card p-5 space-y-3">
            <div className="h-3 w-20 bg-neutral-100 rounded" />
            <div className="h-6 w-24 bg-neutral-200 rounded" />
          </div>
        ))}
      </div>

      <div className="card p-5 h-64">
        <div className="h-4 w-32 bg-neutral-100 rounded mb-4" />
        <div className="h-full w-full bg-neutral-50 rounded" />
      </div>
      </div>
    </div>
  );
}
