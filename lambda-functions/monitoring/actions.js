/**
 * Actions — the two things a monitor can do about what it found.
 *
 *   notify()   always available, never changes anything in the account
 *   enforce()  opt-in per monitor, and its exact inverse release()
 *
 * Every enforcement verb MUST have a release that undoes precisely it. A
 * breaker with no way back is an outage waiting for someone to notice.
 */

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { SESv2Client, PutAccountSendingAttributesCommand } = require('@aws-sdk/client-sesv2');

/**
 * SES account-wide sending switch.
 *
 * This is the only lever that works when the sender is something we do not
 * control — Cognito calls SES directly, so no amount of gating in this repo's
 * own code would stop it. The cost of that reach is that it is account-wide:
 * it stops every SES sender in the account, not just the one that ran away.
 */
async function setSesAccountSending(enabled, { sesv2 }) {
  await sesv2.send(new PutAccountSendingAttributesCommand({ SendingEnabled: enabled }));
  console.log(`SES account sending -> ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

const ENFORCERS = {
  'ses-account-sending': {
    apply: (deps) => setSesAccountSending(false, deps),
    release: (deps) => setSesAccountSending(true, deps),
    describeApply: 'SES account-wide sending has been DISABLED.',
    describeRelease: 'SES account-wide sending has been re-enabled.',
  },
};

async function enforce(monitor, deps) {
  const verb = ENFORCERS[monitor.enforce.type];
  if (!verb) throw new Error(`Monitor ${monitor.id}: unknown enforce type "${monitor.enforce.type}"`);
  await verb.apply(deps);
  return verb.describeApply;
}

async function release(monitor, deps) {
  const verb = ENFORCERS[monitor.enforce.type];
  if (!verb) throw new Error(`Monitor ${monitor.id}: unknown enforce type "${monitor.enforce.type}"`);
  await verb.release(deps);
  return verb.describeRelease;
}

/**
 * Compose the alert text.
 *
 * Kept short and front-loaded on purpose: this arrives as an SMS, where only
 * the first ~40 characters are visible on a lock screen. The monitor id and
 * what happened come first; the explanation follows for the email copy.
 */
function composeMessage({ monitor, value, decision, enforcementNote }) {
  const head = decision.transition === 'recovered'
    ? `RECOVERED ${monitor.id}`
    : `ALERT ${monitor.id}`;

  const body = monitor.describe
    ? monitor.describe({ value, threshold: monitor.threshold })
    : `${monitor.title || monitor.id}: ${value} (threshold ${monitor.threshold})`;

  const lines = [`${head}: ${body}`];
  if (enforcementNote) lines.push(enforcementNote);
  if (decision.transition === 'tripped' && !monitor.enforce) {
    lines.push('No automatic action was taken - this monitor is alert-only.');
  }
  lines.push(`Reason: ${decision.reason}`);
  return lines.join(' ');
}

async function notify({ topicArn, subject, message, sns }) {
  if (!topicArn) {
    console.warn('No ALERT_TOPIC_ARN set; alert not sent:', message);
    return false;
  }
  await sns.send(new PublishCommand({
    TopicArn: topicArn,
    // SNS truncates Subject at 100 chars and rejects newlines. Email
    // subscriptions use it; SMS ignores it entirely.
    Subject: String(subject).slice(0, 100).replace(/\s+/g, ' '),
    Message: message,
  }));
  return true;
}

function defaultClients() {
  return {
    sns: new SNSClient({}),
    sesv2: new SESv2Client({}),
  };
}

module.exports = { enforce, release, notify, composeMessage, defaultClients, ENFORCERS };
