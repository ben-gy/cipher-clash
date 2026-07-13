import { describe, expect, it } from 'vitest';
import { isWord, dictionarySize } from '../src/dictionary';

describe('bundled dictionary', () => {
  it('accepts common words (case-insensitive)', () => {
    for (const w of ['cat', 'word', 'game', 'quiz', 'brain', 'jazz']) {
      expect(isWord(w)).toBe(true);
      expect(isWord(w.toUpperCase())).toBe(true);
    }
  });

  it('rejects non-words', () => {
    for (const w of ['zzzzz', 'qwxyz', 'asdfg']) {
      expect(isWord(w)).toBe(false);
    }
  });

  it('is a substantial list', () => {
    expect(dictionarySize()).toBeGreaterThan(50000);
  });
});
