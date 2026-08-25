/**
 * THE INVOICE, PINNED TO THE SCREEN THAT PROMISES IT.
 *
 * `docs/design/tenancy-redesign/04-billing.html` prints a worked example:
 * 2 stored sets, 20 sessions run, on the $5 Team plan, totalling $8.75. That
 * screen is the specification, so this file asserts the number it shows — in
 * cents, as an integer, line by line, including the sentences beside each line.
 *
 * rejects: a total that is not exactly 875 for the mockup's usage; billing sets
 * on the CURRENT count instead of the PEAK; charging the included units instead
 * of exempting them; any amount that is a float rather than an integer number
 * of cents; a `detail` string drifting from the words on the screen; the two
 * copies of pricing.js drifting apart; pricing gaining a `require` that would
 * stop the frontend importing it.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { TEAM_PLAN, projectInvoice, formatCents } = require(path.join(REPO, 'lambda-functions/game/pricing.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail++; }
}
const lineOf = (invoice, key) => invoice.lines.find((l) => l.key === key);

// ---------- 1. The plan is the plan ----------
console.log('\n1. the plan the owner set, in cents');
check('$5.00 base, as 500', () => assert.strictEqual(TEAM_PLAN.base, 500));
check('5 sessions and 5 sets included', () => {
  assert.strictEqual(TEAM_PLAN.includedSessions, 5);
  assert.strictEqual(TEAM_PLAN.includedSets, 5);
});
check('$0.25 per unit past the allowance, as 25', () => {
  assert.strictEqual(TEAM_PLAN.perSession, 25);
  assert.strictEqual(TEAM_PLAN.perSet, 25);
});
check('every plan number is an integer, never 5.0 or 0.25', () => {
  for (const k of ['base', 'includedSessions', 'includedSets', 'perSession', 'perSet']) {
    assert.ok(Number.isInteger(TEAM_PLAN[k]), `${k} = ${TEAM_PLAN[k]} is not an integer`);
  }
});
check('the shared plan object cannot be mutated by one caller', () => {
  assert.throws(() => { 'use strict'; TEAM_PLAN.base = 999; });
  assert.strictEqual(TEAM_PLAN.base, 500);
});

// ---------- 2. THE WORKED EXAMPLE ----------
// $5.00 + $0.00 + $3.75 = $8.75. This is the number on the screen and the
// number the owner stated; if it moves, one of the three is now a lie.
console.log('\n2. the mockup: 2 sets, 20 sessions -> 875 cents exactly');
{
  const invoice = projectInvoice(TEAM_PLAN, { setsPeak: 2, setsCurrent: 2, sessionsRun: 20 });
  check('total is exactly 875 cents', () =>
    assert.strictEqual(invoice.totalCents, 875));
  check('and renders as $8.75', () =>
    assert.strictEqual(invoice.totalDisplay, '$8.75'));
  check('base line: $5.00, "the monthly subscription"', () => {
    assert.strictEqual(lineOf(invoice, 'base').amountCents, 500);
    assert.strictEqual(lineOf(invoice, 'base').detail, 'the monthly subscription');
  });
  check('sets line: $0.00, "2 stored, 5 included"', () => {
    assert.strictEqual(lineOf(invoice, 'sets').amountCents, 0);
    assert.strictEqual(lineOf(invoice, 'sets').detail, '2 stored, 5 included');
  });
  check('sessions line: $3.75, "15 over the included 5, at $0.25"', () => {
    assert.strictEqual(lineOf(invoice, 'sessions').amountCents, 375);
    assert.strictEqual(lineOf(invoice, 'sessions').detail,
      '15 over the included 5, at $0.25');
  });
  check('the lines add up to the total — the screen shows the arithmetic', () =>
    assert.strictEqual(
      invoice.lines.reduce((s, l) => s + l.amountCents, 0), invoice.totalCents));
  check('three charge lines, in the order the screen draws them', () =>
    assert.deepStrictEqual(invoice.lines.map((l) => l.key), ['base', 'sets', 'sessions']));
}

// ---------- 3. Storage is billed on the PEAK ----------
// "A set you created and deleted still counted" is printed on the screen, so
// billing setsCurrent would contradict a promise already made in writing.
console.log('\n3. sets are billed on the peak, not the count at the end');
{
  const grewThenShrank = projectInvoice(TEAM_PLAN, { setsCurrent: 2, setsPeak: 9, sessionsRun: 0 });
  check('peak 9 / current 2 charges four sets, not zero', () =>
    assert.strictEqual(lineOf(grewThenShrank, 'sets').amountCents, 100));
  check('and the total is 600, not 500', () =>
    assert.strictEqual(grewThenShrank.totalCents, 600));
  check('setsCurrent is not consulted at all', () => {
    const a = projectInvoice(TEAM_PLAN, { setsCurrent: 0, setsPeak: 9, sessionsRun: 0 });
    const b = projectInvoice(TEAM_PLAN, { setsCurrent: 900, setsPeak: 9, sessionsRun: 0 });
    assert.strictEqual(a.totalCents, b.totalCents);
  });
}

// ---------- 4. The allowance is free, not discounted ----------
console.log('\n4. the included units are exempt, not cheaper');
for (const n of [0, 1, 4, 5]) {
  check(`${n} sessions costs the base and nothing else`, () =>
    assert.strictEqual(projectInvoice(TEAM_PLAN, { sessionsRun: n }).totalCents, 500));
}
check('the 6th session is the first one charged', () =>
  assert.strictEqual(projectInvoice(TEAM_PLAN, { sessionsRun: 6 }).totalCents, 525));
check('a line inside its allowance says the count, not an overage', () =>
  assert.strictEqual(lineOf(projectInvoice(TEAM_PLAN, { sessionsRun: 3 }), 'sessions').detail,
    '3 run, 5 included'));

// ---------- 5. NO FLOATS. ANYWHERE. ----------
// 0.1 + 0.2 !== 0.3, and a bill is where that becomes a support thread. Sweep
// junk, fractions, negatives and large numbers through every emitted amount.
console.log('\n5. every amount is an integer number of cents');
{
  const inputs = [
    {}, { sessionsRun: 0.5, setsPeak: 0.5 }, { sessionsRun: '20', setsPeak: '2' },
    { sessionsRun: -3, setsPeak: -3 }, { sessionsRun: NaN, setsPeak: undefined },
    { sessionsRun: 7.999, setsPeak: 5.001 }, { sessionsRun: 1e6, setsPeak: 1e6 },
    { sessionsRun: null, setsPeak: 'x' }, { sessionsRun: 1 / 3, setsPeak: 2 / 3 },
  ];
  for (const usage of inputs) {
    check(`integers for ${JSON.stringify(usage)}`, () => {
      const invoice = projectInvoice(TEAM_PLAN, usage);
      assert.ok(Number.isInteger(invoice.totalCents),
        `total ${invoice.totalCents} is not an integer`);
      for (const line of invoice.lines) {
        for (const field of ['quantity', 'included', 'billable', 'unitCents', 'amountCents']) {
          assert.ok(Number.isInteger(line[field]),
            `${line.key}.${field} = ${line[field]} is not an integer`);
        }
        assert.ok(line.amountCents >= 0, `${line.key} charges a negative amount`);
      }
    });
  }
  check('a fractional count truncates DOWN — never round a customer into a charge', () =>
    assert.strictEqual(projectInvoice(TEAM_PLAN, { sessionsRun: 5.9 }).totalCents, 500));
  check('a negative count is zero, not a credit', () =>
    assert.strictEqual(projectInvoice(TEAM_PLAN, { sessionsRun: -100 }).totalCents, 500));
  check('every quarter still lands on a whole cent at scale', () => {
    // 1,000,000 sessions: 999,995 * 25 = 24,999,875. A float pipeline drifts here.
    const invoice = projectInvoice(TEAM_PLAN, { sessionsRun: 1000000 });
    assert.strictEqual(lineOf(invoice, 'sessions').amountCents, 24999875);
    assert.strictEqual(invoice.totalCents, 25000375);
  });
}

// ---------- 6. Rendering money ----------
console.log('\n6. formatCents builds the string by integer division');
const money = [[0, '$0.00'], [5, '$0.05'], [25, '$0.25'], [500, '$5.00'],
  [875, '$8.75'], [650, '$6.50'], [100000, '$1000.00'], [-25, '-$0.25']];
for (const [cents, want] of money) {
  check(`${cents} -> ${want}`, () => assert.strictEqual(formatCents(cents), want));
}
check('a cent count is never printed with three decimals', () => {
  for (let c = 0; c <= 1000; c++) assert.ok(/^\$\d+\.\d{2}$/.test(formatCents(c)));
});

// ---------- 7. It stays importable by the frontend ----------
// The console imports this file so the screen and the bill run one function.
// A `require` here breaks that bundle, and the two numbers start to drift.
console.log('\n7. pure and dependency-free, so the console can import it');
{
  const body = fs.readFileSync(path.join(REPO, 'lambda-functions/game/pricing.js'), 'utf8');
  check('no require() in pricing.js', () =>
    assert.ok(!/\brequire\s*\(/.test(body), 'pricing.js has grown a dependency'));
  check('no Date, no process, no clock', () =>
    assert.ok(!/\bnew Date\b|\bprocess\./.test(body), 'pricing.js reads a clock or the env'));
  check('projectInvoice does not mutate its arguments', () => {
    const usage = { sessionsRun: 20, setsPeak: 2 };
    const before = JSON.stringify(usage);
    projectInvoice(TEAM_PLAN, usage);
    assert.strictEqual(JSON.stringify(usage), before);
  });
  check('the same input twice gives the same answer', () =>
    assert.deepStrictEqual(
      projectInvoice(TEAM_PLAN, { sessionsRun: 20, setsPeak: 2 }),
      projectInvoice(TEAM_PLAN, { sessionsRun: 20, setsPeak: 2 })));
}

// ---------- 8. The two bundle copies have not drifted ----------
console.log('\n8. game/ and admin/shared/ carry the same file');
{
  const a = fs.readFileSync(path.join(REPO, 'lambda-functions/game/pricing.js'), 'utf8');
  const b = fs.readFileSync(path.join(REPO, 'lambda-functions/admin/shared/pricing.js'), 'utf8');
  check('admin/shared/pricing.js matches game/pricing.js', () =>
    assert.strictEqual(a, b, 'the copies have drifted — two bundles price differently'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
