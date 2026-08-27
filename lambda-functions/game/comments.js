/**
 * COMMENTS ON ONE SECTION OF A ROUND'S REPORT.
 *
 * The owner asked for a feedback round: *"there is a new round where every one
 * can comment on what they have heard … they click on a section (the summary,
 * the results, a specific user response) and the comments now can be seen in the
 * resulting round of feedback … these will get added to the round report and the
 * over all report as well."*
 *
 *     POST /games/{gameId}/comments   write one
 *     GET  /games/{gameId}/comments   read a section, a round, or the session
 *
 * ── PUBLIC, AND WHY THAT IS NOT THE SAME AS UNGUARDED ──────────────────────
 *
 * Both routes are public because participants hold no Cognito identity — the
 * same reason `POST /games/{gameId}/votes` is public. What is NOT public is
 * OPENING a feedback round: that is `POST /games/{gameId}/stage-beat`, which
 * carries the Cognito authorizer, because it moves what the whole room is
 * looking at.
 *
 * So the gate here is not "who are you" but "is the room actually doing this
 * right now", and it is two facts read from the table, not one:
 *
 *   1. the session's STATE is `RESULTS#<the round being commented on>`, and
 *   2. that round's ROUND# record is on the `feedback` beat.
 *
 * BOTH, because either alone leaves a hole. Without (1) a phone still showing
 * round 3's composer writes into round 3 while the room is on round 4 — the
 * comment then appears in a report against material the room has moved past.
 * Without (2) anyone holding the four-digit code can write comments into a
 * session that never opened a feedback round at all. Neither is a security
 * boundary — the code is on the projector — but both are correctness
 * boundaries, and the failure they prevent is silent.
 *
 * ── HTTP, NOT THE WEBSOCKET ANSWER PATH ────────────────────────────────────
 *
 * Answers go over the socket as `ANSWER#nnn`; votes go over HTTP. A comment
 * follows the vote, because a comment needs a status code the participant can
 * see. A socket send is fire-and-forget, and a comment silently lost is worse
 * than a response silently lost: a response has a tally afterwards that shows
 * it missing, and a comment has nothing.
 *
 * ── NOTIFY, THEN REFETCH ───────────────────────────────────────────────────
 *
 * The broadcast carries WHERE something changed and never the prose. Same shape
 * as `authorsRevealed`, and for one extra reason here: the read path applies
 * the anonymity gate, so putting the comment on the wire would route it around
 * the redaction rather than through it.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const crypto = require('crypto');

const {
  ANCHOR_KINDS, MAX_COMMENT, MAX_EXCERPT,
  commentSk, commentPrefix, newCommentId, monotonicNow, parseCommentSk,
} = require('./comment-keys');
const { encryptItem, decryptItem, decryptItems } = require('./tenant-crypto');
const { isHidden, redactAnswers } = require('./anonymity');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/**
 * A comment lives as long as the report it has to appear in.
 *
 * THIRTY DAYS, which is the table's durable-content tier: the AI summary
 * (get-ai-summary.js:1203), the score rows (get-results.js:588) and the REPORT
 * row itself (create-report.js:728) all sit here. A comment belongs with them
 * because it is an OUTPUT that must survive into a report — not a raw input to
 * a tally like a vote, which exists only until the tally is computed and baked
 * in, and is 7 days for exactly that reason.
 *
 * WHAT THIS TTL DOES NOT BUY, because the first draft of the design claimed it
 * did: it does not make a comment and the thing it annotates share a fate.
 * `create-report.js` rebuilds `detailedQuestions[i].answers` from the raw
 * `QUESTION#nnn#ANSWER#` rows, which are 7 days, so from day 8 a rebuilt report
 * has no responses in it at all while the summary and the comments are both
 * still there. No comment TTL fixes that. What protects a comment's meaning is
 * `AnchorExcerpt` — the slice of the commented-on material stored on this row —
 * which from day 8 is the only surviving copy of what was being discussed.
 */
const COMMENT_TTL_SECONDS = 30 * 24 * 60 * 60;

const respond = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: { 'Access-Control-Allow-Origin': '*' },
});

/**
 * Tell the room something changed. Never throws: the row is already written by
 * the time this runs, and reporting a failure would tell a participant their
 * comment did not land when it did.
 */
