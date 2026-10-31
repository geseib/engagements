/**
 * THE EVENT SUMMARY DOCUMENT — the overview and the agenda, one or two pages.
 *
 * The owner, 2026-10-31: "The event doc should just have the overview and
 * agenda and list the other docs. Let's not create a long pdf." Data from
 * utils/eventSummary.js `eventSummaryData`; drawn to PDF by the shared
 * pipeline (utils/saveReport.js drawReportPdf), so it is the session report's
 * design: the same `.report-doc` scope and `rpt-*` pieces of GameReport.css,
 * the same PDF mode, the same stamped head and foot. Never a session's
 * answers, reads or comments: each session's report is its own document, and
 * this one says which exist and where they are filed.
 */
import React from 'react';
import { MountainMark, Ridge, Kicker } from './GameReport';
import { REPORT_STATUS } from '../utils/eventSummary';

export default function EventSummaryDocument({ data }) {
  const { counts } = data;
  const when = [data.startsAt && data.endsAt ? `${data.startsAt}–${data.endsAt}` : data.startsAt, data.timeZone]
    .filter(Boolean).join(' · ');
  const generated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const row = (item) => (
    <div key={item.itemId} role="listitem" className="rpt-ev-row report-keep">
      <span className="rpt-ev-time">{item.at}{item.until && <><br /><span className="rpt-ev-until">until {item.until}</span></>}</span>
      <span className="rpt-ev-item">
        <span className="rpt-ev-title">{item.title}</span>
        {item.ledBy && <span className="rpt-ev-led">Led by {item.ledBy}</span>}
      </span>
      <span className="rpt-ev-format">{item.format}</span>
      <span className="rpt-ev-status">{item.status}</span>
      <span className="rpt-ev-report">
        {item.session ? (
          <>
            <span className={`rpt-ev-rs${item.reportTitle ? ' rpt-ev-rs--ready' : ''}`}>{item.reportStatus}</span>
            {item.reportTitle && <span className="rpt-ev-rtitle">{item.reportTitle}</span>}
            {item.reportWhere && <span className="rpt-ev-where">{item.reportWhere}</span>}
          </>
        ) : <span className="rpt-ev-none">No session</span>}
      </span>
    </div>
  );

  return (
    <article className="report-doc report-paper rpt-event" data-theme="light">
      <header className="rpt-ev-top" data-pdf-block="">
        <div className="rpt-ev-ridge"><Ridge /></div>
        <Kicker quiet={`Event ${data.code}`}>Event summary</Kicker>
        <h1 className="rpt-ev-name">{data.title}</h1>
        <dl className="rpt-facts">
          {data.day && (
            <div className="rpt-fact"><dt>Held</dt><dd>{data.day}{when && <><br /><span className="rpt-fact-quiet">{when}</span></>}</dd></div>
          )}
          {data.place && <div className="rpt-fact"><dt>Place</dt><dd>{data.place}</dd></div>}
          {data.hostName ? (
            <div className="rpt-fact rpt-ev-host">
              <dt>Hosted by</dt>
              <dd>{data.hostName}{data.teamName && <><br /><span className="rpt-fact-quiet">{data.teamName}</span></>}</dd>
            </div>
          ) : data.teamName ? (
            <div className="rpt-fact rpt-ev-host"><dt>Team</dt><dd>{data.teamName}</dd></div>
          ) : null}
        </dl>
        <div className="rpt-strip rpt-ev-strip">
          <div className="rpt-strip-count"><span className="rpt-strip-n">{counts.items}</span><span className="rpt-strip-l">{counts.items === 1 ? 'Item' : 'Items'}</span></div>
          <div className="rpt-strip-count"><span className="rpt-strip-n">{counts.sessionsRun}</span><span className="rpt-strip-l">{counts.sessionsRun === 1 ? 'Session run' : 'Sessions run'}</span></div>
          <div className="rpt-strip-count"><span className="rpt-strip-n">{counts.reportsReady}</span><span className="rpt-strip-l">{counts.reportsReady === 1 ? 'Report ready' : 'Reports ready'}</span></div>
        </div>
      </header>

      <section className="rpt-section rpt-ev-agenda" data-pdf-block="">
        <div className="rpt-keepnext report-keep">
          <Kicker>Agenda</Kicker>
          <h2 className="rpt-h-section">The day, item by item</h2>
          <div className="rpt-ev-row rpt-ev-row--head" aria-hidden="true">
            <span>Time</span><span>Item</span><span>Format</span><span>Status</span><span>Report</span>
          </div>
          {data.items.length > 0
            ? <div role="list" className="rpt-ev-list">{row(data.items[0])}</div>
            : <p className="rpt-empty">This event has no items.</p>}
        </div>
        {data.items.length > 1 && <div role="list" className="rpt-ev-list">{data.items.slice(1).map(row)}</div>}
        <p className="rpt-source rpt-ev-note">
          Each session&rsquo;s report is its own document, filed in Reports under this event. {REPORT_STATUS.auto} means
          the report was built after the session ended and its PDF is made when it is first opened.
        </p>
      </section>

      <p className="rpt-end" data-pdf-block="">
        <MountainMark className="rpt-end-mark" />
        <span>Generated {generated}</span>
      </p>
    </article>
  );
}
