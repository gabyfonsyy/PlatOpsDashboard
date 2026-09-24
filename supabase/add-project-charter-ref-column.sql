-- One-time migration: adds `charter_client_ref` to the live `projects` table. `schema.sql`'s
-- `create table projects` has been updated to match for a fresh install -- an existing database
-- needs the ALTER statement below. Run once in the Supabase SQL editor.
--
-- Backs re-uploading a REVISED charter for a project that was already imported: the charter's own
-- `client_ref` (a stable id her manager's charter-generating skill assigns per charter, e.g.
-- "databricks-ownership-2026-08") gets stored here on first import, so a later upload of the same
-- charter can find the existing project by this column and update it instead of creating a
-- duplicate. See AddProjectLauncher.tsx.
--
-- Safe to re-run: a no-op if already applied.

alter table projects add column if not exists charter_client_ref text;
