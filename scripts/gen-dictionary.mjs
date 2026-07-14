/**
 * gen-dictionary.mjs — one-time offline generator for the bundled word list.
 *
 * Goal: a dictionary a normal player recognises. A full Scrabble/SCOWL dump
 * (~170k words) accepts obscure junk like "nom", "mon", "gos", "kis", "tis",
 * "til", "sog", "lig", "moa" — which rewards smashing consonants around vowels
 * instead of finding real words. So we use SCOWL's own frequency BANDS (via
 * `wordlist-english`: band 10 = most common … 70 = obscure) and cap the band by
 * word LENGTH — strictest on short words, where the junk concentrates:
 *
 *   length 3      -> band <= 35   (very common only)
 *   length 4      -> band <= 40
 *   length 5..9   -> band <= 50   (obscure long words are rarely findable anyway)
 *
 * The band cap is scaled by length because the "smash consonants around a vowel"
 * problem is almost entirely a SHORT-word phenomenon: there are few 3-letter
 * combos and a huge fraction are some obscure valid word, so you can smash into
 * one without knowing it. Long words can't be smashed — if you trace a real
 * uncommon 7-letter word you knew it, so we judge those far more leniently to
 * reward real vocabulary:
 *
 *   length 3  -> band <= 35   (very common only — kills the smash-fest)
 *   length 4  -> band <= 50
 *   length 5+ -> band <= 60   (generous: real words like "trove", "abseil",
 *                              "amphora", "quixotic" count; stops before band 70's
 *                              obscure flood — "abfarad", "abomasum", "abelmosk")
 *
 * This keeps plurals/inflections ("bars", "cats", "played") and common words
 * while dropping short-word junk, yet rewards an experienced player's real
 * vocabulary on longer words. Output is src/dictionary.txt (newline-joined,
 * lowercase, a–z, 3–9 letters), committed so CI never needs this dependency.
 *
 *   npm i -D wordlist-english   # if not already installed
 *   node scripts/gen-dictionary.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'dictionary.txt');

const idx = require('wordlist-english');
const BANDS = ['10', '20', '35', '40', '50', '55', '60', '70'];

// Cumulative set at each band (band N includes all words from bands <= N).
const cumulative = {};
const acc = new Set();
for (const band of BANDS) {
  for (const w of idx['english/' + band]) acc.add(w.toLowerCase());
  cumulative[band] = new Set(acc);
}

function bandCapForLength(len) {
  if (len <= 3) return '35'; // strict: kills short-word smashing
  if (len === 4) return '50';
  return '60'; // generous on 5+ to reward real vocabulary (long words can't be smashed)
}

const seen = new Set();
for (const w of cumulative['70']) {
  if (!/^[a-z]+$/.test(w)) continue;
  if (w.length < 3 || w.length > 9) continue;
  if (cumulative[bandCapForLength(w.length)].has(w)) seen.add(w);
}

const words = [...seen].sort();
mkdirSync(join(__dirname, '..', 'src'), { recursive: true });
writeFileSync(OUT, words.join('\n') + '\n', 'utf8');
const bytes = Buffer.byteLength(words.join('\n'));
console.log(`wrote ${words.length} words, ${(bytes / 1024).toFixed(0)} KB -> ${OUT}`);
