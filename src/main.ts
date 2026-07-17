/**
 * main.ts — app bootstrap and screen router. Owns the persistent shell (footer),
 * the menu, the how-to / about modals, solo start, the P2P lobby, and results.
 * The actual gameplay lives in Session; this file just wires screens together.
 */

import './styles/mobile.css';
import './styles/main.css';
import { hardenViewport } from './engine/mobile';
import { createSfx } from './engine/sound';
import { createStore } from './engine/storage';
import { createNet, type Net } from './engine/net';
import { createRounds, type Rounds } from './engine/rematch';
import {
  clearRoomInUrl,
  createLobby,
  createRoomEntry,
  normalizeRoomCode,
  setRoomInUrl,
} from './engine/lobby';
import { Session, PLAYER_COLORS } from './session';
import type { PlayerInfo, MatchState } from './match';
import { leader } from './match';
import { findPath, generateBoard, scoreWord, solveBoard, type Board } from './board';
import { dictionarySize, isPrefix, isWord } from './dictionary';

const APP_ID = 'cipher-clash';
const DURATION_MS = 90_000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

// Before anything renders: iOS ignores the viewport meta's user-scalable=no, so
// a double-tap or pinch will zoom a live game and there is no way back out.
hardenViewport();

const root = document.getElementById('app')!;
const store = createStore(APP_ID);
const sfx = createSfx(store.get<boolean>('muted', false));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let net: Net | null = null;
let rounds: Rounds | null = null;
let lobby: { destroy: () => void } | null = null;
let roomEntry: { destroy: () => void } | null = null;
let session: Session | null = null;
/** Rounds won per player id, kept across rematches for as long as the room lives. */
let tally = new Map<string, number>();

// A ?room= in the URL (an invite link) is honoured once; after that "Play with
// friends" shows the create/join screen so the link is never the only way in.
let pendingRoom: string | null = (() => {
  const c = normalizeRoomCode(new URL(location.href).searchParams.get('room') ?? '');
  return c.length >= 3 ? c : null;
})();

function defaultName(): string {
  const stored = store.get<string>('name', '');
  if (stored) return stored;
  const n = 'Player' + Math.floor(100 + Math.random() * 900);
  return n;
}
let playerName = defaultName();

function saveName(n: string): void {
  playerName = n.trim().slice(0, 16) || 'Player';
  store.set('name', playerName);
}

// ---- shell ------------------------------------------------------------------

function shell(inner: string): string {
  return `
    <div class="main-content">${inner}</div>
    <footer class="site-footer">
      Built by <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a>
      · <a href="https://hub.benrichardson.dev" target="_blank" rel="noopener">more games, tools &amp; sites</a>
    </footer>`;
}

function screen(): HTMLElement {
  return root.querySelector<HTMLElement>('.main-content')!;
}

