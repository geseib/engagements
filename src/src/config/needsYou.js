/**
 * NEEDS YOU — the one list of things waiting on the host
 * (docs/design/experience-plan/PLAN.md §2 principle 1, §4).
 *
 * WORKED OUT, NEVER STORED. Every item is derived from the session's own
 * state — the roster's handover flags, the late list's count, the read's
 * failure and check, the host's socket — so it is right after a reload or a
 * reconnect, the laptop and the phone Remote agree (both call this function
 * with what they already read), and an item clears itself the moment its
 * cause does, whichever device answered it (PLAN §4.1).
 *
 * LEVELS (PLAN §4.1): `now` — someone is waiting, or something broke with the
 * room watching; it counts on the bell and turns the Needs-you line amber.
 * `soon` — review when there is a gap; a dot on the bell, a calm mention on
 * the line. Glance and Account never enter this list.
 *
 * EVERY ITEM CARRIES TWO SENTENCES: `text`, named, for a private screen; and
 * `kindText`, by kind and never a name, for a screen the room can see
 * (principle 3: "count only" — "A name request", "2 late answers").
 *
 * The events covered are PLAN §4.2 rows 1/16, 2, 3, 4, 5 and 7 — the ones whose
 * data the host page already holds. Rows 8 (room's window) and 13 (the event
 * moved on) keep their own top-line and dock signals until Phase 2 gives them
 * a slot; row 14 (Build Room) has its own queue.
 */

/* The lapse and the two readings live in setupPanel.js, which the roster
   rows already use and which must stay import-free (tests/question-queue-order.js
   evaluates it verbatim). Re-exported here so every reader has one door. */
import { REQUEST_LAPSE_MS, askingNow, openNow } from './setupPanel';

export { REQUEST_LAPSE_MS, askingNow, openNow };

export const NEEDS_LEVELS = Object.freeze({ NOW: 'now', SOON: 'soon' });

/* The action ids an item may carry. The page maps each to its handler. */
export const NEEDS_ACTIONS = Object.freeze({
  LET: 'let',
  NOT_NOW: 'notnow',
  SEE: 'see',
  LOCK: 'lock',
  REVIEW: 'review',
  RETRY: 'retry',
  REDO: 'redo',
  FINE: 'fine',
});

/** The words on each action's button (PLAN §3.6, §4.2). */
export const ACTION_WORDS = Object.freeze({
  let: 'Let them',
  letArmed: 'Let them anyway',
  notnow: 'Not now',
  see: 'See in People',
  lock: 'Lock again',
  review: 'Review',
  retry: 'Retry',
  redo: 'Redo',
  fine: "It's fine",
});

