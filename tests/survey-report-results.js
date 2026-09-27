/**
 * SURVEY RESULTS IN THE REPORT — Task 4 of the 2026-09-26 feature sweep.
 *
 * The owner: "this should also be what the report shows, not who filled in
 * the survey." create-report.js now reads a closed survey's results the
 * SAME WAY GET /games/{gameId}/survey-results does —
 * `survey-host.js`'s own exported `surveyResultsPayload`, not a second copy
 * of it — and folds them into `reportData.surveyResults`.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 *
 *   §1 every question's results reach reportData.surveyResults, and no
 *      QUESTION# rows are invented for a survey (detailedQuestions stays [])
 *   §2 a survey that has not closed yet: surveyResults is null, but the
 *      report still succeeds, and surveyNames still reads off METADATA
 *   §3 PRIVACY: for EVERY Names mode (anonymous, finished, named), a seeded
 *      respondent name and clientId never appear anywhere in the report's
 *      JSON body — survey-host.js's `surveyResultsPayload` never opens a
 *      SURVEY#RESP#/SURVEY#DONE# row, so there is nothing here to leak
 *   §4 the stored REPORT snapshot seals surveyResults at rest, for an
 *      organisation's session — the same class of quoted content as
 *      detailedQuestions on the same row
 *   §5 RECOVERY FLOOR: once the live SURVEY#RESULTS row (and its text pages)
 *      have aged out, a report regenerated from the stored snapshot still
 *      carries the last survey results rather than silently losing them —
 *      report-merge.js's own rule, applied here the same way
 *   §6 an Anonymous survey's reportData still carries playerPerformance (who
 *      JOINED) — GameReport.jsx, not this handler, decides whether "Who was
 *      here" belongs beside anonymous answers (gameReport.test.jsx pins that
 *      half)
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

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
installStubs({ table, sent: [], frames: [] });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
kmsStubs.installTestKeyLoader();

const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const createGame = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const startGame = require(path.join(REPO, 'lambda-functions/game/start-game.js')).handler;
const surveyAnswers = require(path.join(REPO, 'lambda-functions/game/survey-answers.js'));
const surveyHost = require(path.join(REPO, 'lambda-functions/game/survey-host.js'));
const createReport = require(path.join(REPO, 'lambda-functions/game/create-report.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); fail += 1; }
}

/* ---- fixtures — a small slice of tests/survey-results-route.js's own ---- */

const ACME = 'org_acme';
const SET = 'staff-pulse';
const SECRET_NAME = 'Bartholomew Okonkwo-Fitzgerald';

const QUESTIONS = [
  { n: '001', Title: 'How useful was today overall?', kind: 'rating', required: true, scale: '1-5' },
  { n: '002', Title: 'What would you change?', kind: 'text', required: false, textLength: 'long', maxLength: 500 },
];
const qid = (n) => `c001#${n}`;