function toast(msg: string): void {
  let el = document.querySelector<HTMLElement>('.global-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'global-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  window.setTimeout(() => el?.classList.remove('show'), 1600);
}

/** Resolves once any in-flight room teardown has fully finished. */
let roomTeardown: Promise<void> = Promise.resolve();

/**
 * Tear the room down for good. Only ever called on the way to the menu — NEVER
 * between rounds. `net.leave()` is awaited because Trystero keeps the room in
 * its cache until teardown finishes; joining again before then hands back the
 * dying room and every peer ends up alone and self-elected as host. Rematches
 * keep the Net alive and start a new round inside it (engine/rematch.ts).
 */
function leaveRoom(): Promise<void> {
  lobby?.destroy();
  lobby = null;
  roomEntry?.destroy();
  roomEntry = null;
  rounds?.destroy();
  rounds = null;
  session?.destroy();
  session = null;
  tally = new Map();
  // The room is over for us — take it out of the URL so a refresh, or reopening
  // from the home screen, lands on the menu instead of silently rejoining.
  clearRoomInUrl();
  const leaving = net;
  net = null;
  // CHAIN, never replace. leaveRoom() runs again on the way into a new room, and
  // by then `net` is already null — replacing the promise there would hand back
  // an instantly-resolved teardown while the real one was still inside
  // Trystero's 99ms window, and the next createNet would throw.
  roomTeardown = roomTeardown.then(() => leaving?.leave()).then(
    () => undefined,
    () => undefined,
  );
  return roomTeardown;
}

// ---- menu -------------------------------------------------------------------

function showMenu(): void {
  void leaveRoom();
  const best = store.get<number>('best', 0);
  root.innerHTML = shell(`
    <main class="menu">
      <div class="brand">
        <div class="logo" aria-hidden="true">
          <span class="lg lg1">C</span><span class="lg lg2">C</span>
        </div>
        <h1 class="title">Cipher&nbsp;Clash</h1>
        <p class="tagline">Trace words on a shared letter grid. Longer words score big — and in versus, a word only counts for whoever grabs it first.</p>
      </div>
      <label class="name-field">
        <span>Your name</span>
        <input class="name-input" type="text" maxlength="16" value="${escapeAttr(playerName)}" autocomplete="off" spellcheck="false" />
      </label>
      <div class="menu-actions">
        <button class="btn primary big play-solo" type="button">Play solo</button>
        <button class="btn big play-mp" type="button">Play with friends</button>
      </div>
      <div class="menu-links">
        <button class="btn ghost how-btn" type="button">How to play</button>
        <button class="btn ghost about-btn" type="button">About</button>
        <button class="btn ghost mute-btn" type="button" aria-pressed="${sfx.muted()}">${sfx.muted() ? 'Sound: off' : 'Sound: on'}</button>
      </div>
      ${best > 0 ? `<p class="best">Your best solo score: <strong>${best}</strong></p>` : ''}
    </main>`);

  const nameInput = screen().querySelector<HTMLInputElement>('.name-input')!;
  nameInput.addEventListener('change', () => saveName(nameInput.value));
  nameInput.addEventListener('blur', () => saveName(nameInput.value));

  screen().querySelector('.play-solo')!.addEventListener('click', () => {
    sfx.unlock();
    sfx.play('blip');
    saveName(nameInput.value);
    startSolo();
  });
  screen().querySelector('.play-mp')!.addEventListener('click', () => {
    sfx.unlock();
    sfx.play('blip');
    saveName(nameInput.value);
    enterRoom();
  });
  screen().querySelector('.how-btn')!.addEventListener('click', () => showModal('howto'));
  screen().querySelector('.about-btn')!.addEventListener('click', () => showModal('about'));
  screen().querySelector('.mute-btn')!.addEventListener('click', () => {
    sfx.unlock();
    sfx.setMuted(!sfx.muted());
    store.set('muted', sfx.muted());
    if (!sfx.muted()) sfx.play('blip');
    showMenu();
  });

  if (!store.get<boolean>('seenHowto', false)) {
    showModal('howto');
    store.set('seenHowto', true);
  }
}

// ---- modals -----------------------------------------------------------------

function showModal(kind: 'howto' | 'about'): void {
  const existing = document.querySelector('.modal-back');
  existing?.remove();
  const body =
    kind === 'howto'
      ? `<h2>How to play</h2>
         <ol class="how-list">
           <li><strong>Drag across touching letters</strong> (any direction, including diagonals) to spell a word of 3+ letters, then release to submit.</li>
           <li>On a keyboard or by tapping, add letters one at a time and press <kbd>Enter</kbd> or <strong>Submit</strong>. <kbd>Backspace</kbd> undoes, <kbd>Esc</kbd> clears.</li>
           <li><strong>Longer words score much more</strong> — a 7-letter word is worth 9× a short one. You have 90 seconds.</li>
           <li><strong>Versus:</strong> everyone shares the same board and a word only scores for whoever claims it <em>first</em>. Grab the big ones before your rival does.</li>
         </ol>
         <p class="how-note"><strong>About the word list:</strong> Cipher Clash uses a curated list of everyday words, not a full tournament/Scrabble dictionary. Obscure short words like <em>nom</em> or <em>moa</em> — the kind you only land on by smashing letters — don't count, so the game rewards words you actually know. Longer words are judged more generously, so real vocabulary pays off. A few rare-but-real words may not be accepted; that's the trade-off for a game that feels fair rather than a memorisation race.</p>`
      : `<h2>About Cipher Clash</h2>
         <p>A fast word-grid race you can play solo or peer-to-peer with friends — no login, no install.</p>
         <p>Multiplayer is <strong>peer-to-peer over WebRTC</strong>: there is no game server. Setting up a room uses a free public signaling relay only to introduce players to each other; after that, moves flow directly between browsers and nothing is stored on any server.</p>
         <p><strong>The word list</strong> holds ${dictionarySize().toLocaleString()} curated everyday words (with plurals and inflections), not a full tournament/Scrabble dictionary. That's deliberate: accepting obscure Scrabble-only words like <em>nom</em>, <em>mon</em> or <em>moa</em> turns the game into smashing consonants around vowels instead of finding words you know. Short words are held to a strict common-word bar; longer words — which you can't smash into by accident — are judged far more leniently, so an experienced player's real vocabulary is rewarded. The list ships inside the page, so the game works fully offline.</p>
         <p>No cookies or fingerprinting; anonymous, cookie-less page-view counts come from Cloudflare Web Analytics.</p>
         <p>Built by <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a> · <a href="https://hub.benrichardson.dev" target="_blank" rel="noopener">more games, tools &amp; sites</a>.</p>`;

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <button class="modal-close" type="button" aria-label="Close">&times;</button>
      <div class="modal-body">${body}</div>
      <button class="btn primary modal-ok" type="button">Got it</button>
    </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('.modal-close')!.addEventListener('click', close);
  back.querySelector('.modal-ok')!.addEventListener('click', close);
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
}

// ---- solo -------------------------------------------------------------------

function startSolo(): void {
  const seed = (Math.floor(Math.random() * 0xffffffff) >>> 0);
  const players: PlayerInfo[] = [{ id: 'solo', name: playerName }];
  root.innerHTML = shell('<div class="screen-host"></div>');
  session = new Session({
    root: screen().querySelector<HTMLElement>('.screen-host')!,
    seed,
    players,
    selfIndex: 0,
    mode: 'solo',
    isHost: true,
    durationMs: DURATION_MS,
    sfx,
    reducedMotion,
    onQuit: showMenu,
    onResults: showResults,
  });
}

// ---- multiplayer ------------------------------------------------------------

function enterRoom(): void {
  void leaveRoom();

  // Deep-linked via an invite? Join it straight away, once. We are the guest
  // here, never the host — the person who sent the link already holds the room.
  if (pendingRoom) {
    const code = pendingRoom;
    pendingRoom = null;
    void openRoom(code, false);
    return;
  }

  // Otherwise: create a fresh room or type a friend's code.
  root.innerHTML = shell('<div class="entry-host"></div>');
  roomEntry = createRoomEntry({
    container: screen().querySelector<HTMLElement>('.entry-host')!,
    subtitle: 'Start a new room, or enter a friend’s code to join theirs.',
    onSubmit: (code, created) => void openRoom(code, created),
    onCancel: showMenu,
  });
}

/**
 * Join a room ONCE and hold it for as long as the player stays. Every round —
 * the first and every rematch — runs inside this one Net via `rounds`. Nothing
 * here may call net.leave() except the trip back to the menu.
 */
async function openRoom(code: string, created: boolean): Promise<void> {
  leaveRoom();
  // A previous room may still be tearing down (Trystero defers it ~99ms).
  // Joining inside that window returns the dying room, so wait it out.
  await roomTeardown;
  setRoomInUrl(code);

  try {
    net = createNet(
      // `created` is the difference between minting this code and walking into
      // someone else's room. Only the minter may host on arrival; a guest waits
      // to hear from the incumbent instead of racing it for the role.
      { appId: APP_ID, roomId: code, claimHost: created },
      {
        onHostChange: (_h, isSelf) => session?.setHost(isSelf),
        onPeerLeave: () => session?.onPeerLeave(),
      },
    );
  } catch (err) {
    // The room is somehow still held (see engine/net.ts). Never strand the
    // player on a blank screen — say so and go back somewhere they can act.
    console.error(err);
    toast('Could not open that room — try again');
    showMenu();
    return;
  }

  rounds = createRounds({
    net,
    playerName,
    minPlayers: MIN_PLAYERS,
    onRound: ({ seed, players, isHost }) => startMp(seed, players, isHost),
  });

  showLobby(code);
}

function showLobby(code: string): void {
  if (!net || !rounds) return;
  root.innerHTML = shell('<div class="lobby-host"></div>');
  const back = document.createElement('button');
  back.className = 'btn ghost lobby-back';
  back.type = 'button';
  back.textContent = '← Leave room';
  screen().prepend(back);
  back.addEventListener('click', showMenu);

  lobby = createLobby({
    container: screen().querySelector<HTMLElement>('.lobby-host')!,
    net,
    rounds,
    roomCode: code,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
  });
}

function startMp(seed: number, players: PlayerInfo[], isHost: boolean): void {
  if (!net) return;
  lobby?.destroy();
  lobby = null;
  session?.destroy();

  // The roster arrives frozen from the host, identical bytes on every peer, so
  // index N is the same player everywhere. Deriving it locally is how scores
  // used to land on the wrong name.
  const selfIndex = players.findIndex((p) => p.id === net!.selfId);
  if (selfIndex < 0) {
    // Not in this round's roster (we joined mid-start). Wait for the next one
    // rather than silently playing as player 0.
    showLobby(new URL(location.href).searchParams.get('room') ?? '');
    toast('Next round — you’re in the lobby');
    return;
  }

  root.innerHTML = shell('<div class="screen-host"></div>');
  session = new Session({
    root: screen().querySelector<HTMLElement>('.screen-host')!,
    seed,
    players,
    selfIndex,
    mode: 'mp',
    isHost,
    durationMs: DURATION_MS,
    sfx,
    reducedMotion,
    net,
    onQuit: showMenu,
    onResults: showResults,
  });
}

// ---- results ----------------------------------------------------------------

function showResults(info: {
  state: MatchState;
  players: PlayerInfo[];
  selfIndex: number;
  mode: 'solo' | 'mp';
  seed: number;
}): void {
  const { state, players, selfIndex, mode, seed } = info;
  const myScore = state.scores[selfIndex] ?? 0;
  const board = generateBoard(seed);

  // Everything findable on this board. ~0.2ms, so it runs inline — see board.ts.
  const solution = solveBoard(board, isWord, isPrefix);
  const claimed = new Set(state.order);
  const missed = [...solution.keys()]
    .filter((w) => !claimed.has(w))
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  const boardTotal = [...solution.keys()].reduce((n, w) => n + scoreWord(w.length), 0);

  rounds?.finish();

  let banner = '';
  if (mode === 'solo') {
    const best = store.get<number>('best', 0);
    if (myScore > best) {
      store.set('best', myScore);
      banner = `<p class="verdict win">New personal best!</p>`;
    } else {
      banner = `<p class="verdict">Best: ${best}</p>`;
    }
  } else {
    const win = leader(state);
    if (win === -1) banner = `<p class="verdict tie">It's a tie!</p>`;
    else if (win === selfIndex) banner = `<p class="verdict win">You win! 🏆</p>`;
    else banner = `<p class="verdict lose">${escapeHtml(players[win]?.name ?? 'Rival')} wins</p>`;
    const winner = players[win];
    if (winner) tally.set(winner.id, (tally.get(winner.id) ?? 0) + 1);
  }

  const wordsOf = (i: number): string[] =>
    state.order
      .filter((w) => state.claimedBy.get(w) === i)
      .sort((a, b) => b.length - a.length || a.localeCompare(b));

  const ranked = players
    .map((p, i) => ({ p, i, score: state.scores[i] ?? 0, words: wordsOf(i) }))
    .sort((a, b) => b.score - a.score);

  const colour = (i: number): string => PLAYER_COLORS[i % PLAYER_COLORS.length];
  const chip = (w: string, cls: string, style = ''): string =>
    `<button class="wchip ${cls}" type="button" data-word="${escapeAttr(w)}"${style}>${escapeHtml(
      w.toUpperCase(),
    )} <em>+${scoreWord(w.length)}</em></button>`;

  const multi = players.length > 1;
  const showTally = multi && [...tally.values()].some((n) => n > 0);
  const yourShare = boardTotal > 0 ? Math.round((myScore / boardTotal) * 100) : 0;

  root.innerHTML = shell(`
    <main class="results">
      <h1 class="results-title">Time!</h1>
      ${banner}
      ${
        showTally
          ? `<p class="tally">Rounds won · ${players
              .map((p, i) => `<span style="--c:${colour(i)}">${escapeHtml(p.name)} ${tally.get(p.id) ?? 0}</span>`)
              .join(' · ')}</p>`
          : ''
      }
      <ul class="result-scores">
        ${ranked
          .map(
            (r, rank) => `<li class="result-row${r.i === selfIndex ? ' is-self' : ''}" style="--c:${colour(r.i)}">
              <span class="result-rank">${rank + 1}</span>
              <span class="result-name">${escapeHtml(r.p.name)}${r.i === selfIndex ? ' (you)' : ''}</span>
              <span class="result-words">${r.words.length} word${r.words.length === 1 ? '' : 's'}</span>
              <span class="result-score">${r.score}</span>
            </li>`,
          )
          .join('')}
      </ul>

      <div class="results-board">
        <div class="rboard" role="img" aria-label="The board from this round">
          ${board.tiles
            .map((t) => `<span class="rtile">${escapeHtml(t.letter)}</span>`)
            .join('')}
          <svg class="rpath" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
        </div>
        <p class="rhint">Tap any word to see where it was on the grid.</p>
      </div>

      <div class="word-lists">
        ${ranked
          .map(
            (r) => `<section class="wgroup" style="--c:${colour(r.i)}">
              <h3>${escapeHtml(r.p.name)}${r.i === selfIndex ? ' (you)' : ''} <span class="wcount">${r.words.length} · ${r.score} pts</span></h3>
              <div class="word-chips">
                ${
                  r.words.length
                    ? r.words.map((w) => chip(w, 'owned')).join('')
                    : '<span class="none">Nothing this round</span>'
                }
              </div>
            </section>`,
          )
          .join('')}
      </div>

      <details class="missed" ${missed.length ? '' : 'hidden'}>
        <summary>
          <span>Words you all missed</span>
          <span class="mcount">${missed.length}</span>
        </summary>
        <p class="mnote">${
          multi
            ? `Between you, you found ${claimed.size} of ${solution.size} — ${yourShare}% of the board's ${boardTotal} points went to you.`
            : `You found ${claimed.size} of ${solution.size} words on this board (${yourShare}% of ${boardTotal} points).`
        }</p>
        <div class="word-chips">
          ${missed.slice(0, 60).map((w) => chip(w, 'miss')).join('')}
        </div>
        ${missed.length > 60 ? `<p class="mnote">…and ${missed.length - 60} more.</p>` : ''}
      </details>

      <div class="results-actions">
        <button class="btn primary big again-btn" type="button">Play again</button>
        ${mode === 'mp' ? '<button class="btn big start-now-btn" type="button" hidden>Start now</button>' : ''}
        ${mode === 'mp' ? '<button class="btn big lobby-btn" type="button">Back to lobby</button>' : ''}
        <button class="btn big share-btn" type="button">Share</button>
        <button class="btn ghost menu-btn" type="button">Menu</button>
      </div>
      <p class="again-status" role="status" aria-live="polite"></p>
    </main>`);

  sfx.play(mode === 'solo' || leader(state) === selfIndex ? 'win' : 'lose');

  wireWordPaths(board, state, selfIndex);

  const againBtn = screen().querySelector<HTMLButtonElement>('.again-btn')!;
  const status = screen().querySelector<HTMLElement>('.again-status')!;

  againBtn.addEventListener('click', () => {
    if (mode === 'solo') {
      startSolo();
      return;
    }
    // NOT a rejoin. The room and the whole peer mesh stay exactly as they are;
    // this only registers a vote, and the next round starts underneath us when
    // everyone has voted. Leaving and rejoining here is what used to strand both
    // players alone as host — see engine/net.ts.
    if (!rounds) return;
    const s = rounds.state();
    if (s.voted) {
      rounds.unvote();
    } else {
      rounds.vote();
    }
    paintAgain();
  });

  function paintAgain(): void {
    if (mode === 'solo' || !rounds) return;
    const s = rounds.state();
    againBtn.textContent = s.voted ? 'Ready — waiting…' : 'Play again';
    againBtn.classList.toggle('waiting', s.voted);

    // The host never has to sit and hope: once enough people are in, it can
    // start immediately rather than wait out the countdown.
    const startNow = screen().querySelector<HTMLButtonElement>('.start-now-btn');
    if (startNow) startNow.hidden = !s.canStart || s.votes.length === s.present.length;

    const waiting = s.present.length - s.votes.length;
    const secs = s.startsInMs !== null ? Math.ceil(s.startsInMs / 1000) : null;
    if (!s.voted) {
      status.textContent = `${s.votes.length}/${s.present.length} ready for another round`;
    } else if (secs !== null) {
      // Say WHY we are still waiting and when it ends. A bare "waiting…" with no
      // horizon is what made this feel like a hang.
      status.textContent = `Starting in ${secs}s — waiting for ${waiting} more player${
        waiting === 1 ? '' : 's'
      }`;
    } else if (waiting > 0) {
      status.textContent = `Waiting for ${waiting} more player${waiting === 1 ? '' : 's'}…`;
    } else {
      status.textContent = 'Starting…';
    }
  }

  if (mode === 'mp') {
    paintAgain();
    const tick = setInterval(() => {
      if (!document.body.contains(againBtn)) {
        clearInterval(tick);
        return;
      }
      paintAgain();
    }, 500);
  }

  screen().querySelector('.start-now-btn')?.addEventListener('click', () => rounds?.go());
  screen().querySelector('.lobby-btn')?.addEventListener('click', () => {
    // Back to the lobby WITHOUT leaving the room — the mesh, the roster and the
    // running tally all survive. From there you can wait, re-ready, or watch who
    // is still around, instead of the summary being a dead end with only Menu.
    rounds?.unvote();
    showLobby(new URL(location.href).searchParams.get('room') ?? '');
  });
  screen().querySelector('.share-btn')!.addEventListener('click', () => void shareResult(myScore, mode));
  screen().querySelector('.menu-btn')!.addEventListener('click', showMenu);
}

/** Tap a word chip to trace it on the re-rendered board. */
function wireWordPaths(board: Board, state: MatchState, selfIndex: number): void {
  const svg = screen().querySelector<SVGSVGElement>('.rpath');
  if (!svg) return;
  const size = board.size;
  const centre = (i: number): [number, number] => {
    const cell = 100 / size;
    return [(i % size) * cell + cell / 2, Math.floor(i / size) * cell + cell / 2];
  };

  let active: string | null = null;
  for (const btn of screen().querySelectorAll<HTMLButtonElement>('.wchip')) {
    btn.addEventListener('click', () => {
      const word = btn.dataset.word!;
      if (active === word) {
        svg.innerHTML = '';
        active = null;
        for (const b of screen().querySelectorAll('.wchip')) b.classList.remove('tracing');
        return;
      }
      active = word;
      for (const b of screen().querySelectorAll('.wchip')) b.classList.toggle('tracing', b === btn);
      const path = findPath(board, word);
      if (!path) return;
      const owner = state.claimedBy.get(word);
      const stroke =
        owner === undefined ? 'var(--muted)' : PLAYER_COLORS[owner % PLAYER_COLORS.length];
      const pts = path.map(centre).map(([x, y]) => `${x},${y}`).join(' ');
      svg.innerHTML =
        `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="2.2" ` +
        `stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />` +
        path
          .map((i) => {
            const [x, y] = centre(i);
            return `<circle cx="${x}" cy="${y}" r="3" fill="${stroke}" opacity="0.9" />`;
          })
          .join('');
      sfx.play('blip');
      void selfIndex;
    });
  }
}


async function shareResult(score: number, mode: 'solo' | 'mp'): Promise<void> {
  const url = location.origin + location.pathname;
  const text =
    mode === 'solo'
      ? `I scored ${score} in Cipher Clash — can you beat it?`
      : `Come play Cipher Clash with me!`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Cipher Clash', text, url });
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Copied to clipboard');
  } catch {
    toast(url);
  }
}

// ---- utils ------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

window.addEventListener('beforeunload', () => {
  try {
    net?.leave();
  } catch {
    /* ignore */
  }
});

showMenu();
