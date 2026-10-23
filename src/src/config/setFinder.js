/**
 * FINDING A SET — the rules the host's set chooser and the console's Question
 * Sets list share (issue #41; docs/design/set-chooser, owner 23 Oct 2026:
 * "the current UX is not going to scale to find what people need as the
 * question sets grow ... search, filter by mine/team/public/engage or by date
 * or by tag").
 *
 * The search fields and the sorts were QuestionSetsPanel's own; they live here
 * now so the console list and the chooser cannot disagree about what a word
 * finds or what "newest" means. The chooser's extra axes (several tags at
 * once, a date window) are built on the same `config/listControls.js`
 * predicate, so its owner counts, its drop-exits and its list agree by
 * construction, exactly as the console's do.
 *
 * React-free; the component is components/SetChooser.jsx.
 */
import { resolveSetTopic } from './setTopics';
import { setCarriesTag } from './setShelfIndex';
import { setOwnerTag, setOwnerRank } from '../utils/setOwnerTag';

/** What a word in the search box is matched against: the set's name, its
 *  description, its custom instruction and its own tags. */
export const SET_SEARCH_FIELDS = Object.freeze(['name', 'description', 'customInstruction', (set) => set.tags]);

const time = (value) => {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : 0;
};
/** When a set last changed: its updatedAt, else when it was made. */
export const setUpdatedAt = (set) => time(set && (set.updatedAt || set.createdAt));

export const SET_SORTS = Object.freeze({
  newest: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
  oldest: (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
  name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
  questions: (a, b) => (b.totalQuestions || 0) - (a.totalQuestions || 0),
  // Yours, then your team's, then Engage's library, then public — the two you
  // can edit before the two you can only copy. Newest first within an owner.
  owner: (a, b) => (setOwnerRank(a) - setOwnerRank(b))
    || (new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
});

/**
 * Several tags at once, held as one comma-joined string so the axis keeps the
 * listControls shape ('' is All). A set matches when it carries ANY of them:
 * a host who ticks "retro" and "sprint" is widening what they look at.
 */
export const joinTags = (tags) => [...new Set((tags || []).filter(Boolean))].join(',');
export const splitTags = (value) => String(value || '').split(',').map((t) => t.trim()).filter(Boolean);

/** The date windows, in menu order. `used` reads the host's own sessions. */
export const UPDATED_WINDOWS = Object.freeze([
  { value: 'any', label: 'Any time' },
  { value: 'used', label: 'Used by me lately' },
  { value: 'week', label: 'Updated this week' },
  { value: 'month', label: 'Updated this month' },
  { value: 'older', label: 'Older than 3 months' },
]);
const DAY = 24 * 60 * 60 * 1000;
/** How far back "used by me lately" reaches. */
export const RECENT_USE_DAYS = 90;

/**
 * The chooser's config for config/listControls.js.
 *
 * `recent` maps a set's key to when this host last used it (ms); `keyOf` is
 * how the caller keys a set (utils/setRef.js's pair key). `now` is passed in so
 * a test can pin the clock.
 */
export function chooserConfig({ recent = new Map(), keyOf = (s) => s.id, now = Date.now() } = {}) {
  const usedAt = (set) => recent.get(keyOf(set)) || 0;
  const within = (set, days) => setUpdatedAt(set) >= now - days * DAY;
  return {
    searchFields: SET_SEARCH_FIELDS,
    axes: {
      owner: { get: (set) => setOwnerTag(set) },
      topic: { get: (set) => resolveSetTopic(set.topic) },
      tags: {
        all: '',
        get: (set) => set,
        eq: (set, wanted) => splitTags(wanted).some((tag) => setCarriesTag(set, tag)),
      },
      updated: {
        all: 'any',
        get: (set) => set,
        eq: (set, wanted) => {
          if (wanted === 'used') return usedAt(set) >= now - RECENT_USE_DAYS * DAY;
          if (wanted === 'week') return within(set, 7);
          if (wanted === 'month') return within(set, 30);
          if (wanted === 'older') return setUpdatedAt(set) > 0 && !within(set, 90);
          return true;
        },
      },
    },
    sorts: {
      // Recently used first (by this host), then the newest change.
      recent: (a, b) => (usedAt(b) - usedAt(a)) || (setUpdatedAt(b) - setUpdatedAt(a)),
      updated: (a, b) => setUpdatedAt(b) - setUpdatedAt(a),
      name: SET_SORTS.name,
      questions: SET_SORTS.questions,
      owner: SET_SORTS.owner,
    },
    defaultSort: 'recent',
  };
}

export const CHOOSER_SORTS = Object.freeze([
  { value: 'recent', label: 'Recently used' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Name' },
  { value: 'questions', label: 'Most questions' },
  { value: 'owner', label: 'Owner' },
]);

/**
 * The host's own recent uses of sets, from the session list (GET /games):
 * sessions this host made (`byMe`), newest use per set. Keyed by `keyOf`
 * applied to `{ id, scope }` so it meets the chooser's sets.
 */
export function recentUses(sessions = [], keyOf = (s) => s.id) {
  const out = new Map();
  for (const s of sessions || []) {
    if (!s || !s.byMe || !s.questionSetId) continue;
    const at = time(s.lastPlayedAt || s.createdAt);
    const key = keyOf({ id: s.questionSetId, scope: s.questionSetScope || undefined });
    if (at > (out.get(key) || 0)) out.set(key, at);
  }
  return out;
}

/** "used Tue", "used 2 wk ago", or the date a set last changed. */
export function whenWords(set, usedAt, now = Date.now()) {
  const ago = (t) => {
    const days = Math.floor((now - t) / DAY);
    if (days < 1) return 'today';
    if (days < 7) return new Date(t).toLocaleDateString(undefined, { weekday: 'short' });
    if (days < 31) return `${Math.round(days / 7)} wk ago`;
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  if (usedAt) return `used ${ago(usedAt)}`;
  const t = setUpdatedAt(set);
  return t ? ago(t) : '';
}
