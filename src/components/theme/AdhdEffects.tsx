"use client";

import { useEffect, useRef } from "react";
import { CELEBRATE_EVENT, type CelebrateDetail } from "@/lib/celebrate";

/**
 * ADHD View's personality layer: a sparkle trail on the cursor, a burst on click, and louder
 * bursts for rewards fired through the celebrate() bus.
 *
 * Design constraints this is built around, in priority order:
 *
 *  1. It must never cost anything when idle. One <canvas>, one rAF loop, and the loop STOPS
 *     itself the moment the particle array empties — at which point the canvas is also taken out
 *     of the layer tree entirely (display:none), so an untouched tab isn't holding a
 *     viewport-sized composited surface open all afternoon. Which matters, because this is a tool
 *     people leave open all day next to a real incident.
 *  2. It must never interfere. The canvas is fixed, `pointer-events: none`, and `aria-hidden`, so
 *     it cannot intercept a click or reach a screen reader.
 *  3. It must be bounded. Hard cap on particle count, spawn rate throttled by distance travelled
 *     rather than by event frequency (a high-poll-rate mouse must not multiply the work).
 *  4. Reduced motion means *not rendered*, not "rendered smaller". ThemeProvider decides whether
 *     to mount this at all (OS preference, unless explicitly overridden), so by the time this
 *     runs the answer is already yes — there is no second gate here to disagree with it.
 *
 * Every spark is a pre-baked sprite, drawn with a single drawImage. The obvious implementation —
 * createRadialGradient + arc + fill per particle per frame — allocates a gradient object and
 * rasterises a soft ~46px-wide circle for each of up to 140 particles, sixty times a second, and
 * that was the difference between a smooth trail and a trail that visibly drops frames while the
 * rest of the app is trying to render. The sprites are built once (see buildSprites) and cost one
 * texture blit each thereafter.
 */

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining life, 1 -> 0. */
  life: number;
  decay: number;
  size: number;
  /** Index into SPRITES — a (hue, rotation) pair, chosen once at spawn. */
  sprite: number;
  /** Whether this spark is big enough to carry the 4-point star. */
  starry: boolean;
};

/** Above the app but below nothing that matters — the canvas can't be interacted with anyway. */
const CANVAS_Z_INDEX = 60;

/** Hard ceiling. Reached only by an easter egg; ordinary use sits well under it. */
const MAX_PARTICLES = 140;

/** Minimum pointer travel (px) between trail spawns. Decouples spawn rate from event rate. */
const TRAIL_SPACING = 14;

/**
 * Stardust: icy blues through periwinkle, matching the theme's accent. Trail hues are picked from
 * this list only.
 */
const PALETTE = [225, 240, 255, 205, 275];

/**
 * Failure gets its own hue, kept OUT of the palette so a red spark can never turn up in an ordinary
 * cursor trail. Its sprites are built alongside the others and addressed by a fixed block index.
 */
const NOPE_HUE = 355;
const NOPE_BLOCK = PALETTE.length * (1 + 4);

/**
 * A 4-point star looks identical every 90°, so four rotation steps cover every orientation the
 * old per-particle `ctx.rotate` produced. 6 hues x (1 plain + 4 starred) = 30 small textures,
 * built once, and no transform work per particle for the rest of the session.
 */
const ROTATIONS = 4;
const VARIANTS = 1 + ROTATIONS;
/** Sprite edge in CSS px. The glow fills the middle third, so a spark of radius r draws at 6r. */
const SPRITE_EDGE = 48;

type Sprite = { canvas: HTMLCanvasElement };

/**
 * Bakes the glow (and optionally the star) for one hue/rotation into its own canvas. Called
 * VARIANTS x PALETTE.length times at mount and on DPR change, never during a frame.
 */
