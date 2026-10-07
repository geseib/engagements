/**
 * BUILD ROOM WI-FI SHARE: the host's side (docs/design/build-room-lan-share/,
 * mockups L1-L4). The chip in the header, its panel (a popover: the room keeps
 * running behind it), the one-time offer on the Host screen, the QR on the
 * wall and on the Build screen. Copy names laptops, tablets and phones, never
 * phones alone (owner, 2026-10-07).
 */
import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import { copyText } from '../utils/copyText';
import { wifiState } from './wifiShare';

const LOOPBACK = /^(localhost|[^.]+\.localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;
const originOf = (u) => {
  try { const x = new URL(String(u)); return LOOPBACK.test(x.hostname) ? x.origin : ''; } catch (e) { return ''; }
};

/** The link the QR opens: the newest app Claude showed, else the first one shared. */
export function wifiLink(room) {
  const map = (room && room.lan && room.lan.map) || [];
  const log = (room && room.log) || [];
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const o = log[i].by === 'agent' ? originOf(log[i].link) : '';
    const hit = o && map.find((m) => m.local === o);
    if (hit && hit.link) return hit.link;
  }
  return (map[0] && map[0].link) || '';
}

export function WifiChip({ lan, now, onOpen, open }) {
  const s = wifiState(lan, now);
  return (
    <button type="button" className={`brm-wifi brm-wifi--${s.state}${open ? ' is-open' : ''}`} aria-expanded={Boolean(open)} onClick={onOpen} data-testid="brm-wifi">
      {s.label}
    </button>
  );
}

const APP_NAMES = ['Latest build', 'Second app', 'Third app', 'Fourth app'];

function CopyLink({ link }) {
  const [said, setSaid] = useState('');
  const copy = async () => {
    const ok = await copyText(link);
    setSaid(ok ? 'Copied' : 'Press and hold to copy');
    setTimeout(() => setSaid(''), 2500);
  };
  return (
    <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={copy}>
      {said || 'Copy'}
    </button>
  );
}

export function WifiPanel({ lan, link, now, busy, run, api, onClose, onShowWall }) {
  const s = wifiState(lan, now);
  const on = Boolean(lan && lan.wanted);
  const map = (lan && lan.map) || [];
  return (
    <div className="brm-wifipanel" role="dialog" aria-label="Share on this Wi-Fi">
      <div className="brm-wifipanel-top">
        <h3>Share on this Wi-Fi</h3>
        <label className={`brm-auto${on ? ' is-on' : ''}`}>
          <input
            type="checkbox"
            role="switch"
            aria-label="Share on this Wi-Fi"
            checked={on}
            disabled={busy}
            onChange={(e) => run(() => api.share({ on: e.target.checked }))}
          />
          <span>{on ? 'On' : 'Off'}</span>
        </label>
        <button type="button" className="brm-wifipanel-x" aria-label="Close" onClick={onClose}><Icon name="X" size={16} /></button>
      </div>
      <p className="brm-wifipanel-say">Anyone on this Wi-Fi with the link can open the app Claude is running, on a phone, laptop or tablet. Turn it off at any time. Everyone loses it at once.</p>
      {s.state === 'failed' && (
        <div className="brm-wifipanel-err"><b>It didn&apos;t start.</b> {lan.error}</div>
      )}
      {s.state === 'quiet' && (
        <>
          <div className="brm-wifipanel-warn">
            <b>None open yet.</b> It has been on for 2 minutes and no device has opened it. Some Wi-Fi networks (hotels, conferences, guest networks) keep devices apart, so nobody else can reach this laptop.
          </div>
          <p className="brm-wifipanel-say">Check that everyone is on the same Wi-Fi as this laptop: phones and tablets not on mobile data, laptops not on a work VPN. Try it yourself on another device first: scan the QR below.</p>
          {link && (
            <div className="brm-wifipanel-test">
              <div className="brm-buildqr-qr" role="img" aria-label="QR code to test the build on another device"><QRCodeSVG value={link} size={96} level="M" includeMargin={false} /></div>
              <p className="brm-wifipanel-say">Scan to open the build. If your own device cannot open it either, this Wi-Fi will not work for the room. Use screenshots, as before.</p>
            </div>
          )}
        </>
      )}
      {s.state === 'on' && (
        <p className="brm-wifipanel-stat"><b>{s.open}</b> devices opened it in the last 5 minutes</p>
      )}
      {map.length > 0 && (
        <ul className="brm-wifipanel-apps">
          {map.map((m, i) => (
            <li key={m.lan}>
              <span className="brm-wifipanel-k">{APP_NAMES[i] || `App ${i + 1}`}</span>
              <span className="brm-wifipanel-u" title={m.local}>{m.lan}</span>
              {m.link && <CopyLink link={m.link} />}
            </li>
          ))}
        </ul>
      )}
      <div className="brm-wifipanel-foot">
        {s.state === 'failed'
          ? <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={() => run(() => api.share({ on: true }))}>Try again</button>
          : <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={!on || s.state === 'starting' || !map.length} onClick={onShowWall}>Show the QR on the wall</button>}
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export function WifiOffer({ busy, run, api }) {
  return (
    <section className="brm-wifioffer" aria-label="Share the build on this Wi-Fi">
      <p className="brm-wifioffer-t">Let the room open it themselves?</p>
      <p className="brm-wifioffer-s">Anyone in the room on this laptop&apos;s Wi-Fi can open the app Claude is running, on a phone, laptop or tablet. You can turn it off at any time.</p>
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={() => run(() => api.share({ on: true }))}>Share on this Wi-Fi</button>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => run(() => api.share({ dismissOffer: true }))}>Not now</button>
      </div>
    </section>
  );
}

/** The QR on the wall. Modal gives Escape; this adds the X and the bottom Close. */
export function WallBuildQr({ link, onClose }) {
  return (
    <Modal overlayClassName="brm-wallqr" contentClassName="brm-wallqr-card" onClose={onClose} label="Open the build yourself">
      <button type="button" className="brm-wallqr-x" aria-label="Close the QR" onClick={onClose}><Icon name="X" size={16} /></button>
      <div className="brm-wallqr-body">
        <div className="brm-qrzoom-qr brm-wallqr-qr" role="img" aria-label="QR code to open the build">
          <QRCodeSVG value={link} size={512} level="M" includeMargin={false} />
        </div>
        <div>
          <span className="brm-wallqr-eb">The build is live</span>
          <h2 className="brm-wallqr-h">Open the build yourself</h2>
          <p className="brm-wallqr-l">On your phone, laptop or tablet: scan the code, or press Open the build in Engage.</p>
          <p className="brm-wallqr-m">You need to be on the same Wi-Fi as this laptop.</p>
          <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

export function BuildScreenQr({ link }) {
  if (!link) return null;
  return (
    <div className="brm-buildqr">
      <div className="brm-buildqr-qr"><QRCodeSVG value={link} size={96} level="M" includeMargin={false} /></div>
      <p>Open the build yourself<small>Phone, laptop or tablet · same Wi-Fi</small></p>
    </div>
  );
}
