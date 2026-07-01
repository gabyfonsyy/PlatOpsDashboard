import { TopNav } from "@/components/layout/TopNav";
import { getTeams } from "@/lib/teams";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // GAS may not be deployed yet during early setup — degrade to no team tabs rather than crash.
  const teams = await getTeams().catch(() => []);
  const teamTabs = teams.map((t) => ({ key: t.team_key.toLowerCase(), label: t.team_name }));

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav teamTabs={teamTabs} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
