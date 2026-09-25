/**
 * THE SCOREBOARD, AS ARITHMETIC. No fetch, no React.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md; the looks are the
 * approved mockups in docs/design/scoreboard-2026-09-25/.
 *
 * Three surfaces hold an opinion about the board and cannot share a runtime:
 * the stage (which draws it), the phone remote (which polls `/state` and
 * `/players`), and the session menu. `scoreboard.js` on the server is the only
 * writer. The rules live here once, the same deal config/stageFocus.js has.
 *
 * ── THE OWNER'S RULINGS (2026-09-25) ──────────────────────────────────────
 *
 *   Trivia and Call & Answer only. Any time once a round is scored, showing
 *   totals as of the last scored round. Names with totals may show — "as long
 *   as scores are not tallied until all votes are in". ▲n / ▼n since the
 *   previous scored round, NEW, –. Auto-flip, and the host can step. Three
 *   looks, switchable.
 *
 * The server's copy of the vocabulary is lambda-functions/game/scoreboard-state.js;
 * tests/scoreboard-route.js fails if SCOREBOARD_STYLES drifts from it.
 */
import { resolveGameType } from './gameTypes';

/** The three looks, in the order V cycles them. The first is the default. */
export const SCOREBOARD_STYLES = ['departure', 'olympic', 'tote'];
export const DEFAULT_STYLE = 'departure';

/** What the host picks between — the mockups' own names. */
export const STYLE_LABELS = {
  departure: 'Departure board',
  olympic: 'Olympic board',
  tote: 'Tote board',
};

/** The remote's page steps, and the server's. */
const STEPS = ['next', 'prev'];

/** A board nobody has opened. A value, never an absence. */
export const CLOSED_SCOREBOARD = Object.freeze({ open: false, style: DEFAULT_STYLE, page: 0, openedAt: null });

/** Whatever a payload says, as a board this build can act on. */
export function normaliseScoreboard(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    open: v.open === true,
    style: SCOREBOARD_STYLES.includes(v.style) ? v.style : DEFAULT_STYLE,
    page: Number.isInteger(v.page) ? v.page : 0,
    openedAt: typeof v.openedAt === 'string' && v.openedAt ? v.openedAt : null,
  };
}

/** The look after this one — what V does. */
export function nextStyle(style) {
  // An unknown look reads as the default (normaliseScoreboard), so V from it
  // goes where V from the default goes.
  const i = Math.max(0, SCOREBOARD_STYLES.indexOf(style));
  return SCOREBOARD_STYLES[(i + 1) % SCOREBOARD_STYLES.length];
}

/* ------------------------------------------------------------ who, when */

const BOARD_TYPES = ['trivia', 'call-and-answer'];

/**
 * Does this session's type have a board? A session with no type predates the
 * field and plays call-and-answer — what every reader defaults it to.
 */
export function hasScoreboard(gameType) {
  return BOARD_TYPES.includes(resolveGameType(gameType || 'call-and-answer'));
}

/** The disabled reason before any round is scored. */
export const NOT_SCORED_YET = 'Scores appear after the first round';

/**
 * Should a control be drawn, may it be pressed, and if not, why not.
 *
 * Other game types get NO control (`show: false`) rather than a dead one —
 * the owner ruled them out, so it is not a state a host can change.
 * Before any round is scored the control is there and disabled, with the
 * reason beside it, because that state ends on its own a round later.
 *
 * `afterRound` is get-players' last fully scored round, or null.
 */
export function scoreboardAvailability({ gameType, afterRound } = {}) {
  if (!hasScoreboard(gameType)) return { show: false, enabled: false, reason: '' };
  if (!Number.isInteger(afterRound) || afterRound < 1) {
    return { show: true, enabled: false, reason: NOT_SCORED_YET };
  }
  return { show: true, enabled: true, reason: '' };
}

/* --------------------------------------------------------------- the rows */

/**
 * Places per page, declared per display profile (spec §1). The board is
 * outside the stage's fitter, so this is where its density is decided: TV
 * and Call get half a Room page because their type ladder is larger (TV) or
 * the encoder is the constraint (Call).
 */
const PLACES_PER_PAGE = { room: 10, table: 10, tv: 5, call: 5 };
export function placesPerPage(profile) {
  return PLACES_PER_PAGE[profile] || PLACES_PER_PAGE.room;
}

const rankSort = (a, b) => (a.rank - b.rank) || a.name.localeCompare(b.name);

/**
 * `GET /players` → the board's rows, in place order.
 *
 * `place` is the printed place: the rank, with `=` in front when somebody
 * else shares it (competition ranking — 1, 2, 3, =4, =4, 6). A roster from
 * an older server with no `rank` falls back to its total order.
 */
export function boardRows(players) {
  const list = Array.isArray(players) ? players : [];
  const rows = list.map((p, i) => ({
    id: String(p.playerId || p.playerName || i),
    name: String(p.playerName || ''),
    total: Number(p.totalScore) || 0,
    rank: Number.isInteger(p.rank) ? p.rank : null,
    movement: p.movement === 'new' ? 'new' : (Number.isInteger(p.movement) ? p.movement : 0),
    previousScore: Number.isFinite(p.previousScore) ? p.previousScore : null,
  }));
  // An older roster: rank by total, the same competition rule.
  for (const r of rows) {
    if (r.rank === null) r.rank = 1 + rows.filter((o) => o.total > r.total).length;
  }
  const counts = new Map();
  rows.forEach((r) => counts.set(r.rank, (counts.get(r.rank) || 0) + 1));
  return rows
    .map((r) => ({ ...r, tied: counts.get(r.rank) > 1, place: `${counts.get(r.rank) > 1 ? '=' : ''}${r.rank}` }))
    .sort(rankSort);
}