async function seedSet({ setId = SET, questions = QUESTIONS } = {}) {
  const contentPk = `ORG#${ACME}#SET#${setId}#v1`;
  table.put({
    PK: `ORG#${ACME}#SETS`, SK: `SET#${setId}`, orgId: ACME, name: 'Staff pulse',
    engagementType: 'survey', activeVersion: 1, versions: [{ version: 1 }],
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
  close: ['POST', '/games/{gameId}/survey/close'],
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
const hostCall = (name, gameId, org = ACME) => surveyHost.handler(eventFor(name, gameId, undefined, org));
const bodyOf = (res) => JSON.parse(res.body);
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

const isEnvelope = (v) => !!v && typeof v === 'object' && typeof v.ct === 'string' && typeof v.iv === 'string';
const report = async (gameId) => JSON.parse((await createReport({ pathParameters: { gameId } })).body).report;

/* ========================================================================== */

(async () => {
  say('\nsurvey-report-results: create-report.js reads a closed survey the way the results route does\n');

  /* ------------------------------------------------------------------ §1 -- */
  say('§1 every question\'s results reach reportData.surveyResults');
  {
    const g = await openSurvey({});
    const a = newRespondent(); const b = newRespondent();
    await answer(g, a, '001', 5);
    await answer(g, b, '001', 3);
    await answer(g, a, '002', 'The demo was the best part');
    const closed = await hostCall('close', g);
    assert.strictEqual(closed.statusCode, 200, closed.body);

    const out = await createReport({ pathParameters: { gameId: g } });
    await check('create-report returns 200 for a survey session', () =>
      assert.strictEqual(out.statusCode, 200, out.body));
    const rep = JSON.parse(out.body).report;

    await check('gameType is survey', () => assert.strictEqual(rep.gameType, 'survey'));
    // rejects: surveyResults missing, or carrying fewer questions than were asked.
    await check('surveyResults carries every question', () => {
      assert.ok(rep.surveyResults, 'surveyResults is null');
      assert.strictEqual(rep.surveyResults.questions.length, QUESTIONS.length);
    });
    const q1 = rep.surveyResults.questions.find((x) => x.qid === qid('001'));
    await check('the rating question carries its frozen mean', () => {
      assert.strictEqual(q1.kind, 'rating');
      assert.strictEqual(q1.result.n, 2);
      assert.strictEqual(q1.result.mean, 4);
    });
    const q2 = rep.surveyResults.questions.find((x) => x.qid === qid('002'));
    await check('the text question carries the words people wrote', () => {
      assert.strictEqual(q2.texts.length, 1);
      assert.strictEqual(q2.texts[0].text, 'The demo was the best part');
    });
    // rejects: a survey session falling through the trivia/CA rendering path
    // and inventing QUESTION#-shaped rounds it never had.
    await check('no rounds are invented for a survey (detailedQuestions stays empty)', () => {
      assert.deepStrictEqual(rep.detailedQuestions, []);
    });
  }

  /* ------------------------------------------------------------------ §2 -- */
  say('\n§2 not yet closed');
  {
    const g = await openSurvey({});
    const out = await createReport({ pathParameters: { gameId: g } });
    await check('the report still succeeds before a close', () =>
      assert.strictEqual(out.statusCode, 200, out.body));
    const rep = JSON.parse(out.body).report;
    // rejects: create-report throwing, or hanging a 409 off the whole report,
    // because the one survey-specific read came back empty.
    await check('surveyResults is null before a close', () => assert.strictEqual(rep.surveyResults, null));
    // rejects: reading Names only off the frozen row, which does not exist yet.
    await check('surveyNames still reads off METADATA', () => assert.strictEqual(rep.surveyNames, 'anonymous'));
  }

  /* ------------------------------------------------------------------ §3 -- */
  say('\n§3 privacy: no respondent name in the report body, for every Names mode');
  for (const names of ['anonymous', 'finished', 'named']) {
    // eslint-disable-next-line no-await-in-loop
    const g = await openSurvey({ names });
    // eslint-disable-next-line no-await-in-loop
    await answer(g, newRespondent(), '002', 'Great session overall', { player: { name: SECRET_NAME, clientId: 'zz-report-1' } });
    // eslint-disable-next-line no-await-in-loop
    const closed = await hostCall('close', g);
    assert.strictEqual(closed.statusCode, 200, closed.body);
    // eslint-disable-next-line no-await-in-loop
    const out = await createReport({ pathParameters: { gameId: g } });
    // eslint-disable-next-line no-await-in-loop
    await check(`${names}: the report body carries no seeded respondent name or id`, () => {
      assert.strictEqual(out.statusCode, 200, out.body);
      assert.ok(!out.body.includes(SECRET_NAME), `${names} survey report leaked the respondent name`);
      assert.ok(!out.body.includes('zz-report-1'), `${names} survey report leaked the respondent clientId`);
    });
  }

  /* ------------------------------------------------------------------ §4 -- */
  say('\n§4 the stored REPORT snapshot seals surveyResults, for an organisation\'s session');
  {
    const g = await openSurvey({});
    await answer(g, newRespondent(), '002', 'Cannot wait for the next one');
    const closed = await hostCall('close', g);
    assert.strictEqual(closed.statusCode, 200, closed.body);
    await createReport({ pathParameters: { gameId: g } });

    const stored = table.get(`GAME#${g}`, 'REPORT');
    // rejects: surveyResults left off ENCRYPTED_FIELDS.report, so the words
    // people wrote sit in the clear on the one row this table calls "the
    // densest row in the table".
    await check('the stored snapshot seals surveyResults at rest', () =>
      assert.ok(isEnvelope(stored.surveyResults), 'surveyResults is readable at rest on the stored row'));
    const plain = kmsStubs.plainRow(ACME, stored);
    await check('...and decrypts back to the same tallies', () => {
      assert.strictEqual(plain.surveyResults.questions.length, QUESTIONS.length);
      const t = plain.surveyResults.questions.find((x) => x.qid === qid('002'));
      assert.strictEqual(t.texts[0].text, 'Cannot wait for the next one');
    });
  }

  /* ------------------------------------------------------------------ §5 -- */
  say('\n§5 recovery floor: survey results outlive their own live row, the same way rounds do');
  {
    const g = await openSurvey({});
    await answer(g, newRespondent(), '002', 'Send the slides ahead');
    const closed = await hostCall('close', g);
    assert.strictEqual(closed.statusCode, 200, closed.body);
    const first = await report(g);
    assert.ok(first.surveyResults, 'the fixture itself produced no surveyResults to recover');

    // Simulate SURVEY#RESULTS (and its text page) ageing out — DynamoDB's own
    // ttl, thirty days after close — between one report open and the next.
    store.delete(table.keyOf(`GAME#${g}`, 'SURVEY#RESULTS'));
    for (const k of [...store.keys()]) {
      if (k.includes('SURVEY#RESULTS#TEXT#')) store.delete(k);
    }

    const second = await report(g);
    // rejects: the regenerated report silently dropping its survey section —
    // and, worse, WRITING that hollow version over the good snapshot, which
    // is exactly the failure report-merge.js exists to prevent for rounds.
    await check('the regenerated report still carries the earlier survey results', () => {
      assert.ok(second.surveyResults, 'surveyResults was lost once the live row expired');
      assert.strictEqual(second.surveyResults.questions.length, QUESTIONS.length);
      const t = second.surveyResults.questions.find((x) => x.qid === qid('002'));
      assert.strictEqual(t.texts[0].text, 'Send the slides ahead');
    });
  }

  /* ------------------------------------------------------------------ §6 -- */
  say('\n§6 an Anonymous survey\'s reportData still carries who joined');
  {
    const g = await openSurvey({ names: 'anonymous' });
    table.put({ PK: `GAME#${g}`, SK: 'PLAYER#Amara', PlayerName: 'Amara', JoinedAt: '2026-09-20T10:00:00.000Z' });
    await answer(g, newRespondent(), '002', 'Loved it');
    const closed = await hostCall('close', g);
    assert.strictEqual(closed.statusCode, 200, closed.body);
    const rep = await report(g);
    // The decision to LEAVE THE ROSTER OUT of an Anonymous survey's rendered
    // report is GameReport.jsx's (gameReport.test.jsx pins it) — this handler
    // is not the place a name gets withheld twice. playerPerformance is who
    // JOINED, a fact from PLAYER# rows unrelated to the survey's own Names
    // setting, so it travels here exactly as it does for every other game
    // type.
    await check('playerPerformance still lists who joined', () => {
      assert.strictEqual(rep.playerPerformance.length, 1);
      assert.strictEqual(rep.playerPerformance[0].playerName, 'Amara');
    });
  }

  /* ------------------------------------------------------------------ §7 -- */
  say('\n§7 the Workie\'s read of the survey, and the room\'s comments on it, are round 000');
  {
    // The owner, 27 Sep 2026: surveys get the Workie's read and a feedback
    // round. Both live at 000 (get-ai-summary.js, comments.js); the report
    // files them as one entry beside the results, and nothing else.
    const g = await openSurvey({});
    await answer(g, newRespondent(), '001', 4);
    const closed = await hostCall('close', g);
    assert.strictEqual(closed.statusCode, 200, closed.body);
    // A host whose saved preference shows names on rounds: a survey's comments
    // still carry none.
    const meta = table.get(`GAME#${g}`, 'METADATA');
    table.put({ ...meta, HostPreferences: { ...(meta.HostPreferences || {}), anonymousUntilReveal: false } });
    table.put(await C.encryptItem(ACME, 'aiSummary', {
      PK: `GAME#${g}`, SK: 'QUESTION#000#AISummary', QuestionId: '000',
      SummaryText: 'The room found the day useful.', MarkdownResponse: '## What the Room Said\n\n- **Useful**: 4 of 5.',
      DiscussionQuestions: [], NextSteps: [], GeneratedAt: '2026-09-27T10:00:00.000Z',
    }));
    table.put(await C.encryptItem(ACME, 'comment', {
      PK: `GAME#${g}`, SK: 'COMMENT#000#summary#_#000000000000001-aa', GameId: g, QuestionNumber: '000',
      AnchorKind: 'summary', AnchorRef: '', AnchorLabel: 'AI summary', AnchorExcerpt: 'Useful',
      Text: 'Agreed, and send the agenda too.', playerName: SECRET_NAME, name: SECRET_NAME,
      SubmittedAt: '2026-09-27T10:05:00.000Z',
    }));
    const out = await createReport({ pathParameters: { gameId: g } });
    const rep = JSON.parse(out.body).report;
    const read = (rep.detailedQuestions || []).find((q) => q.questionNumber === '000');

    // rejects: the survey's read dropped from the report, or filed as a round.
    await check('detailedQuestions carries exactly one entry, 000', () => {
      assert.strictEqual(rep.detailedQuestions.length, 1, JSON.stringify(rep.detailedQuestions.map((q) => q.questionNumber)));
      assert.ok(read, 'no 000 entry');
    });
    await check('...with the Workie\'s read on it', () =>
      assert.strictEqual(read.aiSummary.markdownResponse, '## What the Room Said\n\n- **Useful**: 4 of 5.'));
    // rejects: a survey comment printed with its author in the host's report.
    await check('...and the comment, with no name', () => {
      assert.strictEqual(read.comments.length, 1);
      assert.strictEqual(read.comments[0].text, 'Agreed, and send the agenda too.');
      assert.ok(!('playerName' in read.comments[0]), JSON.stringify(read.comments[0]));
      assert.ok(!out.body.includes(SECRET_NAME), 'the report body carries the commenter\'s name');
    });
    // rejects: report-merge reading 000's empty `answers` as responses that
    // expired, and heading every survey report "Incomplete record".
    await check('an entry with no responses of its own does not mark the report incomplete', () =>
      assert.strictEqual(rep.reportCompleteness.complete, true, JSON.stringify(rep.reportCompleteness)));
  }

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
