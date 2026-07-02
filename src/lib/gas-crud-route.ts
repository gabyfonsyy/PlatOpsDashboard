import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { postGas } from "@/lib/gas-client";

/** Generates POST/PATCH/DELETE handlers proxying to a GAS CRUD route, injecting the
 * session's email as created_by server-side (client forms never see or send it). */
export function createCrudRouteHandlers(route: string) {
  async function requireSessionEmail() {
    const session = await getServerSession(authOptions);
    return session?.user?.email ?? null;
  }

  return {
    async POST(req: NextRequest) {
      const email = await requireSessionEmail();
      if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      const payload = await req.json();
      const data = await postGas(route, "create", { ...payload, created_by: email });
      return NextResponse.json({ ok: true, data });
    },

    async PATCH(req: NextRequest) {
      const email = await requireSessionEmail();
      if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      const { id, ...payload } = await req.json();
      const data = await postGas(route, "update", payload, id);
      return NextResponse.json({ ok: true, data });
    },

    async DELETE(req: NextRequest) {
      const email = await requireSessionEmail();
      if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      const { id } = await req.json();
      const data = await postGas(route, "delete", {}, id);
      return NextResponse.json({ ok: true, data });
    },
  };
}
