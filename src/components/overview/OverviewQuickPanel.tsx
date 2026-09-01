"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Check, CircleDot, Compass, Loader2, RefreshCw } from "lucide-react";
import { SidePanel } from "@/components/ui/SidePanel";
import { formatManilaDateTime } from "@/lib/format";
import { VIEW_COPY, type OverviewView } from "@/lib/overview-view";
import { cn } from "@/lib/utils";

/**
 * The Overview, one click from anywhere.
 *
 * ── Why a panel and not just the nav link ──────────────────────────────────────────────────────
 * The Overview answers "what needs me today", and that question comes up WHILE you are in the
 * middle of something else — halfway through the Leave tracker, or a team's drill-down. Navigating
 * there to check and then navigating back loses your place, so the common case gets a peek that
 * costs nothing and leaves the page you are on untouched. The full page is still one click away
 * from inside the panel, for when the answer is "yes, go and deal with it".
 *
 * ── What it deliberately does NOT do ───────────────────────────────────────────────────────────
 * It never generates. /api/overview/summary is read-only, so opening this cannot spend an AI
 * request — the assessment is a once-a-day snapshot and a popup quietly triggering one would break
 * that contract invisibly. If today's has not been generated, the panel says so and sends you to
 * the Overview, where opening the page is what asks for it.
 *
 * It also never re-derives anything. Everything shown is exactly what the aggregation layer
 * already computed for the page, condensed — so the panel cannot disagree with the Overview.
 */

type Summary = {
  view: OverviewView;
  headline: string;
  generatedAt: string | null;
  attention: { id: string; priority: string; title: string; action: string; href: string }[];
  priorityAttention: { title: string; urgency: string; action: string }[];
  recommendedFocus: string[];
  stable: string[];
  myDay: { openTasks: number; doneToday: number; overdueCount: number; workdayOpen: boolean };
};

