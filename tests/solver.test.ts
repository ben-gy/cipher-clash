/**
 * solver.test.ts — the board solver behind "words you missed".
 *
 * Correctness is checked against a tiny injected word list; the last case runs
 * the real 50k dictionary to keep the "fast enough to run inline" claim honest.
 */

import { describe, expect, it } from 'vitest';
import { findPath, generateBoard, solveBoard, type Board } from '../src/board';
import { isPrefix, isWord } from '../src/dictionary';

/** A board from an explicit letter grid, mirroring tests/match.test.ts. */
function mkBoard(rows: string[]): Board {
  const size = rows.length;
  const tiles = rows
    .join('')
    .split('')
    .map((ch) => ({ value: ch.toLowerCase(), letter: ch.toUpperCase() }));
  const neighbors: number[][] = [];
  for (let i = 0; i < size * size; i++) {
    const r = Math.floor(i / size);
    const c = i % size;
    const nb: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) nb.push(nr * size + nc);
      }
    }
    neighbors.push(nb);
  }
  return { size, tiles, neighbors } as Board;
}

const tiny = (list: string[]) => {
  const set = new Set(list);
  const pre = new Set<string>();
  for (const w of set) for (let i = 1; i <= w.length; i++) pre.add(w.slice(0, i));
  return { isWord: (w: string) => set.has(w), isPrefix: (s: string) => pre.has(s) };
};

describe('solveBoard', () => {
  it('finds words that trace on the board and ignores ones that do not', () => {
    // Row 0 is C-A-T, so 'cat' walks 0→1→2.
    const board = mkBoard(['catx', 'xxxx', 'xxxx', 'xxxx']);
    const d = tiny(['cat', 'dog', 'act']);
    const found = solveBoard(board, d.isWord, d.isPrefix);

    expect([...found.keys()].sort()).toEqual(['cat']);
    // 'dog' is in the dictionary but has no letters here. 'act' would need C and
    // T adjacent — they sit two apart in the row, so it is correctly rejected.
    expect(found.has('dog')).toBe(false);
    expect(found.has('act')).toBe(false);
  });

  it('returns a legal path for every word it finds', () => {
    const board = mkBoard(['catx', 'xxxx', 'xxxx', 'xxxx']);
    const d = tiny(['cat']);
    const path = solveBoard(board, d.isWord, d.isPrefix).get('cat')!;

    expect(path).toEqual([0, 1, 2]);
    expect(new Set(path).size).toBe(path.length); // no tile reused
  });

  it('never reuses a tile within one word', () => {
    // Only one 'a', so 'aha' cannot be spelled even though the letters look present.
    const board = mkBoard(['ahxx', 'xxxx', 'xxxx', 'xxxx']);
    const d = tiny(['aha', 'ah']);
    expect(solveBoard(board, d.isWord, d.isPrefix).has('aha')).toBe(false);
  });

  it('respects the minimum word length', () => {
    const board = mkBoard(['atxx', 'xxxx', 'xxxx', 'xxxx']);
    const d = tiny(['at']);
    expect(solveBoard(board, d.isWord, d.isPrefix).size).toBe(0);
  });

  it('handles the Qu tile as a single unit', () => {
    const board = mkBoard(['xxxx', 'xxxx', 'xxxx', 'xxxx']);
    board.tiles[0] = { value: 'qu', letter: 'Qu' } as (typeof board.tiles)[0];
    board.tiles[1] = { value: 'i', letter: 'I' } as (typeof board.tiles)[0];
    board.tiles[2] = { value: 't', letter: 'T' } as (typeof board.tiles)[0];
    const d = tiny(['quit']);

    const found = solveBoard(board, d.isWord, d.isPrefix);
    // Four letters across only THREE tiles: the walk consumes tile values, not
    // characters, so Qu contributes both letters in one step.
    expect(found.get('quit')).toEqual([0, 1, 2]);
  });

  it('agrees with findPath on every word it reports', () => {
    const board = generateBoard(12345);
    const found = solveBoard(board, isWord, isPrefix);
    for (const w of found.keys()) {
      expect(findPath(board, w), `no path for ${w}`).not.toBeNull();
    }
  });

  it('solves a real board fast enough to run inline at round end', () => {
    // Warm the lazy dictionary + prefix set first — that cost is paid once.
    solveBoard(generateBoard(1), isWord, isPrefix);

    const t0 = performance.now();
    let total = 0;
    for (let seed = 0; seed < 50; seed++) {
      total += solveBoard(generateBoard(seed), isWord, isPrefix).size;
    }
    const perBoard = (performance.now() - t0) / 50;

    // Generous ceiling: it measures ~0.2ms. This guards the prefix prune — lose
    // it and the walk explodes, and the results screen stalls on a phone.
    expect(perBoard).toBeLessThan(20);
    expect(total / 50).toBeGreaterThan(5); // boards are not coming back empty
  });
});

describe('findPath', () => {
  it('returns null for a word that is not on the board', () => {
    expect(findPath(mkBoard(['catx', 'xxxx', 'xxxx', 'xxxx']), 'dog')).toBeNull();
  });

  it('traces diagonals', () => {
    const board = mkBoard(['cxxx', 'xaxx', 'xxtx', 'xxxx']);
    expect(findPath(board, 'cat')).toEqual([0, 5, 10]);
  });
});
