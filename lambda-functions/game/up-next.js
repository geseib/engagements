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
const { callerMayDriveSession } = require('./tenant');
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

/**
 * Every question this game can no longer serve: asked (QUESTION#nnn#REF rows)
 * UNION disabled by the host (the EXCLUDED row). The exact twin of
 * next-question.js's read — it must stay the same or the preview and the
 * serve disagree about what is spent, which is the one failure this endpoint
 * exists to prevent. Also returns the raw excluded keys so the response can
 * show the host their own veto list.
 */
const spentSourceQuestionIds = async (gameId) => {
  const [res, excludedRes] = await Promise.all([
    db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'QUESTION#' },
    })),
    db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'EXCLUDED' },
    })),
  ]);

  const asked = new Set();
  // The TRULY asked ids, kept apart from the union: the response reports them
  // so the panel's "asked" tags can come from the server instead of from what
  // one browser happened to watch — a disabled question is spent for the
  // planner but has NOT been asked, and tagging it asked would be a lie.
  const askedIds = [];
  for (const item of res.Items || []) {
    if (String(item.SK).endsWith('#REF') && item.SourceQuestionId) {
      asked.add(item.SourceQuestionId);
      askedIds.push(item.SourceQuestionId);
    }
  }

  const excludedKeys = [];
  for (const key of (excludedRes.Item && Array.isArray(excludedRes.Item.Keys)
    ? excludedRes.Item.Keys : [])) {
    const clean = String(key ?? '').trim();
    if (!clean) continue;
    excludedKeys.push(clean);
    asked.add(`QUESTION#${clean}`);
  }

  return { asked, askedIds, excludedKeys };
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

    /*
      WHOSE ROOM IS THIS? The Cognito authorizer on this route says the caller
      is *a* host, and until this line nothing said they were THIS session's
      host — so the boundary was "any `hosts` account plus one of the 9,000
      four-digit ids".

      This route is the reason that mattered even though it writes nothing.
      The template's own note says it: the response ENUMERATES QUESTIONS THAT
      HAVE NOT BEEN ASKED YET, and on a trivia round knowing the next three
      questions is most of the way to knowing the next three answers. A
      read-only hole is still a hole when what it reads is the thing being kept
      back.

      NO EXTRA READ: the METADATA row is already in hand from the Promise.all
      above, so unlike stage-focus.js this costs nothing. Deliberately AFTER
      the 404 for a missing game, so both refusals look identical from outside.
    */
    if (!callerMayDriveSession(event, metaRes.Item)) {
      return respond(404, { error: 'Game not found' });
    }

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
      EVERY category's enabled state, by name — including the switched-off ones
      `cursors` deliberately dropped. The queue resolver below needs both
      halves: a queued question in an OFF category must be reported as blocked,
      not previewed as the next round, because the drain will skip it and leave
      it queued (next-question.js states the three skip-and-leave rules).
    */
    const enabledByName = new Map(categoryRows.map((row, i) => [
      row.Name || row.name || '',
      !catStateRes.Item || maskBit(catStateRes.Item, i + 1),
    ]));

    /*
      One flag for the session, taken from the ORDER records — which is how
      next-question.js decides too (it reads the first one). `some` rather than
      `every`: the selector applies a single randomised/in-order rule to the
      whole session, so if any category is marked random the session behaves
      randomly and the preview must simulate it that way or diverge on round one.
    */
    const isRandomized = !categories.length || categories.some((c) => c.isRandom);

    const { asked, askedIds, excludedKeys } = await spentSourceQuestionIds(gameId);
    const roundNumber = (stateRes.Item?.LessonNumber || 0) + 1;

    /*
      A queued entry is a bare question key; the planner needs its category to
      report one, its title to be worth reading, and whether the DRAIN WOULD
      ACTUALLY SERVE IT. The drain skips-and-leaves an entry that is not in
      the set or has no reachable category; a preview that placed those anyway
      showed a round that was never going to happen and shifted every round
      after it, which read as "the running order listed is not actually used".

      A SWITCHED-OFF CATEGORY IS NOT A SKIP ANY MORE — the owner: "it should
      not skip it. assume its a 1 off that the host wants to add from that
      category." The drain serves it; the preview places it; the row keeps a
      `categoryOff` ADVISORY so the panel can still label the one-off.
      Resolved from the set rows already in hand rather than a read per item.
    */
    const resolveQueued = (key) => {
      const sk = `QUESTION#${key}`;
      if (!titleOf.has(sk)) {
        return { servable: false, reason: 'not-in-set', categoryId: null, title: '', categoryName: '' };
      }
      const row = questionRows.find((r) => r.SK === sk);
      const categoryName = (row && (row.Category || row.category)) || '';
      if (!categoryName || !enabledByName.has(categoryName)) {
        return { servable: false, reason: 'no-category', categoryId: null, title: titleOf.get(sk), categoryName };
      }
      const match = categories.find((c) => c.name === categoryName);
      return {
        servable: true,
        categoryId: match ? match.categoryId : null,
        title: titleOf.get(sk),
        categoryName,
        categoryOff: !enabledByName.get(categoryName),
      };
    };

    const queueKeys = (queueRes.Item && queueRes.Item.Queue) || [];

    const plan = planAhead({
      seed: seedFor({ ...metaRes.Item, GameId: gameId }),
      roundNumber,
      isRandomized,
      queue: queueKeys,
      asked,
      categories,
      resolveQueued,
    }, count);

    const liveQueue = queueKeys
      .filter((key) => !asked.has(`QUESTION#${key}`))
      .map((key) => ({ key, ...resolveQueued(key) }));

    /*
      The queue entries the plan could NOT use, in queue order, each with why.
      They are still queued — the drain leaves them so a restored set recovers
      them — and the host must be able to SEE that they are parked rather than
      watch them be skipped in silence. Already-asked and disabled entries are
      not listed: the next drain drops those for good.
    */
    const blocked = liveQueue
      .filter((entry) => entry.servable === false)
      .map(({ key, reason, title, categoryName }) => ({
        key, questionId: `QUESTION#${key}`, reason, title, categoryName,
      }));

    /*
      Served-but-worth-a-word: a queued one-off whose category is switched
      off. The panel labels it "Category off"; nothing skips it.
    */
    const advisories = liveQueue
      .filter((entry) => entry.servable !== false && entry.categoryOff)
      .map(({ key, title, categoryName }) => ({
        key, questionId: `QUESTION#${key}`, reason: 'category-off', title, categoryName,
      }));

    /*
      The host's own veto list, with titles, so the panel can render a
      "Disabled this session" section with a way back — a veto that can only
      be seen in DynamoDB is a veto the host cannot undo.
    */
    const excluded = excludedKeys.map((key) => ({
      key,
      questionId: `QUESTION#${key}`,
      title: titleOf.get(`QUESTION#${key}`) || '',
    }));

    return respond(200, {
      gameId,
      roundNumber,
      isRandomized,
      // Fewer than asked means the set is running out — a fact worth showing,
      // never padded. See planAhead.
      upNext: plan.map((item) => ({
        ...item,
        title: item.title || titleOf.get(item.questionId) || '',
        categoryName: item.categoryName || nameOf.get(item.categoryId) || '',
      })),
      blocked,
      advisories,
      excluded,
      /*
        THE ROUNDS THIS GAME HAS ACTUALLY SERVED, by source id — the honest
        feed for the question browser's "asked" tags. The client used to
        derive those from what one browser session happened to watch, which
        both leaked across sessions (the state survived Back to Menu, and CSV
        imports reuse the same c001#001 numbering per set, so a NEW session
        opened with another session's rounds marked asked) and went blank on
        re-entering a played session. Truly asked only — never the disabled
        list, which is spent for the planner but was not asked.
      */
      asked: askedIds,
    });
  } catch (error) {
    console.error('❌ Up next error:', error);
    return respond(500, { error: 'Failed to work out what is coming up' });
  }
};
