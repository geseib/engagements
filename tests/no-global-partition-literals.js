/**
 * NOTHING OUTSIDE tenant.js MAY NAME A GLOBAL PARTITION.
 *
 * ── THIS TEST WAS CLAIMED FOR MONTHS AND DID NOT EXIST ─────────────────────
 *
 * All three copies of `tenant.js` say, in their opening paragraph:
 *
 *   "Nothing else in the codebase may write a 'SETS' or 'GAMES' literal;
 *    tests/no-global-partition-literals.js fails the build if one appears."
 *
 * `docs/handoff/multitenant-saas-2026-08-23.md` repeats it. `get-ai-summary.js`
 * goes further and says the tenancy fix removed "any hard-coded `PK: 'SETS'` in
 * a runtime reader, so a third cannot hide."
 *
 * The file did not exist. A third had hidden — see the allowlist below.
 *
 * ── WHY THE RULE MATTERS ───────────────────────────────────────────────────
 *
 * Since tenancy a question set lives in one of three partitions:
 *
 *   PLATFORM  PK 'SETS'              ORG  PK 'ORG#<org>#SETS'   PUBLIC  PK 'PUBLIC#SETS'
 *
 * and `'SETS'` — the bare literal — is now the PLATFORM one specifically, not
 * "the sets". So a reader that hard-codes it does not fail loudly; it silently
 * cannot see any customer's content, and reports the row as missing. Every
 * occurrence found so far produced exactly that: a 404 on a set the caller owns.
 *
 * The same argument holds for `'GAMES'`, which is now only the global four-digit
 * code reservation registry; a session's own index is `ORG#<org>#GAMES`.
 *
 * // rejects: a handler that reads or writes a bare 'SETS'/'GAMES' partition
 * //          instead of going through tenant.js, and so cannot see org content.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

/**
 * KNOWN OCCURRENCES, each with the reason it is not a violation — or, for the
 * one that is, the bug it causes. An allowlist entry is a debt, not a pardon:
 * when the list is empty this block goes away.
 */
const ALLOWED = new Map([
  [
    'lambda-functions/monitoring/monitors.js',
    'Declarative monitor config, not a data-path read. `partition: \'GAMES\'` names '
    + 'the global code-reservation registry deliberately — that partition genuinely '
    + 'is global. The monitoring bundle carries no tenant.js copy to import the '
    + 'constant from, and adding a fourth copy to satisfy a string match would be '
    + 'worse than this line.',
  ],
  [
    'lambda-functions/admin/ai-draft-set-metadata.js',
    'THIS ONE IS A BUG, recorded here rather than in prose so it cannot be lost '
    + 'again. Its pre-flight read hard-codes `Key: { PK: \'SETS\', SK: SET#<id> }`, '
    + 'which is the PLATFORM partition, so AI metadata drafting answers 404 '
    + '"Question set was not found" for EVERY org-authored set. The fix is the '
    + 'pattern in admin/update-game-categories.js: resolve the scope first. Not '
    + 'fixed here because it is a behaviour change that wants its own test, not a '
    + 'cleanup. Delete this entry with the fix.',
  ],
]);

/** Every tracked .js under lambda-functions, minus the tenant.js copies. */
const sources = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Build output and dependencies hold stale COPIES of handlers. Scanning
      // them makes this suite fail on code that is not in the repository — the
      // exact trap tests/cors-allows-sent-headers.js falls into.
      if (['node_modules', '.aws-sam', 'dist'].includes(entry.name)) continue;
      walk(full);
    } else if (entry.name.endsWith('.js') && entry.name !== 'tenant.js') {
      sources.push(full);
    }
  }
};
walk(path.join(REPO, 'lambda-functions'));

/**
 * Strip comments before matching. The rule is about CODE: these files explain
 * the tenancy scheme at length, and a doc comment saying `PK='SETS'` is the
 * platform partition is the opposite of a violation — it is the documentation
 * the rule depends on. Matching raw source would flag sixteen such comments and
 * train the next person to ignore this suite.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

console.log('1. no handler names a global partition directly');

const offenders = [];
for (const file of sources) {
  const rel = path.relative(REPO, file);
  const code = stripComments(fs.readFileSync(file, 'utf8'));
  // A quoted bare SETS or GAMES. `ORG#...#SETS`, `PUBLIC#SETS`, `AIPROMPTS`
  // and `ORGS` are built or owned elsewhere and are not this rule's business.
  for (const m of code.matchAll(/['"](SETS|GAMES)['"]/g)) {
    offenders.push({ rel, literal: m[1] });
  }
}

const unexpected = offenders.filter((o) => !ALLOWED.has(o.rel));
// rejects: THE HOLE this file was always supposed to close.
check('no un-allowlisted handler writes a bare SETS/GAMES literal', () => {
  assert.deepStrictEqual(unexpected, [],
    `these cannot see org content:\n         ${unexpected.map((o) => `${o.rel}: '${o.literal}'`).join('\n         ')}`);
});

console.log('\n2. the allowlist is honest');

// rejects: an allowlist that outlives the thing it excused. Once a file is
// fixed its entry must go, or the next real violation in it passes unnoticed.
for (const [rel, why] of ALLOWED) {
  check(`${path.basename(rel)} still contains the literal it is excused for`, () => {
    assert.ok(offenders.some((o) => o.rel === rel),
      `${rel} no longer names a global partition — delete its ALLOWED entry`);
    assert.ok(why.length > 60, 'an allowlist entry must say why');
  });
}

console.log('\n3. tenant.js is the one place that may');

for (const rel of [
  'lambda-functions/game/tenant.js',
  'lambda-functions/websocket/tenant.js',
  'lambda-functions/admin/shared/tenant.js',
]) {
  check(`${rel.split('/').slice(-2).join('/')} builds the partitions`, () => {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    assert.ok(/GAMES_RESERVATION_PK\s*=\s*'GAMES'/.test(src), 'missing the reservation constant');
    assert.ok(/setsMetadataPk/.test(src), 'missing setsMetadataPk');
  });
}

// rejects: the claim in tenant.js's header becoming false again.
check('tenant.js\'s promise that this file exists is now true', () => {
  const src = fs.readFileSync(path.join(REPO, 'lambda-functions/game/tenant.js'), 'utf8');
  assert.ok(src.includes('tests/no-global-partition-literals.js'),
    'tenant.js no longer names this test — keep the pointer or drop the claim');
  assert.ok(fs.existsSync(__filename));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
