import { describe, expect, it } from 'vitest';
import {
  generateBoard,
  isAdjacent,
  isValidPath,
  pathToWord,
  canForm,
  scoreWord,
  BOARD_SIZE,
  type Board,
} from '../src/board';

/** Build a test board from a letter string (neighbors depend only on size). */
function mkBoard(letters: string): Board {
  const chars = letters.toLowerCase().split('');
  const size = Math.round(Math.sqrt(chars.length));
  const base = generateBoard(1, size);
  const tiles = chars.map((c) =>
    c === 'q' ? { letter: 'Qu', value: 'qu' } : { letter: c.toUpperCase(), value: c },
  );
  return { size, tiles, neighbors: base.neighbors };
}

describe('generateBoard', () => {
  it('is deterministic for a seed (P2P: every peer gets the same board)', () => {
    const a = generateBoard(4242);
    const b = generateBoard(4242);
    expect(a.tiles.map((t) => t.value)).toEqual(b.tiles.map((t) => t.value));
  });

  it('produces 16 tiles for a 4x4 board and differs across seeds', () => {
    const a = generateBoard(1);
    const b = generateBoard(2);
    expect(a.tiles).toHaveLength(BOARD_SIZE * BOARD_SIZE);
    expect(a.tiles.map((t) => t.value).join('')).not.toEqual(b.tiles.map((t) => t.value).join(''));
  });

  it('guarantees a minimum number of vowels for playability', () => {
    const vowels = new Set(['a', 'e', 'i', 'o', 'u']);
    for (let seed = 0; seed < 40; seed++) {
      const board = generateBoard(seed);
      const count = board.tiles.filter((t) => vowels.has(t.value[0])).length;
      expect(count).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('adjacency + path validation', () => {
  const board = mkBoard('catsroendlimubpq'); // 4x4

  it('detects 8-way adjacency and rejects non-neighbors', () => {
    expect(isAdjacent(board, 0, 1)).toBe(true); // right
    expect(isAdjacent(board, 0, 4)).toBe(true); // down
    expect(isAdjacent(board, 0, 5)).toBe(true); // diagonal
    expect(isAdjacent(board, 0, 2)).toBe(false); // two apart
    expect(isAdjacent(board, 3, 4)).toBe(false); // wraps a row edge — not adjacent
  });

  it('accepts a legal path and rejects repeats / jumps', () => {
    expect(isValidPath(board, [0, 1, 2])).toBe(true);
    expect(isValidPath(board, [0, 1, 1])).toBe(false); // repeat
    expect(isValidPath(board, [0, 2])).toBe(false); // not adjacent
    expect(isValidPath(board, [])).toBe(false);
  });

  it('spells the word along a path, expanding Qu', () => {
    expect(pathToWord(board, [0, 1, 2])).toBe('cat');
    // q tile expands to "qu", so "quit" is spelled q(0)+i(1)+t(2).
    const q = mkBoard('qitaaaaaaaaaaaaa');
    expect(pathToWord(q, [0])).toBe('qu');
    expect(pathToWord(q, [0, 1, 2])).toBe('quit');
  });
});

describe('canForm', () => {
  const board = mkBoard('catsroendlimubpq');

  it('finds words that can be traced', () => {
    expect(canForm(board, 'cat')).toBe(true);
    expect(canForm(board, 'cats')).toBe(true);
  });

  it('rejects words that cannot be traced (adjacency broken)', () => {
    expect(canForm(board, 'cte')).toBe(false); // c and t are not adjacent
  });

  it('handles Qu tiles', () => {
    // q(0)+i(1)+t(2) spells "quit"; a bare "qu" is also formable from the q tile.
    const q = mkBoard('qitaeioulmnbprsx');
    expect(canForm(q, 'quit')).toBe(true);
    expect(canForm(q, 'qu')).toBe(true);
  });
});

describe('scoreWord', () => {
  it('rewards longer words sharply', () => {
    expect(scoreWord(2)).toBe(0);
    expect(scoreWord(3)).toBe(1);
    expect(scoreWord(4)).toBe(2);
    expect(scoreWord(5)).toBe(4);
    expect(scoreWord(6)).toBe(6);
    expect(scoreWord(7)).toBe(9);
    expect(scoreWord(8)).toBe(12);
    expect(scoreWord(9)).toBe(16);
    expect(scoreWord(12)).toBe(16);
  });
});
