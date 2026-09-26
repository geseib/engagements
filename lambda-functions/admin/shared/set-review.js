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
const { GetCommand, PutCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { setPartition } = require('./set-version');
// Only for the one subject name `writeReview`'s cap must never drop — see
// OBSERVED_CAP's own comment. No cycle: content-guardrail.js requires nothing
// from this file.
const { SET_SUBJECT } = require('./content-guardrail');

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
 * Facts a check or a decision may record beside the status. A WHITELIST, so a
 * caller's bag cannot rename the row's keys or its version — `writeReview`'s
 * fourth argument used to be destructured field-by-field, which had the same
 * effect by accident; naming the list explicitly means the next fact a worker
 * or a staff decision needs to record (spec: `snapshotKey`, `reasons`,
 * `checkedBy`, `promptDropped`, `declaredNotice`) is one entry here, not a
 * silent drop discovered by a review that went looking for it. `reviewer`,
 * `decidedAt` and `notice` were added for the staff decision (Stage 2 Task 4,
 * moderation-decide.js) — the review row's own vocabulary for who decided,
 * when, and which content notices they attached.
 *
 * `tally` and `observed` are what the check MEASURED, beside what it decided
 * (content-guardrail.js `tallyOf`, and every band it saw): the score card's
 * data. `findings` keeps its meaning — only what intervened — so nothing that
 * reads findings sees a near-miss. A row without a tally was checked before
 * measuring existed; nothing back-fills one.
 *
 * `observedTruncated` says whether `writeReview` had to cut `observed` down to
 * `OBSERVED_CAP` (below) to keep the row inside DynamoDB's 400 KB item limit —
 * see the cap's own comment for why a large set can reach it. Absent, never
 * `false`, on a row whose list needed no cutting.
 *
 * `topicSuggestion` is the shelf the check would have filed the set on
 * (shared/topic-suggestion.js) — a RECOMMENDATION, on the row so a surface can
 * offer it. It decides nothing here either: the status above is computed
 * without reading it, and the set's own `topic` is never written by a check.
 */
const REVIEW_FIELDS = Object.freeze([
  'jobId', 'note', 'findings', 'contentHash', 'snapshotKey', 'reasons', 'checkedBy', 'promptDropped', 'declaredNotice',
  'reviewer', 'decidedAt', 'notice',
  'tally', 'observed', 'observedTruncated',
  'topicSuggestion',
]);

/**
 * THE CEILING ON HOW MANY OBSERVATIONS A REVIEW ROW STORES.
 *
 * Every request to the guardrail asks for `outputScope: 'FULL'`
 * (content-guardrail.js), so a check returns a band for every judged category
 * on every question, and `finding-explanations.js` adds up to a
 * 240-character explanation to each one it can reach. A few hundred questions
 * is enough for `observed` alone to pass DynamoDB's 400 KB item limit before
 * `findings`, `tally`, the snapshot key or anything else on the row is even
 * counted.
 *
 * The TALLY is computed from the FULL list, before this cap ever runs
 * (content-guardrail.js `tallyOf`, called in set-check-worker.js on the
 * un-truncated `observed` array) — so a row capped here still tells the truth
 * about what every category saw; only the per-item detail underneath it is
 * cut, and `observedTruncated` says so.
 *
 * THE CUT NEVER TOUCHES `(set)` — set-check-worker.js appends the set's own
 * text LAST (`observed = [...result.observed, ...setResult.observed]`), so a
 * blind prefix cut drops it FIRST on any large set: `reviewMeasurement.js`'s
 * `setTextClean` reads `observed` for exactly that subject, and a set whose
 * own title or description held a LOW/MEDIUM would then read "all clean in
 * every category" on the score card — the opposite of what the check saw.
 * `(set)` has at most one row per judged category (five, at most) whatever the
 * question count, so keeping every one of them and capping only the
 * per-question entries to fill what room remains never meaningfully shrinks
 * the cap.
 */
const OBSERVED_CAP = 300;

/**
 * WHAT A PERSON DECIDED, as opposed to what a check measured.
 *
 * A staff re-check of a version the public library already serves must not
 * erase the decision that put it there: `writeReview` replaces the row from the
 * whitelist above, so an approval's `reviewer`, `decidedAt` and `notice` would
 * simply be gone, and with them the evidence that a human looked.
 *
 * `note` travels with them, and ONLY with them. After a decision the note is
 * the reviewer's own sentence ("Historical, not gratuitous."); without one it is
 * the previous CHECK's count ("11/11 clean"), which a new check is entitled to
 * replace. So a row with no `reviewer` carries nothing forward.
 */
const DECISION_FIELDS = Object.freeze(['reviewer', 'decidedAt', 'notice', 'note']);
function decisionOf(review) {
  if (!review || !review.reviewer) return {};
  return Object.fromEntries(
    DECISION_FIELDS.filter((f) => review[f] !== undefined && review[f] !== null).map((f) => [f, review[f]]),
  );
}

/**
 * WHAT THE AUTHOR DECLARED — neither a check's measurement nor a reviewer's
 * decision, and the one fact on this row that no check can re-derive: the
 * content says nothing about the notice its author chose to declare about it.
 * So it rides across the lock beside `decisionOf`, and a re-check that did not
 * carry it would erase it for good — taking the score card's account of why a
 * person was ever in this set's history with it.
 *
 * Unlike a decision this is NOT gated on a reviewer: the declaration is the
 * author's own, whether or not anybody has ruled on it yet.
 */
function declarationOf(review) {
  const list = review && Array.isArray(review.declaredNotice) ? review.declaredNotice : [];
  return list.length ? { declaredNotice: list } : {};
}

/**
 * Record an outcome. Refuses a status the state machine does not define, rather
 * than storing it — every reader would otherwise have to defend against a value
 * that should not exist.
 */
async function writeReview(db, tableName, ref, version, { status, ...facts } = {}) {
  if (!WRITABLE.includes(status)) {
    throw new Error(`set-review: refusing to write status ${JSON.stringify(status)}`);
  }
  // findings keeps its old rule — written only when it actually is an array —
  // rather than the generic "present and not null" the rest of the whitelist
  // uses. observed is a list the score card walks, so it takes the same rule,
  // and is additionally capped at OBSERVED_CAP items (see that constant's own
  // comment): the TALLY above already measured the full list the caller
  // passed in, so cutting the per-item detail here loses nothing a reader
  // depends on for its counts, only the entries themselves.
  const observedList = Array.isArray(facts.observed) ? facts.observed : undefined;
  let observedStored = observedList;
  let observedTruncated = false;
  if (observedList && observedList.length > OBSERVED_CAP) {
    // Every `(set)`-subject row survives the cut (OBSERVED_CAP's own comment
    // says why); only the per-question rows are trimmed, to fill whatever room
    // is left. `.filter` preserves each group's own relative order, so the
    // stored list still reads question-order-then-set-text, same as before.
    const setSubject = observedList.filter((o) => o && o.questionId === SET_SUBJECT);
    const perQuestion = observedList.filter((o) => !(o && o.questionId === SET_SUBJECT));
    const roomForQuestions = Math.max(0, OBSERVED_CAP - setSubject.length);
    observedStored = [...perQuestion.slice(0, roomForQuestions), ...setSubject];
    observedTruncated = true;
  }
  const bag = {
    ...facts,
    findings: Array.isArray(facts.findings) ? facts.findings : undefined,
    observed: observedStored,
    observedTruncated: observedTruncated || undefined,
  };
  const kept = Object.fromEntries(
    REVIEW_FIELDS.filter((f) => bag[f] !== undefined && bag[f] !== null).map((f) => [f, bag[f]]),
  );
  const item = {
    ...kept,
    status,
    checkedAt: new Date().toISOString(),
    version: version === null || version === undefined ? null : version,
    // The keys come last: nothing in the bag — a forged PK/SK/version included
    // — may move this row or relabel which version it describes.
    ...reviewKey(ref, version),
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

/** After this, a `checking` row is a check that did not finish, not one in progress. */
const STALE_CHECK_MS = 15 * 60 * 1000;
const isConditionFailure = (e) => e && (e.name === 'ConditionalCheckFailedException' || e.code === 'ConditionalCheckFailedException');

/**
 * THE LOCK. A second submit while one runs would overwrite `checking` and
 * re-run every guardrail call at Engage's expense; a crashed worker would leave
 * `checking` for ever. So the write is conditional: it succeeds when nobody is
 * checking, or when the check that was is older than STALE_CHECK_MS. Readers
 * render a stale `checking` as "didn't finish — submit again" (`isUnfinished`).
 */
async function beginCheck(db, tableName, ref, version, { jobId, now = new Date(), keep = null } = {}) {
  const item = {
    // `keep` FIRST, and the keys and the lock's own fields after it: a caller
    // may carry facts across the lock (a platform re-check carries the human
    // decision, `decisionOf` above, so a worker that dies leaves it on the row
    // rather than taking it down with it) and can never relabel or move the row,
    // nor forge the status the lock is.
    ...(keep && typeof keep === 'object' ? keep : {}),
    ...reviewKey(ref, version),
    version: version === null || version === undefined ? null : version,
    status: STATUS.CHECKING,
    checkedAt: now.toISOString(),
    ...(jobId ? { jobId } : {}),
  };
  try {
    await db.send(new PutCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(#s) OR #s <> :checking OR checkedAt < :stale',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':checking': STATUS.CHECKING,
        ':stale': new Date(now.getTime() - STALE_CHECK_MS).toISOString(),
      },
    }));
    return true;
  } catch (e) {
    if (isConditionFailure(e)) return false;
    throw e;
  }
}
/**
 * Release a lock this job took and could not use (the worker failed to dispatch).
 *
 * `restore` is the row the lock REPLACED, for a caller that had one: a version
 * the public library is serving already carries a review, and deleting the lock
 * would delete that — the approval, the notice, the passed status — over a
 * dispatch that never happened. Given one, the row goes back instead of away.
 * Both forms are conditional on this job still holding the lock, so a worker
 * that did start owns the row and neither branch can touch it.
 */
async function abandonCheck(db, tableName, ref, version, { jobId, restore = null } = {}) {
  const guard = {
    ConditionExpression: '#s = :checking AND jobId = :job',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':checking': STATUS.CHECKING, ':job': String(jobId || '') },
  };
  const putBack = restore && typeof restore === 'object'
    && WRITABLE.includes(restore.status) && restore.status !== STATUS.CHECKING;
  try {
    if (putBack) {
      await db.send(new PutCommand({
        TableName: tableName,
        // The keys last, as everywhere else here: a row read from elsewhere
        // cannot be put back over a different version's.
        Item: { ...restore, ...reviewKey(ref, version) },
        ...guard,
      }));
      return;
    }
    await db.send(new DeleteCommand({ TableName: tableName, Key: reviewKey(ref, version), ...guard }));
  } catch (e) {
    if (!isConditionFailure(e)) throw e;
  }
}
/**
 * Move a version from one state to another, keeping what the row holds.
 * Conditional on the current state so two decisions cannot both apply.
 * Returns the new row, or null when the version was not in `from`.
 */
