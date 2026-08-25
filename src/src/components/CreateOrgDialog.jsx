import React, { useState } from 'react';
import Modal from './Modal';
import { authFetch, setActiveOrgId } from '../auth/authFetch';
import './CreateOrgDialog.css';

/**
 * MAKE A TEAM.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The switcher has offered "Create an organisation" since it was drawn, and it
 * was wired to `window.location.href = '/admin?section=members'` — a link to a
 * section that shows the members of the org you are ALREADY in, and which in
 * platform mode does not exist at all. Reported from dev: "the add organisation
 * does not work. clicking it goes to the Organizations menu item, but lists
 * question sets." Two separate defects met there; this is the one that was a
 * missing screen rather than a mis-wired gate.
 *
 * `POST /orgs` has existed and been authorized the whole time. Nothing in the
 * product called it.
 *
 * ── WHAT IT DOES AFTERWARDS ────────────────────────────────────────────────
 *
 * Switches to the new organisation and reloads, which is what
 * `AdminPage.handleSwitchOrg` does for the same reason: every panel on the page
 * has already fetched its own org's content and no single place owns all of it,
 * so a soft switch would leave one team's rows on screen under another team's
 * name. For a team you have just created and are about to fill, landing inside
 * it is also simply what you wanted.
 *
 * ── A TEAM FROM BIRTH ──────────────────────────────────────────────────────
 *
 * `type` is not derived from member count: an organisation somebody
 * deliberately creates is a team even while they are its only member. The
 * alternative makes a one-person team you named permanently un-leavable and
 * un-deletable, because those are the rules for a PERSONAL space.
 */
export default function CreateOrgDialog({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the team a name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await authFetch(`${window.API_BASE || ''}orgs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);

      const orgId = body.orgId || (body.org && body.org.orgId);
      if (!orgId) throw new Error('The organisation was created but the server did not name it.');

      if (onCreated) {
        onCreated(orgId, body);
        return;
      }
      setActiveOrgId(orgId);
      window.location.reload();
    } catch (err) {
      setError(err.message || 'Could not create that organisation.');
      setBusy(false);
    }
  };

  return (
    <Modal
      overlayClassName="corg corg-scrim"
      contentClassName="corg-dialog"
      onClose={busy ? () => {} : onClose}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      label="Create an organisation"
    >
      <form className="corg-form" onSubmit={submit}>
        <div className="corg-head">
          <h2 className="corg-title">Create a team</h2>
          <button
            type="button"
            className="corg-x"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="corg-sub">
          A team has its own question sets, sessions and members. Your own space stays
          exactly as it is — nothing moves.
        </p>

        <label className="corg-label" htmlFor="corg-name">Name</label>
        <input
          id="corg-name"
          className="corg-input"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          placeholder="Northwind Learning"
          maxLength={80}
          autoFocus
          disabled={busy}
        />

        {error && <p className="corg-error" role="alert">{error}</p>}

        {/* An X AND a bottom exit, which is the rule every dialog here follows. */}
        <div className="corg-actions">
          <button type="button" className="corg-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="corg-btn corg-btn--go" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create team'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
