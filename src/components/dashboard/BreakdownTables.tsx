import type { CountRow, ComboRow, BreakdownTicket } from "@/lib/ticket-breakdowns";
import { formatNumber, formatPercent, formatMinutesDecimalValue, formatDurationBreakdown, formatManilaDate } from "@/lib/format";

/**
 * Count-ranked breakdown — the counting counterpart to LeadCycleTimeRankTable, which ranks by
 * duration. Rows arrive already sorted descending by the report.
 *
 * `share` is optional per row because not every table has a meaningful denominator: the on-hold
 * reason table counts hold CYCLES against a population of TICKETS, so a percentage there would
 * divide two different things (see byReason in lib/ticket-breakdowns.ts).
 */
export function CountRankTable({
  title,
  keyLabel,
  rows,
  countLabel = "Tickets",
  emptyMessage = "Nothing in this period.",
}: {
  title: string;
  keyLabel: string;
  rows: CountRow[];
  countLabel?: string;
  emptyMessage?: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">{keyLabel}</th>
            <th className="px-4 py-3 text-right">{countLabel}</th>
            <th className="px-4 py-3 text-right w-24">Share</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-neutral-400">{emptyMessage}</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key}>
                <td className="px-4 py-2.5 text-neutral-900">
                  {r.key}
                  {/* Proportional bar: the ranking is the point, and a bar reads faster than
                      comparing numbers down a column. Width is relative to the top row, not to
                      the total, so short tails stay visible. */}
                  <span className="block mt-1 h-1 rounded-full bg-sprout-100 overflow-hidden">
                    <span
                      className="block h-full bg-sprout-500"
                      style={{ width: max ? `${Math.max(2, (r.count / max) * 100)}%` : "0%" }}
                    />
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap align-top">{formatNumber(r.count)}</td>
                <td className="px-4 py-2.5 text-right text-neutral-400 tabular-nums whitespace-nowrap align-top">
                  {r.share === null ? "—" : formatPercent(r.share)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Product + Label pairings, ranked by how often the combination appears. */
export function ComboTable({ title, rows }: { title: string; rows: ComboRow[] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          Workflow labels (automation-done, ffup-1/2, autoclose-nonresponse, crf, jira_escalated,
          update-companypolicy, expedite) are excluded — they tag process, not subject matter.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Label</th>
            <th className="px-4 py-3 text-right">Tickets</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-neutral-400">
                No product/label pairings in this period.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`${r.product}-${r.label}`}>
                <td className="px-4 py-2.5 text-neutral-900 whitespace-nowrap">{r.product}</td>
                <td className="px-4 py-2.5">
                  <span className="inline-block text-xs bg-sprout-50 text-sprout-700 rounded px-1.5 py-0.5">{r.label}</span>
                  <span className="block mt-1 h-1 rounded-full bg-sprout-100 overflow-hidden">
                    <span
                      className="block h-full bg-sprout-500"
                      style={{ width: max ? `${Math.max(2, (r.count / max) * 100)}%` : "0%" }}
                    />
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap align-top">{formatNumber(r.count)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Ticket list shared by the escalation / FCR / on-hold drill-downs. `detailLabel` names whatever
 * the report put in `detail` (escalation targets, why a ticket counted as SE-resolved); passing
 * null drops the column entirely rather than rendering an empty one.
 */
export function BreakdownTicketsTable({
  title,
  tickets,
  assigneeLabel,
  detailLabel,
  showMinutes = false,
  jiraBaseUrl,
}: {
  title: string;
  tickets: BreakdownTicket[];
  assigneeLabel: string;
  detailLabel: string | null;
  showMinutes?: boolean;
  jiraBaseUrl?: string;
}) {
  const columns = 5 + (detailLabel ? 1 : 0) + (showMinutes ? 1 : 0);
  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Ticket</th>
            <th className="px-4 py-3">{assigneeLabel}</th>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Labels</th>
            {detailLabel && <th className="px-4 py-3">{detailLabel}</th>}
            {showMinutes && <th className="px-4 py-3">On Hold</th>}
            <th className="px-4 py-3">Resolved</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {tickets.length === 0 ? (
            <tr>
              <td colSpan={columns} className="px-4 py-6 text-center text-neutral-400">
                No tickets for this period.
              </td>
            </tr>
          ) : (
            tickets.map((t) => (
              <tr key={t.issueKey}>
                <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">
                  {jiraBaseUrl ? (
                    <a
                      href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issueKey}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sprout-700 hover:underline"
                    >
                      {t.issueKey}
                    </a>
                  ) : (
                    t.issueKey
                  )}
                  {t.issueType && <span className="block text-xs text-neutral-400 font-normal">{t.issueType}</span>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{t.assignee}</td>
                <td className="px-4 py-3 whitespace-nowrap">{t.product}</td>
                <td className="px-4 py-3 text-xs text-neutral-500">{t.labels || "—"}</td>
                {detailLabel && <td className="px-4 py-3 whitespace-nowrap">{t.detail || "—"}</td>}
                {showMinutes && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    {t.minutes === null ? "—" : formatMinutesDecimalValue(t.minutes)}{" "}
                    {t.minutes !== null && (
                      <span className="text-neutral-400">({formatDurationBreakdown(t.minutes)})</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.resolvedAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