const broadcastToGame = async (gameId, message) => {
  try {
    const apigateway = new ApiGatewayManagementApiClient({
      endpoint: process.env.WEBSOCKET_API_ENDPOINT,
    });
    const res = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#' },
    }));

    const connections = res.Items || [];
    if (connections.length === 0) return;

    await Promise.all(connections.map(async (conn) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: conn.ConnectionId,
          Data: JSON.stringify(message),
        }));
      } catch (err) {
        // 410 Gone == the client is long dead. Drop the row inline; PK/SK are
        // known from the connection item, so no scan is needed.
        const status = err.statusCode || err.$metadata?.httpStatusCode || err.$response?.statusCode;
        if (status === 410 || err.name === 'GoneException') {
          await db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: conn.PK, SK: conn.SK },
          })).catch(() => {});
        } else {
          console.error(`❌ COMMENTS: broadcast failed for ${conn.ConnectionId}:`, err.message);
        }
      }
    }));
  } catch (err) {
    console.error('❌ COMMENTS: broadcast failed entirely (continuing):', err);
  }
};

/** The org this session belongs to, read off the row. The routes are public, so
 *  it cannot come from the caller — same as submit-vote.js. */
const orgOf = (item) => (item && typeof item.orgId === 'string' ? item.orgId.trim() : '');

/** One stored row as the wire sees it. Keys are lower-camel because that is
 *  what `create-report.js` emits and what `displayLabelFor` reads. */
function toWire(row) {
  const parsed = parseCommentSk(row.SK) || {};
  return {
    commentId: parsed.commentId || null,
    questionNumber: row.QuestionNumber,
    anchorKind: row.AnchorKind,
    anchorRef: row.AnchorRef,
    anchorLabel: row.AnchorLabel,
    anchorExcerpt: row.AnchorExcerpt,
    text: row.Text,
    playerName: row.playerName,
    name: row.name,
    submittedAt: row.SubmittedAt,
  };
}

/** Read the two rows the gate needs. */
async function readSession(gameId) {
  const [meta, state] = await Promise.all([
    db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
    })),
    db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
    })),
  ]);
  return { meta: meta.Item, state: state.Item };
}

const roundRecord = async (gameId, padded) => (await db.send(new GetCommand({
  TableName: process.env.TABLE_NAME,
  Key: { PK: `GAME#${gameId}`, SK: `ROUND#${padded}` },
}))).Item;

// ─────────────────────────────────────────────────────────── POST ──────────

async function writeComment(gameId, body) {
  const {
    questionNumber, playerName, anchorKind, anchorRef,
    anchorLabel, anchorExcerpt, text,
  } = body;

  // Validate BEFORE reading the table: a malformed request should cost nothing.
  if (!/^\d+$/.test(String(questionNumber ?? '').trim())) {
    return respond(400, { error: 'a numeric questionNumber is required' });
  }
  if (!ANCHOR_KINDS.includes(anchorKind)) {
    return respond(400, { error: `anchorKind must be one of: ${ANCHOR_KINDS.join(', ')}` });
  }
  const author = String(playerName ?? '').trim();
  if (!author) {
    return respond(400, { error: 'playerName is required' });
  }
  const prose = String(text ?? '').trim();
  if (!prose) {
    return respond(400, { error: 'a comment cannot be empty' });
  }
  if (prose.length > MAX_COMMENT) {
    return respond(400, { error: `a comment is at most ${MAX_COMMENT} characters` });
  }

  const padded = String(questionNumber).trim().padStart(3, '0');

  // Build the key now, so an unusable anchorRef is refused here rather than
  // becoming a row nothing will ever read again.
  const sk = commentSk({
    questionNumber: padded,
    anchorKind,
    anchorRef,
    commentId: newCommentId(monotonicNow(), crypto.randomBytes(4).toString('hex')),
  });
  if (!sk) {
    return respond(400, {
      error: anchorKind === 'response'
        ? 'a response comment needs a numeric anchorRef'
        : 'the anchor could not be resolved',
    });
  }

  const { meta, state } = await readSession(gameId);
  if (!meta || !state) {
    return respond(404, { error: 'Game not found' });
  }

  /*
    THE GATE. Both halves — see the header. `409` rather than `400`: nothing
    about the request is malformed, the room has simply moved, and a composer
    that gets a 409 can say "the host has closed this round" instead of "bad
    request".
  */
  if (String(state.State) !== `RESULTS#${padded}`) {
    return respond(409, {
      error: 'this round is no longer open for comments',
      currentState: state.State,
    });
  }
  const round = await roundRecord(gameId, padded);
  if (!round || round.StageBeat !== 'feedback') {
    return respond(409, { error: 'the host has not opened a feedback round' });
  }

  const now = new Date().toISOString();
  const record = {
    PK: `GAME#${gameId}`,
    SK: sk,
    GameId: gameId,
    QuestionNumber: padded,
    AnchorKind: anchorKind,
    // Re-derived from the key rather than trusted from the body, so the stored
    // attribute and the sort key can never disagree about which response this
    // is about.
    AnchorRef: parseCommentSk(sk).anchorRef,
    AnchorLabel: String(anchorLabel ?? '').slice(0, 200),
    AnchorExcerpt: String(anchorExcerpt ?? '').slice(0, MAX_EXCERPT + 1),
    Text: prose,
    /*
      LOWER-CASE, BOTH OF THEM, and this is load-bearing rather than incidental.
      `ANON_FIELDS` in anonymity.js is exactly
      ['playerId', 'playerName', 'name'] — an answer row's capital-P
      `PlayerName` is not in it, so copying that spelling here would leave the
      author untouched by `redactAnswers` and make the gate below decorative.
    */
    playerName: author,
    name: author,
    SubmittedAt: now,
    ttl: Math.floor(Date.now() / 1000) + COMMENT_TTL_SECONDS,
  };

  // The route is public, so the organisation comes off the session row, never
  // off the caller. A pre-tenancy session has no orgId and keeps plaintext.
  const orgId = orgOf(meta);
  await db.send(new PutCommand({
    TableName: process.env.TABLE_NAME,
    Item: orgId ? await encryptItem(orgId, 'comment', record) : record,
  }));

  await broadcastToGame(gameId, {
    type: 'commentPosted',
    gameId,
    questionNumber: padded,
    anchorKind,
    anchorRef: record.AnchorRef,
    timestamp: now,
  });

  return respond(201, {
    status: 'OK',
    gameId,
    questionNumber: padded,
    comment: toWire(record),
  });
}

