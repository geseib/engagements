// lambda-functions/admin/moderation-decide.js
/**
 * POST /admin/moderation/decide — the person's answer (spec §6.1).
 *
 *   approve  REVIEW ← passed (reviewer, note, notice) · log decided · publish
 *            FROM THE SNAPSHOT · sensitivity on the public row · share stamp
 *            published · log published · queue row deleted · snapshot kept (D9)
 *   reject   REVIEW ← flagged (reviewer, note) · log decided · share stamp
 *            flagged with the note · snapshot deleted · queue row deleted
 *   leave    log left-serving on the set · queue row deleted. NOTHING else:
 *            the answer to a row that is not a publish request and which
 *            neither decision above can answer — a staff RE-CHECK of a listing
 *            the library already serves, or the check of one of ENGAGE'S OWN
 *            sets, which has no public copy to approve into and no author to
 *            reject. See `leaveServing`.
 *
 * The REVIEW move is a conditional Put on the row's current status
 * (transitionReview), so two reviewers cannot both decide: the loser is told
 * who did. The org's content rows are never read or written here — approve
 * publishes what was judged, not what the org has since edited.
 *
 * The snapshot's OWN `source` is what publishSnapshot trusts to derive the
 * public set id (setRef(snapshot.source) -> publicSetIdFor(orgId, setId)) —
 * provenance travels with the judged content, not with the queue pointer.
 * A snapshot whose source names a different org/set than the sk being decided
 * is treated exactly as a missing one: there is nothing here that is really
 * this set's judged content to publish.
 *
 * ── THE QUEUE ROW IS THE COMPLETION MARKER (Ruling R9) ─────────────────────
 *
 * The transition (REVIEW -> passed/flagged) runs BEFORE publish, sensitivity,
 * the share stamp, the log, and the queue-row delete — so a throw anywhere in
 * that tail used to leave a REVIEW row that reads as "decided" while nothing
 * downstream of it actually happened: a stale share stamp, a public set live
 * with no sensitivity, or no public set at all, and a queue row that never
 * goes away. Worse, a retry then read the already-moved REVIEW row and was
 * told "Already decided by <name>" — the reviewer whose click never finished,
 * with no way to finish it.
 *
 * The fix is that the queue row is deleted LAST on both paths, so its
 * presence is the one honest signal that a decision is still incomplete. A
 * queue row that still exists beside an already-decided REVIEW row is not a
 * second decision — it is the first one, crashed. The SAME decision, sent
 * again (by the same reviewer or a different one), RESUMES: it does not
 * re-transition the REVIEW row, and it re-runs every write after the
 * transition so whatever didn't land the first time lands now — INCLUDING a
 * repeat, deliberately, of the `published` log entry every time a resume
 * completes something (`resumed: true` marks it as such; it is not idempotent
 * and is not meant to be — see `decided`, below, for the one write that is
 * guarded against repeating). A DIFFERENT decision on an already-decided
 * review is still refused as somebody else's call to make.
 *
 * ── `decided` IS LOGGED AT THE TRANSITION, NOT AT THE END (Ruling R11) ─────
 *
 * `decided` used to be the second-to-last log write on the approve path (after
 * publish, the sensitivity write and the share stamp) and the last on reject.
 * That meant every crash window that leads to a RESUME — by construction,
 * anywhere after the transition succeeds — happened BEFORE `decided` was
 * written. A resumed decision then left the log holding `published{resumed:
 * true}` (or nothing at all, on a resumed reject) with no record that a
 * person decided, or who: the REVIEW row itself gets overwritten by the org's
 * next re-check, so the review LOG is the only durable memory of the decision
 * once that happens.
 *
 * So `decided` now runs directly after `transitionReview` succeeds, on both
 * paths — before publish, before the stamp, before anything that can still
 * throw. A resume may still need to WRITE it: the crash could have landed
 * between the (now-earlier) `decided` write and the rest of the tail just as
 * easily as before. So a resume reads the log first and appends `decided`
 * only when this version holds none yet, naming the REVIEWER RECORDED ON THE
 * REVIEW ROW — the person who actually decided — never the person clicking
 * the retry. That read-then-write is not atomic, and the check is an
 * in-memory scan of the whole partition's log: two concurrent resumes could
 * in principle both find nothing and both append. Accepted, on the same
 * reasoning that already accepts a concurrent double-resume writing two
 * `published` entries — a duplicate log row is a strictly smaller risk than
 * the dead end (a decision with no way to finish) this whole mechanism exists
 * to close.
 *
 * ── THE QUEUE ROW, NOT THE REVIEW ROW, IS WHAT MAKES AN ITEM DECIDABLE (R19) ─
 *
 * Spec §11: an organisation may delete a version, or the whole set, while it
 * is sitting in this queue. `delete-set-version.js` / `delete-question-set.js`
 * remove the version PARTITION — and the REVIEW row lives in it — but neither
 * the queue row (no TTL, by design: a queue row must not vanish) nor the S3
 * snapshot. `readReview` then answers `unreviewed`, which is not OPEN, so both
 * decisions used to 409 with "not waiting for a decision" and the queue row
 * could never be cleared by anything: a permanent entry nobody could act on.
 *
 * A queued item is ALWAYS looked up first here, so `unreviewed` beside a queue
 * row does not mean "never checked" — it means the REVIEW row vanished from
 * under an item the check had already escalated. That is decidable:
 *
 *   approve  skip transitionReview (it would recreate an orphan row in a
 *            partition the organisation deleted) · publish FROM THE SNAPSHOT,
 *            which is self-contained · sensitivity · share stamp, which simply
 *            does not apply when the whole set is gone (writeShareStamp is
 *            conditional on the row) · log decided + published · queue row
 *            deleted · 200 with `orphaned: true`
 *   reject   snapshot deleted · log decided · queue row deleted · 200. No
 *            share stamp: a reject publishes nothing for the stamp to point
 *            at, and telling an organisation their v2 is `flagged` when they
 *            have deleted v2 is a state about content that no longer exists.
 *
 * Nothing else changes: the orphaned approve differs from the ordinary one in
 * exactly one way — it does not move a REVIEW row that is not there. A
 * PUBLISHED marker does land back in the deleted partition (publishSnapshot
 * writes one), and that is tolerated rather than fought: Stage 1's re-share
 * already leaves markers behind, and a marker is a fact about where a publish
 * went, not a claim that the content is still there.
 *
 * dismiss / take down / keep-with-a-notice are answers to REPORTED rows and
 * arrive with reports (Stage 3). The two keyless shapes —
 * `PUBLIC#<publicSetId>` for a listing and `PLATFORM#<setId>` for Engage's own
 * set — are accepted for `leave` alone, and `leaveServing` refuses one carrying
 * a report: a report is somebody's complaint, not this check's finding.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const tenant = require('./shared/tenant');
const { queueKey, deleteQueueRow } = require('./shared/moderation-queue');
const { STATUS, readReview, transitionReview } = require('./shared/set-review');
const { publishSnapshot, platformPromptExists } = require('./shared/publish-set');
const { writeShareStamp } = require('./shared/share-stamp');
const { appendReviewEvent, readReviewLog } = require('./shared/review-log');
const { readSnapshot, deleteSnapshot } = require('./shared/snapshot-store');
const { setMetadataKey, toVersion } = require('./shared/set-version');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const TABLE = () => process.env.TABLE_NAME;
const BUCKET = () => process.env.AI_PROMPTS_BUCKET || '';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });

const NOTE_MAX = 500;
const NOTICE_ID = /^[a-z0-9-]{1,40}$/;
// Matches declaredNotice's own cap (check-question-set.js `slice(0, 8)`).
const NOTICE_MAX = 8;
/**
 * `leave` is the third answer, and the only one that is not about a publish
 * request: see `leaveServing` below. It is listed here so an unknown decision
 * still reads as "not one of ours" rather than falling into approve's branch.
 */
