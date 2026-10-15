// src/src/components/console/panels/SimplePanels.jsx
import React from 'react';
import CW from '../../../config/consoleWords';
import RW from '../../../config/roundWords';

/**
 * The console's small panels: the lobby, a question asked of the room, the
 * feedback round's comments, and the end of the session.
 */

/** The lobby: the join code, who has joined, and the first task. A chooser (no round picked yet) replaces it. */
export function LobbyPanel({ code, joined = [], firstTask = '', chooser = null }) {
  if (chooser) return <section className="hc-panel">{chooser}</section>;
  return (
    <section className="hc-panel">
      <p className="hc-kicker">{CW.joinedSoFar}</p>
      <p className="hc-code-big">{code}</p>
      {joined.length
        // Two people can share a name: key by position as well.
        ? <ul className="hc-list hc-list--flat">{joined.map((n, i) => <li key={`${i}-${n}`}>{n}</li>)}</ul>
        : <p className="hc-muted">{CW.nobodyYet}</p>}
      {firstTask ? <div className="hc-task"><span className="hc-task-k">{CW.theTask}</span>{firstTask}</div> : null}
    </section>
  );
}

/** A question asked of the room: the caller passes the AskStage it already draws. */
export function RoomQuestionPanel({ children }) {
  return <section className="hc-panel">{children}</section>;
}

/**
 * The feedback round's comments as they land. A press puts one on the wall
 * (or takes the featured one down): the host page's handleFeatureComment.
 * Comments carry the comments route's shape: { commentId, text, anchorLabel, featured }.
 */
export function FeedbackPanel({ comments = [], onFeature }) {
  return (
    <section className="hc-panel">
      <p className="hc-kicker">{CW.commentsTitle}</p>
      {comments.length === 0 ? <p className="hc-muted">{CW.noComments}</p> : null}
      <div className="hc-resps">
        {comments.map((c) => (
          <button
            key={c.commentId}
            type="button"
            className={`hc-resp${c.featured ? ' is-onwall' : ''}`}
            aria-pressed={Boolean(c.featured)}
            onClick={() => onFeature(c.commentId)}
          >
            <small>{c.anchorLabel}{c.featured ? ` · ${CW.onTheWall}` : ''}</small>
            {c.text}
          </button>
        ))}
      </div>
    </section>
  );
}

/** The session has ended: the report. */
export function EndedPanel({ onOpenReport }) {
  return (
    <section className="hc-panel">
      <p className="hc-kicker">{CW.reportSoFar}</p>
      <button type="button" className="hc-btn" onClick={onOpenReport}>{RW.openReport}</button>
    </section>
  );
}
