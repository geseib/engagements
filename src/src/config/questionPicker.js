/**
 * CHOOSE A QUESTION (docs/design/question-picker, approved 5 Nov 2026 with
 * every fork at its recommendation): one picker, four doors, one way back.
 *
 * The decisions the picker makes that do not need a DOM live here, so the
 * laptop's QuestionPicker and the phone's sheet cannot disagree about them:
 * which session types get it (F7), what "the set would serve next" is (F3),
 * how the filters compose (F4: categories filter the list and never switch
 * anything off), where the way back goes (D6), and how Ask next is undone
 * (D7) with the queue route's own ops. No queue logic is copied here: Undo
 * is a list of the ops config/questionQueue.js already defines.
 */
import { filterBrowserRows, questionKey } from './setupPanel';
import { normalizeGameType } from './gameTypes';
import { normaliseQueue } from './questionQueue';

export const PICKER_WORDS = Object.freeze({
  title: 'Choose a question',
  key: 'C',
  door: 'Choose a question',
  change: 'Change what\'s next',
  counts: (notAsked, total) => `${notAsked} not asked · ${total} in the set`,
  done: 'Done',
  backTo: (where) => `Back to ${where}`,
  sessionMenu: 'Session menu',
  search: (n) => `Search ${n} questions`,
  searchLabel: 'Search questions',
  show: 'Show',
  notAsked: 'Not asked',
  all: 'All',
  categories: 'Categories',
  allCategories: 'All categories',
  catsOn: 'Categories that are on',
  off: 'off',
  offName: (name, n) => `${name}, off for this session, ${n}`,
  filtersNote: 'Filters change this list only. To stop a category for the session:',
  filtersLink: 'Up next › Categories',
  serveNext: 'The set would serve next',
  serveNextRest: 'if you change nothing',
  serveNextTitle: 'The set serves unasked questions from the categories that are on, in the set\'s order.',
  allNotAsked: 'All not asked',
  allQuestions: 'All questions',
  more: (n) => `${n} more`,
  showing: (n, of) => `Showing ${n} of ${of}`,
  queue: 'Queue',
  unqueue: 'Unqueue',
  askNext: 'Ask next',
  askNow: 'Ask now',
  askAgainNow: 'Ask again now',
  askNowNote: 'Ends the round on screen and asks this.',
  putAside: 'Put aside for this session',
  nextTag: 'Next',
  queuedTag: (n) => `Queued #${n}`,
  asked: 'Asked',
  alreadyAsked: 'Already asked this session. The running order skips asked questions — use Ask again now.',
  queueHint: 'Add it to the end of the running order.',
  askNextHint: 'Put it at the top of the running order. The round on screen carries on; this is asked when you end it.',
  preview: 'Preview',
  previewPrivate: 'this laptop only',
  previewRoom: 'the room can see this',
  previewNote: 'Ask next: after the round on screen. Ask now… is in ⋯ and ends this round first.',
  previous: 'Previous',
  next: 'Next',
  position: (i, n) => `${i} of ${n}`,
  keysMove: 'move',
  keysAsk: 'ask next',
  keysSearch: 'search',
  keysBack: 'back',
  writeOwn: 'Or write your own',
  loading: 'Loading questions…',
  emptySet: 'No questions are available for this set.',
  emptyFilter: 'Nothing matches these filters.',
  clearFilters: 'Clear the filters',
  roomLine: 'The room can see this list.',
  roomLineRest: 'Correct answers are never shown.',
  hide: 'Hide',
  usePhone: 'Use my phone instead',
  queuedHere: (n) => `${n} queued`,
  undo: 'Undo',
  putBack: 'Put back',
  pickNext: 'Next:',
  // The one-screen choice (D9), in OwnQuestionChoice's shape.
  choiceLead: 'The room can see this screen.',
  choiceLeadRest: 'The list shows questions they have not seen yet.',
  onPhone: 'Choose on your phone',
  onPhoneLine: 'It opens on your phone. Nothing shows here.',
  onPhoneLineOff: 'Scan once to drive the room from your phone. Nothing shows here.',
  openOnPhone: 'Open on my phone',
  connectPhone: 'Connect your phone',
  showHere: 'Show them here',
  showHereLine: 'The room will see the titles and the questions.',
  showHereButton: 'Show here',
  cancel: 'Cancel',
  // The phone (D10).
  phoneBackRound: 'Round',
  phoneBackUpNext: 'Up next',
  phoneChange: 'Change',
  phoneInCategory: (n, cat) => `${n} in ${cat}`,
  phoneClear: 'Clear',
});

/** The one-screen choice's words, in PrivateChoice's shape (D9). */
export const PICKER_CHOICE_WORDS = Object.freeze({
  title: PICKER_WORDS.title,
  cancel: PICKER_WORDS.cancel,
  lead: PICKER_WORDS.choiceLead,
  leadRest: PICKER_WORDS.choiceLeadRest,
  onPhone: PICKER_WORDS.onPhone,
  onPhoneLine: PICKER_WORDS.onPhoneLine,
  onPhoneLineOff: PICKER_WORDS.onPhoneLineOff,
  openOnPhone: PICKER_WORDS.openOnPhone,
  connectPhone: PICKER_WORDS.connectPhone,
  here: PICKER_WORDS.showHere,
  hereLine: PICKER_WORDS.showHereLine,
  hereButton: PICKER_WORDS.showHereButton,
});

/** F7: every set-based type. Survey, Wavelength and the Build Room have no set browser, so no C. */
export const PICKER_TYPES = Object.freeze(['call-and-answer', 'trivia', 'poll']);

