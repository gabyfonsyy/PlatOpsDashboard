"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The star field for Gaby View.
 *
 * ── Why this is DOM and not more CSS gradients ────────────────────────────────────────────────
 * The background was a stack of `radial-gradient` layers, which is cheap and was the right call
 * while it held twenty dots. It cannot do what this needs: every star in a gradient list shares
 * its layer's blur, and a layer either animates as a whole or not at all. So "vary the size,
 * opacity and blur so they don't look like a repeated pattern" and "stars can subtly twinkle" are
 * both unreachable — whole-layer opacity is the sky dimming, not a star twinkling.
 *
 * One span per star gives each its own size, alpha, colour, softness and animation phase, at the
 * cost of ~130 tiny absolutely-positioned elements that never move the layout and never repaint.
 * That is a cost the browser is extremely good at.
 *
 * ── Why the positions are generated and not written out ───────────────────────────────────────
 * Hand-placed stars end up evenly spread, because a person distributing points avoids clumps —
 * and an even rhythm is spotted as fast as a shape is. This uses a seeded PRNG so the field is
 * genuinely irregular, with real clusters and real emptiness.
 *
 * SEEDED rather than `Math.random()`, and the seed is fixed: the sky is the same sky on every
 * load and on every page. It is her window, not a slideshow — a background that reshuffles itself
 * when you navigate is a background you start looking at.
 *
 * ── Why it renders in every theme, and only after mount ───────────────────────────────────────
 * WHICH theme is gated by CSS (`[data-theme="adhd"]`), not by JS: the theme is applied by a
 * pre-hydration script, so a JS theme check would need the class to change after hydration.
 *
 * WHETHER it renders at all is gated on mount, and that is a size decision made with a
 * measurement. Server-rendered, 144 stars came to 25KB of inline style attributes — 34% of the
 * document, and again in the RSC payload — to draw a background. Mounting on the client instead
 * costs nothing on the wire and is visually identical, because the layer fades in over 1.6s
 * regardless: "appears at first paint then fades in" and "appears at hydration then fades in" are
 * the same thing to look at.
 *
 * Under `display: none` the spans cost nothing, so the non-Gaby themes pay only the mount.
 */

/** mulberry32 — 4 lines, no dependency, and the same sequence in every engine. */
function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Star = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  colour: string;
  /** Softness in px. 0 is a crisp point; higher reads as further away or out of focus. */
  blur: number;
  /** Glow radius in px. Only the few brightest get one. */
  glow: number;
  /** Seconds. 0 means it does not twinkle. */
  twinkle: number;
  /** Negative delay, so the field is mid-animation on first paint rather than starting in unison. */
  delay: number;
};

/**
 * Accent stars. Rare on purpose: the palette's own accents have to stay the brightest coloured
 * things on the screen, so the sky gets a handful of very dim ones and no more.
 */
const ACCENTS = ["186 230 253", "199 190 250", "167 243 224"];

/**
 * Clustering is the whole trick. Uniform random points look surprisingly regular — the clumps a
 * real sky has come from stars being drawn toward each other, so this scatters a few dozen loose
 * points and then packs small groups around a handful of anchors.
 */
