/**
 * ADDING QUESTIONS TO A SET THAT ALREADY EXISTS.
 *
 * The owner: "You should be able to add additional questions to a question set
 * using the exact same AI/csv/1by1 etc. ... of course it should ask if you want
 * the same categories, or are adding new categories. adding and using the
 * existing will create a weird imbalance most likely so should either be one or
 * the other at a time."
 *
 * THERE IS NO APPEND ROUTE, AND NONE IS NEEDED. The set editor already holds a
 * set as working rows and saves them as a new VERSION (QuestionsPanel
 * `saveRows` → upload-questions with `replaceSetId`). So "add" means: turn
 * whatever arrived — generated items, a CSV, a hand-written question — into
 * rows, hold them to the ONE mode the person chose, and append them to the
 * working copy. Nothing is written until Save, exactly like every other edit.
 *
 * Pure functions only. The dialog and the panel do the rendering.
 */
import { toRow } from './questionRows';
import { parseCsv } from './questionSetEditing';

export const ADD_MODES = { EXISTING: 'existing', NEW: 'new' };
export const MAX_CATEGORIES = 24;
export const AI_DRAFT_TAG = 'ai-drafted';

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** The set's live categories, in first-seen order, removed rows ignored. */
export function existingCategories(rows = []) {
  const seen = new Map();
  rows.forEach((row) => {
    if (!row || row.removed) return;
    const name = String(row.category ?? '').trim();
    if (name && !seen.has(norm(name))) seen.set(norm(name), name);
  });
  return [...seen.values()];
}

/** How many live questions each category holds — the balance the mode protects. */
export function categoryCounts(rows = []) {
  const counts = new Map();
  rows.forEach((row) => {
    if (!row || row.removed) return;
    const name = String(row.category ?? '').trim();
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  });
  return counts;
}

/** A new row, never a loaded one: no stored key, no number, origin 'new'. */
function asNewRow(source, { ai = false } = {}) {
  const { id, sk, SK, active, ...fields } = source || {};
  const row = toRow(fields, { origin: 'new' });
  return {
    ...row,
    sk: '',
    questionNumber: null,
    tags: ai && !row.tags.includes(AI_DRAFT_TAG) ? [...row.tags, AI_DRAFT_TAG] : row.tags,
  };
}

/** Generated items → rows, tagged so AI authorship survives the CSV. */
export function rowsFromItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => asNewRow(item, { ai: true }));
}

/*
  CSV headers are matched case-insensitively and mapped onto the spellings
  `toRow` reads. `Question#` is deliberately absent: the set numbers its own
  questions, and a number carried in from another file would collide.
*/
const HEADER_TO_FIELD = {
  category: 'Category',
  title: 'Title',
  detail: 'Detail',
  questiondetail: 'Detail',
  // What every download writes for call-and-answer, poll and survey.
  detaillesson: 'Detail',
  school: 'School',
  custominstructions: 'CustomInstructions',
  custominstruction: 'CustomInstructions',
  answerdetails: 'AnswerDetails',
  image: 'Image',
  tags: 'Tags',
  roundkind: 'RoundKind',
  sourceattribution: 'SourceAttribution',
  optiona: 'optionA',
  optionb: 'optionB',
  optionc: 'optionC',
  optiond: 'optionD',
  optione: 'optionE',
  optionf: 'optionF',
  correctanswer: 'correctAnswer',
  difficulty: 'difficulty',
  options: 'options',
  allowmultiple: 'allowMultiple',
  // The survey branch of the contract (docs/design/survey-redesign/
  // IMPLEMENTATION-phase-0-1.md). toRow reads the capitalised spellings and
  // types the strings (booleans, integers, the per-kind defaults).
  kind: 'Kind',
  required: 'Required',
  maxpicks: 'MaxPicks',
  allowother: 'AllowOther',
  shuffle: 'Shuffle',
  scale: 'Scale',
  lowlabel: 'LowLabel',
  highlabel: 'HighLabel',
  yeslabel: 'YesLabel',
  nolabel: 'NoLabel',
  unsure: 'Unsure',
  followupwhen: 'FollowUpWhen',
  followupprompt: 'FollowUpPrompt',
  ranktop: 'RankTop',
  textlength: 'TextLength',
  maxlength: 'MaxLength',
  placeholder: 'Placeholder',
  themes: 'Themes',
};

