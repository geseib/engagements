/**
 * A SET REFERENCE IS A PAIR — utils/setRef.js.
 *
 * `lambda-functions/game/tenant.js` says it plainly: a setId is a slug, and
 * `teamretro` names a DIFFERENT set in each of platform, org and public. Every
 * backend seam already carries the pair — `GET /question-sets` returns `scope`
 * beside `id`, `POST /games` accepts `questionSetScope`, and
 * schema-compliant-manager pins both onto the session.
 *
 * The frontend was the one place that collapsed it: the picker's `<option>`
 * carried `set.id` alone, so the scope was thrown away before the create body
 * was built, and the session defaulted to `platform` — where an org's set does
 * not exist. This module is the pair, encoded once, so it survives a `<select>`
 * (whose value can only be a string).
 */
import { DEFAULT_SCOPE, setRefKey, parseSetRefKey, sameSetRef } from '../utils/setRef';

describe('encoding a reference for a <select>', () => {
  test('carries both halves', () => {
    expect(setRefKey({ id: 'teamretro', scope: 'org' })).toBe('org:teamretro');
    expect(setRefKey({ id: 'teamretro', scope: 'public' })).toBe('public:teamretro');
  });

  /*
    A set that predates tenancy, or any row the backend answered without a
    scope, is a PLATFORM set — that is what create-game.js already assumes for
    a payload that says nothing, so the frontend must not invent a third answer.
  */
  // rejects: a missing scope encoding as "undefined:teamretro", which parses
  // back to a scope no partition has.
  test('a set with no scope is platform', () => {
    expect(setRefKey({ id: 'teamretro' })).toBe('platform:teamretro');
    expect(setRefKey({ id: 'teamretro', scope: '' })).toBe('platform:teamretro');
    expect(DEFAULT_SCOPE).toBe('platform');
  });

  test('the empty choice stays empty', () => {
    expect(setRefKey(null)).toBe('');
    expect(setRefKey({ id: '' })).toBe('');
  });
});

describe('decoding it back', () => {
  test('round-trips', () => {
    for (const ref of [
      { id: 'teamretro', scope: 'org' },
      { id: 'pricing', scope: 'platform' },
      { id: 'shared-icebreakers', scope: 'public' },
    ]) {
      expect(parseSetRefKey(setRefKey(ref))).toEqual(ref);
    }
  });

  /*
    A slug may contain a colon — nothing forbids it — and splitting on every
    colon would truncate the id. The scope is the FIRST segment and the id is
    everything after it.
  */
  // rejects: `key.split(':')` destructured into two, which turns
  // `org:a:b` into the id `a`.
  test('an id containing a colon survives', () => {
    expect(parseSetRefKey('org:weird:id')).toEqual({ id: 'weird:id', scope: 'org' });
  });

  // rejects: a bare id (an older stored value, or an edit seeded from a
  // session that pinned no scope) parsing to an empty id.
  test('a bare id with no scope reads as platform', () => {
    expect(parseSetRefKey('pricing')).toEqual({ id: 'pricing', scope: 'platform' });
  });

  test('empty in, empty out', () => {
    expect(parseSetRefKey('')).toEqual({ id: '', scope: 'platform' });
    expect(parseSetRefKey(undefined)).toEqual({ id: '', scope: 'platform' });
  });
});

describe('comparing two references', () => {
  // rejects: comparing by id alone — the bug this module exists for, one level
  // up. Two sets can share `teamretro` and be different sets.
  test('the same id in two scopes is not the same set', () => {
    expect(sameSetRef({ id: 'teamretro', scope: 'org' }, { id: 'teamretro', scope: 'platform' })).toBe(false);
  });

  test('an absent scope compares as platform on both sides', () => {
    expect(sameSetRef({ id: 'pricing' }, { id: 'pricing', scope: 'platform' })).toBe(true);
  });
});
