/**
 * THE SHELF TRAVELS WITH THE SET — every route that makes a second copy of one.
 *
 * A set's `topic` and `tags` are only worth requiring if they survive the
 * journeys a set actually makes. Three of those make a NEW metadata row out of
 * an old one, and each builds it a different way:
 *
 *   copy-question-set.js   `...carried` — the source row minus a few pointers
 *   shared/publish-set.js  `...meta` — the SNAPSHOT's metadata, not the row's
 *   shared/generated-set.js  builds a body from scratch and posts it to the importer
 *
 * The first two carry a new attribute for free and the third does not, which is
 * exactly why all three are pinned here: "it spreads the whole row" is a fact
 * about today's code, not a promise, and the one that builds a body by hand is
 * the one that silently drops a field nobody remembered to add.
 *
 * ── WHAT A COPY MUST NOT DO ────────────────────────────────────────────────
 *
 * Invent a shelf. An unfiled set copied, or shared, is still unfiled — filing
 * it on the copying team's behalf would put a set on a shelf nobody chose, in a
 * filter somebody is about to trust.
 *
 * // rejects: a copy or a public listing arriving unfiled because the field was
 * //          dropped in transit; a generation job losing the shelf its builder
 * //          named; either path inventing a shelf for a set that had none.
 */
const path = require('path');
const assert = require('assert');

const H = require('./helpers/moderation-harness');
H.install();

const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';

const tenant = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant.js'));
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const { publicSetIdFor, publishSnapshot } = require(path.join(H.REPO, 'lambda-functions/admin/shared/publish-set.js'));
const G = require(path.join(H.REPO, 'lambda-functions/admin/shared/generated-set.js'));
const copySet = require(path.join(H.REPO, 'lambda-functions/admin/copy-question-set.js')).handler;

const parse = (res) => JSON.parse(res.body || '{}');
const ACME = 'org_acme';
const GLOBEX = 'org_globex';
const SET = 'pricingmechanics';

/** A set in a library every organisation may copy from. Shared rows are plaintext. */
function sharedSet(meta = {}) {
  const ref = { scope: tenant.PLATFORM, orgId: '', setId: SET };
  H.seedRow({
    ...V.setMetadataKey(ref),
    name: 'Pricing mechanics',
    engagementType: 'call-and-answer',
    scope: tenant.PLATFORM,
    orgId: '',
    createdBy: 'sub-dai',
    ...meta,
  });
  const pk = V.setPartition(ref, null);
  H.seedRow({ PK: pk, SK: 'CATEGORY#c001', Name: 'Pricing', QuestionCount: 1 });
  H.seedRow({ PK: pk, SK: 'QUESTION#q001', Title: 'WHAT DID WE CHARGE', Detail: 'Say why.' });
}

/**
 * Globex takes a copy. Returns the metadata row both ways — `plain` as a reader
 * sees it, and `raw` exactly as it sits in the table, because whether a field
 * arrives as ciphertext is itself under test below.
 */
async function copyInto() {
  const res = await copySet(H.orgEvent({
    orgId: GLOBEX, role: 'member', method: 'POST', setId: SET, body: { scope: tenant.PLATFORM },
  }), H.ctx());
  assert.strictEqual(res.statusCode, 201, `Globex could not copy the set: ${res.statusCode} ${res.body}`);
  const key = V.setMetadataKey({ scope: tenant.ORG, orgId: GLOBEX, setId: parse(res).setId });
  const [raw] = H.rowsWhere((i) => i.PK === key.PK && i.SK === key.SK);
  assert.ok(raw, `the copy left no metadata row at ${key.PK} / ${key.SK}`);
  return { raw, plain: await H.plainRow(GLOBEX, raw) };
}

const SRC = { scope: tenant.ORG, orgId: ACME, setId: 'safety' };
const PUB = publicSetIdFor(ACME, 'safety');

