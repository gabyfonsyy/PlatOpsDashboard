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
 * ONE trigger, two tabs inside. The tabs live in the panel rather than on the page because the
 * page header is not where a once-a-day task earns two buttons — but the check-in still has to be
 * reachable, and a tab is the cheapest way to say "this is also here".
 *
 * The button carries a dot when today's check-in is unanswered. Without it, collapsing to a single
 * Work Mirror button would remove the only thing on the page that ever mentions the check-in, and
 * a prompt nobody is reminded of is a prompt nobody answers.
 */
export function DayReviewPanel({
  checkin,
  daysAvailable,
}: {
  checkin: WorkCheckin | null;
  daysAvailable: number;
}) {
  const [open, setOpen] = useState(false);
  // Opens on the tab the button names. Landing on the check-in after clicking "Work Mirror" would
  // read as the wrong panel having opened.
  const [tab, setTab] = useState<"checkin" | "mirror">("mirror");
  const mood = checkin ? moodByCode(checkin.mood) : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-secondary py-1.5 px-3 text-xs relative"
        title={checkin ? `Today's check-in: ${mood?.label ?? checkin.mood}` : "Today's check-in is still unanswered"}
      >
        <Sparkles className="w-3.5 h-3.5" />
        Work Mirror
        {!checkin && (
          <span
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500"
            aria-label="Check-in not answered yet"
          />
        )}
      </button>

      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
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
              <HeartPulse className="w-3.5 h-3.5" />
              Check-in
              {!checkin && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
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
