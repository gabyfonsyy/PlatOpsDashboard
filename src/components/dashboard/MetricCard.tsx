import { Info } from "lucide-react";

export function MetricCard({
  label,
  value,
  sublabel,
  tooltip,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tooltip?: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</p>
        {tooltip && (
          <span className="group relative inline-flex">
            <Info className="w-3.5 h-3.5 text-neutral-300 hover:text-neutral-500 cursor-help transition-colors" />
            <span
              role="tooltip"
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56
                         rounded-lg bg-neutral-900 text-white text-[11px] leading-snug font-normal normal-case tracking-normal
                         px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-30 shadow-lg"
            >
              {tooltip}
            </span>
          </span>
        )}
      </div>
      <p className="text-2xl font-semibold text-neutral-900 mt-1">{value}</p>
      {sublabel && <p className="text-xs text-neutral-400 mt-1">{sublabel}</p>}
    </div>
  );
}
