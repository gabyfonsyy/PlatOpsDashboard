"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, Check, X } from "lucide-react";
import { SidePanel } from "@/components/ui/SidePanel";
import { celebrate } from "@/lib/celebrate";
import type { ReferenceCategory, ReferenceTypeRow } from "@/lib/references-taxonomy-store";

type Tab = "categories" | "types";

type TaxonomyItem = { id: string; name: string; is_fallback: boolean };

/**
 * Lightweight manage-Categories/manage-Types UI, reached via the "Manage" link next to either
 * dropdown in the reference form. Reuses SidePanel (glass variant) rather than a new modal
 * system — same Escape/focus-trap/scroll-lock every other slide-over in this app already has.
 * Deliberately simple: an inline-editable list per entity, not a table or a separate route — she
 * shouldn't need more than this panel to add "SE Stuff" as a category.
 */
export function ManageTaxonomyPanel({
  open,
  onClose,
  initialTab,
  categories,
  types,
  referenceCountByCategoryId,
  referenceCountByTypeId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  initialTab: Tab;
  categories: ReferenceCategory[];
  types: ReferenceTypeRow[];
  referenceCountByCategoryId: Map<string, number>;
  referenceCountByTypeId: Map<string, number>;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const categoryItems: TaxonomyItem[] = categories.map((c) => ({ id: c.category_id, name: c.name, is_fallback: c.is_fallback }));
  const typeItems: TaxonomyItem[] = types.map((t) => ({ id: t.type_id, name: t.name, is_fallback: t.is_fallback }));

  async function callApi(url: string, method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
    return body.data;
  }

  return (
    <SidePanel open={open} onClose={onClose} title="Manage Categories & Types" glass>
      <div className="flex gap-1 bg-neutral-100 rounded-lg p-1 mb-4">
        <button
          onClick={() => setTab("categories")}
          className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === "categories" ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
          }`}
        >
          Categories
        </button>
        <button
          onClick={() => setTab("types")}
          className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === "types" ? "bg-surface-raised text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
          }`}
        >
          Types
        </button>
      </div>

      {tab === "categories" ? (
        <TaxonomyList
          key="categories"
          entityLabel="category"
          fallbackHint="references move to Uncategorized"
          items={categoryItems}
          countById={referenceCountByCategoryId}
          onAdd={async (name) => {
            await callApi("/api/reference-categories", "POST", { name });
            onChanged();
          }}
          onRename={async (id, name) => {
            await callApi("/api/reference-categories", "PATCH", { category_id: id, name });
            onChanged();
          }}
          onMove={async (id, direction) => {
            await callApi("/api/reference-categories", "PATCH", { category_id: id, move: direction });
            onChanged();
          }}
          onDelete={async (id) => {
            await callApi("/api/reference-categories", "DELETE", { category_id: id });
            onChanged();
          }}
        />
      ) : (
        <TaxonomyList
          key="types"
          entityLabel="type"
          fallbackHint="references move to Other"
          items={typeItems}
          countById={referenceCountByTypeId}
          onAdd={async (name) => {
            await callApi("/api/reference-types", "POST", { name });
            onChanged();
          }}
          onRename={async (id, name) => {
            await callApi("/api/reference-types", "PATCH", { type_id: id, name });
            onChanged();
          }}
          onMove={async (id, direction) => {
            await callApi("/api/reference-types", "PATCH", { type_id: id, move: direction });
            onChanged();
          }}
          onDelete={async (id) => {
            await callApi("/api/reference-types", "DELETE", { type_id: id });
            onChanged();
          }}
        />
      )}
    </SidePanel>
  );
}

function TaxonomyList({
  entityLabel,
  fallbackHint,
  items,
  countById,
  onAdd,
  onRename,
  onMove,
  onDelete,
}: {
  entityLabel: string;
  fallbackHint: string;
  items: TaxonomyItem[];
  countById: Map<string, number>;
  onAdd: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onMove: (id: string, direction: "up" | "down") => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string | null, fn: () => Promise<void>) {
    setError(null);
    setBusyId(id ?? "new");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      celebrate("nope");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-xs text-red-600">{error}</p>}

      <ul className="flex flex-col gap-1">
        {items.map((item, index) => {
          const editing = editingId === item.id;
          const busy = busyId === item.id;
          const count = countById.get(item.id) ?? 0;
          return (
            <li key={item.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-sprout-50/60 group">
              <div className="flex flex-col">
                <button
                  onClick={() => run(item.id, () => onMove(item.id, "up"))}
                  disabled={index === 0 || busy}
                  className="text-neutral-400 hover:text-sprout-600 disabled:opacity-30 transition-colors"
                  aria-label={`Move ${item.name} up`}
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => run(item.id, () => onMove(item.id, "down"))}
                  disabled={index === items.length - 1 || busy}
                  className="text-neutral-400 hover:text-sprout-600 disabled:opacity-30 transition-colors"
                  aria-label={`Move ${item.name} down`}
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>

              {editing ? (
                <>
                  <input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="form-input flex-1 py-1 text-sm"
                    autoFocus
                  />
                  <button
                    onClick={() =>
                      run(item.id, async () => {
                        await onRename(item.id, editingName);
                        setEditingId(null);
                      })
                    }
                    disabled={busy || !editingName.trim()}
                    className="text-sprout-600 hover:text-sprout-700 disabled:opacity-40"
                    aria-label="Save"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-neutral-400 hover:text-neutral-600" aria-label="Cancel">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-neutral-700 truncate">
                    {item.name}
                    {item.is_fallback && <span className="ml-1.5 text-xs text-neutral-400">(fallback)</span>}
                  </span>
                  <span className="text-xs text-neutral-400">{count}</span>
                  <button
                    onClick={() => {
                      setEditingId(item.id);
                      setEditingName(item.name);
                    }}
                    className="text-neutral-400 hover:text-sprout-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`Rename ${item.name}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {!item.is_fallback && (
                    <button
                      onClick={() => {
                        const message =
                          count > 0
                            ? `Delete “${item.name}”? ${count} ${fallbackHint}.`
                            : `Delete “${item.name}”?`;
                        if (!confirm(message)) return;
                        run(item.id, () => onDelete(item.id));
                      }}
                      disabled={busy}
                      className="text-neutral-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40"
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          run(null, async () => {
            await onAdd(newName.trim());
            setNewName("");
          });
        }}
        className="flex items-center gap-2 pt-1"
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={`New ${entityLabel}…`}
          className="form-input flex-1 py-1.5 text-sm"
        />
        <button type="submit" disabled={busyId === "new" || !newName.trim()} className="btn-secondary py-1.5 px-2.5">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
