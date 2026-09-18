import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Written directly against getToken() rather than next-auth/middleware's withAuth default export.
 *
 * withAuth's only unauthenticated behavior is a redirect to the sign-in page — for a page request
 * that's correct, but for an API request it's a real bug: fetch() follows redirects by default,
 * so an expired-session write to any /api/** route landed on the 200 HTML /login page instead of
 * a 401. Every write call site in this app checks `!res.ok || body?.ok === false` after a
 * `res.json().catch(() => ({}))` — a 200 HTML response makes `res.ok` true and the JSON parse
 * throw into that catch, so the error branch never fires. The UI reported success and the write
 * was silently dropped. Found via a full-codebase audit, confirmed against next-auth's own
 * withAuth source before fixing.
 *
 * API routes now get a real `401 {ok:false}` JSON response instead, which every existing caller's
 * error check already handles correctly — this fixes the silent-failure without needing to touch
 * any of the ~20 route files or their frontend callers.
 */
export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const signInUrl = new URL("/login", req.url);
  signInUrl.searchParams.set("callbackUrl", req.url);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
