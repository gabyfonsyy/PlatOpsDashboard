"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const isDev = process.env.NODE_ENV === "development";

/**
 * Where signing in lands you. Your own work rather than the cross-team Overview: the first question
 * of the day is "what do I need to do", not "how is everyone doing". The Overview is still at "/"
 * via the Teams menu — this only changes the post-login destination.
 */
const LANDING_PAGE = "/my-work";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") router.push(LANDING_PAGE);
  }, [status, router]);

  async function handleSignIn() {
    setLoading(true);
    setError(null);
    const result = await signIn("google", { callbackUrl: LANDING_PAGE });
    if (result?.error) {
      setError("Access denied. Only @sprout.ph accounts are allowed.");
      setLoading(false);
    }
  }

  if (status === "loading" || status === "authenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sprout-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 overflow-hidden">
      {/* Ambient nebula glow accents */}
      <div className="pointer-events-none absolute -top-32 -left-24 w-96 h-96 rounded-full bg-sprout-300/30 blur-3xl animate-glow-pulse" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 w-[28rem] h-[28rem] rounded-full bg-fuchsia-200/30 blur-3xl animate-glow-pulse" />

      <div className="card relative w-full max-w-sm p-8 flex flex-col items-center gap-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sprout-400 to-sprout-600 flex items-center justify-center shadow-glow">
            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-white" stroke="currentColor" strokeWidth={2}>
              <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 7h7v7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-xs font-medium text-sprout-600 uppercase tracking-widest mb-1">Sprout</p>
            <h1 className="text-xl">Platform Operations Dashboard</h1>
          </div>
        </div>

        <p className="text-sm text-neutral-500 text-center">
          Sign in with your Sprout Google account to view SE, DBA, and DevOps operations metrics.
        </p>

        {error && (
          <div className="w-full px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={handleSignIn}
          disabled={loading}
          className="btn-primary w-full justify-center py-2.5"
        >
          {loading ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg viewBox="0 0 24 24" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" opacity={0.85} />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#fff" opacity={0.7} />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" opacity={0.9} />
            </svg>
          )}
          {loading ? "Signing in…" : "Sign in with Google"}
        </button>

        <p className="text-xs text-neutral-400 text-center">
          Restricted to @sprout.ph accounts only
        </p>

        {isDev && (
          <div className="w-full border-t border-neutral-100 pt-4 flex flex-col gap-2">
            <p className="text-[11px] text-neutral-400 text-center uppercase tracking-wider">Dev only</p>
            <button
              onClick={() => signIn("dev-bypass", { callbackUrl: LANDING_PAGE })}
              className="btn-secondary w-full justify-center py-2"
            >
              Skip login (local dev)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
