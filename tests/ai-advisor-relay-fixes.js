/**
 * THE RELAY PILOT FIXES TO THE CALL & ANSWER ADVISOR (owner, 2026-10-11;
 * docs/reviews/relay-pilot-ai-advisor-2026-10-11.md).
 *
 *   1. A disagreement is reported when the answers hold one and never
 *      demanded: the prompt file and The Session Advisor both allow "No split".
 *   2. The TASK the room answered reaches the model as {task}: the question's
 *      CustomInstructions, else the set's customInstruction, else the default,
 *      opened through the same decrypt path as the rest of an org's set.
 *   3. {voteTallyByAuthor} names each author's points, and the reply's
 *      name-and-points claims are checked against it: a match is kept, a
 *      mismatch is written once more, and a mismatch that survives is kept and
 *      logged as a structured warning, never a failed request.
 *   4. The reply keeps the writer's "if", quotes at most 15 words, aims for
 *      about 300 words, and ends on "Suggested next steps".
 *   5. The summary row records the model that wrote it (`Model`), and both
 *      reads return it.
 *
 * Drives the REAL worker path against a stubbed table, S3 and Bedrock and a
 * KMS that enforces the key policy (the harness of
 * tests/question-background-workie.js), with the advisor prompt read off disk.
 *
 * rejects: a prompt or voice that demands a split; a {task} that is the title,
 *          or that skips the decrypt; an author line with wrong points; a
 *          correct reply written twice; a wrong one kept without a second try;
 *          a request failed over a slip; a summary row with no Model.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const util = require('util');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

// ---- in-memory table -------------------------------------------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(key(item.PK, item.SK), item);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

/** A GetCommand with a ProjectionExpression returns only those attributes. */
function project(item, input) {
  if (!item || !input.ProjectionExpression) return item;
  const names = input.ExpressionAttributeNames || {};
  const out = {};
  for (const raw of input.ProjectionExpression.split(',')) {
    const attr = names[raw.trim()] || raw.trim();
    if (attr in item) out[attr] = item[attr];
  }
  return out;
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': put(inp.Item); return {};
      case 'get': return { Item: project(store.get(key(inp.Key.PK, inp.Key.SK)), inp) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
        return { Items: items, Count: items.length };
      }
      case 'scan': {
        // findDefaultPromptId's `PK = :pk AND isDefault = :isDefault` shape.
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          (v[':pk'] === undefined || i.PK === v[':pk'])
          && (v[':isDefault'] === undefined || i.isDefault === v[':isDefault']));
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

// ---- S3: the bodies create-ai-prompt.js would have written ------------------
// A key with no body answers bodyless, which makes fetchPromptFromS3 fall back
// to the DynamoDB record's own `template` — how the platform default is served.
const s3Bodies = new Map();
class GetObjectCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      const body = cmd instanceof GetObjectCommand ? s3Bodies.get(cmd.input.Key) : undefined;
      return body === undefined ? {} : { Body: { transformToString: async () => body } };
    }
  },
  GetObjectCommand,
});
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} });
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});

// ---- Bedrock: record each prompt, answer from a queue ------------------------
let bedrockBodies = [];
let replies = [];
let failSecondCall = false;
class InvokeModelCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockBodies.push({ ...JSON.parse(cmd.input.body), modelId: cmd.input.modelId });
      if (failSecondCall && bedrockBodies.length === 2) throw new Error('stub: Bedrock is down for the retry');
      const text = replies.length > 1 ? replies.shift() : replies[0];
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ text }], stop_reason: 'end_turn' })) };
    }
  },
  InvokeModelCommand,
});

// ---- a KMS that behaves the way the key policy will ------------------------
const nodeCrypto = require('crypto');
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrap = (orgId, k) => Buffer.from(JSON.stringify({ orgId, key: k.toString('base64') }), 'utf8');
stub('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const orgId = command.input.EncryptionContext?.orgId;
        assert.ok(orgId, 'GenerateDataKey must bind an orgId');
        const k = nodeCrypto.randomBytes(32);
        return { Plaintext: k, CiphertextBlob: wrap(orgId, k) };
      }
      if (command instanceof DecryptCommand) {
        const ctx = command.input.EncryptionContext?.orgId;
        if (!ctx) throw new Error('AccessDeniedException: no orgId in encryption context');
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        if (blob.orgId !== ctx) throw new Error('InvalidCiphertextException: encryption context mismatch');
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
process.env.AI_PROMPTS_BUCKET = 'test-prompts-bucket';

const crypto = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { ORG: ORG_SCOPE, PLATFORM, promptsMetadataPk } = require(path.join(REPO, 'lambda-functions/game/tenant.js'));
const { setMetadataKey, setPartition } = require(path.join(REPO, 'lambda-functions/game/set-version.js'));
const { handler: getAiSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));
const personas = require(path.join(REPO, 'lambda-functions/game/personas.js'));
const fs = require('fs');

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';

