/**
 * dictionary.ts — the bundled word list. `dictionary.txt` (a newline-joined,
 * lowercase, a–z word list, 3–9 letters, generated from the system word list by
 * scripts/gen-dictionary.mjs) is inlined into the JS bundle at build time via
 * Vite's `?raw` import — so there is NO runtime fetch and the game works fully
 * offline. The Set is built lazily on first lookup.
 */

import raw from './dictionary.txt?raw';

let WORDS: Set<string> | null = null;
let PREFIXES: Set<string> | null = null;

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

/**
 * Every prefix of every word, including each whole word. This is what makes the
 * board solver viable: it lets a depth-first walk abandon a path the moment its
 * letters stop being the start of anything (~19ms to build, ~106k entries, done
 * once and only if something actually solves a board).
 */
function prefixes(): Set<string> {
  if (!PREFIXES) {
    PREFIXES = new Set<string>();
    for (const w of words()) {
      for (let i = 1; i <= w.length; i++) PREFIXES.add(w.slice(0, i));
    }
  }
  return PREFIXES;
}

export function isWord(w: string): boolean {
  return words().has(w.toLowerCase());
}

/** True if `s` begins at least one dictionary word (or is one). */
export function isPrefix(s: string): boolean {
  return prefixes().has(s.toLowerCase());
}

export function dictionarySize(): number {
  return words().size;
}
