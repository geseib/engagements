/**
 * A QUESTION OF A KIND, AS THE GENERATORS ASK FOR IT AND TAKE IT BACK.
 *
 * shared/survey-kinds.js is the contract: the kinds, their fields, how a row
 * is normalised and what makes one invalid. This file is the generators' half
 * of it — the tool-schema properties a model is handed for each kind's fields,
 * and the repairs applied to what comes back before the contract's validator
 * rules on it. It exists because three generators write typed questions now:
 * the survey builder (ai-generate-survey.js), the poll builder
 * (ai-generate-polls.js) and the one-question drafter's poll branch
 * (ai-generate-questions.js). Three copies of a schema drift, and the one that
 * drifts is the one whose items the importer then skips.
 *
 * ── WHY A POLL HAS ITS OWN WORDING, BUT NOT ITS OWN FIELDS ────────────────
 *
 * A poll question IS a survey question the host asks (the owner, 27 Sep 2026:
 * "a short instant feedback version of the survey items"), so it is typed,
 * normalised and validated by the same contract — `pollFieldsOf` and
 * `validatePoll`. What differs is pacing: a poll is put on the main screen and
 * answered in seconds while the results fill in. So the model is told a
 * poll's options must fit at a glance, and it is not offered the fields that
 * slow a glance down (a "why?" follow-up, an answer limit, an optional mark).
 * Those stay the host's to add in the editor; the generator just does not
 * volunteer them.
 */

const {
  POLL_KINDS, SCALES, FOLLOW_UPS, TEXT_LENGTHS, normalizeKind, pollFieldsOf, validatePoll, itemFields,
} = require('./survey-kinds');

/**
 * Every kind field's schema property, in the contract's column order and in
 * the words the survey generator has always given the model. The object's
 * key order is the order the properties reach the schema.
 */
const KIND_FIELD_SCHEMA = Object.freeze({
  options: { type: 'array', items: { type: 'string' }, description: 'choice: 2-8 options. rank: 3-7 items to put in order. Empty for every other kind.' },
  allowMultiple: { type: 'boolean', description: 'choice only: may the respondent pick several?' },
  maxPicks: { type: 'integer', description: 'choice with allowMultiple only: the most they may pick (2 up to the number of options). Omit for no limit.' },
  allowOther: { type: 'boolean', description: 'choice only: offer a write-in "Something else" box.' },
  shuffle: { type: 'boolean', description: 'choice only: show the options in a random order (not for ordered scales).' },
  scale: { type: 'string', enum: [...SCALES], description: 'rating only: 1-5, 1-10, 0-10 (only for a would-you-recommend question) or stars.' },
  lowLabel: { type: 'string', description: 'rating only: the words under the low end.' },
  highLabel: { type: 'string', description: 'rating only: the words under the high end.' },
  yesLabel: { type: 'string', description: 'yesno only: replace "Yes" — leave empty to keep it.' },
  noLabel: { type: 'string', description: 'yesno only: replace "No" — leave empty to keep it.' },
  unsure: { type: 'boolean', description: 'yesno only: offer "Not sure".' },
  followUpWhen: { type: 'string', enum: ['', 'yes', 'no', 'any'], description: 'yesno only: ask a "why?" after this answer; empty for none.' },
  followUpPrompt: { type: 'string', description: 'yesno with followUpWhen only: the follow-up question.' },
  rankTop: { type: 'integer', description: 'rank only: rank just the top N (fewer than the number of items). Omit to rank them all.' },
  textLength: { type: 'string', enum: [...TEXT_LENGTHS], description: 'text only: one line (short) or a paragraph (long).' },
  maxLength: { type: 'integer', description: 'text only: the answer limit in characters, 20-2000. Omit for the default (280 short, 500 long).' },
  placeholder: { type: 'string', description: 'text only: a short hint shown in the empty answer box.' },
  themes: { type: 'boolean', description: 'text only: let Workie group the answers into themes when the survey closes. Usually true.' },
});

/** The fields each kind uses — survey-kinds.js relevantFields(), without its two on-the-row switches. */
const FIELDS_OF_KIND = Object.freeze({
  choice: ['options', 'allowMultiple', 'maxPicks', 'allowOther', 'shuffle'],
  rank: ['options', 'rankTop'],
  rating: ['scale', 'lowLabel', 'highLabel'],
  yesno: ['yesLabel', 'noLabel', 'unsure', 'followUpWhen', 'followUpPrompt'],
  text: ['textLength', 'maxLength', 'placeholder', 'themes'],
});