/**
 * Everything the console prints while `fn` runs, formatted as the Lambda
 * runtime formats it for CloudWatch — but with no depth, array or string
 * limit, so a value three objects down still counts.
 */
const FORMAT = { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, breakLength: Infinity };
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
async function captureLogs(fn) {
  const lines = [];
  const orig = {};
  for (const level of LEVELS) {
    orig[level] = console[level];
    console[level] = (...args) => lines.push(util.formatWithOptions(FORMAT, ...args));
  }
  let out;
  try { out = await fn(); } finally { Object.assign(console, orig); }
  return { out, logs: lines.join('\n') };
}

/** How many times `needle` occurs in `hay`. */
const count = (hay, needle) => hay.split(needle).length - 1;

// ---- fixtures ---------------------------------------------------------------
const ORG = 'org_relay';
const ADVISOR = JSON.parse(fs.readFileSync(path.join(REPO, 'sets/prompt-callandanswer-workie-advisor.json'), 'utf8'));
const TASK = 'What change does our team need to introduce, and what would stop it?';
const SET_TASK = 'Name one habit the team should drop.';
const TITLE = 'Catherine the Great Modernizes a Resistant Empire';

async function mintOrg(orgId) {
  const blob = await crypto.createOrgDataKey(orgId);
  put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  crypto.forgetOrg(orgId);
}

// Canonical (SK) order: Lena 0, Maya 1, Omar 2, Theo 3. Scoring 3/2/1.
// Totals: Lena 7, Theo 6, Omar 6, Maya 5.
const PEOPLE = ['Lena Ortiz', 'Maya Chen', 'Omar Patel', 'Theo Brooks'];
const BALLOTS = [
  ['V1', { 3: 1, 0: 2, 2: 3 }],
  ['V2', { 0: 1, 3: 2, 1: 3 }],
  ['V3', { 1: 1, 2: 2, 3: 3 }],
  ['V4', { 2: 1, 0: 2, 1: 3 }],
];

async function seedRound(gameId, { orgId = '', questionTask, setTask, hidden = false, persona } = {}) {
  const scope = orgId ? ORG_SCOPE : PLATFORM;
  const setId = `set-${gameId}`;
  const setRef = { scope, orgId, setId };
  const seal = async (entity, item) => (orgId ? crypto.encryptItem(orgId, entity, item) : item);
  put(await seal('session', {
    PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Relay pilot',
    QuestionSetId: setId, QuestionSetScope: scope,
    ...(orgId ? { orgId } : {}),
    ...(persona ? { PersonaId: persona } : {}),
  }));
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: !hidden,
        ...(hidden ? { Anonymous: true } : {}) });
  put(await seal('set', {
    ...setMetadataKey(setRef), ...(orgId ? { orgId } : {}), activeVersion: 1,
    engagementType: 'call-and-answer', name: 'Relay set',
    ...(setTask ? { customInstruction: setTask } : {}),
  }));
  put(await seal('question', {
    PK: setPartition(setRef, 1), SK: 'QUESTION#c001#001',
    Title: TITLE, Detail: 'The story of a reform the court resisted.', Category: 'Change',
    ...(questionTask ? { CustomInstructions: questionTask } : {}),
  }));
  put({
    PK: `GAME#${gameId}`, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#c001#001',
    SetId: setId, SetVersion: 1, SetScope: scope, ...(orgId ? { SetOrgId: orgId } : {}),
  });
  for (const name of PEOPLE) {
    put(await seal('answer', { PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${name}`, PlayerName: name,
      Answer: `If we pilot it with ${name.split(' ')[0]}'s team first, the court cannot stall it.` }));
  }
  for (const [voter, votes] of BALLOTS) {
    put(await seal('vote', { PK: `GAME#${gameId}`, SK: `QUESTION#001#VOTE#${voter}`, VoterName: voter,
      QuestionNumber: '001', Votes: votes }));
  }
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', promptId: 'lessons-learned', name: ADVISOR.name,
        s3Key: 'none', instructions: ADVISOR.instructions, outputFormat: ADVISOR.outputFormat,
        outputSections: ADVISOR.outputSections });
  const advisor = personas.SEED_PERSONAS.find((p) => p.personaId === 'session-advisor');
  // As the live rows are: seeded before requiredAddition, voice as written then.
  put({ PK: 'AIPROMPTS', SK: 'PERSONA#session-advisor', personaId: 'session-advisor',
        name: advisor.name, voice: advisor.voice });
}

