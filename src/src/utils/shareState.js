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

export function shareStateOf(set, nowMs = Date.now()) {
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
    case 'published': {
      if (active && shared && active > shared) {
        return {
          key: 'behind',
          label: `Public, behind (v${active} not shared)`,
          title: `v${shared} is public; your v${active} has not been shared. Submit it for review to update the library.`,
        };
      }
      // A legacy unversioned set's share carries no version number
      // (set-version.js's versionList is [] for it) — say "Public", not the
      // trailing-v "Public v" that `.trim()` alone never removed.
      return { key: 'public', label: shared ? `Public v${shared}` : 'Public', title: 'In the public library. Anyone using Engage can read and copy it.' };
    }
    case 'checking': {
      const age = share.at ? nowMs - Date.parse(share.at) : 0;
      return age > STALE_CHECK_MS
        ? { key: 'unfinished', label: "Didn't finish", title: 'The content check did not finish. Submit it again.' }
        : { key: 'checking', label: 'Checking…', title: 'The content check is running.' };
    }
    case 'flagged':
      return { key: 'flagged', label: 'Needs changes', title: 'Not published. Open the set to see exactly what was flagged.' };
    case 'escalated':
    case 'appealed':
      return { key: 'waiting', label: 'Waiting for Engage', title: 'A person at Engage is looking at this version. The outcome will show here.' };
    case 'passed':
      return { key: 'passed', label: 'Checked', title: 'Passed the content check and not published.' };
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
