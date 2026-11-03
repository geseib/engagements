/**
 * AN EVENT'S ITEM IN THE CONSOLE (docs/design/experience-plan/PLAN.md §3.2a
 * "Event item" column, §3.2b, §3.6 Agenda, §4.2 row 13, §7 decision 8;
 * Phase 2 step 2d).
 *
 * An event's Call & Answer item on two screens gets the same console as a
 * standalone session. What the event adds, and nothing else:
 *
 *   the steps strip    "‹ Agenda" as its first crumb (never on the top bar)
 *   the Session menu   Agenda, and Bring everyone here when the room is elsewhere
 *   the Needs-you line "The event moved on to Item N" (Now), Bring everyone here
 *   People             a latecomer's doing-now reads "from item N"
 *   Setup              screens are set once per event day: a later item that
 *                      day opens at step 3, without asking again
 *
 * Pure, so a test reaches every rule without the host page. The page passes
 * what it already reads from GET /events/{code}.
 */

export const EVENT_WORDS = Object.freeze({
  agenda: 'Agenda',
  // The crumb's visible text; its accessible name is the plain word.
  agendaCrumb: '‹ Agenda',
  agendaHint: 'Back to the event\'s agenda. The phones stay where they are.',
  bringHere: 'Bring everyone here',
  bringHereHint: 'Move the room\'s phones to this item.',
  // Your part now at Setup's step 3 while the room is elsewhere.
  bringAfter: ' when you are ready: the phones move to this item.',
  movedOn: (n) => `The event moved on to Item ${n}`,
  movedOnKind: 'The event moved on',
  fromItem: (n) => `from item ${n}`,
  menuK: 'This event',
});

/** An item's place on the agenda, 1-based, or null. */
export function itemNumber(items, itemId) {
  const i = (items || []).findIndex((it) => it && it.itemId === itemId);
  return i >= 0 ? i + 1 : null;
}

/**
 * THE EVENT MOVED ON (PLAN §4.2 row 13): this item was the room's and another
 * one is live now. `{ n, title }` for the live item, or null.
 *
 * Only a PAUSED item counts: a planned item is the host previewing (its own
 * primary is already Bring everyone here), a done item has nothing left to
 * bring anyone back to, and a paused item with nothing live elsewhere is the
 * host's own pause, not the event moving on.
 */
export function eventMovedOn({ item = null, items = [], liveItemId = '' } = {}) {
  if (!item || item.state !== 'paused' || !liveItemId || liveItemId === item.itemId) return null;
  const n = itemNumber(items, liveItemId);
  if (!n) return null;
  const live = items[n - 1];
  return { n, title: (live && live.title) || '' };
}

/** How long after an item first went live a join still counts as arriving with it. */
export const ARRIVAL_GRACE_MS = 60 * 1000;

const msOf = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A LATECOMER'S "from item N" (PLAN §3.2b): the people of this item who
 * joined it after it first went live (plus a minute's grace for the phones
 * that follow the agenda in by themselves). Everyone who came across from the
 * item before arrived with it and carries no fact. A map name → words.
 */
export function latecomersFrom({ players = [], item = null, n = null } = {}) {
  const out = {};
  const since = msOf(item && item.startedAt);
  if (since === null || !n) return out;
  (players || []).forEach((p) => {
    const name = p && (p.name || p.playerName);
    const at = msOf(p && (p.joinedAt || p.JoinedAt));
    if (name && at !== null && at > since + ARRIVAL_GRACE_MS) out[name] = EVENT_WORDS.fromItem(n);
  });
  return out;
}

/* ------------------------------------------------ screens, once per event day */

const SCREENS_KEY = (code) => `engage.eventScreens.${code}`;

/** This laptop's local calendar day, as YYYY-MM-DD. */
export function dayOf(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** True when this browser set the screens up for this event today (PLAN §7 decision 8). */
export function eventScreensSet(storage, code, nowMs = Date.now()) {
  if (!code) return false;
  try {
    return Boolean(storage) && storage.getItem(SCREENS_KEY(code)) === dayOf(nowMs);
  } catch (e) {
    return false;
  }
}

/** Remember that the screens are set for this event today. */
export function markEventScreens(storage, code, nowMs = Date.now()) {
  if (!code || !storage) return;
  try { storage.setItem(SCREENS_KEY(code), dayOf(nowMs)); } catch (e) { /* private mode: this visit only */ }
}
