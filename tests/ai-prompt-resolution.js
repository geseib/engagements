/**
 * Regression test: a question set pointing at a prompt that no longer exists
 * must NOT silently disable Bedrock.
 *
 * Observed on engagedev 2026-08-07 (game 7971, set "greatesthits"):
 *
 *   🎨 Found custom prompt ID: mdaikmsyh34dwoqayi
 *   ❌ Prompt mdaikmsyh34dwoqayi not found in DynamoDB
 *   ⚠️ Prompt template unavailable — returning data-driven fallback summary
 *
 * Bedrock was never called. A set with NO promptId worked fine the day before,
 * because the "find the game-type default" path only runs when promptId is
 * absent — a dangling promptId is a dead end rather than a miss.
 *
 * That matters because prompt deletion is known to leave orphan references
 * (see docs/handoff/admin-prompt-cleanup-plan.md), so any set can end up here.
 *
 * ── RULING W9: TWO SENTENCES ON A SCREEN DEPEND ON THIS FILE ────────────────
 *
 * The set editor tells a builder what will happen to an attached prompt it
 * cannot offer, and it says two different things depending on WHY it cannot
 * offer it. Both claims are claims about `resolvePromptTemplate` below, and
 * until this ruling nothing checked either of them. Whoever changes that
 * function is reading this because one of the last two cases failed, so here is
 * what you just falsified — the exact words, from
 * `src/src/components/QuestionSetEditor.jsx`:
 *
 *  1. THE CROSS-FORMAT SENTENCE (the `workie-prompt-unavailable` branch guarded
 *     by `promptHonoured`):
 *
 *       "This set is saved with a summary approach written for <Format> sets
 *        ("<id>"). Workie will still follow it, which is unlikely to suit a
 *        <Format> round."
 *
 *     "will still follow it" is true ONLY because `resolvePromptTemplate`
 *     resolves a prompt by id and never consults the set's game type —
 *     `gameType` reaches it, but is spent on `findDefaultPromptId` and on log
 *     text. Add a game-type filter to the id path, however reasonable it looks
 *     from inside this file, and that sentence becomes a lie: the builder is
 *     told their trivia prompt is being followed on a call-and-answer set while
 *     the engine quietly substitutes the default. The editor deliberately does
 *     NOT offer to fall back here, so there is no second sentence to catch it.
 *
 *  2. THE UNOFFERABLE SENTENCE (the same branch without `promptHonoured`):
 *
 *       "This set is saved with a summary approach this environment does not
 *        offer ("<id>"). Workie will sum up each round the standard <Format>
 *        way until it is changed."
 *
 *     The editor decides which branch to draw by excluding `scope === 'public'`
 *     (QuestionSetEditor.jsx ~:344), and that exclusion is only correct while
 *     `promptLibrariesFor` reads the org library then the platform one and
 *     NOTHING ELSE — the same org-then-platform order `admin/shared/
 *     workie-refs.js` `promptRefsFor` enforces at the write. Teach this file to
 *     read `PUBLIC#AIPROMPTS` and the editor starts promising a fallback that
 *     will not happen.
 *
 * Neither case is a guess about intent: if a game-type filter or a public
 * library is genuinely wanted, the editor's copy has to change in the same
 * commit. That is the whole purpose of failing here.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK before the handler loads -----------------------------
// art-title-flow.js poisons require.cache by resolved path, which only works
// for packages that are actually installed. Several of the SDK clients this
// handler imports (client-s3, client-lambda, client-bedrock-runtime) are only
// present in the deployed bundle, so they cannot be resolved locally at all.
// Intercept the loader by module name instead — works either way.
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

// The prompt that EXISTS — the call-and-answer default.
const DEFAULT_PROMPT_ID = 'default-callandanswer';
const DANGLING_PROMPT_ID = 'mdaikmsyh34dwoqayi';
// W9's two rows: one filed under the WRONG game type, one in a library this
// path does not read.
const TRIVIA_PROMPT_ID = 'quiz-recap';
const PUBLIC_PROMPT_ID = 'open-mic';

/* The partition names come from tenant.js rather than from string literals, so
   a partition that is renamed there cannot leave this test quietly probing the
   old one and passing for the wrong reason. `promptsMetadataPk(PUBLIC, '')` is
   also the ONE place this file states what "the public library" is called. */
