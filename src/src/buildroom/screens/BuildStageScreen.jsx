/**
 * STAGE: what the room reads during an ask, drawn by the regular host stage's
 * own parts (components/stage/: Stage, Rail, RoomMeter, Dock), so a Build Room
 * ask looks and behaves like any other session on the projector: the same
 * display profiles and fitter, the phase chip and join code in the rail, the
 * count in the meter. Everything on it is room-safe (stageModel).
 *
 * A DISPLAY COMPONENT (parity PLAN §2.5, B6): `room`, `now`, what the room is
 * shown (`show`: the crew board, the codes card, the host's pick) and, on one
 * screen only, the host's `controls`. With none (the room's window, B7) it
 * renders no button and nothing pressable. `profile` is the room's window's:
 * the server's `wall.profile`; without it the browser's stored choice.
 *
 * THE DOCK IS CALL & ANSWER'S (§2.6, §2a D1-D2): the shared Dock with the
 * shared HostActionBar reading buildControls, so Space, →, the clicker and
 * "press twice, in place" are C&A's; the moment's status on the left, its
 * moves, the SPACE cap, then HOST and SESSION fixed at the right edge.
 * Nothing in it appears on hover. HOST goes to the Host screen in one press,
 * always; what waits is a count on it (the list is the Host screen's Waiting
 * for you, and the Build / History header tab's).
 *
 * At results the host decides here: Send B to Claude sends the room's choice,
 * Change before sending opens the send window (StageDecide), and a click on an
 * option or a wheel slice opens that window with the pick made (owner,
 * 2026-10-08).
 *
 * controls: {
 *   busy, run, api, draft, highlight, onSent,
 *   onPick(id)            a pick on the board while the room still answers (asks first),
 *   onHideCodes, onTakeDown, onPointLater, onPointsMove, onRunNext(force), onRunSkip, onRunStop,
 *   onHost, alert         HOST and its count (hostAlert),
 *   onSession, panelOpen, askingCount,
 *   overlayOpen           a dialog of the page is up: the keys are its,
 * }
 */
import React, {
  useCallback, useEffect, useState,
} from 'react';
import Stage from '../../components/stage/Stage';
import Rail from '../../components/stage/Rail';
import RoomMeter from '../../components/stage/RoomMeter';
import Dock from '../../components/stage/Dock';
import HostActionBar from '../../components/HostActionBar';
import Icon from '../../components/Icon';
import { loadProfile } from '../../config/displayProfile';
import { useRosterMode, rosterRevealFor } from '../../hooks/useRosterReveal';
import { joinedRoster } from '../../config/anonymity';
import BuildWheel from '../BuildWheel';
import BuildStageDecide from '../BuildStageDecide';
import { WallBrief } from '../BuildOpening';
import { PointStage } from '../BuildPointStage';
import { RunStage } from '../BuildRun';
import { CrewBoard, EarlyLook, featuredShare } from '../BuildCrew';
import { WallCodes, wifiLink, demoOnStage } from '../BuildWifiShare';
import { dialogOpen } from '../useNextFocus';
import {
  stageModel, isPointsVote, sentStageAsk, sentOf,
} from '../buildScreens';
import { buildControls } from '../buildControls';
import useStageMoves from '../useStageMoves';
import { safeHref } from '../links';
import { W } from '../words';
import {
  liveBuildLink, WallComment, freshWallComment,
} from './common';
import { AskStage } from './AskStage';
import { IdleStage } from './StageIdle';
import { QrZoom } from './QrZoom';
import ClaudeStatus from './ClaudeStatus';
import { buildMomentOf, buildRoomContent } from '../roomContentData';
import { optionPageSizeFor } from '../../config/stagePaging';
import { textOf } from '../../config/roomContent';

const none = () => undefined;

/** The ask on the Stage: the current one while the room answers, votes, or sees its results. */
export const stageAsk = (room) => ((room && room.asks) || [])
  .find((a) => a.askId === room.currentAskId && ['live', 'voting', 'results'].includes(a.status)) || null;

/**
 * A key the bar leaves to the page: anything inside a dialog or while one is
 * open, and Space on a focused control (the browser presses that control; on
 * the main button itself, that is the same press).
 */
function keepKey(e) {
  if (dialogOpen()) return true;
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return false;
  if (t.closest('[role="dialog"]')) return true;
  return e.key === ' ' && Boolean(t.closest('button, a, [role="button"]'));
}

/**
 * HOST (D2, owner 17 Oct 2026: "it is unclear how to get back to host"):
 * always the Host screen, in one press. The count rides on it as a badge, its
 * slot kept when empty so the main button beside it never moves; amber while
 * Claude waits on the host. Fixed words and a number only: the room reads it.
 */
