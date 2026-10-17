/**
 * CALL & ANSWER FOLLOW-UP ASKS: WHAT ONE ASK IS (docs/design/followup-icons).
 *
 * After the round's read, the host may send ONE short question to the room's
 * phones, laptops and tablets. Pure: no AWS, no I/O. The rows live in
 * followup-store.js, the routes in followups.js.
 *
 * THE KINDS (owner, 2026-10-13, the "Ask the room" mockup), as Build Room
 * names its asks:
 *
 *   ideas   one open question; the room writes a short answer (280 characters).
 *           The wall shows only the answers the host picks, never a name.
 *   choice  a question and 2 to 4 options, one pick, no write-in ("Other" was
 *           ruled out: the options are the room's own). Shown as "Choose".
 *   rate    a statement from the room, rated 1 to 5. The two ends are the
 *           ask's own (owner, 16 Oct 2026: "host should be able to change what
 *           the high low says"): Disagree to Agree unless the host picks
 *           another pair or types both, stored on the ask as `Ends` and read
 *           back by every screen and the report, so a 4 means the same thing
 *           in the room and in the report. An ask stored before then has no
 *           `Ends` and reads as Disagree to Agree. It replaces the first
 *           build's agree / not sure / disagree.
 *
 * An `agree` row from the first build (dev only, 30-day ttl) is not a kind any
 * more: it cannot be sent or answered, and reads as nothing.
 *
 * AN ANSWER IS A SURVEY VALUE. toSurveyQuestion() maps an ask onto the
 * survey's own question shapes, so the phone draws it with the existing
 * TextInput / ChoiceInput / RatingInput and the server checks it with
 * survey-answer.js and counts it with survey-aggregate.js. Nothing here learns
 * a second way to validate or count an answer.
 */
const { checkAnswer } = require('./survey-answer');

/** What may be sent, and what the model may suggest: one vocabulary. */
const KINDS = Object.freeze(['ideas', 'choice', 'rate']);
const TOOL_KINDS = KINDS;

/** The rating scale, and its default ends. */
const RATE = Object.freeze({ scale: '1-5', lowLabel: 'Disagree', highLabel: 'Agree' });
const DEFAULT_ENDS = Object.freeze({ low: RATE.lowLabel, high: RATE.highLabel });
const ENDS_MAX = 24;

/**
 * The ends a host sent: `{value}` or `{error}`. Absent (undefined or null) is
 * the default pair; anything present must be two strings, each 1 to 24
 * characters once trimmed and folded.
 */
function normalizeEnds(raw) {
  if (raw === undefined || raw === null) return { value: { ...DEFAULT_ENDS } };
  const bad = { error: `Each end of the scale is 1 to ${ENDS_MAX} characters` };
  if (typeof raw !== 'object' || Array.isArray(raw)) return bad;
  const fold = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : null);
  const low = fold(raw.low);
  const high = fold(raw.high);
  if (!low || !high || low.length > ENDS_MAX || high.length > ENDS_MAX) return bad;
  return { value: { low, high } };
}

/** A stored or normalized ask's ends; an ask with none reads as the default. */
function endsOf(ask) {
  const a = ask || {};
  const e = a.Ends || a.ends;
  return e && typeof e.low === 'string' && typeof e.high === 'string' && e.low && e.high
    ? { low: e.low, high: e.high }
    : { ...DEFAULT_ENDS };
}

/** Where a sent ask came from: a suggestion as written, one the host edited, or the host's own. */
const ORIGINS = Object.freeze(['suggested', 'edited', 'host']);

/**
 * Hard caps on what the host may SEND. Looser than the suggestion rules (a
 * 20-word statement, a 110-character question, 8-word options), which are
 * marks for the host to see, not refusals: the host may edit past them.
 */
const LIMITS = Object.freeze({
  statement: 300,
  idea: 280,
  question: 200,
  option: 120,
  minOptions: 2,
  maxOptions: 4,
  fromAnswers: 50,
});

const clean = (v, max) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const isAnswerNumber = (n) => Number.isInteger(n) && n >= 1 && n <= 500;

/**
 * A new ask from the host. Returns `{value}` or `{error}`; the error is written
 * for the host, who corrects it in the editor.
 *
 * `value`: { kind, statement, question, options: [{text, answer|null}],
 *            fromAnswers: int[], suggestionIndex: int|null }
 */
