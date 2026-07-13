/**
 * sound.ts — procedural SFX via Web Audio (copied from patterns/, extended).
 * Zero asset files, offline-capable. Call sfx.unlock() from the first user
 * gesture, then sfx.play('coin'). Some plays take an optional pitch multiplier
 * so the tile-chain blip can rise as the word grows.
 */

export type SfxName =
  | 'blip'
  | 'select'
  | 'coin'
  | 'hit'
  | 'powerup'
  | 'lose'
  | 'win'
  | 'tick'
  | 'steal';

interface Patch {
  type: OscillatorType;
  freq: [number, number];
  dur: number;
  gain?: number;
  noise?: boolean;
}

const PATCHES: Record<SfxName, Patch> = {
  blip: { type: 'square', freq: [440, 620], dur: 0.06, gain: 0.18 },
  select: { type: 'triangle', freq: [520, 760], dur: 0.07, gain: 0.16 },
  coin: { type: 'square', freq: [880, 1320], dur: 0.12, gain: 0.2 },
  powerup: { type: 'square', freq: [520, 1240], dur: 0.32, gain: 0.22 },
  hit: { type: 'sawtooth', freq: [220, 70], dur: 0.16, gain: 0.26, noise: true },
  lose: { type: 'sawtooth', freq: [400, 110], dur: 0.55, gain: 0.3 },
  win: { type: 'triangle', freq: [520, 1180], dur: 0.55, gain: 0.28 },
  tick: { type: 'sine', freq: [880, 880], dur: 0.05, gain: 0.14 },
  steal: { type: 'sawtooth', freq: [520, 180], dur: 0.22, gain: 0.22 },
};

export interface Sfx {
  unlock(): void;
  play(name: SfxName, pitch?: number): void;
  muted(): boolean;
  setMuted(m: boolean): void;
}

export function createSfx(initialMuted = false): Sfx {
  let ctx: AudioContext | null = null;
  let muted = initialMuted;

  const ensure = (): AudioContext | null => {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  };

  const noiseBuffer = (ac: AudioContext, dur: number): AudioBuffer => {
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  };

  return {
    unlock() {
      ensure();
    },
    play(name, pitch = 1) {
      if (muted) return;
      const ac = ensure();
      if (!ac) return;
      const p = PATCHES[name];
      const t0 = ac.currentTime;
      const g = ac.createGain();
      g.gain.setValueAtTime(p.gain ?? 0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.dur);
      g.connect(ac.destination);

      const osc = ac.createOscillator();
      osc.type = p.type;
      osc.frequency.setValueAtTime(p.freq[0] * pitch, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, p.freq[1] * pitch), t0 + p.dur);
      osc.connect(g);
      osc.start(t0);
      osc.stop(t0 + p.dur);

      if (p.noise) {
        const n = ac.createBufferSource();
        n.buffer = noiseBuffer(ac, p.dur);
        const ng = ac.createGain();
        ng.gain.setValueAtTime((p.gain ?? 0.25) * 0.6, t0);
        ng.gain.exponentialRampToValueAtTime(0.0001, t0 + p.dur);
        n.connect(ng);
        ng.connect(ac.destination);
        n.start(t0);
        n.stop(t0 + p.dur);
      }
    },
    muted: () => muted,
    setMuted(m) {
      muted = m;
    },
  };
}
