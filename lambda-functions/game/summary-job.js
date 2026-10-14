/**
 * ONE WORKIE READ PER ROUND AT A TIME — the claim both starters take.
 *
 * Two things now start a round's AI read:
 *
 *   get-results.js   the moment the HOST closes the round (POST close-round),
 *                    whichever surface asked — the stage, or the Host Remote
 *                    with the stage closed.
 *   get-ai-summary   `generateNew=true` on the host route: the stage's own
 *                    fetch-else-generate on entering RESULTS, its Try again,
 *                    and Regenerate.
 *
 * Before 2026-10-12 only the second existed, and only GameHostPage ever sent
 * it. A host driving from the remote with the stage closed got no read and no
 * follow-up suggestions at all (dev session 5479: round 2 closed 12:59:25, the
 * remote polled 404s from 12:59:36, and the worker ran at 13:00:07 — the second
 * the stage was opened). With both starters live, the stage opening on a round
 * the server already started would fire a second generation into the same
 * row; this claim is what stops that.
 *
 * `QUESTION#nnn#AISummaryJob` is written conditionally: it can be taken only
 * when there is none, or the one there is older than STALE_MS (a worker that
 * died without releasing). The worker releases it when it finishes, success or
 * failure, so a Regenerate after a read has landed is never refused.
 */
const { GetCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

/** A read takes seconds; a claim this old belongs to a worker that died. */
const STALE_MS = 120 * 1000;
/** The claim row is housekeeping; it never needs to outlive a day. */
const CLAIM_TTL_SECONDS = 24 * 60 * 60;

const jobKey = (gameId, padded) => ({ PK: `GAME#${gameId}`, SK: `QUESTION#${padded}#AISummaryJob` });

const isConditionFailure = (error) =>
  !!error && (error.name === 'ConditionalCheckFailedException'
    || error.__type === 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException');

/**
 * Take the round's claim. Returns the job id, or null when somebody else holds
 * a fresh one — or, with `unlessWritten`, when the round already has a read
 * (closing a round twice must not throw the first read away).
 *
 * Any other failure is thrown: the caller decides whether a read that could
 * not be claimed is still worth starting.
 */
async function claimSummaryJob(db, { gameId, padded, unlessWritten = false, now = Date.now() }) {
  const table = process.env.TABLE_NAME;
  if (unlessWritten) {
    const existing = await db.send(new GetCommand({
      TableName: table,
      Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${padded}#AISummary` },
      ProjectionExpression: 'PK',
    }));
    if (existing && existing.Item) return null;
  }

  const jobId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await db.send(new PutCommand({
      TableName: table,
      Item: {
        ...jobKey(gameId, padded),
        JobId: jobId,
        StartedAt: now,
        ttl: Math.floor(now / 1000) + CLAIM_TTL_SECONDS,
      },
      ConditionExpression: 'attribute_not_exists(PK) OR StartedAt < :stale',
      ExpressionAttributeValues: { ':stale': now - STALE_MS },
    }));
  } catch (error) {
    if (isConditionFailure(error)) return null;
    throw error;
  }
  return jobId;
}

/** Let the round's claim go — only if it is still this job's. Never throws. */
async function releaseSummaryJob(db, { gameId, padded, jobId }) {
  if (!gameId || !padded || !jobId) return;
  try {
    await db.send(new DeleteCommand({
      TableName: process.env.TABLE_NAME,
      Key: jobKey(gameId, padded),
      ConditionExpression: 'JobId = :id',
      ExpressionAttributeValues: { ':id': jobId },
    }));
  } catch (error) {
    if (!isConditionFailure(error)) {
      console.warn(`⚠️ AI SUMMARY: could not release the claim for ${gameId}:${padded}: ${error && error.name}`);
    }
  }
}

module.exports = { claimSummaryJob, releaseSummaryJob, STALE_MS };
