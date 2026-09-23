/**
 * The five survey question kinds — the BROWSER's vocabulary for them.
 *
 * Contract: docs/design/survey-redesign/IMPLEMENTATION-phase-0-1.md, "THE
 * CONTRACT". The server's half is lambda-functions/admin/shared/survey-kinds.js
 * and the data half (row fields, validation, the CSV) is utils/questionRows.js,
 * which is CommonJS and so cannot import this file — it keeps its own copy of
 * the defaults, and a test holds the two equal.
 *
 * This file owns what a PERSON reads about a kind: its name, its icon, the one
 * sentence the Add menu shows, the preview line under a question in the editor,
 * and what switching a question to another kind would throw away.
 */

/** Ordered as the Add question menu lists them (mockup 04). Icons must exist in components/Icon.jsx. */
export const SURVEY_KINDS = [
  { id: 'rating', label: 'Rating', icon: 'Star', blurb: 'A scale: 1–5, 1–10, 0–10 (a recommend score) or stars.' },
  { id: 'choice', label: 'Multiple choice', icon: 'ListBullets', blurb: 'Pick one or several, with an optional write-in.' },
  { id: 'yesno', label: 'Yes / No', icon: 'ToggleLeft', blurb: 'Two buttons, an optional Not sure, and an optional “why?”' },
  { id: 'rank', label: 'Ranking', icon: 'ListNumbers', blurb: 'Put 3–7 items in order; the top few can be enough.' },
  { id: 'text', label: 'Open answer', icon: 'TextAlignLeft', blurb: 'Words. Workie groups them into themes when the survey closes.' },
];

/**
 * Every survey row is filed under this category. Surveys expose no categories,
 * but the importer's category bitmask needs one, so the editor hides the field
 * and fills it.
 */
export const SURVEY_CATEGORY = 'Survey';

const BY_ID = Object.fromEntries(SURVEY_KINDS.map((k) => [k.id, k]));

/** The kind's entry; an unknown kind reads as an open answer. */
export function surveyKindMeta(id) {
  return BY_ID[id] || BY_ID.text;
}

/** The name shown on a question's Kind chip. A 0–10 rating is a recommend score, so it says so. */
export function kindLabel(row) {
  if (row && row.kind === 'rating' && row.scale === '0-10') return 'Rating 0–10';
  return surveyKindMeta(row && row.kind).label;
}

const SCALE_WORDS = { '1-5': '1–5', '1-10': '1–10', '0-10': '0–10', stars: '1–5 stars' };

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const filledOptions = (row) => (Array.isArray(row.options) ? row.options.map(text).filter(Boolean) : []);

/** The one-line answer preview under a question in the editor's table (mockup 04). */
export function previewLine(row) {
  const r = row || {};
  switch (r.kind) {
    case 'rating': {
      const scale = r.scale || '1-5';
      if (scale === '0-10') return '0–10 · recommend score';
      const range = SCALE_WORDS[scale] || scale;
      const low = text(r.lowLabel);
      const high = text(r.highLabel);
      return low || high ? `${range} · ${low || '…'} → ${high || '…'}` : range;
    }
    case 'choice': {
      const n = filledOptions(r).length;
      let rule = 'pick one';
      if (r.allowMultiple) rule = r.maxPicks ? `pick up to ${r.maxPicks}` : 'pick any';
      return `${n} options · ${rule}${r.allowOther ? ' · + write-in' : ''}`;
    }
    case 'yesno': {
      const answers = [text(r.yesLabel) || 'Yes', text(r.noLabel) || 'No'];
      if (r.unsure) answers.push('Not sure');
      const base = answers.join(' / ');
      if (!r.followUpWhen) return base;
      const when = { yes: 'on Yes', no: 'on No', any: 'either way' }[r.followUpWhen] || '';
      return `${base} · asks why ${when}`.trim();
    }
    case 'rank': {
      const n = filledOptions(r).length;
      return `${n} items · ${r.rankTop ? `top ${r.rankTop} is enough` : 'rank all'}`;
    }
    default: {
      const long = (r.textLength || 'long') === 'long';
      const limit = r.maxLength || (long ? 500 : 280);
      return `${long ? 'Long' : 'Short'} answer · up to ${limit} characters`;
    }
  }
}

/** The contract's defaults for a new question of this kind. */
export function defaultsFor(kind) {
  switch (kind) {
    case 'rating':
      return { kind: 'rating', required: false, scale: '1-5', lowLabel: '', highLabel: '' };
    case 'choice':
      return { kind: 'choice', required: false, options: ['', ''], allowMultiple: false, maxPicks: null, allowOther: false, shuffle: false };
    case 'yesno':
      return { kind: 'yesno', required: false, yesLabel: '', noLabel: '', unsure: false, followUpWhen: '', followUpPrompt: '' };
    case 'rank':
      return { kind: 'rank', required: false, options: ['', '', ''], rankTop: null };
    default:
      return { kind: 'text', required: false, textLength: 'long', maxLength: 500, placeholder: '', themes: true };
  }
}