export function pickerApplies(gameType, gameState = '') {
  // The Build Room is not in GAME_TYPES, so normalizeGameType would read it
  // as the default type: it is named here (CLAUDE.md, Build Room).
  if (String(gameType || '').trim().toLowerCase() === 'build') return false;
  return PICKER_TYPES.includes(normalizeGameType(gameType)) && gameState !== 'ENDED';
}

/** D8: the picker's view lives on the page for the session, not in the component. */
export const DEFAULT_PICKER_VIEW = Object.freeze({ search: '', cats: [], show: 'unasked' });

/** The special category entry: "the categories that are on" (the old Enabled only). */
export const CATS_ON = '__on';

/**
 * D6: where the crumb goes, in words. From the Session menu it goes back to
 * the menu; from anywhere else, to the round ("Round 3 · Answer").
 */
export function pickerBackLabel({ from = '', round = 0, step = '' } = {}) {
  if (from === 'menu') return PICKER_WORDS.sessionMenu;
  const n = Number(round);
  if (n > 0 && step) return `Round ${n} · ${step}`;
  if (n > 0) return `Round ${n}`;
  return step || 'the round';
}

/**
 * F3: THE SET WOULD SERVE NEXT — the next three set questions the plan
 * serves if the host changes nothing (queued rows first, as the server
 * drains them, then the set's own order), never the host's own question and
 * never the round on screen. Keys, in serve order.
 */
export function serveNextKeys(upNext = [], { currentQuestionId = null, limit = 3 } = {}) {
  const current = currentQuestionId === null ? '' : questionKey(String(currentQuestionId));
  return (upNext || [])
    .filter((row) => row && row.source !== 'own')
    .map((row) => questionKey(String(row.questionId || '')))
    .filter((key) => key && key !== current)
    .slice(0, limit);
}

/**
 * F4: the filters compose and change the list only. `cats` empty is every
 * category; otherwise a row passes when its category is ticked, or when
 * "categories that are on" is ticked and its category is on. Search matches
 * the title and the question's text (D5, `matchDetail`).
 */
export function filterPickerRows(rows = [], { search = '', cats = [], show = 'unasked' } = {}) {
  const picked = new Set(cats || []);
  const base = filterBrowserRows(rows, { search, unaskedOnly: show === 'unasked', matchDetail: true });
  if (!picked.size) return base;
  return base.filter((row) => picked.has(row.category) || (picked.has(CATS_ON) && !row.disabled));
}

/**
 * The category checkboxes, with the count each would show under the current
 * Show and search, and whether the category is switched off for the session.
 * From the set's rows, so a category the set uses but the session's masks do
 * not list still appears.
 */
export function categoryFacets(rows = [], { search = '', show = 'unasked', order = [] } = {}) {
  const counted = filterBrowserRows(rows, { search, unaskedOnly: show === 'unasked', matchDetail: true });
  const names = [];
  const seen = new Set();
  for (const name of [...(order || []), ...rows.map((r) => r.category)]) {
    if (!name || seen.has(name)) continue;
    if (!rows.some((r) => r.category === name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names.map((name) => ({
    name,
    count: counted.filter((r) => r.category === name).length,
    off: rows.some((r) => r.category === name && r.disabled),
  }));
}

/** The view with one category ticked or unticked; ticking "All categories" clears the rest. */
export function toggleCat(view = DEFAULT_PICKER_VIEW, name = '') {
  const cats = new Set((view && view.cats) || []);
  if (!name) return { ...view, cats: [] };
  if (cats.has(name)) cats.delete(name); else cats.add(name);
  return { ...view, cats: [...cats] };
}

/** Where a key sits in the running order, 0-based, or -1. */
export function queueIndex(queue, key) {
  return normaliseQueue(queue).indexOf(questionKey(String(key ?? '')));
}

/**
 * D7: UNDO FOR ASK NEXT, as the queue route's own ops. Ask next is the
 * `first` op; it either put a new entry at the head or moved one there from
 * `before`. The inverse is `remove` for a new entry, or `later` once per
 * place it moved up. No index splice: each op is replayed by the server
 * against the list it reads (config/questionQueue.js queueMove).
 */
export function undoAskNextOps(before = -1) {
  const at = Number(before);
  if (!Number.isInteger(at) || at < 0) return ['remove'];
  return Array.from({ length: at }, () => 'later');
}

/** The status line after Ask next: "Next: <title>". */
export function pickNoticeText(title = '') {
  return title ? `${PICKER_WORDS.pickNext} ${title}` : PICKER_WORDS.pickNext.replace(/:$/, '');
}

/**
 * The C key's intent, with Q's guards (useOwnQuestionKey.js): never while
 * typing, never with a modifier, never on a key repeat, never for a press
 * another listener already took. Whether a dialog is up is the caller's
 * `enabled`.
 */
export function pickerKeyIntent(event, isTypingTarget = () => false) {
  if (!event || (event.key !== 'c' && event.key !== 'C')) return null;
  if (event.repeat || event.defaultPrevented) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  return 'choose';
}

/** The option texts a preview may show, never which one is right (F7). */
const OPTION_NAMES = [
  ['optionA', 'OptionA'], ['optionB', 'OptionB'], ['optionC', 'OptionC'],
  ['optionD', 'OptionD'], ['optionE', 'OptionE'], ['optionF', 'OptionF'],
];
export function previewOptions(question = {}) {
  const q = question || {};
  const slots = OPTION_NAMES
    .map((names) => names.map((n) => q[n]).find((v) => typeof v === 'string' && v.trim()))
    .filter(Boolean)
    .map((v) => v.trim());
  if (slots.length) return slots;
  // A poll's choice question keeps its options as a list (CLAUDE.md, Poll Questions).
  const list = Array.isArray(q.options) ? q.options : [];
  return list.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
}
