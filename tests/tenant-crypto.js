/**
 * THE PRIVACY PROMISE, PINNED.
 *
 * docs/design/tenancy-redesign/08-privacy.html tells a paying customer that
 * their questions, answers, votes, summaries and reports are stored encrypted
 * under a key belonging to their organisation alone, and that Engage staff
 * browsing the table see "identifiers and ciphertext". Every one of those words
 * is a claim about what the tenant-crypto.js copies do, and a claim
 * about data at rest is exactly the kind that stays green while being false —
 * nothing in the product misbehaves when a field ships in plaintext. This file
 * is the only thing between that promise and a quiet lie.
 *
 * rejects: a field in the ENCRYPT column shipping as plaintext; decryptValue
 * returning garbage instead of throwing when the orgId AAD is wrong; the
 * passthrough rule breaking so pre-migration plaintext throws (which would take
 * the estate down on deploy day); a KMS call per item instead of per org per
 * container; an unbounded key cache; tampered ciphertext being accepted; an
 * unknown entity silently encrypting nothing; a blank orgId being tolerated;
 * the three bundle copies drifting.
 *
 * The cipher is REAL — node:crypto, real round trips. Only KMS is stubbed,
 * because the point of a data key is that nothing on the hot path talks to it.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before the module loads ------------------------------
// @aws-sdk/client-kms is not installed anywhere this file can resolve it from
// (see the integration note — it is a dependency the bundles still need), so it
// MUST be intercepted by request string, exactly as tests/games-list-
// authorization.js intercepts the Cognito client.
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

const nodeCrypto = require('crypto');

/** Every KMS call this run made, so the caching claims are measurable. */
const kmsCalls = { generate: 0, decrypt: 0 };
/** Set to fail the NEXT Decrypt, to prove a failure is not cached. */
let failNextDecrypt = false;

class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }

/**
 * A KMS that behaves the way the real one will once the key policy lands: a
 * blob is bound to the encryption context it was generated under, and a Decrypt
 * whose context disagrees is refused. `wrapLoose` mints a blob with NO bound
 * context — that is not something the real KMS produces, it is how this file
 * simulates an attacker who has already obtained an org's plaintext data key,
 * so that the AES-GCM AAD can be shown to be a SECOND, independent barrier
 * rather than the same check counted twice.
 */
function wrap(orgId, key) {
  return Buffer.from(JSON.stringify({ orgId, key: key.toString('base64') }), 'utf8');
}
function wrapLoose(key) {
  return Buffer.from(JSON.stringify({ orgId: null, key: key.toString('base64') }), 'utf8');
}

stubs.set('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        kmsCalls.generate++;
        assert.ok(command.input.KeyId, 'GenerateDataKey must name the CMK');
        assert.strictEqual(command.input.KeySpec, 'AES_256');
        const orgId = command.input.EncryptionContext?.orgId;
        assert.ok(orgId, 'GenerateDataKey must bind an orgId');
        const key = nodeCrypto.randomBytes(32);
        return { Plaintext: key, CiphertextBlob: wrap(orgId, key) };
      }
      if (command instanceof DecryptCommand) {
        kmsCalls.decrypt++;
        if (failNextDecrypt) { failNextDecrypt = false; throw new Error('KMS unavailable'); }
        const ctx = command.input.EncryptionContext?.orgId;
        // The key policy will DENY a Decrypt with no orgId in its context.
        if (!ctx) throw new Error('AccessDeniedException: no orgId in encryption context');
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        if (blob.orgId && blob.orgId !== ctx) {
          throw new Error('InvalidCiphertextException: encryption context mismatch');
        }
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});

process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));

// The wrapped blobs this run's orgs have on ORG#<id>/METADATA.
const blobs = new Map();
C.setCiphertextLoader(async (orgId) => blobs.get(orgId) || '');

/** Mint an org the way create-org will: one GenerateDataKey, blob on the row. */
async function newOrg(orgId) {
  blobs.set(orgId, await C.createOrgDataKey(orgId));
  return orgId;
}

