/**
 * AN ENGAGEMENT ITEM'S SESSION OPTIONS — the `settings` of POST and PUT
 * /events/{code}/items (items.js, events/item-settings.js), sealed whole on the
 * row as `Settings`, read back by GET /events/{code} and never by the public
 * agenda. Events M1b.
 *
 * The owner, 26 Sep 2026: "It would also be nice if all of the options that
 * you get when setting up each engagement is avail".
 *
 * rejects: an option the format does not have (a briefing on trivia, Names on
 * a poll, a goal on a survey) stored; create's caps (500, 300, 1,500) not
 * held; a goal bigger than the pinned version; options on a presentation;
 * the options readable in the stored row or on the public agenda; "Use vN"
 * silently keeping a goal the new version cannot meet, or a category list it
 * may not have; an item added before M1b (no Settings) failing to edit; an
 * unreadable row showing its options as ciphertext.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf, REPO,
} = require('./helpers/event-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const getEvent = h.load('lambda-functions/websocket/events/get-event.js').handler;
const agenda = h.load('lambda-functions/websocket/events/get-agenda.js').handler;
const rules = h.load('lambda-functions/websocket/events/agenda-rules.js');
const S = h.load('lambda-functions/websocket/events/item-settings.js');
const { isEnvelope } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
let code;
const add = (body) => items(request({
  method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, body, requestContext: asHost(NW),
}));
const edit = (itemId, body) => items(request({
  method: 'PUT', path: `/events/${code}/items/${itemId}`, pathParameters: { code, itemId }, body, requestContext: asHost(NW),
}));
const rowOf = (itemId) => table.get(`EVENT#${code}`, `ITEM#${itemId}`);
const itemCount = () => [...table.store.values()].filter((r) => r.PK === `EVENT#${code}` && String(r.SK).startsWith('ITEM#')).length;
const space = (extra = {}) => ({ type: 'trivia', title: 'Space night', minutes: 15, setRef: { scope: 'platform', setId: 'space' }, ...extra });
const BRIEF = { text: 'Open issues are up 15%.', source: null, namesRemoved: 0, draftedAt: null, editedAt: null };
const TRIVIA = {
  randomizeQuestions: false, categoryIds: ['Ops'], target: 5,
  personaId: 'coach', promptId: 'trivia-vj', aiContext: 'Be brief.', eventDetails: 'Why we meet.',
};

(async () => {
  table.clear();
  seedOrg(table, NW);
  table.put({ PK: 'SETS', SK: 'SET#space', name: 'Space Trivia', engagementType: 'trivia', questionCount: 12, activeVersion: 2, versions: [{ version: 1, questionCount: 8 }, { version: 2, questionCount: 12 }] });
  table.put({ PK: 'SETS', SK: 'SET#friction', name: 'Friction finder', engagementType: 'call-and-answer', questionCount: 4, activeVersion: 1, versions: [{ version: 1, questionCount: 4 }] });
  table.put({ PK: 'SETS', SK: 'SET#mood', name: 'Room mood', engagementType: 'poll', questionCount: 6, activeVersion: 1, versions: [{ version: 1, questionCount: 6 }] });
  table.put({ PK: 'SETS', SK: 'SET#kickoff', name: 'Kickoff pulse', engagementType: 'survey', questionCount: 5, activeVersion: 1, versions: [{ version: 1, questionCount: 5 }] });
  code = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', startsAt: startsIn(20), timeZone: 'Europe/London' },
  }))).event.code;

  console.log('\n1. what an engagement stores');
  let quiz;
  await check('trivia keeps every option it has, sealed whole', async () => {
    const res = await add(space({ settings: TRIVIA }));
    assert.strictEqual(res.statusCode, 201, res.body);
    quiz = bodyOf(res).item;
    assert.deepStrictEqual(quiz.settings, TRIVIA);
    const row = rowOf(quiz.itemId);
    assert.ok(isEnvelope(row.Settings), 'Settings is stored in the clear');
    assert.ok(!JSON.stringify(row).includes('Be brief.'));
    assert.deepStrictEqual(plainRow(NW, row).Settings, TRIVIA);
  });
  await check('no options at all stores the create dialog\'s untouched defaults', async () => {
    const res = await add(space());
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.deepStrictEqual(bodyOf(res).item.settings, rules.settingsFor('trivia', {}));
  });
  await check('Call & Answer keeps its briefing and its anonymity', async () => {
    const res = await add({ type: 'call-and-answer', title: 'Friction', minutes: 20, setRef: { scope: 'platform', setId: 'friction' }, settings: { anonymousResponses: false, briefing: BRIEF } });
    assert.strictEqual(res.statusCode, 201, res.body);
    const { settings } = bodyOf(res).item;
    assert.strictEqual(settings.anonymousResponses, false);
    assert.deepStrictEqual(settings.briefing, BRIEF);
  });
  await check('a survey keeps its Names and nothing about rounds', async () => {
    const res = await add({ type: 'survey', title: 'Pulse', minutes: 8, setRef: { scope: 'platform', setId: 'kickoff' }, settings: { names: 'named' } });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.deepStrictEqual(Object.keys(bodyOf(res).item.settings), ['names', 'personaId', 'promptId', 'aiContext', 'eventDetails']);
    assert.strictEqual(bodyOf(res).item.settings.names, 'named');
  });

  console.log('\n2. what is refused, in words, with nothing written');
  for (const [label, body, error] of [
    ['a briefing on trivia', space({ settings: { briefing: BRIEF } }), /Call & Answer sessions only/],
    ['Names on a poll', { type: 'poll', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'mood' }, settings: { names: 'named' } }, /Names applies to a survey only/],
    ['a goal on a survey', { type: 'survey', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'kickoff' }, settings: { target: 3 } }, /no goal/],
    ['a goal bigger than the set', space({ settings: { target: 13 } }), /This set has 12 questions/],
    ['a goal bigger than the older version pinned', space({ setRef: { scope: 'platform', setId: 'space', version: 1 }, settings: { target: 9 } }), /This set has 8 questions/],
    ['501 characters of instructions', space({ settings: { aiContext: 'x'.repeat(501) } }), /500 characters/],
    ['301 characters of event details', space({ settings: { eventDetails: 'x'.repeat(301) } }), /300 characters/],
    ['a briefing over 1,500 characters', { type: 'call-and-answer', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'friction' }, settings: { briefing: 'x'.repeat(1501) } }, /1,500/],
    ['anonymity that is neither on nor off', { type: 'poll', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'mood' }, settings: { anonymousResponses: 'yes' } }, /on or off/],
    ['an option that does not exist', space({ settings: { triviaTimer: 30 } }), /is not a session option/],
    ['25 categories', space({ settings: { categoryIds: Array.from({ length: 25 }, (_, i) => `C${i}`) } }), /Choose categories/],
    ['options on a presentation', { type: 'presentation', title: 'x', minutes: 5, settings: {} }, /Only an engagement has session options/],
  ]) {
    await check(`${label}: 400`, async () => {
      const before = itemCount();
      const res = await add(body);
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.match(bodyOf(res).error, error);
      assert.strictEqual(itemCount(), before);
    });
  }

  console.log('\n3. editing');
  await check('PUT settings replaces the map', async () => {
    const res = await edit(quiz.itemId, { settings: { target: 7 } });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res).item.settings, rules.settingsFor('trivia', { target: 7 }));
    assert.strictEqual(plainRow(NW, rowOf(quiz.itemId)).Settings.target, 7);
  });
  await check('an edit that sends no settings leaves them as they were', async () => {
    await edit(quiz.itemId, { settings: TRIVIA });
    const res = await edit(quiz.itemId, { minutes: 20 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res).item.settings, TRIVIA);
  });
  await check('"Use v1" under a goal v1 cannot meet: refused in words, nothing changed', async () => {
    await edit(quiz.itemId, { settings: { ...TRIVIA, target: 10 } });
    const res = await edit(quiz.itemId, { version: 1 });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.deepStrictEqual(bodyOf(res), {
      error: 'Your goal of 10 is more than v1’s 8 questions. Lower the goal, then use v1.', code: 'goal_over',
    });
    assert.strictEqual(rowOf(quiz.itemId).SetRef.version, 2);
    assert.strictEqual(plainRow(NW, rowOf(quiz.itemId)).Settings.target, 10);
  });
  await check('"Use v1" with a goal that fits resets a narrowed category list, and says so', async () => {
    await edit(quiz.itemId, { settings: { ...TRIVIA, target: 7 } });
    const res = await edit(quiz.itemId, { version: 1 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).categoriesReset, true);
    assert.deepStrictEqual(bodyOf(res).item.settings.categoryIds, []);
    assert.strictEqual(bodyOf(res).item.settings.target, 7);
    assert.strictEqual(rowOf(quiz.itemId).SetRef.version, 1);
  });
  await check('an item added before M1b (no Settings) edits, and keeps none', async () => {
    const res = await add(space({ title: 'Old quiz' }));
    const id = bodyOf(res).item.itemId;
    const { Settings, ...m1Row } = rowOf(id);
    table.put(m1Row);
    const edited = await edit(id, { minutes: 12 });
    assert.strictEqual(edited.statusCode, 200, edited.body);
    assert.strictEqual(bodyOf(edited).item.settings, undefined);
    assert.ok(!('Settings' in rowOf(id)));
  });
  await check('options sent for a presentation on an edit: 400', async () => {
    const talk = bodyOf(await add({ type: 'presentation', title: 'Talk', minutes: 30 })).item;
    const res = await edit(talk.itemId, { settings: { target: 3 } });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /Only an engagement has session options/);
  });

  console.log('\n4. who reads them');
  await check('the host\'s read carries them, decrypted', async () => {
    const body = bodyOf(await getEvent(request({ path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW) })));
    assert.strictEqual(body.items.find((i) => i.itemId === quiz.itemId).settings.target, 7);
  });
  await check('the public agenda never does', async () => {
    const res = await agenda(request({ path: `/events/${code}/agenda`, pathParameters: { code } }));
    assert.strictEqual(res.statusCode, 200, res.body);
    for (const item of bodyOf(res).items) assert.ok(!('settings' in item), `${item.itemId} leaks its settings`);
    assert.ok(!res.body.includes('Be brief.'));
  });
  await check('a row whose words cannot be opened shows no options, and no ciphertext', async () => {
    const row = rowOf(quiz.itemId);
    table.put({ ...row, Settings: { v: 1, iv: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAA==', ct: 'AAAA' } });
    const res = await getEvent(request({ path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW) }));
    const bad = bodyOf(res).items.find((i) => i.itemId === quiz.itemId);
    assert.strictEqual(bad.decryptFailed, true);
    assert.strictEqual(bad.settings, undefined);
    assert.ok(!/"ct"/.test(res.body));
    table.put(row);
  });

  console.log('\n5. create\'s caps, held equal to the dialog\'s');
  await check('500 and 300 are SessionOptions.jsx\'s own maxLengths', () => {
    const src = fs.readFileSync(path.join(REPO, 'src/src/components/SessionOptions.jsx'), 'utf8');
    const near = (marker) => src.slice(src.indexOf(marker), src.indexOf(marker) + 700);
    assert.strictEqual(S.AI_CONTEXT_MAX, 500);
    assert.strictEqual(S.EVENT_DETAILS_MAX, 300);
    assert.match(near('-ai-context`}'), new RegExp(`maxLength="${S.AI_CONTEXT_MAX}"`));
    assert.match(near('-details`}'), new RegExp(`maxLength="${S.EVENT_DETAILS_MAX}"`));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
