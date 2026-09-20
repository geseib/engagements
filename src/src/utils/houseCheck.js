/**
 * THE CONTENT CHECK ON ONE OF ENGAGE'S OWN SETS.
 *
 * A platform set is served to every organisation, so it reaches further than
 * anything in the public library, and until now nothing had ever measured one.
 * The owner's trigger: a set is checked when it is SWITCHED ON — the moment it
 * becomes servable to everybody, which is the analogue of an organisation
 * sharing theirs — and on demand.
 *
 * ── WHY THE CONSOLE FIRES IT AND NOT THE ACTIVATION ROUTE ──────────────────
 *
 * Because the activation route cannot. A check is a JOB: the POST that starts
 * one self-invokes the check function against its 900-second budget, which
 * needs `lambda:InvokeFunction` on that function. `AdminToggleQuestionSetFunction`
 * holds `DynamoDBCrudPolicy` and nothing else (template-clean.yaml), so an
 * invoke from inside it is an AccessDenied at run time — and an activation must
 * never fail because of a check, so it would have to be swallowed, which is a
 * trigger that looks like one and is not.
 *
 * So the activation ANSWERS with the fact — `checkDue: true`, which
 * `toggle-question-set.js` computes from the transition — and the console runs
 * the check. That keeps the owner's rule exactly: the activation has already
 * returned and the set is already live before a single byte of this is sent, so
 * the check cannot delay it and cannot fail it. What this route is NOT is a
 * guarantee: a console that is closed between the two calls leaves the check
 * unrun, and the on-demand control is the answer to that. Moving the dispatch
 * server-side is a four-line grant in the template and nothing else.
 *
 * ── AND NOBODY IS CHARGED FOR IT ───────────────────────────────────────────
 *
 * `checkPlatformSet` reserves no organisation's daily cap and records no units
 * against one: every counter check-quota writes is keyed `ORG#<id>`, and an
 * Engage set belongs to no organisation. The spend is on the set's own review
 * log instead. So firing this from the console costs a customer nothing.
 */
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from './adminApi';

/**
 * Did an activation just make one of Engage's sets servable to everybody?
 *
 * Read off the ANSWER rather than computed here: only the server knows whether
 * the row was inactive a moment ago, and `toggle-question-set.js` states the
 * field on every answer — true or false — so an absent one means a build that
 * does not say, not "no".
 */
export const checkIsDue = (body) => Boolean(body && body.checkDue === true);

/**
 * The check's own route, and NOT under `/admin`: the template mounts it at
 * `/question-sets/{setId}/check`, which is where ShareSetDialog and the score
 * card's re-check already post. No body flag selects the Engage branch, and
 * none could — the server answers a caller with an active organisation on the
 * organisation's own path, and one without on Engage's.
 */
const checkUrl = (setId) => adminApiUrl(`question-sets/${encodeURIComponent(setId)}/check`);

/**
 * Start it. Never throws: a check nobody asked for out loud must not be able to
 * take down the screen that triggered it, so a network failure comes back as a
 * sentence like every other refusal.
 *
 * @param {string} setId          the Engage set
 * @param {object} [opts]
 * @param {number} [opts.version] a version other than the active one
 * @returns {Promise<{ok: boolean, jobId?: string, version?: number, error?: string}>}
 */
export async function startHouseCheck(setId, { version } = {}) {
  try {
    const res = await authFetch(checkUrl(setId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(version ? { version } : {}),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error || `the server answered ${res.status}` };
    return { ok: true, jobId: body.jobId || '', version: body.version };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * What to say about it. One sentence, in the console's own voice, and it names
 * the set because the banner it lands in sits above a list of forty of them.
 *
 * A failure says the set is live REGARDLESS, because it is: the activation
 * finished before this ran, and a reader told only "the check could not start"
 * would reasonably wonder whether their set went on or not.
 */
export function houseCheckNotice(result, name) {
  const set = name ? `“${name}”` : 'the set';
  return result.ok
    ? { tone: 'success', text: `${set} is live to every organisation, and the content check is running on it. The result shows on its versions.` }
    : { tone: 'error', text: `${set} is live to every organisation, but the content check could not be started: ${result.error}. Run it from the set's Versions panel.` };
}
