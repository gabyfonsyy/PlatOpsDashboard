import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getReviewWaitReport, type ReviewWaitGrain } from "@/lib/review-wait";
import { REVIEW_TARGET_COOKIE, parseReviewTargetCookie } from "@/lib/review-wait-view";
import { resolveFilters } from "@/lib/date-ranges";
import { EXTRA_EXCLUDED_LABELS_COOKIE, resolveExtraExcludedLabels } from "@/lib/excluded-labels";
import { AUTOMATION_LABELS_COOKIE, resolveAutomationLabels } from "@/lib/automation-labels";
import { getKpiBaselines } from "@/lib/kpi-baselines";
import { FilterBar } from "@/components/filters/FilterBar";
import { ReviewWaitDeepDive } from "@/components/dashboard/ReviewWaitDeepDive";

export default async function ReviewWaitPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();
  if (!team.has_peer_review_tracking) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);
  const rawGrain = typeof searchParams.grain === "string" ? searchParams.grain : undefined;
  const grain: ReviewWaitGrain | undefined = rawGrain === "day" || rawGrain === "week" || rawGrain === "month" ? rawGrain : undefined;

  const jar = cookies();
  const extraExcludedLabels = resolveExtraExcludedLabels(jar.get(EXTRA_EXCLUDED_LABELS_COOKIE)?.value);
  // Bot/automation labels come out of the Label and Category breakdowns too — the same catalogue
  // the Automated Tickets page uses, so editing it there applies here.
  const automationLabels = resolveAutomationLabels(jar.get(AUTOMATION_LABELS_COOKIE)?.value);
  const targetOverrideMinutes = parseReviewTargetCookie(jar.get(REVIEW_TARGET_COOKIE)?.value);

  const baselines = await getKpiBaselines(team.team_key);
  const report = await getReviewWaitReport(team.team_key, range, period, {
    issueType,
    grain,
    targetOverrideMinutes,
    baseline: baselines.review_wait,
    extraExcludedLabels,
    automationLabels,
  });

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const query = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="max-w-2xl">
          <Link
            href={`/${team.team_key.toLowerCase()}?${query}`}
            className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {teamLabel(team.team_name)}
          </Link>
          <h1>{teamLabel(team.team_name)} — Review Wait Time</h1>
          <p className="text-sm text-neutral-500 mt-1">
            How long tickets wait in For Peer Review before moving on to On Hold, For Checking, Archived or Rejected — and where
            that wait comes from. Counted per review cycle that started in the period, in calendar time (same basis as Cycle Time),
            attributed to whoever the ticket was assigned to when it entered review. Pass-throughs that left review in under a minute aren&apos;t counted as reviews.
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <ReviewWaitDeepDive report={report} jiraBaseUrl={process.env.JIRA_BASE_URL} extraExcludedLabels={extraExcludedLabels} />
    </div>
  );
}
