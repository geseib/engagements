/**
 * A CLOSED SURVEY GETS THE WORKIE'S READ, AND THE ROOM CAN ANSWER IT.
 *
 * The owner, 27 Sep 2026: "For polls and Surveys: having the Workie just
 * comment on the results vs what is given about the event — can be brief but
 * thoughtful and provide insights and actions. Also it could make sense to
 * have the ability to provide feedback just like we do for call and answer."
 *
 * A survey has no rounds, so both ride the round machinery at a pseudo-round
 * no real round can have: 000. This suite drives the real handlers — create,
 * open, answer, close, then get-ai-summary's worker, stage-beat, comments and
 * create-report — over one table, with Bedrock stubbed, and pins:
 *
 *   §1 the summary is generated from the FROZEN results (survey-host.js's
 *      surveyResultsPayload, described by survey-digest.js): the prompt the
 *      model is sent carries the counts and the words people wrote, from the
 *      shipped survey default prompt
 *   §2 no name reaches the prompt or the stored summary — not a respondent's,
 *      not a joined player's — in a Named survey, the mode that stores them
 *   §3 it is stored at QUESTION#000#AISummary, sealed for the org, and the room
 *      is told on aiSummaryReady with questionId 000
 *   §4 before the close there is nothing to read: 409 NOT_CLOSED, the room is
 *      told, nothing is written; and a survey has no summary but 000
 *   §5 with no survey default seeded, the data-driven fallback states the
 *      survey's own respondent count — never lessons-learned's empty read
 *   §6 a comment lands on 000 only while the survey is CLOSED: not while it is
 *      open, not on any other round, not once it has ended — and it never
 *      comes back with a name
 *   §7 the feedback round a phone is handed: the questions as rows, the
 *      Workie's read, the comments, and no name anywhere in the body
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const Module = require('module');

const REPO = path.join(__dirname, '..');

/* ---- the model, the prompt bucket and the self-invoke: stubbed by name ---- */

const bedrockCalls = [];
let bedrockReply = null; // null → the stub throws, so the fallback path runs
let s3Bodies = new Map();
const realLoad = Module._load;
const kmsStubs = require('./helpers/tenant-crypto-stub');
const kms = kmsStubs.makeKmsStub();
const byName = new Map([
  ['@aws-sdk/client-bedrock-runtime', {
    BedrockRuntimeClient: class {
      async send(cmd) {
        const body = JSON.parse(cmd.input.body);
        bedrockCalls.push(body);
        if (bedrockReply === null) throw new Error('stub: no model in this check');
        return {
          body: new TextEncoder().encode(JSON.stringify({
            content: [{ text: bedrockReply }], stop_reason: 'end_turn',
          })),
        };
      }
    },
    InvokeModelCommand: class { constructor(i) { this.input = i; } },
  }],
  ['@aws-sdk/client-s3', {
    S3Client: class {
      async send(cmd) {
        const body = s3Bodies.get(cmd.input.Key);
        if (!body) throw new Error(`stub: no S3 object ${cmd.input.Key}`);
        return { Body: { transformToString: async () => JSON.stringify(body) } };
      }
    },
    GetObjectCommand: class { constructor(i) { this.input = i; } },
  }],
  ['@aws-sdk/client-lambda', {
    LambdaClient: class { async send() { return {}; } },
    InvokeCommand: class { constructor(i) { this.input = i; } },
  }],
  ['@aws-sdk/client-kms', kms.exports],
]);
Module._load = function load(request, parent, isMain) {
  if (byName.has(request)) return byName.get(request);
  return realLoad.call(this, request, parent, isMain);
};

const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const sent = [];
installStubs({ table, sent, frames: [] });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
process.env.AWS_REGION = 'us-east-1';
process.env.ACCOUNT_ID = '000000000000';
process.env.AI_PROMPTS_BUCKET = 'prompts-test';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'engagetest-get-ai-summary';
kmsStubs.installTestKeyLoader();

