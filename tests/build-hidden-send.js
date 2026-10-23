/**
 * BUILD ROOM — SENT TO CLAUDE, AND "DON'T SHOW THE ROOM" (owner, 23 Oct 2026:
 * "nobody can see what Claude was actually told").
 *
 * Every host send takes `hideFromRoom` (a boolean; anything else is a 400).
 * Ticked, the entry is stored with `RoomHidden: true` and:
 *   - Claude's inbox gets the words exactly as before;
 *   - the host's read keeps the words, marked `hidden: true`;
 *   - a phone's read, the wall's read and the room's History carry the entry
 *     with no words (`text: ''`, no why) and `hidden: true`;
 *   - a hidden decision keeps the room's pick but not the direction.
 * Unticked, phones now get `sent` too (the Sent to Claude card), with the
 * room's pick a decision came from.
 *
 * Expectations are written by hand, never read back off the handler's output.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const H = require('./helpers/build-wall-harness');

const {
  check, hostCall, agentCall, playCall, wallCall, seat, store, PK,
} = H;

const ZEB = 'Zebulon';
const QUI = 'Quintessa';
const zeb = seat(ZEB);
const qui = seat(QUI);

const state = async () => (await hostCall('GET', 'state')).body;
const rows = (prefix) => [...store.values()].filter((r) => r.PK === PK && String(r.SK).startsWith(prefix));
const logRow = (logId) => rows('BUILD#LOG#').find((r) => r.LogId === logId);
const inbox = async () => (await agentCall('GET', 'inbox')).body.inbox || [];
const phone = async (who = zeb) => (await playCall('GET', 'state', who)).body;
const wall = async () => {
  const r = await wallCall((await state()).wallKey);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
/** The words appear nowhere in what this reader got. */
const absent = (body, words) => assert.ok(!JSON.stringify(body).includes(words), `"${words}" reached a room read`);

/** A Choose ask both phones answered B, closed: the results are up. */
async function closedChoice(prompt) {
  const ask = (await hostCall('POST', 'asks', { kind: 'choice', prompt, options: [{ title: 'Bold banner' }, { title: 'Calm photo' }] })).body.ask;
  await hostCall('POST', `asks/${ask.askId}`, { action: 'open' });
  await playCall('POST', 'respond', zeb, { askId: ask.askId, choice: ['B'] });
  await playCall('POST', 'respond', qui, { askId: ask.askId, choice: ['B'] });
  await hostCall('POST', `asks/${ask.askId}`, { action: 'close' });
  return ask.askId;
}

