import React from 'react';
import { SAMPLE_REPORT } from '../content/sampleReport';
import './SampleReport.css';

/**
 * A still of a report, on paper. Deliberately NOT GameReport: that component
 * is bound to live session data and a print sheet. `report` is a fixture
 * view from content/sampleReport.js — SAMPLE_REPORT_HOME (01-home.html's
 * trimmed sheet) or SAMPLE_REPORT (04-reports.html's fuller one, the default
 * here). Every block below renders only when the given view carries it, in
 * the mockup's own order, so the two views can render through one component
 * without either inventing content the other's mockup does not show.
 *
 * `callouts` draws the six numbered pins docs/design/marketing-redesign/
 * 04-reports.html marks on the full sheet: the question, the top answer's
 * text and vote count, the second answer's byline, the summary heading and
 * the standings heading. A pin is only meaningful against the full view; if
 * the given view's round lacks the answer a pin targets, that pin is simply
 * not rendered rather than left orphaned on the wrong block.
 *
 * The footer's `footer.links` entries (fixture: content/sampleReport.js) are
 * rendered as inert `<span aria-hidden="true">` labels, never as `<a>` or
 * `<button>`: neither this sheet nor the product behind it exports a PDF or
 * copies a link from this exact click, so a real link here would promise a
 * navigation ("Export PDF") that goes nowhere. Task 7 had these as `<a
 * href="/reports">` — a live link on the home page, but a dead click back to
 * the same page when the sheet renders on `/reports` itself; the fix-round-2
 * ruling replaced the link with a picture of a button on both pages, rather
 * than keep the link live on one page and dead on the other. `footerLinks`
 * (the old prop that toggled this) is gone — the footer always renders this
 * way, and `/reports` no longer needs to opt out of it.
 *
 * `headingLevel` (default 3, clamped to 2..5) sets the sheet's own title-level
 * tag; its block headings (the question, summary and standings headings) are
 * always one level below it. The home page renders under a section h2 and
 * relies on the default (h3/h4) — do not change it. `/reports` (Task 10,
 * fix round 1) passes `headingLevel={2}` so the sheet's headings sit directly
 * under the page's own h1 without a level skip, and — unlike an earlier
 * version of this page — without reordering the DOM to fake it: reading
 * order and tab order must match the visual layout (WCAG 1.3.2 / 2.4.3), so
 * the heading levels bend instead. `SampleReport.css` styles these by class
 * (`.mk-report-title`, `.mk-report-block-h`), not by tag, so both levels look
 * identical.
 */
export default function SampleReport({
  report = SAMPLE_REPORT,
  callouts = false,
  headingLevel = 3,
}) {
  const r = report;
  const answers = r.round.answers || [];
  const hasDiscussion = Boolean(r.round.discussionQuestions && r.round.discussionQuestions.length);
  // A non-numeric headingLevel (e.g. a typo'd prop) must not reach the tag
  // name — `h${NaN}` renders `<hnan>`, an element no browser or test can
  // reason about. Fall back to the documented default (3) instead of
  // clamping NaN, which Math.min/Math.max would silently pass through.
  const level = Number.isInteger(headingLevel) ? Math.min(5, Math.max(2, headingLevel)) : 3;
  const H = `h${level}`;
  const Sub = `h${level + 1}`;

  const Pin = ({ n, show }) => (callouts && show ? <span className="mk-pin">{n}</span> : null);

  return (
    <article className="mk-report" data-theme="light" aria-label="Sample session report">
      <div className="mk-report-head">
        <p className="mk-report-kicker">{r.kicker}</p>
        <H className="mk-report-title">{r.event}</H>
        <p className="mk-report-meta">{r.meta}</p>
      </div>

      <div className="mk-report-body">
        <section className="mk-report-block">
          <Sub className="mk-report-block-h"><Pin n={1} show />{r.round.questionHeading}</Sub>
          <p className="mk-report-q">{r.round.prompt}</p>
          <ul className="mk-report-answers">
            {answers.map((a, i) => (
              <li key={a.text}>
                <span><Pin n={2} show={i === 0} />{a.text}</span>
                <span className="mk-report-votes"><Pin n={3} show={i === 0} />{a.votesText}</span>
                <span className="mk-report-meter"><i style={{ width: `${a.width}%` }} /></span>
                <span className="mk-report-by"><Pin n={4} show={i === 1} />{a.by}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mk-report-block">
          <Sub className="mk-report-block-h"><Pin n={5} show />{r.round.summaryHeading}</Sub>
          <div className="mk-report-summary">
            <p>{r.round.summary}</p>
            {hasDiscussion && (
              <>
                <p><b>{r.round.discussionLabel}</b></p>
                <ol className="mk-report-list">
                  {r.round.discussionQuestions.map((q) => <li key={q}>{q}</li>)}
                </ol>
              </>
            )}
            {r.round.nextStepsLabel && <p><b>{r.round.nextStepsLabel}</b></p>}
            <ol className="mk-report-list">
              {r.round.nextSteps.map((s) => <li key={s}>{s}</li>)}
            </ol>
          </div>
        </section>

        <section className="mk-report-block">
          <Sub className="mk-report-block-h"><Pin n={6} show />{r.standingsHeading}</Sub>
          <table className="mk-report-standings">
            <thead>
              <tr>
                <th style={{ width: '56px' }}>{r.standingsCols.rank}</th>
                <th>{r.standingsCols.player}</th>
                <th style={{ width: '96px' }}>{r.standingsCols.correct}</th>
                <th style={{ width: '88px' }}>{r.standingsCols.points}</th>
              </tr>
            </thead>
            <tbody>
              {r.standings.map((s) => (
                <tr key={s.name}>
                  <td>{s.rank}</td>
                  <td>{s.name}</td>
                  <td>{s.correct}</td>
                  <td>{s.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="mk-report-foot">
        {r.footer.links.map((link) => (
          <span key={link.label} className="mk-report-btn" aria-hidden="true">{link.label}</span>
        ))}
        {r.footer.note && <span className="mk-report-note">{r.footer.note}</span>}
      </div>
    </article>
  );
}
