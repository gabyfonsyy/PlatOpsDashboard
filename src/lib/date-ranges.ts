export type RangeType = "week" | "month" | "quarter" | "year";

/**
 * Period label formats — kept in lockstep with gas/MetricsApi.gs's resolvePeriodToDateRange_:
 * week "YYYY-Www" (ISO week), month "YYYY-MM", quarter "YYYY-Qn", year "YYYY".
 */
export function getIsoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function defaultPeriodForRange(range: RangeType, date: Date = new Date()): string {
  switch (range) {
    case "week": {
      const { year, week } = getIsoWeek(date);
      return `${year}-W${String(week).padStart(2, "0")}`;
    }
    case "month":
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    case "quarter": {
      const q = Math.floor(date.getMonth() / 3) + 1;
      return `${date.getFullYear()}-Q${q}`;
    }
    case "year":
      return String(date.getFullYear());
  }
}

export function resolveFilters(searchParams: Record<string, string | string[] | undefined>) {
  const rawRange = typeof searchParams.range === "string" ? searchParams.range : "month";
  const range: RangeType = ["week", "month", "quarter", "year"].includes(rawRange) ? (rawRange as RangeType) : "month";
  const period = typeof searchParams.period === "string" ? searchParams.period : defaultPeriodForRange(range);
  const issueType = typeof searchParams.issueType === "string" ? searchParams.issueType : undefined;
  return { range, period, issueType };
}

export function shiftPeriod(range: RangeType, period: string, direction: 1 | -1): string {
  if (range === "month") {
    const [y, m] = period.split("-").map(Number);
    return defaultPeriodForRange("month", new Date(y, m - 1 + direction, 1));
  }
  if (range === "quarter") {
    const [yStr, qStr] = period.split("-Q");
    let year = Number(yStr);
    let q = Number(qStr) + direction;
    if (q < 1) { q = 4; year -= 1; }
    if (q > 4) { q = 1; year += 1; }
    return `${year}-Q${q}`;
  }
  if (range === "year") {
    return String(Number(period) + direction);
  }
  // week
  const [yStr, wStr] = period.split("-W");
  const year = Number(yStr);
  const week = Number(wStr);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day);
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (week - 1) * 7 + direction * 7);
  return defaultPeriodForRange("week", monday);
}

export function formatPeriodLabel(range: RangeType, period: string): string {
  if (range === "month") {
    const [y, m] = period.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (range === "quarter") return period.replace("-", " ");
  if (range === "week") {
    const [y, w] = period.split("-W");
    return `Week ${w}, ${y}`;
  }
  return period;
}
