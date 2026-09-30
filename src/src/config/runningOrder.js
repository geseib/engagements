/**
 * "SET THE RUNNING ORDER" — the way from an event's agenda to an item's
 * running order (QA drive 2026-09-29, finding #4).
 *
 * The running order is the Session panel's Questions tab on the item's own
 * stage (components/stage/SessionSetupPanel.jsx → QueueList). It worked once
 * found, but it was found only by opening the item, opening SESSION, choosing
 * QUESTIONS and scrolling past the category switches. These are the doors:
 *
 *   the builder's row and its Edit dialog   → runningOrderHref(code, item)
 *   the item's preview lobby                → opens the panel in place
 *
 * TWO ADDRESSES, ONE LANDING:
 *   - an item that already has a session (prepared, live or paused) goes
 *     straight to its stage: /host?gameId=<g>&event=<code>&panel=questions
 *   - an item with none yet goes by the event's board with ?order=<itemId>,
 *     and the board prepares it (run.js `prepare`) with the SAME call its
 *     Open uses (EventStage.openItem), then goes on to the address above. The
 *     builder never makes a session itself: one code path makes previews.
 *
 * `panel` is read by GameHostPage once, at load, and only a value it knows
 * does anything — an unknown or absent one leaves the page as it always was.
 */

/** The kinds with questions the host asks one at a time — never a survey. */
export const RUNNING_ORDER_TYPES = Object.freeze(['trivia', 'call-and-answer', 'poll', 'wavelength']);

export const PANEL_PARAM = 'panel';
export const ORDER_PARAM = 'order';
/** The one panel landing there is: the Questions tab, at the running order. */
export const QUESTIONS_PANEL = 'questions';

export const RUNNING_ORDER_LABEL = 'Set the running order';

/** Whether an agenda item of this kind has a running order to set. */
export const hasRunningOrder = (type) => RUNNING_ORDER_TYPES.includes(type);

/**
 * Whether an agenda row offers the door: a question-based engagement, readable,
 * not finished, in an event that has not ended.
 */
export function offersRunningOrder(item, event = null) {
  if (!item || !hasRunningOrder(item.type)) return false;
  if (item.decryptFailed) return false;
  if (item.state === 'done') return false;
  if (event && event.state === 'ENDED') return false;
  return true;
}

/** An item's own stage, optionally landing on a panel. */
export function sessionStagePath(gameId, code, { panel = '' } = {}) {
  const base = `/host?gameId=${encodeURIComponent(gameId)}&event=${encodeURIComponent(code)}`;
  return panel ? `${base}&${PANEL_PARAM}=${encodeURIComponent(panel)}` : base;
}

/** Where "Set the running order" goes for this item. */
export function runningOrderHref(code, item) {
  if (item && item.gameId) return sessionStagePath(item.gameId, code, { panel: QUESTIONS_PANEL });
  return `/host/event/${encodeURIComponent(code)}?${ORDER_PARAM}=${encodeURIComponent((item && item.itemId) || '')}`;
}

/** `?panel=` as the host page reads it: a panel it knows, or ''. */
export function readPanelParam(search) {
  try {
    const value = new URLSearchParams(search || '').get(PANEL_PARAM) || '';
    return value === QUESTIONS_PANEL ? value : '';
  } catch (_) {
    return '';
  }
}

/** `?order=` as the event's board reads it: an item id, or ''. */
export function readOrderParam(search) {
  try {
    return new URLSearchParams(search || '').get(ORDER_PARAM) || '';
  } catch (_) {
    return '';
  }
}

/** Takes one parameter out of the address bar, leaving the rest. */
export function dropParam(name) {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(name)) return;
    url.searchParams.delete(name);
    window.history.replaceState(null, '', url);
  } catch (_) { /* the address is a convenience */ }
}
