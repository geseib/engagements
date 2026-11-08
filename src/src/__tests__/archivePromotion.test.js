/**
 * PROMOTING A BATCH TO THE NEXT TIER — utils/archivePromotion.js and config/tierHosts.js.
 *
 * docs/design/archive-promotion/REVIEW.md, improvement 1. The link is the whole hand-over
 * between two tiers that share nothing but the archive, so it is pinned exactly: its host,
 * its path into Engage → Archive, the ids it carries, and that a sign-in on the target keeps it.
 *
 * rejects: a link to the retired eng.dev twin; a "next tier" after prod; ids that could smuggle
 * markup or another parameter into the address; a promotion that survives a reload; a Google
 * sign-in that drops the batch on the way back.
 */
import { TIER_HOSTS, nextTier, tierOrigin } from '../config/tierHosts';
import { promoteLink, readPromotion, withoutPromotion } from '../utils/archivePromotion';
import { rememberReturnPath, takeReturnPath, RETURN_KEY } from '../auth/returnPath';

describe('the tiers and where they live', () => {
  test('each tier names its own site, and never the retired eng.dev twin', () => {
    expect(TIER_HOSTS).toEqual({ dev: 'engage.dev.seibtribe.us', test: 'engage.test.seibtribe.us', prod: 'engage.seibtribe.us' });
    // Every tier host is an engage.* name; the retired twin's hosts start with "eng." alone.
    for (const host of Object.values(TIER_HOSTS)) expect(host.startsWith('engage.')).toBe(true);
    expect(tierOrigin('test')).toBe('https://engage.test.seibtribe.us');
    expect(tierOrigin('unknown')).toBe('');
  });
  test('work goes dev → test → prod, and no further', () => {
    expect([nextTier('dev'), nextTier('test'), nextTier('prod'), nextTier(''), nextTier('unknown')]).toEqual(['test', 'prod', '', '', '']);
  });
});

describe('the link', () => {
  test('opens the target tier in Engage → Archive with the batch and its origin', () => {
    expect(promoteLink('test', ['4ba6b81b-1', '15e385c8-2'], 'dev'))
      .toBe('https://engage.test.seibtribe.us/admin?section=archive&promote=4ba6b81b-1,15e385c8-2&from=dev');
    expect(promoteLink('prod', ['a'], 'test')).toBe('https://engage.seibtribe.us/admin?section=archive&promote=a&from=test');
  });
  test('drops duplicates and anything that is not an archive id, and is empty with nothing to carry', () => {
    expect(promoteLink('test', ['a', 'a', 'b&from=prod', '<x>', 'c'], 'dev')).toBe('https://engage.test.seibtribe.us/admin?section=archive&promote=a,c&from=dev');
    expect(promoteLink('test', [], 'dev')).toBe('');
    expect(promoteLink('nowhere', ['a'], 'dev')).toBe('');
  });
  test('an unknown origin is left off rather than guessed', () => {
    expect(promoteLink('test', ['a'], 'unknown')).toBe('https://engage.test.seibtribe.us/admin?section=archive&promote=a');
  });
});

describe('reading it back on the target', () => {
  test('reads the ids and the origin', () => {
    expect(readPromotion('?section=archive&promote=a,b&from=dev')).toEqual({ ids: ['a', 'b'], from: 'dev' });
  });
  test('is untrusted input: bad ids are dropped, an unknown origin is blank, nothing usable is null', () => {
    expect(readPromotion('?promote=a,%3Cscript%3E,,b,a&from=elsewhere')).toEqual({ ids: ['a', 'b'], from: '' });
    expect(readPromotion('?promote=%3Cx%3E')).toBeNull();
    expect(readPromotion('?section=archive')).toBeNull();
    expect(readPromotion('')).toBeNull();
  });
  test('the link it built reads back as the batch it was given', () => {
    const link = promoteLink('test', ['x-1', 'y-2'], 'dev');
    expect(readPromotion(new URL(link).search)).toEqual({ ids: ['x-1', 'y-2'], from: 'dev' });
  });
  test('once consumed it is stripped, and the section stays', () => {
    expect(withoutPromotion('https://engage.test.seibtribe.us/admin?section=archive&promote=a,b&from=dev')).toBe('/admin?section=archive');
  });
});

describe('a sign-in on the target keeps the batch', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => window.history.replaceState({}, '', '/'));

  test('a Google sign-in records the whole address, promotion included, and returns to it', () => {
    // ProtectedRoute renders the sign-in form in place on /admin, so the address bar still
    // carries the link when the Google button calls rememberReturnPath().
    window.history.replaceState({}, '', '/admin?section=archive&promote=a,b&from=dev');
    rememberReturnPath();
    expect(sessionStorage.getItem(RETURN_KEY)).toBe('/admin?section=archive&promote=a,b&from=dev');
    const back = takeReturnPath();
    expect(readPromotion(back.slice(back.indexOf('?')))).toEqual({ ids: ['a', 'b'], from: 'dev' });
  });
});
