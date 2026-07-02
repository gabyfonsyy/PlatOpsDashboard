import { cn } from "@/lib/utils";

const TONES = {
  neutral: "bg-neutral-100 text-neutral-600",
  warning: "bg-amber-100 text-amber-700",
  success: "bg-sprout-100 text-sprout-700",
  danger: "bg-red-100 text-red-700",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONES;
}) {
  return <span className={cn("badge mr-1 last:mr-0", TONES[tone])}>{children}</span>;
}
