/**
 * THE EVENT SUMMARY — a short PDF of an event: its overview and its agenda,
 * each session item's report named and placed. Nothing from inside a session.
 *
 * The owner, 2026-10-31: "The event doc should just have the overview and
 * agenda and list the other docs. Let's not create a long pdf." So this is
 * one or two pages, never a roll-up of the sessions' reports: those are their
 * own documents, listed in Reports under the event, and the summary says
 * which exist and where to find them.
 *
 * Reads what already exists, no new route:
 *   - GET /events/{code} (utils/eventsApi.getEvent): the event (title, place,
 *     startsAt, timeZone, state) and its items (type, title, ledBy, minutes,
 *     state, gameId). Planned times come from agenda-rules' agendaTimes, as
 *     the builder, the stage and the phones work them out.
 *   - GET /reports (lambda-functions/game/get-reports.js): per event item, the
 *     report filed under it (saved, or auto-built by the report sweep) and
 *     whether its session has expired.
 *
 * DOWNLOAD ONLY. The save route is per session (POST /games/{id}/save-report,
 * keyed and passkeyed by the session); there is no event-level report row to
 * keep this under, so it is drawn and handed to the browser, not stored.
 */
import { getEvent } from './eventsApi';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from './adminApi';
import { groupReports, EVENT_KIND } from '../config/engagementKinds';
import { rules } from '../components/event/eventDisplay';

/** What the report column says for a session item. */
export const REPORT_STATUS = Object.freeze({
  saved: 'Report saved',
  auto: 'Auto-built',
  none: 'No report yet',
  expired: 'Session expired',
  notRun: 'Not run',
});

const STATE_WORDS = Object.freeze({ planned: 'Planned', live: 'Live', paused: 'Paused', done: 'Done' });

/**
 * The summary's data, from the host view of the event and the GET /reports
 * body. Pure: the tests and the document read it the same way.
 * @param {{event: object, items: object[]}} view   GET /events/{code}
 * @param {object} reportsBody                      GET /reports
 */
export function eventSummaryData(view, reportsBody) {
  const event = (view && view.event) || {};
  const rawItems = (view && view.items) || [];
  const timed = event.startsAt ? rules.agendaTimes(event.startsAt, rawItems) : { rows: rawItems, endsAt: '' };
  const listed = groupReports(reportsBody || {}).find((r) => r.kind === EVENT_KIND && String(r.code) === String(event.code)) || null;
  const filed = new Map(((listed && listed.items) || []).map((i) => [i.itemId, i]));
  const eventTitle = event.title || `Event ${event.code || ''}`.trim();

  const items = timed.rows.map((item) => {
    const row = filed.get(item.itemId) || {};
    const session = rules.isEngagement(item.type);
    const gameId = item.gameId || row.gameId || '';
    const gone = Boolean(gameId) && row.sessionGone === true;
    const report = row.report || null;
    let reportStatus = '';
    if (session) {
      if (report) reportStatus = report.auto ? REPORT_STATUS.auto : REPORT_STATUS.saved;
      else if (!gameId) reportStatus = REPORT_STATUS.notRun;
      else reportStatus = gone ? REPORT_STATUS.expired : REPORT_STATUS.none;
    }
    return {
      itemId: item.itemId,
      at: item.at || '',
      until: item.until || '',
      title: item.title || (item.decryptFailed ? 'Unreadable item' : rules.TYPE_LABELS[item.type] || 'Item'),
      format: rules.TYPE_LABELS[item.type] || '',
      ledBy: item.ledBy || '',
      status: gone ? 'Expired' : STATE_WORDS[item.state] || STATE_WORDS.planned,
      session,
      gameId,
      reportStatus,
      reportTitle: report ? report.title || item.title || '' : '',
      reportWhere: report ? `Reports › ${eventTitle}` : '',
    };
  });

  const sessions = items.filter((i) => i.session);
  return {
    code: event.code || '',
    title: eventTitle,
    day: rules.formatEventDay(event.startsAt),
    startsAt: rules.formatStartTime(event.startsAt),
    endsAt: timed.endsAt || '',
    timeZone: event.timeZone || '',
    place: event.place || '',
    state: event.state || '',
    items,
    counts: {
      items: items.length,
      sessionsRun: sessions.filter((i) => i.gameId).length,
      reportsReady: sessions.filter((i) => i.reportStatus === REPORT_STATUS.saved || i.reportStatus === REPORT_STATUS.auto).length,
    },
  };
}

/** What the stamped head and foot say on each page. */
export function eventRunning(data) {
  return {
    kind: 'Event summary',
    title: data.title,
    footLeft: [`Event ${data.code}`, data.day].filter(Boolean).join(' · '),
    cover: false,
  };
}

/** Both reads, side by side. A failed reports list costs the report column, never the summary. */
export async function loadEventSummary(code, { fetchFn = authFetch } = {}) {
  const [view, reportsBody] = await Promise.all([
    getEvent(code),
    fetchFn(adminApiUrl('reports'))
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({})),
  ]);
  return eventSummaryData(view, reportsBody);
}

/** "Platform-Summit-summary.pdf". */
export const summaryFileName = (title) => `${String(title || 'Event').replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-') || 'Event'}-summary.pdf`;

/**
 * Draw the summary offscreen with the shared pipeline (utils/saveReport.js
 * drawReportPdf: the report's PDF mode, the stamped head and foot) and hand
 * the file to the browser. Modules load on the click, not with the page.
 */
export async function downloadEventSummary(code) {
  const [data, React, { createRoot }, { flushSync }, { default: EventSummaryDocument }, { drawReportPdf }, { REPORT_PDF_PASSES }] = await Promise.all([
    loadEventSummary(code),
    import('react'),
    import('react-dom/client'),
    import('react-dom'),
    import('../components/EventSummary'),
    import('./saveReport'),
    import('../config/reportPdf'),
  ]);
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, { position: 'absolute', left: '-100000px', top: '0', width: '7in' });
  document.body.appendChild(box);
  const root = createRoot(box);
  try {
    flushSync(() => root.render(React.createElement(EventSummaryDocument, { data })));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const element = box.querySelector('.report-doc');
    const base64 = await drawReportPdf({ element, title: data.title, pass: REPORT_PDF_PASSES[0], running: eventRunning(data) });
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = summaryFileName(data.title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return data;
  } finally {
    root.unmount();
    box.remove();
  }
}
