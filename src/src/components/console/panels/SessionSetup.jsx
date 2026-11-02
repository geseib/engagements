import React, { useEffect, useId, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Icon from '../../Icon';
import RoomScreenChooser from '../../stage/RoomScreenChooser';
import { RoomWindowTab } from '../../stage/RoomWindowLink';
import { DISPLAY_PROFILES } from '../../stage/ScreensGroup';
import { SCREEN_WORDS } from '../../../config/roomScreen';
import { presentStatusFrom } from '../../../config/presentStatus';
import { willPlace } from '../../../present/roomWindow';
import {
  SETUP_WORDS as W, stepNumber, recentArrivals, windowChecklist,
} from '../../../config/sessionSetup';
import './SessionSetup.css';

/**
 * SETUP IS THE LOBBY (docs/design/session-start D1, frames A1-A8; experience
 * plan Phase 2 step 2b). Start opens this, in both modes. Three steps, the
 * open one drawn in full, the done ones folded to one line with Change, the
 * later ones dimmed with what they will do:
 *
 *   1  Where the room watches   RoomScreenChooser, unchanged, moved in here
 *   2  Put the room's screen up two screens: the window checklist (open, full
 *                               screen) and the size; one screen: a check, the
 *                               size, and the Remote's address as text (F8)
 *   3  The room joins           the count (the panel's one 30px numeral), who
 *                               arrived in the last minute, named, and round 1
 *
 * The join code is not drawn until step 3: the preview column is dimmed and
 * says "Nothing yet" (D1). The main button is never here: Your part now owns
 * it (the page passes Setup's own control there for steps 1 and 2).
 *
 * `mid`: Setup pressed in the strip mid-session. The same panel, with step 3
 * folded, so the screen the owner likes is the same screen at the start and
 * in the middle (D1 "Setup in the strip stays").
 *
 * Data and callbacks only; the page owns the session.
 */
function useMinuteClock(fixed) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (fixed !== null && fixed !== undefined) return undefined;
    const t = setInterval(() => setNow(Date.now()), 10 * 1000);
    return () => clearInterval(t);
  }, [fixed]);
  return fixed !== null && fixed !== undefined ? fixed : now;
}

function StepHead({ n, state, title, value = '', note = '', onChange = null }) {
  const stateWord = state === 'done' ? W.stateDone : state === 'now' ? W.stateNow : W.stateLater;
  return (
    <div className="hsetup-head">
      <span className={`hsetup-num is-${state}`} aria-hidden="true">
        {state === 'done' ? <Icon name="Check" weight="bold" size={14} color="currentColor" /> : n}
      </span>
      <h3 className="hsetup-h">
        <span className="hsetup-sr">{`${W.stepOf(n, stateWord)}: `}</span>
        {title}
      </h3>
      {value ? <span className="hsetup-val">{value}</span> : null}
      {note ? <span className="hsetup-note">{note}</span> : null}
      {onChange ? <button type="button" className="hsetup-change" onClick={onChange}>{W.change}</button> : null}
    </div>
  );
}

