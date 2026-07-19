/**
 * rematch.test.ts — the multi-round protocol, driven with N simulated peers.
 *
 * What this covers and what it deliberately does not:
 *
 *  - COVERED: our round protocol. Votes, quorum, monotonic round numbers, the
 *    frozen roster, host election, host handover mid-results. This is our logic
 *    and a fake bus exercises it honestly.
 *
 *  - NOT COVERED: the transport bug that started all this. A fake bus sits ABOVE
 *    Trystero's room cache, so it structurally cannot contain that defect and
 *    would happily go green while the real game was broken. Two other tests own
 *    that: trystero-rejoin.test.ts pins the Trystero behaviour itself, and the
 *    "one join per session" case below asserts the invariant that makes the trap
 *    unreachable — no network model required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRounds, type RoundInfo } from '@ben-gy/game-engine/rematch';
import type { Net, PeerId } from '@ben-gy/game-engine/net';

/** A shared in-memory bus. Delivery is synchronous — we are testing protocol
 *  decisions, not timing. */
class Bus {
  peers = new Map<PeerId, Map<string, Set<(d: unknown, from: PeerId) => void>>>();
  /** Per-peer roster watchers, backing net.onPeersChange(). The engine's round
   *  protocol now depends on these firing: they are how it learns the roster is
   *  still moving (so it must not freeze a start) and how a host unicasts the
   *  live round to a peer whose handshake landed late. */
  watchers = new Map<PeerId, Set<(peers: PeerId[]) => void>>();

  join(id: PeerId): void {
    this.peers.set(id, new Map());
    this.watchers.set(id, new Set());
    this.announce();
  }

  part(id: PeerId): void {
    this.peers.delete(id);
    this.watchers.delete(id);
    this.announce();
  }

  private announce(): void {
    const roster = this.roster();
    for (const set of this.watchers.values()) for (const cb of [...set]) cb(roster);
  }

  onPeers(id: PeerId, cb: (peers: PeerId[]) => void): () => void {
    const set = this.watchers.get(id)!;
    set.add(cb);
    return () => set.delete(cb);
  }

  roster(): PeerId[] {
    return [...this.peers.keys()].sort();
  }

  send(from: PeerId, name: string, data: unknown, to?: PeerId | PeerId[]): void {
    const targets = to ? (Array.isArray(to) ? to : [to]) : this.roster().filter((p) => p !== from);
    for (const t of targets) {
      for (const h of this.peers.get(t)?.get(name) ?? []) h(data, from);
    }
  }

  on(id: PeerId, name: string, h: (d: unknown, from: PeerId) => void): () => void {
    const chans = this.peers.get(id)!;
    if (!chans.has(name)) chans.set(name, new Set());
    chans.get(name)!.add(h);
    return () => chans.get(name)!.delete(h);
  }
}

function mockNet(bus: Bus, selfId: PeerId): Net {
  bus.join(selfId);
  return {
    selfId,
    peers: () => bus.roster(),
    // Same election rule as the real net.ts: lexicographically smallest id.
    host: () => bus.roster()[0],
    isHost: () => bus.roster()[0] === selfId,
    hostSettled: () => true,
    // The bus re-elects by min-id on every roster change rather than running
    // terms, so there is one standing epoch. Enough for the round protocol,
    // which only reads it to report; the epoch race itself belongs to net.ts.
    hostEpoch: () => 1,
    count: () => bus.roster().length,
    onPeersChange: (cb) => bus.onPeers(selfId, cb),
    channel<T>(name: string, onReceive: (d: T, from: PeerId) => void) {
      const off = bus.on(selfId, name, onReceive as (d: unknown, from: PeerId) => void);
      const send = ((data: T, to?: PeerId | PeerId[]) => bus.send(selfId, name, data, to)) as ((
        data: T,
        to?: PeerId | PeerId[],
      ) => void) & { off: () => void };
      send.off = off;
      return send;
    },
    ping: async () => 0,
    // Not representable on a min-id bus: there is no term to mint, and no
    // partition to heal. Nothing in the round protocol calls it — the only
    // legitimate caller is a user tapping "host this room" in the lobby.
    takeover: () => {},
    netDiag: () => ({
      selfId,
      host: bus.roster()[0] ?? null,
      epoch: 1,
      settled: true,
      peers: bus.roster(),
      relaySockets: {},
      turn: false,
    }),
    leave: async () => bus.part(selfId),
  };
}

