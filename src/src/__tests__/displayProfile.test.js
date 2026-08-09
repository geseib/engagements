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
  profileClass, autoProfile, loadProfile, saveProfile,
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
