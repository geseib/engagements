/**
 * SET PREVIEW — the rules behind components/SetPreview.jsx (the New engagement
 * dialog's read-only look at a set before choosing it; owner, 7 Nov 2026:
 * "add the set preview to the new engagement dialog").
 *
 * Pure functions, so the wording and the grouping are tested without a DOM.
 *
 * ONE READ, THE HOST'S OWN: `GET question-sets/{id}/questions?scope=<scope>`
 * (admin/get-question-set-questions.js) — the endpoint the set editor, the
 * phone remote's browser and the Build Room already call. Its guard is
 * READABILITY (findSetForCaller: the caller's org, platform and public), so
 * the preview can show nothing the host could not already open; `?scope=`
 * names the library so a slug shared by two libraries reads the right one.
 */
import { gameTypeLabel, normalizeGameType } from './gameTypes';
import { kindLabel } from './surveyKinds';
import { pollKindOf } from '../utils/pollDraft';
import { triviaOptions, isCorrectTriviaOption } from './questionCard';

/** The request path, relative to the API base. */
export function previewPath(set) {
  const id = encodeURIComponent(String((set && set.id) || ''));
  const scope = set && set.scope ? `?scope=${encodeURIComponent(String(set.scope))}` : '';
  return `question-sets/${id}/questions${scope}`;
}

/** A failed read in plain words. Never "deleted": a 404 means "not in a library you can read". */
export function previewFailure(status) {
  if (status === 401 || status === 403) return 'Your sign-in has expired. Sign in again, then open the preview again.';
  if (status === 404) return 'This set is not in a library you can read from here, so its questions cannot be shown.';
  if (!status) return 'Could not load the questions. Check your connection and try again.';
  return `Could not load the questions (${status}). Try again.`;
}

const text = (v) => String(v ?? '').trim();

/** A list field as stored: an array, or one string with | ; or new lines between items. */
export function listOf(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const s = text(value);
  if (!s) return [];
  return s.split(/\s*[|;\n]\s*/).map(text).filter(Boolean);
}

/** The words for a set's format, and whether it is a bluff-round set. */
export function setHeadline(set) {
  const s = set || {};
  return {
    format: s.engagementType ? gameTypeLabel(s.engagementType) : '',
    bluff: s.bluffRound === true,
  };
}

/**
 * ONE QUESTION, AS THE PREVIEW SHOWS IT: title, detail, then what the format
 * adds — trivia's options with the right one marked, a poll or survey
 * question's kind and options, an image thumbnail where the set has one.
 */
export function previewQuestion(q, gameType) {
  const type = normalizeGameType(gameType);
  const out = {
    id: text(q && (q.id || q.questionId)) || '',
    title: text(q && (q.title || q.question)),
    detail: text(q && (q.questionDetail || q.detail)),
    image: text(q && q.image),
    options: [],
    kind: '',
    scaleNote: '',
  };
  if (type === 'trivia') {
    out.options = triviaOptions(q).map((o) => ({
      letter: o.letter, text: text(o.text), correct: isCorrectTriviaOption(q, o.key, o.letter),
    }));
  } else if (type === 'poll' || type === 'survey') {
    const kind = type === 'poll' ? pollKindOf(q) : (text(q && q.kind) || 'text');
    out.kind = kindLabel({ kind, scale: q && q.scale });
    if (kind === 'choice' || kind === 'rank') {
      out.options = listOf(q && (q.options || q.Options)).map((t) => ({ text: t }));
    } else if (kind === 'yesno') {
      out.options = [{ text: text(q.yesLabel) || 'Yes' }, { text: text(q.noLabel) || 'No' }];
    } else if (kind === 'rating') {
      const ends = [text(q.lowLabel), text(q.highLabel)].filter(Boolean).join(' to ');
      out.scaleNote = [text(q.scale) || '1-5', ends].filter(Boolean).join(', ');
    }
  }
  return out;
}

/**
 * THE QUESTIONS BY CATEGORY, in the order the set lists them (the endpoint
 * sorts by sortOrder). A survey has no categories to speak of — every row is
 * filed under "Survey" — so it is one unnamed group.
 */
export function groupByCategory(questions = [], gameType = '') {
  const type = normalizeGameType(gameType);
  const groups = new Map();
  for (const q of questions || []) {
    const name = type === 'survey' ? '' : (text(q && (q.category || q.Category)) || 'General');
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(previewQuestion(q, type));
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }));
}
