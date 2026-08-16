/**
 * THE THREE THINGS AN UNAUTHENTICATED CALLER MUST CLEAR BEFORE A SESSION WILL
 * DISCUSS A NAME WITH IT.
 *
 * Lifted verbatim out of `join-game.js`, where it had been the first fifty
 * lines of the handler, because `request-handover.js` is the second
 * unauthenticated route that reaches into one session's player rows and it has
 * to clear exactly the same three gates in exactly the same order:
 *
 *   1. the session exists                          -> 404
 *   2. the session has been started                -> 403
 *   3. a private session's access code matches     -> 401 / 403
 *
 * ORDER IS THE SECURITY PROPERTY, not tidiness. `tests/join-name-collision.js`
 * asserts that a private session answers 401/403 with NO `code` field when a
 * name is submitted without the access code, and that an unstarted session
 * refuses "before it looks at names". Both are the same claim: the name-in-use
 * signal must sit BEHIND the code gate, or the refusal becomes a roster oracle
 * for anyone who knows a four-digit game id. Duplicating these fifty lines into
 * the second route was the obvious move and would have put the ordering in two
 * places that could drift; a handover request that answered "no such player"
 * ahead of the code check would have re-opened the oracle on a route nobody
 * would think to test for it.
 *
 * The response bodies are byte-for-byte what `join-game.js` shipped. They are
 * matched on exact strings by `components/joinResult.js` (`payload.error ===
 * 'Access code required'`, `'Game not started'`), so a reworded message here is
 * a broken screen on the player's phone.
 */

const { GetCommand } = require('@aws-sdk/lib-dynamodb');

const cors = { 'Access-Control-Allow-Origin': '*' };

/**
 * @returns {{ ok: true, metadata: object } | { ok: false, response: object }}
 *   `ok` false carries the exact HTTP response to return; the caller must not
 *   rewrite it, because the strings are a contract with the join screen.
 */
async function openSessionOr(db, tableName, gameId, accessCode) {
  const gameCheck = await db.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
  }));

  if (!gameCheck.Item) {
    return {
      ok: false,
      response: {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: cors
      }
    };
  }

  if (!gameCheck.Item.Started) {
    return {
      ok: false,
      response: {
        statusCode: 403,
        body: JSON.stringify({
          error: 'Game not started',
          message: 'This game has not been started yet. Please wait for the host to start the session.'
        }),
        headers: cors
      }
    };
  }

  const gameMetadata = gameCheck.Item;
  const gameVisibility = gameMetadata.Visibility || 'public';

  if (gameVisibility === 'private') {
    const requiredAccessCode = gameMetadata.AccessCode;

    if (!requiredAccessCode) {
      console.error(`Game ${gameId} is marked as private but has no access code`);
      return {
        ok: false,
        response: {
          statusCode: 500,
          body: JSON.stringify({ error: 'Game configuration error' }),
          headers: cors
        }
      };
    }

    if (!accessCode) {
      return {
        ok: false,
        response: {
          statusCode: 401,
          body: JSON.stringify({
            error: 'Access code required',
            message: 'This is a private game. Please enter the access code to join.'
          }),
          headers: cors
        }
      };
    }

    if (accessCode !== requiredAccessCode) {
      return {
        ok: false,
        response: {
          statusCode: 403,
          body: JSON.stringify({
            error: 'Invalid access code',
            message: 'The access code you entered is incorrect. Please try again.'
          }),
          headers: cors
        }
      };
    }
  }

  return { ok: true, metadata: gameMetadata };
}

module.exports = { openSessionOr };
