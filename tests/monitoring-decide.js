/**
 * Monitoring subsystem regression tests.
 *
 * Two halves:
 *   1. decide() — the pure core. No stubs at all; it takes no I/O.
 *   2. the evaluator — wired with injected fakes, to prove the orchestration
 *      (enforce-before-notify, per-monitor isolation, state written last).
 *
 * The AWS SDK packages the monitoring modules import are not installed at the
 * repo root — @aws-sdk/client-cloudwatch, -sesv2, -sns, -ssm live only in the
 * deployed bundle. So they are stubbed BY MODULE NAME through Module._load,
 * the same technique tests/delete-question-set-flow.js uses and for the same
 * reason: the require.cache-by-resolved-path trick cannot resolve a package
 * that is not on disk.
 */
const path = require('path');
const assert = require('assert');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

class Cmd { constructor(input) { this.input = input; } }
stub('@aws-sdk/client-cloudwatch', { CloudWatchClient: class {}, GetMetricStatisticsCommand: Cmd });
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => ({}) },
  QueryCommand: Cmd,
});
stub('@aws-sdk/client-sns', { SNSClient: class {}, PublishCommand: Cmd });
stub('@aws-sdk/client-sesv2', { SESv2Client: class {}, PutAccountSendingAttributesCommand: Cmd });
stub('@aws-sdk/client-ssm', {
  SSMClient: class {},
  GetParameterCommand: Cmd,
  PutParameterCommand: Cmd,
  ParameterNotFound: class ParameterNotFound extends Error {},
});

const REPO = path.join(__dirname, '..');
const { decide, isEnabled } = require(path.join(REPO, 'lambda-functions/monitoring/decide'));
const { composeMessage } = require(path.join(REPO, 'lambda-functions/monitoring/actions'));
const { cloudwatchSum } = require(path.join(REPO, 'lambda-functions/monitoring/sources'));

const say = (s) => process.stdout.write(`${s}\n`);
let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const NOW = new Date('2026-08-11T12:00:00Z');

// A monitor shaped exactly like the real SES one, so the tests exercise the
// configuration that actually ships rather than a convenient simplification.
const sesLike = {
  id: 'ses-daily-send-cap',
  title: 'SES daily send volume',
  threshold: 25,
  comparison: '>',
  releaseThreshold: 20,
  enforce: { type: 'ses-account-sending', release: 'auto' },
  renotifyAfterMinutes: 360,
};
const alertOnly = { id: 'games', title: 'Games', threshold: 100, comparison: '>' };

