"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Play,
  Square,
  Circle,
  AlertTriangle,
  Plus,
  Trash2,
  Check,
  X,
  ChevronDown,
} from "lucide-react";
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
 * Start / End Work, with a week of reviewable history folded away behind it.
 *
 * The one-click start stays exactly that — the brief is explicit that being asked to fill anything
 * in just to begin the day is how a tool like this stops getting used. Everything else here is for
 * AFTER the fact: the day you forgot to end, the weekday with nothing on it, the leave you took.
 * It is collapsed by default so none of it is in the way of the button, and the count of days
 * needing attention shows on the closed state so a forgotten End Work still surfaces.
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
  const [reviewOpen, setReviewOpen] = useState(false);
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

  const needsAttention = recentDays.filter((d) => d.flags.length > 0).length;
  const line = philosophyLine(today);

  return (
    <div className="card p-5 flex flex-col gap-3 h-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
                  {loggedToday > 0 && ` · ${formatDuration(loggedToday)} earlier today`}
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

      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* The middle of the card, sized by whatever is left after the status row and the footer.
          Closed, it holds a line of the philosophy rather than dead space — the card is now as
          tall as two scorecards and would otherwise be mostly empty. Open, the same box becomes
          the scrollable review, so expanding never changes the card's height and never pushes the
          scorecards beside it out of alignment. */}
      <div className="flex-1 min-h-0 border-t border-line/70 pt-3">
        {reviewOpen ? (
          <div className="h-full overflow-y-auto divide-y divide-neutral-100 pr-1">
            {recentDays.map((day) => (
              <DayRow key={day.work_date} day={day} today={today} onError={setError} />
            ))}
          </div>
        ) : (
          <div className="h-full flex items-center">
            <blockquote className="text-sm text-neutral-500 leading-relaxed">
              <p className="text-neutral-700">{line.text}</p>
              {line.note && <p className="text-xs text-neutral-400 mt-1">{line.note}</p>}
            </blockquote>
          </div>
        )}
      </div>

      {/* Footer, not a header: closed, the thing above it is a quote, and "Last 7 days" sitting
          over a quote reads as a label for it. The attention count stays visible on the closed
          state deliberately — a forgotten End Work is exactly what you never go looking for. */}
      <button
        onClick={() => setReviewOpen((v) => !v)}
        aria-expanded={reviewOpen}
        className="flex items-center justify-between gap-2 w-full border-t border-line/70 pt-3 text-left group shrink-0"
      >
        <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide group-hover:text-neutral-700 transition-colors">
          Last 7 days
        </span>
        <span className="flex items-center gap-2">
          {needsAttention > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
              <AlertTriangle className="w-3 h-3" />
              {needsAttention} to sort out
            </span>
          )}
          <ChevronDown
            className={cn(
              "w-4 h-4 text-neutral-400 transition-transform duration-200",
              reviewOpen && "rotate-180"
            )}
          />
        </span>
      </button>
    </div>
  );
}

/**
 * The lines shown in the closed card, drawn from the PlatOps operating philosophy Gaby wrote for
 * the Overview's daily assessment — the same principles the model is briefed on in
 * lib/overview-ai.ts, in her words rather than paraphrased.
 *
 * Deliberately NOT motivational filler. The card had dead space and the honest thing to put in it
 * is the standard the work is actually held to; "you've got this" in an operations tool is noise,
 * and noise in a place you look every morning stops being read within a week.
 *
 * `note` is optional and carries the consequence, so a line can state a principle without the
 * principle having to carry its own explanation.
 */
