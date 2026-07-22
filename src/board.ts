// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * board.ts — pure board logic. Deterministic generation from a seed (so every
 * P2P peer builds the identical grid), 8-way adjacency, path validation, word
 * formation, "can this word be traced on the board" search, and scoring.
 *
 * A tile has a display `letter` ("A", or "Qu") and the lowercase `value` it
 * contributes to a spelled word ("a", or "qu"). Words are the concatenation of
 * tile values along a path of touching, non-repeating tiles.
 */

import { makeRng, randInt, type Rng } from '@ben-gy/game-engine/rng';

export interface Tile {
  /** What the player sees on the tile: "A", "Qu", etc. */
  letter: string;
  /** What it contributes to a spelled word, lowercase: "a", "qu". */
  value: string;
}

export interface Board {
  size: number;
  tiles: Tile[];
  /** neighbors[i] = indices of the 8-adjacent tiles to tile i. */
  neighbors: number[][];
}

export const BOARD_SIZE = 4;
export const MIN_WORD_LEN = 3;

const VOWELS = 'aeiou';

/**
 * Weighted letter bag, tuned from English frequencies with vowels nudged up so
 * boards stay playable. Each letter repeated ~ proportional to its weight.
 */
const WEIGHTS: Record<string, number> = {
  a: 9, b: 2, c: 4, d: 4, e: 12, f: 2, g: 3, h: 4, i: 9, j: 1,
  k: 1, l: 5, m: 3, n: 6, o: 8, p: 3, q: 1, r: 6, s: 6, t: 7,
  u: 4, v: 1, w: 2, x: 1, y: 2, z: 1,
};

function buildPool(): string[] {
  const pool: string[] = [];
  for (const [ch, w] of Object.entries(WEIGHTS)) {
    for (let i = 0; i < w; i++) pool.push(ch);
  }
  return pool;
}

const POOL = buildPool();

function tileFor(ch: string): Tile {
  if (ch === 'q') return { letter: 'Qu', value: 'qu' };
  return { letter: ch.toUpperCase(), value: ch };
}

function isVowelTile(t: Tile): boolean {
  return VOWELS.includes(t.value[0]);
}

function computeNeighbors(size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < size * size; i++) {
    const r = Math.floor(i / size);
    const c = i % size;
    const list: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) list.push(nr * size + nc);
      }
    }
    out.push(list);
  }
  return out;
}

/** Ensure at least `min` vowels by swapping in seeded vowels for consonants. */
function ensureVowels(tiles: Tile[], rng: Rng, min: number): void {
  let vowelCount = tiles.filter(isVowelTile).length;
  let guard = 0;
  while (vowelCount < min && guard++ < 100) {
    // find a consonant tile to replace
    const consonantIdxs = tiles
      .map((t, i) => (isVowelTile(t) ? -1 : i))
      .filter((i) => i >= 0);
    if (consonantIdxs.length === 0) break;
    const target = consonantIdxs[randInt(rng, 0, consonantIdxs.length - 1)];
    const v = VOWELS[randInt(rng, 0, VOWELS.length - 1)];
    tiles[target] = tileFor(v);
    vowelCount++;
  }
}

/** Build a deterministic board from a numeric seed. */
export function generateBoard(seed: number, size = BOARD_SIZE): Board {
  const rng = makeRng(seed);
  const tiles: Tile[] = [];
  for (let i = 0; i < size * size; i++) {
    const ch = POOL[randInt(rng, 0, POOL.length - 1)];
    tiles.push(tileFor(ch));
  }
  ensureVowels(tiles, rng, Math.max(4, Math.round(size * size * 0.28)));
  return { size, tiles, neighbors: computeNeighbors(size) };
}

/** Two tile indices touch if they are 8-adjacent (precomputed). */
export function isAdjacent(board: Board, a: number, b: number): boolean {
  return board.neighbors[a]?.includes(b) ?? false;
}

/** A path is legal if all indices are distinct and each step is adjacent. */
export function isValidPath(board: Board, path: number[]): boolean {
  if (path.length < 1) return false;
  const seen = new Set<number>();
  for (let i = 0; i < path.length; i++) {
    const idx = path[i];
    if (idx < 0 || idx >= board.tiles.length) return false;
    if (seen.has(idx)) return false;
    seen.add(idx);
    if (i > 0 && !isAdjacent(board, path[i - 1], idx)) return false;
  }
  return true;
}