/**
 * The running order as it stood after the previous round — what the tote
 * board shows first, before the field rides to its new places. Only players
 * who HAD a place (a previous total); NEW players ride in from below.
 */
export function previousOrder(rows) {
  const had = (rows || []).filter((r) => r.movement !== 'new' && r.previousScore !== null);
  const counts = new Map();
  const prevRank = (r) => 1 + had.filter((o) => o.previousScore > r.previousScore).length;
  had.forEach((r) => counts.set(prevRank(r), (counts.get(prevRank(r)) || 0) + 1));
  return had
    .map((r) => {
      const rank = prevRank(r);
      return { ...r, previousRank: rank, previousPlace: `${counts.get(rank) > 1 ? '=' : ''}${rank}` };
    })
    .sort((a, b) => (a.previousRank - b.previousRank) || a.name.localeCompare(b.name));
}

/** How a movement is written, coloured and read aloud. */
export function movementLabel(movement) {
  if (movement === 'new') return { text: 'NEW', kind: 'new', spoken: 'new' };
  if (Number.isInteger(movement) && movement > 0) return { text: `▲${movement}`, kind: 'up', spoken: `up ${movement}` };
  if (Number.isInteger(movement) && movement < 0) return { text: `▼${-movement}`, kind: 'dn', spoken: `down ${-movement}` };
  return { text: '–', kind: 'eq', spoken: 'no change' };
}

/* ------------------------------------------------------------- paging */

export function pageCount(total, size) {
  return Math.max(1, Math.ceil((Number(total) || 0) / Math.max(1, size)));
}

/** The rows on page `page`, which wraps from either side. */
export function pageRows(rows, page, size) {
  const pages = pageCount(rows.length, size);
  const p = ((page % pages) + pages) % pages;
  return rows.slice(p * size, p * size + size);
}

/** '1–10', '11–14' — the rail's page indicator. */
export function pageRange(page, size, total) {
  if (!total) return '0';
  const pages = pageCount(total, size);
  const p = ((page % pages) + pages) % pages;
  const from = p * size + 1;
  const to = Math.min(total, from + size - 1);
  return `${from}–${to}`;
}

/**
 * How long a page stays up before the auto-flip turns it, from the moment it
 * starts to arrive: the look's own entrance, then the mockups' reading time
 * (3.6s plus 280ms a row). The mockups' pace, per the spec: a new page about
 * every 7–8s, and back on page 1 about 15s after opening on Room.
 *
 * `replay` is the tote board's first visit to a page, which first shows the
 * order after the previous round and then rides the field to its new places.
 */
const SETTLE_MS = { departure: 1500, olympic: 1700, tote: 1200 };
const TOTE_REPLAY_MS = 3400;
export function pageDwellMs(rowsOnPage, style, replay = false) {
  const settle = (SETTLE_MS[style] || SETTLE_MS.departure) + (style === 'tote' && replay ? TOTE_REPLAY_MS : 0);
  return settle + 3600 + (Number(rowsOnPage) || 0) * 280;
}

/* ------------------------------------------------------------- the wire */

/** The body `POST /games/{id}/scoreboard` wants, or null when nothing is sendable. */
export function scoreboardRequest({ open, style, step } = {}) {
  const body = {};
  if (typeof open === 'boolean') body.open = open;
  if (style !== undefined) {
    if (!SCOREBOARD_STYLES.includes(style)) return null;
    body.style = style;
  }
  if (step !== undefined) {
    if (!STEPS.includes(step)) return null;
    body.step = step;
  }
  return Object.keys(body).length ? body : null;
}

/* ------------------------------------------------------------- the keys */

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * What a keypress means to the board, or null when it is not the board's.
 *
 *   S               open / close (always)
 *   → / ←           next / previous page      } only while open
 *   V               the next look             }
 *   Escape, Space   close                     }
 *
 * Space CLOSES AND DOES NOT ADVANCE. While the board is open the page's
 * shortcut gate (utils/hostOverlays.js `shortcutsSuppressed`, scoreboardOpen)
 * takes the advance key away from HostActionBar, so the one press closes the
 * board and nothing else hears it.
 *
 * Never while typing, never inside the session menu (`.setup-panel`, the
 * guard HostActionBar carries for the same reason), never with a modifier,
 * and never on auto-repeat — a held S would flap the board open and shut.
 */
export function scoreboardKeyIntent(event, { open = false } = {}) {
  if (!event) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const target = event.target;
  if (target && (TYPING_TAGS.has(target.tagName) || target.isContentEditable)) return null;
  if (target && typeof target.closest === 'function' && target.closest('.setup-panel')) return null;

  const k = event.key;
  if (k === 's' || k === 'S') return event.repeat ? null : 'toggle';
  if (!open) return null;
  if (k === 'ArrowRight') return 'next';
  if (k === 'ArrowLeft') return 'prev';
  if (k === 'v' || k === 'V') return event.repeat ? null : 'style';
  if (k === 'Escape' || k === ' ' || k === 'Spacebar') return 'close';
  return null;
}
