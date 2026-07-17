/**
 * modes.test.ts — the host's mode is what the room plays.
 *
 * A mode changes the board size AND the clock, so if two peers resolve it
 * differently they are not playing the same game on the same grid — the same
 * class of bug as the roster drift that put scores on the wrong name. The mode
 * therefore travels frozen inside the round start, and these tests pin that.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_MODE, MODES, MODE_LIST, modeOf } from '../src/modes';
import { generateBoard, solveBoard } from '../src/board';
import { isPrefix, isWord } from '../src/dictionary';

describe('modeOf', () => {
  it('resolves a known id', () => {
    expect(modeOf('marathon').size).toBe(5);
    expect(modeOf('blitz').durationMs).toBe(45_000);
  });

  it('falls back rather than handing generateBoard an undefined size', () => {
    // A start from an older peer, a corrupted store, or a hand-edited message.
    // Without the fallback this becomes generateBoard(seed, undefined) -> a NaN
    // grid, so a mismatched peer crashes instead of playing Classic.
    for (const bad of [undefined, null, '', 'nope', 42, {}]) {
      expect(modeOf(bad as unknown).id).toBe(DEFAULT_MODE);
      expect(Number.isInteger(modeOf(bad as unknown).size)).toBe(true);
    }
  });

  it('resolves a hostile id off the wire without inheriting from Object', () => {
    // MODES is an object literal, so 'constructor' / 'toString' are truthy on it.
    // Returning one of those as a Mode would put `undefined` in every field —
    // the exact NaN grid the fallback above exists to prevent, reached through
    // the one input it exists to distrust.
    for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(modeOf(bad).id).toBe(DEFAULT_MODE);
      expect(Number.isInteger(modeOf(bad).size)).toBe(true);
    }
  });
});

describe('the modes are actually different games', () => {
  it('offers a real spread of grid and clock', () => {
    const sizes = new Set(MODE_LIST.map((m) => m.size));
    const times = new Set(MODE_LIST.map((m) => m.durationMs));
    expect(sizes.size).toBeGreaterThan(1);
    expect(times.size).toBe(MODE_LIST.length); // no two modes feel the same
  });

  it('builds the grid its mode asks for', () => {
    for (const m of MODE_LIST) {
      const board = generateBoard(7, m.size);
      expect(board.size).toBe(m.size);
      expect(board.tiles).toHaveLength(m.size * m.size);
    }
  });

  it('makes Marathon a genuinely richer board, not just a slower one', () => {
    // Average, never a single seed: board richness is noisy enough that a 5x5
    // can lose to a 4x4 on any given draw (seed 7 does, 44 words to 46). The
    // claim worth pinning is the distribution — if the bigger grid did not hold
    // materially more words on average, the extra time would just be waiting.
    const mean = (size: number): number => {
      let n = 0;
      for (let s = 0; s < 20; s++) n += solveBoard(generateBoard(s, size), isWord, isPrefix).size;
      return n / 20;
    };
    expect(mean(MODES.marathon.size)).toBeGreaterThan(mean(MODES.classic.size) * 1.4);
  });

  it('keeps every mode solvable inline at round end', () => {
    for (const m of MODE_LIST) {
      solveBoard(generateBoard(1, m.size), isWord, isPrefix); // warm
      const t0 = performance.now();
      for (let s = 0; s < 10; s++) solveBoard(generateBoard(s, m.size), isWord, isPrefix);
      expect((performance.now() - t0) / 10, `${m.id} solve`).toBeLessThan(150);
    }
  });
});
