/**
 * dictionary.ts — the bundled word list. `dictionary.txt` (a newline-joined,
 * lowercase, a–z word list, 3–9 letters, generated from the system word list by
 * scripts/gen-dictionary.mjs) is inlined into the JS bundle at build time via
 * Vite's `?raw` import — so there is NO runtime fetch and the game works fully
 * offline. The Set is built lazily on first lookup.
 */

import raw from './dictionary.txt?raw';

let WORDS: Set<string> | null = null;

function words(): Set<string> {
  if (!WORDS) {
    WORDS = new Set(
      raw
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return WORDS;
}

export function isWord(w: string): boolean {
  return words().has(w.toLowerCase());
}

export function dictionarySize(): number {
  return words().size;
}
