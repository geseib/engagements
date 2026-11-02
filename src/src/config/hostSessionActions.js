/**
 * THE HOST PAGE'S ROW HANDLERS, written once (experience plan 4a/4b).
 *
 * Two lists on the host side use SessionList — Home's Rejoin and recent rows
 * (WelcomeScreen) and the full "Your sessions" dialog (SessionHistoryPanel) —
 * and both take the page's callbacks in the shape GameHostPage has always
 * passed them: `(gameId, title)`. This turns those callbacks into the list's
 * `on` object, so the two can never wire an action differently.
 *
 * START OPENS THE ROOM'S WINDOW IN ITS OWN CLICK (session-start D2, F5;
 * experience plan 2b): with "two screens" remembered, a Call & Answer row's
 * Start opens a blank window synchronously and hands it to onStart as its
 * third argument, `{ pending, blocked }`.
 */
import { openPendingRoomWindow } from '../present/roomWindow';
import { START_WORDS, startModeFor } from './sessionStart';
import { isEventRow, eventStagePath, eventAgendaPath, itemSessionPath } from './engagementKinds';
import { isBuildSession, buildRoomPath, buildReportPath } from '../buildroom/buildHostApi';

const titleOf = (row) => row.title || row.eventTitle || 'Untitled session';

/** Start, said for what it will do. */
export const startLabelFor = (roomScreen) => (row) => START_WORDS.label(startModeFor(row, roomScreen));

/** Start a row: two screens opens the window inside the click. */
export function startRow(row, title, { onStart, roomScreen }) {
  const mode = startModeFor(row, roomScreen);
  if (mode !== 'two') { onStart(row.gameId, title); return; }
  const pending = openPendingRoomWindow();
  onStart(row.gameId, title, { pending, blocked: !pending });
}

/**
 * The list's `on`, from the page's callbacks. Any callback left out is left
 * out of the list too, so a frame can never show an action that does nothing.
 */
export function hostListHandlers({
  onStart, onEdit, onOpen, onReport, onResults, onInvite, onCopyPlayerUrl, onDelete,
  roomScreen = null, navigate = (url) => window.location.assign(url),
}) {
  const on = {};
  if (onStart) on.start = (row) => startRow(row, titleOf(row), { onStart, roomScreen });
  if (onEdit) on.edit = (row) => onEdit(row.gameId, titleOf(row));
  if (onOpen) on.continue = (row) => (isBuildSession(row) ? navigate(buildRoomPath(row.gameId)) : onOpen(row.gameId, titleOf(row)));
  if (onReport) on.report = (row) => (isBuildSession(row) ? navigate(buildReportPath(row.gameId)) : onReport(row.gameId, titleOf(row)));
  if (onResults) on.results = (row) => onResults(row.gameId, titleOf(row));
  if (onInvite) on.invite = (row) => onInvite(row);
  if (onCopyPlayerUrl) on.link = (row) => (isEventRow(row) ? onCopyPlayerUrl(row.gameId, { event: true }) : onCopyPlayerUrl(row.gameId));
  if (onDelete) on.delete = (row, reason) => onDelete(row, reason);
  on.open = (row) => navigate(eventStagePath(row.gameId));
  on.agenda = (row) => navigate(eventAgendaPath(row.gameId));
  on.continueItem = (item, event) => navigate(itemSessionPath(item.session.gameId, event.gameId));
  if (onReport) {
    on.reportItem = (item) => onReport(item.session.gameId, item.title || 'Session');
  }
  return on;
}
