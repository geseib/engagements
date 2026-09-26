/**
 * GET /games/{gameId}/survey-results — THE READ ROUTE FOR A CLOSED SURVEY.
 *
 * Task 3 of the 2026-09-26 feature sweep. `lambda-functions/game/survey-host.js`
 * already freezes SURVEY#RESULTS at close (survey-aggregate.js counts it); this
 * is the first thing that reads it back. docs/design/survey-redesign/PLAN.md
 * "Phase 3" names the route; RATIONALE.md and _src/results.py (30-results.html,
 * 31-open-text.html) are the design.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 *
 *   §1 authorization: no token or another org's host — 404; the owner — 200
 *   §2 a survey not yet closed — 409 NOT_CLOSED, not a crash
 *   §3 every kind renders from the frozen aggregate: rating (incl. 0–10),
 *      choice (single and multi-with-other), yes/no (with whys), rank, text
 *   §4 PRIVACY: a Named survey's respondent name is searched for in the whole
 *      response body and must not appear, however the shape of the route
 *      changes later — survey-aggregate.js's own header is why this is
 *      possible: only SURVEY#RESULTS and its text pages are read, never a
 *      SURVEY#RESP#/SURVEY#DONE# row
 *   §5 no minimum group size (owner's ruling, 26 Sep 2026): a chart with one
 *      answer, or a text question with one answer, is still returned in full
 *   §6 an empty, closed survey (nobody answered) still returns 200 with n:0
 *      and every question at n:0 — the frontend's "No answers yet" reads this
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

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

const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const createGame = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const startGame = require(path.join(REPO, 'lambda-functions/game/start-game.js')).handler;
const surveyAnswers = require(path.join(REPO, 'lambda-functions/game/survey-answers.js'));
const surveyHost = require(path.join(REPO, 'lambda-functions/game/survey-host.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); fail += 1; }
}

/* ---- fixtures --------------------------------------------------------- */

const ACME = 'org_acme';
const RIVAL = 'org_rival';
const SET = 'staff-pulse';
const SECRET_NAME = 'Bartholomew Okonkwo-Fitzgerald';

/** One of every kind, including a 0–10 rating and a multi-pick choice with Other. */
const QUESTIONS = [
  { n: '001', Title: 'How useful was today overall?', kind: 'rating', required: true, scale: '1-5', lowLabel: 'Not at all', highLabel: 'Very' },
  { n: '002', Title: 'How likely are you to recommend it?', kind: 'rating', required: false, scale: '0-10' },
  { n: '003', Title: 'Which session helped most?', kind: 'choice', required: false, options: ['Keynote', 'Roadmap', 'Panels'], allowOther: true },
  { n: '004', Title: 'What should we keep?', kind: 'choice', required: false, options: ['Venue', 'Food', 'Timing'], allowMultiple: true, maxPicks: 2 },
  { n: '005', Title: 'Was the length right?', kind: 'yesno', required: false, unsure: true, followUpWhen: 'no', followUpPrompt: 'What would you cut?' },
  { n: '006', Title: 'Rank the topics', kind: 'rank', required: false, options: ['Pricing', 'Hiring', 'Roadmap'], rankTop: 2 },
  { n: '007', Title: 'What would you change?', kind: 'text', required: false, textLength: 'long', maxLength: 500 },
];
const qid = (n) => `c001#${n}`;

async function seedSet({ namesDefault, setId = SET, questions = QUESTIONS } = {}) {
  const contentPk = `ORG#${ACME}#SET#${setId}#v1`;
  table.put({
    PK: `ORG#${ACME}#SETS`, SK: `SET#${setId}`, orgId: ACME, name: 'Staff pulse',
    engagementType: 'survey', activeVersion: 1, versions: [{ version: 1 }],
    ...(namesDefault ? { namesDefault } : {}),
  });
  table.put({ PK: contentPk, SK: 'CATEGORY#c001', Name: 'Survey', QuestionCount: questions.length });
  for (const q of questions) {
    const { n, ...fields } = q;
    // eslint-disable-next-line no-await-in-loop
    table.put(await C.encryptItem(ACME, 'question', {
      PK: contentPk, SK: `QUESTION#c001#${n}`, Category: 'Survey', Detail: '', QuestionNumber: n, Active: true, ...fields,
    }));
  }
}

const hostCtx = (orgId) => ({ authorizer: { lambda: { userId: `user-${orgId}`, orgId, orgRole: 'admin', groups: 'hosts' } } });
const asHost = (orgId, extra = {}) => ({ requestContext: hostCtx(orgId), ...extra });

