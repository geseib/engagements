import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import './TeamPanel.css';

/**
 * THE MEMBERS SCREEN — who can host for an organisation, and who has been asked.
 *
 * Grounded in docs/design/tenancy-redesign/03-team.html. The backend is built
 * and tested; this screen must not contradict it:
 *
 *   GET    /orgs/{orgId}/members            members + outstanding invites
 *   POST   /orgs/{orgId}/invites            org admin. SAME email twice returns
 *                                           the EXISTING invitation
 *                                           (`created:false`) — that is what
 *                                           Resend is, not a second token.
 *   DELETE /orgs/{orgId}/invites/{token}    org admin
 *   PUT    /orgs/{orgId}/members/{sub}/role org admin
 *   DELETE /orgs/{orgId}/members/{sub}      org admin
 *
 * TWO LISTS, BECAUSE THEY ARE TWO SITUATIONS. An outstanding invitation takes
 * Resend/Revoke; a joined member takes Make admin/Make member/Remove. Merging
 * them into one table with a greyed row makes both harder to act on, which is
 * the mockup's first design note and the reason `list-members.js` returns two
 * arrays rather than one.
 *
 * THE LAST OWNER CANNOT BE DEMOTED OR REMOVED, and this screen renders that as
 * an ABSENCE of buttons plus the reason in the row — never as a disabled
 * control. A dead button is a thing people click twice and then write in about.
 * The flags come from the server (`canDemote`, `canRemove`, `lockReason`) rather
 * than being re-derived here, because the server re-checks them at the moment of
 * the write and a second implementation of the rule is a second thing to drift.
 * A hidden button is not a permission; it is a courtesy.
 *
 * EVERY FAILURE RENDERS THE SERVER'S OWN MESSAGE. The handlers answer with
 * `{ error }` and their sentences are specific — "That person is already a
 * member of this organisation", "That membership changed while you were looking
 * at it. Refresh the list." A local guess ("Something went wrong") throws that
 * away and is wrong more often than it is right. `HostQuestionSetsDialog` and
 * `QuestionSetDeleteDialog` are the precedent.
 *
 * IT FETCHES ITS OWN DATA AND STILL MOUNTS IN JSDOM. `AdminPage.jsx` cannot be
 * rendered in a test at all — `useAuth` hard-throws outside its provider — so
 * this component takes no hook, only props: mocking `authFetch` is enough to
 * drive the whole screen (`__tests__/teamPanel.test.jsx`), the way
 * `UserManagement` is driven. Identity comes from the payload (`you`,
 * `yourRole`), not from a context.
 *
 * A PERSONAL ORGANISATION HAS NO MEMBERS SCREEN AT ALL — there is nobody to
 * manage. That is decided in the nav, not here; nothing below assumes more than
 * one member.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The two roles an invitation can carry. `owner` is deliberately absent — the
 *  backend refuses it (INVITABLE_ROLES), because a typo'd address must not be
 *  handed the one role that cannot be removed. */
export const INVITABLE_ROLES = [
  { value: 'member', label: 'Member', detail: 'Can run sessions and use the team’s sets.' },
  { value: 'admin', label: 'Admin', detail: 'All of that, plus inviting and removing people.' },
];

export function roleLabel(role) {
  const key = String(role || '').toLowerCase();
  if (key === 'owner') return 'Owner';
  if (key === 'admin') return 'Admin';
  if (key === 'member') return 'Member';
  return key ? key[0].toUpperCase() + key.slice(1) : '—';
}

