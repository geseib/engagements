/**
 * WHETHER A VERSION HAS BEEN CHECKED, AND WHERE IT WENT IF IT WAS SHARED.
 *
 * The owner: *"the tagging should be per version, and the checks/moderations
 * have to be per version as well."* The property that request is really about,
 * in one sentence: **an approval of v2 must never be readable as an approval of
 * v3.** Everything in this module serves that.
 *
 * ── WHY A ROW, AND NOT A FIELD ON `versions[]` ────────────────────────────
 *
 * The array on the set's metadata row is the obvious home, and it is unsafe.
 * `delete-set-version.js:159` rewrites the WHOLE array (`SET #versions =
 * :versions`) from a copy read earlier, guarded only on `activeVersion`, and
 * removing an element SHIFTS every later index. So a worker that resolved "v3
 * is `versions[2]`" before a concurrent delete would afterwards stamp
 * `versions[2].review = passed` onto a DIFFERENT VERSION.
 *
 * That is an approval laundering a later edit — precisely the defect
 * per-version state exists to prevent, reintroduced by the storage shape chosen
 * to prevent it. Found in agent review of the design, before any of this was
 * written.
 *
 * A row keyed by the version NUMBER cannot shift, has one writer, and sits in
 * the same partition as the content it describes — so it is deleted with that
 * content rather than outliving it as an orphan approval.
 *
 *   PK = <scope>SET#<id>#v<n>   SK = 'REVIEW'      the check's outcome
 *   PK = <scope>SET#<id>#v<n>   SK = 'PUBLISHED'   where a share put it
 *
 * ── THE FOUR OUTCOMES ARE THE MOCKUPS', NOT AN INVENTION ──────────────────
 *
 * `docs/design/tenancy-redesign/05-share-review.html` promises three — pass,
 * flagged, and "if the check is unsure, it goes to a person at Engage" — and
 * `06-share-rejected.html` adds the fourth with its "Ask for a human review"
 * button. A pass/fail enum can express neither the escalation nor the appeal.
 *
 * ONLY `passed` MAY PUBLISH. `escalated` blocks: `11-moderation.html` is a
 * queue of "sets the automated check would not decide on its own … Waiting for
 * a person", not a notification.
 *
 * ── ADMIN-ONLY, DELIBERATELY ──────────────────────────────────────────────
 *
 * `tenant.js` and `set-version.js` are triplicated across the game, websocket
 * and admin bundles because runtime readers need them. Nothing at RUNTIME reads
 * review state — a session plays a set that was already resolved — so this
 * lives in one place. If a game handler ever needs it, copy it and add it to
 * the drift check in tests/set-versioning-flow.js rather than reaching across
 * bundles.
 */
const { GetCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { setPartition } = require('./set-version');

/** The state machine. `UNREVIEWED` is the absence of a row, never a stored value. */
const STATUS = Object.freeze({
  UNREVIEWED: 'unreviewed',
  CHECKING: 'checking',
  PASSED: 'passed',
  FLAGGED: 'flagged',
  ESCALATED: 'escalated',
  APPEALED: 'appealed',
});

const WRITABLE = Object.freeze(
  Object.values(STATUS).filter((s) => s !== STATUS.UNREVIEWED),
);

/**
 * The review row's key for one version of one set.
 *
 * `setPartition` handles the legacy case: a set that has never been versioned
 * resolves to a partition with no `#v` suffix, which is a DIFFERENT key from
 * v1's. That matters — an unversioned set is not version one, and conflating
 * them would let a check of one answer for the other.
 */
const reviewKey = (ref, version) => ({ PK: setPartition(ref, version), SK: 'REVIEW' });

/** Where a share put this version. Sibling row, same partition. */
const publishedKey = (ref, version) => ({ PK: setPartition(ref, version), SK: 'PUBLISHED' });

/**
 * The review state of one version. **Never null** — a version with no row reads
 * as `unreviewed`, because that is what it is, and because a caller forced to
 * distinguish "absent" from "not checked" will eventually get it wrong in the
 * permissive direction.
 */
async function readReview(db, tableName, ref, version) {
  const res = await db.send(new GetCommand({
    TableName: tableName,
    Key: reviewKey(ref, version),
  }));
  if (!res || !res.Item) return { version, status: STATUS.UNREVIEWED };
  return { ...res.Item, version, status: res.Item.status || STATUS.UNREVIEWED };
}

/**
 * Record an outcome. Refuses a status the state machine does not define, rather
 * than storing it — every reader would otherwise have to defend against a value
 * that should not exist.
 */
async function writeReview(db, tableName, ref, version, { status, jobId, findings, note } = {}) {
  if (!WRITABLE.includes(status)) {
    throw new Error(`set-review: refusing to write status ${JSON.stringify(status)}`);
  }
  const item = {
    ...reviewKey(ref, version),
    version: version === null || version === undefined ? null : version,
    status,
    checkedAt: new Date().toISOString(),
    ...(jobId ? { jobId } : {}),
    ...(note ? { note } : {}),
    ...(Array.isArray(findings) ? { findings } : {}),
  };
  await db.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

/**
 * Every version's state, for the version list.
 *
 * One Query per version partition would be N round trips; these are separate
 * PARTITIONS (the version is in the PK), so there is no single Query that spans
 * them and no BatchGet saving worth the complexity at this size — a set with
 * forty versions is not a thing. Gaps default, so the caller gets an answer for
 * every version it asked about.
 */
async function readReviews(db, tableName, ref, versions = []) {
  const out = new Map();
  for (const v of versions) {
    out.set(v, await readReview(db, tableName, ref, v)); // eslint-disable-line no-await-in-loop
  }
  return out;
}

/**
 * May this version be published?
 *
 * Written as a positive test against ONE value rather than a list of blockers:
 * a new status added later is refused by default, which is the safe direction
 * for a gate whose job is keeping unreviewed content out of a public library.
 */
const mayPublish = (review) => Boolean(review) && review.status === STATUS.PASSED;

module.exports = {
  STATUS,
  WRITABLE,
  reviewKey,
  publishedKey,
  readReview,
  writeReview,
  readReviews,
  mayPublish,
  QueryCommand, // re-exported so callers need not import the SDK for a scan
};
