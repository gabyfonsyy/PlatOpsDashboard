import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Generates POST/PATCH/DELETE handlers for a Supabase-backed Project Tracking table, injecting
 * the session's email as created_by server-side (client forms never see or send it). Same
 * request/response contract as lib/gas-crud-route.ts's createCrudRouteHandlers (POST body =
 * payload, PATCH body = {id, ...payload}, DELETE body = {id}), so every existing form/table
 * component only needed its endpoint URL changed, not its call shape.
 */
export function createSupabaseCrudRouteHandlers<T>(table: {
  create: (email: string, payload: Record<string, unknown>) => Promise<T>;
  update: (id: string, payload: Record<string, unknown>) => Promise<T>;
  remove: (id: string) => Promise<void>;
}) {
  async function requireSessionEmail() {
    const session = await getServerSession(authOptions);
    return session?.user?.email ?? null;
  }

  function fail(err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
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
        const { id, ...payload } = await req.json();
        if (!id) throw new Error("id is required.");
        const data = await table.update(id, payload);
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
        if (!id) throw new Error("id is required.");
        await table.remove(id);
        return NextResponse.json({ ok: true, data: { id, deleted: true } });
      } catch (err) {
        return fail(err);
      }
    },
  };
}
