/**
 * session.ts — the live gameplay controller (used by both solo and P2P modes).
 *
 * Owns: board DOM, letter-chain input (drag / tap / keyboard), the glowing trail,
 * the word preview, the countdown, per-player score chips, the claimed-word feed,
 * particle + shake juice, and the netcode glue.
 *
 * Netcode: host-authoritative. The host (or the solo player) runs resolveClaim
 * and broadcasts snapshots on `snap`; clients validate locally for instant feel,
 * send `{w}` on `clm`, and render the authoritative snapshots they receive.
 */

import {
  generateBoard,
  pathToWord,
  isAdjacent,
  canForm,
  scoreWord,
  MIN_WORD_LEN,
  type Board,
} from './board';
import {
  createMatch,
  resolveClaim,
  encodeSnapshot,
  applySnapshot,
  type MatchState,
  type PlayerInfo,
  type Snapshot,
} from './match';
import { isWord } from './dictionary';
import { createParticles, type Particles } from './particles';
import type { Sfx } from './engine/sound';
import type { Net } from './engine/net';

export const PLAYER_COLORS = ['#22d3ee', '#fbbf24', '#34d399', '#fb7185', '#a78bfa', '#fb923c'];

export interface SessionOptions {
  root: HTMLElement;
  seed: number;
  /** Grid edge for this round's mode. Comes frozen from the host. */
  size: number;
  players: PlayerInfo[];
  selfIndex: number;
  mode: 'solo' | 'mp';
  isHost: boolean;
  durationMs: number;
  sfx: Sfx;
  reducedMotion: boolean;
  net?: Net;
  onQuit: () => void;
  onResults: (info: {
    state: MatchState;
    players: PlayerInfo[];
    selfIndex: number;
    mode: 'solo' | 'mp';
    /** Seed + size, so results can rebuild this exact grid and solve it. */
    seed: number;
    size: number;
  }) => void;
}

export class Session {
  private o: SessionOptions;
  private board: Board;
  private state: MatchState;
  private authoritative: boolean;
  private isHost: boolean;

  private chain: number[] = [];
  private dragging = false;

  private endsAt = 0;
  private clientRemaining: number;
  private ended = false;
  private paused = false;

  private raf = 0;
  private lastStep = 0;
  private lastSnap = 0;
  private timeInterval = 0;

  private shake = 0;

  private particles!: Particles;
  private pending = new Set<string>();
  private knownClaims = new Set<string>();
  private idToIndex = new Map<string, number>();

  private sendClaim?: ((d: { w: string }) => void) & { off: () => void };
  private sendSnap?: ((d: Snapshot) => void) & { off: () => void };

  // DOM refs
  private els!: {
    boardEl: HTMLElement;
    trail: SVGPolylineElement;
    tiles: HTMLElement[];
    wpText: HTMLElement;
    wpPts: HTMLElement;
    timer: HTMLElement;
    scores: HTMLElement;
    feed: HTMLElement;
    toast: HTMLElement;
    fx: HTMLCanvasElement;
    mute: HTMLButtonElement;
    pauseBtn: HTMLButtonElement | null;
    boardWrap: HTMLElement;
    pauseOverlay: HTMLElement;
  };

  private onResize = () => this.particles.resize();
  private onWinPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private onWinPointerUp = () => this.handlePointerUp();
  private onKey = (e: KeyboardEvent) => this.handleKey(e);

  constructor(opts: SessionOptions) {
    this.o = opts;
    this.isHost = opts.isHost;
    this.authoritative = opts.mode === 'solo' || opts.isHost;
    this.board = generateBoard(opts.seed, opts.size);
    this.state = createMatch(opts.players.length);
    this.clientRemaining = opts.durationMs;
    opts.players.forEach((p, i) => this.idToIndex.set(p.id, i));

    this.buildDom();
    this.wireNet();
    this.start();
  }

  // ---- setup ----------------------------------------------------------------

