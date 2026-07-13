/**
 * gen-dictionary.mjs — one-time offline generator for the bundled word list.
 *
 * Source: `an-array-of-english-words` (a SCOWL-derived list that, crucially for a
 * word game, INCLUDES plurals and inflected forms — the system /usr/share/dict
 * list does not, so "bars"/"cats"/"played" would be wrongly rejected). Output is
 * src/dictionary.txt (newline-joined, lowercase, a–z only, 3–9 letters),
 * committed to the repo so CI never needs this dependency.
 *
 *   npm i -D an-array-of-english-words   # if not already installed
 *   node scripts/gen-dictionary.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'dictionary.txt');

const MIN = 3;
const MAX = 9;

const source = require('an-array-of-english-words');

const seen = new Set();
for (const raw of source) {
  const w = raw.toLowerCase();
  if (!/^[a-z]+$/.test(w)) continue;
  if (w.length < MIN || w.length > MAX) continue;
  seen.add(w);
}

const words = [...seen].sort();
mkdirSync(join(__dirname, '..', 'src'), { recursive: true });
writeFileSync(OUT, words.join('\n') + '\n', 'utf8');
const bytes = Buffer.byteLength(words.join('\n'));
console.log(`wrote ${words.length} words, ${(bytes / 1024).toFixed(0)} KB -> ${OUT}`);