/** Initials for the avatar. Never "UN": an em dash says "no name" honestly. */
export function initialsOf(person) {
  const source = person?.displayName || person?.email || '';
  const parts = String(source).split(/[\s@.]+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return '—';
  return parts.map((part) => part[0]).join('').toUpperCase();
}

export function daysSince(value, now = Date.now()) {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

function ageWords(days) {
  if (days == null) return 'at an unknown date';
  if (days === 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * "11 days ago · expires in 3" — the arithmetic done for the reader, the move
 * the approval queue already makes with "Oldest has waited 21 days". "11 days
 * ago" on its own prompts nobody; the number that prompts somebody is the one
 * counting down.
 *
 * The countdown is only worth the ink when it is short. Printing "expires in
 * 13" beside every fresh invitation makes the row that has three days left look
 * exactly like the others, which is the whole failure this is fixing.
 *
 * `daysUntilExpiry` and `expired` are computed SERVER-side (org-guards.js) so
 * that every surface shows the same number and a client clock three days out
 * cannot offer a Resend on an invitation that is already dead.
 */
export const EXPIRY_WARNING_DAYS = 5;

export function sentWords(invite, now = Date.now()) {
  const ago = ageWords(daysSince(invite?.invitedAt, now));
  if (invite?.expired) return { ago, tail: 'expired', dead: true };
  const left = invite?.daysUntilExpiry;
  if (typeof left === 'number' && left <= EXPIRY_WARNING_DAYS) {
    return { ago, tail: left <= 0 ? 'expires today' : `expires in ${left}`, dead: false };
  }
  return { ago, tail: null, dead: false };
}

/** Every write on this screen answers `{ error }` on failure. Render THAT. */
async function readOrThrow(response, fallbackVerb) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `${fallbackVerb} (HTTP ${response.status})`);
  }
  return data;
}

/* ========================================================================== */
/*  The invite dialog                                                          */
/* ========================================================================== */

function InviteDialog({ orgName, onCancel, onInvited, sendInvite }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [phase, setPhase] = useState('form'); // form | sending | failed | done
  const [message, setMessage] = useState('');
  const [discardAsk, setDiscardAsk] = useState(false);

  const busy = phase === 'sending';
  const finished = phase === 'done';
  const dirty = email.trim().length > 0 && !finished;

  /**
   * ONE CANONICAL CLOSE, and every exit routes through it — the X, the footer
   * button, the backdrop and Escape. Escape is GATED ON UNSAVED WORK rather
   * than disabled: with a half-typed address it asks instead of discarding, and
   * the asking happens INLINE. A second Modal over this one is the pattern the
   * container rule forbids (admin-container-rule.md:68-69).
   */
  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty) {
      setDiscardAsk(true);
      return;
    }
    onCancel();
  }, [busy, dirty, onCancel]);

  const send = async () => {
    const address = email.trim();
    if (!address) return;
    setPhase('sending');
    setMessage('');
    try {
      const data = await sendInvite(address, role);
      // `created: false` is the backend REFUSING to mint a second token for an
      // address that already has a live one. Saying "Invitation sent" there
      // would be a lie the Invited list immediately contradicts by not growing.
      setMessage(
        data.created === false
          ? `${address} already has an invitation that has not expired, so it was left alone. `
            + 'Use Resend on their row to mail the same link again.'
          : `Invited ${address} as a ${roleLabel(data?.invite?.role || role).toLowerCase()}. `
            + 'Nothing is created for them until they accept.'
      );
      setPhase('done');
    } catch (error) {
      setMessage(error.message);
      setPhase('failed');
    }
  };

  return (
    <Modal
      overlayClassName="team team-scrim"
      contentClassName="team-modal"
      labelledBy="team-invite-title"
      onClose={requestClose}
      closeOnBackdrop={() => !busy}
      closeOnEscape={() => !busy}
    >
      <header>
        <div className="team-grow">
          <h2 id="team-invite-title">{finished ? 'Invitation handled' : 'Invite someone'}</h2>
          <p className="team-note">
            {orgName ? `They join ${orgName}. ` : ''}
            An invitation expires after 14 days. Nothing is created until it is accepted.
          </p>
        </div>
        <button
          type="button"
          className="team-x"
          onClick={requestClose}
          disabled={busy}
          aria-label="Close"
          title={busy ? 'Wait for the invitation to finish' : 'Close'}
        >
          <Icon name="X" weight="bold" size={14} color="currentColor" />
        </button>
      </header>

      <div className="team-modal-body">
        {!finished && (
          <>
            <div className="team-field">
              <label htmlFor="team-invite-email">Email address</label>
              <input
                id="team-invite-email"
                className="team-input"
                type="email"
                autoComplete="off"
                placeholder="name@example.com"
                value={email}
                disabled={busy}
                onChange={(event) => { setEmail(event.target.value); setDiscardAsk(false); }}
              />
              <small>
                It has to be the address they sign in with — accepting compares the two.
              </small>
            </div>

            <div className="team-field">
              <label htmlFor="team-invite-role">Role</label>
              <select
                id="team-invite-role"
                className="team-input"
                value={role}
                disabled={busy}
                onChange={(event) => setRole(event.target.value)}
              >
                {INVITABLE_ROLES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <small>
                {INVITABLE_ROLES.find((option) => option.value === role)?.detail}
                {' '}Ownership is handed over between people who are already here, so it
                cannot be invited.
              </small>
            </div>
          </>
        )}

        {message && (
          <div
            className={`team-alert${phase === 'failed' ? '' : ' team-alert--ok'}`}
            role={phase === 'failed' ? 'alert' : 'status'}
          >
            <Icon
              name={phase === 'failed' ? 'Warning' : 'CheckCircle'}
              weight="fill"
              size={16}
              color="currentColor"
            />
            <span className="team-alert-text">{message}</span>
          </div>
        )}

        {discardAsk && (
          <div className="team-alert" role="alert">
            <Icon name="Warning" weight="fill" size={16} color="currentColor" />
            <span className="team-alert-text">
              Discard this invitation? Nothing has been sent yet.
            </span>
          </div>
        )}
      </div>

      <footer>
        <span className="team-grow" />
        {finished ? (
          <button type="button" className="team-btn team-btn--primary" onClick={onInvited}>
            Done
          </button>
        ) : discardAsk ? (
          <>
            <button type="button" className="team-btn" onClick={() => setDiscardAsk(false)}>
              Keep editing
            </button>
            <button type="button" className="team-btn team-btn--ghostdanger" onClick={onCancel}>
              Discard it
            </button>
          </>
        ) : (
          <>
            <button type="button" className="team-btn" disabled={busy} onClick={requestClose}>
              Cancel
            </button>
            <button
              type="button"
              className="team-btn team-btn--primary"
              disabled={busy || !email.trim()}
              onClick={send}
            >
              {busy ? 'Sending…' : phase === 'failed' ? 'Try again' : 'Send invitation'}
            </button>
          </>
        )}
      </footer>
    </Modal>
  );
}

