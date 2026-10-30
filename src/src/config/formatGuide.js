/**
 * THE FORMAT GUIDE — one source for the New engagement dialog's gallery cards,
 * its Compare table, the meeting-type chips and the help guide's account of
 * them (docs/design/new-engagement, README §8: "One source for the cards,
 * compare, help and the phone list").
 *
 * Kept beside config/gameTypes.js rather than inside it: gameTypes.js is read
 * by every display surface in the product, and these strings are the create
 * dialog's alone. `blurb` stays in gameTypes.js (the dialog still prints it
 * under the format chips).
 *
 * NO DURATIONS. The first mockup guessed minutes per format and every reviewer
 * caught it. The Pace row says who controls the pace instead, and a real
 * estimate may only come from the host's own history (README §6) — which
 * GET /games cannot give today, because the list carries no start time.
 *
 * `good`    the card's "Good for" line
 * `short`   the card's one plain line
 * `room`    Compare: what the room does
 * `get`     Compare: what the host gets
 * `pace`    Compare: who sets the pace
 * `size`    Compare: group size
 * `questions` Compare: where the questions come from
 * `starts`  Compare: how it starts
 */
import { BUILD_KIND, EVENT_KIND } from './engagementKinds';

export const FORMAT_GUIDE = Object.freeze({
  'call-and-answer': {
    short: 'Everyone answers, then votes for the best answers.',
    good: 'Retros, brainstorms.',
    room: 'Answers an open question on their phones, then votes for the answers that matter.',
    get: 'The room’s answers, ranked by votes, and a short summary from Workie after each round.',
    pace: 'One round is one question: answers, then the vote. You move on when you’re ready.',
    size: 'Any size',
    questions: 'Ready-made, or write your own',
    starts: 'Waits in your Sessions list until you press Start.',
  },
  trivia: {
    short: 'Multiple choice, one right answer, a scoreboard.',
    good: 'Socials, warm-ups.',
    room: 'Picks A, B, C or D. One answer is right, and every answer is explained.',
    get: 'A live scoreboard, and which questions the room knew or missed.',
    pace: 'One question at a time; you reveal the answer and move on.',
    size: 'Any size',
    questions: 'Ready-made, or write your own',
    starts: 'Waits in your Sessions list until you press Start.',
  },
  poll: {
    short: 'Quick questions with live results.',
    good: 'Quick decisions.',
    room: 'Answers one quick question: pick, rate, yes/no or a few words.',
    get: 'Each result filling in live on the main screen.',
    pace: 'Quick: each result shows the moment people answer.',
    size: 'Any size',
    questions: 'Ready-made, or write your own',
    starts: 'Waits in your Sessions list until you press Start.',
  },
  wavelength: {
    short: 'One word each; see where the room thinks alike.',
    good: 'Small teams, 10 or fewer.',
    room: 'Says one word for a subject. The words most people share come out on top.',
    get: 'Where the room already thinks alike, and where it doesn’t.',
    pace: 'One subject at a time; you move on when everyone has answered.',
    size: 'Best with 10 or fewer',
    questions: 'Ready-made, or write your own',
    starts: 'Waits in your Sessions list until you press Start.',
  },
  survey: {
    short: 'A short form, answered in people’s own time.',
    good: 'Feedback by form, not live.',
    room: 'Fills in a short form on their phones, whenever suits them.',
    get: 'Answers reported in aggregate. Anonymous unless you choose otherwise.',
    pace: 'Stays open as long as you like; you close it.',
    size: 'Any size',
    questions: 'Ready-made, or write your own',
    starts: 'Opens to answers the moment you create it. No Start step.',
  },
  [BUILD_KIND]: {
    short: 'Build with your Claude Code while the room votes.',
    good: 'Software teams.',
    room: 'Suggests ideas, picks between mockups and rates while your Claude Code builds.',
    get: 'Something built, every decision the room made, and a report.',
    pace: 'As long as the build takes; you decide each step.',
    size: 'Any size',
    questions: 'None: Claude writes them as it goes. Needs Claude Code.',
    starts: 'Continues on its own page.',
  },
  [EVENT_KIND]: {
    short: 'A whole agenda behind one join code.',
    good: 'Offsites, workshops.',
    room: 'Follows your agenda behind one join code: quizzes, polls, talks and breaks.',
    get: 'Each item’s report, gathered under the event.',
    pace: 'Your agenda’s times.',
    size: 'Any size',
    questions: 'Each agenda item picks its own.',
    starts: 'Continues on its own page.',
  },
});

/** The guide entry for a format id, or an empty one. Never undefined. */
export function formatGuide(id) {
  return FORMAT_GUIDE[id] || {
    short: '', good: '', room: '', get: '', pace: '', size: '', questions: '', starts: '',
  };
}