const reply = (votedLine) => '\n\n- **What came back**: four answers open with *If we pilot it*.\n'
  + '- **No split**: every answer names a pilot.\n\n## What the room voted\n'
  + `- **Top of the vote**: ${votedLine}\n- **Worth keeping**: *the court cannot stall it*.\n\n`
  + '## Discussion topics\n1. Which team pilots first?\n\n## Suggested next steps\n'
  + '1. Whoever runs the pilot: draft the one-page plan.';
const RIGHT = reply('Lena Ortiz earned 7 vote points; Theo Brooks and Omar Patel each earned 6 vote points.');
const WRONG = reply('Lena Ortiz and Omar Patel both earned 6 vote points.');

async function runWorker(gameId) {
  bedrockBodies = [];
  let res;
  const { logs } = await captureLogs(async () => {
    try { res = await getAiSummary({ __workerMode: true, gameId, questionId: '001' }); }
    catch (e) { res = { error: e.message }; }
  });
  const prompt = bedrockBodies.length ? bedrockBodies[0].messages[0].content : '';
  return { res, prompt, logs, calls: bedrockBodies.length, modelIds: bedrockBodies.map((b) => b.modelId),
    stored: store.get(key(`GAME#${gameId}`, 'QUESTION#001#AISummary')) };
}

const decryptRow = async (orgId, row) => (orgId ? crypto.decryptItem(orgId, 'aiSummary', row) : row);