const LEAVE = 'leave';
const DECISIONS = ['approve', 'reject', LEAVE];
const OPEN = [STATUS.ESCALATED, STATUS.APPEALED];

const reviewerOf = (event) => String(event?.requestContext?.authorizer?.lambda?.username || event?.requestContext?.authorizer?.lambda?.userId || 'engage').trim();

/**
 * Only the org shape decides here; PUBLIC# and PLATFORM# rows are reports
 * (Stage 3).
 *
 * `#v([1-9]\d*)` and NOT `#v(\d+)`: a version is one-based, and `v0` would
 * parse to `setPartition(ref, 0)`, which `set-version.js` resolves to the
 * LEGACY UNVERSIONED partition — so `org_acme#safety#v0` would have decided,
 * published and stamped a DIFFERENT set's content than any queue row can name.
 * `v01` goes with it: one spelling per version.
 *
 * The second, bare shape below (no `#v` suffix at all) is that same legacy
 * unversioned partition, named the only way it legitimately can be
 * (moderation-queue.js `queueSk`) — it is what makes an unversioned org set's
 * queue row decidable at all. The negative lookahead keeps it from ever
 * shadowing `PUBLIC#<id>`/`PLATFORM#<id>`: this function runs BEFORE
 * `parsePublicSk`/`parsePlatformSk` (see `parseBody`, below), and an org id can
 * never legitimately be either literal.
 */
