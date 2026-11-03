import React from 'react';
import Icon from './Icon';
import Button from './ui/Button';
import HelpButton from './HelpButton';
import { helpFor } from '../config/help/screens';
import SessionSetup from './console/panels/SessionSetup';
import './SetupBeforeStart.css';

/**
 * WHERE A NEW SESSION LANDS: ITS OWN SETUP, READY TO START (experience plan
 * §3.1, §6 Phase 4 step 4c; the owner's decision 7, 1 Nov 2026: "Every format
 * lands on its own Setup, with Start there").
 *
 * Before this, New engagement had four landings (audit E N1): a round type in
 * the Sessions list ("Created … press Start"), a survey opened and live at
 * once, Quick start live at once, a Build Room on its room. Now a session of
 * any round type, and a survey, lands here: the session's name, format, set
 * and code; one main button, Start (Open the survey, for a survey), said for
 * what it will do; and Edit, so the owner's "edit before it starts" happens
 * where the host already is (it used to be ⋯ › Edit on a list row).
 *
 * SETUP, NOT A SECOND LOBBY. The body is Setup itself (SessionSetup, 2b's
 * lobby panel) in its `before` state: step 1, where the room watches, can be
 * chosen now, and Start opens with that choice (two screens opens the room's
 * window inside the press). Steps 2 and 3 say "after Start", because nobody
 * can join a session that has not started (session-gate.js) and the join
 * code goes up only at step 3 (D1). Start puts the session in the live frame
 * at Setup's next step, the 2b flow unchanged from there. A survey has no
 * lobby, so it has no steps: one line says what Open does.
 *
 * A PAGE, LIKE HOME: dusk, declared on the root; Main menu (House) top left,
 * the `?` top right (§3.6). Data and callbacks only; the page owns the
 * session. Laptop ladder 12 / 13 / 15 / 19 / 24 px (SetupBeforeStart.css).
 */
export const BEFORE_START_WORDS = Object.freeze({
  mainMenu: 'Main menu',
  kicker: 'Setup · not started',
  edit: 'Edit',
  invite: 'Invite',
  starting: 'Starting…',
  code: (code) => `Code ${code}`,
  waiting: 'Created. Nobody can join until you start it.',
  waitingSurvey: 'Created. Nobody can answer until you open it.',
  editLine: 'You can still edit it until then.',
  surveyLine: 'Opening it lets people answer straight away, at their own pace. A survey has no lobby.',
});

export default function SetupBeforeStart({
  title = '',
  code = '',
  formatLabel = '',
  setName = '',
  survey = false,
  /** Setup's steps apply (a round type; config/surfaces.js SETUP_TYPES). */
  steps = true,
  startLabel = 'Start',
  onStart,
  onEdit = null,
  onInvite = null,
  onMainMenu,
  busy = false,
  notice = '',
  /* Setup's step 1, as the live frame passes it. */
  choice = null,
  choosing = false,
  oneOnly = '',
  onChoose = () => {},
  onChange = null,
  onKeep = null,
  presentHref = '',
  profile = 'room',
  onProfileChange = () => {},
}) {
  const W = BEFORE_START_WORDS;
  const name = title || 'Untitled session';
  return (
    <div className="sbs" data-theme="dark" data-testid="setup-before-start">
      <header className="sbs-top">
        {/* The §5.1 looks and sizes (experience plan 5c): the bar's way back
            is the secondary at 36px; Start is the screen's one primary. */}
        <Button variant="secondary" size={36} className="sbs-home" onClick={() => onMainMenu && onMainMenu()}>
          <Icon name="House" size={16} color="currentColor" /> {W.mainMenu}
        </Button>
        <span className="sbs-crumb" aria-hidden="true">Setup</span>
        <HelpButton {...helpFor('host-before-start')} variant="inline" size="small" tooltip="Help: starting a session" className="help-button-quiet sbs-help" />
      </header>

      <main className="sbs-main">
        <div className="sbs-head">
          <div className="sbs-id">
            <p className="sbs-kicker">{W.kicker}</p>
            <h1 className="sbs-title" title={name}>{name}</h1>
            <p className="sbs-meta">{[formatLabel, setName, code ? W.code(code) : ''].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="sbs-acts">
            {onEdit ? (
              <Button variant="secondary" size={44} onClick={onEdit} disabled={busy}>
                <Icon name="PencilSimple" size={16} color="currentColor" /> {W.edit}
              </Button>
            ) : null}
            {onInvite ? (
              <Button variant="secondary" size={44} onClick={onInvite} disabled={busy}>
                <Icon name="PaperPlaneTilt" size={16} color="currentColor" /> {W.invite}
              </Button>
            ) : null}
            <Button variant="primary" size={44} className="sbs-start" onClick={() => onStart && onStart()} disabled={busy}>
              <Icon name="Play" weight="fill" size={16} color="currentColor" /> {busy ? W.starting : startLabel}
            </Button>
          </div>
        </div>

        <p className="sbs-status" role="status">
          <Icon name="Lock" size={16} color="currentColor" />
          <span><b>{survey ? W.waitingSurvey : W.waiting}</b> {onEdit ? W.editLine : ''}</span>
        </p>
        {notice ? <p className="sbs-notice" role="alert">{notice}</p> : null}

        {steps ? (
          <SessionSetup
            before
            step="where"
            choice={choice}
            choosing={choosing}
            oneOnly={oneOnly}
            onChoose={onChoose}
            onChange={onChange}
            onKeep={onKeep}
            presentHref={presentHref}
            profile={profile}
            onProfileChange={onProfileChange}
            title={name}
            code={code}
          />
        ) : (
          <p className="sbs-line">{W.surveyLine}</p>
        )}
      </main>
    </div>
  );
}