// ──────────────────────────────────────────────────────────── GET ──────────

async function readComments(gameId, query) {
  const { questionNumber, anchorKind, anchorRef } = query;

  // An omitted round is the whole session — what create-report wants. A round
  // that IS supplied has to be a number, or the prefix is meaningless.
  const scoped = questionNumber !== undefined && questionNumber !== null && questionNumber !== '';
  if (scoped && !/^\d+$/.test(String(questionNumber).trim())) {
    return respond(400, { error: 'questionNumber must be numeric' });
  }

  const prefix = commentPrefix(scoped
    ? {
      questionNumber: String(questionNumber).trim().padStart(3, '0'),
      ...(anchorKind ? { anchorKind, anchorRef } : {}),
    }
    : {});
  if (prefix === null) {
    return respond(400, { error: 'the anchor could not be resolved' });
  }

  const { meta } = await readSession(gameId);
  if (!meta) {
    return respond(404, { error: 'Game not found' });
  }

  const res = await db.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': prefix },
  }));

  const orgId = orgOf(meta);
  const items = orgId
    ? await decryptItems(orgId, 'comment', res.Items || [])
    : (res.Items || []);

  /*
    ANONYMITY, PER ROUND, THROUGH THE EXISTING GATE.

    Today this can never redact anything: `get-results.js:265` sets
    `AuthorsRevealed` unconditionally on entering RESULTS, and a feedback round
    is a beat INSIDE results, so by the time anyone can comment the round is
    already attributed. It is wired anyway, and cheaply, so that if the reveal
    semantics ever change, comments redact WITH responses instead of becoming
    the one surface in the product that still prints names.

    Per round rather than per request, because a session-wide read spans rounds
    and each round carries its own `AuthorsRevealed`. Answering a per-round
    question with a session-wide flag is the exact defect `PastRound.jsx`
    records: it relabelled three finished rounds "Response 1, 2, 3".

    `redactAnswers` is used as-is rather than a comment-shaped copy: it strips
    ANON_FIELDS from each element preserving order and length, which is exactly
    the job, and `anonymity.js` is byte-identical across two directories under a
    drift guard. Editing it for no behavioural gain is pure risk.
  */
  const roundCache = new Map();
  const out = [];
  const byRound = new Map();
  for (const item of items) {
    const list = byRound.get(item.QuestionNumber) || [];
    list.push(item);
    byRound.set(item.QuestionNumber, list);
  }
  for (const [padded, list] of byRound) {
    if (!roundCache.has(padded)) roundCache.set(padded, await roundRecord(gameId, padded));
    const wire = list.map(toWire);
    out.push(...(isHidden(meta, roundCache.get(padded)) ? redactAnswers(wire) : wire));
  }

  // Sort AFTER regrouping: the per-round grouping above loses the query's own
  // ordering, and a round's comments must read in the order they were written.
  out.sort((a, b) => String(a.commentId).localeCompare(String(b.commentId)));

  return respond(200, { gameId, comments: out });
}

