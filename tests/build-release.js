/**
 * BUILD ROOM — THE RELEASE GATE (owner, 17 Oct 2026: "Have thing get to host
 * queue to release to room"; docs/design/parity/PLAN.md §2c).
 *
 * Nothing Claude makes for the room reaches the room (the phones, the room's
 * window, the laptop's projected screens) until the host releases it from the
 * host's queue. With `reviewAgentPosts` on (the default), Claude's posts
 * (progress, milestone, showing, checkpoint, answer, from the host's Claude or
 * a builder's) and its screenshots are stored HELD (`Released: false`): on the
 * host's read and Claude's, never on a phone, the wall, the wall's image route,
 * the phone's image route or the room's Open the build. Mockups (an image on
 * an ask) follow their ask. "Claude proposed a question" never reaches the room.
 * Claude's live status (the doing line, steps, connected/listening) is never
 * held (owner ruling, 17 Oct).
 *
 *   POST build/posts {action: 'release'|'keep', ids: [logId, …]}   host only
 *
 * Expectations are written by hand, never read back off the handler's output.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const H = require('./helpers/build-wall-harness');

const { S, check, hostCall, agentCall, builderCall, playCall, wallCall, seat, put, PK, PNG } = H;

const phone = async () => (await playCall('GET', 'state', seat('Priya'))).body;
const host = async () => (await hostCall('GET', 'state')).body;
const agent = async () => (await agentCall('GET', 'state')).body;
const wallKey = async () => (await hostCall('GET', 'state')).body.wallKey;
const wall = async () => (await wallCall(await wallKey())).body;
const texts = (log) => (log || []).map((l) => l.text);
const img = (caption, extra = {}) => agentCall('POST', 'images', { data: PNG.toString('base64'), kind: 'progress', caption, ...extra });

(async () => {
  console.log('\nBuild room: the release gate');

  await check('the setting is on by default, and the host turns it off and on', async () => {
    H.seed();
    assert.strictEqual((await host()).settings.reviewAgentPosts, true);
    const off = await hostCall('POST', 'settings', { reviewAgentPosts: false });
    assert.strictEqual(off.status, 200);
    assert.strictEqual(off.body.settings.reviewAgentPosts, false);
    // Turning one setting leaves the other alone.
    assert.strictEqual(off.body.settings.reviewAgentAsks, true);
    assert.strictEqual((await host()).settings.reviewAgentPosts, false);
    await hostCall('POST', 'settings', { reviewAgentPosts: true });
    assert.strictEqual((await host()).settings.reviewAgentPosts, true);
  });

  await check('a held post and screenshot: on the host\'s read and Claude\'s, nowhere the room looks', async () => {
    H.seed();
    const p = await agentCall('POST', 'log', { kind: 'progress', text: 'HELD-PROGRESS-LINE' });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    assert.strictEqual(p.body.entry.roomHold, 'held');
    for (const kind of ['milestone', 'showing', 'checkpoint', 'answer']) {
      assert.strictEqual((await agentCall('POST', 'log', { kind, text: `HELD-${kind}` })).status, 201);
    }
    const shot = (await img('HELD-SHOT')).body.image.imageId;
    const h = await host();
    for (const t of ['HELD-PROGRESS-LINE', 'HELD-milestone', 'HELD-showing', 'HELD-checkpoint', 'HELD-answer', 'HELD-SHOT']) {
      assert.ok(texts(h.log).includes(t), `host sees ${t}`);
      assert.strictEqual(h.log.find((l) => l.text === t).roomHold, 'held');
    }
    assert.ok(h.images.some((i) => i.imageId === shot && i.roomHold === 'held'));
    const a = await agent();
    assert.ok(texts(a.log).includes('HELD-PROGRESS-LINE'), 'Claude sees its own post');
    assert.ok(a.images.some((i) => i.imageId === shot), 'Claude sees its own screenshot');
    const ph = await phone();
    const body = JSON.stringify(ph);
    assert.ok(!body.includes('HELD-'), `phone carries nothing held: ${body.slice(0, 400)}`);
    assert.ok(!ph.images.some((i) => i.imageId === shot));
    const w = await wall();
    assert.ok(!JSON.stringify(w).includes('HELD-'), 'the wall carries nothing held');
    assert.ok(!w.images.some((i) => i.imageId === shot));
    assert.ok(!JSON.stringify(w.history).includes('HELD-'));
    // The image routes: the wall's and a phone's refuse a held picture; the host's serves it.
    assert.strictEqual((await wallCall(await wallKey(), `wall/images/${shot}`)).status, 404);
    assert.strictEqual((await playCall('GET', `images/${shot}`, seat('Priya'))).status, 404);
    assert.strictEqual((await hostCall('GET', `images/${shot}`)).status, 200);
  });

  await check('the host releases one: present everywhere, at its original time', async () => {
    H.seed();
    const first = (await agentCall('POST', 'log', { kind: 'progress', text: 'FIRST-POST' })).body.entry;
    await hostCall('POST', 'log', { kind: 'verbal', text: 'Then the room said hello' });
    const r = await hostCall('POST', 'posts', { action: 'release', ids: [first.logId] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.released, [first.logId]);
    const h = await host();
    const e = h.log.find((l) => l.logId === first.logId);
    assert.ok(!e.roomHold, 'no longer held');
    assert.ok(e.releasedAt, 'ReleasedAt stamped');
    const ph = await phone();
    // Ordered by when it happened, not when it was released: before the room's line.
    assert.deepStrictEqual(texts(ph.log).filter((t) => ['FIRST-POST', 'Then the room said hello'].includes(t)), ['FIRST-POST', 'Then the room said hello']);
    assert.ok(texts((await wall()).log).includes('FIRST-POST'));
  });

  await check('release several, a screenshot among them: the picture reaches phones, the wall and both image routes', async () => {
    H.seed();
    const a = (await agentCall('POST', 'log', { kind: 'milestone', text: 'MILESTONE-A' })).body.entry.logId;
    const shot = (await img('SHOT-B')).body.image.imageId;
    const shotLog = (await host()).log.find((l) => l.kind === 'image' && l.detail === shot).logId;
    const r = await hostCall('POST', 'posts', { action: 'release', ids: [a, shotLog] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const ph = await phone();
    assert.ok(texts(ph.log).includes('MILESTONE-A'));
    assert.ok(ph.images.some((i) => i.imageId === shot));
    const w = await wall();
    assert.ok(w.images.some((i) => i.imageId === shot));
    assert.ok(texts(w.log).includes('SHOT-B'));
    assert.strictEqual((await wallCall(await wallKey(), `wall/images/${shot}`)).status, 200);
    assert.strictEqual((await playCall('GET', `images/${shot}`, seat('Priya'))).status, 200);
  });

  await check('keep to myself: off the queue for good, never in the room, and it cannot be released after', async () => {
    H.seed();
    const id = (await agentCall('POST', 'log', { kind: 'answer', text: 'PRIVATE-ANSWER' })).body.entry.logId;
    const k = await hostCall('POST', 'posts', { action: 'keep', ids: [id] });
    assert.strictEqual(k.status, 200, JSON.stringify(k.body));
    assert.strictEqual((await host()).log.find((l) => l.logId === id).roomHold, 'kept');
    assert.ok(!JSON.stringify(await phone()).includes('PRIVATE-ANSWER'));
    assert.ok(!JSON.stringify(await wall()).includes('PRIVATE-ANSWER'));
    assert.strictEqual((await hostCall('POST', 'posts', { action: 'release', ids: [id] })).status, 409);
    assert.ok(!JSON.stringify(await phone()).includes('PRIVATE-ANSWER'));
  });

  await check('bad bodies: no ids, an unknown action, an id that is not held', async () => {
    H.seed();
    const id = (await agentCall('POST', 'log', { kind: 'progress', text: 'x y' })).body.entry.logId;
    assert.strictEqual((await hostCall('POST', 'posts', { action: 'release', ids: [] })).status, 400);
    assert.strictEqual((await hostCall('POST', 'posts', { action: 'shout', ids: [id] })).status, 400);
    assert.strictEqual((await hostCall('POST', 'posts', { action: 'release', ids: ['nope-123'] })).status, 404);
    const verbal = (await hostCall('POST', 'log', { kind: 'verbal', text: 'said out loud' })).body.entry.logId;
    assert.strictEqual((await hostCall('POST', 'posts', { action: 'release', ids: [verbal] })).status, 404);
  });

  await check('a phone or Claude cannot release (403 / 404)', async () => {
    H.seed();
    const id = (await agentCall('POST', 'log', { kind: 'progress', text: 'NOT-YOURS-TO-RELEASE' })).body.entry.logId;
    assert.strictEqual((await agentCall('POST', 'posts', { action: 'release', ids: [id] })).status, 403);
    assert.strictEqual((await builderCall('Marcus')('POST', 'posts', { action: 'release', ids: [id] })).status, 403);
    assert.strictEqual((await playCall('POST', 'posts', seat('Priya'), { action: 'release', ids: [id] })).status, 404);
    assert.ok(!JSON.stringify(await phone()).includes('NOT-YOURS-TO-RELEASE'));
  });

  await check('the setting off: posts and screenshots go straight through; what was held stays held', async () => {
    H.seed();
    const before = (await agentCall('POST', 'log', { kind: 'progress', text: 'HELD-BEFORE-OFF' })).body.entry.logId;
    await hostCall('POST', 'settings', { reviewAgentPosts: false });
    const p = await agentCall('POST', 'log', { kind: 'showing', text: 'STRAIGHT-THROUGH' });
    assert.ok(!p.body.entry.roomHold);
    const shot = (await img('STRAIGHT-SHOT')).body.image.imageId;
    const ph = await phone();
    assert.ok(texts(ph.log).includes('STRAIGHT-THROUGH'));
    assert.ok(ph.images.some((i) => i.imageId === shot));
    assert.ok(!texts(ph.log).includes('HELD-BEFORE-OFF'));
    assert.strictEqual((await host()).log.find((l) => l.logId === before).roomHold, 'held');
  });

  await check('a builder\'s Claude: its posts are held too, and it still reads its own', async () => {
    H.seed({ players: ['Priya', 'Marcus'] });
    assert.strictEqual((await hostCall('POST', 'crew/settings', { enabled: true, modes: ['fork', 'patch'] })).status, 200);
    const key = await playCall('POST', 'crew/builder-key', seat('Marcus'));
    assert.strictEqual(key.status, 201, JSON.stringify(key.body));
    const b = builderCall('Marcus');
    const p = await b('POST', 'log', { kind: 'progress', text: 'BUILDER-HELD-POST' });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    assert.strictEqual(p.body.entry.roomHold, 'held');
    assert.ok(texts((await host()).log).includes('BUILDER-HELD-POST'));
    assert.ok(!JSON.stringify(await phone()).includes('BUILDER-HELD-POST'));
    assert.ok(texts((await b('GET', 'state')).body.log).includes('BUILDER-HELD-POST'), 'the builder\'s Claude reads its own');
  });

  await check('a mockup appears on phones and the wall exactly when its ask opens, whatever the setting', async () => {
    H.seed();
    const ask = (await agentCall('POST', 'asks', { kind: 'choice', prompt: 'MOCKUP-ASK-PROMPT', options: ['Bold', 'Calm'] })).body.ask;
    assert.strictEqual(ask.status, 'proposed');
    const m = (await agentCall('POST', 'images', { data: PNG.toString('base64'), kind: 'mockup', askId: ask.askId, label: 'A', caption: 'MOCKUP-A' })).body.image.imageId;
    assert.ok(!(await host()).images.find((i) => i.imageId === m).roomHold, 'a mockup is not a held post');
    let ph = await phone();
    assert.ok(!ph.images.some((i) => i.imageId === m), 'not on a phone while proposed');
    assert.ok(!JSON.stringify(ph).includes('MOCKUP-A'));
    assert.strictEqual((await playCall('GET', `images/${m}`, seat('Priya'))).status, 404);
    assert.ok(!(await wall()).images.some((i) => i.imageId === m));
    const o = await hostCall('POST', `asks/${ask.askId}`, { action: 'open' });
    assert.strictEqual(o.status, 200, JSON.stringify(o.body));
    ph = await phone();
    assert.ok(ph.images.some((i) => i.imageId === m), 'on a phone once open');
    assert.strictEqual(ph.current.options.find((x) => x.label === 'A').imageId, m);
    assert.ok((await wall()).images.some((i) => i.imageId === m));
    assert.strictEqual((await playCall('GET', `images/${m}`, seat('Priya'))).status, 200);
  });

  await check('"Claude proposed a question" never reaches a phone or the wall, even after the ask opens', async () => {
    H.seed();
    const ask = (await agentCall('POST', 'asks', { kind: 'suggest', prompt: 'SECRET-PROPOSAL-WORDS' })).body.ask;
    assert.ok(texts((await host()).log).some((t) => /^Claude proposed a question/.test(t)));
    assert.ok(!JSON.stringify(await phone()).includes('SECRET-PROPOSAL-WORDS'));
    assert.ok(!JSON.stringify(await wall()).includes('SECRET-PROPOSAL-WORDS'));
    await hostCall('POST', `asks/${ask.askId}`, { action: 'open' });
    assert.ok(!texts((await phone()).log).some((t) => /proposed a question/.test(t)));
    assert.ok(!texts((await wall()).log).some((t) => /proposed a question/.test(t)));
    // An old row, written before the flag: still the host's only.
    put({ PK, SK: 'BUILD#LOG#0000000000005#old', LogId: '0000000000005-old', Kind: 'ask', Text: 'Claude proposed a question: OLD-PROPOSAL', By: 'system', AskId: ask.askId, CreatedAt: '2026-10-01T00:00:00.000Z' });
    assert.ok(texts((await host()).log).includes('Claude proposed a question: OLD-PROPOSAL'));
    assert.ok(!JSON.stringify(await phone()).includes('OLD-PROPOSAL'));
    assert.ok(!JSON.stringify(await wall()).includes('OLD-PROPOSAL'));
  });

  await check('old rows without the flag stay visible to the room', async () => {
    H.seed();
    put({ PK, SK: 'BUILD#LOG#0000000000007#a', LogId: '0000000000007-a', Kind: 'progress', Text: 'OLD-AGENT-POST', By: 'agent', CreatedAt: '2026-10-01T00:00:00.000Z' });
    put({ PK, SK: 'BUILD#IMG#0000000000008#b', ImageId: 'oldimage0000000000000000', ContentType: 'image/png', Bytes: 10, Caption: 'OLD-SHOT', Kind: 'progress', By: 'agent', CreatedAt: '2026-10-01T00:00:00.000Z' });
    const ph = await phone();
    assert.ok(texts(ph.log).includes('OLD-AGENT-POST'));
    assert.ok(ph.images.some((i) => i.imageId === 'oldimage0000000000000000'));
    const w = await wall();
    assert.ok(texts(w.log).includes('OLD-AGENT-POST'));
    assert.ok(w.images.some((i) => i.imageId === 'oldimage0000000000000000'));
  });

  await check('a held post never hides Claude\'s live status: the doing line, its steps, connected and listening', async () => {
    H.seed();
    await agentCall('POST', 'log', { doing: 'Scaffolding the site' });
    await agentCall('POST', 'log', { done: 'Scaffolded the site', doing: 'Building the form', kind: 'progress', text: 'HELD-WITH-DOING' });
    const ph = await phone();
    assert.ok(!texts(ph.log).includes('HELD-WITH-DOING'));
    assert.strictEqual(ph.doing && ph.doing.text, 'Building the form', 'the doing line is live on a phone');
    assert.ok(ph.log.some((l) => l.kind === 'step'), 'the finished step is on a phone');
    assert.strictEqual(ph.agentConnected, true);
    const w = await wall();
    assert.ok(!texts(w.log).includes('HELD-WITH-DOING'));
    assert.strictEqual(w.doing && w.doing.text, 'Building the form', 'the doing line is live on the wall');
    assert.ok(w.log.some((l) => l.kind === 'step'), 'the finished step is on the wall');
    assert.strictEqual(w.agent.connected, true);
    // Listening (waiting for direction) shows too, held posts or not.
    await agentCall('GET', 'inbox', undefined, { listening: '1' });
    assert.strictEqual((await phone()).agentListening, true);
    assert.strictEqual((await wall()).agent.listening, true);
  });

  await check('the room\'s Open the build ignores a held link; the host\'s share link may still use it', async () => {
    const now = new Date().toISOString();
    const lan = { SK: 'BUILD#LAN', Wanted: true, Status: 'live', ReportedAt: now, Key: 'K'.repeat(30), Map: [{ local: 'http://localhost:4100', lan: 'http://192.168.1.20:4100' }] };
    const base = [
      { SK: 'BUILD#STATE', Rev: 1 }, lan,
      { SK: 'BUILD#LOG#0000000000001#a', LogId: '1-a', Kind: 'showing', Text: 'Old demo', Link: 'http://localhost:4100/old/index.html', Role: 'demo', By: 'agent', CreatedAt: '2026-10-17T10:00:00.000Z' },
      { SK: 'BUILD#LOG#0000000000002#b', LogId: '2-b', Kind: 'showing', Text: 'New demo', Link: 'http://localhost:4100/new/index.html', Role: 'demo', By: 'agent', Released: false, CreatedAt: '2026-10-17T10:05:00.000Z' },
    ];
    const room = S.roomFromRows(base);
    const args = { gameId: '4821', meta: { Title: 't' }, sessionState: 'STARTED', room, players: [], now };
    const pub = S.publicView({ ...args, me: null });
    assert.ok(pub.lan && pub.lan.open && pub.lan.open.includes('/old/'), JSON.stringify(pub.lan));
    assert.ok(!JSON.stringify(pub).includes('/new/'));
    const w = S.wallView({ ...args, crew: { enabled: false } });
    assert.ok(!JSON.stringify(w).includes('New demo'));
    const hv = S.hostView(args);
    assert.ok(hv.lan.demo.includes('/new/'), `the host's share link uses the newest: ${hv.lan.demo}`);
  });

  await check('the Host alert may mark a post seen (post:<logId>)', async () => {
    assert.strictEqual(S.normalizeSeen({ ids: ['post:1734000000000-abcdef'] }).ok, true);
  });

  const { pass, failed } = H.results();
  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
