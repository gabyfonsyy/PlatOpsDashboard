"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Trash2 } from "lucide-react";
import { NOTE_TYPES, NOTE_TYPE_META, type ProjectNote, type ProjectNoteType } from "@/lib/project-tracking";
import { Badge } from "@/components/ui/Badge";
import { formatManilaDateTime } from "@/lib/format";

/**
 * A project's (or one phase's, when `phaseId` is set) notes — newest first, with an inline add
 * form. Delete is enforced author-only server-side (`deleteNote`); the button here is hidden for
 * anyone else's note as a courtesy, not the actual guard.
 */
export function NotesSection({
  projectId,
  phaseId = null,
  notes,
}: {
  projectId: string;
  phaseId?: string | null;
  notes: ProjectNote[];
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const myEmail = session?.user?.email;

  const [content, setContent] = useState("");
  const [noteType, setNoteType] = useState<ProjectNoteType>("update");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/project-tracking/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          phase_id: phaseId,
          note_type: noteType,
          content: content.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      setContent("");
      router.refresh();
    } catch (err) {
      setError(`Could not add note: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this note?")) return;
    const res = await fetch("/api/project-tracking/notes", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {notes.length === 0 && <p className="text-sm text-neutral-400">No notes yet.</p>}
      {notes.map((n) => (
        <div key={n.id} className="flex items-start gap-2 bg-surface rounded-md border border-neutral-200 px-3 py-2">
          <Badge tone={NOTE_TYPE_META[n.note_type].tone}>{NOTE_TYPE_META[n.note_type].label}</Badge>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-neutral-800 whitespace-pre-wrap">{n.content}</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              {n.author_email} · {formatManilaDateTime(n.created_at)}
            </p>
          </div>
          {myEmail === n.author_email && (
            <button
              onClick={() => remove(n.id)}
              className="text-neutral-400 hover:text-red-600 transition-colors shrink-0"
              aria-label="Delete note"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}

      <form onSubmit={addNote} className="flex items-start gap-2 mt-1">
        <select
          value={noteType}
          onChange={(e) => setNoteType(e.target.value as ProjectNoteType)}
          className="form-input w-auto shrink-0 text-sm py-1.5"
          aria-label="Note type"
        >
          {NOTE_TYPES.map((t) => (
            <option key={t} value={t}>{NOTE_TYPE_META[t].label}</option>
          ))}
        </select>
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Add a note…"
          className="form-input flex-1 text-sm py-1.5"
        />
        <button type="submit" disabled={submitting || !content.trim()} className="btn-secondary text-sm py-1.5">
          {submitting ? "Adding…" : "+ Add"}
        </button>
      </form>
      {error && <p className="form-error mt-1">{error}</p>}
    </div>
  );
}