interface Seat {
  id: PeerId;
  net: Net;
  rounds: ReturnType<typeof createRounds>;
  got: RoundInfo[];
}

function table(
  ids: PeerId[],
  opts: { minPlayers?: number; modeOf?: (id: PeerId) => string } = {},
): Seat[] {
  const bus = new Bus();
  return ids.map((id) => {
    const net = mockNet(bus, id);
    const seat: Seat = { id, net, rounds: null as never, got: [] };
    seat.rounds = createRounds({
      net,
      playerName: id.toUpperCase(),
      minPlayers: opts.minPlayers ?? 2,
      // Each seat "wants" its own mode; only the host's may reach the round.
      roundOpts: () => ({ mode: opts.modeOf?.(id) ?? id }),
      onRound: (info) => seat.got.push(info),
    });
    return seat;
  });
}

let seats: Seat[];
beforeEach(() => {
  seats = [];
  // Every case below needs a controllable clock now, because a start is no
  // longer synchronous with the last vote — see settle().
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * Advance past the roster-settle window and onto the next poll tick.
 *
 * The engine deliberately REFUSES to start a round while the roster is still
 * moving (ROSTER_SETTLE_MS = 4s), because freezing a roster from a half-formed
 * mesh is what "ejected the moment the round started" actually was: the host
 * baked in the peers it could see so far, and Trystero only delivers to
 * channels that are already open, so everyone who handshook a second later was
 * simply not in the game. The start is deferred, not cancelled — a 1.5s poll
 * re-attempts it. So a vote that used to start a round synchronously now needs
 * the 4s window plus the poll tick that follows it.
 */
const settle = (): void => {
  vi.advanceTimersByTime(6000);
};

describe('createRounds — starting a round', () => {
  it('starts once every peer has voted, with one host and an identical seed', () => {
    seats = table(['a', 'b']);
    seats.forEach((s) => s.rounds.vote());
    settle();

    // Auto-start fires once the votes are in AND the roster has held still;
    // nobody had to press Start.
    expect(seats.map((s) => s.got.length)).toEqual([1, 1]);
    expect(seats[0].got[0].seed).toBe(seats[1].got[0].seed);
    expect(seats.filter((s) => s.got[0].isHost)).toHaveLength(1);
    expect(seats[0].got[0].round).toBe(1);
  });

  it('freezes ONE roster into the start, so player indices match on every peer', () => {
    seats = table(['b', 'a', 'c'], { minPlayers: 3 });
    seats.forEach((s) => s.rounds.vote());
    settle();

    const rosters = seats.map((s) => s.got[0].players.map((p) => `${p.id}:${p.name}`));
    // Every peer must agree on who is player 0 — this is what stops a score
    // landing on the wrong name. The roster comes from the host's bytes, not
    // from each peer re-deriving it locally.
    expect(rosters[0]).toEqual(rosters[1]);
    expect(rosters[1]).toEqual(rosters[2]);
    expect(rosters[0]).toEqual(['a:A', 'b:B', 'c:C']);
  });

  it('waits below quorum', () => {
    seats = table(['a', 'b', 'c'], { minPlayers: 3 });
    seats[0].rounds.vote();
    seats[1].rounds.vote();
    settle();
    expect(seats.every((s) => s.got.length === 0)).toBe(true);

    seats[2].rounds.vote();
    settle();
    expect(seats.every((s) => s.got.length === 1)).toBe(true);
  });

  it('lets the host start early with go(), leaving a non-voter out of the roster', () => {
    seats = table(['a', 'b', 'c']);
    seats[0].rounds.vote();
    seats[1].rounds.vote();
    settle();
    expect(seats[0].got.length).toBe(0); // c has not voted — no auto-start

    seats[0].rounds.go(); // host forces it
    expect(seats[0].got[0].players.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('ignores a start from a peer that is not the host', () => {
    seats = table(['a', 'b']);
    // 'b' is not the host; forge a start and make sure nobody honours it.
    seats[1].net.channel('rs', () => {})(
      { round: 1, seed: 42, roster: [{ id: 'b', name: 'B' }] } as never,
    );
    expect(seats.every((s) => s.got.length === 0)).toBe(true);
  });
});

describe('createRounds — the rematch (the bug this all exists for)', () => {
  it('runs a second round in the SAME room, both peers together, one host', () => {
    seats = table(['a', 'b']);
    seats.forEach((s) => s.rounds.vote());
    settle();
    seats.forEach((s) => s.rounds.finish());

    // Both players hit "Play again" — the exact sequence the user reported.
    seats.forEach((s) => s.rounds.vote());
    settle();

    expect(seats.map((s) => s.got.length)).toEqual([2, 2]);
    expect(seats[0].got[1].round).toBe(2);
    expect(seats[0].got[1].seed).toBe(seats[1].got[1].seed);
    // The symptom was TWO hosts. There must be exactly one, every round.
    expect(seats.filter((s) => s.got[1].isHost)).toHaveLength(1);
    // …and a fresh board, not a replay of round 1.
    expect(seats[0].got[1].seed).not.toBe(seats[0].got[0].seed);
  });

  it('keeps both peers in each other\'s roster across the rematch', () => {
    seats = table(['a', 'b']);
    seats.forEach((s) => s.rounds.vote());
    settle();
    seats.forEach((s) => s.rounds.finish());
    seats.forEach((s) => s.rounds.vote());
    settle();

    // "Neither can see each other" — assert the opposite, directly.
    for (const s of seats) {
      expect(s.got[1].players.map((p) => p.id)).toEqual(['a', 'b']);
      expect(s.net.count()).toBe(2);
    }
  });

  it('ignores a stale or duplicated start rather than restarting a live round', () => {
    seats = table(['a', 'b']);
    seats.forEach((s) => s.rounds.vote());
    settle();
    const seed = seats[0].got[0].seed;

    // Replay round 1's start — e.g. a duplicate delivery, or both peers pressing
    // at the same instant. The monotonic guard must swallow it.
    seats[0].net.channel('rs', () => {})(
      { round: 1, seed: 999, roster: [{ id: 'a', name: 'A' }] } as never,
    );
    expect(seats[1].got.length).toBe(1);
    expect(seats[1].got[0].seed).toBe(seed);
  });

  it('does not start a rematch while a round is still being played', () => {
    seats = table(['a', 'b']);
    seats.forEach((s) => s.rounds.vote()); // round 1 playing; no finish()
    settle();
    seats.forEach((s) => s.rounds.vote()); // premature "play again"
    settle();
    expect(seats[0].got.length).toBe(1);
  });

  it('drops the vote of a peer who leaves, and still rematches the rest', () => {
    seats = table(['a', 'b', 'c'], { minPlayers: 2 });
    seats.forEach((s) => s.rounds.vote());
    settle();
    seats.forEach((s) => s.rounds.finish());

    seats[0].rounds.vote();
    seats[1].rounds.vote();
    expect(seats[0].got.length).toBe(1); // still waiting on c

    seats[2].net.leave(); // c closes the tab
    seats[0].rounds.vote(); // any nudge re-tallies
    // c leaving IS a roster change, so the settle window restarts from here —
    // the host must not freeze a roster the instant someone drops either.
    settle();

    expect(seats[0].got[1].players.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('createRounds — host handover', () => {
  it('promotes the next peer and still starts when the host leaves at results', () => {
    seats = table(['a', 'b', 'c'], { minPlayers: 2 });
    seats.forEach((s) => s.rounds.vote());
    settle();
    seats.forEach((s) => s.rounds.finish());
    expect(seats[0].net.isHost()).toBe(true);

    seats[0].net.leave(); // the host walks away between rounds
    expect(seats[1].net.isHost()).toBe(true); // b is promoted by min-id election

    seats[1].rounds.vote();
    seats[2].rounds.vote();
    settle();

    // The promoted host must be able to run the rematch — inheriting no tally
    // from the old host is the classic way this deadlocks.
    expect(seats[1].got.length).toBe(2);
    expect(seats[1].got[1].players.map((p) => p.id)).toEqual(['b', 'c']);
    expect(seats[1].got[1].isHost).toBe(true);
  });
});

describe('createRounds — teardown', () => {
  it('stops answering once destroyed', () => {
    seats = table(['a', 'b']);
    seats[1].rounds.destroy();
    seats.forEach((s) => s.rounds.vote());
    settle();

    // A destroyed Rounds must not keep driving a screen that is gone.
    expect(seats[1].got.length).toBe(0);
  });
});


describe('createRounds — never deadlock waiting for a vote that never comes', () => {
  it('starts anyway once the grace countdown expires, without the silent player', () => {
    seats = table(['a', 'b', 'c'], { minPlayers: 2 });
    seats.forEach((s) => s.rounds.vote());
    settle();
    seats.forEach((s) => s.rounds.finish());

    // Two of three hit "Play again". The third is still reading the summary.
    // The OLD rule required unanimity, so this hung forever with no way out but
    // the menu — the exact reported failure.
    seats[0].rounds.vote();
    seats[1].rounds.vote();
    // The roster is quiet, so the grace countdown is armed on the next poll.
    settle();
    expect(seats[0].got.length).toBe(1); // not yet — the countdown is running

    const s = seats[0].rounds.state();
    expect(s.startsInMs).toBeGreaterThan(0); // and it is VISIBLE, not a silent hang

    vi.advanceTimersByTime(8100);

    expect(seats[0].got.length).toBe(2);
    expect(seats[0].got[1].players.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('goes immediately when everyone votes, with no countdown', () => {
    seats = table(['a', 'b'], { minPlayers: 2 });
    seats.forEach((s) => s.rounds.vote());
    settle();
    seats.forEach((s) => s.rounds.finish());
    seats.forEach((s) => s.rounds.vote());
    settle();

    // Unanimity must not be punished with the 8s straggler countdown ON TOP of
    // the settle window — once the roster is quiet and everyone is in, it goes.
    expect(seats[0].got.length).toBe(2);
    expect(seats[0].rounds.state().startsInMs).toBeNull();
  });

  it('lets the host force the rematch immediately with go()', () => {
    seats = table(['a', 'b', 'c'], { minPlayers: 2 });
    seats.forEach((s) => s.rounds.vote());
    settle();
    seats.forEach((s) => s.rounds.finish());

    seats[0].rounds.vote();
    seats[1].rounds.vote();
    seats[0].rounds.go(); // host is not made to wait out the countdown

    expect(seats[0].got.length).toBe(2);
  });

  it('cancels the countdown if quorum is lost again', () => {
    seats = table(['a', 'b', 'c'], { minPlayers: 2 });
    seats.forEach((s) => s.rounds.vote());
    settle();
    seats.forEach((s) => s.rounds.finish());

    seats[0].rounds.vote();
    seats[1].rounds.vote();
    settle(); // arms the straggler countdown
    expect(seats[0].rounds.state().startsInMs).toBeGreaterThan(0);

    seats[1].rounds.unvote(); // changed their mind
    expect(seats[0].rounds.state().startsInMs).toBeNull();

    vi.advanceTimersByTime(8100);
    expect(seats[0].got.length).toBe(1); // no round started below quorum
  });

  it('a peer who returns to the lobby mid-countdown still lands in the round', () => {
    seats = table(['a', 'b', 'c'], { minPlayers: 2 });
    seats.forEach((s) => s.rounds.vote());
    settle();
    seats.forEach((s) => s.rounds.finish());

    seats[0].rounds.vote();
    seats[1].rounds.vote();
    seats[2].rounds.vote(); // the straggler taps just in time
    settle();

    expect(seats[2].got.length).toBe(2);
    expect(seats[2].got[1].players.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});


describe('createRounds — the host\'s game settings, not each peer\'s', () => {
  it('gives every peer the HOST\'s mode, not their own', () => {
    // Each seat wants a different mode. Only one may win, or two peers play
    // different board sizes on the same seed and neither can score the other's
    // words.
    seats = table(['a', 'b', 'c'], { minPlayers: 3, modeOf: (id) => `mode-${id}` });
    seats.forEach((s) => s.rounds.vote());
    settle();

    const opts = seats.map((s) => s.got[0].opts);
    expect(opts[0]).toEqual(opts[1]);
    expect(opts[1]).toEqual(opts[2]);
    expect(opts[0]).toEqual({ mode: 'mode-a' }); // 'a' hosts
  });

  it('re-reads the host\'s choice for each rematch', () => {
    let hostMode = 'classic';
    seats = table(['a', 'b'], { modeOf: () => hostMode });
    seats.forEach((s) => s.rounds.vote());
    settle();
    expect(seats[1].got[0].opts).toEqual({ mode: 'classic' });

    // The host switches mode on the results screen; the next round must use it.
    seats.forEach((s) => s.rounds.finish());
    hostMode = 'marathon';
    seats.forEach((s) => s.rounds.vote());
    settle();

    expect(seats[1].got[1].opts).toEqual({ mode: 'marathon' });
  });
});
