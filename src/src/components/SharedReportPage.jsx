/**
 * THE PAGE A SHARED REPORT LINK OPENS — /shared-report?game=…&key=…
 *
 * For somebody with no account: a client, a colleague, a participant the host
 * chose to send it to. The link names the report; the passkey the host gave
 * them separately opens it. Nothing here signs anybody in, and nothing reads
 * the passkey from the address — it is typed, so it never travels with a link
 * that gets forwarded (config/reportShare.js says why).
 *
 * Paper, like the report itself (GameReport.jsx), and one field, like /join.
 * Every refusal from the server reads the same, so the page cannot say which
 * of "wrong passkey" and "expired link" happened — it says what to check.
 */
import React, { useMemo, useState } from 'react';
import Icon from './Icon';
import {
  PASSKEY_EXAMPLE, describeReportKey, fetchSharedReport, looksLikePasskey,
  readShareLink, reportFilename, saveBlob,
} from '../config/reportShare';
import './ReportShare.css';

const LONG_DATE = { day: 'numeric', month: 'long', year: 'numeric' };

export default function SharedReportPage({
  search = window.location.search,
  apiBase = window.API_BASE,
  fetchFn,
}) {
  const link = useMemo(() => readShareLink(search), [search]);
  const [passkey, setPasskey] = useState('');
  const [status, setStatus] = useState('idle');   // idle | short | pending | done | mismatch | network

  const described = link ? describeReportKey(link.key, link.gameId) : null;
  const savedOn = described && described.savedOn
    ? new Date(`${described.savedOn}T12:00:00`).toLocaleDateString(undefined, LONG_DATE)
    : null;

  const submit = async (e) => {
    e.preventDefault();
    if (status === 'pending') return;
    if (!looksLikePasskey(passkey)) { setStatus('short'); return; }
    setStatus('pending');
    const result = await fetchSharedReport({
      apiBase, gameId: link.gameId, key: link.key, passkey, ...(fetchFn ? { fetchFn } : {}),
    });
    if (!result.ok) { setStatus(result.reason); return; }
    saveBlob(result.blob, reportFilename(link.key));
    setStatus('done');
  };

  return (
    <div className="rshare rshare-page" data-theme="light">
      <header className="rshare-top">
        <a className="rshare-brand" href="/home">Engagements</a>
      </header>

      <main className="rshare-main">
        {!link ? (
          <section className="rshare-card" aria-labelledby="rshare-title">
            <p className="rshare-kicker">Shared session report</p>
            <h1 id="rshare-title" className="rshare-title">This link is incomplete</h1>
            <p className="rshare-lead">
              Part of the address is missing. Ask whoever sent it to copy the link again.
            </p>
          </section>
        ) : (
          <section className="rshare-card" aria-labelledby="rshare-title">
            <p className="rshare-kicker">Shared session report</p>
            <h1 id="rshare-title" className="rshare-title">{described.title}</h1>
            {savedOn && <p className="rshare-meta">Saved {savedOn}</p>}
            <p className="rshare-lead">
              The host gave you a passkey with this link. Enter it to download the report as a PDF.
            </p>

            <form className="rshare-form" onSubmit={submit} noValidate>
              <label className="rshare-label" htmlFor="rshare-passkey">Passkey</label>
              <input
                id="rshare-passkey"
                className="rshare-input rshare-input--key"
                value={passkey}
                onChange={(e) => { setPasskey(e.target.value); if (status !== 'pending') setStatus('idle'); }}
                placeholder={PASSKEY_EXAMPLE}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="rshare-status"
                aria-invalid={status === 'short' || status === 'mismatch' ? 'true' : undefined}
              />
              <button type="submit" className="rshare-btn rshare-btn--primary" disabled={status === 'pending'}>
                <Icon name="DownloadSimple" weight="bold" size={18} />
                {status === 'pending' ? 'Opening…' : 'Download report'}
              </button>
            </form>

            <div id="rshare-status" className="rshare-status" aria-live="polite">
              {status === 'short' && (
                <p className="rshare-note rshare-note--error">
                  A passkey is ten letters and numbers, like{' '}
                  <span className="rshare-nowrap">{PASSKEY_EXAMPLE}</span>.
                </p>
              )}
              {status === 'mismatch' && (
                <p className="rshare-note rshare-note--error" role="alert">
                  That passkey does not open this report. Check it with the host. If it is
                  right, the link may have expired — the host can save the report again and
                  send you a new link and passkey.
                </p>
              )}
              {status === 'network' && (
                <p className="rshare-note rshare-note--error" role="alert">
                  Could not reach Engagements. Check your connection and try again.
                </p>
              )}
              {status === 'done' && (
                <p className="rshare-note rshare-note--done">
                  <Icon name="CheckCircle" weight="fill" size={18} /> Downloaded. Look in your downloads folder.
                </p>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