const ROUTES = {
  answers: ['PUT', '/games/{gameId}/survey/answers'],
  submit: ['POST', '/games/{gameId}/survey/submit'],
  close: ['POST', '/games/{gameId}/survey/close'],
  results: ['GET', '/games/{gameId}/survey-results'],
};

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

const crypto = require('crypto');
const newRespondent = () => `r_${crypto.randomBytes(16).toString('base64url')}`;

async function surveySession({ names, setId = SET, questions = QUESTIONS } = {}) {
  await seedSet({ setId, questions });
  const payload = { eventTitle: 'Offsite pulse', gameType: 'survey', questionSetId: setId, questionSetScope: 'org' };
  if (names !== undefined) payload.names = names;
  const res = await createGame(asHost(ACME, { body: JSON.stringify(payload) }));
  assert.strictEqual(res.statusCode, 201, `create failed: ${res.body}`);
  return bodyOf(res).gameId;
}

async function openSurvey(opts) {
  const gameId = await surveySession(opts);
  const res = await startGame(asHost(ACME, { pathParameters: { gameId } }));
  assert.strictEqual(res.statusCode, 200, `start failed: ${res.body}`);
  return gameId;
}

const answer = (gameId, respondentId, q, value, extra = {}) =>
  phone('answers', gameId, { qid: qid(q), value, respondentId, ...extra });

/* ========================================================================== */

