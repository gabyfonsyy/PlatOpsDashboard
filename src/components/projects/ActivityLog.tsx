import { activityEventLabel, type ProjectActivityEntry } from "@/lib/project-tracking";
import { formatManilaDateTime } from "@/lib/format";
import { Copy } from "@/components/ui/Copy";

/** Newest-first, read-only — every entry was written by `logActivity` (project-tracking-store.ts)
 * from a tracked mutation site, never by anything client-side directly. */
export function ActivityLog({ entries }: { entries: ProjectActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        <Copy serious="No activity logged yet." playful="Quiet so far — nothing logged yet." />
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-2">
      {entries.map((e) => (
        <li key={e.id} className="text-sm flex items-start gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-300 mt-1.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-neutral-800">{e.summary}</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              {activityEventLabel(e.event_type)} · {e.actor_email} · {formatManilaDateTime(e.created_at)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
