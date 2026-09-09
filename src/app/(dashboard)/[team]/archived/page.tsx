import { notFound } from "next/navigation";
import { getTeamByKey } from "@/lib/teams";
import { teamHasOutcome } from "@/lib/ticket-outcomes";
import { resolveFilters } from "@/lib/date-ranges";
import { TicketOutcomeDrillDown } from "@/components/dashboard/TicketOutcomeDrillDown";

export default async function ArchivedTicketsPage({
  params,
  searchParams,
}: {
  params: { team: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const team = await getTeamByKey(params.team);
  if (!team) notFound();
  if (!teamHasOutcome(team, "archived")) notFound();

  const { range, period, issueType } = resolveFilters(searchParams);
  const reasonFilter = typeof searchParams.reason === "string" ? searchParams.reason : undefined;

  return (
    <TicketOutcomeDrillDown
      team={team}
      outcome="archived"
      range={range}
      period={period}
      issueType={issueType}
      reasonFilter={reasonFilter}
    />
  );
}