let pass = 0, fail = 0;
const results = [];
function check(label, fn) { results.push({ label, fn }); }
async function run() {
  for (const { label, fn } of results) {
    try { await fn(); console.log(`  ok - ${label}`); pass++; }
    catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail++; }
  }
}

// ---------- 1. The boundary is DATA, and it is the agreed one ----------
// If each call site kept its own field list they would drift, and the way that
// drift presents is a new field shipping in plaintext with every test green.
console.log('\n1. the plaintext/ciphertext boundary is one exported list');
check('question fields are exactly the agreed set', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.question].sort(), [
    'AnswerDetails', 'CustomInstructions', 'Detail', 'Title',
    'optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF',
  ].sort()));
check('set fields are exactly the agreed set', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.set].sort(),
    ['aiContextInstruction', 'customInstruction', 'description', 'name',
     // Added after review: customer-authored prose, the same kind of content
     // as customInstruction, and missing only because the approved boundary
     // happened to name the other four.
     'roundKindBrief'].sort()));

// THE SESSION BRIEF, and the inconsistency that put it here. `report.gameTitle`
// and `report.hostName` were already in the ENCRYPT column, and they are the
// SAME TWO STRINGS as Title/HostName on GAME#<id>/METADATA — so one sentence
// would have been ciphertext in the report row and readable in the session row
// of the same table.
check('session fields are exactly the agreed set', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.session].sort(),
    ['AIContext', 'Details', 'HostName', 'Title'].sort()));
check('the session row and the report row agree about the same two strings', () => {
  assert.ok(C.ENCRYPTED_FIELDS.session.includes('Title'));
  assert.ok(C.ENCRYPTED_FIELDS.report.includes('gameTitle'));
  assert.ok(C.ENCRYPTED_FIELDS.session.includes('HostName'));
  assert.ok(C.ENCRYPTED_FIELDS.report.includes('hostName'));
});
// AccessCode gates entry to a private session. It is COMPARED, never read back
// to anyone, so encrypting it would break the comparison and protect nothing.
check('AccessCode is deliberately NOT encrypted', () =>
  assert.ok(!C.ENCRYPTED_FIELDS.session.includes('AccessCode')));
check('an answer row encrypts what the participant wrote', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.answer].sort(),
    ['Answer', 'ProcessedWords'].sort()));
// THE DERIVED TALLY QUOTES THE ANSWERS BACK. Encrypting the answer row and
// leaving this one alone protects nothing — the same sentence is one Query
// away, in `answers[].answer` on the wavelength results row.
check('the results row encrypts the answers it quotes', () => {
  assert.ok(C.ENCRYPTED_FIELDS.results.includes('answers'));
  assert.ok(C.ENCRYPTED_FIELDS.results.includes('wordAnalysis'));
  assert.ok(C.ENCRYPTED_FIELDS.results.includes('Winners'));
});
check('...but not the counts, which the privacy page already concedes', () => {
  assert.ok(!C.ENCRYPTED_FIELDS.results.includes('VoteTallies'));
  assert.ok(!C.ENCRYPTED_FIELDS.results.includes('TotalVotes'));
});
check('a ballot encrypts the Votes map', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.vote], ['Votes']));
check('the AI summary encrypts DebugInfo, which carries the whole prompt', () =>
  assert.ok(C.ENCRYPTED_FIELDS.aiSummary.includes('DebugInfo')));
check('a report encrypts what quotes a person, not the counts', () => {
  assert.ok(C.ENCRYPTED_FIELDS.report.includes('detailedQuestions'));
  assert.ok(C.ENCRYPTED_FIELDS.report.includes('playerPerformance'));
  assert.ok(!C.ENCRYPTED_FIELDS.report.includes('gameStats'));
});
check('a generation job encrypts the pasted source document', () =>
  assert.ok(C.ENCRYPTED_FIELDS.job.includes('request')));

// THE CATEGORY NAME IS PLAINTEXT ON PURPOSE. HostMask1/2/3 address categories
// POSITIONALLY and the position derives from the stored names; encrypting them
// reorders the mask and activates the wrong categories.
check('category Name stays plaintext — the 24-bit mask depends on its order', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.category], []));

