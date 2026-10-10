/**
 * SHARE DEMO: the host's side of the Wi-Fi share (docs/design/build-room-share-demo,
 * D1-D6, owner 2026-10-10; built on docs/design/build-room-lan-share). The chip
 * in the header and the panel that hangs from it, the nudge on the Host screen,
 * the code on the Stage and the card on the Build screen.
 *
 * Owner rulings 2026-10-10: "demo" is what the Wi-Fi shares (Share demo, Open
 * the demo, Stop sharing); "build" is this laptop's own link. Opt-in: nothing
 * shares until the host presses Share demo. Not now folds the nudge into the
 * chip, which still offers it without asking again.
 */
import React, { useEffect, useRef, useState } from 'react';
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
    <button type="button" className={`brm-wifi brm-wifi--${s.state}${open ? ' is-open' : ''}`} aria-expanded={Boolean(open)} aria-haspopup="dialog" onClick={onOpen} data-testid="brm-wifi">
      {s.label}
    </button>
  );
}

const APP_NAMES = ['Latest build', 'Second app', 'Third app', 'Fourth app'];

/** What a person reads of a Wi-Fi link: its host and port. The key is never shown, only copied. */
const shownAddress = (link) => { try { return new URL(String(link)).host; } catch (e) { return ''; } };

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

/** The address the room opens, its QR, who can reach it, and Copy (D2). */
function Address({ link, note, copy = true }) {
  if (!link) return null;
  return (
    <div className="brm-wifipanel-addr">
      <div className="brm-buildqr-qr brm-wifipanel-qr" role="img" aria-label="QR code to open the demo on another device"><QRCodeSVG value={link} size={72} level="M" includeMargin={false} /></div>
      <p className="brm-wifipanel-u">{shownAddress(link)}<small>{note}</small></p>
      {copy ? <CopyLink link={link} /> : <span />}
    </div>
  );
}

/**
 * THE PANEL (D1 B, D2, D2 quiet), one element in every state. As a popover it
 * hangs from the chip with an X and a bottom exit; `inline` is the Session
 * panel's Settings (D3: Share demo stays reachable there), with no X and no
 * Not now. `offer` is the nudge: its Not now also tells the room not to ask
 * again. `here` is who is in the room.
 */
export function SharePanel({ lan, link, here = 0, now, busy, run, api, onClose, onShowWall, offer = false, inline = false }) {
  const s = wifiState(lan, now);
  const map = (lan && lan.map) || [];
  const panelRef = useRef(null);
  useKeepOnScreen(panelRef, !inline, s.state);
  const share = (on) => run(() => api.share({ on }));
  const notNow = () => {
    if (offer) run(() => api.share({ dismissOffer: true }));
    onClose();
  };
  const primary = inline ? '' : ' brm-btn--primary';
  const live = s.state === 'on' || s.state === 'quiet';
  const Head = inline ? 'h4' : 'h3';
  const head = live ? W.shareLiveHead : s.state === 'off' ? (inline ? W.shareDemo : W.shareNudgeHead) : W.shareDemo;
  let body;
  let foot;
  if (s.state === 'off') {
    body = (
      <>
        {!inline && <p className="brm-wifipanel-lede">{W.shareNudgeBody}</p>}
        <p className="brm-wifipanel-say">{W.shareWho}</p>
      </>
    );
    foot = (
      <>
        {!inline && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={notNow}>{W.notNow}</button>}
        <button type="button" className={`brm-btn brm-btn--sm${primary}${inline ? '' : ' brm-push'}`} disabled={busy} onClick={() => share(true)}>{W.shareDemo}</button>
      </>
    );
  } else if (s.state === 'failed') {
    body = <div className="brm-wifipanel-err"><b>It didn&apos;t start.</b> {lan.error}</div>;
    foot = (
      <>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => share(false)}>{W.stopSharing}</button>
        <button type="button" className={`brm-btn brm-btn--sm${primary} brm-push`} disabled={busy} onClick={() => share(true)}>{W.tryAgain}</button>
      </>
    );
  } else if (s.state === 'starting' || s.state === 'waiting') {
    body = s.state === 'waiting'
      ? <div className="brm-wifipanel-warn"><b>Claude Code has not answered.</b> {W.wifiWaiting}</div>
      : <p className="brm-wifipanel-say" role="status">{W.shareStarting}</p>;
    foot = <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => share(false)}>{W.stopSharing}</button>;
  } else if (s.state === 'quiet') {
    body = (
      <>
        <div className="brm-wifipanel-warn">
          <b>{W.wifiQuietHead}</b> {W.wifiQuietBody}
          <ul>
            <li>{W.wifiTest}</li>
            <li>{W.wifiSameAdvice}</li>
          </ul>
        </div>
        <Address link={link} note={W.wifiFailsForRoom} copy={false} />
      </>
    );
    foot = (
      <>
        {!inline && <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={onClose}>{W.keepSharing}</button>}
        {/* Sharing that reaches nobody only exposes the laptop: Stop is the move (D2 quiet). */}
        <button type="button" className={`brm-btn brm-btn--sm${primary}${inline ? '' : ' brm-push'}`} disabled={busy} onClick={() => share(false)}>{W.stopSharing}</button>
      </>
    );
  } else {
    body = (
      <>
        <p className="brm-wifipanel-stat">{W.shareOpenedOf(s.open, here)}</p>
        <Address link={link} note={W.shareWhoShort} />
        {s.open < here && <p className="brm-wifipanel-say">{W.shareNotAll(s.open, here)}</p>}
      </>
    );
    foot = (
      <>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => share(false)}>{W.stopSharing}</button>
        <button type="button" className={`brm-btn brm-btn--sm${primary} brm-push`} disabled={!link} onClick={onShowWall}>{W.shareShowOnStage}</button>
      </>
    );
  }
  return (
    <div
      className={`brm-wifipanel${inline ? ' brm-wifipanel--inline' : ''}`}
      {...(inline ? { 'aria-label': W.shareDemo } : { role: 'dialog', 'aria-label': W.shareDemo })}
      ref={panelRef}
    >
      <div className="brm-wifipanel-top">
        <Head>{head}</Head>
        {!inline && <button type="button" className="brm-wifipanel-x" aria-label="Close" onClick={onClose}><Icon name="X" size={16} /></button>}
      </div>
      {body}
      {live && map.length > 1 && (
        <ul className="brm-wifipanel-apps">
          {map.map((m, i) => (
            <li key={m.lan}>
              <span className="brm-wifipanel-k">{APP_NAMES[i] || `App ${i + 1}`}</span>
              <span className="brm-wifipanel-u" title={m.local}>{shownAddress(m.lan)}</span>
              {m.link && <CopyLink link={m.link} />}
            </li>
          ))}
        </ul>
      )}
      <div className="brm-wifipanel-foot">{foot}</div>
    </div>
  );
}

