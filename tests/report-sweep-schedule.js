/**
 * THE REPORT SWEEP RIDES THE ONE SCHEDULE THE STACK ALREADY HAS — and the
 * usage reconcile still runs once a day.
 *
 * template-clean.yaml is near CloudFormation's 500-resource ceiling, so the
 * sweep added NO resource: UsageReconcileFunction's single rule fires every 3
 * hours, usage-reconcile.js runs its own job on the first run of each UTC day
 * (a conditional claim) and hands every run's sweep to CreateReportFunction
 * by async invoke.
 *
 * Pinned:
 *   1. the resource count, the event-source count and the one Schedule did
 *      not grow (155 / 198 / 1 before this change);
 *   2. the wiring: rate(3 hours); the reconcile may invoke create-report and
 *      knows its name; create-report may invoke get-ai-summary, knows its name
 *      and has the time for a sweep;
 *   3. driving the handler: three scheduled runs in a day reconcile usage
 *      once and start the sweep three times; the next day reconciles again;
 *      a manual run reconciles at once and starts no sweep; a run that fails
 *      releases the day so the next run tries again.
 *
 * // rejects: a new function, rule or event; a second schedule; a cron that
 * //          still fires once a day (no sweep every 3h); a reconcile that runs
 * //          on every 3-hourly run or not at all; missing invoke permissions.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const H = require('./helpers/report-sweep-harness');

const REPO = path.join(__dirname, '..');
const TPL = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');

if (!process.env.DEBUG) { console.log = () => {}; console.error = () => {}; console.warn = () => {}; }
const { check, say } = H;

const resources = TPL.slice(TPL.indexOf('\nResources:'), TPL.indexOf('\nOutputs:'));
const block = (name) => {
  const start = resources.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `${name} not found`);
  const rest = resources.slice(start + 1);
  const next = rest.slice(3).search(/\n {2}[A-Za-z0-9]+:\s*\n/);
  return next < 0 ? rest : rest.slice(0, next + 3);
};

(async () => {
  say('\n1. no new resources');
  await check('155 top-level resources, as before the sweep', () =>
    assert.strictEqual((resources.match(/^ {2}[A-Za-z0-9]+:\s*$/gm) || []).length, 155));
  await check('198 event sources (each one expands into resources), as before', () =>
    assert.strictEqual((resources.match(/^ {8}[A-Za-z0-9]+:\s*\n {10}Type:/gm) || []).length, 198));
  await check('still exactly one Schedule in the stack', () =>
    assert.strictEqual((resources.match(/^ {10}Type: Schedule\s*$/gm) || []).length, 1));

  say('\n2. the wiring');
  const rec = block('UsageReconcileFunction');
  const cr = block('CreateReportFunction');
  await check('UsageReconcileFunction fires every 3 hours', () => {
    assert.ok(/Type:\s*Schedule/.test(rec));
    assert.ok(/Schedule:\s*rate\(3 hours\)/.test(rec), 'not rate(3 hours)');
  });
  await check('it names create-report and may invoke it', () => {
    assert.ok(/REPORT_SWEEP_FUNCTION_NAME:\s*!Sub '\$\{StackName\}-create-report'/.test(rec));
    assert.ok(/lambda:InvokeFunction\s*\n\s*Resource: !Sub 'arn:aws:lambda:\$\{AWS::Region\}:\$\{AWS::AccountId\}:function:\$\{StackName\}-create-report'/.test(rec));
  });
  await check('CreateReportFunction may start the Workie worker, and has time for a sweep', () => {
    assert.ok(/AI_SUMMARY_FUNCTION_NAME:\s*!Sub '\$\{StackName\}-get-ai-summary'/.test(cr));
    assert.ok(/lambda:InvokeFunction\s*\n\s*Resource: !Sub 'arn:aws:lambda:\$\{AWS::Region\}:\$\{AWS::AccountId\}:function:\$\{StackName\}-get-ai-summary'/.test(cr));
    assert.ok(/\n {6}Timeout: 300\n/.test(cr), 'Timeout is not 300');
    assert.ok(/kms:Decrypt/.test(cr) && /DynamoDBCrudPolicy/.test(cr));
  });

  say('\n3. once a day inside the 3-hourly schedule');
  process.env.REPORT_SWEEP_FUNCTION_NAME = 'test-create-report';
  const reconcile = require(path.join(REPO, 'lambda-functions/admin/usage-reconcile.js'));
  const scheduled = (iso) => ({ source: 'aws.events', 'detail-type': 'Scheduled Event', now: iso });
  const usageRuns = () => H.log.filter((l) => l.type === 'query' && (l.input.ExpressionAttributeValues || {})[':pk'] === 'ORGS').length;
  H.reset();
  const out = [];
  for (const t of ['2026-11-01T01:10:00.000Z', '2026-11-01T04:10:00.000Z', '2026-11-01T07:10:00.000Z']) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await reconcile.handler(scheduled(t)));
  }
  await check('three runs on one day: usage reconciled once', () => {
    assert.strictEqual(usageRuns(), 1);
    assert.strictEqual(out[0].orgs, 0);
    assert.strictEqual(out[1].usage, 'already-ran-today');
    assert.strictEqual(out[2].usage, 'already-ran-today');
  });
  await check('...and the report sweep started on every run', () => {
    assert.strictEqual(H.invokes.length, 3);
    assert.ok(H.invokes.every((p) => p.__reportSweep === true));
    assert.ok(out.every((o) => o.reportSweep && o.reportSweep.started === true));
  });
  await check('the day\'s claim is a dated row with a ttl', () => {
    const row = H.get('SCHEDULE#usage-reconcile', 'DAY#2026-11-01');
    assert.ok(row && row.ttl > 0);
  });
  await reconcile.handler(scheduled('2026-11-02T01:10:00.000Z'));
  await check('the next day\'s first run reconciles again', () => assert.strictEqual(usageRuns(), 2));
  const before = H.invokes.length;
  const manual = await reconcile.handler({ now: '2026-11-02T05:00:00.000Z' });
  await check('a manual run reconciles at once (same result shape) and starts no sweep', () => {
    assert.strictEqual(usageRuns(), 3);
    assert.deepStrictEqual(Object.keys(manual).sort(), ['orgs', 'repaired']);
    assert.strictEqual(H.invokes.length, before);
  });
  const realSend = H.fakeDoc.send;
  H.fakeDoc.send = async (c) => {
    if (c.type === 'query' && (c.input.ExpressionAttributeValues || {})[':pk'] === 'ORGS') throw new Error('table down');
    return realSend(c);
  };
  await reconcile.handler(scheduled('2026-11-03T01:10:00.000Z')).catch(() => null);
  H.fakeDoc.send = realSend;
  await check('a run that fails outright releases the day', () =>
    assert.strictEqual(H.get('SCHEDULE#usage-reconcile', 'DAY#2026-11-03'), undefined));
  await reconcile.handler(scheduled('2026-11-03T04:10:00.000Z'));
  await check('so the next run that day reconciles', () =>
    assert.ok(H.get('SCHEDULE#usage-reconcile', 'DAY#2026-11-03')));

  const { pass, fail } = H.counts();
  say(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
