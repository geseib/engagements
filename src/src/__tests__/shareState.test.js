import { shareStateOf, versionChip, STALE_CHECK_MS } from '../utils/shareState';

const NOW = Date.parse('2026-09-17T10:20:00.000Z');
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();

describe('shareStateOf — the "Who can see it" column', () => {
  test('no stamp is private', () => {
    expect(shareStateOf({}).key).toBe('private');
    expect(shareStateOf({ share: null }).label).toBe('Private');
  });
  test('a public-library row is visible to everyone, stamp or no stamp', () => {
    expect(shareStateOf({ scope: 'public' })).toMatchObject({ key: 'public', label: 'Public' });
    expect(shareStateOf({ scope: 'public' }).title).toMatch(/anyone using engage/i);
    // A row this org's own console never manages carries no share stamp at
    // all — the label must not depend on one being present.
    expect(shareStateOf({ scope: 'public', share: undefined })).toMatchObject({ key: 'public', label: 'Public' });
  });
  test("an Engage-library (platform-scope) row reads as Everyone's, not Private", () => {
    const s = shareStateOf({ scope: 'platform' });
    expect(s).toMatchObject({ key: 'public', label: 'Everyone' });
    expect(s.title).toMatch(/every organisation/i);
  });
  test('a published stamp with no recorded version says Public, not "Public v"', () => {
    // Minor #11 / the legacy-unversioned-set case: `shared` is falsy.
    expect(shareStateOf({ share: { status: 'published', version: null, at: at(60) } }).label).toBe('Public');
  });
  test('a published stamp at the active version is public, and names the version', () => {
    const s = shareStateOf({ activeVersion: 2, share: { status: 'published', version: 2, publicVersion: 1, at: at(60) } });
    expect(s).toMatchObject({ key: 'public', label: 'Public v2' });
  });
  test('a newer active version than the published one reads as behind, naming both', () => {
    const s = shareStateOf({ activeVersion: 3, share: { status: 'published', version: 2, at: at(60) } });
    expect(s.key).toBe('behind');
    expect(s.label).toBe('Public, behind (v3 not shared)');
    expect(s.title).toMatch(/v2 is public/);
  });
  test('checking is running inside fifteen minutes and unfinished after', () => {
    expect(shareStateOf({ share: { status: 'checking', version: 2, at: at(5) } }, NOW).key).toBe('checking');
    expect(shareStateOf({ share: { status: 'checking', version: 2, at: at(16) } }, NOW)).toMatchObject({ key: 'unfinished', label: "Didn't finish" });
    expect(STALE_CHECK_MS).toBe(15 * 60 * 1000);
  });
  test('flagged is needs changes; escalated and appealed are waiting for Engage; passed is checked', () => {
    expect(shareStateOf({ share: { status: 'flagged', version: 2 } }).label).toBe('Needs changes');
    expect(shareStateOf({ share: { status: 'escalated', version: 2 } }).label).toBe('Waiting for Engage');
    expect(shareStateOf({ share: { status: 'appealed', version: 2 } }).key).toBe('waiting');
    expect(shareStateOf({ share: { status: 'passed', version: 2 } }).label).toBe('Checked');
    expect(shareStateOf({ share: { status: 'unpublished' } }).key).toBe('private');
  });
});
describe('versionChip — the Versions panel', () => {
  test('a version that went public says so; the rest follow the review', () => {
    expect(versionChip({ review: 'passed', published: { publicVersion: 1 } })).toEqual({ key: 'public', label: 'public' });
    expect(versionChip({ review: 'flagged', published: null })).toEqual({ key: 'flagged', label: 'needs changes' });
    expect(versionChip({ review: 'checking', published: null, unfinished: false })).toEqual({ key: 'checking', label: 'checking…' });
    expect(versionChip({ review: 'checking', published: null, unfinished: true })).toEqual({ key: 'unfinished', label: "didn't finish" });
    expect(versionChip({ review: 'escalated', published: null })).toEqual({ key: 'waiting', label: 'waiting for Engage' });
    expect(versionChip({ review: 'unreviewed', published: null })).toEqual({ key: 'unshared', label: 'not shared' });
  });
});
