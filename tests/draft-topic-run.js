/**
 * AN AI DRAFT ARRIVES WITH A TOPIC — through the shared generation factory
 * (ai-generate-trivia), into the draft header and out through the draft view.
 *
 * The owner, 23 Oct 2026: "when ai generates question sets. it should auto tag
 * (based on a list of categories) right now the user gets an error activating
 * sets because they dont have a tag".
 *
 * tests/generated-set-creation.js holds the inline scenarios worker and the
 * new-set accept; this suite holds the factory, the draft view, the "add to a
 * set" runs and a regenerate.
 *
 * // rejects: a factory run that never asks; a suggestion the view does not
 * //          expose; an addition that asks for (or writes) a topic over the
 * //          one its set already has; a regenerate that throws away the
 * //          model's pick for a keyword guess.
 */
const path = require('path');
const assert = require('assert');
const harness = require('./helpers/generation-job-harness');

const REPO = path.join(__dirname, '..');
harness.install();

const L = (p) => path.join(REPO, 'lambda-functions', p);
const trivia = require(L('admin/ai-generate-trivia.js')).handler;
const draftsRoute = require(L('admin/generation-drafts.js')).handler;
const tenant = require(L('admin/shared/tenant.js'));

const { state, reset, toolResponse, test, summary } = harness;

