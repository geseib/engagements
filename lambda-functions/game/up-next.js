/**
 * UP NEXT — `GET /games/{gameId}/up-next?count=5`.
 *
 *   "how much work to offer the up next to show the next several questions even
 *    if its just the built in queue. might create a obvious tag when the user
 *    queued it up just to distinguish."
 *
 * Both halves are here: the next several questions in the order the room will
 * actually meet them, each tagged `queued` (the host put it there) or `auto`
 * (the automatic walk found it).
 *
 * ── THIS FILE DECIDES NOTHING ─────────────────────────────────────────────
 *
 * It reads state and hands it to `question-plan.js`, which holds the whole
 * rule. That split is the point: `next-question.js` calls the SAME
 * `pickIndex` when the moment arrives, so the list shown here is not an
 * imitation of the selection — it is the selection, run early. A second
 * implementation of "what comes next" is precisely how a preview becomes a
 * screen that lies.
 *
 * ── READ-ONLY, AND THAT IS A CONTRACT NOT A COINCIDENCE ───────────────────
 *
 * Nothing here writes. The planner simulates over copies for the same reason.
 * A host may open this panel at any moment, including mid-round and including
 * several times while deciding — if peeking advanced a cursor or spent a
 * question, looking at the running order would change it, and the bug would
 * present as "questions go missing when I check what's coming".
 *
 * ── IT CAN BE WRONG, AND SAYS SO BY BEING RECOMPUTED ──────────────────────
 *
 * Toggling a category mid-session changes which questions are reachable, so a
 * plan made before the toggle is stale afterwards. The answer is not to warn
 * about it but to make it cheap to re-ask: the whole computation is a handful
 * of reads and no writes, so every surface re-fetches rather than caching. The
 * remote already re-polls on every state change for the same reason.
 *
 * HOST ONLY. It enumerates unasked questions, which is the one thing a
 * participant must not see — knowing the next three questions is knowing the
 * answers to them on a trivia round.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const { planAhead, seedFor } = require('./question-plan');
const { resolveSetPartition } = require('./set-version');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/** How many rounds to look ahead when the caller does not say. */
const DEFAULT_COUNT = 5;

/**
 * A ceiling, because the cost is a simulation per item and the value falls off
 * a cliff. A facilitator steers a room two or three questions at a time; a
 * hundred-row preview is a table of contents for a session that has not
 * happened, and every row past the next few is one more thing a mid-session
 * category toggle invalidates.
 */
const MAX_COUNT = 20;

const respond = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: { 'Access-Control-Allow-Origin': '*' },
});

/** Every question this game has already put on screen, by source id. */
const askedSourceQuestionIds = async (gameId) => {
  const res = await db.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'QUESTION#' },
  }));

  const asked = new Set();
  for (const item of res.Items || []) {
    // Only the #REF rows say "this was asked" — the sibling ANSWER#/VOTE#/
    // RESULTS rows share the prefix and carry no SourceQuestionId. Same read as
    // next-question.js, and it must stay the same or the preview and the serve
    // disagree about what is spent.
    if (String(item.SK).endsWith('#REF') && item.SourceQuestionId) {
      asked.add(item.SourceQuestionId);
    }
  }
  return asked;
};

/** The bit for `position` (1-based) across the three 8-bit mask strings. */
const maskBit = (state, position) => {
  const which = position <= 8 ? '1-8' : (position <= 16 ? '9-16' : '17-24');
  const mask = String((state && state[`HostMask${which}`]) || '');
  const offset = (position - 1) % 8;
  return mask.charAt(offset) === '1';
};