(async () => {
  console.log('\nA shared send: the Sent to Claude card on every screen, with the room\'s pick');
  H.seed({ players: [ZEB, QUI] });
  let askId;
  await check('a decided ask the room sees: phones and the wall get the words and the pick', async () => {
    askId = await closedChoice('Which header?');
    const r = await hostCall('POST', `asks/${askId}`, { action: 'decide', chosen: ['B'], direction: 'Go with the calm photo header', method: 'vote' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const want = { method: 'vote', items: [{ label: 'B', title: 'Calm photo' }] };
    const p = (await phone()).sent;
    assert.deepStrictEqual([p.verb, p.text, p.askId, p.hidden, p.pick], ['decided', 'Go with the calm photo header', askId, undefined, want]);
    const w = (await wall()).sent;
    assert.deepStrictEqual([w.text, w.hidden, w.pick], ['Go with the calm photo header', undefined, want]);
    const h = (await state()).sent;
    assert.deepStrictEqual([h.text, h.hidden, h.pick], ['Go with the calm photo header', undefined, want]);
    assert.strictEqual(rows('BUILD#LOG#').find((x) => x.Kind === 'decision').RoomHidden, undefined);
  });
  await check('a plain direction reaches a phone\'s card too', async () => {
    const r = await hostCall('POST', 'directions', { text: 'Make the footer sticky' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const p = (await phone()).sent;
    assert.deepStrictEqual([p.verb, p.text, p.pick], ['told', 'Make the footer sticky', undefined]);
  });

  console.log('\nDon\'t show the room: a direction');
  H.seed({ players: [ZEB, QUI] });
  let dirId;
  await check('the flag is stored; Claude gets the words exactly', async () => {
    const r = await hostCall('POST', 'directions', { text: 'SECRET-DIR-71 rename the pricing tiers', hideFromRoom: true });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    dirId = r.body.entry.logId;
    assert.strictEqual(logRow(dirId).RoomHidden, true);
    assert.strictEqual(logRow(dirId).Text, 'SECRET-DIR-71 rename the pricing tiers');
    const got = (await inbox()).find((x) => x.id === dirId);
    assert.strictEqual(got.text, 'SECRET-DIR-71 rename the pricing tiers');
  });
  await check('the host\'s read keeps the words, marked hidden', async () => {
    const s = await state();
    assert.deepStrictEqual([s.sent.text, s.sent.hidden], ['SECRET-DIR-71 rename the pricing tiers', true]);
    const e = s.log.find((l) => l.logId === dirId);
    assert.deepStrictEqual([e.text, e.hidden], ['SECRET-DIR-71 rename the pricing tiers', true]);
  });
  await check('a phone gets "something went", hidden, with no words', async () => {
    const p = await phone();
    assert.deepStrictEqual([p.sent.verb, p.sent.text, p.sent.hidden, p.sent.pick], ['told', '', true, undefined]);
    absent(p, 'SECRET-DIR-71');
  });
  await check('the wall gets the same, and no words anywhere', async () => {
    const w = await wall();
    assert.deepStrictEqual([w.sent.text, w.sent.hidden], ['', true]);
    absent(w, 'SECRET-DIR-71');
  });

  console.log('\nDon\'t show the room: a decision, its why, and its pick');
  H.seed({ players: [ZEB, QUI] });
  await check('the room keeps its pick; the direction and the why stay the host\'s', async () => {
    const id = await closedChoice('Which header?');
    const r = await hostCall('POST', `asks/${id}`, {
      action: 'decide', chosen: ['B'], direction: 'SECRET-DEC-72 calm photo, darker overlay', why: 'SECRET-WHY-72', method: 'vote', hideFromRoom: true,
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const entry = rows('BUILD#LOG#').find((x) => x.Kind === 'decision');
    assert.deepStrictEqual([entry.RoomHidden, entry.ForAgent], [true, true]);
    const askRow = rows('BUILD#ASK#').find((x) => x.AskId === id);
    assert.strictEqual(askRow.Decision.roomHidden, true);
    // The host's own copy: the words, the why, the mark.
    const hostAsk = (await state()).asks.find((a) => a.askId === id);
    assert.deepStrictEqual([hostAsk.decision.direction, hostAsk.decision.why, hostAsk.decision.hidden], ['SECRET-DEC-72 calm photo, darker overlay', 'SECRET-WHY-72', true]);
    // Claude: the words and the why, as before.
    const got = (await inbox()).find((x) => x.askId === id);
    assert.ok(got.text.startsWith('SECRET-DEC-72 calm photo, darker overlay'), got.text);
    assert.ok(got.text.includes('Why: SECRET-WHY-72'), got.text);
    // A phone: the pick stays, the words go everywhere (current, decisions, history, log, sent).
    const p = await phone();
    assert.deepStrictEqual([p.current.decision.direction, p.current.decision.hidden, p.current.decision.chosen], ['', true, ['B']]);
    assert.deepStrictEqual(p.decisions.map((d) => [d.direction, d.hidden]), [['', true]]);
    const pa = p.history.asks.find((a) => a.askId === id);
    assert.deepStrictEqual([pa.decision.direction, pa.decision.why || '', pa.decision.hidden], ['', '', true]);
    assert.deepStrictEqual([p.sent.text, p.sent.hidden, p.sent.pick], ['', true, undefined]);
    const pl = p.log.find((l) => l.kind === 'decision');
    assert.deepStrictEqual([pl.text, pl.hidden], ['', true]);
    absent(p, 'SECRET-DEC-72');
    absent(p, 'SECRET-WHY-72');
    const w = await wall();
    assert.deepStrictEqual([w.sent.text, w.sent.hidden], ['', true]);
    absent(w, 'SECRET-DEC-72');
    absent(w, 'SECRET-WHY-72');
  });
  await check('recording a decision without sending it never marks it hidden', async () => {
    const id = await closedChoice('Which footer?');
    await hostCall('POST', `asks/${id}`, { action: 'decide', chosen: ['A'], direction: 'Bold footer', sendToAgent: false, hideFromRoom: true });
    assert.strictEqual(rows('BUILD#ASK#').find((x) => x.AskId === id).Decision.roomHidden, undefined);
  });

  console.log('\nDon\'t show the room: Consider, an idea sent as written, Later, the log');
  H.seed({ players: [ZEB, QUI] });
  await check('Consider\'s Send to Claude: History marks it with no words and no why', async () => {
    await playCall('POST', 'idea', zeb, { text: 'SECRET-IDEA-73 a dark mode' });
    const idea = (await state()).ideas[0];
    const r = await hostCall('POST', 'consider', { item: `idea:${idea.ideaId}`, go: 'send', text: 'SECRET-GOT-73 dark mode, toggle in the header', why: 'SECRET-WHY-73', hideFromRoom: true });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(logRow(r.body.entry.logId).RoomHidden, true);
    const s = (await phone(qui)).history.sent.find((x) => x.entryId === r.body.entry.logId);
    assert.deepStrictEqual([s.text, s.why, s.roomWords, s.hidden], ['', '', '', true]);
    const w = (await wall()).history.sent.find((x) => x.entryId === r.body.entry.logId);
    assert.deepStrictEqual([w.text, w.why, w.hidden], ['', '', true]);
    absent(await wall(), 'SECRET-GOT-73');
    absent(await wall(), 'SECRET-WHY-73');
  });
  await check('an idea sent as written: the entry is hidden', async () => {
    await playCall('POST', 'idea', qui, { text: 'bigger buttons' });
    const idea = (await state()).ideas.find((i) => i.text === 'bigger buttons');
    const r = await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'direct', hideFromRoom: true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const e = rows('BUILD#LOG#').find((x) => x.Kind === 'idea' && x.IdeaId === idea.ideaId);
    assert.strictEqual(e.RoomHidden, true);
    const p = (await phone()).sent;
    assert.deepStrictEqual([p.text, p.hidden], ['', true]);
  });
  await check('Send now from the Later list takes the flag; the held entry\'s own flag carries over', async () => {
    const held = await hostCall('POST', 'directions', { text: 'SECRET-LATER-74 an export button', as: 'later', hideFromRoom: true });
    assert.strictEqual(held.status, 201, JSON.stringify(held.body));
    const r = await hostCall('POST', `brief/later/${held.body.entry.logId}/send`, {});
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(logRow(r.body.entry.logId).RoomHidden, true);
    const plain = await hostCall('POST', 'directions', { text: 'a print view', as: 'later' });
    const r2 = await hostCall('POST', `brief/later/${plain.body.entry.logId}/send`, { hideFromRoom: true });
    assert.strictEqual(logRow(r2.body.entry.logId).RoomHidden, true);
    absent(await wall(), 'SECRET-LATER-74');
  });
  await check('the log\'s "Also tell Claude" takes the flag; a note never carries it', async () => {
    const r = await hostCall('POST', 'log', { kind: 'verbal', text: 'SECRET-SAID-75 we want it faster', forAgent: true, hideFromRoom: true });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(logRow(r.body.entry.logId).RoomHidden, true);
    absent(await phone(), 'SECRET-SAID-75');
    const n = await hostCall('POST', 'log', { kind: 'note', text: 'just a note', hideFromRoom: true });
    assert.strictEqual(logRow(n.body.entry.logId).RoomHidden, undefined);
  });

  console.log('\nThe flag is validated like any other body field');
  H.seed({ players: [ZEB, QUI] });
  await check('anything but true or false is a 400, and nothing is written', async () => {
    const before = rows('BUILD#LOG#').length;
    for (const [path, body] of [
      ['directions', { text: 'x', hideFromRoom: 'yes' }],
      ['log', { kind: 'verbal', text: 'x', forAgent: true, hideFromRoom: 1 }],
      ['consider', { item: 'idea:nope', go: 'send', hideFromRoom: 'true' }],
    ]) {
      const r = await hostCall('POST', path, body);
      assert.strictEqual(r.status, path === 'consider' ? 404 : 400, `${path}: ${JSON.stringify(r.body)}`);
      if (r.status === 400) assert.strictEqual(r.body.error, 'hideFromRoom must be true or false');
    }
    const id = await closedChoice('Which?');
    const d = await hostCall('POST', `asks/${id}`, { action: 'decide', chosen: ['B'], direction: 'B', hideFromRoom: 'on' });
    assert.deepStrictEqual([d.status, d.body.error], [400, 'hideFromRoom must be true or false']);
    await playCall('POST', 'idea', zeb, { text: 'an idea' });
    const idea = (await state()).ideas[0];
    const i = await hostCall('POST', `ideas/${idea.ideaId}`, { action: 'direct', hideFromRoom: {} });
    assert.strictEqual(i.status, 400);
    const c = await hostCall('POST', 'consider', { item: `idea:${idea.ideaId}`, go: 'send', hideFromRoom: 'true' });
    assert.strictEqual(c.status, 400);
    assert.strictEqual(rows('BUILD#LOG#').filter((x) => x.ForAgent).length, 0);
    assert.ok(rows('BUILD#LOG#').length >= before);
  });

  const { pass, failed } = H.results();
  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
