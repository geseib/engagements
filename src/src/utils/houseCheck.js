/**
 * THE CONTENT CHECK ON ONE OF ENGAGE'S OWN SETS.
 *
 * A platform set is served to every organisation, so it reaches further than
 * anything in the public library, and until now nothing had ever measured one.
 * The owner's trigger: a set is checked when it is SWITCHED ON — the moment it
 * becomes servable to everybody, which is the analogue of an organisation
 * sharing theirs — and on demand.
 *
 * ── THE SERVER FIRES IT NOW, AND THIS FILE NO LONGER DOES ──────────────────
 *
 * It used to be the console's job. The routes that change one of Engage's sets
 * held no `lambda:InvokeFunction`, so they could not dispatch a job, and they
 * answered `checkDue` for this file to act on instead. That worked and was not
 * a guarantee: a console closed between the write and the post left a set live
 * and unchecked, and nothing ever noticed.
 *
 * The grant exists now, so `admin/shared/house-check.js` dispatches the check
 * from inside the activation, the save and the promote, after each has landed.
 * There is exactly ONE trigger, and it is not here.
 *
 * What is left of this file is the two things the console still owns:
 *
 *   `checkIsDue` + `houseCheckNotice`   TELLING THE PERSON. The routes still
 *                                       answer `checkDue`, and it is still true
 *                                       — it is what the sentence in the banner
 *                                       is built from.
 *   `startHouseCheck`                   THE ON-DEMAND CONTROL, in the Versions
 *                                       panel (QuestionSetEditor). A deliberate
 *                                       press, not a trigger: a set that was
 *                                       already on when checking arrived, and a
 *                                       dispatch that never went, are both
 *                                       answered by asking for one by hand.
 *
 * ── AND NOBODY IS CHARGED FOR IT ───────────────────────────────────────────
 *
 * `checkPlatformSet` reserves no organisation's daily cap and records no units
 * against one: every counter check-quota writes is keyed `ORG#<id>`, and an
 * Engage set belongs to no organisation. The spend is on the set's own review
 * log instead. So asking for one by hand costs a customer nothing.
 */
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from './adminApi';

/**
 * Did this change just make one of Engage's sets newly servable to everybody —
 * and so start a check on it?
 *
 * Read off the ANSWER rather than computed here: only the server knows whether
 * the row was inactive a moment ago, and `toggle-question-set.js` states the
 * field on every answer — true or false — so an absent one means a build that
 * does not say, not "no". The same field comes back from a save
 * (`upload-questions.js`) and a promote (`promote-set-version.js`).
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
 * THE ON-DEMAND CONTROL, asked for by a person in the Versions panel. Not a
 * trigger — the activation, the save and the promote each start their own check
 * server-side — but the way a check that never ran gets run.
 *
 * Never throws: a refusal must not be able to take down the panel it was
 * pressed from, so a network failure comes back as a sentence like every other
 * refusal.
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
 * IT LEADS WITH THE SET BEING LIVE, because that is what the person pressed the
 * button for and the check is the consequence. It takes no outcome to report:
 * the activation started the check itself and answered afterwards, so by the
 * time this sentence is written the request has already gone. What it cannot
 * promise is a check that FINISHES — the result shows on the set's versions,
 * which is also where one that never started is run by hand.
 */
export function houseCheckNotice(name) {
  const set = name ? `“${name}”` : 'the set';
  return {
    tone: 'success',
    text: `${set} is live to every organisation, and the content check is running on it. The result shows on its versions.`,
  };
}
