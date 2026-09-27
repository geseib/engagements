/**
 * LEAVING A PAID PLAN — self-serve, immediate, and only once the sets fit.
 *
 * The owner, 27 Sep 2026: *"also you should be able to leave plan. when doing
 * so they will be given a list of their team or individual sets and be told how
 * many they have to delete to get down to 5 free. they can before deleting also
 * click a make public button (but they will be told they will not be deleted
 * until they are accepted into public (a copy) or they come back and uncheck
 * make public"*.
 *
 * Decisions the owner made, not re-derived here:
 *
 *   - THE PLAN CHANGES ONLY ONCE THE KEPT SETS FIT. "Kept" is every set the
 *     organisation holds that is NOT held for the public library — a held set
 *     is on its way out (shared/public-hold.js). The allowance is the free
 *     plan's own `includedSets` (pricing.js PERSONAL_PLAN), never a literal 5.
 *   - IT IS SELF-SERVE. No request, no approval: an owner or admin of the
 *     organisation presses Leave and the plan is free from that moment. A
 *     personal space's owner is its owner.
 *   - A HELD SET THAT COMES BACK COUNTS AGAIN — unticked, or declined by the
 *     library. The free-tier gate (usage.js `readAllowance`, fed by
 *     `countSets`, which skips held sets) then refuses NEW sets until the
 *     organisation is back at its allowance. Nothing here re-checks that; the
 *     gate that already refuses the sixth set is the one that does.
 *
 * ── ROUTES (routed from plan-requests.js: one Lambda, PlanRequestsFunction) ──
 *
 *   GET  /orgs/{orgId}/plan/leave        admin+  the preview
 *   POST /orgs/{orgId}/plan/leave        admin+  leave (409 + preview if too many)
 *   POST /orgs/{orgId}/plan/leave/hold   admin+  { setId, hold, topic? } "Make public"
 *
 * ── ROWS ────────────────────────────────────────────────────────────────────
 *
 *   ORG#<org> / METADATA                       plan ← 'free', planChangedAt
 *   ORGS      / ORG#<org>                      the same, on the platform index
 *   ORG#<org> / LEDGER#<period>#PLAN_CHANGE#<id>  the record, beside the one an
 *                                              approval writes (plan-requests.js)
 *   ORG#<org> / PLANREQ#…                      any open request → withdrawn
 *   <org>SETS / SET#<id>   publicHold          shared/public-hold.js
 *
 * All in ONE transaction for the plan change itself, conditional on the plan
 * still being the one the preview read: two admins pressing Leave at once
 * produce one change and one ledger row, and the second is told it already
 * happened.
 *
 * ── A MID-PERIOD LEAVE AND THE BILL ─────────────────────────────────────────
 *
 * A period is billed on the plan its organisation holds when it is read or
 * closed — get-usage.js and invoices.js both price with `planFor(orgRow)` — so
 * an organisation that leaves on the 20th sees this month project at the free
 * plan from that moment, exactly as one that is approved onto a paid plan on
 * the 20th sees the whole month project at that plan. Nothing here writes a
 * USAGE# row or a SESSION ledger row, and the PLAN_CHANGE row sits under its
 * own `kind`, so the reconciler (which counts `LEDGER#<period>#SESSION#` only)
 * and an invoice already closed for an earlier month (frozen, invoices.js) are
 * untouched. tests/leave-plan.js holds all three.
 */
const {
  QueryCommand, GetCommand, UpdateCommand, TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const G = require('./shared/org-guards');
const tenant = require('../shared/tenant');
const { periodOf, readUsage, countSets, recordSetCount } = require('../shared/usage');
const { planFor, PERSONAL_PLAN } = require('../shared/pricing');
const {
  setRef, setMetadataKey, resolvePartitionFromMeta, toVersion,
} = require('../shared/set-version');
const { decryptItem, encryptValue, ENCRYPTED_FIELDS } = require('../shared/tenant-crypto');
const { readReview, isUnfinished, STATUS } = require('../shared/set-review');
const {
  normalizeSetTopic, resolveSetTopic, setTopicRefusal, SET_TOPIC_IDS, SET_TOPICS, UNFILED,
} = require('../shared/set-topics');
const { liveSnapshot, publishLiveVersion } = require('../shared/publish-live');
const hold = require('../shared/public-hold');

const SET_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const FREE = 'free';

let lambdaClient = null;
const lambda = () => {
  if (!lambdaClient) lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });
  return lambdaClient;
};

