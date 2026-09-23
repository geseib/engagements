/**
 * pricing-adjust.js — the order of application, pinned.
 * rejects: two percents stacking; a bill below $0.00; a credit spent twice;
 * a revoked or out-of-window row applying; a fractional cent; the two copies
 * drifting.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
const A = require(path.join(REPO, 'lambda-functions/admin/shared/pricing-adjust.js'));
const { TEAM_PLAN } = require(path.join(REPO, 'lambda-functions/admin/shared/pricing.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); pass += 1; console.log(`  ok - ${label}`); }
  catch (e) { fail += 1; console.log(`  FAIL - ${label}\n    ${e.message}`); }
}
const USAGE = { sessionsRun: 20, setsPeak: 2, setsCurrent: 2 }; // $8.75 list
const P = '2026-09';
const code30 = { adjId: 'c1', kind: 'CODE_REDEMPTION', percentOff: 30, validFrom: '2026-09', validTo: '2026-11', source: { type: 'code', code: 'WELCOME30' }, createdAt: '2026-09-23T00:00:00Z' };
const credit10 = { adjId: 'k1', kind: 'CREDIT_CENTS', amountCents: 1000, remainingCents: 1000, validFrom: '2026-09', source: { type: 'platform_admin' }, note: 'pilot goodwill', createdAt: '2026-09-01T00:00:00Z' };

console.log('\n1. the mockup arithmetic (16/19): $8.75 → 30% → $10 credit → $3.50');
{
  const r = A.applyAdjustments(TEAM_PLAN, USAGE, [code30, credit10], P);
  check('list is $8.75', () => assert.strictEqual(r.listCents, 875));
  check('30% takes $2.63 (rounded to the cent)', () => assert.strictEqual(r.discounts[0].amountCents, 263));
  check('the credit takes what is left after the percent ($6.12) and carries $3.88', () => {
    // 875 - 263 = 612; a $10 credit covers it all
    assert.strictEqual(r.credits[0].appliedCents, 612);
    assert.strictEqual(r.credits[0].remainingAfterCents, 388);
    assert.strictEqual(r.totalCents, 0);
  });
  check('savings are stated as a percent of list', () => assert.strictEqual(r.savingsPercent, 100));
  check('the sentence says simulated, the amount, and the discount', () => {
    assert.strictEqual(A.simulationSentence(r), 'This is a simulation. No card was charged. You would have been charged $0.00 — a 100% discount from the list price of $8.75.');
  });
}

console.log('\n2. the rule: one percent, the largest; fixed after; credits last; floor at zero');
{
  const code50 = { ...code30, adjId: 'c2', percentOff: 50, source: { type: 'code', code: 'EDU50' } };
  const fixed = { adjId: 'f1', kind: 'OFFER', fixedOffCents: 500, validFrom: P, validTo: P, source: { type: 'platform_admin' }, createdAt: '2026-09-02T00:00:00Z' };
  const r = A.applyAdjustments(TEAM_PLAN, USAGE, [code30, code50, fixed], P);
  check('only the larger percent applies; the other is listed as not applied', () => {
    const applied = r.discounts.filter((d) => d.amountCents > 0 && d.percent);
    assert.strictEqual(applied.length, 1);
    assert.strictEqual(applied[0].percent, 50);
    assert.ok(r.discounts.some((d) => d.percent === 30 && d.notApplied));
  });
  check('fixed comes off after the percent', () => {
    // 875 → -438 (50%) = 437 → -437 (fixed capped at what is left) = 0
    const f = r.discounts.find((d) => d.adjId === 'f1');
    assert.strictEqual(f.amountCents, 437);
    assert.strictEqual(r.totalCents, 0);
  });
  check('a $50 credit against $8.75 carries $41.25', () => {
    const big = { ...credit10, adjId: 'k2', amountCents: 5000, remainingCents: 5000 };
    const s = A.applyAdjustments(TEAM_PLAN, USAGE, [big], P);
    assert.strictEqual(s.totalCents, 0);
    assert.strictEqual(s.creditsRemaining.k2, 4125);
  });
  check('a credit already partly spent applies only its remainder', () => {
    const half = { ...credit10, remainingCents: 100 };
    const s = A.applyAdjustments(TEAM_PLAN, USAGE, [half], P);
    assert.strictEqual(s.credits[0].appliedCents, 100);
    assert.strictEqual(s.totalCents, 775);
  });
  check('never a fractional cent', () => {
    const s = A.applyAdjustments(TEAM_PLAN, { sessionsRun: 7, setsPeak: 1 }, [{ ...code30, percentOff: 33 }], P);
    [s.listCents, s.totalCents, ...s.discounts.map((d) => d.amountCents)].forEach((n) => assert.ok(Number.isInteger(n), `${n}`));
  });
}

console.log('\n3. windows and revocation');
{
  check('a row is active only inside its window', () => {
    assert.strictEqual(A.isActive(code30, '2026-08'), false);
    assert.strictEqual(A.isActive(code30, '2026-11'), true);
    assert.strictEqual(A.isActive(code30, '2026-12'), false);
    assert.strictEqual(A.isActive({ ...credit10, validTo: undefined }, '2030-01'), true, 'open-ended');
  });
  check('a revoked row never applies, whatever its dates', () => {
    assert.strictEqual(A.isActive({ ...code30, revokedAt: '2026-09-24T00:00:00Z' }, P), false);
    const r = A.applyAdjustments(TEAM_PLAN, USAGE, [{ ...code30, revokedAt: 'x' }], P);
    assert.strictEqual(r.totalCents, 875);
  });
  check('"3 months" from September ends in November', () => assert.deepStrictEqual(A.offerWindow('2026-09', 3), { validFrom: '2026-09', validTo: '2026-11' }));
  check('December plus one is next January', () => assert.strictEqual(A.addMonths('2026-12', 1), '2027-01'));
}

console.log('\n4. the effective plan: a special rate and extra allowance change the LIST, not a discount line');
{
  const rate = { adjId: 'r1', kind: 'RATE_OVERRIDE', rate: { baseCents: 400 }, validFrom: P, validTo: P, source: { type: 'platform_admin' } };
  const units = { adjId: 'u1', kind: 'CREDIT_UNITS', units: { sessions: 10 }, validFrom: P, validTo: P, source: { type: 'platform_admin' } };
  const r = A.applyAdjustments(TEAM_PLAN, USAGE, [rate, units], P);
  check('base $4.00 and 15 included sessions → 5 over × 25¢ = $1.25 → list $5.25', () => {
    assert.strictEqual(r.plan.base, 400);
    assert.strictEqual(r.plan.includedSessions, 15);
    assert.strictEqual(r.listCents, 525);
    assert.strictEqual(r.discounts.length, 0);
  });
  check('a free org stays $0.00 whatever is granted', () => {
    const { PERSONAL_PLAN } = require(path.join(REPO, 'lambda-functions/admin/shared/pricing.js'));
    const s = A.applyAdjustments(PERSONAL_PLAN, USAGE, [credit10], P);
    assert.strictEqual(s.listCents, 0);
    assert.strictEqual(s.totalCents, 0);
    assert.strictEqual(s.creditsRemaining.k1, 1000, 'the credit is untouched');
  });
}

console.log('\n5. the three copies have not drifted');
{
  const a = fs.readFileSync(path.join(REPO, 'lambda-functions/admin/shared/pricing-adjust.js'), 'utf8');
  const b = fs.readFileSync(path.join(REPO, 'lambda-functions/game/pricing-adjust.js'), 'utf8');
  check('game/pricing-adjust.js matches admin/shared/', () => assert.strictEqual(a, b));
  // rejects: the session gate (websocket/create-game.js → websocket/usage.js)
  // folding grants in with a different effectivePlan than the bill does.
  // usage.js requires './pricing-adjust' from every bundle it is copied to.
  check('websocket/pricing-adjust.js matches admin/shared/', () => {
    const w = path.join(REPO, 'lambda-functions/websocket/pricing-adjust.js');
    assert.ok(fs.existsSync(w), 'websocket/ has no pricing-adjust.js, and websocket/usage.js needs one');
    assert.strictEqual(fs.readFileSync(w, 'utf8'), a);
  });
  check('it is pure: requires only pricing', () => assert.deepStrictEqual([...a.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]), ['./pricing']));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
