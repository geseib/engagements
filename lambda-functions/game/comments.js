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
 *     GET  /games/{gameId}/comments   read a section, or a round — NEVER the
 *                                      whole session over this route; see below
 *     GET  /games/{gameId}/late        the HOST's late list, and
 *     POST /games/{gameId}/late/review its review labels (late-list.js; Cognito
 *                                      + callerMayDriveSession, 404 otherwise)
 *
 * ── PUBLIC, AND WHY THAT IS NOT THE SAME AS UNGUARDED ──────────────────────
 *
 * Both routes are public because participants hold no Cognito identity — the
 * same reason `POST /games/{gameId}/votes` is public. What is NOT public is
 * OPENING a feedback round: that is `POST /games/{gameId}/stage-beat`, which
 * carries the Cognito authorizer, because it moves what the whole room is
 * looking at.
 *
 * ── THAT SENTENCE WAS LOAD-BEARING, AND IT WAS ONCE FALSE ──────────────────
 *
 * "Carries the Cognito authorizer" was true and not sufficient. Until
 * 2026-08-27 `stage-beat` checked only that the caller was *a* host, never that
 * they were THIS session's host — so a host in any organisation, holding one of
 * the 9,000 four-digit ids, could open a feedback round on a room they had
 * nothing to do with, and the write gate below would then admit anyone with the
 * code. That was fixed in `stage-beat.js` itself
 * (`tenant.callerMayDriveSession`, asserted end-to-end by
 * `tests/session-beat-org-scope.js`), and it stays fixed regardless of
 * anything below — a rival org's host still cannot move this room's stage,
 * reveal its authors, or open anything on its behalf.
 *
 * ── WHAT PROTECTS THIS ROUTE NOW: MEMBERSHIP, OWNED HERE, NOT BORROWED ─────
 *
 * Until 26 Sep 2026 this section said the route's safety was "borrowed, not
 * owned" from `stage-beat`'s org check, because the write gate's second fact
 * was `ROUND#nnn.StageBeat === 'feedback'` — a value only a host could set, so
 * refusing a hijacked beat also refused every comment on that round. That
 * reasoning stopped being true the moment the beat requirement was dropped
 * (below): a comment no longer needs the beat, so refusing it upstream no
 * longer refuses anything here. Review of that change (26 Sep 2026, fix round
 * 1) found the gap directly: with no beat and no identity check, ANYONE
 * holding the four-digit code could post arbitrary text under an arbitrary
 * name, and that text reaches the projector's arrivals (`RoomMeter`) and both
 * reports. The owner's ruling: add membership.
 *
 * So `writeComment` now asks the table one more thing, itself, before it ever
 * looks at the round: is this playerName actually `PLAYER#<name>` in THIS
 * game? A name with no such row is refused outright. And where the codebase
 * already has a way to prove a claimed name is the same browser that claimed
 * it — `join-game.js` stamps a client-minted `ClientId` on the row, and
 * `get-answers.js`'s `getOwnAnswer` (`identityProven`) is the existing reader
 * of that stamp — this route asks the same question: if the row carries a
 * `ClientId`, the request must present the same one, or it is refused exactly
 * as a non-member is. A row with no stamped `ClientId` (joined before this
 * existed, or by a client that could not mint one) proves nothing either way
 * — and here, unlike in `get-answers.js`, that is accepted rather than
 * refused: membership alone is enough for a row with no proof to check
 * against. That is a real divergence, corrected here since fix round 2
 * mislabeled it as the same posture. `get-answers.js` FAILS CLOSED for
 * exactly this case: `identityProven` is `false` whenever `storedClientId`
 * is falsy, no matter what the request supplies, so an unowned row's answer
 * TEXT is withheld (`answerWithheld: true`) and only the already-public
 * `hasAnswer` fact is returned. This route does the opposite for that same
 * unowned row: the write is ALLOWED, not withheld. The owner's ruling this
 * fix round was specifically to accept a joined player regardless of whether
 * their row happens to carry proof, not to reach `get-answers.js`'s tighter
 * no-proof-means-withhold posture for comments — if that should change, it
 * is a deliberate decision to make here, not an oversight to quietly match.
 * THIS is now the route's own, owned protection — it does not depend on
 * `stage-beat`, `feedback`, or any other route staying correct.
 *
 * WHAT IS DELIBERATELY *NOT* ADDED HERE, still. Not full participant identity
 * verification — a player who has never left the room and whose browser holds
 * no stamped `ClientId` is still trusted on their claimed name, exactly as
 * `submit-vote.js` trusts it, and singling comments out for more would leave
 * every other participant write with the same trust while implying it had
 * been dealt with everywhere. If that posture should change it is one
 * deliberate piece of work across all of them, not a patch here.
 *
 * THE READ ADDITIONALLY REQUIRES A ROUND, which is stricter than the key
 * format allows: `commentPrefix({})` (comment-keys.js) happily returns the
 * bare `COMMENT#` session-wide prefix, because `create-report.js` wants
 * exactly that — but `create-report.js` reaches the table with its own
 * QueryCommand and never calls through this handler. Game ids are four
 * digits (create-game.js:191), so the whole id space is 9,000 values; a
 * public route that served the unscoped prefix would let an unauthenticated
 * script walk it and pull every comment out of every session it lands on, in
 * one call each, no round needed. `readFeedbackRound` below always supplies a
 * round, so nothing legitimate is narrowed by this.
 *
 * THE OTHER READER OF THAT BARE PREFIX WAS OPEN TOO, until 2026-08-28.
 * `create-report.js` queries the session-wide `COMMENT#` prefix directly, and
 * `POST /games/{gameId}/report` had no authorizer — so the walk this gate
 * refuses was available in one call on the route next door, and with the whole
 * session's names and answers attached. It carries the authorizer now and asks
 * `callerMayDriveSession`. Read that as a reason to keep this gate rather than
 * as one to relax it: the two routes were the same hole and only one of them
 * was ever guarded.
 *
 * So the gate here is not "who are you" but "is the room actually doing this
 * right now", and — AS OF 26 SEP 2026, THE OWNER'S RULING BELOW — it is ONE
 * fact read from the table, not two:
 *
 *   1. the session's STATE is `RESULTS#<the round being commented on>`.
 *
 * SINCE 16 OCT 2026 (session flow v3 §4.4, late items Task 2) THAT FACT IS
 * WIDER: "the round has been SHOWN". The room is on its RESULTS, on a later
 * round, or ENDED inside late-window.js's 24 hours (refused once the host
 * pressed "Close comments"), and the ROUND# record exists. A comment posted
 * while the room was anywhere but this round's RESULTS is no longer refused
 * as stale: it is kept with `AddedLater: true` and `PostedDuring`, so the
 * report and the host's late list can say it arrived after the room moved
 * on, rather than letting it sit as if said at the time. A round never shown
 * is still refused. The paragraphs below are the history of the narrower
 * rule and still explain why the beat is not required.
 *
 * ── THE SECOND FACT, AND WHY IT IS GONE FROM THIS HALF OF THE GATE ─────────
 *
 * Until 26 Sep 2026 a write ALSO required the round's ROUND# record to be on
 * the `feedback` beat — the host's "Request feedback" was the only door in.
 * The owner's ruling that day: *"the player's own Feedback button works on
 * any round whose results are showing, without the host opening feedback
 * mode."* A player-initiated comment button on the ORDINARY results screen
 * (`PlayerPage.jsx`'s RESULTS# arm) cannot depend on the host ever pressing
 * anything, so `writeComment` below drops the beat requirement: fact (1) is
 * now sufficient on its own, and posting a comment therefore no longer cares
 * which of `results` / `field-notes` / `feedback` the round is on. The round
 * record itself must still exist — `roundRecord()` below still reads it —
 * which is a defensive check on data integrity, not a reintroduction of the
 * beat requirement.
 *
 * THIS WIDENS *WHEN*, FOR A MEMBER — the membership check above is what still
 * answers *who*. A round the host never opens for feedback is no longer
 * permanently closed to comments once it is over: for a joined player, it is
 * open for exactly as long as the room is looking at its results, the same
 * window every other participant write (a vote, an answer) already uses. That
 * is the deliberate point of the ruling, not a side effect of it — see
 * `tests/session-beat-org-scope.js` for what stays scoped by organisation
 * regardless (stage-beat, reveal-authors) and for the membership check's own
 * coverage in `tests/round-comments.js`.
 *
 * `readFeedbackRound` (`GET /feedback-round`, further down) is UNCHANGED and
 * still requires the `feedback` beat. It is the host-triggered, WHOLE-ROOM
 * switch — the one that pulls every phone in the session into
 * `FeedbackRoundPanel` at once — and the owner was explicit that mode "stays
 * exactly as it is." A player's own button opens the same panel for
 * themselves alone, by a different route entirely, never `GET
 * /feedback-round`: PlayerPage.jsx snapshots the question it already has,
 * fetches this round's ranked responses itself from the public `POST
 * /games/get-results` (confirmed by fix round 2's re-review: the same read
 * the ordinary results screen already makes, never the host-only transition
 * path), fetches Workie's read from the public `GET /games/{id}/ai-summary`,
 * and reads what has already been said through this file's own public `GET
 * /games/{gameId}/comments`. So loosening the WRITE gate here does not touch
 * the whole-room switch at all, and confirms names print on the player's own
 * panel exactly as they do on the host-triggered one — same component, same
 * read, redacted the same way for a round `AuthorsRevealed` has not reached.
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
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { readReport, readReportHead, readReportRound } = require('./report-store');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const crypto = require('crypto');

const {
  ANCHOR_KINDS, MAX_COMMENT, MAX_EXCERPT,
  commentSk, commentPrefix, newCommentId, monotonicNow, parseCommentSk,
} = require('./comment-keys');
const { encryptItem, decryptItem, decryptItems } = require('./tenant-crypto');
const { isHidden, redactAnswers } = require('./anonymity');
const { callerMayDriveSession } = require('./tenant');
const { SURVEY_CLOSED } = require('./survey-names');
const { describeSurveyQuestion } = require('./survey-digest');
const { lateWindow } = require('./late-window');
const { queryAll } = require('./followup-store');
const { readLate, reviewLate, isLateRoute } = require('./late-list');

/**
 * What a refused comment says. The window's own two sentences ("Comments are
 * closed for this session.", "This session has closed…") live beside its rule
 * in late-window.js and are passed through as they are.
 */
const COMMENT_WORDS = {
  NOT_SHOWN: 'This round has not been shown yet.',
  SURVEY_NOT_OPEN: 'This survey is not open for comments.',
  PAUSED: 'The host has paused this for a moment.',
};
// Call & Answer follow-up asks share this function (followups.js header).
const { handleFollowUps, isFollowUpRoute } = require('./followups');

/**
 * A CLOSED SURVEY'S FEEDBACK ROUND (27 Sep 2026: the owner asked for "the
 * ability to provide feedback just like we do for call and answer").
 *
 * A survey has no rounds, so its Workie read-back and the room's comments on
 * it sit at a pseudo-round no real round can have: 000. Its comments are
 * open for exactly as long as the survey is CLOSED — the survey's own
 * "results are showing" — the same window a round's RESULTS#nnn is.
 *
 * AND THEY NEVER CARRY A NAME, whatever the session's Names setting or the
 * host's saved anonymity preference. A survey's promise to the room is about
 * what it writes about people; the composer on the phone says the name is
 * not shown (FeedbackRoundPanel), and this is what makes that true.
 */
const SURVEY_ROUND = '000';
const isSurveySession = (meta) => Boolean(meta && meta.GameType === 'survey');
const commentsHidden = (meta, round) => isSurveySession(meta) || isHidden(meta, round);

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
 *
 * `hostsOnly`: only HOST connections (`ConnectionType = 'HOST'`), for what the
 * room must never see, such as the late list's `lateChanged` (owner, Q14:
 * review labels never reach a phone or the wall).
 */
const broadcastToGame = async (gameId, message, { hostsOnly = false } = {}) => {
  try {
    const apigateway = new ApiGatewayManagementApiClient({
      endpoint: process.env.WEBSOCKET_API_ENDPOINT,
    });
    // Every page: a one-call Query past 1 MB truncates silently.
    const all = await queryAll(db, gameId, 'CONNECTION#');
    const connections = hostsOnly ? all.filter((c) => c.ConnectionType === 'HOST') : all;
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
    // The host put it on the wall (featureComment below). A boolean on the
    // wire even when the row has none, so a reader never has to tell "not
    // featured" from "written before featuring existed".
    featured: row.Featured === true,
    featuredAt: row.FeaturedAt || null,
    // Typed by the host for something said in the room.
    fromHost: row.FromHost === true,
    // Posted after the room left this round's results (late items Task 2).
    addedLater: row.AddedLater === true,
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

/** Who a host-typed comment is from: nobody in particular, the room. */
const HOST_AUTHOR = 'Said in the room';

async function writeComment(gameId, body, { asHost = false } = {}) {
  const {
    questionNumber, anchorKind, anchorRef,
    anchorLabel, anchorExcerpt, text,
  } = body;
  const playerName = asHost ? HOST_AUTHOR : body.playerName;

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
    MEMBERSHIP — see the header's "WHAT PROTECTS THIS ROUTE NOW". Read once the
    game is known to exist, and checked BEFORE the round/state gate below: a
    name that never joined this session is refused regardless of what round or
    state the room is in, the same as it would be on any other round.

    A missing PLAYER# row is a straightforward refusal. A row that DOES carry
    a `ClientId` (join-game.js stamps one when the joining client minted one)
    additionally requires the request to present that same id — the identical
    check `get-answers.js`'s `getOwnAnswer` already makes (`identityProven`) —
    so typing somebody else's already-claimed name is refused too. A row with
    no stamped `ClientId` (joined before this existed) proves nothing either
    way, and here membership alone is enough for it — NOT what `get-answers.js`
    does with the same fact: it fails closed (`identityProven` is always false
    with no stored id to check, so the answer TEXT is withheld) rather than
    allowing anything. This route allows the WRITE instead. That is a
    deliberate choice for this fix round — the owner's ruling was to accept a
    joined player whether or not their row happens to carry proof — not a
    claim that the two routes agree; see the header for the full comparison.
  */
  // The host noting what was said aloud (owner, 2026-10-13: "the host should
  // get to type things in as well, because things might be said in the
  // room"). Its proof is the signed-in host check in hostComment, not a seat.
  const playerRow = asHost ? { host: true } : (await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${author}` },
  }))).Item;
  if (!playerRow) {
    return respond(409, { error: 'you have not joined this session' });
  }
  const storedClientId = asHost ? null : (playerRow.ClientId || null);
  if (storedClientId) {
    const suppliedClientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (!suppliedClientId || suppliedClientId !== storedClientId) {
      return respond(409, { error: 'you have not joined this session' });
    }
  }

  /*
    THE GATE — see the header. `409` rather than `400`: nothing about the
    request is malformed, the round is simply not open, and a composer that
    gets a 409 can say so in a sentence instead of "bad request". Widened on
    16 Oct 2026 to "the round has been shown" (header; late items Task 2).

    OWNER'S RULING, 26 SEP 2026: this is now the WHOLE gate. Until this date a
    second check followed — `round.StageBeat !== 'feedback'` — refusing a
    comment unless the host had opened a feedback round. It is gone: the
    player's own "Feedback" button (PlayerPage.jsx's RESULTS# arm) posts here
    with no host action at all, on any beat of RESULTS. The state check below
    already establishes the one fact that still matters — the room is
    currently on THIS round's results — so it is sufficient by itself. The
    feedback-beat path (`stage-beat.js` opening `feedback`, the host's
    "Request feedback") is UNCHANGED: it always satisfied this same state
    check, and nothing here treats it any differently from a comment posted
    while the round is on its tally or its AI read-back.
  */
  /*
    A SURVEY keeps its own door, unchanged: a closed survey is its own results
    showing, so comments land on 000 while it is CLOSED and on nothing else
    (see SURVEY_ROUND above). Everything below the survey branch is rounds.
  */
  const roomState = String(state.State || '');
  let addedLater = false;
  if (isSurveySession(meta)) {
    if (padded !== SURVEY_ROUND || roomState !== SURVEY_CLOSED) {
      return respond(409, { error: COMMENT_WORDS.SURVEY_NOT_OPEN, currentState: state.State });
    }
    if (state.EventPaused) {
      return respond(409, { error: COMMENT_WORDS.PAUSED, code: 'PAUSED' });
    }
  } else {
    /*
      COMMENTS AFTER THE ROUND (session flow v3 §4.4; late items Task 2).
      A round takes comments once it has been SHOWN, not only while it is on
      screen: the room is on its RESULTS, on a later round, or the session
      ENDED inside the late window (late-window.js: 24 h, unless the host
      pressed "Close comments"). One posted while the room was anywhere but
      this round's RESULTS is kept and marked AddedLater, for the host's late
      list; it is never put on the wall by itself (only featureComment does).
    */
    const late = lateWindow({ meta, state });
    if (!late.open) {
      return respond(409, { error: late.error, code: late.code, currentState: state.State });
    }
    // An event's item, paused (events M3): nothing is posted until it resumes.
    if (state.EventPaused) {
      return respond(409, { error: COMMENT_WORDS.PAUSED, code: 'PAUSED' });
    }
    const onItsResults = roomState === `RESULTS#${padded}`;
    const roomRound = roomState.match(/^[A-Z_]+#(\d+)$/);
    const roomPastIt = Boolean(roomRound) && Number(roomRound[1]) > Number(padded);
    const shownByState = onItsResults || roomPastIt || roomState === 'ENDED';
    /*
      AND THE ROUND RECORD EXISTS. get-results.js writes ROUND#nnn as it shows
      results, so a round that never reached them has none. stage-focus.js can
      write one on VOTE, which is why the record alone is not enough and the
      state above must also have passed the round.
    */
    const round = shownByState ? await roundRecord(gameId, padded) : null;
    /*
      A ROUND THE ROOM HAS LEFT MUST HAVE HAD ITS RESULTS UP. get-results.js
      stamps ResultsShownAt as it shows them; a round skipped from VOTE can
      still have a ROUND# row (stage-focus, reveal-authors) but never that
      mark. On its own RESULTS the state already says so.
    */
    if (!round || (!onItsResults && !round.ResultsShownAt)) {
      return respond(409, { error: COMMENT_WORDS.NOT_SHOWN, code: 'NOT_SHOWN', currentState: state.State });
    }
    addedLater = !onItsResults;
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
    ...(asHost ? { FromHost: true } : {}),
    // Where the room was when this arrived, and whether that was somewhere
    // other than this round's results (late items Task 2). Reviewed is the
    // host's label, set by the late routes; null is "Not reviewed".
    PostedDuring: roomState,
    AddedLater: addedLater,
    // A host's own comment after the round is late but not news to the host:
    // it is born reviewed ('read'), so it never sits in "Not reviewed" and
    // the report keeps it under "Arrived late" whatever the setting.
    Reviewed: asHost && addedLater ? 'read' : null,
    ...(asHost && addedLater ? { ReviewedAt: now } : {}),
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

  /*
    A ROUND IS REQUIRED ON THIS ROUTE — unlike `commentPrefix({})` itself,
    which happily returns the bare 'COMMENT#' session-wide prefix, because
    `create-report.js` wants exactly that (comment-keys.js's own doc comment
    says so). That caller reaches the table with its own direct QueryCommand
    and never calls this function, so tightening the requirement here does not
    touch it.

    This route is PUBLIC and unauthenticated — the same reason
    `GET /games/{id}/answers` is public — and game ids are four digits
    (create-game.js:191): the id space is 9,000 values. Without this gate an
    unauthenticated script walking it gets back every comment in every live or
    recently-ended session it lands on, on any tenant, decrypted, with author
    names attached, in one call each — the widest public surface this feature
    has, because unlike the answers route it needs no round scoping at all to
    get the whole game in one shot.

    `readFeedbackRound` below always supplies a round when it calls this
    function, so nothing that legitimately needs a read is affected.
  */
  if (questionNumber === undefined || questionNumber === null || questionNumber === '') {
    return respond(400, { error: 'questionNumber is required' });
  }
  if (!/^\d+$/.test(String(questionNumber).trim())) {
    return respond(400, { error: 'questionNumber must be numeric' });
  }

  const prefix = commentPrefix({
    questionNumber: String(questionNumber).trim().padStart(3, '0'),
    ...(anchorKind ? { anchorKind, anchorRef } : {}),
  });
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
    out.push(...(commentsHidden(meta, roundCache.get(padded)) ? redactAnswers(wire) : wire));
  }

  // Sort AFTER regrouping: the per-round grouping above loses the query's own
  // ordering, and a round's comments must read in the order they were written.
  out.sort((a, b) => String(a.commentId).localeCompare(String(b.commentId)));

  return respond(200, { gameId, comments: out });
}

