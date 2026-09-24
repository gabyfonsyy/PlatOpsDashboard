import { ONE_PAGER_FIELDS, type Project } from "@/lib/project-tracking";
import { Copy } from "@/components/ui/Copy";

/** Read-only rendering of a project's one-pager: Stakeholders (`contributors`, added later than
 * the rest but always meant to live here — it just never had a display until now) + the six
 * one-pager text fields (`ONE_PAGER_FIELDS`, shared with the Add Project flow and the AI review
 * route so all three agree on what "the one-pager" means). Its own component, typed to `Project`
 * — this is Records data, not My Work's `WorkProject`/`BriefSummary`, and the two must never be
 * conflated even though the six-question shape reads the same. */
export function ProjectOnePager({ project }: { project: Project }) {
  const stakeholders = project.contributors.filter((s) => s.trim());
  const filled = ONE_PAGER_FIELDS.filter((f) => String(project[f.key] ?? "").trim());

  if (stakeholders.length === 0 && filled.length === 0) {
    return (
      <p className="text-sm text-neutral-400 italic">
        <Copy serious="No one-pager filled in yet." playful="One-pager's still a blank page." />
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {stakeholders.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">Stakeholders</p>
          <p className="text-sm text-neutral-800 leading-relaxed">{stakeholders.join(", ")}</p>
        </div>
      )}
      {filled.map((f) => {
        const value = String(project[f.key]);
        return (
          <div key={f.key}>
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">{f.label}</p>
            {f.key === "success_metrics" ? (
              <ul className="list-disc list-outside pl-4 text-sm text-neutral-800 leading-relaxed marker:text-sprout-500">
                {value.split("\n").map((line) => line.trim()).filter(Boolean).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-800 whitespace-pre-wrap leading-relaxed">{value}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
