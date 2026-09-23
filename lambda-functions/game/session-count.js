/**
 * WHEN A SESSION COUNTS — the first answer to its second answered question.
 *
 * The owner, 2026-09-23: "the session only counts if at least 2 questions get
 * answered by 1 or more people. otherwise we chalk it up to test, or something
 * was not correct and they likely will restart."
 *
 * So a session counts toward its organisation's plan the moment a second
 * DIFFERENT question receives its first answer. Round numbers and skips do not
 * matter: questions 1-3 skipped, 4 answered, 5 skipped, 6 answered — it counts
 * on the first answer to 6. Creating, starting, joining, serving questions
 * nobody answers, and a whole room answering one question are all free.
 *
 * Why here and not at the join (4b39c871, the moment before this one): a join
 * happens in every rehearsal and every QR test. Two answered questions is the
 * room actually taking part, and it is observable the instant it happens.
 *
 * ── THE TWO ATTRIBUTES, ON THE SESSION'S METADATA ROW ──────────────────────
 *
 *   FirstAnsweredRound  the round ('004') of the first question anybody
 *                       answered. Claimed once, conditionally.
 *   CountedAt           when the session counted. Once present, every later
 *                       answer skips all of this — message.js already reads
 *                       METADATA for the org, and reads these two with it, so a
 *                       counted session costs no extra call per answer.
 *
 * Answers are only accepted for the round on screen (message.js checks STATE
 * is `ASK#<round>`), so the only answers that can race for FirstAnsweredRound
 * are answers to the same question; the loser re-reads and finds its own round.
 *
 * ── IT NEVER THROWS, AND IT NEVER MARKS A CHARGE THAT DID NOT LAND ─────────
 *
 * The answer is already stored when this runs, and nothing here may lose it
 * (RATIONALE.md §3). A failed ledger write leaves CountedAt unstamped, so the
 * next answer tries again; `recordBillableSession`'s conditional put on
 * `LEDGER#<period>#SESSION#<gameId>` makes every retry and every redelivered
 * frame the same single charge. A session with no organisation (a pre-tenancy
 * row) counts, and bills nobody — usage.js refuses to invent a partition.
 *
 * ── TWO COPIES, ONE RULE ───────────────────────────────────────────────────
 *
 * websocket/session-count.js is called by message.js, after an ANSWER# row is
 * written. game/session-count.js is the same file, byte for byte, called by
 * game/survey-answers.js after a survey answer is saved: a survey has no rounds
 * and no socket answer path, so its "round" here is the question's qid
 * ('c001#003'), and a survey bills at its second distinct answered question —
 * the same moment, counted the same way. Answers to one survey arrive for any
 * question at any time, so two people answering different questions can race
 * for FirstAnsweredRound; the loser re-reads, finds the other's question, and
 * counts the session — which is the rule.
 *
 * tests/billable-session-wiring.js drives create, start, join, next-question
 * and real answers through message.js, holds the two copies identical, and
 * holds them the meter's only callers.
 */
const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { recordBillableSession } = require('./usage');

/** What countAnsweredQuestion needs from METADATA, for the caller's own read. */
const COUNT_PROJECTION = 'orgId, FirstAnsweredRound, CountedAt';

const metadataKey = (gameId) => ({ PK: `GAME#${gameId}`, SK: 'METADATA' });

/**
 * Note that `round` was answered, and count the session if it is the second
 * question to be.
 *
 * @param meta the METADATA read the caller made with COUNT_PROJECTION
 * @returns {{ counted: boolean, reason: string }}
 */
async function countAnsweredQuestion(db, tableName, gameId, round, meta = {}, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  try {
    if (meta.CountedAt) return { counted: false, reason: 'already' };

    let first = meta.FirstAnsweredRound;
    if (!first) {
      try {
        await db.send(new UpdateCommand({
          TableName: tableName,
          Key: metadataKey(gameId),
          UpdateExpression: 'SET FirstAnsweredRound = :round',
          ConditionExpression: 'attribute_not_exists(FirstAnsweredRound)',
          ExpressionAttributeValues: { ':round': round },
        }));
        return { counted: false, reason: 'first-question' };
      } catch (error) {
        if (!error || error.name !== 'ConditionalCheckFailedException') throw error;
        // STRONGLY: the write we just lost to may not be on an eventually-
        // consistent replica yet, and a re-read that misses it finds no
        // FirstAnsweredRound, takes this for the same question, and does not
        // count a session that has now answered two.
        const again = await db.send(new GetCommand({
          TableName: tableName,
          Key: metadataKey(gameId),
          ProjectionExpression: 'FirstAnsweredRound, CountedAt',
          ConsistentRead: true,
        }));
        if (again.Item && again.Item.CountedAt) return { counted: false, reason: 'already' };
        first = again.Item && again.Item.FirstAnsweredRound;
      }
    }
    if (!first || first === round) return { counted: false, reason: 'same-question' };

    const charge = await recordBillableSession(meta.orgId, gameId, { db, tableName, now });
    if (charge.reason === 'error') return { counted: false, reason: 'meter-error' };

    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: metadataKey(gameId),
      UpdateExpression: 'SET CountedAt = :at',
      ExpressionAttributeValues: { ':at': now.toISOString() },
    }));
    return { counted: true, reason: charge.reason };
  } catch (error) {
    console.error(`⚠️ session-count: could not count ${gameId} at round ${round} — the next answer retries:`, error);
    return { counted: false, reason: 'error' };
  }
}

module.exports = { countAnsweredQuestion, COUNT_PROJECTION };
