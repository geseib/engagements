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
 * PLAIN WORDS (owner, 30 Oct 2026: "the explaination of each type is not
 * super clear"; feedback/owner-2026-10-30.md). Three lengths per format:
 *
 * `short`   the plain summary: the guide's line, the gallery card in Guided
 *           and the line under the chips (README round 2, decision 8)
 * `col`     the guide card's one sentence
 * `get`     what you get (the walkthrough's last dot says it at length)
 * `good` / `group` / `startsShort`  the guide card's Good for, Group, Starts
 * `room`, `pace`, `size`, `questions`, `starts`  the retired Compare table's
 *           rows, kept for the help's account of each format
 */
import { BUILD_KIND, EVENT_KIND } from './engagementKinds';

export const FORMAT_GUIDE = Object.freeze({
  'call-and-answer': {
    short: 'Ask the room a question. Everyone answers on their phone, reads all the answers and votes for their favourites.',
    col: 'Everyone answers, reads all the answers and votes for their favourites.',
    good: 'Retros, brainstorms.',
    group: 'Any size',
    startsShort: 'When you press Start',
    room: 'Answers your question on their phones, reads everyone’s answers (no names while voting), votes for their favourites, and can comment on what Workie says.',
    get: 'Every answer ranked by the room’s votes, Workie’s read of what the room said, and the comments, all in the report.',
    pace: 'One round is one question: answers, then the vote. You move on when you’re ready.',
    size: 'Any size',
    questions: 'Ready-made, or write your own',
    starts: 'Waits in your Sessions list until you press Start.',
  },
  trivia: {
    short: 'Ask a question with one right answer. Everyone picks A, B, C or D; you reveal the answer and a scoreboard keeps count.',
    col: 'Everyone picks A, B, C or D. You reveal the right one; a scoreboard keeps count.',
    good: 'Socials, warm-ups.',
    group: 'Any size',
    startsShort: 'When you press Start',
    room: 'Picks an answer on their phones. You reveal the right one, and points go on the scoreboard.',
    get: 'A live scoreboard, and which questions the room knew or missed.',
    pace: 'One question at a time; you reveal the answer and move on.',
    size: 'Any size',
    questions: 'Ready-made, or write your own',
    starts: 'Waits in your Sessions list until you press Start.',
  },
  poll: {
    short: 'Ask a quick question: pick one, rate it, yes or no, or a few words. The results fill in live on the big screen.',
    col: 'A quick question. The results fill in live on the big screen. No right answer, no names.',
    good: 'Quick decisions.',
    group: 'Any size',
    startsShort: 'When you press Start',
    room: 'Answers one quick question at a time and watches the result fill in. No right answer, no vote, no names.',
    get: 'Each result filling in live on the main screen.',
    pace: 'Quick: each result shows the moment people answer.',
    size: 'Any size',
    questions: 'Ready-made, or write your own',
    starts: 'Waits in your Sessions list until you press Start.',
  },
  wavelength: {
    short: 'Give the room a subject. Everyone writes the words it brings to mind; a word counts when everyone wrote it.',
    col: 'Everyone writes words for a subject. The words everyone shared light up. No scores.',
    good: 'Small teams, 10 or fewer.',
    group: '10 or fewer',
    startsShort: 'When you press Start',
    room: 'Writes the words a subject brings to mind. The screen shows the words everyone shared, so you see how alike the team thinks.',
    get: 'Where the room already thinks alike, and where it doesn’t.',
    pace: 'One subject at a time; you move on when everyone has answered.',
    size: 'Best with 10 or fewer',
    questions: 'Ready-made, or write your own',
    starts: 'Waits in your Sessions list until you press Start.',
  },
  survey: {
    short: 'Send a short form people fill in on their phones, in their own time. You see the answers added up.',
    col: 'A short form people fill in on their phones, in their own time.',
    good: 'Feedback by form, not live.',
    group: 'Any size',
    startsShort: 'As soon as you create it',
    room: 'Fills in a short form on their phones, whenever suits them.',
    get: 'The answers added up, with names only if you chose that.',
    pace: 'Stays open as long as you like; you close it.',
    size: 'Any size',
    questions: 'Ready-made, or write your own',
    starts: 'Opens to answers the moment you create it. No Start step.',
  },
  [BUILD_KIND]: {
    short: 'Build something with your Claude Code while the room steers: people suggest ideas, pick between options and rate what Claude makes.',
    col: 'Your Claude Code builds; the room suggests ideas, picks options and rates.',
    /* The gallery's quieter row under "Bigger than one session" (round 4). */
    tag: 'with your Claude Code',
    good: 'Software teams.',
    group: 'Any size',
    startsShort: 'On its own page',
    room: 'Suggests ideas, picks between mockups and rates while your Claude Code builds.',
    get: 'Something built, every decision the room made, and a report.',
    pace: 'As long as the build takes; you decide each step.',
    size: 'Any size',
    questions: 'None: Claude writes them as it goes. Needs Claude Code.',
    starts: 'Continues on its own page.',
  },
  [EVENT_KIND]: {
    short: 'Run a whole day behind one join code: an agenda of quizzes, polls, talks and breaks, each with its own report.',
    col: 'A whole day behind one join code: quizzes, polls, talks and breaks.',
    tag: 'a whole day, one join code',
    good: 'Offsites, workshops.',
    group: 'Any size',
    startsShort: 'On its own page',
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
    short: '', col: '', good: '', group: '', startsShort: '', room: '', get: '', pace: '', size: '', questions: '', starts: '',
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
  { id: 'quiz', label: 'Quiz', format: 'trivia', reason: 'One right answer per question: everyone picks, you reveal it, and a scoreboard keeps count.' },
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
  A CACHE OF THOSE TWO VALUES, so the first paint picks gallery or chips
  before the request returns, and whether "How it runs" is hidden. Both are
  per-viewer conveniences whose loss costs one click (README §6), so both live
  in localStorage, wrapped: a private window or blocked storage throws on
  access, and the dialog must work exactly the same without it.
*/
const HISTORY_KEY = 'engage.newEngagement.history';
const HOW_KEY = 'engage.newEngagement.howItRuns';

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

/*
  "HOW IT RUNS", SHOWN OR HIDDEN (README round 3, option A). One layout: the
  storyboard sits beside the form, open by default; its Hide folds it to a
  rail. The choice is per browser; lost or unreadable, the pane simply shows,
  which is the safe default. (Round 2's Guided | Quick switch is retired.)
*/
export function readHowHidden() {
  try {
    return Boolean(storage() && storage().getItem(HOW_KEY) === 'hidden');
  } catch (e) {
    return false;
  }
}

export function writeHowHidden(hidden) {
  try {
    const s = storage();
    if (!s) return;
    if (hidden) s.setItem(HOW_KEY, 'hidden'); else s.removeItem(HOW_KEY);
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
