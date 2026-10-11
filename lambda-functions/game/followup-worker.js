/**
 * THE FOLLOW-UP SUGGESTIONS, MADE BY THE READ'S OWN WORKER.
 *
 * docs/design/ca-followup-asks PLAN.md T7. get-ai-summary.js calls this in
 * worker mode AFTER the round's read is stored and `aiSummaryReady` has gone
 * out, so the room already has its read when this starts, and nothing this
 * does can delay it. It also runs alone, on the host's "make them again"
 * (`followUps=suggest`), against the read already stored.
 *
 * IT NEVER THROWS. The worker is an async (Event) invocation: a throw would
 * make Lambda retry it, and the retry regenerates the room's read. So every
 * failure here is caught, logged as a reason word, and the worker returns as
 * if this had not run. For the same reason it never runs into the function's
 * timeout: the model call gets a deadline well inside the time left.
 *
 * WHEN IT RUNS — all of:
 *   FOLLOWUP_ASKS_ENABLED is 'on' (dev only, for now);
 *   the session is Call & Answer (owner, 2026-10-11: "Call & Answer only");
 *   the read was written by a model — a fallback template read gets no
 *   suggestions, and any earlier ones for the round are deleted, since they
 *   were made from a read the room no longer sees;
 *   the round has answers.
 */
const { isCallAndAnswer } = require('./briefing');
const { normalizeGameType } = require('./game-types');
const { resolveTask } = require('./task-instruction');
const { rankAnswers } = require('./numbered-answers');
const { suggestFollowUps } = require('./followup-asks');
const store = require('./followup-store');

/** Time kept back from the function's remaining time, for the write and the broadcast. */
const RESERVE_MS = 20000;
/** Less than this left for the model call: do not start it. */
const MIN_CALL_MS = 20000;

/** Every name known in the session: the answers' authors, the players, the host. */
async function rosterNames(db, gameId, answers, hostName) {
  const names = new Set();
  for (const a of answers || []) {
    const n = a && (a.playerName || a.PlayerName);
    if (typeof n === 'string' && n.trim()) names.add(n.trim());
  }
  try {
    const rows = await store.queryAll(db, gameId, 'PLAYER#');
    for (const r of rows) {
      const fromKey = String(r.SK || '').slice('PLAYER#'.length).replace(/#SCORE$/, '');
      const n = typeof r.PlayerName === 'string' && r.PlayerName.trim() ? r.PlayerName : fromKey;
      if (n && n.trim()) names.add(n.trim());
    }
  } catch (e) {
    // The answers' authors are still checked; the log says the roster read failed.
    console.warn(JSON.stringify({ event: 'followup-asks-roster', gameId, error: (e && e.name) || 'Error' }));
  }
  if (typeof hostName === 'string' && hostName.trim()) names.add(hostName.trim());
  return [...names];
}

/**
 * @param {object} p
 * @param {object} p.db           the worker's DocumentClient
 * @param {object} p.bedrock      the worker's Bedrock client
 * @param {string} p.gameId
 * @param {string} p.round        '003'
 * @param {string} p.orgId        the session's org ('' for an orgless session)
 * @param {object} p.aiData       the material the read was built from (get-ai-summary.js)
 * @param {object} p.metadata     the session row, decrypted
 * @param {{markdownResponse: string, fallback: boolean, generatedAt: string}} p.read
 * @param {object} [p.context]    the Lambda context, for the time left
 * @param {(gameId: string, message: object) => Promise<void>} p.broadcast
 * @param {(cmd: object) => Promise<object>} [p.send]   the model call (tests)
 * @returns {Promise<{ran: boolean, reason?: string, kept?: number}>}
 */
async function runFollowUpSuggestions(p) {
  try {
    if (!store.followUpsEnabled()) return { ran: false, reason: 'off' };
    const gameType = (p.aiData && p.aiData.gameType) || (p.metadata && p.metadata.GameType);
    if (!isCallAndAnswer(gameType)) return { ran: false, reason: 'not-call-and-answer' };

    const read = p.read || {};
    if (read.fallback || !String(read.markdownResponse || '').trim()) {
      await store.deleteSuggestions(p.db, { gameId: p.gameId, round: p.round });
      return { ran: false, reason: 'fallback-read' };
    }

    const aiData = p.aiData || {};
    const ranked = rankAnswers(aiData.answers, aiData.results && aiData.results.voteTallies);
    if (!ranked.length) return { ran: false, reason: 'no-answers' };

    const left = p.context && typeof p.context.getRemainingTimeInMillis === 'function'
      ? p.context.getRemainingTimeInMillis() - RESERVE_MS
      : null;
    let result;
    if (left !== null && left < MIN_CALL_MS) {
      result = { asks: [], reason: 'no-time', model: null, promptVersion: null };
      console.warn(JSON.stringify({ event: 'followup-asks', gameId: p.gameId, round: p.round, reason: 'no-time' }));
    } else {
      const canonical = normalizeGameType(gameType) || gameType;
      result = await suggestFollowUps({
        eventTitle: aiData.eventTitle,
        task: resolveTask(aiData.question || {}, aiData.customInstruction, canonical),
        questionTitle: (aiData.question && (aiData.question.title || aiData.question.Title)) || '',
        ranked,
        voteCount: Array.isArray(aiData.votes) ? aiData.votes.length : 0,
        readBack: read.markdownResponse,
        rosterNames: await rosterNames(p.db, p.gameId, aiData.answers, p.metadata && p.metadata.HostName),
        bedrock: p.bedrock,
        send: p.send,
        deadlineMs: left === null ? undefined : left,
        logContext: { gameId: p.gameId, round: p.round },
      });
    }

    await store.writeSuggestions(p.db, {
      gameId: p.gameId, round: p.round, orgId: p.orgId, forSummaryAt: read.generatedAt || null, result,
    });
    await p.broadcast(p.gameId, { type: 'followUpChanged', gameId: p.gameId, questionNumber: p.round, status: 'suggested' });
    return { ran: true, reason: result.reason || null, kept: result.asks.length };
  } catch (e) {
    console.warn(JSON.stringify({ event: 'followup-asks-failed', gameId: p.gameId, round: p.round, error: (e && e.name) || 'Error' }));
    return { ran: false, reason: 'error' };
  }
}

module.exports = { RESERVE_MS, MIN_CALL_MS, rosterNames, runFollowUpSuggestions };