const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const createGame = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const startGame = require(path.join(REPO, 'lambda-functions/game/start-game.js')).handler;
const surveyAnswers = require(path.join(REPO, 'lambda-functions/game/survey-answers.js'));
const surveyHost = require(path.join(REPO, 'lambda-functions/game/survey-host.js'));
const aiSummary = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js')).handler;
const stageBeat = require(path.join(REPO, 'lambda-functions/game/stage-beat.js')).handler;
const comments = require(path.join(REPO, 'lambda-functions/game/comments.js')).handler;
const createReport = require(path.join(REPO, 'lambda-functions/game/create-report.js')).handler;
const SHIPPED = require(path.join(REPO, 'lambda-functions/admin/default-ai-prompts.json'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); fail += 1; }
}

/* ---- fixtures ------------------------------------------------------------ */

const ACME = 'org_acme';
const SET = 'offsite-pulse';
const RESPONDENT = 'Bartholomew Okonkwo-Fitzgerald';
const RESPONDENT_CLIENT = 'zz-workie-read-1';
const SECOND = 'Dana Whitfield';
const SECOND_CLIENT = 'zz-workie-read-2';
const JOINED = 'Amara Quist';
const SECRETS = [RESPONDENT, RESPONDENT_CLIENT, SECOND, SECOND_CLIENT, JOINED];
const WRITTEN = 'Send the slides a day ahead so we can come with questions';

const QUESTIONS = [
  { n: '001', Title: 'How useful was today overall?', kind: 'rating', required: true, scale: '1-5' },
  { n: '002', Title: 'Which part helped most?', kind: 'choice', required: false, options: ['The demo', 'The case studies', 'The Q&A'] },
  { n: '003', Title: 'What would you change?', kind: 'text', required: false, textLength: 'long', maxLength: 500 },
];
const qid = (n) => `c001#${n}`;

async function seedSet() {
  const contentPk = `ORG#${ACME}#SET#${SET}#v1`;
  table.put({
    PK: `ORG#${ACME}#SETS`, SK: `SET#${SET}`, orgId: ACME, name: 'Offsite pulse',
    engagementType: 'survey', activeVersion: 1, versions: [{ version: 1 }],
  });
  table.put({ PK: contentPk, SK: 'CATEGORY#c001', Name: 'Survey', QuestionCount: QUESTIONS.length });
  for (const q of QUESTIONS) {
    const { n, ...fields } = q;
    // eslint-disable-next-line no-await-in-loop
    table.put(await C.encryptItem(ACME, 'question', {
      PK: contentPk, SK: `QUESTION#c001#${n}`, Category: 'Survey', Detail: '', QuestionNumber: n, Active: true, ...fields,
    }));
  }
}

/** The shipped survey default, seeded the way admin/populate-defaults.js writes it. */
function seedSurveyDefault() {
  const prompt = SHIPPED.survey.general;
  const s3Key = 'prompts/survey/survey-default/v1.json';
  table.put({
    PK: 'AIPROMPTS', SK: 'AIPROMPT#survey-default', promptId: 'survey-default', name: prompt.name,
    gameType: 'survey', category: 'general', isDefault: true, status: 'active', s3Key,
    createdAt: '2026-09-27T00:00:00.000Z',
  });
  s3Bodies.set(s3Key, { ...prompt, promptType: 'analysis' });
}
function unseedSurveyDefault() {
  table.store.delete(table.keyOf('AIPROMPTS', 'AIPROMPT#survey-default'));
  s3Bodies = new Map();
}

const hostCtx = (orgId) => ({ authorizer: { lambda: { userId: `user-${orgId}`, orgId, orgRole: 'admin', groups: 'hosts' } } });
const asHost = (orgId, extra = {}) => ({ requestContext: hostCtx(orgId), ...extra });
const bodyOf = (res) => JSON.parse(res.body);