const tenant = require(path.join(REPO, 'lambda-functions', 'game', 'tenant.js'));
const PLATFORM_PROMPTS_PK = tenant.promptsMetadataPk(tenant.PLATFORM, '');
const PUBLIC_PROMPTS_PK = tenant.promptsMetadataPk(tenant.PUBLIC, '');

const ddbItems = new Map([
  [`${PLATFORM_PROMPTS_PK}|AIPROMPT#${DEFAULT_PROMPT_ID}`, {
    PK: PLATFORM_PROMPTS_PK, SK: `AIPROMPT#${DEFAULT_PROMPT_ID}`,
    promptId: DEFAULT_PROMPT_ID, name: 'Lessons Learned - Strategic Insights',
    gameType: 'callandanswer', isDefault: true, category: 'lessons-learned',
    s3Key: `prompts/callandanswer/${DEFAULT_PROMPT_ID}/v1.json`,
  }],
  // A TRIVIA prompt in the platform library. Nothing marks it as a default, so
  // it can only ever be reached by id — which is what case 6 is about.
  [`${PLATFORM_PROMPTS_PK}|AIPROMPT#${TRIVIA_PROMPT_ID}`, {
    PK: PLATFORM_PROMPTS_PK, SK: `AIPROMPT#${TRIVIA_PROMPT_ID}`,
    promptId: TRIVIA_PROMPT_ID, name: 'Quiz Recap',
    gameType: 'trivia', category: 'trivia',
    s3Key: `prompts/trivia/${TRIVIA_PROMPT_ID}/v1.json`,
  }],
  // A PUBLIC prompt, seeded and perfectly usable, sitting in the one library
  // this path must not read. Case 7 asserts it is never even probed.
  [`${PUBLIC_PROMPTS_PK}|AIPROMPT#${PUBLIC_PROMPT_ID}`, {
    PK: PUBLIC_PROMPTS_PK, SK: `AIPROMPT#${PUBLIC_PROMPT_ID}`,
    promptId: PUBLIC_PROMPT_ID, name: 'Open Mic',
    gameType: 'call-and-answer', category: 'callandanswer',
    s3Key: `prompts/public/${PUBLIC_PROMPT_ID}/v1.json`,
  }],
  // NOTE: no record for DANGLING_PROMPT_ID — that is the whole point.
]);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') {
      return { Item: ddbItems.get(`${inp.Key.PK}|${inp.Key.SK}`) };
    }
    if (cmd.type === 'scan') {
      // findDefaultPromptId scans PK=AIPROMPTS + isDefault. It deliberately no
      // longer filters on gameType server-side: rows exist under both
      // `callandanswer` and `call-and-answer`, and a FilterExpression cannot
      // normalize, so the game-type match happens in JS. Honour whichever
      // values the handler actually supplied rather than assuming a fixed set.
      const v = inp.ExpressionAttributeValues || {};
      const items = [...ddbItems.values()].filter((i) =>
        (v[':pk'] === undefined || i.PK === v[':pk']) &&
        (v[':gameType'] === undefined || i.gameType === v[':gameType']) &&
        (v[':isDefault'] === undefined || i.isDefault === v[':isDefault']));
      return { Items: items, Count: items.length };
    }
    return { Items: [], Count: 0 };
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

/**
 * S3 bodies by key. Every other key is a NoSuchKey, as it was when this served
 * the default prompt alone — the map exists so W9's cases can put a SECOND
 * usable template behind a second row, and tell which of the two came back.
 */
const s3Bodies = new Map([
  [`prompts/callandanswer/${DEFAULT_PROMPT_ID}/v1.json`, {
    name: 'Lessons Learned - Strategic Insights',
    instructions: 'Summarise the responses.',
    outputFormat: '## Summary\n{responsesText}',
  }],
  [`prompts/trivia/${TRIVIA_PROMPT_ID}/v1.json`, {
    name: 'Quiz Recap',
    instructions: 'Read back the scores.',
    outputFormat: '## Scores\n{responsesText}',
  }],
  [`prompts/public/${PUBLIC_PROMPT_ID}/v1.json`, {
    name: 'Open Mic',
    instructions: 'Read the room.',
    outputFormat: '## Open\n{responsesText}',
  }],
]);

