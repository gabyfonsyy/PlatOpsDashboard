import { TopNav } from "@/components/layout/TopNav";
import { OverviewQuickPanel } from "@/components/overview/OverviewQuickPanel";
import { getTeams } from "@/lib/teams";
import { teamLabel } from "@/lib/utils";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // GAS may not be deployed yet during early setup — degrade to no team tabs rather than crash.
  const teams = await getTeams().catch(() => []);
  const teamTabs = teams.map((t) => ({ key: t.team_key.toLowerCase(), label: teamLabel(t.team_name) }));

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav teamTabs={teamTabs} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">{children}</main>

      {/* Today's overview, without leaving the page you're on. Hides itself on "/".

          Mounted here rather than inside TopNav on purpose: it is a fixed edge tab and a slide-out
          panel, and the header is `backdrop-blur-xl` — which makes it a containing block for fixed
          descendants (the trap documented in ui/SidePanel). Rendered from the header, the tab would
          be trapped in the header's box. The panel itself already escapes via a portal; the tab
          cannot, so it is mounted outside the blurred subtree instead. */}
      <OverviewQuickPanel />
    </div>
  );
}
