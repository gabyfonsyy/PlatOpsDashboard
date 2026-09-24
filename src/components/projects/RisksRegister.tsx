"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { RISK_LEVEL_META, RISK_LEVELS, RISK_STATUSES, type ProjectRisk, type RiskLevel } from "@/lib/project-tracking";
import { Copy } from "@/components/ui/Copy";

const RISK_STATUS_LABEL: Record<string, string> = { open: "Open", mitigated: "Mitigated", closed: "Closed" };

export function RisksRegister({ projectId, risks }: { projectId: string; risks: ProjectRisk[] }) {
  const router = useRouter();
  const [risk, setRisk] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, payload: Record<string, unknown>) {
    await fetch("/api/project-tracking/risks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...payload }),
    });
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this risk?")) return;
    await fetch("/api/project-tracking/risks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  async function addRisk(e: React.FormEvent) {
    e.preventDefault();
    if (!risk.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/project-tracking/risks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, risk: risk.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      setRisk("");
      router.refresh();
    } catch (err) {
      setError(`Could not add risk: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {risks.length === 0 && (
        <p className="text-sm text-neutral-400">
          <Copy serious="No risks logged yet." playful="Skies clear — no risks logged yet." />
        </p>
      )}
      {risks.map((r) => (
        <div key={r.id} className="bg-surface rounded-md border border-neutral-200 p-3 flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <textarea
              defaultValue={r.risk}
              rows={2}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== r.risk) patch(r.id, { risk: next });
              }}
              className="form-input flex-1 text-sm resize-y"
              aria-label="Risk"
            />
            <button
              onClick={() => remove(r.id)}
              className="text-neutral-400 hover:text-red-600 transition-colors shrink-0"
              aria-label="Delete risk"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={r.impact}
              onChange={(e) => patch(r.id, { impact: e.target.value || null })}
              className="form-input w-auto text-xs py-1"
              aria-label="Impact"
            >
              <option value="">Impact: —</option>
              {RISK_LEVELS.map((l) => (
                <option key={l} value={l}>Impact: {RISK_LEVEL_META[l as Exclude<RiskLevel, "">].label}</option>
              ))}
            </select>
            <select
              value={r.likelihood}
              onChange={(e) => patch(r.id, { likelihood: e.target.value || null })}
              className="form-input w-auto text-xs py-1"
              aria-label="Likelihood"
            >
              <option value="">Likelihood: —</option>
              {RISK_LEVELS.map((l) => (
                <option key={l} value={l}>Likelihood: {RISK_LEVEL_META[l as Exclude<RiskLevel, "">].label}</option>
              ))}
            </select>
            <select
              value={r.status}
              onChange={(e) => patch(r.id, { status: e.target.value })}
              className="form-input w-auto text-xs py-1"
              aria-label="Status"
            >
              {RISK_STATUSES.map((s) => (
                <option key={s} value={s}>{RISK_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <input
            defaultValue={r.owner}
            onBlur={(e) => e.target.value !== r.owner && patch(r.id, { owner: e.target.value })}
            placeholder="Owner"
            className="form-input text-sm"
          />
          <textarea
            defaultValue={r.mitigation}
            rows={2}
            onBlur={(e) => e.target.value !== r.mitigation && patch(r.id, { mitigation: e.target.value })}
            placeholder="Mitigation"
            className="form-input text-sm resize-y"
          />
        </div>
      ))}

      <form onSubmit={addRisk} className="flex items-center gap-2 mt-1">
        <input
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
          placeholder="e.g. Vendor API rate limits"
          className="form-input flex-1 text-sm py-1.5"
        />
        <button type="submit" disabled={submitting || !risk.trim()} className="btn-secondary text-sm py-1.5">
          {submitting ? "Adding…" : "+ Add risk"}
        </button>
      </form>
      {error && <p className="form-error mt-1">{error}</p>}
    </div>
  );
}