// ──────────────────────────────────────────────── GET /feedback-round ──────

/**
 * A CLOSED SURVEY, AS THE ROUND THE ROOM COMMENTS ON.
 *
 * Built from the stored report the host has just made (`surveyResults`, the
 * frozen results create-report.js reads with survey-host.js's own reader) and
 * the 000 slice's `aiSummary` — the Workie's read. One row per question, in the
 * survey's order, each the same words the Workie was given about it
 * (survey-digest.js), so a comment on "response 3" is a comment on question
 * 3's result. No row carries a name: the results never held one.
 *
 * In the shape RoundReport.jsx reads — `title`, `detail`, `answers[].answer` —
 * with the report's own spellings (`questionData`, `answerText`) alongside, so
 * a reader written against either finds it.
 */
function surveyFeedbackRound(report) {
  const results = report && report.surveyResults;
  if (!results || !Array.isArray(results.questions)) return null;
  const read = (report.detailedQuestions || []).find((q) => String(q.questionNumber) === SURVEY_ROUND);
  const title = report.gameTitle || 'The survey';
  const count = results.questions.length;
  const detail = `${Number(results.n) || 0} answered · ${count} question${count === 1 ? '' : 's'}`;
  const answers = results.questions.map((q, i) => {
    const text = describeSurveyQuestion(q, i);
    return { answerIndex: i, answer: text, answerText: text };
  });
  return {
    // Rows are questions, not people's responses: RoundReport.jsx titles the
    // list by question and prints no "Response 1" author beside each.
    kind: 'survey',
    questionNumber: SURVEY_ROUND,
    number: SURVEY_ROUND,
    ordinal: 0,
    title,
    detail,
    questionData: { title, detail, category: 'Survey' },
    answers,
    aiSummary: (read && read.aiSummary) || null,
  };
}

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
 *
 * UNCHANGED BY THE 26 SEP 2026 RULING ABOVE, deliberately. `writeComment`
 * dropped its beat requirement that day; this function still has one, because
 * it does two things the owner said should stay exactly as they were: it is
 * the HOST'S whole-room switch (nobody's phone jumps into `FeedbackRoundPanel`
 * until the host opens `feedback`), and it reads the snapshot the host built,
 * which a player pressing their own button has no way to have caused to
 * exist. The player's own button never calls this route at all — it builds
 * its round from data the page already has plus the public
 * `GET /games/{id}/ai-summary`, so it needs neither the beat nor the REPORT
 * row this function depends on.
 */