(async () => {
  say('\nGET /games/{gameId}/survey-results\n');

  /* ------------------------------------------------------------------ §1 -- */
  say('§1 authorization');

  const closed1 = await openSurvey({});
  const r1 = newRespondent();
  await answer(closed1, r1, '001', 4);
  const closeRes = await host('close', closed1);
  assert.strictEqual(closeRes.statusCode, 200, closeRes.body);

  // rejects: a route open to anyone holding the code, or to another org.
  await check('no token: 404', async () => {
    assert.strictEqual((await surveyHost.handler(eventFor('results', closed1))).statusCode, 404);
  });
  await check('another organisation\'s host: 404', async () => {
    assert.strictEqual((await host('results', closed1, RIVAL)).statusCode, 404);
  });
  await check('an unknown game id: 404', async () => {
    assert.strictEqual((await host('results', '9999')).statusCode, 404);
  });
  await check('the owner: 200', async () => {
    const res = await host('results', closed1);
    assert.strictEqual(res.statusCode, 200, res.body);
  });

  /* ------------------------------------------------------------------ §2 -- */
  say('\n§2 not yet closed');

  const collecting = await openSurvey({});
  await check('an open survey: 409 NOT_CLOSED, not a crash', async () => {
    const res = await host('results', collecting);
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'NOT_CLOSED');
  });
  const neverOpened = await surveySession({});
  await check('a survey that never opened: 409 NOT_CLOSED', async () => {
    assert.strictEqual((await host('results', neverOpened)).statusCode, 409);
  });

  /* ------------------------------------------------------------------ §3 -- */
  say('\n§3 every kind, from the frozen aggregate');

  const g = await openSurvey({});
  const a = newRespondent(); const b = newRespondent(); const c = newRespondent();
  await answer(g, a, '001', 5);
  await answer(g, b, '001', 3);
  await answer(g, a, '002', 9);   // promoter
  await answer(g, b, '002', 4);   // detractor
  await answer(g, a, '003', [0]);
  await answer(g, b, '003', [{ other: 'Something else entirely' }]);
  await answer(g, a, '004', [0, 2]);
  await answer(g, a, '005', { v: 'no', why: 'Ran long' });
  await answer(g, b, '005', { v: 'yes' });
  await answer(g, a, '006', [1, 0]);
  await answer(g, b, '006', [0, 1]);
  await answer(g, a, '007', 'The demo was the best part');
  await answer(g, c, '007', 'More time for questions next time');
  const closed = await host('close', g);
  assert.strictEqual(closed.statusCode, 200, closed.body);
  const results = bodyOf(await host('results', g));

  await check('the shape: gameId, n, finished, names, timestamps, questions', () => {
    assert.strictEqual(results.gameId, g);
    assert.strictEqual(typeof results.n, 'number');
    assert.strictEqual(typeof results.finished, 'number');
    assert.strictEqual(results.names, 'anonymous');
    assert.ok(Array.isArray(results.questions));
    assert.strictEqual(results.questions.length, QUESTIONS.length);
  });

  const byQid = (n) => results.questions.find((x) => x.qid === qid(n));

  await check('rating 1–5 carries its own scale and low/high labels, and the frozen counts', () => {
    const q1 = byQid('001');
    assert.strictEqual(q1.kind, 'rating');
    assert.strictEqual(q1.scale, '1-5');
    assert.strictEqual(q1.lowLabel, 'Not at all');
    assert.strictEqual(q1.highLabel, 'Very');
    assert.strictEqual(q1.result.kind, 'rating');
    assert.strictEqual(q1.result.n, 2);
    assert.strictEqual(q1.result.mean, 4);
  });

  await check('rating 0–10 carries the recommend split', () => {
    const q2 = byQid('002');
    assert.strictEqual(q2.result.scale, '0-10');
    assert.strictEqual(q2.result.detractors, 1);
    assert.strictEqual(q2.result.promoters, 1);
    assert.strictEqual(typeof q2.result.score, 'number');
  });

  await check('choice (single) carries its options, and an Other write-in text', () => {
    const q3 = byQid('003');
    assert.deepStrictEqual(q3.options, ['Keynote', 'Roadmap', 'Panels']);
    assert.strictEqual(q3.result.counts[0], 1);
    assert.strictEqual(q3.result.other, 1);
    assert.strictEqual(q3.texts.length, 1);
    assert.strictEqual(q3.texts[0].text, 'Something else entirely');
  });

  await check('choice (multi) counts every pick', () => {
    const q4 = byQid('004');
    assert.strictEqual(q4.allowMultiple, true);
    assert.strictEqual(q4.result.counts[0], 1);
    assert.strictEqual(q4.result.counts[2], 1);
  });

  await check('yes/no carries the split and files its why under the answer it explains', () => {
    const q5 = byQid('005');
    assert.deepStrictEqual(q5.result.counts, { yes: 1, no: 1, unsure: 0 });
    assert.strictEqual(q5.result.whys.no.length, 1);
    const whyId = q5.result.whys.no[0];
    const found = q5.texts.find((t) => t.id === whyId);
    assert.ok(found, 'the why text is not among this question\'s texts');
    assert.strictEqual(found.text, 'Ran long');
  });

  await check('rank carries average place summing to k(k+1)/2, k = its option count', () => {
    const q6 = byQid('006');
    assert.deepStrictEqual(q6.options, ['Pricing', 'Hiring', 'Roadmap']);
    const k = q6.options.length; // 3, NOT rankTop (2) — rankTop only bounds how many a person places
    const sum = q6.result.avgPlace.reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(sum - (k * (k + 1)) / 2) < 0.01, `avgPlace summed to ${sum}, not k=${k}'s ${(k * (k + 1)) / 2}`);
  });

  await check('text carries every open answer, however few — no minimum group size', () => {
    const q7 = byQid('007');
    assert.strictEqual(q7.result.n, 2);
    assert.strictEqual(q7.texts.length, 2);
    const words = q7.texts.map((t) => t.text).sort();
    assert.deepStrictEqual(words, ['More time for questions next time', 'The demo was the best part']);
  });

  /* ------------------------------------------------------------------ §4 -- */
  say('\n§4 privacy: no name, in Named mode, however the search is shaped');

  const named = await openSurvey({ names: 'named' });
  await answer(named, newRespondent(), '007', 'Great session overall', { player: { name: SECRET_NAME, clientId: 'b-1' } });
  const namedClose = await host('close', named);
  assert.strictEqual(namedClose.statusCode, 200, namedClose.body);
  const namedResults = await host('results', named);

  await check('the response is Named, and still carries no name anywhere in its body', async () => {
    assert.strictEqual(namedResults.statusCode, 200, namedResults.body);
    assert.strictEqual(bodyOf(namedResults).names, 'named');
    assert.ok(!namedResults.body.includes(SECRET_NAME), 'the seeded respondent name leaked into the response body');
    assert.ok(!namedResults.body.includes('b-1'), 'the seeded clientId leaked into the response body');
  });

  /* ------------------------------------------------------------------ §6 -- */
  say('\n§6 an empty, closed survey');

  const empty = await openSurvey({});
  const emptyClose = await host('close', empty);
  assert.strictEqual(emptyClose.statusCode, 200, emptyClose.body);
  const emptyResults = bodyOf(await host('results', empty));

  await check('n:0, every question at n:0, no texts', () => {
    assert.strictEqual(emptyResults.n, 0);
    assert.strictEqual(emptyResults.finished, 0);
    for (const q of emptyResults.questions) {
      assert.strictEqual(q.result.n, 0);
      assert.deepStrictEqual(q.texts, []);
    }
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
