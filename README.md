# Platform Operations Dashboard

Jira ticket metrics, project tracking, leave, and RTO visibility across SE, DBA, and
DevOps — for Monthly/Quarterly/Annual Business Reviews and performance evaluations.
Standalone from Operations Hub and Jira Tagging: own repo, own Vercel deployment, own
dedicated Jira API token.

## Architecture

```
Jira Cloud  --(JQL + changelog, incremental sync)-->  Apps Script (Google Sheets backend)
                                                              |  JSON over HTTPS
                                                              v
                                                     Next.js 14 (Vercel)
                                                     Google OAuth (@sprout.ph only)
```

- **Database:** two Google Sheets — `PlatOps - Jira Data` (raw ticket rows, sharded by
  team+year, plus precomputed metrics tables) and `PlatOps - Manager Data` (Leave, RTO,
  Project Tracker, team config, incident logs, AI insight cache).
- **Backend:** a standalone Google Apps Script project (`gas/`) — syncs Jira on a
  schedule, precomputes rollups so the frontend never scans raw ticket rows, exposes a
  JSON Web App API, and generates daily narrative insights.
- **Frontend:** this Next.js app — per-team dashboards (SE/DBA/DevOps), a cross-team
  rollup, a performance/eval view, manager-entered Leave/RTO/Project trackers, Incident
  Logs, and My Work — a personal command centre for today's work and the days ahead.
