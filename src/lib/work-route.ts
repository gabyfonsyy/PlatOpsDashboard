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

/** Uniform envelope + error shape, matching the /api/gas/* routes. */
export async function handle<T>(fn: (email: string) => Promise<T>) {
  const email = await requireEmail();
  if (!email) return unauthorized();
  try {
    return NextResponse.json({ ok: true, data: await fn(email) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
