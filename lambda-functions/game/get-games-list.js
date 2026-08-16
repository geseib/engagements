const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, BatchGetCommand } = require('@aws-sdk/lib-dynamodb');
const { countParticipants } = require('./player-rows');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/**
 * TWO COUNTS PER SESSION, AND THE COST OF EACH IS NOT THE SAME.
 *
 * Neither number is maintained anywhere. The GAMES index row is written once at
 * creation and updated exactly once more, by start-game, which sets `Started`
 * and `LastPlayedAt` and nothing else. So both have to be read.
 *
 *   ROUNDS is nearly free. `STATE.LessonNumber` is incremented by
 *   next-question and never decremented, and it is a GetItem by full key — so a
 *   hundred sessions fit in ONE BatchGetItem. Cost is ceil(N/100) extra calls
 *   for the whole list.
 *
 *   PLAYERS IS AN N+1, one Query per session, and it is stated plainly here
 *   rather than buried. It cannot be a BatchGet (the rows are a prefix, not a
 *   key) and it cannot use `Select: COUNT` either, because the count has to
 *   exclude two SK SUFFIXES and DynamoDB cannot filter on those — see
 *   player-rows.js. So the rows come back projected to SK+PlayerName+JoinedAt,
 *   which is small, and the arithmetic happens here.
 *
 * If the list ever grows past the point where that is comfortable, the fix is
 * not to optimise this loop — it is to maintain counters on the GAMES row at
 * creation, join and advance, at which point both numbers come back from the
 * single Query above and this whole section deletes. That change is also what
 * makes a "7 of 80" denominator possible, which today's data cannot support:
 * the selected total IS written at creation but is destructively recomputed
 * from decremented arrays on every round, so by round 7 it reads 73 and the
 * original 80 is gone.
 *
 * NULL, NEVER ZERO, WHEN A READ FAILS. "Nobody joined" and "we could not find
 * out" are different facts and the second must not render as the first — the
 * list shows an em dash for null. Every enrichment is best-effort: a failure
 * here degrades a column, it does not fail the list.
 */
const COUNT_CONCURRENCY = 8;
const BATCH_LIMIT = 100;

/*
  THE PLAYER ROWS OUTLIVE THE SESSION BY LESS THAN THE LIST SHOWS IT FOR.

      PLAYER#{name}          7 days   (join-game.js:338)
      PLAYER#{name}#SCORE   30 days   (join-game.js:361)
      the session itself    90 days   (schema-compliant-manager.js:19)

  `countParticipants` reads any PLAYER# row, so it holds up for 30 days rather
  than 7. Past 30 there is nothing left to count, and a session that ran with
  eleven people would report 0 — a confident, wrong number sitting in a column
  for two more months.

  So a zero is only reported where a zero is KNOWABLE. Inside the window it is
  a real answer: a session nobody joined genuinely had none. Outside it, we
  cannot tell an empty session from an expired one, and null is the honest
  answer — the list draws an em dash.

  A session that was never started is exempt: nobody can have joined a session
  whose doors never opened, so its zero is true at any age.
*/
const SCORE_ROW_TTL_DAYS = 30;

function knowablePlayerCount(count, game) {
  if (count > 0) return count;
  if (!game.started) return 0;
  const created = Date.parse(game.createdAt);
  if (Number.isNaN(created)) return null;
  const ageDays = (Date.now() - created) / (24 * 60 * 60 * 1000);
  return ageDays <= SCORE_ROW_TTL_DAYS ? 0 : null;
}

/** Rounds played per gameId, from STATE.LessonNumber. Missing → null. */
async function roundsPlayedByGame(gameIds) {
  const out = new Map();
  for (let i = 0; i < gameIds.length; i += BATCH_LIMIT) {
    const slice = gameIds.slice(i, i + BATCH_LIMIT);
    try {
      const res = await db.send(new BatchGetCommand({
        RequestItems: {
          [process.env.TABLE_NAME]: {
            Keys: slice.map((id) => ({ PK: `GAME#${id}`, SK: 'STATE' })),
            ProjectionExpression: 'PK, LessonNumber',
          },
        },
      }));
      const items = (res.Responses && res.Responses[process.env.TABLE_NAME]) || [];
      items.forEach((item) => {
        const id = String(item.PK).replace('GAME#', '');
        out.set(id, Number(item.LessonNumber) || 0);
      });
    } catch (error) {
      // Leave this slice unset: the rows render an em dash rather than a zero.
      console.error(`⚠️ rounds batch failed for ${slice.length} sessions:`, error.message);
    }
  }
  return out;
}

/** Player count per gameId. A failed or absent query leaves the id unset. */
async function playerCountsByGame(gameIds) {
  const out = new Map();
  for (let i = 0; i < gameIds.length; i += COUNT_CONCURRENCY) {
    const slice = gameIds.slice(i, i + COUNT_CONCURRENCY);
    const results = await Promise.allSettled(slice.map((id) => db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${id}`, ':sk': 'PLAYER#' },
      ProjectionExpression: 'SK, PlayerName, JoinedAt',
    }))));
    results.forEach((result, n) => {
      if (result.status !== 'fulfilled') {
        console.error(`⚠️ player count failed for ${slice[n]}:`, result.reason && result.reason.message);
        return;
      }
      out.set(slice[n], countParticipants(result.value.Items || []));
    });
  }
  return out;
}

exports.handler = async (event) => {
  try {
    console.log('🎮 Getting games list for game history');

    // Get all games from GAMES partition
    const gamesResult = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'GAMES'
      },
      ScanIndexForward: false // Sort by SK in descending order (most recent first)
    }));

    const games = (gamesResult.Items || []).map(game => ({
      gameId: game.SK.replace('GAME#', ''),
      title: game.Title,
      gameType: game.GameType,
      questionSetId: game.QuestionSetId,
      createdAt: game.CreatedAt,
      started: game.Started || false,
      lastPlayedAt: game.LastPlayedAt,
      visibility: game.Visibility || 'public',
      hostName: game.HostName
    }));

    // Sort by creation date (most recent first)
    games.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    /*
      Enrichment is best-effort and deliberately not inside the map above: a
      column that could not be read must come back as null so the list can say
      "we do not know" rather than "nobody". Both helpers already swallow their
      own failures per-session; this try/catch is the backstop for anything
      that escapes them, and it still returns the list.
    */
    const ids = games.map((game) => game.gameId);
    let rounds = new Map();
    let players = new Map();
    try {
      [rounds, players] = await Promise.all([
        roundsPlayedByGame(ids),
        playerCountsByGame(ids),
      ]);
    } catch (error) {
      console.error('⚠️ session counts unavailable, returning the list without them:', error.message);
    }

    games.forEach((game) => {
      game.roundsPlayed = rounds.has(game.gameId) ? rounds.get(game.gameId) : null;
      game.playerCount = players.has(game.gameId)
        ? knowablePlayerCount(players.get(game.gameId), game)
        : null;
    });

    console.log(`✅ Returning ${games.length} games for history`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        games: games,
        count: games.length,
        timestamp: new Date().toISOString()
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Get games list error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get games list: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
