import { twoSurfacesOn, SURFACES_KEY } from '../config/surfaces';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
};

describe('twoSurfacesOn (two-surface D6)', () => {
  it('on in development for Call & Answer', () => {
    expect(twoSurfacesOn({ env: 'development', search: '', storage: memory(), gameType: 'call-and-answer' })).toBe(true);
  });
  it('off on test and prod', () => {
    for (const env of ['test', 'production', undefined]) {
      expect(twoSurfacesOn({ env, search: '', storage: memory(), gameType: 'call-and-answer' })).toBe(false);
    }
  });
  it('off for a type the Presentation does not cover yet, even when asked for', () => {
    for (const gameType of ['trivia', 'poll', 'survey', 'build-room', 'wavelength']) {
      expect(twoSurfacesOn({ env: 'development', search: '?surfaces=two', storage: memory(), gameType })).toBe(false);
    }
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
    expect(twoSurfacesOn({ env: 'development', search: '', storage: memory() })).toBe(true);
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