function parseOrgSk(raw) {
  const s = String(raw || '').trim();
  let m = /^([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)#v([1-9]\d*)$/.exec(s);
  if (m) return { sk: m[0], ref: { scope: 'org', orgId: m[1], setId: m[2] }, version: Number(m[3]) };
  m = /^(?!PUBLIC#|PLATFORM#)([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)$/.exec(s);
  if (m) return { sk: m[0], ref: { scope: 'org', orgId: m[1], setId: m[2] }, version: null };
  return null;
}

/**
 * A LISTING's queue row: `PUBLIC#<publicSetId>`, which is where a staff
 * re-check raises one (set-check-worker.js). Only `leave` addresses one — it is
 * not a publish request, so there is nothing there for approve or reject to
 * answer. Stage 3's reports land on this same shape and are refused inside
 * `leaveServing` by what the row SAYS, not by its key.
 */
function parsePublicSk(raw) {
  const m = /^PUBLIC#([A-Za-z0-9_-]+)$/.exec(String(raw || '').trim());
  return m ? { sk: m[0], publicSetId: m[1] } : null;
}

/**
 * ENGAGE'S OWN SET: `PLATFORM#<setId>`, §3.2's third shape and where the check
 * of a platform set raises its row (set-check-worker.js). `leave` is the only
 * answer it can have, and for a sharper reason than the listing's: approve
 * would publish Engage's own set into the public library, which is a library
 * for customers' content, and reject would stamp an author who does not exist.
 * Switching the set off is the console's job and stays there.
 */
function parsePlatformSk(raw) {
  const m = /^PLATFORM#([A-Za-z0-9_-]+)$/.exec(String(raw || '').trim());
  return m ? { sk: m[0], platformSetId: m[1] } : null;
}

function parseBody(event) {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { error: 'The request body is not JSON.' }; }
  const decision = String(body.decision || '').trim();
  if (!DECISIONS.includes(decision)) return { error: 'The decision must be approve, reject or leave.' };
  const parsed = parseOrgSk(body.sk);
  // The listing and platform shapes are offered to `leave` alone, and only when
  // the org shape did not match: a re-check of a VERSIONED entry could carry
  // the flag on either key, historically on the organisation's own.
  const listing = !parsed && decision === LEAVE
    ? (parsePublicSk(body.sk) || parsePlatformSk(body.sk))
    : null;
  if (!parsed && !listing) return { error: 'That is not a queue entry this screen decides.' };
  // Minor #4: a non-string note (an object, an array, a number...) must be
  // refused, not silently coerced -- String({}) is '[object Object]'.
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
    return { error: 'The note must be text.' };
  }
  const note = String(body.note || '').trim();
  if (note.length > NOTE_MAX) return { error: `The note is over ${NOTE_MAX} characters.` };
  const notice = Array.isArray(body.notice) ? body.notice.map((n) => String(n || '').trim()).filter(Boolean) : [];
  // Minor #2: this is a SHAPE check, not a whitelist -- say what a valid id
  // looks like, not that it's unrecognised.
  if (notice.length > NOTICE_MAX || notice.some((n) => !NOTICE_ID.test(n))) {
    return { error: 'A content notice id is lowercase letters, digits and dashes, up to 40 characters, and there are at most 8 of them.' };
  }
  if (listing) {
    return {
      sk: listing.sk,
      publicSetId: listing.publicSetId || '',
      platformSetId: listing.platformSetId || '',
      ref: null, version: 0, decision, note, notice,
    };
  }
  return { ...parsed, publicSetId: '', platformSetId: '', decision, note, notice };
}