/** A CSV in the template's own columns → rows. `{ rows, error }`. */
export function rowsFromCsv(text) {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], error: 'That file has a header and no questions under it.' };
  const fields = table[0].map((h) => HEADER_TO_FIELD[norm(h).replace(/[\s_#-]/g, '')] || null);
  if (!fields.includes('Title') || !fields.includes('Category')) {
    return { rows: [], error: 'That file needs at least a Category and a Title column — start from the template.' };
  }
  const rows = table.slice(1)
    .filter((cells) => cells.some((c) => String(c).trim() !== ''))
    .map((cells) => {
      const source = {};
      fields.forEach((field, i) => { if (field) source[field] = cells[i] ?? ''; });
      // The file separates options with a pipe, as the importer reads them.
      // Handing toRow the raw cell would let its tag splitter cut an option
      // at every comma ("The case studies, with their numbers" became two).
      if (typeof source.options === 'string') {
        source.options = source.options.split('|').map((o) => o.trim()).filter(Boolean);
      }
      return asNewRow(source);
    })
    .filter((row) => row.title);
  return rows.length ? { rows, error: '' } : { rows: [], error: 'No row in that file has a title.' };
}

/**
 * HOLD THE INCOMING ROWS TO THE ONE MODE THAT WAS CHOSEN.
 *
 *   existing — only rows filed under a category the set already has. The
 *              category is re-spelled the set's way ("history" → "History"),
 *              so a case difference does not mint a twin category.
 *   new      — only rows filed under a category the set does NOT have.
 *
 * `spread: true` (the AI path, in `existing` mode) re-files strays round-robin
 * across the set's categories instead of dropping them: those questions were
 * paid for, and the model inventing a category name is not the author's fault.
 *
 * Returns `{ kept, dropped, overCap }`; `dropped` rows carry the reason in words.
 */
export function holdToMode(incoming = [], currentRows = [], mode = ADD_MODES.EXISTING, { spread = false } = {}) {
  const existing = existingCategories(currentRows);
  const byNorm = new Map(existing.map((name) => [norm(name), name]));
  const kept = [];
  const dropped = [];
  let turn = 0;

  incoming.forEach((row) => {
    const match = byNorm.get(norm(row.category));
    if (mode === ADD_MODES.EXISTING) {
      if (match) kept.push({ ...row, category: match });
      else if (spread && existing.length) {
        kept.push({ ...row, category: existing[turn % existing.length] });
        turn += 1;
      } else {
        dropped.push({ row, reason: row.category ? `“${row.category}” is not one of this set's categories` : 'it has no category' });
      }
    } else if (match) {
      dropped.push({ row, reason: `“${match}” already exists in this set` });
    } else if (!String(row.category ?? '').trim()) {
      dropped.push({ row, reason: 'it has no category' });
    } else {
      kept.push(row);
    }
  });

  // The 24-category ceiling is the bitmask's, not a preference.
  let overCap = 0;
  if (mode === ADD_MODES.NEW) {
    const room = Math.max(0, MAX_CATEGORIES - existing.length);
    const fresh = existingCategories(kept);
    if (fresh.length > room) {
      const allowed = new Set(fresh.slice(0, room).map(norm));
      const within = [];
      kept.forEach((row) => {
        if (allowed.has(norm(row.category))) within.push(row);
        else { overCap += 1; dropped.push({ row, reason: `a set holds at most ${MAX_CATEGORIES} categories` }); }
      });
      return { kept: within, dropped, overCap };
    }
  }
  return { kept, dropped, overCap };
}

/** One sentence for the status line after an add. */
export function describeAdded({ kept = [], dropped = [] }, mode) {
  const n = kept.length;
  const cats = existingCategories(kept).length;
  const head = n === 0
    ? 'Nothing was added.'
    : `${n} question${n === 1 ? '' : 's'} added ${mode === ADD_MODES.NEW
      ? `in ${cats} new categor${cats === 1 ? 'y' : 'ies'}`
      : `across ${cats} of this set's categories`}.`;
  const reasons = [...new Set(dropped.map((d) => d.reason))];
  const left = dropped.length
    ? ` ${dropped.length} left out: ${reasons.join('; ')}.`
    : '';
  return `${head}${left}${n ? ' Nothing is saved until you press Save.' : ''}`;
}
