/**
 * THE ONE PLACE A SURVEY IS COUNTED.
 *
 * `aggregate(questions, rows)` turns a survey's decrypted response rows into
 * the frozen results close writes to SURVEY#RESULTS:
 *
 *   { N, Finished, Order, PerQuestion: { [qid]: … }, Texts: { [qid]: [{ id, text, v? }] } }
 *
 * Pure: no AWS, no I/O, no clock, no randomness. The console, the wall's
 * walk-through, the report and a shared link all read what this returns, and
 * nothing else in the product may work out a share, a mean or a place —
 * tests/survey-aggregate.js fails the build if `avgPlace`, `topTwo` or
 * `placeHist` appear in any other file. The contract is
 * docs/design/survey-redesign/IMPLEMENTATION-phase-2.md §2 ("Answer values",
 * "Aggregate"); the numbers it is tested against are the mockups' own
 * (docs/design/survey-redesign/_src/content.py).
 *
 * ── WHAT COUNTS ───────────────────────────────────────────────────────────
 *
 * A question's `n` is the rows holding a VALID value for it, so a person who
 * stopped at question 5 counts for 1–4 and nothing else. `N` is the rows with
 * at least one valid answer; `Finished` the rows with `Complete === true`.
 * A value that does not fit its question — wrong type, out of range, an
 * unsure where none is offered, a why where none is asked, an unknown qid —
 * is ignored whole, never thrown on. The PUT route checks the same things on
 * write; this function only has to survive a row that slipped past.
 * Blank text (after trimming) is no answer: a blank open answer is not
 * counted, a blank why or write-in is dropped and the rest of the value kept.
 *
 * ── PER KIND ──────────────────────────────────────────────────────────────
 *
 *   rating  { kind, scale, n, counts, mean, topTwo }
 *           counts[i] is the point lo+i of the scale (1-5, 1-10, 0-10; stars
 *           is 1-5; a missing or unknown scale is 1-5). mean to 2 dp; topTwo
 *           the whole-number percent of n at the top two points. 0-10 adds
 *           { detractors, passives, promoters } (0–6, 7–8, 9–10 counts) and
 *           score = %promoters − %detractors, rounded half away from zero.
 *   choice  { kind, n, counts, other, otherIds }
 *           counts per canonical option index; `other` the write-ins, which
 *           count as a pick (single-pick: exactly one, index or write-in;
 *           multi: at most maxPicks). Shares of n may sum past 100%.
 *   yesno   { kind, n, counts: { yes, no, unsure }, whys: { yes, no, unsure } }
 *           whys are text ids, filed under the answer they explain.
 *   rank    { kind, n, avgPlace, firsts, placeHist, unplaced } per canonical item.
 *           An item left out of a partial ranking takes the MEAN OF THE
 *           UNFILLED PLACES (top 3 of 5 → places 4 and 5 → 4.5 each), so every
 *           respondent contributes 1+2+…+k and the averages sum to k(k+1)/2 —
 *           the only rule under which the mockup's 2.1+2.3+2.9+3.6+4.1 = 15.
 *           placeHist[i][p] counts explicit placements at place p+1;
 *           unplaced[i] = n − Σ placeHist[i]. avgPlace to 2 dp.
 *   text    { kind, n, answerIds }
 *   other   { kind, n: 0 } — a kind this function does not know.
 *
 * Empty questions give null for mean, topTwo, score and avgPlace, never NaN.
 *
 * ── TEXT IDS CARRY NO ORDER ───────────────────────────────────────────────
 *
 * Every open answer, write-in and why is copied into Texts[qid] and given the
 * id `<qid>:<k>`, k from 0, AFTER sorting by a sha256 of the qid, the answer
 * it explains and the text. Arrival order would say who answered first, and a
 * row's position could be lined up with a name elsewhere; a content hash says
 * neither. The same inputs in any row order give byte-identical output.
 *
 * ── NOTHING ABOUT A PERSON PASSES THROUGH ─────────────────────────────────
 *
 * Only `Answers` and `Complete` are read from a row. Its key, name, clientId,
 * timestamps, Rev and Session never reach the output.
 */
const crypto = require('crypto');