/**
 * Ruling R5: does this snapshot's own provenance name the set being decided?
 * publishSnapshot derives the public set id from `snapshot.source`, so a
 * snapshot that parses but points elsewhere must never be published under
 * this sk's identity — that would publish org_other's content as org_acme's.
 * Compared as strings, orgId and setId only; scope is not part of the check
 * (an org-shaped queue sk always implies scope 'org' on both sides here).
 */
const sameSet = (source, ref) => Boolean(source)
  && String(source.orgId || '') === String(ref.orgId || '')
  && String(source.setId || '') === String(ref.setId || '');

/**
 * "LEAVE IT SERVING" — the other answer to a row a staff re-check raised, and
 * the one the queue could not give.
 *
 * A re-check of a listing the library already serves records what it measured
 * and, when that is worse than the decision on record, raises a row so a person
 * looks (R7: nothing is taken down automatically). Neither ordinary decision
 * applies to it — approve would publish content already live a second time,
 * reject would tell an author off for a check nobody asked them for — so the
 * only control staff had left was TAKE DOWN: the destructive one, on content a
 * person had already approved. The refusal above even says "or leave it
 * serving", which was not a thing anybody could do: the row stayed in the
 * worklist and in the nav badge for ever, ageing.
 *
 * The likely outcome of exactly the re-checks the owner wants is a MEDIUM band a
 * person has already ruled on (content-guardrail.js maps MEDIUM to escalate), so
 * "the approval stands" is not an edge case — it is the common one, and this is
 * how it is said.
 *
 * It deletes the QUEUE ROW and nothing else: not the review row (the
 * measurement stays, and so does the human decision), not the S3 snapshot, not
 * one row of the library. The organisation's log records it, because that log is
 * where they see what Engage did to their set and a re-check that changed
 * nothing is still something Engage did.
 */
