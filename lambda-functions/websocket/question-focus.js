/**
 * A QUESTION ON THE WALL BELONGS TO THE PHASE IT WAS PUT UP IN (review of the
 * 16 Oct 2026 batch, finding 1).
 *
 * The host may put the question back up during VOTE (the console's "The
 * question" row, the Remote, the stage). Nothing took it down when the round
 * moved on to RESULTS, and get-game-state hands a stored 'question' focus back
 * in any phase, so the wall kept showing the question while the dock and the
 * Remote said RESULTS. game/get-results.js's enterResultsState now clears it,
 * on the server, so every surface follows the one stored fact.
 *
 * The same holds one phase earlier: a question put up during ASK (from the
 * Remote, say) is cleared when the round enters VOTE, by websocket/start-vote.js
 * and message.js's REQUEST_VOTE, so the wall shows the ballot the dock says.
 * TWO IDENTICAL COPIES: game/question-focus.js and websocket/question-focus.js
 * (separate deploy bundles); tests/question-focus-vote.js holds them equal.
 *
 * Conditional on the focus BEING the question: a response or the join code
 * someone put up is not this function's to take down. A new round needs no
 * clear: the focus lives on that round's own ROUND#nnn row, which starts empty.
 */

/** The UpdateCommand input that takes a question focus down on one round, or fails its condition. */
function clearQuestionFocusWrite(table, gameId, padded, now) {
  return {
    TableName: table,
    Key: { PK: `GAME#${gameId}`, SK: `ROUND#${padded}` },
    UpdateExpression: 'SET #focus = :none, #idx = :null, #phase = :null, #part = :null, #parts = :null, #updatedAt = :now ADD #rev :one',
    ConditionExpression: '#focus = :question',
    ExpressionAttributeNames: {
      '#focus': 'StageFocus', '#idx': 'StageFocusIndex', '#phase': 'StageFocusPhase',
      '#part': 'StageFocusPart', '#parts': 'StageFocusParts', '#rev': 'StageFocusRev', '#updatedAt': 'UpdatedAt',
    },
    ExpressionAttributeValues: { ':none': 'none', ':question': 'question', ':null': null, ':now': now, ':one': 1 },
    ReturnValues: 'ALL_NEW',
  };
}

/** The frame every surface applies when the question comes down (stage-focus.js's shape). */
function focusClearedFrame(gameId, padded, rev, now) {
  return {
    type: 'stageFocusChanged', gameId, questionNumber: padded,
    focus: 'none', index: null, part: null, parts: null, phase: null, rev, timestamp: now,
  };
}

/**
 * Clear a question focus on this round and tell the room. Never throws: no
 * question up is the usual case, and the round's results are shown either way.
 */
async function clearQuestionFocus({ db, UpdateCommand, broadcast, table, gameId, padded }) {
  const now = new Date().toISOString();
  try {
    const out = await db.send(new UpdateCommand(clearQuestionFocusWrite(table, gameId, padded, now)));
    const rev = Number.isInteger(out && out.Attributes && out.Attributes.StageFocusRev) ? out.Attributes.StageFocusRev : null;
    await broadcast(gameId, focusClearedFrame(gameId, padded, rev, now));
    return true;
  } catch (error) {
    if (!error || error.name !== 'ConditionalCheckFailedException') {
      console.error('⚠️ QUESTION FOCUS: the question did not come down:', error && error.message);
    }
    return false;
  }
}

module.exports = { clearQuestionFocusWrite, focusClearedFrame, clearQuestionFocus };
