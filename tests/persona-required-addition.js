/**
 * A PICKED VOICE IS HEARD — each persona's required addition, restated after
 * the format contract.
 *
 * ── THE FAILURE ────────────────────────────────────────────────────────────
 *
 * The owner picked The Historian on a round and got no history. Measured
 * against dev's live default Workie on Haiku 4.5 (2026-09-24, six runs each):
 *
 *   the prompt as it was                                  0/6 with a fact
 *   plus a PERMISSION to use outside knowledge            0/6
 *   plus the voice restated after the contract            1/6
 *   plus a concrete REQUIRED ADDITION after the contract  6/6
 *
 * and The Comedian, as it was, made no joke in 4/4. The voice rides at the top
 * of the prompt (`VOICE:`), and every default template follows it with its own
 * identity and rule 1 — "Every claim comes from the material listed at the
 * end… You know nothing else about this room." Haiku obeys the specific rule
 * over the general voice: games 1935 and 4567 again, which personas.js's
 * buildHostDirective records for the host's instructions.
 *
 * So each persona carries a `requiredAddition` — the one concrete thing the
 * voice must put in the reply — and buildVoiceDirective states it AFTER the
 * contract, as a requirement of the format, with the rule-1 widening that
 * general knowledge needs and a self-check. Before the host's additions, so
 * what the host asked for this session stays the last word before the
 * briefing.
 *
 * The persona ROWS on dev, test and prod were seeded before the field existed
 * and nothing edits them but scripts/seed-personas.js, so a row with no
 * `requiredAddition` takes the seed's, by personaId. A row that carries its
 * own wins.
 *
 * The owner chose facts on Haiku knowing the measured cost: the facts come,
 * and most carry an embellished detail.
 *
 * What this does NOT yet fix, measured the same way: a TONE. The Comedian
 * made no joke in 4/4 with its addition, and The Sports Commentator gave no
 * play-by-play in 4/4. This file pins the mechanism, not that result.
 *
 * rejects: a seed persona other than the house default with no required
 *          addition; an addition that dictates structure; a live-style row
 *          losing the seed's addition; a row's own addition ignored; a
 *          directive for the inferred voice or a context-as-voice; a picked
 *          persona's addition missing from the prompt, placed before the
 *          format contract, or after the host's additions or the briefing;
 *          the directive not widening rule 1 or not asking for a self-check;
 *          a set's persona not getting the same treatment as a host's pick.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
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

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': put(inp.Item); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
        return { Items: items, Count: items.length };
      }
      case 'scan': {
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
// A bodyless S3 object makes fetchPromptFromS3 fall back to the DynamoDB row.
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} });
stub('@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} });
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});
stub('@aws-sdk/client-kms', {
  KMSClient: class { async send() { throw new Error('no KMS: every row here is platform'); } },
  GenerateDataKeyCommand: class {}, DecryptCommand: class {},
});

// ---- Bedrock: record what Workie was told, then fail ------------------------
let bedrockBodies = [];
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockBodies.push(JSON.parse(cmd.input.body));
      throw new Error('stub: no Bedrock in tests');
    }
  },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const {
  SEED_PERSONAS, resolvePersona, buildVoiceDirective,
} = require(path.join(REPO, 'lambda-functions/game/personas.js'));
const { setMetadataKey } = require(path.join(REPO, 'lambda-functions/game/set-version.js'));
const { handler: getAiSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));

// ---- harness ---------------------------------------------------------------
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const seed = (id) => SEED_PERSONAS.find((p) => p.personaId === id);

/** A persona row as dev/test/prod hold it today: seeded before the field existed. */
const liveRow = (id) => {
  const { requiredAddition, ...row } = seed(id); // eslint-disable-line no-unused-vars
  return { PK: 'AIPROMPTS', SK: `PERSONA#${id}`, ...row, status: 'active' };
};

const RULE_ONE = '1. Every claim comes from the material listed at the end. If it is not there, do not say it. You know nothing else about this room.';
const HOST_ASK = 'Relate every point to the Apollo program';
const BRIEF = 'Launch slipped three weeks. The go/no-go meeting had no named owner.';