/** Is this organisation on a plan it could leave? The plan's own flag, not its
 *  id: pricing.js `planFor` decides what a stored plan string means, and a paid
 *  plan is the one that meters. */
const onPaidPlan = (org) => planFor(org).metersOverage === true;

/** The free allowance, read from the plan that defines it. */
const freeAllowance = () => Math.max(0, Math.trunc(Number(PERSONAL_PLAN.includedSets) || 0));

/** `2026-09` → `2026-10-01`: when a free month's sessions start again. */
function resetsOn(period) {
  const [y, m] = String(period).split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------- the preview --- */

/**
 * Where a held set is in the library's hands, from its version's REVIEW row —
 * the same row the publish gate reads, so the dialog cannot tell a different
 * story from the one the library is acting on.
 *
 *   checking  the content check is running
 *   waiting   with a person at Engage (escalated, or appealed)
 *   stalled   nothing is moving — a check that did not finish, or a pass whose
 *             publish did not complete. "Make public" again restarts it.
 */
function holdStateOf(review) {
  if (!review) return 'stalled';
  if (review.status === STATUS.CHECKING) return isUnfinished(review) ? 'stalled' : 'checking';
  if (review.status === STATUS.ESCALATED || review.status === STATUS.APPEALED) return 'waiting';
  return 'stalled';
}

async function listSets(orgId) {
  return G.queryPartition(tenant.setsMetadataPk(tenant.ORG, orgId), 'SET#');
}

/** One row of the dialog's list. Names are ciphertext at rest; this decrypts. */
async function publicSetRow(orgId, row) {
  const plain = await decryptItem(orgId, 'set', row);
  // The key is the id — get-question-sets.js reads it the same way.
  const setId = String(row.SK || '').replace(/^SET#/, '');
  const ref = setRef({ scope: tenant.ORG, orgId, setId });
  const held = hold.isHeld(row);
  const version = toVersion(row.activeVersion);
  let holdState = null;
  if (held) {
    const review = await readReview(G.db, G.tableName(), ref, toVersion(hold.holdOf(row).version));
    holdState = holdStateOf(review);
  }
  const released = hold.releasedOf(row);
  return {
    setId,
    name: String(plain.name || setId),
    engagementType: String(row.engagementType || ''),
    questionCount: Math.max(0, Math.trunc(Number(row.questionCount) || 0)),
    version,
    topic: resolveSetTopic(row.topic),
    held,
    holdState,
    heldAt: held ? String(hold.holdOf(row).at || '') : '',
    // Said once, on the row, so a set the library turned down does not simply
    // reappear in somebody's count with no word about why.
    released: !held && released && released.reason !== 'unticked'
      ? { reason: released.reason, note: String(released.note || ''), at: String(released.at || '') }
      : null,
  };
}

/**
 * Everything the dialog draws, and everything POST decides on. One function, so
 * the number the person is told to delete and the number the refusal enforces
 * are the same arithmetic on the same read.
 */
async function buildPreview(orgId, org) {
  const plan = planFor(org);
  const rows = await listSets(orgId);
  const sets = [];
  for (const row of rows) sets.push(await publicSetRow(orgId, row)); // eslint-disable-line no-await-in-loop
  sets.sort((a, b) => a.name.localeCompare(b.name));
  const allowance = freeAllowance();
  const heldCount = sets.filter((s) => s.held).length;
  const kept = sets.length - heldCount;
  const mustDelete = Math.max(0, kept - allowance);
  const paid = onPaidPlan(org);

  const period = periodOf(new Date());
  let sessionsRun = 0;
  try {
    sessionsRun = (await readUsage(orgId, period, { db: G.db, tableName: G.tableName() })).sessionsRun;
  } catch (error) {
    // A sentence of context, not a gate: an unreadable counter must not stop
    // somebody seeing what they have to delete.
    console.warn(`⚠️ leave-plan: could not read ${orgId}'s sessions for the preview:`, error && error.message);
  }

  return {
    orgId,
    plan: { id: String(org.plan || FREE), planId: plan.id, name: plan.name, paid },
    freePlan: {
      name: PERSONAL_PLAN.name,
      includedSets: allowance,
      includedSessions: Math.max(0, Math.trunc(Number(PERSONAL_PLAN.includedSessions) || 0)),
    },
    allowance,
    sets,
    total: sets.length,
    held: heldCount,
    kept,
    mustDelete,
    canLeave: paid && mustDelete === 0,
    sessions: {
      used: sessionsRun,
      included: Math.max(0, Math.trunc(Number(PERSONAL_PLAN.includedSessions) || 0)),
      resetsOn: resetsOn(period),
    },
    topics: SET_TOPIC_IDS.map((id) => ({ id, label: SET_TOPICS[id].label })),
  };
}

async function preview(event, orgId) {
  const auth = await G.authorizeOrg(event, orgId, 'admin');
  if (auth.denied) return auth.denied;
  return G.json(200, await buildPreview(orgId, auth.org));
}

/* ------------------------------------------------------------------- leave --- */

/** The same plural the dialog uses, so a refusal and the screen read alike. */
const setsWord = (n) => `${n} ${n === 1 ? 'set' : 'sets'}`;

async function openRequests(orgId) {
  const res = await G.db.send(new QueryCommand({
    TableName: G.tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': tenant.orgPk(orgId), ':sk': 'PLANREQ#' },
  }));
  return (res.Items || []).filter((r) => r.status === 'requested');
}

/**
 * Withdraw one open plan request, in the same shape plan-requests.js
 * `moveRequest` moves one: the row to `withdrawn` (conditional on still being
 * requested), its queue pointer out of `requested` and into `withdrawn`. Built
 * here as transaction items so it lands with the plan change or not at all.
 */
function withdrawItems(row, now, by) {
  const queueSk = (status) => `PLANREQ#${status}#${row.requestedAt}#${row.orgId}`;
  return [
    {
      Update: {
        TableName: G.tableName(),
        Key: { PK: row.PK, SK: row.SK },
        UpdateExpression: 'SET #status = :withdrawn, withdrawnAt = :now, withdrawnBy = :by, withdrawnVia = :via',
        ConditionExpression: '#status = :requested',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':withdrawn': 'withdrawn', ':requested': 'requested', ':now': now, ':by': by, ':via': 'leave-plan',
        },
      },
    },
    { Delete: { TableName: G.tableName(), Key: { PK: tenant.ORGS_INDEX_PK, SK: queueSk('requested') } } },
    {
      Put: {
        TableName: G.tableName(),
        Item: {
          PK: tenant.ORGS_INDEX_PK, SK: queueSk('withdrawn'),
          RecordType: 'PLANREQ_QUEUE', orgId: row.orgId, reqId: row.reqId, toPlan: row.toPlan, code: row.code || '',
          requestedAt: row.requestedAt, decidedAt: now,
        },
      },
    },
  ];
}

async function leave(event, orgId) {
  const auth = await G.authorizeOrg(event, orgId, 'admin');
  if (auth.denied) return auth.denied;
  const org = auth.org;
  const view = await buildPreview(orgId, org);
  if (!view.plan.paid) {
    return G.json(409, { error: `This organisation is already on the ${PERSONAL_PLAN.name} plan.`, code: 'not_on_paid_plan', ...view });
  }
  if (view.mustDelete > 0) {
    return G.json(409, {
      error: `You have ${setsWord(view.kept)} to keep. The free plan keeps ${view.allowance} — delete `
        + `${view.mustDelete}, or make some public, and then leave.`,
      code: 'too_many_sets',
      ...view,
    });
  }

  const now = new Date().toISOString();
  const by = G.callerSub(event);
  const fromPlan = String(org.plan || '');
  const changeId = `leave-${G.randomBase58(10)}`;
  const requests = await openRequests(orgId);

  const items = [
    // The plan changes on BOTH org rows (create-org.js writes both, and
    // plan-requests.js `decide` changes both) — the METADATA one conditional
    // on still holding the plan this request read.
    {
      Update: {
        TableName: G.tableName(),
        Key: { PK: tenant.orgPk(orgId), SK: 'METADATA' },
        UpdateExpression: 'SET #plan = :plan, planChangedAt = :now',
        ConditionExpression: '#plan = :from',
        ExpressionAttributeNames: { '#plan': 'plan' },
        ExpressionAttributeValues: { ':plan': FREE, ':now': now, ':from': fromPlan },
      },
    },
    {
      Update: {
        TableName: G.tableName(),
        Key: { PK: tenant.ORGS_INDEX_PK, SK: tenant.orgPk(orgId) },
        UpdateExpression: 'SET #plan = :plan, planChangedAt = :now',
        ExpressionAttributeNames: { '#plan': 'plan' },
        ExpressionAttributeValues: { ':plan': FREE, ':now': now },
      },
    },
    {
      Put: {
        TableName: G.tableName(),
        Item: {
          PK: tenant.orgPk(orgId), SK: `LEDGER#${periodOf(new Date(now))}#PLAN_CHANGE#${changeId}`,
          RecordType: 'LEDGER', kind: 'PLAN_CHANGE', orgId, changeId,
          fromPlan, toPlan: FREE, via: 'leave', code: '',
          at: now, by, byEmail: G.callerEmail(event),
          note: 'Left the plan from Plan & usage.',
          setsKept: view.kept, setsHeld: view.held,
        },
      },
    },
    ...requests.flatMap((r) => withdrawItems(r, now, by)),
  ];

  try {
    await G.db.send(new TransactWriteCommand({ TransactItems: items }));
  } catch (e) {
    if (e && e.name === 'TransactionCanceledException') {
      return G.fail(409, 'The plan changed a moment ago — reload to see where it stands.');
    }
    throw e;
  }

  // The gate reads a counter the stream keeps, and the stream is seconds
  // behind at best. Bring it to the count this request just enforced, so the
  // first thing the free plan does is not refuse on a stale number. Best effort:
  // the stream and the nightly reconciler reach the same figure regardless.
  try {
    await recordSetCount(orgId, await countSets(orgId, { db: G.db, tableName: G.tableName() }), { db: G.db, tableName: G.tableName() });
  } catch (error) {
    console.warn(`⚠️ leave-plan: ${orgId} left its plan; the set counter will catch up from the stream:`, error && error.message);
  }

  console.log(`📉 ${orgId} left the ${fromPlan} plan (${view.kept} kept, ${view.held} held for the public library)`);
  return G.json(200, {
    plan: FREE,
    left: { fromPlan, toPlan: FREE, at: now, changeId },
    withdrawn: requests.map((r) => r.reqId),
    preview: await buildPreview(orgId, { ...org, plan: FREE }),
  });
}

/* ------------------------------------------------------------- make public --- */

/**
 * Start the content check on one version by RE-ENTERING check-question-set.js
 * through its ordinary HTTP entry point — the pattern shared/house-check.js set
 * for Engage's own sets. The whole of that route applies unchanged: the shelf
 * gate, the organisation's daily cap, the lock that stops two checks of one
 * version, the job row and the worker dispatch.
 *
 * SYNCHRONOUS (`RequestResponse`), unlike house-check: the route answers in well
 * under a second (it dispatches its own worker as an Event), and its answer
 * decides what this one says — a 202 is "checking", a 429 is "no checks left
 * today", and either way the person is told.
 *
 * THE AUTHORIZER IS THE CALLER'S OWN, forwarded. The route that received it has
 * already proved this caller is an owner or admin of this organisation, which is
 * exactly the bar the check route applies, so nothing is widened.
 */
async function startCheck(event, setId, version) {
  const FunctionName = String(process.env.CHECK_FUNCTION_NAME || '').trim();
  if (!FunctionName) {
    console.error('⚠️ CHECK_FUNCTION_NAME is not set, so a held set could not be sent to the content check');
    return { statusCode: 503, body: { error: 'The content check is not reachable from here right now. Try again shortly.' } };
  }
  const request = {
    version: '2.0',
    routeKey: 'POST /question-sets/{setId}/check',
    rawPath: `/question-sets/${setId}/check`,
    pathParameters: { setId },
    requestContext: {
      http: { method: 'POST', path: `/question-sets/${setId}/check` },
      authorizer: event?.requestContext?.authorizer,
    },
    body: JSON.stringify({ version, publish: true }),
  };
  try {
    const res = await lambda().send(new InvokeCommand({
      FunctionName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(request)),
    }));
    const raw = res && res.Payload ? Buffer.from(res.Payload).toString('utf8') : '';
    const answer = raw ? JSON.parse(raw) : {};
    if (res && res.FunctionError) throw new Error(answer.errorMessage || res.FunctionError);
    let body = {};
    try { body = typeof answer.body === 'string' ? JSON.parse(answer.body || '{}') : (answer.body || {}); } catch { body = {}; }
    return { statusCode: Number(answer.statusCode) || 500, body };
  } catch (error) {
    console.error(`⚠️ leave-plan: could not start the content check for ${setId}:`, error);
    return { statusCode: 502, body: { error: `The content check could not be started: ${error.message}` } };
  }
}

