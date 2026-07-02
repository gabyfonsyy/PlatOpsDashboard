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
  Project Tracker, team config, Gemini insight cache).
- **Backend:** a standalone Google Apps Script project (`gas/`) — syncs Jira on a
  schedule, precomputes rollups so the frontend never scans raw ticket rows, exposes a
  JSON Web App API, and generates daily Gemini narrative insights.
- **Frontend:** this Next.js app — per-team dashboards (SE/DBA/DevOps), a cross-team
  rollup, a performance/eval view, and manager-entered Leave/RTO/Project trackers.

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

All planned milestones (Jira sync, aggregation/metrics API, dashboard UI, Gemini
insights) are code-complete. What's outstanding is entirely on the deployment side —
see `gas/README.md`'s step-by-step: create the Apps Script project, set Script
Properties (including your dedicated Jira token and a Gemini API key), run
`setupAll()`, run `runInitialBackfill()` for the 2-year historical load, deploy the Web
App, then point this frontend's env vars at it.
