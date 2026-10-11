/**
 * THE PAGED FAKE CAN COUNT — tests/helpers/paged-table.js, Update.
 *
 * The usage stats (docs/design/usage-stats/SPEC.md) are counters behind
 * once-only guards, and the suites that must prove their READERS page use the
 * paged fake. So the fake has to model the counter grammar exactly, and refuse
 * anything else: an ignored clause is a passing test for a guard that does
 * nothing.
 *
 *   §1  ADD a number, ADD into a string set, if_not_exists
 *   §2  the four conditions, and that they fail as DynamoDB fails
 *   §3  an unknown clause THROWS
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const { createPagedTable, commands } = require('./helpers/paged-table');

const { UpdateCommand } = commands;
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass += 1; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}
const update = (t, input) => t.send(new UpdateCommand({ TableName: 't', ...input }));
const failsCondition = async (p) => {
  try { await p; } catch (e) { if (e.name === 'ConditionalCheckFailedException') return; throw e; }
  throw new Error('the condition did not fail');
};

(async () => {
  console.log('\npaged-table: the counter grammar\n');

  console.log('§1 ADD and if_not_exists');
  const t = createPagedTable();
  // rejects: an ADD that cannot create its row — a first counter never lands.
  await check('ADD upserts a missing row and adds numbers', async () => {
    const input = {
      Key: { PK: 'ORG#o1', SK: 'STATS#2026-10#TYPE#trivia' },
      UpdateExpression: 'ADD #c0 :n0 SET #p = :p, #first = if_not_exists(#first, :now)',
      ExpressionAttributeNames: { '#c0': 'questions', '#p': 'period', '#first': 'firstRecordedAt' },
      ExpressionAttributeValues: { ':n0': 2, ':p': '2026-10', ':now': 'A' },
    };
    await update(t, input);
    await update(t, { ...input, ExpressionAttributeValues: { ...input.ExpressionAttributeValues, ':now': 'B' } });
    const row = t.get('ORG#o1', 'STATS#2026-10#TYPE#trivia');
    assert.strictEqual(row.questions, 4);
    // rejects: if_not_exists overwriting — "counting since" would move daily.
    assert.strictEqual(row.firstRecordedAt, 'A');
  });
  // rejects: a set ADD that replaces the set, forgetting earlier asks.
  await check('ADD of a Set merges into a string set', async () => {
    t.put({ PK: 'GAME#1', SK: 'METADATA' });
    await update(t, { Key: { PK: 'GAME#1', SK: 'METADATA' }, UpdateExpression: 'ADD #s :v', ExpressionAttributeNames: { '#s': 'StatsAsks' }, ExpressionAttributeValues: { ':v': new Set(['001']) } });
    await update(t, { Key: { PK: 'GAME#1', SK: 'METADATA' }, UpdateExpression: 'ADD #s :v', ExpressionAttributeNames: { '#s': 'StatsAsks' }, ExpressionAttributeValues: { ':v': new Set(['002']) } });
    assert.deepStrictEqual([...t.get('GAME#1', 'METADATA').StatsAsks].sort(), ['001', '002']);
  });

  console.log('\n§2 the conditions');
  // rejects: a marker that can be claimed twice — a retried start counts again.
  await check('attribute_exists(PK) AND attribute_not_exists(x): first wins, second bounces', async () => {
    const input = {
      Key: { PK: 'GAME#1', SK: 'METADATA' }, UpdateExpression: 'SET #m = :t',
      ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(#m)',
      ExpressionAttributeNames: { '#m': 'StatsCreatedAt' }, ExpressionAttributeValues: { ':t': 'now' },
    };
    await update(t, input);
    await failsCondition(update(t, input));
  });
  // rejects: a guard that conjures a METADATA row for a session that has none.
  await check('attribute_exists(PK) fails on a missing row and writes nothing', async () => {
    await failsCondition(update(t, {
      Key: { PK: 'GAME#nope', SK: 'METADATA' }, UpdateExpression: 'SET #m = :t',
      ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(#m)',
      ExpressionAttributeNames: { '#m': 'X' }, ExpressionAttributeValues: { ':t': 1 },
    }));
    assert.strictEqual(t.has('GAME#nope', 'METADATA'), false);
  });
  // rejects: a ratchet that lets an equal round through — a retried round counts.
  await check('x < :n with OR, and UPDATED_OLD says whether it was the first', async () => {
    const input = (n) => ({
      Key: { PK: 'GAME#1', SK: 'METADATA' }, UpdateExpression: 'SET #r = :n',
      ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(#r) OR #r < :n)',
      ExpressionAttributeNames: { '#r': 'MetricsRoundsServed' }, ExpressionAttributeValues: { ':n': n },
      ReturnValues: 'UPDATED_OLD',
    });
    const first = await update(t, input(1));
    assert.deepStrictEqual(first, {});
    const second = await update(t, input(2));
    assert.strictEqual(second.Attributes.MetricsRoundsServed, 1);
    await failsCondition(update(t, input(2)));
  });
  // rejects: a reopened ask counted again.
  await check('NOT contains(x, :v) bounces an id already in the set', async () => {
    const input = (id) => ({
      Key: { PK: 'GAME#1', SK: 'METADATA' }, UpdateExpression: 'ADD #s :set',
      ConditionExpression: 'attribute_exists(PK) AND NOT contains(#s, :id)',
      ExpressionAttributeNames: { '#s': 'StatsDecided' }, ExpressionAttributeValues: { ':set': new Set([id]), ':id': id },
    });
    await update(t, input('004'));
    await failsCondition(update(t, input('004')));
    await update(t, input('005'));
    assert.deepStrictEqual([...t.get('GAME#1', 'METADATA').StatsDecided].sort(), ['004', '005']);
  });

  console.log('\n§3 anything else throws');
  // rejects: a fake that ignores a clause it does not understand.
  await check('an unmodelled condition clause throws', async () => {
    await assert.rejects(update(t, {
      Key: { PK: 'GAME#1', SK: 'METADATA' }, UpdateExpression: 'SET #m = :t',
      ConditionExpression: 'begins_with(#m, :t)',
      ExpressionAttributeNames: { '#m': 'X' }, ExpressionAttributeValues: { ':t': 'a' },
    }), /unsupported/);
    await assert.rejects(update(t, {
      Key: { PK: 'GAME#1', SK: 'METADATA' }, UpdateExpression: 'SET #m = :t',
      ConditionExpression: 'attribute_exists(#m)',
      ExpressionAttributeNames: { '#m': 'X' }, ExpressionAttributeValues: { ':t': 'a' },
    }), /unsupported/);
  });
  // rejects: losing the old guard — a plain SET on a missing row still throws.
  await check('a plain SET on a missing row still throws', async () => {
    await assert.rejects(update(t, {
      Key: { PK: 'GAME#none', SK: 'X' }, UpdateExpression: 'SET a = :v', ExpressionAttributeValues: { ':v': 1 },
    }), /missing row/);
  });

  suiteFinished();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
