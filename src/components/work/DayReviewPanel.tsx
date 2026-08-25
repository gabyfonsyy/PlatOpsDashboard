"use client";

import { useState } from "react";
import { HeartPulse, Sparkles } from "lucide-react";
import { SidePanel } from "@/components/ui/SidePanel";
import { CheckInCard } from "@/components/work/CheckInCard";
import { WorkMirror } from "@/components/work/WorkMirror";
import { moodByCode, type WorkCheckin } from "@/lib/work";
import { cn } from "@/lib/utils";

/**
 * Moves the end-of-day surfaces off the board and into a slide-over.
 *
 * Both of these are things you do ONCE, at the end of a day, and they were occupying a full
 * two-column band on a page whose job is answering "what needs me now?" every morning. Behind a
 * button they cost nothing until wanted, and the board gets its space back.
 *
 * Two triggers, one panel, because they are genuinely two tasks — but they share a panel rather
 * than getting one each, since looking at the mirror right after rating the day is the natural
 * order and forcing a close-then-open between them would be busywork.
 */
export function DayReviewPanel({
  checkin,
  daysAvailable,
}: {
  checkin: WorkCheckin | null;
  daysAvailable: number;
}) {
  const [tab, setTab] = useState<"checkin" | "mirror" | null>(null);
  const mood = checkin ? moodByCode(checkin.mood) : null;

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setTab("checkin")} className="btn-secondary py-1.5 px-3 text-xs">
          <HeartPulse className="w-3.5 h-3.5" />
          {/* Showing today's answer on the button is what stops the check-in being forgotten:
              otherwise there is no signal anywhere on the page that it is still unanswered. */}
          {checkin ? `Today: ${mood?.emoji ?? ""} ${mood?.label ?? checkin.mood}` : "How was work today?"}
        </button>
        <button onClick={() => setTab("mirror")} className="btn-secondary py-1.5 px-3 text-xs">
          <Sparkles className="w-3.5 h-3.5" />
          Work Mirror
        </button>
      </div>

      <SidePanel
        open={tab !== null}
        onClose={() => setTab(null)}
        title={tab === "mirror" ? "Work Mirror" : "How was work today?"}
        description={
          tab === "mirror"
            ? "Patterns across your recent days. Only runs when you ask it to."
            : "Thirty seconds. Picking a mood is enough on its own."
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-1 pill-nav self-start">
            <button
              onClick={() => setTab("checkin")}
              className={cn("pill", tab === "checkin" && "pill-active")}
            >
              Check-in
            </button>
            <button
              onClick={() => setTab("mirror")}
              className={cn("pill", tab === "mirror" && "pill-active")}
            >
              Mirror
            </button>
          </div>

          {/* Both stay MOUNTED once opened so a half-written note or a generated mirror result
              survives switching tabs — remounting would silently discard either. */}
          <div className={cn(tab === "checkin" ? "block" : "hidden")}>
            <CheckInCard checkin={checkin} />
          </div>
          <div className={cn(tab === "mirror" ? "block" : "hidden")}>
            <WorkMirror daysAvailable={daysAvailable} />
          </div>
        </div>
      </SidePanel>
    </>
  );
}
