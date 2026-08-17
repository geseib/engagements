import React, { useMemo, useState } from 'react';
import './InviteDialog.css';
import Modal from './Modal';
import Icon from './Icon';
import {
  buildInvite, retentionStatus, formatDeadline, RETENTION_DAYS,
} from '../config/invite';

/**
 * ONE INVITE DIALOG, OPENED FROM BOTH PLACES THAT INVITE.
 *
 * Owner: *"this should be identical mech (and i like the detail in the
 * session/setting panel) ... make this interface super nice and the same for
 * both location buttons."*
 *
 * It is the first thing on the host stage to use the shared `Modal`, which is
 * where every dialog is supposed to go: Escape, the focus trap, the scroll
 * lock, the focus restore and the ARIA all come from there rather than being
 * hand-rolled for the twelfth time.
 *
 * BOTH EXITS ROUTE THROUGH ONE HANDLER — the X and the footer Close — per the
 * dialog rule. There is no unsaved work here, so the backdrop and Escape close
 * too; they go through the same `onClose` so a future confirmation has one
 * place to live.
 *
 * COPY DOES NOT CLOSE. A host may well want the "now" wording for chat and a
 * dated one for a calendar, and closing after the first would make the second
 * a re-open. The button reports itself for a couple of seconds instead.
 *
 * THE PREVIEW IS NOT DECORATION. "Now" inserting a specific sentence is
 * otherwise a promise the host has to take on trust and only discovers after
 * pasting; showing the actual text makes the choice legible before it is made.
 */
export default function InviteDialog({
  /** { gameId, title, gameType, setName, categories, createdAt } */
  target,
  origin = typeof window !== 'undefined' ? window.location.origin : '',
  onClose = () => {},
  /** Injected only by tests; production reads the real clock. */
  now = undefined,
}) {
  const [when, setWhen] = useState('now');
  const [at, setAt] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');

  const text = useMemo(() => (target ? buildInvite({
    title: target.title,
    gameId: target.gameId,
    origin,
    gameType: target.gameType,
    setName: target.setName,
    categories: target.categories,
    when,
    at,
  }) : ''), [target, origin, when, at]);

  const status = useMemo(() => retentionStatus({
    createdAt: target && target.createdAt,
    at: when === 'scheduled' ? at : '',
    now: now || new Date(),
  }), [target, when, at, now]);

  if (!target) return null;

  const copy = async () => {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (error) {
      // Never an alert(): this can be on screen in front of a room, and an
      // alert is a second modal over the first.
      setCopyError('Could not reach the clipboard. Select the text above and copy it.');
    }
  };

  /*
    THE WARNING STATES THE CONSEQUENCE AND OFFERS THE WAY OUT, rather than
    shouting about severity. It never blocks the copy — the host may have a
    reason, and a dialog that refuses to do the thing it exists for is worse
    than one that says what will happen.
  */
  const warning = (() => {
    switch (status.verdict) {
      case 'unknown':
        return {
          tone: 'warn',
          text: 'We could not work out when this session expires, so we cannot check that date for you.',
        };
      case 'session-expired':
        return {
          tone: 'bad',
          text: `This session passed its ${RETENTION_DAYS}-day limit on ${formatDeadline(status.deadline)} and is being deleted. Create a new session before inviting anyone.`,
        };
      case 'past':
        return { tone: 'warn', text: 'That date and time have already passed.' };
      case 'beyond-deadline':
        return {
          tone: 'bad',
          text: `That date is after this session is deleted. It is kept until ${formatDeadline(status.deadline)} — ${RETENTION_DAYS} days after it was created — so an invitation for later points at a session that will no longer exist. Create a new session for that date instead.`,
        };
      default:
        return null;
    }
  })();

  return (
    <Modal
      overlayClassName="modal-overlay inv-scrim"
      contentClassName="inv"
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      label={`Invite people to ${target.title || 'this session'}`}
    >
      <div className="inv__head">
        <h2 className="inv__title">
          <Icon name="ClipboardText" weight="duotone" size={20} color="var(--primary)" /> Invite
        </h2>
        <button type="button" className="inv__x" onClick={onClose} aria-label="Close">
          <Icon name="X" weight="bold" size={18} />
        </button>
      </div>

      <p className="inv__for">{target.title || 'Engagement Session'}</p>

      {/* Two radios in a fieldset, not a select: there are two options and both
          are worth seeing without opening anything. */}
      <fieldset className="inv__when">
        <legend>When is this?</legend>
        <label>
          <input
            type="radio"
            name="inv-when"
            value="now"
            checked={when === 'now'}
            onChange={() => setWhen('now')}
          />
          Happening now
        </label>
        <label>
          <input
            type="radio"
            name="inv-when"
            value="scheduled"
            checked={when === 'scheduled'}
            onChange={() => setWhen('scheduled')}
          />
          At a date and time
        </label>

        {/*
          Native `datetime-local`. No date input existed anywhere in this
          codebase, so there is no house pattern to match and no consistency
          argument for a custom one — and on a phone the native control is a
          properly sized wheel in the user's own locale, accessible for free,
          with no dependency. A hand-rolled picker is exactly the kind of
          surface this repo keeps finding overflow bugs in.
        */}
        {when === 'scheduled' && (
          <label className="inv__at">
            <span>Date and time</span>
            <input
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              autoFocus
            />
          </label>
        )}
      </fieldset>

      <div className="inv__live" aria-live="polite">
        {warning && (
          <p className={`inv__warn inv__warn--${warning.tone}`}>
            <Icon name="Warning" weight="fill" size={16} color="currentColor" /> {warning.text}
          </p>
        )}
        {!warning && status.deadline && (
          <p className="inv__note">
            {`This session is kept until ${formatDeadline(status.deadline)}.`}
          </p>
        )}
      </div>

      <label className="inv__preview">
        <span className="inv__preview-lab">What gets copied</span>
        <textarea readOnly value={text} rows={12} />
      </label>

      {copyError && <p className="inv__warn inv__warn--warn">{copyError}</p>}

      <div className="inv__acts">
        <button type="button" className="inv__btn" onClick={onClose}>
          Close
        </button>
        <button type="button" className="inv__btn inv__btn--primary" onClick={copy}>
          {copied ? 'Copied!' : 'Copy invite'}
        </button>
      </div>
    </Modal>
  );
}
