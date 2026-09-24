"use client";

import { useRef, useState } from "react";
import { Plus, Upload } from "lucide-react";
import type { TeamConfig } from "@/lib/teams";
import type { Project, ProjectPhaseStatus } from "@/lib/project-tracking";
import { AddProjectPanel, type AddProjectValues, type PendingCharterImport } from "@/components/projects/AddProjectPanel";

const TRACKER_PAYLOAD_RE = /<script type="application\/json" id="tracker-payload">([\s\S]*?)<\/script>/;

/** Loose shape of a charter's tracker-payload — only the fields this flow actually reads; the
 * skill that generates charters carries more (ai_proposed, open_questions, current values, etc.)
 * that this deliberately doesn't import, per her "just what's important" instruction. */
type CharterPayload = {
  kind?: string;
  /** Stable id the charter-generating skill assigns per charter (e.g.
   * "databricks-ownership-2026-08") — the match key for "this is the same charter, re-uploaded". */
  client_ref?: string;
  project?: {
    name?: string;
    team?: string;
    owner?: string;
    business_value?: string;
    start?: string;
    end?: string;
    committed?: string;
  };
  metrics?: Array<{ metric?: string; target?: string; source?: string }>;
  phases?: Array<{ name?: string; start?: string; end?: string; status?: string; metric?: string; target?: string }>;
  charter?: {
    summary?: string;
    why_now?: string;
    risks?: Array<{ risk?: string; mitigation?: string }>;
  };
};

function mapPhaseStatus(status?: string): ProjectPhaseStatus {
  if (status === "Done") return "done";
  if (status === "Not started") return "not_started";
  // "On track" / "At risk" / "Slipped" — this schema tracks health nuance at the project level
  // via `health`, not per-phase, so every other charter status collapses to "in_progress".
  return "in_progress";
}

function buildDraft(payload: CharterPayload): Partial<AddProjectValues> {
  const p = payload.project ?? {};
  const metricLines = (payload.metrics ?? [])
    .map((m) => (m.metric ? `${m.metric}: target ${m.target || "—"} (source: ${m.source || "—"})` : null))
    .filter(Boolean)
    .join("\n");
  return {
    project_name: p.name || "",
    start_date: p.start || "",
    target_date: p.end || "",
    committed_date: p.committed || "",
    problem_context: payload.charter?.summary || "",
    objective: payload.charter?.why_now || "",
    expected_outcome: p.business_value || "",
    success_metrics: metricLines,
  };
}

function buildPendingImport(payload: CharterPayload): PendingCharterImport {
  const phases = (payload.phases ?? [])
    .filter((ph) => ph.name)
    .map((ph) => ({
      name: ph.name as string,
      description: ph.metric ? `${ph.metric} — target: ${ph.target || "—"}` : "",
      status: mapPhaseStatus(ph.status),
      start_date: ph.start || "",
      target_date: ph.end || "",
    }));
  const risks = (payload.charter?.risks ?? [])
    .filter((r) => r.risk)
    .map((r) => ({ risk: r.risk as string, mitigation: r.mitigation || "" }));
  return { phases, risks };
}

function buildCreateBanner(payload: CharterPayload): string | undefined {
  const team = payload.project?.team;
  const owner = payload.project?.owner;
  if (!team && !owner) return undefined;
  return `Imported from a charter. Team and Owner aren't auto-filled — the charter said Team: ${team || "—"}, Owner: ${owner || "—"}. Pick the real team and enter the owner below.`;
}

function buildUpdateBanner(existing: Project): string {
  return `This charter was already imported as "${existing.project_name}". Re-uploading it will update that project's Problem/Objective/dates/etc. — phases and risks are left as-is.`;
}

/** Fields the charter never covers (Team/Owner/Stakeholders/Priority — the tracker's own real
 * values, entered by hand after the first import, per the create flow's own banner). On an
 * update, `buildDraft`'s charter fields are merged ON TOP of this, not the other way round — the
 * form must start from what's already on the project, or submitting would silently blank these
 * back out via the PATCH, wiping real data the charter was never responsible for setting. */
