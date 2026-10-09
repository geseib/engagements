/**
 * The report's "Talking points and research" section (Build Room, Task 6).
 * Mockup: docs/design/build-room-talking-points T10. Data: build-points-report.js
 * (reportData.talkingPoints). Props in, markup out; null in, nothing out.
 *
 * No participant is named anywhere in the data this reads. A builder's name
 * arrives already attached to their own points ("Priya's Claude").
 */
import React from 'react';
import './TalkingPointsReport.css';

const time = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

function linkLabel(s) {
  return s.site ? `${s.title} · ${s.site}` : s.title;
}

function Finding({ f }) {
  return (
    <li className="tpr-keep">
      {f.text}
      {f.fromBuilder && <span className="tpr-mut"> From {f.by}.</span>}
      {f.shownAt && <span className="tpr-mut"> Shown to the room {time(f.shownAt)}.</span>}
      {f.sources.map((s) => (
        <a key={s.url} className="tpr-src" href={s.url} target="_blank" rel="noopener noreferrer">{linkLabel(s)}</a>
      ))}
    </li>
  );
}

function outcomeText(o) {
  if (o.movedForward) return `Moved forward${o.outcome ? ` · ${o.outcome}` : ''}`;
  return o.outcome ? o.outcome.charAt(0).toUpperCase() + o.outcome.slice(1) : '';
}

const STATE_TEXT = { done: 'Done', skipped: 'Skipped, to Later', doing: 'Sent, not marked done', pending: 'Not reached' };

export default function TalkingPointsReport({ data }) {
  if (!data) return null;
  const c = data.counts || {};
  const requests = data.requests || [];
  const votes = data.votes || [];
  const run = data.run;
  const shown = data.shown || [];
  const sources = [
    c.fromClaude ? plural(c.fromClaude, 'point') + ' from Claude' : '',
    ...(c.fromBuilders || []).map((b) => `${plural(b.n, 'point')} from ${b.name}`),
  ].filter(Boolean);
  const asked = [
    c.researchRequests ? plural(c.researchRequests, 'research request') : '',
    c.ideaRequests ? plural(c.ideaRequests, 'request') + ' for ideas' : '',
  ].filter(Boolean);
  const did = [c.votes ? plural(c.votes, 'vote') : '', c.runs ? plural(c.runs, 'run list') : ''].filter(Boolean);
  const lede = [sources.join(' and '), asked.join(', '), did.join(', ')].filter(Boolean).map((x) => `${x}.`).join(' ');

  return (
    <section className="report-question tpr" aria-labelledby="tpr-heading">
      <header className="report-question-header">
        <p className="report-section-index"><span className="report-section-number">Build Room</span></p>
        <h2 className="report-lesson-heading" id="tpr-heading">Talking points and research</h2>
      </header>
      {lede && <p className="tpr-lede">{lede}</p>}

      {requests.length > 0 && <h3 className="tpr-h">Research and ideas</h3>}
      {requests.map((q) => (
        <div className="tpr-group" key={q.id || 'loose'}>
          {q.subject && (
            <p className="tpr-subject">
              <b>{q.subject}</b>
              <span className="tpr-mut">
                {q.askedAt ? ` · asked ${time(q.askedAt)}` : ''}
                {q.kind === 'ideas' ? '' : ` · ${q.findings.length ? plural(q.findings.length, 'finding') : 'nothing found'}`}
                {q.for !== 'Claude' ? ` · ${q.for}` : ''}
              </span>
            </p>
          )}
          {q.findings.length > 0 && <ul>{q.findings.map((f) => <Finding key={f.id} f={f} />)}</ul>}
          {q.ideas.length > 0 && <ul>{q.ideas.map((f) => <Finding key={f.id} f={f} />)}</ul>}
        </div>
      ))}

      {votes.length > 0 && <h3 className="tpr-h">Put to the room</h3>}
      {votes.map((v) => (
        <div className="tpr-group tpr-keep" key={v.id}>
          <p className="tpr-subject">
            <b>{v.prompt}</b>
            <span className="tpr-mut"> {'·'} pick up to {v.maxPicks} {'·'} {v.voted} voted, {plural(v.picks, 'pick')}</span>
          </p>
          <table className="tpr-table">
            <thead><tr><th>Option</th><th>From</th><th className="tpr-n">Votes</th><th>Outcome</th></tr></thead>
            <tbody>
              {v.options.map((o) => (
                <tr key={o.label}>
                  <td>{o.text}</td>
                  <td>{o.isFinding && !o.fromBuilder ? "Claude's research" : o.by}</td>
                  <td className="tpr-n">{o.votes}</td>
                  <td className={o.movedForward ? 'tpr-fw' : 'tpr-sk'}>{outcomeText(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {run && (
        <>
          <h3 className="tpr-h">Worked through in turn</h3>
          <table className="tpr-table tpr-keep">
            <tbody>
              {run.items.map((it) => (
                <tr key={it.k}>
                  <td className="tpr-k">{it.k}</td>
                  <td>
                    {it.text}
                    {it.fromBuilder && <span className="tpr-mut"> From {it.by}.</span>}
                    {it.note && <span className="tpr-src tpr-note">Claude: {it.note}</span>}
                  </td>
                  <td className={it.state === 'done' ? 'tpr-fw' : 'tpr-sk'}>
                    {STATE_TEXT[it.state] || it.state}{it.state === 'done' && it.doneAt ? ` ${time(it.doneAt)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {shown.length > 0 && (
        <>
          <h3 className="tpr-h">Shown to the room</h3>
          <ul>
            {shown.map((s) => (
              <li className="tpr-keep" key={`${s.shownAt}-${s.text}`}>
                {s.text}
                <span className="tpr-mut">
                  {' '}From {s.fromBuilder ? s.by : s.kind === 'finding' ? "Claude's research" : 'Claude'}
                  {s.shownAt ? ` · ${time(s.shownAt)}` : ''}
                  {s.ideasSent ? ` · ${plural(s.ideasSent, 'idea')} sent about it` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="tpr-foot">Points never shown, voted on or sent are left out of the report. They stay in each person&rsquo;s folder in the repo.</p>
    </section>
  );
}