/** Every field the contract gives any kind. Switching kind clears the ones the new kind does not use. */
const KIND_FIELDS = {
  rating: ['scale', 'lowLabel', 'highLabel'],
  choice: ['options', 'allowMultiple', 'maxPicks', 'allowOther', 'shuffle'],
  yesno: ['yesLabel', 'noLabel', 'unsure', 'followUpWhen', 'followUpPrompt'],
  rank: ['options', 'rankTop'],
  text: ['textLength', 'maxLength', 'placeholder', 'themes'],
};
const ALL_KIND_FIELDS = [...new Set(Object.values(KIND_FIELDS).flat())];

const MAX_ITEMS = { choice: 8, rank: 7 };

/**
 * What a question of `from` kind would lose by leaving, in words a person can
 * be asked about. Only FILLED, non-default settings count: a default 1–5
 * rating with no labels switches without a question, because nothing is lost.
 */
function whatIsLost(row, toKind) {
  const lost = [];
  const keepsList = (row.kind === 'choice' || row.kind === 'rank') && (toKind === 'choice' || toKind === 'rank');
  switch (row.kind) {
    case 'rating':
      if (row.scale && row.scale !== '1-5') lost.push(`the ${SCALE_WORDS[row.scale] || row.scale} scale`);
      if (text(row.lowLabel)) lost.push(`the label “${text(row.lowLabel)}”`);
      if (text(row.highLabel)) lost.push(`the label “${text(row.highLabel)}”`);
      break;
    case 'choice':
      if (!keepsList && filledOptions(row).length) lost.push(`${filledOptions(row).length} options`);
      if (row.allowMultiple && row.maxPicks) lost.push(`pick up to ${row.maxPicks}`);
      else if (row.allowMultiple) lost.push('picking several');
      if (row.allowOther) lost.push('the write-in box');
      if (row.shuffle) lost.push('shuffling');
      break;
    case 'yesno':
      if (text(row.yesLabel)) lost.push(`the label “${text(row.yesLabel)}”`);
      if (text(row.noLabel)) lost.push(`the label “${text(row.noLabel)}”`);
      if (row.unsure) lost.push('Not sure');
      if (row.followUpWhen && text(row.followUpPrompt)) lost.push(`the follow-up “${text(row.followUpPrompt)}”`);
      break;
    case 'rank':
      if (!keepsList && filledOptions(row).length) lost.push(`${filledOptions(row).length} items`);
      if (row.rankTop) lost.push(`ranking the top ${row.rankTop}`);
      break;
    case 'text':
      if (text(row.placeholder)) lost.push(`the placeholder “${text(row.placeholder)}”`);
      break;
    default:
      break;
  }
  if (keepsList && MAX_ITEMS[toKind]) {
    const extra = (Array.isArray(row.options) ? row.options : []).slice(MAX_ITEMS[toKind]).map(text).filter(Boolean);
    extra.forEach((o) => lost.push(`option “${o}”`));
  }
  return lost;
}

/**
 * Switch a question to another kind. Returns the new row and `loses` — what
 * would be thrown away, in words. An empty `loses` means switch without
 * asking; anything else, ask first and name it. Choice ↔ Ranking keep their
 * list (trimmed to the new kind's maximum); Title, Detail, Required and every
 * non-kind field ride along untouched.
 */
export function convertKind(row, toKind) {
  if (!row || row.kind === toKind) return { row, loses: [] };
  const loses = whatIsLost(row, toKind);
  const next = { ...row };
  ALL_KIND_FIELDS.forEach((f) => { delete next[f]; });
  const defaults = defaultsFor(toKind);
  Object.assign(next, defaults, { required: row.required === true });
  if ((row.kind === 'choice' || row.kind === 'rank') && (toKind === 'choice' || toKind === 'rank')) {
    const kept = (Array.isArray(row.options) ? row.options : []).slice(0, MAX_ITEMS[toKind]);
    next.options = kept.length >= defaults.options.length ? kept : [...kept, ...defaults.options.slice(kept.length)];
  }
  return { row: next, loses };
}

/** "About N minutes to answer": ~20 seconds a question, a minute for each open answer, rounded up. */
export function estimateMinutes(rows) {
  const seconds = (rows || []).reduce((s, r) => s + ((r && r.kind) === 'text' ? 60 : 20), 0);
  return Math.ceil(seconds / 60);
}
