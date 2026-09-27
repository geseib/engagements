/**
 * THE POLL GENERATOR'S KINDS, AND ITS ONE BRIDGE TO THE CSV CONTRACT.
 *
 * The owner, 27 Sep 2026: a poll "should be a short instant feedback version of
 * the survey items", with "rate, pick from a few choices, binary … and then
 * open ended". So a poll question is a survey question the host asks — one of
 * the contract's POLL_KINDS (lambda-functions/admin/shared/survey-kinds.js),
 * with the survey's fields — and this file is what components/PollAIBuilder.jsx
 * and utils/generatedSetUpload.js need to say so: the four kinds in the words
 * the builder uses, a poll's kind read the way the server reads it, the line
 * the review table shows under each question, and the CSV.
 *
 * THE CSV IS NOT WRITTEN HERE, for the reason surveyDraft.js gives: the browser
 * has one writer of the question-set CSV, `rowsToCsv` in utils/questionRows.js.
 * Its survey branch IS the poll contract's CSV — the same twenty columns from
 * Kind to Themes — and it writes each row's own category, so a poll keeps
 * its categories where a survey files every row under `Survey`. The server's
 * writer of the same items is shared/generated-set.js `pollsToCsv`, and
 * __tests__/pollDraft.test.js holds the two byte-identical.
 */
import { toRow, rowsToCsv, rowProblems } from './questionRows';
import { normalizeTags } from './tags';
import { SURVEY_KINDS, previewLine, POLL_KINDS as CONTRACT_POLL_KINDS } from '../config/surveyKinds';

/**
 * The four kinds a poll may be, in the contract's POLL_KINDS order and named as
 * the poll builder names them. Rank is not one: a ranking is a ballot, not a
 * glance. Icons are the survey kinds' own, so a kind looks the same wherever it
 * appears.
 */
const BUILDER_WORDS = {
  choice: { label: 'Pick from choices', icon: 'ListBullets', blurb: 'Two to five short options. Pick one, or several.' },
  rating: { label: 'Rate', icon: 'Star', blurb: 'A scale, with words at both ends that mean something.' },
  yesno: { label: 'Yes / No', icon: 'ToggleLeft', blurb: 'Two buttons: Yes / No, or a pair that fits — Approve / Decline, True / False.' },
  text: { label: 'Open answer', icon: 'TextAlignLeft', blurb: 'A few words in their own voice. Used sparingly.' },
};
// The list itself is config/surveyKinds.js's (the contract's twin), so the
// builder, the editor and the importer can never disagree on what a poll may be.
export const POLL_KINDS = CONTRACT_POLL_KINDS.map((id) => ({ id, ...BUILDER_WORDS[id] }));

export const POLL_KIND_IDS = POLL_KINDS.map((k) => k.id);

/** Every kind on: the generator mixes them, and a host narrows it by unticking. */
export const DEFAULT_POLL_KINDS = [...POLL_KIND_IDS];

/** A poll question with no category of its own is filed here, as the server files it. */
const FALLBACK_CATEGORY = 'General';

const SURVEY_KIND_IDS = SURVEY_KINDS.map((k) => k.id);
const text = (value) => String(value ?? '').trim();
const filled = (options) => (Array.isArray(options) ? options.map(text).filter(Boolean) : []);

/**
 * The kind a poll item plays as — the server's pollFieldsOf rule, exactly: its
 * own kind if that is a poll kind, else a choice when it has two or more
 * options, else an open answer. An item from before kinds (options and
 * allowMultiple only) is therefore the choice it always was.
 */
export function pollKindOf(item) {
  const kind = text(item && item.kind);
  if (POLL_KIND_IDS.includes(kind)) return kind;
  return filled(item && item.options).length >= 2 ? 'choice' : 'text';
}

/** The kind's entry in POLL_KINDS. */
export function pollKindMeta(item) {
  const kind = pollKindOf(item);
  return POLL_KINDS.find((k) => k.id === kind);
}

/** The kind's name, as the Kind column shows it. */
export function pollKindLabel(item) {
  return pollKindMeta(item).label;
}

/** One poll item as an editor row: its kind resolved, its category and school filled, its tags normalised. */
export function pollItemRow(item) {
  const source = item || {};
  return toRow({
    ...source,
    kind: pollKindOf(source),
    category: text(source.category) || FALLBACK_CATEGORY,
    school: text(source.school) || 'General',
    tags: normalizeTags(source.tags),
  }, { origin: 'new' });
}

/**
 * The kept items as the poll contract's CSV — grouped by category in
 * first-seen order and numbered within each, as every builder's CSV is and as
 * the server's pollsToCsv writes the same items.
 */
export function pollItemsToCsv(items) {
  const groups = new Map();
  (items || []).forEach((item) => {
    const category = text(item && item.category) || FALLBACK_CATEGORY;
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  });
  return rowsToCsv([...groups.values()].flat().map(pollItemRow), 'survey');
}

/**
 * What would stop this item importing as a poll, in the importer's words, or
 * null. A survey-only kind is named first (validatePoll's own sentence): the
 * survey question form offers Ranking, and a poll that became one would
 * otherwise be written as a choice and never say why.
 */
export function pollItemProblem(item) {
  const kind = text(item && item.kind);
  if (kind && !POLL_KIND_IDS.includes(kind) && SURVEY_KIND_IDS.includes(kind)) {
    return `a poll can't be a ${kind} question`;
  }
  const problems = rowProblems(pollItemRow(item), 'survey');
  return problems.length ? problems.join('; ') : null;
}

/**
 * The line under a question in the review table: what the room will actually
 * see. A choice shows its options (a count would hide the one that is wrong);
 * the other kinds use the survey editor's own preview line, so a rating reads
 * "1–5 · Not ready → Ready" and a yes/no "Approve / Decline" wherever it is.
 */
export function pollSummary(item) {
  const row = pollItemRow(item);
  if (row.kind === 'choice') {
    const options = filled(row.options);
    if (options.length === 0) return 'No options yet';
    let rule = '';
    if (row.allowMultiple) rule = row.maxPicks ? ` — pick up to ${row.maxPicks}` : ' — pick several';
    return `${options.join(' · ')}${rule}${row.allowOther ? ' · + write-in' : ''}`;
  }
  const line = previewLine(row);
  return row.kind === 'text' && text(row.placeholder) ? `${line} · “${text(row.placeholder)}”` : line;
}

const VERBS = {
  choice: 'pick an option',
  rating: 'rate it',
  yesno: 'answer yes or no',
  text: 'answer in a few words',
};

const inWords = (list) => (list.length < 2 ? list.join('')
  : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`);

/**
 * THE MECHANIC LINE of a poll set's participant instruction: how a poll is
 * answered, for the kinds this set was generated with. It used to be "Select
 * your preferred option(s)", which was true only while every poll was a list
 * of options — and false for a rating, a yes/no or an open answer.
 */
export function pollMechanicInstruction(kinds) {
  const chosen = POLL_KIND_IDS.filter((id) => (kinds || []).includes(id));
  const verbs = (chosen.length ? chosen : POLL_KIND_IDS).map((id) => VERBS[id]);
  const how = verbs.length === 1 ? `: ${verbs[0]}` : ` — ${inWords(verbs)}, as each one asks`;
  return `Answer each question as it comes up${how}. The results appear on screen as the room answers.`;
}