(async () => {
  say('monitoring: the decision core\n');

  // 1. Quiet ------------------------------------------------------------------
  // rejects: a decide() that notifies on every run rather than on transitions.
  {
    const d = decide({ monitor: sesLike, value: 3, state: {}, now: NOW });
    check('under the threshold, nothing happens', () => {
      assert.strictEqual(d.breached, false);
      assert.strictEqual(d.transition, null);
      assert.strictEqual(d.shouldNotify, false);
      assert.strictEqual(d.shouldEnforce, false);
    });
  }

  // 2. The trip ---------------------------------------------------------------
  // rejects: dropping the enforce call, or notifying without enforcing.
  {
    const d = decide({ monitor: sesLike, value: 26, state: {}, now: NOW });
    check('crossing the threshold trips, alerts and enforces', () => {
      assert.strictEqual(d.transition, 'tripped');
      assert.strictEqual(d.shouldNotify, true);
      assert.strictEqual(d.shouldEnforce, true);
      assert.strictEqual(d.nextState.tripped, true);
    });
    check('...and records that WE were the one who enforced', () =>
      assert.strictEqual(d.nextState.enforcedByUs, true));
    check('...and stamps when it tripped', () =>
      assert.strictEqual(d.nextState.trippedAt, NOW.toISOString()));
  }

  // 3. Exactly at the threshold ----------------------------------------------
  // The cap is "no more than 25", so 25 is allowed and 26 is not. Off-by-one
  // here is the difference between a 25-cap and a 24-cap.
  // rejects: flipping '>' to '>=' in the registry or the comparison table.
  {
    const at = decide({ monitor: sesLike, value: 25, state: {}, now: NOW });
    check('25 is within a cap of 25 (the comparison is >, not >=)', () =>
      assert.strictEqual(at.breached, false, 'a 25/day cap must permit the 25th send'));
  }

  // 4. Staying tripped --------------------------------------------------------
  // rejects: re-alerting every five minutes, which is 288 SMS a day.
  {
    const state = { tripped: true, enforcedByUs: true, lastNotifiedAt: NOW.toISOString() };
    const d = decide({ monitor: sesLike, value: 40, state, now: new Date(NOW.getTime() + 5 * 60000) });
    check('still breached does not re-alert on the next cycle', () => {
      assert.strictEqual(d.transition, null);
      assert.strictEqual(d.shouldNotify, false);
      assert.strictEqual(d.shouldEnforce, false, 'must not re-apply an enforcement already in place');
    });
  }

  // 5. Hysteresis -------------------------------------------------------------
  // rejects: deleting releaseThreshold, which lets a value hovering at 25/26
  //          flap enforced/released and fire an SMS on every flap.
  {
    const state = { tripped: true, enforcedByUs: true };
    const between = decide({ monitor: sesLike, value: 22, state, now: NOW });
    check('a value between release and trip thresholds stays tripped', () => {
      assert.strictEqual(between.breached, true, '22 is under 25 but not yet under 20');
      assert.strictEqual(between.transition, null);
      assert.strictEqual(between.shouldRelease, false);
    });
  }

  // 6. Recovery ---------------------------------------------------------------
  // rejects: never releasing, i.e. a breaker with no way back.
  {
    const state = { tripped: true, enforcedByUs: true, trippedAt: '2026-08-10T00:00:00Z' };
    const d = decide({ monitor: sesLike, value: 4, state, now: NOW });
    check('falling under the release threshold recovers and releases', () => {
      assert.strictEqual(d.transition, 'recovered');
      assert.strictEqual(d.shouldRelease, true);
      assert.strictEqual(d.shouldNotify, true);
      assert.strictEqual(d.nextState.tripped, false);
    });
    check('...and hands ownership back', () =>
      assert.strictEqual(d.nextState.enforcedByUs, false));
    check('...and clears the trip timestamp', () =>
      assert.strictEqual(d.nextState.trippedAt, undefined));
  }

  // 7. THE ONE THAT MATTERS ---------------------------------------------------
  // An operator disables SES by hand mid-incident. The count then falls. We
  // must NOT switch sending back on underneath them.
  // rejects: releasing on `transition === 'recovered'` alone, without the
  //          enforcedByUs guard. That is the obvious implementation and it
  //          silently overrides a human's deliberate action.
  {
    const state = { tripped: true, enforcedByUs: false };
    const d = decide({ monitor: sesLike, value: 1, state, now: NOW });
    check('recovery does NOT release an enforcement we did not apply', () => {
      assert.strictEqual(d.transition, 'recovered');
      assert.strictEqual(d.shouldRelease, false,
        'released a breaker a human had set by hand');
      assert.strictEqual(d.shouldNotify, true, 'should still say it recovered');
    });
  }

  // 8. Re-notify --------------------------------------------------------------
  // rejects: dropping renotifyAfterMinutes, so a 3am trip is silent by noon.
  {
    const state = { tripped: true, enforcedByUs: true, lastNotifiedAt: '2026-08-11T05:00:00Z' };
    const due = decide({ monitor: sesLike, value: 40, state, now: NOW });   // 7h later
    check('a long-running trip re-alerts after the configured interval', () => {
      assert.strictEqual(due.shouldNotify, true);
      assert.strictEqual(due.transition, null, 're-notify is not a new transition');
      assert.strictEqual(due.shouldEnforce, false);
    });

    const notDue = decide({
      monitor: sesLike, value: 40,
      state: { tripped: true, enforcedByUs: true, lastNotifiedAt: '2026-08-11T11:00:00Z' },
      now: NOW,                                                             // 1h later
    });
    check('...but not before it', () => assert.strictEqual(notDue.shouldNotify, false));
  }

  // 9. Alert-only monitors ----------------------------------------------------
  // rejects: enforcing on a monitor with no enforce block, i.e. a business
  //          metric acquiring the power to change account settings.
  {
    const d = decide({ monitor: alertOnly, value: 500, state: {}, now: NOW });
    check('a monitor with no enforce block alerts but never acts', () => {
      assert.strictEqual(d.transition, 'tripped');
      assert.strictEqual(d.shouldNotify, true);
      assert.strictEqual(d.shouldEnforce, false);
    });
    const rec = decide({ monitor: alertOnly, value: 1, state: { tripped: true }, now: NOW });
    check('...and never releases either', () =>
      assert.strictEqual(rec.shouldRelease, false));
  }

  // 10. The enable switch -----------------------------------------------------
  // rejects: a typo'd SSM value ("flase") silently disabling a safety control.
  check('the registry default applies with no override', () => {
    assert.strictEqual(isEnabled({ enabled: true }, undefined), true);
    assert.strictEqual(isEnabled({ enabled: false }, undefined), false);
    assert.strictEqual(isEnabled({}, undefined), true, 'absent `enabled` means on');
  });
  check('an SSM override wins over the registry, both ways', () => {
    assert.strictEqual(isEnabled({ enabled: true }, 'false'), false);
    assert.strictEqual(isEnabled({ enabled: false }, 'true'), true);
  });
  check('an unrecognised override is ignored, not treated as off', () => {
    assert.strictEqual(isEnabled({ enabled: true }, 'flase'), true);
    assert.strictEqual(isEnabled({ enabled: true }, ''), true);
  });

  // 11. An unknown comparison is a crash, not a silent pass -------------------
  // rejects: defaulting an unknown comparison to `() => false`, which would
  //          make a misconfigured monitor look permanently healthy.
  check('an unknown comparison throws rather than never firing', () =>
    assert.throws(() => decide({
      monitor: { id: 'x', threshold: 1, comparison: '~=' }, value: 5, state: {}, now: NOW,
    }), /unknown comparison/));

  // 12. Alert copy ------------------------------------------------------------
  // rejects: an SMS whose first 40 characters do not say which monitor fired.
  {
    const d = decide({ monitor: sesLike, value: 31, state: {}, now: NOW });
    const msg = composeMessage({
      monitor: sesLike, value: 31, decision: d,
      enforcementNote: 'SES account-wide sending has been DISABLED.',
    });
    check('the alert leads with the monitor id and the action taken', () => {
      assert(msg.startsWith('ALERT ses-daily-send-cap'), msg);
      assert(msg.includes('31'), msg);
      assert(msg.includes('DISABLED'), msg);
    });

    const recMsg = composeMessage({
      monitor: sesLike, value: 2,
      decision: decide({ monitor: sesLike, value: 2, state: { tripped: true, enforcedByUs: true }, now: NOW }),
      enforcementNote: 'SES account-wide sending has been re-enabled.',
    });
    check('a recovery reads as a recovery, not another alarm', () =>
      assert(recMsg.startsWith('RECOVERED ses-daily-send-cap'), recMsg));

    const quiet = composeMessage({
      monitor: alertOnly, value: 500,
      decision: decide({ monitor: alertOnly, value: 500, state: {}, now: NOW }),
    });
    check('an alert-only monitor says plainly that nothing was done', () =>
      assert(/alert-only/.test(quiet), quiet));
  }

  // 13. CloudWatch summing ----------------------------------------------------
  // rejects: reading Datapoints[0] instead of summing, which would report one
  //          hour's sends as if it were the day's.
  {
    const fake = { send: async () => ({ Datapoints: [{ Sum: 10 }, { Sum: 7 }, { Sum: 4 }] }) };
    const total = await cloudwatchSum({
      source: { namespace: 'AWS/SES', metricName: 'Send', statistic: 'Sum' },
      windowMinutes: 1440, now: NOW, cloudwatch: fake,
    });
    check('the trailing window sums every hourly datapoint', () =>
      assert.strictEqual(total, 21));
  }
  {
    // CloudWatch publishes NO datapoints for a metric with no activity - it
    // does not emit zeros. An implementation that treats "empty" as "unknown"
    // and skips evaluation would never trip on the first send of a quiet day.
    // rejects: returning null/undefined for an empty Datapoints array.
    const fake = { send: async () => ({ Datapoints: [] }) };
    const total = await cloudwatchSum({
      source: { namespace: 'AWS/SES', metricName: 'Send' },
      windowMinutes: 1440, now: NOW, cloudwatch: fake,
    });
    check('no datapoints means zero, not unknown', () => assert.strictEqual(total, 0));
  }
  {
    // rejects: hardcoding a 24h window instead of honouring monitor.window.
    let captured;
    const fake = { send: async (cmd) => { captured = cmd.input; return { Datapoints: [] }; } };
    await cloudwatchSum({
      source: { namespace: 'AWS/SES', metricName: 'Send' },
      windowMinutes: 60, now: NOW, cloudwatch: fake,
    });
    check('the requested window is the one asked for', () =>
      assert.strictEqual(NOW.getTime() - captured.StartTime.getTime(), 60 * 60 * 1000));
  }

  // ---- the evaluator --------------------------------------------------------
  say('\nmonitoring: the evaluator\n');

  const { handler } = require(path.join(REPO, 'lambda-functions/monitoring/evaluate-monitors'));

  // A controlled registry, injected. The second monitor's source type does not
  // exist, so readValue throws — that is the point of it.
  const twoMonitors = [
    { ...sesLike, source: { type: 'cloudwatch', namespace: 'AWS/SES', metricName: 'Send' }, window: 1440 },
    { id: 'explodes', title: 'Broken', threshold: 1, window: 60, source: { type: 'nope' } },
  ];

  function harness({ value, state = {}, enforceThrows = false }) {
    const calls = { published: [], ses: [], written: [] };
    const deps = {
      now: NOW,
      monitors: twoMonitors,
      topicArn: 'arn:aws:sns:us-east-1:1:alerts',
      cloudwatch: { send: async () => ({ Datapoints: [{ Sum: value }] }) },
      ddb: { send: async () => ({ Items: [] }) },
      sns: { send: async (c) => { calls.published.push(c.input); } },
      sesv2: {
        send: async (c) => {
          if (enforceThrows) throw new Error('AccessDenied');
          calls.ses.push(c.input);
        },
      },
      ssm: {
        send: async (c) => {
          if (c.input.Value !== undefined) { calls.written.push(c.input); return {}; }
          if (String(c.input.Name).endsWith('/enabled')) {
            const e = new Error('not found'); e.name = 'ParameterNotFound'; throw e;
          }
          return { Parameter: { Value: JSON.stringify(state) } };
        },
      },
    };
    return { deps, calls };
  }

  // rejects: a handler that throws on the first bad monitor, taking every
  //          later monitor - including the SES breaker - down with it.
  {
    const { deps, calls } = harness({ value: 30 });
    const res = await handler({}, {}, deps);
    check('one monitor failing does not stop the others', () => {
      const ses = res.results.find((r) => r.id === 'ses-daily-send-cap');
      const bad = res.results.find((r) => r.id === 'explodes');
      assert.strictEqual(bad.status, 'error', 'the broken monitor should report an error');
      assert.strictEqual(ses.status, 'evaluated', 'the SES monitor must still be evaluated');
      assert.strictEqual(ses.transition, 'tripped');
    });
    check('...and the failure is itself alerted, not swallowed', () =>
      assert(calls.published.some((p) => /MONITOR ERROR/.test(p.Subject)),
        `subjects: ${calls.published.map((p) => p.Subject).join(' | ')}`));
    check('a trip actually calls SES with SendingEnabled false', () =>
      assert.deepStrictEqual(calls.ses, [{ SendingEnabled: false }]));
  }

  // rejects: giving up on the alert when enforcement fails - the case where
  //          knowing is most urgent, because nothing is capping the overage.
  {
    const { deps, calls } = harness({ value: 30, enforceThrows: true });
    await handler({}, {}, deps);
    check('a failed enforcement still alerts, and says it failed', () => {
      // Match on Message, not Subject: the subject carries the human title and
      // SMS subscriptions never see it at all.
      const alert = calls.published.find((p) => /ses-daily-send-cap/.test(p.Message));
      assert(alert, `no alert was sent at all (subjects: ${calls.published.map((p) => p.Subject).join(' | ')})`);
      assert(/FAILED/.test(alert.Message), alert.Message);
      assert(/Manual action needed/.test(alert.Message), alert.Message);
    });
    check('...and does not claim ownership it never took', () => {
      const written = calls.written.find((w) => /ses-daily-send-cap/.test(w.Name));
      assert.strictEqual(JSON.parse(written.Value).enforcedByUs, false,
        'recorded enforcedByUs after the enforcement threw - the next recovery would ' +
        'then "release" something it never applied');
    });
  }

  // rejects: writing state before acting, which on a mid-run crash would leave
  //          the monitor believing it had already enforced.
  {
    const { deps, calls } = harness({ value: 2, state: { tripped: true, enforcedByUs: true } });
    await handler({}, {}, deps);
    check('recovery re-enables SES and records the handover', () => {
      assert.deepStrictEqual(calls.ses, [{ SendingEnabled: true }]);
      const written = calls.written.find((w) => /ses-daily-send-cap/.test(w.Name));
      assert.strictEqual(JSON.parse(written.Value).enforcedByUs, false);
      assert.strictEqual(JSON.parse(written.Value).tripped, false);
    });
  }

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write(`harness error: ${e && e.stack}\n`); process.exit(1); });
