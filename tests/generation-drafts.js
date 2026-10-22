/**
 * AI GENERATION DRAFTS AND THE INBOX — what a run leaves, who sees it, how it
 * is decided, and the bell that says it is waiting.
 *
 * The owner, 2026-10-16/21: "i went to add 2 new categories with 10 questions
 * each, i was told i could close and come back … when i came back i didnt see
 * anything." And the decisions that followed: a run writes a DRAFT that lasts
 * thirty days, visible only to its creator until accepted; a notification in
 * one bell; accept per question, regenerate per category, discard with a
 * seven-day restore; the destination library chosen and stated; audit on every
 * decision. Design: docs/design/ai-generation-review/README.md.
 *
 * Drives the REAL handlers — ai-generate-trivia (the shared factory),
 * admin/generation-drafts.js, orgs/my-notifications.js — over the shared
 * in-memory harness (tests/helpers/generation-job-harness.js), with only
 * Bedrock, the self-invoke and KMS stubbed.
 *
 * // rejects: an "Add questions" run whose items live only in a job row and an
 * //          open editor; a draft another member can read; a draft whose
 * //          content sits in plaintext; an accept that runs twice; a decision
 * //          with no audit entry; a notification that outlives its draft.
 */
const path = require('path');
const assert = require('assert');
const harness = require('./helpers/generation-job-harness');

const REPO = path.join(__dirname, '..');
harness.install();

const L = (p) => path.join(REPO, 'lambda-functions', p);
const trivia = require(L('admin/ai-generate-trivia.js')).handler;
const draftsRoute = require(L('admin/generation-drafts.js')).handler;
const { myNotifications } = require(L('admin/orgs/my-notifications.js'));
const tenant = require(L('admin/shared/tenant.js'));
const notifications = require(L('admin/shared/notifications.js'));
const drafts = require(L('admin/shared/generation-drafts.js'));
const { requiredGroupsForRoute } = require(L('auth/authorizer.js'));

const { state, reset, toolResponse, test, summary } = harness;

const ORG = 'org_AyDiAVBysZ7688ABXgGSkQ';
const DAY = 24 * 60 * 60;
const isEnvelope = (v) => !!v && typeof v === 'object' && typeof v.ct === 'string' && typeof v.iv === 'string';
const rows = () => [...state.ddb.values()];
const nowS = () => Math.floor(Date.now() / 1000);

const member = (sub = 'sub-me', extra = {}) => ({
  lambda: {
    userId: sub, username: sub, groups: 'hosts', orgId: ORG, orgRole: 'member', orgIds: ORG,
    email: `${sub}@x.example`, emailVerified: true, ...extra,
  },
});
const staff = { lambda: { userId: 'sub-staff', username: 'staff', groups: 'admins' } };
const orgless = { lambda: { userId: 'sub-lost', username: 'lost', groups: 'hosts' } };

