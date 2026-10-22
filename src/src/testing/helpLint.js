/* eslint-env node */
/**
 * helpLint — the help corpus, read the way its guard-rail tests read it
 * (help refresh Phase 0; __tests__/helpGuardrails.test.js).
 *
 * Plain CommonJS with no dependencies, under src/src/testing/ (not __tests__/,
 * where jest would run it as a suite). It never imports the corpus: callers
 * pass guides in, so it can be reused by a script without a transpiler.
 */

/** Keys whose values are addresses or rendering choices, never words people read. */
const NOT_TEXT = new Set(['id', 'icon', 't', 'tone', 'gameType', 'names']);

/** Every string a reader sees in a guide (or a section, or a block), in order. */
function userStrings(node) {
  const out = [];
  const walk = (value, key) => {
    if (key && NOT_TEXT.has(key)) return;
    if (typeof value === 'string') { out.push(value); return; }
    if (Array.isArray(value)) { value.forEach((v) => walk(v)); return; }
    if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(v, k));
  };
  walk(node);
  return out;
}

const userText = (node) => userStrings(node).join('\n');

const words = (text) => String(text).split(/\s+/).filter(Boolean).length;

/**
 * RETIRED WORDS (owner's decisions 1-3, 22 Oct 2026, and labels the UI no
 * longer has). `cased: true` for UI labels, which are only wrong spelled as
 * the label: "a new version" is a fine phrase, "New version" is a button that
 * does not exist.
 */
const BANNED = [
  { term: 'Presentation', re: /\bPresentation\b/g },
  { term: 'SETUP control', re: /\bSETUP control\b/g },
  { term: 'New version', re: /\bNew version\b/g },
  { term: 'Fork', re: /\bFork(ed|s)?\b/g },
  { term: 'codes card', re: /\bcodes card\b/gi },
  { term: 'display profile', re: /\bdisplay profile\b/gi },
  { term: 'word cloud', re: /\bword cloud\b/gi },
  { term: 'Field Notes', re: /\bField Notes\b/gi },
  { term: 'the AI summary', re: /\b(the|an) AI summary\b/gi },
  { term: 'projector', re: /\bprojector\b/gi },
  { term: 'big screen', re: /\bbig[- ]screen\b/gi },
  { term: 'the wall', re: /\bthe wall\b/gi },
];

const countTerm = (text, banned) => (String(text).match(banned.re) || []).length;

/**
 * The units a reader reads in one go: a paragraph, one list or step item, one
 * note, one question and its answer, one table row.
 */
function units(section) {
  const out = [];
  (section.blocks || []).forEach((block) => {
    if (Array.isArray(block.items) && block.t !== 'note') block.items.forEach((item) => out.push(userText(item)));
    else if (Array.isArray(block.rows)) block.rows.forEach((row) => out.push(userText(row)));
    else out.push(userText(block));
  });
  return out;
}

const sectionWords = (section) => words(userText(section));
const longestUnitWords = (section) => Math.max(0, ...units(section).map(words));

/** UI labels are marked in the text as **Label** (rendered bold by DocRenderer). */
const UI_LABEL = /\*\*([^*]+?)\*\*/g;
const uiLabels = (text) => [...String(text).matchAll(UI_LABEL)].map((m) => m[1]);

module.exports = {
  NOT_TEXT, userStrings, userText, words, BANNED, countTerm, units,
  sectionWords, longestUnitWords, UI_LABEL, uiLabels,
};