// ──────────────────────────────────────────────── GET /feedback-round ──────

/**
 * THE ONE ROUND A PARTICIPANT IS BEING ASKED TO COMMENT ON.
 *
 * The owner: *"they should have a copy of the feedback report (the same item
 * that is avail when you click the previous round in the session rounds screen.
 * so they can read, copy paste."*
 *
 * This route exists because both of the obvious ways to give a phone that
 * report are wrong:
 *
 *   - `POST /games/{id}/report` WRITES. Forty phones calling it is forty
 *     full-partition re-queries, forty KMS encrypts, and forty overwrites of
 *     the one `SK: 'REPORT'` row, per feedback round.
 *   - `GET /games/{id}/report` is read-only, but branches on a `?role=` query
 *     parameter the handler itself documents as unverifiable, and its non-host
 *     branch returns a leaderboard with NO `detailedQuestions` — nothing to
 *     comment on. A phone passing `role=host` would work and would receive the
 *     entire session: every round, every response, and the standings. That is a
 *     far larger grant than a feedback round needs, taken by leaning on a check
 *     that is known not to hold.
 *
 * So: ONE round, the one actually on the `feedback` beat, no standings, no
 * other round, and a 409 when no round is open. Minimum privilege by
 * construction rather than by promise.
 *
 * It READS the stored report rather than rebuilding, so a room of forty costs
 * forty cheap reads and no writes. The host builds the row before opening the
 * beat; a phone that arrives between those two calls gets a 409 that says the
 * report is not ready, which is a state the composer can render as "the host is
 * preparing this" rather than an error a participant has to interpret.
 */
async function readFeedbackRound(gameId) {
  const { meta, state } = await readSession(gameId);
  if (!meta || !state) return respond(404, { error: 'Game not found' });

  const onScreen = String(state.State || '').match(/^RESULTS#(\d+)$/);
  if (!onScreen) {
    return respond(409, { error: 'the host has not opened a feedback round' });
  }
  const padded = onScreen[1];

  const round = await roundRecord(gameId, padded);
  if (!round || round.StageBeat !== 'feedback') {
    return respond(409, { error: 'the host has not opened a feedback round' });
  }

  const stored = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: 'REPORT' },
  }));
  if (!stored.Item) {
    return respond(409, { error: 'the round report is not ready yet' });
  }

  const orgId = orgOf(meta);
  const report = orgId ? await decryptItem(orgId, 'report', stored.Item) : stored.Item;

  const slice = (report.detailedQuestions || [])
    .find((q) => String(q.questionNumber) === padded);
  if (!slice) {
    return respond(409, { error: 'the round report is not ready yet' });
  }

  // The comments come from the live rows, not from the report's own snapshot:
  // the report was built when the host opened the round and every comment
  // arrived after it. Reusing readComments keeps one anonymity gate rather than
  // a second copy of it here.
  const live = JSON.parse((await readComments(gameId, { questionNumber: padded })).body);

  return respond(200, {
    gameId,
    // Named separately as well as on the round, because this is what the
    // composer posts back and it must not have to dig for it.
    questionNumber: padded,
    roundNoun: report.roundNoun || null,
    gameTitle: report.gameTitle || null,
    round: { ...slice, comments: live.comments || [] },
  });
}

// ───────────────────────────────────────────────────────── handler ─────────

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return respond(200, {});

  const { gameId } = event.pathParameters || {};
  if (!gameId) return respond(400, { error: 'gameId is required' });

  try {
    if (method === 'GET') {
      const route = event.requestContext?.routeKey || event.routeKey || '';
      if (route.includes('/feedback-round')) {
        return await readFeedbackRound(gameId);
      }
      return await readComments(gameId, event.queryStringParameters || {});
    }

    let body = {};
    try {
      body = JSON.parse(event.body || '{}') || {};
    } catch {
      return respond(400, { error: 'Body must be JSON' });
    }
    return await writeComment(gameId, body);
  } catch (error) {
    console.error('❌ COMMENTS: error:', error);
    return respond(500, { error: 'Failed to handle the comment' });
  }
};
