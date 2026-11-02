/**
 * ONE SESSIONS LIST, TWO FRAMES (experience plan Phase 4a/4b, §3.1).
 *
 * The host met their sessions in two lists built twice: the start screen's
 * "Your sessions" (SessionHistoryPanel, `.shist`) with Edit, Start, Continue,
 * Report, Results, Link and Invite, and the console's Sessions place
 * (SessionsPanel, `.sp`) with Delete and little else (audit E §1.3 L1, §1.9).
 * Reports already shared one list in both places; this is that pattern for
 * sessions. Every row of either list now asks THIS module which actions it
 * offers, so "available from both places" is one function, not a promise.
 *
 * A row is one shape everywhere: title, format, set, status, date, and its
 * actions as ONE primary button plus a ⋯ menu holding the rest. What an
 * action DOES may differ by frame (the console hands Start to the host page
 * through a URL; the start screen calls it directly), which list offers it
 * may not.
 */
import { isEventRow } from './engagementKinds';
import { BUILD_GAME_TYPE } from '../buildroom/buildHostApi';

/** What the console is called, everywhere it is linked (PLAN §3.1, 4b). */
export const LIBRARY_NAME = 'Library & team';
/** The console's Sessions place: "See all" on Home opens it in place. */
export const LIBRARY_SESSIONS_PATH = '/admin?section=games';
/** Home. The brand mark goes here when somebody is signed in (audit E S3). */
export const HOME_PATH = '/';

/** How many of the newest sessions Home shows (PLAN §6 4b). */
export const RECENT_COUNT = 5;

/**
 * Every row action, in its words. `results` is "Survey results", never a bare
 * "Results" (PLAN §3.6: Results is said Reports when it means a report).
 */
export const ROW_ACTION_WORDS = Object.freeze({
  start: 'Start',
  edit: 'Edit',
  continue: 'Continue',
  open: 'Open',
  report: 'Report',
  results: 'Survey results',
  invite: 'Invite…',
  link: 'Copy join link',
  delete: 'Delete…',
  agenda: 'Edit the agenda',
});

export const ROW_ACTION_ICONS = Object.freeze({
  start: 'PlayCircle',
  edit: 'PencilSimple',
  continue: 'Play',
  open: 'Play',
  report: 'ChartBar',
  results: 'ChartBar',
  invite: 'ClipboardText',
  link: 'LinkSimple',
  delete: 'Trash',
  agenda: 'PencilSimple',
});

const isBuild = (row) => Boolean(row) && row.gameType === BUILD_GAME_TYPE;

/** May this caller delete the row? GET /games says, per row (`deleteAs`); '' is "no". */
export const canDelete = (row) => Boolean(row) && row.deleteAs !== '';

/**
 * THE ROW'S ACTIONS: `{ primary, menu }`, ids from ROW_ACTION_WORDS.
 *
 *   not started   Start            · Edit, Invite, Copy join link, Delete
 *   running       Continue         · Report, Invite, Copy join link, Delete
 *   ended         Report           · Continue, Invite, Copy join link, Delete
 *   closed survey Survey results   · Report, Continue, Invite, Copy join link, Delete
 *   Build Room    Continue         · Report, Copy join link, Delete
 *   event         Open (its stage) · Edit the agenda, Copy join link, Delete
 *
 * Start is the primary on a row nobody has joined: it is the next thing a
 * host does there (experience plan 2b), and its label says how the room will
 * watch. Edit stays one press away in the menu, and the session's Setup keeps
 * an Edit too.
 */
export function sessionActions(row) {
  if (!row) return { primary: null, menu: [] };
  const del = canDelete(row) ? ['delete'] : [];
  if (isEventRow(row)) {
    return { primary: 'open', menu: ['agenda', 'link', ...del] };
  }
  if (isBuild(row)) {
    return { primary: 'continue', menu: ['report', 'link', ...del] };
  }
  if (!row.started) {
    return { primary: 'start', menu: ['edit', 'invite', 'link', ...del] };
  }
  if (row.gameType === 'survey' && row.surveyClosed) {
    return { primary: 'results', menu: ['report', 'continue', 'invite', 'link', ...del] };
  }
  if (row.ended === true) {
    return { primary: 'report', menu: ['continue', 'invite', 'link', ...del] };
  }
  return { primary: 'continue', menu: ['report', 'invite', 'link', ...del] };
}

/** Every action a row offers, primary first. */
export const allActions = (row) => {
  const { primary, menu } = sessionActions(row);
  return [primary, ...menu].filter(Boolean);
};