async function readFeedbackRound(gameId) {
  const { meta, state } = await readSession(gameId);
  if (!meta || !state) return respond(404, { error: 'Game not found' });

  const onScreen = String(state.State || '').match(/^RESULTS#(\d+)$/);
  const surveyClosed = isSurveySession(meta) && state.State === SURVEY_CLOSED;
  if (!onScreen && !surveyClosed) {
    return respond(409, { error: 'the host has not opened a feedback round' });
  }
  const padded = onScreen ? onScreen[1] : SURVEY_ROUND;

  const round = await roundRecord(gameId, padded);
  if (!round || round.StageBeat !== 'feedback') {
    return respond(409, { error: 'the host has not opened a feedback round' });
  }

  // One round: one GetItem on its own row (report-store.js). A closed survey
  // reads the head, where its results live.
  const orgId = orgOf(meta);
  const table = process.env.TABLE_NAME;
  // The head names the round and the session (two small reads in all).
  const report = surveyClosed
    ? await readReport(db, { table, gameId, orgId })
    : await readReportHead(db, { table, gameId, orgId });
  if (!report) {
    return respond(409, { error: 'the round report is not ready yet' });
  }
  const slice = surveyClosed
    ? surveyFeedbackRound(report)
    : await readReportRound(db, { table, gameId, orgId, questionNumber: padded });
  if (!slice) {
    return respond(409, { error: 'the round report is not ready yet' });
  }

  // The comments come from the live rows, not from the report's own snapshot:
  // the report was built when the host opened the round and every comment
  // arrived after it. Reusing readComments keeps one anonymity gate rather than
  // a second copy of it here.
  const live = JSON.parse((await readComments(gameId, { questionNumber: padded })).body);

  // "Arrived late" is the host's and the report's: its review labels never
  // reach a phone (owner, Q14), and neither do its late items.
  const { late: _hostOnly, ...roomSlice } = slice;

  return respond(200, {
    gameId,
    // Named separately as well as on the round, because this is what the
    // composer posts back and it must not have to dig for it.
    questionNumber: padded,
    roundNoun: report.roundNoun || null,
    gameTitle: report.gameTitle || null,
    round: { ...roomSlice, comments: live.comments || [] },
  });
}

// ──────────────────────────────────────────── POST /comments/host ────────

/**
 * THE HOST TYPES WHAT WAS SAID IN THE ROOM (owner, 2026-10-13). Not public:
 * Cognito in front and callerMayDriveSession behind, 404 on anyone else, the
 * same pair and shape as featureComment. Then the player write, with the room
 * as its author and no seat to prove.
 */
async function hostComment(event, gameId, body) {
  const { meta } = await readSession(gameId);
  if (!meta) return respond(404, { error: 'Game not found' });
  const claims = event?.requestContext?.authorizer?.jwt?.claims || event?.requestContext?.authorizer?.lambda;
  if (!claims || !callerMayDriveSession(event, meta)) {
    return respond(404, { error: 'Game not found' });
  }
  return writeComment(gameId, body, { asHost: true });
}

// ─────────────────────────────────── POST /comments/{commentId}/feature ────

/**
 * THE HOST PUTS ONE COMMENT ON THE WALL.
 *
 * The owner (2026-09-22): after results, "there needs to be a way to get that
 * info up on the screen … click on those would allow everyone to see them.
 * this feedback needs to be captured for the reports as well." The stage's
 * earlier ruling — no text on the wall — is reversed for the text the host
 * CHOOSES; the arrivals list on the stage stays unattributed and only the
 * featured one carries its author, who was told on their phone that their
 * name would be shown with the comment.
 *
 * THIS ROUTE IS NOT PUBLIC — the one route in this file that is not. Cognito
 * in front (template-clean.yaml) and `callerMayDriveSession` on the session's
 * own org behind it, the same pair stage-beat.js pays and for the same reason:
 * the id space is 9,000 four-digit codes, and "feature" is a write against
 * somebody's room. 404, not 403, on a caller who is not this session's host —
 * the same shape as the beat, so an outsider learns nothing from the status.
 *
 * UPDATE, never PUT: the prose stays exactly as it was written and encrypted;
 * only `Featured`/`FeaturedAt` change. The row is found by its round prefix
 * and the id at the end of its key, because the anchor segments between the
 * two are not in the request and must not be trusted from it.
 */
async function featureComment(event, gameId, commentId, body) {
  const questionNumber = body && body.questionNumber;
  if (questionNumber === undefined || questionNumber === null || questionNumber === '') {
    return respond(400, { error: 'questionNumber is required' });
  }
  if (!/^\d+$/.test(String(questionNumber).trim())) {
    return respond(400, { error: 'questionNumber must be numeric' });
  }
  if (typeof body.featured !== 'boolean') {
    return respond(400, { error: 'featured must be a boolean' });
  }
  const padded = String(questionNumber).trim().padStart(3, '0');

  const { meta } = await readSession(gameId);
  if (!meta) return respond(404, { error: 'Game not found' });
  // No identity at all is a phone. A phone cannot feature.
  const claims = event?.requestContext?.authorizer?.jwt?.claims || event?.requestContext?.authorizer?.lambda;
  if (!claims || !callerMayDriveSession(event, meta)) {
    return respond(404, { error: 'Game not found' });
  }

  const rows = await queryAll(db, gameId, commentPrefix({ questionNumber: padded }));
  const row = rows.find((item) => (parseCommentSk(item.SK) || {}).commentId === String(commentId));
  if (!row) return respond(404, { error: 'Comment not found' });

  const now = new Date().toISOString();
  /*
    ON THE WALL IS "REVIEWED WITH THE ROOM" (session flow v3 §4.4, late items
    Task 3): featuring an ADDED-LATER comment also sets Reviewed 'shown'. An
    on-time comment is not a late item and carries no review. Taking it down
    does not undo that; it was shown.
  */
  const markShown = body.featured === true && row.AddedLater === true;
  const updated = await db.send(new UpdateCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: row.PK, SK: row.SK },
    UpdateExpression: markShown
      ? 'SET #featured = :featured, #featuredAt = :at, #reviewed = :shown, #reviewedAt = :at'
      : 'SET #featured = :featured, #featuredAt = :at',
    ExpressionAttributeNames: {
      '#featured': 'Featured',
      '#featuredAt': 'FeaturedAt',
      ...(markShown ? { '#reviewed': 'Reviewed', '#reviewedAt': 'ReviewedAt' } : {}),
    },
    ExpressionAttributeValues: { ':featured': body.featured, ':at': now, ...(markShown ? { ':shown': 'shown' } : {}) },
    ReturnValues: 'ALL_NEW',
  }));

  await broadcastToGame(gameId, {
    type: 'commentFeatured',
    gameId,
    questionNumber: padded,
    commentId: String(commentId),
    featured: body.featured,
    timestamp: now,
  });
  // An added-later comment's label changed: the host's late list refetches.
  if (markShown) {
    await broadcastToGame(gameId, { type: 'lateChanged', gameId }, { hostsOnly: true });
  }

  const orgId = orgOf(meta);
  const plain = orgId ? await decryptItem(orgId, 'comment', updated.Attributes || row) : (updated.Attributes || row);
  const wire = toWire(plain);
  return respond(200, {
    status: 'OK', gameId, questionNumber: padded,
    // Not even to the host: a survey's comments carry no name anywhere.
    comment: isSurveySession(meta) ? redactAnswers([wire])[0] : wire,
  });
}

