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
import React, { Suspense, lazy, useEffect, useMemo } from 'react';
import PresentStage from './present/PresentStage';
import { PresentMoment, PhaseWipe } from './present/PresentMoments';
import usePresentation from './present/usePresentation';
import { presentModel } from './present/presentModel';
import Scoreboard from './components/stage/scoreboard/Scoreboard';
import { hasScoreboard } from './config/scoreboard';
import useFullscreenKey, { useFullscreenElement } from './hooks/useFullscreenKey';
import { fullscreenElement, enterFullscreen, canFullscreen } from './utils/fullscreen';
import usePresentControls from './present/presentControls';
import Button from './components/ui/Button';
import Eyebrow from './components/ui/Eyebrow';
import './present/present.css';

// THE BUILD ROOM'S WINDOW (parity PLAN §2.4): its own chunk, reached before
// usePresentation starts, whose reads and frames are Call & Answer's.
const BuildWall = lazy(() => import('./present/buildwall/BuildWall'));

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

/**
 * What the fitter re-runs on. The results rows are in it (walk of dev
 * 26af5fc8, F1): they land after the moment does, and without them the wall
 * was fitted to "Counting the votes" and never again.
 */
/** Opened by the host's "Room's window" on the other display (present/roomWindow.js). */
function placedFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('placed') === '1';
  } catch (e) {
    return false;
  }
}

/**
 * ONE CLICK FILLS THE SCREEN on a window the host placed on the other display.
 * A page may only go full screen from a click inside itself, so this is the
 * one step placing cannot do. The click goes no further (capture phase), so it
 * does not also take the join code down. F still works, as everywhere.
 */
export function useClickToFill(on) {
  useEffect(() => {
    if (!on || !canFullscreen()) return undefined;
    const onClick = (e) => {
      if (fullscreenElement()) return;
      e.stopPropagation();
      e.preventDefault();
      enterFullscreen(document.documentElement);
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [on]);
}

/**
 * THE CUE FOR THAT ONE CLICK (owner, 18 Oct 2026: the placed window "wasnt
 * fullscreen. i have to click that window and press f"; nothing said one
 * click would do). Shown only on a window the host placed, only until it is
 * full screen. The room may glimpse it while the host is setting up.
 */
export const FILL_CUE = 'Click anywhere to fill the screen';
export function FillCue({ placed }) {
  const full = useFullscreenElement();
  if (!placed || full || !canFullscreen()) return null;
  // data-theme="dark": the cue sits outside the wall's own scope, so it re-enters
  // the dusk tokens itself (a light page drew it white; walk of dev 173fc2f6).
  return <p className="present-fillcue" data-theme="dark" role="status">{FILL_CUE}</p>;
}

export function presentFitKey(model) {
  const rows = Array.isArray(model.rows) ? model.rows.map((r) => (r && (r.idea || r.label)) || '').join('\u241E') : '';
  // The voting overview's answers and the QR panel change the layout too.
  const answers = Array.isArray(model.answers) ? model.answers.map((a) => (a && a.text) || '').join('\u241E') : '';
  const join = model.join ? 'qr' : '';
  return [model.moment, model.index, model.part, model.page, model.text, model.content, model.title, model.joined, rows, model.more, model.task, answers, join]
    .map((x) => (x === undefined ? '' : String(x))).join('|');
}

function paramFromUrl(name) {
  try {
    return new URLSearchParams(window.location.search).get(name) || '';
  } catch (e) {
    return '';
  }
}

/** The Build Room's window: the wall, placed and filled as the Presentation is. */
function BuildWallPage({ gameId, k }) {
  useFullscreenKey();
  const placed = useMemo(placedFromUrl, []);
  useClickToFill(placed);
  return (
    <>
      <Suspense fallback={null}>
        <BuildWall gameId={gameId} k={k} />
      </Suspense>
      <FillCue placed={placed} />
    </>
  );
}

/** `type=build` is the Build Room's wall; anything else, the Presentation. */
export default function PresentPage() {
  const route = useMemo(() => ({ gameId: gameIdFromUrl(), type: paramFromUrl('type'), k: paramFromUrl('k') }), []);
  if (route.type === 'build') return <BuildWallPage gameId={route.gameId} k={route.k} />;
  return <CallPresentPage />;
}

function CallPresentPage() {
  const gameId = useMemo(gameIdFromUrl, []);
  const { snapshot, reads, refetch } = usePresentation(gameId);
  const model = gameId ? presentModel(snapshot, reads) : { moment: 'NOT_FOUND', profile: 'room' };
  useFullscreenKey();
  const placed = useMemo(placedFromUrl, []);
  useClickToFill(placed);
  // Forward and back with the keys or a clicker, for a host who may drive
  // this session (present/presentControls.js); the room's own view is unchanged.
  const total = Number.isInteger(model.total) && model.total > 0
    ? model.total
    : Number(snapshot && snapshot.roomCounts && snapshot.roomCounts.answered) || 0;
  // Does every answer fit the voting overview? Decided once, in the model
  // (config/roomContent.js overviewFits), so the keys and the wall agree.
  const overview = Boolean(model.overview);
  const controls = usePresentControls({
    gameId, snapshot, total, overview, refetch, notesReady: model.moment !== 'READ_WAIT',
  });
  // A CLICK ANYWHERE TAKES THE QR DOWN (owner, 2026-10-13), as J does, for a
  // host who may drive the session; the strip and the ask keep their own.
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

  const fitKey = presentFitKey(model);

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
          {controls.joinShown ? 'Hide QR (J)' : 'Show QR (J)'}
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
    <>
      <PresentStage profile={model.profile} fitKey={fitKey} overlay={<>{overlay}{strip}{ask}</>} fitcheck={fitcheckOn()}>
        <PresentMoment model={model} />
        <PhaseWipe moment={model.moment} />
      </PresentStage>
      <FillCue placed={placed} />
    </>
  );
}
