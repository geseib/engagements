/**
 * The display profile is the one parameter the whole stage reads, and it has
 * failed silently before: revision 1 scaled one ladder by a `--k` multiplier
 * declared on :root, where it substituted against :root's own value of 1, so
 * all three profiles rendered identically and only the boxes shrank. The audit
 * check that catches that (A5) lives in a browser; what CAN be tested here is
 * that the selection and persistence rules are right, because "never lose the
 * presentation state on reload" is a hard requirement and a projector browser
 * that reloads has to come back exactly as it was.
 */
import {
  PROFILES, DEFAULT_PROFILE, FLOORS,
  profileClass, autoProfile, loadProfile, saveProfile, toggleBigScreen,
} from '../config/displayProfile';

/** A localStorage stand-in. jsdom provides one, but an explicit fake keeps
 *  these tests independent of jsdom's global state leaking between files. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

describe('the profile vocabulary', () => {
  test('there are exactly four, and Room is the default', () => {
    expect(PROFILES).toEqual(['room', 'tv', 'call', 'table']);
    expect(DEFAULT_PROFILE).toBe('room');
  });

  test('each profile maps to its root class', () => {
    expect(profileClass('room')).toBe('d-room');
    expect(profileClass('tv')).toBe('d-tv');
    expect(profileClass('call')).toBe('d-call');
    expect(profileClass('table')).toBe('d-table');
  });

  test('an unknown profile falls back to the default class rather than throwing', () => {
    expect(profileClass('projector')).toBe('d-room');
    expect(profileClass(undefined)).toBe('d-room');
  });

  // The floors are angular targets projected through a distance and a pixel
  // density, not a style preference. They are asserted here so a later "tidy
  // up" cannot quietly unify them.
  test('each profile carries its own floor', () => {
    expect(FLOORS).toEqual({ room: 20, tv: 26, call: 20, table: 16 });
  });
});

describe('automatic selection', () => {
  // TV and Call cannot be detected — the browser cannot know a panel's physical
  // size, and it cannot know it is being screen-shared. Only Table is
  // detectable, and only by the crude proxy of viewport width.
  test('below 1600px is Table', () => {
    expect(autoProfile(1440)).toBe('table');
    expect(autoProfile(1599)).toBe('table');
  });

  test('1600px and above is Room', () => {
    expect(autoProfile(1600)).toBe('room');
    expect(autoProfile(1920)).toBe('room');
  });

  test('a missing width does not crash and lands on the default', () => {
    expect(autoProfile(undefined)).toBe('room');
  });
});

describe('persistence', () => {
  test('a persisted profile wins over auto-selection', () => {
    // The whole point: a host on a 1366px laptop who chose TV meant it.
    expect(loadProfile(fakeStorage({ 'engage.displayProfile': 'tv' }), 1366)).toBe('tv');
  });

  test('nothing persisted falls back to auto-selection', () => {
    expect(loadProfile(fakeStorage(), 1366)).toBe('table');
    expect(loadProfile(fakeStorage(), 1920)).toBe('room');
  });

  test('a junk value is ignored rather than trusted', () => {
    expect(loadProfile(fakeStorage({ 'engage.displayProfile': 'banana' }), 1920)).toBe('room');
  });

  test('saving round-trips', () => {
    const s = fakeStorage();
    saveProfile(s, 'call');
    expect(loadProfile(s, 1920)).toBe('call');
  });

  test('an unknown profile is never saved', () => {
    const s = fakeStorage();
    saveProfile(s, 'banana');
    expect(s.getItem('engage.displayProfile')).toBeNull();
  });

  // Safari in private mode throws on setItem. Losing the preference is
  // survivable; a white screen in front of a room is not.
  test('a throwing storage does not propagate', () => {
    const hostile = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(() => saveProfile(hostile, 'tv')).not.toThrow();
    expect(loadProfile(hostile, 1920)).toBe('room');
  });
});

/*
 * THE REMOTE'S BIG-SCREEN BUTTON, WHICH DID NOTHING FOR THE WHOLE OF THIS
 * MODULE'S EXISTENCE.
 *
 * This file replaced a `bigScreenMode` boolean with four profiles and its
 * header says so. GameHostPage's remote-command handler was not updated: it
 * kept calling `setBigScreenMode`, a binding that no longer existed, so
 * TOGGLE_BIG_SCREEN threw a ReferenceError and the projector never changed.
 * Nothing caught it — there is no ESLint in this project, and that handler sits
 * in the one file jsdom cannot mount. (`__tests__/undeclaredSetters.test.js`
 * now catches the class.)
 */
describe('toggling the big screen from the remote', () => {
  // rejects: a toggle that only goes one way, which is the same dead button
  //          with an extra step — the host presses it twice and the room is
  //          stuck on TV.
  test('it goes to TV and back again', () => {
    expect(toggleBigScreen('room', 1920)).toBe('tv');
    expect(toggleBigScreen('tv', 1920)).toBe('room');
  });

  // rejects: hardcoding 'room' as the way back. A host on a laptop who toggles
  //          TV on and off must land on `table`, not on a projector ladder that
  //          over-serves an eye three feet away.
  test('turning it off returns to what the viewport implies, not a constant', () => {
    expect(toggleBigScreen('tv', 1280)).toBe('table');
    expect(toggleBigScreen('tv', 1920)).toBe('room');
  });

  // rejects: cycling all four. Room and Call are undetectable in principle and
  //          are Console choices; a button that walks through them leaves the
  //          host pressing until the room looks right.
  test('it never lands on a profile the remote cannot mean', () => {
    for (const from of [...PROFILES, undefined, 'banana']) {
      expect(['tv', 'room', 'table']).toContain(toggleBigScreen(from, 1920));
    }
  });

  // rejects: returning something that is not a profile, which saveProfile would
  //          silently refuse to persist — losing the presentation state on the
  //          next reload, in front of a room.
  test('every result is a real profile', () => {
    for (const from of [...PROFILES, undefined, null, 'banana']) {
      expect(PROFILES).toContain(toggleBigScreen(from, 1920));
      expect(PROFILES).toContain(toggleBigScreen(from, NaN));
    }
  });
});