// A COMMENT ON ONE SECTION OF A ROUND'S REPORT.
// SK=COMMENT#<nnn>#<anchorKind>#<anchorRef>#<commentId>.
//
// This is customer-authored prose, written by a named person, about a named
// person's response — among the most sensitive content the table holds.
//
// `AnchorExcerpt` is the trap. It is a verbatim slice of the material being
// commented on, copied onto the comment row at write time so a comment stays
// readable in the session report without the round beside it. That makes it a
// SECOND COPY of an answer or a summary, in a different row, and encrypting
// `Text` alone would leave the participant's actual words readable at rest
// while the commentary about them was ciphertext — the same shape of mistake
// as encrypting `Answer` but not `ProcessedWords`.
check('comment encrypts the prose, the excerpt and the label', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.comment].sort(),
    ['AnchorExcerpt', 'AnchorLabel', 'Text']));

// The author is conceded visible exactly as it is on `answer`: PlayerName is
// part of the sort key on an answer row and cannot be hidden there, so
// encrypting it on a comment would buy nothing and break the join.
check('comment PlayerName stays plaintext, as it does on answer', () => {
  assert.ok(!C.ENCRYPTED_FIELDS.comment.includes('PlayerName'));
  assert.ok(!C.ENCRYPTED_FIELDS.answer.includes('PlayerName'));
});

// The anchor is a key, not content: a reader has to group by it without asking
// KMS anything, and create-report.js groups thousands of rows in one pass.
check('comment anchor coordinates stay plaintext so rows can be grouped', () => {
  assert.ok(!C.ENCRYPTED_FIELDS.comment.includes('AnchorKind'));
  assert.ok(!C.ENCRYPTED_FIELDS.comment.includes('AnchorRef'));
  assert.ok(!C.ENCRYPTED_FIELDS.comment.includes('QuestionNumber'));
});

// The index, the owner and the counts stay readable, which is exactly what the
// privacy page promises is visible.
const NEVER_ENCRYPTED = ['PK', 'SK', 'orgId', 'createdBy', 'createdAt', 'updatedAt',
  'questionCount', 'categoryCount', 'active', 'visibility', 'engagementType',
  'hasImages', 'activeVersion', 'versions', 'Name', 'correctAnswer'];
for (const f of NEVER_ENCRYPTED) {
  check(`${f} appears in no entity's list`, () => {
    for (const [entity, fields] of Object.entries(C.ENCRYPTED_FIELDS)) {
      assert.ok(!fields.includes(f), `${entity} would encrypt ${f}`);
    }
  });
}
// Frozen, so one handler cannot quietly widen or narrow the boundary for every
// other handler in the same container. (Sloppy mode swallows the assignment
// rather than throwing, so assert the EFFECT, not the exception.)
check('the list cannot be edited at run time', () => {
  const before = [...C.ENCRYPTED_FIELDS.question];
  try { C.ENCRYPTED_FIELDS.question.push('sneak'); } catch (e) { /* strict mode */ }
  try { C.ENCRYPTED_FIELDS.newEntity = ['x']; } catch (e) { /* strict mode */ }
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.question], before);
  assert.strictEqual(C.ENCRYPTED_FIELDS.newEntity, undefined);
});