- **Theming:** three modes (Light / Dark / Gaby's View) via `data-theme` on `<html>`. Every
  colour is a CSS variable, and the neutral ramp inverts for the dark themes, so ~440 existing
  `neutral-*`/`sprout-*` usages repaint with no component edits. Gaby's View is a **spacecraft**:
  deep-space ground, a nebula bloom, a static star field, a periwinkle-indigo accent (a hue
  rotation of the old magenta ramp — same lightness at every step, so contrast behaviour is
  unchanged), and stardust sparks on the cursor. It also **renames the navigation** — see
  *Two names per page* below. The personality layer ships as a **separate lazy chunk** and is never
  loaded in Light or Dark. It respects `prefers-reduced-motion`, with a visible one-click override
  so the OS setting can't silently disable a mode you deliberately chose.
- **Two names per page:** `src/lib/nav.ts` carries a plain name and a flight-deck name for every
  page — My Work / Mission Control, Leave / Shore Leave, RTO / Re-entry, Projects / Missions,
  Incident Logs / Black Box, Ticket Monitoring / Radar, Teams / Crew. **Both** strings are rendered
  and CSS shows one (`<Copy>`, `.copy-serious` / `.copy-playful`), rather than reading the theme in
  JS: the theme is applied by a pre-hydration script, so a JS-driven label would render the plain
  name on the server and snap to the playful one on hydration — a visible flicker across the whole
  nav on every page load. It also lets server components use the names without theme context. URLs,
  tables and API routes always follow the plain name.
- **Motion has a budget in Gaby's View.** Nothing full-viewport is allowed to animate forever:
  `.card` is `backdrop-filter`, and an animating fixed layer invalidates the backdrop of every
  blurred surface above it on every frame — permanent GPU load for as long as the tab is open. So
  the star field and nebula are static, one-shot fade-in only; the ambient "good news" pulse is
  `box-shadow` rather than `transform` (a transform on a filtered element re-blurs its backdrop);
  badges inside tables don't animate on mount (a page renders up to 113 of them); blur radius is
  10px on cards and off entirely on inputs, where it was invisible anyway. The one moving thing is
  the cursor canvas, which is capped, sprite-based, self-stopping, and leaves the layer tree when
  idle.
- **AI:** one provider throughout — open-weight models (Llama 3.3 70B by default) hosted on
  Groq, via the OpenAI-compatible chat API. Apps Script owns the scheduled narrative insights
  (`gas/AiClient.gs`); this app owns the interactive incident-feedback rewriting
  (`src/lib/ai.ts`), so the call the manager waits on is one hop rather than two. Replaced
  Gemini in full — `GEMINI_API_KEY` is no longer used anywhere.

## AI usage policy

Groq is on a free/limited tier, so AI is treated as a scarce resource. **The dashboard is fully
functional with AI switched off** — every number on every page is computed by ordinary queries.

### The rule

**Opening, refreshing, or navigating to a page NEVER makes an AI request.** There is no
page-load, timer, poll, or prefetch path to the model anywhere in the app. Every AI call
originates from a button a person pressed.

### Where AI runs, and where it doesn't

| Page | AI | Trigger |
|---|---|---|
| Incident Logs | yes | "Rephrase with AI" in the log dialog |
| Mission Control | yes | "What have you noticed?" in Work Mirror |
| Team dashboards / Overview | yes | "Generate insight" on the insight panel |
| Leave | **no** | — |
| RTO | **no** | — |
| Projects | **no** | deterministic metrics only |
| Ticket Monitoring | **no** | deterministic metrics only |

Nothing that can be counted, averaged, or compared is sent to a model. Ticket counts, aging,
resolution times, compliance percentages, incident tallies, project completion, score impacts and
trends are all plain queries — an LLM would be slower, costlier and less reliable at all of them.

AI is used only where the answer requires relating several independent signals, which is the one
thing code can't do for us: rewriting a blunt note into shareable feedback, and finding patterns
across weeks of duration/throughput/mood data.

### Expected daily cost

| Activity | Requests |
|---|---|
| Browsing any page, any number of times | **0** |
| Adding, editing, completing tasks | **0** |
| Viewing incidents and their stored feedback | **0** |
| Syncing Jira, refreshing data | **0** |
| Writing up one incident with AI help | 1 |
| Asking Work Mirror, or generating a team insight | 1 each |

### How that's enforced

**No scheduled AI.** `installTriggers` deliberately does not create a trigger for
`generateInsightsAllTeams`, and actively deletes one if it exists. It previously ran daily at
06:00 — 4 requests every day (3 teams + rollup), ~1,460 a year, generating paragraphs whether
anyone read them or not.

**Everything generated is stored and re-served.** Incident rewrites live in `INCIDENT_LOGS`
(`feedback_polished`, `improvements`, `categories_json`, `ai_model`, `ai_generated_at`). Team
narratives live in `INSIGHTS_CACHE`. Work Mirror observations live in `ai_insight_cache`. Later
views read storage, never the model.

**Regeneration is gated on the data actually changing.** Each cached insight stores a
`source_version` — a hash of exactly the payload that was sent. Ask again with unchanged inputs
and the stored answer is returned with `aiCalls: 0`. Because the fingerprint covers the
*aggregated* figures rather than raw rows, one extra ticket that doesn't move any of them does not
invalidate anything.

**Cheap and paying actions are different buttons.** "Generate/Refresh insight" takes the cached
path; "Regenerate" is what forces a request. The UI states which happened ("Already up to date —
no AI request used", "Served from cache").

**Duplicate requests are blocked** by in-flight guards on every AI button, plus a content check:
"Rephrase with AI" goes inert and reads "Drafted" while the note is unchanged, so the app's
most-used AI feature can't be double-spent by a double-click or a re-render.

**Prompts carry aggregates, never raw data.** Deterministic rollups are computed first and only
those numbers are sent. Nothing sends a table dump, and no prompt grows with the size of the
database.

**Model tiers are explicit** (`AI_MODELS` in both `src/lib/ai.ts` and `gas/AiClient.gs`):
`fast` = Llama 3.1 8B for rewriting, classifying and narrating pre-computed numbers; `deep` =
Llama 3.3 70B reserved for Work Mirror's multi-variable correlation. Defaulting to the big model
is the expensive habit, so the tier is chosen per call site.

**AI failure is never app failure.** Rate limits, outages and errors surface as a small inline
message; cached insights stay on screen and every page keeps working.

### Adding AI later

Answer this first: **what can a model tell me here that ordinary code cannot?** If that's not
obvious, don't. Three excellent, rarely-invoked AI features beat seven pages of AI-generated
filler burning the quota.

### My Work (Mission Control in Gaby's View)

A personal command centre at `/my-work` — the app's home: the brand mark in the header and the
post-login redirect both land here. Workday start/end, a low-friction to-do board for today, an
**Ahead** panel for work planned on later days, a lightweight project strip, a 30-second
end-of-day check-in, and **Work Mirror** — an AI pass over your own tracked history.

(`/mission-control` existed briefly as the route and permanently redirects here.)

**Repeating tasks.** A recurrence is a rule (`work_recurrences`), and its instances are
materialised into `work_tasks` as ordinary rows — so the board, Ahead, the lifecycle stamps, the
day rollups and Work Mirror all keep working untouched, because by the time anything reads it, a
recurring task *is* a task. Four frequencies (daily / weekdays / weekly / monthly), each one line
of arithmetic; a full RRULE engine is a library, not a column. Instances are created 14 days ahead,
idempotently, via a unique index on `(recurrence_id, work_date)` — so two tabs opening the page on
the same morning can't both create that day's copy. Monthly on the 31st **skips** short months
rather than clamping to the 28th. Pause is the primary action on a rule (and immediately gives up
the future copies it had already placed); deleting a rule keeps the days it already produced.
Untouched instances older than yesterday are swept to Deferred, so a skipped daily habit doesn't
accumulate in "still open from earlier" forever.

**Planning ahead.** A task's `work_date` is the schedule — dating one in the future keeps it off
today's board and files it under Ahead, grouped by day, until it arrives. Nothing rolls over on
its own: work still open from an earlier day appears in Ahead under "Still open from earlier" with
a one-click *bring all to today*, so today's list is always something that was chosen rather than
inherited. The board and Ahead share one optimistic store, so rescheduling a task moves it between
them in the same frame.

Unlike every other manager-entered surface (Leave, RTO, Incident Logs), this one stores in
**Supabase rather than the Apps Script/Sheets backend**. It's the one page where latency is the
feature: a GAS Web App round-trip runs 2–40s, and a to-do list that takes seconds to tick a
checkbox is one nobody opens twice. Supabase writes land in ~100–300ms, and the board updates
optimistically on top of that.

**Setup:** run `supabase/my-work.sql` in the Supabase SQL editor. It's idempotent, so re-run it
whenever it changes — the recurring-tasks tables were added to it later than the rest. Until it's
run the page shows a one-line instruction instead of breaking; if only the recurrence part is
missing, everything else on the page works and just the Repeating list explains itself.

The schema keeps every lifecycle timestamp (session start/end, task created/started/completed/
deferred, task→project links, daily mood + factors + free text) because Work Mirror's job is
finding patterns across weeks. Anything storing only "current status" makes that impossible after
the fact.

Work Mirror computes its aggregates **deterministically in TypeScript** and passes only those
numbers to the model — same discipline as the narrative insights. The model describes; it never
calculates. Its output is split into `pattern` (checkable against the numbers) and
`interpretation` (explicitly hedged), and it's forbidden from giving advice. It also refuses to
speak below ~5 tracked days, because any model will produce confident nonsense from three.

### Incident Logs

Marking a ticket as a valid incident happens in Jira: the manager sets the **Report Tagging**
field (`customfield_10262`), and a sync pulls every tagged ticket in as a row to write up.
The dashboard is read-only against Jira — feedback never leaves it.

Each incident carries one log *per person implicated*, because an SE incident can be the
doer's, the validator's, or both, and each needs its own severity and its own feedback.
Severity is a fixed rubric that deducts from that person's evaluation (S1 Critical -3,
S2 Major -2, S3 Minor -1.5, S4 Low -1), always recomputed server-side from the code so it
cannot drift.

The manager writes the blunt version; the AI rewrites it into something shareable (neutral,
professional, warm), suggests concrete improvements, and classifies it into a **closed** set of
concern categories — closed on purpose, since an open-ended model emits "Communication",
"Comms", and "Communication Skills" across three tickets and the rollup stops meaning anything.
Both versions are stored: the raw note stays private and verbatim, the rewrite is what is shown.

See `gas/README.md` for full backend deployment steps — **that setup must happen
before this frontend will show real data.**

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in NEXTAUTH_*, GOOGLE_CLIENT_*, GAS_*
npm run dev
```

Without `GAS_WEB_APP_URL`/`GAS_API_KEY` configured, pages degrade gracefully (empty
states) rather than crashing — useful for iterating on UI before the backend is live.

## Deploying

Push to GitHub, import into Vercel, set the same env vars from `.env.local.example` in
the Vercel project settings. Use a dedicated Google OAuth client (don't reuse
Operations Hub's).

## Status

All planned milestones (Jira sync, aggregation/metrics API, dashboard UI, AI
insights, Incident Logs) are code-complete. What's outstanding is entirely on the
deployment side — see `gas/README.md`'s step-by-step: create the Apps Script project, set
Script Properties (including your dedicated Jira token and an `AI_API_KEY`), run
`setupAll()`, run `runInitialBackfill()` for the 2-year historical load, deploy the Web
App, then point this frontend's env vars at it.
