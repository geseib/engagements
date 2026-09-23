/**
 * A SURVEY SESSION, END TO END, THROUGH THE REAL HANDLERS.
 *
 * docs/design/survey-redesign/IMPLEMENTATION-phase-2.md §2 is the contract and
 * §4 "Track A" the list this suite holds. A survey is a session with no rounds:
 *
 *   CREATED ─start─▶ SURVEY#OPEN ─close─▶ SURVEY#CLOSED ─end─▶ ENDED
 *
 * Phones write ONE row per person (`SURVEY#RESP#<respondent>`) through a public
 * handler (game/survey-answers.js); the host drives it through Cognito routes
 * that also ask callerMayDriveSession (game/survey-host.js). Names decides what
 * is written about people and is fixed once the survey opens.
 *
 *   §0  the table double can fail a transaction and hand back a second page
 *   §1  create stores Names; start opens; Names locks when it opens
 *   §2  next-question refuses a survey, however it is asked
 *   §3  GET /survey: the questions, decrypted from the SET's org
 *   §4  every answer is checked against its question before it is kept
 *   §5  an answer is an idempotent overwrite, and the host hears counts only
 *   §6  a phone reaches its own row and nobody else's
 *   §7  the answers are ciphertext at rest
 *   §8  Names: what each mode writes, and what it never writes
 *   §9  Send, and the answers still missing
 *   §10 billing: the second distinct answered question bills, once
 *   §11 close: frozen results, once, from every page, this session only
 *   §12 after close nothing is written — including by a PUT racing the close
 *   §13 the warning, the end, progress and people
 *   §14 get-game and get-game-state report the survey's own facts
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

// KMS, faked, and registered before any handler loads: the set's questions,
// the org's index row and every answer row are envelopes at rest.
const kmsStubs = require('./helpers/tenant-crypto-stub');
const kms = kmsStubs.makeKmsStub();
for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')]) {
  let p;
  try { p = require.resolve('@aws-sdk/client-kms', { paths: [base] }); } catch { continue; }
  require.cache[p] = { id: p, filename: p, loaded: true, exports: kms.exports };
}

const table = createTable();
const store = table.store;
const sent = [];
const frames = [];
installStubs({ table, sent, frames });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
kmsStubs.installTestKeyLoader();

const { startedTtl, DAY } = require(path.join(REPO, 'lambda-functions/game/session-ttl.js'));
const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { SURVEY_OPEN, SURVEY_CLOSED } = require(path.join(REPO, 'lambda-functions/game/survey-names.js'));
const createGame = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const startGame = require(path.join(REPO, 'lambda-functions/game/start-game.js')).handler;
const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js')).handler;
const updateGame = require(path.join(REPO, 'lambda-functions/game/update-game.js')).handler;
const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js')).handler;
const grantHandover = require(path.join(REPO, 'lambda-functions/game/grant-handover.js')).handler;
const getGame = require(path.join(REPO, 'lambda-functions/game/get-game.js')).handler;
const getGameState = require(path.join(REPO, 'lambda-functions/game/get-game-state.js')).handler;
const surveyAnswers = require(path.join(REPO, 'lambda-functions/game/survey-answers.js'));
const surveyHost = require(path.join(REPO, 'lambda-functions/game/survey-host.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); fail += 1; }
}

/* The counting is game/survey-aggregate.js's (Track B), used as it is: close
   is driven through it here, so these checks prove what is FROZEN, and
   tests/survey-aggregate.js proves how it counts. */

/* ---- fixtures ------------------------------------------------------------- */

const ACME = 'org_acme';
const RIVAL = 'org_rival';
const SET = 'staff-pulse';
const CONTENT_PK = `ORG#${ACME}#SET#${SET}#v1`;
const SECRET_TITLE = 'Was the offsite worth the money';
const SECRET_ANSWER = 'The roadmap session ran long and nobody decided anything';

/** The eight questions of the mockups (_src/content.py), one of every kind and scale. */
const QUESTIONS = [
  { n: '001', Title: 'How useful was today overall?', kind: 'rating', required: true, scale: '1-5', lowLabel: 'Not at all', highLabel: 'Very' },
  { n: '002', Title: 'How likely are you to recommend it?', kind: 'rating', required: false, scale: '0-10' },
  { n: '003', Title: 'Which session helped most?', kind: 'choice', required: false, options: ['Keynote', 'Roadmap', 'Panels', 'Workshops', 'Socials'], allowOther: true },
  { n: '004', Title: 'What should we keep?', kind: 'choice', required: false, options: ['Venue', 'Food', 'Timing', 'Format'], allowMultiple: true, maxPicks: 3, allowOther: true },
  { n: '005', Title: SECRET_TITLE, kind: 'yesno', required: false, unsure: true, followUpWhen: 'no', followUpPrompt: 'What would you cut?' },
  { n: '006', Title: 'Rank the topics', kind: 'rank', required: false, options: ['Pricing', 'Hiring', 'Roadmap', 'Culture', 'Tools'], rankTop: 3 },
  { n: '007', Title: 'What would you change?', kind: 'text', required: true, textLength: 'long', maxLength: 500 },
  { n: '008', Title: 'One word for today', kind: 'text', required: false, textLength: 'short', maxLength: 20 },
];
const qid = (n) => `c001#${n}`;

async function seedSet({ namesDefault } = {}) {
  table.put({
    PK: `ORG#${ACME}#SETS`, SK: `SET#${SET}`, orgId: ACME, name: 'Staff pulse',
    engagementType: 'survey', activeVersion: 1, versions: [{ version: 1 }],
    ...(namesDefault ? { namesDefault } : {}),
  });
  table.put({ PK: CONTENT_PK, SK: 'CATEGORY#c001', Name: 'Survey', QuestionCount: QUESTIONS.length });
  for (const q of QUESTIONS) {
    const { n, ...fields } = q;
    table.put(await C.encryptItem(ACME, 'question', {
      PK: CONTENT_PK, SK: `QUESTION#c001#${n}`, Category: 'Survey', Detail: '', QuestionNumber: n, Active: true, ...fields,
    }));
  }
}

/** The shape the Lambda authorizer really emits — see tenant-session-scoping.js. */
const hostCtx = (orgId) => ({ authorizer: { lambda: { userId: `user-${orgId}`, orgId, orgRole: 'admin', groups: 'hosts' } } });
const asHost = (orgId, extra = {}) => ({ requestContext: hostCtx(orgId), ...extra });

const ROUTES = {
  get: ['GET', '/games/{gameId}/survey'],
  answers: ['PUT', '/games/{gameId}/survey/answers'],
  submit: ['POST', '/games/{gameId}/survey/submit'],
  mine: ['POST', '/games/{gameId}/survey/mine'],
  close: ['POST', '/games/{gameId}/survey/close'],
  warning: ['POST', '/games/{gameId}/survey/warning'],
  end: ['POST', '/games/{gameId}/survey/end'],
  progress: ['GET', '/games/{gameId}/survey/progress'],
  people: ['GET', '/games/{gameId}/survey/people'],
};

