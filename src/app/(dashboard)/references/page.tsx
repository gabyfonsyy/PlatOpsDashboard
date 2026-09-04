import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getReferences } from "@/lib/references-store";
import { PageTitle } from "@/components/ui/PageTitle";
import { Copy } from "@/components/ui/Copy";
import { ReferencesView } from "@/components/references/ReferencesView";

/**
 * A personal dumping ground for links worth keeping — Sheets, Docs, random websites — with a
 * title and a quick description, so they're a search away instead of buried in Slack. Lives
 * under the My Work dropdown (see TopNav) because it's the same kind of thing: personal,
 * disposable, Supabase-backed for the same reason work_projects is — see references.sql.
 *
 * Site Monitoring is a built-in card here (rendered first, non-deletable, non-reorderable — see
 * ReferencesView) that links out to its own dedicated page at /references/site-monitoring. It is
 * NOT rendered on this page — this page is deliberately just the card launcher, per the 2026-09-04
 * revision that split it out (the full table used to live here directly).
 */
export default async function ReferencesPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return <p className="text-sm text-neutral-500">Sign in to see your references.</p>;
  }

  let needsSetup = false;
  const references = await getReferences(email).catch((err) => {
    if (err instanceof Error && err.message === "needs-setup") {
      needsSetup = true;
      return [];
    }
    throw err;
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle page="references" />
        <p className="text-sm text-neutral-500 mt-1">
          <Copy
            serious="Sheets, docs, and websites worth finding again."
            playful="Everything you'd otherwise lose in Slack scrollback."
          />
        </p>
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Reference Library</h2>
      </div>

      <ReferencesView references={references} needsSetup={needsSetup} />
    </div>
  );
}
