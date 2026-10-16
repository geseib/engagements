/**
 * THE HOST'S LATE LIST AND ITS REVIEW (session flow v3 §4.4; late items Task 3).
 *
 *     GET  /games/{gameId}/late          every late item, by round
 *     POST /games/{gameId}/late/review   label one, close comments, or set the report setting
 *
 * Served by the comments function (comments.js hands these routes here, after
 * its Cognito + callerMayDriveSession check: 404 to anyone else). No new Lambda,
 * because the stack is near its resource limit.
 *
 * THREE KINDS OF LATE ITEM, each its own row, each read with a paged Query (a
 * one-call Query past 1 MB truncates silently):
 *
 *   answer      QUESTION#nnn#LATE#<player>               websocket/message.js
 *   askAnswer   FOLLOWUP#nnn#ASK#<id>#LATE#<player>      followup-store.js
 *   comment     COMMENT#nnn#… with AddedLater: true      comments.js
 *
 * An on-time comment is not late and is not listed (it is "in the round").
 *
 * NAMES follow the round's Names setting, the rule create-report.js uses
 * (`isHidden`; a survey never names). In a round that hid names `author` is
 * null and nothing on the item carries a name, the ref included: a ref is a
 * comment's id, or a hash of the row's key, never the player's name. A late
 * round answer has no response number in its round (it is not in the
 * results), so in such a round it reads "Late answer". A question for the
 * room never names anyone (followups.js), so its late answers never do either.
 *
 * REVIEW sets `Reviewed` ('shown' | 'read') and `ReviewedAt` on exactly the
 * row the ref names, found under its own kind's prefix in THIS game's
 * partition, so a ref can never reach another row type or another game.
 * 'shown' is never taken back by a later 'read'. A late round answer has no
 * wall view, so it can only be 'read' (controller ruling, 16 Oct). Putting a
 * comment or an idea on the wall marks it 'shown' through the existing routes
 * (featureComment, the Ideas pick), not through this one.
 *
 * CLOSE COMMENTS sets METADATA `CommentsClosedAt` (late-window.js then refuses
 * late ask answers and comments). Only once the session has ENDED (controller
 * ruling): before that, 409.
 *
 * THE REPORT SETTING, "Include items not reviewed" (late items Task 5), is the
 * same POST with `{ kind: 'report', how: 'include' | 'leave-out' }`: METADATA
 * `IncludeNotReviewed`, any time, and GET returns it as `includeNotReviewed`.
 * create-report.js reads it, and reads the late items through `lateByRound`.
 */
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { decryptItems } = require('./tenant-crypto');
const { isHidden } = require('./anonymity');
const { commentPrefix, parseCommentSk } = require('./comment-keys');
const keys = require('./followup-keys');
const { queryAll, ideaId } = require('./followup-store');
const { sessionIdSecret } = require('./id-secret');
const { readReportHead } = require('./report-store');
const { reviewedOf, reviewLabel, REVIEW_STATES } = require('./late-labels');

const LATE_WORDS = {
  CLOSE_TOO_SOON: 'Comments can be closed once the session has ended.',
  NO_WALL: 'A late answer to a round cannot go on the wall. Mark it reviewed instead.',
  LATE_ANSWER: 'Late answer',
  COMMENT: 'Comment',
};

const KINDS = ['answer', 'askAnswer', 'comment'];
const LATE_ANSWER_SK = /^QUESTION#(\d{3})#LATE#(.+)$/;
const HASH_REF = /^[0-9a-f]{12}$/;
const COMMENT_REF = /^\d{15}-[a-z0-9]{1,12}$/i;
const ASK_REF = /^([a-z0-9]{6,40}):([0-9a-f]{12})$/;

