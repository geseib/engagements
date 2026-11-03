/**
 * BUILD ROOM — ENGAGE'S OWN PROMPTS NEVER REACH THE ROOM AS PROMPTS (QA walk on
 * test, 31 Oct 2026). Start building pressed before Claude Code connected put
 * "The room has framed the build. Plan 3 to 6 steps, post the plan with
 * post_update (kind "milestone")… THE ROOM BRIEF…" on every phone, on the
 * Stage and in the host's Claude now: openingAction 'start' wrote it as an
 * ordinary direction, and sentView handed its words to every reader.
 *
 * Every prompt Engage writes for Claude now carries a key (`EngagePrompt`):
 *   - Claude's inbox gets the words exactly as before;
 *   - the host's read keeps the words and says the key (the page shows the
 *     plain line, buildScreens plainPromptLine);
 *   - a phone's and the wall's `sent` carry the key and no words;
 *   - a prompt sent hidden (Don't show the room) stays hidden: no key, no words.
 * The page's own one-press prompts name their key in the body; anything else
 * is a 400 and nothing is written.
 *
 * Expectations are written by hand, never read back off the handler's output.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const H = require('./helpers/build-wall-harness');

const {
  check, hostCall, agentCall, playCall, wallCall, seat, store, PK,
} = H;
const S = require('../lambda-functions/game/build-store');

const zeb = seat('Zebulon');

const state = async () => (await hostCall('GET', 'state')).body;
const rows = (prefix) => [...store.values()].filter((r) => r.PK === PK && String(r.SK).startsWith(prefix));
const inbox = async () => (await agentCall('GET', 'inbox')).body.inbox || [];
const phone = async () => (await playCall('GET', 'state', zeb)).body;
const wall = async () => {
  const r = await wallCall((await state()).wallKey);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const absent = (body, words) => assert.ok(!JSON.stringify(body).includes(words), `"${words}" reached a room read`);

(async () => {
  console.log('\nStart building before Claude connects (the QA walk\'s screens 121-123)');
  H.seed({ players: ['Zebulon'] });
  await check('the keys are the six prompts the page and the server write', () => {
    assert.deepStrictEqual([...S.ENGAGE_PROMPTS].sort(), ['back-to-opening', 'draft-brief', 'mockups', 'preview', 'start-building', 'wrap-up']);
  });
  await check('Claude still gets the whole prompt, brief and all', async () => {
    const r = await hostCall('POST', 'opening/start', {});
    assert.ok(r.status < 300, JSON.stringify(r.body));
    const got = (await inbox()).find((x) => /^The room has framed the build\./.test(x.text));
    assert.ok(got, 'the start prompt is in the inbox');
    assert.ok(/post_update \(kind "milestone"\)/.test(got.text), got.text);
    const row = rows('BUILD#LOG#').find((x) => x.Kind === 'direction' && /^The room has framed/.test(x.Text));
    assert.strictEqual(row.EngagePrompt, 'start-building');
  });
  H.seed({ players: ['Zebulon'] });
  await check('a phone and the wall get the key and no words; the host keeps the words with the key', async () => {
    await hostCall('POST', 'opening/start', {});
    const p = (await phone()).sent;
    assert.deepStrictEqual([p.text, p.engagePrompt, p.hidden, p.queued], ['', 'start-building', undefined, true]);
    absent(await phone(), 'post_update');
    absent(await phone(), 'framed the build. Plan');
    const w = (await wall()).sent;
    assert.deepStrictEqual([w.text, w.engagePrompt], ['', 'start-building']);
    absent(await wall(), 'post_update');
    const h = (await state()).sent;
    assert.strictEqual(h.engagePrompt, 'start-building');
    assert.ok(/^The room has framed the build\./.test(h.text), h.text);
    const e = (await state()).log.find((l) => l.kind === 'direction' && l.engagePrompt === 'start-building');
    assert.ok(e, 'the host\'s log entry names its key');
  });
  await check('Back to the opening is keyed the same way', async () => {
    await hostCall('POST', 'opening/resume', {});
    assert.deepStrictEqual([(await phone()).sent.text, (await phone()).sent.engagePrompt], ['', 'back-to-opening']);
    absent(await wall(), 'wait_for_direction');
  });
  await check('a row written before the key (an old session) is still known by its words', async () => {
    const row = rows('BUILD#LOG#').find((x) => x.EngagePrompt === 'back-to-opening');
    delete row.EngagePrompt;
    assert.deepStrictEqual([(await phone()).sent.text, (await phone()).sent.engagePrompt], ['', 'back-to-opening']);
  });

  console.log('\nThe page\'s one-press prompts name their key');
  H.seed({ players: ['Zebulon'] });
  await check('Preview the work, sent plain: the room reads the key, never the words', async () => {
    const r = await hostCall('POST', 'directions', { text: 'Show the room the work so far, running. Start it.', engagePrompt: 'preview' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.entry.engagePrompt, 'preview');
    assert.deepStrictEqual([(await phone()).sent.text, (await phone()).sent.engagePrompt], ['', 'preview']);
    assert.strictEqual((await inbox()).pop().text, 'Show the room the work so far, running. Start it.');
  });
  await check('a hidden wrap-up stays hidden: no key and no words for the room', async () => {
    await hostCall('POST', 'directions', { text: 'We are wrapping up. Call room_status, then wrap_up.', engagePrompt: 'wrap-up', hideFromRoom: true });
    const p = (await phone()).sent;
    assert.deepStrictEqual([p.text, p.hidden, p.engagePrompt], ['', true, undefined]);
    const h = (await state()).sent;
    assert.deepStrictEqual([h.engagePrompt, h.hidden], ['wrap-up', true]);
  });
  await check('an unknown key is a 400 and nothing is written', async () => {
    const before = rows('BUILD#LOG#').length;
    for (const v of ['start', 'Wrap-up', 7, true]) {
      const r = await hostCall('POST', 'directions', { text: 'x', engagePrompt: v });
      assert.strictEqual(r.status, 400, `${JSON.stringify(v)}: ${JSON.stringify(r.body)}`);
    }
    assert.strictEqual(rows('BUILD#LOG#').length, before);
  });
  await check('a direction the host wrote has no key', async () => {
    await hostCall('POST', 'directions', { text: 'Make the footer sticky' });
    const p = (await phone()).sent;
    assert.deepStrictEqual([p.text, p.engagePrompt], ['Make the footer sticky', undefined]);
  });

  const { pass, failed } = H.results();
  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
