import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";
import { getTeamCapacityDetail, getOwnershipRisk } from "@/lib/capacity";
import { resolveFilters } from "@/lib/date-ranges";
import { FilterBar } from "@/components/filters/FilterBar";
import { CapacityTeamView } from "@/components/dashboard/CapacityTeamView";

export default async function TeamCapacityPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();

  const { range, period } = resolveFilters(searchParams);

  const [detail, ownershipRisk] = await Promise.all([
    getTeamCapacityDetail(team.team_key, range, period),
    getOwnershipRisk(team.team_key),
  ]);
  if (!detail) notFound();

  const query = new URLSearchParams({ range, period }).toString();

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
          <h1>{teamLabel(team.team_name)} — Capacity &amp; Health</h1>
          <p className="text-sm text-neutral-500 mt-1">Workload, availability, and single-point-of-failure risk for this team, individual by individual.</p>
        </div>
        <FilterBar />
      </div>

      <CapacityTeamView team={detail} ownershipRisk={ownershipRisk} />
    </div>
  );
}