const respond = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: { 'Access-Control-Allow-Origin': '*' },
});
const orgOf = (item) => (item && typeof item.orgId === 'string' ? item.orgId.trim() : '');
const openAll = async (orgId, entity, rows) => (orgId ? decryptItems(orgId, entity, rows) : rows);
const hiddenIn = (meta, round) => Boolean(meta && meta.GameType === 'survey') || isHidden(meta, round);
/**
 * "Include items not reviewed" (spec §4.5, Settings › Report): on unless the
 * host turned it off. METADATA `IncludeNotReviewed`; only an explicit false
 * is off, so every session from before the setting includes everything.
 */
const includesNotReviewed = (meta) => !(meta && meta.IncludeNotReviewed === false);
const REPORT_HOW = { include: true, 'leave-out': false };
const textOf = (v) => (v === undefined || v === null ? '' : (typeof v === 'string' ? v : JSON.stringify(v)));

function item(kind, row, { round, ref, text, author, who, arrivedDuring, extra = {} }) {
  const reviewed = reviewedOf(row);
  return {
    kind,
    ref,
    round,
    text,
    label: reviewLabel(reviewed),
    arrivedAt: row.SubmittedAt || null,
    arrivedDuring: arrivedDuring || null,
    author,
    who,
    reviewed,
    ...extra,
  };
}

// ───────────────────────────────────────────────────────────── GET ──

/**
 * Every late item in the session, decrypted, as a Map of round → items (not
 * yet sorted). The one reader: the late list below and the report
 * (create-report.js, "Arrived late") both come through here, so the two can
 * never disagree about what is late or whose name may show.
 *
 * `withRefs: false` skips the session's id secret (and so every write it
 * could cause): the report needs no ref, and an answer's or an idea's ref is
 * then null. A comment's ref is its own id either way.
 */
async function lateByRound(db, { gameId, meta, withRefs = true }) {
  const orgId = orgOf(meta);
  const secret = withRefs ? await sessionIdSecret(db, gameId, meta) : null;
  const refOf = (sk) => (secret ? ideaId(secret, sk) : null);
  const [questionRows, commentRows, followUpRows, roundRows] = await Promise.all([
    queryAll(db, gameId, 'QUESTION#'),
    queryAll(db, gameId, commentPrefix({})),
    queryAll(db, gameId, keys.ROOT),
    queryAll(db, gameId, 'ROUND#'),
  ]);
  const rounds = new Map(roundRows.map((r) => [String(r.SK).replace('ROUND#', ''), r]));
  const hidden = (padded) => hiddenIn(meta, rounds.get(padded));

  const [answers, comments, asks] = await Promise.all([
    openAll(orgId, 'answer', questionRows.filter((r) => LATE_ANSWER_SK.test(String(r.SK)))),
    openAll(orgId, 'comment', commentRows.filter((r) => parseCommentSk(r.SK) && r.AddedLater === true)),
    openAll(orgId, 'followup', followUpRows.filter((r) => (keys.parseFollowUpSk(r.SK) || {}).kind === 'late')),
  ]);

  const byRound = new Map();
  const add = (round, it) => {
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push(it);
  };

  for (const row of answers) {
    const [, round, player] = LATE_ANSWER_SK.exec(String(row.SK));
    const author = hidden(round) ? null : (row.PlayerName || player);
    add(round, item('answer', row, {
      round,
      ref: refOf(row.SK),
      text: textOf(row.Answer),
      author,
      who: author || LATE_WORDS.LATE_ANSWER,
      arrivedDuring: row.ArrivedDuring,
    }));
  }
  for (const row of comments) {
    const parsed = parseCommentSk(row.SK);
    const round = parsed.questionNumber;
    const author = hidden(round) ? null : (row.playerName || row.name || null);
    add(round, item('comment', row, {
      round,
      ref: parsed.commentId,
      text: textOf(row.Text),
      author,
      who: author || LATE_WORDS.COMMENT,
      arrivedDuring: row.PostedDuring,
      // What it is about, as coordinates. Never AnchorLabel: it can carry the
      // name of the response's author ("Response 2 — Sam").
      extra: {
        anchor: { kind: parsed.anchorKind, ref: parsed.anchorRef },
        fromHost: row.FromHost === true,
        featured: row.Featured === true,
      },
    }));
  }
  for (const row of asks) {
    const k = keys.parseFollowUpSk(row.SK);
    const id = refOf(row.SK);
    add(k.round, item('askAnswer', row, {
      round: k.round,
      ref: id ? `${k.askId}:${id}` : null,
      text: textOf(row.Text !== undefined && row.Text !== null && row.Text !== '' ? row.Text : row.Value),
      author: null,
      who: LATE_WORDS.LATE_ANSWER,
      arrivedDuring: row.ArrivedDuring,
      // For the Ideas pick (followups.js): its ask and the idea's id.
      extra: { askId: k.askId, askKind: row.Kind || null, id },
    }));
  }
  return byRound;
}

