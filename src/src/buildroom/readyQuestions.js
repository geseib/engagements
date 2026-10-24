/**
 * READY QUESTIONS FOR A BUILD ROOM (step 7b, C13 and C15; owner, 2026-10-05:
 * "pre-canned questions that the host could pick from ... from call and
 * answer or poll question sets ... tag as build rooms ready").
 *
 * A set is Build Room ready when it carries the ordinary set tag `build-room`.
 * Its questions keep playing as they always have in a regular session; in a
 * Build Room each one is asked as one of the room's four types, decided here
 * from the set's type and the question's own kind, never typed by hand (owner,
 * 24 Oct: "some questions are ideas ... some are multiple choice ... some are
 * yes no. we need to store that info"):
 *
 *   Call and Answer          -> Ideas  (everyone answers, then votes)
 *   Poll, open answer        -> Ideas
 *   Poll, choice of 2 to 6   -> Choose
 *   Poll, yes or no          -> Yes/No (a choice of its two answers, the room's
 *                               yes or no ask; build-store.js ideaOutcome)
 *   Poll, rating on 1 to 5   -> Rate
 *
 * So one Poll set holds all four. Anything else (a 1 to 10 scale, a ranking, a
 * choice of seven) cannot be asked in a Build Room and says why.
 *
 * Questions arrive as editor rows (utils/questionRows.js `toRow`), so the set
 * editor and the Ask the room library read them the same way.
 */
export const BUILD_ROOM_TAG = 'build-room';
export const isBuildRoomSet = (set) => ((set && set.tags) || []).some((t) => String(t).toLowerCase() === BUILD_ROOM_TAG);

/**
 * WHICH KINDS OF BUILD A SET IS FOR (docs/superpowers/plans/2026-10-22-build-room-question-sets.md):
 * its `for-<kind>` tags (tags are kebab-case: `for-game`, `for-training`). None: any kind.
 */
export const forKindsOf = (set) => ((set && set.tags) || [])
  .map((t) => String(t).toLowerCase())
  .filter((t) => t.startsWith('for-') && t.length > 4)
  .map((t) => t.slice(4));

/**
 * The library's order once the room's kind is known: the sets for it, then the
 * general ones (no `for-` tag), then the rest, which the library folds away.
 * Before the kind is known, every set is shown, the general ones first.
 */
export function rankSetsForKind(sets, kind) {
  const list = sets || [];
  const general = list.filter((st) => !forKindsOf(st).length);
  if (!kind) return { first: [], general, other: list.filter((st) => forKindsOf(st).length) };
  const first = list.filter((st) => forKindsOf(st).includes(kind));
  const other = list.filter((st) => forKindsOf(st).length && !forKindsOf(st).includes(kind));
  return { first, general, other };
}

/** The kinds of build, as the library and the host read them (build-store.js BUILD_KINDS). */
export const KIND_NAMES = Object.freeze({
  website: 'a website', app: 'an app', game: 'a game', tool: 'a tool', document: 'a document or paper',
  explore: 'figuring something out', training: 'a training site', dashboard: 'a dashboard',
});

/**
 * The room's names for its four types, keyed by the ask's kind, and `yesno`
 * for a choice of yes or no. In the library's order.
 */
export const ASKED_AS = Object.freeze({ suggest: 'Ideas', choice: 'Choose', yesno: 'Yes/No', rating: 'Rate' });
/** What each type asks of the room, for the set editor. */
export const ASKED_AS_HINT = Object.freeze({
  suggest: 'Everyone answers, then votes.',
  choice: 'The room picks from the options.',
  yesno: 'The room answers yes or no.',
  rating: 'The room rates 1 to 5: 1 needs work, 5 is great.',
});

/** The starter sets' groups, in the order a session meets them (starter-set.md). */
export const CATEGORY_ORDER = Object.freeze(['Who it is for', 'Start', 'Think differently', 'While building', 'Before wrapping up']);

const MAX_CHOICE = 6;
const typeOf = (set) => String((set && (set.engagementType || set.gameType)) || '').toLowerCase();
const filled = (list) => (Array.isArray(list) ? list : []).map((o) => String(o || '').trim()).filter(Boolean);

/**
 * One question as a Build Room ask: `{ask, type}` with the ask ready for POST
 * asks (with the set's ClaudeGets and ClaudeNote) and its type an ASKED_AS
 * key, or `{reason}` it cannot be asked.
 */
