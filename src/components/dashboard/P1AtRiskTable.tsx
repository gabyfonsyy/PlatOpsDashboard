import type { P1AtRiskTicket } from "@/lib/p1-sla";
import { STATUS_LABEL, STATUS_TONE, type RiskTier } from "@/lib/sla-status";
import { Badge } from "@/components/ui/Badge";
import { formatManilaDate, formatPercent } from "@/lib/format";

const RISK_ORDER: RiskTier[] = ["critical", "atRisk", "watch", "healthy"];

/**
 * Open P1s not yet past due, ranked by how much of their own SLA window is already gone —
 * "what needs attention before it breaches", the ACTION section of the page. A ticket already
 * past due is a MISS already counted in the overdue set (see P1TicketsTable), not here.
 */
export function P1AtRiskTable({ tickets, assigneeLabel, jiraBaseUrl }: { tickets: P1AtRiskTicket[]; assigneeLabel: string; jiraBaseUrl?: string }) {
  const sorted = tickets.slice().sort((a, b) => RISK_ORDER.indexOf(a.riskTier) - RISK_ORDER.indexOf(b.riskTier) || b.consumedFraction - a.consumedFraction);

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h3 className="text-sm font-semibold text-neutral-900">P1s at Risk</h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          Open, not yet past due — ranked by how much of their own SLA window is already elapsed.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
            <th className="px-4 py-3">Ticket</th>
            <th className="px-4 py-3">{assigneeLabel}</th>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Due</th>
            <th className="px-4 py-3 text-right">Days Left</th>
            <th className="px-4 py-3 w-40">SLA Window Used</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">
                No open P1s currently within their SLA window — nothing at risk right now.
              </td>
            </tr>
          ) : (
            sorted.map((t) => {
              const tone = STATUS_TONE[t.riskTier];
              return (
                <tr key={t.issueKey}>
                  <td className="px-4 py-3 font-medium text-neutral-900 whitespace-nowrap">
                    {jiraBaseUrl ? (
                      <a href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${t.issueKey}`} target="_blank" rel="noreferrer" className="text-sprout-700 hover:underline">
                        {t.issueKey}
                      </a>
                    ) : (
                      t.issueKey
                    )}
                    <span className="block text-xs text-neutral-400 font-normal">{t.issueType}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{t.assignee}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{t.product}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatManilaDate(t.dueDate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                    {t.daysRemaining}d
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="block h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.min(100, Math.max(2, t.consumedFraction * 100))}%`,
                            backgroundColor: `rgb(var(${tone === "success" ? "--ok-500" : tone === "warning" ? "--warn-500" : "--danger-500"}))`,
                          }}
                        />
                      </span>
                      <span className="text-xs text-neutral-400 tabular-nums whitespace-nowrap">{formatPercent(t.consumedFraction, 0)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={tone}>{STATUS_LABEL[t.riskTier]}</Badge>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