function buildSprites(dpr: number): Sprite[] {
  const sprites: Sprite[] = [];
  const edge = SPRITE_EDGE * dpr;
  const mid = edge / 2;
  // The glow's outer edge. A particle drawn at destination size 6r maps this back to r*3, which
  // is the radius the gradient version used.
  const glowR = mid;
  // Where the particle's own radius `r` lands in sprite space — the star is sized off this.
  const unit = glowR / 3;

  for (const hue of [...PALETTE, NOPE_HUE]) {
    for (let variant = 0; variant < VARIANTS; variant++) {
      const canvas = document.createElement("canvas");
      canvas.width = edge;
      canvas.height = edge;
      const c = canvas.getContext("2d");
      if (!c) continue;

      // Alpha is applied per-draw via globalAlpha, so the sprite bakes the shape at full strength
      // and the relative stops of the original gradient.
      const grad = c.createRadialGradient(mid, mid, 0, mid, mid, glowR);
      grad.addColorStop(0, `hsla(${hue}, 100%, 88%, 1)`);
      grad.addColorStop(0.4, `hsla(${hue}, 95%, 72%, 0.55)`);
      grad.addColorStop(1, `hsla(${hue}, 90%, 65%, 0)`);
      c.fillStyle = grad;
      c.beginPath();
      c.arc(mid, mid, glowR, 0, Math.PI * 2);
      c.fill();

      if (variant > 0) {
        const arm = unit * 2.1;
        c.save();
        c.translate(mid, mid);
        c.rotate(((variant - 1) / ROTATIONS) * (Math.PI / 2));
        c.strokeStyle = `hsla(${hue}, 100%, 95%, 0.9)`;
        c.lineWidth = 0.9 * dpr * 3;
        c.beginPath();
        c.moveTo(-arm, 0);
        c.lineTo(arm, 0);
        c.moveTo(0, -arm);
        c.lineTo(0, arm);
        c.stroke();
        c.restore();
      }

      sprites.push({ canvas });
    }
  }
  return sprites;
}

function makeParticle(x: number, y: number, opts: Partial<Particle> = {}): Particle {
  const angle = Math.random() * Math.PI * 2;
  const speed = 0.15 + Math.random() * 0.5;
  const size = opts.size ?? 1.6 + Math.random() * 2.2;
  const starry = opts.starry ?? size > 2.4;
  // A hue block is VARIANTS wide; index 0 of the block is the plain glow, 1..4 the starred ones.
  // Only PALETTE's blocks are randomisable — NOPE_HUE's block is addressed explicitly or never.
  const block = ((Math.random() * PALETTE.length) | 0) * VARIANTS;
  const sprite = block + (starry ? 1 + ((Math.random() * ROTATIONS) | 0) : 0);
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 0.12, // slight upward bias: sparks drift, they don't fall
    life: 1,
    decay: 0.022 + Math.random() * 0.02,
    size,
    sprite,
    starry,
    ...opts,
  };
}

