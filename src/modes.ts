// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * modes.ts — the shapes a round can take.
 *
 * One knob each: how big the grid is, and how long you get. Bigger grids are not
 * just "more" — a 5x5 holds roughly double the findable words and rewards
 * hunting long words over sweeping for threes, so the extra time is part of the
 * mode, not a separate setting to fiddle with.
 *
 * The host picks; the choice travels frozen inside the round start (see
 * engine/rematch.ts), so every peer plays the same board for the same length.
 * A mode each peer read from its own UI is a mode two peers can disagree about.
 */

export interface Mode {
  id: ModeId;
  name: string;
  /** Grid edge. board.ts generates and solves any size. */
  size: number;
  durationMs: number;
  /** One line, shown under the name — say what it FEELS like, not the numbers. */
  blurb: string;
}

export type ModeId = 'blitz' | 'classic' | 'marathon';

export const MODES: Record<ModeId, Mode> = {
  blitz: {
    id: 'blitz',
    name: 'Blitz',
    size: 4,
    durationMs: 45_000,
    blurb: 'Small grid, 45 seconds. Grab what you see.',
  },
  classic: {
    id: 'classic',
    name: 'Classic',
    size: 4,
    durationMs: 90_000,
    blurb: 'The original. 4×4, 90 seconds.',
  },
  marathon: {
    id: 'marathon',
    name: 'Marathon',
    size: 5,
    durationMs: 180_000,
    blurb: '5×5 and three minutes — room for the long words.',
  },
};

export const DEFAULT_MODE: ModeId = 'classic';

export const MODE_LIST: Mode[] = [MODES.blitz, MODES.classic, MODES.marathon];

/**
 * Resolve a mode id that arrived over the wire or out of storage.
 *
 * Never trust it: an older peer, a corrupted store or a hand-edited message
 * would otherwise hand `undefined` to generateBoard and produce a board of size
 * NaN. Falling back keeps a mismatched peer playing Classic rather than crashing.
 *
 * hasOwn, NOT a plain `MODES[id] || …`: MODES is an object literal, so it
 * inherits from Object.prototype and `MODES['constructor']` is the Object
 * function — truthy, so it sails through the guard and gets returned AS a Mode
 * with every field undefined. That is the exact NaN board this function exists
 * to prevent, reached by the one input it exists to distrust. Same for
 * 'toString', 'valueOf' and friends. Pinned by tests/modes.test.ts.
 */
export function modeOf(id: unknown): Mode {
  if (typeof id === 'string' && Object.hasOwn(MODES, id)) return MODES[id as ModeId];
  return MODES[DEFAULT_MODE];
}
