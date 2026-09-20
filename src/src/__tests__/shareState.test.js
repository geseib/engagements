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
  /*
    THREE THINGS, THREE WORDS — the owner's second report: *"right now the tag
    is the same for your question set that was shared publicly and the copy
    that is public. they both are marked public."*

    They are on the same screen at the same time: the org console's list carries
    ORG, PLATFORM and PUBLIC rows (get-question-sets.js readableScopes), so the
    set you shared and the copy that went public are two rows, and both said
    "Public". They are not the same thing and they do not have the same exits —
    one you can edit and re-share, the other you can only copy.

    SHARED is what you did. PUBLIC is what it is.
  */
  test("an organisation's own published set says what you did — Shared — not what the public copy is", () => {
    const s = shareStateOf({ activeVersion: 2, share: { status: 'published', version: 2, publicVersion: 1, at: at(60) } });
    expect(s).toMatchObject({ key: 'shared', label: 'Shared v2' });
    expect(s.label).not.toMatch(/^Public/);
    // And the hover says whose copy is out there, which is the distinction.
    expect(s.title).toMatch(/copy of this set/i);
  });
  test('a published stamp with no recorded version still says Shared, not "Shared v"', () => {
    // Minor #11 / the legacy-unversioned-set case: `shared` is falsy.
    expect(shareStateOf({ share: { status: 'published', version: null, at: at(60) } }).label).toBe('Shared');
  });
  test('the public library\'s own copy keeps the word for what it IS', () => {
    expect(shareStateOf({ scope: 'public' })).toMatchObject({ key: 'public', label: 'Public' });
  });
  /*
    THE THIRD STATE, which the owner asked for by name: *"if the version has
    been updated locally and not publicly, we make it yellow or something
    shared(!) and when you hover over tag it will say older version is shared.
    click share to share the latest version."*

    Both numbers come off the row `admin/get-question-sets.js` already projects:
    `activeVersion` (the set's own current version) and `share.version` (the
    version the share stamp recorded going out — shared/share-stamp.js writes it
    beside publicSetId and publicVersion). No extra read.
  */
  test('a set that has moved on since the shared version warns, and names both versions', () => {
    const s = shareStateOf({ activeVersion: 3, share: { status: 'published', version: 2, publicSetId: 'orgacme-x', publicVersion: 1, at: at(60) } });
    expect(s.key).toBe('behind');
    expect(s.label).toBe('Shared v2, yours is v3');
  });
  test('and its hover is the sentence that says which button fixes it', () => {
    const s = shareStateOf({ activeVersion: 3, share: { status: 'published', version: 2, at: at(60) } });
    expect(s.title).toBe('An older version is shared. Click Share to share the latest version.');
  });
  test('the three states are three different keys, so one style cannot paint two of them', () => {
    const ours = shareStateOf({ activeVersion: 2, share: { status: 'published', version: 2, at: at(60) } }).key;
    const theirs = shareStateOf({ scope: 'public' }).key;
    const stale = shareStateOf({ activeVersion: 3, share: { status: 'published', version: 2, at: at(60) } }).key;
    expect(new Set([ours, theirs, stale]).size).toBe(3);
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

/*
  ENGAGE'S OWN LIBRARY NEVER SHARES, so none of the words above is true of it.
  `shareStateOf` has had this branch since tenancy — it says "Everyone" — and
  the chip did not, so a checked platform set was labelled "needs changes" and
  "waiting for Engage" in the one panel staff use to look at it.
*/
describe('versionChip — Engage\'s own set', () => {
  test('a platform set is never labelled with a share word', () => {
    expect(versionChip({ review: 'flagged', published: null }, 'platform')).toEqual({ key: 'flagged', label: 'check flagged it' });
    expect(versionChip({ review: 'escalated', published: null }, 'platform')).toEqual({ key: 'waiting', label: 'with a person' });
    expect(versionChip({ review: 'appealed', published: null }, 'platform').label).toBe('with a person');
    expect(versionChip({ review: 'passed', published: null }, 'platform')).toEqual({ key: 'passed', label: 'checked' });
    // "not shared" invites the reader to go and share a set every organisation
    // already reads. Nothing checked Engage's sets until now, so this is the
    // label most of the shared library wears.
    expect(versionChip({ review: 'unreviewed', published: null }, 'platform')).toEqual({ key: 'unshared', label: 'not checked' });
  });
  test('the check states keep their own words, which are not share words', () => {
    expect(versionChip({ review: 'checking', unfinished: false }, 'platform')).toEqual({ key: 'checking', label: 'checking…' });
    expect(versionChip({ review: 'checking', unfinished: true }, 'platform')).toEqual({ key: 'unfinished', label: "didn't finish" });
  });
  test('an organisation\'s own set is unchanged by the new argument', () => {
    expect(versionChip({ review: 'flagged', published: null })).toEqual(versionChip({ review: 'flagged', published: null }, ''));
    expect(versionChip({ review: 'flagged', published: null }, 'org').label).toBe('needs changes');
  });
});
