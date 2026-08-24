/**
 * THE 402 REFUSAL, RECOGNISED IN ONE PLACE.
 *
 * A personal space is free and has an allowance (5 sessions a month, 5 sets
 * held at once — mockup 12). When it is spent, the API answers:
 *
 *   HTTP 402
 *   { code: 'upgrade_required', upgradeRequired: true,
 *     limit:   { kind, used, included, period, ... },
 *     upgrade: { plan, priceLabel, ... } }
 *
 * WHY A SHARED HELPER AND NOT AN `if (res.status === 402)` PER SCREEN. Four
 * screens can hit this — creating a set, starting a session, copying from the
 * public library, uploading. Four copies of the same status test is four places
 * for the shape to drift from the backend, and the failure mode is silent: a
 * screen that does not recognise the refusal shows a generic "something went
 * wrong", which is the one message the design set exists to avoid. The whole
 * argument on 12 is that a limit is stated in advance and never mysterious.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: draw anything. No billing UI lives here.
 * It returns the parts a screen needs and lets each screen say them in its own
 * words, because the sentence that belongs above a question-set form is not the
 * one that belongs on the host's front door.
 *
 * NOTHING IS EVER BLOCKED MID-SESSION (RATIONALE §3). A limit only ever stops
 * you STARTING something; a room already in front of you keeps working to the
 * end. So a 402 is always a refusal to begin, never an interruption, and the
 * copy a caller writes from `blocked` should say so.
 */

/** The status the API answers with. */
export const UPGRADE_REQUIRED_STATUS = 402;

/** The machine-readable code in the body, checked as well as the status. */
export const UPGRADE_REQUIRED_CODE = 'upgrade_required';

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Is this the allowance refusal?
 *
 * BOTH HALVES ARE CHECKED, and either one alone is enough to say yes. 402 is a
 * rare enough status that a bare one from an edge or a proxy is still this
 * refusal in spirit, and a body carrying `code: 'upgrade_required'` is this
 * refusal whatever a gateway rewrote the status to. Requiring both would make
 * the helper fail exactly when it is most needed.
 *
 * @param {{status?: number}|number|null} response a Response, or a bare status
 * @param {object|null} body the parsed JSON body, when the caller has it
 */
export function isUpgradeRequired(response, body) {
  const status = typeof response === 'number' ? response : Number(response?.status);
  if (status === UPGRADE_REQUIRED_STATUS) return true;
  if (!isObject(body)) return false;
  return body.upgradeRequired === true || body.code === UPGRADE_REQUIRED_CODE;
}

/**
 * The parts a screen needs, or null when this is not the refusal.
 *
 * EVERY FIELD IS OPTIONAL AND EVERY FIELD IS NORMALISED. A screen that has to
 * write `limit?.used ?? 0` four times will eventually write it three times, and
 * the fourth renders "undefined of undefined" over somebody's shoulder. `used`
 * and `included` come back as numbers or null — never undefined, never a
 * string — so `used > included` is a question a caller can ask directly.
 *
 * @param {{status?: number}|number|null} response
 * @param {object|null} body the parsed JSON body
 * @returns {null | {
 *   blocked: boolean, kind: string, used: number|null, included: number|null,
 *   period: string, plan: string, priceLabel: string, message: string,
 *   limit: object, upgrade: object
 * }}
 */
export function parseUpgradeRequired(response, body) {
  if (!isUpgradeRequired(response, body)) return null;
  const payload = isObject(body) ? body : {};
  const limit = isObject(payload.limit) ? payload.limit : {};
  const upgrade = isObject(payload.upgrade) ? payload.upgrade : {};
  const num = (value) => (Number.isFinite(Number(value)) && value !== null && value !== ''
    ? Number(value)
    : null);

  return {
    /* Always true when we got here. Named rather than implied so a caller
       reads `if (refusal.blocked)` and not `if (refusal)`, which is the same
       test spelled in a way that hides what it means. */
    blocked: true,
    kind: String(limit.kind || payload.kind || ''),
    used: num(limit.used),
    included: num(limit.included ?? limit.limit),
    period: String(limit.period || ''),
    plan: String(upgrade.plan || ''),
    priceLabel: String(upgrade.priceLabel || upgrade.price || ''),
    /* The API's own sentence when it has one. A caller should prefer its own
       copy: a generic server string is how a screen ends up saying less than
       it knows. */
    message: String(payload.message || ''),
    limit,
    upgrade,
  };
}

/**
 * The same thing from a live `Response`, without consuming the caller's body.
 *
 * `response.clone()` because a caller that gets null back must still be able to
 * read its own error body — reading it here would leave them with a used stream
 * and an unhelpful TypeError several lines later.
 *
 * @param {Response} response
 * @returns {Promise<null|object>}
 */
export async function readUpgradeRequired(response) {
  if (!response) return null;
  if (!isUpgradeRequired(response, null)) return null;
  let body = null;
  try {
    body = await (typeof response.clone === 'function' ? response.clone() : response).json();
  } catch (err) {
    /* A 402 with an unreadable body is still a refusal — it just carries no
       numbers. Saying "you are at your limit" with no arithmetic beats saying
       "something went wrong". */
    body = null;
  }
  return parseUpgradeRequired(response, body);
}

export default parseUpgradeRequired;
