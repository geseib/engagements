import React from 'react';
import LW from '../config/lateWords';

/**
 * "ARRIVED LATE", IN THE REPORTS (session flow v3 §4.4; late items Task 5).
 *
 * One round's late items, as create-report.js files them inside the round
 * (`late: { answers, askAnswers, comments }`): what was said, who said it
 * where the round showed names, when it arrived, and the owner's review label
 * ("Not reviewed", "Reviewed with the room", "Reviewed by the host"). All
 * three kinds sit here, the late answers to a question for the room
 * included, so a late item is always found in the same place. An added-later
 * comment is listed here and not among the round's comments.
 *
 * The host's and the report's only: the labels never reach a phone or the
 * wall (owner, Q14). The server drops `late` from the phone's feedback round
 * and config/sessionHistory.js's feedbackRoundFrom drops it again.
 *
 * Shared by the session report (GameReport) and the round report
 * (RoundReport), like ReportFollowUps. Renders nothing when there is nothing.
 */
const KIND_ORDER = [['answers', 'answer'], ['askAnswers', 'askAnswer'], ['comments', 'comment']];

/** The round's late items, flat, oldest first. */
export function lateItemsOfRound(late) {
  if (!late || typeof late !== 'object') return [];
  return KIND_ORDER
    .flatMap(([key, kind]) => (Array.isArray(late[key]) ? late[key] : []).map((it) => ({ ...it, kind })))
    .sort((a, b) => String(a.arrivedAt || '').localeCompare(String(b.arrivedAt || '')));
}

export default function ReportLate({ late, roundNoun = null, className = 'report-late' }) {
  const items = lateItemsOfRound(late);
  if (!items.length) return null;
  return (
    <div className={className}>
      <h3 className="report-block-heading">{LW.report.heading}</h3>
      {items.map((it, i) => {
        const about = it.kind === 'askAnswer' && it.askQuestion
          ? LW.report.toQuestion(it.askQuestion)
          : (it.kind === 'comment' && it.anchorLabel ? LW.report.on(it.anchorLabel) : '');
        const when = LW.arrivedDuring(it.arrivedDuring, roundNoun);
        return (
          <div key={i} className="report-comment report-late-item report-keep" data-kind={it.kind}>
            <div className="comment-on">{[LW.kinds[it.kind], about].filter(Boolean).join(' · ')}</div>
            <blockquote className="comment-text">{it.text}</blockquote>
            <div className="comment-meta">
              {it.who ? <span className="comment-author">{it.who}</span> : null}
              {when ? <span className="report-late-when">{when}</span> : null}
              <span className="report-late-label">{it.label || LW.labels.none}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
