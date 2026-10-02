import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getFcrDeepDive, parseFcrFilter, parseSegmentFilter } from "@/lib/fcr";
import type { ReviewWaitGrain } from "@/lib/review-wait";
import { resolveFilters } from "@/lib/date-ranges";
import { getKpiBaselines } from "@/lib/kpi-baselines";
import { FilterBar } from "@/components/filters/FilterBar";
import { FcrDeepDive } from "@/components/dashboard/FcrDeepDive";

export default async function FcrPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();
  if (!team.has_fcr_escalation) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);
  const str = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const rawGrain = str("grain");
  const grain: ReviewWaitGrain | undefined = rawGrain === "day" || rawGrain === "week" || rawGrain === "month" ? rawGrain : undefined;

  const baselines = await getKpiBaselines(team.team_key);
  const report = await getFcrDeepDive(team.team_key, range, period, {
    issueType,
    grain,
    baseline: baselines.fcr_rate,
    fcr: parseFcrFilter(str("fcr")),
    segment: parseSegmentFilter(str("seg")),
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
          <h1>{teamLabel(team.team_name)} — First Contact Resolution</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Tickets with First Contact Resolution = Yes ÷ tickets resolved in the period (by resolved date), and where the follow-up work comes from.
            Tickets with a blank FCR value are left out of the rate and listed under Data quality. Archived and Rejected tickets count, as before.
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <FcrDeepDive report={report} jiraBaseUrl={process.env.JIRA_BASE_URL} teamSlug={team.team_key.toLowerCase()} query={query} />
    </div>
  );
}
