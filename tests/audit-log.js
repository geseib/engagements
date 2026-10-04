/**
 * THE AUDIT LOG'S WRITER — lambda-functions/{admin/shared,game,websocket}/
 * audit-log.js, the minimal implementation of the shared contract
 * (2026-10-04). The fuller module replaces these at merge; until then they are
 * held to the contract here.
 *
 *   recordAudit(db, { orgId, action, actor: { sub, email, name, role },
 *                     target: { type, id, title }, reason, detail })
 *   → PK ORG#<orgId>#AUDIT, SK <ISO>#<8 hex>, At, OrgId, Action, Actor,
 *     Target {Type, Id}, Title and Reason sealed with the org's key, Detail.
 *
 * rejects: copies that drift; a title or reason in plaintext; user text in
 * Detail; an entry with no org, no actor, an unknown role or no target; a
 * write that fails silently; an entry kept for more or less than the owner's
 * one year (RETENTION_DAYS = 365, on the table's `ttl`).
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { installEventHarness } = require('./helpers/event-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const h = installEventHarness();
const { table } = h;
const COPIES = ['lambda-functions/admin/shared/audit-log.js', 'lambda-functions/game/audit-log.js', 'lambda-functions/websocket/audit-log.js'];

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; } catch (e) { console.log(`  FAIL - ${label}\n    ${e.stack || e.message}`); fail += 1; }
}
const ORG = 'org_nw';
const entry = (over = {}) => ({
  orgId: ORG,
  action: 'session.delete',
  actor: { sub: 'u-1', email: 'ada@example.com', name: 'ada', role: 'platform-admin' },
  target: { type: 'session', id: '4821', title: 'Q4 offsite' },
  reason: 'The customer asked us to remove it (ticket 88).',
  detail: { gameType: 'trivia', players: 12, note: 'free text is dropped' },
  ...over,
});
const audits = () => [...table.store.values()].filter((r) => r.PK === `ORG#${ORG}#AUDIT`);

(async () => {
  await check('the three copies are byte-identical', () => {
    const [a, ...rest] = COPIES.map((rel) => fs.readFileSync(path.join(h.REPO, rel), 'utf8'));
    rest.forEach((b, i) => assert.strictEqual(b, a, `${COPIES[i + 1]} drifted from ${COPIES[0]}`));
  });

  for (const rel of COPIES) {
    const { recordAudit } = h.load(rel);
    await check(`${rel}: the row is the contract's, title and reason sealed, detail ids and counts only, kept a year`, async () => {
      table.store.clear();
      await recordAudit(table.doc, entry());
      const [row] = audits();
      assert.ok(row, 'an entry');
      assert.match(row.SK, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z#[0-9a-f]{8}$/);
      assert.strictEqual(row.At, row.SK.split('#')[0]);
      assert.strictEqual(row.OrgId, ORG);
      assert.strictEqual(row.Action, 'session.delete');
      assert.deepStrictEqual(row.Actor, { Sub: 'u-1', Email: 'ada@example.com', Name: 'ada', Role: 'platform-admin' });
      assert.deepStrictEqual(row.Target, { Type: 'session', Id: '4821' });
      assert.strictEqual(typeof row.Title, 'object', 'Title is ciphertext');
      assert.strictEqual(typeof row.Reason, 'object', 'Reason is ciphertext');
      const plain = plainRow(ORG, row);
      assert.strictEqual(plain.Title, 'Q4 offsite');
      assert.strictEqual(plain.Reason, 'The customer asked us to remove it (ticket 88).');
      assert.deepStrictEqual(row.Detail, { gameType: 'trivia', players: 12 });
      // Kept one year (the owner, 2026-10-04): the entry's own time + 365 days.
      assert.strictEqual(h.load(rel).RETENTION_DAYS, 365);
      assert.strictEqual(row.ttl, Math.floor(Date.parse(row.At) / 1000) + 365 * 86400);
    });
  }

  const { recordAudit } = h.load(COPIES[1]);
  await check('no reason, no title: neither attribute is written', async () => {
    table.store.clear();
    await recordAudit(table.doc, entry({ reason: '', target: { type: 'session', id: '1', title: '' }, actor: { sub: 'u', role: 'host' } }));
    const [row] = audits();
    assert.ok(!('Reason' in row) && !('Title' in row));
  });
  await check('refused: no org, a bad action, an unknown role, no actor, no target', async () => {
    for (const bad of [
      entry({ orgId: '' }), entry({ action: 'delete' }), entry({ actor: { sub: 'u', role: 'admin' } }),
      entry({ actor: { role: 'host' } }), entry({ target: { type: 'session', id: '' } }),
    ]) {
      await assert.rejects(() => recordAudit(table.doc, bad));
    }
  });
  await check('a write that fails throws', async () => {
    table.inject((cmd) => cmd.type === 'put' && /#AUDIT$/.test(cmd.input.Item.PK), () => new Error('ProvisionedThroughputExceededException'));
    await assert.rejects(() => recordAudit(table.doc, entry()), /ProvisionedThroughput/);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
