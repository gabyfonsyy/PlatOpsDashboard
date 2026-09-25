import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ValidationError } from "@/lib/work-route";

/**
 * Generates POST/PATCH/DELETE handlers for a Supabase-backed Project Tracking table, injecting
 * the session's email as created_by server-side (client forms never see or send it). Same
 * request/response contract as lib/gas-crud-route.ts's createCrudRouteHandlers (POST body =
 * payload, PATCH body = {id, ...payload}, DELETE body = {id}), so every existing form/table
 * component only needed its endpoint URL changed, not its call shape.
 */
export function createSupabaseCrudRouteHandlers<T>(table: {
  create: (email: string, payload: Record<string, unknown>) => Promise<T>;
  // `email` here is the acting user, for stores that log activity off a PATCH (e.g. updateProject,
  // updatePhase) — a store that doesn't need it can just declare fewer parameters and ignore it,
  // same as every other table passed to this factory already does.
  update: (id: string, payload: Record<string, unknown>, email: string) => Promise<T>;
  remove: (id: string) => Promise<void>;
}) {
  async function requireSessionEmail() {
    const session = await getServerSession(authOptions);
    return session?.user?.email ?? null;
  }

  function fail(err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: err instanceof ValidationError ? 400 : 502 }
    );
  }

  return {
    async POST(req: NextRequest) {
      const email = await requireSessionEmail();
      if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      try {
        const payload = await req.json();
        const data = await table.create(email, payload);
        return NextResponse.json({ ok: true, data });
      } catch (err) {
        return fail(err);
      }
    },

    async PATCH(req: NextRequest) {
      const email = await requireSessionEmail();
      if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      try {
        // created_by/author_email are stamped once at creation time and are not client-patchable —
        // forwarding a client-supplied value here would let an edit forge who authored the record
        // (or, worse, pass an author-only ownership check elsewhere by reassigning it to yourself).
        const { id, created_by: _createdBy, author_email: _authorEmail, ...payload } = await req.json();
        if (!id) throw new ValidationError("id is required.");
        const data = await table.update(id, payload, email);
        return NextResponse.json({ ok: true, data });
      } catch (err) {
        return fail(err);
      }
    },

    async DELETE(req: NextRequest) {
      const email = await requireSessionEmail();
      if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      try {
        const { id } = await req.json();
        if (!id) throw new ValidationError("id is required.");
        await table.remove(id);
        return NextResponse.json({ ok: true, data: { id, deleted: true } });
      } catch (err) {
        return fail(err);
      }
    },
  };
}