// ---------- 2. Nothing in the ENCRYPT column ships as plaintext ----------
console.log('\n2. an encrypted field never reaches the table readable');
const SECRET = 'the client is threatening to walk in Q3';
check('every named field becomes an envelope and the row still finds itself', async () => {
  const org = await newOrg('org_nw');
  const row = {
    PK: 'ORG#org_nw#SET#teamretro', SK: 'QUESTION#delivery#001',
    Title: SECRET, Detail: 'what went wrong', optionA: 'a', optionF: 'f',
    AnswerDetails: 'because', CustomInstructions: 'be blunt',
    Category: 'delivery', QuestionNumber: 1, Active: true,
  };
  const enc = await C.encryptItem(org, 'question', row);
  // The claim in the customer's words: browsing the table shows identifiers
  // and ciphertext. Search the WHOLE serialised row, not just the fields we
  // remembered to look at.
  assert.ok(!JSON.stringify(enc).includes(SECRET), 'the question text is in the row');
  assert.ok(!JSON.stringify(enc).includes('be blunt'));
  for (const f of C.ENCRYPTED_FIELDS.question) {
    if (!(f in row)) continue;
    assert.ok(C.isEnvelope(enc[f]), `${f} is not an envelope`);
  }
  assert.strictEqual(enc.PK, row.PK, 'the key must stay queryable');
  assert.strictEqual(enc.SK, row.SK);
  assert.strictEqual(enc.Category, 'delivery');
  assert.strictEqual(enc.QuestionNumber, 1);
  assert.strictEqual(enc.Active, true);
});
// AND THE SAME CLAIM MADE WITHOUT CONSULTING THE LIST. The check above trusts
// ENCRYPTED_FIELDS to say what should be encrypted, so quietly deleting a field
// from it passes. These names are written out by hand, from the boundary the
// owner approved: if one is dropped from the module, its text lands in the
// table in the clear and this goes red.
const MUST_NOT_LEAK = {
  question: ['Title', 'Detail', 'optionA', 'optionB', 'optionC', 'optionD',
    'optionE', 'optionF', 'AnswerDetails', 'CustomInstructions'],
  set: ['name', 'description', 'customInstruction', 'aiContextInstruction',
    'roundKindBrief'],
  // The session brief. Its Title/HostName are the same two strings as
  // report.gameTitle/hostName below — they must not be ciphertext in one row
  // and readable in the other.
  session: ['Title', 'HostName', 'Details', 'AIContext'],
  answer: ['Answer', 'ProcessedWords'],
  // The derived tally quoted the answers back in the clear before this.
  results: ['Winners', 'answers', 'question', 'wordAnalysis'],
  vote: ['Votes'],
  aiSummary: ['Summary', 'SummaryText', 'DiscussionQuestions', 'NextSteps',
    'FullResponse', 'MarkdownResponse', 'DebugInfo'],
  report: ['gameTitle', 'hostName', 'playerPerformance', 'detailedQuestions',
    'questionSummaries', 'questionSetData'],
  job: ['request', 'items', 'meta'],
  // A comment on a section of a round's report. `AnchorExcerpt` carries a
  // verbatim slice of the commented-on answer or summary, so it is a second
  // copy of content the boundary already protects one copy of.
  comment: ['Text', 'AnchorExcerpt', 'AnchorLabel'],
};
for (const [entity, fields] of Object.entries(MUST_NOT_LEAK)) {
  check(`no ${entity} field named in the boundary survives as readable text`, async () => {
    const row = { PK: 'ORG#org_nw#SETS', SK: 'SET#teamretro' };
    for (const f of fields) row[f] = `SECRET-${entity}-${f}`;
    const enc = await C.encryptItem('org_nw', entity, row);
    const wire = JSON.stringify(enc);
    for (const f of fields) {
      assert.ok(!wire.includes(`SECRET-${entity}-${f}`), `${entity}.${f} shipped in plaintext`);
    }
  });
}