const ROUTES = {
  answers: ['PUT', '/games/{gameId}/survey/answers'],
  close: ['POST', '/games/{gameId}/survey/close'],
  end: ['POST', '/games/{gameId}/survey/end'],
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
const hostCall = (name, gameId) => surveyHost.handler(eventFor(name, gameId, undefined, ACME));
const newRespondent = () => `r_${crypto.randomBytes(16).toString('base64url')}`;
const answer = (gameId, respondentId, q, value, extra = {}) =>
  surveyAnswers.handler(eventFor('answers', gameId, { qid: qid(q), value, respondentId, ...extra }));

async function openSurvey({ names = 'named' } = {}) {
  await seedSet();
  const payload = {
    eventTitle: 'Offsite pulse', gameType: 'survey', questionSetId: SET, questionSetScope: 'org', names,
    engagementInfo: 'A leadership offsite deciding next quarter\'s priorities',
  };
  const res = await createGame(asHost(ACME, { body: JSON.stringify(payload) }));
  assert.strictEqual(res.statusCode, 201, `create failed: ${res.body}`);
  const gameId = bodyOf(res).gameId;
  const started = await startGame(asHost(ACME, { pathParameters: { gameId } }));
  assert.strictEqual(started.statusCode, 200, `start failed: ${started.body}`);
  // Three joined players: two answer (under their names, in a Named survey),
  // one only watches. None of the three may reach the Workie.
  table.put({ PK: `GAME#${gameId}`, SK: `PLAYER#${JOINED}`, PlayerName: JOINED, JoinedAt: '2026-09-27T09:00:00.000Z' });
  table.put({ PK: `GAME#${gameId}`, SK: `PLAYER#${RESPONDENT}`, PlayerName: RESPONDENT, ClientId: RESPONDENT_CLIENT });
  table.put({ PK: `GAME#${gameId}`, SK: `PLAYER#${SECOND}`, PlayerName: SECOND, ClientId: SECOND_CLIENT });
  table.put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#phone-1', ConnectionId: 'phone-1', ConnectionType: 'PLAYER', PlayerName: JOINED });
  return gameId;
}

/** Two people answer, under their names — a Named survey stores them. */
async function answerIt(gameId) {
  const first = { player: { name: RESPONDENT, clientId: RESPONDENT_CLIENT } };
  const second = { player: { name: SECOND, clientId: SECOND_CLIENT } };
  const a = newRespondent(); const b = newRespondent();
  for (const [rid, q, value, who] of [
    [a, '001', 5, first], [b, '001', 3, second], [a, '002', [1], first], [b, '003', WRITTEN, second],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await answer(gameId, rid, q, value, who);
    assert.strictEqual(res.statusCode, 200, `the fixture's answer to ${q} was refused: ${res.body}`);
  }
}

const worker = (gameId, questionId = '000') =>
  aiSummary({ __workerMode: true, gameId, questionId, paddedQuestionNumber: questionId });
const summaryRow = (gameId, n = '000') => table.get(`GAME#${gameId}`, `QUESTION#${n}#AISummary`);

const REPLY = '\n\n- **Two of two found it useful**: the rating came back as printed.\n\n'
  + '## What It Means\n\n- **Prep matters**: *Send the slides a day ahead*.\n\n'
  + '## Next Steps\n\n1. Session lead: send the next deck a day early.';

const beat = (gameId, b) => stageBeat({
  requestContext: { http: { method: 'POST' }, ...hostCtx(ACME) },
  pathParameters: { gameId },
  body: JSON.stringify({ beat: b, questionNumber: 0 }),
});
const postComment = (gameId, over = {}) => comments({
  requestContext: { http: { method: 'POST' }, routeKey: 'POST /games/{gameId}/comments' },
  routeKey: 'POST /games/{gameId}/comments',
  pathParameters: { gameId },
  body: JSON.stringify({
    questionNumber: 0, playerName: JOINED, anchorKind: 'summary', anchorRef: '',
    anchorLabel: 'AI summary', anchorExcerpt: 'Prep matters', text: 'Agree — and send the agenda too.', ...over,
  }),
});
const readComments = (gameId, n = '000') => comments({
  requestContext: { http: { method: 'GET' }, routeKey: 'GET /games/{gameId}/comments' },
  routeKey: 'GET /games/{gameId}/comments',
  pathParameters: { gameId },
  queryStringParameters: { questionNumber: n },
});
const feedbackRound = (gameId) => comments({
  requestContext: { http: { method: 'GET' }, routeKey: 'GET /games/{gameId}/feedback-round' },
  routeKey: 'GET /games/{gameId}/feedback-round',
  pathParameters: { gameId },
  queryStringParameters: {},
});

/* ========================================================================== */

(async () => {
  say('\nsurvey-workie-read: a closed survey gets the Workie\'s read, and a feedback round\n');

  seedSurveyDefault();
  bedrockReply = REPLY;

  /* ------------------------------------------------------------ §1–§3 -- */
  const g = await openSurvey({ names: 'named' });
  await answerIt(g);
  const closed = await hostCall('close', g);
  assert.strictEqual(closed.statusCode, 200, closed.body);

  sent.length = 0;
  bedrockCalls.length = 0;
  const done = await worker(g);

  say('§1 generated from the frozen results, with the shipped survey prompt');
  await check('the worker finishes and one model call is made', () => {
    assert.deepStrictEqual(done, { ok: true, gameId: g, questionId: '000' });
    assert.strictEqual(bedrockCalls.length, 1);
  });
  const prompt = bedrockCalls.length ? bedrockCalls[0].messages[0].content : '';
  // rejects: the survey falling through to the round path (REF/ANSWER rows it
  // does not have) and summarising an empty round.
  await check('the prompt carries every question of the survey, in its order', () => {
    const at = QUESTIONS.map((q) => prompt.indexOf(q.Title));
    assert.ok(at.every((i) => i > -1), `missing a question title: ${at}`);
    assert.deepStrictEqual([...at].sort((x, y) => x - y), at, 'questions out of survey order');
  });
  // rejects: counts worked out anywhere but the aggregate, or a digest that
  // prints no figures at all.
  await check('...with the counts the close froze (2 answered the rating, average 4)', () => {
    assert.ok(/2 answered on a 1-5 scale/.test(prompt), 'the rating\'s n is not printed');
    assert.ok(/Average 4\b/.test(prompt), 'the rating\'s frozen mean is not printed');
    assert.ok(/The case studies: 1 of 1/.test(prompt), 'the choice counts are not printed');
  });
  await check('...and the words people wrote, quoted', () =>
    assert.ok(prompt.includes(`"${WRITTEN}"`), 'the open answer is not in the prompt'));
  await check('...through the shipped survey default, not the call-and-answer one', () => {
    assert.ok(prompt.includes('reading a closed survey back to the room'), 'not the survey prompt');
    assert.ok(!/\{surveyResults\}|\{eventTitle\}/.test(prompt), 'a token was left unsubstituted');
  });
  await check('...with the session\'s own context', () =>
    assert.ok(prompt.includes('deciding next quarter'), 'the event details did not reach the prompt'));

  say('\n§2 no name reaches the model or the stored read');
  // rejects: a digest that reads SURVEY#RESP#/DONE# rows, playerNames built
  // from PLAYER# rows, or a Named survey's names travelling into the prompt.
  await check('the prompt carries no respondent name, clientId or joined player', () => {
    for (const secret of SECRETS) {
      assert.ok(!prompt.includes(secret), `the prompt carries ${secret}`);
    }
  });
  const stored = summaryRow(g);
  await check('nor does the stored summary row, opened', () => {
    const plain = JSON.stringify(kmsStubs.plainRow(ACME, stored || {}));
    for (const secret of SECRETS) {
      assert.ok(!plain.includes(secret), `the stored row carries ${secret}`);
    }
  });

  say('\n§3 stored at 000, sealed, and announced');
  await check('the summary lives at QUESTION#000#AISummary', () => assert.ok(stored, 'no QUESTION#000#AISummary row'));
  // rejects: a survey summary written in the clear on an org's session.
  await check('its prose is sealed for the org, and opens to the model\'s reply', () => {
    assert.ok(C.isEnvelope(stored.MarkdownResponse), 'MarkdownResponse is readable at rest');
    const plain = kmsStubs.plainRow(ACME, stored);
    assert.ok(plain.MarkdownResponse.startsWith('## What the Room Said'), plain.MarkdownResponse.slice(0, 60));
    assert.ok(plain.MarkdownResponse.includes('Session lead: send the next deck'));
    assert.strictEqual(plain.QuestionId, '000');
  });
  await check('the room is told aiSummaryReady for 000', () =>
    assert.ok(sent.some((m) => m.type === 'aiSummaryReady' && m.questionId === '000'), JSON.stringify(sent)));
  // rejects: a round-number sweep that leaves a survey summary on a real
  // round's key, where create-report would file it as round 1.
  await check('and nothing is written on any real round', () =>
    assert.strictEqual(summaryRow(g, '001'), undefined));

  /* ------------------------------------------------------------------ §4 -- */
  say('\n§4 nothing to read before the close, and nothing but 000');
  {
    const open = await openSurvey({ names: 'anonymous' });
    await answer(open, newRespondent(), '001', 4);
    sent.length = 0;
    bedrockCalls.length = 0;
    const early = await worker(open);
    // rejects: reading live SURVEY#RESP# rows before the close froze them —
    // counts that move under the Workie's words.
    await check('an open survey: 409 NOT_CLOSED and no model call', () => {
      assert.strictEqual(early.statusCode, 409, early.body);
      assert.strictEqual(bodyOf(early).code, 'NOT_CLOSED');
      assert.strictEqual(bedrockCalls.length, 0);
    });
    await check('the room is told, so no spinner waits on a summary that is not coming', () =>
      assert.ok(sent.some((m) => m.type === 'aiSummaryError' && m.questionId === '000'), JSON.stringify(sent)));
    await check('and no summary row is written', () => assert.strictEqual(summaryRow(open), undefined));

    const wrong = await worker(g, '001');
    // rejects: a survey summary filed under a real round number.
    await check('a survey asked for a round number other than 000: 400, nothing written', () => {
      assert.strictEqual(wrong.statusCode, 400, wrong.body);
      assert.strictEqual(summaryRow(g, '001'), undefined);
    });
  }

  /* ------------------------------------------------------------------ §5 -- */
  say('\n§5 no survey default seeded: the fallback states the survey\'s own count');
  {
    unseedSurveyDefault();
    bedrockCalls.length = 0;
    const again = await worker(g);
    const plain = kmsStubs.plainRow(ACME, summaryRow(g));
    // rejects: falling back to lessons-learned, which reads ranked responses a
    // survey never has and tells the room nobody answered.
    await check('no model call is made on a prompt that cannot read a survey', () => {
      assert.deepStrictEqual(again, { ok: true, gameId: g, questionId: '000' });
      assert.strictEqual(bedrockCalls.length, 0);
    });
    await check('the data-driven read says how many answered the survey', () =>
      assert.ok(/^2 responses were submitted/.test(plain.SummaryText), plain.SummaryText));
    seedSurveyDefault();
    await worker(g); // put the model's read back for the sections below
  }

  /* ------------------------------------------------------------------ §6 -- */
  say('\n§6 a comment lands on 000 only while the survey is closed');
  {
    const s = await openSurvey({ names: 'named' });
    await answerIt(s);
    const whileOpen = await postComment(s);
    // rejects: comments accepted while the room is still answering.
    await check('while the survey is open: 409', () => assert.strictEqual(whileOpen.statusCode, 409, whileOpen.body));

    await hostCall('close', s);
    await worker(s);
    const opened = await beat(s, 'field-notes');
    await check('the host moves a closed survey to What We Heard at round 0', () => {
      assert.strictEqual(opened.statusCode, 200, opened.body);
      assert.ok(table.get(`GAME#${s}`, 'ROUND#000'), 'no ROUND#000 record');
    });

    const onRead = await postComment(s);
    await check('once closed: a comment on 000 is written (201)', () => assert.strictEqual(onRead.statusCode, 201, onRead.body));
    const onRound = await postComment(s, { questionNumber: 1 });
    // rejects: a gate that opens every round number once any survey closes.
    await check('...but never on any other round number (409)', () => assert.strictEqual(onRound.statusCode, 409, onRound.body));
    const stranger = await postComment(s, { playerName: 'Nobody Joined' });
    await check('...and never from a name that did not join (409)', () => assert.strictEqual(stranger.statusCode, 409, stranger.body));

    const listed = bodyOf(await readComments(s));
    // rejects: a survey comment read back with its author — the composer tells
    // the writer their name is not shown.
    await check('read back, it carries no name', () => {
      assert.strictEqual(listed.comments.length, 1);
      assert.strictEqual(listed.comments[0].text, 'Agree — and send the agenda too.');
      assert.ok(!('playerName' in listed.comments[0]) && !('name' in listed.comments[0]), JSON.stringify(listed.comments[0]));
    });

    /* ---------------------------------------------------------------- §7 -- */
    say('\n§7 the feedback round a phone is handed');
    const notYet = await feedbackRound(s);
    await check('on What We Heard, no feedback round is open yet (409)', () =>
      assert.strictEqual(notYet.statusCode, 409, notYet.body));

    const built = await createReport(asHost(ACME, { pathParameters: { gameId: s } }));
    assert.strictEqual(built.statusCode, 200, built.body);
    await beat(s, 'feedback');
    const fr = await feedbackRound(s);
    const frBody = bodyOf(fr);
    await check('with the feedback beat open: 200, for round 000', () => {
      assert.strictEqual(fr.statusCode, 200, fr.body);
      assert.strictEqual(frBody.questionNumber, '000');
    });
    // rejects: a round shape RoundReport cannot draw (no title, no rows).
    await check('the round is the survey: its title, and one row per question', () => {
      assert.strictEqual(frBody.round.title, 'Offsite pulse');
      assert.strictEqual(frBody.round.answers.length, QUESTIONS.length);
      assert.ok(frBody.round.answers[0].answer.includes(QUESTIONS[0].Title), frBody.round.answers[0].answer);
      assert.ok(frBody.round.answers[2].answer.includes(WRITTEN), 'the open answers are not on the row');
    });
    // rejects: rows read as people's responses — RoundReport printed "Response 3"
    // beside question 3's result (seen in Chromium, 27 Sep 2026).
    await check('...marked as a survey, so the phone titles the rows by question', () =>
      assert.strictEqual(frBody.round.kind, 'survey'));
    await check('...with the Workie\'s read and the comments on it', () => {
      assert.ok(String(frBody.round.aiSummary && frBody.round.aiSummary.markdownResponse).includes('Session lead'));
      assert.strictEqual(frBody.round.comments.length, 1);
    });
    await check('...and no name anywhere in what the phone receives', () => {
      for (const secret of SECRETS) {
        assert.ok(!fr.body.includes(secret), `the feedback round carries ${secret}`);
      }
    });

    await hostCall('end', s);
    const afterEnd = await postComment(s);
    // rejects: comments still accepted after the session has ended.
    await check('once the session has ended: 409', () => assert.strictEqual(afterEnd.statusCode, 409, afterEnd.body));
  }

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