/**
 * AN EVENT ITEM'S SESSION, one step in under its event. Continue on the stage
 * inside the event, and its report once played. An item whose session has
 * expired offers nothing: it says so (`expired`), and its event's agenda is
 * where it can be run again.
 */
export function itemActions(item) {
  if (!item) return { primary: null, menu: [], expired: false };
  if (item.sessionGone) return { primary: null, menu: [], expired: true };
  const s = item.session;
  if (!s) return { primary: null, menu: [], expired: false };
  return { primary: 'continue', menu: s.started ? ['report'] : [], expired: false };
}

/** A session's state, in words: never a colour alone. */
export function statusOf(row) {
  if (!row) return { word: '—', on: false };
  if (isEventRow(row)) {
    if (row.state === 'LIVE') return { word: 'Running', on: true };
    if (row.state === 'ENDED') return { word: 'Ended', on: false };
    return { word: row.started ? 'Played' : 'Not started', on: Boolean(row.started) };
  }
  if (!row.started) return { word: 'Not started', on: false };
  if (row.gameType === 'survey' && row.surveyClosed) return { word: 'Closed', on: false };
  if (row.ended === true) return { word: 'Ended', on: false };
  if (row.ended === false) return { word: 'Running', on: true };
  return { word: 'Played', on: true };
}

/** The one date a row shows: when it last ran, else when it was made. */
export const rowDate = (row) => (row && (row.lastPlayedAt || row.createdAt)) || null;

const REJOIN_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * CAN THE HOST GO BACK INTO IT? Home's Rejoin: a session this host made, that
 * has started and not ended, touched in the last day. A session whose end was
 * never read (`ended` absent) is not offered: a guess would put last week's
 * session under "Rejoin". Events have their own section on Home.
 */
export function isRejoinable(row, now = Date.now()) {
  if (!row || isEventRow(row) || !row.started || row.ended !== false) return false;
  if (row.byMe === false) return false;
  if (row.gameType === 'survey' && row.surveyClosed) return false;
  const at = new Date(rowDate(row) || 0).getTime();
  return Number.isFinite(at) && now - at <= REJOIN_WINDOW_MS;
}

/** Newest first: the order both lists open in. */
export function newestFirst(rows) {
  return [...(rows || [])].sort(
    (a, b) => new Date(b.createdAt || b.startsAt || 0) - new Date(a.createdAt || a.startsAt || 0),
  );
}

/** Home's recent sessions: the newest few, events left to their own section. */
export function recentSessions(rows, count = RECENT_COUNT) {
  return newestFirst(rows).filter((r) => !isEventRow(r)).slice(0, count);
}

/** The set's name where the list knows it, else its id. */
export function setNameOf(row, questionSets = []) {
  if (!row || !row.questionSetId) return '';
  const set = (questionSets || []).find((s) => s && s.id === row.questionSetId);
  return (set && set.name) || row.questionSetId;
}

/** What InviteDialog needs for a row, in either frame. */
export function inviteTargetFor(row, questionSets = []) {
  return {
    gameId: row.gameId,
    title: row.title || row.eventTitle,
    gameType: row.gameType,
    setName: setNameOf(row, questionSets) || undefined,
    /* null, not [] — a list row carries no category data, and [] would print
       "All categories" onto an invite nobody checked. */
    categories: null,
    createdAt: row.createdAt,
  };
}

/**
 * THE CONSOLE HANDS A SESSION TO THE HOST PAGE BY URL. `/admin` is a page of
 * its own (App.jsx routes on pathname), so Start, Edit, Report and Survey
 * results from Library & team open the host page with the session and the
 * action named, and the host page runs it once and clears the URL.
 */
export const SESSION_INTENTS = Object.freeze(['start', 'edit', 'report', 'results']);
export const INTENT_PARAM = 'do';
export const INTENT_SESSION_PARAM = 'session';

export function sessionIntentPath(gameId, action) {
  return `/host?${INTENT_SESSION_PARAM}=${encodeURIComponent(gameId)}&${INTENT_PARAM}=${encodeURIComponent(action)}`;
}

/** `{ gameId, action }` when the URL asks for one, else null. */
export function readSessionIntent(search) {
  const p = new URLSearchParams(search || '');
  const gameId = (p.get(INTENT_SESSION_PARAM) || '').trim();
  const action = p.get(INTENT_PARAM) || '';
  if (!/^\d{4}$/.test(gameId) || !SESSION_INTENTS.includes(action)) return null;
  return { gameId, action };
}

/** Where the host page's Continue lands for a session. */
export const continuePath = (gameId) => `/host?gameId=${encodeURIComponent(gameId)}`;
