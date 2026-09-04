"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, AlertTriangle, Check, X, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { celebrate } from "@/lib/celebrate";
import { Badge } from "@/components/ui/Badge";
import { Copy } from "@/components/ui/Copy";
import { useTablePagination } from "@/lib/use-table-pagination";
import { TablePagination } from "@/components/dashboard/TablePagination";
import type { SiteMonitoringClient } from "@/lib/site-monitoring";

const IMPACTED_STORAGE_KEY = "platops.impactedClients";

/** Columns with their own dropdown filter — options are the distinct values actually in the data. */
const FILTER_FIELDS = [
  { key: "clientStatus", label: "Client Status" },
  { key: "databaseServer", label: "Database Server" },
  { key: "appPoolName", label: "App Pool" },
  { key: "sso", label: "SSO" },
  { key: "keycloakInstance", label: "Keycloak Instance" },
  { key: "keycloakRealm", label: "Keycloak Realm" },
  { key: "ecosystem", label: "Ecosystem" },
] as const satisfies readonly { key: keyof SiteMonitoringClient; label: string }[];

const SEARCH_FIELDS = [
  "clientId",
  "clientName",
  "domainName",
  "databaseName",
  "databaseServer",
  "appPoolName",
  "sso",
  "keycloakInstance",
  "keycloakRealm",
] as const satisfies readonly (keyof SiteMonitoringClient)[];

type FilterState = Partial<Record<(typeof FILTER_FIELDS)[number]["key"], string>>;

function statusTone(value: string): "success" | "neutral" | "danger" {
  const v = value.trim().toLowerCase();
  if (v === "active" || v === "yes") return "success";
  if (v === "inactive" || v === "no") return "neutral";
  return "neutral";
}

