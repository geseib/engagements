/**
 * Question-set EDIT regression tests — lambda-functions/admin/edit-question-set.js
 * plus both set-list projections and the import-time promptId default.
 *
 * Runs the REAL handlers against a stubbed DynamoDB document client whose
 * `update` actually evaluates the UpdateExpression. That matters: the bug these
 * tests exist for is entirely about which clauses make it into that expression,
 * so a stub that returns {} without applying anything would pass while the
 * product stayed broken.
 *
 * Stubbing follows tests/import-questions-flow.js and tests/delete-question-set-flow.js:
 * hook Module._load BY MODULE NAME. The require.cache-by-resolved-path trick in
 * art-title-flow.js silently misses, because several @aws-sdk packages exist
 * only in the deployed bundle and cannot be resolved from the repo root.
 *
 * What these tests pin down:
 *   - clearing customInstruction PERSISTS an empty string (the headline bug:
 *     blanking a field used to be a silent no-op and the old value came back)
 *   - a field the editor omits is left untouched
 *   - promptId can be detached ('' → stored empty, runtime falls back to the
 *     game-type default)
 *   - roundNoun round-trips edit -> both projections
 *   - personaId and hasImages appear in BOTH projections (D10, D19)
 *   - updatedAt (lower case) moves after an edit, and the admin projection still
 *     shows a date for rows written with the legacy `UpdatedAt`
 *   - engagementType is editable and validated
 *   - upload no longer stamps 'lessons-learned' on every set regardless of type
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK before any handler loads -----------------------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const TABLE = 'test-table';

const store = new Map();        // "PK|SK" -> Item
const log = [];                 // every command the handlers issued
const k = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(k(item.PK, item.SK), item);
function resetDb() { store.clear(); log.length = 0; }

/**
 * Apply a `SET a = :a, #b = :b` UpdateExpression to an item.
 *
 * Deliberately strict: an unmapped #name or :value throws rather than being
 * ignored, because that is exactly the class of mistake (a clause added to the
 * expression without its value) that would otherwise surface only in production.
 */
function applyUpdate(item, inp) {
  const names = inp.ExpressionAttributeNames || {};
  const values = inp.ExpressionAttributeValues || {};
  const m = /^\s*SET\s+([\s\S]*)$/i.exec(inp.UpdateExpression || '');
  if (!m) throw new Error(`unsupported UpdateExpression: ${inp.UpdateExpression}`);
  for (const clause of m[1].split(',')) {
    const parts = clause.split('=');
    if (parts.length !== 2) throw new Error(`unsupported clause: ${clause}`);
    const lhs = parts[0].trim();
    const rhs = parts[1].trim();
    const attr = lhs.startsWith('#') ? names[lhs] : lhs;
    if (!attr) throw new Error(`unmapped attribute name ${lhs}`);
    if (!(rhs in values)) throw new Error(`unmapped attribute value ${rhs}`);
    item[attr] = values[rhs];
  }
  return item;
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    log.push({ type: cmd.type, input: inp });

    if (cmd.type === 'get') return { Item: store.get(k(inp.Key.PK, inp.Key.SK)) };
    if (cmd.type === 'put') { put(inp.Item); return {}; }
    if (cmd.type === 'delete') { store.delete(k(inp.Key.PK, inp.Key.SK)); return {}; }

    if (cmd.type === 'update') {
      const id = k(inp.Key.PK, inp.Key.SK);
      const item = store.get(id) || { ...inp.Key };
      applyUpdate(item, inp);
      store.set(id, item);
      return { Attributes: item };
    }

    if (cmd.type === 'batchWrite') {
      for (const reqs of Object.values(inp.RequestItems || {})) {
        for (const r of reqs) {
          if (r.PutRequest) put(r.PutRequest.Item);
          if (r.DeleteRequest) store.delete(k(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
        }
      }
      return { UnprocessedItems: {} };
    }

    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const pk = v[':pk'] ?? v[':setpk'];
      const prefix = v[':sk'] ?? '';
      const items = [...store.values()]
        .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
      return { Items: items, Count: items.length };
    }

    return { Items: [], Count: 0 };
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand,
  ScanCommand, UpdateCommand, BatchWriteCommand,
});

process.env.TABLE_NAME = TABLE;

const editSet = require(path.join(REPO, 'lambda-functions', 'admin', 'edit-question-set.js')).handler;
const adminList = require(path.join(REPO, 'lambda-functions', 'admin', 'get-question-sets.js')).handler;
const gameList = require(path.join(REPO, 'lambda-functions', 'game', 'get-question-sets.js')).handler;
const upload = require(path.join(REPO, 'lambda-functions', 'admin', 'upload-questions.js')).handler;