  private buildDom(): void {
    const p = this.o.players;
    const soloPause =
      this.o.mode === 'solo'
        ? '<button class="icon-btn pause-btn" type="button" aria-label="Pause">Pause</button>'
        : '';
    this.o.root.innerHTML = `
      <div class="game">
        <header class="hud">
          <button class="icon-btn quit-btn" type="button">&larr; Quit</button>
          <div class="timer" aria-live="off">1:30</div>
          <div class="hud-right">
            <button class="icon-btn mute-btn" type="button" aria-label="Toggle sound"></button>
            ${soloPause}
          </div>
        </header>
        <div class="scores"></div>
        <div class="board-wrap">
          <div class="word-preview"><span class="wp-text"></span><span class="wp-pts"></span></div>
          <div class="board" role="grid" aria-label="Letter board"></div>
          <div class="controls">
            <button class="ctrl-btn clear-btn" type="button">Clear</button>
            <button class="ctrl-btn submit-btn primary" type="button">Submit</button>
          </div>
        </div>
        <div class="feed-wrap">
          <h3 class="feed-title">Claimed words</h3>
          <ul class="feed" aria-live="polite"></ul>
        </div>
        <div class="pause-overlay" hidden>
          <div class="pause-card">
            <h2>Paused</h2>
            <button class="ctrl-btn primary resume-btn" type="button">Resume</button>
          </div>
        </div>
        <canvas class="fx" aria-hidden="true"></canvas>
        <div class="toast" role="status" aria-live="assertive"></div>
      </div>`;

    const root = this.o.root;
    const boardEl = root.querySelector<HTMLElement>('.board')!;

    // build tiles
    const tiles: HTMLElement[] = [];
    boardEl.style.setProperty('--n', String(this.board.size));
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.classList.add('trail');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    const trail = document.createElementNS(svgNs, 'polyline') as SVGPolylineElement;
    trail.classList.add('trail-line');
    svg.appendChild(trail);
    boardEl.appendChild(svg);

    this.board.tiles.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'tile';
      b.type = 'button';
      b.dataset.idx = String(i);
      b.setAttribute('role', 'gridcell');
      b.setAttribute('aria-label', t.letter);
      b.innerHTML = `<span class="tile-letter">${t.letter}</span>`;
      b.addEventListener('pointerdown', (e) => this.handlePointerDown(e, i));
      boardEl.appendChild(b);
      tiles.push(b);
    });

    const fx = root.querySelector<HTMLCanvasElement>('.fx')!;
    this.particles = createParticles(fx, this.o.reducedMotion);

    this.els = {
      boardEl,
      trail,
      tiles,
      wpText: root.querySelector<HTMLElement>('.wp-text')!,
      wpPts: root.querySelector<HTMLElement>('.wp-pts')!,
      timer: root.querySelector<HTMLElement>('.timer')!,
      scores: root.querySelector<HTMLElement>('.scores')!,
      feed: root.querySelector<HTMLElement>('.feed')!,
      toast: root.querySelector<HTMLElement>('.toast')!,
      fx,
      mute: root.querySelector<HTMLButtonElement>('.mute-btn')!,
      pauseBtn: root.querySelector<HTMLButtonElement>('.pause-btn'),
      boardWrap: root.querySelector<HTMLElement>('.board-wrap')!,
      pauseOverlay: root.querySelector<HTMLElement>('.pause-overlay')!,
    };

    root.querySelector('.quit-btn')!.addEventListener('click', () => this.quit());
    root.querySelector('.clear-btn')!.addEventListener('click', () => this.clearChain());
    root.querySelector('.submit-btn')!.addEventListener('click', () => this.submit());
    this.els.mute.addEventListener('click', () => this.toggleMute());
    this.els.pauseBtn?.addEventListener('click', () => this.togglePause());
    root.querySelector('.resume-btn')?.addEventListener('click', () => this.togglePause());

    window.addEventListener('pointermove', this.onWinPointerMove);
    window.addEventListener('pointerup', this.onWinPointerUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);

    this.renderMute();
    this.renderScores();
    this.updatePreview();
    void p;
  }

  private wireNet(): void {
    if (this.o.mode !== 'mp' || !this.o.net) return;
    const net = this.o.net;
    this.sendClaim = net.channel<{ w: string }>('clm', (msg, from) => {
      if (this.isHost) this.hostReceiveClaim(from, msg.w);
    });
    this.sendSnap = net.channel<Snapshot>('snap', (snap) => {
      if (!this.isHost) this.onSnapshot(snap);
    });
  }

  /**
   * Detach this round's receivers from the shared Net. The Net outlives the
   * Session now (it spans every round in the room), and net.channel() fans out
   * to all subscribers — so without this, a finished round keeps listening: the
   * old host would resolve the next round's claims against the previous board
   * and broadcast snapshots of a dead match over the live one.
   */
  private unwireNet(): void {
    this.sendClaim?.off();
    this.sendSnap?.off();
    this.sendClaim = undefined;
    this.sendSnap = undefined;
  }

  private start(): void {
    const now = performance.now();
    this.endsAt = now + this.o.durationMs;
    this.lastStep = now;
    this.lastSnap = 0;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    // A setInterval backs the rAF loop so the countdown, round-end, and host
    // snapshots keep advancing even when the tab is backgrounded (browsers pause
    // rAF for hidden tabs but only throttle setInterval to ~1s).
    this.timeInterval = window.setInterval(() => this.stepTime(), 400);
    if (this.authoritative && this.o.mode === 'mp') this.broadcastSnap();
  }

  // ---- host migration -------------------------------------------------------

  /** Called by main when net re-elects the host (e.g. the host left). */
  setHost(isSelfHost: boolean): void {
    if (this.ended) return;
    if (isSelfHost && !this.isHost) {
      // take over authoritatively from our last-known remaining time
      this.isHost = true;
      this.authoritative = true;
      this.endsAt = performance.now() + this.getRemaining();
      this.toast('You are now the host', 'info');
      this.broadcastSnap();
    }
  }

  onPeerLeave(): void {
    if (!this.ended) this.toast('A player left', 'info');
  }

  // ---- input ----------------------------------------------------------------

  private handlePointerDown(e: PointerEvent, idx: number): void {
    if (this.ended || this.paused) return;
    e.preventDefault();
    this.o.sfx.unlock();
    if (this.chain.length === 0) {
      this.dragging = true;
      this.pushTile(idx);
    } else {
      // tap-sequence in progress
      const last = this.chain[this.chain.length - 1];
      if (idx === last) {
        this.submit();
      } else if (this.chain.includes(idx)) {
        // tapping an earlier tile trims back to it
        const at = this.chain.indexOf(idx);
        this.chain = this.chain.slice(0, at + 1);
        this.renderChain();
      } else if (isAdjacent(this.board, last, idx)) {
        this.pushTile(idx);
      } else {
        this.flashTile(idx, false);
      }
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.dragging || this.ended || this.paused) return;
    const idx = this.tileAt(e.clientX, e.clientY);
    if (idx < 0) return;
    const len = this.chain.length;
    if (len === 0) return;
    const last = this.chain[len - 1];
    if (idx === last) return;
    if (len >= 2 && idx === this.chain[len - 2]) {
      // backtrack
      this.chain.pop();
      this.renderChain();
      return;
    }
    if (!this.chain.includes(idx) && isAdjacent(this.board, last, idx)) {
      this.pushTile(idx);
    }
  }

  private handlePointerUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.chain.length >= MIN_WORD_LEN) {
      this.submit();
    } else if (this.chain.length > 1) {
      // too short after a drag — clear
      this.clearChain();
    }
    // a single-tile press stays as the start of a tap-sequence
  }

  private handleKey(e: KeyboardEvent): void {
    if (this.ended) return;
    if (e.key === 'Enter' || e.key === ' ') {
      if (this.chain.length) {
        e.preventDefault();
        this.submit();
      }
    } else if (e.key === 'Backspace') {
      if (this.chain.length) {
        e.preventDefault();
        this.chain.pop();
        this.renderChain();
      }
    } else if (e.key === 'Escape') {
      if (this.paused && this.o.mode === 'solo') this.togglePause();
      else this.clearChain();
    } else if (e.key === 'p' && this.o.mode === 'solo') {
      this.togglePause();
    }
  }

  private tileAt(cx: number, cy: number): number {
    const el = document.elementFromPoint(cx, cy);
    const tile = el?.closest<HTMLElement>('.tile');
    if (!tile || tile.dataset.idx === undefined) return -1;
    return Number(tile.dataset.idx);
  }

  private pushTile(idx: number): void {
    this.chain.push(idx);
    this.renderChain();
    const pitch = 1 + Math.min(1.2, (this.chain.length - 1) * 0.12);
    this.o.sfx.play('select', pitch);
    this.flashTile(idx, true);
  }

  private clearChain(): void {
    this.chain = [];
    this.dragging = false;
    this.renderChain();
  }

  // ---- submit + claim resolution -------------------------------------------

  private submit(): void {
    const path = this.chain.slice();
    this.clearChain();
    if (path.length < MIN_WORD_LEN) {
      if (path.length > 0) this.toast('Too short', 'bad');
      return;
    }
    const word = pathToWord(this.board, path);

    if (this.authoritative) {
      const res = resolveClaim(this.state, this.board, isWord, this.o.selfIndex, word);
      this.applyLocalResult(res, path);
      if (this.o.mode === 'mp') this.broadcastSnap();
      return;
    }

    // client path: instant local feedback, then defer to host
    if (this.state.claimedBy.has(word)) {
      this.o.sfx.play('steal');
      this.toast(`"${word.toUpperCase()}" already taken`, 'bad');
      this.triggerShake(4, true);
      return;
    }
    if (word.length < MIN_WORD_LEN) return;
    if (!isWord(word) || !canFormLocal(this.board, word)) {
      this.o.sfx.play('hit');
      this.toast(`Not in word list: ${word.toUpperCase()}`, 'bad');
      this.triggerShake(4, true);
      return;
    }
    this.pending.add(word);
    this.sendClaim?.({ w: word });
    this.toast(`${word.toUpperCase()}…`, 'pending');
    this.wordParticles(path, this.o.selfIndex, true);
  }

  private applyLocalResult(res: ReturnType<typeof resolveClaim>, path: number[]): void {
    if (res.status === 'ok') {
      const pts = res.points ?? 0;
      const big = res.word.length >= 6;
      this.o.sfx.play(big ? 'powerup' : 'coin', 1 + Math.min(0.5, res.word.length * 0.04));
      this.toast(`+${pts}  ${res.word.toUpperCase()}`, 'good');
      this.wordParticles(path, this.o.selfIndex, false);
      if (big) this.triggerShake(res.word.length, false);
      this.knownClaims.add(res.word);
      this.renderScores();
      this.renderFeed();
    } else if (res.status === 'taken') {
      this.o.sfx.play('steal');
      const who = this.o.players[res.by ?? -1]?.name ?? 'Someone';
      this.toast(`Taken by ${who}`, 'bad');
      this.triggerShake(4, true);
    } else if (res.status === 'invalid') {
      this.o.sfx.play('hit');
      this.toast(`Not in word list: ${res.word.toUpperCase()}`, 'bad');
      this.triggerShake(4, true);
    } else {
      this.toast('Too short', 'bad');
    }
  }

  private hostReceiveClaim(from: string, word: string): void {
    const idx = this.idToIndex.get(from);
    if (idx === undefined) return;
    resolveClaim(this.state, this.board, isWord, idx, word);
    this.knownClaims = new Set(this.state.order);
    this.renderScores();
    this.renderFeed();
    this.broadcastSnap();
  }

  private broadcastSnap(): void {
    if (!this.sendSnap) return;
    const snap = encodeSnapshot(this.state, this.getRemaining(), this.ended);
    this.sendSnap(snap);
    this.lastSnap = performance.now();
  }

  private onSnapshot(snap: Snapshot): void {
    // detect new claims for juice/feedback
    const before = this.knownClaims;
    applySnapshot(this.state, snap);
    this.clientRemaining = snap.r;
    for (const w of this.state.order) {
      if (before.has(w)) continue;
      const owner = this.state.claimedBy.get(w)!;
      if (owner === this.o.selfIndex) {
        this.pending.delete(w);
        this.o.sfx.play(w.length >= 6 ? 'powerup' : 'coin');
        this.toast(`+${scoreWord(w.length)}  ${w.toUpperCase()}`, 'good');
      } else if (this.pending.has(w)) {
        // we tried but a rival beat us to it
        this.pending.delete(w);
        this.o.sfx.play('steal');
        this.toast(`Stolen: ${w.toUpperCase()}`, 'bad');
        this.triggerShake(5, true);
      }
    }
    this.knownClaims = new Set(this.state.order);
    this.renderScores();
    this.renderFeed();
    if (snap.d && !this.ended) this.endRound();
  }

  // ---- rendering ------------------------------------------------------------

  private renderChain(): void {
    const inChain = new Set(this.chain);
    this.els.tiles.forEach((el, i) => {
      el.classList.toggle('in-chain', inChain.has(i));
      el.classList.toggle('chain-head', this.chain[this.chain.length - 1] === i);
    });
    // trail polyline through tile centers (percent coords in the board)
    const rect = this.els.boardEl.getBoundingClientRect();
    const pts = this.chain
      .map((i) => {
        const r = this.els.tiles[i].getBoundingClientRect();
        const x = ((r.left + r.width / 2 - rect.left) / rect.width) * 100;
        const y = ((r.top + r.height / 2 - rect.top) / rect.height) * 100;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
    this.els.trail.setAttribute('points', pts);
    this.els.trail.style.stroke = PLAYER_COLORS[this.o.selfIndex % PLAYER_COLORS.length];
    this.updatePreview();
  }

  private updatePreview(): void {
    const word = pathToWord(this.board, this.chain);
    const display = this.chain.map((i) => this.board.tiles[i].letter).join('');
    this.els.wpText.textContent = display || ' ';
    let cls = 'word-preview';
    let pts = '';
    if (word.length >= MIN_WORD_LEN) {
      const taken = this.state.claimedBy.has(word);
      const valid = !taken && isWord(word) && canFormLocal(this.board, word);
      if (taken) {
        cls += ' is-taken';
        pts = 'taken';
      } else if (valid) {
        cls += ' is-valid';
        pts = `+${scoreWord(word.length)}`;
      } else {
        cls += ' is-unknown';
        pts = '';
      }
    }
    const wrap = this.els.wpText.closest('.word-preview')!;
    wrap.className = cls;
    this.els.wpPts.textContent = pts;
  }

  private renderScores(): void {
    const html = this.o.players
      .map((pl, i) => {
        const c = PLAYER_COLORS[i % PLAYER_COLORS.length];
        const self = i === this.o.selfIndex ? ' is-self' : '';
        const words = this.state.order.filter((w) => this.state.claimedBy.get(w) === i).length;
        return `<div class="score-chip${self}" style="--c:${c}">
          <span class="score-name">${esc(pl.name)}${i === this.o.selfIndex ? ' (you)' : ''}</span>
          <span class="score-val">${this.state.scores[i] ?? 0}</span>
          <span class="score-words">${words}w</span>
        </div>`;
      })
      .join('');
    this.els.scores.innerHTML = html;
  }

  private renderFeed(): void {
    const recent = this.state.order.slice(-16).reverse();
    this.els.feed.innerHTML = recent
      .map((w) => {
        const owner = this.state.claimedBy.get(w)!;
        const c = PLAYER_COLORS[owner % PLAYER_COLORS.length];
        const name = this.o.players[owner]?.name ?? '?';
        return `<li class="feed-item" style="--c:${c}">
          <span class="feed-word">${esc(w.toUpperCase())}</span>
          <span class="feed-pts">+${scoreWord(w.length)}</span>
          <span class="feed-who">${esc(name)}</span>
        </li>`;
      })
      .join('');
  }

  private renderMute(): void {
    this.els.mute.textContent = this.o.sfx.muted() ? 'Muted' : 'Sound';
    this.els.mute.setAttribute('aria-pressed', String(this.o.sfx.muted()));
  }

  private wordParticles(path: number[], playerIdx: number, pending: boolean): void {
    if (!path.length) return;
    const color = PLAYER_COLORS[playerIdx % PLAYER_COLORS.length];
    let sx = 0;
    let sy = 0;
    for (const i of path) {
      const r = this.els.tiles[i].getBoundingClientRect();
      sx += r.left + r.width / 2;
      sy += r.top + r.height / 2;
    }
    const cx = sx / path.length;
    const cy = sy / path.length;
    const chars = path.map((i) => this.board.tiles[i].letter).join('');
    if (!pending) this.particles.burst(cx, cy, color, chars);
    this.particles.ring(cx, cy, color);
  }

  private flashTile(idx: number, good: boolean): void {
    const el = this.els.tiles[idx];
    el.classList.remove('pulse-good', 'pulse-bad');
    void el.offsetWidth; // restart animation
    el.classList.add(good ? 'pulse-good' : 'pulse-bad');
  }

  private toastTimer = 0;
  private toast(msg: string, kind: 'good' | 'bad' | 'info' | 'pending'): void {
    const t = this.els.toast;
    t.textContent = msg;
    t.className = `toast show ${kind}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 1200);
  }

  private triggerShake(amount: number, bad: boolean): void {
    if (this.o.reducedMotion) return;
    this.shake = Math.min(14, amount);
    this.els.boardWrap.classList.toggle('shake-bad', bad);
  }

  // ---- loop -----------------------------------------------------------------

  private getRemaining(): number {
    if (this.authoritative) return Math.max(0, this.endsAt - performance.now());
    return Math.max(0, this.clientRemaining);
  }

  /** rAF loop: visuals only (particles, screen shake). Paused when tab hidden. */
  private frame(_now: number): void {
    this.raf = requestAnimationFrame((t) => this.frame(t));

    this.particles.tick();

    if (this.shake > 0.1) {
      const dx = (Math.random() * 2 - 1) * this.shake;
      const dy = (Math.random() * 2 - 1) * this.shake;
      this.els.boardWrap.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      this.shake *= 0.85;
    } else if (this.shake !== 0) {
      this.shake = 0;
      this.els.boardWrap.style.transform = '';
      this.els.boardWrap.classList.remove('shake-bad');
    }

    this.stepTime();
  }

  /** Time/authority loop: countdown, round-end, host snapshots. Driven by BOTH
   *  the rAF frame (smooth) and a setInterval (survives a backgrounded tab). */
  private stepTime(): void {
    if (this.ended || this.paused) return;
    const now = performance.now();
    const dt = Math.min(1000, now - this.lastStep);
    this.lastStep = now;

    if (!this.authoritative) this.clientRemaining = Math.max(0, this.clientRemaining - dt);

    const rem = this.getRemaining();
    this.renderTimer(rem);

    if (this.authoritative && rem <= 0) {
      this.endRound();
      return;
    }
    if (this.authoritative && this.o.mode === 'mp' && now - this.lastSnap > 1000) {
      this.broadcastSnap();
    }
    if (!this.authoritative && rem <= 0 && now - this.lastSnap > 3000) {
      this.endRound();
    }
  }

  private lastTimerText = '';
  private renderTimer(ms: number): void {
    const s = Math.ceil(ms / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    const text = `${mm}:${ss.toString().padStart(2, '0')}`;
    if (text !== this.lastTimerText) {
      this.lastTimerText = text;
      this.els.timer.textContent = text;
      this.els.timer.classList.toggle('urgent', s <= 10);
      if (s <= 10 && s > 0 && !this.ended) this.o.sfx.play('tick');
    }
  }

  // ---- lifecycle ------------------------------------------------------------

  private togglePause(): void {
    if (this.o.mode !== 'solo' || this.ended) return;
    this.paused = !this.paused;
    this.els.pauseOverlay.hidden = !this.paused;
    if (this.paused) {
      this.pausedAt = performance.now();
    } else {
      // shift the deadline forward by the paused duration
      const now = performance.now();
      this.endsAt += now - this.pausedAt;
      this.lastStep = now;
    }
  }
  private pausedAt = 0;

  private toggleMute(): void {
    this.o.sfx.setMuted(!this.o.sfx.muted());
    this.renderMute();
    if (!this.o.sfx.muted()) this.o.sfx.play('blip');
  }

  private endRound(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.authoritative && this.o.mode === 'mp') this.broadcastSnap();
    this.teardownInput();
    cancelAnimationFrame(this.raf);
    // The outcome sound belongs to the results screen, which is the only place
    // that knows whether this was a win or a loss.
    this.o.onResults({
      state: this.state,
      players: this.o.players,
      selfIndex: this.o.selfIndex,
      mode: this.o.mode,
      seed: this.o.seed,
      size: this.o.size,
    });
  }

  private quit(): void {
    this.destroy();
    this.o.onQuit();
  }

  private teardownInput(): void {
    window.removeEventListener('pointermove', this.onWinPointerMove);
    window.removeEventListener('pointerup', this.onWinPointerUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
    window.clearInterval(this.timeInterval);
  }

  destroy(): void {
    this.ended = true;
    cancelAnimationFrame(this.raf);
    this.teardownInput();
    this.unwireNet();
    this.particles.destroy();
  }
}

const canFormLocal = canForm;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
