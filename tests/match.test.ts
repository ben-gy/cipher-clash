import { describe, expect, it } from 'vitest';
import { generateBoard, type Board } from '../src/board';
import {
  createMatch,
  resolveClaim,
  encodeSnapshot,
  applySnapshot,
  leader,
} from '../src/match';

function mkBoard(letters: string): Board {
  const chars = letters.toLowerCase().split('');
  const size = Math.round(Math.sqrt(chars.length));
  const base = generateBoard(1, size);
  const tiles = chars.map((c) =>
    c === 'q' ? { letter: 'Qu', value: 'qu' } : { letter: c.toUpperCase(), value: c },
  );
  return { size, tiles, neighbors: base.neighbors };
}

const board = mkBoard('catsroendlimubpq');
const DICT = new Set(['cat', 'cats', 'oats', 'rot', 'sat']);
const isWord = (w: string) => DICT.has(w);

describe('resolveClaim', () => {
  it('awards points to the first claimant and records the word', () => {
    const m = createMatch(2);
    const r = resolveClaim(m, board, isWord, 0, 'cat');
    expect(r.status).toBe('ok');
    expect(r.points).toBe(1);
    expect(m.scores[0]).toBe(1);
    expect(m.order).toEqual(['cat']);
  });

  it('gives a contested word only to whoever grabbed it first', () => {
    const m = createMatch(2);
    resolveClaim(m, board, isWord, 0, 'cat');
    const second = resolveClaim(m, board, isWord, 1, 'cat');
    expect(second.status).toBe('taken');
    expect(second.by).toBe(0);
    expect(m.scores[1]).toBe(0);
  });

  it('rejects non-dictionary words and unformable words', () => {
    const m = createMatch(2);
    expect(resolveClaim(m, board, isWord, 0, 'zzz').status).toBe('invalid'); // not in dict
    // "cats" is a real dict word here but reversed order still traceable; use a
    // dict word that cannot be traced on the board:
    const m2 = createMatch(1);
    const onlyDict = new Set(['xylophone']);
    expect(resolveClaim(m2, board, (w) => onlyDict.has(w), 0, 'xylophone').status).toBe('invalid');
  });

  it('rejects words below the minimum length', () => {
    const m = createMatch(1);
    expect(resolveClaim(m, board, isWord, 0, 'ca').status).toBe('short');
  });

  it('accumulates scores across multiple words', () => {
    const m = createMatch(1);
    resolveClaim(m, board, isWord, 0, 'cat'); // 1
    resolveClaim(m, board, isWord, 0, 'cats'); // 2
    expect(m.scores[0]).toBe(3);
    expect(m.order).toEqual(['cat', 'cats']);
  });
});

describe('snapshot serialization (netcode round-trip)', () => {
  it('encodes and re-applies to an identical state', () => {
    const host = createMatch(2);
    resolveClaim(host, board, isWord, 0, 'cat');
    resolveClaim(host, board, isWord, 1, 'cats');
    const snap = encodeSnapshot(host, 45000, false);

    const client = createMatch(2);
    applySnapshot(client, snap);

    expect(client.scores).toEqual(host.scores);
    expect([...client.claimedBy.entries()].sort()).toEqual([...host.claimedBy.entries()].sort());
    expect(client.order).toEqual(host.order);
    expect(snap.r).toBe(45000);
    expect(snap.d).toBe(false);
  });

  it('marks the round ended in the snapshot', () => {
    const m = createMatch(1);
    expect(encodeSnapshot(m, 0, true).d).toBe(true);
  });
});

describe('leader', () => {
  it('returns the top scorer', () => {
    const m = createMatch(2);
    m.scores = [3, 7];
    expect(leader(m)).toBe(1);
  });
  it('returns -1 on a tie', () => {
    const m = createMatch(2);
    m.scores = [5, 5];
    expect(leader(m)).toBe(-1);
  });
});
