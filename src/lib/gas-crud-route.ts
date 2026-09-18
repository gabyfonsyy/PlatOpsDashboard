import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { postGas } from "@/lib/gas-client";

/**
 * Generates POST/PATCH/DELETE handlers proxying to a GAS CRUD route, injecting the session's
 * email as created_by server-side (client forms never see or send it).
 *
 * Every handler is wrapped in try/catch and returns the app's uniform `{ok:false, error}` JSON
 * contract on failure — unlike an earlier version of this file, which let a malformed body
 * (`req.json()` throwing) or a GAS-side failure escape as an unhandled exception (a non-JSON
 * framework error page), which every frontend caller's `res.json().catch(() => ({}))` silently
 * swallowed as if the write had succeeded. Mirrors lib/work-route.ts's `handle()` posture.
 */
export function createCrudRouteHandlers(route: string) {
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
        const data = await postGas(route, "create", { ...payload, created_by: email });
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
        const data = await postGas(route, "update", payload, id);
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
        const data = await postGas(route, "delete", {}, id);
        return NextResponse.json({ ok: true, data });
      } catch (err) {
        return fail(err);
      }
    },
  };
}