/**
 * THE CHIP AND ITS POPOVER. `nudge` (D1 B, on Build and History) hangs the
 * panel open from the chip until the host answers it or closes it here; the
 * X, Escape or a click elsewhere fold it back into the chip for this device.
 */
export function ShareDemo({ lan, link, here, now, busy, run, api, onShowWall, nudge = false }) {
  const [open, setOpen] = useState(false);
  const [folded, setFolded] = useState(false);
  const wrap = useRef(null);
  const shown = open || (nudge && !folded);
  const close = () => { setOpen(false); setFolded(true); };
  useEffect(() => {
    if (!shown) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      close();
      const b = wrap.current && wrap.current.querySelector('button.brm-wifi');
      if (b) b.focus();
    };
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) close(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="brm-wifiwrap" ref={wrap}>
      <WifiChip lan={lan} now={now} open={shown} onOpen={() => (shown ? close() : setOpen(true))} />
      {shown && (
        <SharePanel
          lan={lan} link={link} here={here} now={now} busy={busy} run={run} api={api}
          offer={!(lan && lan.offerDismissed)} onClose={close}
          onShowWall={() => { close(); onShowWall(); }}
        />
      )}
    </span>
  );
}

/** THE NUDGE ON THE HOST SCREEN (D1 A): the top of the Now column, until the host answers. */
/** `lead`: Share demo is the screen's one orange; false while something else on the Host screen leads. */
export function DemoNudge({ busy, run, api, picture = null, lead = true }) {
  return (
    <section className="brm-wifioffer" aria-label={W.shareDemo}>
      <p className="brm-wifioffer-t">{W.shareNudgeHead}</p>
      <p className="brm-wifioffer-s">{W.shareNudgeBody}</p>
      {picture && <div className="brm-wifioffer-pic">{picture}</div>}
      <p className="brm-wifioffer-who">{W.shareWho}</p>
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} onClick={() => run(() => api.share({ dismissOffer: true }))}>{W.notNow}</button>
        <button type="button" className={`brm-btn${lead ? ' brm-btn--primary' : ''} brm-push`} disabled={busy} onClick={() => run(() => api.share({ on: true }))}>{W.shareDemo}</button>
      </div>
    </section>
  );
}

/**
 * THE STAGE WHILE SHARED (D4): the code, three short lines and how many
 * opened it, a number and never a name. Modal gives Escape; the X and Hide the
 * code close it.
 */
export function WallBuildQr({ link, open = 0, onClose }) {
  return (
    <Modal overlayClassName="brm-wallqr" contentClassName="brm-wallqr-card" onClose={onClose} label={W.stageDemoHead}>
      <button type="button" className="brm-wallqr-x" aria-label="Close the QR" onClick={onClose}><Icon name="X" size={16} /></button>
      <div className="brm-wallqr-body">
        <div className="brm-qrzoom-qr brm-wallqr-qr" role="img" aria-label="QR code to open the demo">
          <QRCodeSVG value={link} size={512} level="M" includeMargin={false} />
        </div>
        <div>
          <span className="brm-wallqr-eb">{W.stageDemoLive}</span>
          <h2 className="brm-wallqr-h">{W.stageDemoHead}</h2>
          <p className="brm-wallqr-l">{W.stageDemoScan}</p>
          <p className="brm-wallqr-m">{W.stageSameWifi}</p>
          <p className="brm-wallqr-n">{W.stageOpened(Number(open) || 0)}</p>
          <button type="button" className="brm-btn brm-btn--primary" onClick={onClose}>{W.hideCode}</button>
        </div>
      </div>
    </Modal>
  );
}

/** The Build screen's card while shared (D6): the QR and the count. */
export function BuildScreenQr({ link, open = 0 }) {
  if (!link) return null;
  return (
    <div className="brm-buildqr">
      <div className="brm-buildqr-qr"><QRCodeSVG value={link} size={96} level="M" includeMargin={false} /></div>
      <p>{W.stageDemoHead}<small>{W.buildCardSub(Number(open) || 0)}</small></p>
    </div>
  );
}