const PHILOSOPHY: { text: string; note?: string }[] = [
  {
    text: "Optimise the system, not the person.",
    note: "When the same issue keeps needing someone to catch it, the catching isn't the fix.",
  },
  {
    text: "Work has to get done — but the system shouldn't depend on unsustainable effort.",
  },
  {
    text: "Passion and determination keep a team going.",
    note: "The leadership question is how to help them sustain it without individual heroics.",
  },
  {
    text: "Someone failing in a healthy system and someone compensating for an unhealthy one look identical in the numbers.",
    note: "They need opposite responses.",
  },
  {
    text: "High workload isn't poor performance, and high output isn't automatically healthy.",
    note: "Ask whether it can be maintained, not whether it happened.",
  },
  {
    text: "How do we make this easier, more reliable, or more sustainable next time?",
  },
  {
    text: "Monitoring is sometimes the whole intervention.",
    note: "Not everything that moved needs you to do something about it.",
  },
];

/**
 * One line per day, chosen from the date rather than at random.
 *
 * Math.random() here would differ between the server render and hydration and React would warn
 * about the mismatch — and beyond that, a line that changes on every refresh is wallpaper. Keyed
 * on the Manila date, it is the same all day and different tomorrow.
 */
function philosophyLine(isoDate: string): { text: string; note?: string } {
  let hash = 0;
  for (let i = 0; i < isoDate.length; i++) hash = (hash * 31 + isoDate.charCodeAt(i)) >>> 0;
  return PHILOSOPHY[hash % PHILOSOPHY.length];
}

/**
 * One reviewable day. Collapsed it is a single line; the editor only appears on demand, because
 * this list is read far more often than it is corrected and seven open forms would bury the
 * Start Work button the card exists for.
 *
 * The Holiday/Leave control sits INSIDE the expanded editor rather than on the row. It was on the
 * row until the card was halved in width, where a label, a time range, a duration and a select
 * could not share a line without wrapping into an unreadable mess.
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

  return (
    <div className="py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left group"
        aria-expanded={open}
      >
        <span
          className={cn(
            "text-xs font-medium w-16 shrink-0",
            day.isWeekend ? "text-neutral-400" : "text-neutral-700"
          )}
        >
          {dayLabel(day.work_date, today)}
        </span>

        <span className="text-xs text-neutral-500 truncate flex-1 group-hover:text-sprout-700 transition-colors">
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
                  `${formatManilaTime(s.started_at)}–${
                    s.ended_at ? formatManilaTime(s.ended_at) : "open"
                  }`
              )
              .join(", ")
          )}
        </span>

        {day.flags.length > 0 && (
          <AlertTriangle
            className="w-3.5 h-3.5 text-amber-600 shrink-0"
            aria-label={day.flags.map((f) => FLAG_MESSAGES[f]).join("; ")}
          />
        )}

        <span className="text-xs tabular-nums text-neutral-600 shrink-0 w-14 text-right">
          {day.closedMinutes > 0 ? formatDuration(day.closedMinutes) : "—"}
        </span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2 pl-1">
          {day.flags.map((f) => (
            <p key={f} className="text-[11px] text-amber-700 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {FLAG_MESSAGES[f]}
            </p>
          ))}

          {day.sessions.map((s) => (
            <SessionEditor
              key={s.session_id}
              session={s}
              busy={busy}
              onSave={(patch) =>
                send("PATCH", "/api/work/session", { session_id: s.session_id, ...patch })
              }
              onDelete={() => send("DELETE", "/api/work/session", { session_id: s.session_id })}
            />
          ))}

          <div className="flex items-center gap-2 flex-wrap">
            <AddSession
              workDate={day.work_date}
              busy={busy}
              onAdd={(payload) => send("POST", "/api/work/session", payload)}
            />
            {!isToday && (
              <select
                value={day.mark?.day_type ?? ""}
                onChange={(e) =>
                  send("POST", "/api/work/day-mark", {
                    work_date: day.work_date,
                    day_type: e.target.value || null,
                  })
                }
                disabled={busy}
                className="form-input w-auto py-1 text-xs"
                aria-label={`Mark ${day.work_date} as a non-working day`}
              >
                <option value="">Workday</option>
                {DAY_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
          </div>
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
    <div className="flex items-center gap-1.5 flex-wrap">
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
      <button onClick={() => setAdding(true)} className="btn-secondary py-1 px-2 text-xs">
        <Plus className="w-3 h-3" />
        Add a session
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
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
