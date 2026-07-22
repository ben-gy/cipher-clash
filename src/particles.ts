// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * particles.ts — a tiny canvas particle overlay for score juice. Bursts a spray
 * of glyphs/dots in a player's colour when a word is claimed. Fully disabled
 * under prefers-reduced-motion (bursts become no-ops). The owning session calls
 * `tick()` once per animation frame.
 */

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  char: string;
  rot: number;
  vr: number;
}

export interface Particles {
  resize(): void;
  burst(x: number, y: number, color: string, chars: string): void;
  ring(x: number, y: number, color: string): void;
  tick(): void;
  clear(): void;
  destroy(): void;
}

export function createParticles(canvas: HTMLCanvasElement, reducedMotion: boolean): Particles {
  const ctx = canvas.getContext('2d');
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  const particles: P[] = [];
  const rings: { x: number; y: number; r: number; max: number; color: string }[] = [];

  function resize(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
  }
  resize();

  function burst(x: number, y: number, color: string, chars: string): void {
    if (reducedMotion || !ctx) return;
    const glyphs = (chars || '★').toUpperCase();
    const n = Math.min(18, 8 + glyphs.length * 2);
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const sp = 60 + Math.random() * 160;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 0,
        max: 0.6 + Math.random() * 0.5,
        size: 12 + Math.random() * 10,
        color,
        char: glyphs[i % glyphs.length],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 8,
      });
    }
  }

  function ring(x: number, y: number, color: string): void {
    if (reducedMotion || !ctx) return;
    rings.push({ x, y, r: 8, max: 90, color });
  }

  let lastT = performance.now();
  function tick(): void {
    if (!ctx) return;
    const now = performance.now();
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.max) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += 520 * dt; // gravity
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const t = 1 - p.life / p.max;
      ctx.save();
      ctx.globalAlpha = Math.max(0, t);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.font = `700 ${p.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.char, 0, 0);
      ctx.restore();
    }

    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += (r.max - r.r) * Math.min(1, dt * 8);
      const t = 1 - r.r / r.max;
      if (t <= 0.02) {
        rings.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, t) * 0.7;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function clear(): void {
    particles.length = 0;
    rings.length = 0;
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { resize, burst, ring, tick, clear, destroy: clear };
}
