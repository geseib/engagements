import React, { useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import './PrivacyPanel.css';

/**
 * DATA & PRIVACY — the customer's own copy of the guarantee.
 *
 * Grounded in docs/design/tenancy-redesign/08-privacy.html and RATIONALE.md §3.
 *
 * WHY THIS SCREEN EXISTS. A promise about data handling that a customer cannot
 * check is a sentence in a contract. This page is the check, and it has three
 * jobs: say what is encrypted, show every time anyone read anything and WHY,
 * and make leaving self-service.
 *
 * THE COPY STATES THE LIMIT HONESTLY, AND MUST KEEP DOING SO.
 * "We cannot read your data" is FALSE while anyone holds the AWS account, and a
 * customer who discovers that has learned something worse than the limit
 * itself. What is true is that we cannot do it QUIETLY: the KMS key policy
 * denies `kms:Decrypt` unless an `orgId` encryption context is supplied
 * (lambda-functions/game/tenant-crypto.js), so every decrypt names one tenant in
 * CloudTrail and the decrypt log IS the per-tenant read log below. Softening
 * HONEST_LIMIT into a claim the product cannot keep is a regression;
 * __tests__/privacyPanel.test.jsx fails on it.
 *
 * ONE TABLE, NOT TWO. Our access and the customer's own appear together. Two
 * tables would read as a surveillance panel; one reads as a record, and it lets
 * an admin answer "who exported that report?" on the same screen. Each row
 * carries who, what they did, the free-text reason they had to give, what it
 * touched and when — a support-access row without its reason is "somebody
 * looked", which is worse than no row at all.
 *
 * PURE PROPS, NO FETCH. `AdminPage.jsx` cannot be mounted in jsdom (`useAuth`
 * hard-throws), so anything that stays in the page is untestable. Fetching and
 * the endpoints live there; every decision this screen makes happens here.
 */

/** The one sentence that must not be softened. */
export const HONEST_LIMIT = 'It is not that we cannot — it is that we cannot do it quietly.';

/**
 * What the product actually encrypts, in the customer's words. Defaults, not
 * decoration: they are the prose form of ENCRYPTED_FIELDS in
 * lambda-functions/game/tenant-crypto.js, and the `encryption` prop overrides
 * them once an endpoint can report the boundary rather than restate it.
 *
 * `notEncrypted` names CATEGORY NAMES on purpose. They are customer-authored
 * content and they are stored in the clear, because the 24-bit host mask
 * addresses categories positionally and an encrypted name silently activates
 * the wrong ones (tenant-crypto.js, the `category` entity). Leaving that out
 * would make this panel the marketing version of the boundary rather than the
 * boundary.
 */
export const DEFAULT_ENCRYPTION = Object.freeze({
  encrypted: 'Set names, questions, participant answers, votes, AI summaries, session titles and reports.',
  notEncrypted: 'Record identifiers, timestamps, counts, access codes and category names — the things needed to find a row at all, and the names the category mask is addressed by. No question, answer or report text.',
  published: null,
});

function Dot({ kind }) {
  const cls = kind === 'engage' ? 'priv-dot priv-dot--plat' : 'priv-dot priv-dot--mem';
  return <span className={cls} aria-hidden="true" />;
}

/* --------------------------------------------------------------- the log -- */

function AccessLog({ log }) {
  const { loading = false, error = null, entries = [] } = log || {};

  if (loading) {
    return (
      <div className="priv-state">
        <h4>Loading the access log</h4>
        <p>One moment. Nothing has been hidden — this is the list being fetched.</p>
      </div>
    );
  }

  // A failure to load and an empty log are DIFFERENT situations and get
  // different sentences. Saying "nobody has read anything" when the request
  // failed would be the one lie this page cannot afford.
  if (error) {
    return (
      <div className="priv-state priv-state--bad">
        <h4>The access log could not be loaded</h4>
        <p>
          {error} This is a display failure, not an empty log: nothing has been
          removed and nothing can be. Reload, and tell us if it persists.
        </p>
      </div>
    );
  }

  // An empty log is a GOOD state. It must not look like a loading failure.
  if (!entries.length) {
    return (
      <div className="priv-state priv-state--empty">
        <h4>Nobody at Engage has read anything</h4>
        <p>
          No decryption request has ever named your organisation, and nobody on
          your team has exported a session. Every read — ours and yours — appears
          here, with the reason that was given for it.
        </p>
      </div>
    );
  }

  return (
    <table className="priv-tbl">
      <thead>
        <tr>
          <th className="priv-col-who" scope="col">Who</th>
          <th className="priv-col-what" scope="col">What they did</th>
          <th className="priv-col-touched" scope="col">What it touched</th>
          <th className="priv-col-when" scope="col">When</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr className="priv-logrow" key={e.id}>
            <td className="priv-wrap priv-tight">
              <span className="priv-actor"><Dot kind={e.who?.kind} />{e.who?.name || 'Unknown'}</span>
              <span className="priv-affil">
                {e.who?.affiliation || (e.who?.kind === 'engage' ? 'Engage staff' : '')}
              </span>
            </td>
            {/* WRAPS, never truncates. The reason somebody gave for reading a
                customer's data is the whole point of the row; an ellipsis eats
                the half that carries the meaning. */}
            <td className="priv-wrap priv-tight">
              {e.what}
              {e.reason ? <span className="priv-rsn">{e.reason}</span> : null}
            </td>
            <td className="priv-wrap priv-tight">{e.touched}</td>
            <td className="priv-wrap priv-tight priv-dim">{e.when}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------ the dialog -- */

function DeleteDialog({
  orgName, deleting, error, onExport, onConfirm, onClose,
}) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === orgName;

  // ONE canonical close. While the delete is in flight it deliberately does
  // nothing: unmounting the dialog would remove the only surface that can
  // report the outcome. The X stays rendered but disabled, because a control
  // that looks live and is not is worse than one that says it is not.
  const requestClose = () => { if (!deleting) onClose(); };

  return (
    <Modal
      overlayClassName="priv-scrim"
      contentClassName="priv-modal"
      onClose={requestClose}
      closeOnBackdrop={false}
      closeOnEscape={() => !deleting}
      labelledBy="priv-del-title"
    >
      <header>
        <h2 id="priv-del-title">Delete {orgName}?</h2>
        <span className="priv-grow" />
        <button
          type="button"
          className="priv-btn priv-btn--icon"
          onClick={requestClose}
          disabled={deleting}
          aria-label="Close"
        >
          <Icon name="X" weight="bold" size={14} color="currentColor" />
        </button>
      </header>
      <div className="priv-modal-body">
        {/* The consequence, not the severity. */}
        <ul className="priv-consq">
          <li>Every question set, session, response, summary and report is destroyed.</li>
          <li>
            This organisation&rsquo;s encryption key is deleted, which is what makes
            any remaining copy unreadable — including ours.
          </li>
          <li>Your access log survives. It is the record of who read what, and it outlives the data.</li>
          <li>Sets you published to the public library stay public. Delete them first if you want them gone.</li>
        </ul>
        <p>This cannot be undone, and we cannot undo it for you.</p>
        {/* The reversible neighbour, offered rather than mentioned. */}
        <p className="priv-alt">
          <b>Take it with you first.</b> Export writes every set, session,
          response and report as files you keep. It needs no notice and no
          conversation, and it does not slow this down.
          {onExport ? (
            <>
              {' '}
              <button type="button" className="priv-btn" onClick={onExport}>
                <Icon name="Package" weight="bold" size={14} color="currentColor" />
                Export everything
              </button>
            </>
          ) : null}
        </p>
        <div className="priv-field">
          <label htmlFor="priv-del-confirm">
            Type <b>{orgName}</b> to confirm
          </label>
          <input
            id="priv-del-confirm"
            className="priv-input"
            type="text"
            value={typed}
            autoComplete="off"
            disabled={deleting}
            onChange={(ev) => setTyped(ev.target.value)}
          />
        </div>
        {error ? <p className="priv-err">{error}</p> : null}
      </div>
      <footer>
        {/* The bottom exit. Every dialog gets one AND an X, both through
            requestClose. */}
        <button
          type="button"
          className="priv-btn"
          onClick={requestClose}
          disabled={deleting}
        >
          Keep {orgName}
        </button>
        <button
          type="button"
          className="priv-btn priv-btn--dangersolid"
          onClick={onConfirm}
          disabled={!matches || deleting}
        >
          <Icon name="Trash" weight="bold" size={14} color="currentColor" />
          {deleting ? 'Deleting…' : 'Delete for ever'}
        </button>
      </footer>
    </Modal>
  );
}

/* ---------------------------------------------------------------- screen -- */

export default function PrivacyPanel({
  org,
  encryption,
  accessLog,
  onExport,
  onDelete,
  exporting = false,
  exportError = null,
  exportMessage = null,
  deleting = false,
  deleteError = null,
}) {
  const [confirming, setConfirming] = useState(false);
  const orgName = org?.name || 'this organisation';
  const enc = { ...DEFAULT_ENCRYPTION, ...(encryption || {}) };

  return (
    <div className="priv" data-theme="dark">
      <section className="priv-panel">
        <header><h2>Encryption</h2></header>
        <div className="priv-panel-body">
          <dl className="priv-kv">
            <dt>Your content</dt>
            <dd>
              <span className="priv-dot priv-dot--ok" aria-hidden="true" />
              Encrypted with a key that belongs to {orgName} alone. {enc.encrypted}
            </dd>
            <dt>Not encrypted</dt>
            <dd>{enc.notEncrypted}</dd>
            {enc.published ? (
              <>
                <dt>Published sets</dt>
                <dd>{enc.published}</dd>
              </>
            ) : null}
          </dl>
          <p className="priv-note-box">
            <b>What this does and does not promise.</b> Engage staff browsing the
            database see identifiers and ciphertext, not your questions. Reading
            them takes a decryption request that names your organisation and is
            recorded below. {HONEST_LIMIT}
          </p>
        </div>
      </section>

      <h3 className="priv-secttl">Who has read your data</h3>
      <AccessLog log={accessLog} />
      <p className="priv-note" style={{ marginTop: 10 }}>
        This log cannot be edited or cleared, by you or by us. It is kept for the
        life of the organisation.
      </p>

      <h3 className="priv-secttl">Leaving</h3>
      <div className="priv-grid2">
        <div className="priv-panel">
          <div className="priv-panel-body">
            <b>Export everything</b>
            <p className="priv-note" style={{ marginTop: 6 }}>
              Every set, session, response and report as files you keep. Available
              at any time, with no notice and no conversation.
            </p>
            <div className="priv-actions">
              <button
                type="button"
                className="priv-btn priv-btn--primary"
                onClick={onExport}
                disabled={!onExport || exporting}
              >
                <Icon name="Package" weight="bold" size={14} color="currentColor" />
                {exporting ? 'Preparing your export…' : 'Export everything'}
              </button>
            </div>
            {exportError ? <p className="priv-err">{exportError}</p> : null}
            {exportMessage && !exportError ? <p className="priv-ok">{exportMessage}</p> : null}
          </div>
        </div>
        <div className="priv-panel">
          <div className="priv-panel-body">
            <b>Delete this organisation</b>
            <p className="priv-note" style={{ marginTop: 6 }}>
              Content, sessions and reports are destroyed and the encryption key
              is deleted, which makes any remaining copy unreadable. Your access
              log survives. This cannot be undone.
            </p>
            <div className="priv-actions">
              <button
                type="button"
                className="priv-btn priv-btn--danger"
                onClick={() => setConfirming(true)}
                disabled={!onDelete}
              >
                Delete {orgName}
              </button>
            </div>
          </div>
        </div>
      </div>

      {confirming ? (
        <DeleteDialog
          orgName={orgName}
          deleting={deleting}
          error={deleteError}
          onExport={onExport}
          onConfirm={onDelete}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