/**
 * The schema properties for the fields `kinds` use, in contract order.
 * `omit` leaves fields out altogether; `describe` rewords one for a product
 * whose model needs telling something different (a poll's options fit at a
 * glance; a survey's need not).
 */
function kindFieldProperties(kinds, { omit = [], describe = {} } = {}) {
  const wanted = new Set((kinds || []).flatMap((kind) => FIELDS_OF_KIND[kind] || []));
  const properties = {};
  for (const field of Object.keys(KIND_FIELD_SCHEMA)) {
    if (!wanted.has(field) || omit.includes(field)) continue;
    properties[field] = describe[field]
      ? { ...KIND_FIELD_SCHEMA[field], description: describe[field] }
      : KIND_FIELD_SCHEMA[field];
  }
  return properties;
}

const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * REPAIR WHAT HAS A SENSIBLE VALUE, in place, on a normalised field object
 * (surveyFieldsFromItem / pollFieldsOf output). An unknown scale becomes 1–5, a
 * list too long for its kind is cut, an impossible pick or rank limit is
 * dropped, a follow-up with no question is switched off, and an open answer
 * with no usable length gets the product's default. What cannot be repaired —
 * a choice with one option — is left for the validator to refuse.
 */
function repairKindFields(f, { maxOptions = 8, textLength = 'long' } = {}) {
  if (f.kind === 'rating' && !SCALES.includes(f.scale)) f.scale = '1-5';
  if (f.kind === 'choice') {
    f.options = f.options.slice(0, maxOptions);
    if (!f.allowMultiple || !inRange(f.maxPicks, 2, f.options.length)) f.maxPicks = null;
  }
  if (f.kind === 'rank') {
    f.options = f.options.slice(0, 7);
    if (!inRange(f.rankTop, 1, f.options.length - 1)) f.rankTop = null;
  }
  if (f.kind === 'yesno') {
    if (!FOLLOW_UPS.includes(f.followUpWhen) || !f.followUpPrompt) {
      f.followUpWhen = '';
      f.followUpPrompt = '';
    }
  }
  if (f.kind === 'text') {
    if (!TEXT_LENGTHS.includes(f.textLength)) f.textLength = textLength;
    if (!inRange(f.maxLength, 20, 2000)) f.maxLength = f.textLength === 'short' ? 280 : 500;
  }
  return f;
}

// ── Polls ─────────────────────────────────────────────────────────────────

/**
 * A poll's options have to fit on a projected screen and be read at a glance,
 * so the generator asks for at most five. The contract allows eight; a host
 * who wants more adds them in the editor.
 */
const POLL_MAX_OPTIONS = 5;

/**
 * NOT OFFERED TO THE MODEL FOR A POLL, and why: a "why?" follow-up turns a
 * glance into a form; an answer limit and themes have defaults that already
 * suit a short answer; and `required` means nothing when the host asks one
 * question at a time. All of them are still valid on a poll row.
 */
const POLL_OMITTED_FIELDS = Object.freeze(['followUpWhen', 'followUpPrompt', 'maxLength', 'themes']);

/** What each poll kind asks the model for, in the poll's own terms. */
const POLL_FIELD_WORDING = Object.freeze({
  options: `choice only: 2-${POLL_MAX_OPTIONS} short options, a few words each (40 characters maximum), distinct and covering the realistic range of views. Empty for every other kind.`,
  allowMultiple: 'choice only: may people pick several? Only when "pick all that apply" is genuinely the question.',
  allowOther: 'choice only: add a write-in "Something else" box. Rarely needed in a poll.',
  shuffle: 'choice only: show the options in a random order for each person. Never for options that run in an order (never → always).',
  scale: 'rating only: 1-5 unless another reads better — 1-10, stars, or 0-10 only for a would-you-recommend question.',
  lowLabel: 'rating only: a few words for what the low end means for THIS question, e.g. "Not at all ready". Never just "Low".',
  highLabel: 'rating only: a few words for what the high end means for THIS question, e.g. "Ready today". Never just "High".',
  yesLabel: 'yesno only: the first button\'s word when "Yes" does not fit the question — Approve, True, Agree, Ready. Empty keeps "Yes". Set both labels or neither.',
  noLabel: 'yesno only: its opposite on the second button — Decline, False, Disagree, Not ready. Empty keeps "No". Set both labels or neither.',
  unsure: 'yesno only: offer "Not sure" where honest uncertainty is a real answer.',
  textLength: 'text only: short (one line — the right size for a poll) or long (a paragraph, rarely right for a poll).',
  placeholder: 'text only: a hint of a few words shown in the empty answer box.',
});