const snapshotOf = (meta) => ({
  version: 2,
  contentHash: 'c'.repeat(64),
  source: SRC,
  meta: { name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia', ...meta },
  categories: [{ SK: 'CATEGORY#c001', Name: 'Injuries' }],
  questions: [{ SK: 'QUESTION#c001#001', Category: 'Injuries', Title: 'A clean one', Detail: 'Which glove?' }],
});

const publicMeta = async () => (await db.send(new GetCommand({
  TableName: T, Key: V.setMetadataKey({ scope: tenant.PUBLIC, orgId: '', setId: PUB }),
}))).Item;

const CSV = 'Category,Title,Detail\nWarmups,First,One';

(async () => {
  console.log('\n1. a copy into another organisation');

  // rejects: `...carried` being narrowed so that the shelf stops riding along —
  // the copying team would find the set in their library, unfiled, and no
  // filter would show it beside the one they took it from.
  await H.test('a copy keeps the topic and the tags', async () => {
    H.reset();
    sharedSet({ topic: 'business-work', tags: ['pricing', 'negotiation'] });
    const { plain } = await copyInto();
    assert.strictEqual(plain.topic, 'business-work');
    assert.deepStrictEqual(plain.tags, ['pricing', 'negotiation']);
  });

  // rejects: the shelf being sealed to the organisation's key. `topic` is an id
  // from a closed list — structural, like `engagementType` — and `tags` are
  // canonical labels, the same kind of thing as `roundNoun`, which this
  // boundary already leaves in plaintext. ENCRYPTED_FIELDS.set names PROSE, and
  // a sealed shelf could never be filtered or browsed across libraries at all.
  await H.test("an org set's shelf is stored readable, not sealed", async () => {
    H.reset();
    sharedSet({ topic: 'business-work', tags: ['pricing'] });
    const { raw } = await copyInto();
    assert.strictEqual(raw.topic, 'business-work', 'the shelf came back as an envelope');
    assert.deepStrictEqual(raw.tags, ['pricing'], 'the tags came back as an envelope');
    // …and the control: the row really was encrypted, so the two above are a
    // decision and not an accident of a copy that never reached the key.
    assert.notStrictEqual(raw.name, 'Pricing mechanics', 'nothing on this row was encrypted at all');
  });

  // rejects: filing a set on the copying team's behalf. Nobody chose a shelf
  // for this one, and a copy is a mechanical duplication, not a decision.
  await H.test('a copy of an unfiled set is still unfiled', async () => {
    H.reset();
    sharedSet();
    const { plain } = await copyInto();
    assert.strictEqual('topic' in plain, false, `the copy invented a shelf: ${plain.topic}`);
  });

  console.log('\n2. the public copy');

  // rejects: the shelf being dropped at exactly the moment it matters most.
  // The public library is the one everybody browses, and the owner asked for
  // the requirement there first: "req at least 1 pretty broad for public ones".
  await H.test('a public copy keeps the topic it was shared with', async () => {
    H.reset();
    H.seedRow({ ...V.setMetadataKey(SRC), name: 'Safety walkthrough', activeVersion: 2, versions: [{ version: 2 }] });
    await publishSnapshot(db, T, snapshotOf({ topic: 'health-medicine', tags: ['ppe'] }), { sourceOrgName: 'Acme' });
    const meta = await publicMeta();
    assert.ok(meta, 'nothing was published');
    assert.strictEqual(meta.topic, 'health-medicine');
    assert.deepStrictEqual(meta.tags, ['ppe']);
  });

  // rejects: a default shelf appearing on the public row. A set shared before
  // the shelf existed is unfiled in the library too, and says so.
  await H.test('a public copy of an unfiled set is unfiled, not defaulted', async () => {
    H.reset();
    H.seedRow({ ...V.setMetadataKey(SRC), name: 'Safety walkthrough', activeVersion: 2, versions: [{ version: 2 }] });
    await publishSnapshot(db, T, snapshotOf(), { sourceOrgName: 'Acme' });
    const meta = await publicMeta();
    assert.strictEqual(meta.topic, undefined, `the public copy was filed under ${meta.topic}`);
  });

  console.log('\n3. the set a generation job leaves behind');

  // rejects: the shelf a builder chose being read off the payload and then not
  // sent. This path builds the importer's body BY HAND, so nothing carries a
  // new field for it.
  await H.test("a job's set metadata carries the topic and tags the builder named", () => {
    const read = G.readSetMetadata({
      setMetadata: {
        title: 'World Leaders', topic: 'Politics & Society', tags: ['Heads of State', 'heads of state'],
      },
    });
    assert.strictEqual(read.title, 'World Leaders');
    assert.strictEqual(read.topic, 'Politics & Society', 'the raw value travels; the importer is what validates it');
    assert.deepStrictEqual(read.tags, ['heads-of-state'], 'a builder\'s duplicates collapse before they are sent');
  });

  await H.test('a job that named no topic sends none, rather than a guess', () => {
    const read = G.readSetMetadata({ setMetadata: { title: 'World Leaders' } });
    assert.strictEqual(read.topic, '');
    assert.deepStrictEqual(read.tags, []);
  });

  // rejects: the whole forwarding being asserted only against `readSetMetadata`
  // while `createSetForJob` quietly leaves the two fields out of the body it
  // posts. This drives the real importer, so the stored row is the evidence.
  await H.test('a finished job creates its draft on the shelf the builder chose', async () => {
    H.reset();
    const created = await G.createSetForJob({
      dynamodb: db,
      tableName: T,
      jobId: 'job-topic-1',
      spec: { engagementType: 'call-and-answer', toCsv: () => CSV },
      payload: { setMetadata: { title: 'World Leaders', topic: 'History', tags: ['leaders'] } },
      items: [{ title: 'First' }],
      caller: { userId: 'sub-dai', username: 'dai', orgId: '', orgRole: '' },
    });
    assert.ok(created, 'the job created no set at all');
    const key = V.setMetadataKey({ scope: tenant.PLATFORM, orgId: '', setId: created.setId });
    const [row] = H.rowsWhere((i) => i.PK === key.PK && i.SK === key.SK);
    assert.ok(row, `no metadata row at ${key.PK} / ${key.SK}`);
    assert.strictEqual(row.topic, 'history');
    assert.deepStrictEqual(row.tags, ['leaders']);
    assert.strictEqual(row.active, false, 'a generated set is still a draft');
  });

  H.summary();
})();
