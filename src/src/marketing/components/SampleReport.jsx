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
 */
export default function SampleReport({ report = SAMPLE_REPORT, callouts = false }) {
  const r = report;
  const answers = r.round.answers || [];
  const hasDiscussion = Boolean(r.round.discussionQuestions && r.round.discussionQuestions.length);

  const Pin = ({ n, show }) => (callouts && show ? <span className="mk-pin">{n}</span> : null);

  return (
    <article className="mk-report" data-theme="light" aria-label="Sample session report">
      <div className="mk-report-head">
        <p className="mk-report-kicker">{r.kicker}</p>
        <h3>{r.event}</h3>
        <p className="mk-report-meta">{r.meta}</p>
      </div>

      <div className="mk-report-body">
        <section className="mk-report-block">
          <h4><Pin n={1} show />{r.round.questionHeading}</h4>
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
          <h4><Pin n={5} show />{r.round.summaryHeading}</h4>
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
          <h4><Pin n={6} show />{r.standingsHeading}</h4>
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
          <a key={link.label} className="mk-report-btn" href={link.href}>{link.label}</a>
        ))}
        {r.footer.note && <span className="mk-report-note">{r.footer.note}</span>}
      </div>
    </article>
  );
}