/** The lowercase word spelled by a path (concatenated tile values). */
export function pathToWord(board: Board, path: number[]): string {
  return path.map((i) => board.tiles[i].value).join('');
}

/**
 * Can `word` be traced somewhere on the board via a legal path? Depth-first,
 * consuming 1–2 chars per tile (Qu). Board is small so this is cheap.
 */
export function canForm(board: Board, word: string): boolean {
  const w = word.toLowerCase();
  const visited = new Array<boolean>(board.tiles.length).fill(false);

  const dfs = (idx: number, pos: number): boolean => {
    const val = board.tiles[idx].value;
    if (w.substr(pos, val.length) !== val) return false;
    const next = pos + val.length;
    if (next === w.length) return true;
    visited[idx] = true;
    for (const nb of board.neighbors[idx]) {
      if (!visited[nb] && dfs(nb, next)) {
        visited[idx] = false;
        return true;
      }
    }
    visited[idx] = false;
    return false;
  };

  for (let i = 0; i < board.tiles.length; i++) {
    if (w.startsWith(board.tiles[i].value) && dfs(i, 0)) return true;
  }
  return false;
}

/**
 * Where `word` traces on the board, or null. Same walk as `canForm`, but it
 * hands back the tile path so the results screen can draw it over the grid.
 */
export function findPath(board: Board, word: string): number[] | null {
  const w = word.toLowerCase();
  const visited = new Array<boolean>(board.tiles.length).fill(false);
  const path: number[] = [];

  const dfs = (idx: number, pos: number): boolean => {
    const val = board.tiles[idx].value;
    if (w.substr(pos, val.length) !== val) return false;
    const next = pos + val.length;
    path.push(idx);
    if (next === w.length) return true;
    visited[idx] = true;
    for (const nb of board.neighbors[idx]) {
      if (!visited[nb] && dfs(nb, next)) {
        visited[idx] = false;
        return true;
      }
    }
    visited[idx] = false;
    path.pop();
    return false;
  };

  for (let i = 0; i < board.tiles.length; i++) {
    if (w.startsWith(board.tiles[i].value) && dfs(i, 0)) return path;
    path.length = 0;
  }
  return null;
}

/**
 * Every word findable on this board, mapped to one path that spells it.
 *
 * Enumerates paths and tests them against the dictionary — the inverse of
 * `canForm`, which tests one known word. `isPrefix` is what keeps it cheap: a
 * walk stops as soon as its letters start no word at all, which prunes the vast
 * majority of the 16-tile path space at depth 2–3. Both dictionary functions are
 * injected so tests can pass a small word list (and so this file stays pure).
 *
 * Measures ~0.2ms on a typical 4x4 board, so it runs inline at round end — no
 * worker, no jank. Expect ~50 words on a normal board.
 */
export function solveBoard(
  board: Board,
  isWord: (w: string) => boolean,
  isPrefix: (s: string) => boolean,
): Map<string, number[]> {
  const found = new Map<string, number[]>();
  const visited = new Array<boolean>(board.tiles.length).fill(false);
  const path: number[] = [];

  const dfs = (idx: number, pre: string): void => {
    const s = pre + board.tiles[idx].value; // 'qu' tiles come through whole
    if (!isPrefix(s)) return; // the prune that makes this fast
    visited[idx] = true;
    path.push(idx);
    if (s.length >= MIN_WORD_LEN && !found.has(s) && isWord(s)) found.set(s, path.slice());
    for (const nb of board.neighbors[idx]) {
      if (!visited[nb]) dfs(nb, s);
    }
    path.pop();
    visited[idx] = false;
  };

  for (let i = 0; i < board.tiles.length; i++) dfs(i, '');
  return found;
}

/** Points for a word of `len` letters. Longer words scale up sharply. */
export function scoreWord(len: number): number {
  if (len < MIN_WORD_LEN) return 0;
  if (len === 3) return 1;
  if (len === 4) return 2;
  if (len === 5) return 4;
  if (len === 6) return 6;
  if (len === 7) return 9;
  if (len === 8) return 12;
  return 16; // 9+
}