async function transitionReview(db, tableName, ref, version, from, patch = {}) {
  const froms = (Array.isArray(from) ? from : [from]).filter((s) => WRITABLE.includes(s));
  if (!froms.length) throw new Error('set-review: transitionReview needs at least one valid source status');
  if (!WRITABLE.includes(patch.status)) throw new Error(`set-review: refusing to write status ${JSON.stringify(patch.status)}`);
  const current = await readReview(db, tableName, ref, version);
  if (!froms.includes(current.status)) return null;
  const item = {
    ...current,
    ...patch,
    // The keys and the version come LAST: a patch can change the state and
    // add facts, never move the row or relabel which version it describes.
    ...reviewKey(ref, version),
    version: current.version === undefined ? (version === null || version === undefined ? null : version) : current.version,
    transitionedAt: new Date().toISOString(),
  };
  const values = { ':s0': current.status };
  try {
    await db.send(new PutCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: '#s = :s0',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: values,
    }));
    return item;
  } catch (e) {
    if (isConditionFailure(e)) return null;
    throw e;
  }
}
const isUnfinished = (review, nowMs = Date.now()) => Boolean(review)
  && review.status === STATUS.CHECKING
  && Boolean(review.checkedAt)
  && (nowMs - Date.parse(review.checkedAt)) > STALE_CHECK_MS;

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
  REVIEW_FIELDS,
  OBSERVED_CAP,
  DECISION_FIELDS,
  decisionOf,
  declarationOf,
  reviewKey,
  publishedKey,
  readReview,
  writeReview,
  readReviews,
  mayPublish,
  STALE_CHECK_MS,
  beginCheck,
  abandonCheck,
  transitionReview,
  isUnfinished,
  QueryCommand, // re-exported so callers need not import the SDK for a scan
};
