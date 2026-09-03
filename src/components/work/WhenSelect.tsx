"use client";

import { addIsoDays, nextMondayIso } from "@/lib/work";

/**
 * When a new task is for. Today and tomorrow are one click because they're the two answers almost
 * every time; "Next Mon" exists because "not this week" is the third; and the date field only
 * appears when none of those is the answer, so the common path stays one select rather than a
 * calendar you have to think about.
 *
 * Its own file rather than living in TaskBoard (where it was written) because AddTaskDialog needs
 * it too, and TaskBoard already imports AddTaskDialog — importing it back would be a cycle.
 */
export function WhenSelect({
  today,
  value,
  onChange,
}: {
  today: string;
  value: string;
  onChange: (date: string) => void;
}) {
  const tomorrow = addIsoDays(today, 1);
  const monday = nextMondayIso(today);
  const presets = [
    { key: today, label: "Today" },
    { key: tomorrow, label: "Tomorrow" },
    // Skipped when next Monday IS tomorrow — two options for the same day is just a puzzle.
    ...(monday !== tomorrow ? [{ key: monday, label: "Next Mon" }] : []),
  ];
  const isPreset = presets.some((p) => p.key === value);

  return (
    <>
      <select
        value={isPreset ? value : "custom"}
        onChange={(e) => onChange(e.target.value === "custom" ? addIsoDays(today, 7) : e.target.value)}
        className="form-input w-auto text-sm"
        aria-label="When"
      >
        {presets.map((p) => (
          <option key={p.key} value={p.key}>{p.label}</option>
        ))}
        <option value="custom">Pick a date…</option>
      </select>
      {!isPreset && (
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value || today)}
          className="form-input w-auto text-sm"
          aria-label="Date for new task"
        />
      )}
    </>
  );
}