check('and it comes back byte for byte', async () => {
  const org = 'org_nw';
  const row = { PK: 'x', SK: 'y', Title: SECRET, Detail: '' };
  const back = await C.decryptItem(org, 'question', await C.encryptItem(org, 'question', row));
  assert.deepStrictEqual(back, row);
});
check('a Votes MAP round-trips as a map, not as its string form', async () => {
  const org = 'org_nw';
  const row = { PK: 'GAME#4821', SK: 'QUESTION#001#VOTE#dai', Votes: { 0: 1, 1: 2, 2: 3 } };
  const enc = await C.encryptItem(org, 'vote', row);
  assert.ok(C.isEnvelope(enc.Votes));
  const back = await C.decryptItem(org, 'vote', enc);
  assert.deepStrictEqual(back.Votes, { 0: 1, 1: 2, 2: 3 });
});
check('an ARRAY field round-trips as an array', async () => {
  const org = 'org_nw';
  const item = { SK: 'QUESTION#001#AISummary', DiscussionQuestions: ['why?', 'what next?'] };
  const back = await C.decryptItem(org, 'aiSummary', await C.encryptItem(org, 'aiSummary', item));
  assert.deepStrictEqual(back.DiscussionQuestions, ['why?', 'what next?']);
});
check('the caller\'s object is NOT mutated — handlers return the item they wrote', async () => {
  const row = { Title: SECRET };
  await C.encryptItem('org_nw', 'question', row);
  assert.strictEqual(row.Title, SECRET);
});
check('two encryptions of the same text differ — the IV is fresh each time', async () => {
  const a = await C.encryptValue('org_nw', SECRET);
  const b = await C.encryptValue('org_nw', SECRET);
  assert.notStrictEqual(a.ct, b.ct);
  assert.notStrictEqual(a.iv, b.iv);
});
check('a blank field is left blank rather than turned into noise', async () => {
  const enc = await C.encryptItem('org_nw', 'question', { Title: 't', Detail: '', optionA: null });
  assert.strictEqual(enc.Detail, '');
  assert.strictEqual(enc.optionA, null);
});
check('encrypting twice does not nest an envelope inside an envelope', async () => {
  const once = await C.encryptItem('org_nw', 'question', { Title: SECRET });
  const twice = await C.encryptItem('org_nw', 'question', once);
  assert.deepStrictEqual(twice, once);
  assert.strictEqual((await C.decryptItem('org_nw', 'question', twice)).Title, SECRET);
});

// ---------- 3. The wrong organisation FAILS. It does not get garbage. ----------
// This is the assertion the whole isolation story rests on. A decrypt that
// returned plausible wrong plaintext would put one customer's retrospective
// into another customer's report, and nothing downstream would notice.
console.log('\n3. decrypting as the wrong organisation throws');
check("another org's key cannot read this org's ciphertext", async () => {
  await newOrg('org_md');
  const env = await C.encryptValue('org_nw', SECRET);
  await assert.rejects(() => C.decryptValue('org_md', env));
});
check('and the failure names the field rather than "unable to authenticate data"', async () => {
  const enc = await C.encryptItem('org_nw', 'question', { Title: SECRET });
  await assert.rejects(() => C.decryptItem('org_md', 'question', enc),
    /question\.Title/);
});
// THE AAD IS A SECOND BARRIER, NOT THE SAME ONE COUNTED TWICE. Give an
// attacker org_nw's actual plaintext data key, wrapped so KMS raises no
// objection, and have them present it as org_ev. AES-GCM still refuses.
check('even holding the right KEY, the wrong orgId AAD still fails', async () => {
  const stolen = JSON.parse(Buffer.from(blobs.get('org_nw'), 'base64').toString('utf8'));
  blobs.set('org_ev', wrapLoose(Buffer.from(stolen.key, 'base64')).toString('base64'));
  const env = await C.encryptValue('org_nw', SECRET);
  await assert.rejects(() => C.decryptValue('org_ev', env),
    /unable to authenticate|Unsupported state/i);
});
check('a decrypt with no orgId at all is refused before it reaches KMS', async () => {
  const env = await C.encryptValue('org_nw', SECRET);
  await assert.rejects(() => C.decryptValue('', env), /orgId is required/);
  await assert.rejects(() => C.encryptValue('   ', 'x'), /orgId is required/);
});

