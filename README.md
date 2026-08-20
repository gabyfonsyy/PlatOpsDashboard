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
  rollup, a performance/eval view, manager-entered Leave/RTO/Project trackers, and
  Incident Logs.
- **AI:** one provider throughout — open-weight models (Llama 3.3 70B by default) hosted on
  Groq, via the OpenAI-compatible chat API. Apps Script owns the scheduled narrative insights
  (`gas/AiClient.gs`); this app owns the interactive incident-feedback rewriting
  (`src/lib/ai.ts`), so the call the manager waits on is one hop rather than two. Replaced
  Gemini in full — `GEMINI_API_KEY` is no longer used anywhere.

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
