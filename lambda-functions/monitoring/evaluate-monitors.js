/**
 * The scheduled evaluator.
 *
 * EventBridge runs this on a fixed interval (see template-monitoring.yaml).
 * For each enabled monitor: read its value, decide what that means, and carry
 * out whatever the decision says — notify, enforce, release, or nothing.
 *
 * Design rule: ONE MONITOR'S FAILURE MUST NOT SILENCE THE OTHERS. Every
 * monitor is evaluated inside its own try/catch, and the handler reports a
 * per-monitor outcome rather than throwing at the first problem. A monitoring
 * system that stops monitoring because one metric was unreadable is worse than
 * none, because it still looks installed.
 */

const { getMonitors } = require('./monitors');
const { decide, isEnabled } = require('./decide');
const sources = require('./sources');
const actions = require('./actions');
const stateStore = require('./state');

async function evaluateOne(monitor, deps) {
  const override = await stateStore.readEnabledOverride(monitor.id, deps);

  if (!isEnabled(monitor, override)) {
    return { id: monitor.id, status: 'skipped', reason: 'disabled' };
  }

  const value = await sources.readValue(monitor, deps);
  const state = await stateStore.readState(monitor.id, deps);
  const decision = decide({ monitor, value, state, now: deps.now });

  let enforcementNote;

  // Enforce BEFORE notifying, so the alert can truthfully say what was done.
  // If enforcement fails we still alert — an un-capped overage the operator
  // knows about beats a silent one — and we do not record enforcedByUs, so the
  // recovery path will not later "release" something we never took.
  if (decision.shouldEnforce) {
    try {
      enforcementNote = await actions.enforce(monitor, deps);
    } catch (err) {
      console.error(`Monitor ${monitor.id}: enforcement FAILED:`, err);
      enforcementNote = `Automatic enforcement FAILED (${err.message}). Manual action needed.`;
      decision.nextState.enforcedByUs = false;
    }
  }

  if (decision.shouldRelease) {
    try {
      enforcementNote = await actions.release(monitor, deps);
    } catch (err) {
      console.error(`Monitor ${monitor.id}: release FAILED:`, err);
      enforcementNote = `Automatic release FAILED (${err.message}). Sending may still be disabled.`;
      // Keep the flag set: we still own the enforcement, so the next cycle
      // should try to hand it back rather than forgetting it was ours.
      decision.nextState.enforcedByUs = true;
    }
  }

  if (decision.shouldNotify) {
    const message = actions.composeMessage({ monitor, value, decision, enforcementNote });
    await actions.notify({
      topicArn: deps.topicArn,
      subject: `${decision.transition === 'recovered' ? 'RECOVERED' : 'ALERT'}: ${monitor.title || monitor.id}`,
      message,
      sns: deps.sns,
    });
  }

  // State is written last. If anything above threw, the monitor stays in its
  // previous state and the next cycle re-evaluates from scratch — which for a
  // trip means it will try to enforce again rather than assuming it worked.
  await stateStore.writeState(monitor.id, decision.nextState, deps);

  return {
    id: monitor.id,
    status: 'evaluated',
    value,
    threshold: monitor.threshold,
    breached: decision.breached,
    transition: decision.transition,
    notified: decision.shouldNotify,
    enforced: decision.shouldEnforce,
    released: decision.shouldRelease,
    reason: decision.reason,
  };
}

exports.handler = async (event, context, injected) => {
  const deps = injected || {
    now: new Date(),
    topicArn: process.env.ALERT_TOPIC_ARN,
    ...sources.defaultClients(),
    ...actions.defaultClients(),
    ...stateStore.defaultClients(),
  };
  if (!deps.now) deps.now = new Date();

  // The registry is injectable so the evaluator's orchestration — per-monitor
  // isolation, enforce-before-notify, state-written-last — can be tested
  // against a controlled set instead of whatever ships in monitors.js.
  const registry = deps.monitors || getMonitors();

  const results = [];
  for (const monitor of registry) {
    try {
      results.push(await evaluateOne(monitor, deps));
    } catch (err) {
      console.error(`Monitor ${monitor.id} failed:`, err);
      results.push({ id: monitor.id, status: 'error', error: err.message });

      // A monitor that cannot be read is itself worth knowing about — a
      // breaker silently failing to evaluate looks exactly like a quiet day.
      try {
        await actions.notify({
          topicArn: deps.topicArn,
          subject: `MONITOR ERROR: ${monitor.id}`,
          message: `Monitor ${monitor.id} could not be evaluated: ${err.message}`,
          sns: deps.sns,
        });
      } catch (notifyErr) {
        console.error('Could not send the monitor-error alert either:', notifyErr);
      }
    }
  }

  console.log(JSON.stringify({ evaluated: results }, null, 2));
  return { statusCode: 200, results };
};

exports.evaluateOne = evaluateOne;
