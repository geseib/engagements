// src/src/components/console/panels/ResponsesPanel.jsx
import React from 'react';
import CW from '../../../config/consoleWords';
import { navigatorLabel } from '../../../config/navigatorOrder';
import StageGathering from '../../stage/StageGathering';
import { YOUR_TURN } from '../../QuestionCard';

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
 *
 * THE QUESTION, BACK ON THE WALL (owner, 16 Oct 2026): at VOTE and RESULTS,
 * wherever a response can go up, a first row "The question" (the task text)
 * puts the question back up (`onQuestionToWall`), marked "On the wall now"
 * while the wall shows it (`questionOnWall`). The row carries the lesson
 * (owner, 18 Oct 2026), else the task; the task box then does not show. At
 * RESULTS the row is "The results": pressing it takes a spotlit response down
 * and the ranked results come back.
 */
export default function ResponsesPanel({
  kicker, title, lesson = '', task = '', taskOwn = false, phase, responses = [], authorsHidden = true,
  onWallIndex = null, onPutOnWall = null, stillWriting = 0, side = null, upNext = null,
  status = 'ready', gatheringNoun = 'responses', onRetry = null,
  questionOnWall = false, onQuestionToWall = null,
}) {
  const questionRow = Boolean(onQuestionToWall) && (phase === 'VOTE' || phase === 'RESULTS');
  const ready = status === 'ready';
  const rows = ready ? responses : [];
  const ordered = phase === 'ASK'
    ? rows.map((r, i) => ({ r, i })).reverse()
    : rows.map((r, i) => ({ r, i }));
  const labelPhase = phase === 'VOTE' ? 'VOTE' : phase === 'RESULTS' ? 'RESULTS' : 'ASK';
  // THE STAGE'S RULE FOR POINTS (GameHostPage, the RESULTS cards): a score
  // that jumps names its author as surely as a label would, so points show on
  // RESULTS only while the names do (standingsVisible === !authorsHidden).
  const showPoints = phase === 'RESULTS' && !authorsHidden;
  return (
    <section className="hc-panel">
      <p className="hc-kicker">{kicker}</p>
      <h2 className="hc-h">{title}</h2>
      {/* The lesson the room is answering, above the task (owner, 18 Oct 2026). */}
      {lesson && phase === 'ASK' ? <p className="hc-lesson">{lesson}</p> : null}
      {/* The room's label for the question's own instruction ("Your turn",
          docs/design/room-content-v2) when it is the question's own; a set's
          or type's default instruction stays "The task" — the host still
          sees it here, the room does not. */}
      {task && !questionRow ? <div className={`hc-task${taskOwn ? ' is-own' : ''}`}><span className="hc-task-k">{taskOwn ? YOUR_TURN : CW.theTask}</span>{task}</div> : null}
      <div className={`hc-cols${side ? '' : ' is-one'}`}>
        <div className="hc-resps">
          {questionRow ? (
            <button
              type="button"
              data-testid="hc-question"
              className={`hc-resp hc-question${questionOnWall ? ' is-onwall' : ''}`}
              onClick={onQuestionToWall}
            >
              <span className="hc-resp-body">
                {/* At RESULTS this row is the ranked results (focus none), not the
                    question: it said "The question · On the wall now" while the
                    wall showed the tally (walk of dev eed66685). */}
                <small>{phase === 'RESULTS' ? CW.resultsTitle : CW.theQuestion}{questionOnWall ? ` · ${CW.onTheWall}` : ''}</small>
                {lesson || task || title}
              </span>
            </button>
          ) : null}
          {ready ? null : <StageGathering status={status} noun={gatheringNoun} onRetry={onRetry} />}
          {ready && ordered.length === 0 ? <p className="hc-muted">{CW.waitingForResponses}</p> : null}
          {ordered.map(({ r, i }) => {
            const label = navigatorLabel(r, i, { phase: labelPhase, authorsHidden: phase === 'VOTE' ? true : authorsHidden });
            const onWall = !questionOnWall && onWallIndex === i;
            const Tag = onPutOnWall ? 'button' : 'div';
            return (
              <Tag
                key={i}
                type={onPutOnWall ? 'button' : undefined}
                data-testid="hc-resp"
                className={`hc-resp${onWall ? ' is-onwall' : ''}${r.isNew ? ' is-new' : ''}${showPoints ? ' has-pts' : ''}`}
                onClick={onPutOnWall ? () => onPutOnWall(i) : undefined}
              >
                <span className="hc-resp-body">
                  <small>{label}{onWall ? ` · ${CW.onTheWall}` : ''}</small>
                  {r.answer}
                </span>
                {showPoints ? <span className="hc-pts">{CW.points(r.points || 0)}</span> : null}
              </Tag>
            );
          })}
          {stillWriting > 0 ? <p className="hc-muted">{`${stillWriting} ${CW.stillWriting}`}</p> : null}
          {onPutOnWall && ready ? <p className="hc-muted">{questionRow ? CW.pressToWallOrQuestion : CW.pressToWall}</p> : null}
          {upNext ? <div className="hc-card"><h3 className="hc-card-h">{CW.upNext}</h3><p className="hc-strong">{upNext.title}</p><p className="hc-muted">{upNext.task}</p></div> : null}
        </div>
        {side}
      </div>
    </section>
  );
}
