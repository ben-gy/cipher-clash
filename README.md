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

**Rematches happen inside the room.** The room is joined once and held for the
whole session; "Play again" is a vote, and the next round starts underneath you as
soon as everyone has accepted — same peers, same connection, fresh board, and a
running tally of rounds won. Leaving and rejoining the room to reset would look
equivalent and is in fact fatal: Trystero memoizes `joinRoom` while `leave()`
tears down asynchronously, so a rejoin returns the dying room and every peer ends
up alone and self-elected as host. `src/engine/net.ts` throws if you try it, and
`tests/net-lifecycle.test.ts` holds the line at one join per session.

## After the round

The summary shows **everyone's words**, grouped and colour-coded by player, not
just your own — plus every word **nobody** found, because the board is solved
exhaustively at round end (`solveBoard` in `src/board.ts`, a prefix-pruned DFS
that takes ~0.2ms, so it runs inline). Tap any word to trace it back onto the
grid.

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

## license

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see
[ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

In short: you may run, modify, redistribute and even sell this, but if you
distribute it — or run a modified version where other people can reach it — you
have to publish your source under the same licence and keep the attribution. A
separate commercial licence without those obligations is available on request:
<hi@ben.gy>.

Third-party components keep their own licences — see
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
