/**
 * BUILD ROOM — THE SERVER OWNS WHAT THE WALL SHOWS (docs/design/parity/PLAN.md
 * §2.3, task B3; host standards §6: "cleared by the server on every phase
 * change that makes it stale, with a frame to every surface. A client never
 * clears it alone").
 *
 *   BUILD#STATE  WallScreen  stage | build | history   (default stage)
 *                WallCodes   none | join | both        (default none)
 *                WallProfile room | tv | call | table  (default room)
 *                WallRev     ADD 1 on every write
 *
 *   POST /games/{id}/build/wall {screen?, codes?, profile?, rotate?}: the host
 *   only (Claude's key and a builder's are refused, a phone has no such route);
 *   junk → 400; announces buildChanged to every connection, /present's included.
 *
 *   Server clears: an ask opening sets codes none; the session ending reads as
 *   codes none; back to the opening sets the screen to stage.
 *
 * Expectations are written by hand, never read back off the handler's output.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const H = require('./helpers/build-wall-harness');

const { check, hostCall, agentCall, builderCall, playCall, wallCall, seat, row, put, PK } = H;

const wallOf = async () => (await hostCall('GET', 'state')).body.wall;
const stateRow = () => row('BUILD#STATE');

(async () => {
  console.log('\nbuild wall: the host moves it');
  H.seed();
  // A /present window and a phone are both connected: both must hear the change.
  put({ PK, SK: 'CONNECTION#wall-1', ConnectionId: 'wall-1', ConnectionType: 'PLAYER', PlayerName: null, Viewer: 'present', ViewerId: 'viewer-abcdef12' });
  const k = (await hostCall('GET', 'state')).body.wallKey;

  await check('defaults before anything is written: Stage, no codes, Room, rev 0, on the host read and the wall', async () => {
    assert.deepStrictEqual(await wallOf(), { screen: 'stage', codes: 'none', profile: 'room', rev: 0 });
    assert.deepStrictEqual((await wallCall(k)).body.wall, { screen: 'stage', codes: 'none', profile: 'room', rev: 0 });
  });
  await check('the host writes the screen; the reply, the host read and the wall all say so', async () => {
    const r = await hostCall('POST', 'wall', { screen: 'build' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.wall, { screen: 'build', codes: 'none', profile: 'room', rev: 1 });
    assert.deepStrictEqual(await wallOf(), r.body.wall);
    assert.deepStrictEqual((await wallCall(k)).body.wall, r.body.wall);
    assert.strictEqual(stateRow().WallScreen, 'build');
  });
  await check('one write may carry all three; what it leaves out stays', async () => {
    let r = await hostCall('POST', 'wall', { screen: 'history', codes: 'both', profile: 'tv' });
    assert.deepStrictEqual(r.body.wall, { screen: 'history', codes: 'both', profile: 'tv', rev: 2 });
    r = await hostCall('POST', 'wall', { codes: 'join' });
    assert.deepStrictEqual(r.body.wall, { screen: 'history', codes: 'join', profile: 'tv', rev: 3 });
  });
  await check('rev only goes up, one per write, and moves the room\'s Rev too', async () => {
    const before = stateRow();
    const r = await hostCall('POST', 'wall', { profile: 'call' });
    assert.strictEqual(r.body.wall.rev, before.WallRev + 1);
    assert.strictEqual(stateRow().Rev, before.Rev + 1);
    const r2 = await hostCall('POST', 'wall', { profile: 'call' });
    assert.ok(r2.body.wall.rev > r.body.wall.rev, 'the same value written again still moves on');
  });
  await check('the row keeps the session ttl', async () => {
    assert.strictEqual(stateRow().ttl, H.TTL);
  });
  await check('buildChanged goes to every connection, the /present window included, carrying no wall data', async () => {
    H.sent.length = 0;
    await hostCall('POST', 'wall', { screen: 'stage' });
    const to = H.sent.filter((s) => s.message.type === 'buildChanged').map((s) => s.connectionId).sort();
    assert.deepStrictEqual(to, ['host-1', 'p-1', 'wall-1']);
    const frame = H.sent.find((s) => s.message.type === 'buildChanged').message;
    assert.deepStrictEqual(Object.keys(frame).sort(), ['gameId', 'rev', 'type']);
  });

  console.log('\nbuild wall: what is refused');
  await check('junk → 400, and nothing is written', async () => {
    const before = JSON.stringify(stateRow());
    for (const b of [{ screen: 'host' }, { codes: 'yes' }, { profile: 'cinema' }, { screen: 3 }, { screen: '' }, {}, { rotate: 'yes' }, { codes: ['join'] }]) {
      const r = await hostCall('POST', 'wall', b);
      assert.strictEqual(r.status, 400, `${JSON.stringify(b)} → ${r.status}`);
    }
    assert.strictEqual(JSON.stringify(stateRow()), before);
  });
  await check('Claude\'s key → 403; a builder\'s → 403; a phone → 404; nothing written', async () => {
    const before = JSON.stringify(stateRow());
    assert.strictEqual((await agentCall('POST', 'wall', { screen: 'build' })).status, 403);
    await hostCall('POST', 'crew/settings', { enabled: true });
    await playCall('POST', 'crew/builder-key', seat('Priya'));
    const after = JSON.stringify(stateRow());
    assert.strictEqual((await builderCall('Priya')('POST', 'wall', { screen: 'build' })).status, 403);
    assert.strictEqual((await playCall('POST', 'wall', seat('Marcus'), { screen: 'build' })).status, 404);
    assert.ok(before.length > 0);
    assert.strictEqual(stateRow().WallScreen, 'stage');
    assert.strictEqual(JSON.parse(after).WallRev, stateRow().WallRev);
  });
  await check('the host\'s Claude does not read the wall\'s state', async () => {
    const a = (await agentCall('GET', 'state')).body;
    assert.ok(!('wall' in a) && !('wallKey' in a));
  });

  console.log('\nbuild wall: the server clears it');
  await check('opening an ask takes the codes down (the codes yield to the ask)', async () => {
    await hostCall('POST', 'wall', { codes: 'both', screen: 'stage' });
    const rev = stateRow().WallRev;
    const ask = await hostCall('POST', 'asks', { kind: 'choice', prompt: 'Blue or orange?', options: [{ title: 'Blue' }, { title: 'Orange' }] });
    assert.strictEqual(ask.body.ask.status, 'live');
    assert.strictEqual((await wallOf()).codes, 'none');
    assert.ok(stateRow().WallRev > rev, 'the clear is a write: rev moves');
  });
  await check('opening a waiting ask by hand, and asking again, clear them too', async () => {
    const draft = (await hostCall('POST', 'asks', { kind: 'rating', prompt: 'How is it?', draft: true })).body.ask;
    await hostCall('POST', 'wall', { codes: 'join' });
    await hostCall('POST', `asks/${draft.askId}`, { action: 'open' });
    assert.strictEqual((await wallOf()).codes, 'none');
    await hostCall('POST', 'wall', { codes: 'join' });
    const re = await hostCall('POST', `asks/${draft.askId}`, { action: 'reask', prompt: 'How is it now?' });
    assert.strictEqual(re.status, 200, JSON.stringify(re.body));
    assert.strictEqual((await wallOf()).codes, 'none');
  });
  await check('a write that is not an opening leaves the codes alone (closing an ask)', async () => {
    await hostCall('POST', 'wall', { codes: 'join' });
    const cur = stateRow().CurrentAskId;
    await hostCall('POST', `asks/${cur}`, { action: 'close' });
    assert.strictEqual((await wallOf()).codes, 'join');
  });
  await check('back to the opening puts the Stage up', async () => {
    await hostCall('POST', 'opening/start', {});
    await hostCall('POST', 'wall', { screen: 'history' });
    const r = await hostCall('POST', 'opening/resume', {});
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual((await wallOf()).screen, 'stage');
  });
  await check('the session ending reads as no codes, on the host read and the wall', async () => {
    await hostCall('POST', 'wall', { codes: 'both', screen: 'history' });
    row('STATE').State = 'ENDED';
    assert.strictEqual((await wallOf()).codes, 'none');
    const w = (await wallCall(k)).body;
    assert.strictEqual(w.state, 'ENDED');
    assert.strictEqual(w.wall.codes, 'none');
    assert.strictEqual(w.wall.screen, 'history', 'the screen the host chose stays');
  });
  await check('after the end the host may still move the screen and the profile, but not put codes up', async () => {
    let r = await hostCall('POST', 'wall', { screen: 'build', profile: 'table' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.wall.screen, 'build');
    r = await hostCall('POST', 'wall', { codes: 'join' });
    assert.strictEqual(r.status, 409);
    r = await hostCall('POST', 'wall', { codes: 'none' });
    assert.strictEqual(r.status, 200);
  });

  const { pass, failed } = H.results();
  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
