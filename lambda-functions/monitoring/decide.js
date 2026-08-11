/**
 * The decision core of the monitoring subsystem.
 *
 * Deliberately pure: no AWS calls, no clock of its own, no I/O. Everything it
 * needs arrives as arguments and everything it decides comes back as a plain
 * object. That is what makes the interesting cases — a breaker that must not
 * release something a human disabled, a long trip that must not re-alert every
 * five minutes — testable without stubbing four AWS clients.
 *
 * The evaluator (evaluate-monitors.js) does all the talking to AWS and calls
 * this to find out what should happen.
 */

/**
 * Monitor state, as persisted between runs.
 *
 * @typedef {Object} MonitorState
 * @property {boolean} tripped        - is this monitor currently over its threshold
 * @property {string}  [trippedAt]    - ISO timestamp of the transition into tripped
 * @property {boolean} [enforcedByUs] - did WE apply the enforcement action.
 *   Load-bearing. If an operator disables SES sending by hand during an
 *   incident, and the trailing count then falls below the threshold, we must
 *   NOT helpfully switch sending back on underneath them. We only ever undo
 *   what we did.
 * @property {string}  [lastNotifiedAt] - ISO timestamp of the last alert sent
 */

const COMPARISONS = {
  '>': (value, threshold) => value > threshold,
  '>=': (value, threshold) => value >= threshold,
  '<': (value, threshold) => value < threshold,
  '<=': (value, threshold) => value <= threshold,
};

/**
 * Is a monitor switched on?
 *
 * Two sources, because "handy to turn on and off" should not require a
 * CloudFormation deploy. The registry carries the default; an SSM parameter
 * can override it at runtime. An absent or unparseable override means "no
 * opinion" and the registry wins — a typo in a parameter must not silently
 * disable a safety control.
 *
 * @param {Object} monitor
 * @param {string|undefined|null} override - raw SSM parameter value
 */
function isEnabled(monitor, override) {
  if (override === 'true' || override === 'on' || override === '1') return true;
  if (override === 'false' || override === 'off' || override === '0') return false;
  return monitor.enabled !== false;
}

/**
 * Decide what a single monitor's reading means.
 *
 * @param {Object}       args
 * @param {Object}       args.monitor
 * @param {number}       args.value    - the observed value for this window
 * @param {MonitorState} args.state    - persisted state from the previous run
 * @param {Date}         args.now
 * @returns {{
 *   breached: boolean,
 *   transition: 'tripped'|'recovered'|null,
 *   shouldNotify: boolean,
 *   shouldEnforce: boolean,
 *   shouldRelease: boolean,
 *   reason: string,
 *   nextState: MonitorState
 * }}
 */
function decide({ monitor, value, state = {}, now = new Date() }) {
  const compare = COMPARISONS[monitor.comparison || '>'];
  if (!compare) {
    throw new Error(`Monitor ${monitor.id}: unknown comparison "${monitor.comparison}"`);
  }

  const wasTripped = state.tripped === true;

  // Hysteresis. Releasing at the same number we tripped at makes a metric
  // hovering on the threshold flap between enforced and released, and each flap
  // is an SMS. `releaseThreshold` is the lower bar the value must fall back
  // under before we call it recovered. Defaults to the trip threshold, i.e. no
  // hysteresis, for monitors that do not want it.
  const releaseThreshold = typeof monitor.releaseThreshold === 'number'
    ? monitor.releaseThreshold
    : monitor.threshold;

  const breached = wasTripped
    ? compare(value, releaseThreshold)   // still breached until it clears the LOWER bar
    : compare(value, monitor.threshold);

  let transition = null;
  if (breached && !wasTripped) transition = 'tripped';
  if (!breached && wasTripped) transition = 'recovered';

  // Re-alert on a trip that stays tripped, so a breaker that trips at 3am and
  // is still down at noon does not go silent. Off by default.
  const renotifyAfterMs = (monitor.renotifyAfterMinutes || 0) * 60 * 1000;
  const lastNotified = state.lastNotifiedAt ? Date.parse(state.lastNotifiedAt) : NaN;
  const dueForRenotify = Boolean(
    breached
    && wasTripped
    && renotifyAfterMs > 0
    && Number.isFinite(lastNotified)
    && (now.getTime() - lastNotified) >= renotifyAfterMs
  );

  const shouldNotify = transition !== null || dueForRenotify;

  // Enforcement is opt-in per monitor. A monitor with no `enforce` block is
  // alert-only and can never change anything in the account.
  const canEnforce = Boolean(monitor.enforce);
  const shouldEnforce = canEnforce && transition === 'tripped';

  // Only release what we took. See MonitorState.enforcedByUs.
  const shouldRelease = canEnforce
    && transition === 'recovered'
    && state.enforcedByUs === true;

  let reason;
  if (transition === 'tripped') {
    reason = `${value} ${monitor.comparison || '>'} ${monitor.threshold}`;
  } else if (transition === 'recovered') {
    reason = `${value} back under ${releaseThreshold}`;
  } else if (dueForRenotify) {
    reason = `still breached at ${value}`;
  } else if (breached) {
    reason = `breached at ${value}, already alerted`;
  } else {
    reason = `${value} within limit`;
  }

  const nextState = {
    ...state,
    tripped: breached,
    trippedAt: transition === 'tripped' ? now.toISOString() : (breached ? state.trippedAt : undefined),
    lastNotifiedAt: shouldNotify ? now.toISOString() : state.lastNotifiedAt,
  };

  if (shouldEnforce) nextState.enforcedByUs = true;
  // Clear the flag once we have handed control back, so a later human-applied
  // disable is not mistaken for ours on the next cycle.
  if (shouldRelease) nextState.enforcedByUs = false;
  // Recovered without releasing means someone else owns the enforcement now.
  if (transition === 'recovered' && !shouldRelease) nextState.enforcedByUs = false;

  if (!breached) delete nextState.trippedAt;

  return { breached, transition, shouldNotify, shouldEnforce, shouldRelease, reason, nextState };
}

module.exports = { decide, isEnabled, COMPARISONS };