// ─────────────────────────────────────────────────── late list ──────────────

/**
 * GET /games/{gameId}/late and POST /games/{gameId}/late/review (late-list.js).
 * NOT PUBLIC: Cognito in front (template-clean.yaml) and callerMayDriveSession
 * on the session's own org here, 404 to anyone else, before anything is read
 * beyond METADATA or anything in the body is looked at.
 */
async function lateRoute(event, gameId, method) {
  const { meta, state } = await readSession(gameId);
  if (!meta) return respond(404, { error: 'Game not found' });
  const claims = event?.requestContext?.authorizer?.jwt?.claims || event?.requestContext?.authorizer?.lambda;
  if (!claims || !callerMayDriveSession(event, meta)) {
    return respond(404, { error: 'Game not found' });
  }
  if (method === 'GET') return readLate(db, { gameId, meta, state: state || null });
  let body = {};
  try {
    body = JSON.parse(event.body || '{}') || {};
  } catch {
    return respond(400, { error: 'Body must be JSON' });
  }
  return reviewLate(db, broadcastToGame, { gameId, meta, state, body });
}

// ───────────────────────────────────────────────────────── handler ─────────

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return respond(200, {});

  const { gameId } = event.pathParameters || {};
  if (!gameId) return respond(400, { error: 'gameId is required' });

  try {
    // The follow-up asks' two route families (followups.js), behind their own
    // switch; the same table client and the same notify-then-refetch broadcast.
    if (isFollowUpRoute(event.requestContext?.routeKey || event.routeKey)) {
      return await handleFollowUps(event, { db, broadcast: broadcastToGame });
    }
    // The host's late list (late-list.js): Cognito in front, and here the
    // same check featureComment makes, 404 to anyone else.
    if (isLateRoute(event)) {
      return await lateRoute(event, gameId, method);
    }
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
    const route = event.requestContext?.routeKey || event.routeKey || '';
    if (route.endsWith('/comments/host')) {
      return await hostComment(event, gameId, body);
    }
    if (route.includes('/feature')) {
      return await featureComment(event, gameId, event.pathParameters?.commentId, body);
    }
    return await writeComment(gameId, body);
  } catch (error) {
    console.error('❌ COMMENTS: error:', error);
    return respond(500, { error: 'Failed to handle the comment' });
  }
};