/* ========================================================================== */
/*  The destructive confirmations                                              */
/* ========================================================================== */

/**
 * Revoking an invitation and removing a member are the same shape: state the
 * CONSEQUENCE rather than the severity, offer the reversible neighbour, and
 * close only on acknowledgement so that a failure is not pixel-for-pixel
 * identical to a success.
 */
function ConfirmDialog({
  titleId,
  title,
  subtitle,
  consequences,
  neighbour,
  confirmLabel,
  busyLabel,
  doneTitle,
  onCancel,
  onDone,
  run,
}) {
  const [phase, setPhase] = useState('confirm'); // confirm | working | failed | done
  const [message, setMessage] = useState('');

  const busy = phase === 'working';
  const finished = phase === 'done';
  // An in-flight write must not be dismissable: unmounting the only surface
  // that can report the outcome is exactly the defect these dialogs exist for.
  // A finished one closes by acknowledgement. Backdrop, Escape, the footer and
  // the X are all held to this one gate.
  const dismissable = () => !busy && !finished;

  const go = async () => {
    setPhase('working');
    setMessage('');
    try {
      const said = await run();
      setMessage(said || 'Done.');
      setPhase('done');
    } catch (error) {
      setMessage(error.message);
      setPhase('failed');
    }
  };

  return (
    <Modal
      overlayClassName="team team-scrim"
      contentClassName="team-modal"
      labelledBy={titleId}
      onClose={onCancel}
      closeOnBackdrop={dismissable}
      closeOnEscape={dismissable}
    >
      <header>
        <Icon
          name={finished ? 'CheckCircle' : 'Warning'}
          weight="fill"
          size={20}
          color={finished ? 'var(--success)' : 'var(--danger-text)'}
        />
        <div className="team-grow">
          <h2 id={titleId}>{finished ? doneTitle : title}</h2>
          {subtitle && <p className="team-note">{subtitle}</p>}
        </div>
        <button
          type="button"
          className="team-x"
          onClick={onCancel}
          disabled={!dismissable()}
          aria-label="Close"
          title={busy ? 'Wait for this to finish' : 'Close'}
        >
          <Icon name="X" weight="bold" size={14} color="currentColor" />
        </button>
      </header>

      <div className="team-modal-body">
        {!finished && consequences.map((line) => <p key={line}>{line}</p>)}

        {!finished && neighbour && (
          <p>
            <b>{neighbour.headline}</b>{' '}
            <button
              type="button"
              className="team-btn team-btn--link"
              disabled={busy}
              onClick={neighbour.onChoose}
            >
              {neighbour.label}
            </button>
          </p>
        )}

        {message && (
          <div
            className={`team-alert${phase === 'failed' ? '' : ' team-alert--ok'}`}
            role={phase === 'failed' ? 'alert' : 'status'}
          >
            <Icon
              name={phase === 'failed' ? 'Warning' : 'CheckCircle'}
              weight="fill"
              size={16}
              color="currentColor"
            />
            <span className="team-alert-text">{message}</span>
          </div>
        )}
      </div>

      <footer>
        <span className="team-grow" />
        {finished ? (
          <button type="button" className="team-btn team-btn--primary" onClick={onDone}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="team-btn" disabled={busy} onClick={onCancel}>
              {phase === 'failed' ? 'Close' : 'Keep things as they are'}
            </button>
            <button
              type="button"
              className="team-btn team-btn--dangersolid"
              disabled={busy}
              onClick={go}
            >
              {busy ? busyLabel : phase === 'failed' ? 'Try again' : confirmLabel}
            </button>
          </>
        )}
      </footer>
    </Modal>
  );
}

