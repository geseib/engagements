import { twoSurfacesOn, SURFACES_KEY } from '../config/surfaces';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
};

describe('twoSurfacesOn (two-surface D6)', () => {
  // NO TIER DEFAULT (session-start F6, experience plan 2b): with nothing
  // stored, every tier is one screen while Setup's step 1 asks.
  it('nothing stored: off on every tier, dev included (Setup asks)', () => {
    for (const env of ['development', 'test', 'production', undefined]) {
      expect(twoSurfacesOn({ env, search: '', storage: memory(), gameType: 'call-and-answer' })).toBe(false);
    }
  });
  it('off for a type the Presentation does not cover yet, even when asked for', () => {
    for (const gameType of ['survey', 'build-room', 'wavelength']) {
      expect(twoSurfacesOn({ env: 'development', search: '?surfaces=two', storage: memory(), gameType })).toBe(false);
    }
  });
  // Experience plan 2g (§7 decision 10): the room's window covers Trivia and Poll.
  it('Trivia and Poll can use two screens, off until chosen as Call & Answer', () => {
    for (const gameType of ['trivia', 'poll']) {
      expect(twoSurfacesOn({ env: 'test', search: '?surfaces=two', storage: memory(), gameType })).toBe(true);
      expect(twoSurfacesOn({ env: 'development', search: '', storage: memory(), gameType })).toBe(false);
    }
  });
});

describe('one screen only, said with the reason (decision 10 fallback)', () => {
  // eslint-disable-next-line global-require
  const { oneScreenWhy, TWO_SURFACE_TYPES, CONSOLE_TYPES } = require('../config/surfaces');
  it('the lists: two screens and the console', () => {
    expect(TWO_SURFACE_TYPES).toEqual(['call-and-answer', 'build', 'trivia', 'poll']);
    expect(CONSOLE_TYPES).toEqual(['call-and-answer', 'trivia', 'poll']);
  });
  it('Wavelength says why; a two-screen type says nothing', () => {
    expect(oneScreenWhy('wavelength')).toMatch(/one screen for now/);
    expect(oneScreenWhy('wavelength')).toMatch(/Write and Reveal/);
    ['call-and-answer', 'trivia', 'poll', 'build'].forEach((t) => expect(oneScreenWhy(t)).toBe(''));
  });
  it('?surfaces=two turns it on anywhere and is remembered; ?surfaces=classic turns it off', () => {
    const storage = memory();
    expect(twoSurfacesOn({ env: 'test', search: '?surfaces=two', storage, gameType: 'call-and-answer' })).toBe(true);
    expect(storage.getItem(SURFACES_KEY)).toBe('two');
    expect(twoSurfacesOn({ env: 'test', search: '', storage, gameType: 'call-and-answer' })).toBe(true);
    expect(twoSurfacesOn({ env: 'development', search: '?surfaces=classic', storage, gameType: 'call-and-answer' })).toBe(false);
    expect(twoSurfacesOn({ env: 'development', search: '', storage, gameType: 'call-and-answer' })).toBe(false);
  });
  it('a storage that throws never breaks the page', () => {
    const bad = { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); } };
    expect(twoSurfacesOn({ env: 'development', search: '?surfaces=two', storage: bad, gameType: 'call-and-answer' })).toBe(true);
    expect(twoSurfacesOn({ env: 'test', search: '', storage: bad, gameType: 'call-and-answer' })).toBe(false);
  });
  it('a missing game type reads as Call & Answer (the default type)', () => {
    expect(twoSurfacesOn({ env: 'test', search: '?surfaces=two', storage: memory() })).toBe(true);
  });
});

describe('presentHref: the room\'s window', () => {
  // eslint-disable-next-line global-require
  const { presentHref: href } = require('../config/surfaces');
  it('the Presentation for a session', () => {
    expect(href('5479')).toBe('/present?gameId=5479');
  });
  it('the Build Room wall carries its type and the wall key', () => {
    expect(href('4821', { type: 'build', k: 'ab_C-9/+' })).toBe('/present?gameId=4821&type=build&k=ab_C-9%2F%2B');
  });
  it('another type is the plain Presentation', () => {
    expect(href('4821', { type: 'poll', k: 'x' })).toBe('/present?gameId=4821');
  });
});
