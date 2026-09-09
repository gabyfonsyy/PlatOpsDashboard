import type { AccountCreationTicketSla } from "@/lib/account-creation-sla";
import { MILESTONE_STATUS_META } from "@/lib/account-creation-view";

const TONE_CHIP_CLASS: Record<string, string> = {
  neutral: "bg-neutral-100 text-neutral-500",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-red-100 text-red-700",
};

/**
 * Four milestone statuses as compact dots (S = SE Setup, L = L3 Endorsement, 2 = Day 2, 3 = Day 3)
 * instead of four separate badge columns — the Watchtower board and Ticket Receipts table were
 * wide enough (9 columns) to force horizontal scrolling on a normal screen. Full status text is
 * still available via the native `title` tooltip on hover/focus, so nothing is actually hidden,
 * just not spelled out in-line.
 */
export function AccountCreationMilestoneDots({ ticket }: { ticket: AccountCreationTicketSla }) {
  const milestones = [
    { code: "S", label: "Day 1 SE Setup", meta: MILESTONE_STATUS_META[ticket.day1SeSetup.status] },
    { code: "L", label: "L3 Endorsement", meta: MILESTONE_STATUS_META[ticket.day1L3Endorsement.status] },
    { code: "2", label: "Day 2 — L3 Realm + Site Bindings", meta: MILESTONE_STATUS_META[ticket.day2.status] },
    { code: "3", label: "Day 3 — Data Loading", meta: MILESTONE_STATUS_META[ticket.day3.status] },
  ];

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Milestone statuses">
      {milestones.map((m) => (
        <span
          key={m.code}
          title={`${m.label}: ${m.meta.label}`}
          aria-label={`${m.label}: ${m.meta.label}`}
          className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold cursor-help ${TONE_CHIP_CLASS[m.meta.tone]}`}
        >
          {m.code}
        </span>
      ))}
    </div>
  );
}
