# Game Plan: Cipher Clash

## Overview
- **Name:** Cipher Clash
- **Repo name:** cipher-clash
- **Tagline:** Trace words on a shared letter grid and race to claim them before your rival does.
- **Genre (directory category):** word

## Core Loop
A 4×4 grid of letters appears. Drag (or tap) through touching tiles — any of the 8
directions — to spell a word of 3+ letters; each tile can be used once per word.
Release to submit. Valid, unclaimed words pop, score by length, and spray
particles. You have 90 seconds to bank as many points as you can. The tension:
longer words are worth exponentially more but harder to spot, and in versus mode a
word is only worth points to **whoever claims it first** — hesitate and your rival
steals it out from under you. Round ends at 0:00; highest score wins.

## Controls
- **Desktop:** Click-drag across tiles to build a word, release to submit. Or click
  tiles one by one and press Enter/Space to submit, Backspace/Esc to clear.
- **Mobile:** Touch-drag across tiles (the whole board is the control surface — no
  virtual D-pad needed). Tap-to-chain also works. Big 44px+ tiles.

## Multiplayer
- **Mode:** live P2P **and** async (the board is seeded, so a shared room link =
  the same board; friends can also just compare scores on the same seed).
- **If live P2P:** players 2–6; topology **host-authoritative star**. The lobby
  broadcasts one shared seed → every peer builds the identical board via `rng.ts`.
  Each peer validates words locally, then sends a claim to the host on `clm`
  `{word}`. The host owns the authoritative `claimedBy` map + scores + countdown
  and broadcasts a compact snapshot on `snap` `{t, claims:[[word,pid]], scores}`.
  First claim the host receives wins the word; later claimants are told it's taken
  (a "stolen"/"taken" flash). Late joiner: host sends full snapshot on join. Host
  leaves → `net.ts` re-elects; the new host continues from its last snapshot
  (every peer tracks the claimed map, so no state is lost). Channels: `clm`, `snap`
  (both ≤12 bytes). Fully playable solo if nobody joins.

## Juice Plan
- **Sound (`sound.ts`):** `select` blip as each tile joins the chain (pitch rises
  with chain length), `coin`/`powerup` on a valid word (bigger word → `powerup`),
  `hit` on an invalid/duplicate word, `win`/`lose` at round end, `blip` on menu.
- **Particles:** a burst of glyph particles from a scored word, colour-keyed to the
  player. Canvas overlay, disabled under `prefers-reduced-motion`.
- **Screen shake:** tiny shake on a big word (6+), a red shake on invalid.
- **Tweens:** tiles scale-pop when chained; the current chain draws a glowing SVG
  polyline that eases; score counter tweens up; found-word list slides in.
- **Palette:** dark slate board, cyan (you) vs amber (rival) — colour-blind-safe
  (cyan/amber is a standard CVD-safe pair, distinguished by hue *and* position).

## Style Direction
**Vibe:** neon-minimal (clean dark arcade).
**Palette:** slate `#0f172a` bg, tile `#1e293b`, ink `#e2e8f0`, cyan `#22d3ee`
(self/primary), amber `#fbbf24` (rival), green `#34d399` (valid), rose `#fb7185`
(invalid). Cyan vs amber chosen for deuteranopia/protanopia safety.
**Theme:** dark.
**Reference feel:** the tactile letter-tracing of classic word-grid games + the
snappy, particle-heavy feedback of a good itch.io minigame.

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite.
- **Render:** DOM/CSS grid for the board (crisp letters, easy hit targets,
  accessible) + one small Canvas overlay for particles + an SVG layer for the
  chain trail.
- **Engine modules copied from patterns/:** rng, sound, storage, net, lobby
  (loop not needed — the board is event-driven; a `requestAnimationFrame` ticker
  drives only particles + the countdown display).
- **Persistence:** localStorage — mute pref, "seen how-to", solo best score, last
  player name (via `storage.ts`).

## Non-Goals
- No server-validated dictionary or anti-cheat (peers trust each other; casual).
- No account, no global leaderboard (only local best + in-room scores).
- No spectator replay, no chat.

## How To Play (player-facing copy)
Drag across touching letters to spell a word (3+ letters). Longer words score
much more. You have 90 seconds — find as many as you can. Playing with friends?
Everyone shares the same board and a word only counts for whoever grabs it first.
