/**
 * identity.test.ts — carrying a display name between games without cookies.
 *
 * Each game is its own subdomain, so each has its own localStorage and there is
 * no shared store to read. The name rides a `?n=` param on a link the player
 * clicked, and each game seeds its OWN storage from it once.
 *
 * The dangerous part is the strip. Invite links are built from location.href,
 * so a `?n=` left in the URL would be copied into the invite — and rename
 * whoever accepted it to the host's name. That case is asserted first.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { resolveName, takeNameFromLink, withName } from '@ben-gy/game-engine/identity';

/** Minimal stand-in for engine/storage's createStore. */
function memStore() {
  const map = new Map<string, unknown>();
  return {
    map,
    get<T>(k: string, fallback: T): T {
      return map.has(k) ? (map.get(k) as T) : fallback;
    },
    set<T>(k: string, v: T): void {
      map.set(k, v);
    },
  };
}

function goTo(url: string): void {
  history.replaceState(null, '', url);
}

beforeEach(() => {
  goTo('/');
});

describe('takeNameFromLink', () => {
  it('removes ?n= from the URL so it cannot leak into an invite link', () => {
    goTo('/?n=Ben');
    expect(takeNameFromLink()).toBe('Ben');

    // THE bug this guards: inviteLink() derives from location.href. If ?n=
    // survived, the host's invite would carry their own name and rename the
    // guest who accepted it.
    expect(location.search).toBe('');
    const invite = new URL(location.href);
    invite.searchParams.set('room', 'ABCD');
    expect(invite.toString()).not.toContain('n=Ben');
  });

  it('keeps other params intact while removing its own', () => {
    goTo('/?room=ABCD&n=Ben');
    expect(takeNameFromLink()).toBe('Ben');
    expect(new URL(location.href).searchParams.get('room')).toBe('ABCD');
  });

  it('returns null when there is no name to take', () => {
    goTo('/?room=ABCD');
    expect(takeNameFromLink()).toBeNull();
    expect(location.search).toBe('?room=ABCD');
  });

  it('ignores an empty or whitespace-only name', () => {
    goTo('/?n=%20%20');
    expect(takeNameFromLink()).toBeNull();
  });

  it('caps the length, because this lands in other players\' lobbies', () => {
    goTo('/?n=' + encodeURIComponent('x'.repeat(80)));
    expect(takeNameFromLink()!.length).toBe(16);
  });

  it('strips control characters that could smuggle a newline into a roster', () => {
    goTo('/?n=' + encodeURIComponent('Be\u0007n\u0000'));
    expect(takeNameFromLink()).toBe('Ben');
  });

  it('keeps spaces and punctuation — people have those in their names', () => {
    goTo('/?n=' + encodeURIComponent("Ben R."));
    expect(takeNameFromLink()).toBe('Ben R.');
  });
});

describe('resolveName', () => {
  it('seeds this game from a link on a first visit', () => {
    goTo('/?n=Ben');
    const store = memStore();
    expect(resolveName(store, () => 'Player999')).toBe('Ben');
    expect(store.get('name', '')).toBe('Ben');
  });

  it('does NOT overwrite a name already chosen in this game', () => {
    goTo('/?n=Ben');
    const store = memStore();
    store.set('name', 'Zed');

    // Arriving from the hub must not silently rename you in a game you have
    // already played.
    expect(resolveName(store, () => 'Player999')).toBe('Zed');
    expect(store.get('name', '')).toBe('Zed');
  });

  it('still strips ?n= even when it does not use it', () => {
    goTo('/?n=Ben');
    const store = memStore();
    store.set('name', 'Zed');
    resolveName(store, () => 'Player999');
    expect(location.search).toBe(''); // or it would leak into the invite
  });

  it('falls back to a generated name and persists it', () => {
    const store = memStore();
    expect(resolveName(store, () => 'Player999')).toBe('Player999');
    // Persisting matters: without it the name churns on every reload.
    expect(store.get('name', '')).toBe('Player999');
  });
});

describe('withName', () => {
  it('adds the name to an outbound link', () => {
    expect(withName('https://hub.benrichardson.dev', 'Ben')).toContain('n=Ben');
  });

  it('adds nothing when there is no name', () => {
    expect(withName('https://hub.benrichardson.dev', '   ')).toBe(
      'https://hub.benrichardson.dev',
    );
  });

  it('round-trips a name with spaces', () => {
    const link = withName('https://hub.benrichardson.dev', 'Ben R.');
    goTo(new URL(link).search);
    expect(takeNameFromLink()).toBe('Ben R.');
  });
});
