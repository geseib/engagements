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
import { copyText } from '../utils/copyText';
import { wifiState, demoRunnable, remoteState, remotePeople } from './wifiShare';
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
export const shownAddress = (link) => { try { return new URL(String(link)).host; } catch (e) { return ''; } };

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
 * THE PANEL (D1 B, D2, D2 quiet), one element in every state. It hangs from
 * the chip with an X and a bottom exit. `offer` is the nudge: its Not now also
 * tells the room not to ask again. `here` is who is in the room. Settings
 * carries the same states in its Demo tile (DemoTile, below).
 */
export function SharePanel({ lan, link, here = 0, now, busy, run, api, onClose, onShowWall, offer = false }) {
  const s = wifiState(lan, now);
  const rs = remoteState(lan);
  const map = (lan && lan.map) || [];
  const panelRef = useRef(null);
  useKeepOnScreen(panelRef, true, s.state);
  const share = (on) => run(() => api.share({ on }));
  const notNow = () => {
    if (offer) run(() => api.share({ dismissOffer: true }));
    onClose();
  };
  const live = s.state === 'on' || s.state === 'quiet';
  const head = live ? (rs === 'live' ? W.remoteLiveHead : W.shareLiveHead) : s.state === 'off' ? W.shareNudgeHead : W.shareDemo;
  let body;
  let foot;
  if (s.state === 'off') {
    body = (
      <>
        <p className="brm-wifipanel-lede">{W.shareNudgeBody}</p>
        <p className="brm-wifipanel-say">{W.shareWho}</p>
      </>
    );
    foot = (
      <>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={notNow}>{W.notNow}</button>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--primary brm-push" disabled={busy} onClick={() => share(true)}>{W.shareDemo}</button>
      </>
    );
  } else if (s.state === 'failed') {
    body = <div className="brm-wifipanel-err"><b>It didn&apos;t start.</b> {lan.error}</div>;
    foot = (
      <>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => share(false)}>{W.stopSharing}</button>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--primary brm-push" disabled={busy} onClick={() => share(true)}>{W.tryAgain}</button>
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
        <QuietWarning />
        <Address link={link} note={W.wifiFailsForRoom} copy={false} />
        <RemoteSwitch lan={lan} busy={busy} run={run} api={api} />
      </>
    );
    foot = (
      <>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={onClose}>{W.keepSharing}</button>
        {/* Sharing that reaches nobody only exposes the laptop: Stop is the move (D2 quiet). */}
        <button type="button" className="brm-btn brm-btn--sm brm-btn--primary brm-push" disabled={busy} onClick={() => share(false)}>{W.stopSharing}</button>
      </>
    );
  } else {
    body = (
      <>
        <p className="brm-wifipanel-stat">{rs === 'live' ? W.remoteOpenedOf(s.open, here) : W.shareOpenedOf(s.open, here)}</p>
        {rs === 'live' && <RemotePeople people={remotePeople(lan)} busy={busy} run={run} api={api} />}
        <Address link={link} note={W.shareWhoShort} />
        {s.open < here && rs !== 'live' && <p className="brm-wifipanel-say">{W.shareNotAll(s.open, here)}</p>}
        <RemoteSwitch lan={lan} busy={busy} run={run} api={api} />
      </>
    );
    foot = (
      <>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => share(false)}>{W.stopSharing}</button>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--primary brm-push" disabled={!link} onClick={onShowWall}>{W.shareShowOnStage}</button>
      </>
    );
  }
  return (
    <div className="brm-wifipanel" role="dialog" aria-label={W.shareDemo} ref={panelRef}>
      <div className="brm-wifipanel-top">
        <h3>{head}</h3>
        <button type="button" className="brm-wifipanel-x" aria-label="Close" onClick={onClose}><Icon name="X" size={16} /></button>
      </div>
      {body}
      {live && <AppList map={map} />}
      <div className="brm-wifipanel-foot">{foot}</div>
    </div>
  );
}

/**
 * REMOTE SHARE, R1-R3 (owner 2026-10-16): one switch under the address, off by
 * default every session. Its words say who it reaches; never "tunnel". Off and
 * on again is also how a failed start is retried.
 */
export function RemoteSwitch({ lan, busy, run, api }) {
  const rs = remoteState(lan);
  const on = rs !== 'off';
  const remote = (lan && lan.remote) || {};
  let line;
  let small = null;
  if (rs === 'off') { line = W.remoteOffBody; small = W.remoteOffSmall; }
  else if (rs === 'starting') line = W.remoteStarting;
  else if (rs === 'live') { line = W.remoteLiveBody; small = W.remoteLiveSmall; }
  else { line = <><b className="brm-wifipanel-bad">{W.remoteFailedHead}</b> {remote.error}</>; small = W.remoteWifiFine; }
  return (
    <div className={`brm-wifipanel-sw brm-wifipanel-sw--${rs}`} data-testid="brm-remote">
      <button
        type="button" role="switch" aria-checked={on} aria-label={W.remoteSwitch}
        className={`brm-wifipanel-tg${on ? ' is-on' : ''}`} disabled={busy}
        onClick={() => run(() => api.share({ remote: !on }))}
      />
      <div className="brm-wifipanel-swtx">
        <b>{W.remoteSwitch}</b>
        <span {...(rs === 'starting' ? { role: 'status' } : {})}>{line}</span>
        {small && <small>{small}</small>}
      </div>
    </div>
  );
}

