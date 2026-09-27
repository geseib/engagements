/**
 * THE EVENTS SWITCH, READ THE SAME WAY IN BOTH PLACES (roadmap D6).
 *
 * EVENTS_ENABLED decides two things: whether POST /events answers
 * (websocket/events/event-http.js `eventsEnabled`) and whether the console
 * shows Events at all — which it learns from GET /orgs `features.events`
 * (admin/orgs/list-my-orgs.js). Two readers of one variable can drift: a
 * console that shows the builder while the server refuses every create is a
 * page of controls that do nothing.
 *
 * rejects: the two readers disagreeing about any value; the switch on for
 * anything but the exact word "on"; GET /orgs dropping `features`.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const { installEventHarness, asHost, request, bodyOf } = require('./helpers/event-harness');

const h = installEventHarness({ eventsEnabled: null });
const { eventsEnabled } = h.load('lambda-functions/websocket/events/event-http.js');
const listMyOrgs = h.load('lambda-functions/admin/orgs/list-my-orgs.js').handler;

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

(async () => {
  for (const [value, on] of [
    [undefined, false], ['', false], ['off', false], ['yes', false], ['true', false],
    ['on', true], ['ON', true], [' on ', true],
  ]) {
    await check(`EVENTS_ENABLED=${JSON.stringify(value)}: both say ${on ? 'on' : 'off'}`, async () => {
      if (value === undefined) delete process.env.EVENTS_ENABLED; else process.env.EVENTS_ENABLED = value;
      assert.strictEqual(eventsEnabled(), on);
      const res = await listMyOrgs(request({
        method: 'GET', path: '/orgs',
        requestContext: asHost('', { groups: 'hosts', orgIds: '', userId: 'u_switch' }),
      }));
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.deepStrictEqual(bodyOf(res).features, { events: on });
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
