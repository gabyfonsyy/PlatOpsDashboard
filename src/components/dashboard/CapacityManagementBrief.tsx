"use client";

import { useState } from "react";
import { Copy as CopyIcon, Check } from "lucide-react";

/**
 * Brief §12's "Generate Management Brief" — reveals a pre-formatted text panel and offers a Copy
 * button. This app has no PDF/file-export pipeline anywhere else, so plain text + clipboard is the
 * shareable format (pastes cleanly into email/Slack/Docs).
 */
export function CapacityManagementBrief({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked (permissions/context) — the panel is still selectable/copyable by hand.
    }
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
        <button onClick={() => setOpen((o) => !o)} className="btn-secondary">
          {open ? "Hide Brief" : "Generate Management Brief"}
        </button>
      </div>

      {open && (
        <div className="mt-4">
          <div className="flex justify-end mb-2">
            <button onClick={onCopy} className="btn-ghost text-xs inline-flex items-center gap-1.5">
              {copied ? <Check className="w-3.5 h-3.5" /> : <CopyIcon className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="whitespace-pre-wrap text-sm text-neutral-800 bg-neutral-50 border border-neutral-200 rounded-lg p-4 font-sans">{text}</pre>
        </div>
      )}
    </div>
  );
}
