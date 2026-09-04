"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, ExternalLink, X, ChevronUp, ChevronDown, Link2, ArrowRight } from "lucide-react";
import { celebrate } from "@/lib/celebrate";
import { Copy } from "@/components/ui/Copy";
import { Badge } from "@/components/ui/Badge";
import { SiteMonitoringCard } from "@/components/references/SiteMonitoringCard";
import { REFERENCE_TYPES, type ReferenceType, type WorkReference } from "@/lib/references-store";

/** Bare hostname for a quick visual "what site is this", without pulling in a URL-parsing lib. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ReferencesView({
  references,
  needsSetup = false,
}: {
  references: WorkReference[];
  /** Supabase's work_references table isn't set up — show the built-in card and a setup prompt only. */
  needsSetup?: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WorkReference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  async function submit(
    body: { title: string; url: string; description: string; reference_type: ReferenceType },
    referenceId?: string
  ): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch("/api/references", {
        method: referenceId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(referenceId ? { reference_id: referenceId, ...body } : body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${res.status}`);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
      return false;
    }
  }

  async function remove(reference: WorkReference) {
    if (!confirm(`Delete “${reference.title}”?`)) return;
    setError(null);
    try {
      const res = await fetch("/api/references", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_id: reference.reference_id }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
    }
  }

  async function move(reference: WorkReference, direction: "up" | "down") {
    setError(null);
    setMoving(reference.reference_id);
    try {
      const res = await fetch("/api/references", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_id: reference.reference_id, move: direction }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
    } finally {
      setMoving(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!needsSetup && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-neutral-400">
            {references.length} saved
          </p>
          <button onClick={() => setAdding(true)} className="btn-secondary shrink-0">
            <Plus className="w-4 h-4" />
            Add reference
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {adding && (
        <ReferenceForm
          onCancel={() => setAdding(false)}
          onSave={async (body) => {
            const ok = await submit(body);
            if (ok) {
              setAdding(false);
              celebrate("success");
            }
            return ok;
          }}
        />
      )}

      {editing && (
        <ReferenceForm
          reference={editing}
          onCancel={() => setEditing(null)}
          onSave={async (body) => {
            const ok = await submit(body, editing.reference_id);
            if (ok) setEditing(null);
            return ok;
          }}
        />
      )}

      {needsSetup && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-neutral-900">One setup step left</h3>
          <p className="text-sm text-neutral-600 mt-2 max-w-2xl">
            The Reference Library&apos;s table doesn&apos;t exist in Supabase yet. Open the
            Supabase SQL editor and run{" "}
            <code className="text-sprout-700">supabase/references.sql</code> from this repo,
            then reload this page. It&apos;s idempotent, so re-running it is safe.
          </p>
        </div>
      )}

      {/* A widget library, not a stack of full-width rows — Site Monitoring is always first,
          always here, and isn't a work_references row, so it has no move/edit/delete controls
          and can't end up below a user reference. `items-stretch` (the grid default) plus
          `h-full` + `mt-auto` on the "Open" link is what keeps every tile the same height
          regardless of description length. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <SiteMonitoringCard />

        {!needsSetup && references.length === 0 && !adding && (
          <div className="card p-4 sm:col-span-2 lg:col-span-3">
            <p className="text-sm text-neutral-500">
              <Copy
                serious="No references saved yet — add one above."
                playful="Nothing dumped here yet. Go dump something."
              />
            </p>
          </div>
        )}

        {!needsSetup && references.map((ref, index) => (
          <div key={ref.reference_id} className="card p-4 flex flex-col gap-3 h-full bg-surface border-2 border-neutral-300 shadow-lg group">
            <div className="flex items-start justify-between gap-2">
              <span className="w-9 h-9 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">
                <Link2 className="w-4.5 h-4.5" />
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex flex-col items-center gap-0.5">
                  <button
                    onClick={() => move(ref, "up")}
                    disabled={index === 0 || moving === ref.reference_id}
                    className="text-neutral-400 hover:text-sprout-600 disabled:opacity-30 disabled:hover:text-neutral-400 transition-colors"
                    aria-label="Move up"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => move(ref, "down")}
                    disabled={index === references.length - 1 || moving === ref.reference_id}
                    className="text-neutral-400 hover:text-sprout-600 disabled:opacity-30 disabled:hover:text-neutral-400 transition-colors"
                    aria-label="Move down"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  onClick={() => setEditing(ref)}
                  className="text-neutral-400 hover:text-sprout-600 transition-colors"
                  aria-label="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => remove(ref)}
                  className="text-neutral-400 hover:text-red-600 transition-colors"
                  aria-label="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-neutral-900 truncate">{ref.title}</span>
                <Badge tone="neutral">{ref.reference_type}</Badge>
              </div>
              <p className="text-xs text-neutral-400 truncate mt-0.5">{hostOf(ref.url)}</p>
              {ref.description && (
                <p className="text-sm text-neutral-600 mt-1.5 line-clamp-3">{ref.description}</p>
              )}
            </div>

            <a
              href={ref.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-sprout-700 group-hover:text-sprout-800 transition-colors"
            >
              Open
              <ArrowRight className="w-4 h-4" />
              <ExternalLink className="w-3 h-3 text-neutral-300" />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReferenceForm({
  reference,
  onSave,
  onCancel,
}: {
  reference?: WorkReference;
  onSave: (body: { title: string; url: string; description: string; reference_type: ReferenceType }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(reference?.title ?? "");
  const [url, setUrl] = useState(reference?.url ?? "");
  const [description, setDescription] = useState(reference?.description ?? "");
  const [referenceType, setReferenceType] = useState<ReferenceType>(reference?.reference_type ?? "Other");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await onSave({ title: title.trim(), url: url.trim(), description: description.trim(), reference_type: referenceType });
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">
          {reference ? "Edit reference" : "New reference"}
        </h3>
        <button type="button" onClick={onCancel} className="text-neutral-400 hover:text-neutral-600" aria-label="Cancel">
          <X className="w-4 h-4" />
        </button>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="form-input"
        aria-label="Title"
        autoFocus
        required
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
        type="url"
        className="form-input"
        aria-label="URL"
        required
      />
      <select
        value={referenceType}
        onChange={(e) => setReferenceType(e.target.value as ReferenceType)}
        className="form-input w-auto"
        aria-label="Type"
      >
        {REFERENCE_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Quick description (optional)"
        className="form-input min-h-[4.5rem] resize-y"
        aria-label="Description"
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting || !title.trim() || !url.trim()} className="btn-primary">
          {submitting ? "Saving…" : reference ? "Save" : "Add reference"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-neutral-500 hover:text-neutral-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
