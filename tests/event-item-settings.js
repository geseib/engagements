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
/** A new event on the same seeded sets — resets the 8-engagement cap between
 *  fix-round-1 sections that each add several engagement items of their own. */
async function freshEvent() {
  code = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Fix round 1', startsAt: startsIn(25), timeZone: 'Europe/London' },
  }))).event.code;
}

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
    ['anonymity that is neither on nor off', { type: 'call-and-answer', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'friction' }, settings: { anonymousResponses: 'yes' } }, /on or off/],
    // A typed poll has no vote to hide authors behind (27 Sep 2026).
    ['anonymity on a poll', { type: 'poll', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'mood' }, settings: { anonymousResponses: true } }, /Call & Answer only/],
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

  console.log('\n6. a concurrent edit cannot land a goal the pin cannot hold (fix round 1)');
  await freshEvent(); // sections 1-5 already used 5 of the 8 engagement slots
  await check('"Use v1" that read the row before a concurrent goal change loses the race, not silently combining with it', async () => {
    const raceId = bodyOf(await add(space({ settings: { target: 5 } }))).item.itemId;
    assert.strictEqual(rowOf(raceId).SetRef.version, 2);
    // Guarantee the item's creation UpdatedAt is on a different millisecond
    // from the winning edit's, below — otherwise a test this fast could
    // coincidentally collide and the guard would (correctly) not fire.
    await new Promise((resolve) => { setTimeout(resolve, 2); });

    const gate = table.hold((c) => c.type === 'update' && c.input.Key && c.input.Key.SK === `ITEM#${raceId}`);
    const slow = edit(raceId, { version: 1 }); // alone, this would succeed: target 5 fits v1's 8
    await gate.reached;
    const fast = await edit(raceId, { settings: { target: 10 } }); // fits v2's 12, the pin as fast itself reads it
    assert.strictEqual(fast.statusCode, 200, fast.body);
    gate.release();
    const late = await slow;

    // Before this fix `late` was conditioned only on State = planned, and
    // landed anyway: v1 pinned with a goal of 10 — more than v1's 8
    // questions, a combination neither edit's own check ever allowed.
    assert.strictEqual(late.statusCode, 409, late.body);
    assert.strictEqual(bodyOf(late).code, 'agenda_changed');
    assert.strictEqual(rowOf(raceId).SetRef.version, 2, 'the losing "Use v1" moved the version anyway');
    assert.strictEqual(plainRow(NW, rowOf(raceId)).Settings.target, 10, 'the winning edit\'s goal was lost');
  });

  console.log('\n7. null means blank or default, never a refusal (fix round 1 RULING)');
  await check('every applicable key sent as null reads as the create dialog\'s own default', async () => {
    const res = await add(space({
      settings: {
        randomizeQuestions: null, categoryIds: null, target: null,
        personaId: null, promptId: null, aiContext: null, eventDetails: null,
      },
    }));
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.deepStrictEqual(bodyOf(res).item.settings, rules.settingsFor('trivia', {}));
  });
  await check('null for a key this format does not have is skipped, not refused', async () => {
    const res = await add(space({ settings: { briefing: null } })); // trivia has no briefing
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.deepStrictEqual(Object.keys(bodyOf(res).item.settings), Object.keys(rules.settingsFor('trivia', {})));
  });
  await check('null Names on a survey reads as Anonymous', async () => {
    const res = await add({ type: 'survey', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'kickoff' }, settings: { names: null } });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.strictEqual(bodyOf(res).item.settings.names, 'anonymous');
  });
  await check('null anonymousResponses on a call-and-answer reads as on (the default)', async () => {
    const res = await add({ type: 'call-and-answer', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'friction' }, settings: { anonymousResponses: null } });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.strictEqual(bodyOf(res).item.settings.anonymousResponses, true);
  });
  await check('a null goal on a survey is still just skipped — a survey never gets one', async () => {
    const res = await add({ type: 'survey', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'kickoff' }, settings: { target: null } });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.ok(!('target' in bodyOf(res).item.settings));
  });
  await check('an unknown key is still refused even when its value is null', async () => {
    const res = await add(space({ settings: { triviaTimer: null } }));
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /is not a session option/);
  });
  await check('an unrecognised key\'s own name is truncated in the 400 sentence', async () => {
    const longKey = 'x'.repeat(60);
    const res = await add(space({ settings: { [longKey]: 1 } }));
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.ok(bodyOf(res).error.includes('x'.repeat(S.KEY_ECHO_MAX)), 'the truncated prefix is missing');
    assert.ok(!bodyOf(res).error.includes(longKey), 'the full 60-character key rode into the message');
  });

  console.log('\n8. settings: null on a non-engagement is accepted as none (fix round 1)');
  await check('add: settings: null on a break is accepted, and the item carries none', async () => {
    const res = await add({ type: 'break', minutes: 5, settings: null });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.strictEqual(bodyOf(res).item.settings, undefined);
    assert.ok(!('Settings' in rowOf(bodyOf(res).item.itemId)));
  });
  await check('edit: settings: null on a presentation is accepted, and changes nothing about it', async () => {
    const talk = bodyOf(await add({ type: 'presentation', title: 'Talk', minutes: 30 })).item;
    const res = await edit(talk.itemId, { settings: null });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).item.settings, undefined);
  });
  await check('edit: a real settings object on a break is still refused', async () => {
    const brk = bodyOf(await add({ type: 'break', minutes: 5 })).item;
    const res = await edit(brk.itemId, { settings: { target: 3 } });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /Only an engagement has session options/);
  });

  console.log('\n9. version and settings together, and "Use vN" on the edges (fix round 1)');
  await freshEvent(); // sections 6-8 already used several of the 8 engagement slots
  let combo;
  await check('setup: an item pinned to v2 with a goal that fits v2 but not v1', async () => {
    combo = bodyOf(await add(space({ settings: { target: 9 } }))).item.itemId;
    assert.strictEqual(rowOf(combo).SetRef.version, 2);
  });
  await check('version and settings together: the goal is checked against the NEW version, not the old one', async () => {
    const res = await edit(combo, { version: 1, settings: { target: 9 } });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /This set has 8 questions/);
    assert.strictEqual(rowOf(combo).SetRef.version, 2, 'a refused combined edit moved the version anyway');
  });
  await check('version and settings together, a goal the new version can hold: both land in one edit', async () => {
    const res = await edit(combo, { version: 1, settings: { target: 8 } });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).item.settings.target, 8);
    assert.strictEqual(rowOf(combo).SetRef.version, 1);
  });
  await check('the category list is kept when "Use vN" does not actually move the version', async () => {
    await edit(combo, { version: 2, settings: { target: 8, categoryIds: ['Ops'] } });
    const res = await edit(combo, { version: 2 }); // the version it is already pinned to
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).categoriesReset, undefined, 'a version that did not move reset the categories anyway');
    assert.deepStrictEqual(bodyOf(res).item.settings.categoryIds, ['Ops']);
  });
  await check('"Use vN" on an item added before M1b writes the create dialog\'s defaults', async () => {
    const preM1bId = bodyOf(await add(space({ title: 'Old quiz, races' }))).item.itemId;
    const { Settings, ...bare } = rowOf(preM1bId);
    table.put(bare);
    assert.ok(!('Settings' in rowOf(preM1bId)));
    const res = await edit(preM1bId, { version: 1 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res).item.settings, rules.settingsFor('trivia', {}));
    assert.ok(isEnvelope(rowOf(preM1bId).Settings), 'the item did not gain a Settings envelope');
  });

  console.log('\n10. a null version is refused in plain words, never "vnull" (fix round 1 nit)');
  await check('version: null is refused before it ever reaches the goal-over sentence', async () => {
    const before = rowOf(combo).SetRef.version;
    const res = await edit(combo, { version: null });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /Choose a version/);
    assert.ok(!/vnull/.test(bodyOf(res).error));
    assert.strictEqual(rowOf(combo).SetRef.version, before, 'a null version moved the pin anyway');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