/** One call-and-answer round at RESULTS from a platform set. */
function seedRound(gameId, { hostPersonaId = null, setPersonaId = null, aiContext = '', briefing = '' } = {}) {
  const setRef = { scope: '', orgId: '', setId: 'launch-retro' };
  put({
    PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Launch retro',
    QuestionSetId: 'launch-retro',
    ...(hostPersonaId ? { PersonaId: hostPersonaId } : {}),
    ...(aiContext ? { AIContext: aiContext } : {}),
    ...(briefing ? { Briefing: { text: briefing } } : {}),
  });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  put({
    ...setMetadataKey(setRef), activeVersion: 1, engagementType: 'call-and-answer',
    name: 'Launch retro', ...(setPersonaId ? { personaId: setPersonaId } : {}),
  });
  put({
    PK: 'SET#launch-retro#v1', SK: 'QUESTION#c001#001',
    Title: 'What is the biggest risk when a team ships on a fixed date?', Category: 'Delivery',
  });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#c001#001', SetId: 'launch-retro', SetVersion: 1 });
  for (const [n, a] of [['Ada', 'Skipping the dress rehearsal'], ['Grace', 'Nobody owns the go/no-go call']]) {
    put({ PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${n}`, PlayerName: n, Answer: a });
  }
}

async function promptFor(gameId) {
  bedrockBodies = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    await getAiSummary({ __workerMode: true, gameId, questionId: '001' });
  } catch { /* worker mode rethrows the stubbed Bedrock failure */ } finally {
    Object.assign(console, orig);
  }
  assert.ok(bedrockBodies.length, 'no prompt reached the model');
  return bedrockBodies[0].messages[0].content;
}

(async () => {
  console.log('\n1. every seed persona but the house default says what it must deliver');
  await check('each non-default seed persona carries a concrete requiredAddition', () => {
    for (const p of SEED_PERSONAS.filter((x) => !x.isDefault)) {
      assert.ok(typeof p.requiredAddition === 'string' && p.requiredAddition.trim().length > 30,
        `${p.personaId} has no usable requiredAddition`);
    }
  });
  await check('no requiredAddition dictates structure', () => {
    for (const p of SEED_PERSONAS) {
      if (p.requiredAddition) assert.ok(!/##|\bheading\b/i.test(p.requiredAddition), `${p.personaId} mentions headings`);
    }
  });
  await check("the Historian's asks for a fact, origin story or precedent", () =>
    assert.ok(/fact/i.test(seed('historian').requiredAddition) && /precedent/i.test(seed('historian').requiredAddition),
      seed('historian').requiredAddition));

  console.log('\n2. resolvePersona carries it, from the row or else the seed');
  const rows = { historian: liveRow('historian'), comedian: { ...liveRow('comedian'), requiredAddition: 'A pun about the winning answer, and only one.' } };
  const loadPersona = async (id) => rows[id] || null;
  await check('a live-style row with no field takes the seed\'s addition', async () => {
    const p = await resolvePersona({ hostPersonaId: 'historian', loadPersona });
    assert.strictEqual(p.requiredAddition, seed('historian').requiredAddition);
  });
  await check('a row that carries its own addition wins over the seed', async () => {
    const p = await resolvePersona({ hostPersonaId: 'comedian', loadPersona });
    assert.strictEqual(p.requiredAddition, 'A pun about the winning answer, and only one.');
  });
  await check('the inferred voice and a context-as-voice carry none', async () => {
    assert.ok(!(await resolvePersona({ loadPersona })).requiredAddition);
    assert.ok(!(await resolvePersona({ gameAiContext: 'Be a pirate', loadPersona })).requiredAddition);
  });

  console.log('\n3. buildVoiceDirective states it with the force of the format');
  await check("'' when there is nothing to require", () => {
    assert.strictEqual(buildVoiceDirective(null), '');
    assert.strictEqual(buildVoiceDirective({ source: 'inferred', voice: 'x', inferred: true }), '');
    assert.strictEqual(buildVoiceDirective({ source: 'host', name: 'The Facilitator', voice: 'x' }), '');
  });
  const directive = buildVoiceDirective({ source: 'host', name: 'The Historian', voice: 'x', requiredAddition: seed('historian').requiredAddition });
  await check('it names the voice and carries the addition', () => {
    assert.ok(directive.includes('The Historian'), directive);
    assert.ok(directive.includes(seed('historian').requiredAddition), directive);
  });
  await check('it is a requirement of the format, not a suggestion', () =>
    assert.ok(/identical in force to the headings/.test(directive) && /malformed/.test(directive), directive));
  await check('it widens rule 1 for general knowledge, and only that', () => {
    assert.ok(directive.includes('the material listed at the end'), directive);
    assert.ok(/general knowledge/i.test(directive), directive);
    assert.ok(/never contradict/i.test(directive), directive);
  });
  await check('it ends on a self-check', () => assert.ok(/before you reply/i.test(directive), directive));

  console.log('\n4. in the prompt the worker sends');
  put(rows.historian);
  put({ PK: 'AIPROMPTS', SK: 'PERSONA#comedian', ...liveRow('comedian') });
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', promptId: 'lessons-learned', s3Key: 'none',
        instructions: `You are reading back one round.\n\nRULES.\n\n${RULE_ONE}\n\n- Answers: {responsesText}`,
        outputFormat: 'Keep it short.' });

  seedRound('8101', { hostPersonaId: 'historian', aiContext: HOST_ASK, briefing: BRIEF });
  const full = await promptFor('8101');
  const at = (s) => full.indexOf(s);
  await check("a host-picked Historian's addition reaches the model", () =>
    assert.ok(full.includes(seed('historian').requiredAddition), 'the addition is not in the prompt'));
  await check('…after the format contract and the template\'s rule 1', () => {
    const d = at("THE VOICE'S REQUIRED ADDITION");
    assert.ok(d > at('FORMAT (this part is not negotiable') && d > at(RULE_ONE), `directive at ${d}`);
  });
  await check("…and before the host's additions and the briefing", () => {
    const d = at("THE VOICE'S REQUIRED ADDITION");
    assert.ok(d < at("THE HOST'S REQUIRED ADDITIONS"), 'the host no longer has the last word before the briefing');
    assert.ok(d < at('THE BRIEFING —'), 'the directive landed after the briefing');
  });
  await check('the voice itself still opens the prompt', () => assert.ok(full.startsWith('VOICE:\n' + seed('historian').voice)));

  seedRound('8102', {});
  const none = await promptFor('8102');
  await check('with no persona picked there is no directive', () =>
    assert.ok(!none.includes("THE VOICE'S REQUIRED ADDITION"), 'an inferred voice got a directive'));

  seedRound('8103', { setPersonaId: 'comedian' });
  const fromSet = await promptFor('8103');
  await check("a set's persona gets the same treatment as a host's pick", () =>
    assert.ok(fromSet.includes(seed('comedian').requiredAddition), 'the Comedian set persona lost its addition'));

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(`CRASH ${e.stack}`); process.exit(1); });
