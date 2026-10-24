/**
 * PROMPT VERSIONS — the backend half of docs/design/prompt-versions/.
 *
 *   1. every content save is a new version; the old object is never rewritten
 *   2. the versions list: recorded history, plus S3 objects saved before it
 *   3. make-live moves the row's pointer, and the Workie reader follows it
 *   4. save-from-repo: a new live version that remembers its repo file + hash
 *   5. scope isolation: another org's versions are absent, not forbidden
 *   6. a reseed of the built-in defaults is a new version, not an overwrite
 *
 * The REAL handlers (create/update/get-ai-prompts, populate-defaults, and the
 * game side's resolvePromptTemplate) against in-memory DynamoDB, S3 and KMS.
 * Stubbing by request NAME through Module._load, as the neighbouring suites
 * do, because several SDK packages exist only in the deployed bundle.
 */
const suiteFinished = require('./helpers/finish-guard');
process.env.TEAM_WORKIE_AUTHORING = 'on';

const path = require('path');
const assert = require('assert');
const fs = require('fs');

const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

// ---- in-memory table ---------------------------------------------------------
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
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), JSON.parse(JSON.stringify(inp.Item))); return {};
      case 'get': {
        const item = store.get(key(inp.Key.PK, inp.Key.SK));
        return { Item: item ? JSON.parse(JSON.stringify(item)) : undefined };
      }
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': {
        const k = key(inp.Key.PK, inp.Key.SK);
        const item = store.get(k) || { ...inp.Key };
        const names = inp.ExpressionAttributeNames || {};
        const values = Object.fromEntries(
          Object.entries(inp.ExpressionAttributeValues || {}).filter(([, v]) => v !== undefined)
        );
        const expr = String(inp.UpdateExpression || '');
        for (const ref of expr.match(/:[A-Za-z0-9_]+/g) || []) {
          if (!(ref in values)) throw new Error(`ValidationException: ${ref} not defined`);
        }
        // The one condition make-live writes: `s3Key = :liveKey`.
        const cond = /^(\w+) = (:\w+)$/.exec(String(inp.ConditionExpression || ''));
        if (cond && item[cond[1]] !== values[cond[2]]) {
          const e = new Error('ConditionalCheckFailedException'); e.name = 'ConditionalCheckFailedException'; throw e;
        }
        const setPart = (expr.replace(/^SET /, '').match(/^(.*?)(?:\s+REMOVE\b|$)/i) || [])[1];
        for (const clause of (setPart || '').split(',')) {
          const m = clause.trim().match(/^(#?[\w.]+)\s*=\s*(:\w+)$/);
          if (m) item[names[m[1]] || m[1]] = JSON.parse(JSON.stringify(values[m[2]]));
        }
        const removePart = (expr.match(/REMOVE\s+(.*)$/i) || [])[1];
        for (const t of (removePart || '').split(',').filter(Boolean)) delete item[names[t.trim()] || t.trim()];
        store.set(k, item);
        return { Attributes: item };
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
        return { Items: items.map((i) => JSON.parse(JSON.stringify(i))), Count: items.length };
      }
      default: return { Items: [], Count: 0 };
    }
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

// ---- in-memory S3, with LastModified and write counts -----------------------
const s3Store = new Map();      // key -> { body, at }
const s3Writes = new Map();     // key -> number of PutObjects
let clock = Date.parse('2026-08-01T10:00:00Z');
const tick = () => new Date(clock += 60000);
const putObject = (k, body, at = tick()) => { s3Store.set(k, { body, at }); s3Writes.set(k, (s3Writes.get(k) || 0) + 1); };
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      const i = cmd.input;
      if (cmd.type === 'put') { putObject(i.Key, i.Body); return {}; }
      if (cmd.type === 'get') {
        const o = s3Store.get(i.Key);
        if (!o) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
        return { Body: { transformToString: async () => o.body } };
      }
      if (cmd.type === 'list') {
        const Contents = [...s3Store.entries()]
          .filter(([k]) => k.startsWith(i.Prefix || ''))
          .map(([k, o]) => ({ Key: k, LastModified: o.at }));
        return { Contents, IsTruncated: false };
      }
      if (cmd.type === 'delete') { s3Store.delete(i.Key); return {}; }
      return {};
    }
  },
  PutObjectCommand: class { constructor(i) { this.input = i; this.type = 'put'; } },
  GetObjectCommand: class { constructor(i) { this.input = i; this.type = 'get'; } },
  DeleteObjectCommand: class { constructor(i) { this.input = i; this.type = 'delete'; } },
  DeleteObjectsCommand: class { constructor(i) { this.input = i; this.type = 'deleteMany'; } },
  ListObjectsV2Command: class { constructor(i) { this.input = i; this.type = 'list'; } },
});