exports.handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return respond(200, {});
  }

  const { gameId } = event.pathParameters || {};
  if (!gameId) return respond(400, { error: 'gameId is required' });

  const requested = Number(event.queryStringParameters?.count);
  const count = Number.isInteger(requested) && requested > 0
    ? Math.min(requested, MAX_COUNT)
    : DEFAULT_COUNT;

  try {
    const [metaRes, stateRes, catStateRes, queueRes] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' },
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'QUEUE' },
      })),
    ]);

    if (!metaRes.Item) return respond(404, { error: 'Game not found' });

    const resolved = await resolveSetPartition(
      db, process.env.TABLE_NAME, metaRes.Item.QuestionSetId, undefined
    );

    // Every CATEGORY# and QUESTION# row of the set, in one read. The planner
    // needs the category list, the titles for display, and the mapping from a
    // queued key to its category — all from this one partition.
    const setRows = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': resolved.pk },
    }));

    const rows = setRows.Items || [];
    const categoryRows = rows
      .filter((r) => String(r.SK).startsWith('CATEGORY#'))
      .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));

    const questionRows = rows.filter((r) => String(r.SK).startsWith('QUESTION#'));
    const titleOf = new Map(questionRows.map((r) => [
      r.SK,
      r.Title || r.title || r.Prompt || r.prompt || '',
    ]));

    // The cursor and running order per category, as next-question.js keeps them.
    const cursors = await Promise.all(categoryRows.map(async (row, i) => {
      const categoryId = String(row.SK).replace('CATEGORY#', '');
      const position = i + 1;

      // A category the host has switched OFF contributes nothing. Reading the
      // same HostMask the selector reads is what keeps the preview honest
      // across a mid-session toggle.
      if (catStateRes.Item && !maskBit(catStateRes.Item, position)) return null;

      const [orderRes, activeRes] = await Promise.all([
        db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: `CATEGORY#${categoryId}#ORDER` },
        })),
        db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: `CATEGORY#${categoryId}#ACTIVE` },
        })),
      ]);

      if (!activeRes.Item) return null;

      return {
        categoryId,
        position,
        name: row.Name || row.name || categoryId,
        order: (orderRes.Item && orderRes.Item.QuestionOrder) || [],
        cursor: activeRes.Item.ActiveIndex || 0,
        questionCount: activeRes.Item.QuestionCount || 0,
        // Read exactly as next-question.js reads it — `IsRandom !== false`, so
        // an older record with the field absent still means random, which is
        // the historical default and what those sessions have been doing.
        isRandom: !orderRes.Item || orderRes.Item.IsRandom !== false,
      };
    }));

    const categories = cursors.filter(Boolean);
    const nameOf = new Map(categories.map((c) => [c.categoryId, c.name]));

    /*
      One flag for the session, taken from the ORDER records — which is how
      next-question.js decides too (it reads the first one). `some` rather than
      `every`: the selector applies a single randomised/in-order rule to the
      whole session, so if any category is marked random the session behaves
      randomly and the preview must simulate it that way or diverge on round one.
    */
    const isRandomized = !categories.length || categories.some((c) => c.isRandom);

    const asked = await askedSourceQuestionIds(gameId);
    const roundNumber = (stateRes.Item?.LessonNumber || 0) + 1;

    const plan = planAhead({
      seed: seedFor({ ...metaRes.Item, GameId: gameId }),
      roundNumber,
      isRandomized,
      queue: (queueRes.Item && queueRes.Item.Queue) || [],
      asked,
      categories,
      /*
        A queued entry is a bare question key; the planner needs its category to
        report one, and its title to be worth reading. Resolved from the set
        rows already in hand rather than a read per queued item.
      */
      resolveQueued: (key) => {
        const sk = `QUESTION#${key}`;
        if (!titleOf.has(sk)) return null;
        const row = questionRows.find((r) => r.SK === sk);
        const categoryName = row && (row.Category || row.category);
        const match = categories.find((c) => c.name === categoryName);
        return { categoryId: match ? match.categoryId : null, title: titleOf.get(sk) };
      },
    }, count);

    return respond(200, {
      gameId,
      roundNumber,
      isRandomized,
      // Fewer than asked means the set is running out — a fact worth showing,
      // never padded. See planAhead.
      upNext: plan.map((item) => ({
        ...item,
        title: item.title || titleOf.get(item.questionId) || '',
        categoryName: nameOf.get(item.categoryId) || '',
      })),
    });
  } catch (error) {
    console.error('❌ Up next error:', error);
    return respond(500, { error: 'Failed to work out what is coming up' });
  }
};
