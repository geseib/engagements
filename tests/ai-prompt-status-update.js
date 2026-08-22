/**
 * WHAT A ONE-CLICK STATUS CHANGE IS ALLOWED TO DO TO A PROMPT.
 *
 * The prompt library's status chip is a toggle now — click it and the prompt
 * moves between Active and Draft (components/PromptLibraryPanel.jsx). It sends
 * `PUT /admin/ai-prompts/{promptId}` with `{ status }` and nothing else, which
 * is a shape that route had never been sent before: every previous caller was
 * the editor form, which resends the whole record on every save.
 *
 * Two things in `update-ai-prompt.js` were only safe because of that, and both
 * are asserted here against the REAL handler:
 *
 *  1. `status` was written verbatim into the DynamoDB row AND into the S3
 *     object's metadata, unchecked. Every consumer compares it for exact
 *     equality — get-ai-prompts.js:64 filters on it, the library's select
 *     offers three strings, AdminPage.js:238 keeps only `active` for the
 *     question-set picker — so a value outside the three makes the prompt
 *     vanish from every filter and every picker while it is still stored, still
 *     resolvable by id, and possibly still the game-type default that runs for
 *     every set of its type.
 *
 *  2. The handler's read of the current content from S3 is best-effort: it
 *     warns and carries on. With the whole form in the request body that cost
 *     the record's untouched extras. With `{ status }` alone it would write an
 *     S3 object carrying NO template, NO instructions and NO outputFormat and
 *     point `s3Key` at it — a shape `isUsableSummaryPrompt` rejects
 *     (get-ai-summary.js:412-431), so every set pinned to the prompt silently
 *     falls back to the game-type default while the library still shows a
 *     healthy row. A status flip must not be able to destroy a prompt.
 *
 * Stubbing note: identical to tests/ai-prompt-lifecycle.js — intercept
 * Module._load by request NAME, because several SDK packages these handlers
 * import exist only in the deployed bundle and cannot be resolved locally at
 * all, so poisoning require.cache by resolved path silently misses.
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
        // Minimal `SET a = :x, #b = :y [REMOVE #z]` interpreter, same as the
        // lifecycle harness. The status clause travels as `#status = :status`
        // because `status` is a DynamoDB reserved word.
        const item = store.get(key(inp.Key.PK, inp.Key.SK));
        if (!item) return {};
        const expr = inp.UpdateExpression || '';
        const names = inp.ExpressionAttributeNames || {};
        const resolve = (t) => (t.startsWith('#') ? names[t] : t);

        /*
          `removeUndefinedValues: true` IS MODELLED, BECAUSE THAT IS WHERE THE
          SECOND HALF OF THE KEYLESS-ROW BUG LIVED.

          update-ai-prompt.js builds its document client with
          `marshallOptions: { removeUndefinedValues: true }`, so an
          ExpressionAttributeValues entry whose value is `undefined` is DROPPED
          before the request is sent — while the clause that reads it stays in
          the UpdateExpression. DynamoDB then refuses the whole write with "an
          expression attribute value used in expression is not defined". A stub
          that quietly assigns `undefined` instead turns a guaranteed failure
          into a passing test, which is exactly what it did.
        */
        const values = Object.fromEntries(
          Object.entries(inp.ExpressionAttributeValues || {}).filter(([, v]) => v !== undefined)
        );
        for (const ref of expr.match(/:[A-Za-z0-9_]+/g) || []) {
          if (!(ref in values)) {
            throw new Error(
              'ValidationException: Invalid UpdateExpression: An expression attribute value '
              + `used in expression is not defined; attribute value: ${ref}`
            );
          }
        }

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
        const items = [...store.values()].filter(
          (i) => i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? ''))
        );
        return { Items: items, Count: items.length };
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
});

