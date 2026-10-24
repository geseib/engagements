/**
 * scripts/delete-question-sets.js: deleting the Build Room's old, switched-off
 * sets (owner, 24 Oct 2026: "old build room sets, then yes").
 *
 * Against an in-memory table: a dry run removes nothing and counts every row;
 * --apply removes the content partitions and the index row; it refuses a set
 * that is still on, one a live session names, and anything outside the Engage
 * library. Expectations are written by hand.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const { deleteSets } = require('../scripts/delete-question-sets');

let pass = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log(`  PASS  ${name}`); } catch (e) { failed += 1; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

const NOW = 2000000000;
function table() {
  const rows = new Map();
  const put = (r) => rows.set(`${r.PK}|${r.SK}`, r);
  put({ PK: 'SETS', SK: 'SET#oldgame', name: 'Build Room: Game questions', engagementType: 'call-and-answer', questionCount: 2, active: false, activeVersion: 1 });
  put({ PK: 'SET#oldgame#v1', SK: 'QUESTION#c001#001' });
  put({ PK: 'SET#oldgame#v1', SK: 'QUESTION#c001#002' });
  put({ PK: 'SET#oldgame#v1', SK: 'CATEGORY#c001' });
  put({ PK: 'SETS', SK: 'SET#stillon', name: 'Still on', active: true });
  put({ PK: 'SET#stillon#v1', SK: 'QUESTION#c001#001' });
  put({ PK: 'SETS', SK: 'SET#used', name: 'Used', active: false });
  put({ PK: 'SET#used#v1', SK: 'QUESTION#c001#001' });
  put({ PK: 'GAME#4821', SK: 'METADATA', QuestionSetId: 'used', ttl: NOW + 100 });
  put({ PK: 'GAME#4000', SK: 'METADATA', QuestionSetId: 'oldgame', ttl: NOW - 100 }); // expired: does not hold it
  put({ PK: 'ORG#org_X#SETS', SK: 'SET#teamset', name: 'A team set', active: false });
  const db = {
    send: async (cmd) => {
      const i = cmd.input;
      switch (cmd.constructor.name) {
        case 'GetCommand': return { Item: rows.get(`${i.Key.PK}|${i.Key.SK}`) };
        case 'ScanCommand': return { Items: [...rows.values()].filter((r) => r.SK === 'METADATA' && r.QuestionSetId) };
        case 'QueryCommand': {
          const pk = i.ExpressionAttributeValues[':pk'] || Object.values(i.ExpressionAttributeValues)[0];
          return { Items: [...rows.values()].filter((r) => r.PK === pk).map((r) => ({ PK: r.PK, SK: r.SK })) };
        }
        case 'BatchWriteCommand': {
          for (const reqs of Object.values(i.RequestItems)) for (const q of reqs) rows.delete(`${q.DeleteRequest.Key.PK}|${q.DeleteRequest.Key.SK}`);
          return { UnprocessedItems: {} };
        }
        case 'DeleteCommand': rows.delete(`${i.Key.PK}|${i.Key.SK}`); return {};
        default: throw new Error(`unexpected ${cmd.constructor.name}`);
      }
    },
  };
  return { rows, db };
}

(async () => {
  console.log('delete-question-sets.js');

  await check('a dry run counts every row and removes nothing', async () => {
    const { rows, db } = table();
    const before = rows.size;
    const out = await deleteSets(db, 'T', ['oldgame'], { now: NOW });
    assert.deepStrictEqual(out.lines, ['  oldgame: "Build Room: Game questions" (call-and-answer, 2 questions) WOULD BE DELETED: 4 row(s)']);
    assert.strictEqual(out.failed, false);
    assert.strictEqual(rows.size, before);
  });

  await check('--apply removes the content rows and the index row; an expired session does not hold it', async () => {
    const { rows, db } = table();
    const out = await deleteSets(db, 'T', ['oldgame'], { apply: true, now: NOW });
    assert.ok(/oldgame: "Build Room: Game questions" deleted/.test(out.lines[0]), out.lines[0]);
    assert.ok(![...rows.keys()].some((k) => k.includes('oldgame')), [...rows.keys()].join(' '));
    assert.ok(rows.has('SETS|SET#stillon') && rows.has('SET#used#v1|QUESTION#c001#001'), 'touched another set');
  });

  await check('refuses a set still switched on, one a live session names, and says so', async () => {
    const { rows, db } = table();
    const out = await deleteSets(db, 'T', ['stillon', 'used'], { apply: true, now: NOW });
    assert.strictEqual(out.failed, true);
    assert.ok(/stillon: "Still on" is still switched on; REFUSED/.test(out.lines[0]), out.lines[0]);
    assert.ok(/used: "Used" is named by live session\(s\) 4821; REFUSED/.test(out.lines[1]), out.lines[1]);
    assert.ok(rows.has('SETS|SET#stillon') && rows.has('SETS|SET#used'));
  });

  await check('never an organisation\'s set: only the Engage library is read', async () => {
    const { rows, db } = table();
    const out = await deleteSets(db, 'T', ['teamset'], { apply: true, now: NOW });
    assert.deepStrictEqual(out.lines, ['  teamset: not on this table, nothing to delete']);
    assert.ok(rows.has('ORG#org_X#SETS|SET#teamset'));
  });

  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