export const NEEDS_WORDS = Object.freeze({
  title: 'Needs you',
  calm: 'Nothing needs you now.',
  roomCanSee: 'The room can see this screen',
  showHere: 'Show on this screen',
  roomWillSee: 'The room will see this. Show it?',
  showIt: 'Show it',
  cancel: 'Cancel',
  hide: 'Hide',
  onPhone: 'on your phone',
  openOnPhone: 'Open on your phone',
  waitingOnPhone: 'Waiting on your phone, named, with its buttons.',
  connectPhone: 'Connect your phone',
  open: 'Open',
  thisSession: 'This session',
  yourAccount: 'Your account',
});

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Epoch ms of an ISO string, or NaN. */
function msOf(iso) {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/** The handover flags a roster row carries (get-players publicHandoverState). */
function handoverOf(player) {
  return (player && player.handover) || {};
}

/**
 * THE SOCKET FRAME, APPLIED AT ONCE (1a: "no reload-only"). `handoverRequested`
 * names the person; the roster refetch that follows is the authority, but the
 * flag goes on the row in the same render so the Needs-you line turns amber
 * before the network answers. A name not in the roster is left alone (the
 * refetch will bring it).
 */
export function markHandoverRequested(players, name, at = new Date().toISOString(), expiresAt = null) {
  if (!name || !Array.isArray(players)) return players;
  let hit = false;
  const next = players.map((p) => {
    const n = p && (p.name || p.playerName);
    if (n !== name) return p;
    hit = true;
    const h = handoverOf(p);
    return { ...p, handover: { ...h, requested: true, open: false, requestLapsed: false, requestedAt: at, requestExpiresAt: expiresAt || h.requestExpiresAt || null } };
  });
  return hit ? next : players;
}

/** "0:20 ago", "4 min ago". */
export function agoText(iso, now = Date.now()) {
  const at = msOf(iso);
  if (!Number.isFinite(at)) return '';
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `0:${String(s).padStart(2, '0')} ago`;
  return `${Math.floor(s / 60)} min ago`;
}

/** "4:10 left" from epoch seconds. */
export function leftText(expiresAtSec, now = Date.now()) {
  const exp = Number(expiresAtSec);
  if (!Number.isFinite(exp)) return '';
  const s = Math.max(0, Math.floor(exp - now / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`;
}

function lateText({ notReviewed = 0, answers = 0 } = {}) {
  const others = Math.max(0, notReviewed - answers);
  if (!answers) return others === 1 ? '1 late comment to review' : `${others} late comments to review`;
  if (!others) return answers === 1 ? '1 late answer to review' : `${answers} late answers to review`;
  return `${notReviewed} arrived late: ${plural(answers, 'answer', 'answers')}, ${plural(others, 'comment', 'comments')}`;
}

/**
 * THE LIST. Inputs are what the host page (or the Remote) already holds:
 *
 *   players       roster rows (`handover`, `name`/`playerName`, `deviceConnected`:
 *                 a page is open under the name; never `isConnected`, which
 *                 is set at join and never cleared)
 *   late          lateStatusOf(...): { notReviewed, answers }
 *   readFailure   the page's aiSummaryFailure ({ headline, detail }) or null
 *   readCheck     the read check's note text ('' when nothing to check)
 *   readRound     the round the read belongs to (keys the read items)
 *   connected     the host's socket (false only once it had connected)
 *   dismissed     ids the host has said "It's fine" to
 *   now           ms, for lapse and countdowns
 *
 * Returns { items, nowCount, soonCount, top }: Now items first (the
 * connection, then name requests newest first, then a failed read), then
 * Soon items. `top` is what the Needs-you line shows.
 */
export function needsYou({
  players = [], late = null, readFailure = null, readCheck = '', readRound = null,
  connected = true, dismissed = [], now = Date.now(),
} = {}) {
  const gone = new Set(dismissed || []);
  const nowItems = [];
  const soonItems = [];

  if (connected === false) {
    nowItems.push({
      id: 'offline',
      kind: 'offline',
      level: NEEDS_LEVELS.NOW,
      text: 'Not hearing the room · Reconnecting',
      kindText: 'Not hearing the room · Reconnecting',
      actions: [],
    });
  }

  const asking = [];
  (players || []).forEach((p) => {
    const name = p && (p.name || p.playerName);
    if (!name) return;
    const h = handoverOf(p);
    if (askingNow(h, now)) {
      asking.push({
        id: `name:${name}`,
        kind: 'name-request',
        level: NEEDS_LEVELS.NOW,
        name,
        text: `${name} wants their name on a new device`,
        at: h.requestedAt || null,
        /* WHILE THE FIRST DEVICE IS STILL ANSWERING a second "Sam" is more
           likely someone else, so Let them arms in place: a second press
           within six seconds goes ahead (PLAN §4.4; host standards §3). */
        armLet: p.deviceConnected === true,
        detail: [
          agoText(h.requestedAt, now) ? `Asked ${agoText(h.requestedAt, now)}` : '',
          p.deviceConnected === true ? `${name} is still answering on their first device`
            : (p.deviceConnected === false ? `${name}'s first device is away` : ''),
        ].filter(Boolean).join(' · '),
        kindText: 'A name request',
        actions: [NEEDS_ACTIONS.LET, NEEDS_ACTIONS.NOT_NOW, NEEDS_ACTIONS.SEE],
      });
    } else if (openNow(h, now)) {
      const left = leftText(h.expiresAt, now);
      soonItems.push({
        id: `open:${name}`,
        kind: 'name-open',
        level: NEEDS_LEVELS.SOON,
        name,
        text: h.requested
          ? `Waiting for ${name}'s new device${left ? ` · ${left}` : ''}`
          : `${name}'s name is open for a new device${left ? ` · ${left}` : ''}`,
        kindText: 'A name open for a new device',
        actions: [NEEDS_ACTIONS.LOCK],
      });
    }
  });
  // Newest first: "Ask again" moves a request back to the top (PLAN §4.4).
  asking.sort((a, b) => (msOf(b.at) || 0) - (msOf(a.at) || 0));
  nowItems.push(...asking);

  if (readFailure) {
    nowItems.push({
      id: `read-failed:${readRound || ''}`,
      kind: 'read-failed',
      level: NEEDS_LEVELS.NOW,
      text: "Workie's read didn't arrive",
      detail: readFailure.headline || '',
      kindText: "Workie's read didn't arrive",
      actions: [NEEDS_ACTIONS.RETRY, NEEDS_ACTIONS.REDO],
    });
  }

  const lateN = late ? Number(late.notReviewed) || 0 : 0;
  if (lateN > 0) {
    const t = lateText(late);
    soonItems.push({
      id: 'late',
      kind: 'late',
      level: NEEDS_LEVELS.SOON,
      count: lateN,
      text: t,
      kindText: t,
      actions: [NEEDS_ACTIONS.REVIEW],
    });
  }

  const checkId = `read-check:${readRound || ''}`;
  if (readCheck && !readFailure && !gone.has(checkId)) {
    soonItems.push({
      id: checkId,
      kind: 'read-check',
      level: NEEDS_LEVELS.SOON,
      text: readRound ? `Check Workie's read for round ${Number(readRound) || readRound}` : "Check Workie's read",
      detail: readCheck,
      kindText: "Workie's read to check",
      actions: [NEEDS_ACTIONS.REDO, NEEDS_ACTIONS.FINE],
    });
  }

  const items = nowItems.concat(soonItems).filter((it) => !gone.has(it.id));
  const nowCount = items.filter((it) => it.level === NEEDS_LEVELS.NOW).length;
  const soonCount = items.length - nowCount;
  return { items, nowCount, soonCount, top: items[0] || null };
}

/**
 * THE PUBLIC-SAFE LINE for a screen the room can see (PLAN §3.3): a count by
 * kind, never a name. "1 name request", "2 late answers to review". With the
 * phone Remote connected it adds "· on your phone".
 */
export function kindSummary(needs, { remoteConnected = false } = {}) {
  const items = (needs && needs.items) || [];
  if (!items.length) return NEEDS_WORDS.calm;
  const names = items.filter((i) => i.kind === 'name-request').length;
  const parts = [];
  if (names) parts.push(plural(names, 'name request', 'name requests'));
  items.filter((i) => i.kind !== 'name-request').forEach((i) => parts.push(i.kindText));
  const line = parts.join(' · ');
  return remoteConnected ? `${line} · ${NEEDS_WORDS.onPhone}` : line;
}

/** A name for each item kind, for the one-screen sheet ("A name request"). */
export function kindLabel(item) {
  return item ? item.kindText : '';
}
