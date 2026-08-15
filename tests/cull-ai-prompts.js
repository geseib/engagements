/**
 * THE REFERENCE GATE IN scripts/cull-ai-prompts.js.
 *
 * The script proposes prompt rows for HARD DELETION. The failure it must never
 * cause is deleting a prompt a question set points at: get-ai-summary.js:412-444
 * treats an unresolvable promptId as a recovery, not an error — it substitutes
 * the game-type default, logs it, and returns a summary. The set keeps its
 * promptId, the admin UI still shows the prompt as attached, and every future
 * round of that set is summarised by a prompt nobody chose. Nothing anywhere
 * says so.
 *
 * So the gate is the thing under test, in both directions:
 *   - a referenced row is never proposed, no matter which pass proposes it;
 *   - an unreferenced duplicate IS proposed, or the pass does nothing at all.
 *
 * The script is a self-executing IIFE that reads process.argv, so it runs here
 * as a real child process with the AWS SDK preloaded out (helpers/cull-aws-stub.js).
 * Assertions are made against the operator-visible stdout, and every write the
 * script attempts is echoed as a `WROTE …` line so "a dry run writes nothing"
 * is checkable rather than assumed.
 */
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'cull-ai-prompts.js');
const STUB = path.join(__dirname, 'helpers', 'cull-aws-stub.js');
const TABLE = 'engage-cull-test';

const shipped = require(path.join(REPO, 'lambda-functions', 'admin', 'default-ai-prompts.json'));
// Two real shipped names, read from the catalogue rather than typed, so a
// rename in the JSON fails this file loudly instead of quietly testing nothing.
const SHIPPED_NAME = shipped['call-and-answer']['lessons-learned'].name;
const OTHER_SHIPPED_NAME = shipped.trivia.general.name;

let pass = 0;
let fail = 0;
const check = (label, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${label}`); } catch (e) {
    fail++; console.log(`  FAIL  ${label}\n        ${e.message}`);
  }
};

const promptRow = (over) => ({
  PK: 'AIPROMPTS', SK: `AIPROMPT#${over.promptId}`,
  gameType: 'call-and-answer', createdBy: 'system', createdAt: '2025-01-01T00:00:00Z',
  ...over,
});
const setRow = (setId, over = {}) => ({
  PK: 'SETS', SK: `SET#${setId}`, SetName: `Set ${setId}`, ...over,
});

/** Run the script against a fixture and return its stdout. */
const run = (fixture, args = []) => execFileSync(
  process.execPath, ['-r', STUB, SCRIPT, TABLE, ...args],
  { env: { ...process.env, CULL_FIXTURE: JSON.stringify(fixture) }, encoding: 'utf8' }
);