function normalizeFollowUp(body) {
  const b = body || {};
  const kind = String(b.kind || '').trim().toLowerCase();
  if (!KINDS.includes(kind)) return { error: `The kind must be one of: ${KINDS.join(', ')}` };

  const value = {
    kind,
    statement: '',
    question: '',
    options: [],
    fromAnswers: [...new Set((Array.isArray(b.fromAnswers) ? b.fromAnswers : [])
      .map(Number).filter(isAnswerNumber))].slice(0, LIMITS.fromAnswers),
    suggestionIndex: Number.isInteger(b.suggestionIndex) && b.suggestionIndex >= 0 && b.suggestionIndex < 10
      ? b.suggestionIndex : null,
  };

  if (kind === 'rate') {
    const raw = String(b.statement === undefined || b.statement === null ? '' : b.statement).replace(/\s+/g, ' ').trim();
    if (!raw) return { error: 'Write the statement the room will rate' };
    if (raw.length > LIMITS.statement) return { error: `A statement is at most ${LIMITS.statement} characters` };
    value.statement = raw;
    const ends = normalizeEnds(b.ends);
    if (ends.error) return { error: ends.error };
    value.ends = ends.value;
    return { value };
  }

  const q = String(b.question === undefined || b.question === null ? '' : b.question).replace(/\s+/g, ' ').trim();
  if (!q) return { error: 'Write the question' };
  if (q.length > LIMITS.question) return { error: `A question is at most ${LIMITS.question} characters` };
  value.question = q;
  if (kind === 'ideas') return { value };

  // choice
  const list = Array.isArray(b.options) ? b.options : [];
  const options = [];
  const seen = new Set();
  for (const o of list) {
    const text = clean(o && typeof o === 'object' ? o.text : o, LIMITS.option + 1);
    if (!text) continue;
    if (text.length > LIMITS.option) return { error: `An option is at most ${LIMITS.option} characters` };
    const k = text.toLowerCase();
    if (seen.has(k)) return { error: 'Two options say the same thing' };
    seen.add(k);
    const answer = o && typeof o === 'object' && isAnswerNumber(Number(o.answer)) ? Number(o.answer) : null;
    options.push({ text, answer });
  }
  if (options.length < LIMITS.minOptions) return { error: `A pick-one question needs at least ${LIMITS.minOptions} options` };
  if (options.length > LIMITS.maxOptions) return { error: `A pick-one question takes at most ${LIMITS.maxOptions} options` };
  value.options = options;
  return { value };
}

/**
 * The survey question a phone draws and the server checks an answer against.
 * Works on a sent ask in either spelling (the stored row's `Kind`/`Options`,
 * or the normalized `kind`/`options`).
 */
function toSurveyQuestion(ask) {
  const a = ask || {};
  const kind = a.Kind || a.kind;
  if (kind === 'rate') {
    const ends = endsOf(a);
    return { kind: 'rating', scale: RATE.scale, lowLabel: ends.low, highLabel: ends.high, required: true };
  }
  if (kind === 'ideas') {
    return { kind: 'text', maxLength: LIMITS.idea, required: true };
  }
  if (kind === 'choice') {
    const options = (a.Options || a.options || []).map((o) => (o && typeof o === 'object' ? o.text : String(o)));
    return { kind: 'choice', options, allowMultiple: false, allowOther: false, maxPicks: 1 };
  }
  return null;
}

/**
 * Is `value` an answer to this ask? `{ok, value}` (the value to store) or
 * `{ok:false, error}`. A clear (null) is refused: a follow-up is one tap, and
 * an answer can be changed until results are shown, never withdrawn.
 */
function checkValue(ask, value) {
  const question = toSurveyQuestion(ask);
  if (!question) return { ok: false, error: 'This question cannot be answered' };
  if (value === null || value === undefined) return { ok: false, error: 'Pick an answer' };
  const checked = checkAnswer(question, value);
  // An empty idea is no answer: the survey's text check lets a blank through.
  if (checked.ok && (checked.value === null || checked.value === '')) return { ok: false, error: 'Write an answer' };
  return checked;
}

/**
 * The words of a stored or normalized ask, comparable with a suggestion's: the
 * statement, or the question and the option texts in order.
 */
function wordsOf(ask) {
  const a = ask || {};
  const kind = a.Kind || a.kind || a.type;
  const fold = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  if (kind === 'rate') return { kind, statement: fold(a.Statement || a.statement) };
  if (kind === 'ideas') return { kind, question: fold(a.Question || a.question) };
  return {
    kind,
    question: fold(a.Question || a.question),
    options: (a.Options || a.options || []).map((o) => fold(o && typeof o === 'object' ? o.text : o)),
  };
}

/**
 * Where a sent ask came from, decided on the server from the stored
 * suggestion — never trusted from the request. An option keeps its answer
 * number only while its words are the suggestion's own for that number;
 * anything else is the host's words (`ownWords`), which the editor and the
 * report label "Your words", never "Answer n".
 *
 * @returns {{origin: string, options: object[], fromAnswers: number[]}}
 */