async function leaveServing({
  sk, pointer, ref, version, publicSetId, platformSetId, note, reviewer,
}) {
  /*
    IS ANYBODY WAITING ON A DECISION HERE? That is the whole of the gate, and
    `recheck` is how a row keyed by a VERSION says no — the organisation's own
    submission of that same version says nothing and is a publish request that
    is owed an answer.

    A row keyed `PLATFORM#<setId>` cannot be a publish request whatever it
    carries: there is no version in the key to publish and no organisation
    waiting on one. Engage's own set raises exactly that row, so it is admitted
    by its shape rather than by a flag — and the report check below still
    applies to it, because a report IS somebody waiting.
  */
  if (!platformSetId && pointer.recheck !== true) {
    return json(409, {
      error: 'Only an entry a staff re-check raised can be left serving — this one is a request waiting for a decision.',
    });
  }
  const reasons = Array.isArray(pointer.reasons) ? pointer.reasons : [];
  // Stage 3's reports land on the listing's key too, and a report is somebody's
  // complaint rather than this check's finding: dropping the row would drop it.
  if (reasons.includes('reported')) {
    return json(409, { error: 'This entry also carries a report, which is answered on the report itself.' });
  }
  // WHOSE LOG. For a listing's row the provenance is the LISTING's, read from
  // the public row the way every other path here reads it — never from the
  // pointer, whose own `setId` is the public set id. A listing that has gone
  // leaves nothing to write to, and the row is simply an orphan to remove.
  let logRef = ref;
  let logVersion = version;
  // ENGAGE'S OWN SET is its own provenance: the log is the set's, and the
  // version is the one the check recorded on the row it raised.
  if (!logRef && platformSetId) {
    logRef = { scope: tenant.PLATFORM, orgId: '', setId: platformSetId };
    logVersion = toVersion(pointer.version);
  }
  if (!logRef && publicSetId) {
    const meta = (await db.send(new GetCommand({
      TableName: TABLE(),
      Key: setMetadataKey({ scope: tenant.PUBLIC, orgId: '', setId: publicSetId }),
    }))).Item;
    if (meta && meta.sourceOrgId && meta.sourceSetId) {
      logRef = { scope: tenant.ORG, orgId: String(meta.sourceOrgId), setId: String(meta.sourceSetId) };
      logVersion = toVersion(meta.sourceVersion);
    } else {
      logRef = null;
    }
  }
  // What was left serving: a public listing, or Engage's own set. Named the
  // same way in the log and in the answer, so neither has to be guessed at.
  const leftServing = platformSetId || publicSetId || pointer.publicSetId || '';
  if (logRef) {
    await appendReviewEvent(db, TABLE(), logRef, 'left-serving', {
      version: logVersion === undefined ? null : logVersion,
      ...(platformSetId ? { setId: platformSetId } : { publicSetId: publicSetId || pointer.publicSetId || '' }),
      reviewer,
      ...(note ? { note } : {}),
    });
  }
  // LAST, as on every other path here: the queue row is the completion marker,
  // so a crash before this leaves the row for the next click rather than a
  // cleared worklist with nothing in the customer's log.
  await deleteQueueRow(db, TABLE(), sk);
  return json(200, { decision: LEAVE, leftServing });
}