export function buildAskFromQuestion(row, set) {
  const r = row || {};
  const prompt = String(r.title || '').trim();
  if (!prompt) return { reason: 'It has no question text.' };
  const base = {
    prompt,
    detail: String(r.detail || '').trim(),
    claudeGets: String(r.claudeGets || '').trim() || 'do-now',
    claudeNote: String(r.claudeNote || '').trim(),
  };
  const type = typeOf(set);
  if (type === 'call-and-answer') return { ask: { kind: 'suggest', ...base }, type: 'suggest' };
  if (type !== 'poll') return { reason: 'Only Call and Answer and Poll sets can be asked in a Build Room.' };
  const kind = String(r.kind || '').toLowerCase();
  if (kind === 'rating') {
    const scale = String(r.scale || '1-5');
    if (scale !== '1-5') return { reason: `A Build Room rates on 1 to 5; this question uses ${scale === 'stars' ? 'stars' : scale.replace('-', ' to ')}.` };
    return { ask: { kind: 'rating', ...base }, type: 'rating' };
  }
  if (kind === 'choice') {
    const options = filled(r.options);
    if (options.length < 2) return { reason: 'A choice needs at least 2 options.' };
    if (options.length > MAX_CHOICE) return { reason: `A Build Room choice takes at most ${MAX_CHOICE} options; this one has ${options.length}.` };
    const maxPicks = r.allowMultiple ? Math.min(Number(r.maxPicks) || options.length, options.length) : 1;
    return { ask: { kind: 'choice', ...base, options: options.map((title) => ({ title })), maxPicks }, type: 'choice' };
  }
  if (kind === 'yesno') {
    // Its own answer words when the set renamed them (Approve / Decline); "Not sure" is not offered.
    const options = [String(r.yesLabel || '').trim() || 'Yes', String(r.noLabel || '').trim() || 'No'];
    return { ask: { kind: 'choice', ...base, options: options.map((title) => ({ title })), maxPicks: 1 }, type: 'yesno' };
  }
  if (kind === 'text') return { ask: { kind: 'suggest', ...base }, type: 'suggest' };
  const words = { rank: 'A ranking' };
  return { reason: `${words[kind] || 'This kind of question'} cannot be asked in a Build Room.` };
}

/** A label for the editor and the library: "Ideas", "Choose", "Yes/No", "Rate", or null. */
export function askedAs(row, set) {
  const out = buildAskFromQuestion(row, set);
  return out.ask ? ASKED_AS[out.type] : null;
}

/** A library item's type: its own, or its ask's kind (ASKED_AS keys). */
export const typeOfItem = (it) => (it && (it.type || (it.ask && it.ask.kind))) || '';

/**
 * THE TYPE CHIPS (owner, 24 Oct: "need to filter if the host clicks a type"):
 * All, then each type in ASKED_AS order, with how many of the items are it.
 * A type none of the items is still shows, at 0, so the row does not jump.
 */
export function typeCounts(items) {
  const list = items || [];
  return [
    { type: 'all', label: 'All', count: list.length },
    ...Object.keys(ASKED_AS).map((type) => ({ type, label: ASKED_AS[type], count: list.filter((it) => typeOfItem(it) === type).length })),
  ];
}

/**
 * A set's askable questions grouped by category, the starter categories first
 * in session order, then any others as the set has them.
 */
export function groupReady(items) {
  const groups = new Map();
  for (const it of items) {
    const cat = it.category || 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(it);
  }
  const rank = (c) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([category, list]) => ({ category, items: list }));
}

// ── Question sets Claude wrote (question-sets plan step 7) ─────────────────

/** A Claude set's kinds (build-store.js normalizeClaudeSet) as the room asks them. */
const CLAUDE_KIND = Object.freeze({ suggest: 'suggest', choice: 'choice', yesno: 'choice', rating: 'rating' });
const YES_NO = Object.freeze(['Yes', 'No']);

/** A Claude set's questions as the library lists them, like a saved set's. */
export function claudeSetItems(cs) {
  return ((cs && cs.questions) || []).filter((q) => CLAUDE_KIND[q.kind]).map((q, i) => ({
    key: `claude:${cs.setId}:${i}`,
    category: q.category || 'While building',
    setName: cs.name || 'From Claude',
    type: q.kind,
    ask: {
      kind: CLAUDE_KIND[q.kind],
      prompt: q.prompt,
      detail: q.detail || '',
      claudeGets: 'do-now',
      claudeNote: '',
      ...(CLAUDE_KIND[q.kind] === 'choice' ? { options: (q.kind === 'yesno' ? YES_NO : q.options || []).map((title) => ({ title })), maxPicks: 1 } : {}),
    },
  }));
}

/**
 * A Claude set as a draft for the AI drafts review behind the bell. Only
 * Ideas: a Call and Answer draft. Any Choose, Yes/No or Rate: one Poll draft,
 * the Ideas in it as open answers, the shape the starter sets have (owner, 24
 * Oct). Tagged build-room and for-<kind>, so once accepted it is in the
 * library for that kind.
 */
const POLL_ITEM = Object.freeze({
  suggest: () => ({ kind: 'text' }),
  choice: (q) => ({ kind: 'choice', options: q.options || [] }),
  yesno: () => ({ kind: 'yesno' }),
  rating: () => ({ kind: 'rating', scale: '1-5' }),
});
export function draftsFromClaudeSet(cs, gameId = '') {
  const qs = ((cs && cs.questions) || []).filter((q) => POLL_ITEM[q.kind]);
  if (!qs.length) return [];
  const name = (cs && cs.name) || 'Questions from Claude';
  const tags = ['build-room', ...(cs && cs.kind ? [`for-${cs.kind}`] : [])];
  const poll = qs.some((q) => q.kind !== 'suggest');
  const item = (q) => ({ title: q.prompt, detail: q.detail || '', category: q.category || 'While building', ...(poll ? POLL_ITEM[q.kind](q) : {}) });
  return [{
    tags, description: 'Written by Claude in a Build Room.', ...(gameId ? { gameId: String(gameId) } : {}),
    title: name,
    engagementType: poll ? 'poll' : 'call-and-answer',
    items: qs.map(item),
  }];
}