/** An HTTP API v2 event for one of the routes above. `org` null = no token. */
function eventFor(name, gameId, body, org = null) {
  const [method, route] = ROUTES[name];
  const routeKey = `${method} ${route}`;
  return {
    routeKey,
    rawPath: route.replace('{gameId}', gameId),
    requestContext: { routeKey, http: { method }, ...(org ? hostCtx(org) : {}) },
    pathParameters: { gameId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
const phone = (name, gameId, body) => surveyAnswers.handler(eventFor(name, gameId, body));
const host = (name, gameId, org = ACME) => surveyHost.handler(eventFor(name, gameId, undefined, org));
const bodyOf = (res) => JSON.parse(res.body);

const row = (pk, sk) => store.get(table.keyOf(pk, sk));
const partition = (gameId) => [...store.values()].filter((i) => i.PK === `GAME#${gameId}`);
const respRows = (gameId) => partition(gameId).filter((i) => String(i.SK).startsWith('SURVEY#RESP#'));
const doneRows = (gameId) => partition(gameId).filter((i) => String(i.SK).startsWith('SURVEY#DONE#'));
const newRespondent = () => `r_${crypto.randomBytes(16).toString('base64url')}`;

function reset() {
  table.clear();
  table.pageSize = null;
  sent.length = 0;
  frames.length = 0;
  kmsStubs.forgetAllOrgs();
}

/**
 * A CREATED survey session, made by the real creator. Sessions ACCUMULATE in
 * the one table — later sections read earlier sections' rooms, and the creator
 * draws a fresh code (and retries a taken one) exactly as it does live. Each
 * check reads its own session's partition.
 */
async function surveySession({ names, namesDefault, gameType = 'survey', randomizeQuestions } = {}) {
  table.pageSize = null;
  sent.length = 0;
  frames.length = 0;
  await seedSet({ namesDefault });
  const payload = { eventTitle: 'Offsite pulse', gameType, questionSetId: SET, questionSetScope: 'org' };
  if (names !== undefined) payload.names = names;
  if (randomizeQuestions !== undefined) payload.randomizeQuestions = randomizeQuestions;
  const res = await createGame(asHost(ACME, { body: JSON.stringify(payload) }));
  assert.strictEqual(res.statusCode, 201, `create failed: ${res.body}`);
  const { gameId } = bodyOf(res);
  // Two host screens and a phone, as connect.js writes them.
  for (const [id, type] of [['host-1', 'HOST'], ['host-2', 'HOST'], ['phone-1', 'PLAYER']]) {
    table.put({ PK: `GAME#${gameId}`, SK: `CONNECTION#${id}`, ConnectionId: id, ConnectionType: type });
  }
  return gameId;
}

async function openSurvey(opts) {
  const gameId = await surveySession(opts);
  const res = await startGame(asHost(ACME, { pathParameters: { gameId } }));
  assert.strictEqual(res.statusCode, 200, `start failed: ${res.body}`);
  sent.length = 0;
  frames.length = 0;
  return gameId;
}

async function join(gameId, playerName, clientId, extra = {}) {
  const res = await joinGame({ pathParameters: { gameId }, body: JSON.stringify({ playerName, clientId, ...extra }) });
  assert.strictEqual(res.statusCode, 200, `join ${playerName} failed: ${res.body}`);
  return res;
}

/** One answer from an anonymous phone. */
const answer = (gameId, respondentId, q, value, extra = {}) =>
  phone('answers', gameId, { qid: qid(q), value, respondentId, ...extra });

const hostFrames = (type) => frames.filter((f) => f.message.type === type);

/* ========================================================================== */

(async () => {
  say('\nsurvey sessions: open, answer, close, end\n');

  /* ----------------------------------------------------------------------- */
  say('§0 the table double');

  // rejects: a fake that applies a transaction's Put while its ConditionCheck
  // fails — every "closed rejects" check below would then pass vacuously.
  await check('a failed ConditionCheck cancels the whole transaction, with reasons in order', async () => {
    reset();
    table.put({ PK: 'P', SK: 'STATE', State: 'SURVEY#CLOSED' });
    const { TransactWriteCommand } = require('./helpers/player-table');
    let error;
    try {
      await table.doc.send(new TransactWriteCommand({
        TransactItems: [
          { ConditionCheck: { Key: { PK: 'P', SK: 'STATE' }, ConditionExpression: '#s = :open', ExpressionAttributeNames: { '#s': 'State' }, ExpressionAttributeValues: { ':open': SURVEY_OPEN } } },
          { Put: { Item: { PK: 'P', SK: 'ROW', v: 1 } } },
        ],
      }));
    } catch (e) { error = e; }
    assert.ok(error, 'the transaction went through');
    assert.strictEqual(error.name, 'TransactionCanceledException');
    assert.deepStrictEqual(error.CancellationReasons.map((r) => r.Code), ['ConditionalCheckFailed', 'None']);
    assert.strictEqual(row('P', 'ROW'), undefined, 'the Put landed although the check failed');
  });

  // rejects: a fake that never returns a second page, which lets a handler that
  // reads one page and stops pass every check.
  await check('a Query can be forced onto pages and walked with LastEvaluatedKey', async () => {
    reset();
    for (let i = 0; i < 5; i++) table.put({ PK: 'P', SK: `R#${i}` });
    table.pageSize = 2;
    const { QueryCommand } = require('./helpers/player-table');
    const seen = [];
    let ExclusiveStartKey; let pages = 0;
    do {
      const page = await table.doc.send(new QueryCommand({ KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)', ExpressionAttributeValues: { ':pk': 'P', ':sk': 'R#' }, ExclusiveStartKey }));
      seen.push(...page.Items.map((i) => i.SK));
      ExclusiveStartKey = page.LastEvaluatedKey;
      pages += 1;
    } while (ExclusiveStartKey);
    assert.deepStrictEqual(seen, ['R#0', 'R#1', 'R#2', 'R#3', 'R#4']);
    assert.strictEqual(pages, 3);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§1 create, open, and the Names lock');

  // rejects: `names` dropped by create-game's whitelist destructure — the field
  // accepted by the API and silently discarded, the triviaTimer failure.
  await check('create stores the Names the host chose', async () => {
    const g = await surveySession({ names: 'finished' });
    assert.strictEqual(row(`GAME#${g}`, 'METADATA').Names, 'finished');
  });
  // rejects: ignoring the set's own default.
  await check('no Names from the host: the set\'s namesDefault, else anonymous', async () => {
    const g1 = await surveySession({ namesDefault: 'named' });
    assert.strictEqual(row(`GAME#${g1}`, 'METADATA').Names, 'named');
    const g2 = await surveySession({});
    assert.strictEqual(row(`GAME#${g2}`, 'METADATA').Names, 'anonymous');
    const g3 = await surveySession({ names: 'everyone', namesDefault: 'finished' });
    assert.strictEqual(row(`GAME#${g3}`, 'METADATA').Names, 'finished', 'an unknown value should fall to the set default');
  });
  // rejects: shuffling a survey's questions — a survey is read in order.
  await check('a survey is never randomised, whatever the payload says', async () => {
    const g = await surveySession({ randomizeQuestions: true });
    assert.strictEqual(row(`GAME#${g}`, 'METADATA').HostPreferences.randomizeQuestions, false);
    assert.strictEqual(row(`GAME#${g}`, 'CATEGORY#c001#ORDER').IsRandom, false);
  });
  // rejects: Names leaking onto every session type.
  await check('a session that is not a survey carries no Names', async () => {
    const g = await surveySession({ gameType: 'poll', names: 'named' });
    assert.strictEqual(row(`GAME#${g}`, 'METADATA').Names, undefined);
  });

  const opening = await surveySession({ names: 'finished' });
  const startRes = await startGame(asHost(ACME, { pathParameters: { gameId: opening } }));
  // rejects: a survey opening into STARTED, which inherits the lobby's
  // auto-select, the remote's "Start First Round" and next-question.
  await check('start opens a survey: STATE SURVEY#OPEN, and says so', () => {
    assert.strictEqual(startRes.statusCode, 200, startRes.body);
    assert.strictEqual(bodyOf(startRes).state, SURVEY_OPEN);
    assert.strictEqual(row(`GAME#${opening}`, 'STATE').State, SURVEY_OPEN);
  });
  // rejects: OpenedAt not written, or written from a second clock.
  await check('OpenedAt is stamped on METADATA, equal to StartedAt, on the started ttl', () => {
    const state = row(`GAME#${opening}`, 'STATE');
    const meta = row(`GAME#${opening}`, 'METADATA');
    assert.ok(meta.OpenedAt, 'no OpenedAt');
    assert.strictEqual(meta.OpenedAt, state.StartedAt);
    assert.strictEqual(meta.Started, true);
    assert.strictEqual(state.ttl, startedTtl(meta.OpenedAt));
    assert.strictEqual(meta.ttl, startedTtl(meta.OpenedAt));
  });

  // rejects: a phone that loaded the survey before it opened waiting forever.
  await check('opening tells every screen, phones included (gameStateChanged)', () => {
    const f = frames.filter((x) => x.message.type === 'gameStateChanged');
    assert.deepStrictEqual(f.map((x) => x.connectionId).sort(), ['host-1', 'host-2', 'phone-1']);
    assert.strictEqual(f[0].message.newState, SURVEY_OPEN);
    assert.strictEqual(f[0].message.gameId, opening);
  });

  // rejects: Names editable after the survey has opened — the promise on the
  // phone would change under the people it was made to.
  await check('PUT /games/{id} with names after the survey opened: 400', async () => {
    const res = await updateGame(asHost(ACME, { pathParameters: { gameId: opening }, body: JSON.stringify({ names: 'named' }) }));
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.strictEqual(row(`GAME#${opening}`, 'METADATA').Names, 'finished');
  });
  await check('before it opens, names is editable, and only to a known value', async () => {
    const g = await surveySession({ names: 'anonymous' });
    const ok = await updateGame(asHost(ACME, { pathParameters: { gameId: g }, body: JSON.stringify({ names: 'named' }) }));
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.strictEqual(row(`GAME#${g}`, 'METADATA').Names, 'named');
    const bad = await updateGame(asHost(ACME, { pathParameters: { gameId: g }, body: JSON.stringify({ names: 'everyone' }) }));
    assert.strictEqual(bad.statusCode, 400, bad.body);
    assert.strictEqual(row(`GAME#${g}`, 'METADATA').Names, 'named');
  });
  // rejects: names settable on a trivia or poll session.
  await check('names on a session that is not a survey: 400', async () => {
    const g = await surveySession({ gameType: 'poll' });
    const res = await updateGame(asHost(ACME, { pathParameters: { gameId: g }, body: JSON.stringify({ names: 'named' }) }));
    assert.strictEqual(res.statusCode, 400, res.body);
  });
  // rejects: a read-then-write Names edit — the read says CREATED, the survey
  // opens in between, and the write lands anyway.
  await check('a Names edit racing the open loses: its write is conditioned on no OpenedAt', async () => {
    const g = await surveySession({ names: 'anonymous' });
    const held = table.hold((c) => c.type === 'update' && c.input.Key.SK === 'METADATA' && /Names/.test(JSON.stringify(c.input.ExpressionAttributeNames || {})));
    const edit = updateGame(asHost(ACME, { pathParameters: { gameId: g }, body: JSON.stringify({ names: 'named' }) }));
    await held.reached;
    const started = await startGame(asHost(ACME, { pathParameters: { gameId: g } }));
    assert.strictEqual(started.statusCode, 200, started.body);
    held.release();
    const res = await edit;
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.strictEqual(row(`GAME#${g}`, 'METADATA').Names, 'anonymous');
  });

  /* ----------------------------------------------------------------------- */
  say('\n§2 next-question refuses a survey');

  const pressNext = (gameId, body = {}) => nextQuestion(asHost(ACME, { pathParameters: { gameId }, body: JSON.stringify(body) }));
  // rejects: the refusal placed after the state check, where `action: 'skip'`
  // bypasses it and serves ASK#001 of a survey set from CREATED.
  for (const [label, body] of [['from CREATED', {}], ['from CREATED with action skip', { action: 'skip' }], ['with select_specific', { action: 'select_specific', questionId: '001' }]]) {
    await check(`${label}: 409, still CREATED, no round written`, async () => {
      const g = await surveySession({});
      const res = await pressNext(g, body);
      assert.strictEqual(res.statusCode, 409, res.body);
      assert.strictEqual(row(`GAME#${g}`, 'STATE').State, 'CREATED');
      assert.deepStrictEqual(partition(g).filter((i) => /#REF$|^ROUND#/.test(i.SK)).map((i) => i.SK), []);
    });
  }
  await check('an open survey with action skip: 409, still open', async () => {
    const g = await openSurvey({});
    const res = await pressNext(g, { action: 'skip' });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(row(`GAME#${g}`, 'STATE').State, SURVEY_OPEN);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§3 GET /survey');

  await check('404 for a session that is not a survey', async () => {
    const g = await surveySession({ gameType: 'poll' });
    await startGame(asHost(ACME, { pathParameters: { gameId: g } }));
    assert.strictEqual((await phone('get', g)).statusCode, 404);
  });
  await check('409 before it opens', async () => {
    const g = await surveySession({});
    const res = await phone('get', g);
    assert.strictEqual(res.statusCode, 409, res.body);
  });
  const readable = await openSurvey({ names: 'finished' });
  const got = await phone('get', readable);
  // rejects: reading the questions with the caller's org (a phone has none) or
  // the session's, instead of the SET's — every title would be an envelope.
  await check('200: the state, Names, OpenedAt and the questions in set order, decrypted', () => {
    assert.strictEqual(got.statusCode, 200, got.body);
    const b = bodyOf(got);
    assert.strictEqual(b.state, SURVEY_OPEN);
    assert.strictEqual(b.names, 'finished');
    assert.strictEqual(b.openedAt, row(`GAME#${readable}`, 'METADATA').OpenedAt);
    assert.strictEqual(b.warnedAt, null);
    assert.deepStrictEqual(b.questions.map((q) => q.qid), QUESTIONS.map((q) => qid(q.n)));
    assert.deepStrictEqual(b.questions.map((q) => q.n), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.strictEqual(b.questions[4].title, SECRET_TITLE);
    assert.deepStrictEqual(b.questions[2].options, QUESTIONS[2].options);
    assert.strictEqual(b.questions[4].followUpPrompt, 'What would you cut?');
    assert.strictEqual(b.questions[0].required, true);
    assert.strictEqual(b.questions[0].scale, '1-5');
    assert.strictEqual(b.questions[0].lowLabel, 'Not at all');
    assert.strictEqual(b.questions[0].highLabel, 'Very');
    assert.strictEqual(b.questions[3].allowMultiple, true);
    assert.strictEqual(b.questions[3].maxPicks, 3);
    assert.strictEqual(b.questions[2].allowOther, true);
    assert.strictEqual(b.questions[4].unsure, true);
    assert.strictEqual(b.questions[4].followUpWhen, 'no');
    assert.strictEqual(b.questions[6].maxLength, 500);
    assert.strictEqual(b.questions[6].textLength, 'long');
    assert.strictEqual(b.questions[5].rankTop, 3);
  });
  // rejects: a question payload carrying fields another kind would use.
  await check('each question carries its own kind\'s fields and no other kind\'s', () => {
    const [rating, , choice] = bodyOf(got).questions;
    assert.strictEqual(rating.options, undefined);
    assert.strictEqual(choice.scale, undefined);
    assert.strictEqual(choice.kind, 'choice');
  });

  /* ----------------------------------------------------------------------- */
  say('\n§4 answer checks, per kind');

  const cases = [
    // [question, value, ok?, label]
    ['001', 4, true, 'rating in 1-5'],
    ['001', 0, false, 'rating 0 on 1-5'],
    ['001', 6, false, 'rating 6 on 1-5'],
    ['001', 3.5, false, 'a fractional rating'],
    ['001', '4', false, 'a rating sent as a string'],
    ['002', 0, true, 'NPS 0'],
    ['002', 10, true, 'NPS 10'],
    ['002', 11, false, 'NPS 11'],
    ['003', [1], true, 'one pick'],
    ['003', [1, 2], false, 'two picks on pick-one'],
    ['003', [5], false, 'an index past the options'],
    ['003', [-1], false, 'a negative index'],
    ['003', [{ other: 'Lunch' }], true, 'a write-in alone on pick-one'],
    ['003', [], false, 'no pick'],
    ['004', [0, 2, { other: 'Coffee' }], true, 'several picks with a write-in'],
    ['004', [0, 1, 2, 3], false, 'more than maxPicks'],
    ['004', [0, 1, 2, { other: 'Coffee' }], false, 'a write-in that makes one pick too many'],
    ['004', [0, 0], false, 'the same pick twice'],
    ['004', [0, { other: 'x'.repeat(281) }], false, 'a write-in over 280'],
    ['004', [0, { other: '   ' }], true, 'a blank write-in beside a pick (dropped, the pick kept)'],
    ['003', [{ other: '   ' }], false, 'a blank write-in and nothing else'],
    ['005', { v: 'yes' }, true, 'yes'],
    ['005', { v: 'unsure' }, true, 'unsure where it is offered'],
    ['005', { v: 'no', why: 'Too long' }, true, 'no, with the why it asks for'],
    ['005', { v: 'yes', why: 'Because' }, false, 'a why on an answer that does not ask for one'],
    ['005', { v: 'maybe' }, false, 'an answer that is not yes/no/unsure'],
    ['005', 'yes', false, 'a bare string'],
    ['006', [2, 0, 4], true, 'a ranking'],
    ['006', [2, 2], false, 'an item ranked twice'],
    ['006', [9], false, 'an item that is not there'],
    ['006', [], false, 'an empty ranking'],
    ['007', SECRET_ANSWER, true, 'text'],
    ['007', 'x'.repeat(501), false, 'text over maxLength'],
    ['008', 'Brilliant', true, 'short text'],
    ['008', 'x'.repeat(21), false, 'short text over its own maxLength'],
    ['007', 12, false, 'text that is not a string'],
    ['001', null, true, 'null clears'],
  ];
  const checking = await openSurvey({});
  const who = newRespondent();
  for (const [q, value, ok, label] of cases) {
    // rejects: storing whatever the phone sent — the aggregate would count an
    // index that names no option, or a rating off the scale.
    await check(`${ok ? 'accepts' : 'refuses'} ${label}`, async () => {
      const res = await answer(checking, who, q, value);
      assert.strictEqual(res.statusCode, ok ? 200 : 400, `${res.statusCode} ${res.body}`);
    });
  }
  // rejects: storing a value the aggregate would then ignore — the phone would
  // say "Saved" for an answer that is never counted.
  await check('a blank why and a blank write-in are dropped, the rest of the answer kept', async () => {
    await answer(checking, who, '005', { v: 'no', why: '   ' });
    await answer(checking, who, '004', [3, { other: '  ' }]);
    const mine = bodyOf(await phone('mine', checking, { respondentId: who }));
    assert.deepStrictEqual(mine.answers[qid('005')], { v: 'no' });
    assert.deepStrictEqual(mine.answers[qid('004')], [3]);
  });
  await check('a write-in and a why are stored trimmed', async () => {
    await answer(checking, who, '005', { v: 'no', why: '  Too long  ' });
    await answer(checking, who, '003', [{ other: '  Lunch ' }]);
    const mine = bodyOf(await phone('mine', checking, { respondentId: who }));
    assert.deepStrictEqual(mine.answers[qid('005')], { v: 'no', why: 'Too long' });
    assert.deepStrictEqual(mine.answers[qid('003')], [{ other: 'Lunch' }]);
  });
  // rejects: a why after "not sure" — a follow-up of 'any' asks after a yes or
  // a no, and the phone never offers one after unsure.
  await check('followUpWhen any: a why after yes or no, never after unsure', () => {
    const { checkAnswer } = require(path.join(REPO, 'lambda-functions/game/survey-answer.js'));
    const q = { kind: 'yesno', unsure: true, followUpWhen: 'any' };
    assert.strictEqual(checkAnswer(q, { v: 'yes', why: 'a' }).ok, true);
    assert.strictEqual(checkAnswer(q, { v: 'no', why: 'b' }).ok, true);
    assert.strictEqual(checkAnswer(q, { v: 'unsure', why: 'c' }).ok, false);
    assert.strictEqual(checkAnswer(q, { v: 'unsure' }).ok, true);
  });
  await check('an unknown qid, and a qid from outside the pinned set: 400', async () => {
    assert.strictEqual((await phone('answers', checking, { qid: 'c001#099', value: 1, respondentId: who })).statusCode, 400);
    assert.strictEqual((await phone('answers', checking, { qid: 'QUESTION#c001#001', value: 1, respondentId: who })).statusCode, 400);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§5 an idempotent overwrite, and what the host hears');

  const idem = await openSurvey({});
  const ann = newRespondent();
  const first = await answer(idem, ann, '001', 4);
  const again = await answer(idem, ann, '001', 4);
  const changed = await answer(idem, ann, '001', 5);
  // rejects: a row per submission — the aggregate would count one person twice.
  await check('three PUTs to one question: one row, one Answered entry, the latest value', async () => {
    assert.strictEqual(first.statusCode, 200, first.body);
    assert.strictEqual(respRows(idem).length, 1);
    const r = respRows(idem)[0];
    assert.deepStrictEqual(r.Answered, [qid('001')]);
    assert.strictEqual(r.Rev, 3);
    assert.strictEqual(bodyOf(await phone('mine', idem, { respondentId: ann })).answers[qid('001')], 5);
  });
  await check('the PUT answers {qid, saved, rev, answered, complete}', () => {
    assert.deepStrictEqual(bodyOf(again), { qid: qid('001'), saved: true, rev: 2, answered: 1, complete: false });
  });
  // rejects: a progress frame on every keystroke — only a change of WHO has
  // answered WHAT moves the wall.
  await check('one surveyProgress frame per host screen — the overwrites sent none', () => {
    const progress = hostFrames('surveyProgress');
    assert.deepStrictEqual(progress.map((f) => f.connectionId).sort(), ['host-1', 'host-2']);
  });
  // rejects: a progress frame reaching the phones, or carrying anything but counts.
  await check('surveyProgress goes to HOST connections only, and carries counts only', () => {
    const f = hostFrames('surveyProgress')[0].message;
    assert.deepStrictEqual(Object.keys(f).sort(), ['at', 'finished', 'gameId', 'perQuestion', 'started', 'type']);
    assert.strictEqual(f.started, 1);
    assert.strictEqual(f.finished, 0);
    assert.strictEqual(f.perQuestion.length, QUESTIONS.length);
    assert.deepStrictEqual(f.perQuestion[0], { qid: qid('001'), answered: 1 });
    assert.ok(!frames.some((x) => x.connectionId === 'phone-1'), 'a phone was sent a progress frame');
    assert.ok(!JSON.stringify(f).includes(ann), 'a respondent id rode on the wire');
  });
  // rejects: a clear from a phone that never answered creating an empty row —
  // a "started" on the wall, and in Who finished a name on the list, for
  // somebody who has said nothing.
  await check('clearing an answer nobody gave writes nothing and tells nobody', async () => {
    frames.length = 0;
    const res = await answer(idem, newRespondent(), '002', null);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(respRows(idem).length, 1);
    assert.deepStrictEqual(hostFrames('surveyProgress'), []);
  });
  await check('clearing an answer removes it from Answered and moves the wall', async () => {
    frames.length = 0;
    await answer(idem, ann, '001', null);
    assert.deepStrictEqual(respRows(idem)[0].Answered, []);
    assert.strictEqual(hostFrames('surveyProgress').length, 2);
    // Somebody who has taken back every answer is not "started" any more.
    assert.strictEqual(hostFrames('surveyProgress')[0].message.started, 0);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§6 a phone reaches its own row and nobody else\'s');

  const own = await openSurvey({});
  const a = newRespondent(); const b = newRespondent();
  await answer(own, a, '001', 2);
  await answer(own, b, '001', 5);
  await answer(own, b, '007', SECRET_ANSWER);
  // rejects: accepting any string as a respondent id — including a player name
  // or a clientId, which would tie answers to a person in Anonymous.
  for (const bad of [undefined, '', 'Ada', 'r_short', `r_${'a'.repeat(21)}!`, `x_${'a'.repeat(22)}`]) {
    await check(`a malformed respondent id (${JSON.stringify(bad)}): 400`, async () => {
      const res = await phone('answers', own, { qid: qid('001'), value: 3, respondentId: bad });
      assert.strictEqual(res.statusCode, 400, res.body);
    });
  }
  // rejects: `mine` reading a row named by anything but the caller's own id.
  await check('mine returns the caller\'s row and only it', async () => {
    const mineA = bodyOf(await phone('mine', own, { respondentId: a }));
    assert.deepStrictEqual(mineA.answers, { [qid('001')]: 2 });
    assert.ok(!JSON.stringify(mineA).includes(SECRET_ANSWER));
    assert.strictEqual((await phone('mine', own, { respondentId: newRespondent() })).statusCode, 404);
  });
  await check('mine answers {answers, answered, complete, rev}', async () => {
    const m = bodyOf(await phone('mine', own, { respondentId: b }));
    assert.deepStrictEqual(Object.keys(m).sort(), ['answered', 'answers', 'complete', 'rev']);
    assert.deepStrictEqual(m.answered, [qid('001'), qid('007')]);
    assert.strictEqual(m.complete, false);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§7 ciphertext at rest');

  // rejects: Answers written in the clear — what a named person said, readable
  // by a table scan. ENCRYPTED_FIELDS.surveyResponse.
  await check('Answers is an envelope, under the SESSION\'s org', () => {
    const r = respRows(own).find((x) => x.SK.endsWith(b));
    assert.ok(C.isEnvelope(r.Answers), `Answers shipped as ${JSON.stringify(r.Answers)}`);
    assert.strictEqual(kmsStubs.plainRow(ACME, r).Answers[qid('007')], SECRET_ANSWER);
  });
  await check('the sentence appears nowhere in the raw partition, and mine hands it back', async () => {
    assert.ok(!JSON.stringify(partition(own)).includes('roadmap session'), 'answer text at rest');
    const m = bodyOf(await phone('mine', own, { respondentId: b }));
    assert.strictEqual(m.answers[qid('007')], SECRET_ANSWER);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§8 Names: what each mode writes');

  const anon = await openSurvey({ names: 'anonymous' });
  await join(anon, 'Ada', 'browser-ada');
  const anonId = newRespondent();
  await answer(anon, anonId, '001', 4, { player: { name: 'Ada', clientId: 'browser-ada' } });
  await answer(anon, anonId, '007', 'Shorter sessions');
  await phone('submit', anon, { respondentId: anonId, player: { name: 'Ada', clientId: 'browser-ada' } });
  // rejects: a name, a player id or a timestamp on an Anonymous row — any one
  // links a person to what they said.
  await check('Anonymous: the row holds only PK, SK, Answers, Answered, Complete, Rev, Session, ttl', () => {
    const r = respRows(anon)[0];
    const allowed = ['PK', 'SK', 'Answers', 'Answered', 'Complete', 'Rev', 'Session', 'ttl'];
    assert.deepStrictEqual(Object.keys(r).filter((k) => !allowed.includes(k)), []);
    assert.ok(!/Ada|browser-ada/.test(JSON.stringify(r)), 'a name or clientId on the row');
    assert.strictEqual(r.Session, row(`GAME#${anon}`, 'METADATA').CreatedAt);
    assert.strictEqual(r.ttl, startedTtl(row(`GAME#${anon}`, 'METADATA').OpenedAt));
    assert.strictEqual(r.Complete, true);
  });
  await check('Anonymous: no SURVEY#DONE rows', () => assert.deepStrictEqual(doneRows(anon), []));

  const fin = await openSurvey({ names: 'finished' });
  await join(fin, 'Grace', 'browser-grace');
  const graceId = newRespondent();
  const grace = { name: 'Grace', clientId: 'browser-grace' };
  await answer(fin, graceId, '001', 5, { player: grace });
  // rejects: the DONE list written only at Send — "who stopped partway" would
  // be invisible.
  await check('Who finished: the first answer writes DONE "started", with no respondent id', () => {
    const d = doneRows(fin);
    assert.strictEqual(d.length, 1);
    assert.strictEqual(d[0].SK, 'SURVEY#DONE#Grace');
    assert.strictEqual(d[0].Status, 'started');
    assert.ok(!JSON.stringify(d[0]).includes(graceId), 'the DONE row links to the answers');
    assert.strictEqual(d[0].FinishedAt, undefined);
  });
  await check('Who finished: the answer row carries no name and no timestamp', () => {
    const r = respRows(fin)[0];
    assert.ok(!/Grace|browser-grace/.test(JSON.stringify(r)));
    for (const k of Object.keys(r)) assert.ok(!/At$/.test(k), `${k} on a Who-finished answer row`);
  });
  await check('Who finished: the answer needs the player, and the player\'s own browser', async () => {
    assert.strictEqual((await answer(fin, graceId, '002', 7)).statusCode, 400);
    const res = await answer(fin, graceId, '002', 7, { player: { name: 'Grace', clientId: 'someone-else' } });
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.strictEqual(bodyOf(res).code, 'NOT_YOU');
  });
  await check('Who finished: Send moves DONE to "finished" with FinishedAt', async () => {
    await answer(fin, graceId, '007', 'More breaks', { player: grace });
    const res = await phone('submit', fin, { respondentId: graceId, player: grace });
    assert.strictEqual(res.statusCode, 200, res.body);
    const d = doneRows(fin)[0];
    assert.strictEqual(d.Status, 'finished');
    assert.ok(d.FinishedAt);
    assert.strictEqual(respRows(fin)[0].Complete, true);
  });

  const named = await openSurvey({ names: 'named' });
  await join(named, 'Chris', 'chris-phone');
  const chris = { name: 'Chris', clientId: 'chris-phone' };
  await phone('answers', named, { qid: qid('001'), value: 3, player: chris });
  await check('Named: the row is the player\'s, with Name and StartedAt', () => {
    const r = respRows(named)[0];
    assert.strictEqual(r.SK, 'SURVEY#RESP#Chris');
    assert.strictEqual(r.Name, 'Chris');
    assert.ok(r.StartedAt);
    assert.ok(!JSON.stringify(r).includes('chris-phone'), 'a clientId — a capability — on the answer row');
  });
  // rejects: trusting the name a phone sends.
  await check('Named: another browser answering as Chris is refused NOT_YOU', async () => {
    const res = await phone('answers', named, { qid: qid('002'), value: 1, player: { name: 'Chris', clientId: 'not-chris' } });
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.strictEqual(bodyOf(res).code, 'NOT_YOU');
    assert.strictEqual((await phone('answers', named, { qid: qid('002'), value: 1, player: { name: 'Nobody', clientId: 'x' } })).statusCode, 403);
  });
  // rejects: keying Named answers to the browser — a person who changes phone
  // mid-survey would start again, or never get their answers back.
  await check('Named: after a host handover, the new browser\'s mine is the same row; the old one is refused', async () => {
    await grantHandover(asHost(ACME, { pathParameters: { gameId: named, playerName: 'Chris' }, body: JSON.stringify({}) }));
    await join(named, 'Chris', 'chris-laptop', { claimExisting: true });
    const now = await phone('mine', named, { player: { name: 'Chris', clientId: 'chris-laptop' } });
    assert.strictEqual(now.statusCode, 200, now.body);
    assert.strictEqual(bodyOf(now).answers[qid('001')], 3);
    const old = await phone('mine', named, { player: chris });
    assert.strictEqual(old.statusCode, 403, old.body);
  });
  await check('Named: Send stamps CompletedAt', async () => {
    await phone('answers', named, { qid: qid('007'), value: 'Fewer slides', player: { name: 'Chris', clientId: 'chris-laptop' } });
    const res = await phone('submit', named, { player: { name: 'Chris', clientId: 'chris-laptop' } });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(respRows(named)[0].CompletedAt);
    assert.deepStrictEqual(doneRows(named), []);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§9 Send');

  const sending = await openSurvey({});
  const s1 = newRespondent();
  await answer(sending, s1, '002', 9);
  // rejects: Send marking a row complete with a required question unanswered.
  await check('422 with the required questions still missing, in order', async () => {
    const res = await phone('submit', sending, { respondentId: s1 });
    assert.strictEqual(res.statusCode, 422, res.body);
    assert.deepStrictEqual(bodyOf(res).missing, [qid('001'), qid('007')]);
    assert.strictEqual(respRows(sending)[0].Complete, false);
  });
  await check('with them answered: 200 {complete: true}, one progress frame per host', async () => {
    await answer(sending, s1, '001', 1);
    await answer(sending, s1, '007', 'ok');
    frames.length = 0;
    const res = await phone('submit', sending, { respondentId: s1 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).complete, true);
    assert.strictEqual(hostFrames('surveyProgress').length, 2);
    assert.strictEqual(hostFrames('surveyProgress')[0].message.finished, 1);
  });
  await check('answers stay editable after Send, until close', async () => {
    const res = await answer(sending, s1, '002', 3);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).complete, true);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§10 billing');

  const ledger = (gameId) => [...store.values()].filter((i) => i.PK === `ORG#${ACME}` && new RegExp(`^LEDGER#\\d{4}-\\d{2}#SESSION#${gameId}$`).test(i.SK));
  const billing = await openSurvey({});
  const p1 = newRespondent(); const p2 = newRespondent();
  await answer(billing, p1, '001', 3);
  await answer(billing, p2, '001', 4);
  // rejects: billing a survey at its first answer, or at the join.
  await check('one question answered by two people: not billed', () => assert.strictEqual(ledger(billing).length, 0));
  await answer(billing, p1, '002', 8);
  await answer(billing, p2, '003', [1]);
  // rejects: survey answers bypassing the meter (session-count.js was only
  // called from message.js), or billing on every later answer.
  await check('the second distinct answered question writes exactly one ledger row', () => {
    assert.strictEqual(ledger(billing).length, 1);
    assert.ok(row(`GAME#${billing}`, 'METADATA').CountedAt);
  });
  await check('clearing an answer is not answering a question', async () => {
    const g = await openSurvey({});
    const r = newRespondent();
    await answer(g, r, '001', 3);
    await answer(g, r, '002', null);
    assert.strictEqual(ledger(g).length, 0);
    assert.strictEqual(row(`GAME#${g}`, 'METADATA').FirstAnsweredRound, qid('001'));
  });

  /* ----------------------------------------------------------------------- */
  say('\n§11 close');

  const closing = await openSurvey({ names: 'anonymous' });
  const ca = newRespondent(); const cb = newRespondent();
  await answer(closing, ca, '001', 4);
  await answer(closing, ca, '002', 9);          // A: q1 + q2, never sent
  await answer(closing, cb, '001', 5);
  await answer(closing, cb, '007', SECRET_ANSWER);
  await phone('submit', closing, { respondentId: cb }); // B: q1 (+ q7), sent
  // A previous session on the same code left a row behind (the reservation is
  // released at start + 7 days; DynamoDB deletes up to ~48h late).
  table.put({ PK: `GAME#${closing}`, SK: `SURVEY#RESP#${newRespondent()}`, Answers: { [qid('001')]: 1 }, Answered: [qid('001')], Complete: true, Rev: 1, Session: '2026-01-01T00:00:00.000Z' });
  frames.length = 0;

  // rejects: close open to anyone holding the code, or to another org's host.
  await check('no token, or another organisation\'s host: 404, still open', async () => {
    assert.strictEqual((await surveyHost.handler(eventFor('close', closing))).statusCode, 404);
    assert.strictEqual((await host('close', closing, RIVAL)).statusCode, 404);
    assert.strictEqual(row(`GAME#${closing}`, 'STATE').State, SURVEY_OPEN);
  });

  const closed = await host('close', closing);
  const results = row(`GAME#${closing}`, 'SURVEY#RESULTS');
  // rejects: counting a row that stopped partway as not a respondent, or a
  // previous session's row on the same code as one.
  await check('partial answers count, and a previous session\'s row does not', () => {
    assert.strictEqual(closed.statusCode, 200, closed.body);
    const b = bodyOf(closed);
    assert.strictEqual(b.n, 2);
    assert.strictEqual(b.finished, 1);
    assert.strictEqual(b.perQuestion[qid('001')].n, 2);
    assert.strictEqual(b.perQuestion[qid('002')].n, 1);
  });
  await check('the response carries counts, never the words people wrote', () => {
    assert.ok(!closed.body.includes('roadmap session'), 'answer text in the close response');
    assert.strictEqual(bodyOf(closed).texts, undefined);
  });
  // rejects: results that depend on 7-day rows, or quote answers in the clear.
  await check('SURVEY#RESULTS is frozen, self-contained, and its Texts are ciphertext', () => {
    assert.ok(results, 'no SURVEY#RESULTS row');
    const meta = row(`GAME#${closing}`, 'METADATA');
    const state = row(`GAME#${closing}`, 'STATE');
    assert.strictEqual(results.Version, 1);
    assert.strictEqual(results.N, 2);
    assert.strictEqual(results.Finished, 1);
    assert.strictEqual(results.Names, 'anonymous');
    assert.strictEqual(results.OpenedAt, meta.OpenedAt);
    assert.strictEqual(results.ClosedAt, state.ClosedAt);
    assert.strictEqual(results.Session, meta.CreatedAt);
    assert.strictEqual(results.orgId, ACME);
    assert.strictEqual(results.QuestionSetId, SET);
    assert.strictEqual(results.QuestionSetScope, 'org');
    assert.strictEqual(results.QuestionSetVersion, 1);
    assert.strictEqual(results.ttl, Math.floor(Date.parse(results.ClosedAt) / 1000) + 30 * DAY);
    assert.ok(C.isEnvelope(results.Texts), `Texts shipped as ${JSON.stringify(results.Texts)}`);
    assert.ok(!JSON.stringify(partition(closing)).includes('roadmap session'), 'answer text at rest');
    const plain = kmsStubs.plainRow(ACME, results);
    assert.ok(JSON.stringify(plain.Texts).includes(SECRET_ANSWER), 'the open answer was not frozen');
  });
  await check('STATE is SURVEY#CLOSED with ClosedAt', () => {
    assert.strictEqual(row(`GAME#${closing}`, 'STATE').State, SURVEY_CLOSED);
    assert.ok(row(`GAME#${closing}`, 'STATE').ClosedAt);
  });
  await check('surveyClosed reaches every screen with the counts', () => {
    const f = frames.filter((x) => x.message.type === 'surveyClosed');
    assert.deepStrictEqual(f.map((x) => x.connectionId).sort(), ['host-1', 'host-2', 'phone-1']);
    assert.deepStrictEqual(f[0].message, {
      type: 'surveyClosed', gameId: closing, newState: SURVEY_CLOSED, n: 2, finished: 1, closedAt: row(`GAME#${closing}`, 'STATE').ClosedAt,
    });
  });
  // rejects: a second close re-aggregating over rows that may have expired,
  // or telling the room twice.
  await check('a second close returns the stored results and broadcasts nothing', async () => {
    frames.length = 0;
    const res = await host('close', closing);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res).perQuestion, bodyOf(closed).perQuestion);
    assert.strictEqual(bodyOf(res).n, 2);
    assert.deepStrictEqual(frames, []);
  });
  await check('closing a survey that never opened: 409', async () => {
    const g = await surveySession({});
    assert.strictEqual((await host('close', g)).statusCode, 409);
  });
  // rejects: a close that reads one page of a big room.
  await check('close reads every page of answer rows', async () => {
    const g = await openSurvey({});
    for (let i = 0; i < 5; i++) await answer(g, newRespondent(), '001', 3);
    table.pageSize = 2;
    const res = await host('close', g);
    table.pageSize = null;
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).n, 5);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§12 after close nothing is written');

  await check('a PUT after close: 409, and the row is unchanged', async () => {
    const before = JSON.stringify(respRows(closing));
    const res = await answer(closing, ca, '003', [0]);
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(JSON.stringify(respRows(closing)), before);
    assert.strictEqual((await phone('submit', closing, { respondentId: ca })).statusCode, 409);
    // The phone reads 409 on mine as "closed", too.
    const m = await phone('mine', closing, { respondentId: ca });
    assert.strictEqual(m.statusCode, 409, m.body);
    assert.strictEqual(bodyOf(m).code, 'SURVEY_CLOSED');
  });
  // rejects: a PUT that read STATE as open and then wrote after the close —
  // its answer would miss the frozen results and sit in the row as if counted.
  await check('a PUT interleaved with the close fails its ConditionCheck; the row is unchanged', async () => {
    const g = await openSurvey({});
    const r = newRespondent();
    await answer(g, r, '001', 2);
    const before = JSON.stringify(respRows(g));
    const held = table.hold((c) => c.type === 'transactWrite');
    const racing = answer(g, r, '002', 7);
    await held.reached;
    const res = await host('close', g);
    assert.strictEqual(res.statusCode, 200, res.body);
    held.release();
    const late = await racing;
    assert.strictEqual(late.statusCode, 409, late.body);
    assert.strictEqual(JSON.stringify(respRows(g)), before);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§13 warning, end, progress, people');

  const running = await openSurvey({ names: 'finished' });
  await check('the warning: 200 {warnedAt}, on STATE, to every screen', async () => {
    const res = await host('warning', running);
    assert.strictEqual(res.statusCode, 200, res.body);
    const { warnedAt } = bodyOf(res);
    assert.ok(warnedAt);
    assert.strictEqual(row(`GAME#${running}`, 'STATE').WarnedAt, warnedAt);
    const f = frames.filter((x) => x.message.type === 'surveyClosingSoon');
    assert.deepStrictEqual(f.map((x) => x.connectionId).sort(), ['host-1', 'host-2', 'phone-1']);
    assert.deepStrictEqual(f[0].message, { type: 'surveyClosingSoon', gameId: running, minutes: 2, warnedAt });
  });
  await check('the warning needs an open survey and a host of it', async () => {
    const g = await surveySession({});
    assert.strictEqual((await host('warning', g)).statusCode, 409);
    assert.strictEqual((await host('warning', running, RIVAL)).statusCode, 404);
  });
  await check('end refuses an open survey', async () => {
    assert.strictEqual((await host('end', running)).statusCode, 409);
    assert.strictEqual(row(`GAME#${running}`, 'STATE').State, SURVEY_OPEN);
  });

  await join(running, 'Ada', 'b-ada');
  await join(running, 'Bea', 'b-bea');
  await join(running, 'Cal', 'b-cal');
  const adaId = newRespondent(); const beaId = newRespondent();
  await answer(running, adaId, '001', 4, { player: { name: 'Ada', clientId: 'b-ada' } });
  await answer(running, adaId, '007', 'x', { player: { name: 'Ada', clientId: 'b-ada' } });
  await phone('submit', running, { respondentId: adaId, player: { name: 'Ada', clientId: 'b-ada' } });
  await answer(running, beaId, '002', 6, { player: { name: 'Bea', clientId: 'b-bea' } });

  await check('progress: the surveyProgress payload, for the host', async () => {
    const res = await host('progress', running);
    assert.strictEqual(res.statusCode, 200, res.body);
    const p = bodyOf(res);
    assert.strictEqual(p.gameId, running);
    assert.strictEqual(p.started, 2);
    assert.strictEqual(p.finished, 1);
    assert.deepStrictEqual(p.perQuestion.slice(0, 2), [{ qid: qid('001'), answered: 1 }, { qid: qid('002'), answered: 1 }]);
    assert.strictEqual((await host('progress', running, RIVAL)).statusCode, 404);
    assert.strictEqual((await surveyHost.handler(eventFor('progress', running))).statusCode, 404);
  });
  // rejects: names in Anonymous, or a people list open to anyone.
  await check('people, Who finished: finished, partway, not started — by name, nothing else', async () => {
    const res = await host('people', running);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res), { people: [
      { name: 'Ada', status: 'finished' }, { name: 'Bea', status: 'partway' }, { name: 'Cal', status: 'not-started' },
    ] });
    assert.strictEqual((await surveyHost.handler(eventFor('people', running))).statusCode, 404);
  });
  await check('people, Anonymous: 409 — there is no one to list', async () => {
    assert.strictEqual((await host('people', anon)).statusCode, 409);
  });
  await check('people, Named: from the answer rows', async () => {
    const res = await host('people', named);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res).people, [{ name: 'Chris', status: 'finished' }]);
  });

  await host('close', running);
  frames.length = 0;
  const ended = await host('end', running);
  // rejects: a survey that can never reach ENDED — next-question is the only
  // other writer of it and a survey never calls that.
  await check('end: ENDED, and gameEnded to every screen', () => {
    assert.strictEqual(ended.statusCode, 200, ended.body);
    assert.deepStrictEqual(bodyOf(ended), { state: 'ENDED' });
    assert.strictEqual(row(`GAME#${running}`, 'STATE').State, 'ENDED');
    const f = frames.filter((x) => x.message.type === 'gameEnded');
    assert.deepStrictEqual(f.map((x) => x.connectionId).sort(), ['host-1', 'host-2', 'phone-1']);
    assert.deepStrictEqual(f[0].message, { type: 'gameEnded', gameId: running, state: 'ENDED' });
  });
  await check('end again: 200, told nobody twice', async () => {
    frames.length = 0;
    assert.strictEqual((await host('end', running)).statusCode, 200);
    assert.deepStrictEqual(frames, []);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§14 get-game and get-game-state');

  const described = await openSurvey({ names: 'named' });
  await host('warning', described);
  await check('get-game carries names, openedAt and warnedAt for a survey', async () => {
    const b = bodyOf(await getGame({ pathParameters: { gameId: described } }));
    const meta = row(`GAME#${described}`, 'METADATA');
    assert.strictEqual(b.names, 'named');
    assert.strictEqual(b.openedAt, meta.OpenedAt);
    assert.strictEqual(b.warnedAt, row(`GAME#${described}`, 'STATE').WarnedAt);
    assert.strictEqual(b.state, SURVEY_OPEN);
  });
  await check('get-game-state carries them in gameMetadata', async () => {
    const b = bodyOf(await getGameState({ pathParameters: { gameId: described } }));
    assert.strictEqual(b.state, SURVEY_OPEN);
    assert.strictEqual(b.gameType, 'survey');
    assert.strictEqual(b.gameMetadata.names, 'named');
    assert.strictEqual(b.gameMetadata.openedAt, row(`GAME#${described}`, 'METADATA').OpenedAt);
    assert.strictEqual(b.gameMetadata.warnedAt, row(`GAME#${described}`, 'STATE').WarnedAt);
  });
  await check('a session that is not a survey reports no names', async () => {
    const g = await surveySession({ gameType: 'poll' });
    assert.strictEqual(bodyOf(await getGame({ pathParameters: { gameId: g } })).names, null);
  });

  /* ----------------------------------------------------------------------- */
  say('\n§15 the platform console counts a survey');

  const M = require(path.join(REPO, 'lambda-functions/game/platform-metrics.js'));
  const monthRow = () => ({ ...(row(M.METRICS_PK, M.monthSk(M.periodOf(new Date()))) || {}) });
  const beforeOpen = monthRow();
  const counted = await openSurvey({});
  const afterOpen = monthRow();
  const delta = (a, b, k) => (b[k] || 0) - (a[k] || 0);
  // rejects: a survey invisible on the console — it never calls next-question,
  // which is where rounds are counted.
  await check('opening serves all eight questions, for one session that served', () => {
    assert.strictEqual(delta(beforeOpen, afterOpen, 'roundsServed'), QUESTIONS.length);
    assert.strictEqual(delta(beforeOpen, afterOpen, 'sessionsServed'), 1);
    assert.strictEqual(delta(beforeOpen, afterOpen, 'sessionsStarted'), 1);
  });
  const m1 = newRespondent(); const m2 = newRespondent();
  await answer(counted, m1, '001', 3);
  await answer(counted, m1, '002', 6);
  await answer(counted, m2, '001', 5);
  await check('answering writes no metrics', () => {
    assert.strictEqual(delta(afterOpen, monthRow(), 'answersStored'), 0);
  });
  await host('close', counted);
  // rejects: counting people (2) rather than answers given (3).
  await check('closing counts the answers given, once', async () => {
    assert.strictEqual(delta(afterOpen, monthRow(), 'answersStored'), 3);
    await host('close', counted);
    assert.strictEqual(delta(afterOpen, monthRow(), 'answersStored'), 3);
  });

  say(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`crashed: ${e.stack}`); process.exit(1); });
