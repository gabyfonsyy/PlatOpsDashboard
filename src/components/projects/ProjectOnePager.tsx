import type { Project } from "@/lib/project-tracking";

const FIELDS: Array<{ key: keyof Project; label: string }> = [
  { key: "problem_context", label: "Problem" },
  { key: "objective", label: "Objective" },
  { key: "expected_outcome", label: "Expected Outcome" },
  { key: "scope", label: "Scope" },
  { key: "out_of_scope", label: "Out of Scope" },
  { key: "success_metrics", label: "Success Metrics" },
];

/** Read-only rendering of a project's one-pager (Phase 1's 6 free-text fields). Its own component,
 * typed to `Project` — this is Records data, not My Work's `WorkProject`/`BriefSummary`, and the
 * two must never be conflated even though the six-question shape reads the same. */
export function ProjectOnePager({ project }: { project: Project }) {
  const filled = FIELDS.filter((f) => String(project[f.key] ?? "").trim());
  if (filled.length === 0) {
    return <p className="text-sm text-neutral-400 italic">No one-pager filled in yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {filled.map((f) => (
        <div key={f.key}>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">{f.label}</p>
          <p className="text-sm text-neutral-800 whitespace-pre-wrap leading-relaxed">
            {String(project[f.key])}
          </p>
        </div>
      ))}
    </div>
  );
}