const SCALES = Object.freeze({ '1-5': [1, 5], '1-10': [1, 10], '0-10': [0, 10], stars: [1, 5] });
const DEFAULT_SCALE = '1-5';
const ANSWERS = Object.freeze(['yes', 'no', 'unsure']);
const FOLLOW_UPS = Object.freeze(['yes', 'no', 'any']);
const SHORT_TEXT_MAX = 280; // a why and a write-in, as the PUT route checks them
const TEXT_CAP = 2000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const owns = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isIndex = (v, count) => Number.isInteger(v) && v >= 0 && v < count;
const sumOf = (list) => list.reduce((a, b) => a + b, 0);
const optionCount = (q) => (Array.isArray(q.options) ? q.options.length : 0);

/** Rounded from the integer (or half-integer) total, so 161/40 is 4.03, not 4.02. */
const round2 = (total, n) => (n ? Math.round((total * 100) / n) / 100 : null);
const percent = (count, n) => (n ? Math.round((count * 100) / n) : null);
const halfAwayFromZero = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));

/**
 * A string trimmed, or `undefined` when blank / not there, or `null` when it is
 * the wrong type or longer than `max` (a value that does not fit).
 */
function readText(v, max) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return undefined;
  return t.length > max ? null : t;
}

// ── Each kind: how to read a value, and how to count what was read ─────────

function ratingKind(q) {
  const scale = owns(SCALES, q.scale) ? q.scale : DEFAULT_SCALE;
  const [lo, hi] = SCALES[scale];
  const counts = new Array(hi - lo + 1).fill(0);
  return {
    read: (v) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null),
    add: (v) => { counts[v - lo] += 1; },
    result: (n) => {
      const out = {
        kind: 'rating',
        scale,
        n,
        counts,
        mean: round2(sumOf(counts.map((c, i) => c * (lo + i))), n),
        topTwo: percent(counts[counts.length - 1] + counts[counts.length - 2], n),
      };
      if (scale === '0-10') {
        out.detractors = sumOf(counts.slice(0, 7));
        out.passives = sumOf(counts.slice(7, 9));
        out.promoters = sumOf(counts.slice(9));
        out.score = n ? halfAwayFromZero(((out.promoters - out.detractors) * 100) / n) : null;
      }
      return out;
    },
  };
}

function choiceKind(q, texts) {
  const count = optionCount(q);
  const multi = q.allowMultiple === true;
  const maxPicks = Number.isInteger(q.maxPicks) && q.maxPicks >= 1 ? q.maxPicks : Infinity;
  const counts = new Array(count).fill(0);
  let other = 0;
  return {
    read: (v) => {
      if (!Array.isArray(v) || v.length === 0) return null;
      let picks = v;
      let written;
      if (isObject(v[v.length - 1])) {
        if (q.allowOther !== true) return null;
        written = readText(v[v.length - 1].other, SHORT_TEXT_MAX);
        if (written === null) return null;
        picks = v.slice(0, -1);
      }
      if (!picks.every((i) => isIndex(i, count)) || new Set(picks).size !== picks.length) return null;
      const total = picks.length + (written === undefined ? 0 : 1);
      if (total === 0 || (!multi && total !== 1) || total > maxPicks) return null;
      return { picks, written };
    },
    add: ({ picks, written }) => {
      for (const i of picks) counts[i] += 1;
      if (written !== undefined) { other += 1; texts.push({ text: written }); }
    },
    result: (n, ids) => ({ kind: 'choice', n, counts, other, otherIds: ids.map((e) => e.id) }),
  };
}

function yesnoKind(q, texts) {
  const offered = q.unsure === true ? ANSWERS : ANSWERS.slice(0, 2);
  const asks = FOLLOW_UPS.includes(q.followUpWhen) ? q.followUpWhen : '';
  const counts = { yes: 0, no: 0, unsure: 0 };
  return {
    read: (v) => {
      if (!isObject(v) || !offered.includes(v.v)) return null;
      const why = readText(v.why, SHORT_TEXT_MAX);
      if (why === null) return null;
      if (why !== undefined && asks !== 'any' && asks !== v.v) return null;
      return { answer: v.v, why };
    },
    add: ({ answer, why }) => {
      counts[answer] += 1;
      if (why !== undefined) texts.push({ text: why, v: answer });
    },
    result: (n, ids) => ({
      kind: 'yesno',
      n,
      counts,
      whys: Object.fromEntries(ANSWERS.map((a) => [a, ids.filter((e) => e.v === a).map((e) => e.id)])),
    }),
  };
}