const s3Fetches = [];
stub('@aws-sdk/client-s3', {
  S3Client: class { async send(cmd) {
    const key = cmd.input.Key;
    s3Fetches.push(key);
    if (s3Bodies.has(key)) {
      return { Body: { transformToString: async () => JSON.stringify(s3Bodies.get(key)) } };
    }
    const err = new Error('NoSuchKey'); err.name = 'NoSuchKey'; throw err;
  } },
  GetObjectCommand: class { constructor(i) { this.input = i; } },
  PutObjectCommand: class { constructor(i) { this.input = i; } },
});

stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class { async send() { throw new Error('bedrock not stubbed for this test'); } },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-lambda', {
  LambdaClient: class { async send() { return {}; } },
  InvokeCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';

const mod = require(path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

(async () => {
  console.log('resolvePromptTemplate: dangling promptId must fall back to the game-type default\n');

  assert(typeof mod.resolvePromptTemplate === 'function',
    'get-ai-summary.js must export resolvePromptTemplate for this to be testable');

  // 1. The reported failure: an explicit promptId that does not exist.
  s3Fetches.length = 0;
  const dangling = await mod.resolvePromptTemplate(DANGLING_PROMPT_ID, 'call-and-answer');
  check('a dangling promptId still yields a usable template', () =>
    assert(dangling && dangling.promptData, 'got no template — Bedrock would be skipped'));
  check('it resolves via the game-type default', () =>
    assert.strictEqual(dangling.promptId, DEFAULT_PROMPT_ID));
  check('the recovery is reported, not silent', () =>
    assert.strictEqual(dangling.recoveredFrom, DANGLING_PROMPT_ID));

  // 2. A promptId that does exist must be used as-is, not overridden.
  const good = await mod.resolvePromptTemplate(DEFAULT_PROMPT_ID, 'call-and-answer');
  check('an existing promptId is used unchanged', () =>
    assert.strictEqual(good.promptId, DEFAULT_PROMPT_ID));
  check('no spurious recovery flag when nothing was wrong', () =>
    assert.strictEqual(good.recoveredFrom, undefined));

  // 3. No promptId at all — the path that already worked — must keep working.
  const none = await mod.resolvePromptTemplate(null, 'call-and-answer');
  check('a missing promptId still resolves the default', () =>
    assert.strictEqual(none.promptId, DEFAULT_PROMPT_ID));

  // 4. An unrecognised game type is NOT a dead end. normalizeGameType maps any
  //    unknown spelling to call-and-answer (same rule as src/config/gameTypes.js),
  //    so the call-and-answer default still answers. This used to return null:
  //    the game silently lost its AI summary because of a typo in a game type.
  const unknownType = await mod.resolvePromptTemplate('nope', 'no-such-game-type');
  check('an unrecognised gameType degrades to the call-and-answer default', () =>
    assert(unknownType && unknownType.promptId === DEFAULT_PROMPT_ID,
      'an unknown game type must not cost the room its summary'));

  // 5. Genuinely nothing available: caller must still get a clean signal so it
  //    can use the data-driven fallback rather than throwing. Empty the table
  //    of defaults to reach that state — an unknown game type no longer does.
  const defaultKey = `${PLATFORM_PROMPTS_PK}|AIPROMPT#${DEFAULT_PROMPT_ID}`;
  const savedDefault = ddbItems.get(defaultKey);
  ddbItems.delete(defaultKey);
  const empty = await mod.resolvePromptTemplate('nope', 'call-and-answer');
  ddbItems.set(defaultKey, savedDefault);
  check('unresolvable everything returns null rather than throwing', () =>
    assert.strictEqual(empty, null));

  // ── RULING W9 ────────────────────────────────────────────────────────────
  // Two properties the set editor's copy asserts in words. See the header for
  // the sentences themselves; break one of these and you have falsified one.

  // 6. A prompt written for ANOTHER game type is still the prompt that runs.
  //    `gameType` is passed to resolvePromptTemplate and is spent entirely on
  //    findDefaultPromptId and on log text — the id path never consults it. The
  //    editor tells a builder "Workie will still follow it" on the strength of
  //    exactly this, and offers them no fallback, so a filter added here would
  //    not merely change behaviour: it would leave a false sentence on screen
  //    with nothing to correct it.
  s3Fetches.length = 0;
  const crossFormat = await mod.resolvePromptTemplate(TRIVIA_PROMPT_ID, 'call-and-answer');
  check('a prompt written for another game type still resolves', () =>
    assert(crossFormat && crossFormat.promptData,
      'a trivia prompt on a call-and-answer set lost its template'));
  check('…and it is that prompt, not the game-type default, that is used', () => {
    assert.strictEqual(crossFormat.promptId, TRIVIA_PROMPT_ID,
      'the id came back rewritten to the default — "Workie will still follow it" is now false');
    // The id alone could match while the BODY came from somewhere else, so the
    // template itself is checked: this is the trivia text, not the house one.
    assert.strictEqual(crossFormat.promptData.name, 'Quiz Recap');
    assert.match(crossFormat.promptData.outputFormat, /## Scores/);
  });
  check('…and nothing is reported as recovered, because nothing was', () =>
    assert.strictEqual(crossFormat.recoveredFrom, undefined,
      'a silent substitution is exactly what the editor promises will not happen'));
  check('…the default prompt was never even fetched', () =>
    assert(!s3Fetches.includes(`prompts/callandanswer/${DEFAULT_PROMPT_ID}/v1.json`),
      'the default was read, so some branch is preferring it over the attached id'));

  // 7. A PUBLIC-scoped id does not resolve here, with or without an org.
  //    promptLibrariesFor reads the org library then the platform one and
  //    nothing else — the same org-then-platform order workie-refs.js's
  //    promptRefsFor enforces at the write. The editor excludes `scope ===
  //    'public'` from the ids it calls honoured on the strength of it, and says
  //    the round will be summed up the standard way instead.
  check('the public row really is seeded — this is about reach, not absence', () =>
    assert(ddbItems.has(`${PUBLIC_PROMPTS_PK}|AIPROMPT#${PUBLIC_PROMPT_ID}`)
      && s3Bodies.has(`prompts/public/${PUBLIC_PROMPT_ID}/v1.json`),
      'the row and a usable body must both exist, or case 7 proves nothing'));

  for (const orgId of ['', 'org_acme']) {
    s3Fetches.length = 0;
    // eslint-disable-next-line no-await-in-loop
    const fromPublic = await mod.resolvePromptTemplate(PUBLIC_PROMPT_ID, 'call-and-answer', orgId);
    const where = orgId ? 'for an org session' : 'for a platform session';
    check(`a public-scoped prompt id does not resolve ${where}`, () =>
      assert.strictEqual(fromPublic.promptId, DEFAULT_PROMPT_ID,
        'the public library was read — the editor now promises a fallback that will not happen'));
    check(`…it falls back and says so ${where}`, () => {
      assert.strictEqual(fromPublic.recoveredFrom, PUBLIC_PROMPT_ID);
      assert.strictEqual(fromPublic.recoveryReason, 'missing');
    });
    check(`…and its partition was never probed ${where}`, () =>
      assert(!s3Fetches.includes(`prompts/public/${PUBLIC_PROMPT_ID}/v1.json`),
        'S3 was asked for the public body, so the row was found first'));
  }

  /* ── WHICH promptId THE ROUND STARTS FROM ─────────────────────────────────
     The session's pick (METADATA.PromptId, from setup or the mid-round switch)
     beats the set's, which beats nothing — and nothing is what sends the
     resolver to the game-type default above. The precedence is one pure
     function so it can be pinned without a round. */
  console.log('\nsessionPromptId: the session beats the set beats the default\n');
  check('get-ai-summary exports sessionPromptId', () =>
    assert.strictEqual(typeof mod.sessionPromptId, 'function'));
  check('a PromptId on the game beats one on the question set', () =>
    assert.strictEqual(mod.sessionPromptId({ PromptId: 'game-pick' }, { promptId: 'set-pick' }), 'game-pick'));
  check('with no game pick the set\'s promptId is used', () =>
    assert.strictEqual(mod.sessionPromptId({}, { promptId: 'set-pick' }), 'set-pick'));
  check('neither is the empty string, which the resolver reads as "the default"', () =>
    assert.strictEqual(mod.sessionPromptId({}, {}), ''));
  check('a blank PromptId on the game does not shadow the set', () =>
    assert.strictEqual(mod.sessionPromptId({ PromptId: '  ' }, { promptId: 'set-pick' }), 'set-pick'));
  check('a missing set item is tolerated', () =>
    assert.strictEqual(mod.sessionPromptId({ PromptId: 'game-pick' }, null), 'game-pick'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
