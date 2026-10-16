/**
 * A QUESTION PUT UP AT VOTE COMES DOWN AT RESULTS (review of the 16 Oct 2026
 * batch, finding 1). Nothing cleared a stored 'question' focus when the round
 * entered RESULTS, and get-game-state hands one back in any phase, so the wall
 * showed the question while the dock and the Remote said RESULTS.
 *
 * game/question-focus.js clears it (only a question: never a response or the
 * join code), bumps the rev and tells every screen; get-results.js's
 * enterResultsState calls it before the results frame. Writes go through
 * tests/helpers/stage-table.js, which applies updates and conditions for real.
 *
 * rejects: a question focus surviving into RESULTS; the clear taking down a
 * response or the join code; a clear with no frame.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const stageTable = require('./helpers/stage-table');
const { clearQuestionFocus } = require('../lambda-functions/game/question-focus');

class UpdateCommand { constructor(i) { this.input = i; } }
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const db = { send: async (cmd) => stageTable.applyUpdate(store, key, cmd.input) };
let sent = [];
const broadcast = async (gameId, message) => { sent.push({ gameId, message }); };

let pass = 0; let fail = 0;
const check = async (label, fn) => {
  try { await fn(); pass += 1; console.log(`  ✓ ${label}`); } catch (e) { fail += 1; console.log(`  ✗ ${label}\n    ${e.message}`); }
};
const seed = (gameId, focus) => store.set(key(`GAME#${gameId}`, 'ROUND#002'), {
  PK: `GAME#${gameId}`, SK: 'ROUND#002', StageFocus: focus, StageFocusIndex: focus === 'answer' ? 1 : null, StageFocusRev: 4,
});
const clear = (gameId) => clearQuestionFocus({ db, UpdateCommand, broadcast, table: 'T', gameId, padded: '002' });

(async () => {
  console.log('question focus at RESULTS');
  seed('1', 'question');
  sent = [];
  await check('a question focus is cleared, the rev moves on, and the room is told', async () => {
    assert.strictEqual(await clear('1'), true);
    const row = store.get(key('GAME#1', 'ROUND#002'));
    assert.strictEqual(row.StageFocus, 'none');
    assert.strictEqual(row.StageFocusRev, 5);
    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(
      { type: sent[0].message.type, focus: sent[0].message.focus, rev: sent[0].message.rev, q: sent[0].message.questionNumber },
      { type: 'stageFocusChanged', focus: 'none', rev: 5, q: '002' },
    );
  });
  for (const other of ['answer', 'join', 'none']) {
    seed('2', other);
    sent = [];
    // eslint-disable-next-line no-await-in-loop
    await check(`a ${other} focus is left alone, and nothing is sent`, async () => {
      assert.strictEqual(await clear('2'), false);
      assert.strictEqual(store.get(key('GAME#2', 'ROUND#002')).StageFocus, other);
      assert.strictEqual(sent.length, 0);
    });
  }
  store.clear();
  sent = [];
  await check('a round with no row: nothing written, nothing sent, no throw', async () => {
    assert.strictEqual(await clear('3'), false);
    assert.strictEqual(store.size, 0);
    assert.strictEqual(sent.length, 0);
  });

  await check('get-results.js enters RESULTS through it, before the results frame', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lambda-functions', 'game', 'get-results.js'), 'utf8');
    const start = src.indexOf('const enterResultsState');
    const end = src.indexOf('\n};', start);
    const body = src.slice(start, end);
    const at = body.indexOf('clearQuestionFocus(');
    assert.ok(at > -1, 'enterResultsState does not clear a question focus');
    assert.ok(at < body.indexOf('broadcastResultsReady('), 'the clear must come before the results frame');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
