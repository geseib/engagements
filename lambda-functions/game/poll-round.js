/**
 * A POLL ROUND, READ AND COUNTED (typed polls, 27 Sep 2026).
 *
 * `readPollQuestion` finds the question a round was served from — the REF row
 * the host pinned, the set version it names, decrypted from the SET's org, as
 * every other round reader does — and hands back its kind and fields
 * (poll-question.js). `pollTally` counts the round's answer rows with the
 * survey's own aggregate (survey-aggregate.js), treating the round as a
 * one-question survey: the same rule for a share, a mean or a write-in, so a
 * poll and a survey can never disagree about what a result is.
 *
 * Game bundle only: the host's answers (get-answers.js, live while the round
 * is open) and the round's results (get-results.js) read it.
 */
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { refSetRef, resolveSetPartition } = require('./set-version');
const { ORG } = require('./tenant');
const { decryptItem } = require('./tenant-crypto');
const { aggregate } = require('./survey-aggregate');
const { isPollRound, pollQuestionOf } = require('./poll-question');

/** The one question id a poll round's tally is keyed by. */
const QID = 'q';

/** `{ question, title, detail }` for this round, or null when it is not a poll's. */
async function readPollQuestion(db, tableName, gameId, questionNumber) {
  const ref = await db.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${questionNumber}#REF` },
  }));
  if (!ref.Item) return null;
  const resolved = await resolveSetPartition(db, tableName, refSetRef(ref.Item, ref.Item.SetId), ref.Item.SetVersion);
  const row = await db.send(new GetCommand({
    TableName: tableName,
    Key: { PK: resolved.pk, SK: ref.Item.SourceQuestionId },
  }));
  if (!row.Item) return null;
  const setOrgId = resolved.scope === ORG ? String(resolved.orgId || '') : '';
  const item = setOrgId ? await decryptItem(setOrgId, 'question', row.Item) : row.Item;
  if (!isPollRound(resolved.metadata, item)) return null;
  return { question: pollQuestionOf(item), title: item.Title || '', detail: item.Detail || '' };
}

/**
 * The round's result: the aggregate's own shape for the kind (counts per
 * option, the scale's histogram and mean, yes/no/unsure, or the open answers'
 * ids) plus `texts` — every open answer, write-in and why, in the aggregate's
 * content-hash order, never arrival order. Rows are DECRYPTED answer rows;
 * only `PollValue` is read, so no name reaches the result.
 */
function pollTally(question, answerRows) {
  const rows = (Array.isArray(answerRows) ? answerRows : [])
    .filter((r) => r && r.PollValue !== undefined && r.PollValue !== null)
    .map((r) => ({ Answers: { [QID]: r.PollValue } }));
  const { PerQuestion, Texts } = aggregate([{ qid: QID, ...question }], rows);
  return { ...PerQuestion[QID], texts: Texts[QID] || [] };
}

const SCALE_POINTS = { '1-5': [1, 5], '1-10': [1, 10], '0-10': [0, 10], stars: [1, 5] };
const quote = (t) => `"${String(t).replace(/\s+/g, ' ').trim()}"`;

/**
 * A poll's result as the Workie reads it (get-ai-summary.js): counts copied
 * from the tally, in the question's own words — option labels, the scale's
 * end labels, the binary's own labels — and the open answers quoted. Counts
 * only, never a share: the summary prompts forbid a figure the material does
 * not print, so none is printed that the model might round differently.
 */
function describePollTally(question, tally) {
  const q = question || {};
  const t = tally || {};
  const n = t.n || 0;
  if (!n) return 'Nobody answered.';
  const texts = Array.isArray(t.texts) ? t.texts : [];
  const textOf = (ids) => texts.filter((x) => (ids || []).includes(x.id)).map((x) => quote(x.text));
  switch (q.kind) {
    case 'choice': {
      const lines = (q.options || []).map((o, i) => `${o}: ${(t.counts || [])[i] || 0} of ${n}`);
      const others = textOf(t.otherIds);
      if (others.length) lines.push(`Written in instead: ${others.join(', ')}`);
      return `${n} answered${q.allowMultiple ? ' (several picks allowed)' : ''}. ${lines.join('; ')}.`;
    }
    case 'rating': {
      const [lo] = SCALE_POINTS[q.scale] || SCALE_POINTS['1-5'];
      const spread = (t.counts || []).map((c, i) => `${lo + i}: ${c}`).join(', ');
      const ends = [q.lowLabel && `${lo} means ${quote(q.lowLabel)}`, q.highLabel && `the top means ${quote(q.highLabel)}`].filter(Boolean);
      return `${n} answered on a ${q.scale} scale${ends.length ? ` (${ends.join('; ')})` : ''}. `
        + `Average ${t.mean === null || t.mean === undefined ? 'not available' : t.mean}. How many chose each point: ${spread}.`;
    }
    case 'yesno': {
      const c = t.counts || {};
      const yes = q.yesLabel || 'Yes';
      const no = q.noLabel || 'No';
      const whys = [...textOf((t.whys || {}).yes).map((w) => `${yes}: ${w}`), ...textOf((t.whys || {}).no).map((w) => `${no}: ${w}`)];
      return `${n} answered. ${yes}: ${c.yes || 0}; ${no}: ${c.no || 0}${q.unsure ? `; not sure: ${c.unsure || 0}` : ''}.`
        + (whys.length ? ` Reasons given: ${whys.join('; ')}.` : '');
    }
    case 'text':
      return `${n} answered. Their answers: ${texts.slice(0, 60).map((x) => quote(x.text)).join('; ')}.`;
    default:
      return `${n} answered.`;
  }
}

module.exports = { readPollQuestion, pollTally, describePollTally };
