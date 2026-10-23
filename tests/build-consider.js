/**
 * BUILD ROOM — CONSIDER, AND THE "SENT TO CLAUDE" MARKS
 * (docs/design/build-room-consider, frames 2-6; owner, 19 Oct 2026: "have the
 * ability to consider an item where you get a choice to queue up to the room,
 * or send to claude at any time ... we need to mark any ideas, votes, in
 * history as having been sent to claude ... maybe there is a place for notes").
 *
 *   POST /games/{id}/build/consider  { item, go: send|later|queue, text?, why?, round? }
 *
 * An item is one thing the room gave: idea:<id>, resp:<ask>:<id>,
 * option:<ask>:<label>, why:<ask>:<whyId>. What is held here:
 *   - the host's why is stored with the provenance stamp, sealed in a team's
 *     room, and Claude reads it ("Why: …") with what it gets;
 *   - History (the host's log, a phone's and the wall's history) carries the
 *     why, the room's words, a stable entry id, and never a name;
 *   - Queue for the room: an idea waits "queued" for a vote, or a waiting ask
 *     (yes/no, feedback) is made on its words; the normal flow is untouched.
 *
 * Expectations are written by hand, never read back off the handler's output.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const H = require('./helpers/build-wall-harness');

const { check, hostCall, agentCall, playCall, wallCall, seat, store, PK } = H;

const ZEB = 'Zebulon';
const QUI = 'Quintessa';
const zeb = seat(ZEB);
const qui = seat(QUI);
const ORG = 'org_TestOrg1';

const state = async () => (await hostCall('GET', 'state')).body;
const rows = (prefix) => [...store.values()].filter((r) => r.PK === PK && String(r.SK).startsWith(prefix));
const logRow = (logId) => rows('BUILD#LOG#').find((r) => r.LogId === logId);
const sendIdea = async (who, text) => {
  const r = await playCall('POST', 'idea', who, { text });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  return (await state()).ideas.find((i) => i.text === text);
};
const consider = (body) => hostCall('POST', 'consider', body);
const inbox = async () => (await agentCall('GET', 'inbox')).body.inbox || [];
const phoneHistory = async (who = zeb) => (await playCall('GET', 'state', who)).body.history;
const wallBody = async () => {
  const k = (await state()).wallKey;
  const r = await wallCall(k);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return r.body;
};

/** An open Ideas ask with suggestions from both phones. */
async function ideasAsk(prompt, texts) {
  const ask = (await hostCall('POST', 'asks', { kind: 'suggest', prompt })).body.ask;
  await hostCall('POST', `asks/${ask.askId}`, { action: 'open' });
  const who = [zeb, qui];
  for (let i = 0; i < texts.length; i += 1) await playCall('POST', 'respond', who[i % 2], { askId: ask.askId, text: texts[i] });
  return ask.askId;
}

/** A Choose ask, answered by both phones (with a why each), closed: the results are up. */
async function closedChoice(prompt, options, picks, whys = []) {
  const ask = (await hostCall('POST', 'asks', { kind: 'choice', prompt, options })).body.ask;
  await hostCall('POST', `asks/${ask.askId}`, { action: 'open' });
  await playCall('POST', 'respond', zeb, { askId: ask.askId, choice: [picks[0]], ...(whys[0] ? { why: whys[0] } : {}) });
  await playCall('POST', 'respond', qui, { askId: ask.askId, choice: [picks[1]], ...(whys[1] ? { why: whys[1] } : {}) });
  await hostCall('POST', `asks/${ask.askId}`, { action: 'close' });
  return ask.askId;
}

