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
 * as an engagement; the ninth engagement let in because it is a survey.
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
const publicRead = async () => bodyOf(await agenda(request({ path: `/events/${code}/agenda` })));

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

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
