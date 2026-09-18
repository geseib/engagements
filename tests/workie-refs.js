/**
 * WORKIE'S TWO SETTINGS, CHECKED BEFORE THEY ARE STORED —
 * lambda-functions/admin/shared/workie-refs.js and its two call sites.
 *
 * A question set carries `promptId` (how each round is summed up) and
 * `personaId` (the voice). Both resolve at RUN time and both degrade quietly
 * when they resolve to nothing: get-ai-summary.js falls back to the game-type
 * default and personas.js falls through to the next rung. Nothing ever told the
 * person who chose the value that it would not be used, because nothing checked
 * it at the moment it was written — `edit-question-set.js`'s OPTIONAL_FIELDS and
 * `upload-questions.js`'s metadata write both accepted any string at all.
 *
 * So this file is about the WRITE. A stored id that resolves to nothing is the
 * defect; a refusal a builder can act on is the fix.
 *
 * ── WHY 'missing' AND NOT 'unreadable' FOR ANOTHER ORG'S PROMPT ─────────────
 *
 * The task brief expected another organisation's prompt id to come back
 * `unreadable`. It comes back `missing`, deliberately, and the difference is a
 * rule this codebase already made and wrote down. `prompt-access.js`:
 *
 *   "a scope this caller cannot read is never probed, so another
 *    organisation's Workie is not 'forbidden' here, it is ABSENT"
 *
 * Reporting `unreadable` would mean probing `ORG#<someone else>#AIPROMPTS` —
 * which we cannot do, having only our own org id — or inferring the row's
 * existence some other way and then CONFIRMING it to the wrong tenant. Either
 * is the cross-tenant leak `findPromptForCaller` and `findSetForCaller` exist to
 * prevent, for one word in an error message.
 *
 * `unreadable` still earns its place, for the case that genuinely is one: a
 * prompt row sitting in THIS org's library sealed to a DIFFERENT org's key. We
 * found it, it is ours by partition, and we still cannot read a word of it —
 * which is exactly what a row copied across organisations looks like.
 */
const path = require('path');
const assert = require('assert');

const H = require('./helpers/moderation-harness');
H.install();

const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';

const W = require(path.join(H.REPO, 'lambda-functions/admin/shared/workie-refs.js'));
const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const tenant = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant.js'));
const { promptKey } = require(path.join(H.REPO, 'lambda-functions/admin/shared/prompt-access.js'));
const { setMetadataKey } = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));

const editSet = require(path.join(H.REPO, 'lambda-functions/admin/edit-question-set.js')).handler;
const upload = require(path.join(H.REPO, 'lambda-functions/admin/upload-questions.js')).handler;

const ACME = 'org_acme';
const BETA = 'org_beta';
const parse = (res) => JSON.parse(res.body || '{}');

/** A platform prompt row — the shared library, deliberately plaintext. */
const platformPrompt = (promptId, name) => ({
  ...promptKey({ scope: tenant.PLATFORM, promptId }),
  promptId,
  name,
  category: 'callandanswer',
  gameType: 'call-and-answer',
  status: 'active',
  s3Key: `prompts/call-and-answer/${promptId}/v1.json`,
});

/** An org prompt row, sealed to `sealedTo` (its own org unless we say otherwise). */
const orgPrompt = (orgId, promptId, name, sealedTo = orgId) => C.encryptItem(sealedTo, 'prompt', {
  ...promptKey({ scope: tenant.ORG, orgId, promptId }),
  promptId,
  name,
  scope: tenant.ORG,
  orgId,
  category: 'callandanswer',
  status: 'active',
  s3Key: `prompts/org/${orgId}/call-and-answer/${promptId}/v1.json`,
});

const persona = (personaId, extra = {}) => ({
  PK: tenant.personasPk(),
  SK: `PERSONA#${personaId}`,
  personaId,
  name: personaId,
  voice: 'You are dry, precise and short.',
  gameTypes: ['all'],
  status: 'active',
  ...extra,
});

