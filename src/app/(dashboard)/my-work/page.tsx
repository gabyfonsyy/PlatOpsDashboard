import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getMyWork } from "@/lib/work-store";
import { dayLabel, formatDuration, moodByCode, type MyWorkData } from "@/lib/work";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Copy } from "@/components/ui/Copy";
import { PageTitle } from "@/components/ui/PageTitle";
import { WorkdayBar } from "@/components/work/WorkdayBar";
import { MyWorkView } from "@/components/work/MyWorkView";
import { CheckInCard } from "@/components/work/CheckInCard";
import { WorkMirror } from "@/components/work/WorkMirror";

/**
 * The personal command centre, and the page the app opens on — "My Work" in Light and Dark,
 * "Mission Control" in Gaby's View (see lib/nav.ts). One page, in the order an actual workday runs:
 * start work, see what needs doing today, glance at projects, look at what's coming, end work,
 * check in, and (later) look in the mirror.
 *
 * Reads Supabase directly on the server, so the first paint already has today's board — no
 * client-side fetch waterfall on a page opened first thing every morning.
 */

const EMPTY: MyWorkData = {
  today: "",
  openSession: null,
  todaySessions: [],
  tasks: [],
  projects: [],
  checkin: null,
  history: [],
  upcoming: [],
  overdue: [],
  recurrences: [],
  recurrencesReady: false,
};

export default async function MyWorkPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  // The dashboard is behind middleware, so this is belt-and-braces rather than a real path.
  if (!email) {
    return <p className="text-sm text-neutral-500">Sign in to see your work.</p>;
  }

  const data = await getMyWork(email).catch(() => ({ ...EMPTY, needsSetup: true }));
  const {
    today,
    openSession,
    todaySessions,
    tasks,
    projects,
    checkin,
    history,
    upcoming,
    overdue,
    recurrences,
    recurrencesReady,
    needsSetup,
  } = data;

  const openTasks = tasks.filter((t) => t.status !== "Done" && t.status !== "Deferred");
  const focusOpen = openTasks.filter((t) => t.lane === "Focus");
  const doneToday = tasks.filter((t) => t.status === "Done").length;
  const yesterday = history.find((d) => d.work_date !== data.today) ?? null;
  const firstName = session?.user?.name?.split(" ")[0] ?? "there";
  // The nearest planned day, for the Ahead card's sublabel — "8 planned" answers how much, this
  // answers when the next of it actually lands.
  const nextDay = upcoming[0]?.work_date ?? null;

  if (needsSetup) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <PageTitle page="home" />
          <p className="text-sm text-neutral-500 mt-1">Personal work tracking.</p>
        </div>
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-neutral-900">One setup step left</h2>
          <p className="text-sm text-neutral-600 mt-2 max-w-2xl">
            This page&apos;s tables don&apos;t exist in Supabase yet. Open the Supabase SQL editor
            and run <code className="text-sprout-700">supabase/my-work.sql</code> from this repo,
            then reload this page. It&apos;s idempotent, so re-running it is safe.
          </p>
          <p className="text-xs text-neutral-400 mt-3">
            Nothing else on the dashboard is affected — this page is the only thing that uses those
            tables.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle page="home" />
        <p className="text-sm text-neutral-500 mt-1">
          <Copy
            serious={`What needs your attention today, ${firstName}.`}
            playful={`Right then, ${firstName}. What are we actually doing today?`}
          />
        </p>
      </div>

      {/* A. Workday */}
      <WorkdayBar openSession={openSession} todaySessions={todaySessions} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="In Focus"
          value={String(focusOpen.length)}
          sublabel={focusOpen.length ? focusOpen[0].title : "nothing claimed yet"}
          tooltip="Open tasks in the Focus lane — the 1–2 things that actually deserve today."
          className={focusOpen.length > 0 && focusOpen.length <= 3 ? "adhd-happy" : undefined}
        />
        <MetricCard
          label="Open Today"
          value={String(openTasks.length)}
          sublabel={`${doneToday} done`}
          tooltip="Everything not yet finished or deferred on today's board."
        />
        {/* Replaces the old Waiting card: what's planned is the question this page couldn't answer
            before, and Waiting is already visible as its own lane on the board below. */}
        <MetricCard
          label="Ahead"
          value={String(upcoming.length)}
          sublabel={
            overdue.length
              ? `${overdue.length} unfinished from earlier`
              : nextDay
                ? `next: ${dayLabel(nextDay, today)}`
                : "nothing planned yet"
          }
          tooltip="Open tasks dated after today, plus anything still open from an earlier day. Neither is on today's board until you move it there."
        />
        <MetricCard
          label="Yesterday"
          value={yesterday ? formatDuration(yesterday.durationMinutes) : "—"}
          sublabel={
            yesterday
              ? `${yesterday.tasksCompleted} done${yesterday.mood ? ` · ${moodByCode(yesterday.mood)?.emoji ?? ""}` : ""}`
              : "no history yet"
          }
          tooltip="Your previous tracked day — duration, tasks completed, and how you rated it."
        />
      </div>

      {/* B + C + D. Today's board with Projects alongside it, then what's coming. */}
      <MyWorkView
        today={today}
        tasks={tasks}
        upcoming={upcoming}
        overdue={overdue}
        projects={projects}
        recurrences={recurrences}
        recurrencesReady={recurrencesReady}
      />

      {/* E + F. Winding down, then the long view. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <CheckInCard checkin={checkin} />
        <WorkMirror daysAvailable={history.length} />
      </div>
    </div>
  );
}