// ---------- 4. Tampering is rejected. That is what GCM is for. ----------
console.log('\n4. a modified envelope is refused, never decoded');
function flip(b64) {
  const buf = Buffer.from(b64, 'base64');
  buf[0] ^= 0xff;
  return buf.toString('base64');
}
check('a flipped byte of ciphertext throws', async () => {
  const env = await C.encryptValue('org_nw', SECRET);
  await assert.rejects(() => C.decryptValue('org_nw', { ...env, ct: flip(env.ct) }));
});
check('a flipped byte of the auth tag throws', async () => {
  const env = await C.encryptValue('org_nw', SECRET);
  await assert.rejects(() => C.decryptValue('org_nw', { ...env, tag: flip(env.tag) }));
});
check('a swapped IV throws', async () => {
  const a = await C.encryptValue('org_nw', SECRET);
  const b = await C.encryptValue('org_nw', 'something else entirely');
  await assert.rejects(() => C.decryptValue('org_nw', { ...a, iv: b.iv }));
});
check('an envelope version this bundle cannot read throws, rather than passing through', async () => {
  const env = await C.encryptValue('org_nw', SECRET);
  await assert.rejects(() => C.decryptValue('org_nw', { ...env, v: 99 }),
    /unknown envelope version/);
});

// ---------- 5. Plaintext passes through. This IS the migration. ----------
// Nothing re-encrypts the estate; a set becomes encrypted the first time it is
// written. Until then plaintext and ciphertext share a partition, sometimes the
// same Query result. A reader that threw on plaintext would take the product
// down on the day this shipped.
console.log('\n5. pre-migration plaintext passes through untouched');
for (const value of ['a plain old question title', 42, true, ['a', 'b'], { some: 'map' },
  { v: 1, iv: 'x' }, null, '']) {
  check(`${JSON.stringify(value)} is returned unchanged`, async () =>
    assert.deepStrictEqual(await C.decryptValue('org_nw', value), value));
}
check('a half-migrated ROW decrypts the encrypted half and leaves the rest', async () => {
  const row = {
    PK: 'p', SK: 's',
    Title: await C.encryptValue('org_nw', 'encrypted yesterday'),
    Detail: 'written in 2024, still plaintext',
  };
  const out = await C.decryptItem('org_nw', 'question', row);
  assert.strictEqual(out.Title, 'encrypted yesterday');
  assert.strictEqual(out.Detail, 'written in 2024, still plaintext');
});
check('a fully plaintext row needs no key at all — an org with no key still reads', async () => {
  // blobs has nothing for org_legacy, so any KMS trip would throw.
  const out = await C.decryptItem('org_legacy', 'question', { Title: 'old', Detail: 'older' });
  assert.deepStrictEqual(out, { Title: 'old', Detail: 'older' });
});