/** The promptIds the run actually proposed for deletion. */
const deletionsIn = (out) => out.split('\n')
  .filter((l) => /^\s*DELETE\s/.test(l))
  .map((l) => (l.match(/AIPROMPT#(\S+)/) || [])[1])
  .filter(Boolean);

const heldIn = (out) => out.split('\n')
  .filter((l) => /HELD BACK \(referenced\)/.test(l))
  .map((l) => (l.match(/AIPROMPT#(\S+)/) || [])[1])
  .filter(Boolean);

console.log('\ncull-ai-prompts.js — the reference gate\n');

/* ------------------------------------------------------------------------ *
 * 1. THREE COPIES OF ONE SHIPPED DEFAULT, THE MIDDLE ONE ATTACHED TO A SET.
 *
 * This is D17's residue exactly: populate-defaults.js used to mint a fresh
 * promptId on every run, so the table holds N copies of one prompt. The copy
 * a set was pointed at by hand is not the oldest and is not the one carrying
 * isDefault, so any rule that keeps "the oldest" or "the default" deletes the
 * one in use.
 * ------------------------------------------------------------------------ */
{
  const fixture = {
    AIPROMPTS: [
      promptRow({ promptId: 'dup-old', name: SHIPPED_NAME, createdAt: '2025-01-01T00:00:00Z', isDefault: true }),
      promptRow({ promptId: 'dup-used', name: SHIPPED_NAME, createdAt: '2025-06-01T00:00:00Z' }),
      promptRow({ promptId: 'dup-new', name: SHIPPED_NAME, createdAt: '2025-09-01T00:00:00Z' }),
    ],
    SETS: [setRow('artset', { promptId: 'dup-used', SetName: 'The Art Set' })],
  };
  const out = run(fixture, ['--only=superseded']);
  const deleted = deletionsIn(out);

  check('the copy a question set references is never proposed for deletion', () =>
    assert(!deleted.includes('dup-used'),
      `dup-used was proposed; deletions were ${JSON.stringify(deleted)}`));
  check('the referenced copy is the one kept, over the older and the isDefault one', () =>
    assert(/keeping dup-used \(referenced by a set\)/.test(out),
      `expected dup-used kept, got:\n${out}`));
  check('the two unreferenced copies ARE proposed', () =>
    assert(deleted.includes('dup-old') && deleted.includes('dup-new'),
      `expected both unreferenced copies, got ${JSON.stringify(deleted)}`));
  check('the referencing set is named in the output, not just counted', () =>
    assert(/artset \("The Art Set"\)/.test(out), 'the operator cannot see which set is affected'));
  check('a dry run writes nothing at all', () =>
    assert(!/^WROTE /m.test(out), 'the script wrote to the table without --apply'));
}

/* ------------------------------------------------------------------------ *
 * 2. THE GATE OVERRIDES THE PASS'S OWN RANKING.
 *
 * Here the referenced copy is ALSO the one the ranking would discard, and a
 * second, unrelated shipped prompt has a referenced duplicate too. If the gate
 * only worked because the ranking happened to agree with it, this fails.
 * ------------------------------------------------------------------------ */
{
  const fixture = {
    AIPROMPTS: [
      promptRow({ promptId: 'keep-a', name: OTHER_SHIPPED_NAME, gameType: 'trivia', createdAt: '2025-01-01T00:00:00Z' }),
      promptRow({ promptId: 'ref-b', name: OTHER_SHIPPED_NAME, gameType: 'trivia', createdAt: '2025-02-01T00:00:00Z' }),
      promptRow({ promptId: 'ref-c', name: OTHER_SHIPPED_NAME, gameType: 'trivia', createdAt: '2025-03-01T00:00:00Z' }),
    ],
    SETS: [
      setRow('quiz1', { promptId: 'ref-b' }),
      setRow('quiz2', { promptId: 'ref-c' }),
    ],
  };
  const out = run(fixture, ['--only=superseded']);
  const deleted = deletionsIn(out);
  const held = heldIn(out);

  check('with two referenced copies, one is kept and the other is HELD BACK', () =>
    assert(held.includes('ref-c') || held.includes('ref-b'),
      `expected a held-back referenced copy, got held=${JSON.stringify(held)}`));
  check('neither referenced copy is proposed for deletion', () => {
    assert(!deleted.includes('ref-b'), `ref-b proposed: ${JSON.stringify(deleted)}`);
    assert(!deleted.includes('ref-c'), `ref-c proposed: ${JSON.stringify(deleted)}`);
  });
  check('the unreferenced copy is still proposed', () =>
    assert(deleted.includes('keep-a'),
      `the gate suppressed an unreferenced row too: ${JSON.stringify(deleted)}`));
}

/* ------------------------------------------------------------------------ *
 * 3. --force-referenced IS THE ONLY WAY PAST THE GATE.
 * ------------------------------------------------------------------------ */
{
  const fixture = {
    AIPROMPTS: [
      promptRow({ promptId: 'f-keep', name: SHIPPED_NAME, createdAt: '2025-01-01T00:00:00Z' }),
      promptRow({ promptId: 'f-ref', name: SHIPPED_NAME, createdAt: '2025-02-01T00:00:00Z' }),
      promptRow({ promptId: 'f-ref2', name: SHIPPED_NAME, createdAt: '2025-03-01T00:00:00Z' }),
    ],
    SETS: [setRow('s1', { promptId: 'f-ref' }), setRow('s2', { promptId: 'f-ref2' })],
  };
  const gated = deletionsIn(run(fixture, ['--only=superseded']));
  const forced = deletionsIn(run(fixture, ['--only=superseded', '--force-referenced']));

  check('without the flag a referenced duplicate is not proposed', () =>
    assert(!gated.includes('f-ref2') && !gated.includes('f-ref'),
      `gate leaked: ${JSON.stringify(gated)}`));
  check('with --force-referenced the referenced duplicate is proposed', () =>
    assert(forced.includes('f-ref2') || forced.includes('f-ref'),
      `--force-referenced changed nothing: ${JSON.stringify(forced)}`));
}

/* ------------------------------------------------------------------------ *
 * 4. A SET POINTING AT A PROMPT THAT NO LONGER EXISTS.
 *
 * Not something this script causes — it is the state a previous unguarded
 * delete leaves behind, and it is the single most useful thing in the report.
 * ------------------------------------------------------------------------ */
{
  const fixture = {
    AIPROMPTS: [promptRow({ promptId: 'alive', name: SHIPPED_NAME })],
    SETS: [
      setRow('good', { promptId: 'alive' }),
      setRow('broken', { promptId: 'vanished', SetName: 'Q4 Retro' }),
    ],
  };
  const out = run(fixture, ['--only=superseded']);

  check('a promptId no prompt row carries is reported as DANGLING', () =>
    assert(/DANGLING\s+vanished/.test(out), `no dangling report in:\n${out}`));
  check('the dangling report names the set that is already silently broken', () =>
    assert(/broken \("Q4 Retro"\)/.test(out), 'the operator cannot tell which set to fix'));
  check('a resolvable reference is NOT called dangling', () =>
    assert(!/DANGLING\s+alive/.test(out), '"alive" resolves and must not be flagged'));
  check('the dangling count is summarised', () =>
    assert(/\(1 dangling\)/.test(out), `expected a dangling count in the summary:\n${out}`));
}

/* ------------------------------------------------------------------------ *
 * 5. RETIRED NAMES ARE REPORTED, NEVER DELETED.
 *
 * `createdBy: 'system'` is populate-defaults.js's own stamp, and it is what
 * separates a withdrawn default from a prompt the owner wrote in the admin UI.
 * The owner's prompt must not appear in this list at all.
 * ------------------------------------------------------------------------ */
{
  const fixture = {
    AIPROMPTS: [
      promptRow({ promptId: 'gone-1', name: 'Wavelength Rapid Fire - Retired' }),
      promptRow({ promptId: 'gone-2', name: 'Old Poll Prompt', }),
      promptRow({ promptId: 'mine', name: 'My Own Prompt', createdBy: 'george@seibtribe.com' }),
      promptRow({ promptId: 'current', name: SHIPPED_NAME }),
    ],
    SETS: [setRow('s9', { promptId: 'gone-2' })],
  };
  const out = run(fixture, ['--only=retired']);

  check('a seeded row whose name left the catalogue is reported', () =>
    assert(/AIPROMPT#gone-1/.test(out), `gone-1 not reported:\n${out}`));
  check('a reported row that a set references is marked "do not remove"', () =>
    assert(/AIPROMPT#gone-2.*REFERENCED by s9 — do not remove/.test(out),
      `gone-2 not flagged as referenced:\n${out}`));
  check('an unreferenced one is marked unreferenced rather than referenced', () =>
    assert(/AIPROMPT#gone-1.*unreferenced/.test(out), 'gone-1 mislabelled'));
  check('a prompt the owner authored is not treated as a retired default', () =>
    assert(!/AIPROMPT#mine/.test(out), 'the pass claimed an owner-authored prompt'));
  check('a name still in the catalogue is not reported as retired', () =>
    assert(!/AIPROMPT#current/.test(out), 'a currently shipped default was called retired'));
  check('the retired pass proposes no deletion of any kind', () =>
    assert(deletionsIn(out).length === 0, 'retired must be report-only'));
}

/* ------------------------------------------------------------------------ *
 * 6. A PASS MUST NOT ELECT A ROW THAT AN EARLIER PASS IS DELETING.
 *
 * Every pass reads the same snapshot taken at the top, so `defaults` still
 * sees rows `superseded` has just removed. Both copies here carry isDefault —
 * which is exactly the D17 residue, since populate-defaults.js stamped the
 * flag on every copy it minted. If `defaults` crowns the deleted copy it also
 * clears the flag off the surviving one, and the game type is left with NO
 * default: every unattached call-and-answer set falls to the hardcoded
 * fallback in get-ai-summary.js, silently.
 * ------------------------------------------------------------------------ */
{
  const fixture = {
    AIPROMPTS: [
      promptRow({ promptId: 'old-copy', name: SHIPPED_NAME, isDefault: true, createdAt: '2025-01-01T00:00:00Z' }),
      promptRow({ promptId: 'live-copy', name: SHIPPED_NAME, isDefault: true, createdAt: '2025-08-01T00:00:00Z' }),
    ],
    SETS: [setRow('inuse', { promptId: 'live-copy' })],
  };
  const out = run(fixture, ['--only=superseded,defaults']);
  const deleted = deletionsIn(out);

  check('the duplicate that is not referenced is proposed for deletion', () =>
    assert(deleted.includes('old-copy'), `expected old-copy deleted, got ${JSON.stringify(deleted)}`));
  check('the surviving default is the row that is NOT being deleted', () =>
    assert(/call-and-answer: 1 default — ok \(live-copy\)/.test(out)
      || /keeping live-copy/.test(out),
    `defaults elected a doomed row:\n${out}`));
  check('isDefault is not cleared off the only row that will still exist', () => {
    const cleared = out.split('\n')
      .filter((l) => /clear isDefault/.test(l))
      .map((l) => (l.match(/AIPROMPT#(\S+)/) || [])[1]);
    assert(!cleared.includes('live-copy'),
      'the surviving copy lost isDefault, so the game type now has none at all');
  });
}

/* ------------------------------------------------------------------------ *
 * 7. THE SHIPPED CATALOGUE IS WHAT "SHIPPED" MEANS.
 *
 * The script reads default-ai-prompts.json rather than a list of its own, so
 * a prompt added to the JSON is immediately understood by both new passes.
 * ------------------------------------------------------------------------ */
{
  const names = [];
  for (const categories of Object.values(shipped)) {
    for (const p of Object.values(categories)) names.push(p.name);
  }
  check('every shipped default has a name for the seeder to match on', () =>
    assert(names.every((n) => typeof n === 'string' && n.trim().length > 0),
      'a nameless default cannot be matched, so every seed run would duplicate it'));
  check('no two shipped defaults share a name', () =>
    assert(new Set(names).size === names.length,
      'two defaults with one name collapse into a single row at seed time'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
