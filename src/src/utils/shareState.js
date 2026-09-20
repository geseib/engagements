/**
 * "WHO CAN SEE IT" — the one place the share stamp is turned into words.
 *
 * The stamp (`set.share`) is written by the server on every event of the
 * share lifecycle (lambda-functions/admin/shared/share-stamp.js). The list
 * reads it and nothing else, so the list does not become one read per version
 * per set. `STALE_CHECK_MS` mirrors set-review.js: a `checking` older than this
 * did not finish, and saying "checking…" for it would be an empty state that
 * lies.
 */
export const STALE_CHECK_MS = 15 * 60 * 1000;

const PRIVATE = { key: 'private', label: 'Private', title: 'Only your organisation can see this set.' };

/*
 * WHETHER THE READER HAS THE CONTROL THE WORDS NAME (`canShare`).
 *
 * Two of the hovers below tell somebody to press something: "Click Share to
 * share the latest version" and "Submit it again". Whether that button is on
 * the row is not a fact about the stamp — it is the caller's fact.
 * QuestionSetsPanel draws Share only when it was given `onShare` AND the server
 * said `canManage` for that row, and both halves fail routinely on the org
 * console: a host sees a colleague's set with `canManage: false`
 * (admin/shared/question-set-access.js — a host manages only what they created)
 * and gets Open, not Share, beside the very same amber chip.
 *
 * So the caller states it and this module still owns the words. The default is
 * the reader WITHOUT the exit, deliberately: an instruction that names a
 * control which is not there is the defect (design rule 2, and the reason the
 * dead "New set" button was removed); leaving the instruction off a reader who
 * happens to have the button costs them nothing but a sentence.
 */
export function shareStateOf(set, nowMs = Date.now(), { canShare = false } = {}) {
  /*
   * AN ENGAGE-LIBRARY OR PUBLIC-LIBRARY ROW IS THE PUBLISHED COPY ITSELF —
   * checked BEFORE the stamp is read, and regardless of whether one exists.
   * The org-console list also shows ORG -> PLATFORM -> PUBLIC rows
   * (get-question-sets.js; spec §0 readableScopes), and those rows carry no
   * `share` stamp of their own (the stamp lives on the ORG row that shared
   * FROM it) — so falling through to the stamp check below said "Private"
   * for a set every organisation can already read.
   */
  if (set && set.scope === 'public') {
    return { key: 'public', label: 'Public', title: 'In the public library. Anyone using Engage can read and copy it.' };
  }
  if (set && set.scope === 'platform') {
    return { key: 'public', label: 'Everyone', title: "Engage's shared library — every organisation can read and copy it." };
  }
  const share = set && set.share && typeof set.share === 'object' ? set.share : null;
  if (!share || !share.status) return PRIVATE;
  const active = Number(set.activeVersion) || null;
  const shared = Number(share.version) || null;
  switch (share.status) {
    /*
     * SHARED IS WHAT YOU DID; PUBLIC IS WHAT IT IS.
     *
     * Reported by the owner: *"right now the tag is the same for your question
     * set that was shared publicly and the copy that is public. they both are
     * marked public."* They are two ROWS of the same list — the org console
     * reads ORG, PLATFORM and PUBLIC scopes together (get-question-sets.js,
     * spec §0 readableScopes) — and they are not the same object. The public
     * row is a separate set with its own id, which this organisation can only
     * copy; THIS row is theirs, and editing and re-sharing it is the whole
     * point of the word.
     *
     * Only this branch changed. The public-library and Engage-library rows are
     * caught above, before the stamp is read at all, and keep their words.
     */
    case 'published': {
      /*
       * THE THIRD STATE, AND WHERE BOTH NUMBERS COME FROM.
       *
       * `set.activeVersion` is the set's own current version and
       * `share.version` is the version the stamp recorded going out — written
       * together by admin/shared/share-stamp.js beside publicSetId and
       * publicVersion, and both already on the row get-question-sets.js
       * projects. Nothing extra is read to know this.
       *
       * `publicVersion` is deliberately NOT the comparison: it counts the
       * public copy's own revisions, which start at 1 and have no relation to
       * the source set's numbering.
       */
      if (active && shared && active > shared) {
        return {
          key: 'behind',
          label: `Shared v${shared}, yours is v${active}`,
          // The owner's own words where the exit exists, and the same fact with
          // nothing to press where it does not — see `canShare` above.
          title: canShare
            ? 'An older version is shared. Click Share to share the latest version.'
            : 'An older version is shared. The latest version has not been shared.',
        };
      }
      // A legacy unversioned set's share carries no version number
      // (set-version.js's versionList is [] for it) — say "Shared", not the
      // trailing-v "Shared v" that `.trim()` alone never removed.
      return {
        key: 'shared',
        label: shared ? `Shared v${shared}` : 'Shared',
        title: 'The public library has a copy of this set. Anyone using Engage can read and copy it.',
      };
    }
    /*
     * EVERY STATUS BELOW SPEAKS OF THE VERSION, NEVER OF THE LIBRARY.
     *
     * A re-share does not withdraw what is already out there. Pressing Share on
     * v3 of a set whose v2 is published replaces the whole stamp with
     * `{version: 3, status: 'checking', jobId}` (check-question-set.js:153 —
     * the map is REPLACED, never merged, and no non-published writer carries
     * `publicSetId` forward), while the v2 copy goes on being served: publishing
     * happens only on a pass (set-check-worker.js:374), and nothing here
     * unpublishes. The same is true through a refusal and through an appeal.
     *
     * So these rows said "Not published." and "…and not published" about sets
     * every organisation could read. This row cannot know whether a copy is
     * live — the pointer is gone from the stamp, and get-question-sets.js
     * projects the public row's sourceOrgId but not its sourceSetId, so there
     * is nothing to match against either. A state that cannot know must not
     * claim, in either direction.
     */
    case 'checking': {
      const age = share.at ? nowMs - Date.parse(share.at) : 0;
      return age > STALE_CHECK_MS
        ? { key: 'unfinished', label: "Didn't finish", title: `The content check did not finish.${canShare ? ' Submit it again.' : ''}` }
        : { key: 'checking', label: 'Checking…', title: 'The content check is running on this version. Whatever the library is serving is unchanged until it finishes.' };
    }
    case 'flagged':
      // Two real situations wear this stamp: a version the check or a reviewer
      // refused (an earlier one may still be in the library), and a takedown
      // (public-library-item.js:217, on a version that WAS published). The one
      // sentence true of both is where the reason is written down.
      return { key: 'flagged', label: 'Needs changes', title: 'Open the set to see exactly what was flagged.' };
    case 'escalated':
    case 'appealed':
      return { key: 'waiting', label: 'Waiting for Engage', title: 'A person at Engage is looking at this version. The outcome will show here.' };
    case 'passed':
      // Safe to say of the version and only of the version: one that had been
      // published would carry `published`, not this.
      return { key: 'passed', label: 'Checked', title: 'This version passed the content check and has not been published.' };
    default:
      return PRIVATE;
  }
}