const PEOPLE_SHOWN = 3;

/**
 * R2: who opened it remotely, by name, with devices. More than one device on
 * a person is marked, with Remove: the Session panel's own remove (reversible
 * there), which ends their key. A second press confirms.
 */
export function RemotePeople({ people, busy, run, api }) {
  const [sure, setSure] = useState('');
  if (!people || !people.length) return null;
  const shown = people.slice(0, PEOPLE_SHOWN);
  const more = people.length - shown.length;
  const remove = (name) => {
    if (sure !== name) { setSure(name); return; }
    setSure('');
    run(() => api.playerRemoved(name, true));
  };
  return (
    <ul className="brm-wifipanel-people" aria-label="Who opened it remotely">
      {shown.map((p) => (
        <li key={p.name} className={p.devices > 1 ? 'is-many' : ''}>
          <span className="brm-wifipanel-who" title={p.name}>{p.name}</span>
          <span className="brm-wifipanel-dev">{W.remoteDevices(p.devices)}</span>
          {p.devices > 1 && (
            <button type="button" className="brm-btn brm-btn--sm brm-btn--ghostdanger" disabled={busy} onClick={() => remove(p.name)}>
              {sure === p.name ? W.remoteRemoveSure(p.name) : W.remoteRemove}
            </button>
          )}
        </li>
      ))}
      {more > 0 && <li className="brm-wifipanel-more">{W.remoteMore(more)}</li>}
    </ul>
  );
}

/** Nobody has opened it in 2 minutes: what to try (D2 quiet). The host's, never the room's. */
export function QuietWarning() {
  return (
    <div className="brm-wifipanel-warn">
      <b>{W.wifiQuietHead}</b> {W.wifiQuietBody}
      <ul>
        <li>{W.wifiTest}</li>
        <li>{W.wifiSameAdvice}</li>
      </ul>
    </div>
  );
}