function HostHome({ alert, onHost }) {
  const count = (alert && alert.count) || 0;
  const tone = count > 0 ? (alert.amber ? ' brm-hostalert--amber' : ' brm-hostalert--grey') : '';
  return (
    <button
      type="button"
      className={`dock-more brm-hostalert brm-hostalert--stage brm-hosthome${tone}`}
      onClick={onHost}
      title={W.hostKeys}
      aria-label={count > 0 ? `${W.hostScreen},${W.hostWaitingSr(count)}` : W.hostScreen}
      aria-keyshortcuts="1 P"
      data-capability="host-alert"
    >
      <span className="dock-more-lbl">{W.hostBack}</span>
      <span className="brm-hostalert-n" aria-hidden="true" data-off={count > 0 ? undefined : ''}>
        <span className="c">{count}</span>
      </span>
    </button>
  );
}

export default function BuildStageScreen({
  room, now, show = {}, controls = null, profile: wallProfile = null,
}) {
  const c = controls;
  const { crewOn = false, codesUp = false, pickId = null } = show;
  const ended = room.state === 'ENDED';
  const current = stageAsk(room);
  const crew = room.crew && room.crew.enabled ? room.crew : null;
  const onWall = crewOn && crew ? featuredShare(crew) : null;
  // The host's page sizes the Stage per browser; the room's window takes the server's (§2.3).
  const [storedProfile] = useState(() => loadProfile(window.localStorage, window.innerWidth));
  const profile = wallProfile || storedProfile;
  // One code enlarged alone: the rail's join code, or either code on the codes card.
  const [zoom, setZoom] = useState(null); // 'join' | 'demo'
  const demoLink = wifiLink(room);
  // The picks wait for the wheel to stop (a wheel already still on arrival is settled).
  const spinsOf = (current && current.wheel && current.wheel.spins) || [];
  const lastSpinId = spinsOf.length ? spinsOf[spinsOf.length - 1].spinId : null;
  const [settledSpin, setSettledSpin] = useState(lastSpinId);
  const wheelTurning = Boolean(lastSpinId && lastSpinId !== settledSpin);
  const both = codesUp && demoOnStage(room, now, demoLink);
  const bar = c ? buildControls(room, current, now, {
    crewOn, draft: c.draft || null, turning: wheelTurning, highlight: c.highlight, codesUp, codesBoth: both, busy: Boolean(c.busy),
  }) : null;
  const m = bar ? bar.model : stageModel(room, current, now, { crewOn, turning: wheelTurning });
  const [editing, setEditing] = useState(false);
  const [editPick, setEditPick] = useState(null); // an option clicked on the board
  // The window belongs to one ask at results: it goes when that ask moves on.
  // A vote made from points settles by highlight (T6), not by the send window.
  const pointsVote = Boolean(current && isPointsVote(current) && !current.wheel && !current.revotedAs);
  const editable = Boolean(c && current && current.status === 'results' && !ended && !crewOn && !pointsVote);
  const editKey = current ? `${current.askId}:${current.status}` : '';
  useEffect(() => { setEditing(false); setEditPick(null); }, [editKey]);
  // A LONG ASK PAGES ITS OPTIONS (room content, owner 17 Oct 2026): ↑ ↓ on the
  // host's Stage; the room's window shows the first page and counts the rest.
  const [optPage, setOptPage] = useState(0);
  useEffect(() => { setOptPage(0); }, [editKey, profile]);
  const liveLink = safeHref(liveBuildLink(room, now));
  // A click on an option or a wheel slice at results opens the send window
  // with that pick made; while the room is still answering it asks first, as before.
  const boardPick = (id) => {
    if (editable) { setEditPick(id); setEditing(true); return; }
    if (c && c.onPick) c.onPick(id);
  };
  const doMove = useStageMoves({
    current,
    draft: c ? c.draft : null,
    busy: Boolean(c && c.busy),
    run: c ? c.run : none,
    api: c ? c.api : null,
    wheelTurning,
    editable,
    onEdit: useCallback(() => setEditing(true), []),
    onSent: c ? c.onSent : none,
    onHideCodes: c ? c.onHideCodes : none,
    onTakeDown: c ? c.onTakeDown : none,
    onPointLater: c ? c.onPointLater : none,
    onPointsMove: c ? c.onPointsMove : none,
    onRunNext: c ? c.onRunNext : none,
    onRunSkip: c ? c.onRunSkip : none,
    onRunStop: c ? c.onRunStop : none,
  });
  // Escape takes the codes down too, as the card it replaced did; never while a dialog is up.
  const onHideCodes = c ? c.onHideCodes : null;
  useEffect(() => {
    if (!codesUp || !onHideCodes) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || dialogOpen()) return;
      onHideCodes();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [codesUp, onHideCodes]);
  // WHO IS IN THE ROOM, on hover (owner, 2026-10-07): the regular stage's
  // lobby list, the same hover, focus, pin and Escape. Only while no ask is
  // up: the list is the joined set, and an ask phase names the waiting set.
  const [rosterMode, setRosterMode] = useRosterMode();
  const { reveal, handlers } = rosterRevealFor(rosterMode, setRosterMode, `IDLE#${room.currentAskId || (room.asks || []).length}`);
  // A pinned list does not outlive the quiet moment it was asked for: when an
  // ask is up it is put away, and it is not there when the ask ends.
  const askUp = Boolean(m.phase);
  useEffect(() => { if (askUp) setRosterMode(null); }, [askUp, setRosterMode]);
  const joined = m.phase ? null : joinedRoster({ players: (room.players || []).map((name) => ({ name })) });
  // OFF BY DEFAULT (owner, 2026-10-09): the meter lists who has joined only when
  // the host turned "List names on the room meter" on in the Session panel.
  const listNames = Boolean(room.settings && room.settings.listNames);
  const joinedWaiting = c && joined && listNames ? { names: joined, mode: reveal, ...handlers } : null;
  const meterBody = m.meter.of === null ? String(m.meter.count) : <>{m.meter.count}<small>{` / ${m.meter.of}`}</small></>;
  const playUrl = `${window.location.origin}/play?gameId=${room.gameId}`;
  const pickable = Boolean(c) && !ended && !codesUp && !crewOn && Boolean(current) && !pointsVote;
  // FRAME 8 (docs/design/room-content-v2, owner 18 Oct 2026): once the host
  // sends the room's decision, its result stays up with the "Sent to Claude"
  // band until Claude says what it is doing (the one I9 state); then the work
  // row (I10). Drawn only: the host's moves are the quiet moment's, as before.
  const sentAsk = !current && !codesUp && !crewOn && !ended ? sentStageAsk(room, now) : null;
  const shownAsk = current || sentAsk;
  // WHAT THE ROOM SEES (config/roomContent.js): the same call on one screen and on the room's window.
  const momentNow = buildMomentOf({
    current: codesUp || crewOn ? null : shownAsk,
    wheel: Boolean(current && m.wheel),
    point: m.point || null,
    run: m.run || null,
    showing: Boolean(codesUp || crewOn || (!shownAsk && room.opening && room.opening.phase === 'opening')),
  });
  const rc = buildRoomContent(momentNow, profile, room, codesUp || crewOn ? null : shownAsk, now);
  const optSize = shownAsk ? optionPageSizeFor(profile, shownAsk.options, {
    height: window.innerHeight, results: !['live', 'voting'].includes(shownAsk.status),
  }) : 0;
  const sentWords = sentAsk ? (sentOf(room) || {}).text || '' : '';
  // Claude's line changes height as its words change: the fitter measures again.
  const claudeNow = textOf(rc, 'claude') || {};
  const claudeKey = [claudeNow.headline, claudeNow.dur, claudeNow.helperLine].join('/');
  let content;
  if (codesUp) {
    content = <WallCodes room={room} now={now} link={demoLink} onZoom={c ? setZoom : null} />;
  } else if (crewOn) {
    content = (
      <>
        {onWall && <EarlyLook key={onWall.shareId} share={onWall} crew={crew} host={false} stage />}
        <CrewBoard crew={crew} host={false} now={now} busy={Boolean(c && c.busy)} run={c ? c.run : none} api={c ? c.api : null} onOpen={none} playerCount={room.playerCount} />
      </>
    );
  } else if (current && m.wheel) {
    content = (
      <section className="brm-stage brm-wheelstage" aria-label="The wheel">
        <span className="brm-eyebrow"><b>The wheel</b> · Ask {Number(current.askId) || current.askId}</span>
        <h2 className="brm-q">{current.prompt}</h2>
        <BuildWheel wheel={current.wheel} size="lg" onSettled={setSettledSpin} />
        {/* SAME GOES FOR SPIN (owner, 2026-10-06): after it lands, the host may
            take the wheel's pick or an alternate, with the same question. */}
        {pickable && current.wheel.landed && !wheelTurning && (
          <div className="brm-wheelpicks" role="group" aria-label="Pick">
            {(current.wheel.slices || []).map((sl) => (
              <button key={sl.id} type="button" className={`brm-btn${sl.id === current.wheel.landed ? ' is-landed' : ''}`} onClick={() => boardPick(sl.id)}>
                {sl.label ? `${sl.label} · ` : ''}{sl.text}
              </button>
            ))}
          </div>
        )}
      </section>
    );
  } else if (shownAsk) {
    content = (
      <AskStage
        key={`${shownAsk.askId}:${shownAsk.status}`}
        ask={shownAsk}
        room={room}
        host={false}
        busy={Boolean(c && c.busy)}
        ended={ended}
        run={c ? c.run : none}
        api={c ? c.api : null}
        pickId={editPick || pickId}
        onPick={pickable ? boardPick : null}
        rc={rc}
        paging={{
          size: optSize, page: optPage, onPage: c ? setOptPage : null, enabled: Boolean(c) && !editing && !zoom && !c.overlayOpen,
        }}
      />
    );
  } else if (room.opening && room.opening.phase === 'opening') {
    // THE OPENING (O3): between steps, the wall reads back the brief so far.
    content = <WallBrief room={room} />;
  } else if (m.point) {
    content = <PointStage point={m.point} />;
  } else if (m.run) {
    content = <RunStage run={m.run} />;
  } else {
    content = <IdleStage room={room} now={now} host={false} />;
  }
  // FIXED SLOTS (§2a): one line of status with its words in the title; the
  // build's link on a second line whose height is kept when there is none.
  const status = (
    <span className="brm-dockstat">
      <span className="brm-dockstat-t" title={m.status || undefined}>{m.status}</span>
      <span className="brm-dockstat-link">
        {/* A small link, not a button: it must never compete with the main button. */}
        {liveLink && <a className="brm-dockbuild" href={liveLink} target="_blank" rel="noopener noreferrer" title="Opens in a new tab"><Icon name="ArrowSquareOut" size={14} /> {W.openBuildTab}</a>}
      </span>
    </span>
  );
  const shortcutsOn = Boolean(c) && !editing && !zoom && !c.overlayOpen;
  const kbd = bar && bar.primary && !bar.primary.disabled && shortcutsOn ? 'SPACE' : '';
  return (
    <>
      <Stage
        profile={profile}
        phase={m.phase || ''}
        fitKey={[shownAsk ? `${shownAsk.askId}:${shownAsk.status}:${shownAsk.answerCount}:${shownAsk.voteCount}:${shownAsk.wheel ? shownAsk.wheel.spins.length : 0}:${optPage}` : 'idle', crewOn ? 'crew' : '', codesUp ? `codes:${both}` : '', claudeKey, sentWords].join('|')}
        rail={(
          <Rail
            phase={m.phase}
            title={room.title || 'Build Room'}
            context={m.context}
            join={ended
              ? { code: room.gameId, closed: true }
              : c
                ? { url: `${window.location.host}/play`, code: room.gameId, onPreview: none, onPreviewEnd: none, onPin: () => setZoom('join') }
                : { url: `${window.location.host}/play`, code: room.gameId }}
          />
        )}
        meter={codesUp ? null : <RoomMeter phase={m.phase || 'LOBBY'} heading={m.meter.heading} body={meterBody} waiting={joinedWaiting} />}
        dock={c ? (
          <Dock
            data-capability={bar.primary ? 'ask-moves' : undefined}
            status={status}
            kbd={kbd}
            home={<HostHome alert={c.alert} onHost={c.onHost} />}
            onSetup={c.onSession}
            setupCount={c.askingCount || 0}
            setupCountLabel={W.askingSr}
            setupOpen={Boolean(c.panelOpen)}
            setupProps={{ 'data-capability': 'settings' }}
          >
            <HostActionBar controls={bar} onAction={doMove} bigScreen shortcutsEnabled={shortcutsOn} ignoreKey={keepKey} />
          </Dock>
        ) : <Dock status={status} />}
      >
        <div className="content" data-capability={pickable ? 'board-pick' : undefined} data-room-moment={momentNow}>
          <div className="fitbox">
            {content}
            {/* Claude's status, essential on every screen the room sees (owner, 17 Oct
                2026); between asks the IdleStage above IS that status, so not twice. */}
            {momentNow !== 'BUILD_IDLE' && <ClaudeStatus rc={rc} sent={sentWords} />}
          </div>
        </div>
      </Stage>
      <WallComment comment={freshWallComment(room, now)} />
      {c && editing && editable && (
        <BuildStageDecide key={`${current.askId}:${editPick || ''}`} initialPick={editPick} draft={c.draft || null} onSent={c.onSent} ask={current} busy={c.busy} run={c.run} api={c.api} onClose={() => { setEditing(false); setEditPick(null); }} />
      )}
      {c && zoom === 'join' && <QrZoom playUrl={playUrl} gameId={room.gameId} onClose={() => setZoom(null)} />}
      {c && zoom === 'demo' && demoLink && <QrZoom demoLink={demoLink} onClose={() => setZoom(null)} />}
    </>
  );
}
