/**
 * A CLOSED SURVEY, AS THE WORKIE READS IT.
 *
 * The owner, 27 Sep 2026: "For polls and Surveys: having the Workie just
 * comment on the results vs what is given about the event — can be brief but
 * thoughtful and provide insights and actions."
 *
 * `describeSurveyResults(payload)` turns survey-host.js's
 * `surveyResultsPayload` — the frozen results and nothing a person is known
 * by — into the one block of text the survey prompt reads as
 * `{surveyResults}` (get-ai-summary.js). Each question in the survey's own
 * order: its title, its kind, how many answered it, and the figures COPIED
 * from the aggregate, then a sample of what people wrote.
 *
 * ── THIS FILE COUNTS NOTHING ────────────────────────────────────────────────
 *
 * Every share, mean and place was worked out once, at close, by
 * survey-aggregate.js, and tests/survey-aggregate.js holds every other file to
 * that. This one prints what is already on SURVEY#RESULTS — which is why it is
 * on that test's READERS list, with the reason. Counts and the aggregate's own
 * figures only, never a percentage of its own: the survey prompt forbids a
 * figure the material does not print, so none is printed that the model might
 * round differently.
 *
 * Choice, rating, yes/no and open answers are described by poll-round.js's
 * `describePollTally`: a poll question and a survey question are the same
 * kinds, counted by the same aggregate, and the Workie must not read one
 * differently from the other. A ranking has no poll form, so it is described
 * here.
 *
 * ── NO NAMES, BY CONSTRUCTION ───────────────────────────────────────────────
 *
 * The payload never opens a SURVEY#RESP# or SURVEY#DONE# row (survey-host.js
 * header), and this reads only its `questions`, `n` and `finished`.
 *
 * ── THE WORDS ARE SAMPLED ───────────────────────────────────────────────────
 *
 * A survey of eight questions and a few hundred people can carry thousands of
 * open answers, and the read-back is meant to be brief. Each question quotes
 * at most TEXT_SAMPLE of them, each cut at TEXT_CHARS, and says how many it
 * left out. The sample is the first of the aggregate's own order — a content
 * hash, never arrival order — so it favours nobody and is the same on a Redo.
 */
const { describePollTally } = require('./poll-round');

/** Written answers quoted per question, at most. */
const TEXT_SAMPLE = 12;
/** Each quoted answer is cut here, on a word where one is near. */
const TEXT_CHARS = 280;
/** A question's own detail line is cut here. */
const DETAIL_CHARS = 200;

const KIND_WORDS = {
  rating: 'a rating',
  choice: 'multiple choice',
  yesno: 'yes or no',
  rank: 'a ranking',
  text: 'an open answer',
};

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const quote = (t) => `"${t}"`;

/** A ranking's result in words: the aggregate's average places and firsts, as printed. */
function describeRanking(question, result) {
  const n = Number(result && result.n) || 0;
  if (!n) return 'Nobody answered.';
  const options = Array.isArray(question.options) ? question.options : [];
  const places = Array.isArray(result.avgPlace) ? result.avgPlace : [];
  const firsts = Array.isArray(result.firsts) ? result.firsts : [];
  // Listed in the order the aggregate's own averages put them — ordering the
  // printed figures, not working out new ones. An item with no average (it
  // cannot happen once n > 0, but a hand-made row is not trusted) goes last.
  const order = options.map((_, i) => i).sort((a, b) => {
    const pa = typeof places[a] === 'number' ? places[a] : Infinity;
    const pb = typeof places[b] === 'number' ? places[b] : Infinity;
    return pa === pb ? a - b : pa - pb;
  });
  const top = Number.isInteger(question.rankTop) && question.rankTop < options.length
    ? `their top ${question.rankTop} of ${options.length}`
    : `all ${options.length}`;
  const averages = order
    .map((i) => `${options[i]}: ${typeof places[i] === 'number' ? places[i] : 'not available'}`)
    .join('; ');
  const firstLine = order.map((i) => `${options[i]}: ${firsts[i] || 0}`).join('; ');
  return `${n} ranked ${top}. Average place, where 1 is the top (an item someone left out shares `
    + `the places they did not fill): ${averages}. How many put each first: ${firstLine}.`;
}

/** A 0–10 rating's three bands and net score, as the aggregate stored them. */
function describeNetScore(result) {
  if (!result || result.scale !== '0-10' || !Number(result.n)) return '';
  const { detractors, passives, promoters, score } = result;
  if (![detractors, passives, promoters].every(Number.isInteger)) return '';
  const net = typeof score === 'number'
    ? ` Net score, the share scoring 9 or 10 less the share scoring 0 to 6: ${score > 0 ? '+' : ''}${score}.`
    : '';
  return ` Scored 0 to 6: ${detractors}; 7 or 8: ${passives}; 9 or 10: ${promoters}.${net}`;
}

/** One question: title, kind, the result in words, and what was left unquoted. */
function describeQuestion(q, index) {
  const result = q.result || { n: 0 };
  const texts = Array.isArray(q.texts) ? q.texts : [];
  const sample = texts.slice(0, TEXT_SAMPLE).map((t) => ({ ...t, text: clip(t.text, TEXT_CHARS) }));
  const kind = String(q.kind || result.kind || '').toLowerCase();

  let body;
  if (kind === 'rank') {
    body = describeRanking(q, result);
  } else if (kind === 'text') {
    const n = Number(result.n) || 0;
    body = n
      ? `${n} answered. ${sample.length < texts.length ? `${sample.length} of their ${texts.length} answers` : 'Their answers'}: `
        + `${sample.map((t) => quote(t.text)).join('; ')}.`
      : 'Nobody answered.';
  } else {
    body = describePollTally(q, { ...result, texts: sample });
    if (kind === 'rating') body += describeNetScore(result);
    if (sample.length < texts.length) {
      body += ` (${sample.length} of the ${texts.length} written answers are quoted here.)`;
    }
  }

  const detail = clip(q.detail, DETAIL_CHARS);
  return [
    `${index + 1}. ${clip(q.title, DETAIL_CHARS) || 'Untitled question'} (${KIND_WORDS[kind] || 'a question'})`,
    detail ? `Detail: ${detail}` : null,
    body,
  ].filter(Boolean).join('\n');
}

/**
 * The frozen results, in words. Returns
 *   { text, respondents, finished, questionCount }
 * where `respondents` is the aggregate's N (people who answered at least one
 * question) — the number a fallback summary states as "responses".
 */
function describeSurveyResults(payload) {
  const p = payload || {};
  const questions = Array.isArray(p.questions) ? p.questions : [];
  const respondents = Number(p.n) || 0;
  const finished = Number(p.finished) || 0;

  const head = respondents
    ? `${respondents} ${respondents === 1 ? 'person' : 'people'} answered at least one question, `
      + `and ${finished} finished the survey. It had ${questions.length} question${questions.length === 1 ? '' : 's'}.`
    : `Nobody answered the survey. It had ${questions.length} question${questions.length === 1 ? '' : 's'}.`;

  return {
    text: [head, ...questions.map(describeQuestion)].join('\n\n'),
    respondents,
    finished,
    questionCount: questions.length,
  };
}

// `describeSurveyQuestion` is comments.js's too: a closed survey's feedback
// round shows the room each question in the words the Workie was given.
module.exports = {
  describeSurveyResults, describeSurveyQuestion: describeQuestion, TEXT_SAMPLE, TEXT_CHARS,
};