/** A platform set an Engage admin owns, and the event that edits it. */
const platformSet = (setId, extra = {}) => ({
  ...setMetadataKey({ scope: tenant.PLATFORM, setId }),
  name: 'Retro',
  engagementType: 'call-and-answer',
  createdBy: 'sub-dai',
  ...extra,
});
const editPlatform = (setId, body) => H.platformEvent({ method: 'PUT', path: { setId }, body });

(async () => {
  console.log('\nworkie refs — the prompt and the voice a set points at\n');

  // ── 1. The resolver ──────────────────────────────────────────────────────

  await H.test('an absent id resolves ok with a null value — clearing is always allowed', async () => {
    H.reset();
    for (const empty of ['', '   ', null, undefined]) {
      assert.deepStrictEqual(
        await W.resolvePromptRef(db, T, empty, { orgId: ACME }), { ok: true, prompt: null },
        `a prompt id of ${JSON.stringify(empty)} must read as "no prompt", not as a dangling one`,
      );
      assert.deepStrictEqual(
        await W.resolvePersonaRef(db, T, empty), { ok: true, persona: null },
        `a persona id of ${JSON.stringify(empty)} must read as "no voice"`,
      );
    }
  });

  await H.test('a platform prompt id resolves, with an org and without one', async () => {
    H.reset();
    H.seedRow(platformPrompt('house-retro', 'House retro'));

    const forStaff = await W.resolvePromptRef(db, T, 'house-retro', { orgId: '' });
    assert.strictEqual(forStaff.ok, true, JSON.stringify(forStaff));
    assert.strictEqual(forStaff.prompt.name, 'House retro');

    // rejects: an org-only lookup. The platform library is the shared one —
    // every organisation reads it, so an org set may point at it.
    const forOrg = await W.resolvePromptRef(db, T, 'house-retro', { orgId: ACME });
    assert.strictEqual(forOrg.ok, true, JSON.stringify(forOrg));
    assert.strictEqual(forOrg.prompt.name, 'House retro');
  });

  await H.test("an org's own prompt resolves for that org, decrypted", async () => {
    H.reset();
    H.seedRow(await orgPrompt(ACME, 'acme-retro', 'Acme retro'));

    const res = await W.resolvePromptRef(db, T, 'acme-retro', { orgId: ACME });
    assert.strictEqual(res.ok, true, JSON.stringify(res));
    // rejects: handing back the sealed row. `name` is in ENCRYPTED_FIELDS.prompt,
    // so reading it proves the org library was decrypted and not merely found.
    assert.strictEqual(res.prompt.name, 'Acme retro');
  });

  await H.test("another organisation's prompt is absent, not forbidden", async () => {
    H.reset();
    H.seedRow(await orgPrompt(ACME, 'acme-retro', 'Acme retro'));

    // rejects: probing a partition this caller may not read, and rejects
    // answering in a way that confirms Acme has a Workie by this name. See the
    // header — `missing` here is the same answer findSetForCaller gives.
    assert.deepStrictEqual(
      await W.resolvePromptRef(db, T, 'acme-retro', { orgId: BETA }),
      { ok: false, reason: 'missing' },
    );
    assert.deepStrictEqual(
      await W.resolvePromptRef(db, T, 'acme-retro', { orgId: '' }),
      { ok: false, reason: 'missing' },
      'a platform set must not reach into an org library either',
    );
  });

  await H.test('a prompt in our own library sealed to another org is unreadable', async () => {
    H.reset();
    // The row a careless cross-org copy leaves behind: Beta's partition, Acme's key.
    H.seedRow(await orgPrompt(BETA, 'carried-over', 'Acme retro', ACME));

    // rejects: reporting it `missing` (it is right there) and rejects returning
    // a row whose prose is 60 bytes of noise every `x || fallback` reader would
    // treat as present.
    assert.deepStrictEqual(
      await W.resolvePromptRef(db, T, 'carried-over', { orgId: BETA }),
      { ok: false, reason: 'unreadable' },
    );
  });

  await H.test('a prompt id that exists nowhere is missing', async () => {
    H.reset();
    H.seedRow(platformPrompt('house-retro', 'House retro'));
    assert.deepStrictEqual(
      await W.resolvePromptRef(db, T, 'lessons-learned', { orgId: ACME }),
      { ok: false, reason: 'missing' },
    );
  });

  await H.test('an active persona resolves and an unusable one does not', async () => {
    H.reset();
    H.seedRow(persona('storyteller'));
    H.seedRow(persona('retired', { status: 'inactive' }));
    H.seedRow(persona('voiceless', { voice: '   ' }));

    const live = await W.resolvePersonaRef(db, T, 'storyteller');
    assert.strictEqual(live.ok, true, JSON.stringify(live));
    assert.strictEqual(live.persona.voice, 'You are dry, precise and short.');

    assert.deepStrictEqual(
      await W.resolvePersonaRef(db, T, 'retired'), { ok: false, reason: 'inactive' },
    );
    // rejects: calling an empty-voiced persona usable. personas.js falls
    // through on `!record.voice` exactly as it does on `status === 'inactive'`,
    // so storing one would promise a voice that never speaks.
    assert.deepStrictEqual(
      await W.resolvePersonaRef(db, T, 'voiceless'), { ok: false, reason: 'inactive' },
    );
    assert.deepStrictEqual(
      await W.resolvePersonaRef(db, T, 'nobody'), { ok: false, reason: 'missing' },
    );
  });

  await H.test('personas are platform-global — an org never gets its own', async () => {
    H.reset();
    H.seedRow(persona('storyteller'));
    // rejects: routing personas through promptsMetadataPk. tenant.personasPk()
    // ignores scope on purpose; a second partition would make the SAME id
    // resolve for one org and not another.
    assert.strictEqual(tenant.personasPk(), tenant.promptsMetadataPk(tenant.PLATFORM, ''));
    const res = await W.resolvePersonaRef(db, T, 'storyteller');
    assert.strictEqual(res.ok, true, JSON.stringify(res));
  });

  // ── 2. edit-question-set ─────────────────────────────────────────────────

  await H.test('editing a set refuses a summary prompt that does not exist', async () => {
    H.reset();
    H.seedRow(platformSet('retro'));

    const res = await editSet(editPlatform('retro', { name: 'Retro', promptId: 'lessons-learned' }), H.ctx());
    assert.strictEqual(res.statusCode, 400, res.body);
    const body = parse(res);
    // The message is read by somebody building a question set, so it says what
    // is wrong and what to do — not `promptId` and not a reason code.
    assert.match(body.error, /summary prompt/i, body.error);
    assert.match(body.error, /no longer exists/i, body.error);
    assert.match(body.error, /clear it/i, 'a refusal must name the way out');
    assert.doesNotMatch(body.error, /promptId|undefined|null/, 'no field names in a builder-facing message');
    // …and the field is named for the UI, beside the sentence rather than in it.
    assert.strictEqual(body.field, 'promptId');

    const [row] = H.rowsWhere((i) => i.SK === 'SET#retro');
    assert.strictEqual(row.promptId, undefined, 'a refused prompt id was written anyway');
  });

  await H.test('editing a set stores a summary prompt that does exist', async () => {
    H.reset();
    H.seedRow(platformSet('retro'));
    H.seedRow(platformPrompt('house-retro', 'House retro'));

    const res = await editSet(editPlatform('retro', { name: 'Retro', promptId: 'house-retro' }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).updated.promptId, 'house-retro');
    const [row] = H.rowsWhere((i) => i.SK === 'SET#retro');
    assert.strictEqual(row.promptId, 'house-retro');
  });

  await H.test('editing a set refuses a voice that does not exist, and one turned off', async () => {
    H.reset();
    H.seedRow(platformSet('retro'));
    H.seedRow(persona('retired', { status: 'inactive' }));

    for (const [personaId, pattern] of [['nobody', /no longer exists/i], ['retired', /turned off/i]]) {
      const res = await editSet(editPlatform('retro', { name: 'Retro', personaId }), H.ctx());
      assert.strictEqual(res.statusCode, 400, res.body);
      const body = parse(res);
      assert.match(body.error, /voice/i, body.error);
      assert.match(body.error, pattern, body.error);
      assert.doesNotMatch(body.error, /personaId/, 'no field names in a builder-facing message');
      assert.strictEqual(body.field, 'personaId');
      const [row] = H.rowsWhere((i) => i.SK === 'SET#retro');
      assert.strictEqual(row.personaId, undefined, `a refused voice (${personaId}) was written anyway`);
    }
  });

  await H.test('editing a set stores a voice that is live', async () => {
    H.reset();
    H.seedRow(platformSet('retro'));
    H.seedRow(persona('storyteller'));

    const res = await editSet(editPlatform('retro', { name: 'Retro', personaId: 'storyteller' }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).updated.personaId, 'storyteller');
    const [row] = H.rowsWhere((i) => i.SK === 'SET#retro');
    assert.strictEqual(row.personaId, 'storyteller');
  });

  // ── 2b. The legacy set: a value the builder never touched ────────────────
  //
  // Sets ALREADY point at ids that resolve to nothing — BuilderPage.jsx offers
  // seven the seeder never mints, and upload-questions.js used to stamp
  // `lessons-learned` on every set regardless of type. The editor sends the
  // whole set back, so a strict check on every save would refuse a RENAME over
  // a field the person never opened. Ruling W5: validate a changed value only.
  //
  // This is not a licence for the id to live forever. Ruling W4 (Task 5) shows
  // a stored id that is absent from the fetched list as unavailable, with a
  // one-click clear, so the builder meets it BEFORE saving rather than in a
  // refusal afterwards.

  await H.test('renaming a set does not re-argue a summary prompt nobody touched', async () => {
    H.reset();
    // `lessons-learned` is deliberately NOT in the library — this is the legacy
    // state the stamp left behind on 14 sets.
    H.seedRow(platformSet('retro', { promptId: 'lessons-learned' }));

    const res = await editSet(
      editPlatform('retro', { name: 'Retro, renamed', promptId: 'lessons-learned' }), H.ctx(),
    );
    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = H.rowsWhere((i) => i.SK === 'SET#retro');
    assert.strictEqual(row.name, 'Retro, renamed', 'the rename did not land');
    // rejects: "fixing" the dangling id by blanking it behind the builder's
    // back. Untouched means untouched.
    assert.strictEqual(row.promptId, 'lessons-learned');
  });

  await H.test('renaming a set does not re-argue a voice nobody touched', async () => {
    H.reset();
    H.seedRow(platformSet('retro', { personaId: 'curator' }));

    const res = await editSet(
      editPlatform('retro', { name: 'Retro, renamed', personaId: 'curator' }), H.ctx(),
    );
    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = H.rowsWhere((i) => i.SK === 'SET#retro');
    assert.strictEqual(row.name, 'Retro, renamed', 'the rename did not land');
    assert.strictEqual(row.personaId, 'curator');
  });

  await H.test('swapping one dangling summary prompt for another is still refused', async () => {
    H.reset();
    H.seedRow(platformSet('retro', { promptId: 'lessons-learned' }));

    // rejects: reading W5 as "a set with a dangling id is exempt". The
    // grandfathering is per VALUE, not per row — choosing a new broken id is a
    // choice, and it is refused exactly as it is on a clean set.
    const res = await editSet(editPlatform('retro', { name: 'Retro', promptId: 'still-gone' }), H.ctx());
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(parse(res).error, /summary prompt/i, res.body);
    assert.strictEqual(parse(res).field, 'promptId');
    const [row] = H.rowsWhere((i) => i.SK === 'SET#retro');
    assert.strictEqual(row.promptId, 'lessons-learned', 'a refused prompt id was written anyway');
  });

  await H.test('swapping one unusable voice for another is still refused', async () => {
    H.reset();
    H.seedRow(platformSet('retro', { personaId: 'curator' }));

    const res = await editSet(editPlatform('retro', { name: 'Retro', personaId: 'nobody' }), H.ctx());
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(parse(res).error, /voice/i, res.body);
    assert.strictEqual(parse(res).field, 'personaId');
    const [row] = H.rowsWhere((i) => i.SK === 'SET#retro');
    assert.strictEqual(row.personaId, 'curator', 'a refused voice was written anyway');
  });

  await H.test('clearing a dangling summary prompt is the way out, and it works', async () => {
    H.reset();
    H.seedRow(platformSet('retro', { promptId: 'lessons-learned' }));

    // The refusal above tells the builder to "clear it". This is that, on the
    // set that needs it most — the one whose prompt is already gone.
    const res = await editSet(editPlatform('retro', { name: 'Retro', promptId: '' }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = H.rowsWhere((i) => i.SK === 'SET#retro');
    assert.strictEqual(row.promptId, '');
  });

  await H.test('clearing either setting is still allowed', async () => {
    H.reset();
    H.seedRow(platformSet('retro', { promptId: 'house-retro', personaId: 'storyteller' }));

    // rejects: a validator that treats '' as a dangling id. Nothing is seeded
    // here on purpose — detaching a value must work even when the thing it used
    // to point at has already been deleted, which is the common case.
    const res = await editSet(editPlatform('retro', { name: 'Retro', promptId: '', personaId: null }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = H.rowsWhere((i) => i.SK === 'SET#retro');
    assert.strictEqual(row.promptId, '');
    assert.strictEqual(row.personaId, '');
  });

  await H.test("an org set may point at its own org's prompt", async () => {
    H.reset();
    H.seedRow(await C.encryptItem(ACME, 'set', {
      ...setMetadataKey({ scope: tenant.ORG, orgId: ACME, setId: 'teamretro' }),
      name: 'Team retro', engagementType: 'call-and-answer', scope: tenant.ORG, orgId: ACME,
      createdBy: 'sub-amara',
    }));
    H.seedRow(await orgPrompt(ACME, 'acme-retro', 'Acme retro'));

    // rejects: validating against the PLATFORM library only, which is the exact
    // defect get-ai-summary.js's promptLibrariesFor was written to fix — an org
    // could author a Workie, attach it, and never hear it.
    const res = await editSet(
      H.orgEvent({ orgId: ACME, method: 'PUT', setId: 'teamretro', body: { name: 'Team retro', promptId: 'acme-retro' } }),
      H.ctx(),
    );
    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = H.rowsWhere((i) => i.SK === 'SET#teamretro');
    assert.strictEqual(row.promptId, 'acme-retro');
  });

  // ── 3. upload-questions ──────────────────────────────────────────────────

  const csv = 'Category,Title\n"General","A question"';

  await H.test('importing a set refuses a summary prompt that does not exist', async () => {
    H.reset();
    const res = await upload(H.platformEvent({
      method: 'POST',
      body: {
        fileName: 'x.csv', fileContent: csv, customTitle: 'Imported Set',
        engagementType: 'call-and-answer', promptId: 'lessons-learned',
      },
    }), H.ctx());

    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(parse(res).error, /summary prompt/i, res.body);
    assert.strictEqual(parse(res).field, 'promptId');
    // rejects: refusing after the rows are written. Nothing at all may land.
    assert.deepStrictEqual(H.rowsWhere(() => true), [], 'a refused import still wrote rows');
  });

  await H.test('importing a set stores a summary prompt that does exist', async () => {
    H.reset();
    H.seedRow(platformPrompt('house-retro', 'House retro'));
    const res = await upload(H.platformEvent({
      method: 'POST',
      body: {
        fileName: 'x.csv', fileContent: csv, customTitle: 'Imported Set',
        engagementType: 'call-and-answer', promptId: 'house-retro',
      },
    }), H.ctx());

    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = H.rowsWhere((i) => String(i.SK).startsWith('SET#') && i.name === 'Imported Set');
    assert.ok(row, 'the imported set has no metadata row');
    assert.strictEqual(row.promptId, 'house-retro');
  });

  await H.test('importing a set with no prompt at all still works', async () => {
    H.reset();
    const res = await upload(H.platformEvent({
      method: 'POST',
      body: {
        fileName: 'x.csv', fileContent: csv, customTitle: 'Plain Set',
        engagementType: 'call-and-answer',
      },
    }), H.ctx());

    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = H.rowsWhere((i) => String(i.SK).startsWith('SET#') && i.name === 'Plain Set');
    assert.ok(row, 'the imported set has no metadata row');
    assert.strictEqual('promptId' in row, false, 'an unasked-for promptId was invented');
  });

  H.summary();
})();