const ctx = () => ({ functionName: 'engagedev-admin-ai-generate-trivia', getRemainingTimeInMillis: () => 900000 });
const post = (body, authorizer = member()) => ({ requestContext: { http: { method: 'POST' }, authorizer }, body: JSON.stringify(body) });
const route = (method, tail, body, authorizer = member()) => draftsRoute({
  requestContext: { http: { method, path: `/admin/generation-drafts/${tail}` }, authorizer },
  pathParameters: { proxy: tail },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const inbox = (method, tail, authorizer = member()) => myNotifications({
  requestContext: { http: { method, path: `/me/notifications/${tail}` }, authorizer },
  pathParameters: { proxy: tail },
});
const parse = (res) => ({ status: res.statusCode, body: JSON.parse(res.body || '{}') });

const q = (title, category = 'Presidents', extra = {}) => ({
  title, questionDetail: `${title}?`, category, answerDetails: 'Because.', difficulty: 'medium',
  optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA', tags: ['x'], ...extra,
});

/** Seed the org's key and a set the member owns, at version 2. */
async function seedOrgAndSet() {
  const { mintOrg } = require('./helpers/tenant-crypto-stub');
  await mintOrg((item) => state.ddb.set(`${item.PK}|${item.SK}`, item), ORG);
  const pk = tenant.setsMetadataPk(tenant.ORG, ORG);
  state.ddb.set(`${pk}|SET#history`, {
    PK: pk, SK: 'SET#history', scope: 'org', orgId: ORG, createdBy: 'sub-me',
    name: 'History Quiz', engagementType: 'trivia', activeVersion: 2, versions: [{ version: 1 }, { version: 2 }],
  });
}

/** POST, then run the worker as Lambda's Event invoke would. */
async function run(body, authorizer = member()) {
  const started = parse(await trivia(post(body, authorizer), ctx()));
  if (started.status !== 202) return { started };
  const dispatch = state.dispatched[state.dispatched.length - 1].payload;
  await trivia(dispatch, ctx());
  return { started, draftId: started.body.draftId, jobId: started.body.jobId, dispatch };
}

const header = (draftId, lib = { scope: 'org', orgId: ORG }) =>
  state.ddb.get(`${tenant.draftsIndexPk(lib.scope, lib.orgId)}|DRAFT#${draftId}`);
const itemRows = (draftId, lib = { scope: 'org', orgId: ORG }) =>
  rows().filter((r) => r.PK === tenant.draftItemsPk(lib.scope, lib.orgId, draftId));
const auditRows = (action) => rows().filter((r) => r.RecordType === 'AUDIT' && (!action || r.Action === action));
const notes = (sub = 'sub-me') => rows().filter((r) => r.PK === tenant.notificationsPk(sub));

const APPEND = {
  topic: 'American history', count: 4, numberOfCategories: 2, numChoices: 4,
  appendOnly: true, appendTo: { setId: 'history', scope: 'org', mode: 'new' },
};

(async function main() {
  console.log('\nthe keys');

  await test('a draft lives in its library, and is never public', async () => {
    assert.strictEqual(tenant.draftsIndexPk('platform', ''), 'GENDRAFTS');
    assert.strictEqual(tenant.draftsIndexPk('org', ORG), `ORG#${ORG}#GENDRAFTS`);
    assert.strictEqual(tenant.draftItemsPk('org', ORG, 'abc123def'), `ORG#${ORG}#GENDRAFT#abc123def`);
    assert.throws(() => tenant.draftsIndexPk('public', ''), /never public/);
    assert.throws(() => tenant.draftItemsPk('org', ORG, '../x'), /draft id/);
    assert.strictEqual(tenant.notificationsPk('sub-1'), 'USER#sub-1#NOTIFY');
  });

  console.log('\nwhere the work goes');

  await test('a host standing in no library is refused before anything is paid for', async () => {
    reset();
    const { started } = await run({ topic: 'x', count: 2, setMetadata: { title: 'X' } }, orgless);
    assert.strictEqual(started.status, 403);
    assert.strictEqual(started.body.code, 'no_destination');
    assert.strictEqual(state.bedrockCalls.length, 0);
    assert.strictEqual(state.dispatched.length, 0);
  });

  await test('Engage staff in the Engage console generate into Engage\'s library, in plaintext', async () => {
    reset();
    state.bedrockHandler = () => toolResponse([q('Who signed it'), q('Who wrote it')]);
    const { started, draftId } = await run({ topic: 'x', count: 2, setMetadata: { title: 'Staff Set' } }, staff);
    assert.deepStrictEqual(started.body.destination, { scope: 'platform', orgId: '' });
    const h = header(draftId, { scope: 'platform', orgId: '' });
    assert.strictEqual(h.title, 'Staff Set');
    assert.strictEqual(h.status, 'ready');
    assert.ok(started.body.estimatedOutputTokens > 0, 'no estimate was offered');
  });

  console.log('\nadding to a set: the owner\'s case');

  await test('an Add questions run waits in a draft in the SET\'S library, sealed, and the set is untouched', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Q1', 'Founders'), q('Q2', 'Founders'), q('Q3', 'Treaties'), q('Q4', 'Treaties')]);
    const { started, draftId } = await run(APPEND);
    assert.strictEqual(started.status, 202, JSON.stringify(started.body));
    const h = header(draftId);
    assert.strictEqual(h.status, 'ready');
    assert.strictEqual(h.mode, 'append');
    assert.strictEqual(h.targetSetId, 'history');
    assert.strictEqual(h.targetVersion, 2);
    assert.strictEqual(h.produced, 4);
    assert.ok(isEnvelope(h.title) && isEnvelope(h.request), 'the draft header sat in plaintext');
    const items = itemRows(draftId);
    assert.strictEqual(items.length, 4);
    assert.ok(items.every((r) => isEnvelope(r.item)), 'a generated question sat in plaintext');
    assert.ok(!JSON.stringify(rows()).includes('Founders'), 'generated content is readable at rest');
    const set = state.ddb.get(`${tenant.setsMetadataPk('org', ORG)}|SET#history`);
    assert.strictEqual(set.activeVersion, 2, 'the live set moved before anybody accepted anything');
    assert.ok(h.ttl > nowS() + 29 * DAY && h.ttl <= nowS() + 30 * DAY + 5, 'a ready draft is not kept thirty days');
    assert.ok(items.every((r) => r.ttl === h.ttl), 'items do not live as long as their draft');
  });

  await test('the creator is notified, in the bell, with a link to the review', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Q1', 'Founders'), q('Q2', 'Treaties')]);
    const { draftId } = await run({ ...APPEND, count: 2 });
    const [note] = notes();
    assert.ok(note, 'no notification was written');
    assert.ok(isEnvelope(note.title), 'the notification names the set in plaintext');
    const listed = parse(await inbox('GET', 'list'));
    assert.strictEqual(listed.status, 200);
    const mine = listed.body.items.find((n) => n.id === `draft#${draftId}`);
    assert.ok(mine, 'the inbox does not list the draft');
    assert.strictEqual(mine.kind, 'draft.ready');
    assert.match(mine.title, /2 questions ready to review/);
    assert.match(mine.body, /History Quiz/);
    assert.deepStrictEqual(mine.link, { type: 'draft', draftId, orgId: ORG, setId: 'history' });
    assert.strictEqual(mine.read, false);
    assert.ok(listed.body.unread >= 1);
    assert.strictEqual(parse(await inbox('POST', `${encodeURIComponent(`draft#${draftId}`)}/read`)).status, 200);
    const after = parse(await inbox('GET', 'list')).body.items.find((n) => n.id === `draft#${draftId}`);
    assert.strictEqual(after.read, true);
  });

  await test('a draft is its creator\'s alone: a teammate and the same person elsewhere get 404', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Q1', 'Founders')]);
    const { draftId } = await run({ ...APPEND, count: 1 });
    assert.strictEqual(parse(await route('GET', draftId)).status, 200);
    assert.strictEqual(parse(await route('GET', draftId, null, member('sub-teammate', { orgRole: 'owner' }))).status, 404);
    assert.strictEqual(parse(await route('GET', draftId, null, { lambda: { ...member().lambda, orgId: 'org_Other', orgIds: 'org_Other' } })).status, 404);
    const listed = parse(await route('GET', 'list', null, member('sub-teammate', { orgRole: 'owner' })));
    assert.deepStrictEqual(listed.body.drafts, []);
  });

  await test('accepting into a set is claimed once, audited first, and released on a failed save', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Q1', 'Founders'), q('Q2', 'Founders'), q('Q3', 'Treaties')]);
    const { draftId } = await run({ ...APPEND, count: 3 });
    // Leave one out.
    const got = parse(await route('GET', draftId)).body;
    assert.strictEqual(got.items.length, 3);
    const leave = got.items[1].seq;
    assert.strictEqual(parse(await route('POST', `${draftId}/items`, { updates: [{ seq: leave, decision: 'leave' }] })).status, 200);

    const claim = parse(await route('POST', `${draftId}/accept`, { phase: 'claim' }));
    assert.strictEqual(claim.status, 200, JSON.stringify(claim.body));
    assert.strictEqual(claim.body.items.length, 2, 'a left-out question was handed to the editor');
    assert.strictEqual(claim.body.activeVersion, 2);
    assert.strictEqual(auditRows('draft.accept').length, 1, 'the accept was not recorded before it happened');
    const second = parse(await route('POST', `${draftId}/accept`, { phase: 'claim' }));
    assert.strictEqual(second.status, 409, 'a second press claimed the same accept');

    // The editor's save failed: hand it back.
    assert.strictEqual(parse(await route('POST', `${draftId}/accept`, { phase: 'release' })).status, 200);
    assert.strictEqual(header(draftId).status, 'ready');
    assert.strictEqual(auditRows('draft.accept')[0].Outcome, 'failed', 'the log claims an accept that did not happen');

    // Claim again and complete with the version the editor saved.
    assert.strictEqual(parse(await route('POST', `${draftId}/accept`, { phase: 'claim' })).status, 200);
    const done = parse(await route('POST', `${draftId}/accept`, { phase: 'complete', version: 3, previousVersion: 2, kept: 2, left: 1 }));
    assert.strictEqual(done.status, 200, JSON.stringify(done.body));
    const h = header(draftId);
    assert.strictEqual(h.status, 'accepted');
    assert.strictEqual(h.acceptedVersion, 3);
    assert.strictEqual(h.previousVersion, 2);
    assert.ok(h.ttl > nowS() + 29 * DAY, 'the accepted record is not kept thirty days');
    assert.strictEqual(notes().length, 0, 'the notification outlived the decision');
  });

  await test('undo switches the set back to the version before this accept — once, and only while it is live', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Q1', 'Founders')]);
    const { draftId } = await run({ ...APPEND, count: 1 });
    await route('POST', `${draftId}/accept`, { phase: 'claim' });
    // What the editor's save did: version 3, with the old content still on disk at v2.
    const setKey = `${tenant.setsMetadataPk('org', ORG)}|SET#history`;
    state.ddb.set(setKey, { ...state.ddb.get(setKey), activeVersion: 3, versions: [{ version: 1 }, { version: 2 }, { version: 3 }] });
    const v2 = tenant.setContentPk('org', ORG, 'history', 2);
    state.ddb.set(`${v2}|QUESTION#c001#001`, { PK: v2, SK: 'QUESTION#c001#001', Title: 'old' });
    await route('POST', `${draftId}/accept`, { phase: 'complete', version: 3, previousVersion: 2, kept: 1, left: 0 });

    // A teammate cannot undo somebody else's accept.
    assert.strictEqual(parse(await route('POST', `${draftId}/undo`, {}, member('sub-teammate', { orgRole: 'owner' }))).status, 404);
    const undone = parse(await route('POST', `${draftId}/undo`, {}));
    assert.strictEqual(undone.status, 200, JSON.stringify(undone.body));
    assert.strictEqual(state.ddb.get(setKey).activeVersion, 2, 'the set did not go back');
    assert.strictEqual(auditRows('set.promote-version').length, 1, 'the rollback was not audited');
    assert.strictEqual(parse(await route('POST', `${draftId}/undo`, {})).status, 409, 'an accept was undone twice');
  });

  console.log('\ndiscard, restore, stop');

  await test('discard writes nothing to the set, keeps the draft seven days, and can be restored', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Q1', 'Founders')]);
    const { draftId } = await run({ ...APPEND, count: 1 });
    const d = parse(await route('POST', `${draftId}/discard`, {}));
    assert.strictEqual(d.status, 200);
    let h = header(draftId);
    assert.strictEqual(h.status, 'discarded');
    assert.ok(h.ttl <= nowS() + 7 * DAY + 5 && h.ttl > nowS() + 6 * DAY, 'a discard is not restorable for seven days');
    assert.ok(itemRows(draftId).every((r) => r.ttl === h.ttl));
    assert.strictEqual(auditRows('draft.discard').length, 1);
    assert.strictEqual(notes().length, 0, 'a discarded draft still rings the bell');
    const r = parse(await route('POST', `${draftId}/restore`, {}));
    assert.strictEqual(r.status, 200);
    h = header(draftId);
    assert.strictEqual(h.status, 'ready');
    assert.strictEqual(auditRows('draft.restore').length, 1);
    assert.strictEqual(notes().length, 1, 'a restored draft is not back in the bell');
  });

  await test('Stop is read between passes: a stopped run pays for nothing more', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Never', 'Founders')]);
    const started = parse(await trivia(post({ ...APPEND, count: 2 }), ctx()));
    const draftId = started.body.draftId;
    assert.strictEqual(parse(await route('POST', `${draftId}/cancel`, {})).status, 200);
    await trivia(state.dispatched[0].payload, ctx());
    assert.strictEqual(state.bedrockCalls.length, 0, 'a stopped run still called the model');
    const h = header(draftId);
    assert.strictEqual(h.status, 'failed', 'a run stopped before anything was written reads as ready');
    assert.strictEqual(notes()[0].kind, 'draft.failed');
  });

  console.log('\nregenerate one category, or the rest');

  await test('regenerating a category replaces only that category, and tells the model what to avoid', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Keep me', 'Founders'), q('Replace me', 'Treaties')]);
    const { draftId } = await run({ ...APPEND, count: 2 });
    state.bedrockHandler = () => toolResponse([q('A fresh treaty question', 'Something else')]);
    const again = parse(await trivia(post({ draftId, regenerate: { category: 'Treaties', count: 1 } }), ctx()));
    assert.strictEqual(again.status, 202, JSON.stringify(again.body));
    assert.strictEqual(again.body.draftId, draftId);
    assert.strictEqual(header(draftId).status, 'generating');
    await trivia(state.dispatched[state.dispatched.length - 1].payload, ctx());
    const prompt = state.bedrockCalls[state.bedrockCalls.length - 1].prompt;
    assert.ok(prompt.includes('Keep me'), 'the other category\'s titles were not passed as already used');
    assert.ok(prompt.includes('Treaties'), 'the category was not named to the model');
    const items = parse(await route('GET', draftId)).body.items;
    const titles = items.map((i) => i.item.title).sort();
    assert.deepStrictEqual(titles, ['A fresh treaty question', 'Keep me']);
    assert.ok(items.every((i) => i.item.category === 'Founders' || i.item.category === 'Treaties'),
      'a regenerated question was filed outside the category asked for');
    assert.strictEqual(header(draftId).status, 'ready');
    assert.ok(header(draftId).usage, 'no token usage was recorded');
  });

  await test('the remainder is generated INTO the same draft', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Only one', 'Founders')]);
    const { draftId } = await run({ ...APPEND, count: 3 });
    assert.strictEqual(header(draftId).produced, 1);
    state.bedrockHandler = () => toolResponse([q('Two', 'Founders'), q('Three', 'Treaties')]);
    const again = parse(await trivia(post({ draftId, regenerate: { remaining: true } }), ctx()));
    assert.strictEqual(again.body.requested, 2, 'the rest was not counted from what the draft holds');
    await trivia(state.dispatched[state.dispatched.length - 1].payload, ctx());
    assert.strictEqual(itemRows(draftId).length, 3);
    assert.strictEqual(header(draftId).produced, 3);
  });

  await test('this batch\'s guidance is used and never stored, on the draft or anywhere', async () => {
    reset();
    await seedOrgAndSet();
    state.bedrockHandler = () => toolResponse([q('Q1', 'Founders')]);
    await run({ ...APPEND, count: 1, batchGuidance: 'Include SENTINEL-XY-11 somewhere.' });
    assert.ok(state.bedrockCalls[0].prompt.includes('SENTINEL-XY-11'));
    const { decryptItem } = require(L('admin/shared/tenant-crypto.js'));
    for (const row of rows()) {
      const opened = row.orgId && row.PK.includes('GENDRAFT') ? await decryptItem(ORG, row.PK.endsWith('GENDRAFTS') ? 'draft' : 'draftItem', row) : row;
      assert.ok(!JSON.stringify(opened).includes('SENTINEL-XY-11'), `the guidance was stored on ${row.PK}`);
    }
  });

  console.log('\nthe reminder');

  await test('five days before a draft expires, its notification turns unread again', async () => {
    reset();
    await seedOrgAndSet();
    const soon = nowS() + 4 * DAY;
    await notifications.notify(harness.docClient, {
      sub: 'sub-me', key: 'draft#abc123def', kind: 'draft.ready', orgId: ORG, scope: 'org',
      title: 'x', body: 'y', link: { type: 'draft', draftId: 'abc123def', orgId: ORG }, expiresAt: soon,
    });
    await notifications.markRead(harness.docClient, 'sub-me', 'draft#abc123def');
    const [n] = await notifications.listFor(harness.docClient, 'sub-me');
    assert.strictEqual(n.read, false, 'no reminder');
    assert.strictEqual(n.reminder, true);
    assert.strictEqual(n.daysLeft, 4);
    await notifications.markRead(harness.docClient, 'sub-me', 'draft#abc123def');
    const [again] = await notifications.listFor(harness.docClient, 'sub-me');
    assert.strictEqual(again.read, true, 'the reminder fires on every read');
  });

  console.log('\nthe bell also names what already waits');

  await test('an invitation and a flagged set appear as live entries, with somewhere to go', async () => {
    reset();
    await seedOrgAndSet();
    const meta = state.ddb.get(`ORG#${ORG}|METADATA`);
    state.ddb.set(`ORG#${ORG}|METADATA`, { ...meta, name: 'Northwind' });
    state.ddb.set(`USER#sub-me|ORG#${ORG}`, { PK: 'USER#sub-me', SK: `ORG#${ORG}`, orgId: ORG, role: 'member' });
    const setsPk = tenant.setsMetadataPk('org', ORG);
    state.ddb.set(`${setsPk}|SET#flagged`, { PK: setsPk, SK: 'SET#flagged', orgId: ORG, share: { status: 'flagged' } });
    state.ddb.set('INVITEE#sub-me@x.example|INVITE#tok', {
      PK: 'INVITEE#sub-me@x.example', SK: 'INVITE#tok', token: 'tok', orgId: 'org_Other1', orgName: 'Acme',
      role: 'member', expiresAt: new Date(Date.now() + 3 * DAY * 1000).toISOString(),
    });
    const listed = parse(await inbox('GET', 'list'));
    assert.strictEqual(listed.status, 200, JSON.stringify(listed.body));
    const flagged = listed.body.items.find((n) => n.kind === 'org.sets-flagged');
    assert.ok(flagged, 'the flagged set is not in the bell');
    assert.deepStrictEqual(flagged.link, { type: 'section', orgId: ORG, section: 'questionsets' });
    assert.match(flagged.body, /Northwind/);
    const invite = listed.body.items.find((n) => n.kind === 'invite');
    assert.ok(invite, 'the invitation is not in the bell');
    assert.match(invite.title, /Acme/);
    assert.ok(!JSON.stringify(listed.body).includes('"tok"'), 'an invitation token travelled in the inbox');
  });

  console.log('\nthe doors');

  await test('drafts are a host\'s and an admin\'s; the bell is anyone signed in', async () => {
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'admin/generation-drafts/{proxy+}'), ['hosts', 'admins']);
    assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/generation-drafts/abc123def/accept'), ['hosts', 'admins']);
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'me/notifications/{proxy+}'), ['pending', 'hosts', 'admins']);
    // A notification id must never read as a participant route ("join", "vote").
    assert.deepStrictEqual(requiredGroupsForRoute('POST', 'me/notifications/invite%23joinvote/read'), ['pending', 'hosts', 'admins']);
  });

  // A QUESTION SET CLAUDE WROTE IN A BUILD ROOM (docs/superpowers/plans/2026-10-22-build-room-question-sets.md step 7).
  await test('from-build: Claude\'s set becomes a ready draft in my library, sealed, with a bell note; only I see it', async () => {
    reset();
    await seedOrgAndSet();
    const r = parse(await route('POST', 'from-build', {
      title: 'Game questions: choose and rate', engagementType: 'poll', tags: ['build-room', 'for-game'], gameId: '4821',
      items: [
        { title: 'Which look?', category: 'While building', kind: 'choice', options: ['Pixel', 'Paper'] },
        { title: 'How fun is it so far?', category: 'Before wrapping up', kind: 'rating' },
      ],
    }));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const { draftId } = r.body.draft;
    assert.deepStrictEqual([r.body.draft.status, r.body.draft.mode, r.body.draft.engagementType, r.body.draft.produced], ['ready', 'new', 'poll', 2]);
    const items = rows().filter((x) => x.RecordType === 'GENDRAFT_ITEM');
    assert.strictEqual(items.length, 2);
    assert.ok(items.every((x) => isEnvelope(x.item)), 'Claude\'s questions sat in plaintext');
    assert.ok(!JSON.stringify(rows()).includes('How fun is it'), 'readable at rest');
    const opened = parse(await route('GET', draftId));
    assert.strictEqual(opened.status, 200);
    assert.deepStrictEqual(opened.body.items.map((x) => x.item), [
      { title: 'Which look?', detail: '', category: 'While building', kind: 'choice', options: ['Pixel', 'Paper'] },
      { title: 'How fun is it so far?', detail: '', category: 'Before wrapping up', kind: 'rating', scale: '1-5' },
    ]);
    const note = parse(await inbox('GET', 'list')).body.items.find((n) => n.id === `draft#${draftId}`);
    assert.ok(note, 'no bell note');
    assert.strictEqual(parse(await route('GET', draftId, null, member('sub-other'))).status, 404, 'another member read my draft');
  });
  await test('from-build refuses what a Build Room set cannot be', async () => {
    reset();
    await seedOrgAndSet();
    const bad = async (b) => parse(await route('POST', 'from-build', { title: 'X', engagementType: 'poll', items: [{ title: 'Q', kind: 'choice', options: ['A', 'B'] }], ...b })).status;
    assert.strictEqual(await bad({ engagementType: 'trivia' }), 400);
    assert.strictEqual(await bad({ title: '  ' }), 400);
    assert.strictEqual(await bad({ items: [] }), 400);
    assert.strictEqual(await bad({ items: [{ title: 'Q', kind: 'choice', options: ['A'] }] }), 400);
    assert.strictEqual(await bad({ items: [{ title: 'Q', kind: 'yesno' }] }), 400);
    assert.strictEqual(await bad({ items: [{ title: '', kind: 'rating' }] }), 400);
    assert.strictEqual(parse(await route('POST', 'from-build', { title: 'X', engagementType: 'call-and-answer', items: [{ title: 'Q' }] }, orgless)).status, 403);
  });

  await test('the TTLs are the owner\'s', () => {
    assert.strictEqual(drafts.READY_DAYS, 30);
    assert.strictEqual(drafts.DISCARD_RESTORE_DAYS, 7);
    assert.strictEqual(drafts.ACCEPTED_KEEP_DAYS, 30);
    assert.strictEqual(notifications.REMIND_DAYS_BEFORE, 5);
  });

  summary();
})();