/**
 * The chip beside a version in the editor's Versions panel.
 *
 * `scope` is the library the SET is in, and only `platform` changes anything.
 * The words below are a SHARE's vocabulary — "needs changes" is a submission
 * that was not published, "waiting for Engage" is one a person is deciding
 * about, "not shared" is one nobody sent. None of those is true of Engage's own
 * set: it never shares, it is already served to every organisation, and a check
 * of it (check-question-set.js `checkPlatformSet`) publishes and unpublishes
 * nothing. `shareStateOf` above already has this branch — it says "Everyone" —
 * so the list row was honest while this chip was not.
 */
export function versionChip(entry, scope = '') {
  if (scope === 'platform') {
    switch (entry && entry.review) {
      case 'flagged': return { key: 'flagged', label: 'check flagged it' };
      case 'checking': return entry.unfinished ? { key: 'unfinished', label: "didn't finish" } : { key: 'checking', label: 'checking…' };
      case 'escalated':
      case 'appealed': return { key: 'waiting', label: 'with a person' };
      case 'passed': return { key: 'passed', label: 'checked' };
      // Engage's own sets were never checked at all until now, so "not
      // checked" is the honest word — not "not shared", which invites the
      // reader to go and share a set that is already served to everybody.
      default: return { key: 'unshared', label: 'not checked' };
    }
  }
  if (entry && entry.published) return { key: 'public', label: 'public' };
  switch (entry && entry.review) {
    case 'flagged': return { key: 'flagged', label: 'needs changes' };
    case 'checking': return entry.unfinished ? { key: 'unfinished', label: "didn't finish" } : { key: 'checking', label: 'checking…' };
    case 'escalated':
    case 'appealed': return { key: 'waiting', label: 'waiting for Engage' };
    case 'passed': return { key: 'passed', label: 'checked' };
    default: return { key: 'unshared', label: 'not shared' };
  }
}
