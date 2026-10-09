/**
 * READY QUESTIONS FOR A BUILD ROOM (step 7b, C13 and C15; owner, 2026-10-05:
 * "pre-canned questions that the host could pick from ... from call and
 * answer or poll question sets ... tag as build rooms ready").
 *
 * A set is Build Room ready when it carries the ordinary set tag `build-room`.
 * Its questions keep playing as they always have in a regular session; in a
 * Build Room each one is asked as one of the room's three kinds, decided here
 * from the set's type and the question's own kind, never typed by hand:
 *
 *   Call and Answer          -> Ideas  (everyone answers, then votes)
 *   Poll, rating on 1 to 5   -> Rate
 *   Poll, choice of 2 to 6   -> Choose
 *
 * Anything else (a 1 to 10 scale, yes or no, an open answer, a ranking, a
 * choice of seven) cannot be asked in a Build Room and says why.
 *
 * Questions arrive as editor rows (utils/questionRows.js `toRow`), so the set
 * editor and the Ask the room library read them the same way.
 */
export const BUILD_ROOM_TAG = 'build-room';
export const isBuildRoomSet = (set) => ((set && set.tags) || []).some((t) => String(t).toLowerCase() === BUILD_ROOM_TAG);

/** The room's names for its three kinds. */
export const ASKED_AS = Object.freeze({ suggest: 'Ideas', choice: 'Choose', rating: 'Rate' });

/** The starter sets' groups, in the order a session meets them (starter-set.md). */
export const CATEGORY_ORDER = Object.freeze(['Who it is for', 'Start', 'Think differently', 'While building', 'Before wrapping up']);

const MAX_CHOICE = 6;
const typeOf = (set) => String((set && (set.engagementType || set.gameType)) || '').toLowerCase();
const filled = (list) => (Array.isArray(list) ? list : []).map((o) => String(o || '').trim()).filter(Boolean);

/**
 * One question as a Build Room ask: `{ask}` ready for POST asks (with the
 * set's ClaudeGets and ClaudeNote), or `{reason}` it cannot be asked.
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
  if (type === 'call-and-answer') return { ask: { kind: 'suggest', ...base } };
  if (type !== 'poll') return { reason: 'Only Call and Answer and Poll sets can be asked in a Build Room.' };
  const kind = String(r.kind || '').toLowerCase();
  if (kind === 'rating') {
    const scale = String(r.scale || '1-5');
    if (scale !== '1-5') return { reason: `A Build Room rates on 1 to 5; this question uses ${scale === 'stars' ? 'stars' : scale.replace('-', ' to ')}.` };
    return { ask: { kind: 'rating', ...base } };
  }
  if (kind === 'choice') {
    const options = filled(r.options);
    if (options.length < 2) return { reason: 'A choice needs at least 2 options.' };
    if (options.length > MAX_CHOICE) return { reason: `A Build Room choice takes at most ${MAX_CHOICE} options; this one has ${options.length}.` };
    const maxPicks = r.allowMultiple ? Math.min(Number(r.maxPicks) || options.length, options.length) : 1;
    return { ask: { kind: 'choice', ...base, options: options.map((title) => ({ title })), maxPicks } };
  }
  const words = { yesno: 'A yes or no question', text: 'An open answer', rank: 'A ranking' };
  return { reason: `${words[kind] || 'This kind of question'} cannot be asked in a Build Room.` };
}

/** A label for the editor and the library: "Ideas", "Rate", "Choose", or null. */
export function askedAs(row, set) {
  const out = buildAskFromQuestion(row, set);
  return out.ask ? ASKED_AS[out.ask.kind] : null;
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