// ---- in-memory S3 ----------------------------------------------------------
/*
  THE STUB REFUSES `Key: undefined`, BECAUSE THE REAL CLIENT DOES.

  This harness used to accept it, and section 4 below said so out loud: "the S3
  stub accepts `Key: undefined`, where the real client throws, so what a keyless
  row does past this point is not decided here." That was an honest limit while
  no UI sent a status-only PUT to a keyless row. The generation library's status
  chip does now, so the limit had to go rather than be documented again — a stub
  more forgiving than the thing it stands in for turns a guaranteed 500 into a
  green test.

  `@aws-sdk/client-s3` serializes Key into the request URI path, so a missing one
  fails client-side before any network call, with "No value provided for input
  HTTP label: Key."
*/
const s3Store = new Map();
const requireKey = (cmd) => {
  if (cmd.input.Key === undefined || cmd.input.Key === null || cmd.input.Key === '') {
    throw new Error('No value provided for input HTTP label: Key.');
  }
};
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      if (cmd.type === 'put' || cmd.type === 'get' || cmd.type === 'delete') requireKey(cmd);
      if (cmd.type === 'put') { s3Store.set(cmd.input.Key, cmd.input.Body); return {}; }
      if (cmd.type === 'delete') { s3Store.delete(cmd.input.Key); return {}; }
      if (cmd.type === 'get') {
        const body = s3Store.get(cmd.input.Key);
        if (!body) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
        return { Body: { transformToString: async () => body } };
      }
      return {};
    }
  },
  PutObjectCommand: class { constructor(i) { this.input = i; this.type = 'put'; } },
  GetObjectCommand: class { constructor(i) { this.input = i; this.type = 'get'; } },
  DeleteObjectCommand: class { constructor(i) { this.input = i; this.type = 'delete'; } },
  DeleteObjectsCommand: class { constructor(i) { this.input = i; this.type = 'deleteMany'; } },
  ListObjectsV2Command: class { constructor(i) { this.input = i; this.type = 'list'; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';

const admin = (f) => require(path.join(REPO, 'lambda-functions', 'admin', f));
const createPrompt = admin('create-ai-prompt.js');
const updatePrompt = admin('update-ai-prompt.js');
const { isUsableSummaryPrompt } = admin('shared/prompt-shape.js');

let pass = 0, fail = 0;
function check(label, fn) {
  try {
    const r = fn();
    assert(!(r && typeof r.then === 'function'),
      'check() takes a synchronous assertion — use acheck() for async');
    console.log(`  PASS  ${label}`); pass++;
  } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const post = (body) => createPrompt.handler({ body: JSON.stringify(body) });
const put = (promptId, body) => updatePrompt.handler({
  pathParameters: { promptId },
  body: JSON.stringify(body),
});

const row = (promptId) => store.get(key('AIPROMPTS', `AIPROMPT#${promptId}`));
const content = (promptId) => JSON.parse(s3Store.get(row(promptId).s3Key));

/** A fresh, ordinary summary prompt with real text in both halves. */
async function seed(overrides = {}) {
  const res = await post({
    name: 'Lessons Learned',
    description: 'the stock call-and-answer review',
    gameType: 'call-and-answer',
    promptType: 'analysis',
    category: 'lessons-learned',
    instructions: 'Here is what the room said: {responsesText}',
    // Prose, not [brackets]: the bracket-direction guard
    // (tests/prompt-save-guards.js) refuses bracketed placeholders at save.
    outputFormat: '## Summary\nWhat was asked, and what the room said.',
    status: 'active',
    ...overrides,
  });
  return JSON.parse(res.body).promptId;
}

(async () => {
  console.log('AI prompt status updates: the chip sends one field, and one field is all it may move\n');

  // === 1. The happy path: one field moves, the prompt survives =============
  const p1 = await seed();

  const deactivate = await put(p1, { status: 'draft' });
  check('a status-only PUT succeeds', () =>
    assert.strictEqual(deactivate.statusCode, 200, deactivate.body));

  check('the stored status is the one that was sent', () =>
    assert.strictEqual(row(p1).status, 'draft'));

  check('nothing else on the row moved', () => {
    assert.strictEqual(row(p1).name, 'Lessons Learned');
    assert.strictEqual(row(p1).category, 'lessons-learned');
    assert.strictEqual(row(p1).isDefault, false);
  });

  check('the prompt still has its text, and can still drive a summary', () => {
    /*
      THE ONE THAT MATTERS. Every field the chip does not send arrives as
      `undefined`, and `undefined` means "leave alone" everywhere in this
      handler — but the S3 object is rebuilt from scratch on every write, so
      "leave alone" there means "copy from the content we just read". If that
      copy is ever dropped, the prompt is still listed, still named, still
      pinnable, and produces no summary.
    */
    const c = content(p1);
    assert.strictEqual(c.instructions, 'Here is what the room said: {responsesText}');
    assert(String(c.outputFormat).includes('## Summary'), 'the output half is gone');
    assert.strictEqual(isUsableSummaryPrompt(c), true,
      'a status flip left the prompt in a shape the summary engine rejects');
  });

  check('the S3 copy of the status agrees with the row', () =>
    assert.strictEqual(content(p1).status, 'draft',
      'the two copies of status disagree, so which one is true depends on who reads it'));

  const reactivate = await put(p1, { status: 'active' });
  check('and it goes back, which is what makes it a toggle', () => {
    assert.strictEqual(reactivate.statusCode, 200, reactivate.body);
    assert.strictEqual(row(p1).status, 'active');
  });

  // === 2. Only the three known statuses are writable =======================
  const p2 = await seed({ name: 'Second Prompt' });
  const s3KeyBefore = row(p2).s3Key;
  const contentBefore = s3Store.get(s3KeyBefore);

  const bogus = await put(p2, { status: 'inactive' });
  check('a status outside the vocabulary is refused', () => {
    assert.notStrictEqual(bogus.statusCode, 200, 'an unknown status was accepted');
    assert(/status must be one of/.test(bogus.body), bogus.body);
    assert(/active/.test(bogus.body) && /draft/.test(bogus.body) && /archived/.test(bogus.body),
      'the refusal has to name the legal values, or it is a dead end');
  });

  check('and the refusal wrote nothing at all', () => {
    /*
      rejects: validating after the S3 write. The handler rebuilds and PUTs the
      S3 object BEFORE it touches DynamoDB, so a check in the wrong place
      leaves the two copies disagreeing about a value neither should hold.
    */
    assert.strictEqual(row(p2).status, 'active', 'the row moved despite the refusal');
    assert.strictEqual(row(p2).s3Key, s3KeyBefore, 'a new version was cut for a refused write');
    assert.strictEqual(s3Store.get(s3KeyBefore), contentBefore, 'the S3 object was rewritten');
  });

  for (const legal of ['active', 'draft', 'archived']) {
    // `archived` is legal HERE even though the chip never sends it: the
    // editor's Status select offers all three, and delete-ai-prompt.js is what
    // normally writes it. Narrowing this route to the chip's two values would
    // make the editor unable to save a state it still shows.
    // eslint-disable-next-line no-await-in-loop
    const res = await put(p2, { status: legal });
    check(`\`${legal}\` is accepted`, () => {
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(row(p2).status, legal);
    });
  }

  // === 3. A partial update cannot empty a prompt ===========================
  const p3 = await seed({ name: 'Third Prompt' });
  const lostKey = row(p3).s3Key;
  s3Store.delete(lostKey);                       // the read will now throw NoSuchKey

  const blind = await put(p3, { status: 'draft' });
  check('a partial update over unreadable content is refused', () => {
    assert.notStrictEqual(blind.statusCode, 200, 'the handler wrote a prompt it could not read');
    assert(/could not be read/.test(blind.body), blind.body);
    assert(/Nothing was changed/.test(blind.body),
      'the refusal has to say whether it half-happened');
  });

  check('and it really did change nothing', () => {
    assert.strictEqual(row(p3).status, 'active');
    assert.strictEqual(row(p3).s3Key, lostKey,
      's3Key was repointed at an object built from nothing');
    assert.strictEqual(s3Store.has(lostKey), false,
      'an object was written over the key whose read had just failed');
  });

  const rebuilt = await put(p3, {
    status: 'draft',
    instructions: 'Here is what the room said: {responsesText}',
    outputFormat: '## Summary\nWhat was asked.',
  });
  check('supplying the text again is still allowed, so this is not a lock-out', () => {
    /*
      rejects: refusing on `!currentContent` alone. The guard exists to stop a
      write that would leave the prompt with NO text — a caller that brings the
      text with it is the recovery path, and a prompt whose S3 object is gone
      must stay repairable from the editor.
    */
    assert.strictEqual(rebuilt.statusCode, 200, rebuilt.body);
    assert.strictEqual(row(p3).status, 'draft');
    assert.strictEqual(isUsableSummaryPrompt(content(p3)), true);
  });

  // === 4. The generation rows: no s3Key, and now a status chip of their own ==
  /*
    THE SHAPE `populate-generation-prompts.js:497` REALLY WRITES.

    Copied field for field from that handler, including the two details that
    each broke this route on their own:

      - NO `s3Key`, and no S3 object anywhere. The whole prompt — basePrompt,
        the four templates, defaultSettings — is on the DynamoDB row.
      - `version: '1.0.0'`, a STRING. `'1.0.0' + 1` is `'1.0.01'`.

    Both were unreachable while the generation library drew its status as a
    plain label. It is a toggle now (AIGenerationPromptEditor passes
    `onToggleStatus`), so every row below is one click away from this handler.
  */
  const genRow = (promptId, extra = {}) => {
    store.set(key('AIPROMPTS', `AIPROMPT#${promptId}`), {
      PK: 'AIPROMPTS', SK: `AIPROMPT#${promptId}`,
      promptId,
      promptType: 'generation', gameType: 'call-and-answer',
      name: 'Lessons Learned Scenarios',
      basePrompt: 'Write scenarios about…',
      contextTemplate: '\n\nContext: {context}',
      outputFormat: 'Return as JSON array',
      defaultSettings: { difficulty: 'medium' },
      status: 'active', isDefault: false, version: '1.0.0',
      ...extra,
    });
  };

  genRow('gen-call-and-answer-lessons-learned');
  const genRes = await put('gen-call-and-answer-lessons-learned', { status: 'draft' });

  check('a DynamoDB-only prompt is not caught by the body guard — it has nothing to lose', () => {
    /*
      rejects: gating the guard on `!currentContent` rather than on
      `s3Key && !currentContent`. Every generation prompt in the environment
      reads as "content unreadable" because there is no content in S3 to read,
      and the blunt guard would refuse every one of them by name — a refusal
      indistinguishable, in the log, from the real thing it exists to catch.
    */
    assert(!/could not be read/.test(genRes.body),
      'the body guard fired on a row that never had a body in S3');
  });

  check('and the flip actually lands, rather than 500ing on a missing S3 key', () => {
    /*
      rejects: the shipped arrangement, which reached `PutObjectCommand` with
      `Key: undefined` for exactly this row. The real client refuses that
      client-side, so every non-default generation prompt answered a status
      click with a 500 and no explanation. The stub above refuses it too now.
    */
    assert.strictEqual(genRes.statusCode, 200, genRes.body);
    assert.strictEqual(row('gen-call-and-answer-lessons-learned').status, 'draft');
  });

  check('nothing was invented in the bucket for it', () => {
    /*
      rejects: "fixing" the crash by minting a key and writing the object
      anyway. `currentContent` is null for these rows, so the object would carry
      the name and the status and NONE of the prompt text — and `s3Key` would
      then point at it, so the next edit would rebuild the record from that
      husk. A row with no body in S3 must come out of this route with no body in
      S3.
    */
    const r = row('gen-call-and-answer-lessons-learned');
    // ABSENT, not present-and-undefined: `s3Key = :s3Key` with an undefined
    // value is refused outright by DynamoDB (see the stub's note), so a row
    // that came back with the attribute set to undefined would mean the write
    // never reached the table at all.
    assert.strictEqual('s3Key' in r, false, `a bucket key was invented: ${r.s3Key}`);
    assert.strictEqual([...s3Store.keys()].some((k) => k.includes('lessons-learned')), false,
      'an object was written for a prompt that keeps its body on the row');
  });

  check('the row keeps the prompt text that only it holds', () => {
    // rejects: any path that rewrites these attributes from `currentContent`.
    const r = row('gen-call-and-answer-lessons-learned');
    assert.strictEqual(r.basePrompt, 'Write scenarios about…');
    assert.strictEqual(r.contextTemplate, '\n\nContext: {context}');
    assert.deepStrictEqual(r.defaultSettings, { difficulty: 'medium' });
  });

  check('and its version is left alone, because nothing was versioned', () => {
    /*
      rejects: bumping the version on a write that produced no new object. A
      version number counts S3 objects; incrementing it with none written makes
      the row claim a v2 that does not exist.
    */
    assert.strictEqual(row('gen-call-and-answer-lessons-learned').version, '1.0.0');
  });

  // The default generation prompt takes the `currentPrompt.isDefault` branch,
  // which is where the string version was concatenated into a filename.
  genRow('gen-trivia-general-knowledge', { isDefault: true, gameType: 'trivia' });
  const genDefault = await put('gen-trivia-general-knowledge', { status: 'draft' });

  check('the DEFAULT generation prompt toggles too, and does not mint v1.0.01', () => {
    /*
      rejects: `newVersion = currentPrompt.version + 1` unguarded. With
      `version: '1.0.0'` that is the STRING '1.0.01', which went into
      `prompts/trivia/…/v1.0.01.json` and was stored back as the row's version —
      a version that no longer sorts, compares or increments.
    */
    assert.strictEqual(genDefault.statusCode, 200, genDefault.body);
    assert.strictEqual(row('gen-trivia-general-knowledge').status, 'draft');
    assert.strictEqual(row('gen-trivia-general-knowledge').version, '1.0.0');
    assert.strictEqual([...s3Store.keys()].some((k) => k.includes('1.0.01')), false,
      'a filename was built by string-concatenating a version');
  });

  const genBack = await put('gen-call-and-answer-lessons-learned', { status: 'active' });
  check('a generation prompt goes back to Active, which is what makes it a toggle', () => {
    // rejects: a one-way trip. The chip offers both directions on these rows.
    assert.strictEqual(genBack.statusCode, 200, genBack.body);
    assert.strictEqual(row('gen-call-and-answer-lessons-learned').status, 'active');
  });

  // The recovery path for a keyless row: supply the text and it DOES get a
  // bucket object, because now there is something to put in one.
  const genRebuild = await put('gen-call-and-answer-lessons-learned', {
    status: 'draft',
    template: 'Write scenarios about {context}',
  });
  check('supplying a body to a keyless row does mint a key, so this is not a lock-out', () => {
    /*
      rejects: skipping S3 on `!s3Key` alone. The skip is about having nothing
      to write, not about the row being untouchable — a caller that brings text
      has to be able to store it, and the version has to start at a number.
    */
    assert.strictEqual(genRebuild.statusCode, 200, genRebuild.body);
    const r = row('gen-call-and-answer-lessons-learned');
    assert(r.s3Key && r.s3Key.endsWith('/v1.json'),
      `expected a numeric first version, got ${r.s3Key}`);
    assert.strictEqual(r.version, 1);
    assert.strictEqual(JSON.parse(s3Store.get(r.s3Key)).template, 'Write scenarios about {context}');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
