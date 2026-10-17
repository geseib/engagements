/**
 * BUILD ROOM — THE WALL READ (docs/design/parity/PLAN.md §2.2, tasks B2 and B4).
 *
 *   GET /games/{id}/build-play/wall?k=<wallKey>
 *   GET /games/{id}/build-play/wall/images/{imageId}?k=<wallKey>
 *
 * Public (no seat, no sign-in) but keyed: `k` must equal BUILD#STATE.WallKey.
 * The body is `wallView`, an ALLOWLIST built for what the projected Stage,
 * Build and History screens read. The fixture below puts every private thing
 * a Build Room holds into one room, each under a distinctive string, and the
 * wall's body must carry none of them. Names appear only when the host has
 * "List names on the room meter" on (owner, Q12/Q15).
 *
 * B4: the host's read carries the room's window status (`presenting`,
 * `presentDetail`, room-counts.js); the wall, a phone and the host's Claude
 * never do; a viewer connection row is never counted as a player.
 *
 * Expectations are written by hand, never read back off the handler's output.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const H = require('./helpers/build-wall-harness');

const { check, hostCall, agentCall, builderCall, playCall, wallCall, seat, put, PK, PNG } = H;

// Distinctive names: a case-insensitive substring check on the body means something.
const ZEB = 'Zebulon';
const QUI = 'Quintessa';
const OTT = 'Ottoline'; // a builder
const NAMES = [ZEB, QUI, OTT];
const SECRETS = {
  hostNote: 'HOST-NOTE-ON-THE-DECISION-77',
  privateLog: 'HOST-PRIVATE-NOTE-ENTRY-77',
  claudeNote: 'CLAUDE-NOTE-HOW-TO-USE-77',
  draftHeadline: 'DRAFT-HEADLINE-NOT-AGREED-77',
  draftSummary: 'DRAFT-SUMMARY-NOT-AGREED-77',
  later: 'LATER-ITEM-HELD-FOR-CLAUDE-77',
  unusedIdea: 'UNUSED-IDEA-NOBODY-SENT-77',
  direction: 'DIRECTION-WORDS-OF-THE-HOST-77',
  point: 'TALKING-POINT-NOT-SHOWN-77',
  lanKey: 'LANKEYlanKEYlanKEY77zz',
  email: 'host-person@example.org',
  idSecret: 'SECRET-ID-SECRET-NEVER-SENT-0123456789abcdef',
  proposed: 'PROPOSED-ASK-THE-ROOM-NEVER-SAW-77',
  activity: 'ACTIVITY-LINE-CLAUDE-IS-ON-77',
};

const ids = {};

async function buildFixture() {
  H.seed({ players: [ZEB, QUI, OTT] });
  // An email on METADATA and on a player row, as sign-in writes them.
  const meta = H.row('METADATA');
  Object.assign(meta, { CreatedBy: SECRETS.email, HostEmail: SECRETS.email });
  Object.assign(H.row(`PLAYER#${ZEB}`), { Email: SECRETS.email });
  // A /present window on this session: a connection row, never a player.
  put({ PK, SK: 'CONNECTION#wall-1', ConnectionId: 'wall-1', ConnectionType: 'PLAYER', PlayerName: null, Viewer: 'present', ViewerId: 'viewer-abcdef12', ConnectedAt: new Date().toISOString(), StatusAt: new Date().toISOString(), Fullscreen: true, Visible: true });

  ids.wallKey = (await hostCall('GET', 'state')).body.wallKey;
  ids.agentKey = (await hostCall('POST', 'keys', {})).body.key;

  // A choice ask, answered with names and whys, decided with a host note and a ready question's note.
  const choice = (await hostCall('POST', 'asks', { kind: 'choice', prompt: 'Which colour?', options: [{ title: 'Blue' }, { title: 'Orange' }], claudeNote: SECRETS.claudeNote })).body.ask;
  ids.choice = choice.askId;
  await playCall('POST', 'respond', seat(ZEB), { askId: choice.askId, choice: ['A'], why: 'Calm' });
  await playCall('POST', 'respond', seat(QUI), { askId: choice.askId, choice: ['B'], why: 'Bright' });
  await hostCall('POST', `asks/${choice.askId}`, { action: 'close' });
  // The wheel names who spins it.
  await hostCall('POST', `asks/${choice.askId}`, { action: 'wheel' });
  await hostCall('POST', `asks/${choice.askId}`, { action: 'spin' });
  const d = await hostCall('POST', `asks/${choice.askId}`, { action: 'decide', chosen: ['A'], note: SECRETS.hostNote });
  assert.strictEqual(d.status, 200, JSON.stringify(d.body));

  // Ideas from the room: one sent to Claude (its author on the log's detail), one never used.
  await playCall('POST', 'idea', seat(ZEB), { text: 'Add a parking map' });
  await playCall('POST', 'idea', seat(QUI), { text: SECRETS.unusedIdea });
  const ideas = (await hostCall('GET', 'state')).body.ideas;
  ids.sentIdea = ideas.find((i) => i.text === 'Add a parking map').ideaId;
  ids.unusedIdea = ideas.find((i) => i.text === SECRETS.unusedIdea).ideaId;
  await hostCall('POST', `ideas/${ids.sentIdea}`, { action: 'direct' });

  // The host's own words: a private note, a direction, a brief with a Later item.
  await hostCall('POST', 'log', { kind: 'note', text: SECRETS.privateLog });
  await hostCall('POST', 'directions', { text: SECRETS.direction });
  await hostCall('POST', 'brief', { forWhom: 'Volunteers on a Saturday', keep: ['Keep it to one page'], later: [SECRETS.later] });
  // Claude's draft of the brief, not yet used.
  const draft = await agentCall('POST', 'brief/draft', { headline: SECRETS.draftHeadline, summary: SECRETS.draftSummary });
  assert.ok(draft.status < 300, JSON.stringify(draft.body));
  // A talking point Claude posted that the host has not shown.
  const pts = await agentCall('POST', 'points', { points: [{ kind: 'talk', text: SECRETS.point }] });
  assert.ok(pts.status < 300, JSON.stringify(pts.body));
  // Claude's live activity line.
  await agentCall('POST', 'activity', { items: [{ kind: 'edit', text: SECRETS.activity }], doing: SECRETS.activity });
  // The Host alert's seen.
  await hostCall('POST', 'seen', { ids: [`ask:${choice.askId}`] });

  // Claude's ask the room never saw, with a mockup on it: never on the wall, nor its picture.
  const prop = (await agentCall('POST', 'asks', { kind: 'choice', prompt: SECRETS.proposed, options: [{ title: 'One' }, { title: 'Two' }] })).body.ask;
  assert.strictEqual(prop.status, 'proposed');
  ids.hiddenImage = (await agentCall('POST', 'images', { data: PNG.toString('base64'), kind: 'mockup', askId: prop.askId, label: 'A', caption: 'mockup' })).body.image.imageId;
  // A screenshot of the work: on the wall.
  ids.shot = (await agentCall('POST', 'images', { data: PNG.toString('base64'), kind: 'progress', caption: 'The sign-up form' })).body.image.imageId;

  // The demo on this Wi-Fi: live, with its key; Claude showed it at a laptop address.
  put({ PK, SK: 'BUILD#LAN', Wanted: true, Status: 'live', ReportedAt: new Date().toISOString(), LiveSince: new Date().toISOString(), Open: 1, Key: SECRETS.lanKey, Map: [{ local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900' }], ttl: H.TTL });
  await agentCall('POST', 'log', { kind: 'showing', text: 'The form, running', link: 'http://localhost:5173/signup' });

  // A crew: a builder whose branch and lane carry her name, an early look on the wall, a room reaction.
  await hostCall('POST', 'crew/settings', { enabled: true });
  await playCall('POST', 'crew/builder-key', seat(OTT));
  const ott = builderCall(OTT);
  await ott('POST', 'crew/me', { mode: 'fork', forkUrl: 'https://github.com/ottoline-k/foodbank', branch: 'crew/ottoline/parking-map', status: 'building' });
  const img = await ott('POST', 'images', { data: PNG.toString('base64'), caption: 'Map', kind: 'progress' });
  ids.crewShot = img.body.image.imageId;
  const share = await ott('POST', 'crew/shares', { title: 'Parking map', summary: 'Three lots', commit: '9c41d7a', imageIds: [ids.crewShot] });
  assert.strictEqual(share.status, 201, JSON.stringify(share.body));
  await hostCall('POST', `crew/shares/${share.body.share.shareId}`, { action: 'feature' });
  await playCall('POST', 'crew/react', seat(QUI), { shareId: share.body.share.shareId, kind: 'question', text: 'Does it work at night?' });
}

const body = async (k = ids.wallKey) => {
  const r = await wallCall(k);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return r;
};
const hasName = (text) => NAMES.filter((n) => text.toLowerCase().includes(n.toLowerCase()));

(async () => {
  console.log('\nbuild wall: who may read it');
  H.seed();
  await check('before the host has read the room there is no key: any k, and no k, is refused', async () => {
    assert.strictEqual((await wallCall(undefined)).status, 403);
    assert.strictEqual((await wallCall('')).status, 403);
    assert.strictEqual((await wallCall('undefined')).status, 403);
  });
  const k = (await hostCall('GET', 'state')).body.wallKey;
  await check('no key → 403; a wrong key → 403; a key of the wrong length → 403', async () => {
    assert.strictEqual((await wallCall(undefined)).status, 403);
    assert.strictEqual((await wallCall('')).status, 403);
    assert.strictEqual((await wallCall(`${k.slice(0, -1)}${k.slice(-1) === 'A' ? 'B' : 'A'}`)).status, 403);
    assert.strictEqual((await wallCall(`${k}x`)).status, 403);
    assert.strictEqual((await wallCall(k.slice(1))).status, 403);
  });
  await check('the right key → 200, with no seat and no sign-in', async () => {
    const r = await wallCall(k);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.gameId, H.GAME);
  });
  await check('a phone\'s seat is not a key', async () => {
    assert.strictEqual((await playCall('GET', 'wall', seat('Priya'))).status, 403);
  });
  await check('the image route takes the same key', async () => {
    assert.strictEqual((await wallCall(undefined, 'wall/images/abc')).status, 403);
    assert.strictEqual((await wallCall('nope', 'wall/images/abc')).status, 403);
  });
  await check('not a build session → 404, as every build-play route', async () => {
    H.seed({ gameType: 'trivia' });
    assert.strictEqual((await wallCall(k)).status, 404);
  });

  console.log('\nbuild wall: what it carries');
  await buildFixture();
  let wall;
  await check('the allowlist: these keys and no others', async () => {
    wall = (await body()).body;
    assert.deepStrictEqual(Object.keys(wall).sort(), [
      'agent', 'brief', 'crew', 'current', 'doing', 'gameId', 'goal', 'history', 'ideaCounts', 'images', 'lan', 'log', 'opening', 'outcome',
      'playerCount', 'players', 'rev', 'run', 'shownPoint', 'state', 'title', 'wall', 'wallComment',
    ].sort());
    // Claude's status line on the Stage and the Build screen, as a phone reads it: no key, no times.
    assert.deepStrictEqual(Object.keys(wall.agent).sort(), ['connected', 'listening', 'name']);
  });
  await check('none of the private strings appears anywhere in the body', async () => {
    const text = (await body()).text;
    for (const [what, s] of Object.entries(SECRETS)) assert.ok(!text.includes(s), `the wall carries ${what}: ${s}`);
    assert.ok(!text.includes(ids.agentKey), 'the agent key');
    assert.ok(!text.includes(ids.wallKey), 'the wall key itself');
    assert.ok(!text.includes('IdSecret'));
    assert.ok(!text.includes('@'), 'no email, nor anything shaped like one');
    assert.ok(!text.includes(ids.unusedIdea), 'not even the unused idea\'s id');
  });
  await check('with List names off, no name anywhere: players, voters, why names, idea authors, the wheel, the crew', async () => {
    const text = (await body()).text;
    assert.deepStrictEqual(hasName(text), []);
    assert.ok(!/playerName|voters|"spinner":"[^"h]/.test(text), text.slice(0, 400));
    assert.deepStrictEqual(wall.players, []);
  });
  await check('never the host-only parts: seen, ideas, activity, points, settings, plugin, briefDraft, agent', async () => {
    for (const k2 of ['seen', 'ideas', 'activity', 'points', 'settings', 'plugin', 'briefDraft', 'asks', 'mine', 'myIdeas', 'deleteAs', 'wallKey', 'presenting', 'presentDetail']) {
      assert.ok(!(k2 in wall), `wallView carries ${k2}`);
    }
  });
  await check('the agreed brief and the opening, never the draft nor the Later list', async () => {
    assert.strictEqual(wall.brief.forWhom, 'Volunteers on a Saturday');
    assert.deepStrictEqual(wall.brief.keep.map((i) => i.text), ['Keep it to one page']);
    assert.ok(!('later' in wall.brief));
    assert.ok(wall.opening && Array.isArray(wall.opening.steps) && wall.opening.phase, JSON.stringify(wall.opening));
  });
  await check('History: the asks the room saw (with stamps), the used ideas, what carried them to Claude', async () => {
    const h = wall.history;
    assert.deepStrictEqual(h.asks.map((a) => a.askId), [ids.choice]);
    const a = h.asks[0];
    assert.deepStrictEqual(a.decision.chosen, ['A']);
    assert.ok(!('note' in a.decision));
    assert.ok(!('claudeNote' in a) && !('claudeGets' in a));
    assert.deepStrictEqual(a.results.options.map((o) => [o.label, o.count]), [['A', 1], ['B', 1]]);
    assert.deepStrictEqual(h.ideas.map((i) => i.text), ['Add a parking map']);
    const sentEntry = h.sent.find((l) => l.kind === 'idea');
    assert.deepStrictEqual([sentEntry.ideaId, sentEntry.asWritten], [ids.sentIdea, true]);
  });
  await check('ideaCounts: every idea, and the used ones by History\'s rule', async () => {
    assert.deepStrictEqual(wall.ideaCounts, { total: 2, used: 1 });
  });
  await check('the log is the room\'s timeline: no notes, no directions, no idea authors, no laptop or keyed links', async () => {
    const kinds = new Set(wall.log.map((l) => l.kind));
    for (const kk of ['note', 'direction', 'crew', 'help', 'base']) assert.ok(!kinds.has(kk), `log has ${kk}`);
    assert.ok(wall.log.some((l) => l.kind === 'showing' && l.text === 'The form, running'), 'Claude\'s showing is there');
    assert.ok(wall.log.every((l) => !l.link || !/localhost|192\.168|[?&]k=/.test(l.link)), JSON.stringify(wall.log.map((l) => l.link)));
    assert.ok(wall.log.every((l) => !l.name), 'no entry names a person');
    assert.ok(wall.log.filter((l) => l.kind === 'idea').every((l) => l.detail === ''));
  });
  await check('the demo on this Wi-Fi: that it is live, never its keyed link', async () => {
    assert.deepStrictEqual(wall.lan, { live: true });
  });
  await check('images: the screenshot and the seen ask\'s pictures, never a picture for an ask the room has not seen', async () => {
    const listed = wall.images.map((i) => i.imageId);
    assert.ok(listed.includes(ids.shot));
    assert.ok(listed.includes(ids.crewShot), 'the crew board\'s screenshot');
    assert.ok(!listed.includes(ids.hiddenImage));
    assert.ok(wall.images.every((i) => Object.keys(i).every((kk) => ['imageId', 'caption', 'kind', 'askId', 'label', 'contentType', 'createdAt'].includes(kk))), JSON.stringify(wall.images[0]));
  });
  await check('the wall image route serves a listed image and 404s one that is not listed', async () => {
    const ok = await wallCall(ids.wallKey, `wall/images/${ids.shot}`);
    assert.strictEqual(ok.status, 200);
    assert.ok(ok.raw.equals(PNG));
    assert.strictEqual(ok.headers['Content-Type'], 'image/png');
    assert.strictEqual((await wallCall(ids.wallKey, `wall/images/${ids.hiddenImage}`)).status, 404);
    assert.strictEqual((await wallCall(ids.wallKey, 'wall/images/0123456789abcdef01234567')).status, 404);
    assert.strictEqual((await wallCall('wrong', `wall/images/${ids.shot}`)).status, 403);
  });
  await check('the crew board: lanes, tasks, the early look on the wall; no branch, no fork, no names', async () => {
    const c = wall.crew;
    assert.strictEqual(c.enabled, true);
    assert.strictEqual(c.builders.length, 1);
    const b = c.builders[0];
    assert.ok(b.name && !hasName(b.name).length, b.name);
    assert.ok(!('branch' in b) && !('forkUrl' in b) && !('note' in b), JSON.stringify(b));
    assert.strictEqual(c.shares.length, 1);
    assert.strictEqual(c.shares[0].builder, b.name, 'the board\'s lane and the early look agree on the label');
    assert.ok(c.shares[0].versions.every((v) => !('branch' in v) && !('forkUrl' in v)));
    assert.deepStrictEqual(c.shares[0].reactions, { 'looks-right': 0, question: 1, concern: 0 });
    assert.ok(!('repoUrl' in c) && !('runCrewCode' in c) && !('me' in c));
  });
  await check('the room\'s count: players only; the /present window is not one', async () => {
    assert.strictEqual(wall.playerCount, 3);
  });
  await check('wall state: Stage, no codes, Room profile by default; the ask that opened moved its rev', async () => {
    assert.deepStrictEqual(wall.wall, { screen: 'stage', codes: 'none', profile: 'room', rev: H.row('BUILD#STATE').WallRev });
    assert.ok(wall.wall.rev > 0);
  });
  await check('an entry about an ask the room has not seen is not on the wall', async () => {
    assert.ok(!wall.log.some((l) => l.askId && !wall.history.asks.some((a) => a.askId === l.askId)), JSON.stringify(wall.log.map((l) => [l.kind, l.askId])));
  });
  await check('the comment the host put on the wall shows while fresh, never its author, and goes when stale', async () => {
    await playCall('POST', 'idea', seat(ZEB), { text: 'Love the orange' });
    const idea = (await hostCall('GET', 'state')).body.ideas.find((i) => i.text === 'Love the orange');
    await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'wall' });
    let w = (await body()).body;
    assert.strictEqual(w.wallComment.text, 'Love the orange');
    assert.ok(!hasName(JSON.stringify(w.wallComment)).length);
    H.row('BUILD#STATE').WallComment.At = new Date(Date.now() - H.S.WALL_COMMENT_MS - 1000).toISOString();
    w = (await body()).body;
    assert.strictEqual(w.wallComment, null);
  });

  console.log('\nbuild wall: names only with List names on');
  await check('List names on: the players, the builders and the spinner by name', async () => {
    await hostCall('POST', 'settings', { listNames: true });
    const r = await body();
    assert.deepStrictEqual(r.body.players, [OTT, QUI, ZEB]);
    assert.strictEqual(r.body.crew.builders[0].name, OTT);
    assert.strictEqual(r.body.crew.shares[0].builder, OTT);
    // Still never a voter list, a why's author, or an idea's author.
    assert.ok(!/voters|playerName/.test(r.text));
    for (const s of Object.values(SECRETS)) assert.ok(!r.text.includes(s), s);
  });
  await check('List names off again: gone again', async () => {
    await hostCall('POST', 'settings', { listNames: false });
    assert.deepStrictEqual(hasName((await body()).text), []);
  });

  console.log('\nbuild wall: the room\'s window status for the host (B4)');
  await check('the host\'s read carries presenting and presentDetail', async () => {
    const h = (await hostCall('GET', 'state')).body;
    assert.strictEqual(h.presenting, 1);
    assert.strictEqual(h.presentDetail.open, true);
    assert.strictEqual(h.presentDetail.fullscreen, true);
    assert.strictEqual(h.presentDetail.visible, true);
    assert.ok(Number.isFinite(h.presentDetail.ageMs));
    assert.strictEqual(h.playerCount, 3, 'the window\'s connection row is not a player');
  });
  await check('the host\'s Claude, a phone and the wall never carry them', async () => {
    const a = (await agentCall('GET', 'state')).body;
    assert.ok(!('presenting' in a) && !('presentDetail' in a));
    const p = (await playCall('GET', 'state', seat(ZEB))).body;
    assert.ok(!('presenting' in p) && !('presentDetail' in p));
    assert.strictEqual(p.playerCount, 3);
    const w = (await body()).body;
    assert.ok(!('presenting' in w) && !('presentDetail' in w));
  });
  await check('the window status fails soft: a failed read is 0 and null, never a 500', async () => {
    H.hooks.beforeQuery = (inp) => { if (inp.ExpressionAttributeValues[':viewer']) throw new Error('throttled'); };
    const quiet = console.error; console.error = () => {};
    try {
      const r = await hostCall('GET', 'state');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.presenting, 0);
      assert.strictEqual(r.body.presentDetail, null);
    } finally { H.hooks.beforeQuery = null; console.error = quiet; }
  });
  await check('no window open: presenting 0 and presentDetail closed', async () => {
    H.store.delete(`${PK}|CONNECTION#wall-1`);
    const h = (await hostCall('GET', 'state')).body;
    assert.strictEqual(h.presenting, 0);
    assert.strictEqual(h.presentDetail.open, false);
  });

  const { pass, failed } = H.results();
  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
