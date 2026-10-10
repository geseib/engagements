/**
 * BUILD ROOM WI-FI SHARE: the host's side (docs/design/build-room-lan-share/,
 * mockups L1-L4). The chip in the header, its panel (a popover: the room keeps
 * running behind it), the one-time offer on the Host screen, the QR on the
 * wall and on the Build screen. Copy names laptops, tablets and phones, never
 * phones alone (owner, 2026-10-07).
 */
import React, { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import { copyText } from '../utils/copyText';
import { wifiState } from './wifiShare';
import { useKeepOnScreen } from './keepOnScreen';
import { W } from './words';

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

/**
 * `inline` is the Session panel's Settings, The room (docs/design/build-room-sidebar
 * S3): the same content, laid out in the panel rather than hung from the chip
 * as a popover, with no X or Done of its own and the wall button named for the
 * code it shows ("the build's QR", since the room's join QR is a different one).
 */
export function WifiPanel({ lan, link, now, busy, run, api, onClose, onShowWall, inline = false }) {
  const s = wifiState(lan, now);
  const on = Boolean(lan && lan.wanted);
  const map = (lan && lan.map) || [];
  const panelRef = useRef(null);
  useKeepOnScreen(panelRef, !inline);
  return (
    <div className={`brm-wifipanel${inline ? ' brm-wifipanel--inline' : ''}`} {...(inline ? { 'aria-label': 'Share on this Wi-Fi' } : { role: 'dialog', 'aria-label': 'Share on this Wi-Fi' })} ref={panelRef}>
      <div className="brm-wifipanel-top">
        {inline ? <h4>Share on this Wi-Fi</h4> : <h3>Share on this Wi-Fi</h3>}
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
        {!inline && <button type="button" className="brm-wifipanel-x" aria-label="Close" onClick={onClose}><Icon name="X" size={16} /></button>}
      </div>
      <p className="brm-wifipanel-say">{W.wifiSay}</p>
      {s.state === 'failed' && (
        <div className="brm-wifipanel-err"><b>It didn&apos;t start.</b> {lan.error}</div>
      )}
      {s.state === 'waiting' && (
        <div className="brm-wifipanel-warn"><b>Claude Code has not answered.</b> {W.wifiWaiting}</div>
      )}
      {s.state === 'quiet' && (
        <>
          <div className="brm-wifipanel-warn">
            <b>{W.wifiQuietHead}</b> {W.wifiQuietBody}
          </div>
          <p className="brm-wifipanel-say" title={W.tipWifiSame}>{W.wifiTest}</p>
          {link && (
            <div className="brm-wifipanel-test">
              <div className="brm-buildqr-qr" role="img" aria-label="QR code to test the build on another device"><QRCodeSVG value={link} size={96} level="M" includeMargin={false} /></div>
              <p className="brm-wifipanel-say">{W.wifiFailsForRoom}</p>
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
          : <button type="button" className={`brm-btn brm-btn--sm${inline ? '' : ' brm-btn--primary'}`} disabled={!on || s.state === 'starting' || s.state === 'waiting' || !map.length} onClick={onShowWall}>{inline ? "Show the build's QR on the wall" : 'Show the QR on the wall'}</button>}
        {!inline && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" onClick={onClose}>Done</button>}
      </div>
    </div>
  );
}

export function WifiOffer({ busy, run, api }) {
  return (
    <section className="brm-wifioffer" aria-label="Share the build on this Wi-Fi">
      <p className="brm-wifioffer-t">Let the room open it themselves?</p>
      <p className="brm-wifioffer-s">{W.wifiOffer}</p>
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => run(() => api.share({ on: true }))}>Share on this Wi-Fi</button>
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
          <p className="brm-wallqr-l">{W.wallQrScan}</p>
          <p className="brm-wallqr-m">{W.sameWifiOnly}</p>
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
      <p>Open the build yourself<small>{W.sameWifi}</small></p>
    </div>
  );
}