/* ========================================================================== */
/*  The screen                                                                 */
/* ========================================================================== */

export default function TeamPanel({
  /** The organisation whose roster this is. Required; nothing loads without it. */
  orgId,
  /** Its name, for the copy. The screen still works without one. */
  orgName = '',
  /** Told `{ memberCount, outstandingInvites }` whenever the roster is re-read,
   *  so the nav badge and this table cannot disagree. Optional. */
  onRosterChange,
}) {
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyKeys, setBusyKeys] = useState(() => new Set());
  const [dialog, setDialog] = useState(null); // {kind:'invite'|'revoke'|'remove', …}

  const markBusy = (key, on) => setBusyKeys((prev) => {
    const next = new Set(prev);
    if (on) next.add(key); else next.delete(key);
    return next;
  });

  /* THE CALLBACK LIVES IN A REF, and `load` does not depend on it. An inline
     arrow from the page — the ordinary way to pass one — is a new function on
     every render, so a `load` that depended on it would be a new `load` on every
     render, and the effect below would re-fetch the roster forever. */
  const tellCaller = useRef(onRosterChange);
  tellCaller.current = onRosterChange;

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const response = await authFetch(adminApiUrl(`orgs/${encodeURIComponent(orgId)}/members`));
      const data = await readOrThrow(response, 'Could not load the members of this organisation');
      setRoster(data);
      setError(null);
      if (tellCaller.current) {
        tellCaller.current({
          memberCount: data.memberCount ?? (data.members || []).length,
          outstandingInvites: data.outstandingInvites
            ?? (data.invites || []).filter((invite) => !invite.expired).length,
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const orgPath = (suffix) => adminApiUrl(`orgs/${encodeURIComponent(orgId)}/${suffix}`);

  /** Invite AND resend are the same request: an address that already has a live
   *  invitation gets that one back, `created:false`. One address, one live
   *  token, one thing to revoke (invite-member.js). */
  const sendInvite = async (email, role) => {
    const response = await authFetch(orgPath('invites'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    return readOrThrow(response, 'Could not create that invitation');
  };

  const resend = async (invite) => {
    markBusy(`invite:${invite.token}`, true);
    setNotice(null);
    try {
      await sendInvite(invite.email, invite.role);
      setNotice(`The invitation to ${invite.email} was mailed again. It is the same link, `
        + 'with the same expiry — a second one is never minted.');
      setError(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      markBusy(`invite:${invite.token}`, false);
    }
  };

  const changeRole = async (member, role) => {
    markBusy(`member:${member.userId}`, true);
    setNotice(null);
    try {
      const response = await authFetch(
        orgPath(`members/${encodeURIComponent(member.userId)}/role`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        }
      );
      await readOrThrow(response, 'Could not change that role');
      setNotice(`${member.displayName || member.email} is now ${role === 'admin' ? 'an admin' : 'a member'}.`);
      setError(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      markBusy(`member:${member.userId}`, false);
    }
  };

  const members = roster?.members || [];
  const invites = roster?.invites || [];
  const yourRole = String(roster?.yourRole || '').toLowerCase();
  const youAreOwner = yourRole === 'owner';
  const canAdminister = youAreOwner || yourRole === 'admin';
  const outstanding = invites.filter((invite) => !invite.expired).length;

  /** Only an owner may change or remove another owner — the server enforces it,
   *  and a button that is going to be refused is a button that should not be
   *  drawn. */
  const mayActOn = (member) => canAdminister && (member.role !== 'owner' || youAreOwner);

  const closeDialog = () => setDialog(null);
  const afterWrite = async () => { setDialog(null); await load(); };

  return (
    <div className="team" data-theme="dark">
      {error && (
        <div className="team-alert" role="alert">
          <Icon name="Warning" weight="fill" size={16} color="currentColor" />
          <span className="team-alert-text">{error}</span>
          <button type="button" className="team-alert-close" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div className="team-alert team-alert--ok" role="status">
          <Icon name="CheckCircle" weight="fill" size={16} color="currentColor" />
          <span className="team-alert-text">{notice}</span>
          <button type="button" className="team-alert-close" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {loading && !roster && <p className="team-loading">Loading the roster…</p>}

      {roster && (
        <>
          {/*
            ── WHAT A HOST CAN AND CANNOT DO HERE ──────────────────────────

            A host is an ADMIN of their own personal space and a MEMBER of this
            organisation, and nothing on screen used to say so. They arrive to a
            roster with no Invite button and "An admin can change this" on every
            row, which reads as a broken screen rather than as a boundary — and
            the sections they have lost (Plan & usage, Data & privacy) are
            simply absent from the nav, so there is nothing to explain them
            either.

            The owner asked for this in those words: a friendly but informative
            notice that they do not have access to these when they switch to an
            organisation.

            It says what they CAN do first. A notice that only lists refusals
            reads as a demotion; this person can build question sets and run
            sessions here, which is the whole job.
          */}
          {!canAdminister && (
            <div className="team-notebox team-notebox--role">
              <b>You are a host in {orgName || 'this organisation'}.</b>
              {' '}
              You can build question sets, run sessions and see who else is here.
              Inviting people, changing roles, the plan and the privacy controls
              belong to its admins — ask one of the owners below if you need
              something changed. Your own space is still entirely yours.
            </div>
          )}

          {canAdminister && (
            <div className="team-head">
              <span className="team-head-grow" />
              <button
                type="button"
                className="team-btn team-btn--primary"
                onClick={() => setDialog({ kind: 'invite' })}
              >
                <Icon name="Plus" weight="bold" size={14} color="currentColor" />
                Invite someone
              </button>
            </div>
          )}

          {/*
            THE INVITATIONS PANEL KEEPS ITS FRAME WHEN IT IS EMPTY. A section
            that disappears when it has nothing in it is a section you stop
            looking for, and "nobody is waiting to get in" is a fact this screen
            exists to state.
          */}
          <section
            className={`team-panel${outstanding ? ' team-panel--live' : ''}`}
            aria-label="Invited, not joined yet"
          >
            <header className="team-panel-head">
              <h2>Invited, not joined yet</h2>
              <p className="team-note">
                An invitation expires after 14 days. Nothing is created until it is accepted.
              </p>
            </header>
            <div className="team-panel-body">
              {invites.length === 0 ? (
                /*
                  TWO DIFFERENT EMPTY STATES. "Nobody has been invited yet" and
                  "no invitation is outstanding" are different situations with
                  different exits, and one sentence for both is an empty state
                  that lies. The API keeps no history of accepted invitations, so
                  the only honest signal for the first is a roster of one — which
                  is stated as what it is ("you are the only person here"), never
                  as a claim about what was sent in the past.
                */
                members.length <= 1 ? (
                  <div className="team-empty">
                    <h3>Nobody has been invited yet</h3>
                    <p>
                      You are the only person here. An invitation lets somebody else run
                      sessions for {orgName || 'this organisation'} using its question sets —
                      and anything they build belongs to it, not to them.
                    </p>
                    {canAdminister && (
                      <div className="team-empty-acts">
                        <button
                          type="button"
                          className="team-btn team-btn--lg team-btn--primary"
                          onClick={() => setDialog({ kind: 'invite' })}
                        >
                          <Icon name="Plus" weight="bold" size={16} color="currentColor" />
                          Invite the first person
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="team-empty">
                    <h3>No invitation is outstanding</h3>
                    <p>
                      Everyone who has been invited is in the list below — {members.length}{' '}
                      {members.length === 1 ? 'person' : 'people'}. Nobody is holding a link
                      that has not been used.
                    </p>
                    {canAdminister && (
                      <div className="team-empty-acts">
                        <button
                          type="button"
                          className="team-btn team-btn--link"
                          onClick={() => setDialog({ kind: 'invite' })}
                        >
                          Invite somebody else
                        </button>
                      </div>
                    )}
                  </div>
                )
              ) : (
                <table className="team-tbl">
                  <thead>
                    <tr>
                      <th className="team-col-email">Email</th>
                      <th className="team-col-irole">Role</th>
                      <th className="team-col-sent">Sent</th>
                      <th className="team-col-iacts" />
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((invite) => {
                      const when = sentWords(invite);
                      const busy = busyKeys.has(`invite:${invite.token}`);
                      return (
                        <tr key={invite.token}>
                          <td>
                            {/* One text node, min-width:0, and title= carries the
                                whole address: a reduction with no recovery is a
                                deletion. */}
                            <span className="team-nm team-nm--mail" title={invite.email}>{invite.email}</span>
                          </td>
                          <td>
                            <span className="team-chip team-chip--role">
                              {roleLabel(invite.role)}
                            </span>
                          </td>
                          <td>
                            {/* NOT truncated. Cutting this cell ate "expires in
                                3" — the half that prompts action. */}
                            <span className="team-when">
                              {when.ago}
                              {when.tail && (
                                <>
                                  {' · '}
                                  <b className={when.dead ? 'team-dead' : 'team-stale'}>
                                    {when.tail}
                                  </b>
                                </>
                              )}
                            </span>
                          </td>
                          <td>
                            <div className="team-rowact">
                              {canAdminister ? (
                                <>
                                  <button
                                    type="button"
                                    className="team-btn team-btn--sm"
                                    disabled={busy}
                                    onClick={() => resend(invite)}
                                  >
                                    {busy ? 'Working…' : 'Resend'}
                                  </button>
                                  <button
                                    type="button"
                                    className="team-btn team-btn--sm team-btn--ghostdanger"
                                    disabled={busy}
                                    onClick={() => setDialog({ kind: 'revoke', invite })}
                                  >
                                    Revoke
                                  </button>
                                </>
                              ) : (
                                <span className="team-lock">An admin can resend this</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <h3 className="team-secttl">Members · {members.length}</h3>
          <table className="team-tbl">
            <thead>
              <tr>
                <th className="team-col-person">Person</th>
                <th className="team-col-role">Role</th>
                <th className="team-col-joined">Joined</th>
                <th className="team-col-acts" />
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const busy = busyKeys.has(`member:${member.userId}`);
                const name = member.displayName || member.email || member.userId;
                const joined = member.joinedAt
                  ? new Date(member.joinedAt).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short',
                  })
                  : '—';
                const actionable = mayActOn(member);
                // The row states the REASON where a disabled button would be.
                const lock = member.isLastOwner
                  ? `${member.you ? 'You · ' : ''}${member.lockReason || 'the last owner'}`
                  : null;
                return (
                  <tr key={member.userId}>
                    <td>
                      <div className="team-person">
                        <span className="team-avatar" aria-hidden="true">{initialsOf(member)}</span>
                        <span className="team-pn">
                          <span className="team-nm" title={name}>{name}</span>
                          <span className="team-sub" title={member.email}>
                            {member.email || member.userId}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`team-chip ${member.role === 'owner' ? 'team-chip--owner' : 'team-chip--role'}`}
                      >
                        {roleLabel(member.role)}
                      </span>
                    </td>
                    <td><span className="team-when">{joined}</span></td>
                    <td>
                      <div className="team-rowact">
                        {lock ? (
                          <span className="team-lock">{lock}</span>
                        ) : actionable ? (
                          <>
                            {member.canDemote !== false && member.role === 'member' && (
                              <button
                                type="button"
                                className="team-btn team-btn--sm"
                                disabled={busy}
                                onClick={() => changeRole(member, 'admin')}
                              >
                                {busy ? 'Working…' : 'Make admin'}
                              </button>
                            )}
                            {member.canDemote !== false && member.role !== 'member' && (
                              <button
                                type="button"
                                className="team-btn team-btn--sm"
                                disabled={busy}
                                onClick={() => changeRole(member, 'member')}
                              >
                                {busy ? 'Working…' : 'Make member'}
                              </button>
                            )}
                            {member.canRemove !== false && (
                              <button
                                type="button"
                                className="team-btn team-btn--sm team-btn--ghostdanger"
                                disabled={busy}
                                onClick={() => setDialog({ kind: 'remove', member })}
                              >
                                {member.you ? 'Leave' : 'Remove'}
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="team-lock">
                            {member.role === 'owner' ? 'Only an owner can change an owner' : 'An admin can change this'}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/*
            Said once, in place, because team role and Engage account approval
            look identical from here and are not — and that is cheaper than the
            support thread.
          */}
          <p className="team-notebox">
            <b>Roles here are not the same thing as an Engage account.</b> Someone can be an
            admin of {orgName || 'this organisation'} and a member of another team with the
            same sign-in. Approving somebody to use Engage at all is a separate decision,
            made by Engage staff, on a screen these people never see.
          </p>
        </>
      )}

      {dialog?.kind === 'invite' && (
        <InviteDialog
          orgName={orgName}
          sendInvite={sendInvite}
          onCancel={closeDialog}
          onInvited={afterWrite}
        />
      )}

      {dialog?.kind === 'revoke' && (
        <ConfirmDialog
          titleId="team-revoke-title"
          title={`Revoke the invitation to ${dialog.invite.email}?`}
          subtitle={`Invited as ${roleLabel(dialog.invite.role).toLowerCase()} · ${sentWords(dialog.invite).ago}`}
          consequences={[
            'The link stops working the moment you do this. If they open it afterwards they '
            + 'are told the invitation no longer exists.',
            'Nobody is removed and nothing is lost — an invitation creates nothing until it '
            + 'is accepted. You can invite this address again at any time.',
          ]}
          neighbour={{
            headline: 'If they simply never saw the email,',
            label: 'mail the same link again instead',
            onChoose: async () => { setDialog(null); await resend(dialog.invite); },
          }}
          confirmLabel="Revoke it"
          busyLabel="Revoking…"
          doneTitle="Invitation revoked"
          onCancel={closeDialog}
          onDone={afterWrite}
          run={async () => {
            const response = await authFetch(
              orgPath(`invites/${encodeURIComponent(dialog.invite.token)}`),
              { method: 'DELETE' }
            );
            await readOrThrow(response, 'Could not revoke that invitation');
            return `The invitation to ${dialog.invite.email} no longer works.`;
          }}
        />
      )}

      {dialog?.kind === 'remove' && (
        <ConfirmDialog
          titleId="team-remove-title"
          title={dialog.member.you
            ? `Leave ${orgName || 'this organisation'}?`
            : `Remove ${dialog.member.displayName || dialog.member.email} from ${orgName || 'this organisation'}?`}
          subtitle={`${dialog.member.email || dialog.member.userId} · ${roleLabel(dialog.member.role).toLowerCase()}`}
          consequences={dialog.member.you ? [
            'You lose access to this organisation’s question sets, sessions and reports '
            + 'immediately, and it disappears from your organisation switcher.',
            'Everything you made here stays here — it belongs to the organisation, not to '
            + 'you. Getting back in means somebody inside it invites you again.',
          ] : [
            'They lose access to this organisation’s question sets, sessions and reports '
            + 'immediately. A session they are running right now is not interrupted.',
            'Everything they made stays here, and their Engage account is untouched — this '
            + 'removes them from this organisation and nothing else. You can invite them '
            + 'back at any time.',
          ]}
          neighbour={dialog.member.you || dialog.member.role === 'member' ? null : {
            headline: 'If the problem is only that they can invite and remove people,',
            label: 'make them a member instead',
            onChoose: async () => { setDialog(null); await changeRole(dialog.member, 'member'); },
          }}
          confirmLabel={dialog.member.you ? 'Leave it' : 'Remove them'}
          busyLabel={dialog.member.you ? 'Leaving…' : 'Removing…'}
          doneTitle={dialog.member.you ? 'You have left' : 'Removed'}
          onCancel={closeDialog}
          onDone={afterWrite}
          run={async () => {
            const response = await authFetch(
              orgPath(`members/${encodeURIComponent(dialog.member.userId)}`),
              { method: 'DELETE' }
            );
            await readOrThrow(response, 'Could not remove that person');
            return dialog.member.you
              ? 'You are no longer a member of this organisation.'
              : `${dialog.member.displayName || dialog.member.email} is no longer a member.`;
          }}
        />
      )}
    </div>
  );
}
