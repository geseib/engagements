/**
 * BUILD ROOM — THE WALL KEY (docs/design/parity/PLAN.md §2.2, task B1; owner Q1:
 * "a per-session wall key in the window's URL, minted by the host, rotatable.
 * The code alone does not open the wall").
 *
 *   - minted lazily on BUILD#STATE (`WallKey`, 32 random bytes, base64url) the
 *     first time the host reads the room, through the state writer, so the row
 *     keeps the session's ttl and two racing first reads agree on one key;
 *   - returned ONLY on the host's own read: never to the host's Claude, never
 *     to a builder's Claude, never to a phone, never on the wall itself;
 *   - `POST build/wall {rotate: true}` (host only) retires the old key.
 *
 * Expectations are written by hand, never read back off the handler's output.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const H = require('./helpers/build-wall-harness');

const { check, hostCall, agentCall, builderCall, playCall, wallCall, seat, row, seed } = H;
const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;

(async () => {
  console.log('\nbuild wall: the key');
  seed();

  let first;
  await check('the host\'s read mints the key: 32 random bytes, base64url, on BUILD#STATE with the session ttl', async () => {
    assert.strictEqual(row('BUILD#STATE'), undefined, 'no state row before the first read');
    const r = await hostCall('GET', 'state');
    assert.strictEqual(r.status, 200);
    first = r.body.wallKey;
    assert.ok(B64URL_32.test(first), `wallKey ${first}`);
    assert.strictEqual(Buffer.from(first, 'base64url').length, 32);
    const st = row('BUILD#STATE');
    assert.strictEqual(st.WallKey, first);
    assert.strictEqual(st.ttl, H.TTL, 'the row keeps the session ttl');
  });
  await check('minting is not a change the room sees: no rev bump, no announce', async () => {
    seed();
    await hostCall('GET', 'state');
    const st = row('BUILD#STATE');
    assert.ok(!st.Rev, `Rev ${st.Rev}`);
    assert.strictEqual(H.sent.length, 0);
  });
  await check('the key is stable across reads, and written only once', async () => {
    seed();
    const a = (await hostCall('GET', 'state')).body.wallKey;
    const writes = H.updates.length;
    const b = (await hostCall('GET', 'state')).body.wallKey;
    assert.strictEqual(a, b);
    assert.strictEqual(H.updates.length, writes, 'a second read writes nothing');
    first = a;
  });
  await check('a racing mint keeps the key already there (conditional write)', async () => {
    seed();
    H.put({ PK: H.PK, SK: 'BUILD#STATE', ttl: H.TTL, Rev: 3 });
    const WON = 'theOtherReadWonTheRaceAndWroteThisKey012345';
    // Another read writes its key between this read's load and its write.
    H.hooks.beforeUpdate = (inp) => {
      if (/WallKey/.test(JSON.stringify(inp.ExpressionAttributeNames || {}))) {
        H.store.get(`${H.PK}|BUILD#STATE`).WallKey = WON;
        H.hooks.beforeUpdate = null;
      }
    };
    const a = (await hostCall('GET', 'state')).body.wallKey;
    H.hooks.beforeUpdate = null;
    assert.strictEqual(a, WON, 'the losing read answers with the winner\'s key');
    assert.strictEqual(row('BUILD#STATE').WallKey, WON, 'and never overwrote it');
    assert.strictEqual((await hostCall('GET', 'state')).body.wallKey, WON);
    const mints = H.updates.filter((u) => /WallKey/.test(JSON.stringify(u.ExpressionAttributeNames || {})));
    assert.ok(mints.every((u) => /attribute_not_exists/.test(u.ConditionExpression || '')), 'every mint is conditional');
  });

  seed();
  first = (await hostCall('GET', 'state')).body.wallKey;
  await check('never on the host\'s Claude\'s read', async () => {
    const r = await agentCall('GET', 'state');
    assert.strictEqual(r.status, 200);
    assert.ok(!('wallKey' in r.body));
    assert.ok(!r.text.includes(first));
  });
  await check('never on a builder\'s Claude\'s read', async () => {
    await hostCall('POST', 'crew/settings', { enabled: true });
    await playCall('POST', 'crew/builder-key', seat('Priya'));
    const r = await builderCall('Priya')('GET', 'state');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(!r.text.includes(first));
  });
  await check('never on a phone\'s read', async () => {
    const r = await playCall('GET', 'state', seat('Marcus'));
    assert.strictEqual(r.status, 200);
    assert.ok(!r.text.includes(first));
    assert.ok(!/wallKey/i.test(r.text));
  });
  await check('never on the wall\'s own read', async () => {
    const r = await wallCall(first);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(!r.text.includes(first));
    assert.ok(!/wallKey/i.test(r.text));
  });
  await check('an answer to any other host route does not carry it either', async () => {
    const r = await hostCall('POST', 'wall', { screen: 'build' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(!r.text.includes(first));
  });

  await check('rotate: a new key; the old one is refused, the new one opens the wall', async () => {
    const r = await hostCall('POST', 'wall', { rotate: true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const next = r.body.wallKey;
    assert.ok(B64URL_32.test(next));
    assert.notStrictEqual(next, first);
    assert.strictEqual(row('BUILD#STATE').WallKey, next);
    assert.strictEqual((await hostCall('GET', 'state')).body.wallKey, next);
    assert.strictEqual((await wallCall(first)).status, 403, 'the old key is retired');
    assert.strictEqual((await wallCall(next)).status, 200);
    assert.strictEqual(row('BUILD#STATE').ttl, H.TTL);
  });
  await check('rotate tells every screen (the old window learns its link has changed)', async () => {
    H.sent.length = 0;
    await hostCall('POST', 'wall', { rotate: true });
    assert.ok(H.sent.some((s) => s.message.type === 'buildChanged'), JSON.stringify(H.sent));
    assert.ok(!JSON.stringify(H.sent).includes(row('BUILD#STATE').WallKey), 'the frame never carries the key');
  });
  await check('only the host rotates: Claude\'s key and a phone are refused, and the key stays', async () => {
    const before = row('BUILD#STATE').WallKey;
    assert.strictEqual((await agentCall('POST', 'wall', { rotate: true })).status, 403);
    assert.strictEqual((await builderCall('Priya')('POST', 'wall', { rotate: true })).status, 403);
    assert.strictEqual((await playCall('POST', 'wall', seat('Marcus'), { rotate: true })).status, 404);
    assert.strictEqual(row('BUILD#STATE').WallKey, before);
  });

  const { pass, failed } = H.results();
  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
