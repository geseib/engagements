/**
 * ASKING THE CONTENT CHECK WHICH SHELF A SET LOOKS LIKE — without publishing it.
 *
 * The owner, asking for the whole feature: *"maybe when saving or making public
 * the tag can get verified, or recommended as well."* The check already does
 * the reading (`admin/shared/topic-suggestion.js`, called at the end of every
 * check) and records what it would file the set under beside the review. This
 * is the request that makes that reachable for an organisation's own set.
 *
 * ── WHY IT EXISTS AT ALL, GIVEN THE SHARE ALREADY RUNS A CHECK ─────────────
 *
 * It does, and for an UNFILED set it never gets that far: sharing one is
 * refused before a check is spent (`check-question-set.js`, the shelf gate),
 * precisely so nobody is charged for a "no" they could be told at once. So the
 * one journey where a proposal is the whole point — an author looking at a
 * picker that says Unfiled, with fifteen shelves and no idea which — was the
 * one journey that could never reach one. The gate exempts a check that
 * publishes nothing, and this is the only thing in the product that asks for
 * one.
 *
 * ── WHAT IT COSTS, SO THE COPY CAN SAY SO ─────────────────────────────────
 *
 * A real check: one of the organisation's twenty daily ones, the model calls,
 * and a verdict recorded on the version like any other. It publishes nothing
 * and moves no share stamp (`publish: false` is carried the whole way down into
 * `job.request`). The surface that draws the button has to say all of that
 * before it is pressed — see SetTopicField.jsx.
 *
 * ── WHERE THE ANSWER COMES BACK ───────────────────────────────────────────
 *
 * Not in the response. The suggestion is written onto the review row at the END
 * of the worker's run, so it arrives on the set's versions
 * (`reviewTopicSuggestion`, read by `latestTopicSuggestion`). That is why this
 * polls to completion rather than returning on the 202: the caller's next move
 * is to reload the versions, and doing that while the job is still running
 * would read the row as it was before the check.
 *
 * NEVER THROWS, like `startHouseCheck` next door: a refusal must not be able to
 * take down the panel it was pressed from.
 */
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from './adminApi';
import { pollGenerationJob } from './aiBatchClient';
import { interpretCheckJob } from './checkJob';

/** The check's own route — not under `/admin`; see houseCheck.js for why. */
const checkUrl = (setId) => adminApiUrl(`question-sets/${encodeURIComponent(setId)}/check`);

/**
 * Run a check that publishes nothing, and wait for it, so the shelf it proposes
 * is on the set's versions by the time this answers.
 *
 * @param {string} setId
 * @param {object} [opts]
 * @param {number} [opts.version] a version other than the active one
 * @returns {Promise<{ok: boolean, outcome?: string, error?: string}>}
 *   `outcome` is the CHECK's verdict (passed / flagged / escalated), which is
 *   not the same question as whether a shelf was proposed — the proposal is a
 *   convenience the check may skip, and it is never a reason to call the whole
 *   thing a failure.
 */
export async function askForTopicSuggestion(setId, { version } = {}) {
  let jobId;
  try {
    const res = await authFetch(checkUrl(setId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `publish: false` is the whole point and is sent EXPLICITLY: the server
      // reads `body.publish !== false`, so an absent flag means publish, which
      // is both a share this person did not ask for and a refusal for the
      // unfiled set this exists to help.
      body: JSON.stringify({ publish: false, ...(version ? { version } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error || `the server answered ${res.status}` };
    jobId = body.jobId;
  } catch (e) {
    return { ok: false, error: e.message };
  }
  try {
    const job = await pollGenerationJob(checkUrl(setId), jobId, { label: 'Content check' });
    return { ok: true, outcome: interpretCheckJob(job).outcome };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export default askForTopicSuggestion;
