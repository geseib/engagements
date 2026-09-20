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
    const s = shareStateOf({ activeVersion: 3, share: { status: 'published', version: 2, at: at(60) } }, NOW, { canShare: true });
    expect(s.title).toBe('An older version is shared. Click Share to share the latest version.');
  });
  /*
    …FOR THE READER WHO HAS THAT BUTTON, AND ONLY THEM.

    The sentence names a control, and whether the control is on the row is the
    CALLER's fact, not the stamp's: QuestionSetsPanel draws Share only when it
    was given `onShare` and the server said `canManage` for that row, and a host
    reading a colleague's set gets neither (question-set-access.js). So the
    caller states it and this module chooses the words; the default is the
    reader WITHOUT the exit, because inventing a control is the failure and
    omitting an instruction is not.
  */
  test('a reader with no Share on that row gets the same fact and no instruction they cannot follow', () => {
    const drifted = { activeVersion: 3, share: { status: 'published', version: 2, at: at(60) } };
    const s = shareStateOf(drifted, NOW);
    expect(s.key).toBe('behind');
    expect(s.label).toBe('Shared v2, yours is v3');
    expect(s.title).toMatch(/an older version is shared/i);
    expect(s.title).not.toMatch(/click share/i);
  });
  test('the same rule for the check that did not finish, whose hover says to submit it again', () => {
    // "Submit it again" is the same instruction naming the same control.
    const stale = { share: { status: 'checking', version: 2, at: at(16) } };
    expect(shareStateOf(stale, NOW, { canShare: true }).title).toMatch(/submit it again/i);
    expect(shareStateOf(stale, NOW).title).toMatch(/did not finish/i);
    expect(shareStateOf(stale, NOW).title).not.toMatch(/submit it again/i);
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
  /*
    THE TAG AFTER A FAILED OR IN-FLIGHT RE-SHARE, WHICH WAS THE LIE.

    The stamp is REPLACED, never merged (shared/share-stamp.js: "Each writer
    knows the whole truth of the moment it writes"), and not one of the writers
    for a non-published status carries `publicSetId` forward —
    check-question-set.js:153 writes `{version, status:'checking', jobId}`,
    set-check-worker.js:384 `{version, status, contentHash, jobId}`,
    appeal-question-set.js:124 `{version, status:'appealed', contentHash}`.

    So: share v2 (published, live in the library) → edit → press Share on v3 →
    the stamp is now `checking` on v3, and NOTHING removed the v2 copy. The
    library is still serving it through the check, through a refusal, through an
    appeal — publishing only ever happens on a pass (set-check-worker.js:374).
    The row said "Not published." about a set every organisation could read.

    What this row cannot know is whether a copy is live: the pointer is gone
    from the stamp and `get-question-sets.js` projects the public row's
    `sourceOrgName`/`sourceOrgId` but not its `sourceSetId`, so there is nothing
    to match on either. A state that cannot know must not claim. Each of these
    says what is true OF THE VERSION and asserts nothing about the library.
  */
  describe('a set whose public copy is still being served does not read as though it is not', () => {
    /* Every status shared/share-stamp.js will write (SHARE_STATUSES). */
    const EVERY_STATUS = ['checking', 'passed', 'published', 'flagged', 'escalated', 'appealed', 'unpublished'];
    test.each(EVERY_STATUS)('%s says nothing about the set being absent from the library', (status) => {
      const s = shareStateOf({ activeVersion: 2, share: { status, version: 2, at: at(1) } }, NOW);
      expect(s.key).toBeTruthy();
      expect(s.title).toMatch(/\S/);
      // rejects: the two sentences that used to be here — "Not published. Open
      // the set…" on a refusal and "…and not published" on a pass — either of
      // which is false while an earlier version is still in the library.
      expect(s.title).not.toMatch(/\bnot published\b/i);
      expect(s.title).not.toMatch(/\bnot in the (public )?library\b/i);
    });
    test('a refusal names the exit and drops the claim it could not make', () => {
      const s = shareStateOf({ share: { status: 'flagged', version: 3 } }, NOW);
      expect(s.label).toBe('Needs changes');
      expect(s.title).toBe('Open the set to see exactly what was flagged.');
    });
    test('a pass says of THE VERSION that it has not gone out', () => {
      // True in every case: a version that had been published would carry the
      // `published` status, not this one.
      const s = shareStateOf({ share: { status: 'passed', version: 3 } }, NOW);
      expect(s.label).toBe('Checked');
      expect(s.title).toMatch(/this version/i);
      expect(s.title).toMatch(/has not been published/i);
    });
    test('a check in flight says what it will and will not disturb', () => {
      const s = shareStateOf({ activeVersion: 3, share: { status: 'checking', version: 3, at: at(2) } }, NOW);
      expect(s.label).toBe('Checking…');
      expect(s.title).toMatch(/this version/i);
      // Publishing happens only on a pass, so whatever the library has now, it
      // keeps until then — which is the fact the old words contradicted.
      expect(s.title).toMatch(/until it finishes/i);
    });
    test('and an appeal still speaks only of the version a person is holding', () => {
      expect(shareStateOf({ share: { status: 'appealed', version: 3 } }, NOW).title).toMatch(/this version/i);
    });
    test('an unpublished stamp is the one that DOES know: the copy was removed first', () => {
      // publish-question-set.js:189 writes it after unpublishSet has removed the
      // rows, so "only your organisation can see this" is true there.
      expect(shareStateOf({ share: { status: 'unpublished' } }, NOW)).toMatchObject({ key: 'private', label: 'Private' });
    });
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
  /*
    THE RESERVED WORD, ONE SCREEN DEEPER.

    The owner's complaint was that one word meant two things: the set THEY
    shared and the library's COPY of it both read "public". The list row was
    split into "Shared v2" and "Public" — and this chip, reached by pressing
    Edit on that very row, went on labelling the organisation's own version
    "public". It is the same object as the row that now says "Shared v2", so it
    is the same collision, one click along.

    The KEY stays `public` deliberately: in this module the key is the style
    bucket rather than the word — `shareStateOf` returns key `public` for the
    label "Everyone" too — and it is what `.qs-version-chip--public` and the
    editor's hover read. That hover, "Public as orgacme-x v1", is the reserved
    word used correctly: it names the library's copy, by its id.
  */
  test("the version that went out says what you did, and leaves 'public' to the library's copy", () => {
    const chip = versionChip({ review: 'passed', published: { publicSetId: 'orgacme-x', publicVersion: 1 } });
    expect(chip.label).toBe('shared');
    expect(chip.label).not.toMatch(/public/i);
    expect(chip.key).toBe('public');
    // …and its opposite still reads as its opposite.
    expect(versionChip({ review: 'unreviewed', published: null }).label).toBe('not shared');
  });
  test('a version that went public says so; the rest follow the review', () => {
    expect(versionChip({ review: 'passed', published: { publicVersion: 1 } })).toEqual({ key: 'public', label: 'shared' });
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
