import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getOverview, type OverviewData } from "@/lib/overview";
import { getBriefing, type OverviewBriefing } from "@/lib/overview-ai";
import {
  SECTION_ORDER,
  VIEW_COOKIE,
  VIEW_COPY,
  greeting,
  isOverviewView,
  voiceForView,
  type OverviewView,
  type SectionKey,
} from "@/lib/overview-view";
import { AssessmentHeader } from "@/components/overview/AssessmentHeader";
import { ViewToggle } from "@/components/overview/ViewToggle";
import { SectionCard } from "@/components/overview/SectionCard";
import {
  FocusList,
  MyDayPanel,
  OperationsPanel,
  PriorityList,
  ProsePanel,
  StableList,
  TeamPulsePanel,
  WatchList,
} from "@/components/overview/Panels";

/**
 * The Overview — a management command centre for an Engineering Lead, not a metrics page.
 *
 * ── What this page is ──────────────────────────────────────────────────────────────────────────
 * An AGGREGATION LAYER. It owns no data and duplicates no module's functionality: every figure is
 * read from the module that already computes it (see lib/overview.ts) and every card links back
 * there. That is what stops it drifting out of agreement with the pages it summarises.
 *
 * ── Two registers ──────────────────────────────────────────────────────────────────────────────
 * Professional and Gaby View render from the SAME OverviewData and the same briefing structure.
 * Only labels, section order and the AI's voice layer differ — see lib/overview-view.ts. Both are
 * assembled below from one `sections` map so the two orders cannot drift into two pages.
 *
 * ── Live data, daily interpretation ────────────────────────────────────────────────────────────
 * The numbers are read on every request. The AI assessment is a once-a-day snapshot with its own
 * visible timestamp, so an old interpretation can never be mistaken for a live one.
 */

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return <p className="text-sm text-neutral-500">Sign in to see your overview.</p>;

  // Param wins over cookie so a shared link opens in the register it was shared in.
  const fromCookie = cookies().get(VIEW_COOKIE)?.value;
  const view: OverviewView = isOverviewView(searchParams.view)
    ? searchParams.view
    : isOverviewView(fromCookie)
      ? fromCookie
      : "professional";

  const copy = VIEW_COPY[view];
  const firstName = session.user?.name?.split(" ")[0] ?? "there";

  const data = await getOverview(email);
  // Never generates — that is the snapshot route's job, triggered by AssessmentHeader.
  const briefing = await getBriefing(email, data.today, voiceForView(view));

  const dateLabel = new Date().toLocaleDateString("en-US", {
    timeZone: "Asia/Manila",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const sections = buildSections(data, briefing, copy);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <AssessmentHeader
            view={view}
            greeting={greeting()}
            firstName={firstName}
            dateLabel={dateLabel}
            headline={briefing?.headline ?? ""}
            generatedAt={briefing?.generatedAt ?? null}
            hasBriefing={Boolean(briefing)}
          />
        </div>
        <div className="pt-1">
          <ViewToggle view={view} />
        </div>
      </div>

      {SECTION_ORDER[view].map((key) => sections[key])}
    </div>
  );
}

type Copy = (typeof VIEW_COPY)[OverviewView];

/**
 * Every section, built once and rendered in whichever order the register asks for.
 *
 * Keyed rather than inlined so the two orders in SECTION_ORDER are the ONLY difference between the
 * modes — if a section were written twice, the two copies would eventually disagree, which is
 * exactly the "two dashboards" outcome the brief rules out.
 */
function buildSections(
  data: OverviewData,
  briefing: OverviewBriefing | null,
  copy: Copy
): Record<SectionKey, React.ReactNode> {
  return {
    priority: (
      <SectionCard
        key="priority"
        title={copy.priority.title}
        subtitle={copy.priority.subtitle}
        tone={data.attention.some((a) => a.priority === "high") || briefing?.priorityAttention.some((p) => p.urgency === "urgent") ? "attention" : "default"}
      >
        <PriorityList
          items={data.attention}
          aiItems={briefing?.priorityAttention ?? []}
          emptyMessage={copy.empty.priority}
        />
      </SectionCard>
    ),

    myDay: (
      <SectionCard
        key="myDay"
        title={copy.myDay.title}
        subtitle={copy.myDay.subtitle}
        action={{ label: "My Work", href: "/my-work" }}
      >
        <MyDayPanel day={data.myDay} note={briefing?.myDay ?? ""} />
      </SectionCard>
    ),

    teamPulse: (
      <SectionCard
        key="teamPulse"
        title={copy.teamPulse.title}
        subtitle={copy.teamPulse.subtitle}
        action={{ label: "Team Stats", href: "/teams" }}
      >
        <TeamPulsePanel pulse={data.pulse} metrics={data.metrics} note={briefing?.teamPulse ?? ""} />
      </SectionCard>
    ),

    systemPulse: (
      <SectionCard key="systemPulse" title={copy.systemPulse.title} subtitle={copy.systemPulse.subtitle}>
        <ProsePanel
          text={briefing?.systemPulse ?? ""}
          fallback="No system-level pattern identified in the available data."
        />
      </SectionCard>
    ),

    momentum: (
      <SectionCard key="momentum" title={copy.momentum.title} subtitle={copy.momentum.subtitle}>
        <ProsePanel
          text={briefing?.sustainableMomentum ?? ""}
          fallback="Not enough data to assess sustainability — this dashboard holds no hours or after-hours data for the team."
        />
      </SectionCard>
    ),

    watch: (
      <SectionCard key="watch" title={copy.watch.title} subtitle={copy.watch.subtitle}>
        <WatchList notes={briefing?.keepAnEyeOn ?? []} emptyMessage={copy.empty.watch} />
      </SectionCard>
    ),

    stable: (
      <SectionCard key="stable" title={copy.stable.title} subtitle={copy.stable.subtitle}>
        <StableList
          statements={data.stable}
          aiStatements={briefing?.noIntervention ?? []}
          emptyMessage={copy.empty.stable}
        />
      </SectionCard>
    ),

    focus: (
      <SectionCard key="focus" title={copy.focus.title} subtitle={copy.focus.subtitle}>
        <FocusList moves={briefing?.recommendedFocus ?? []} emptyMessage={copy.empty.focus} />
      </SectionCard>
    ),

    operations: (
      <SectionCard key="operations" title={copy.operations.title} subtitle={copy.operations.subtitle}>
        <OperationsPanel
          rows={data.operations}
          planned={data.planned}
          emptyMessage="No active projects on your board."
        />
      </SectionCard>
    ),
  };
}
