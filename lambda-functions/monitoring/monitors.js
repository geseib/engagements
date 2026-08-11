/**
 * The monitor registry.
 *
 * One entry per thing being watched. Adding a monitor should be adding an
 * object here — not writing a Lambda, a rule and an alarm. That is the whole
 * point of the subsystem: the SES cap is the first customer, not the feature.
 *
 * Every monitor is:
 *
 *   id          stable, used as the SSM state key. Renaming one loses its
 *               state, which means one spurious "tripped" alert. Don't rename.
 *   enabled     the default. Overridable at runtime, without a deploy, via
 *               SSM at <STATE_PREFIX>/<id>/enabled = true|false.
 *   source      how to read the current value. See sources.js.
 *   window      trailing period, in minutes, that `source` should measure over.
 *   threshold   the number that trips it.
 *   comparison  '>' | '>=' | '<' | '<='   (default '>')
 *   releaseThreshold
 *               optional lower bar the value must fall back under before the
 *               monitor is called recovered. Prevents a metric sitting on the
 *               threshold from flapping, and each flap is an SMS.
 *   enforce     optional. Omit for alert-only. See actions.js for the verbs.
 *   renotifyAfterMinutes
 *               optional. Re-alert while still tripped, so a 3am trip that is
 *               still down at noon does not go silent.
 */

const monitors = [
  {
    id: 'ses-daily-send-cap',
    title: 'SES daily send volume',
    enabled: true,

    // Why this exists: SES production access lifted the sandbox limit to the
    // account's full quota, which is orders of magnitude more than this
    // product needs. AWS has no API to set a LOWER quota than the one you were
    // granted — you can request an increase; a decrease is a support case — so
    // a self-service cap has to be built rather than configured.
    //
    // Note as of writing NOTHING in this repo sends through SES. The Cognito
    // user pool in template-clean.yaml has no EmailConfiguration, so it is on
    // COGNITO_DEFAULT (Amazon's own mailer, its own ~50/day cap, never touches
    // SES). This monitor is therefore a guardrail installed before there is
    // traffic to guard — which is the good case. If Cognito is ever pointed at
    // SES, re-read the note on `enforce` below BEFORE deploying that change.
    source: {
      type: 'cloudwatch',
      namespace: 'AWS/SES',
      metricName: 'Send',
      statistic: 'Sum',
      // No dimensions: this is the account-wide send count, which is the thing
      // the quota is actually applied to.
      dimensions: [],
    },
    window: 24 * 60,          // trailing 24h, matching how SES applies its quota
    threshold: 25,
    comparison: '>',
    releaseThreshold: 20,     // must fall back under 20 before sending resumes

    enforce: {
      // Account-wide. SES's per-configuration-set switch would be narrower,
      // but nothing here sends through a configuration set, so there is no
      // narrower thing to switch off yet. If a configuration set is ever
      // introduced, prefer scoping this to it.
      //
      // THE SHARP EDGE, recorded because it is invisible at the call site: if
      // Cognito is later routed through SES, a tripped breaker also blocks
      // password-reset and verification email. A real user can be locked out
      // until the trailing 24h count rolls off. Today that risks nothing.
      type: 'ses-account-sending',
      release: 'auto',        // re-enable automatically once recovered
    },

    renotifyAfterMinutes: 6 * 60,

    describe: ({ value, threshold }) =>
      `SES has sent ${value} message(s) in the last 24 hours (cap ${threshold}).`,
  },

  // ---------------------------------------------------------------------
  // Example of the OTHER shape this subsystem is built for: a business
  // metric read out of DynamoDB rather than CloudWatch, alert-only, with no
  // enforcement verb at all. Shipped DISABLED — it is here to prove the
  // registry generalises and to be the template for the next one, not
  // because anybody asked to be paged about game volume.
  // ---------------------------------------------------------------------
  {
    id: 'games-created-per-day',
    title: 'Games created per day',
    enabled: false,
    source: {
      type: 'dynamodb-count',
      // Which table is a per-tier question, so it comes from the environment
      // rather than being baked in here.
      tableEnv: 'GAMES_TABLE_NAME',
      partition: 'GAMES',
      // Count rows whose createdAt falls inside the window.
      timestampAttribute: 'createdAt',
    },
    window: 24 * 60,
    threshold: 100,
    comparison: '>',
    // No `enforce` block: this one can only ever tell you something.
    describe: ({ value, threshold }) =>
      `${value} games created in the last 24 hours (expected under ${threshold}).`,
  },
];

function getMonitors() {
  return monitors;
}

function findMonitor(id) {
  return monitors.find((m) => m.id === id);
}

module.exports = { getMonitors, findMonitor };
