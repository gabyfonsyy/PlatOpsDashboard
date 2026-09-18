import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Shared plumbing for the /api/work/* handlers.
 *
 * The email comes from the session and is NEVER read from the request body. Task rows are keyed
 * by email, so accepting it from the client would let anyone read or edit anyone else's board by
 * changing one field.
 */
export async function requireEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.email ?? null;
}

export function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

/**
 * Throw this for an ordinary client-input problem (missing field, bad value) — handle() reports
 * it as 400, not 502. A plain `throw new Error(...)` still works exactly as before (502) for call
 * sites that haven't been updated to distinguish the two; this is additive, not a required
 * migration. Found via a full-codebase audit: routes across this file's ~20 callers throw a
 * validation message like "A task needs a title." and it was shipping as 502 Bad Gateway,
 * indistinguishable from a real upstream failure — any status-code-based monitoring would read
 * routine user mistakes as backend outages.
 */
export class ValidationError extends Error {}

/** Uniform envelope + error shape, matching the /api/gas/* routes. */
export async function handle<T>(fn: (email: string) => Promise<T>) {
  const email = await requireEmail();
  if (!email) return unauthorized();
  try {
    return NextResponse.json({ ok: true, data: await fn(email) });
  } catch (err) {
    const status = err instanceof ValidationError ? 400 : 502;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status }
    );
  }
}
