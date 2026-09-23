/**
 * "REPORT SAVED" — the one moment the host sees the passkey.
 *
 * Replaces a confirm box whose two buttons were "Download Now" and "Copy Link",
 * where the link alone opened the report for anybody who could guess it — and
 * anybody in the room could (config/reportShare.js). Now a shared report is two
 * items, and this dialog hands the host both: the link to /shared-report, and
 * the passkey save-report.js minted. The passkey is shown here and never again;
 * only its hash is kept, so there is nothing to look it up from later. Saving
 * again mints a new one, and the team can always open the report from Reports.
 *
 * The X, the backdrop, Escape and "Done" all close it. Nothing here is unsaved
 * work — the report is already stored — so none of them is gated.
 */
import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import {
  fetchSharedReport, formatShareUntil, reportFilename, saveBlob, shareLinkFor,
} from '../config/reportShare';
import './ReportShare.css';

function CopyField({ id, label, value, className = '', copyLabel }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (permissions, an insecure origin): select the text so
      // the host can copy it by hand rather than being told nothing.
      const el = document.getElementById(id);
      if (el) { el.focus(); el.select(); }
    }
  };
  return (
    <div className="rshare-field">
      <label className="rshare-label" htmlFor={id}>{label}</label>
      <div className="rshare-copyrow">
        <input
          id={id}
          className={`rshare-input ${className}`}
          value={value}
          readOnly
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="rshare-btn" onClick={copy} aria-label={copyLabel}>
          <Icon name={copied ? 'Check' : 'ClipboardText'} weight="bold" size={18} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default function ReportSavedDialog({
  saved,
  gameId,
  apiBase = window.API_BASE,
  origin = window.location.origin,
  onClose,
  fetchFn,
}) {
  const [download, setDownload] = useState('idle');   // idle | pending | failed
  const link = shareLinkFor(origin, gameId, saved.fileName);
  const until = formatShareUntil(saved.shareUntil);

  const downloadNow = async () => {
    setDownload('pending');
    const result = await fetchSharedReport({
      apiBase, gameId, key: saved.fileName, passkey: saved.passkey, ...(fetchFn ? { fetchFn } : {}),
    });
    if (!result.ok) { setDownload('failed'); return; }
    saveBlob(result.blob, reportFilename(saved.fileName));
    setDownload('idle');
  };

  return (
    <Modal
      overlayClassName="rshare-scrim"
      contentClassName="rshare rshare-dialog"
      onClose={onClose}
      labelledBy="rshare-saved-title"
      theme="light"
    >
      <div className="rshare-dialog-head">
        <h2 id="rshare-saved-title" className="rshare-head">Report saved</h2>
        <button type="button" className="rshare-x" onClick={onClose} aria-label="Close">
          <Icon name="X" weight="bold" size={20} />
        </button>
      </div>

      <p className="rshare-lead">
        To share it with someone who is not signed in, send them the link <strong>and</strong> the
        passkey. They need both. Sending them separately — the passkey by text or out loud — keeps
        a forwarded link from opening it.
      </p>

      <CopyField id="rshare-link" label="Link" value={link} copyLabel="Copy the link" />
      <CopyField
        id="rshare-key"
        label="Passkey"
        value={saved.passkey}
        className="rshare-input--key"
        copyLabel="Copy the passkey"
      />

      <ul className="rshare-facts">
        <li>This is the only time the passkey is shown. If it is lost, save the report again for a new one.</li>
        {until && <li>The link and passkey work until {until}, while the session&apos;s record is kept.</li>}
        <li>Anyone on your team can open it any time from Reports, without a passkey.</li>
      </ul>

      {download === 'failed' && (
        <p className="rshare-note rshare-note--error" role="alert">
          The download did not start. Try again, or open it from Reports.
        </p>
      )}

      <div className="rshare-actions">
        <button type="button" className="rshare-btn" onClick={downloadNow} disabled={download === 'pending'}>
          <Icon name="DownloadSimple" weight="bold" size={18} />
          {download === 'pending' ? 'Downloading…' : 'Download PDF'}
        </button>
        <button type="button" className="rshare-btn rshare-btn--primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