function SizeSelect({ profile, onProfileChange }) {
  const id = useId();
  return (
    <div className="hsetup-size">
      <label className="hsetup-k" htmlFor={id}>{SCREEN_WORDS.size}</label>
      <select id={id} className="hsetup-select" value={profile} onChange={(e) => onProfileChange(e.target.value)}>
        {DISPLAY_PROFILES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <span className="hsetup-hint">{SCREEN_WORDS.sizeHint}</span>
    </div>
  );
}

function WindowChecklist({ detail, href, blocked, nowMs }) {
  const items = windowChecklist(detail, nowMs);
  const closed = items[0].state !== 'done';
  const windowed = presentStatusFrom(detail, nowMs).state === 'windowed';
  return (
    <>
      {blocked && closed ? <p className="hsetup-warn" role="status">{W.blocked}</p> : null}
      <ul className="hsetup-checks" aria-label={W.windowDone}>
        {items.map((it) => (
          <li key={it.id} className={`hsetup-check is-${it.state}`} data-check={it.id} data-state={it.state}>
            <span className="hsetup-mark" aria-hidden="true">
              {it.state === 'done' ? <Icon name="CheckCircle" weight="fill" size={18} color="currentColor" />
                : it.state === 'wait' ? <Icon name="WarningCircle" weight="bold" size={18} color="currentColor" />
                  : <Icon name="Circle" weight="bold" size={18} color="currentColor" />}
            </span>
            <span className="hsetup-check-l">{it.label}</span>
            {it.hint ? <span className="hsetup-hint">{it.hint}</span> : null}
          </li>
        ))}
      </ul>
      {windowed ? <p className="hsetup-p"><b>{W.draggedHere}</b> {W.dragHint}</p> : null}
      {closed && !willPlace() && href ? (
        <p className="hsetup-p">
          <RoomWindowTab className="hsetup-inline" href={href} />
          {' '}{SCREEN_WORDS.noSecondDisplay}
        </p>
      ) : null}
    </>
  );
}

function Joins({ players, nowMs, firstUp, onRunningOrder }) {
  const names = players.map((p) => (p && (p.name || p.playerName)) || '').filter(Boolean);
  const recent = recentArrivals(players, nowMs);
  const recentSet = new Set(recent);
  return (
    <div className="hsetup-joins">
      <p className="hsetup-count" aria-live="polite">
        <b className="hsetup-numeral">{names.length}</b>
        <span className="hsetup-count-l">{W.inTheRoom}</span>
        {recent.length ? (
          <span className="hsetup-recent" title={recent.join(', ')}>{` · ${W.justArrived(recent.length)} ${recent.join(', ')}`}</span>
        ) : null}
      </p>
      {names.length ? (
        <ul className="hsetup-names">
          {/* Two people can share a name: key by position as well. */}
          {names.map((n, i) => <li key={`${i}-${n}`} className={recentSet.has(n) ? 'is-new' : undefined}>{n}</li>)}
        </ul>
      ) : <p className="hsetup-hint">{W.nobodyYet}</p>}
      {firstUp ? (
        <p className="hsetup-first">
          <span className="hsetup-k">{W.firstUp}</span>
          <b className="hsetup-first-t" title={firstUp}>{firstUp}</b>
          {onRunningOrder ? <button type="button" className="hsetup-change" onClick={onRunningOrder}>{W.runningOrder}</button> : null}
        </p>
      ) : null}
    </div>
  );
}

function Preview({ two, step, title, count, joinUrl, code, detail, nowMs }) {
  const live = step === 'joins';
  if (!two) {
    return (
      <aside className="hsetup-preview" aria-label={W.previewK}>
        <p className="hsetup-k">{W.previewK}</p>
        <div className="hsetup-room is-whole">
          <p className="hsetup-room-t">{W.previewWholeScreen}</p>
          <p className="hsetup-hint">{W.previewWholeLine}</p>
        </div>
      </aside>
    );
  }
  const status = presentStatusFrom(detail, nowMs);
  return (
    <aside className="hsetup-preview" aria-label={live ? W.previewK : W.previewKBefore}>
      <div className="hsetup-preview-k">
        <p className="hsetup-k">{live ? W.previewK : W.previewKBefore}</p>
        <span className={`hsetup-stat is-${status.tone}`}>{status.short}</span>
      </div>
      <div className={`hsetup-room${live ? ' is-live' : ' is-dim'}`} data-live={live ? '1' : '0'}>
        <div className="hsetup-room-about">
          <p className="hsetup-room-t" title={title}>{title}</p>
          <p className="hsetup-hint">{W.inRoom(count)}</p>
        </div>
        {/* THE JOIN CODE ONLY AT STEP 3 (D1): before it, a blank square, never a code. */}
        {live && joinUrl ? (
          <div className="hsetup-qr" data-testid="setup-qr" aria-label="QR code to join">
            <QRCodeSVG value={joinUrl} size={112} level="M" includeMargin={false} />
            <span className="hsetup-qr-code">{code}</span>
          </div>
        ) : <div className="hsetup-qr is-blank" aria-hidden="true" />}
      </div>
      <p className="hsetup-hint">{live ? W.lateJoin : (step === 'screen' ? W.previewOpens : W.nothingYet)}</p>
    </aside>
  );
}

export default function SessionSetup({
  step = 'where', choice = null, choosing = false, mid = false,
  onChoose = () => {}, onChange = null, onKeep = null, onRecheck = null,
  presentHref = '', presentDetail = null, blocked = false,
  profile = 'room', onProfileChange = () => {},
  players = [], title = '', code = '', joinUrl = '',
  firstUp = '', onRunningOrder = null,
  remoteAddr = '', onUseTwo = null,
  now: fixedNow = null,
}) {
  const nowMs = useMinuteClock(fixedNow);
  const two = choice === 'two';
  const at = stepNumber(step);
  const stateOf = (id) => {
    const n = stepNumber(id);
    if (mid && id === 'joins' && step === 'joins') return 'done';
    return n < at ? 'done' : n === at ? 'now' : 'later';
  };
  const status = presentStatusFrom(presentDetail, nowMs);
  const sizeName = (DISPLAY_PROFILES.find(([v]) => v === profile) || ['', ''])[1];

  const where = stateOf('where');
  const screen = stateOf('screen');
  const joins = stateOf('joins');

  return (
    <section className={`hsetup${mid ? ' is-mid' : ''}`} aria-label={W.label} data-at={step} data-mode={two ? 'two' : (choice ? 'one' : 'unset')}>
      <ol className="hsetup-steps">
        <li className={`hsetup-step is-${where}`} data-step="where" data-state={where}>
          <StepHead
            n={1}
            state={where}
            title={where === 'done' ? W.whereDone : W.whereOpen}
            value={where === 'done' ? (two ? W.twoScreens : W.oneScreen) : ''}
            onChange={where === 'done' ? onChange : null}
          />
          {where === 'now' ? (
            <div className="hsetup-body">
              {/* `quiet`: Your part now holds the one orange move (D1); the two
                  choices are its answer, not a second main button. */}
              <RoomScreenChooser
                embedded
                quiet
                current={choosing ? choice : null}
                presentHref={presentHref}
                onChoose={onChoose}
                onClose={choosing && choice ? onKeep : null}
              />
            </div>
          ) : null}
        </li>

        <li className={`hsetup-step is-${screen}`} data-step="screen" data-state={screen}>
          <StepHead
            n={2}
            state={screen}
            title={screen === 'done'
              ? (two ? W.windowDone : W.checkDone)
              : (choice === 'classic' ? W.checkOpen : W.windowOpen)}
            value={screen === 'done' ? (two ? status.short : W.checked) : ''}
            note={screen === 'later' ? W.after(1) : (screen === 'done' && sizeName ? sizeName : '')}
            onChange={screen === 'done' && !two ? onRecheck : null}
          />
          {screen === 'now' && two ? (
            <div className="hsetup-body">
              <WindowChecklist detail={presentDetail} href={presentHref} blocked={blocked} nowMs={nowMs} />
              <SizeSelect profile={profile} onProfileChange={onProfileChange} />
            </div>
          ) : null}
          {screen === 'now' && !two ? (
            <div className="hsetup-body">
              <p className="hsetup-banner" role="note">
                <Icon name="Eye" weight="bold" size={18} color="currentColor" />
                {W.roomSeesThis}
              </p>
              <SizeSelect profile={profile} onProfileChange={onProfileChange} />
              {/* F8: the Remote's address as TEXT, never a second QR on the room's screen. */}
              {remoteAddr ? (
                <p className="hsetup-p" data-testid="setup-remote">
                  <b>{W.remoteK}</b> {W.remoteText(remoteAddr, code)}
                </p>
              ) : null}
            </div>
          ) : null}
        </li>

        <li className={`hsetup-step is-${joins}`} data-step="joins" data-state={joins}>
          <StepHead
            n={3}
            state={joins}
            title={W.joins}
            value={joins === 'done' ? W.inRoom(players.length) : ''}
            note={joins === 'later' ? (two ? W.codeHereTwo : (choice === 'classic' ? W.codeHereOne : W.codeHere)) : ''}
          />
          {joins === 'now' ? (
            <div className="hsetup-body">
              <Joins players={players} nowMs={nowMs} firstUp={firstUp} onRunningOrder={onRunningOrder} />
            </div>
          ) : null}
        </li>
      </ol>

      <div className="hsetup-side">
        {choice ? (
          <Preview two={two} step={step} title={title} count={players.length} joinUrl={joinUrl} code={code} detail={presentDetail} nowMs={nowMs} />
        ) : (
          <aside className="hsetup-preview" aria-label={W.previewKBefore}>
            <p className="hsetup-k">{W.previewKBefore}</p>
            <div className="hsetup-room is-dim">
              <div className="hsetup-room-about">
                <p className="hsetup-room-t" title={title}>{title}</p>
                <p className="hsetup-hint">{W.inRoom(players.length)}</p>
              </div>
              <div className="hsetup-qr is-blank" aria-hidden="true" />
            </div>
            <p className="hsetup-hint">{W.nothingYet}</p>
          </aside>
        )}
        {!two && choice === 'classic' && onUseTwo && step !== 'joins' ? (
          <p className="hsetup-hint">
            {W.useTwoInstead}{' '}
            <button type="button" className="hsetup-change" onClick={onUseTwo}>{W.useTwo}</button>
          </p>
        ) : null}
        {mid ? <p className="hsetup-hint">{W.midNote}</p> : null}
      </div>
    </section>
  );
}
