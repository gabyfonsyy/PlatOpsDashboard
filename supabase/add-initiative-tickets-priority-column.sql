-- One-time migration: adds `priority` to the live `initiative_tickets` table. schema.sql only
-- reflects this for a FRESH install (`create table`) — an existing database needs the ALTER
-- statement below. Run this once in the Supabase SQL editor.
--
-- Backs the Records -> Project Tracking phase/ticket-linking work, which shows a linked ticket's
-- priority. Populated by the regular GAS sync going forward (gas/InitiativesSync.gs's
-- syncInitiativeTickets now requests Jira's priority field) — existing rows get it filled in on
-- their next sync (full re-pull each run, no separate backfill needed).
--
-- Safe to re-run: a no-op if already applied.

alter table initiative_tickets add column if not exists priority text;