/** The sheet stores bare domains/hosts with no scheme — prefix one so it's a valid <a href>. */
function toHref(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/**
 * Domain Name as a real, readable link — the actual domain text IS the link (never a generic
 * "Open"/"View Site" label), because it's a primary identifier during P1 triage. Wraps with
 * break-words rather than truncating, so a long domain degrades to two lines instead of "…".
 */
function DomainLink({ domain }: { domain: string }) {
  if (!domain) return <span className="text-neutral-300">—</span>;
  return (
    <a
      href={toHref(domain)}
      target="_blank"
      rel="noopener noreferrer"
      title={domain}
      className="text-sprout-700 hover:text-sprout-800 break-words"
    >
      {domain}
    </a>
  );
}

/** Ecosystem URL as a short "Open" link rather than the raw URL stretching the row. */
function EcosystemLink({ url }: { url: string }) {
  if (!url) return <span className="text-neutral-300">—</span>;
  return (
    <a
      href={toHref(url)}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className="inline-flex items-center gap-1 text-sprout-700 hover:text-sprout-800 whitespace-nowrap"
    >
      Open Ecosystem
      <ExternalLink className="w-3 h-3 shrink-0" />
    </a>
  );
}

function formatSyncedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function readImpactedFromStorage(): SiteMonitoringClient[] {
  try {
    const raw = window.sessionStorage.getItem(IMPACTED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function SiteMonitoringSection({
  initialClients,
  initialSyncedAt,
}: {
  initialClients: SiteMonitoringClient[];
  /** null = never synced yet. */
  initialSyncedAt: string | null;
}) {
  const [clients, setClients] = useState(initialClients);
  const [syncedAt, setSyncedAt] = useState(initialSyncedAt);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [justSynced, setJustSynced] = useState(false);

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Keyed by clientId so "already impacted" and de-duplication are both O(1). Restored from
  // sessionStorage on mount — per-tab, per-browser scratch state for one incident; never sent to
  // the backend, never written to the source sheet (see SiteMonitoringApi.gs).
  const [impacted, setImpacted] = useState<Map<string, SiteMonitoringClient>>(new Map());
  const [impactedLoaded, setImpactedLoaded] = useState(false);

  useEffect(() => {
    setImpacted(new Map(readImpactedFromStorage().map((c) => [c.clientId, c])));
    setImpactedLoaded(true);
  }, []);

  useEffect(() => {
    if (!impactedLoaded) return; // don't clobber storage with the empty initial map before it's read
    try {
      window.sessionStorage.setItem(IMPACTED_STORAGE_KEY, JSON.stringify(Array.from(impacted.values())));
    } catch {
      // Best-effort — a full or disabled sessionStorage shouldn't break the page.
    }
  }, [impacted, impactedLoaded]);

  const filterOptions = useMemo(() => {
    const options: Partial<Record<(typeof FILTER_FIELDS)[number]["key"], string[]>> = {};
    for (const field of FILTER_FIELDS) {
      const values = new Set<string>();
      for (const c of clients) {
        const v = String(c[field.key] ?? "").trim();
        if (v) values.add(v);
      }
      options[field.key] = Array.from(values).sort((a, b) => a.localeCompare(b));
    }
    return options;
  }, [clients]);

  const visibleClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      for (const [key, value] of Object.entries(filters)) {
        if (value && String(c[key as keyof SiteMonitoringClient] ?? "") !== value) return false;
      }
      if (!q) return true;
      return SEARCH_FIELDS.some((field) => String(c[field] ?? "").toLowerCase().includes(q));
    });
  }, [clients, filters, search]);

  const hasActiveFilters = search.trim() !== "" || Object.values(filters).some(Boolean);

  // Her 2026-09-03 standing rule for every ticket/client detail table: paginate the filtered
  // result rather than rendering it all inline. With 2,670 clients in one snapshot, rendering
  // every row unconditionally was the real cause of the sluggish theme toggle reported on this
  // page — a `data-theme` change forces the browser to restyle the entire DOM, and that DOM was
  // ~2,670 rows deep regardless of how many were ever visible on screen. Search/filter still run
  // over the full `clients` array; only what's painted is capped.
  const { page, setPage, pageCount, pageRows, pageSize } = useTablePagination(visibleClients);

  function clearFilters() {
    setSearch("");
    setFilters({});
  }

  function toggleExpanded(clientId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  function addImpacted(client: SiteMonitoringClient) {
    setImpacted((prev) => {
      if (prev.has(client.clientId)) return prev;
      const next = new Map(prev);
      next.set(client.clientId, client);
      return next;
    });
  }

  function removeImpacted(clientId: string) {
    setImpacted((prev) => {
      if (!prev.has(clientId)) return prev;
      const next = new Map(prev);
      next.delete(clientId);
      return next;
    });
  }

  function clearImpacted() {
    if (impacted.size === 0) return;
    if (!confirm("Clear the current P1 watchlist? This only clears this view — nothing is deleted from the source sheet.")) return;
    setImpacted(new Map());
  }

  /**
   * The only place this page ever touches the Google Sheet. Deliberate and manual — the sheet
   * changes ~quarterly, so a normal page visit reads the cached snapshot (see the server page)
   * and never lands here on its own.
   */
  async function sync() {
    setSyncing(true);
    setSyncError(null);
    setJustSynced(false);
    try {
      const res = await fetch("/api/site-monitoring/sync", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${res.status}`);
      const fresh = payload.data.clients as SiteMonitoringClient[];
      setClients(fresh);
      setSyncedAt(payload.data.syncedAt as string);
      // Prune impacted clients that no longer exist post-sync; keep the rest, updated to their
      // fresh field values, rather than the stale snapshot from before the sync.
      setImpacted((prev) => {
        if (prev.size === 0) return prev;
        const byId = new Map(fresh.map((c) => [c.clientId, c]));
        const next = new Map<string, SiteMonitoringClient>();
        for (const id of Array.from(prev.keys())) {
          const match = byId.get(id);
          if (match) next.set(id, match);
        }
        return next;
      });
      celebrate("success");
      setJustSynced(true);
      setTimeout(() => setJustSynced(false), 4000);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Freshness metadata — supporting info, deliberately understated. This is the only control
          that ever calls the Sheet; everything else below operates on `clients` in memory. The
          status dot is static (no pulse) on purpose — this one reports a fact (source ready or
          not), not "alive", so it shouldn't compete with the Site Monitoring card's own breathing
          dot for attention. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-neutral-400 inline-flex items-center gap-1.5">
          <span className={cn("w-1.5 h-1.5 rounded-full", syncedAt ? "bg-sprout-500" : "bg-neutral-300")} aria-hidden="true" />
          {syncedAt ? `Last synced · ${formatSyncedAt(syncedAt)}` : "Not synced yet"}
        </p>
        <button
          onClick={sync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-sprout-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} />
          {syncing ? "Syncing Site Monitoring…" : "Sync Site Monitoring"}
        </button>
      </div>

      {justSynced && !syncError && (
        <p className="text-xs text-sprout-700">
          <Copy serious="Site Monitoring is up to date." playful="Mission data synced. You're good to go." />
        </p>
      )}

      {syncError && (
        <div className="text-xs text-red-600">
          <p>
            Couldn&apos;t reach the source sheet.{" "}
            {syncedAt ? "Keeping the last known data for now." : "There's no previously synced data to fall back on yet."}
          </p>
          <p className="text-red-400 mt-0.5">{syncError}</p>
        </div>
      )}

      {clients.length === 0 && !syncedAt && (
        <div className="card p-6 text-center">
          <p className="text-sm text-neutral-600">
            No Site Monitoring data yet — run the first sync to pull it from the Google Sheet.
          </p>
          <button onClick={sync} disabled={syncing} className="btn-primary mt-3">
            {syncing ? "Syncing…" : "Sync Site Monitoring"}
          </button>
        </div>
      )}

      {/* Impacted Clients — above the table, deliberately. Removal only happens here, one at a
          time, never via a click in the main table (see the static badge below), so a misclick
          during a live incident can't silently drop a client. Rendered as compact rows rather
          than a dense table — this list is meant to stay short, so it can afford to be readable. */}
      {/* `amber-500` at low opacity, not `amber-50`/`amber-200` — this panel needs to read as a
          warm highlight in EVERY theme. `amber-50`/`-200` are ramp endpoints that invert with the
          rest of the neutral scale in dark/adhd (see globals.css), which turns "highlighted" into
          a muddy dark-brown block that no longer looks like a highlight at all. `amber-500` itself
          stays a recognizable gold/amber across all three themes, so a translucent wash of it
          reads as the same warm accent everywhere — confirmed live in light, dark, and Gaby's View. */}
      <div className={cn("rounded-lg border", impacted.size > 0 ? "border-amber-500/40 shadow-sm" : "border-neutral-200")}>
        <div className={cn(
          "flex items-center justify-between gap-3 px-3 py-2 border-b",
          impacted.size > 0 ? "border-amber-500/40 bg-amber-500/10" : "border-neutral-200 bg-neutral-50"
        )}>
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">Impacted Clients ({impacted.size})</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              <Copy
                serious="Temporary for this investigation — never saved to the source sheet."
                playful="Clients currently on the P1 watchlist."
              />
            </p>
          </div>
          {impacted.size > 0 && (
            <button onClick={clearImpacted} className="text-xs text-red-600 hover:text-red-700 shrink-0">
              Clear Impacted Clients
            </button>
          )}
        </div>
        {impacted.size === 0 ? (
          <div className="px-3 py-3">
            <p className="text-sm text-neutral-500 font-medium">No impacted clients yet</p>
            <p className="text-xs text-neutral-400 mt-0.5">
              <Copy
                serious="Add clients here while you're investigating an incident."
                playful="Flag clients here while you're tracing the incident."
              />
            </p>
          </div>
        ) : (
          <>
            {/* Desktop/tablet: a real scannable table — the 5 fields a P1 investigation actually
                needs (Client ID, Domain, Server, App Pool, Keycloak Instance) are columns, not
                prose, and never behind a "Details" click the way the main table's secondary
                fields are. This list is the point of the workspace, so nothing here is hidden. */}
            {/* `table-fixed` is load-bearing here, not decorative — without it the browser
                auto-sizes columns from content, so a short Domain value shrinks that column
                below its intended share (opening a gap before Database Server) while realistic
                App Pool values ("HRIS SSO Production v2 Tier 19") get squeezed into whatever's
                left and wrap. Fixed widths below are tuned to those two columns' real content
                lengths, same "table-fixed + explicit w-[%]" pattern the main table already uses. */}
            <table className="w-full text-sm table-fixed hidden sm:table">
              <colgroup>
                <col className="w-[13%]" /><col className="w-[21%]" /><col className="w-[12%]" />
                <col className="w-[26%]" /><col className="w-[18%]" /><col className="w-[10%]" />
              </colgroup>
              <thead className="bg-neutral-50/60 border-b border-neutral-100">
                <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
                  <th className="px-3 py-2">Client ID</th>
                  <th className="px-3 py-2">Domain Name</th>
                  <th className="px-3 py-2">Database Server</th>
                  <th className="px-3 py-2">App Pool Name</th>
                  <th className="px-3 py-2">Keycloak Instance</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {Array.from(impacted.values()).map((c) => (
                  <tr key={c.clientId}>
                    <td className="px-3 py-2 align-top">
                      <span className="font-medium text-neutral-900 break-words">{c.clientId}</span>
                      <p className="text-xs text-neutral-500 break-words">{c.clientName}</p>
                    </td>
                    <td className="px-3 py-2 align-top break-words"><DomainLink domain={c.domainName} /></td>
                    <td className="px-3 py-2 align-top break-words">{c.databaseServer}</td>
                    <td className="px-3 py-2 align-top break-words">{c.appPoolName}</td>
                    <td className="px-3 py-2 align-top break-words">{c.keycloakInstance}</td>
                    <td className="px-3 py-2 align-top text-right">
                      <button
                        onClick={() => removeImpacted(c.clientId)}
                        className="text-neutral-400 hover:text-red-600 transition-colors"
                        title="Remove from Impacted Clients"
                        aria-label={`Remove ${c.clientId} from impacted clients`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile: the same 5 fields, reorganised as a stacked card per client rather than
                squeezed into unreadable columns — same information, no "Details" click needed. */}
            <div className="flex flex-col divide-y divide-neutral-100 sm:hidden">
              {Array.from(impacted.values()).map((c) => (
                <div key={c.clientId} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-neutral-900 break-words">{c.clientId}</p>
                      <p className="text-xs text-neutral-500 break-words">{c.clientName}</p>
                      <p className="text-sm mt-0.5"><DomainLink domain={c.domainName} /></p>
                    </div>
                    <button
                      onClick={() => removeImpacted(c.clientId)}
                      className="text-neutral-400 hover:text-red-600 transition-colors shrink-0"
                      title="Remove from Impacted Clients"
                      aria-label={`Remove ${c.clientId} from impacted clients`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-[5rem_1fr] gap-y-0.5 text-xs text-neutral-600 mt-2">
                    <span className="text-neutral-400">Server</span>
                    <span className="break-words">{c.databaseServer || "—"}</span>
                    <span className="text-neutral-400">App Pool</span>
                    <span className="break-words">{c.appPoolName || "—"}</span>
                    <span className="text-neutral-400">Keycloak</span>
                    <span className="break-words">{c.keycloakInstance || "—"}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Search + column filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients, domains, databases…"
            className="form-input pl-8 w-full"
            aria-label="Search clients"
          />
        </div>
        {FILTER_FIELDS.map((field) => (
          <select
            key={field.key}
            value={filters[field.key] ?? ""}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, [field.key]: e.target.value || undefined }))
            }
            className="form-input w-auto"
            aria-label={field.label}
          >
            <option value="">{field.label}: All</option>
            {(filterOptions[field.key] ?? []).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        ))}
        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs text-neutral-500 hover:text-neutral-700">
            Clear Filters
          </button>
        )}
      </div>

      <p className="text-xs text-neutral-400">
        {visibleClients.length} of {clients.length} clients
      </p>

      {/*
        Main table — 8 priority fields (Client ID, Name, Domain, Status, SSO, DB Server, App
        Pool, Keycloak Instance) in a comfortably wide fixed layout, no horizontal scroll.
        Database Name/Keycloak Realm/Ecosystem/Ecosystem URL are one click away via "Details"
        rather than crammed into the row — the alternative (12 narrow columns) made every field,
        especially Domain, too compressed to read at a glance, which defeats the point of a P1
        lookup tool.
      */}
      <div className="rounded-lg border border-neutral-200 overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[8%]" /><col className="w-[13%]" /><col className="w-[19%]" />
            <col className="w-[8%]" /><col className="w-[6%]" /><col className="w-[10%]" />
            <col className="w-[14%]" /><col className="w-[10%]" /><col className="w-[12%]" />
          </colgroup>
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide">
              <th className="px-3 py-2.5">Client ID</th>
              <th className="px-3 py-2.5">Client Name</th>
              <th className="px-3 py-2.5">Domain Name</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">SSO</th>
              <th className="px-3 py-2.5">DB Server</th>
              <th className="px-3 py-2.5">App Pool Name</th>
              <th className="px-3 py-2.5">Keycloak Instance</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {visibleClients.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center">
                  {clients.length === 0 ? (
                    <p className="text-neutral-400">No Site Monitoring data loaded.</p>
                  ) : (
                    <>
                      <p className="text-neutral-500 font-medium">No clients found</p>
                      <p className="text-neutral-400 text-xs mt-0.5">
                        <Copy
                          serious="No clients match the current search or filters."
                          playful="Nothing matched. Try another client, domain, database, or filter."
                        />
                      </p>
                    </>
                  )}
                </td>
              </tr>
            )}
            {pageRows.map((c) => {
              const isImpacted = impacted.has(c.clientId);
              const isOpen = expanded.has(c.clientId);
              return (
                <Fragment key={c.clientId}>
                  <tr
                    className={cn(
                      "hover:bg-neutral-50/80 transition-colors",
                      // Same amber-500-at-low-opacity reasoning as the Impacted Clients panel
                      // above — `amber-50/50` was nearly imperceptible in dark/adhd because that
                      // ramp endpoint is already close to the row's own dark background there.
                      isImpacted && "bg-amber-500/10",
                      isOpen && "bg-neutral-50/60"
                    )}
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-start gap-1.5">
                        {isImpacted ? (
                          <span
                            className="inline-flex items-center justify-center w-5 h-5 text-red-700 bg-red-50 rounded shrink-0"
                            title="Already flagged — remove it from the Impacted Clients panel above"
                            aria-label="Already flagged as impacted"
                          >
                            <Check className="w-3 h-3" />
                          </span>
                        ) : (
                          <button
                            onClick={() => addImpacted(c)}
                            className="inline-flex items-center justify-center w-5 h-5 text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 rounded transition-colors shrink-0"
                            title="Add this client to Impacted Clients"
                            aria-label="Add this client to Impacted Clients"
                          >
                            <AlertTriangle className="w-3 h-3" />
                          </button>
                        )}
                        <span className="font-medium text-neutral-900 break-words">{c.clientId}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top break-words">{c.clientName}</td>
                    <td className="px-3 py-2 align-top text-[13px] leading-snug"><DomainLink domain={c.domainName} /></td>
                    <td className="px-3 py-2 align-top"><Badge tone={statusTone(c.clientStatus)}>{c.clientStatus || "—"}</Badge></td>
                    <td className="px-3 py-2 align-top break-words">{c.sso}</td>
                    <td className="px-3 py-2 align-top break-words">{c.databaseServer}</td>
                    <td className="px-3 py-2 align-top break-words">{c.appPoolName}</td>
                    <td className="px-3 py-2 align-top break-words">{c.keycloakInstance}</td>
                    <td className="px-3 py-2 align-top text-right">
                      <button
                        onClick={() => toggleExpanded(c.clientId)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-sprout-700 border border-neutral-300 hover:border-sprout-300 rounded-md px-2 py-1 transition-colors"
                        aria-expanded={isOpen}
                      >
                        Details
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-neutral-50/60">
                      <td colSpan={9} className="px-4 py-3">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-neutral-400">Database Name</p>
                            <p className="text-sm text-neutral-800 mt-0.5 break-words">{c.databaseName || "—"}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-neutral-400">Keycloak Realm</p>
                            <p className="text-sm text-neutral-800 mt-0.5 break-words">{c.keycloakRealm || "—"}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-neutral-400">Ecosystem</p>
                            <p className="text-sm mt-0.5"><Badge tone={statusTone(c.ecosystem)}>{c.ecosystem}</Badge></p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-neutral-400">Ecosystem URL</p>
                            <p className="text-sm mt-0.5"><EcosystemLink url={c.ecosystemUrl} /></p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <TablePagination page={page} pageCount={pageCount} totalCount={visibleClients.length} pageSize={pageSize} onPageChange={setPage} />
      </div>
    </div>
  );
}
