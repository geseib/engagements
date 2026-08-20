/**
 * Persona controls, end to end, against the REAL handlers.
 *
 * The persona resolver shipped in 3d343663 and then nothing used it: nothing
 * wrote `PersonaId`, nothing read the persona library, and there was no picker
 * anywhere. These tests pin the wiring that was missing, and in particular the
 * three traps it could have fallen into:
 *
 *   1. `create-game.js` destructures a FIXED WHITELIST and
 *      `schema-compliant-manager.js` writes a HARDCODED METADATA item, so a new
 *      field needs three edits and is otherwise dropped in silence —
 *      `triviaTimer` was discarded that way for months (D9).
 *   2. The obvious home for a mid-game switch, `websocket/save-game-context.js`,
 *      `Put`s a METADATA item seeded from the CONTEXT record. Using it would
 *      have destroyed ScoringConfig, Visibility, AccessCode and Started. The
 *      "only PersonaId changed" assertions below exist to catch a regression
 *      back to a Put.
 *   3. `gameTypes` has been stored on every persona since seeding and read by
 *      nobody (D11).
 *
 * Stubbing note (same as tests/ai-prompt-lifecycle.js): poisoning require.cache
 * by resolved path silently misses, because several SDK packages these handlers
 * import exist only in the deployed bundle. Intercept Module._load by request
 * name instead.
 */
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
function stub(name, exports) { stubs.set(name, exports); }

