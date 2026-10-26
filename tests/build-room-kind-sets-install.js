/**
 * THE BUILD ROOM'S SETS PER KIND, INSTALLED ONCE (owner, 24 Oct 2026: one set
 * per kind holding Ideas, Choose, Yes/No and Rate). scripts/install-build-room-kind-sets.sh
 * installs sets/build-room-<kind>.csv as one Poll set and switches off the two
 * it replaces (scripts/retire-question-sets.js), so a tier that had the old
 * pair does not list both.
 *
 * rejects: a dry run that writes; a retire that deletes, or touches an org's
 * sets; the old ids drifting from the titles they were installed under; a
 * re-run that fails on the set it already installed; a pulse file left behind.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { retireSets, LIBRARY_PK } = require('../scripts/retire-question-sets');

const REPO = path.join(__dirname, '..');
let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); } catch (e) { failed += 1; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

/** A document client over a Map, recording every command it is sent. */
function fakeDb(rows) {
  const sent = [];
  return {
    sent,
    async send(cmd) {
      const type = cmd.constructor.name;
      sent.push({ type, input: cmd.input });
      const k = `${cmd.input.Key.PK}|${cmd.input.Key.SK}`;
      if (type === 'GetCommand') return { Item: rows.get(k) };
      if (type === 'UpdateCommand') { rows.set(k, { ...rows.get(k), active: false }); return {}; }
      throw new Error(`unexpected ${type}`);
    },
  };
}
const seed = () => new Map([
  ['SETS|SET#buildroomgamequestions', { name: 'Build Room: Game questions', engagementType: 'call-and-answer', questionCount: 14, active: true }],
  ['SETS|SET#buildroomgamepulse', { name: 'Build Room: Game pulse', engagementType: 'poll', questionCount: 3, active: false }],
]);
const IDS = ['buildroomgamequestions', 'buildroomgamepulse', 'buildroomgamenever'];
const SCRIPT = fs.readFileSync(path.join(REPO, 'scripts', 'install-build-room-kind-sets.sh'), 'utf8');

(async () => {
  console.log('retire-question-sets.js');
  await check('a dry run reads each set and says what it would do, and writes nothing', async () => {
    const db = fakeDb(seed());
    const out = await retireSets(db, 'engagetest', IDS);
    assert.deepStrictEqual(out.lines, [
      '  buildroomgamequestions: "Build Room: Game questions" (call-and-answer, 14 questions) WOULD BE SWITCHED OFF',
      '  buildroomgamepulse: "Build Room: Game pulse" (poll, 3 questions) is already switched off',
      '  buildroomgamenever: not on this table, nothing to retire',
    ]);
    assert.deepStrictEqual(db.sent.map((c) => c.type), ['GetCommand', 'GetCommand', 'GetCommand']);
  });
  await check('--apply switches off only the active one, in the Engage library, and only if it exists; never a delete', async () => {
    const rows = seed();
    const db = fakeDb(rows);
    const out = await retireSets(db, 'engagetest', IDS, { apply: true, now: new Date('2026-10-24T12:00:00Z') });
    const writes = db.sent.filter((c) => c.type !== 'GetCommand');
    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(writes[0].input.Key, { PK: LIBRARY_PK, SK: 'SET#buildroomgamequestions' });
    assert.strictEqual(LIBRARY_PK, 'SETS');
    assert.strictEqual(writes[0].input.ConditionExpression, 'attribute_exists(PK)');
    assert.deepStrictEqual(writes[0].input.ExpressionAttributeValues, { ':off': false, ':at': '2026-10-24T12:00:00.000Z' });
    assert.strictEqual(rows.get('SETS|SET#buildroomgamequestions').active, false);
    assert.ok(out.lines[0].endsWith('switched off') && !out.failed);
  });

  console.log('\ninstall-build-room-kind-sets.sh');
  await check('installs one Poll set per kind, re-runnable, then retires the old pair', () => {
    assert.ok(/--type poll --title "Build Room: \$TITLE"/.test(SCRIPT), 'one Poll set, titled Build Room: <Kind>');
    assert.ok(/--skip-existing/.test(SCRIPT), 'a re-run would refuse the set it installed');
    assert.ok(SCRIPT.indexOf('node scripts/install-question-set.js') < SCRIPT.indexOf('node scripts/retire-question-sets.js'), 'retires before the new set is on the table');
    assert.ok(/--tags "build-room,for-\$KIND"/.test(SCRIPT));
  });
  await check('the old ids are the ids install-question-set.js gave the old titles', () => {
    const idOf = (title) => title.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [kind, title] of [['training', 'Training'], ['game', 'Game'], ['document', 'Document'], ['dashboard', 'Dashboard']]) {
      const old = SCRIPT.match(/OLD="([^"]+)"/)[1].replace(/\$\{KIND\}/g, kind).split(' ');
      assert.deepStrictEqual(old, [idOf(`Build Room: ${title} questions`), idOf(`Build Room: ${title} pulse`)]);
    }
  });
  await check('each kind has one file, and no pulse file is left to install by hand', () => {
    for (const kind of ['training', 'game', 'document', 'dashboard']) {
      assert.ok(fs.existsSync(path.join(REPO, 'sets', `build-room-${kind}.csv`)), kind);
      assert.ok(!fs.existsSync(path.join(REPO, 'sets', `build-room-${kind}-pulse.csv`)), `${kind} pulse`);
      assert.ok(/^Category,Question#,Title,Detail_lesson,School,CustomInstruction,Kind,/.test(fs.readFileSync(path.join(REPO, 'sets', `build-room-${kind}.csv`), 'utf8')), `${kind} is not a poll file`);
    }
  });

  suiteFinished();
  console.log(failed ? `\n${failed} failed` : '\nall passed, 0 failed');
  process.exit(failed ? 1 : 0);
})();