(async () => {
  await mintOrg(ORG);

  say('\n1. the prompt file: a split is conditional, the "if" is kept, the reply is short');
  const rules = ADVISOR.instructions;
  await check('rule 5 asks for a split only when two answers conflict, and forbids inventing one', () => {
    assert.match(rules, /NAME A DISAGREEMENT ONLY IF THERE IS ONE/);
    assert.match(rules, /doing one rules out the other/);
    assert.match(rules, /If no two answers conflict, say so plainly/);
    assert.match(rules, /Never invent a split\./);
    assert.ok(!/NAME THE DISAGREEMENT AND LEAVE IT OPEN/.test(rules), 'the old unconditional rule is still there');
  });
  await check('"What the room said" offers **No split** as an equal ending, not a demanded **Not settled**', () => {
    const said = ADVISOR.outputSections.find((s) => s.heading === 'What the room said').guidance;
    assert.ok(!/must start \*\*Not settled\*\*/.test(said), said);
    assert.match(said, /\*\*No split\*\*/);
    assert.match(said, /Never invent a split/);
  });
  await check('discussion topics hand back a split only if there was one', () => {
    const disc = ADVISOR.outputSections.find((s) => s.heading === 'Discussion topics').guidance;
    assert.ok(!/One question must be the split/.test(disc), disc);
    assert.match(disc, /If it said there was none, do not invent one/);
  });
  await check('conditions stay inside quotes, quotes are 15 words or fewer', () => {
    assert.match(rules, /keep the condition in the quote/);
    assert.match(rules, /"If we…" stays "If we…"/);
    assert.match(rules, /A quote is at most 15 words/);
  });
  await check('about 300 words, two or three bullets a section, and the old 400 is gone', () => {
    assert.match(rules, /about 300 words/);
    assert.match(rules, /two or three bullets in each section/);
    assert.ok(!/400 words/.test(rules + ADVISOR.outputFormat));
  });
  await check('the last section is "Suggested next steps", and its steps are suggestions', () => {
    const last = ADVISOR.outputSections[ADVISOR.outputSections.length - 1];
    assert.strictEqual(last.heading, 'Suggested next steps');
    assert.match(rules, /NEXT STEPS ARE SUGGESTIONS, NOT DECISIONS/);
  });
  await check('the material labels the task, the story, and the author tally', () => {
    assert.match(rules, /The task the room was set: \{task\}/);
    assert.match(rules, /The story or topic the task was set against: \{questionTitle\}/);
    assert.match(rules, /Vote points by author: \{voteTallyByAuthor\}/);
    assert.ok(!/The question the room answered/.test(rules));
  });
  await check('the rule count the prompt states is the number of rules it has', () => {
    const n = (rules.match(/^\d+\. /gm) || []).length;
    assert.match(rules, /All sixteen apply/);
    assert.strictEqual(n, 16);
  });
  await check('the parser files "Suggested next steps" as next steps', () => {
    const { parseAIResponse } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));
    const parsed = parseAIResponse('## Summary\ntext here that is long enough to count as a summary.\n\n## Suggested next steps\n1. Ada: draft it.');
    assert.deepStrictEqual(parsed.nextSteps, ['Ada: draft it.']);
  });

  say('\n2. The Session Advisor: the split is conditional, the recommendation is required');
  const advisor = personas.SEED_PERSONAS.find((p) => p.personaId === 'session-advisor');
  await check('its required addition no longer demands a disagreement', () => {
    assert.ok(!/disagreement/i.test(advisor.requiredAddition), advisor.requiredAddition);
    assert.match(advisor.requiredAddition, /suggestion tied to a specific answer/);
    // rejects: the owner the honesty rule forbids inventing, demanded every reply.
    assert.ok(!/named owner/i.test(advisor.requiredAddition), advisor.requiredAddition);
    assert.ok(!/no owner is an opinion/i.test(advisor.voice), advisor.voice);
  });
  await check('its voice reports a disagreement only when there is one', () => {
    assert.match(advisor.voice, /report any real disagreement/);
    assert.match(advisor.voice, /When the answers agree, say so plainly/);
  });
  await check('the directive states the split as conditional, outside the "malformed" self-check', () => {
    const d = personas.buildVoiceDirective(advisor);
    const conditional = d.indexOf('ONLY WHEN THE ANSWERS CALL FOR IT, NEVER DEMANDED');
    assert.ok(conditional > -1, d);
    assert.match(d, /No split: …/);
    assert.match(d, /overrides any line in the voice above/);
    assert.ok(!/must include[^.]*disagreement/.test(d), d);
  });
  await check('no seed persona demands a disagreement in every reply', () => {
    for (const p of personas.SEED_PERSONAS) {
      assert.ok(!/disagreement|split/i.test(p.requiredAddition || ''), `${p.personaId}: ${p.requiredAddition}`);
    }
  });
  await check('a live row without the field still gets the conditional from the seed', async () => {
    const resolved = await personas.resolvePersona({
      hostPersonaId: 'session-advisor',
      loadPersona: async () => ({ personaId: 'session-advisor', name: 'The Session Advisor', voice: 'old voice' }),
    });
    assert.strictEqual(resolved.conditionalAddition, advisor.conditionalAddition);
  });

  say('\n3. {task}: the question\'s own, then the set\'s, then the default — decrypted');
  replies = [RIGHT];
  await seedRound('7101', { orgId: ORG, questionTask: TASK, setTask: SET_TASK, persona: 'session-advisor' });
  await check('the question\'s task is ciphertext at rest', () => {
    const row = store.get(key(setPartition({ scope: ORG_SCOPE, orgId: ORG, setId: 'set-7101' }, 1), 'QUESTION#c001#001'));
    assert.ok(isEnvelope(row.CustomInstructions));
  });
  const org = await runWorker('7101');
  await check('the worker completed', () => assert.strictEqual(org.res && org.res.ok, true, JSON.stringify(org.res)));
  await check('the prompt carries the question\'s task, in the clear, under its label', () =>
    assert.ok(org.prompt.includes(`The task the room was set: ${TASK}`), org.prompt.slice(0, 400)));
  await check('the title is labelled as the story, not as what the room answered', () =>
    assert.ok(org.prompt.includes(`The story or topic the task was set against: ${TITLE}`)));
  await check('no unresolved {task} or {voteTallyByAuthor}', () => {
    assert.ok(!org.prompt.includes('{task}'));
    assert.ok(!org.prompt.includes('{voteTallyByAuthor}'));
  });
  await check('The Session Advisor\'s conditional split rides the prompt', () =>
    assert.ok(org.prompt.includes('ONLY WHEN THE ANSWERS CALL FOR IT, NEVER DEMANDED')));

  replies = [RIGHT];
  await seedRound('7102', { orgId: ORG, setTask: SET_TASK });
  const setOnly = await runWorker('7102');
  await check('with no task of its own, the question takes the set\'s (decrypted)', () =>
    assert.ok(setOnly.prompt.includes(`The task the room was set: ${SET_TASK}`)));

  replies = [RIGHT];
  await seedRound('7103', {});
  const bare = await runWorker('7103');
  await check('with neither, the call-and-answer default, as the phone shows it', () =>
    assert.ok(bare.prompt.includes('The task the room was set: How could you adapt this lesson to your work, project, or team?')));

  await check('task-instruction.js mirrors the phone\'s resolveInstruction defaults and order', () => {
    const phone = fs.readFileSync(path.join(REPO, 'src/src/config/instructions.js'), 'utf8');
    const ti = require(path.join(REPO, 'lambda-functions/game/task-instruction.js'));
    for (const [type, line] of Object.entries(ti.GAME_TYPE_INSTRUCTIONS)) {
      assert.ok(phone.includes(`${/-/.test(type) ? `'${type}'` : type}: '${line}'`), `${type}: ${line}`);
    }
    assert.ok(phone.includes(`'${ti.ART_TITLE_INSTRUCTION}'`), 'art line');
    assert.ok(phone.includes(`const FALLBACK = '${ti.FALLBACK}'`), 'fallback');
    const order = ['q.CustomInstructions', '(setInstruction', 'q.Image', 'GAME_TYPE_INSTRUCTIONS[gameType]'];
    const at = order.map((w) => phone.indexOf(w, phone.indexOf('export function resolveInstruction')));
    assert.deepStrictEqual([...at].sort((a, b) => a - b), at, 'the phone resolves in a different order');
    assert.strictEqual(ti.resolveTask({ CustomInstructions: ' own ' }, 'set', 'poll'), 'own');
    assert.strictEqual(ti.resolveTask({}, ' set ', 'poll'), 'set');
    assert.strictEqual(ti.resolveTask({ Image: 'x.jpg' }, '', 'call-and-answer'), ti.ART_TITLE_INSTRUCTION);
    assert.strictEqual(ti.resolveTask({ CustomInstructions: { v: 1 } }, '', 'poll'), 'Share your opinion:');
    assert.strictEqual(ti.resolveTask(null, '', 'nonsense'), 'Share your response:');
  });

  say('\n4. {voteTallyByAuthor}: one line per author, the right points');
  await check('every author, with their points, highest first', () => {
    const lines = org.prompt.split('Vote points by author: ')[1].split('\n- Every answer')[0];
    assert.ok(lines.includes('- Lena Ortiz: 7 vote points (1 first, 2 second, 0 third)'), lines);
    assert.ok(lines.includes('- Theo Brooks: 6 vote points'), lines);
    assert.ok(lines.includes('- Omar Patel: 6 vote points'), lines);
    assert.ok(lines.includes('- Maya Chen: 5 vote points'), lines);
    assert.ok(lines.indexOf('Lena Ortiz') < lines.indexOf('Maya Chen'));
  });

  await check('a tie reads in the room\'s answer order, in the tally line and the ranked list', () => {
    const { inDisplayOrder } = require(path.join(REPO, 'lambda-functions/game/answer-order.js'));
    const shown = inDisplayOrder(PEOPLE.map((n) => ({ SK: `QUESTION#001#ANSWER#${n}` })), '7101', '001')
      .map((a) => a.SK.split('#ANSWER#')[1]).filter((n) => n === 'Theo Brooks' || n === 'Omar Patel');
    const lines = org.prompt.split('Vote points by author: ')[1].split('\n- Every answer')[0];
    assert.ok(lines.indexOf(shown[0]) < lines.indexOf(shown[1]), lines);
    const ranked = org.prompt.split('Every answer, ranked, with the vote points it earned: ')[1];
    assert.ok(ranked.indexOf(shown[0]) < ranked.indexOf(shown[1]), ranked.slice(0, 400));
  });

  say('\n5. the tally check');
  await check('a reply that matches the tally is written once', () => {
    assert.strictEqual(org.calls, 1);
    assert.ok(!/ai-summary-tally-mismatch/.test(org.logs));
  });

  replies = [WRONG, RIGHT];
  await seedRound('7104', { orgId: ORG, questionTask: TASK });
  const fixed = await runWorker('7104');
  await check('a mismatch is written once more, told the right figures', () => {
    assert.strictEqual(fixed.calls, 2);
    const second = bedrockBodies[1].messages[0].content;
    assert.match(second, /CORRECTION\. An earlier draft/);
    assert.ok(second.includes('- Lena Ortiz: 7 vote points'));
  });
  await check('the corrected reply is the one stored, with no warning', async () => {
    const row = await decryptRow(ORG, fixed.stored);
    assert.ok(row.MarkdownResponse.includes('Lena Ortiz earned 7 vote points'), row.MarkdownResponse);
    assert.ok(!/ai-summary-tally-mismatch/.test(fixed.logs));
  });

  replies = [WRONG];
  await seedRound('7105', { orgId: ORG, questionTask: TASK });
  const stuck = await runWorker('7105');
  await check('a mismatch that survives is NOT a failed request: the reply is kept', async () => {
    assert.strictEqual(stuck.res && stuck.res.ok, true, JSON.stringify(stuck.res));
    assert.strictEqual(stuck.calls, 2, 'regenerated more than once, or not at all');
    const row = await decryptRow(ORG, stuck.stored);
    assert.ok(row.MarkdownResponse.includes('Lena Ortiz and Omar Patel both earned 6'));
    assert.ok(!row.Fallback, 'a slip sent the round to the template');
  });
  await check('…and a structured warning is logged, with figures but no names', () => {
    const line = stuck.logs.split('\n').find((l) => l.includes('"event":"ai-summary-tally-mismatch"'));
    assert.ok(line, stuck.logs.slice(-800));
    const w = JSON.parse(line);
    assert.strictEqual(w.gameId, '7105');
    assert.strictEqual(w.attempts, 2);
    assert.deepStrictEqual(w.mismatches, [{ claimed: [6], actual: 7 }]);
    for (const name of PEOPLE) assert.ok(!line.includes(name.split(' ')[0]), `the warning names ${name}`);
  });

  replies = [WRONG];
  failSecondCall = true;
  await seedRound('7106', { orgId: ORG, questionTask: TASK });
  const down = await runWorker('7106');
  failSecondCall = false;
  await check('if the second call fails, the first reply is kept and the request still succeeds', async () => {
    assert.strictEqual(down.res && down.res.ok, true, JSON.stringify(down.res));
    const row = await decryptRow(ORG, down.stored);
    assert.ok(row.MarkdownResponse.includes('both earned 6'));
    assert.ok(/"kept":"first reply"/.test(down.logs));
  });

  replies = [WRONG];
  await seedRound('7107', { hidden: true });
  const anon = await runWorker('7107');
  await check('an anonymous round names nobody in the tally line and is not checked', () => {
    assert.ok(anon.prompt.includes('Vote points by author: Authors are hidden this round. Name nobody.'));
    for (const name of PEOPLE) assert.ok(!anon.prompt.includes(name), `${name} reached the prompt`);
    assert.strictEqual(anon.calls, 1);
  });

  const { findTallyMismatches } = require(path.join(REPO, 'lambda-functions/game/author-tally.js'));
  const T = [{ name: 'Theo Brooks', points: 7 }, { name: 'Lena Ortiz', points: 6 },
    { name: 'Omar Patel', points: 6 }, { name: 'Maya Chen', points: 5 }];
  await check('the checker catches the pilot\'s slip (two names, one figure)', () =>
    assert.deepStrictEqual(findTallyMismatches("Theo's answer and Omar Patel's answer both earned 6 points.", T),
      [{ name: 'Theo Brooks', claimed: [6], actual: 7 }]));
  await check('the checker reads number words and first names', () =>
    assert.deepStrictEqual(findTallyMismatches('Maya collected seven points.', T),
      [{ name: 'Maya Chen', claimed: [7], actual: 5 }]));
  await check('the checker does not flag correct text', () => {
    for (const ok of [
      '**Lena Ortiz** and **Omar Patel** both earned 6 vote points.',
      "Theo's answer led with 7 of the 18 points cast.",
      'Theo Brooks: list the three points the room raised.',
      'Lena earned 6 points, one fewer than Theo.',
      'Theo Brooks earned 7 vote points. Maya Chen earned 5.',
      'No split: every answer names the pilot.',
      'Omar Patel earned 6 vote points from three voters, including Theo Brooks.',
    ]) assert.deepStrictEqual(findTallyMismatches(ok, T), [], ok);
  });

  say('\n6. Model on the row and in both reads');
  await check('the stored row records the Bedrock model id', () =>
    assert.strictEqual(org.stored.Model, 'us.anthropic.claude-haiku-4-5-20251001-v1:0'));
  await check('it is the model the call used', () =>
    assert.ok(org.modelIds[0].endsWith(`inference-profile/${org.stored.Model}`), org.modelIds[0]));
  await check('the cached read returns it', async () => {
    const res = await getAiSummary({ pathParameters: { gameId: '7101' }, queryStringParameters: { questionId: '001' } });
    assert.strictEqual(JSON.parse(res.body).model, 'us.anthropic.claude-haiku-4-5-20251001-v1:0');
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
