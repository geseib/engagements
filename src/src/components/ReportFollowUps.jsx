import React from 'react';
import FW, { KINDS, RATE_ENDS } from '../config/followUpWords';

/**
 * QUESTIONS FOR THE ROOM, IN THE REPORTS (docs/design/followup-icons, phase D).
 *
 * What the host sent after a round's read and what the room answered: each
 * ask with the point of the read it came from, then its result in counts —
 * Choose per option, Rate as the average and each value's count, Ideas as
 * the words the host put on the wall. A cancelled one says so. No name
 * anywhere: create-report.js stores none for these.
 *
 * Shared by the session report (GameReport) and the round report (RoundReport).
 */
export default function ReportFollowUps({ followUps, className = 'report-followups' }) {
  if (!Array.isArray(followUps) || followUps.length === 0) return null;
  return (
    <div className={className}>
      <h3 className="report-block-heading">Questions for the room</h3>
      {followUps.map((f, i) => {
        const kind = KINDS[f.kind] || KINDS.ideas;
        const words = f.kind === 'rate' ? `“${f.statement}”` : f.question;
        const where = f.anchor ? FW.fromPoint(f.anchor.section, f.anchor.point) : '';
        const t = f.tally;
        return (
          <div key={i} className="report-followup report-keep">
            <div className="comment-on">{where ? `${kind.label} · ${where}` : kind.label}</div>
            <p className="report-followup-q"><b>{words}</b></p>
            {f.status === 'cancelled' && <p className="report-followup-note">Cancelled before the results were shown.</p>}
            {f.status === 'closed' && t && f.kind === 'choice' && (
              <ul className="report-followup-list">
                {(f.options || []).map((o, j) => (
                  <li key={j}>{`${String.fromCharCode(65 + j)} · ${o} — ${(t.counts && t.counts[j]) || 0}`}</li>
                ))}
              </ul>
            )}
            {f.status === 'closed' && t && f.kind === 'rate' && (
              <>
                <p className="report-followup-note">
                  {`${t.mean === null || t.mean === undefined ? '–' : t.mean.toFixed(1)} ${FW.averageOf5}`}
                </p>
                <ul className="report-followup-list">
                  {[5, 4, 3, 2, 1].map((v) => (
                    <li key={v}>{`${v === 5 ? RATE_ENDS.high : v === 1 ? RATE_ENDS.low : v} — ${(t.counts && t.counts[v - 1]) || 0}`}</li>
                  ))}
                </ul>
              </>
            )}
            {f.status === 'closed' && f.kind === 'ideas' && (f.picked || []).map((p, j) => (
              <blockquote key={j} className="comment-text">{p}</blockquote>
            ))}
            {f.status === 'closed' && t && (
              <p className="report-followup-note">
                {f.kind === 'ideas' ? FW.ideasCount(t.n || 0, (f.picked || []).length) : FW.answered(t.n || 0)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
