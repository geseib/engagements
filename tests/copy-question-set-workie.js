/**
 * A COPY CARRIES ONLY THE WORKIE THE DESTINATION CAN USE —
 * lambda-functions/admin/copy-question-set.js
 *
 * `copy-question-set.js` builds the new metadata row by spreading the source's
 * wholesale (`...meta`). That is right for almost everything — the file says so
 * itself about content rows, "so a future row type is carried rather than
 * dropped" — and wrong for the two fields that are POINTERS INTO A LIBRARY:
 *
 *   promptId    how each round is summed up
 *   personaId   the voice it is summed up in
 *
 * A pointer is only meaningful where it can be followed. Copied into another
 * organisation, an id naming a Workie in the SOURCE team's library names
 * nothing the destination may read, so the copy arrives already broken: it says
 * it has a summary approach, the picker shows a value, and `get-ai-summary.js`
 * quietly uses the game-type default instead. Task 1 made that state
 * unreachable by a builder's own hand (`edit-question-set.js` refuses a
 * dangling id); the copy path was the way it still got in.
 *
 * ── AND `promptDropped`, WHICH IS ABOUT A DIFFERENT ROW ENTIRELY ────────────
 *
 * `shared/publish-set.js` writes `promptDropped: true` on a PUBLIC row to
 * record that the publishing org's own Workie did not come along (D5: an org
 * Workie never goes public). It is a fact about THAT publish, of THAT version,
 * by THAT team. Spread onto a copy it becomes a claim about a set that has
 * never been published at all — and it is not inert: `get-question-sets.js`
 * projects `promptDropped` on every row it lists, org rows included, so the
 * copying team's own library reports a drop that never happened to it.
 *
 * So it is deleted on every copy, unconditionally. There is no case where the
 * source's answer is the copy's answer.
 *
 * ── WHAT DECIDES: THE DESTINATION'S LIBRARIES, NOT THE PLATFORM'S ──────────
 *
 * `resolvePromptRef(db, table, id, { orgId })` reads the destination org's own
 * library first and the platform library second — the same order and the same
 * keys `get-ai-summary.js` follows at run time. Checking only the platform
 * library would drop an id the destination CAN read, and checking the source's
 * would keep one it cannot. Personas are platform-global, so the same id means
 * the same voice everywhere; it still has to exist and still has to speak.
 */
const path = require('path');
const assert = require('assert');

const H = require('./helpers/moderation-harness');
H.install();

const tenant = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant.js'));
const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const { promptKey } = require(path.join(H.REPO, 'lambda-functions/admin/shared/prompt-access.js'));
const { setMetadataKey, setPartition } = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));

const copySet = require(path.join(H.REPO, 'lambda-functions/admin/copy-question-set.js')).handler;

const ACME = 'org_acme';        // authored the set and its Workie
const GLOBEX = 'org_globex';    // copies the set out of a shared library

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

const SET = 'pricingmechanics';

/**
 * A set sitting in a library every organisation may copy from, with the one
 * category and one question a copy needs to be allowed at all. Platform and
 * public rows are plaintext — they have no tenant to key them to — which is
 * why the fixture seeds them as they are.
 */
function sharedSet(scope, meta = {}) {
  H.seedRow({
    ...setMetadataKey({ scope, orgId: '', setId: SET }),
    name: 'Pricing mechanics',
    engagementType: 'call-and-answer',
    scope,
    orgId: '',
    createdBy: 'sub-dai',
    ...meta,
  });
  const pk = setPartition({ scope, orgId: '', setId: SET }, null);
  H.seedRow({ PK: pk, SK: 'CATEGORY#c001', Name: 'Pricing', QuestionCount: 1 });
  H.seedRow({ PK: pk, SK: 'QUESTION#q001', Title: 'WHAT DID WE CHARGE', Detail: 'Say why.' });
}

/** Globex takes a copy. Returns its decrypted metadata row. */
async function copyInto(scope = tenant.PLATFORM) {
  const res = await copySet(H.orgEvent({
    orgId: GLOBEX, role: 'member', method: 'POST', setId: SET, body: { scope },
  }), H.ctx());
  assert.strictEqual(res.statusCode, 201, `Globex could not copy the set: ${res.statusCode} ${res.body}`);
  const { setId } = parse(res);
  const key = setMetadataKey({ scope: tenant.ORG, orgId: GLOBEX, setId });
  const [row] = H.rowsWhere((i) => i.PK === key.PK && i.SK === key.SK);
  assert.ok(row, `the copy left no metadata row at ${key.PK} / ${key.SK}`);
  return H.plainRow(GLOBEX, row);
}

