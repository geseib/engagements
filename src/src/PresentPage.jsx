/**
 * /present?gameId= — THE PRESENTATION (docs/design/two-surface, PLAN 2.9).
 *
 * Public: it shows only what the room already sees, through public reads
 * (present/usePresentation.js), so a join-code URL is enough and no sign-in is
 * asked for. Opened from the host's Present link and dragged to the projector
 * (F for full screen), or shared alone as a window in a call.
 *
 * Holds no state of its own: a reload, a dropped network or a second copy on
 * another computer lands on the same moment.
 */
import React, { useEffect, useMemo } from 'react';
import PresentStage from './present/PresentStage';
import { PresentMoment, PhaseWipe } from './present/PresentMoments';
import usePresentation from './present/usePresentation';
import { presentModel } from './present/presentModel';
import Scoreboard from './components/stage/scoreboard/Scoreboard';
import { hasScoreboard } from './config/scoreboard';
import useFullscreenKey from './hooks/useFullscreenKey';
import usePresentControls from './present/presentControls';
import Button from './components/ui/Button';
import Eyebrow from './components/ui/Eyebrow';
import './present/present.css';

function gameIdFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('gameId') || '';
  } catch (e) {
    return '';
  }
}

function fitcheckOn() {
  try {
    return window.ENV === 'development' && new URLSearchParams(window.location.search).get('fitcheck') === '1';
  } catch (e) {
    return false;
  }
}

export default function PresentPage() {
  const gameId = useMemo(gameIdFromUrl, []);
  const { snapshot, reads, refetch } = usePresentation(gameId);
  const model = gameId ? presentModel(snapshot, reads) : { moment: 'NOT_FOUND', profile: 'room' };
  useFullscreenKey();
  // Forward and back with the keys or a clicker, for a host who may drive
  // this session (present/presentControls.js); the room's own view is unchanged.
  const total = Number.isInteger(model.total) && model.total > 0
    ? model.total
    : Number(snapshot && snapshot.roomCounts && snapshot.roomCounts.answered) || 0;
  const controls = usePresentControls({
    gameId, snapshot, total, refetch, notesReady: model.moment !== 'READ_WAIT',
  });
  // A CLICK ANYWHERE TAKES THE JOIN CODE DOWN (owner, 2026-10-13), as J does,
  // for a host who may drive the session; the strip and the ask keep their own.
  const { joinShown, armed, toggleJoin } = controls;
  useEffect(() => {
    if (!joinShown || !armed) return undefined;
    const onClick = (e) => {
      const t = e.target;
      if (t && typeof t.closest === 'function' && t.closest('.present-strip, .present-confirm')) return;
      toggleJoin();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [joinShown, armed, toggleJoin]);

  const fitKey = [model.moment, model.index, model.part, model.page, model.text, model.content, model.title, model.joined]
    .map((x) => (x === undefined ? '' : String(x))).join('|');

  const showBoard = Boolean(model.scoreboard && hasScoreboard(snapshot && snapshot.gameType));
  const overlay = showBoard ? (
    <div className="present-board">
      <Scoreboard
        gameId={gameId}
        apiBase={window.API_BASE || ''}
        title={model.sessionTitle}
        profile={model.profile}
        board={model.scoreboard}
        refreshKey={String(snapshot && snapshot.state)}
        keysEnabled={false}
        closable={false}
      />
    </div>
  ) : null;

  /*
    THE ONE-SCREEN STRIP (two-surface D7): moving the mouse shows it for three
    seconds. To a host who may drive this session it holds Back, the join code
    and Forward; to anyone else it says why the keys do nothing, rather than
    staying silent (the owner pressed keys and saw nothing happen).
  */
  const step = controls.step;
  const strip = controls.strip ? (
    controls.armed ? (
      <div className="present-strip" role="toolbar" aria-label="Presentation controls">
        <span className="present-strip-status">{(step && step.status && step.status.text) || ''}</span>
        <Button className="present-strip-btn" onClick={controls.back}>‹ Back</Button>
        <Button
          className="present-strip-btn"
          aria-pressed={controls.joinShown}
          onClick={controls.toggleJoin}
          disabled={!/^(ASK|VOTE|RESULTS)#/.test(String(snapshot && snapshot.state))}
        >
          {controls.joinShown ? 'Hide join code (J)' : 'Join code (J)'}
        </Button>
        <Button variant="action" className="present-strip-btn is-go" onClick={controls.forward}>Forward ›</Button>
      </div>
    ) : (
      <div className="present-strip" role="status">
        <span className="present-strip-status is-note">{controls.note}</span>
      </div>
    )
  ) : null;

  /*
    THE SAFETY ASK (owner, 2026-10-13: "perhaps with a safety ask? modal pops
    up"). Forward with nothing left to step through asks before the round
    moves: → or Enter goes on, ← or Esc stays.
  */
  const ask = controls.confirm ? (
    <div className="present-confirm" role="dialog" aria-modal="true" aria-labelledby="present-confirm-title">
      <Eyebrow className="present-confirm-ey">Next step</Eyebrow>
      <p className="present-confirm-title" id="present-confirm-title">{controls.confirm.label}</p>
      {controls.confirm.note ? <p className="present-confirm-note">{controls.confirm.note}</p> : null}
      <div className="present-confirm-row">
        <Button className="present-strip-btn" onClick={controls.confirmCancel}>← Stay here</Button>
        <Button variant="action" className="present-strip-btn is-go" onClick={controls.confirmGo}>{`${controls.confirm.label} →`}</Button>
      </div>
    </div>
  ) : null;

  return (
    <PresentStage profile={model.profile} fitKey={fitKey} overlay={<>{overlay}{strip}{ask}</>} fitcheck={fitcheckOn()}>
      <PresentMoment model={model} />
      <PhaseWipe moment={model.moment} />
    </PresentStage>
  );
}