// ---- in-memory table -------------------------------------------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class TransactWriteCommand { constructor(i) { this.input = i; this.type = 'transact'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put':
        store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
        return {};
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'update': {
        const k = key(inp.Key.PK, inp.Key.SK);
        const item = store.get(k);

        // `attribute_exists(PK)` is the guard that stops an Update on a missing
        // key from CREATING the item. Honour it, or the "unknown game 404s"
        // test passes against a handler that would happily conjure a METADATA
        // row containing nothing but a persona.
        if (/attribute_exists\(PK\)/.test(inp.ConditionExpression || '') && !item) {
          const e = new Error('The conditional request failed');
          e.name = 'ConditionalCheckFailedException';
          throw e;
        }
        if (!item) return {};

        const expr = inp.UpdateExpression || '';
        const names = inp.ExpressionAttributeNames || {};
        const values = inp.ExpressionAttributeValues || {};
        const resolve = (t) => (t.startsWith('#') ? names[t] : t);

        const setPart = (expr.match(/SET\s+(.*?)(?=\s+REMOVE\b|$)/i) || [])[1];
        if (setPart) {
          for (const clause of setPart.split(',')) {
            const [lhs, rhs] = clause.split('=').map((s) => s.trim());
            if (lhs && rhs && rhs in values) item[resolve(lhs)] = values[rhs];
          }
        }
        const removePart = (expr.match(/REMOVE\s+(.*)$/i) || [])[1];
        if (removePart) {
          for (const t of removePart.split(',')) delete item[resolve(t.trim())];
        }
        return {};
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const pk = v[':pk'] ?? v[':PK'];
        const prefix = v[':sk'] ?? v[':prefix'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: items, Count: items.length };
      }
      case 'batchWrite': {
        for (const [, requests] of Object.entries(inp.RequestItems || {})) {
          for (const r of requests) {
            if (r.PutRequest) store.set(key(r.PutRequest.Item.PK, r.PutRequest.Item.SK), r.PutRequest.Item);
            if (r.DeleteRequest) store.delete(key(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
          }
        }
        return { UnprocessedItems: {} };
      }
      default:
        return { Items: [], Count: 0 };
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
  TransactWriteCommand, BatchWriteCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-s3', {
  S3Client: class { async send() { return {}; } },
  GetObjectCommand: class { constructor(i) { this.input = i; } },
  ListObjectsV2Command: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';

const createGameHandler = require(path.join(REPO, 'lambda-functions', 'websocket', 'create-game.js')).handler;
const updatePersonaHandler = require(path.join(REPO, 'lambda-functions', 'game', 'update-game-persona.js')).handler;
const getPersonasHandler = require(path.join(REPO, 'lambda-functions', 'admin', 'get-personas.js')).handler;
const { resolvePersona } = require(path.join(REPO, 'lambda-functions', 'game', 'personas.js'));
const { SEED_PERSONAS } = require(path.join(REPO, 'lambda-functions', 'game', 'personas.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try {
    const r = fn();
    assert(!(r && typeof r.then === 'function'),
      'check() takes a synchronous assertion — use acheck() for async');
    console.log(`  PASS  ${label}`); pass++;
  } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}
async function acheck(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/** Write a persona exactly as scripts/seed-personas.js writes it. */
function seedPersona(overrides = {}) {
  const base = SEED_PERSONAS[0];
  const persona = {
    personaId: base.personaId,
    name: base.name,
    tagline: base.tagline,
    icon: base.icon,
    voice: base.voice,
    gameTypes: base.gameTypes || ['all'],
    isDefault: base.isDefault === true,
    sortOrder: base.sortOrder ?? 500,
    status: 'active',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
  store.set(key('AIPROMPTS', `PERSONA#${persona.personaId}`), {
    PK: 'AIPROMPTS', SK: `PERSONA#${persona.personaId}`, ...persona,
  });
  return persona;
}

const loadPersonaFromStore = async (id) =>
  store.get(key('AIPROMPTS', `PERSONA#${id}`)) || null;

const createGame = async (body) => {
  const res = await createGameHandler({ body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const metadataOf = (gameId) => store.get(key(`GAME#${gameId}`, 'METADATA'));

(async () => {
  // Silence the handlers' own logging; these tests assert on state, not stdout.
  const realLog = console.log;
  const realWarn = console.warn;
  const quiet = () => { console.log = () => {}; console.warn = () => {}; };
  const loud = () => { console.log = realLog; console.warn = realWarn; };

  loud();
  console.log('create-game persistence\n');

  seedPersona();
  seedPersona({ personaId: 'comedian', name: 'The Comedian', gameTypes: ['all'], sortOrder: 20, isDefault: false });
  seedPersona({ personaId: 'commentator', name: 'The Sports Commentator', gameTypes: ['trivia'], sortOrder: 60, isDefault: false });
  seedPersona({ personaId: 'pollster', name: 'The Pollster', gameTypes: ['poll'], sortOrder: 65, isDefault: false });
  // Stored under the legacy spelling. Two vocabularies is what made every poll
  // prompt filter return nothing; the normalizer has to bridge it here too.
  seedPersona({ personaId: 'oldtimer', name: 'The Old Timer', gameTypes: ['callandanswer'], sortOrder: 70, isDefault: false });
  seedPersona({ personaId: 'retired', name: 'Retired Voice', gameTypes: ['all'], sortOrder: 90, status: 'inactive', isDefault: false });

  let withPersona, withoutPersona;

  quiet();
  withPersona = await createGame({
    eventTitle: 'Persona session', gameType: 'trivia', questionSetId: 'set-a',
    personaId: 'comedian', visibility: 'private', accessCode: '1234',
  });
  withoutPersona = await createGame({ eventTitle: 'Plain session', gameType: 'trivia', questionSetId: 'set-a' });
  loud();

  await acheck('a personaId in the create payload reaches METADATA as PersonaId', async () => {
    assert.strictEqual(withPersona.status, 201);
    const md = metadataOf(withPersona.body.gameId);
    assert(md, 'no METADATA item was written');
    assert.strictEqual(md.PersonaId, 'comedian',
      'personaId was dropped — check all THREE edit sites: the destructure in ' +
      'create-game.js, the createGame() argument, and the METADATA item in ' +
      'schema-compliant-manager.js');
  });

  check('omitting personaId leaves no PersonaId attribute at all', () => {
    const md = metadataOf(withoutPersona.body.gameId);
    assert(md, 'no METADATA item was written');
    assert(!('PersonaId' in md),
      'an empty pick must not write an empty attribute — absent means "adapt to the session"');
  });

  check('adding PersonaId did not disturb the rest of the METADATA item', () => {
    const md = metadataOf(withPersona.body.gameId);
    assert.strictEqual(md.Visibility, 'private');
    assert.strictEqual(md.AccessCode, '1234');
    assert.strictEqual(md.Started, false);
    assert.strictEqual(md.ScoringConfig.firstPlacePoints, 3);
  });

  console.log('\nprecedence at the values get-ai-summary actually reads\n');

  await acheck('a persona on the game beats one on the question set', async () => {
    const md = metadataOf(withPersona.body.gameId);
    store.set(key('SETS', 'SET#set-a'), { PK: 'SETS', SK: 'SET#set-a', personaId: 'facilitator' });
    const setItem = store.get(key('SETS', 'SET#set-a'));

    // Exactly the two reads get-ai-summary.js performs.
    const persona = await resolvePersona({
      hostPersonaId: md.PersonaId || md.personaId || null,
      setPersonaId: setItem.personaId,
      loadPersona: loadPersonaFromStore,
    });
    assert.strictEqual(persona.source, 'host');
    assert.strictEqual(persona.personaId, 'comedian');
  });

  await acheck('with no game persona the set\'s persona wins', async () => {
    const md = metadataOf(withoutPersona.body.gameId);
    const setItem = store.get(key('SETS', 'SET#set-a'));
    const persona = await resolvePersona({
      hostPersonaId: md.PersonaId || md.personaId || null,
      setPersonaId: setItem.personaId,
      loadPersona: loadPersonaFromStore,
    });
    assert.strictEqual(persona.source, 'question_set');
    assert.strictEqual(persona.personaId, 'facilitator');
  });

  await acheck('a personaId pointing at a deleted persona degrades instead of dead-ending', async () => {
    const persona = await resolvePersona({
      hostPersonaId: 'deleted-after-it-was-picked',
      setPersonaId: 'facilitator',
      loadPersona: loadPersonaFromStore,
    });
    assert.strictEqual(persona.source, 'question_set',
      'a dangling reference must fall through to the next level, never fail the summary');
  });

  await acheck('a dangling persona at every level still yields the adaptive voice', async () => {
    const persona = await resolvePersona({
      hostPersonaId: 'gone', setPersonaId: 'also-gone',
      templateInstructions: 'You are an AI business strategist analyzing lessons learned.',
      loadPersona: loadPersonaFromStore,
    });
    assert.strictEqual(persona.inferred, true);
    assert(!/business strategist/.test(persona.voice),
      'the legacy template persona leaked through — inference outranks it on purpose');
  });

  console.log('\nmid-game switch (PUT /games/{gameId}/persona)\n');

  const putPersona = async (gameId, personaId) => {
    quiet();
    const res = await updatePersonaHandler({
      pathParameters: { gameId },
      body: JSON.stringify(personaId === undefined ? {} : { personaId }),
    });
    loud();
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };

  await acheck('a switch changes ONLY PersonaId and leaves the rest of METADATA intact', async () => {
    const gameId = withPersona.body.gameId;
    // Deep clone, not a spread. A spread shares the ScoringConfig reference, so
    // a handler that mutated it in place would compare equal to itself and the
    // assertion below would be theatre.
    const before = structuredClone(metadataOf(gameId));

    const res = await putPersona(gameId, 'facilitator');
    assert.strictEqual(res.status, 200);

    const after = metadataOf(gameId);
    assert.strictEqual(after.PersonaId, 'facilitator');

    // This is the save-game-context trap. A Put would have wiped every one of
    // these, and the failure would only surface at scoring time.
    assert.deepStrictEqual(after.ScoringConfig, before.ScoringConfig, 'ScoringConfig was clobbered');
    assert.strictEqual(after.Visibility, before.Visibility, 'Visibility was clobbered');
    assert.strictEqual(after.AccessCode, before.AccessCode, 'AccessCode was clobbered');
    assert.strictEqual(after.Started, before.Started, 'Started was clobbered');
    assert.strictEqual(after.Details, before.Details, 'Details was clobbered');
    assert.strictEqual(after.Title, before.Title, 'Title was clobbered');
    assert.strictEqual(after.QuestionSetId, before.QuestionSetId, 'QuestionSetId was clobbered');
    assert.strictEqual(after.GameType, before.GameType, 'GameType was clobbered');
    assert.strictEqual(after.LastPlayedAt, before.LastPlayedAt, 'LastPlayedAt was clobbered');

    // And nothing new appeared or vanished beyond the one attribute.
    const added = Object.keys(after).filter((k) => !(k in before));
    assert.deepStrictEqual(added, [], `unexpected new attributes: ${added.join(', ')}`);
    const removed = Object.keys(before).filter((k) => !(k in after));
    assert.deepStrictEqual(removed, [], `attributes disappeared: ${removed.join(', ')}`);
  });

  await acheck('a switch says it applies to the next question, not this one', async () => {
    const res = await putPersona(withPersona.body.gameId, 'comedian');
    assert.strictEqual(res.body.appliesTo, 'next-question',
      'the switch must be explicit that Redo is what rewrites the summary on screen');
  });

  await acheck('clearing the persona removes the attribute rather than writing an empty one', async () => {
    const gameId = withPersona.body.gameId;
    const before = structuredClone(metadataOf(gameId));
    const res = await putPersona(gameId, '');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.personaId, null);

    const after = metadataOf(gameId);
    assert(!('PersonaId' in after), 'cleared persona left an empty attribute behind');
    assert.deepStrictEqual(after.ScoringConfig, before.ScoringConfig, 'ScoringConfig was clobbered on clear');
    assert.strictEqual(after.AccessCode, before.AccessCode, 'AccessCode was clobbered on clear');
  });

  await acheck('a cleared persona falls back to the set, then to the adaptive voice', async () => {
    const md = metadataOf(withPersona.body.gameId);
    const persona = await resolvePersona({
      hostPersonaId: md.PersonaId || null,
      setPersonaId: null,
      loadPersona: loadPersonaFromStore,
    });
    assert.strictEqual(persona.inferred, true);
  });

  await acheck('an unknown persona is rejected rather than written as a dangling id', async () => {
    const gameId = withPersona.body.gameId;
    const res = await putPersona(gameId, 'no-such-persona');
    assert.strictEqual(res.status, 404);
    assert(!('PersonaId' in metadataOf(gameId)), 'a rejected id was written anyway');
  });

  await acheck('an inactive persona is rejected', async () => {
    const res = await putPersona(withPersona.body.gameId, 'retired');
    assert.strictEqual(res.status, 400);
  });

  await acheck('an unknown game 404s and does NOT conjure a METADATA item', async () => {
    const res = await putPersona('0000', 'comedian');
    assert.strictEqual(res.status, 404);
    assert.strictEqual(store.get(key('GAME#0000', 'METADATA')), undefined,
      'an Update without attribute_exists() creates the item it was meant to modify');
  });

  console.log('\nGET /admin/personas\n');

  const getPersonas = async (queryStringParameters) => {
    quiet();
    const res = await getPersonasHandler({ queryStringParameters });
    loud();
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };

  await acheck('with no filter every active persona is returned', async () => {
    const res = await getPersonas(null);
    assert.strictEqual(res.status, 200);
    const ids = res.body.personas.map((p) => p.personaId);
    assert(ids.includes('facilitator') && ids.includes('commentator') && ids.includes('pollster'));
  });

  await acheck('an inactive persona is never offered', async () => {
    const res = await getPersonas(null);
    assert(!res.body.personas.some((p) => p.personaId === 'retired'));
  });

  await acheck('gameType=trivia returns the trivia personas plus the "all" ones', async () => {
    const res = await getPersonas({ gameType: 'trivia' });
    const ids = res.body.personas.map((p) => p.personaId);
    assert(ids.includes('commentator'), 'the trivia-specific persona was filtered out');
    assert(ids.includes('facilitator') && ids.includes('comedian'), '["all"] must match every type');
    assert(!ids.includes('pollster'), 'a poll-only persona was offered for trivia');
    assert(!ids.includes('oldtimer'), 'a call-and-answer persona was offered for trivia');
  });

  await acheck('gameType=poll finds the poll persona (the vocabulary that used to match nothing)', async () => {
    const res = await getPersonas({ gameType: 'poll' });
    const ids = res.body.personas.map((p) => p.personaId);
    assert(ids.includes('pollster'));
    assert(!ids.includes('commentator'));
  });

  await acheck('a legacy "callandanswer" spelling still matches a "call-and-answer" request', async () => {
    const res = await getPersonas({ gameType: 'call-and-answer' });
    const ids = res.body.personas.map((p) => p.personaId);
    assert(ids.includes('oldtimer'),
      'gameTypes must be compared through normalizeGameType — the two spellings ' +
      'of the same type are exactly what made every poll prompt filter miss');
  });

  await acheck('gameType=all is not treated as a filter', async () => {
    const res = await getPersonas({ gameType: 'all' });
    const ids = res.body.personas.map((p) => p.personaId);
    assert(ids.includes('pollster') && ids.includes('commentator'));
  });

  await acheck('personas come back sorted and carry what the picker renders', async () => {
    const res = await getPersonas(null);
    const orders = res.body.personas.map((p) => p.sortOrder);
    assert.deepStrictEqual(orders, [...orders].sort((a, b) => a - b), 'personas are not sorted');
    for (const p of res.body.personas) {
      assert(p.personaId && p.name, 'a persona with no id would make <option value> fall back to its label text');
      assert(!('voice' in p), 'the picker has no use for the voice text; do not ship it');
    }
  });

  await acheck('a persona seeded exactly as the seeder writes it is returned as active', async () => {
    // D13: the resolver reads `status`, so the seeder must write one. If it
    // ever stops, this and the seeder assertion in persona-resolution.js fail.
    const seeded = store.get(key('AIPROMPTS', 'PERSONA#facilitator'));
    assert.strictEqual(seeded.status, 'active');
    const res = await getPersonas(null);
    const found = res.body.personas.find((p) => p.personaId === 'facilitator');
    assert(found, 'a seeded persona did not survive the active filter');
    assert.strictEqual(found.status, 'active');
  });

  await acheck('a persona row with no gameTypes is offered rather than hidden', async () => {
    store.set(key('AIPROMPTS', 'PERSONA#legacy'), {
      PK: 'AIPROMPTS', SK: 'PERSONA#legacy', personaId: 'legacy', name: 'Legacy', voice: 'x', sortOrder: 95,
    });
    const res = await getPersonas({ gameType: 'trivia' });
    assert(res.body.personas.some((p) => p.personaId === 'legacy'),
      'an omitted field must never make a persona disappear from the picker');
  });

  console.log('\ncontext is additive, never a competing voice\n');

  const { buildContextBlock } = require(path.join(REPO, 'lambda-functions', 'game', 'personas.js'));
  const fs2 = require('fs');
  const summarySrc = fs2.readFileSync(
    path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'), 'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  await acheck('a persona outranks the contexts in the VOICE chain — and only there', async () => {
    /*
      THE REPORTED BUG, precisely bounded. resolvePersona treats the contexts
      as fallback voices — that is the DJ fix (persona-resolution.js) and it
      stays — so a persona rightly wins the voice here. What was broken is
      that winning the voice also DELETED the contexts from the prompt; the
      cure is get-ai-summary's context block (asserted below), not a change
      to this chain. A first fix deleted the context rungs and the DJ suite
      caught it: two owner reports, one chain, both must hold.
    */
    const persona = await resolvePersona({
      hostPersonaId: 'comedian', setPersonaId: null,
      questionSetAiContext: 'the set author context',
      gameAiContext: 'the host context',
      loadPersona: loadPersonaFromStore,
    });
    assert.strictEqual(persona.source, 'host');
    assert(!/host context|author context/.test(persona.voice));
  });

  await acheck('a context that became the voice is not repeated in the block', async () => {
    // get-ai-summary blanks the field that won the chain before building the
    // block — the model must not weigh one instruction twice.
    assert(/persona\.source === 'game_context' \? '' : gameAiContext/.test(summarySrc));
    assert(/persona\.source === 'question_set_context' \? '' : questionSetAiContext/.test(summarySrc));
  });

  await acheck('buildContextBlock carries all three fields, labeled apart', async () => {
    const blockText = buildContextBlock({
      eventDetails: 'Two-day leadership offsite',
      hostInstructions: 'Reference our Q3 pricing decision',
      questionSetContext: 'Answers should stay team-level',
    });
    assert(blockText.includes('ABOUT THIS SESSION: Two-day leadership offsite'));
    assert(blockText.includes("THE HOST'S INSTRUCTIONS: Reference our Q3 pricing decision"));
    assert(blockText.includes("FROM THE QUESTION SET'S AUTHOR: Answers should stay team-level"));
  });

  await acheck('details and instructions are separate fields — neither shadows the other', async () => {
    // The old read was `AIContext || EngagementInfo`: one slot, so filling the
    // instructions ERASED the event details. Both must survive side by side.
    const blockText = buildContextBlock({
      eventDetails: 'the details', hostInstructions: 'the instructions',
    });
    assert(blockText.includes('the details') && blockText.includes('the instructions'));
  });

  await acheck('nothing to say is an empty string, not an empty ceremony', async () => {
    assert.strictEqual(buildContextBlock({}), '');
    assert.strictEqual(buildContextBlock({ eventDetails: '   ' }), '');
    assert.strictEqual(buildContextBlock(), '');
  });

  await acheck('get-ai-summary reads the two metadata fields into two slots', async () => {
    // Source-level, because the full prompt build needs a live Bedrock stub
    // this harness does not carry: the one-slot `AIContext || EngagementInfo`
    // read must be gone, and eventDetails must have its own.
    assert(!/AIContext \|\| metadata\.EngagementInfo/.test(summarySrc),
      'the shadowing read is back');
    assert(/eventDetails: metadata\.EngagementInfo \|\| metadata\.Details/.test(summarySrc));
  });

  await acheck('the context layer is injected when the template has no placeholder', async () => {
    /*
      The other half of the bug: context reached the prompt only through the
      {contextSections} template variable, which authored and imported prompts
      mostly do not contain — so the context vanished with no error. The build
      must now check for the placeholder and inject the block itself when it
      is absent. One door or the other is always open.
    */
    assert(/templateBody\.includes\('\{contextSections\}'\)/.test(summarySrc));
    assert(/buildContextBlock\(\{/.test(summarySrc));
    assert(/\$\{contextLayer\}\$\{templateBody\}/.test(summarySrc),
      'the context layer is not in the assembled prompt');
  });

  console.log('\nthe host\'s instructions carry authority — game 1935\'s fix\n');

  const { buildHostDirective } = require(path.join(REPO, 'lambda-functions', 'game', 'personas.js'));

  await acheck('the directive names its precedence over material-only rules', async () => {
    /*
      CloudWatch, game 1935: the host's "what would Steve Jobs do" was
      delivered as the VOICE and then out-ranked by the template's "use only
      the listed material". The cure is a second statement at the position
      that wins, saying explicitly WHICH earlier rules it overrides.
    */
    const directive = buildHostDirective({
      hostInstructions: 'add a comment with Steve Jobs\'s creative spirit',
    });
    assert(directive.includes("THE HOST'S INSTRUCTIONS"));
    assert(/outrank every rule and instruction above/.test(directive));
    assert(/only the listed material/.test(directive), 'must name the rule class it overrides');
    assert(/Only the FORMAT block below outranks them/.test(directive),
      'the headings the parser keys on must stay sovereign');
    assert(directive.includes("Steve Jobs's creative spirit"));
  });

  await acheck('the event details ride the directive too — game 4567\'s class', async () => {
    /*
      The owner, after "mention something from star wars" never surfaced:
      "i think the engagement event details, and the AI context should always
      be added to AI prompt as important details." Details are facts to weave
      in; instructions are orders; both get the winning position, labeled
      apart so the model knows which is which.
    */
    const directive = buildHostDirective({
      eventDetails: 'We are demoing to the team; mention something from star wars',
    });
    assert(directive.includes('ABOUT THIS SESSION: We are demoing'));
    assert(/outrank every rule and instruction above/.test(directive),
      'details alone must still carry the authority text');

    const both = buildHostDirective({
      hostInstructions: 'the orders', eventDetails: 'the facts',
    });
    assert(both.indexOf('ABOUT THIS SESSION: the facts')
      < both.indexOf("THE HOST'S INSTRUCTIONS: the orders"),
      'facts frame first, orders follow');
  });

  await acheck('nothing to say, no directive — not an empty ceremony', async () => {
    assert.strictEqual(buildHostDirective({}), '');
    assert.strictEqual(buildHostDirective({ hostInstructions: '   ', eventDetails: '' }), '');
    assert.strictEqual(buildHostDirective(), '');
  });

  await acheck('the directive sits between the template and the contract', async () => {
    // Position IS the fix: after the template's rules (so it is the more
    // recent instruction) and before the contract (which must stay last —
    // the heading list is what parseAIResponse and the projector key on).
    assert(/hostInstructions: gameAiContext/.test(summarySrc));
    assert(/eventDetails,/.test(summarySrc));
    assert(/\$\{contextLayer\}\$\{templateBody\}\$\{hostLayer\}\\n\\n\$\{buildOutputContract/.test(summarySrc),
      'the assembled prompt must read template → host directive → contract');
  });

  console.log('\nthe reply is prefilled with its own first heading\n');

  await acheck('the model call carries an assistant prefill of the first heading', async () => {
    /*
      Source-level, as the metadata-read pins above are. The prefill kills the
      "Here's a summary…" preamble and the invented document title (game 7971's
      breakage) mechanically. Verified live against the exact Bedrock model
      before shipping: the completion continues "\n\nThe room…" and never
      contaminates the heading line.
    */
    assert(/const prefill = `## \$\{firstHeading\}`/.test(summarySrc));
    assert(/\{ role: 'assistant', content: prefill \}/.test(summarySrc));
    // And the stored/parsed reply is prefill + completion, never the
    // completion alone — the parser and the projector need the heading.
    assert(/prefill \+ responseBody\.content\[0\]\.text/.test(summarySrc));
  });

  await acheck('temperature is 0.7 — variety, fenced by material-only rules', async () => {
    assert(/temperature: 0\.7/.test(summarySrc));
    assert(!/temperature: 0\.5/.test(summarySrc), 'the flattening 0.5 is back');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
