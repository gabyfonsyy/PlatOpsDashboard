export function MetricCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold text-neutral-900 mt-1">{value}</p>
      {sublabel && <p className="text-xs text-neutral-400 mt-1">{sublabel}</p>}
    </div>
  );
}