/** More than one app shared: each, by name, with Copy. The QR is the newest (wifiLink). */
export function AppList({ map }) {
  if (!map || map.length < 2) return null;
  return (
    <ul className="brm-wifipanel-apps">
      {map.map((m, i) => (
        <li key={m.lan}>
          <span className="brm-wifipanel-k">{APP_NAMES[i] || `App ${i + 1}`}</span>
          <span className="brm-wifipanel-u" title={m.local}>{shownAddress(m.lan)}</span>
          {m.link && <CopyLink link={m.link} />}
        </li>
      ))}
    </ul>
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

/* ------------------------------------------------------------- two codes -- */

/**
 * A code on its white quiet zone, sized by its box (BuildRoom.css). Level M
 * and a four-module margin: the join and demo links are both version 4, 41
 * modules with the margin (docs/design/build-room-two-qr, Sizes).
 */
export function CodeBox({ value, label, className = '' }) {
  return (
    <span className={`brm-codes-qr${className ? ` ${className}` : ''}`} role="img" aria-label={label}>
      <QRCodeSVG value={value} size={256} level="M" marginSize={4} />
    </span>
  );
}

/**
 * Which Demo tile to draw: 'none' (nothing runnable: screenshots alone), or
 * the chip's own state (wifiState), so the tile and the chip never disagree.
 */
export function demoSlotOf(room, now) {
  if (!demoRunnable(room)) return 'none';
  return wifiState(room && room.lan, now).state;
}

/** The demo is on the Stage card only while it can be opened: live or quiet (no auto-hide, owner 2026-10-11). */
export function demoOnStage(room, now, link) {
  const st = wifiState(room && room.lan, now).state;
  return Boolean(link) && (st === 'on' || st === 'quiet');
}

/** The QR-shaped frame a code will fill: the three corner marks over a soft dot field. */
function DemoSlot({ tbd = false, bad = false, status = false, children }) {
  return (
    <div className={`brm-codes-slot${tbd ? ' brm-codes-slot--tbd' : ''}${bad ? ' is-bad' : ''}`} {...(status ? { role: 'status' } : {})}>
      {tbd && (
        <>
          <span className="brm-codes-fp brm-codes-fp--tl" aria-hidden="true" />
          <span className="brm-codes-fp brm-codes-fp--tr" aria-hidden="true" />
          <span className="brm-codes-fp brm-codes-fp--bl" aria-hidden="true" />
        </>
      )}
      <div className="brm-codes-slot-t">{children}</div>
    </div>
  );
}

/**
 * THE DEMO TILE (two codes, C; owner 2026-10-11). The Session panel's demo,
 * every state the inline Share demo panel had: No demo yet (the placeholder),
 * Not shared (Share demo), Starting or waiting, live with the count, quiet,
 * failed (Try again). Wi-Fi only: a remote link goes to browsers, never here.
 * The orange inside it is the room group's one orange in the states where it
 * leads (Share demo, Try again); RoomCodes keeps the rest plain.
 */
export function DemoTile({ room, now, link, here = 0, busy, run, api }) {
  const st = demoSlotOf(room, now);
  const lan = (room && room.lan) || {};
  const share = (on) => run(() => api.share({ on }));
  const stop = <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => share(false)}>{W.stopSharing}</button>;
  const open = Number(lan.open) || 0;
  let visual;
  let sub = '';
  let line = null;
  let acts = null;
  let mod = '';
  const live = (st === 'on' || st === 'quiet') && link;
  if (st === 'none') {
    visual = <DemoSlot tbd><b>{W.noDemoYet}</b><span>{W.noDemoBody}</span></DemoSlot>;
    line = <p className="brm-codes-m">{W.noDemoRoom}</p>;
  } else if (st === 'off') {
    visual = (
      <DemoSlot>
        <b>{W.notShared}</b>
        <span>{W.onlyThisLaptop}</span>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={() => share(true)}>{W.shareDemo}</button>
      </DemoSlot>
    );
    line = <p className="brm-codes-m">{W.shareWho}</p>;
  } else if (st === 'failed') {
    mod = ' is-warn';
    visual = (
      <DemoSlot bad>
        <b>It didn&apos;t start.</b>
        {lan.error && <span>{lan.error}</span>}
        <button type="button" className="brm-btn brm-btn--sm brm-btn--primary" disabled={busy} onClick={() => share(true)}>{W.tryAgain}</button>
      </DemoSlot>
    );
    acts = stop;
  } else if (live) {
    mod = st === 'quiet' ? ' is-warn is-quiet' : ' is-live';
    sub = W.codesSameWifi;
    visual = <CodeBox value={link} label="QR code to open the demo" />;
    line = st === 'quiet'
      ? <p className="brm-codes-m">{W.noneOpened}</p>
      : <p className="brm-codes-st">{W.openedOfHere(open, here)}</p>;
    acts = (
      <>
        <CopyLink link={link} />
        {st === 'on' && stop}
      </>
    );
  } else {
    // Starting, waiting for Claude Code, or live before the link is known.
    visual = st === 'waiting'
      ? <DemoSlot status><b>Claude Code has not answered.</b><span>{W.wifiWaiting}</span></DemoSlot>
      : <DemoSlot status><b>{W.shareStarting}</b><span>{W.demoSlotStarting}</span></DemoSlot>;
    acts = stop;
  }
  return (
    <div className={`brm-codes-tile${mod}`} data-testid="brm-demo-tile" data-state={st}>
      {visual}
      <h4 className="brm-codes-h">{W.codesDemo}{sub && <span>{sub}</span>}</h4>
      {live && <span className="brm-codes-u">{shownAddress(link)}</span>}
      {line}
      {acts && <div className="brm-codes-acts">{acts}</div>}
    </div>
  );
}

/**
 * THE STAGE CARD (two codes, B and C): Join left, the demo right while it can
 * be opened; when the demo stops or fails its half leaves and the card is Join
 * alone, never an empty slot. Room ladder; every line 12 words or fewer, and
 * a count only once someone has opened it. A click on a code enlarges it alone.
 */
export function WallCodes({ room, now, link, onZoom }) {
  const demo = demoOnStage(room, now, link);
  const open = Number(room && room.lan && room.lan.open) || 0;
  const playUrl = `${window.location.origin}/play?gameId=${room.gameId}`;
  return (
    <section className={`brm-wallcodes${demo ? '' : ' is-one'}`} aria-label={demo ? 'The join and demo codes' : 'The join code'} data-testid="brm-wallcodes">
      <div className="brm-wallcodes-c">
        <button type="button" className="brm-wallcodes-qr" aria-label="Enlarge the join code" onClick={() => onZoom('join')}>
          <CodeBox value={playUrl} label={`QR code to join at ${playUrl}`} />
        </button>
        <span className="brm-wallcodes-eb">{W.stageJoinEyebrow}</span>
        <h2 className="brm-wallcodes-h">{W.stageJoinHead}</h2>
        <p className="brm-wallcodes-l">{`${window.location.host}/play \u00b7 code `}<b>{room.gameId}</b></p>
      </div>
      {demo && (
        <div className="brm-wallcodes-c">
          <button type="button" className="brm-wallcodes-qr" aria-label="Enlarge the demo code" onClick={() => onZoom('demo')}>
            <CodeBox value={link} label="QR code to open the demo" />
          </button>
          <span className="brm-wallcodes-eb is-live">{W.stageDemoLive}</span>
          <h2 className="brm-wallcodes-h">{W.stageDemoHead}</h2>
          <p className="brm-wallcodes-l">{W.stageSameWifi}</p>
          {open > 0 && <p className="brm-wallcodes-n">{W.stageOpened(open)}</p>}
        </div>
      )}
    </section>
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
