/**
 * START THE CONTENT CHECK ON ONE OF ENGAGE'S OWN SETS, FROM THE ROUTE THAT
 * JUST CHANGED IT.
 *
 * A PLATFORM set is served to every organisation, so it reaches further than
 * anything in the public library, and the owner's trigger is the moment what
 * every organisation plays changes: an activation (toggle-question-set.js), a
 * replace of the questions under a set that is already on (upload-questions.js)
 * and a promote of a different version of one (promote-set-version.js).
 *
 * ── WHY THIS IS SERVER-SIDE NOW ────────────────────────────────────────────
 *
 * It was the console's job. Each of the three routes answered `checkDue` and
 * `src/utils/houseCheck.js` posted the check itself, because a check is a JOB —
 * the POST that starts one self-invokes the check function against its
 * 900-second budget — and none of the three held `lambda:InvokeFunction` to
 * dispatch one with. That worked and was not a guarantee: a console closed
 * between the write and the post left one of Engage's sets live and unchecked,
 * and nothing ever noticed.
 *
 * The owner granted the invoke, so the trigger moved here. Each function now
 * carries exactly one statement — `lambda:InvokeFunction` on
 * `${StackName}-check-question-set` and nothing else — and the console fires
 * nothing of its own. `checkDue` is still on every answer, because it is what
 * the sentence the person reads is built from.
 *
 * ── AND IT CANNOT FAIL THE WRITE ───────────────────────────────────────────
 *
 * This is the rule everything else here bends around. The dispatch happens
 * AFTER the activation, the save or the promote has landed, and a dispatch that
 * will not go — a grant that was not deployed, a throttle, a Lambda
 * control-plane outage — is logged and swallowed. The person keeps the thing
 * they pressed the button for, and the on-demand control in the Versions panel
 * is how a check that never started gets run.
 *
 * `InvocationType: 'Event'` for the same reason: the send returns as soon as
 * the Lambda service accepts the request, so an activation never waits behind a
 * 900-second job. It is the pattern check-question-set.js already uses to reach
 * its own worker.
 *
 * ── ENGAGE'S LIBRARY ONLY ──────────────────────────────────────────────────
 *
 * An organisation's own set is checked when THEY share it, on their own daily
 * cap, by their own action, and nothing here adds a second trigger to that.
 * Every caller below tests the scope of the row it just wrote before it asks
 * for anything.
 */
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambda = new LambdaClient({ region: process.env.AWS_REGION });

/**
 * The request the check function would have received had the console posted it.
 *
 * It re-enters `check-question-set.js` by its ordinary HTTP entry point rather
 * than by some private back door, so the whole of that route applies unchanged:
 * `canManageScope(PLATFORM)`'s interlock, the lock that stops two checks of one
 * version, the job row, the quota exemption and the worker dispatch all stay in
 * the one place that has always owned them.
 *
 * THE AUTHORIZER IS THE CALLER'S OWN, forwarded. Not a fabricated staff
 * identity: the check writes who asked onto the set's review log, and the
 * honest answer is the person who just switched the set on. It is also the
 * envelope API Gateway put on the request that reached US a moment ago, and the
 * route that received it already proved that caller may manage this platform
 * row (`requireSetManager`, which for a platform set is exactly the same
 * interlock the check applies). Nothing is widened by passing it along.
 */
const checkRequest = (event, setId) => ({
  version: '2.0',
  routeKey: 'POST /question-sets/{setId}/check',
  rawPath: `/question-sets/${setId}/check`,
  pathParameters: { setId },
  requestContext: {
    http: { method: 'POST', path: `/question-sets/${setId}/check` },
    authorizer: event?.requestContext?.authorizer,
  },
  body: '{}',
});

/**
 * Ask for the check. Never throws, never waits for the check itself, and
 * answers only so a caller can log what happened.
 *
 * @param {object} event  the HTTP event this route was called with
 * @param {string} setId  the Engage set whose content changed
 * @returns {Promise<boolean>} whether the request was accepted
 */
async function dispatchHouseCheck(event, setId) {
  const FunctionName = String(process.env.CHECK_FUNCTION_NAME || '').trim();
  if (!FunctionName) {
    // A deploy that wired the code and not the environment. Loud, because the
    // symptom otherwise is a library that is quietly never measured.
    console.error(`⚠️ CHECK_FUNCTION_NAME is not set, so the content check for Engage's set "${setId}" was not started`);
    return false;
  }
  try {
    await lambda.send(new InvokeCommand({
      FunctionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(checkRequest(event, setId))),
    }));
    console.log(`🔎 dispatched the content check for Engage's set "${setId}"`);
    return true;
  } catch (error) {
    console.error(`⚠️ the content check for Engage's set "${setId}" could not be started (${error.message}); the change itself stands, and the Versions panel can run it by hand`);
    return false;
  }
}

module.exports = { dispatchHouseCheck };
