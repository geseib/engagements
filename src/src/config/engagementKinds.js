/**
 * EVERY KIND OF ENGAGEMENT, AS A LIST OF SESSIONS NAMES IT (2026-10-04).
 *
 * The owner: "why are these not treated as other types of engagements that i
 * can see listed in sessions, and reports, etc." — and, decided the same day,
 * an event is ONE row in every list, labelled Event with its item count;
 * opening it shows its agenda items, each linking to that item's own session
 * and report; an item's session is never listed a second time. A Build Room is
 * one row, labelled Build Room.
 *
 * GET /games and GET /reports already do the filing (game/get-games-list.js,
 * game/get-reports.js): events come back beside the sessions or reports, and
 * the item sessions sit under their items. This file is the one place the
 * screens turn that into rows and words:
 *
 *   - `kindOf(row)`     'event' | 'build' | a config/gameTypes.js id | ''
 *   - `kindLabel(kind)` Event / Build Room / Trivia / … / '—' when unknown
 *   - `kindIcon(kind)`  a Phosphor name for components/Icon.jsx
 *   - `typeOptions`     the Type filter's options, in a fixed order
 *   - `mergeSessions`   GET /games → one list of rows, newest first
 *   - `groupReports`    GET /reports → report rows and event rows
 *   - `itemKindLabel`   an agenda item's kind in words (Talk, Break, …)
 *
 * Build Room is deliberately NOT a config/gameTypes.js type (Build Room PLAN
 * §4) and an event is not a session, so both are named here rather than
 * widening that registry, which feeds the set pickers.
 */
import { resolveGameType, gameTypeLabel, gameTypeMeta, GAME_TYPE_LIST } from './gameTypes';
import { BUILD_GAME_TYPE, BUILD_LABEL } from '../buildroom/buildHostApi';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';

export const EVENT_KIND = 'event';
export const BUILD_KIND = BUILD_GAME_TYPE;
export const EVENT_LABEL = 'Event';

/** What kind of engagement a list row is. '' when nothing says. */
export function kindOf(row) {
  if (!row) return '';
  if (row.kind === EVENT_KIND || row.gameType === EVENT_KIND) return EVENT_KIND;
  if (row.gameType === BUILD_KIND) return BUILD_KIND;
  return resolveGameType(row.gameType) || '';
}

export const isEventRow = (row) => kindOf(row) === EVENT_KIND;

/** The kind in words, for a chip or a filter option. */
export function kindLabel(kind) {
  if (kind === EVENT_KIND) return EVENT_LABEL;
  if (kind === BUILD_KIND) return BUILD_LABEL;
  return kind ? gameTypeLabel(kind) : '—';
}

/** A Phosphor icon name for the kind (components/Icon.jsx). */
export function kindIcon(kind) {
  if (kind === EVENT_KIND) return 'CalendarBlank';
  if (kind === BUILD_KIND) return 'Wrench';
  return kind ? gameTypeMeta(kind).icon : 'Circle';
}

/**
 * THE TYPE FILTER'S OPTIONS: All, every format, Build Room, and Event while
 * events are in the list (GET /games answers none while EVENTS_ENABLED is off
 * for the tier, so the option is absent exactly when the switch is).
 */
export function typeOptions(rows) {
  const withEvents = (rows || []).some(isEventRow);
  return [
    { value: 'all', label: 'All types' },
    ...GAME_TYPE_LIST.map((t) => ({ value: t.id, label: t.label })),
    { value: BUILD_KIND, label: BUILD_LABEL },
    ...(withEvents ? [{ value: EVENT_KIND, label: EVENT_LABEL }] : []),
  ];
}

/** Every item title of an event, for search. */
export function itemTitles(row) {
  return ((row && row.items) || []).map((i) => i && i.title).filter(Boolean);
}

/**
 * GET /games's two arrays as one list of rows, newest first. An event row is
 * dated by its creation, else its day.
 */
export function mergeSessions(data) {
  const games = Array.isArray(data && data.games) ? data.games : [];
  const events = Array.isArray(data && data.events) ? data.events : [];
  const when = (row) => new Date(row.createdAt || row.startsAt || 0).getTime() || 0;
  return [...games, ...events.map((e) => ({ ...e, kind: EVENT_KIND }))]
    .sort((a, b) => when(b) - when(a));
}

/**
 * GET /reports as rows: every report that is not an event item's, and ONE row
 * per event, its items each carrying their report (or null). A report whose
 * event is no longer listed (gone, or the switch is off) is still one row of
 * its own, never two and never none.
 */
export function groupReports(data) {
  const reports = Array.isArray(data && data.reports) ? data.reports : [];
  const events = Array.isArray(data && data.events) ? data.events : [];
  const listed = new Map(events.map((e) => [String(e.code), e]));
  const byId = new Map(reports.map((r) => [r.id, r]));
  const rows = reports.filter((r) => !(r.eventRef && listed.has(String(r.eventRef))));
  for (const e of events) {
    const items = (e.items || []).map((item) => ({ ...item, report: item.reportId ? byId.get(item.reportId) || null : null }));
    const saved = items.map((i) => i.report).filter(Boolean);
    const latest = saved.map((r) => r.savedAt).filter(Boolean).sort().pop() || null;
    // The first of its reports to go: what "Kept until" warns about.
    const soonest = saved.map((r) => r.expiresAt).filter(Boolean).sort()[0] || null;
    rows.push({
      ...e,
      kind: EVENT_KIND,
      id: `EVENT#${e.code}`,
      gameId: e.code,
      gameType: EVENT_KIND,
      items,
      reportCount: saved.length,
      savedAt: latest,
      expiresAt: soonest,
    });
  }
  return rows;
}

/** An agenda item's kind in words: the format, or Presentation / Activity / Break. */
export function itemKindLabel(type) {
  return rules.TYPE_LABELS[type] || kindLabel(resolveGameType(type) || '');
}

const ITEM_STATES = Object.freeze({
  planned: 'Planned', live: 'Live', paused: 'Paused', done: 'Done',
});
/** An agenda item's state in words. */
export const itemStateLabel = (state) => ITEM_STATES[state] || ITEM_STATES.planned;

/** An event's state in the State column's words. */
export function eventStateLabel(row) {
  if (row && row.state === 'LIVE') return 'Running';
  if (row && row.state === 'ENDED') return 'Ended';
  return row && row.started ? 'Played' : 'Not started';
}

/** "3 items" — the count the owner asked every list to show. */
export const itemCountText = (n) => `${Number(n) || 0} item${Number(n) === 1 ? '' : 's'}`;

/** Where things live, so every screen links the same way. */
export const eventStagePath = (code) => `/host/event/${encodeURIComponent(code)}`;
export const eventAgendaPath = (code) => `/host/event/${encodeURIComponent(code)}/agenda`;
export const eventJoinPath = (code) => `/play?event=${encodeURIComponent(code)}`;
export const itemSessionPath = (gameId, code) => `/host?gameId=${encodeURIComponent(gameId)}&event=${encodeURIComponent(code)}`;