(async () => {
  console.log('\nConsider an idea: Send to Claude with changed words and a why');
  H.seed({ players: [ZEB, QUI] });
  let entryId;
  let ideaId;
  await check('the entry carries the why, the room\'s words, reworded, and names its idea', async () => {
    const idea = await sendIdea(zeb, 'make the background blue');
    ideaId = idea.ideaId;
    const r = await consider({ item: `idea:${idea.ideaId}`, go: 'send', text: 'make the background a gradient, light blue to white', why: 'the room agreed plain blue was too drab' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const e = r.body.entry;
    entryId = e.logId;
    assert.strictEqual(e.kind, 'direction');
    assert.strictEqual(e.text, 'make the background a gradient, light blue to white');
    assert.strictEqual(e.why, 'the room agreed plain blue was too drab');
    assert.strictEqual(e.roomWords, 'make the background blue');
    assert.strictEqual(e.asWritten, false);
    assert.strictEqual(e.considered, true);
    assert.deepStrictEqual(e.from, { askIds: [], ideaIds: [idea.ideaId] });
    const row = logRow(e.logId);
    assert.deepStrictEqual([row.Why, row.RoomWords, row.Considered, row.ForAgent], ['the room agreed plain blue was too drab', 'make the background blue', true, true]);
  });
  await check('the idea is used (sent to Claude), off the host\'s queue', async () => {
    const idea = (await state()).ideas.find((i) => i.ideaId === ideaId);
    assert.deepStrictEqual([idea.status, idea.promotedVia], ['promoted', 'claude']);
  });
  await check('Claude reads the direction with "Why: …" under it', async () => {
    const got = await inbox();
    const d = got.find((x) => x.id === entryId);
    assert.ok(d, JSON.stringify(got));
    assert.strictEqual(d.text, 'make the background a gradient, light blue to white\n\nWhy: the room agreed plain blue was too drab');
  });
  await check('a phone\'s History has the entry: entry id, the room\'s words, what Claude got, the why', async () => {
    const h = await phoneHistory();
    const s = h.sent.find((x) => x.entryId === entryId);
    assert.ok(s, JSON.stringify(h.sent));
    assert.deepStrictEqual(
      [s.text, s.roomWords, s.why, s.asWritten, s.considered, s.from.ideaIds],
      ['make the background a gradient, light blue to white', 'make the background blue', 'the room agreed plain blue was too drab', false, true, [ideaId]],
    );
    assert.ok(h.ideas.some((i) => i.ideaId === ideaId), 'the idea is a used one');
  });
  await check('the wall\'s History has the same entry', async () => {
    const w = await wallBody();
    const s = w.history.sent.find((x) => x.entryId === entryId);
    assert.deepStrictEqual([s.text, s.roomWords, s.why], ['make the background a gradient, light blue to white', 'make the background blue', 'the room agreed plain blue was too drab']);
  });
  await check('a why over 500 characters is cut to 500', async () => {
    const idea = await sendIdea(qui, 'bigger buttons for older phones');
    const r = await consider({ item: `idea:${idea.ideaId}`, go: 'send', why: 'x'.repeat(700) });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.entry.why.length, 500);
  });

  console.log('\nConsider an idea as written');
  H.seed({ players: [ZEB, QUI] });
  await check('unchanged words go as the idea, as written, with the why; no room words kept', async () => {
    const idea = await sendIdea(qui, 'let people pick a shift before making an account');
    const r = await consider({ item: `idea:${idea.ideaId}`, go: 'send', text: 'let people pick a shift before making an account', why: 'fewer steps' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.entry.kind, r.body.entry.ideaId, r.body.entry.asWritten, r.body.entry.roomWords, r.body.entry.why], ['idea', idea.ideaId, true, '', 'fewer steps']);
    const d = (await inbox()).find((x) => x.id === r.body.entry.logId);
    assert.strictEqual(d.text, 'An idea from the room: let people pick a shift before making an account\n\nWhy: fewer steps');
  });
  await check('the idea card\'s own Send to Claude (ideas/:id direct) takes a why too', async () => {
    const idea = await sendIdea(zeb, 'show a photo of last year\'s volunteers');
    assert.strictEqual((await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'direct', why: 'people trust faces' })).status, 200);
    const e = (await state()).log.find((l) => l.kind === 'idea' && l.ideaId === idea.ideaId);
    assert.strictEqual(e.why, 'people trust faces');
  });

  console.log('\nConsider a suggestion arriving in an open Ideas ask');
  H.seed({ players: [ZEB, QUI] });
  await check('a suggestion goes as a direction stamped with its item; the ask runs on', async () => {
    const askId = await ideasAsk('What would make sign-up friendlier?', ['a progress bar', 'fewer fields']);
    const resp = (await state()).asks.find((a) => a.askId === askId).responses.find((x) => x.text === 'fewer fields');
    const r = await consider({ item: `resp:${askId}:${resp.respId}`, go: 'send' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.entry.from, { askIds: [], ideaIds: [], items: [`resp:${askId}:${resp.respId}`] });
    assert.deepStrictEqual([r.body.entry.text, r.body.entry.asWritten, r.body.entry.considered], ['fewer fields', true, true]);
    const ask = (await state()).asks.find((a) => a.askId === askId);
    assert.strictEqual(ask.status, 'live', 'the normal flow is untouched');
    assert.strictEqual(ask.responses.length, 2);
  });
  await check('liked by N: the votes a suggestion had when it went', async () => {
    const askId = await ideasAsk('Which page first?', ['the map', 'the calendar']);
    await hostCall('POST', `asks/${askId}`, { action: 'vote' });
    const resp = (await state()).asks.find((a) => a.askId === askId).responses.find((x) => x.text === 'the map');
    await playCall('POST', 'vote', zeb, { askId, respIds: [resp.respId] });
    await playCall('POST', 'vote', qui, { askId, respIds: [resp.respId] });
    const r = await consider({ item: `resp:${askId}:${resp.respId}`, go: 'send', text: 'the map, with parking marked' });
    assert.strictEqual(r.body.entry.liked, 2);
    assert.strictEqual(r.body.entry.roomWords, 'the map');
  });
  await check('a key that names nothing, or a hidden suggestion, is refused (404) and nothing is sent', async () => {
    const before = rows('BUILD#LOG#').length;
    assert.strictEqual((await consider({ item: 'resp:001:nope', go: 'send' })).status, 404);
    assert.strictEqual((await consider({ item: 'idea:nope', go: 'send' })).status, 404);
    assert.strictEqual((await consider({ item: 'bogus', go: 'send' })).status, 404);
    assert.strictEqual(rows('BUILD#LOG#').length, before);
  });

  console.log('\nConsider an option after a vote, and a phone\'s why');
  H.seed({ players: [ZEB, QUI] });
  let askId;
  let laterEntry;
  await check('the runner-up option, for later: held on the Later list, stamped with the option', async () => {
    askId = await closedChoice('What next?', ['The pricing page', 'The sign-up flow', 'A live demo room'], ['B', 'C'], ['', `${ZEB} says a demo sells it`]);
    const r = await consider({ item: `option:${askId}:C`, go: 'later', why: 'build C as well, after B' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    laterEntry = r.body.entry;
    assert.deepStrictEqual([laterEntry.held, laterEntry.text, laterEntry.liked], [true, 'A live demo room', 1]);
    assert.deepStrictEqual(laterEntry.from.items, [`option:${askId}:C`]);
    const st = await state();
    assert.ok(st.brief.later.some((i) => i.id === laterEntry.logId), JSON.stringify(st.brief.later));
    assert.strictEqual(st.asks.find((a) => a.askId === askId).status, 'results', 'the ask is untouched');
    assert.ok(!(await inbox()).some((d) => d.id === laterEntry.logId), 'Claude hears nothing from Later');
  });
  await check('Send now from Later: the entry that carries it keeps the stamp and the why; the held one points at it', async () => {
    const r = await hostCall('POST', `brief/later/${laterEntry.logId}/send`, {});
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const e = r.body.entry;
    assert.deepStrictEqual([e.from.items, e.why, e.considered, e.held], [[`option:${askId}:C`], 'build C as well, after B', true, false]);
    assert.strictEqual(logRow(laterEntry.logId).SentAs, e.logId);
    const d = (await inbox()).find((x) => x.id === e.logId);
    assert.strictEqual(d.text, 'A live demo room\n\nWhy: build C as well, after B');
  });
  let whyKey;
  await check('a phone\'s why has an id on the host\'s results only; Consider sends it', async () => {
    const ask = (await state()).asks.find((a) => a.askId === askId);
    const w = ask.results.whys.find((x) => /demo sells it/.test(x.text));
    assert.ok(/^[0-9a-f]{12}$/.test(w.whyId), JSON.stringify(w));
    whyKey = `why:${askId}:${w.whyId}`;
    const p = (await playCall('GET', 'state', qui)).body.current;
    assert.ok(p.results.whys.every((x) => !('whyId' in x)), 'a phone never gets the id');
    const r = await consider({ item: whyKey, go: 'send', text: 'make the demo room the first thing people see' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.entry.from.items, [whyKey]);
  });
  await check('the room\'s History never carries a why\'s key, nor a name in the words it shows', async () => {
    const h = await phoneHistory(qui);
    const s = h.sent.find((x) => x.text === 'make the demo room the first thing people see');
    assert.ok(s, JSON.stringify(h.sent));
    assert.deepStrictEqual(s.from.items, [], 'the why key stays with the host');
    assert.strictEqual(s.roomWords, '', `the room's words name ${ZEB}: blanked`);
    const w = await wallBody();
    assert.ok(!JSON.stringify(w.history).includes(whyKey));
  });

  console.log('\nThe host\'s why on a decision (Send B to Claude)');
  H.seed({ players: [ZEB, QUI] });
  await check('decide with a why: on the decision, in Claude\'s inbox, in History; reworded keeps the room\'s words', async () => {
    const id = await closedChoice('Which header?', ['Bold banner', 'Calm photo'], ['B', 'B']);
    const r = await hostCall('POST', `asks/${id}`, { action: 'decide', direction: 'Which header: Calm photo, with the date on it', chosen: ['B'], why: 'the date is what people look for' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const d = r.body.ask.decision;
    assert.deepStrictEqual([d.reworded, d.why, d.roomWords], [true, 'the date is what people look for', 'Which header: Calm photo']);
    const got = (await inbox()).find((x) => x.askId === id);
    assert.strictEqual(got.text, 'Which header: Calm photo, with the date on it\n\nWhy: the date is what people look for');
    const agentAsk = (await agentCall('GET', `asks/${id}`)).body.ask;
    assert.strictEqual(agentAsk.decision.direction, 'Which header: Calm photo, with the date on it\n\nWhy: the date is what people look for');
    const ha = (await phoneHistory()).asks.find((a) => a.askId === id);
    assert.deepStrictEqual([ha.decision.why, ha.decision.roomWords], ['the date is what people look for', 'Which header: Calm photo']);
  });
  await check('a why naming someone in the room is blanked on a phone and the wall, kept for the host', async () => {
    const id = await closedChoice('Which footer?', ['Links', 'Contact'], ['A', 'A']);
    await hostCall('POST', `asks/${id}`, { action: 'decide', direction: 'Which footer: Links', chosen: ['A'], why: `${QUI} asked for it` });
    assert.strictEqual((await state()).asks.find((a) => a.askId === id).decision.why, `${QUI} asked for it`);
    const ha = (await phoneHistory()).asks.find((a) => a.askId === id);
    assert.strictEqual(ha.decision.why, '');
    const w = await wallBody();
    assert.ok(!JSON.stringify(w.history).includes(QUI), 'the wall\'s history names nobody');
  });

  console.log('\nQueue for the room');
  H.seed({ players: [ZEB, QUI] });
  await check('an idea queued for a vote is "queued", still on the host\'s list, and goes into a vote', async () => {
    const a = await sendIdea(zeb, 'a map of the parking');
    const b = await sendIdea(qui, 'a reminder text');
    const r = await consider({ item: `idea:${a.ideaId}`, go: 'queue', round: 'vote' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.idea.status, 'queued');
    assert.ok(r.body.idea.queuedAt);
    const v = await hostCall('POST', 'asks-from-ideas', { ideaIds: [a.ideaId, b.ideaId] });
    assert.strictEqual(v.status, 201, JSON.stringify(v.body));
    assert.strictEqual((await state()).ideas.find((i) => i.ideaId === a.ideaId).status, 'promoted');
  });
  await check('Yes or no: a waiting ask on the idea\'s words; the idea is in it; discarding puts it back', async () => {
    const idea = await sendIdea(zeb, 'a dark mode');
    const r = await consider({ item: `idea:${idea.ideaId}`, go: 'queue', round: 'yesno' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const ask = r.body.ask;
    assert.deepStrictEqual([ask.status, ask.kind, ask.prompt, ask.detail, ask.fromItem], ['proposed', 'choice', 'Should we do this?', '“a dark mode”', `idea:${idea.ideaId}`]);
    assert.deepStrictEqual(ask.options.map((o) => o.title), ['Yes', 'No']);
    const st = await state();
    assert.deepStrictEqual([st.ideas.find((i) => i.ideaId === idea.ideaId).status, st.ideas.find((i) => i.ideaId === idea.ideaId).promotedTo], ['promoted', ask.askId]);
    const cur = (await playCall('GET', 'state', qui)).body.current;
    assert.ok(!cur || cur.askId !== ask.askId, 'the room sees nothing until the host opens it');
    await hostCall('POST', `asks/${ask.askId}`, { action: 'discard' });
    assert.strictEqual((await state()).ideas.find((i) => i.ideaId === idea.ideaId).status, 'new');
  });
  await check('Feedback on a suggestion: a waiting Ideas ask with the host\'s question', async () => {
    const id = await ideasAsk('Anything else?', ['a FAQ']);
    const resp = (await state()).asks.find((a) => a.askId === id).responses[0];
    const r = await consider({ item: `resp:${id}:${resp.respId}`, go: 'queue', round: 'feedback', prompt: 'What should the FAQ answer first?' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.ask.kind, r.body.ask.prompt, r.body.ask.status], ['suggest', 'What should the FAQ answer first?', 'proposed']);
  });
  await check('an option queued for a vote becomes a nameless idea of the room\'s, marked with where it came from', async () => {
    const id = await closedChoice('Pick a colour', ['Green', 'Orange'], ['A', 'B']);
    const r = await consider({ item: `option:${id}:B`, go: 'queue', round: 'vote' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.idea.text, r.body.idea.status, r.body.idea.playerName, r.body.idea.source, r.body.idea.fromItem], ['Orange', 'queued', '', 'room', `option:${id}:B`]);
  });
  await check('a bad round, or an idea already used, is refused', async () => {
    const idea = await sendIdea(qui, 'confetti');
    assert.strictEqual((await consider({ item: `idea:${idea.ideaId}`, go: 'queue', round: 'party' })).status, 400);
    assert.strictEqual((await consider({ item: `idea:${idea.ideaId}`, go: 'dance' })).status, 400);
    await consider({ item: `idea:${idea.ideaId}`, go: 'send' });
    assert.strictEqual((await consider({ item: `idea:${idea.ideaId}`, go: 'queue', round: 'vote' })).status, 409);
  });
  await check('only the host considers (Claude gets 403)', async () => {
    const idea = await sendIdea(zeb, 'a footer');
    assert.strictEqual((await agentCall('POST', 'consider', { item: `idea:${idea.ideaId}`, go: 'send' })).status, 403);
  });

  console.log('\nD: the sender\'s phone hears what happened (ideas flow D)');
  H.seed({ players: [ZEB, QUI] });
  const outcomeOf = async (who, ideaId) => ((await playCall('GET', 'state', who)).body.myIdeas.find((i) => i.ideaId === ideaId) || {}).outcome;
  await check('yes/no: in the vote, the counts once closed, then what the host did and when Claude has it', async () => {
    const idea = await sendIdea(zeb, 'a help page');
    assert.strictEqual(await outcomeOf(zeb, idea.ideaId), undefined, 'with the host: nothing to say yet');
    const ask = (await consider({ item: `idea:${idea.ideaId}`, go: 'queue', round: 'yesno' })).body.ask;
    assert.strictEqual(await outcomeOf(zeb, idea.ideaId), undefined, 'a waiting ask is not news');
    await hostCall('POST', `asks/${ask.askId}`, { action: 'opennext' });
    assert.deepStrictEqual(await outcomeOf(zeb, idea.ideaId), { round: 'yesno', phase: 'open', at: (await outcomeOf(zeb, idea.ideaId)).at });
    await playCall('POST', 'respond', zeb, { askId: ask.askId, choice: ['A'] });
    await playCall('POST', 'respond', qui, { askId: ask.askId, choice: ['B'] });
    await hostCall('POST', `asks/${ask.askId}`, { action: 'my-vote', choice: ['A'] });
    await hostCall('POST', `asks/${ask.askId}`, { action: 'close' });
    const counted = await outcomeOf(zeb, idea.ideaId);
    assert.deepStrictEqual([counted.phase, counted.yes, counted.no], ['counted', 2, 1]);
    await hostCall('POST', `asks/${ask.askId}`, { action: 'decide', chosen: ['A'], direction: 'Add a help page' });
    const sent = await outcomeOf(zeb, idea.ideaId);
    assert.deepStrictEqual([sent.phase, sent.host, sent.claudeHas], ['decided', 'claude', false]);
    await inbox();
    assert.strictEqual((await outcomeOf(zeb, idea.ideaId)).claudeHas, true);
    assert.ok(!(await playCall('GET', 'state', qui)).body.myIdeas.some((i) => i.ideaId === idea.ideaId), 'another phone hears about it');
  });
  await check('a vote between ideas: the winner hears what the host did, the other that the room picked another', async () => {
    const a = await sendIdea(zeb, 'a parking map');
    const b = await sendIdea(qui, 'a reminder text');
    const v = await hostCall('POST', 'asks-from-ideas', { ideaIds: [a.ideaId, b.ideaId], open: true });
    const id = v.body.ask.askId;
    await playCall('POST', 'respond', zeb, { askId: id, choice: ['B'] });
    await playCall('POST', 'respond', qui, { askId: id, choice: ['B'] });
    await hostCall('POST', `asks/${id}`, { action: 'close' });
    await hostCall('POST', `asks/${id}`, { action: 'decide', chosen: ['B'], direction: 'Text a reminder', as: 'later' });
    const lost = await outcomeOf(zeb, a.ideaId);
    assert.deepStrictEqual([lost.round, lost.phase, lost.won, lost.host], ['vote', 'decided', false, undefined]);
    const won = await outcomeOf(qui, b.ideaId);
    assert.deepStrictEqual([won.won, won.host], [true, 'later']);
  });
  await check('sent straight to Claude: says so, and says when Claude has it', async () => {
    const idea = await sendIdea(zeb, 'bigger buttons');
    await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'direct' });
    const o = await outcomeOf(zeb, idea.ideaId);
    assert.deepStrictEqual([o.round, o.phase, o.host, o.claudeHas], ['claude', 'decided', 'claude', false]);
    await inbox();
    assert.strictEqual((await outcomeOf(zeb, idea.ideaId)).claudeHas, true);
  });

  console.log('\nNever a name on a phone or the wall');
  await check('no player name anywhere in a phone\'s history or the wall\'s, after all of the above', async () => {
    const h = JSON.stringify(await phoneHistory(qui));
    const w = JSON.stringify((await wallBody()).history);
    for (const n of [ZEB, QUI]) {
      assert.ok(!h.includes(n), `a phone's history names ${n}`);
      assert.ok(!w.includes(n), `the wall's history names ${n}`);
    }
    assert.ok(!/playerName/.test(h + w));
  });

  console.log('\nA team\'s room: the why is sealed at rest');
  H.seed({ players: [ZEB, QUI] });
  await check('Why and RoomWords are ciphertext in the table, plain through the API', async () => {
    H.row('METADATA').orgId = ORG;
    const HOST_ORG = { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG };
    const orgCall = (method, proxy, body) => H.call('build', method, proxy, { body, auth: HOST_ORG });
    await playCall('POST', 'idea', zeb, { text: 'SECRET-IDEA-WORDS-55' });
    const idea = (await orgCall('GET', 'state')).body.ideas[0];
    const r = await orgCall('POST', 'consider', { item: `idea:${idea.ideaId}`, go: 'send', text: 'SECRET-CHANGED-WORDS-55', why: 'SECRET-WHY-55' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const raw = JSON.stringify(rows('BUILD#'));
    for (const s of ['SECRET-WHY-55', 'SECRET-CHANGED-WORDS-55', 'SECRET-IDEA-WORDS-55']) assert.ok(!raw.includes(s), `${s} is plaintext at rest`);
    const e = (await orgCall('GET', 'state')).body.log.find((l) => l.logId === r.body.entry.logId);
    assert.deepStrictEqual([e.why, e.roomWords], ['SECRET-WHY-55', 'SECRET-IDEA-WORDS-55']);
  });

  const { pass, failed } = H.results();
  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
