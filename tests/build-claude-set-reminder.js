/**
 * #45 — CLAUDE'S UNSAVED QUESTION SET, REMINDED BEFORE IT GOES.
 *
 * A Build Room's set from Claude lives as long as its session (7 days from
 * the start) unless the host saves it. The Build Room writes a quiet bell
 * entry when the set arrives (tests/build-points.js); this holds the rest:
 * when that entry turns into a reminder, that drafts keep their own window,
 * and that the inbox writer's two copies (admin/shared, game) stay identical.
 * Expectations are written by hand.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
process.env.TABLE_NAME = 'T';
const N = require(path.join(REPO, 'lambda-functions/admin/shared/notifications.js'));

let pass = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log(`  PASS  ${name}`); } catch (e) { failed += 1; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

const DAY = 24 * 60 * 60;
const NOW = new Date('2026-10-23T12:00:00Z');
const T = Math.floor(NOW.getTime() / 1000);

/** One inbox: Query returns its rows, Update is applied, Put stored. */
function inbox(rows) {
  const store = new Map(rows.map((r) => [r.SK, { PK: 'USER#user-1#NOTIFY', ...r }]));
  return {
    store,
    send: async (cmd) => {
      const name = cmd.constructor.name;
      if (name === 'QueryCommand') return { Items: [...store.values()] };
      if (name === 'PutCommand') { store.set(cmd.input.Item.SK, cmd.input.Item); return {}; }
      if (name === 'UpdateCommand') {
        const cur = store.get(cmd.input.Key.SK);
        const v = cmd.input.ExpressionAttributeValues;
        store.set(cmd.input.Key.SK, { ...cur, remindedAt: v[':now'], read: v[':f'], updatedAt: v[':now'] });
        return {};
      }
      throw new Error(`unexpected ${name}`);
    },
  };
}
const row = (kind, left, extra = {}) => ({
  SK: `NOTE#${kind === N.KINDS.CLAUDE_SET_UNSAVED ? 'claudeset#4821-x' : 'draft#d1'}`,
  key: kind === N.KINDS.CLAUDE_SET_UNSAVED ? 'claudeset#4821-x' : 'draft#d1',
  kind, read: true, title: 't', body: '', orgId: '', link: null,
  createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
  expiresAt: T + left, ttl: T + left, ...extra,
});

(async () => {
  console.log('Claude\'s unsaved question set (#45)');

  await check('the two copies of notifications.js are identical', () => {
    const a = fs.readFileSync(path.join(REPO, 'lambda-functions/admin/shared/notifications.js'), 'utf8');
    const b = fs.readFileSync(path.join(REPO, 'lambda-functions/game/notifications.js'), 'utf8');
    assert.ok(a === b, 'lambda-functions/game/notifications.js differs from admin/shared: copy it again');
  });

  await check('the windows: a Claude set two days before its session ends; a draft five; anything else never', () => {
    assert.strictEqual(N.remindDaysFor(N.KINDS.CLAUDE_SET_UNSAVED), 2);
    assert.strictEqual(N.remindDaysFor(N.KINDS.DRAFT_READY), 5);
    assert.strictEqual(N.remindDaysFor(N.KINDS.DRAFT_PARTIAL), 5);
    assert.strictEqual(N.remindDaysFor(N.KINDS.DRAFT_FAILED), 0);
  });

  await check('written quiet: listed as read, not counted', async () => {
    const db = inbox([]);
    assert.strictEqual(await N.notify(db, {
      sub: 'user-1', key: 'claudeset#4821-x', kind: N.KINDS.CLAUDE_SET_UNSAVED, title: 'Claude\'s question set is not saved: X',
      link: { type: 'build', gameId: '4821', setId: 'x' }, expiresAt: T + 7 * DAY, quiet: true,
    }, { now: NOW }), true);
    const [item] = await N.listFor(db, 'user-1', { now: NOW });
    assert.strictEqual(item.read, true);
    assert.strictEqual(item.reminder, false);
    assert.strictEqual(item.daysLeft, 7);
  });

  await check('three days out it stays quiet; inside two days it turns unread, once, and says how long is left', async () => {
    let db = inbox([row(N.KINDS.CLAUDE_SET_UNSAVED, 3 * DAY)]);
    let [item] = await N.listFor(db, 'user-1', { now: NOW });
    assert.deepStrictEqual([item.read, item.reminder], [true, false]);

    db = inbox([row(N.KINDS.CLAUDE_SET_UNSAVED, 2 * DAY - 60)]);
    [item] = await N.listFor(db, 'user-1', { now: NOW });
    assert.deepStrictEqual([item.read, item.reminder, item.daysLeft], [false, true, 2]);

    // Read after the reminder: it stays read; the reminder is not re-armed.
    const stored = db.store.get('NOTE#claudeset#4821-x');
    db.store.set(stored.SK, { ...stored, read: true });
    [item] = await N.listFor(db, 'user-1', { now: NOW });
    assert.deepStrictEqual([item.read, item.reminder], [true, true]);
  });

  await check('a draft still reminds at five days, and a Claude set at four days does not', async () => {
    const db = inbox([row(N.KINDS.DRAFT_READY, 4 * DAY), row(N.KINDS.CLAUDE_SET_UNSAVED, 4 * DAY)]);
    const items = await N.listFor(db, 'user-1', { now: NOW });
    const by = Object.fromEntries(items.map((i) => [i.kind, i]));
    assert.strictEqual(by[N.KINDS.DRAFT_READY].reminder, true);
    assert.strictEqual(by[N.KINDS.CLAUDE_SET_UNSAVED].reminder, false);
  });

  await check('gone with the session: an entry past its ttl is not listed', async () => {
    const db = inbox([row(N.KINDS.CLAUDE_SET_UNSAVED, -60)]);
    assert.deepStrictEqual(await N.listFor(db, 'user-1', { now: NOW }), []);
  });

  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
