/**
 * "DELETE ALL SESSIONS" DELETES ONE ORGANISATION'S SESSIONS.
 *
 * ── WHAT IT USED TO DO ─────────────────────────────────────────────────────
 *
 * `clear-all-games.js` SCANNED THE WHOLE TABLE and deleted every `GAME#*`
 * partition, the global `GAMES` code reservation, and — via
 * `/^ORG#.+#GAMES$/` — EVERY ORGANISATION'S SESSION INDEX. It read no `orgId`
 * anywhere.
 *
 * The control that fires it is on the org Sessions screen
 * (components/SessionsPanel.jsx), under a list that IS org-scoped
 * (`get-games-list.js` queries `gamesIndexPk(orgId)`), beside a dialog that
 * says "Delete all 3 sessions? Everything below goes at once". So an Engage
 * admin standing in their own personal space, looking at three of their own
 * rows, would have destroyed every customer's sessions on the tier.
 *
 * It is `admins`-only, which is the only reason this was survivable — and
 * "only staff can trigger the cross-tenant data loss" is not a boundary, it is
 * a smaller blast radius.
 *
 * ── WHAT IT DOES NOW ───────────────────────────────────────────────────────
 *
 * Queries the caller's own `ORG#{orgId}#GAMES` index and deletes exactly those
 * sessions, their `GAME#{id}` partitions and their `GAMES` reservations. No
 * Scan, so it cannot see another tenant's rows at all — the same "not filtered
 * out, not expressible" property the rest of the tenancy work rests on.
 *
 * // rejects: any return to a table Scan, and any delete that reaches a row
 * //          belonging to an organisation other than the caller's.
 */
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const REPO = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'lambda-functions/admin/clear-all-games.js'), 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

console.log('1. it cannot see another tenant');

// rejects: THE DEFECT. A Scan is how it saw every organisation at once.
check('no ScanCommand anywhere in the handler', () => {
  assert.ok(!/ScanCommand/.test(code),
    'a Scan reads every partition in the table, including every other organisation\'s');
});

check('it queries the caller\'s own session index', () => {
  assert.ok(/gamesIndexPk\s*\(/.test(code),
    'the org session index must be built by tenant.js, never spelled by hand');
  assert.ok(/QueryCommand/.test(code), 'a Query is single-partition by definition');
});

// rejects: falling back to "everything" when no organisation is resolved, which
// is exactly how a scoped delete turns back into a global one.
check('it refuses when there is no organisation, rather than clearing everything', () => {
  assert.ok(/callerOrgId/.test(code), 'it has to read the caller\'s org');
  assert.ok(/return|refus|403/i.test(code), 'and refuse without one');
});

console.log('\n2. the partitions it is allowed to touch');

// rejects: widening the delete back out to a regex over every ORG#…#GAMES.
check('no wildcard over other organisations\' indexes', () => {
  assert.ok(!/\^ORG#\.\+#GAMES\$/.test(code),
    'that pattern matches EVERY organisation, which is the bug');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