/** Formats that continue on their own page rather than in this dialog. */
export const HANDOFF_FORMATS = Object.freeze([BUILD_KIND, EVENT_KIND]);
export const isHandoffFormat = (id) => HANDOFF_FORMATS.includes(id);

/**
 * "PLANNING A…" — meeting types, because people say "retro", not "ideas and
 * priorities" (README §6). Each chooses a format and says why in one
 * sentence; any card can still be picked. They never filter the set list
 * (README §9, declined: no tag vocabulary guarantees a match).
 */
export const MEETING_TYPES = Object.freeze([
  { id: 'retro', label: 'Retro', format: 'call-and-answer', reason: 'Everyone answers “what went well, what should change”, then votes for the answers that matter.' },
  { id: 'brainstorm', label: 'Brainstorm', format: 'call-and-answer', reason: 'Everyone puts ideas in at once, then the room votes the best ones to the top.' },
  { id: 'kickoff', label: 'Kick-off', format: 'poll', reason: 'Quick questions with the result live on the screen get everyone talking from the first minute.' },
  { id: 'checkin', label: 'Team check-in', format: 'poll', reason: 'One quick question at a time — rate it, pick one, yes or no — with the result live.' },
  { id: 'quiz', label: 'Quiz', format: 'trivia', reason: 'Multiple choice with one right answer, every answer explained, and a scoreboard.' },
  { id: 'feedback', label: 'Feedback form', format: 'survey', reason: 'A short form people answer in their own time; you get the answers in aggregate.' },
  { id: 'offsite', label: 'Offsite day', format: EVENT_KIND, reason: 'A whole agenda — quizzes, polls, talks and breaks — behind one join code.' },
]);

/* ── The host's own history, from GET /games ─────────────────────────────── */

/**
 * What the dialog may infer from the session list the page already fetches
 * when it opens (README §6: no new storage): has this host created a session,
 * and what format was their newest. Rows carry `byMe`, `gameType` and
 * `createdAt` (game/get-games-list.js).
 *
 * @param {object[]} games  GET /games `games`
 * @param {string[]} offered format ids the dialog can choose
 */
export function historyFacts(games = [], offered = []) {
  const mine = (games || []).filter((g) => g && g.byMe);
  if (mine.length === 0) return { known: true, hasCreated: false, lastFormat: '' };
  const when = (g) => new Date(g.createdAt || 0).getTime() || 0;
  const newest = [...mine].sort((a, b) => when(b) - when(a))[0];
  const type = newest && newest.gameType;
  return {
    known: true,
    hasCreated: true,
    lastFormat: offered.includes(type) ? type : '',
  };
}

/*
  A CACHE OF THOSE TWO VALUES, so the first paint picks the right layout before
  the request returns, and the explicit "I know these" override. Both are
  per-viewer conveniences whose loss costs one click (README §6), so both live
  in localStorage, wrapped: a private window or blocked storage throws on
  access, and the dialog must work exactly the same without it.
*/
const HISTORY_KEY = 'engage.newEngagement.history';
const LAYOUT_KEY = 'engage.newEngagement.layout';

function storage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch (e) {
    return null;
  }
}

export function readHistoryCache() {
  try {
    const raw = storage() && storage().getItem(HISTORY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object'
      ? { known: false, hasCreated: Boolean(v.hasCreated), lastFormat: String(v.lastFormat || '') }
      : null;
  } catch (e) {
    return null;
  }
}

export function writeHistoryCache(facts) {
  try {
    const s = storage();
    if (s) s.setItem(HISTORY_KEY, JSON.stringify({ hasCreated: Boolean(facts.hasCreated), lastFormat: facts.lastFormat || '' }));
  } catch (e) { /* a convenience: nothing depends on it */ }
}

/** 'compact' | 'full' | '' (no override). */
export function readLayoutOverride() {
  try {
    const v = storage() && storage().getItem(LAYOUT_KEY);
    return v === 'compact' || v === 'full' ? v : '';
  } catch (e) {
    return '';
  }
}

export function writeLayoutOverride(value) {
  try {
    const s = storage();
    if (!s) return;
    if (value) s.setItem(LAYOUT_KEY, value); else s.removeItem(LAYOUT_KEY);
  } catch (e) { /* a convenience: nothing depends on it */ }
}

/* ── The shortcut ─────────────────────────────────────────────────────────── */

/** True on a Mac, from userAgentData.platform with the navigator.platform fallback. */
export function isMacPlatform(nav = (typeof navigator !== 'undefined' ? navigator : null)) {
  if (!nav) return false;
  const platform = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** "⌘↵" on a Mac, "Ctrl+↵" elsewhere. */
export function createShortcutLabel(mac = isMacPlatform()) {
  return mac ? '⌘↵' : 'Ctrl+↵';
}

/** The create shortcut: Enter with Meta or Control, either platform. */
export const isCreateShortcut = (event) => event.key === 'Enter' && (event.metaKey || event.ctrlKey);