async function writeSensitivity(pubRef, notice) {
  await db.send(new UpdateCommand({
    TableName: TABLE(),
    Key: setMetadataKey(pubRef),
    UpdateExpression: 'SET sensitivity = :n',
    ExpressionAttributeValues: { ':n': notice },
    ConditionExpression: 'attribute_exists(PK)',
  }));
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM, '')) {
    return json(403, { error: 'Decisions are for Engage staff acting as Engage.' });
  }
  const input = parseBody(event);
  if (input.error) return json(400, { error: input.error });
  const { sk, ref, version, decision, note, notice, publicSetId, platformSetId } = input;
  const reviewer = reviewerOf(event);
  try {
    const row = await db.send(new GetCommand({ TableName: TABLE(), Key: queueKey(sk) }));
    if (!row || !row.Item) return json(404, { error: 'Nothing is waiting under that entry — it may already be decided.' });
    const pointer = row.Item;
    // The one answer that is not about a publish request, so it comes before
    // every read and every branch that assumes one.
    if (decision === LEAVE) {
      return await leaveServing({ sk, pointer, ref, version, publicSetId, platformSetId, note, reviewer });
    }
    /*
      A ROW STAFF'S RE-CHECK RAISED IS NOT DECIDED HERE, and the refusal comes
      before every branch below because both buttons are wrong on it.

      THE SECOND LOCK, and deliberately kept as one. A re-check is now keyed by
      the LISTING (`PUBLIC#<publicSetId>`, set-check-worker.js), a shape
      `parseOrgSk` above does not parse at all, so no row this code raises can
      reach here carrying the flag. It used to share the organisation's version
      key, which is how a re-check turned THEIR pending publish request into one
      nobody could answer. A bump still inherits the flag from whatever row it
      lands on (moderation-queue.js), so the check below costs one boolean and
      keeps the two locks independent of each other.

      The library is already serving this exact version. APPROVE would take the
      ordinary path — `escalated` is open, so nothing resumes — and
      publishSnapshot without `resume` mints a SECOND public version of content
      already live (publish-set.js), flips `activeVersion` onto it and rewrites
      the author's share stamp: the "every card becomes Public v2" outcome the
      re-check was built to avoid. REJECT would stamp the author `flagged`, with
      a note they read, for a check nobody told them about — while the library
      goes on serving the set, so the finding is dismissed as well. A FLAGGED
      re-check is worse again: `flagged` is not open, so the resumed-reject
      branch is the only one a reject reaches, and it deletes the snapshot a
      person still has to look at.

      So the decision belongs on the set's score card, which shows the
      escalation, what held it, and Take down. `recheck` is written fresh on
      every upsert (moderation-queue.js), so the organisation's own later
      submission of this version is decided here as usual.
    */
    if (pointer.recheck === true) {
      return json(409, {
        error: 'The library is already serving this version, and a staff re-check raised this entry — so approving it would publish it a second time and rejecting it would tell its author off for a check nobody asked them for. Open its score card to take it down, or leave it serving.',
        recheck: true,
        publicSetId: pointer.publicSetId || '',
      });
    }
    const review = await readReview(db, TABLE(), ref, version);
    const decidedAt = new Date().toISOString();

    // Ruling R9: the queue row is the LAST write on both the approve and the
    // reject path -- deleted only once publish/stamp/log have all landed. So
    // a queue row that still exists beside an ALREADY-decided REVIEW row is
    // not a second decision; it is the first one, crashed between the
    // transition and the delete. The SAME decision, replayed, RESUMES: no
    // new transition (the recorded reviewer/note/notice win over whatever
    // this retry sent), and every write after the transition runs again so
    // whatever didn't land the first time -- the publish, the sensitivity,
    // the stamp -- lands now. A DIFFERENT decision on an already-decided
    // review is refused as somebody else's call; a status this screen never
    // opens (unreviewed, checking...) is refused as not waiting at all.
    const resumingApprove = review.status === STATUS.PASSED && decision === 'approve';
    const resumingReject = review.status === STATUS.FLAGGED && decision === 'reject';
    // Ruling R19: no REVIEW row under a row that IS queued means the
    // organisation deleted the version (or the set) while it waited — see the
    // header. Decidable, without a transition.
    const orphaned = review.status === STATUS.UNREVIEWED;

    if (!OPEN.includes(review.status) && !resumingApprove && !resumingReject && !orphaned) {
      if (review.status === STATUS.PASSED || review.status === STATUS.FLAGGED) {
        return json(409, { error: `Already decided by ${review.reviewer || 'somebody else'}.`, status: review.status, reviewer: review.reviewer || '' });
      }
      return json(409, { error: `That entry is not waiting for a decision (status: ${review.status}).`, status: review.status });
    }

    if (orphaned) {
      if (decision === 'approve') {
        const snapshot = pointer.snapshotKey ? await readSnapshot(s3, BUCKET(), pointer.snapshotKey) : null;
        if (!snapshot || !sameSet(snapshot.source, ref)) {
          return json(409, { error: 'The snapshot is gone, so there is nothing to publish — ask the organisation to submit it again.' });
        }
        // The REVIEW row carried `promptDropped`, and it is gone with the
        // partition — so this is re-derived from the snapshot's OWN meta
        // against the PLATFORM prompts partition, exactly as
        // publish-question-set.js derives it. Reading `review.promptDropped`
        // here would be `false` every time, and a public set pointing at an
        // organisation's private Workie is a dangling reference in every copy
        // anyone takes of it (D5).
        const promptId = (snapshot.meta && snapshot.meta.promptId) || '';
        const promptDropped = Boolean(promptId) && !(await platformPromptExists(db, TABLE(), promptId));
        await appendReviewEvent(db, TABLE(), ref, 'decided', { version, decision, reviewer, note, notice, orphaned: true });
        // Ruling R9 applies here exactly as it does to the ordinary path's
        // resumingApprove below: the queue row is the completion marker, so a
        // crash between this publish landing and the row's delete must
        // converge on retry rather than mint a second public version.
        // `resume: true` was missing here — the one approve path that forgot
        // it — which is what let a retried orphan approve publish twice (7b).
        const published = await publishSnapshot(db, TABLE(), snapshot, {
          review: { findings: [], note }, sourceOrgName: pointer.orgName || '', promptDropped, resume: true,
        });
        if (notice.length) await writeSensitivity(published.pubRef, notice);
        // No-ops when the whole set was deleted; lands when only the version
        // was, which is the case where the organisation's list still has a row
        // that ought to say where this went.
        await writeShareStamp(db, TABLE(), ref, {
          version, status: 'published', publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash,
        });
        await appendReviewEvent(db, TABLE(), ref, 'published', { version, publicSetId: published.publicSetId, publicVersion: published.publicVersion, by: reviewer });
        await deleteQueueRow(db, TABLE(), sk);
        return json(200, { decision, publicSetId: published.publicSetId, publicVersion: published.publicVersion, orphaned: true });
      }
      await appendReviewEvent(db, TABLE(), ref, 'decided', { version, decision, reviewer, note, orphaned: true });
      if (pointer.snapshotKey) await deleteSnapshot(s3, BUCKET(), pointer.snapshotKey);
      await deleteQueueRow(db, TABLE(), sk);
      return json(200, { decision, orphaned: true });
    }

    if (resumingApprove) {
      const snapshot = pointer.snapshotKey ? await readSnapshot(s3, BUCKET(), pointer.snapshotKey) : null;
      if (!snapshot || !sameSet(snapshot.source, ref)) {
        return json(409, { error: 'The snapshot is gone, so there is nothing to publish — ask the organisation to submit it again.' });
      }
      const resumedNote = review.note || '';
      const resumedNotice = Array.isArray(review.notice) ? review.notice : [];
      // Ruling R11: `decided` moved to right after the transition, so a crash
      // before this resume could already have written it. Back-fill only if
      // this version's log holds none yet, and name the person who actually
      // decided (the REVIEW row's own reviewer), not this retry's caller.
      const log = await readReviewLog(db, TABLE(), ref);
      if (!log.some((e) => e.event === 'decided' && Number(e.version) === version)) {
        await appendReviewEvent(db, TABLE(), ref, 'decided', {
          version, decision, reviewer: review.reviewer || reviewer, note: resumedNote, notice: resumedNotice,
        });
      }
      const published = await publishSnapshot(db, TABLE(), snapshot, {
        review, sourceOrgName: pointer.orgName || '', promptDropped: review.promptDropped === true, resume: true,
      });
      if (resumedNotice.length) await writeSensitivity(published.pubRef, resumedNotice);
      await writeShareStamp(db, TABLE(), ref, {
        version, status: 'published', publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash || review.contentHash,
      });
      // `published` is NOT guarded — it is repeated, deliberately, every time
      // a resume completes something; `resumed: true` marks it as a repeat.
      await appendReviewEvent(db, TABLE(), ref, 'published', { version, publicSetId: published.publicSetId, publicVersion: published.publicVersion, by: reviewer, resumed: true });
      await deleteQueueRow(db, TABLE(), sk);
      return json(200, { decision, publicSetId: published.publicSetId, publicVersion: published.publicVersion, resumed: true });
    }

    if (resumingReject) {
      const resumedNote = review.note || '';
      // Ruling R11: same back-fill guard as the resumed approve above.
      const log = await readReviewLog(db, TABLE(), ref);
      if (!log.some((e) => e.event === 'decided' && Number(e.version) === version)) {
        await appendReviewEvent(db, TABLE(), ref, 'decided', { version, decision, reviewer: review.reviewer || reviewer, note: resumedNote });
      }
      await writeShareStamp(db, TABLE(), ref, { version, status: 'flagged', note: resumedNote, contentHash: review.contentHash });
      if (pointer.snapshotKey) await deleteSnapshot(s3, BUCKET(), pointer.snapshotKey);
      await deleteQueueRow(db, TABLE(), sk);
      return json(200, { decision, resumed: true });
    }

    if (decision === 'approve') {
      const snapshot = pointer.snapshotKey ? await readSnapshot(s3, BUCKET(), pointer.snapshotKey) : null;
      if (!snapshot || !sameSet(snapshot.source, ref)) {
        return json(409, { error: 'The snapshot is gone, so there is nothing to publish — ask the organisation to submit it again.' });
      }
      const moved = await transitionReview(db, TABLE(), ref, version, review.status, {
        status: STATUS.PASSED, reviewer, decidedAt, note, ...(notice.length ? { notice } : {}),
      });
      if (!moved) {
        const now = await readReview(db, TABLE(), ref, version);
        return json(409, { error: `Already decided by ${now.reviewer || 'somebody else'}.`, status: now.status, reviewer: now.reviewer || '' });
      }
      // Ruling R11: logged HERE, right after the transition succeeds — not
      // after publish/stamp, which can still throw and leave a resume with
      // no record of who decided at all. publicSetId/publicVersion are not
      // known yet at this point and are not this event's job; `published`
      // carries them.
      await appendReviewEvent(db, TABLE(), ref, 'decided', { version, decision, reviewer, note, notice });
      const published = await publishSnapshot(db, TABLE(), snapshot, {
        review: moved, sourceOrgName: pointer.orgName || '', promptDropped: review.promptDropped === true,
      });
      if (notice.length) await writeSensitivity(published.pubRef, notice);
      await writeShareStamp(db, TABLE(), ref, {
        version, status: 'published', publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash || review.contentHash,
      });
      await appendReviewEvent(db, TABLE(), ref, 'published', { version, publicSetId: published.publicSetId, publicVersion: published.publicVersion, by: reviewer });
      await deleteQueueRow(db, TABLE(), sk);
      return json(200, { decision, publicSetId: published.publicSetId, publicVersion: published.publicVersion });
    }

    const moved = await transitionReview(db, TABLE(), ref, version, review.status, { status: STATUS.FLAGGED, reviewer, decidedAt, note });
    if (!moved) {
      const now = await readReview(db, TABLE(), ref, version);
      return json(409, { error: `Already decided by ${now.reviewer || 'somebody else'}.`, status: now.status, reviewer: now.reviewer || '' });
    }
    // Ruling R11: logged HERE, right after the transition, same as approve.
    await appendReviewEvent(db, TABLE(), ref, 'decided', { version, decision, reviewer, note });
    await writeShareStamp(db, TABLE(), ref, { version, status: 'flagged', note, contentHash: review.contentHash });
    if (pointer.snapshotKey) await deleteSnapshot(s3, BUCKET(), pointer.snapshotKey);
    await deleteQueueRow(db, TABLE(), sk);
    return json(200, { decision });
  } catch (error) {
    console.error('❌ decide failed:', error);
    return json(500, { error: `Could not record that decision: ${error.message}` });
  }
};
