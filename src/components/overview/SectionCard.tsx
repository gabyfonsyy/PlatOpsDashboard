import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The Overview's one container. Every section on the page is one of these, which is most of what
 * makes the page scannable: identical header rhythm, identical padding, so the eye learns the
 * shape once and then only reads the contents.
 *
 * `action` is the link back to the module the section aggregates. The Overview never owns data, so
 * every section has somewhere to go.
 */
export function SectionCard({
  title,
  subtitle,
  action,
  aside,
  tone = "default",
  children,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; href: string };
  /** Rendered top-right, before the action — for timestamps, counts, a regenerate button. */
  aside?: ReactNode;
  tone?: "default" | "attention";
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "card p-5 flex flex-col gap-4",
        // The attention section is the only one allowed to shout, and it does it with a hairline
        // rather than a filled panel — a page of coloured blocks has no hierarchy left to spend.
        tone === "attention" && "ring-1 ring-amber-200/70"
      )}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
          {subtitle && <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {aside}
          {action && (
            <Link
              href={action.href}
              className="text-xs text-sprout-700 hover:underline inline-flex items-center gap-1"
            >
              {action.label}
              <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * What a section shows when it has nothing to show. Distinct from ModulePlaceholder: this means
 * "we looked and there was nothing", which is a real, reassuring answer.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-neutral-400">{children}</p>;
}
