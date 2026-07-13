import { describe, expect, it } from 'vitest';
import { isWord, dictionarySize } from '../src/dictionary';

describe('bundled dictionary', () => {
  it('accepts common words (case-insensitive)', () => {
    for (const w of ['cat', 'word', 'game', 'quiz', 'brain', 'jazz']) {
      expect(isWord(w)).toBe(true);
      expect(isWord(w.toUpperCase())).toBe(true);
    }
  });

  it('accepts common plurals and inflections (not just base forms)', () => {
    for (const w of ['cats', 'dogs', 'houses', 'played', 'jumped', 'figs', 'piles']) {
      expect(isWord(w)).toBe(true);
    }
  });

  it('rejects non-words', () => {
    for (const w of ['zzzzz', 'qwxyz', 'asdfg']) {
      expect(isWord(w)).toBe(false);
    }
  });

  it('rejects obscure Scrabble-only junk that feels fake to players', () => {
    // Curated to common words (SCOWL frequency bands, strict on short words) so
    // players find real words, not consonant-around-vowel combos. Regression
    // guard for the reported "what is a nom or a mon" feedback.
    for (const w of ['nom', 'mon', 'gos', 'goy', 'kis', 'tis', 'til', 'sog', 'lig', 'moa', 'pom', 'nog', 'mog', 'mir', 'mirs']) {
      expect(isWord(w)).toBe(false);
    }
  });

  it('is a substantial curated list', () => {
    expect(dictionarySize()).toBeGreaterThan(30000);
    expect(dictionarySize()).toBeLessThan(80000);
  });
});
