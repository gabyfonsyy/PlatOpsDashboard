"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Square, Circle, AlertTriangle, Plus, Trash2, Check, X } from "lucide-react";
import { celebrate } from "@/lib/celebrate";
import {
  DAY_TYPES,
  FLAG_MESSAGES,
  dayLabel,
  formatDuration,
  formatManilaTime,
  type DayType,
  type WorkSession,
  type WorkdayRecap,
} from "@/lib/work";
import { cn } from "@/lib/utils";

/**
 * Start / End Work, plus a week of review beside it.
 *
 * The one-click start stays exactly that — the brief is explicit that being asked to fill anything
 * in just to begin the day is how a tool like this stops getting used. Everything added here is
 * for AFTER the fact: the day you forgot to end, the weekday with nothing on it, the leave you
 * took. None of it is in the way of the button.
 *
 * The card reviews a week rather than the "2-3 days" originally asked for, because the most useful
 * flag — a weekday with nothing logged — needs a full week to be meaningful: look back three days
 * on a Monday and two of them are the weekend.
 */
export function WorkdayBar({
  openSession,
  todaySessions,
  recentDays,
  today,
}: {
  openSession: WorkSession | null;
  todaySessions: WorkSession[];
  recentDays: WorkdayRecap[];
  today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ticks the elapsed label. Only mounted while a session is open, so a closed day costs nothing.
  const [, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!openSession) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [openSession]);

  async function toggle(action: "start" | "end") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/work/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      celebrate(action === "start" ? "success" : "milestone");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
    } finally {
      setBusy(false);
    }
  }

  const elapsed = openSession
    ? (Date.now() - new Date(openSession.started_at).getTime()) / 60000
    : null;

  // Sum of every closed session today, so a day resumed after lunch reads as its real total.
  const loggedToday = todaySessions
    .filter((s) => s.ended_at)
    .reduce(
      (sum, s) =>
        sum + (new Date(s.ended_at as string).getTime() - new Date(s.started_at).getTime()) / 60000,
      0
    );

  const needsAttention = recentDays.filter((d) => d.flags.length > 0);

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={cn(
              "inline-flex items-center justify-center w-9 h-9 rounded-full shrink-0",
              openSession ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-400"
            )}
          >
            <Circle className={cn("w-3.5 h-3.5", openSession && "fill-current")} />
          </span>
          <div className="min-w-0">
            {openSession ? (
              <>
                <p className="text-sm font-semibold text-neutral-900">
                  Working since {formatManilaTime(openSession.started_at)}
                </p>
                <p className="text-xs text-neutral-500">
                  {formatDuration(elapsed)} so far
                  {loggedToday > 0 && ` · ${formatDuration(loggedToday)} logged earlier today`}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-neutral-900">Workday not started</p>
                <p className="text-xs text-neutral-500">
                  {loggedToday > 0
                    ? `${formatDuration(loggedToday)} logged today`
                    : "Nothing logged today yet"}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {error && <p className="text-xs text-red-600 max-w-xs text-right">{error}</p>}
          {openSession ? (
            <button onClick={() => toggle("end")} disabled={busy} className="btn-secondary">
              <Square className="w-4 h-4" />
              {busy ? "Ending…" : "End Work"}
            </button>
          ) : (
            <button onClick={() => toggle("start")} disabled={busy} className="btn-primary">
              <Play className="w-4 h-4" />
              {busy ? "Starting…" : "Start Work"}
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-line/70 pt-3">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Last 7 days</p>
          {needsAttention.length > 0 && (
            <p className="text-xs text-amber-700 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {needsAttention.length} day{needsAttention.length === 1 ? "" : "s"} to sort out
            </p>
          )}
        </div>
        <div className="divide-y divide-neutral-100">
          {recentDays.map((day) => (
            <DayRow key={day.work_date} day={day} today={today} onError={setError} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One reviewable day. Collapsed it is a single line; the editor only appears on demand, because
 * this list is read far more often than it is corrected and seven open forms would bury the
 * Start Work button the card exists for.
 */
function DayRow({
  day,
  today,
  onError,
}: {
  day: WorkdayRecap;
  today: string;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isToday = day.work_date === today;
  const flagged = day.flags.length > 0;

  async function send(method: "POST" | "PATCH" | "DELETE", url: string, body: unknown) {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || `HTTP ${res.status}`);
      router.refresh();
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function mark(dayType: DayType | null) {
    await send("POST", "/api/work/day-mark", { work_date: day.work_date, day_type: dayType });
  }

  return (
    <div className="py-2">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-left min-w-0 flex items-center gap-2 group"
          aria-expanded={open}
        >
          <span
            className={cn(
              "text-xs font-medium w-20 shrink-0",
              day.isWeekend ? "text-neutral-400" : "text-neutral-700"
            )}
          >
            {dayLabel(day.work_date, today)}
          </span>
          <span className="text-xs text-neutral-500 group-hover:text-sprout-700 transition-colors">
            {day.sessions.length === 0 ? (
              day.mark ? (
                <span className="text-neutral-400">{day.mark.day_type}</span>
              ) : (
                <span className="text-neutral-300">nothing logged</span>
              )
            ) : (
              day.sessions
                .map(
                  (s) =>
                    `${formatManilaTime(s.started_at)} → ${
                      s.ended_at ? formatManilaTime(s.ended_at) : "still running"
                    }`
                )
                .join(", ")
            )}
          </span>
        </button>

        <span className="ml-auto text-xs tabular-nums text-neutral-600 shrink-0">
          {day.closedMinutes > 0 ? formatDuration(day.closedMinutes) : "—"}
        </span>

        {/* Marking a day is the answer to "why is this empty", so it sits on the row itself
            rather than inside the editor — one click, no expand. */}
        {!isToday && (
          <select
            value={day.mark?.day_type ?? ""}
            onChange={(e) => mark((e.target.value || null) as DayType | null)}
            disabled={busy}
            className="form-input w-auto py-0.5 text-xs shrink-0"
            aria-label={`Mark ${day.work_date} as a non-working day`}
          >
            <option value="">Workday</option>
            {DAY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>

      {flagged && (
        <div className="flex flex-wrap gap-2 mt-1 ml-[5.75rem]">
          {day.flags.map((f) => (
            <span
              key={f}
              className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5"
            >
              <AlertTriangle className="w-3 h-3" />
              {FLAG_MESSAGES[f]}
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-2 ml-[5.75rem] flex flex-col gap-2">
          {day.sessions.map((s) => (
            <SessionEditor
              key={s.session_id}
              session={s}
              busy={busy}
              onSave={(patch) => send("PATCH", "/api/work/session", { session_id: s.session_id, ...patch })}
              onDelete={() => send("DELETE", "/api/work/session", { session_id: s.session_id })}
            />
          ))}
          <AddSession
            workDate={day.work_date}
            busy={busy}
            onAdd={(payload) => send("POST", "/api/work/session", payload)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * `datetime-local` gives and takes a zone-less local wall-clock string. These two helpers are the
 * only place that conversion happens, and they deliberately go through the browser's own offset:
 * the person editing is in the same place as the clock they are reading, so "09:14" means 09:14
 * where they are. The API refuses anything without an explicit offset, so a bug here fails loudly
 * rather than silently shifting a session by hours.
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  // new Date("2026-08-24T09:14") is parsed as LOCAL time by every browser, which is what we want;
  // toISOString then stamps the real offset onto it.
  return new Date(value).toISOString();
}

function SessionEditor({
  session,
  busy,
  onSave,
  onDelete,
}: {
  session: WorkSession;
  busy: boolean;
  onSave: (patch: { started_at?: string; ended_at?: string | null }) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [start, setStart] = useState(() => toLocalInput(session.started_at));
  const [end, setEnd] = useState(() => (session.ended_at ? toLocalInput(session.ended_at) : ""));

  const dirty =
    start !== toLocalInput(session.started_at) ||
    end !== (session.ended_at ? toLocalInput(session.ended_at) : "");

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="datetime-local"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="form-input w-auto py-1 text-xs"
        aria-label="Session start"
      />
      <span className="text-xs text-neutral-400">→</span>
      <input
        type="datetime-local"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="form-input w-auto py-1 text-xs"
        aria-label="Session end"
        placeholder="still running"
      />
      <button
        onClick={() =>
          onSave({
            started_at: fromLocalInput(start),
            // Clearing the end field re-opens the session rather than being ignored.
            ended_at: end ? fromLocalInput(end) : null,
          })
        }
        disabled={busy || !dirty || !start}
        className="btn-secondary py-1 px-2 text-xs disabled:opacity-40"
        title="Save this session"
      >
        <Check className="w-3 h-3" />
        Save
      </button>
      <button
        onClick={onDelete}
        disabled={busy}
        className="text-neutral-400 hover:text-red-600 transition-colors p-1"
        aria-label="Delete this session"
        title="Delete this session"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** Backfills a day that was worked but never started. Both ends required — see createSession. */
function AddSession({
  workDate,
  busy,
  onAdd,
}: {
  workDate: string;
  busy: boolean;
  onAdd: (payload: { started_at: string; ended_at: string }) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [start, setStart] = useState(`${workDate}T09:00`);
  const [end, setEnd] = useState(`${workDate}T18:00`);

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="self-start btn-secondary py-1 px-2 text-xs"
      >
        <Plus className="w-3 h-3" />
        Add a session
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="datetime-local"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="form-input w-auto py-1 text-xs"
        aria-label="New session start"
      />
      <span className="text-xs text-neutral-400">→</span>
      <input
        type="datetime-local"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="form-input w-auto py-1 text-xs"
        aria-label="New session end"
      />
      <button
        onClick={async () => {
          const ok = await onAdd({
            started_at: fromLocalInput(start),
            ended_at: fromLocalInput(end),
          });
          if (ok) setAdding(false);
        }}
        disabled={busy || !start || !end}
        className="btn-secondary py-1 px-2 text-xs disabled:opacity-40"
      >
        <Check className="w-3 h-3" />
        Add
      </button>
      <button
        onClick={() => setAdding(false)}
        className="text-neutral-400 hover:text-neutral-700 transition-colors p-1"
        aria-label="Cancel"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
