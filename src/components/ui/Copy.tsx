/**
 * Theme-aware microcopy WITHOUT client JS.
 *
 * Both strings render; `.copy-serious` / `.copy-playful` in globals.css show one and hide the
 * other based on `[data-theme="adhd"]`. That matters because most of the copy worth making
 * playful lives in server components (empty states, page headers), which have no access to theme
 * context — and swapping text after hydration would flash the wrong wording.
 *
 * Rule of thumb for using this: never on operational values, error text, or anything a person
 * would read while diagnosing a real incident. Empty states, idle states and success confirmations
 * only. `serious` must always be complete on its own.
 */
export function Copy({ serious, playful }: { serious: string; playful: string }) {
  return (
    <>
      <span className="copy-serious">{serious}</span>
      <span className="copy-playful">{playful}</span>
    </>
  );
}
