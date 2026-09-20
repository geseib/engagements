import React from 'react';
import { SAMPLE_REPORT, REPORT_LABELS } from '../content/sampleReport';
import './SampleReport.css';

/**
 * A still of a report, on paper. Deliberately NOT GameReport: that component
 * is bound to live session data and a print sheet. This is fixture data
 * (SAMPLE_REPORT), transcribed from the mockups, and the page around it says
 * so (HOME.summit.lead).
 *
 * `callouts` draws the six numbered pins docs/design/marketing-redesign/
 * 04-reports.html marks on this same session: the question, the top answer's
 * text and vote count, the second answer's byline, the summary heading and
 * the standings heading — in that order. HomePage renders none of them;
 * /reports (Task 10) renders them beside its own numbered callout list.
 */
export default function SampleReport({ callouts = false }) {
  const r = SAMPLE_REPORT;
  const t = REPORT_LABELS;

  const Pin = ({ n }) => (callouts ? <span className="mk-pin">{n}</span> : null);

  return (
    <article className="mk-report" data-theme="light" aria-label="Sample session report">
      <div className="mk-report-head">
        <p className="mk-report-kicker">{t.kicker}</p>
        <h3>{r.event}</h3>
        <p className="mk-report-meta">{t.meta(r)}</p>
      </div>

      <div className="mk-report-body">
        <section className="mk-report-block">
          <h4><Pin n={1} />{t.questionHeading(r)}</h4>
          <p className="mk-report-q">{r.round.prompt}</p>
          <ul className="mk-report-answers">
            {r.round.answers.map((a, i) => (
              <li key={a.text}>
                <span>{i === 0 && <Pin n={2} />}{a.text}</span>
                <span className="mk-report-votes">{i === 0 && <Pin n={3} />}{t.votesLabel(a.votes)}</span>
                <span className="mk-report-meter"><i style={{ width: `${a.width}%` }} /></span>
                <span className="mk-report-by">{i === 1 && <Pin n={4} />}{a.by}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mk-report-block">
          <h4><Pin n={5} />{t.summaryHeading}</h4>
          <div className="mk-report-summary">
            <p>{r.round.summary}</p>
            <p><b>{t.discussionLabel}</b></p>
            <ol className="mk-report-list">
              {r.round.discussionQuestions.map((q) => <li key={q}>{q}</li>)}
            </ol>
            <p><b>{t.nextStepsLabel}</b></p>
            <ol className="mk-report-list">
              {r.round.nextSteps.map((s) => <li key={s}>{s}</li>)}
            </ol>
          </div>
        </section>

        <section className="mk-report-block">
          <h4><Pin n={6} />{t.standingsHeading}</h4>
          <table className="mk-report-standings">
            <thead>
              <tr>
                <th style={{ width: '56px' }}>{t.standingsCols.rank}</th>
                <th>{t.standingsCols.player}</th>
                <th style={{ width: '96px' }}>{t.standingsCols.correct}</th>
                <th style={{ width: '88px' }}>{t.standingsCols.points}</th>
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
        <a className="mk-report-btn" href="/reports">{t.exportLabel}</a>
        <a className="mk-report-btn" href="/reports">{t.shareLabel}</a>
        <span className="mk-report-note">{t.footNote}</span>
      </div>
    </article>
  );
}
