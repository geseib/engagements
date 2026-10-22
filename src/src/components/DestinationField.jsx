import React from 'react';
import Icon from './Icon';

/**
 * WHERE THIS WILL BE SAVED — always shown, before anything is generated.
 *
 * The owner, 2026-10-21: "there should be clear understanding if im saving
 * this under my account, a team, or engage (if im an admin). public sets for
 * now are created after saved in the personal or team accounts."
 *
 * A NEW SET: a choice among the libraries this person may write to (Your
 * space, each team, Engage for Engage staff), defaulting to the one the
 * console stands in. ADDING TO A SET: no choice — the questions join that
 * set, in its library — so one sentence says so.
 *
 * The four AI builders are paper-theme modals, so this uses their own
 * `.form-group` markup and carries no colour of its own.
 */
export default function DestinationField({
  libraries = [],
  value = '',
  onChange,
  appendTo = null,
  disabled = false,
  /** Read the list of libraries — called when the person asks to change it. */
  onAskForLibraries,
}) {
  if (appendTo && appendTo.setName) {
    return (
      <p className="destination-note" data-testid="destination-note">
        <Icon name="Books" size={14} color="currentColor" />{' '}
        Adds to <b>“{appendTo.setName}”</b>{appendTo.libraryLabel ? <> in <b>{appendTo.libraryLabel}</b></> : null}.
        {' '}You review them before anything in the set changes.
      </p>
    );
  }
  const chosen = libraries.find((l) => l.key === value);
  if (libraries.length === 0) {
    return (
      <p className="destination-note" data-testid="destination-field">
        <Icon name="Books" size={14} color="currentColor" />{' '}
        Saves into the library you are working in now. You review it before anything is saved, and a set
        becomes public only by publishing it once it is saved.
        {onAskForLibraries && (
          <>
            {' '}
            <button type="button" className="btn-link" onClick={onAskForLibraries}>Choose another</button>
          </>
        )}
      </p>
    );
  }
  return (
    <div className="form-group destination-field" data-testid="destination-field">
      <label htmlFor="ai-destination">Save into</label>
      <select
        id="ai-destination"
        value={value}
        disabled={disabled || libraries.length === 0}
        onChange={(e) => onChange && onChange(e.target.value)}
      >
        {libraries.map((l) => (
          <option key={l.key} value={l.key}>
            {l.kind === 'engage' ? 'Engage — the shared library (staff)' : l.kind === 'personal' ? 'Your space' : `${l.label} (team)`}
          </option>
        ))}
      </select>
      <small>
        {chosen && chosen.kind === 'engage'
          ? 'Every organisation can use Engage’s library. '
          : ''}
        You review the questions before anything is saved. Public is not a choice here: publish the set
        from Your space or a team once it is saved.
      </small>
    </div>
  );
}
