import React from 'react';
import FW, { KINDS, RATE_ENDS } from '../config/followUpWords';

/**
 * QUESTIONS FOR THE ROOM, IN THE REPORTS (docs/design/followup-icons, phase D;
 * the full record since session flow v3 §4.2).
 *
 * Each question the host sent after a round's read, as one block:
 *
 *   Ideas · from Discussion topics, point 3
 *   "Maya Chen proposes a staged commitment …"          the point itself
 *   What is one measurable gate …?                       what was sent
 *   Workie suggested: "…" · Edited by the host (question) | Sent as Workie wrote it | Written by the host
 *   Workie's reason: … · Drawn from responses 2 and 4
 *   Open 01:12–01:14 · 4 of 4 in the room answered
 *   then the result: Choose per option, Rate as the average and each count,
 *   Ideas as every idea in two groups, "Shown to the room" and "Not shown"
 *   (owner, 15 Oct, Q1).
 *
 * A LATE IDEA THE HOST PUT ON THE WALL (walk W2, 16 Oct 2026) is not one of
 * the record's ideas: it is listed under Arrived late (ReportLate). So the
 * two counts stay about the ideas that came in on time, and one line under
 * them says "1 late idea was shown to the room · see Arrived late", matched
 * to the question by its words (the round's `late.askAnswers`).
 *
 * A row from before the full record prints what it has. No name anywhere:
 * create-report.js stores none for these. Shared by the session report
 * (GameReport) and the round report (RoundReport).
 */
const clock = (iso) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function originLine(f) {
  if (f.origin === 'host') return FW.writtenByHost;
  if (f.origin === 'suggested') return FW.sentAsWritten;
  if (f.origin !== 'edited') return '';
  const s = f.suggested;
  const words = s ? (s.kind === 'rate' ? s.statement : s.question) : '';
  return [words ? FW.workieSuggested(words) : '', FW.editedBy(f.edits || [])].filter(Boolean).join(' · ');
}

const lateShownFor = (late, f) => (late && Array.isArray(late.askAnswers) ? late.askAnswers : [])
  .filter((a) => a && a.reviewed === 'shown' && a.askQuestion && a.askQuestion === f.question).length;

export default function ReportFollowUps({ followUps, late = null, className = 'report-followups' }) {
  if (!Array.isArray(followUps) || followUps.length === 0) return null;
  return (
    <div className={className}>
      <h3 className="report-block-heading">Questions for the room</h3>
      {followUps.map((f, i) => {
        const kind = KINDS[f.kind] || KINDS.ideas;
        const words = f.kind === 'rate' ? `“${f.statement}”` : f.question;
        const where = f.anchor ? FW.fromPoint(f.anchor.section, f.anchor.point) : '';
        const t = f.tally;
        const origin = originLine(f);
        const s = f.suggested;
        const reason = s && s.why ? FW.workiesReason(s.why) : '';
        const drawn = s && Array.isArray(s.answers) && s.answers.length ? FW.drawnFrom(s.answers) : '';
        const opened = clock(f.sentAt);
        const closed = clock(f.closedAt || f.cancelledAt);
        const timing = opened ? FW.openFor(opened, closed) : '';
        const count = f.status === 'closed' && t ? FW.answeredOfRoom(t.n || 0, f.roomSize) : '';
        const ideas = Array.isArray(f.ideas) ? f.ideas : null;
        const shown = ideas ? ideas.filter((x) => x.shown) : [];
        const notShown = ideas ? ideas.filter((x) => !x.shown) : [];
        return (
          <div key={i} className="report-followup report-keep">
            <div className="comment-on">{where ? `${kind.label} · ${where}` : kind.label}</div>
            {f.anchorText ? <p className="report-followup-anchor"><i>{`“${f.anchorText}”`}</i></p> : null}
            <p className="report-followup-q"><b>{words}</b></p>
            {origin ? <p className="report-followup-note">{origin}</p> : null}
            {(reason || drawn) ? <p className="report-followup-note">{[reason, drawn].filter(Boolean).join(' · ')}</p> : null}
            {(timing || count) ? (
              <p className="report-followup-note">
                {[timing, count, f.sentFrom === 'remote' ? FW.sentFromRemote : ''].filter(Boolean).join(' · ')}
              </p>
            ) : null}
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
            {f.status === 'closed' && f.kind === 'ideas' && ideas ? (
              <>
                <p className="report-followup-note"><b>{FW.shownToRoom(shown.length)}</b></p>
                {shown.map((p, j) => <blockquote key={`s${j}`} className="comment-text">{p.text}</blockquote>)}
                <p className="report-followup-note"><b>{FW.notShown(notShown.length)}</b></p>
                {notShown.map((p, j) => <blockquote key={`n${j}`} className="comment-text">{p.text}</blockquote>)}
              </>
            ) : null}
            {f.kind === 'ideas' && lateShownFor(late, f) > 0 ? (
              <p className="report-followup-note report-followup-late">{FW.lateShown(lateShownFor(late, f))}</p>
            ) : null}
            {f.status === 'closed' && f.kind === 'ideas' && !ideas && (f.picked || []).map((p, j) => (
              <blockquote key={j} className="comment-text">{p}</blockquote>
            ))}
            {f.status === 'closed' && t && f.kind === 'ideas' && !ideas && (
              <p className="report-followup-note">{FW.ideasCount(t.n || 0, (f.picked || []).length)}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