// ---------- 6. KMS is touched once per org per container ----------
// The cost argument for envelope encryption is that field crypto costs
// microseconds and no network. A Decrypt per item would be a per-request KMS
// bill and a per-request latency, and it is the kind of regression that shows
// up on the invoice rather than in a test.
console.log('\n6. the data key is fetched once per org per container');
check('encrypting many fields across many items costs ONE Decrypt', async () => {
  C.forgetOrg('org_nw');
  const before = { ...kmsCalls };
  for (let i = 0; i < 5; i++) {
    await C.encryptItem('org_nw', 'question',
      { Title: `t${i}`, Detail: `d${i}`, optionA: 'a', optionB: 'b', optionC: 'c' });
  }
  assert.strictEqual(kmsCalls.decrypt - before.decrypt, 1,
    'a KMS call per item, not per org');
  assert.strictEqual(kmsCalls.generate - before.generate, 0);
});
check('a warm container makes none at all', async () => {
  const before = kmsCalls.decrypt;
  await C.encryptItem('org_nw', 'question', { Title: 'again' });
  await C.decryptItem('org_nw', 'question', { Title: await C.encryptValue('org_nw', 'x') });
  assert.strictEqual(kmsCalls.decrypt, before);
});
check('CONCURRENT first calls share one round trip, they do not race into two', async () => {
  C.forgetOrg('org_nw');
  const before = kmsCalls.decrypt;
  await Promise.all(Array.from({ length: 8 }, (_, i) =>
    C.encryptValue('org_nw', `concurrent ${i}`)));
  assert.strictEqual(kmsCalls.decrypt - before, 1);
});
check('a second organisation costs its own, separate, logged Decrypt', async () => {
  C.forgetOrg();
  const before = kmsCalls.decrypt;
  await C.encryptValue('org_nw', 'a');
  await C.encryptValue('org_md', 'b');
  assert.strictEqual(kmsCalls.decrypt - before, 2);
});
check('creating an org mints its key ONCE and does not then decrypt it', async () => {
  const before = { ...kmsCalls };
  const blob = await C.createOrgDataKey('org_fresh');
  blobs.set('org_fresh', blob);
  assert.ok(blob && typeof blob === 'string', 'the wrapped blob is what goes on the ORG row');
  await C.encryptValue('org_fresh', 'first ever question');
  assert.strictEqual(kmsCalls.generate - before.generate, 1);
  assert.strictEqual(kmsCalls.decrypt - before.decrypt, 0);
});
check('the cache is BOUNDED — one container cannot accumulate every tenant\'s key', async () => {
  // The bound is asserted as well as exercised. Without this line, raising
  // MAX_CACHED_ORGS to a million raises the loop below with it and the
  // eviction check passes while the cache is effectively unbounded.
  assert.ok(C.MAX_CACHED_ORGS > 0 && C.MAX_CACHED_ORGS <= 64,
    `MAX_CACHED_ORGS is ${C.MAX_CACHED_ORGS} — a container would hold every tenant's key`);
  C.forgetOrg();
  const many = C.MAX_CACHED_ORGS + 4;
  for (let i = 0; i < many; i++) {
    const id = `org_bulk_${i}`;
    blobs.set(id, await C.createOrgDataKey(id));
    await C.encryptValue(id, 'x');
  }
  // The earliest org must have been evicted, so touching it again pays KMS.
  const before = kmsCalls.decrypt;
  await C.encryptValue('org_bulk_0', 'y');
  assert.strictEqual(kmsCalls.decrypt - before, 1, 'the cache grew without limit');
});
check('a failed key fetch is not cached — the next request retries', async () => {
  C.forgetOrg('org_md');
  failNextDecrypt = true;
  await assert.rejects(() => C.encryptValue('org_md', 'x'), /KMS unavailable/);
  assert.strictEqual(await C.decryptValue('org_md', await C.encryptValue('org_md', 'x')), 'x');
});
check('forgetting an org is what makes a deleted org unreadable', async () => {
  C.forgetOrg('org_gone');
  blobs.delete('org_gone');
  await assert.rejects(() => C.encryptValue('org_gone', 'x'), /has no dataKeyCiphertext/);
});

// ---------- 7. It fails loudly, never quietly ----------
// An unknown entity returning the item unchanged would ship a whole row in
// plaintext and look like it worked — the same argument tenant.js makes for an
// unknown scope.
console.log('\n7. bad input throws rather than doing nothing');
for (const bad of ['questions', 'Question', 'sets', '', null, undefined]) {
  check(`entity ${JSON.stringify(bad)} throws`, async () =>
    assert.rejects(() => C.encryptItem('org_nw', bad, { Title: 'x' }), /unknown entity/));
}
check('decryptItem refuses an unknown entity too', async () =>
  assert.rejects(() => C.decryptItem('org_nw', 'nope', {}), /unknown entity/));

// ---------- 8. The three bundle copies are byte-identical ----------
// CodeUri is per-directory and there are no layers, so this module is
// triplicated exactly as tenant.js and set-version.js are. A drift here means
// one bundle encrypts a field another bundle does not, and the row that lands
// in the table depends on which handler happened to write it.
console.log('\n8. the three bundle copies have not drifted');
{
  const copies = [
    'lambda-functions/game/tenant-crypto.js',
    'lambda-functions/websocket/tenant-crypto.js',
    'lambda-functions/admin/shared/tenant-crypto.js',
  ].map((p) => ({ p, body: fs.readFileSync(path.join(REPO, p), 'utf8') }));
  check('all three exist', () => assert.strictEqual(copies.length, 3));
  for (const c of copies.slice(1)) {
    check(`${c.p} matches game/tenant-crypto.js`, () =>
      assert.strictEqual(c.body, copies[0].body,
        'the copies have drifted — one bundle is running different rules'));
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
