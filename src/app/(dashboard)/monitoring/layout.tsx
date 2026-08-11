import { MonitoringSidebar } from "@/components/layout/MonitoringSidebar";

export default function MonitoringLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row gap-6">
      <MonitoringSidebar />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
