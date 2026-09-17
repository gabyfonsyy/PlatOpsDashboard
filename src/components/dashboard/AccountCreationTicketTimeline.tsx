import { Badge } from "@/components/ui/Badge";
import { formatManilaDateTime, formatDurationBreakdown } from "@/lib/format";
import { DELAY_AREA_META } from "@/lib/account-creation-view";
import type { CycleStage, CycleTimelineSummary, DelayAttribution } from "@/lib/account-creation-cycle";

function stageLabel(stage: CycleStage): string {
  if (stage.stage === "se_work") return stage.cycleNumber === 1 ? "SE Work" : `SE Rework Cycle ${stage.cycleNumber}`;
  return stage.cycleNumber === 1 ? "Peer Review" : `Review Cycle ${stage.cycleNumber}`;
}

function longestStageLabel(stage: CycleStage | null): string {
  return stage ? stageLabel(stage) : "—";
}

/**
 * Per-ticket SE-execution-vs-peer-review breakdown (Section 4) — rendered inline below an expanded
 * Ticket Receipts row, not a modal (see the mockup review: no read-only modal exists anywhere in
 * this app, only edit-form ones). The flow arrows only render for the common single-work/single-
 * review-cycle shape; a multi-cycle ticket (Section 11 rework) falls back to the stage table alone,
 * which already generalizes to any number of cycles via `stages`' own cycleNumber sequencing —
 * the raw timeline stays fully explainable either way, just without the simplified arrow diagram.
 */
export function AccountCreationTicketTimeline({
  stages,
  summary,
  delay,
}: {
  stages: CycleStage[];
  summary: CycleTimelineSummary;
  delay: DelayAttribution;
}) {
  const delayMeta = DELAY_AREA_META[delay.area];
  const showSimpleFlow = stages.length > 0 && stages.length <= 2;

  if (stages.length === 0) {
    return <p className="text-sm text-neutral-400 px-1 py-2">No SE-execution or peer-review history available for this ticket yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {showSimpleFlow && (
        <div className="flex items-center flex-wrap text-sm">
          {stages.map((stage, i) => (
            <div key={`${stage.stage}-${stage.cycleNumber}-flow`} className="flex items-center">
              {i > 0 && <span className="mx-3 text-neutral-300 text-lg">→</span>}
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-neutral-900">{i === 0 ? "In Progress" : stageLabel(stage)}</span>
                <span className="text-xs text-neutral-400">{formatManilaDateTime(stage.startedAt)}</span>
              </div>
              {i === stages.length - 1 && stage.endedAt && (
                <>
                  <span className="mx-3 text-neutral-300 text-lg">→</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-neutral-900">
                      {stage.stage === "peer_review" ? stage.exitedToStatus || "Exited" : "For Peer Review"}
                    </span>
                    <span className="text-xs text-neutral-400">{formatManilaDateTime(stage.endedAt)}</span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide border-b border-neutral-200">
            <th className="py-1.5 pr-3">Stage</th>
            <th className="py-1.5 pr-3">Owner</th>
            <th className="py-1.5 pr-3">Start</th>
            <th className="py-1.5 pr-3">End</th>
            <th className="py-1.5 text-right">Cycle Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {stages.map((stage) => (
            <tr key={`${stage.stage}-${stage.cycleNumber}`}>
              <td className="py-2 pr-3 font-medium text-neutral-900 whitespace-nowrap">{stageLabel(stage)}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{stage.ownerAtStart || "(unassigned)"}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-neutral-600">{formatManilaDateTime(stage.startedAt)}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-neutral-600">
                {stage.endedAt ? formatManilaDateTime(stage.endedAt) : <span className="text-amber-700">In Progress (elapsed so far)</span>}
              </td>
              <td className="py-2 text-right tabular-nums whitespace-nowrap">{formatDurationBreakdown(stage.durationMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap gap-6 text-sm pt-1 border-t border-neutral-200">
        <div>
          <span className="block text-[11px] uppercase tracking-wide text-neutral-400">Total Active Workflow Time</span>
          <span className="font-semibold text-neutral-900">{formatDurationBreakdown(summary.totalWorkflowMinutes) || "—"}</span>
        </div>
        <div>
          <span className="block text-[11px] uppercase tracking-wide text-neutral-400">Longest Stage</span>
          <span className="font-semibold text-neutral-900">{longestStageLabel(summary.longestStage)}</span>
        </div>
        <div>
          <span className="block text-[11px] uppercase tracking-wide text-neutral-400">Delay Area</span>
          <Badge tone={delayMeta.tone}>{delayMeta.label}</Badge>
        </div>
        <div>
          <span className="block text-[11px] uppercase tracking-wide text-neutral-400">Potential Delay Owner</span>
          <span className="font-semibold text-neutral-900">{delay.owner || "—"}</span>
        </div>
      </div>
    </div>
  );
}