function buildField(): Star[] {
  const rand = rng(0x5eed10);
  const stars: Star[] = [];

  const push = (rawX: number, rawY: number, tier: "far" | "mid" | "near") => {
    if (rawX < -2 || rawX > 102 || rawY < -2 || rawY > 102) return;
    // Two decimals is finer than a pixel at any plausible viewport width, and it keeps a raw
    // 17-significant-digit PRNG float out of every style attribute.
    const x = Math.round(rawX * 100) / 100;
    const y = Math.round(rawY * 100) / 100;
    const r = rand();
    if (tier === "far") {
      stars.push({
        x,
        y,
        size: 1,
        // Most of the field sits at the very bottom of the visible range. It should read as
        // texture you cannot quite resolve, not as a dot you can count.
        opacity: Math.round((0.1 + r * 0.16) * 100) / 100,
        colour: "226 236 252",
        blur: r > 0.75 ? 0.6 : 0,
        glow: 0,
        twinkle: 0,
        delay: 0,
      });
      return;
    }
    if (tier === "mid") {
      const accent = r > 0.86;
      stars.push({
        x,
        y,
        size: r > 0.6 ? 1.5 : 1,
        opacity: Math.round((0.26 + r * 0.2) * 100) / 100,
        colour: accent ? ACCENTS[Math.floor(rand() * ACCENTS.length)] : "236 244 255",
        blur: r > 0.8 ? 0.5 : 0,
        glow: 0,
        // A minority twinkle, each on its own clock. Long periods: at 7-13s a star reads as
        // breathing, and anything quicker reads as a cursor blinking at the edge of vision.
        twinkle: r > 0.55 ? Math.round((7 + rand() * 6) * 10) / 10 : 0,
        delay: -Math.round(rand() * 120) / 10,
      });
      return;
    }
    const accent = r > 0.55;
    stars.push({
      x,
      y,
      size: Math.round((1.5 + rand()) * 10) / 10,
      opacity: Math.round((0.5 + r * 0.3) * 100) / 100,
      colour: accent ? ACCENTS[Math.floor(rand() * ACCENTS.length)] : "246 250 255",
      blur: 0,
      glow: Math.round((2 + rand() * 3) * 10) / 10,
      twinkle: Math.round((9 + rand() * 7) * 10) / 10,
      delay: -Math.round(rand() * 140) / 10,
    });
  };

  // Loose scatter — the bulk of the sky.
  for (let i = 0; i < 74; i++) push(rand() * 100, rand() * 100, "far");
  for (let i = 0; i < 18; i++) push(rand() * 100, rand() * 100, "mid");

  // Clusters. Small, tight, and few — these are what stop the scatter looking uniform.
  for (let c = 0; c < 6; c++) {
    const cx = 6 + rand() * 88;
    const cy = 6 + rand() * 88;
    const count = 4 + Math.floor(rand() * 6);
    for (let i = 0; i < count; i++) {
      // Gaussian-ish spread, so a cluster is dense in the middle and frays at the edge.
      const dx = (rand() + rand() - 1) * 7;
      const dy = (rand() + rand() - 1) * 6;
      push(cx + dx, cy + dy, rand() > 0.82 ? "mid" : "far");
    }
  }

  // The bright few. Deliberately last and deliberately countable — eight points of real light in
  // the entire sky.
  for (let i = 0; i < 8; i++) push(rand() * 100, rand() * 100, "near");

  return stars;
}

/**
 * Distant light clusters: a smudge of unresolved stars, the thing that reads as "there is more out
 * there than I can see". Three, all tiny, all barely there.
 */
const SMUDGES = [
  { x: 21, y: 68, w: 150, h: 90, rot: -18, colour: "142 176 232", alpha: 0.07 },
  { x: 73, y: 26, w: 190, h: 70, rot: 24, colour: "168 158 224", alpha: 0.055 },
  { x: 55, y: 84, w: 120, h: 80, rot: 8, colour: "128 190 214", alpha: 0.05 },
];

const FIELD = buildField();

export function SpaceField() {
  // Deliberately not rendered on the server — see the note above. The field is decorative, so
  // there is nothing here worth a single byte of the document.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <div className="space-field" aria-hidden="true">
      {/* Dust and haze sit in their own layer rather than on the body background, so they can
          drift without dragging the stars with them. */}
      <div className="space-dust" />

      <div className="space-stars">
        {FIELD.map((s, i) => (
          <span
            key={i}
            className={cn("space-star", s.twinkle > 0 && "space-star-twinkle")}
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: `${s.size}px`,
              height: `${s.size}px`,
              opacity: s.opacity,
              backgroundColor: `rgb(${s.colour})`,
              ...(s.blur ? { filter: `blur(${s.blur}px)` } : {}),
              ...(s.glow ? { boxShadow: `0 0 ${s.glow}px rgb(${s.colour} / 0.75)` } : {}),
              ...(s.twinkle
                ? { animationDuration: `${s.twinkle}s`, animationDelay: `${s.delay}s` }
                : {}),
            }}
          />
        ))}
      </div>

      <div className="space-smudges">
        {SMUDGES.map((g, i) => (
          <span
            key={i}
            className="space-smudge"
            style={{
              left: `${g.x}%`,
              top: `${g.y}%`,
              width: `${g.w}px`,
              height: `${g.h}px`,
              transform: `translate(-50%, -50%) rotate(${g.rot}deg)`,
              background: `radial-gradient(closest-side, rgb(${g.colour} / ${g.alpha}), transparent 75%)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