(async () => {
  console.log('\na copy carries only the Workie the destination can use\n');

  console.log('1. the summary prompt');

  // rejects: `...meta` carrying an id that names a Workie in ANOTHER team's
  // library. Globex cannot read `ORG#org_acme#AIPROMPTS`, so the copy would
  // arrive pointing at nothing while claiming to have a summary approach.
  await H.test("a prompt from the source team's own library does not come along", async () => {
    H.reset();
    H.seedRow(await orgPrompt(ACME, 'acme-retro', 'Acme retro'));
    sharedSet(tenant.PUBLIC, { promptId: 'acme-retro', sourceOrgId: ACME });

    const copy = await copyInto(tenant.PUBLIC);
    assert.strictEqual('promptId' in copy, false,
      `the copy points at ${JSON.stringify(copy.promptId)}, which Globex cannot read`);
  });

  // rejects: dropping the pointer wholesale. The shared library is shared: a
  // platform Workie is exactly as readable from Globex as from anywhere.
  await H.test('a prompt from the platform library is kept', async () => {
    H.reset();
    H.seedRow(platformPrompt('house-retro', 'House retro'));
    sharedSet(tenant.PLATFORM, { promptId: 'house-retro' });

    const copy = await copyInto(tenant.PLATFORM);
    assert.strictEqual(copy.promptId, 'house-retro');
  });

  // rejects: checking the PLATFORM library only. The destination's own library
  // is read first, exactly as get-ai-summary.js reads it at run time — so the
  // id the copy stores is the one the copy will actually be summed up with.
  await H.test("a prompt in the DESTINATION's own library is kept", async () => {
    H.reset();
    H.seedRow(await orgPrompt(GLOBEX, 'teamretro', 'Globex retro'));
    sharedSet(tenant.PLATFORM, { promptId: 'teamretro' });

    const copy = await copyInto(tenant.PLATFORM);
    assert.strictEqual(copy.promptId, 'teamretro');
  });

  // rejects: keeping an id merely because a row answers to it. This is the
  // wreckage a careless copy leaves — Globex's partition, Acme's key — and it
  // is unreadable prose, not a Workie.
  await H.test("a prompt in our partition sealed to another org's key does not come along", async () => {
    H.reset();
    H.seedRow(await orgPrompt(GLOBEX, 'carried-over', 'Acme retro', ACME));
    sharedSet(tenant.PLATFORM, { promptId: 'carried-over' });

    const copy = await copyInto(tenant.PLATFORM);
    assert.strictEqual('promptId' in copy, false,
      `the copy points at ${JSON.stringify(copy.promptId)}, which is sealed to somebody else`);
  });

  // rejects: a prompt id that exists nowhere at all — the state
  // BuilderPage.jsx's seven invented ids left behind on real rows.
  await H.test('a prompt id that exists nowhere does not come along', async () => {
    H.reset();
    sharedSet(tenant.PLATFORM, { promptId: 'lessons-learned' });

    const copy = await copyInto(tenant.PLATFORM);
    assert.strictEqual('promptId' in copy, false, `the copy points at ${JSON.stringify(copy.promptId)}`);
  });

  console.log('\n2. promptDropped, which is a fact about a different row');

  // rejects: `...meta` carrying the publish marker. It says Acme's Workie did
  // not go public with Acme's version; get-question-sets.js would project it on
  // Globex's own unpublished set.
  await H.test('promptDropped never reaches a copy', async () => {
    H.reset();
    sharedSet(tenant.PUBLIC, { promptDropped: true, sourceOrgId: ACME });

    const copy = await copyInto(tenant.PUBLIC);
    assert.strictEqual('promptDropped' in copy, false,
      "the copy claims a prompt was dropped at a publish it was never part of");
  });

  // rejects: deleting promptDropped only when there is no prompt to keep. The
  // two are independent facts and the marker is wrong on a copy either way.
  await H.test('promptDropped never reaches a copy even beside a prompt that does', async () => {
    H.reset();
    H.seedRow(platformPrompt('house-retro', 'House retro'));
    sharedSet(tenant.PUBLIC, { promptDropped: true, promptId: 'house-retro', sourceOrgId: ACME });

    const copy = await copyInto(tenant.PUBLIC);
    assert.strictEqual(copy.promptId, 'house-retro');
    assert.strictEqual('promptDropped' in copy, false,
      'the copy carried the publish marker alongside a prompt it can read');
  });

  // rejects: replacing the source's marker with a freshly-minted one. Nothing
  // reads `promptDropped` as "this copy lost a Workie", and inventing that
  // meaning here would put a second author on a field publish-set.js owns.
  await H.test('a copy that loses its prompt does not mint a promptDropped of its own', async () => {
    H.reset();
    H.seedRow(await orgPrompt(ACME, 'acme-retro', 'Acme retro'));
    sharedSet(tenant.PUBLIC, { promptId: 'acme-retro', sourceOrgId: ACME });

    const copy = await copyInto(tenant.PUBLIC);
    assert.strictEqual('promptId' in copy, false);
    assert.strictEqual('promptDropped' in copy, false,
      'the copy invented a publish marker for a publish that has not happened');
  });

  console.log('\n3. the voice');

  // rejects: keeping a personaId with no persona behind it. Personas are
  // platform-global, so this is not a tenancy question — the row is simply gone.
  await H.test('a voice that no longer exists does not come along', async () => {
    H.reset();
    sharedSet(tenant.PLATFORM, { personaId: 'curator' });

    const copy = await copyInto(tenant.PLATFORM);
    assert.strictEqual('personaId' in copy, false, `the copy points at ${JSON.stringify(copy.personaId)}`);
  });

  // rejects: a voice that is switched off, and one with nothing to say —
  // personas.js falls through on both, so storing either promises a voice that
  // never speaks.
  await H.test('a voice that is turned off or has no words does not come along', async () => {
    for (const [personaId, extra] of [['retired', { status: 'inactive' }], ['voiceless', { voice: '   ' }]]) {
      H.reset();
      H.seedRow(persona(personaId, extra));
      sharedSet(tenant.PLATFORM, { personaId });

      const copy = await copyInto(tenant.PLATFORM);
      assert.strictEqual('personaId' in copy, false,
        `the copy kept the unusable voice ${personaId}: ${JSON.stringify(copy.personaId)}`);
    }
  });

  // rejects: dropping the voice wholesale. One cast of voices, the same id
  // everywhere — a live persona is as usable in Globex's copy as in the source.
  await H.test('a live voice is kept', async () => {
    H.reset();
    H.seedRow(persona('storyteller'));
    sharedSet(tenant.PLATFORM, { personaId: 'storyteller' });

    const copy = await copyInto(tenant.PLATFORM);
    assert.strictEqual(copy.personaId, 'storyteller');
  });

  console.log('\n4. a set that points at nothing still copies');

  // rejects: treating an absent id as a broken one. Most sets name neither
  // field, and a copy must not invent a value or refuse over one.
  await H.test('a set with neither setting copies, and gains neither', async () => {
    H.reset();
    sharedSet(tenant.PLATFORM);

    const copy = await copyInto(tenant.PLATFORM);
    assert.strictEqual('promptId' in copy, false, 'an unasked-for promptId was invented');
    assert.strictEqual('personaId' in copy, false, 'an unasked-for personaId was invented');
    assert.strictEqual(copy.name, 'Pricing mechanics', 'the copy did not arrive');
  });

  // rejects: a check that refuses rather than drops, and rejects one that runs
  // before the content is written. The copy is a mechanical duplication, not a
  // builder choosing a value — everything the destination CAN use still lands.
  await H.test('everything else still arrives, dropped Workie or not', async () => {
    H.reset();
    H.seedRow(await orgPrompt(ACME, 'acme-retro', 'Acme retro'));
    sharedSet(tenant.PUBLIC, {
      promptId: 'acme-retro', personaId: 'curator', promptDropped: true,
      description: 'How we priced it', sourceOrgId: ACME,
    });

    const copy = await copyInto(tenant.PUBLIC);
    assert.strictEqual(copy.name, 'Pricing mechanics');
    assert.strictEqual(copy.description, 'How we priced it');
    assert.strictEqual(copy.engagementType, 'call-and-answer');
    assert.strictEqual(copy.scope, tenant.ORG);
    assert.strictEqual(copy.orgId, GLOBEX);
    assert.strictEqual(copy.sourceSetId, SET);

    const contentPk = setPartition({ scope: tenant.ORG, orgId: GLOBEX, setId: copy.SK.replace('SET#', '') }, null);
    const sks = H.rowsWhere((i) => i.PK === contentPk).map((i) => i.SK).sort();
    assert.deepStrictEqual(sks, ['CATEGORY#c001', 'QUESTION#q001'],
      `the content rows did not reach the copy (found ${sks.join(', ') || 'none'})`);
  });

  H.summary();
})();
