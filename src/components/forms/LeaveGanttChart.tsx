"use client";

import type { LeaveRecord } from "@/lib/types";
import { formatManilaDate, formatNumber } from "@/lib/format";

/**
 * Month Gantt of who's on leave: one row per employee, a colored bar per leave record spanning
 * the days it covers (clipped to the selected month), colored by leave type. Weekends are shaded,
 * today is marked, and half-days render as a half-width bar on the correct side of the day.
 *
 * Colors come from the validated categorical palette (dataviz skill) in fixed order; leave types
 * beyond the palette fold into a neutral "Other" grey. Fills sit below the 3:1 contrast floor, so
 * identity is never colour-alone — every row carries the employee name, the legend maps colour to
 * type, each bar has a hover tooltip, and the records table below is the full table view.
 */

// Validated categorical palette (light surface), fixed CVD-safe order. See dataviz references/palette.md.
const PALETTE = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4"];
const OTHER = "#a89bc0";

/** yyyy-mm-dd (Manila) -> day-of-month number. */
function dayOf(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function LeaveGanttChart({ records, month }: { records: LeaveRecord[]; month: string }) {
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7)); // 1-12
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const dayPct = 100 / daysInMonth;

  // Distinct leave types (stable alphabetical order) -> colour.
  const types = Array.from(new Set(records.map((r) => r.leave_type || "Unspecified"))).sort();
  const colorForType = new Map<string, string>();
  types.forEach((t, i) => colorForType.set(t, i < PALETTE.length ? PALETTE[i] : OTHER));

  // Group records by employee; keep only those overlapping the month.
  const byEmployee = new Map<string, { record: LeaveRecord; sd: string; ed: string }[]>();
  for (const r of records) {
    const sd = formatManilaDate(r.start_date);
    const ed = formatManilaDate(r.end_date);
    if (!sd || !ed) continue;
    const clipStart = sd < monthStart ? monthStart : sd;
    const clipEnd = ed > monthEnd ? monthEnd : ed;
    if (clipEnd < monthStart || clipStart > monthEnd) continue;
    if (!byEmployee.has(r.employee_name)) byEmployee.set(r.employee_name, []);
    byEmployee.get(r.employee_name)!.push({ record: r, sd: clipStart, ed: clipEnd });
  }
  const employees = Array.from(byEmployee.keys()).sort();

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const isWeekend = (d: number) => {
    const wd = new Date(year, monthNum - 1, d).getDay();
    return wd === 0 || wd === 6;
  };

  const todayIso = formatManilaDate(new Date().toISOString());
  const todayDay = todayIso.slice(0, 7) === month ? dayOf(todayIso) : null;

  const monthLabel = new Date(year, monthNum - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  if (employees.length === 0) {
    return (
      <div className="card p-5">
        <p className="text-sm font-medium text-neutral-700 mb-1">Leave Calendar — {monthLabel}</p>
        <div className="py-10 text-center text-sm text-neutral-400">No one on leave this month for the current filter.</div>
      </div>
    );
  }

  // Background layer of day cells (weekend shading + gridlines), shared by header and every row.
  const dayCells = (
    <div className="absolute inset-0 flex">
      {days.map((d) => (
        <div
          key={d}
          className={`flex-1 border-r border-neutral-100 ${isWeekend(d) ? "bg-neutral-50" : ""}`}
        />
      ))}
    </div>
  );

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <p className="text-sm font-medium text-neutral-700">Leave Calendar — {monthLabel}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {types.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colorForType.get(t) }} />
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: `${140 + daysInMonth * 22}px` }}>
          {/* Header: day numbers */}
          <div className="grid" style={{ gridTemplateColumns: "140px 1fr" }}>
            <div />
            <div className="relative h-6">
              <div className="absolute inset-0 flex">
                {days.map((d) => (
                  <div
                    key={d}
                    className={`flex-1 text-center text-[10px] leading-6 ${
                      isWeekend(d) ? "text-neutral-300" : "text-neutral-400"
                    }`}
                  >
                    {d}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Employee rows */}
          <div className="divide-y divide-neutral-100 border-t border-neutral-100">
            {employees.map((emp) => {
              const recs = byEmployee.get(emp)!;
              return (
                <div key={emp} className="grid items-center" style={{ gridTemplateColumns: "140px 1fr" }}>
                  <div className="pr-3 py-2 min-w-0">
                    <p className="text-sm text-neutral-800 truncate" title={emp}>{emp}</p>
                    <p className="text-[10px] text-neutral-400 uppercase tracking-wide">{recs[0].record.team_key}</p>
                  </div>
                  <div className="relative h-9">
                    {dayCells}
                    {todayDay !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-sprout-400/70 z-10"
                        style={{ left: `${(todayDay - 0.5) * dayPct}%` }}
                      />
                    )}
                    {recs.map(({ record, sd, ed }, i) => {
                      const startDay = dayOf(sd);
                      const endDay = dayOf(ed);
                      const half = record.half_day_period && startDay === endDay;
                      let left = (startDay - 1) * dayPct;
                      let width = (endDay - startDay + 1) * dayPct;
                      if (half) {
                        width = dayPct / 2;
                        if (record.half_day_period === "Second Half") left += dayPct / 2;
                      }
                      const color = colorForType.get(record.leave_type || "Unspecified") ?? OTHER;
                      const dim = record.status && record.status.toLowerCase() !== "approved";
                      const tip = `${record.leave_type}${half ? ` (${record.half_day_period})` : ""} · ${formatManilaDate(
                        record.start_date
                      )} → ${formatManilaDate(record.end_date)} · ${formatNumber(record.num_days)} day${
                        record.num_days === 1 ? "" : "s"
                      }${record.status ? ` · ${record.status}` : ""}`;
                      return (
                        <div
                          key={record.leave_id || i}
                          className="group absolute top-1.5 bottom-1.5 rounded-[3px] ring-1 ring-white/40 cursor-default"
                          style={{
                            left: `${left}%`,
                            width: `calc(${width}% - 2px)`,
                            backgroundColor: color,
                            opacity: dim ? 0.5 : 1,
                          }}
                        >
                          <span
                            role="tooltip"
                            className="pointer-events-none absolute left-0 bottom-full mb-1 z-30 hidden group-hover:block
                                       whitespace-nowrap rounded-md bg-neutral-900 text-white text-[11px] leading-snug
                                       px-2 py-1 shadow-lg"
                          >
                            {emp} — {tip}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-neutral-400">
        Bars span leave days within the month (multi-month leaves are clipped). Faded bars are not yet approved.
        Weekends are shaded{todayDay !== null ? "; the green line marks today" : ""}.
      </p>
    </div>
  );
}
