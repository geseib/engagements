/**
 * HOW AN EVENT'S ITEMS READ ON THE ATTENDEE'S PAGE AND ON THE STAGE (events
 * M2–M4). Pure: no fetch, no DOM. The rules themselves — kinds, labels, times
 * — are lambda-functions/websocket/events/agenda-rules.js, read here as the
 * console's builder reads them, so the phone, the wall and the builder cannot
 * disagree about what an item is called or when it starts.
 */
import rules from '../../../../lambda-functions/websocket/events/agenda-rules';

/** One Phosphor glyph per kind; the builder's own map (EventBuilder.jsx). */
export const TYPE_ICONS = Object.freeze({
  trivia: 'Brain',
  'call-and-answer': 'ChatCircleText',
  poll: 'ChartBar',
  wavelength: 'Waves',
  survey: 'ListChecks',
  presentation: 'Monitor',
  custom: 'UsersThree',
  break: 'Clock',
});

export const typeLabel = (type) => rules.TYPE_LABELS[type] || '';
export const isEngagement = (type) => rules.isEngagement(type);
export const isBreak = (type) => type === rules.BREAK;

/** "Presentation · Dana Whitfield", "Trivia", or for a break "Back at 10:28". */
export function typeLine(item, { returnAt } = {}) {
  if (!item) return '';
  if (isBreak(item.type)) return `Back at ${returnAt || item.until || ''}`.trim();
  const label = typeLabel(item.type);
  return item.ledBy ? `${label} · ${item.ledBy}` : label;
}

/**
 * "3 of 8" — an item's place among the COUNTED items (decision 7: a break has
 * no number). Null for a break or an item not in the list.
 */
export function positionOf(items, itemId) {
  const counted = (items || []).filter((i) => !isBreak(i.type));
  const at = counted.findIndex((i) => i.itemId === itemId);
  return at < 0 ? null : { n: at + 1, of: counted.length };
}

/**
 * A moment (ISO) as the agenda prints times: the event's own wall clock,
 * 24-hour, no leading zero ("9:05", "10:28") — agenda-rules.clock's shape.
 * '' when it cannot be read.
 */
export function wallClock(iso, timeZone) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone: timeZone || undefined,
    }).formatToParts(new Date(t));
    const hour = Number((parts.find((p) => p.type === 'hour') || {}).value);
    const minute = (parts.find((p) => p.type === 'minute') || {}).value || '00';
    return Number.isFinite(hour) ? `${hour}:${minute}` : '';
  } catch (_) {
    return '';
  }
}

/** The item after `itemId` that has not happened yet, or null. */
export function nextAfter(items, itemId) {
  const list = items || [];
  const at = list.findIndex((i) => i.itemId === itemId);
  return list.slice(at + 1).find((i) => (i.state || 'planned') === 'planned') || null;
}

/** The first planned item — what the host is likely to start next — or null. */
export const firstPlanned = (items) => (items || []).find((i) => (i.state || 'planned') === 'planned') || null;

/**
 * The word an agenda row carries for its state — said in a WORD, never by
 * tint alone (agenda-phone.css). `null` when the row says nothing.
 *   done → Done · live → Now · paused → Paused
 *   planned, before anything has started → Not started
 *   planned, the next one once the day is under way → Next
 */
export function stateWord(item, { started, nextId }) {
  const state = (item && item.state) || 'planned';
  if (state === 'done') return { word: 'Done', tone: 'done' };
  if (state === 'live') return { word: 'Now', tone: 'now' };
  if (state === 'paused') return { word: 'Paused', tone: 'paused' };
  if (isBreak(item.type)) return null;
  if (!started) return { word: 'Not started', tone: 'planned' };
  if (item.itemId === nextId) return { word: 'Next', tone: 'next' };
  return null;
}

export { rules };