export default function AdhdEffects() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastSpawn = useRef({ x: 0, y: 0 });
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    // Cap DPR at 2: a 3x backing store triples fill cost for no perceptible gain on 2px sparks.
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let sprites = buildSprites(dpr);
    let width = 0;
    let height = 0;

    function resize() {
      const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
      // Reallocating the backing store is expensive and a drag-resize fires this continuously, so
      // identical dimensions are a no-op rather than a rebuild.
      if (nextDpr === dpr && window.innerWidth === width && window.innerHeight === height) return;
      if (nextDpr !== dpr) {
        dpr = nextDpr;
        sprites = buildSprites(dpr);
      }
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
    }
    resize();

    /**
     * The canvas is only in the layer tree while there's something on it. Hidden, it costs the
     * compositor nothing; visible-but-empty it is still a viewport-sized surface being composited
     * over the whole page for as long as the tab is open.
     */
    function setVisible(on: boolean) {
      canvas!.style.display = on ? "block" : "none";
    }
    setVisible(false);

    function draw() {
      const list = particles.current;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      // Additive blending: overlapping sparks brighten instead of muddying.
      ctx!.globalCompositeOperation = "lighter";

      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.008; // the faintest gravity, so bursts arc
        p.life -= p.decay;

        if (p.life <= 0) {
          list.splice(i, 1);
          continue;
        }

        // Ease the fade so sparks linger bright then vanish, rather than dimming linearly.
        ctx!.globalAlpha = p.life * p.life;
        const r = p.size * (0.6 + p.life * 0.8);
        const d = r * 6; // sprite edge maps to 6r — see buildSprites
        const sprite = sprites[p.sprite] ?? sprites[0];
        if (sprite) ctx!.drawImage(sprite.canvas, p.x - d / 2, p.y - d / 2, d, d);
      }

      ctx!.globalAlpha = 1;
      ctx!.globalCompositeOperation = "source-over";

      // Self-terminating loop. This is what makes the effect free when idle.
      if (list.length > 0) {
        rafRef.current = window.requestAnimationFrame(draw);
      } else {
        rafRef.current = null;
        ctx!.clearRect(0, 0, width, height);
        setVisible(false);
      }
    }

    function ensureRunning() {
      setVisible(true);
      if (rafRef.current === null) rafRef.current = window.requestAnimationFrame(draw);
    }

    function spawn(x: number, y: number, count: number, opts: Partial<Particle> = {}) {
      const list = particles.current;
      const room = MAX_PARTICLES - list.length;
      if (room <= 0) return;
      const n = Math.min(count, room);
      for (let i = 0; i < n; i++) list.push(makeParticle(x, y, opts));
      ensureRunning();
    }

    function onPointerMove(e: PointerEvent) {
      pointer.current = { x: e.clientX, y: e.clientY };
      const dx = e.clientX - lastSpawn.current.x;
      const dy = e.clientY - lastSpawn.current.y;
      const dist = Math.hypot(dx, dy);
      if (dist < TRAIL_SPACING) return;
      lastSpawn.current = { x: e.clientX, y: e.clientY };

      // Faster movement => slightly more sparks, capped. Gives the trail a sense of momentum
      // without letting a fast flick across the screen dump 50 particles.
      const extra = dist > 60 ? 2 : dist > 30 ? 1 : 0;
      spawn(e.clientX, e.clientY, 1 + extra, { decay: 0.03 + Math.random() * 0.02 });

      // Hovering something interactive earns one brighter spark — the "tiny additional sparkle"
      // from the brief, driven off the element under the cursor rather than per-component wiring.
      const el = e.target as HTMLElement | null;
      if (el?.closest("button, a, select, [role='menuitem'], input, textarea")) {
        if (Math.random() < 0.5) {
          spawn(e.clientX, e.clientY, 1, { size: 3.2, decay: 0.02 });
        }
      }
    }

    function onPointerDown(e: PointerEvent) {
      pointer.current = { x: e.clientX, y: e.clientY };
      spawn(e.clientX, e.clientY, 12, { decay: 0.026, size: 2 + Math.random() * 2.4 });
    }

    function onCelebrate(e: Event) {
      const detail = (e as CustomEvent<CelebrateDetail>).detail;
      const x = detail?.x ?? pointer.current.x ?? window.innerWidth / 2;
      const y = detail?.y ?? pointer.current.y ?? window.innerHeight / 2;
      switch (detail?.kind) {
        case "milestone":
          spawn(x, y, 40, { decay: 0.014, size: 2.4 + Math.random() * 2.6 });
          break;
        case "chaos":
          // The only thing allowed near the cap.
          spawn(x, y, 70, { decay: 0.01, size: 2 + Math.random() * 3.4 });
          break;
        case "nope":
          // Failure gets acknowledgement, not confetti. Fixed to the red end of the palette.
          spawn(x, y, 5, { decay: 0.05, size: 1.4, starry: false, sprite: NOPE_BLOCK });
          break;
        default:
          spawn(x, y, 18, { decay: 0.02 });
      }
    }

    /**
     * Easter egg #2: type the secret word. Ignored entirely while focus is in a field, so it can
     * never fire mid-way through writing incident feedback — the one place stray behaviour would
     * actually cost something.
     */
    let typed = "";
    function onKeyDown(e: KeyboardEvent) {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      typed = (typed + e.key.toLowerCase()).slice(-4);
      if (typed === "gaby") {
        typed = "";
        spawn(window.innerWidth / 2, window.innerHeight / 3, 70, {
          decay: 0.01,
          size: 2 + Math.random() * 3.4,
        });
      }
    }

    // Resize is coalesced to one rAF: a drag-resize fires the event dozens of times a second and
    // each handled one would otherwise reallocate a full-viewport backing store.
    let resizeQueued = false;
    function onResize() {
      if (resizeQueued) return;
      resizeQueued = true;
      window.requestAnimationFrame(() => {
        resizeQueued = false;
        resize();
      });
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(CELEBRATE_EVENT, onCelebrate as EventListener);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(CELEBRATE_EVENT, onCelebrate as EventListener);
      window.removeEventListener("resize", onResize);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      particles.current = [];
      sprites = [];
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: CANVAS_Z_INDEX }}
    />
  );
}