function rankKind(q) {
  const k = optionCount(q);
  const placeSums = new Array(k).fill(0);
  const firsts = new Array(k).fill(0);
  const placeHist = Array.from({ length: k }, () => new Array(k).fill(0));
  const unplaced = new Array(k).fill(0);
  return {
    read: (v) => (Array.isArray(v) && v.length >= 1 && v.every((i) => isIndex(i, k)) && new Set(v).size === v.length
      ? v : null),
    add: (order) => {
      // the places nobody was put in (order.length+1 … k), shared evenly by the items left out
      const shared = (order.length + 1 + k) / 2;
      const placed = new Array(k).fill(false);
      order.forEach((item, p) => {
        placed[item] = true;
        placeSums[item] += p + 1;
        placeHist[item][p] += 1;
      });
      firsts[order[0]] += 1;
      placed.forEach((isPlaced, item) => {
        if (!isPlaced) { placeSums[item] += shared; unplaced[item] += 1; }
      });
    },
    result: (n) => ({
      kind: 'rank', n, avgPlace: placeSums.map((s) => round2(s, n)), firsts, placeHist, unplaced,
    }),
  };
}

function textKind(q, texts) {
  const max = Number.isInteger(q.maxLength) && q.maxLength >= 1 && q.maxLength <= TEXT_CAP ? q.maxLength : TEXT_CAP;
  return {
    read: (v) => readText(v, max) || null,
    add: (text) => { texts.push({ text }); },
    result: (n, ids) => ({ kind: 'text', n, answerIds: ids.map((e) => e.id) }),
  };
}

function unknownKind(kind) {
  return { read: () => null, add: () => {}, result: () => ({ kind, n: 0 }) };
}

const KINDS = { rating: ratingKind, choice: choiceKind, yesno: yesnoKind, rank: rankKind, text: textKind };

// ── Text ids ────────────────────────────────────────────────────────────────

/** The same texts in any arrival order → the same order, and so the same ids. */
function numberTexts(qid, entries) {
  const keyed = entries.map((e) => ({
    e,
    key: crypto.createHash('sha256').update(`${qid}\n${e.v || ''}\n${e.text}`).digest('hex'),
  }));
  keyed.sort((a, b) => {
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    if (a.e.text !== b.e.text) return a.e.text < b.e.text ? -1 : 1;
    return 0; // same qid, same answer, same words: interchangeable
  });
  return keyed.map(({ e }, k) => (e.v === undefined
    ? { id: `${qid}:${k}`, text: e.text }
    : { id: `${qid}:${k}`, text: e.text, v: e.v }));
}

// ── The whole survey ────────────────────────────────────────────────────────

function aggregate(questions, rows) {
  const specs = [];
  const seen = new Set();
  for (const q of Array.isArray(questions) ? questions : []) {
    if (!isObject(q) || typeof q.qid !== 'string' || !q.qid || q.qid === '__proto__' || seen.has(q.qid)) continue;
    seen.add(q.qid);
    const kind = String(q.kind ?? '').trim().toLowerCase();
    const texts = [];
    const tally = owns(KINDS, kind) ? KINDS[kind](q, texts) : unknownKind(kind);
    specs.push({ qid: q.qid, tally, texts, n: 0 });
  }

  let N = 0;
  let Finished = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isObject(row)) continue;
    if (row.Complete === true) Finished += 1;
    const answers = isObject(row.Answers) ? row.Answers : null;
    if (!answers) continue;
    let answeredAny = false;
    for (const spec of specs) {
      if (!owns(answers, spec.qid)) continue;
      const raw = answers[spec.qid];
      if (raw === null || raw === undefined) continue;
      const value = spec.tally.read(raw);
      if (value === null) continue;
      spec.tally.add(value);
      spec.n += 1;
      answeredAny = true;
    }
    if (answeredAny) N += 1;
  }

  const PerQuestion = {};
  const Texts = {};
  for (const spec of specs) {
    const numbered = numberTexts(spec.qid, spec.texts);
    PerQuestion[spec.qid] = spec.tally.result(spec.n, numbered);
    if (numbered.length) Texts[spec.qid] = numbered;
  }
  return { N, Finished, Order: specs.map((s) => s.qid), PerQuestion, Texts };
}

module.exports = { aggregate };