// Silence the handlers' very chatty logging unless DEBUG=1.
if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const edit = (setId, body) => editSet({ pathParameters: { setId }, body: JSON.stringify(body) });
const parse = (res) => JSON.parse(res.body);
const metaOf = (setId) => store.get(k('SETS', `SET#${setId}`));

const OLD_TIMESTAMP = '2020-01-01T00:00:00.000Z';
function seedSet(overrides = {}) {
  put({
    PK: 'SETS',
    SK: 'SET#retro',
    name: 'Retro Set',
    description: 'A description that exists',
    customInstruction: 'Original custom instruction',
    aiContextInstruction: 'Original AI context',
    promptId: 'lessons-learned',
    engagementType: 'call-and-answer',
    questionCount: 12,
    categoryCount: 2,
    active: true,
    hasImages: false,
    createdAt: OLD_TIMESTAMP,
    updatedAt: OLD_TIMESTAMP,
    ...overrides,
  });
}

(async () => {
  // ===========================================================================
  say('\n1. THE HEADLINE BUG: clearing a field must persist the clear');
  // ===========================================================================
  resetDb();
  seedSet();
  let res = await edit('retro', { name: 'Retro Set', customInstruction: '' });
  check('edit returns 200', () =>
    assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`));
  check('customInstruction is stored as an empty string, not left alone', () =>
    assert.strictEqual(metaOf('retro').customInstruction, '',
      `got ${JSON.stringify(metaOf('retro').customInstruction)}`));
  check('the response reports the change so the UI can say what landed', () =>
    assert.deepStrictEqual(parse(res).updated, { customInstruction: '' }));

  say('\n   a re-read through the admin projection must not resurrect it');
  let listed = parse(await adminList({})).questionSets.find((s) => s.id === 'retro');
  check('admin list shows the cleared value', () =>
    assert.strictEqual(listed.customInstruction, '', `got ${JSON.stringify(listed.customInstruction)}`));

  // ===========================================================================
  say('\n2. An omitted field is left untouched');
  // ===========================================================================
  resetDb();
  seedSet();
  res = await edit('retro', { name: 'Renamed Set' });
  check('edit returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
  check('name updated', () => assert.strictEqual(metaOf('retro').name, 'Renamed Set'));
  check('description untouched', () =>
    assert.strictEqual(metaOf('retro').description, 'A description that exists'));
  check('customInstruction untouched', () =>
    assert.strictEqual(metaOf('retro').customInstruction, 'Original custom instruction'));
  check('aiContextInstruction untouched', () =>
    assert.strictEqual(metaOf('retro').aiContextInstruction, 'Original AI context'));
  check('promptId untouched', () => assert.strictEqual(metaOf('retro').promptId, 'lessons-learned'));
  check('engagementType untouched', () =>
    assert.strictEqual(metaOf('retro').engagementType, 'call-and-answer'));
  check('nothing but the name reported as changed', () =>
    assert.deepStrictEqual(parse(res).updated, {}));

  // ===========================================================================
  say('\n3. promptId can be detached (there was previously no way to do this)');
  // ===========================================================================
  resetDb();
  seedSet();
  res = await edit('retro', { name: 'Retro Set', promptId: '' });
  check('edit returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
  check('promptId cleared', () =>
    assert.strictEqual(metaOf('retro').promptId, '', `got ${JSON.stringify(metaOf('retro').promptId)}`));
  check('cleared promptId is falsy, so get-ai-summary falls back to the default', () =>
    assert.ok(!metaOf('retro').promptId));

  say('\n   and a legacy caller sending null still means "clear", not "skip"');
  resetDb();
  seedSet();
  await edit('retro', { name: 'Retro Set', aiContextInstruction: null });
  check('null coerced to an empty string', () =>
    assert.strictEqual(metaOf('retro').aiContextInstruction, ''));

  // ===========================================================================
  say('\n4. roundNoun round-trips edit -> both projections');
  // ===========================================================================
  resetDb();
  seedSet();
  res = await edit('retro', { name: 'Retro Set', roundNoun: 'Lesson' });
  check('edit returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
  check('roundNoun stored', () => assert.strictEqual(metaOf('retro').roundNoun, 'Lesson'));

  listed = parse(await adminList({})).questionSets.find((s) => s.id === 'retro');
  check('admin projection exposes roundNoun', () =>
    assert.strictEqual(listed.roundNoun, 'Lesson'));

  let gameSets = parse(await gameList({})).sets;
  check('game projection exposes roundNoun', () =>
    assert.strictEqual(gameSets.find((s) => s.id === 'retro').roundNoun, 'Lesson'));

  say('\n   and it can be cleared back to the engagement-type default');
  await edit('retro', { name: 'Retro Set', roundNoun: '' });
  check('roundNoun cleared', () => assert.strictEqual(metaOf('retro').roundNoun, ''));
  gameSets = parse(await gameList({})).sets;
  check('game projection reports null for an empty roundNoun', () =>
    assert.strictEqual(gameSets.find((s) => s.id === 'retro').roundNoun, null));

  // ===========================================================================
  say('\n5. personaId and hasImages appear in BOTH projections (D10, D19)');
  // ===========================================================================
  resetDb();
  seedSet({ SK: 'SET#art', name: 'Famous Art Titles', hasImages: true, roundNoun: 'Artwork' });
  put({ PK: 'SET#art', SK: 'CATEGORY#c001', Name: 'Renaissance', QuestionCount: 5 });

  res = await edit('art', { name: 'Famous Art Titles', personaId: 'curator' });
  check('edit returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
  check('personaId stored', () => assert.strictEqual(metaOf('art').personaId, 'curator'));

  const adminArt = parse(await adminList({})).questionSets.find((s) => s.id === 'art');
  check('admin projection exposes personaId', () =>
    assert.strictEqual(adminArt.personaId, 'curator'));
  check('admin projection exposes hasImages', () =>
    assert.strictEqual(adminArt.hasImages, true));

  const gameArt = parse(await gameList({})).sets.find((s) => s.id === 'art');
  check('game projection exposes personaId', () =>
    assert.strictEqual(gameArt.personaId, 'curator'));
  check('game projection exposes hasImages so the picker can badge art sets', () =>
    assert.strictEqual(gameArt.hasImages, true));
  check('game projection exposes promptId', () =>
    assert.strictEqual(gameArt.promptId, 'lessons-learned'));
  check('game projection still carries its categories', () =>
    assert.strictEqual(gameArt.categories.length, 1));
  seedSet();
  const gamePlain = parse(await gameList({})).sets.find((s) => s.id === 'retro');
  check('a set without images reports hasImages false, never undefined', () =>
    assert.strictEqual(gamePlain.hasImages, false));

  // ===========================================================================
  say('\n6. updatedAt moves after an edit, and the legacy casing still reads');
  // ===========================================================================
  resetDb();
  seedSet();
  await edit('retro', { name: 'Retro Set' });
  check('lower-case updatedAt written (matches every other writer + the reader)', () => {
    const item = metaOf('retro');
    assert.ok(item.updatedAt && item.updatedAt !== OLD_TIMESTAMP,
      `updatedAt was ${JSON.stringify(item.updatedAt)}`);
  });
  check('no capital-U UpdatedAt introduced', () =>
    assert.strictEqual(metaOf('retro').UpdatedAt, undefined));
  listed = parse(await adminList({})).questionSets.find((s) => s.id === 'retro');
  check('the list timestamp actually moves', () =>
    assert.notStrictEqual(listed.updatedAt, OLD_TIMESTAMP));

  say('\n   a row written before the fix (capital U only) still shows a date');
  resetDb();
  seedSet({ SK: 'SET#legacy', updatedAt: undefined, UpdatedAt: '2021-06-01T00:00:00.000Z' });
  delete metaOf('legacy').updatedAt;
  listed = parse(await adminList({})).questionSets.find((s) => s.id === 'legacy');
  check('legacy UpdatedAt used as a fallback', () =>
    assert.strictEqual(listed.updatedAt, '2021-06-01T00:00:00.000Z'));

  // ===========================================================================
  say('\n7. engagementType is editable and validated');
  // ===========================================================================
  resetDb();
  seedSet();
  res = await edit('retro', { name: 'Retro Set', engagementType: 'trivia' });
  check('edit returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
  check('engagementType updated — a mis-imported set is now fixable', () =>
    assert.strictEqual(metaOf('retro').engagementType, 'trivia'));

  res = await edit('retro', { name: 'Retro Set', engagementType: 'callandanswer' });
  check('a legacy spelling is normalised, not stored verbatim', () =>
    assert.strictEqual(metaOf('retro').engagementType, 'call-and-answer'));

  res = await edit('retro', { name: 'Retro Set', engagementType: 'nonsense' });
  check('an unknown type is rejected with 400', () =>
    assert.strictEqual(res.statusCode, 400, `got ${res.statusCode}: ${res.body}`));
  check('and the stored value is unchanged by the rejected edit', () =>
    assert.strictEqual(metaOf('retro').engagementType, 'call-and-answer'));

  say('\n   guard rails still hold');
  res = await edit('retro', { name: '   ' });
  check('a blank name is rejected', () => assert.strictEqual(res.statusCode, 400, res.body));
  res = await editSet({ pathParameters: {}, body: JSON.stringify({ name: 'x' }) });
  check('a missing setId is rejected', () => assert.strictEqual(res.statusCode, 400, res.body));

  // ===========================================================================
  say('\n8. Several fields in one save all land');
  // ===========================================================================
  resetDb();
  seedSet();
  res = await edit('retro', {
    name: 'Retro Set',
    description: 'New description',
    customInstruction: '',
    aiContextInstruction: 'Fresh context',
    promptId: 'art-summary',
    roundNoun: 'Artwork',
    engagementType: 'wavelength',
  });
  check('edit returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
  check('every field landed', () => {
    const item = metaOf('retro');
    assert.deepStrictEqual(
      {
        description: item.description,
        customInstruction: item.customInstruction,
        aiContextInstruction: item.aiContextInstruction,
        promptId: item.promptId,
        roundNoun: item.roundNoun,
        engagementType: item.engagementType,
      },
      {
        description: 'New description',
        customInstruction: '',
        aiContextInstruction: 'Fresh context',
        promptId: 'art-summary',
        roundNoun: 'Artwork',
        engagementType: 'wavelength',
      }
    );
  });
  await edit('retro', { name: 'Retro Set', roundNoun: '  Scenario  ' });
  check('whitespace around a value is trimmed', () =>
    assert.strictEqual(metaOf('retro').roundNoun, 'Scenario'));

  // ===========================================================================
  say('\n9. Import no longer stamps lessons-learned on every set');
  // ===========================================================================
  resetDb();
  const TRIVIA_CSV = [
    'Category,Title,QuestionDetail,OptionA,OptionB,OptionC,OptionD,CorrectAnswer,AnswerDetails,Difficulty',
    '"Science","SKY COLOUR","Why is the sky blue?","Rayleigh scattering","Magic","Paint","Ozone","OptionA","Short wavelengths scatter most.","easy"',
  ].join('\n');

  let up = await upload({
    body: JSON.stringify({
      fileName: 'trivia.csv', fileContent: TRIVIA_CSV,
      customTitle: 'Science Trivia', engagementType: 'trivia',
    }),
  });
  check('upload returns 200', () => assert.strictEqual(up.statusCode, 200, up.body));
  check('no call-and-answer prompt attached to a trivia set', () => {
    const item = metaOf('sciencetrivia');
    assert.strictEqual(item.promptId, undefined,
      `got ${JSON.stringify(item.promptId)} — the runtime default should resolve by game type instead`);
  });

  say('\n   but an explicitly chosen prompt is still honoured');
  up = await upload({
    body: JSON.stringify({
      fileName: 'trivia2.csv', fileContent: TRIVIA_CSV,
      customTitle: 'Chosen Prompt Set', engagementType: 'trivia',
      promptId: 'trivia-summary',
    }),
  });
  check('upload returns 200', () => assert.strictEqual(up.statusCode, 200, up.body));
  check('promptId written when supplied', () =>
    assert.strictEqual(metaOf('chosenpromptset').promptId, 'trivia-summary'));

  // ===========================================================================
  say('\n10. The frontend must not reintroduce "blank means null"');
  // ===========================================================================
  // AdminPage.jsx is JSX, so it cannot be required from plain Node and its
  // payload builder cannot be exercised here. What CAN be pinned is the exact
  // line that caused the bug: `field.trim() || null` flattened every blank field
  // to null, and the backend skipped nulls, so blanking anything was a silent
  // no-op. This is a source check, and it is deliberately narrow.
  //
  // The editor was extracted out of AdminPage.jsx into QuestionSetEditor.jsx +
  // utils/questionSetEditing.js, so this must scan the whole editing surface.
  // Pinning one filename made this fail for a refactor that kept the contract
  // perfectly — a test that cries wolf on a rename teaches people to ignore it.
  const editorFiles = [
    ['src', 'src', 'AdminPage.jsx'],
    ['src', 'src', 'components', 'QuestionSetEditor.jsx'],
    ['src', 'src', 'utils', 'questionSetEditing.js'],
  ];
  const fs = require('fs');
  const editorSource = editorFiles
    .map((p) => path.join(REPO, ...p))
    .filter((p) => fs.existsSync(p))
    .map((p) => fs.readFileSync(p, 'utf8'))
    .join('\n');

  check('no `.trim() || null` left in the set-edit payload', () =>
    assert.strictEqual(/\.trim\(\)\s*\|\|\s*null/.test(editorSource), false,
      'a blank field is being flattened to null again — the backend will skip it'));

  // Assert the CONTRACT, not a variable name: the payload builder compares each
  // field against a snapshot of what was loaded, and only sends the ones that
  // differ. Whatever it is called, that comparison has to be there — without it
  // an untouched field is sent every time (harmless) or, far worse, a cleared
  // field is dropped and blanking silently reverts.
  check('the edit payload is still built as a diff against the loaded values', () =>
    assert.ok(
      /current\[\s*field\s*\]\s*!==\s*\(?\s*original\[/.test(editorSource)
        || /editOriginal/.test(editorSource),
      'the omit-untouched / send-empty-when-cleared contract is gone'));

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write(`harness error: ${e && e.stack}\n`); process.exit(1); });
