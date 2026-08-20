"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PageName } from "@/components/ui/PageTitle";

const MONITORING_NAV_ITEMS = [
  { href: "/monitoring/late-pickup", label: "Account Creation Review" },
  { href: "/monitoring/peer-review-wait", label: "Review Wait Time" },
  { href: "/monitoring/tool-assisted", label: "Tool-Assisted Efficiency" },
];

export function MonitoringSidebar() {
  const pathname = usePathname();

  return (
    <nav className="sm:w-56 shrink-0">
      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide px-3 mb-2">
        <PageName page="monitoring" />
      </p>
      <div className="flex sm:flex-col gap-1 overflow-x-auto sm:overflow-visible">
        {MONITORING_NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
                active ? "bg-sprout-50 text-sprout-700" : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
