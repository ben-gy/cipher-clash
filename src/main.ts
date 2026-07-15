/**
 * main.ts — app bootstrap and screen router. Owns the persistent shell (footer),
 * the menu, the how-to / about modals, solo start, the P2P lobby, and results.
 * The actual gameplay lives in Session; this file just wires screens together.
 */

import './styles/main.css';
import { createSfx } from './engine/sound';
import { createStore } from './engine/storage';
import { createNet, type Net } from './engine/net';
import {
  createLobby,
  createRoomEntry,
  getOrCreateRoomCode,
  normalizeRoomCode,
  setRoomInUrl,
} from './engine/lobby';
import { Session, PLAYER_COLORS } from './session';
import type { PlayerInfo, MatchState } from './match';
import { leader } from './match';
import { scoreWord } from './board';
import { dictionarySize } from './dictionary';

const APP_ID = 'cipher-clash';
const DURATION_MS = 90_000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

const root = document.getElementById('app')!;
const store = createStore(APP_ID);
const sfx = createSfx(store.get<boolean>('muted', false));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let net: Net | null = null;
let lobby: { destroy: () => void } | null = null;
let roomEntry: { destroy: () => void } | null = null;
let session: Session | null = null;

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

function leaveRoom(): void {
  lobby?.destroy();
  lobby = null;
  roomEntry?.destroy();
  roomEntry = null;
  try {
    net?.leave();
  } catch {
    /* ignore */
  }
  net = null;
}

// ---- menu -------------------------------------------------------------------

function showMenu(): void {
  leaveRoom();
  session = null;
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
  leaveRoom();
  session = null;

  // Deep-linked via an invite? Join it straight away, once.
  if (pendingRoom) {
    const code = pendingRoom;
    pendingRoom = null;
    openRoom(code);
    return;
  }

  // Otherwise: create a fresh room or type a friend's code.
  root.innerHTML = shell('<div class="entry-host"></div>');
  roomEntry = createRoomEntry({
    container: screen().querySelector<HTMLElement>('.entry-host')!,
    subtitle: 'Start a new room, or enter a friend’s code to join theirs.',
    onSubmit: (code) => openRoom(code),
    onCancel: showMenu,
  });
}

function openRoom(code: string): void {
  leaveRoom();
  session = null;
  setRoomInUrl(code);
  net = createNet(
    { appId: APP_ID, roomId: code },
    {
      onHostChange: (_h, isSelf) => session?.setHost(isSelf),
      onPeerLeave: () => session?.onPeerLeave(),
    },
  );
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
    roomCode: code,
    playerName,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    onStart: ({ seed, players }) => {
      startMp(seed, players.map((p) => ({ id: p.id, name: p.name })));
    },
  });
}

function startMp(seed: number, lobbyPlayers: PlayerInfo[]): void {
  if (!net) return;
  lobby?.destroy();
  lobby = null;
  // Canonical ordering identical on every peer (sort by id) → stable indices.
  const players = [...lobbyPlayers].sort((a, b) => a.id.localeCompare(b.id));
  const selfIndex = Math.max(0, players.findIndex((p) => p.id === net!.selfId));
  root.innerHTML = shell('<div class="screen-host"></div>');
  session = new Session({
    root: screen().querySelector<HTMLElement>('.screen-host')!,
    seed,
    players,
    selfIndex,
    mode: 'mp',
    isHost: net.isHost(),
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
}): void {
  const { state, players, selfIndex, mode } = info;
  const myScore = state.scores[selfIndex] ?? 0;

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
  }

  const ranked = players
    .map((p, i) => ({ p, i, score: state.scores[i] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  const myWords = state.order
    .filter((w) => state.claimedBy.get(w) === selfIndex)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));

  root.innerHTML = shell(`
    <main class="results">
      <h1 class="results-title">Time!</h1>
      ${banner}
      <ul class="result-scores">
        ${ranked
          .map(
            (r, rank) => `<li class="result-row${r.i === selfIndex ? ' is-self' : ''}" style="--c:${PLAYER_COLORS[r.i % PLAYER_COLORS.length]}">
              <span class="result-rank">${rank + 1}</span>
              <span class="result-name">${escapeHtml(r.p.name)}${r.i === selfIndex ? ' (you)' : ''}</span>
              <span class="result-score">${r.score}</span>
            </li>`,
          )
          .join('')}
      </ul>
      <div class="my-words">
        <h3>Your words (${myWords.length})</h3>
        <div class="word-chips">
          ${
            myWords.length
              ? myWords
                  .map((w) => `<span class="wchip">${escapeHtml(w.toUpperCase())} <em>+${scoreWord(w.length)}</em></span>`)
                  .join('')
              : '<span class="none">No words this round — try again!</span>'
          }
        </div>
      </div>
      <div class="results-actions">
        <button class="btn primary big again-btn" type="button">Play again</button>
        <button class="btn big share-btn" type="button">Share</button>
        <button class="btn ghost menu-btn" type="button">Menu</button>
      </div>
    </main>`);

  sfx.play(mode === 'solo' ? 'win' : leader(state) === selfIndex ? 'win' : 'lose');

  screen().querySelector('.again-btn')!.addEventListener('click', () => {
    if (mode === 'solo') startSolo();
    else {
      // Rejoin the same room with fresh channels for a rematch.
      openRoom(getOrCreateRoomCode());
    }
  });
  screen().querySelector('.share-btn')!.addEventListener('click', () => void shareResult(myScore, mode));
  screen().querySelector('.menu-btn')!.addEventListener('click', showMenu);
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
