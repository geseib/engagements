/**
 * A SESSION ENDS HERE — whichever door closes it.
 *
 * Two doors write ENDED for a non-survey session, and both must write and
 * broadcast identically, or a host's own "end it now" would look different on
 * the wire than the pool running dry:
 *
 *   next-question.js  the pool-dry path — no more questions to serve
 *   end-session.js    POST /games/{gameId}/end — the host's own choice to
 *                      stop early (Task 4, 2026-09-26 bug sweep: "a host who
 *                      wants to stop after round 4 of 10 cannot")
 *
 * ONE HELPER, so neither door can drift from the other — the exact fault this
 * file exists to close. Before this, next-question.js's pool-dry block wrote
 * the UpdateCommand and the broadcast inline; end-session.js would otherwise
 * have needed its own copy, and a later edit to one (a new field on the
 * broadcast, say) could easily miss the other.
 *
 * IDEMPOTENT BY CONSTRUCTION: a session already ENDED writes and broadcasts
 * nothing. The pool-dry path has never needed this (a round only ends once,
 * on its way there), but end-session.js's own route is documented idempotent
 * — a second "End session" click, or two devices racing the same click, must
 * not send the room a second END frame.
 *
 * A survey never reaches this file. It ends through survey-host.js's own
 * `end()` (SURVEY#CLOSED -> ENDED only), which end-session.js refuses to
 * duplicate — see its own header.
 */
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');

/**
 * Write STATE to ENDED and broadcast the same frame the pool-dry path has
 * always sent, unless the session is already ENDED.
 *
 * @param db          a DynamoDBDocumentClient
 * @param tableName   the table name
 * @param gameId      the session's id
 * @param currentState STATE's own `State` field, read by the caller — passed
 *                     in rather than re-read here, since every caller has
 *                     already fetched STATE for its own refusals.
 * @param broadcastToGame the caller's own broadcaster: `(gameId, message) =>
 *                     Promise`, so this module stays free of the
 *                     ApiGatewayManagementApiClient plumbing each Lambda
 *                     already carries a copy of.
 * @param now         ISO timestamp, injectable for tests.
 * @returns {{changed: boolean, endedAt: string|null}}
 */
async function endSession(db, tableName, gameId, {
  currentState, broadcastToGame, now = new Date().toISOString(),
} = {}) {
  if (currentState === 'ENDED') {
    return { changed: false, endedAt: null };
  }

  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
    UpdateExpression: 'SET #state = :state, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#state': 'State',
      '#updatedAt': 'UpdatedAt',
    },
    ExpressionAttributeValues: {
      ':state': 'ENDED',
      ':updatedAt': now,
    },
  }));

  await broadcastToGame(gameId, {
    type: 'hostMessage',
    messageType: 'END',
    gameId,
    state: `GAME#${gameId} ENDED`,
    timestamp: now,
    message: 'All questions have been completed',
  });

  return { changed: true, endedAt: now };
}

module.exports = { endSession };
