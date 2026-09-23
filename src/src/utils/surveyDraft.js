/**
 * THE SURVEY GENERATOR'S ARITHMETIC, and its one bridge to the CSV contract.
 *
 * docs/design/survey-redesign/02-generate.html (the form) and 03-review.html
 * (the review). Shared by components/SurveyAIBuilder.jsx and AdminPage's
 * handleSurveyGenerated, which is why it is a util and not a pair of closures.
 *
 * THE CSV IS NOT WRITTEN HERE. The browser has one writer of the question-set
 * CSV — `rowsToCsv` in utils/questionRows.js, held byte-identical to
 * download-question-set.js by tests/question-set-roundtrip.js — and a survey is
 * a branch of it (the implementation plan's "THE CONTRACT"). Generated items
 * already carry the contract's field names, so this maps each one to a row
 * (filed under the Survey category, which every survey row carries) and hands
 * the rows over. A second survey writer here would be a second thing to drift.
 */
import { toRow, rowsToCsv, rowProblems } from './questionRows';
import { SURVEY_KINDS, SURVEY_CATEGORY, estimateMinutes } from '../config/surveyKinds';

/** "Past twelve, people stop reading. The cap is 20." (mockup 02) */
export const MAX_SURVEY_QUESTIONS = 20;

/** The three sizes the form offers, in the mockup's words. */
export const SURVEY_SIZES = [
  { id: 'quick', label: 'Quick', count: 5 },
  { id: 'standard', label: 'Standard', count: 8 },
  { id: 'thorough', label: 'Thorough', count: 12 },
];

export const DEFAULT_SURVEY_COUNT = 8;

/**
 * Every kind on except Ranking — the slowest kind to answer and the easiest to
 * get wrong, so it is something to ask for rather than something to receive.
 */
export const DEFAULT_SURVEY_KINDS = SURVEY_KINDS.map((k) => k.id).filter((id) => id !== 'rank');

/** Whole questions, 1..20. What the field shows is what the job is asked for. */
export function clampQuestionCount(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_SURVEY_QUESTIONS);
}

/**
 * The survey the form is about to ask for, as far as time is concerned:
 * Workie uses only the ticked kinds and MIXES them, so the estimate deals the
 * count round the ticked kinds in menu order rather than pretending every
 * question is the quick kind.
 */
export function plannedMinutes(count, kinds) {
  const ticked = (kinds && kinds.length) ? kinds : DEFAULT_SURVEY_KINDS;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const planned = Array.from({ length: n }, (_, i) => ({ kind: ticked[i % ticked.length] }));
  return estimateMinutes(planned);
}

const firstLine = (value) => String(value ?? '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .find(Boolean) || '';

/** Cut at a word boundary, marked, so a clipped name reads as clipped. */
function clip(value, max) {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

/**
 * The name the draft set is created under.
 *
 * It has to be SOMETHING: shared/generated-set.js creates no set without a
 * title and records "No title was given for the set" on the job instead, which
 * would quietly turn the draft-set path back into the manual one. So a typed
 * name wins, then the first line of the material, then the goal.
 */
export function draftSurveyTitle({ title, source, goal } = {}) {
  const typed = String(title ?? '').trim();
  if (typed) return typed.slice(0, 200);
  const fromSource = firstLine(source);
  if (fromSource) return clip(fromSource, 80);
  const fromGoal = firstLine(goal);
  if (fromGoal) return clip(fromGoal, 80);
  return 'Untitled survey';
}

/** The set's description: what it is and what it was for. */
export function draftSurveyDescription({ goal } = {}) {
  const purpose = String(goal ?? '').trim();
  return purpose
    ? `A survey Workie drafted from your material. What it is for: ${purpose}`
    : 'A survey Workie drafted from your material.';
}

/** One generated item as an editor row, filed under Survey. */
export function surveyItemRow(item) {
  const source = item || {};
  return toRow(
    { ...source, category: source.category || SURVEY_CATEGORY },
    { origin: 'new' },
  );
}

/** The kept items as the contract CSV the importer reads. */
export function surveyItemsToCsv(items) {
  return rowsToCsv((items || []).map(surveyItemRow), 'survey');
}

/**
 * What would stop this item importing, in the importer's own words (the
 * contract's validation list, via rowProblems) — or null. Drives the review
 * table's "Needs attention" filter.
 */
export function surveyItemProblem(item) {
  const problems = rowProblems(surveyItemRow(item), 'survey');
  return problems.length ? problems.join('; ') : null;
}

/** How many of each kind, in menu order, absent kinds left out. */
export function kindMix(items) {
  const counts = {};
  (items || []).forEach((item) => {
    const kind = item && item.kind;
    counts[kind] = (counts[kind] || 0) + 1;
  });
  return SURVEY_KINDS
    .filter((k) => counts[k.id])
    .map((k) => ({ kind: k.id, count: counts[k.id] }));
}