function draftFromExisting(existing: Project): Partial<AddProjectValues> {
  return {
    owning_team: existing.owning_team,
    owner: existing.owner,
    contributors: existing.contributors.join(", "),
    urgent: existing.urgent,
    important: existing.important,
  };
}

/** The landing page's write actions — "Add Project" plus "Upload Charter" (her manager's separate
 * Claude Skill prints a static charter HTML page with an embedded tracker-payload JSON block; its
 * own footer says to upload it here). A charter upload never auto-creates a project — it just
 * pre-fills the same Add Project panel with whatever maps cleanly, since the charter's Team/Owner
 * vocabulary doesn't match this tracker's real fields. Self-contained so `page.tsx` (a server
 * component) doesn't need to hold client state of its own. */
export function AddProjectLauncher({
  teams,
  defaultTeam,
  projects,
}: {
  teams: TeamConfig[];
  defaultTeam?: string;
  /** Full, unfiltered project list — used to match a re-uploaded charter back to the project it
   * already created, by `charter_client_ref`, regardless of which team pill is active. */
  projects: Project[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<AddProjectValues> | undefined>(undefined);
  const [pendingImport, setPendingImport] = useState<PendingCharterImport | undefined>(undefined);
  const [importBanner, setImportBanner] = useState<string | undefined>(undefined);
  const [updateProjectId, setUpdateProjectId] = useState<string | undefined>(undefined);
  const [charterRef, setCharterRef] = useState<string | undefined>(undefined);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function openBlank() {
    setDraft(undefined);
    setPendingImport(undefined);
    setImportBanner(undefined);
    setUpdateProjectId(undefined);
    setCharterRef(undefined);
    setUploadError(null);
    setOpen(true);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a failed attempt
    if (!file) return;

    setUploadError(null);
    try {
      const text = await file.text();
      const match = text.match(TRACKER_PAYLOAD_RE);
      if (!match) throw new Error("No tracker-payload block found in this file.");
      const payload = JSON.parse(match[1]) as CharterPayload;
      if (payload.kind !== "ops-project-charter") {
        throw new Error("This file isn't a recognized project charter.");
      }

      const ref = payload.client_ref?.trim();
      const existing = ref ? projects.find((p) => p.charter_client_ref === ref) : undefined;

      if (existing) {
        // Same charter, re-uploaded: update the project it already created rather than making a
        // duplicate. Team/Owner/Stakeholders/Priority come from the EXISTING row first, then the
        // charter's own fields (name/dates/one-pager) are merged on top — see draftFromExisting's
        // own note on why the order matters. Phases/risks are intentionally NOT re-imported here.
        setDraft({ ...draftFromExisting(existing), ...buildDraft(payload) });
        setPendingImport(undefined);
        setUpdateProjectId(existing.project_id);
        setCharterRef(undefined);
        setImportBanner(buildUpdateBanner(existing));
      } else {
        setDraft(buildDraft(payload));
        setPendingImport(buildPendingImport(payload));
        setUpdateProjectId(undefined);
        setCharterRef(ref);
        setImportBanner(buildCreateBanner(payload));
      }
      setOpen(true);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not read this charter file.");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 self-start">
        <button type="button" onClick={openBlank} className="btn-primary">
          <Plus className="w-4 h-4" />
          Add Project
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-secondary">
          <Upload className="w-4 h-4" />
          Upload Charter
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".html,.htm"
          onChange={handleFile}
          className="hidden"
          aria-hidden="true"
        />
      </div>
      {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}

      <AddProjectPanel
        open={open}
        onClose={() => setOpen(false)}
        teams={teams}
        defaultTeam={defaultTeam}
        initialDraft={draft}
        pendingImport={pendingImport}
        importBanner={importBanner}
        updateProjectId={updateProjectId}
        charterRef={charterRef}
      />
    </>
  );
}
