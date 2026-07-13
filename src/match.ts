/**
 * match.ts — pure, host-authoritative claim resolution + snapshot (de)serialize.
 *
 * A word is worth points only to whoever claims it FIRST. The host runs
 * `resolveClaim` for every claim (its own and clients'), which validates the
 * word against the dictionary and the board, then records the first claimant.
 * The host broadcasts snapshots; clients apply them. Solo play is just a match
 * with a single player where nothing is ever contested.
 *
 * Kept dependency-light and side-effect-free (mutates only the passed state) so
 * it is fully unit-testable and identical on every peer.
 */

import { canForm, scoreWord, MIN_WORD_LEN, type Board } from './board';

export interface PlayerInfo {
  id: string;
  name: string;
}

export type ClaimStatus = 'ok' | 'taken' | 'invalid' | 'short';

export interface ClaimResult {
  status: ClaimStatus;
  word: string;
  /** Player index that owns the word (present for 'ok' and 'taken'). */
  by?: number;
  /** Points awarded (present for 'ok'). */
  points?: number;
}

export interface MatchState {
  /** word -> index of the player who claimed it first. */
  claimedBy: Map<string, number>;
  /** scores[i] = player i's running total. */
  scores: number[];
  /** words in the order they were claimed (for the live feed). */
  order: string[];
}

export interface Snapshot {
  /** claims as [word, playerIndex] pairs. */
  c: [string, number][];
  /** scores. */
  s: number[];
  /** ms remaining in the round. */
  r: number;
  /** true once the round is over. */
  d: boolean;
}

export function createMatch(numPlayers: number): MatchState {
  return {
    claimedBy: new Map(),
    scores: new Array<number>(Math.max(1, numPlayers)).fill(0),
    order: [],
  };
}

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

/**
 * Resolve a claim against authoritative state. Mutates `state` on success.
 * `isWord` is injected so tests can supply a small dictionary.
 */
export function resolveClaim(
  state: MatchState,
  board: Board,
  isWord: (w: string) => boolean,
  playerIdx: number,
  rawWord: string,
): ClaimResult {
  const word = normalizeWord(rawWord);
  if (word.length < MIN_WORD_LEN) return { status: 'short', word };

  const existing = state.claimedBy.get(word);
  if (existing !== undefined) {
    return { status: 'taken', word, by: existing };
  }
  if (!isWord(word) || !canForm(board, word)) {
    return { status: 'invalid', word };
  }

  const points = scoreWord(word.length);
  state.claimedBy.set(word, playerIdx);
  if (playerIdx >= 0 && playerIdx < state.scores.length) state.scores[playerIdx] += points;
  state.order.push(word);
  return { status: 'ok', word, by: playerIdx, points };
}

/** Build a wire snapshot of the authoritative state. */
export function encodeSnapshot(state: MatchState, msRemaining: number, ended: boolean): Snapshot {
  const c: [string, number][] = state.order.map((w) => [w, state.claimedBy.get(w)!]);
  return { c, s: state.scores.slice(), r: Math.max(0, Math.round(msRemaining)), d: ended };
}

/** Overwrite local state from a received snapshot (clients render from this). */
export function applySnapshot(state: MatchState, snap: Snapshot): void {
  state.claimedBy = new Map(snap.c);
  state.order = snap.c.map(([w]) => w);
  state.scores = snap.s.slice();
}

/** Winner index (or -1 on a tie / no players). */
export function leader(state: MatchState): number {
  let best = -1;
  let bestScore = -1;
  let tie = false;
  for (let i = 0; i < state.scores.length; i++) {
    if (state.scores[i] > bestScore) {
      bestScore = state.scores[i];
      best = i;
      tie = false;
    } else if (state.scores[i] === bestScore) {
      tie = true;
    }
  }
  return tie ? -1 : best;
}
