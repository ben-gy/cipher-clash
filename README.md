# Cipher Clash

**Trace words on a shared letter grid and race to claim them before your rival does.**

🎮 Play: https://cipher-clash.benrichardson.dev

## What it is

Cipher Clash is a fast word-grid race. A 4×4 board of letters appears; you drag
across touching tiles — any of the eight directions — to spell words of three or
more letters. Longer words are worth exponentially more (a seven-letter word
scores 9× a three-letter one), so the tension is always "do I bank the short one
I see, or hunt for the big score?" You get 90 seconds a round, and your best solo
score is saved locally.

It's fun instantly, solo, with no login or install. But the twist is in the name:
in **versus** mode every player shares the *same* seeded board and a word only
scores for whoever claims it **first**. Spot a juicy seven-letter word and hesitate,
and you'll watch your rival snatch it — the feed shows every claim as it lands,
colour-coded by player. It's a friendly knife-fight over a pool of words.

Rendering is crisp DOM tiles with a glowing SVG chain trail, a canvas particle
layer for the juice, and procedural Web Audio sound — no image or audio assets.

## How to play

- **Desktop:** click-drag across touching letters to spell a word, release to
  submit. Or tap letters one at a time and press **Enter** / **Submit**;
  **Backspace** undoes, **Esc** clears.
- **Mobile:** touch-drag across the tiles (the whole board is the control surface —
  no fiddly D-pad). Tap-to-chain works too. Tiles are large, thumb-friendly targets.
- **Goal:** score as many points as you can in 90 seconds. Longer words score much
  more. In versus, grab a word before anyone else does.

## Multiplayer

**Live peer-to-peer** for 2–6 players, plus an implicit **async** mode (the board
is seeded from the room code, so a shared link is the same board — friends can
also just play the same seed and compare scores).

Create a room from "Play with friends", share the invite link, and the host starts
when everyone's ready. Everyone shares one board built from a single broadcast seed,
so no board data ever needs syncing. It's **host-authoritative**: the host resolves
claims (first claim wins the word) and broadcasts compact snapshots; clients
validate locally for instant feel and render the authoritative state. There is
**no game server** — WebRTC connects browsers directly; a free public signaling
relay is used only to introduce peers. If the host leaves, a new host is elected
automatically and continues from the last snapshot.

## Tech

- Vite 6 + vanilla TypeScript
- DOM/CSS board + SVG chain trail + Canvas particle overlay
- Shared engine: seedable deterministic RNG, unified pointer/touch input,
  procedural audio, Trystero P2P netcode, host-authoritative snapshots
- Bundled offline word list (~157k words incl. plurals & inflections), generated
  from a SCOWL-derived list by `scripts/gen-dictionary.mjs` and inlined at build
  time — the game works fully offline
- Vitest for game logic + P2P-sync determinism + snapshot round-trip
- GitHub Pages hosting

No cookies, no fingerprinting, no third-party fonts. Anonymous, cookie-less
page-view counts via Cloudflare Web Analytics; multiplayer adds only the public
P2P signaling relay, disclosed in the About panel.

## Local dev

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

To regenerate the bundled dictionary (rarely needed):

```bash
npm i -D an-array-of-english-words
npm run gen:dict
```

## License

MIT