// ---- KMS, as the key policy behaves ------------------------------------------
const nodeCrypto = require('crypto');
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const orgId = command.input.EncryptionContext.orgId;
        const k = nodeCrypto.randomBytes(32);
        return { Plaintext: k, CiphertextBlob: Buffer.from(JSON.stringify({ orgId, key: k.toString('base64') })) };
      }
      const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
      if (blob.orgId !== command.input.EncryptionContext.orgId) throw new Error('InvalidCiphertextException');
      return { Plaintext: Buffer.from(blob.key, 'base64') };
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});

// ---- the game side's other clients, never reached here -----------------------
const noop = class { async send() { return {}; } };
stub('@aws-sdk/client-lambda', { LambdaClient: noop, InvokeCommand: class {} });
stub('@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient: noop, PostToConnectionCommand: class {} });
stub('@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient: noop, InvokeModelCommand: class {} });

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

const admin = (f) => require(path.join(REPO, 'lambda-functions', 'admin', f));
const createPrompt = admin('create-ai-prompt.js');
const updatePrompt = admin('update-ai-prompt.js');
const getPrompts = admin('get-ai-prompts.js');
const populateDefaults = admin('populate-defaults.js');
const versions = admin('shared/prompt-versions.js');
const C = admin('shared/tenant-crypto.js');
const { resolvePromptTemplate } = require(path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'));
const repoPrompts = JSON.parse(fs.readFileSync(path.join(REPO, 'src', 'src', 'config', 'repoPrompts.json'), 'utf8'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const caller = (lambda) => ({ requestContext: { authorizer: { lambda } } });
const PLATFORM_ADMIN = caller({ userId: 'sub-g', username: 'g', email: 'george@seibtribe.com', groups: 'admins', status: 'enabled' });
const ORG_A = 'org_acme';
const ORG_B = 'org_globex';
const orgAdmin = (orgId, sub) => caller({
  userId: sub, username: sub, email: `${sub}@example.com`, groups: 'admins', status: 'enabled',
  orgId, orgRole: 'admin', orgIds: orgId,
});
async function mintOrg(orgId) {
  const blob = await C.createOrgDataKey(orgId);
  store.set(key(`ORG#${orgId}`, 'METADATA'), { PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  C.forgetOrg(orgId);
}

const BODY = {
  name: 'Retro Workie',
  description: 'what the room learned',
  gameType: 'call-and-answer',
  promptType: 'analysis',
  category: 'lessons-learned',
  status: 'active',
  instructions: 'You read back the round.\nResponses: {responsesText}',
  outputFormat: '## Summary\nWhat the room said, in two sentences.',
};
const parse = (r) => { try { return JSON.parse(r.body); } catch { return {}; } };
const post = async (who, body = {}) => parse(await createPrompt.handler({ ...who, body: JSON.stringify({ ...BODY, ...body }) }));
const put = async (who, promptId, body) => {
  const r = await updatePrompt.handler({ ...who, pathParameters: { promptId }, body: JSON.stringify(body) });
  return { status: r.statusCode, body: parse(r) };
};
const getVersions = async (who, promptId, extra = {}) => {
  const r = await getPrompts.handler({ ...who, queryStringParameters: { versions: promptId, ...extra } });
  return { status: r.statusCode, body: parse(r) };
};
const row = (promptId, pk = 'AIPROMPTS') => store.get(key(pk, `AIPROMPT#${promptId}`));
const bodyAt = (k) => JSON.parse(s3Store.get(k).body);
const reset = () => { store.clear(); s3Store.clear(); s3Writes.clear(); };

(async () => {
  say('\nprompt versions\n');

  // ── 1 ─────────────────────────────────────────────────────────────────────
  say('1. every content save is a new version');
  reset();
  const { promptId } = await post(PLATFORM_ADMIN);
  const v1Key = row(promptId).s3Key;
  await check('create records v1 in the history, with who and how', () => {
    const r = row(promptId);
    assert.strictEqual(r.latestVersion, 1);
    assert.strictEqual(r.versionHistory.length, 1);
    assert.deepStrictEqual(
      { v: r.versionHistory[0].version, by: r.versionHistory[0].by, how: r.versionHistory[0].how, key: r.versionHistory[0].s3Key },
      { v: 1, by: 'george@seibtribe.com', how: 'edit', key: v1Key },
    );
    assert.match(r.versionHistory[0].hash, /^[0-9a-f]{16}$/);
  });

  const edit = await put(PLATFORM_ADMIN, promptId, { ...BODY, instructions: `${BODY.instructions}\nBe brief.` });
  await check('an ordinary editor save (no createNewVersion) mints v2', () => {
    assert.strictEqual(edit.status, 200, JSON.stringify(edit.body));
    assert.strictEqual(edit.body.version, 2);
    assert.strictEqual(edit.body.newVersion, true);
    assert.strictEqual(row(promptId).s3Key, versions.versionFromKey(edit.body.s3Key) === 2 ? edit.body.s3Key : '?');
  });
  await check('v1\'s object is still there, written once and never again', () => {
    assert.strictEqual(s3Writes.get(v1Key), 1);
    assert.strictEqual(bodyAt(v1Key).instructions, BODY.instructions);
  });
  const statusOnly = await put(PLATFORM_ADMIN, promptId, { status: 'draft' });
  await check('a status-only save is not a version', () => {
    assert.strictEqual(statusOnly.status, 200);
    assert.strictEqual(statusOnly.body.newVersion, false);
    assert.strictEqual(row(promptId).version, 2);
    assert.strictEqual(row(promptId).versionHistory.length, 2);
  });
  const same = await put(PLATFORM_ADMIN, promptId, { ...BODY, instructions: `${BODY.instructions}\nBe brief.` });
  await check('sending the same text back is not a version either', () => {
    assert.strictEqual(same.body.newVersion, false);
    assert.strictEqual(row(promptId).latestVersion, 2);
  });
  const upload = await put(PLATFORM_ADMIN, promptId, { ...BODY, outputFormat: '## Summary\nThree sentences.', versionHow: 'upload' });
  await check('a save from an uploaded file says so', () => {
    assert.strictEqual(upload.body.version, 3);
    assert.strictEqual(row(promptId).versionHistory[2].how, 'upload');
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────
  say('\n2. the versions list');
  const listed = await getVersions(PLATFORM_ADMIN, promptId);
  await check('newest first, the live one marked, who and how from the history', () => {
    assert.strictEqual(listed.status, 200, JSON.stringify(listed.body));
    assert.deepStrictEqual(listed.body.versions.map((v) => v.version), [3, 2, 1]);
    assert.deepStrictEqual(listed.body.versions.map((v) => v.live), [true, false, false]);
    assert.deepStrictEqual(listed.body.versions.map((v) => v.how), ['upload', 'edit', 'edit']);
    assert.ok(listed.body.versions.every((v) => v.by === 'george@seibtribe.com' && v.recorded));
  });
  const one = await getVersions(PLATFORM_ADMIN, promptId, { version: '1' });
  await check('one version\'s text, for View and Compare with live', () => {
    assert.strictEqual(one.status, 200);
    assert.strictEqual(one.body.content.instructions, BODY.instructions);
    assert.strictEqual(one.body.version.version, 1);
  });
  await check('the list response carries the live text\'s field hashes and no history array', async () => {
    const r = parse(await getPrompts.handler({ ...PLATFORM_ADMIN, queryStringParameters: { includeContent: 'true' } }));
    const p = r.prompts.find((x) => x.promptId === promptId);
    assert.strictEqual(p.versionHistory, undefined);
    assert.strictEqual(p.versionCount, 3);
    assert.deepStrictEqual(p.fieldHashes, versions.fieldHashes(bodyAt(row(promptId).s3Key)));
  });

  // A row from before version history: three objects, no history, no latestVersion.
  const LEGACY = 'legacy-retro';
  for (const n of [1, 2, 3]) {
    putObject(`prompts/call-and-answer/${LEGACY}/v${n}.json`, JSON.stringify({ ...BODY, id: LEGACY, version: n, instructions: `${BODY.instructions}\nv${n}` }));
  }
  store.set(key('AIPROMPTS', `AIPROMPT#${LEGACY}`), {
    PK: 'AIPROMPTS', SK: `AIPROMPT#${LEGACY}`, promptId: LEGACY, name: 'Legacy', gameType: 'call-and-answer',
    promptType: 'analysis', status: 'active', version: 3, s3Key: `prompts/call-and-answer/${LEGACY}/v3.json`,
  });
  const legacy = await getVersions(PLATFORM_ADMIN, LEGACY);
  await check('versions saved before history are synthesised from S3, By and How unknown', () => {
    assert.deepStrictEqual(legacy.body.versions.map((v) => v.version), [3, 2, 1]);
    assert.ok(legacy.body.versions.every((v) => v.how === 'unknown' && v.by === null && v.recorded === false));
    assert.ok(legacy.body.versions.every((v) => typeof v.savedAt === 'string' && v.savedAt.startsWith('2026-08-01')));
    assert.strictEqual(legacy.body.versions[0].live, true);
  });
  const IMPORTED = 'imported-123-abc';
  putObject(`prompts/call-and-answer/${IMPORTED}/v1.json`, JSON.stringify({ ...BODY, id: IMPORTED }));
  store.set(key('AIPROMPTS', `AIPROMPT#${IMPORTED}`), {
    PK: 'AIPROMPTS', SK: `AIPROMPT#${IMPORTED}`, promptId: IMPORTED, gameType: 'call-and-answer',
    version: 1, s3Key: `prompts/call-and-answer/${IMPORTED}/v1.json`, importedFrom: { archiveId: 'a1' },
  });
  await check('an archive import\'s v1 reads "Imported from the archive", by admin import', async () => {
    const v = (await getVersions(PLATFORM_ADMIN, IMPORTED)).body.versions[0];
    assert.deepStrictEqual({ how: v.how, by: v.by }, { how: 'archive', by: 'admin import' });
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────
  say('\n3. make live');
  const objectsBefore = new Map([...s3Store.entries()].map(([k, o]) => [k, o.body]));
  const live1 = await put(PLATFORM_ADMIN, promptId, { action: 'make-live', version: 1 });
  await check('the row now points at v1', () => {
    assert.strictEqual(live1.status, 200, JSON.stringify(live1.body));
    assert.strictEqual(row(promptId).version, 1);
    assert.strictEqual(row(promptId).s3Key, v1Key);
    assert.strictEqual(row(promptId).latestVersion, 3);
    assert.deepStrictEqual(
      { v: row(promptId).lastMadeLive.version, from: row(promptId).lastMadeLive.from },
      { v: 1, from: 3 },
    );
  });
  await check('nothing was written to S3 and nothing deleted', () => {
    assert.deepStrictEqual(new Map([...s3Store.entries()].map(([k, o]) => [k, o.body])), objectsBefore);
  });
  await check('the Workie reader (get-ai-summary resolvePromptTemplate) reads v1', async () => {
    const resolved = await resolvePromptTemplate(promptId, 'call-and-answer', '');
    assert.strictEqual(resolved.promptId, promptId);
    assert.strictEqual(resolved.promptData.instructions, BODY.instructions);
    assert.strictEqual(resolved.promptData.version, 1);
  });
  await check('the list now marks v1 live, and v3 stays listed', async () => {
    const v = (await getVersions(PLATFORM_ADMIN, promptId)).body.versions;
    assert.deepStrictEqual(v.map((x) => [x.version, x.live]), [[3, false], [2, false], [1, true]]);
  });
  const afterLive = await put(PLATFORM_ADMIN, promptId, { ...BODY, instructions: `${BODY.instructions}\nNew after v1.` });
  await check('the next save is v4 — never a second v2 over the first', () => {
    assert.strictEqual(afterLive.body.version, 4);
    // v2's object was rewritten in place only by the two saves that changed no
    // content while it was live; what it SAYS is what v2 recorded.
    const v2 = row(promptId).versionHistory.find((h) => h.version === 2);
    assert.strictEqual(versions.contentHash(bodyAt(edit.body.s3Key)), v2.hash);
    assert.ok(bodyAt(edit.body.s3Key).instructions.endsWith('Be brief.'));
  });
  const missing = await put(PLATFORM_ADMIN, promptId, { action: 'make-live', version: 9 });
  await check('a version that does not exist is refused, nothing changed', () => {
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(row(promptId).version, 4);
  });
  await check('make-live with no version number is refused', async () => {
    assert.strictEqual((await put(PLATFORM_ADMIN, promptId, { action: 'make-live' })).status, 400);
  });
  putObject(`prompts/call-and-answer/${promptId}/v5.json`, JSON.stringify({ id: promptId, version: 5, name: 'broken' }));
  await check('a version the summary engine could not run is refused', async () => {
    const r = await put(PLATFORM_ADMIN, promptId, { action: 'make-live', version: 5 });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(row(promptId).version, 4);
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────
  say('\n4. save from the repo');
  reset();
  const entry = repoPrompts.prompts.find((p) => p.key === 'demo-sets/lessons-from-different-schools.prompt.json');
  const imported = await post(PLATFORM_ADMIN, {
    name: `${entry.name} (Imported 2026-08-15)`, description: 'older', instructions: BODY.instructions, outputFormat: BODY.outputFormat,
  });
  const fromRepo = await put(PLATFORM_ADMIN, imported.promptId, {
    from: 'repo',
    repoSource: { key: entry.key, path: entry.path, fields: entry.fields, commitDate: entry.commitDate },
    ...entry.values,
  });
  await check('a new version, live, recorded as From the repo', () => {
    assert.strictEqual(fromRepo.status, 200, JSON.stringify(fromRepo.body));
    assert.strictEqual(fromRepo.body.version, 2);
    const h = row(imported.promptId).versionHistory[1];
    assert.deepStrictEqual({ how: h.how, repoKey: h.repoKey, v: h.version }, { how: 'repo', repoKey: entry.key, v: 2 });
    assert.strictEqual(row(imported.promptId).s3Key, h.s3Key);
  });
  await check('the row stores repoSource with the repo file\'s own hash', () => {
    const src = row(imported.promptId).repoSource;
    assert.strictEqual(src.key, entry.key);
    assert.strictEqual(src.hash, entry.hash);
    assert.deepStrictEqual(src.fieldHashes, entry.fieldHashes);
    assert.strictEqual(src.version, 2);
  });
  await check('the live text now hashes equal to the repo entry (Matches the repo)', async () => {
    const r = parse(await getPrompts.handler({ ...PLATFORM_ADMIN, queryStringParameters: { includeContent: 'true' } }));
    const p = r.prompts.find((x) => x.promptId === imported.promptId);
    for (const f of entry.fields) assert.strictEqual(p.fieldHashes[f], entry.fieldHashes[f], f);
  });
  await check('v1 (the imported text) is still in the list', async () => {
    const v = (await getVersions(PLATFORM_ADMIN, imported.promptId)).body.versions;
    assert.deepStrictEqual(v.map((x) => [x.version, x.live, x.how]), [[2, true, 'repo'], [1, false, 'edit']]);
  });
  await check('a from-repo save that names no repo file is refused, nothing changed', async () => {
    const r = await put(PLATFORM_ADMIN, imported.promptId, { from: 'repo', instructions: 'x {responsesText}', outputFormat: 'y' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(row(imported.promptId).latestVersion, 2);
  });

  // ── 5 ─────────────────────────────────────────────────────────────────────
  say('\n5. scope isolation');
  reset();
  await mintOrg(ORG_A);
  await mintOrg(ORG_B);
  const amara = orgAdmin(ORG_A, 'amara');
  const bilal = orgAdmin(ORG_B, 'bilal');
  const orgPrompt = await post(amara, { scope: 'org' });
  const orgPk = `ORG#${ORG_A}#AIPROMPTS`;
  await put(amara, orgPrompt.promptId, { ...BODY, instructions: `${BODY.instructions}\nOrg v2.` });
  await check('an org prompt\'s versions stay in its own S3 path, sealed', () => {
    const r = row(orgPrompt.promptId, orgPk);
    assert.strictEqual(r.version, 2);
    for (const e of r.versionHistory) {
      assert.ok(e.s3Key.startsWith(`prompts/org/${ORG_A}/`), e.s3Key);
      assert.ok(!s3Store.get(e.s3Key).body.includes('You read back'), 'org body stored in the clear');
    }
  });
  await check('its own org reads the list and one version\'s text, decrypted', async () => {
    const l = await getVersions(amara, orgPrompt.promptId);
    assert.deepStrictEqual(l.body.versions.map((v) => v.version), [2, 1]);
    const v1 = await getVersions(amara, orgPrompt.promptId, { version: '1' });
    assert.strictEqual(v1.body.content.instructions, BODY.instructions);
  });
  await check('another org gets 404 on the list — absent, not forbidden', async () => {
    assert.strictEqual((await getVersions(bilal, orgPrompt.promptId)).status, 404);
  });
  await check('another org cannot make a version live (404), nothing changed', async () => {
    assert.strictEqual((await put(bilal, orgPrompt.promptId, { action: 'make-live', version: 1 })).status, 404);
    assert.strictEqual(row(orgPrompt.promptId, orgPk).version, 2);
  });
  await check('an Engage admin outside the org cannot either', async () => {
    const r = await put(PLATFORM_ADMIN, orgPrompt.promptId, { action: 'make-live', version: 1 });
    assert.ok([403, 404].includes(r.status), String(r.status));
    assert.strictEqual(row(orgPrompt.promptId, orgPk).version, 2);
  });
  await check('its own org can, and the reader follows inside the org', async () => {
    assert.strictEqual((await put(amara, orgPrompt.promptId, { action: 'make-live', version: 1 })).status, 200);
    const resolved = await resolvePromptTemplate(orgPrompt.promptId, 'call-and-answer', ORG_A);
    assert.strictEqual(resolved.promptData.instructions, BODY.instructions);
  });
  await check('a platform prompt cannot be made live by an org admin', async () => {
    const plat = await post(PLATFORM_ADMIN);
    await put(PLATFORM_ADMIN, plat.promptId, { ...BODY, instructions: `${BODY.instructions}\nP2` });
    const r = await put(amara, plat.promptId, { action: 'make-live', version: 1 });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(row(plat.promptId).version, 2);
  });

  // ── 6 ─────────────────────────────────────────────────────────────────────
  say('\n6. a reseed of the built-in defaults is a new version');
  reset();
  const internal = {};
  await populateDefaults.handler({ ...internal, body: JSON.stringify({ overwrite: false }) });
  const seeded = [...store.values()].filter((r) => String(r.SK).startsWith('AIPROMPT#'));
  const lessons = seeded.find((r) => r.name === 'Lessons Learned - Strategic Insights');
  await check('a first seed writes v1, How: Seeded default, with its repo identity', () => {
    assert.strictEqual(lessons.version, 1);
    assert.strictEqual(lessons.versionHistory[0].how, 'seed');
    assert.strictEqual(lessons.repoSource.key, versions.defaultsRepoKey('call-and-answer', 'lessons-learned'));
    const e = repoPrompts.prompts.find((p) => p.key === lessons.repoSource.key);
    assert.strictEqual(lessons.repoSource.hash, e.hash);
  });
  await put(PLATFORM_ADMIN, lessons.promptId, {
    instructions: `${BODY.instructions}\nEdited here.`, outputFormat: BODY.outputFormat,
  });
  await populateDefaults.handler({ ...internal, body: JSON.stringify({ overwrite: true }) });
  const reseeded = row(lessons.promptId);
  await check('overwrite: v3, and the edit made here (v2) is kept, not overwritten', () => {
    assert.strictEqual(reseeded.version, 3);
    assert.deepStrictEqual(reseeded.versionHistory.map((h) => [h.version, h.how]), [[1, 'seed'], [2, 'edit'], [3, 'seed']]);
    assert.ok(bodyAt(reseeded.versionHistory[1].s3Key).instructions.endsWith('Edited here.'));
    assert.strictEqual(s3Writes.get(reseeded.versionHistory[0].s3Key), 1);
  });

  // ── 7 ─────────────────────────────────────────────────────────────────────
  say('\n7. scripts/apply-repo-prompts.js — the library\'s Save, for every prompt at once');
  reset();
  const applyScript = require(path.join(REPO, 'scripts', 'apply-repo-prompts.js'));
  const match = await import(require('url').pathToFileURL(path.join(REPO, 'src', 'src', 'utils', 'repoPromptMatch.js')).href);
  await populateDefaults.handler({ body: JSON.stringify({ overwrite: false }) });
  const transfer = repoPrompts.prompts.find((p) => p.key === 'demo-sets/lessons-from-different-schools.prompt.json');
  const stale = await post(PLATFORM_ADMIN, {
    name: `${transfer.name} (Imported 2026-08-15)`, description: 'older', instructions: BODY.instructions, outputFormat: BODY.outputFormat,
  });
  const editedDefault = [...store.values()].find((r) => r.name === 'Lessons Learned - Strategic Insights');
  await put(PLATFORM_ADMIN, editedDefault.promptId, { instructions: `${BODY.instructions}\nEdited here.`, outputFormat: BODY.outputFormat });
  const editedVersion = row(editedDefault.promptId).version;
  const opts = {
    listHandler: getPrompts.handler, updateHandler: updatePrompt.handler,
    entries: repoPrompts.prompts, match, by: 'george@seibtribe.com',
  };
  const dry = await applyScript.run({ ...opts, apply: false });
  await check('dry run: the stale import is planned, the edited default is skipped, nothing written', () => {
    const planned = dry.rows.filter((r) => r.action === 'save').map((r) => r.prompt.promptId);
    assert.deepStrictEqual(planned, [stale.promptId]);
    const skipped = dry.rows.find((r) => r.prompt.promptId === editedDefault.promptId);
    assert.match(skipped.note, /edited on this tier/);
    assert.strictEqual(row(stale.promptId).version, 1);
  });
  const applied = await applyScript.run({ ...opts, apply: true });
  await check('apply: one new version, From the repo, verified as matching', () => {
    assert.deepStrictEqual(applied.saved.map((r) => [r.prompt.promptId, r.newVersion]), [[stale.promptId, 2]]);
    assert.deepStrictEqual([applied.failed.length, applied.unverified.length], [0, 0]);
    const h = row(stale.promptId).versionHistory[1];
    assert.deepStrictEqual({ how: h.how, by: h.by, repoKey: h.repoKey }, { how: 'repo', by: 'george@seibtribe.com', repoKey: transfer.key });
    assert.strictEqual(row(editedDefault.promptId).version, editedVersion);
  });
  await check('a second run has nothing to do', async () => {
    const again = await applyScript.run({ ...opts, apply: true });
    assert.deepStrictEqual(again.saved, []);
  });
  await check('--include-edited replaces the edit with the repo text, and the edit stays in the history', async () => {
    const forced = await applyScript.run({ ...opts, apply: true, includeEdited: true, only: 'strategic insights' });
    assert.deepStrictEqual(forced.saved.map((r) => r.prompt.promptId), [editedDefault.promptId]);
    const r = row(editedDefault.promptId);
    assert.strictEqual(r.version, editedVersion + 1);
    assert.ok(bodyAt(r.versionHistory[editedVersion - 1].s3Key).instructions.endsWith('Edited here.'));
  });

  await check('an archived prompt is never planned, even when the repo is newer', () => {
    const rows = applyScript.planRows([{ ...row(stale.promptId), name: transfer.name, status: 'archived', fieldHashes: {} }],
      repoPrompts.prompts, match, {});
    assert.deepStrictEqual(rows.map((r) => [r.action, r.note]), [['none', 'skipped: archived']]);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
