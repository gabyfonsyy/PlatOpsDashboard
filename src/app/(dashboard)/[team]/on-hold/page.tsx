import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getOnHoldReport } from "@/lib/on-hold";
import { ON_HOLD_THRESHOLD_COOKIE, parseOnHoldThresholdCookie } from "@/lib/on-hold-view";
import { parseSegmentFilter } from "@/lib/fcr";
import { getKpiBaselines } from "@/lib/kpi-baselines";
import type { ReviewWaitGrain } from "@/lib/review-wait";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { OnHoldDeepDive } from "@/components/dashboard/OnHoldDeepDive";

export default async function OnHoldPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();
  if (!team.has_holding_reason) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);
  const str = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const rawGrain = str("grain");
  const grain: ReviewWaitGrain | undefined = rawGrain === "day" || rawGrain === "week" || rawGrain === "month" ? rawGrain : undefined;

  const baselines = await getKpiBaselines(team.team_key);
  const report = await getOnHoldReport(team.team_key, range, period, {
    issueType,
    grain,
    baseline: baselines.on_hold_wait,
    baselineP75: baselines.on_hold_wait_p75,
    thresholdOverrideMinutes: parseOnHoldThresholdCookie(cookies().get(ON_HOLD_THRESHOLD_COOKIE)?.value),
    reason: str("reason") ?? null,
    exit: str("exit") ?? null,
    segment: parseSegmentFilter(str("seg")),
    longOnly: str("long") === "1",
  });

  const issueTypes = team.issue_types_csv
    ? team.issue_types_csv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const query = new URLSearchParams({ range, period, ...(issueType ? { issueType } : {}) }).toString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="max-w-3xl">
          <Link
            href={`/${team.team_key.toLowerCase()}?${query}`}
            className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {teamLabel(team.team_name)}
          </Link>
          <h1>{teamLabel(team.team_name)} — On-Hold Wait Time</h1>
          <p className="text-sm text-neutral-500 mt-1">
            How long tickets wait in On Hold, why, and where they go next. Each hold is measured on its own, from entering On Hold to
            moving to In Progress, For Checking, For Peer Review, For Product Team, Archived or Rejected. It uses tickets resolved in
            the period and calendar time, the same basis as Cycle Time. Holds that are still open show in the current queue only.
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <OnHoldDeepDive report={report} jiraBaseUrl={process.env.JIRA_BASE_URL} teamSlug={team.team_key.toLowerCase()} query={query} />
    </div>
  );
}