/** Oldest first; on a tie, answers, then ask answers, then comments. */
const lateOrder = (a, b) => String(a.arrivedAt || '').localeCompare(String(b.arrivedAt || ''))
  || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);

async function readLate(db, { gameId, meta }) {
  const orgId = orgOf(meta);
  const byRound = await lateByRound(db, { gameId, meta });

  let roundNoun = null;
  try {
    const head = await readReportHead(db, { table: process.env.TABLE_NAME, gameId, orgId });
    roundNoun = (head && head.roundNoun) || null;
  } catch (err) {
    console.error('❌ LATE: report head unreadable (roundNoun left null):', err.message);
  }

  const out = [...byRound.keys()].sort().map((round) => ({
    round,
    roundNoun,
    items: byRound.get(round).sort(lateOrder),
  }));
  const notReviewed = out.reduce((n, r) => n + r.items.filter((i) => i.reviewed === null).length, 0);

  return respond(200, {
    gameId,
    rounds: out,
    counts: { notReviewed },
    commentsClosedAt: (meta && meta.CommentsClosedAt) || null,
    includeNotReviewed: includesNotReviewed(meta),
  });
}

// ──────────────────────────────────────────────────────────── POST ──

/** The one row a validated ref names, in this game, under its kind's prefix; or null. */
async function findRow(db, gameId, kind, round, ref, secret) {
  if (kind === 'answer') {
    const rows = await queryAll(db, gameId, `QUESTION#${round}#LATE#`);
    return rows.find((r) => LATE_ANSWER_SK.test(String(r.SK)) && ideaId(secret, r.SK) === ref) || null;
  }
  if (kind === 'comment') {
    const rows = await queryAll(db, gameId, commentPrefix({ questionNumber: round }));
    // Only an added-later comment is a late item; an on-time one is not reviewed here.
    return rows.find((r) => (parseCommentSk(r.SK) || {}).commentId === ref && r.AddedLater === true) || null;
  }
  const [, askId, id] = ASK_REF.exec(ref);
  const prefix = keys.latePrefix(round, askId);
  if (!prefix) return null;
  const rows = await queryAll(db, gameId, prefix);
  return rows.find((r) => (keys.parseFollowUpSk(r.SK) || {}).kind === 'late' && ideaId(secret, r.SK) === id) || null;
}

function refIsWellFormed(kind, ref) {
  if (typeof ref !== 'string') return false;
  if (kind === 'answer') return HASH_REF.test(ref);
  if (kind === 'comment') return COMMENT_REF.test(ref);
  const m = ASK_REF.exec(ref);
  return Boolean(m) && keys.isAskId(m[1]);
}

async function closeComments(db, broadcast, { gameId, state }) {
  if (!state || state.State !== 'ENDED') {
    return respond(409, { error: LATE_WORDS.CLOSE_TOO_SOON, code: 'NOT_ENDED' });
  }
  const res = await db.send(new UpdateCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
    // A second press keeps the first time.
    UpdateExpression: 'SET #c = if_not_exists(#c, :now)',
    ConditionExpression: 'attribute_exists(SK)',
    ExpressionAttributeNames: { '#c': 'CommentsClosedAt' },
    ExpressionAttributeValues: { ':now': new Date().toISOString() },
    ReturnValues: 'ALL_NEW',
  }));
  await broadcast(gameId, { type: 'lateChanged', gameId }, { hostsOnly: true });
  return respond(200, { gameId, commentsClosedAt: (res.Attributes && res.Attributes.CommentsClosedAt) || null });
}