const MESSAGES = {
  public: (name) => `The public copy of “${name}” is live, so it has been removed from here.`,
  publicNotRemoved: (name) => `The public copy of “${name}” is live, but removing it from here did not finish. Press Make public again to finish.`,
  waiting: () => 'Kept until the public library accepts a copy — then it’s removed from here. Untick to keep it.',
  checking: () => 'Being checked for the public library. Kept until a copy is accepted — then it’s removed from here. Untick to keep it.',
  kept: () => 'Kept. It counts towards your sets again.',
  // Unticking keeps the SET; it does not recall a submission already with the
  // library. There is no withdraw for a check in flight or a queue row a person
  // is looking at, so the sentence says what can still happen, and where the
  // undo for it is.
  keptStillSubmitted: () => 'Kept, and it counts towards your sets again. It is still with the public library, '
    + 'so a copy may yet be published there — you can unpublish it from Question sets.',
};

async function setHold(event, orgId) {
  const auth = await G.authorizeOrg(event, orgId, 'admin');
  if (auth.denied) return auth.denied;
  const body = G.parseBody(event);
  if (!body) return G.fail(400, 'That request body is not JSON.');
  const setId = G.clean(body.setId);
  if (!SET_ID_RE.test(setId)) return G.fail(400, 'Which set?');
  if (typeof body.hold !== 'boolean') return G.fail(400, 'hold must be true or false.');

  const source = setRef({ scope: tenant.ORG, orgId, setId });
  let meta = (await G.db.send(new GetCommand({ TableName: G.tableName(), Key: setMetadataKey(source) }))).Item;
  if (!meta) return G.fail(404, 'That set is not one of this organisation’s.');
  const plainName = async () => String((await decryptItem(orgId, 'set', meta)).name || setId);

  const answer = async (statusCode, extra) => G.json(statusCode, {
    setId, ...extra, preview: await buildPreview(orgId, auth.org),
  });

  /* ---------------------------------------------------------- untick --- */
  if (body.hold === false) {
    const heldVersion = hold.isHeld(meta) ? toVersion(hold.holdOf(meta).version) : toVersion(meta.activeVersion);
    const was = hold.isHeld(meta) ? holdStateOf(await readReview(G.db, G.tableName(), source, heldVersion)) : null;
    await hold.releaseHold(G.db, G.tableName(), source, { reason: 'unticked', version: heldVersion });
    return answer(200, {
      held: false,
      state: 'kept',
      deleted: false,
      message: was === 'checking' || was === 'waiting' ? MESSAGES.keptStillSubmitted() : MESSAGES.kept(),
    });
  }

  /* --------------------------------------------------- the shelf, first --- */
  // The library files every set under exactly one topic, and the check route
  // refuses an unfiled share before it spends anything. Asked for HERE, before
  // anything is held, so a set is never held for a library that cannot take it.
  if (resolveSetTopic(meta.topic) === UNFILED) {
    const offered = body.topic === undefined ? '' : body.topic;
    const topic = normalizeSetTopic(offered);
    if (!topic) {
      return G.json(409, {
        setId,
        needsTopic: true,
        error: offered
          ? setTopicRefusal(offered)
          : 'Choose a topic for it first — the public library files every set under one.',
        topics: SET_TOPIC_IDS.map((id) => ({ id, label: SET_TOPICS[id].label })),
      });
    }
    const stored = ENCRYPTED_FIELDS.set.includes('topic') ? await encryptValue(orgId, topic) : topic;
    await G.db.send(new UpdateCommand({
      TableName: G.tableName(),
      Key: setMetadataKey(source),
      UpdateExpression: 'SET #topic = :topic, updatedAt = :now',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#topic': 'topic' },
      ExpressionAttributeValues: { ':topic': stored, ':now': new Date().toISOString() },
    }));
    meta = { ...meta, topic: stored };
  }

  const { version } = resolvePartitionFromMeta(source, meta, null);
  const review = await readReview(G.db, G.tableName(), source, version);

  /*
   * FLAGGED, AND NOTHING HAS CHANGED SINCE: the library has already said no to
   * exactly this content, and a second check would spend one of today's checks
   * to be told the same. Refused WITHOUT holding — a hold is a promise the set
   * is on its way out, and this one is not.
   */
  if (review.status === STATUS.FLAGGED) {
    const { snapshot } = await liveSnapshot(G.db, G.tableName(), source, meta, version);
    if (!review.contentHash || review.contentHash === snapshot.contentHash) {
      // A hold the worker's flag should already have released (its settle is
      // best effort) is released here, so a flagged set can never sit held.
      if (hold.isHeld(meta)) {
        await hold.releaseHold(G.db, G.tableName(), source, {
          reason: 'flagged', note: 'The content check flagged it, so it was not made public.', version,
        });
      }
      return G.json(409, {
        setId,
        error: 'The content check flagged this version, so the public library will not take it as it is. '
          + 'Edit the flagged questions and try again — or delete it.',
        status: review.status,
        findings: review.findings || [],
      });
    }
  }

  if (!await hold.markHeld(G.db, G.tableName(), source, { version, by: G.callerSub(event) })) {
    return G.fail(404, 'That set is not one of this organisation’s.');
  }

  // Held with nothing moving is the one state this must never leave behind:
  // the set would stop counting while no library ever decided about it.
  const giveBack = () => hold.releaseHold(G.db, G.tableName(), source, { reason: '', version });

  /* ----------------------------------------- passed: publish it now --- */
  if (review.status === STATUS.PASSED) {
    const result = await publishLiveVersion(G.db, G.tableName(), { source, meta, version, resume: true });
    if (result.status === 201) {
      // The name is read BEFORE the settle: a settle that works deletes the row
      // it would otherwise be read from.
      const name = await plainName();
      let deleted = false;
      try {
        deleted = (await hold.settleHeldSet(G.db, G.tableName(), source, { outcome: 'published', version })).action === 'deleted';
      } catch (error) {
        // The copy is live and stays live. The set stays HELD — so it still does
        // not count — and pressing Make public again converges (publish-set.js
        // `resume`) and finishes the delete.
        console.error(`⚠️ leave-plan: ${orgId}/${setId} is public, but removing it did not finish:`, error);
      }
      return answer(200, {
        held: !deleted,
        state: 'public',
        deleted,
        publicSetId: result.body.publicSetId,
        message: deleted ? MESSAGES.public(name) : MESSAGES.publicNotRemoved(name),
      });
    }
    if (result.reason !== 'changed') {
      await giveBack();
      return G.json(result.status, { setId, ...result.body });
    }
    // Changed since it passed: the prose was edited in place, and it goes back
    // through the check exactly as the Share dialog would send it.
  }

  /* ------------------------------------ a person, or a check, is on it --- */
  if (review.status === STATUS.ESCALATED || review.status === STATUS.APPEALED) {
    return answer(200, { held: true, state: 'waiting', deleted: false, message: MESSAGES.waiting() });
  }
  if (review.status === STATUS.CHECKING && !isUnfinished(review)) {
    return answer(200, { held: true, state: 'checking', deleted: false, message: MESSAGES.checking() });
  }

  /* ------------------------------------------------ send it to the check --- */
  const started = await startCheck(event, setId, version);
  if (started.statusCode === 202) {
    return answer(200, {
      held: true, state: 'checking', deleted: false, jobId: started.body.jobId || '', message: MESSAGES.checking(),
    });
  }
  if (started.statusCode === 409 && started.body.status === STATUS.CHECKING) {
    return answer(200, { held: true, state: 'checking', deleted: false, message: MESSAGES.checking() });
  }
  await giveBack();
  return G.json(started.statusCode >= 400 ? started.statusCode : 502, {
    setId,
    error: started.body.error || 'The content check could not be started.',
    ...(started.body.cap ? { cap: started.body.cap } : {}),
  });
}

/* ----------------------------------------------------------------- routing --- */

/** Called by plan-requests.js for any path under `/orgs/{orgId}/plan/leave`. */
async function route(event, orgId, method, path) {
  if (!orgId) return G.fail(400, 'orgId is required.');
  if (/\/plan\/leave\/hold\/?$/.test(path)) {
    if (method === 'POST') return setHold(event, orgId);
    return G.fail(404, 'Endpoint not found');
  }
  if (method === 'GET') return preview(event, orgId);
  if (method === 'POST') return leave(event, orgId);
  return G.fail(404, 'Endpoint not found');
}

module.exports = {
  route, buildPreview, holdStateOf, onPaidPlan, freeAllowance, MESSAGES,
};
