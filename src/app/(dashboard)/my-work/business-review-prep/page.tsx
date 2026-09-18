import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { THEME_COOKIE, isTheme, DEFAULT_THEME } from "@/lib/theme";
import { getBusinessReview, type ReviewTeamLabel } from "@/lib/business-review";
import type { ReviewMode } from "@/lib/review-periods";
import { Copy } from "@/components/ui/Copy";
import { TeamSelector } from "@/components/business-review/TeamSelector";
import { ReviewModeSelector } from "@/components/business-review/ReviewModeSelector";
import { ExecutiveSummaryCard } from "@/components/business-review/ExecutiveSummaryCard";
import { MetricComparisonCard } from "@/components/business-review/MetricComparisonCard";
import { ReviewPrepChecklist } from "@/components/business-review/ReviewPrepChecklist";
import { TalkingPoints } from "@/components/business-review/TalkingPoints";

/**
 * My Work -> Business Review Prep. Automates WBR/MBR/QBR prep: pulls the existing per-team
 * metrics (lib/business-review.ts), compares against the right prior period, explains what moved
 * and (where the data supports it) why, then gives Gaby a checklist and editable talking points
 * to walk into the review with. See the approved plan at
 * C:\Users\gabriellef\.claude\plans\deep-herding-valiant.md for the full design.
 *
 * A sibling of /my-work rather than nested in its per-user task data (work-store.ts) — this page's
 * data is org/team-wide, not personal-task data, even though the checklist/talking points state
 * it also owns IS personal (scoped by session email, same posture as My Work itself).
 */

const VALID_TEAMS: ReviewTeamLabel[] = ["SE", "DBA", "DevOps"];
const VALID_MODES: ReviewMode[] = ["weekly", "monthly", "quarterly"];

export default async function BusinessReviewPrepPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return <p className="text-sm text-neutral-500">Sign in to see Business Review Prep.</p>;

  const themeCookie = cookies().get(THEME_COOKIE)?.value;
  const theme = isTheme(themeCookie) ? themeCookie : DEFAULT_THEME;

  const teamParam = typeof searchParams.team === "string" ? searchParams.team : "SE";
  const team: ReviewTeamLabel = VALID_TEAMS.includes(teamParam as ReviewTeamLabel) ? (teamParam as ReviewTeamLabel) : "SE";

  const modeParam = typeof searchParams.mode === "string" ? searchParams.mode : "weekly";
  const mode: ReviewMode = VALID_MODES.includes(modeParam as ReviewMode) ? (modeParam as ReviewMode) : "weekly";

  const periodParam = typeof searchParams.period === "string" ? searchParams.period : undefined;

  const review = await getBusinessReview(team, mode, theme, periodParam, email);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">
          <Copy serious="Business Review Prep" playful="\ud83d\ude80 Business Review Prep" />
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          <Copy
            serious="What changed this period, why, and what to bring to the review."
            playful="What happened out there, what moved the needle, and what you're saying about it."
          />
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TeamSelector team={team} />
        <ReviewModeSelector mode={mode} periodStart={review.current.start} currentLabel={review.currentLabel} />
      </div>

      <p className="text-xs text-neutral-400 -mt-3">
        {review.currentLabel} vs {review.previousLabel}
      </p>

      <ExecutiveSummaryCard summary={review.executiveSummary} />

      <div>
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">
          <Copy serious="Key Metric Changes" playful="\ud83d\udcca The Numbers" />
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {review.metrics.map((metric) => (
            <MetricComparisonCard key={metric.key} metric={metric} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReviewPrepChecklist periodKey={review.periodKey} initialState={review.checklistState} />
        <TalkingPoints periodKey={review.periodKey} initialPoints={review.talkingPoints} />
      </div>
    </div>
  );
}