function resolveOrigin(value, suggestion) {
  if (!suggestion) {
    return {
      origin: 'host',
      options: value.options.map((o) => ({ text: o.text, ownWords: true })),
      fromAnswers: [],
    };
  }
  const sent = wordsOf(value);
  const from = wordsOf(suggestion);
  const sameKind = sent.kind === (suggestion.type || suggestion.kind);
  const suggestedOptions = Array.isArray(suggestion.options) ? suggestion.options : [];
  const options = value.options.map((o) => {
    const match = suggestedOptions.find((s) => s && String(s.text || '').replace(/\s+/g, ' ').trim() === o.text
      && Number.isInteger(s.answer) && !(s.marks || []).includes('reworded'));
    return match ? { text: o.text, answer: match.answer } : { text: o.text, ownWords: true };
  });
  const identical = sameKind && JSON.stringify(sent) === JSON.stringify(from);
  return {
    origin: identical ? 'suggested' : 'edited',
    options,
    fromAnswers: Array.isArray(suggestion.answers) ? suggestion.answers.filter(isAnswerNumber) : value.fromAnswers,
  };
}

/**
 * WORKIE'S WORDS AT SEND TIME, and what the host changed (session flow v3
 * §4.1-4.2). The suggestion row is replaced whenever the read is redone, so
 * copying the words onto the ask is the only way the report can say "Workie
 * suggested: …". Null for a question the host wrote from blank.
 */
function suggestedOf(suggestion) {
  if (!suggestion) return null;
  const w = wordsOf(suggestion);
  return {
    kind: w.kind,
    ...(w.statement !== undefined ? { statement: w.statement } : {}),
    ...(w.question !== undefined ? { question: w.question } : {}),
    ...(w.options ? { options: w.options } : {}),
    why: String(suggestion.why || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    answers: Array.isArray(suggestion.answers) ? suggestion.answers.filter(isAnswerNumber) : [],
  };
}

/** Which parts the host changed: any of 'kind', 'question', 'options'. */
function editsOf(value, suggestion) {
  if (!suggestion) return [];
  const sent = wordsOf(value);
  const from = wordsOf(suggestion);
  const out = [];
  if (sent.kind !== from.kind) out.push('kind');
  const words = (w) => (w.kind === 'rate' ? w.statement : w.question);
  if (words(sent) !== words(from)) out.push('question');
  if (sent.kind === 'choice' && JSON.stringify(sent.options || []) !== JSON.stringify(from.options || [])) out.push('options');
  return out;
}

/** Where it was sent from, and how many could answer: what the host's client says, checked. */
function sendContextOf(body) {
  const b = body || {};
  const sentFrom = b.sentFrom === 'laptop' || b.sentFrom === 'remote' ? b.sentFrom : null;
  const n = Number(b.roomSize);
  const roomSize = Number.isInteger(n) && n >= 0 && n <= 5000 ? n : null;
  return { sentFrom, roomSize };
}

/**
 * A frozen tally in the report's shape, from the aggregate's result for the
 * ask's survey question (poll-round.js pollTally). Counts only, never a
 * percentage (the reads' rule), never a name.
 *
 *   rate    { n, counts: [1s, 2s, 3s, 4s, 5s], mean }
 *   choice  { n, counts: [per option, in the ask's order] }
 *   ideas   { n }  — the texts are rows of their own, shown only when picked
 */
function tallyOf(ask, aggregateResult) {
  const kind = (ask && (ask.Kind || ask.kind)) || '';
  const r = aggregateResult || {};
  const n = Number.isInteger(r.n) ? r.n : 0;
  if (kind === 'rate') {
    const counts = Array.from({ length: 5 }, (_, i) => (Array.isArray(r.counts) ? r.counts[i] || 0 : 0));
    return { n, counts, mean: n && typeof r.mean === 'number' ? r.mean : null };
  }
  if (kind === 'ideas') return { n };
  const size = ((ask && (ask.Options || ask.options)) || []).length;
  const counts = Array.from({ length: size }, (_, i) => (Array.isArray(r.counts) ? r.counts[i] || 0 : 0));
  return { n, counts };
}

module.exports = {
  KINDS,
  TOOL_KINDS,
  RATE,
  DEFAULT_ENDS,
  ENDS_MAX,
  normalizeEnds,
  endsOf,
  ORIGINS,
  LIMITS,
  normalizeFollowUp,
  toSurveyQuestion,
  checkValue,
  wordsOf,
  resolveOrigin,
  tallyOf,
  suggestedOf,
  editsOf,
  sendContextOf,
};
