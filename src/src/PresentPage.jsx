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
import React, { useMemo } from 'react';
import PresentStage from './present/PresentStage';
import { PresentMoment, PhaseWipe } from './present/PresentMoments';
import usePresentation from './present/usePresentation';
import { presentModel } from './present/presentModel';
import Scoreboard from './components/stage/scoreboard/Scoreboard';
import { hasScoreboard } from './config/scoreboard';
import useFullscreenKey from './hooks/useFullscreenKey';
import usePresentControls from './present/presentControls';
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
    seconds, only to a host who may drive this session. The room sees it too,
    so it is the fallback, not the design: back, the join code, and the round's
    next step, with the armed text when an early advance needs a second press.
  */
  const step = controls.step;
  const primary = step && step.primary;
  const strip = controls.strip ? (
    <div className="present-strip" role="toolbar" aria-label="Presentation controls">
      <span className="present-strip-status">{controls.arming || (step && step.status && step.status.text) || ''}</span>
      <button type="button" className="present-strip-btn" onClick={controls.back} aria-label="Back">‹ Back</button>
      <button
        type="button"
        className="present-strip-btn"
        aria-pressed={controls.joinShown}
        onClick={controls.toggleJoin}
        disabled={!/^(ASK|VOTE|RESULTS)#/.test(String(snapshot && snapshot.state))}
      >
        {controls.joinShown ? 'Hide join code' : 'Join code'}
      </button>
      <button type="button" className="present-strip-btn is-go" onClick={controls.forward} disabled={Boolean(primary && primary.disabled)}>
        {controls.arming ? 'Press again' : 'Forward ›'}
      </button>
    </div>
  ) : null;

  return (
    <PresentStage profile={model.profile} fitKey={fitKey} overlay={<>{overlay}{strip}</>} fitcheck={fitcheckOn()}>
      <PresentMoment model={model} />
      <PhaseWipe moment={model.moment} />
    </PresentStage>
  );
}