const ORG = 'org_AyDiAVBysZ7688ABXgGSkQ';
const member = (sub = 'sub-me') => ({
  lambda: {
    userId: sub, username: sub, groups: 'hosts', orgId: ORG, orgRole: 'member', orgIds: ORG,
    email: `${sub}@x.example`, emailVerified: true,
  },
});
const ctx = () => ({ functionName: 'engagedev-admin-ai-generate-trivia', getRemainingTimeInMillis: () => 900000 });
const post = (body) => ({ requestContext: { http: { method: 'POST' }, authorizer: member() }, body: JSON.stringify(body) });
const route = (method, tail, body) => draftsRoute({
  requestContext: { http: { method, path: `/admin/generation-drafts/${tail}` }, authorizer: member() },
  pathParameters: { proxy: tail },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const parse = (res) => ({ status: res.statusCode, body: JSON.parse(res.body || '{}') });
const q = (title, category = 'Presidents', extra = {}) => ({
  title, questionDetail: `${title}?`, category, answerDetails: 'Because.', difficulty: 'medium',
  optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA', tags: ['x'], ...extra,
});
const header = (draftId) => state.ddb.get(`${tenant.draftsIndexPk('org', ORG)}|DRAFT#${draftId}`);
const setRow = () => state.ddb.get(`${tenant.setsMetadataPk(tenant.ORG, ORG)}|SET#history`);

async function seedOrgAndSet(topic) {
  const { mintOrg } = require('./helpers/tenant-crypto-stub');
  await mintOrg((item) => state.ddb.set(`${item.PK}|${item.SK}`, item), ORG);
  const pk = tenant.setsMetadataPk(tenant.ORG, ORG);
  state.ddb.set(`${pk}|SET#history`, {
    PK: pk, SK: 'SET#history', scope: 'org', orgId: ORG, createdBy: 'sub-me',
    name: 'History Quiz', engagementType: 'trivia', activeVersion: 2, versions: [{ version: 1 }, { version: 2 }],
    ...(topic ? { topic } : {}),
  });
}

async function run(body) {
  const started = parse(await trivia(post(body), ctx()));
  if (started.status !== 202) return { started };
  await trivia(state.dispatched[state.dispatched.length - 1].payload, ctx());
  return { started, draftId: started.body.draftId };
}

const NEW_SET = { topic: 'American presidents', count: 2, numChoices: 4, setMetadata: { title: 'Presidents Quiz' } };
const APPEND = {
  topic: 'American history', count: 2, numberOfCategories: 1, numChoices: 4,
  appendOnly: true, appendTo: { setId: 'history', scope: 'org', mode: 'existing' },
};

(async function main() {
  console.log('\na new set');

  await test('the factory asks in the same call, and the view exposes the model\'s pick', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Who was first'), q('Who was second')], 'tool_use',
      { setTopic: 'history', setTags: ['US Presidents', 'history'] });
    const { draftId, started } = await run(NEW_SET);
    assert.strictEqual(started.status, 202, JSON.stringify(started.body));
    assert.strictEqual(state.bedrockCalls.length, 1, 'the topic cost a second call');
    assert.match(state.bedrockCalls[0].prompt, /SET TOPIC/);
    assert.ok(state.bedrockCalls[0].body.tools[0].input_schema.properties.setTopic, 'the tool has no topic field');
    const h = header(draftId);
    assert.strictEqual(h.suggestedTopic, 'history');
    assert.strictEqual(h.suggestedTopicSource, 'model');
    assert.deepStrictEqual(h.suggestedTags, ['us-presidents'], 'a tag restating the topic was kept');
    const view = parse(await route('GET', draftId)).body.draft;
    assert.strictEqual(view.suggestedTopic, 'history');
    assert.deepStrictEqual(view.suggestedTags, ['us-presidents']);
    assert.strictEqual(view.suggestedTopicSource, 'model');
    assert.strictEqual(view.topic, '', 'the builder chose no topic, and the view says it did');
  });

  await test('no topic from the model → keywords, still on the shelf', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Which president signed the treaty', 'Presidents', { tags: ['treaties'] })]);
    const { draftId } = await run({ ...NEW_SET, count: 1 });
    const h = header(draftId);
    assert.strictEqual(h.suggestedTopic, 'history');
    assert.strictEqual(h.suggestedTopicSource, 'keywords');
    assert.ok(h.suggestedTags.includes('treaties'), h.suggestedTags.join(','));
  });

  await test('a regenerate keeps the model\'s pick and does not ask again', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Q one'), q('Q two')], 'tool_use', { setTopic: 'politics-society' });
    const { draftId } = await run(NEW_SET);
    state.bedrockCalls = [];
    state.bedrockHandler = () => toolResponse([q('Q three')]);
    const regen = parse(await trivia(post({ draftId, regenerate: { category: 'Presidents', count: 1 } }), ctx()));
    assert.strictEqual(regen.status, 202, JSON.stringify(regen.body));
    await trivia(state.dispatched[state.dispatched.length - 1].payload, ctx());
    assert.ok(!/SET TOPIC/.test(state.bedrockCalls[0].prompt), 'a regenerate asked for the topic again');
    assert.strictEqual(header(draftId).suggestedTopic, 'politics-society');
    assert.strictEqual(header(draftId).suggestedTopicSource, 'model');
  });

  console.log('\nadding to a set');

  await test('a set that has a topic: not asked, not overwritten, and the view says which it has', async () => {
    reset();
    await seedOrgAndSet('history');
    state.bedrockHandler = () => toolResponse([q('Q1', 'Founders'), q('Q2', 'Founders')], 'tool_use', { setTopic: 'music' });
    const { draftId } = await run(APPEND);
    assert.ok(!/SET TOPIC/.test(state.bedrockCalls[0].prompt), 'an addition to a filed set asked for its topic');
    const view = parse(await route('GET', draftId)).body.draft;
    assert.strictEqual(view.targetTopic, 'history');
    assert.strictEqual(parse(await route('POST', `${draftId}/accept`, { phase: 'claim' })).status, 200);
    assert.strictEqual(parse(await route('POST', `${draftId}/accept`,
      { phase: 'complete', version: 3, previousVersion: 2, kept: 2, left: 0, topic: 'music' })).status, 200);
    assert.strictEqual(setRow().topic, 'history', 'accepting an addition re-filed the set');
  });

  await test('an unfiled set: the run proposes one for the review to offer', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Q1', 'Founders')], 'tool_use', { setTopic: 'history', setTags: ['founders'] });
    const { draftId } = await run({ ...APPEND, count: 1 });
    assert.match(state.bedrockCalls[0].prompt, /SET TOPIC/);
    const view = parse(await route('GET', draftId)).body.draft;
    assert.strictEqual(view.targetTopic, '');
    assert.strictEqual(view.suggestedTopic, 'history');
    assert.strictEqual(setRow().topic, undefined, 'the run filed the set by itself');
  });

  summary();
})();
