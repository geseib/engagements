/**
 * THE GROUNDING CHECK: is a suggested follow-up ask the room's, or the model's?
 *
 * docs/design/ca-followup-asks/SPEC.md §4.2. Pure: no AWS, no I/O. The server
 * never trusts the model's tool input; every suggestion passes through here
 * before it is stored, and only what survives reaches the host.
 *
 *   type unknown, or not sendable in this build      dropped ('type')
 *   cited answers missing or out of range             dropped ('answers')
 *   the fields its type needs are missing             dropped ('fields')
 *   rate statement not words copied, in order, from
 *     ONE cited answer, or over 20 words              dropped ('not-copied' / 'too-long')
 *   any roster name, first or last, in what the room
 *     would see (statement, question, options)       dropped ('names')
 *   a choice option not copied from its own answer,
 *     over 8 words, or two from one answer            kept, marked 'reworded'
 *   a question over 110 characters                    kept, marked 'long'
 *   an anchor that is not a point of the stored read  kept, anchor null, marked 'unanchored'
 *                                                     (shown after the read, never lost)
 *
 * Owner, 2026-10-11: "drop agree statements not in the room's words and
 * anything naming a person, keep reworded options marked 'Reworded'".
 *
 * "COPIED" ignores case, punctuation and whitespace, and nothing else: the
 * statement's words must appear as one unbroken run in the answer
 * (prototype/check.py, the rule PROTOTYPE.md measured).
 *
 * The `why` is host-only and is not checked for names: the prompt asks for
 * none, and a slip there never reaches the room.
 */
const { KINDS } = require('./followup-kinds');
const { pointAt } = require('./read-sections');

const RULES = Object.freeze({
  statementWords: 20,
  optionWords: 8,
  questionChars: 110,
  minOptions: 2,
  maxOptions: 4,
  maxAsks: 3,
});

/** Words, lower-cased, punctuation gone. Curly apostrophes fold to straight first. */
function words(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Are `needle`'s words one unbroken run inside `hay`'s? */
function copiedFrom(hay, needle) {
  const h = words(hay);
  const n = words(needle);
  if (!n.length || n.length > h.length) return false;
  for (let i = 0; i + n.length <= h.length; i++) {
    let ok = true;
    for (let j = 0; j < n.length; j++) {
      if (h[i + j] !== n[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * The name parts to look for: every word of every roster name, two letters or
 * more (an initial is not a name anyone can be found by).
 */
function nameParts(rosterNames) {
  const parts = new Set();
  for (const name of Array.isArray(rosterNames) ? rosterNames : []) {
    for (const w of words(name)) if (w.length >= 2) parts.add(w);
  }
  return parts;
}

const fold = (s) => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();
const inRange = (n, count) => Number.isInteger(n) && n >= 1 && n <= count;

/**
 * Check the model's asks against the round.
 *
 * @param {object[]} asks         the tool input's `asks`
 * @param {string[]} answers      the numbered answers' texts; answers[0] is answer 1
 * @param {string[]} rosterNames  every name known in the session
 * @param {object}   [opts]
 * @param {string[]} [opts.kinds] the kinds that may be kept (default: the sendable kinds)
 * @param {string}   [opts.read]  the stored read's markdown, to check each anchor against
 * @returns {{ kept: object[], dropped: number, reasons: object, raw: number }}
 *   each kept ask: { type, statement?, question?, options?, answers, why, anchor, marks }
 *   `reasons` counts drops by reason word — never the text.
 */
function checkSuggestions(asks, answers, rosterNames, { kinds = KINDS, read = '' } = {}) {
  const list = Array.isArray(asks) ? asks : [];
  const texts = Array.isArray(answers) ? answers.map((a) => String(a || '')) : [];
  const parts = nameParts(rosterNames);
  const kept = [];
  const reasons = {};
  const drop = (why) => { reasons[why] = (reasons[why] || 0) + 1; };

  const namesSomeone = (fields) => {
    if (!parts.size) return false;
    for (const f of fields) for (const w of words(f)) if (parts.has(w)) return true;
    return false;
  };

  for (const raw of list) {
    if (kept.length >= RULES.maxAsks) { drop('over-three'); continue; }
    const a = raw && typeof raw === 'object' ? raw : {};
    const type = String(a.type || '').trim().toLowerCase();
    if (!kinds.includes(type)) { drop('type'); continue; }

    const cited = [...new Set((Array.isArray(a.answers) ? a.answers : []).map(Number))];
    if (!cited.length || cited.some((n) => !inRange(n, texts.length))) { drop('answers'); continue; }

    const why = fold(a.why).slice(0, 400);
    const marks = [];
    const out = { type, answers: cited, why };

    if (type === 'rate') {
      const statement = fold(a.statement);
      if (!statement) { drop('fields'); continue; }
      // A name is the first reason given: it is the one that must never be missed.
      if (namesSomeone([statement])) { drop('names'); continue; }
      if (words(statement).length > RULES.statementWords) { drop('too-long'); continue; }
      if (!cited.some((n) => copiedFrom(texts[n - 1], statement))) { drop('not-copied'); continue; }
      out.statement = statement;
    } else {
      const question = fold(a.question);
      if (!question) { drop('fields'); continue; }
      if (question.length > RULES.questionChars) marks.push('long');
      out.question = question;

      if (type === 'choice') {
        const opts = Array.isArray(a.options) ? a.options : [];
        if (opts.length < RULES.minOptions || opts.length > RULES.maxOptions) { drop('fields'); continue; }
        const options = [];
        let bad = false;
        const used = new Set();
        for (const o of opts) {
          const text = fold(o && o.text);
          const n = Number(o && o.answer);
          if (!text || !inRange(n, texts.length)) { bad = true; break; }
          const optionMarks = [];
          if (words(text).length > RULES.optionWords || !copiedFrom(texts[n - 1], text) || used.has(n)) {
            optionMarks.push('reworded');
          }
          used.add(n);
          options.push({ text, answer: n, marks: optionMarks });
        }
        if (bad) { drop('fields'); continue; }
        if (new Set(options.map((o) => o.text.toLowerCase())).size !== options.length) { drop('fields'); continue; }
        if (namesSomeone([question, ...options.map((o) => o.text)])) { drop('names'); continue; }
        if (options.some((o) => o.marks.length)) marks.push('reworded');
        out.options = options;
      } else if (namesSomeone([question])) {
        drop('names'); continue;
      }
    }

    // THE ANCHOR (option A): the section and point of the read this came
    // from, exactly as the read printed them. A miss is kept, after the read.
    const at = pointAt(read, a.anchor);
    out.anchor = at ? { section: at.section, point: at.point } : null;
    if (!at) marks.push('unanchored');

    out.marks = marks;
    kept.push(out);
  }

  const dropped = Object.values(reasons).reduce((s, n) => s + n, 0);
  return { kept, dropped, reasons, raw: list.length };
}

module.exports = { RULES, words, copiedFrom, nameParts, checkSuggestions };
