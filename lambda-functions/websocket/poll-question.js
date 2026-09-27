/**
 * A POLL ROUND'S QUESTION, as the phone and the stage play it (typed polls,
 * 27 Sep 2026: "a short instant feedback version of the survey items").
 *
 * The survey's kind and the fields that kind uses, from the DECRYPTED question
 * row — `pollFieldsOf` reads a row written before polls had kinds as the choice
 * its options meant, or as an open question. Both question readers send it
 * (get-question.js, get-game-state.js), the answer check reads the same shape
 * (websocket/message.js), and the tally counts against it (get-answers.js,
 * get-results.js), so a phone draws exactly what will be accepted and counted.
 *
 * Byte-identical in game/ and websocket/ (tests/poll-question.js holds them
 * equal), like survey-kinds.js: each bundle packages only its own CodeUri.
 */
const { pollFieldsOf, itemFields } = require('./survey-kinds');

const POLL = 'poll';

/** Is this round a poll's? The set says so; a set too old to say, by its row. */
function isPollRound(setMeta, row) {
  const type = setMeta && (setMeta.engagementType || setMeta.EngagementType);
  if (type) return type === POLL;
  return Boolean(row && (row.kind || Array.isArray(row.options)));
}

/** `{ kind, required, …the kind's fields }` — nothing a phone does not draw. */
function pollQuestionOf(row) {
  return itemFields(pollFieldsOf(row));
}

const SCALE_TOP = { '1-5': 5, '1-10': 10, '0-10': 10, stars: 5 };

/**
 * A poll answer as a sentence, for everything that shows a round's answers as
 * text — the report, the host's list, the Workie's input — so none of them
 * has to learn the kinds. The structured value is stored beside it
 * (`PollValue`) and is what the tally counts.
 */
function pollAnswerText(question, value) {
  const q = question || {};
  if (value === null || value === undefined) return '';
  switch (q.kind) {
    case 'choice': {
      const list = Array.isArray(value) ? value : [];
      return list.map((v) => (v && typeof v === 'object' ? `Other: ${v.other || ''}` : (q.options || [])[v]))
        .filter((t) => String(t ?? '').trim()).join(', ');
    }
    case 'rating':
      return SCALE_TOP[q.scale] ? `${value} / ${SCALE_TOP[q.scale]}` : String(value);
    case 'yesno': {
      const v = value && value.v;
      const label = v === 'yes' ? (q.yesLabel || 'Yes') : v === 'no' ? (q.noLabel || 'No') : 'Not sure';
      return value && value.why ? `${label} — ${value.why}` : label;
    }
    default:
      return String(value);
  }
}

module.exports = { POLL, isPollRound, pollQuestionOf, pollAnswerText };
