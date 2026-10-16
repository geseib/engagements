// src/src/components/console/panels/ResponsesPanel.jsx
import React from 'react';
import CW from '../../../config/consoleWords';
import { navigatorLabel } from '../../../config/navigatorOrder';
import StageGathering from '../../stage/StageGathering';

/**
 * The responses, as the host works with them (host console spec §3.4):
 * answering (newest first, names hidden while hidden), voting (the room's
 * order, always "Response N"), results, and between rounds (with Up next).
 * Pressing a response puts it on the wall when onPutOnWall is given.
 *
 * THE STAGE'S READINESS GUARD (config/stageAnswers.js). For about a second
 * after VOTE or RESULTS opens, the page's `answers` still hold the previous
 * round-phase's rows; a press then would publish an index into the wrong
 * list. The page passes `status` ('ready' | 'gathering' | 'failed', from
 * stageAnswersStatus) and no rows until 'ready'; until then this panel says
 * what the stage says ("Gathering responses…", or that they did not load,
 * with the stage's retry) instead of "No responses yet."
 */
export default function ResponsesPanel({
  kicker, title, task = '', phase, responses = [], authorsHidden = true,
  onWallIndex = null, onPutOnWall = null, stillWriting = 0, side = null, upNext = null,
  status = 'ready', gatheringNoun = 'responses', onRetry = null,
}) {
  const ready = status === 'ready';
  const rows = ready ? responses : [];
  const ordered = phase === 'ASK'
    ? rows.map((r, i) => ({ r, i })).reverse()
    : rows.map((r, i) => ({ r, i }));
  const labelPhase = phase === 'VOTE' ? 'VOTE' : phase === 'RESULTS' ? 'RESULTS' : 'ASK';
  return (
    <section className="hc-panel">
      <p className="hc-kicker">{kicker}</p>
      <h2 className="hc-h">{title}</h2>
      {task ? <div className="hc-task"><span className="hc-task-k">{CW.theTask}</span>{task}</div> : null}
      <div className={`hc-cols${side ? '' : ' is-one'}`}>
        <div className="hc-resps">
          {ready ? null : <StageGathering status={status} noun={gatheringNoun} onRetry={onRetry} />}
          {ready && ordered.length === 0 ? <p className="hc-muted">{CW.waitingForResponses}</p> : null}
          {ordered.map(({ r, i }) => {
            const label = navigatorLabel(r, i, { phase: labelPhase, authorsHidden: phase === 'VOTE' ? true : authorsHidden });
            const onWall = onWallIndex === i;
            const Tag = onPutOnWall ? 'button' : 'div';
            return (
              <Tag
                key={i}
                type={onPutOnWall ? 'button' : undefined}
                data-testid="hc-resp"
                className={`hc-resp${onWall ? ' is-onwall' : ''}${r.isNew ? ' is-new' : ''}`}
                onClick={onPutOnWall ? () => onPutOnWall(i) : undefined}
              >
                <small>{label}{onWall ? ` · ${CW.onTheWall}` : ''}</small>
                {r.answer}
              </Tag>
            );
          })}
          {stillWriting > 0 ? <p className="hc-muted">{`${stillWriting} ${CW.stillWriting}`}</p> : null}
          {onPutOnWall && ready ? <p className="hc-muted">{CW.pressToWall}</p> : null}
          {upNext ? <div className="hc-card"><h3 className="hc-card-h">{CW.upNext}</h3><p className="hc-strong">{upNext.title}</p><p className="hc-muted">{upNext.task}</p></div> : null}
        </div>
        {side}
      </div>
    </section>
  );
}
