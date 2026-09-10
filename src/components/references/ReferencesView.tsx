"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { celebrate } from "@/lib/celebrate";
import { Copy } from "@/components/ui/Copy";
import { SiteMonitoringCard } from "@/components/references/SiteMonitoringCard";
import { ReferenceCard } from "@/components/references/ReferenceCard";
import { ReferenceSidebar, type SidebarSection } from "@/components/references/ReferenceSidebar";
import { ManageTaxonomyPanel } from "@/components/references/ManageTaxonomyPanel";
import type { WorkReference } from "@/lib/references-store";
import type { ReferenceCategory, ReferenceTypeRow } from "@/lib/references-taxonomy-store";

type SaveBody = { title: string; url: string; description: string; category_id: string; type_id: string };

export function ReferencesView({
  references,
  categories,
  types,
  needsSetup = false,
  needsTaxonomySetup = false,
}: {
  references: WorkReference[];
  categories: ReferenceCategory[];
  types: ReferenceTypeRow[];
  /** work_references itself isn't set up — show only the built-in card and a setup prompt. */
  needsSetup?: boolean;
  /** work_references exists, but references-taxonomy.sql hasn't been run yet. Existing
   * references still render (references-store.ts's attachTaxonomy returns them with
   * category/type null rather than erroring) — just as a flat grid with a setup prompt above
   * them, not category sections, until she runs it. */
  needsTaxonomySetup?: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WorkReference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [managePanel, setManagePanel] = useState<{ open: boolean; tab: "categories" | "types" }>({ open: false, tab: "categories" });

  const ready = !needsSetup && !needsTaxonomySetup;

  async function submit(body: SaveBody, referenceId?: string): Promise<boolean> {
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

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return references;
    return references.filter(
      (r) =>
        r.title.toLowerCase().includes(query) ||
        (r.description ?? "").toLowerCase().includes(query) ||
        (r.category?.name ?? "").toLowerCase().includes(query) ||
        (r.type?.name ?? "").toLowerCase().includes(query)
    );
  }, [references, query]);

  // One section per category that has at least one VISIBLE (post-search) reference — empty
  // categories never render as a page section, per her §11, even though they still exist for
  // management. Sections and sidebar entries are derived from this same array, so they can never
  // disagree with each other.
  const sections = useMemo(() => {
    const byCategoryId = new Map<string, WorkReference[]>();
    for (const r of filtered) {
      if (!r.category_id) continue;
      if (!byCategoryId.has(r.category_id)) byCategoryId.set(r.category_id, []);
      byCategoryId.get(r.category_id)!.push(r);
    }
    return categories
      .map((c) => ({ category: c, items: byCategoryId.get(c.category_id) ?? [] }))
      .filter((s) => s.items.length > 0);
  }, [filtered, categories]);

  const sidebarSections: SidebarSection[] = sections.map((s) => ({
    id: `category-${s.category.category_id}`,
    label: s.category.name,
  }));

  const referenceCountByCategoryId = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of references) if (r.category_id) m.set(r.category_id, (m.get(r.category_id) ?? 0) + 1);
    return m;
  }, [references]);
  const referenceCountByTypeId = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of references) if (r.type_id) m.set(r.type_id, (m.get(r.type_id) ?? 0) + 1);
    return m;
  }, [references]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <SiteMonitoringCard />
      </div>

      {!needsSetup && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-neutral-400">{references.length} saved</p>
          <div className="flex items-center gap-2 flex-wrap">
            {ready && (
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search references…"
                className="form-input w-56"
                aria-label="Search references"
              />
            )}
            <button onClick={() => setAdding(true)} className="btn-secondary shrink-0">
              <Plus className="w-4 h-4" />
              Add reference
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {adding && (
        <ReferenceForm
          categories={categories}
          types={types}
          onManage={(tab) => setManagePanel({ open: true, tab })}
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
          categories={categories}
          types={types}
          onManage={(tab) => setManagePanel({ open: true, tab })}
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

      {needsTaxonomySetup && !needsSetup && (
        <>
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-neutral-900">One more setup step</h3>
            <p className="text-sm text-neutral-600 mt-2 max-w-2xl">
              Categories and Types need one more table. Open the Supabase SQL editor and run{" "}
              <code className="text-sprout-700">supabase/references-taxonomy.sql</code> from this
              repo, then reload this page. It&apos;s idempotent and additive — your existing
              references and their types are preserved automatically once it runs.
            </p>
          </div>

          {/* Existing references stay visible and usable in the meantime — same flat layout this
              page had before category sections existed, just without a Type/Category badge until
              the table above exists and getReferences() can attach one. */}
          {references.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {references.map((ref, index) => (
                <ReferenceCard
                  key={ref.reference_id}
                  reference={ref}
                  isFirstInCategory={index === 0}
                  isLastInCategory={index === references.length - 1}
                  moving={moving === ref.reference_id}
                  onEdit={() => setEditing(ref)}
                  onDelete={() => remove(ref)}
                  onMove={(direction) => move(ref, direction)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {ready && references.length === 0 && !adding && (
        <div className="card p-4">
          <p className="text-sm text-neutral-500">
            <Copy
              serious="No references saved yet — add one above."
              playful="Nothing dumped here yet. Go dump something."
            />
          </p>
        </div>
      )}

      {ready && references.length > 0 && sections.length === 0 && query && (
        <div className="card p-4">
          <p className="text-sm text-neutral-500">No references match &ldquo;{search}&rdquo;.</p>
        </div>
      )}

      {ready && sections.length > 0 && (
        <>
          {/* Mobile category nav — a horizontal scrollable pill row replaces the sidebar below
              the `lg` breakpoint (ReferenceSidebar itself is hidden there). Same click-to-scroll
              behaviour, no separate state to keep in sync since both read from `sidebarSections`. */}
          <div className="lg:hidden flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {sidebarSections.map((s) => (
              <button
                key={s.id}
                onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="team-pill shrink-0"
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex gap-6 items-start">
            <ReferenceSidebar sections={sidebarSections} />

            <div className="flex-1 min-w-0 flex flex-col gap-8">
              {sections.map(({ category, items }) => (
                <section key={category.category_id} id={`category-${category.category_id}`} className="scroll-mt-24">
                  <h2 className="reference-section-heading flex items-center text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-3 pb-2 border-b border-neutral-200">
                    {category.name}
                    <span aria-hidden="true" className="gaby-sparkle ml-1.5">
                      ✦
                    </span>
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {items.map((ref, index) => (
                      <ReferenceCard
                        key={ref.reference_id}
                        reference={ref}
                        isFirstInCategory={index === 0}
                        isLastInCategory={index === items.length - 1}
                        moving={moving === ref.reference_id}
                        onEdit={() => setEditing(ref)}
                        onDelete={() => remove(ref)}
                        onMove={(direction) => move(ref, direction)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </>
      )}

      <ManageTaxonomyPanel
        open={managePanel.open}
        onClose={() => setManagePanel((p) => ({ ...p, open: false }))}
        initialTab={managePanel.tab}
        categories={categories}
        types={types}
        referenceCountByCategoryId={referenceCountByCategoryId}
        referenceCountByTypeId={referenceCountByTypeId}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}

function ReferenceForm({
  reference,
  categories,
  types,
  onManage,
  onSave,
  onCancel,
}: {
  reference?: WorkReference;
  categories: ReferenceCategory[];
  types: ReferenceTypeRow[];
  onManage: (tab: "categories" | "types") => void;
  onSave: (body: SaveBody) => Promise<boolean>;
  onCancel: () => void;
}) {
  const defaultCategoryId = reference?.category_id ?? categories.find((c) => !c.is_fallback)?.category_id ?? categories[0]?.category_id ?? "";
  const defaultTypeId = reference?.type_id ?? types.find((t) => !t.is_fallback)?.type_id ?? types[0]?.type_id ?? "";

  const [title, setTitle] = useState(reference?.title ?? "");
  const [url, setUrl] = useState(reference?.url ?? "");
  const [description, setDescription] = useState(reference?.description ?? "");
  const [categoryId, setCategoryId] = useState(defaultCategoryId);
  const [typeId, setTypeId] = useState(defaultTypeId);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await onSave({ title: title.trim(), url: url.trim(), description: description.trim(), category_id: categoryId, type_id: typeId });
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
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Quick description (optional)"
        className="form-input min-h-[4.5rem] resize-y"
        aria-label="Description"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="form-label mb-0">Category</label>
            <button type="button" onClick={() => onManage("categories")} className="text-xs text-sprout-700 hover:text-sprout-800">
              Manage
            </button>
          </div>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="form-input" aria-label="Category" required>
            {categories.map((c) => (
              <option key={c.category_id} value={c.category_id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="form-label mb-0">Type</label>
            <button type="button" onClick={() => onManage("types")} className="text-xs text-sprout-700 hover:text-sprout-800">
              Manage
            </button>
          </div>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="form-input" aria-label="Type" required>
            {types.map((t) => (
              <option key={t.type_id} value={t.type_id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
        type="url"
        className="form-input"
        aria-label="URL"
        required
      />

      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting || !title.trim() || !url.trim() || !categoryId || !typeId} className="btn-primary">
          {submitting ? "Saving…" : reference ? "Save" : "Add reference"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-neutral-500 hover:text-neutral-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