/**
 * THE REPORT SETTING, "Include items not reviewed" (late items Task 5). On
 * this route, like Close comments, so it costs no new route. Any time, ENDED
 * included: it changes only what the next report generation prints
 * (create-report.js reads it), never what the room was shown.
 */
async function setReportSetting(db, broadcast, { gameId, how }) {
  if (!Object.prototype.hasOwnProperty.call(REPORT_HOW, how)) {
    return respond(400, { error: "report takes how: 'include' or 'leave-out'" });
  }
  await db.send(new UpdateCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
    UpdateExpression: 'SET #i = :i',
    ConditionExpression: 'attribute_exists(SK)',
    ExpressionAttributeNames: { '#i': 'IncludeNotReviewed' },
    ExpressionAttributeValues: { ':i': REPORT_HOW[how] },
  }));
  await broadcast(gameId, { type: 'lateChanged', gameId }, { hostsOnly: true });
  return respond(200, { gameId, includeNotReviewed: REPORT_HOW[how] });
}

async function reviewLate(db, broadcast, { gameId, meta, state, body }) {
  const { kind, how, ref } = body || {};
  if (kind === 'report') return setReportSetting(db, broadcast, { gameId, how });
  if (kind === 'comments') {
    if (how !== 'close') return respond(400, { error: "comments takes how: 'close'" });
    return closeComments(db, broadcast, { gameId, state });
  }
  if (!KINDS.includes(kind)) return respond(400, { error: `kind must be one of: ${KINDS.join(', ')}, comments, report` });
  if (!REVIEW_STATES.includes(how)) return respond(400, { error: `how must be one of: ${REVIEW_STATES.join(', ')}` });
  if (kind === 'answer' && how === 'shown') return respond(400, { error: LATE_WORDS.NO_WALL, code: 'NO_WALL' });
  const round = keys.roundOf(body.round);
  if (!round) return respond(400, { error: 'round must be a round number' });
  if (!refIsWellFormed(kind, ref)) return respond(400, { error: 'ref does not name a late item' });

  const row = await findRow(db, gameId, kind, round, ref, kind === 'comment' ? null : await sessionIdSecret(db, gameId, meta));
  if (!row) return respond(404, { error: 'Not found' });

  // 'shown' is the stronger fact: a later "Mark reviewed" never takes it back.
  let reviewed = how;
  if (reviewedOf(row) === 'shown' && how === 'read') {
    reviewed = 'shown';
  } else {
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: row.PK, SK: row.SK },
      UpdateExpression: 'SET #r = :r, #at = :at',
      ConditionExpression: 'attribute_exists(SK)',
      ExpressionAttributeNames: { '#r': 'Reviewed', '#at': 'ReviewedAt' },
      ExpressionAttributeValues: { ':r': how, ':at': new Date().toISOString() },
    }));
  }
  await broadcast(gameId, { type: 'lateChanged', gameId }, { hostsOnly: true });
  return respond(200, { gameId, kind, round, ref, reviewed, label: reviewLabel(reviewed) });
}

/**
 * Does this request belong here? (comments.js asks before routing.) By its
 * routeKey, or, when that is absent, by its method and rawPath, so a request
 * without a routeKey can never fall through to the public comments read.
 */
function isLateRoute(event) {
  const routeKey = String((event && (event.requestContext?.routeKey || event.routeKey)) || '');
  if (/\/games\/\{gameId\}\/late(?:\/review)?$/.test(routeKey)) return true;
  const rawPath = String((event && (event.rawPath || event.path || event.requestContext?.http?.path)) || '');
  return /\/games\/[^/]+\/late(?:\/review)?\/?$/.test(rawPath);
}

module.exports = {
  readLate, reviewLate, isLateRoute, lateByRound, lateOrder, includesNotReviewed, LATE_WORDS,
};
