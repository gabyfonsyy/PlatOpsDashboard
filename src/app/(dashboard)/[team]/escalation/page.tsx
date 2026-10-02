import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getEscalationReport } from "@/lib/escalation";
import { parseFcrFilter, parseSegmentFilter, type FcrValue } from "@/lib/fcr";
import type { ReviewWaitGrain } from "@/lib/review-wait";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { EscalationDeepDive } from "@/components/dashboard/EscalationDeepDive";

export default async function EscalationPage({
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
  // Ticket list: escalated (FCR = No) by default; fcr=all widens to every resolved ticket.
  const rawFcr = str("fcr");
  const fcr: FcrValue | null | undefined = rawFcr === "all" ? null : rawFcr ? parseFcrFilter(rawFcr) ?? undefined : undefined;

  const report = await getEscalationReport(team.team_key, range, period, {
    issueType,
    grain,
    fcr,
    segment: parseSegmentFilter(str("seg")),
    destinations: (str("dest") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
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
          <h1>{teamLabel(team.team_name)} — Escalation Rate</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Tickets with First Contact Resolution = No ÷ tickets resolved in the period — the inverse of FCR Rate. Ticket Escalation shows which
            teams helped: each team is counted on its own, so a ticket sent to DevOps and L3 adds one to each, but only one to the rate.
          </p>
        </div>
        <FilterBar issueTypes={issueTypes} />
      </div>

      <EscalationDeepDive report={report} jiraBaseUrl={process.env.JIRA_BASE_URL} />
    </div>
  );
}
