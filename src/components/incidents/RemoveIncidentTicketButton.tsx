"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { celebrate } from "@/lib/celebrate";

/**
 * Retracts an incident: clears Report Tagging in Jira, then removes the ticket and any logs on it.
 *
 * Two-step in place rather than a `confirm()`, for the reason the same pattern gives on the project
 * card in TaskBoard.tsx — a native dialog can't state the two things that decide it: that this
 * edits the Jira ticket, and how many pieces of written feedback go with it.
 *
 * Both tables use this. In the queue there is nothing to lose (an unlogged ticket is pure mirrored
 * Jira data), so it reads as a quiet tertiary action. On a logged incident it is destroying
 * evaluation feedback, so the confirm names the count.
 */
export function RemoveIncidentTicketButton({
  issueKey,
  logCount = 0,
  className,
}: {
  issueKey: string;
  /** Logs that will be deleted with the ticket. Drives the confirm wording. */
  logCount?: number;
  className?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<"idle" | "removing">("idle");
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setState("removing");
    setError(null);
    try {
      const res = await fetch("/api/gas/incidents/ticket", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_key: issueKey }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      }
      celebrate("success");
      // The row disappears on the refresh; the confirm stays open until then so the button can't
      // be pressed a second time against a ticket that is already gone.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirming(false);
      celebrate("nope");
    } finally {
      setState("idle");
    }
  }

  return (
    // No align-items of its own: it sits in a left-aligned table cell in one table and a
    // right-aligned header group in the other, so the parent decides.
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      {confirming ? (
        <span className="inline-flex items-center gap-2 text-[11px]">
          <span className="text-neutral-500">
            Clears Report Tagging in Jira
            {logCount > 0 && ` and deletes ${logCount} log${logCount === 1 ? "" : "s"}`}.
          </span>
          <button
            onClick={remove}
            disabled={state === "removing"}
            className="text-red-600 hover:text-red-700 font-medium transition-colors disabled:cursor-wait disabled:opacity-60"
          >
            {state === "removing" ? "Removing…" : "Remove"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={state === "removing"}
            className="text-neutral-400 hover:text-neutral-600 transition-colors disabled:opacity-60"
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="text-[11px] text-neutral-400 hover:text-red-600 transition-colors inline-flex items-center gap-1"
          title="Not a valid incident — clear its Report Tagging in Jira and take it off this page"
          aria-label={`Remove ${issueKey} from the incident list`}
        >
          <Trash2 className="w-3 h-3" aria-hidden="true" />
          Not an incident
        </button>
      )}

      {/* The trigger stays available underneath a failure: the realistic error is a Jira
          permission one, and a retry after it's fixed shouldn't need a page reload. */}
      {error && (
        <span className="inline-flex flex-col gap-0.5 text-[11px] max-w-xs">
          <span className="text-red-600">{error}</span>
          {/* Stated because the alternative reading — "it half-happened" — is the one that sends
              you to Jira to check by hand. GAS clears the field before it touches the sheet, so a
              failure means nothing changed in either place. */}
          <span className="text-neutral-400">Nothing was removed; the Jira tag is still set.</span>
        </span>
      )}
    </span>
  );
}
