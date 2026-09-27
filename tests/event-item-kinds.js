/**
 * THE KINDS OF AGENDA ITEM, AND WHO LEADS THEM — POST and PUT
 * /events/{code}/items (lambda-functions/websocket/events/items.js), read back
 * by GET /events/{code} and GET /events/{code}/agenda. Events M1b.
 *
 * The owner, 26 Sep 2026: "Survey should work today, as we have surveys.
 * presentations for now could be just placeholders. we also need a custom
 * choice ... enter the facilitator/speaker/presenter."
 *
 * rejects: a survey item that pins a set of another type, or does not count
 * as an engagement; the ninth engagement let in because it is a survey; a
 * presentation or an activity counted as an engagement, or let in as the
 * 17th item; a leader's name stored in the clear, on a break, or longer than
 * 80; a name that cannot be cleared; an unreadable row showing ciphertext.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const getEvent = h.load('lambda-functions/websocket/events/get-event.js').handler;
const agenda = h.load('lambda-functions/websocket/events/get-agenda.js').handler;
const rules = h.load('lambda-functions/websocket/events/agenda-rules.js');
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
const meta = () => table.get(`EVENT#${code}`, 'METADATA');
const rowOf = (itemId) => table.get(`EVENT#${code}`, `ITEM#${itemId}`);
const hostRead = async () => bodyOf(await getEvent(request({
  path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW),
})));
const publicRead = async () => bodyOf(await agenda(request({ path: `/events/${code}/agenda`, pathParameters: { code } })));

async function freshEvent() {
  table.clear();
  seedOrg(table, NW);
  table.put({
    PK: 'SETS', SK: 'SET#kickoff', name: 'Kickoff pulse', engagementType: 'survey', questionCount: 5,
    activeVersion: 1, versions: [{ version: 1, questionCount: 5 }],
  });
  table.put({
    PK: 'SETS', SK: 'SET#space', name: 'Space Trivia', engagementType: 'trivia', questionCount: 12,
    activeVersion: 2, versions: [{ version: 1, questionCount: 8 }, { version: 2, questionCount: 12 }],
  });
  code = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', startsAt: startsIn(20), timeZone: 'Europe/London' },
  }))).event.code;
}

(async () => {
  console.log('\n1. a survey item');
  await freshEvent();
  await check('a survey item pins a survey set and counts as an engagement', async () => {
    const res = await add({ type: 'survey', title: 'Before we start', minutes: 8, setRef: { scope: 'platform', setId: 'kickoff' } });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.deepStrictEqual(bodyOf(res).item.setRef, { scope: 'platform', orgId: '', setId: 'kickoff', version: 1 });
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount], [1, 1]);
  });
  await check('a survey item refuses a set of another type', async () => {
    const res = await add({ type: 'survey', title: 'x', minutes: 8, setRef: { scope: 'platform', setId: 'space' } });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /Trivia set, and this item is Survey/);
  });
  await check('the ninth engagement may not be a survey either', async () => {
    table.put({ ...meta(), ItemCount: 8, EngagementCount: 8 });
    const res = await add({ type: 'survey', title: 'x', minutes: 8, setRef: { scope: 'platform', setId: 'kickoff' } });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).error, rules.CAP_SENTENCES.engagements);
  });

  console.log('\n2. a presentation and an activity: counted items, never engagements');
  await freshEvent();
  let talk; let lunch;
  await check('a presentation is added with its presenter, sealed', async () => {
    const res = await add({ type: 'presentation', title: 'The FY27 plan', ledBy: 'Marcus Oyelaran', minutes: 35, description: 'The three bets.' });
    assert.strictEqual(res.statusCode, 201, res.body);
    talk = bodyOf(res).item;
    assert.strictEqual(talk.ledBy, 'Marcus Oyelaran');
    assert.strictEqual(talk.setRef, undefined);
    assert.ok(isEnvelope(rowOf(talk.itemId).LedBy));
    assert.strictEqual(plainRow(NW, rowOf(talk.itemId)).LedBy, 'Marcus Oyelaran');
  });
  await check('an activity is added with nobody leading it', async () => {
    const res = await add({ type: 'custom', title: 'Lunch with the speakers', minutes: 45 });
    assert.strictEqual(res.statusCode, 201, res.body);
    lunch = bodyOf(res).item;
    assert.strictEqual(lunch.type, 'custom');
    assert.strictEqual(lunch.ledBy, '');
  });
  await check('both count toward the 16 items and neither toward the 8 engagements', () =>
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount, meta().BreakCount], [2, 0, 0]));
  await check('the 17th item may not be a presentation either: the items sentence', async () => {
    table.put({ ...meta(), ItemCount: 16 });
    const res = await add({ type: 'presentation', title: 'One too many', minutes: 10 });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.deepStrictEqual(bodyOf(res), { error: rules.CAP_SENTENCES.items, cap: 'items' });
    table.put({ ...meta(), ItemCount: 2 });
  });
  for (const [label, body, error] of [
    ['a break with somebody leading it', { type: 'break', minutes: 15, ledBy: 'Sam' }, /A break is not led by anyone/],
    ['a name longer than 80 characters', { type: 'custom', title: 'x', minutes: 5, ledBy: 'x'.repeat(81) }, /80 characters/],
    ['an activity with no title', { type: 'custom', minutes: 5 }, /title/],
  ]) {
    await check(`${label}: 400, nothing written`, async () => {
      const before = meta().ItemCount + meta().BreakCount;
      const res = await add(body);
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.match(bodyOf(res).error, error);
      assert.strictEqual(meta().ItemCount + meta().BreakCount, before);
    });
  }
  await check('the name is edited, and cleared', async () => {
    let res = await edit(lunch.itemId, { ledBy: 'Dana Whitfield' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).item.ledBy, 'Dana Whitfield');
    assert.strictEqual(plainRow(NW, rowOf(lunch.itemId)).LedBy, 'Dana Whitfield');
    res = await edit(lunch.itemId, { ledBy: '' });
    assert.strictEqual(bodyOf(res).item.ledBy, '');
  });
  await check('an edit that leaves the name out keeps it, and returns no ciphertext', async () => {
    const res = await edit(talk.itemId, { minutes: 40 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).item.ledBy, 'Marcus Oyelaran');
    assert.ok(!/"ct"/.test(res.body));
  });

  console.log('\n3. who leads it, read back');
  await check('the host\'s read carries ledBy on every item', async () => {
    const body = await hostRead();
    assert.deepStrictEqual(body.items.map((i) => [i.type, i.ledBy]), [['presentation', 'Marcus Oyelaran'], ['custom', '']]);
  });
  await check('the public agenda carries the name, for "Presentation · Marcus Oyelaran"', async () => {
    const body = await publicRead();
    assert.deepStrictEqual(body.items.map((i) => [i.type, i.ledBy]), [['presentation', 'Marcus Oyelaran'], ['custom', '']]);
  });
  await check('an item whose words cannot be opened shows no name and no ciphertext', async () => {
    const row = rowOf(talk.itemId);
    table.put({ ...row, LedBy: { v: 1, iv: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAA==', ct: 'AAAA' } });
    const res = await getEvent(request({ path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW) }));
    const bad = bodyOf(res).items.find((i) => i.itemId === talk.itemId);
    assert.deepStrictEqual([bad.decryptFailed, bad.ledBy, bad.title], [true, '', '']);
    assert.ok(!/"ct"/.test(res.body));
    table.put(row);
  });
  await check('an item added before M1b (no LedBy at all) reads as nobody named, and edits', async () => {
    const res = await add({ type: 'trivia', title: 'Old quiz', minutes: 10, setRef: { scope: 'platform', setId: 'space' } });
    const id = bodyOf(res).item.itemId;
    const { LedBy, ...m1Row } = rowOf(id);
    table.put(m1Row);
    const edited = await edit(id, { minutes: 12 });
    assert.strictEqual(edited.statusCode, 200, edited.body);
    assert.strictEqual(bodyOf(edited).item.ledBy, '');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