export function OverviewQuickPanel() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Marks the data as belonging to a previous opening, so re-opening refetches rather than showing
  // a stale glance — the whole value of this thing is that it is current.
  const loadedAt = useRef<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/overview/summary", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body.data as Summary);
      loadedAt.current = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Refetch when the panel has been shut for more than a minute; a glance opened twice in quick
    // succession reuses what is already there.
    if (data && Date.now() - loadedAt.current < 60_000) return;
    void load();
  }, [open, data, load]);

  // On the Overview itself the panel would be a smaller copy of what is already on screen.
  if (pathname === "/") return null;

  const copy = VIEW_COPY[data?.view ?? "professional"];

  return (
    <>
      {/*
        A tab on the right edge, not an icon in the header.

        It was in the header beside the theme toggle, where it sat close enough to the pill nav to
        read as part of it — and it is not navigation. This is a thing you consult mid-task and
        then dismiss, so it belongs at the edge of the screen the panel slides out of: the button
        and the panel are visibly the same object, one pulled out of the other.

        Vertically centred and fixed, so it is in the same place on every page and never moves as
        content scrolls. `z-30` puts it under the panel (z-50) and over the page.
      */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "group fixed right-0 top-1/2 -translate-y-1/2 z-30",
          "flex items-center gap-2 py-3 pl-2.5 pr-2",
          "rounded-l-xl border border-r-0 border-line/70 bg-surface/80 backdrop-blur-xl shadow-card",
          "text-neutral-400 hover:text-sprout-700 hover:pr-3 transition-all duration-200",
          open && "opacity-0 pointer-events-none"
        )}
        aria-label="Today's overview"
        title="Today's overview"
      >
        <Compass className="w-5 h-5 shrink-0" />
        {/*
          The label is written sideways and only opens on hover. A permanent word on a fixed edge
          tab is a permanent distraction; an icon alone is a guess. `writing-mode` keeps the tab
          narrow enough to sit outside the reading column at any width, and `max-w-0 -> max-w-8`
          animates a real width rather than opacity, so the collapsed state reserves nothing.
        */}
        <span
          className="max-w-0 group-hover:max-w-8 overflow-hidden transition-all duration-200 text-[11px] font-medium tracking-wide whitespace-nowrap"
          style={{ writingMode: "vertical-rl" }}
        >
          Today
        </span>
        {/* A dot rather than a count: this is a peek affordance, and a number on it would turn
            every page into a notification surface competing for attention. */}
        {data && (data.attention.length > 0 || data.priorityAttention.length > 0) && (
          <span className="absolute top-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
        )}
      </button>

      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
        title="Today"
        description={data?.generatedAt ? `Assessed ${formatManilaDateTime(data.generatedAt)}` : undefined}
      >
        <div className="flex flex-col gap-5">
          {loading && !data && (
            <p className="text-sm text-neutral-500 inline-flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Reading today…
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {data && (
            <>
              {data.headline ? (
                <p className="text-sm text-neutral-800 leading-relaxed">{data.headline}</p>
              ) : (
                <p className="text-sm text-neutral-500">
                  No assessment generated for today yet — open the Overview and it will write one.
                </p>
              )}

              <div className="grid grid-cols-3 gap-3">
                <Stat label="Open" value={String(data.myDay.openTasks)} />
                <Stat label="Done" value={String(data.myDay.doneToday)} />
                <Stat
                  label="Overdue"
                  value={String(data.myDay.overdueCount)}
                  warn={data.myDay.overdueCount > 0}
                />
              </div>

              <Group title={copy.priority.title}>
                {data.priorityAttention.length === 0 && data.attention.length === 0 ? (
                  <p className="text-sm text-neutral-400">{copy.empty.priority}</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {data.priorityAttention.map((p, i) => (
                      <li key={`ai-${i}`} className="flex items-start gap-2">
                        <CircleDot
                          className={cn(
                            "w-3.5 h-3.5 mt-0.5 shrink-0",
                            p.urgency === "urgent" ? "text-amber-600" : "text-neutral-300"
                          )}
                        />
                        <div className="min-w-0">
                          <p className="text-sm text-neutral-900">{p.title}</p>
                          <p className="text-xs text-neutral-500 mt-0.5">{p.action}</p>
                        </div>
                      </li>
                    ))}
                    {data.attention.map((a) => (
                      <li key={a.id} className="flex items-start gap-2">
                        <CircleDot
                          className={cn(
                            "w-3.5 h-3.5 mt-0.5 shrink-0",
                            a.priority === "high" ? "text-amber-600" : "text-neutral-300"
                          )}
                        />
                        <div className="min-w-0">
                          <Link
                            href={a.href}
                            onClick={() => setOpen(false)}
                            className="text-sm text-neutral-900 hover:text-sprout-700 transition-colors"
                          >
                            {a.title}
                          </Link>
                          <p className="text-xs text-neutral-500 mt-0.5">{a.action}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Group>

              {data.recommendedFocus.length > 0 && (
                <Group title={copy.focus.title}>
                  <ol className="flex flex-col gap-2">
                    {data.recommendedFocus.map((m, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full bg-sprout-50 text-sprout-700 text-[10px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <p className="text-sm text-neutral-800 leading-relaxed">{m}</p>
                      </li>
                    ))}
                  </ol>
                </Group>
              )}

              {data.stable.length > 0 && (
                <Group title={copy.stable.title}>
                  <ul className="flex flex-col gap-1.5">
                    {data.stable.map((s, i) => (
                      <li key={i} className="text-sm text-neutral-600 flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </Group>
              )}
            </>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-line/70 pt-4">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="text-sm text-sprout-700 hover:underline inline-flex items-center gap-1"
            >
              Open the full Overview
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="btn-secondary py-1 px-2.5 text-xs"
              title="Re-read the current data (does not regenerate the assessment)"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Reload
            </button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">{title}</p>
      {children}
    </div>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-line/70 px-3 py-2">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={cn("text-lg font-semibold", warn ? "text-amber-700" : "text-neutral-900")}>{value}</p>
    </div>
  );
}
