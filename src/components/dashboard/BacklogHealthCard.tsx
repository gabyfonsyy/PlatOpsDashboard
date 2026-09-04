"use client";

import { AlertTriangle, Eye, CheckCircle2, Activity } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Badge } from "@/components/ui/Badge";
import type { BacklogHealthStatus, BacklogHealthSignal } from "@/lib/backlog-aging";

const STATUS_META: Record<BacklogHealthStatus, { label: string; tone: "success" | "warning" | "danger" }> = {
  healthy: { label: "Healthy", tone: "success" },
  watch: { label: "Watch", tone: "warning" },
  atRisk: { label: "At Risk", tone: "danger" },
};

const TONE_META: Record<BacklogHealthSignal["tone"], { icon: typeof AlertTriangle; className: string }> = {
  negative: { icon: AlertTriangle, className: "text-red-600" },
  watch: { icon: Eye, className: "text-amber-700" },
  positive: { icon: CheckCircle2, className: "text-emerald-700" },
};

function renderBoldSegments(text: string) {
  const segments = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  if (segments.length === 1) return text;
  return segments.map((segment, i) =>
    segment.startsWith("**") && segment.endsWith("**") ? (
      <strong key={i} className="font-semibold text-neutral-900">
        {segment.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{segment}</span>
    )
  );
}

/**
 * Healthy/Watch/At-Risk with the CONCRETE reasons that fired (brief section 14: never an
 * unexplained score like "72/100"). buildBacklogHealth() computes the status and signal list
 * server-side from real deltas/shares — this component only renders what it's given.
 */
export function BacklogHealthCard({ status, signals, title }: { status: BacklogHealthStatus; signals: BacklogHealthSignal[]; title?: string }) {
  const { theme } = useTheme();
  const gaby = theme === "adhd";
  const meta = STATUS_META[status];

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-sprout-600" />
        <h3 className="text-sm font-semibold text-neutral-900">{title ?? "Backlog Health"}</h3>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <ul className="space-y-2.5">
        {signals.map((s, i) => {
          const m = TONE_META[s.tone];
          const Icon = m.icon;
          return (
            <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
              <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${m.className}`} />
              <span>{renderBoldSegments(gaby ? s.text.gaby : s.text.professional)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