/** The `kind` property and every kind field a poll of `kinds` may carry. */
function pollItemProperties(kinds) {
  return {
    kind: { type: 'string', enum: [...kinds], description: 'The kind of poll question. Use only the kinds listed.' },
    ...kindFieldProperties(kinds, { omit: POLL_OMITTED_FIELDS, describe: POLL_FIELD_WORDING }),
  };
}

/**
 * Each poll kind, in the words the prompt gives the model. Only the kinds the
 * host chose are shown. The open answer's line says outright that it is not a
 * fallback for options the model did not write: the owner's report was a
 * medium poll item that came back as a text box with no options at all.
 */
const POLL_KIND_GUIDE = Object.freeze({
  choice: 'choice — pick from a few choices: 2-5 short options that fit on the screen at a glance, mutually exclusive and covering the realistic range of views. allowMultiple only where "pick all that apply" is genuinely the question.',
  rating: 'rating — rate it on a scale: 1-5 unless another reads better (1-10, stars; 0-10 only for would-you-recommend). Label both ends with words that mean something for this question (lowLabel, highLabel) — "Not at all confident" to "Completely confident", never "Low" to "High".',
  yesno: 'yesno — a binary call. Yes / No by default; when another pair fits the question better, set yesLabel and noLabel to it: Approve / Decline, True / False, Agree / Disagree, Ready / Not ready. unsure adds "Not sure" where that is an honest answer.',
  text: 'text — an open answer in a few words. Use it sparingly, only where the room\'s own words are the point — never as a stand-in for options you did not write. Keep it short (textLength short) and give a placeholder hint.',
});

/** The KINDS block of a poll prompt, for the chosen kinds. */
function pollKindGuide(kinds) {
  const list = POLL_KINDS.filter((kind) => (kinds || []).includes(kind));
  const heading = list.length > 1
    ? 'KINDS OF POLL QUESTION — use ONLY these, and mix them sensibly: choose the kind that fits each question rather than asking the same kind over and over:'
    : 'KIND OF POLL QUESTION — every question is this kind:';
  return `${heading}\n${list.map((kind) => `- ${POLL_KIND_GUIDE[kind]}`).join('\n')}`;
}

/**
 * One raw tool item's POLL fields — `kind`, `required` and what the kind uses —
 * or null when it cannot be a poll of the chosen kinds.
 *
 * The kind is the model's. An item with NO kind is read the way pollFieldsOf
 * reads a stored row from before kinds, but only in the direction that is safe:
 * two or more options make it the choice it plainly is. With fewer it is
 * DROPPED, not read as an open answer — a question that arrived with neither a
 * kind nor options is exactly the defect the owner reported, and turning it
 * into a text box would ship it.
 *
 * `allowMultiple` is the request's legacy flag: `false` (an older builder's
 * "single-select only") forces single-select; `true` or absent leaves it to
 * the model.
 */
function typedPollFields(raw, { kinds = POLL_KINDS, allowMultiple = null } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const normal = normalizeKind(src.kind ?? src.type);
  const options = Array.isArray(src.options) ? src.options.filter((o) => String(o ?? '').trim()) : [];
  let kind = normal.kind || '';
  if (!kind) {
    if (options.length < 2) return null;
    kind = 'choice';
  }
  if (!kinds.includes(kind) || !POLL_KINDS.includes(kind)) return null;

  const f = pollFieldsOf({
    ...src,
    kind,
    scale: normal.scale || src.scale,
    // Short unless the model said otherwise: the contract's default for a
    // blank length is long, which suits a survey and not a glance.
    textLength: src.textLength ?? 'short',
    required: src.required === true,
  });
  repairKindFields(f, { maxOptions: POLL_MAX_OPTIONS, textLength: 'short' });

  if (f.kind === 'choice' && allowMultiple === false) {
    f.allowMultiple = false;
    f.maxPicks = null;
  }
  // A pair is a pair. "Approve / No" reads as a slip on the screen, so a
  // yes/no with only one of its labels set goes back to Yes / No.
  if (f.kind === 'yesno' && Boolean(f.yesLabel) !== Boolean(f.noLabel)) {
    f.yesLabel = '';
    f.noLabel = '';
  }

  if (validatePoll(f).length > 0) return null;
  return itemFields(f);
}

module.exports = {
  KIND_FIELD_SCHEMA,
  FIELDS_OF_KIND,
  kindFieldProperties,
  repairKindFields,
  POLL_MAX_OPTIONS,
  POLL_OMITTED_FIELDS,
  POLL_KIND_GUIDE,
  pollItemProperties,
  pollKindGuide,
  typedPollFields,
};
