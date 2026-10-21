/**
 * AI generation DRAFTS, from the browser — admin/generation-drafts.js on the
 * server. Every call names the draft's LIBRARY in the `X-Engage-Org` header,
 * because a draft lives in one library and is found there: a review opened
 * from the bell works whichever library the console happens to be standing in.
 *
 * Pure transport and a few pure readers. No React.
 */
import { authFetch, ORG_HEADER } from '../auth/authFetch';

export const DRAFT_STATUS = Object.freeze({
  GENERATING: 'generating',
  READY: 'ready',
  FAILED: 'failed',
  ACCEPTING: 'accepting',
  ACCEPTED: 'accepted',
  DISCARDED: 'discarded',
});

const base = () => `${(typeof window !== 'undefined' && window.API_BASE) || ''}admin/generation-drafts`;

/** The header that puts a request in a library, or nothing for "where I stand". */
export const libraryHeaders = (libraryKey) => (libraryKey ? { [ORG_HEADER]: libraryKey } : {});

async function call(method, tail, { body, libraryKey } = {}) {
  const res = await authFetch(`${base()}/${tail}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...libraryHeaders(libraryKey) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  return { ok: res.ok, status: res.status, data };
}

const enc = encodeURIComponent;

export const listDrafts = (libraryKey) => call('GET', 'list', { libraryKey });
export const getDraft = (draftId, libraryKey) => call('GET', enc(draftId), { libraryKey });
export const updateDraftItems = (draftId, updates, libraryKey) =>
  call('POST', `${enc(draftId)}/items`, { body: { updates }, libraryKey });
export const cancelDraft = (draftId, libraryKey) => call('POST', `${enc(draftId)}/cancel`, { body: {}, libraryKey });
export const discardDraft = (draftId, libraryKey) => call('POST', `${enc(draftId)}/discard`, { body: {}, libraryKey });
export const restoreDraft = (draftId, libraryKey) => call('POST', `${enc(draftId)}/restore`, { body: {}, libraryKey });
/** A new set: the server makes it. `{ activate, title, topic }`. */
export const acceptNewSetDraft = (draftId, options, libraryKey) =>
  call('POST', `${enc(draftId)}/accept`, { body: options || {}, libraryKey });
/** Adding to a set: claim, then the editor's save, then complete — or release. */
export const claimAppendDraft = (draftId, libraryKey) =>
  call('POST', `${enc(draftId)}/accept`, { body: { phase: 'claim' }, libraryKey });
export const completeAppendDraft = (draftId, result, libraryKey) =>
  call('POST', `${enc(draftId)}/accept`, { body: { phase: 'complete', ...result }, libraryKey });
export const releaseAppendDraft = (draftId, libraryKey) =>
  call('POST', `${enc(draftId)}/accept`, { body: { phase: 'release' }, libraryKey });

// ── Pure readers ───────────────────────────────────────────────────────────

const NOUNS = { trivia: 'questions', poll: 'poll questions', survey: 'survey questions' };
export const draftNoun = (engagementType) => NOUNS[engagementType] || 'questions';

/** Drafts waiting on the person: ready or failed (a failure is news too). */
export const waitingDrafts = (drafts = []) =>
  (drafts || []).filter((d) => d && (d.status === DRAFT_STATUS.READY || d.status === DRAFT_STATUS.FAILED));

/** Ready drafts that add to a given set, for its row's "Review · N" chip. */
export const draftsForSet = (drafts = [], setId = '') =>
  (drafts || []).filter((d) => d && d.mode === 'append' && d.targetSetId === setId
    && (d.status === DRAFT_STATUS.READY || d.status === DRAFT_STATUS.GENERATING));

/** Discarded in the last seven days, still restorable. */
export const restorableDrafts = (drafts = []) => (drafts || []).filter((d) => d && d.status === DRAFT_STATUS.DISCARDED);

/** Items grouped by category, first-seen order. Each group: `{ category, items }`. */
export function groupByCategory(items = []) {
  const groups = [];
  const at = new Map();
  for (const it of items || []) {
    const category = String((it && it.item && it.item.category) || 'Uncategorised').trim() || 'Uncategorised';
    if (!at.has(category)) { at.set(category, groups.length); groups.push({ category, items: [] }); }
    groups[at.get(category)].items.push(it);
  }
  return groups;
}

/**
 * What is wrong with one generated question, in words, or null. The same two
 * defects the builders' review screens checked: an answer key that names no
 * option this question has, and a question with no text to put in front of a
 * room. A defective question is left out by default on the review screen.
 */
export function itemDefect(item = {}, engagementType = '') {
  if (!String(item.title || '').trim()) return 'No title.';
  if (engagementType === 'trivia') {
    const answers = (Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer]).filter(Boolean);
    if (!answers.length) return 'No correct answer was set — this question cannot be scored.';
    const missing = answers.filter((a) => !String(item[`option${String(a).replace(/^Option/, '')}`] || '').trim());
    if (missing.length) return `The correct answer (${missing.join(', ')}) points at an empty option.`;
    return null;
  }
  if (['call-and-answer', 'wavelength'].includes(engagementType) && !String(item.detail || '').trim()) {
    return 'No scenario text — there is nothing for the room to respond to.';
  }
  return null;
}

/** "about 7,000 output tokens" — the estimate the server already knows the rate for. */
export function tokenEstimate(count, tokensPerItem) {
  const n = Math.max(0, Number(count) || 0) * Math.max(0, Number(tokensPerItem) || 0);
  if (!n) return '';
  const rounded = n >= 1000 ? Math.round(n / 100) * 100 : n;
  return `about ${rounded.toLocaleString('en-US')} output tokens`;
}
