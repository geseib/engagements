import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

/**
 * THE JOIN CODE BESIDE THE CONTENT, NOT OVER IT (owner, 18 Oct 2026,
 * docs/design/room-content-v2 frames 9 and 10):
 *
 *   "i like this idea whenever the host wants to show the qr code. it moves
 *    the screen around a bit so all content is there but the qr code is
 *    avail."
 *
 * The lobby's join block (styles/stage.css `.joinblock`, `.qr`), stacked in a
 * panel on the right of the one-screen stage while a round is up: the QR, the
 * promise, the address and the code. GameHostPage draws it when the
 * stage-focus `join` fact is true, inside `.content[data-join]`, which narrows
 * the content's column so the fitter steps the type down beside it. It holds
 * no state: showing and hiding it is the host's J / the rail's code, through
 * POST /stage-focus `{ join }`.
 *
 * Outside the fitter's reach on purpose — it carries no data-drop and no
 * class from the fitter's CONTENT list — because the point of putting it up
 * is that it stays up.
 */
export const JOIN_PROMISE = 'Scan to join · no app, no account';

/**
 * The address may wrap only before its path, never inside the domain: the
 * panel broke "engage.dev.seibtribe. / us/play" (walk of dev 409c6621).
 */
function breakableUrl(url) {
  const s = String(url || '');
  const at = s.indexOf('/');
  if (at <= 0) return s;
  return <>{s.slice(0, at)}<wbr />{s.slice(at)}</>;
}

/**
 * `second`: a Build Room's demo while it is shared on the Wi-Fi ({ url, head,
 * note }), the panel's second code below the join (docs/design/room-content-v2:
 * "Two QR codes in Build Room ... so its QR panel holds both"). Both codes
 * then step down to share the panel's height.
 */
/**
 * `onZoom(which)`: the host's own screen may enlarge a code ('join' or
 * 'second') to read or copy it. The room's window passes none, so nothing on
 * it is pressable.
 */
export default function StageJoinPanel({ playUrl, joinUrl, code, second = null, onZoom = null }) {
  const qr = (which, value, label) => {
    const box = <QRCodeSVG value={value || ''} size={512} level="M" includeMargin={false} />;
    return onZoom
      ? <button type="button" className="qr stage-join-zoom" aria-label={label} onClick={() => onZoom(which)}>{box}</button>
      : <div className="qr">{box}</div>;
  };
  return (
    <aside className={`stage-join${second ? ' is-two' : ''}`} aria-label="Join this session" data-testid="stage-join-panel">
      {qr('join', playUrl, 'Enlarge the join code')}
      <p className="stage-join-k">{JOIN_PROMISE}</p>
      <p className="stage-join-url">{breakableUrl(joinUrl)}</p>
      <p className="stage-join-code">{code}</p>
      {second && second.url ? (
        <div className="stage-join-second" data-testid="stage-join-second">
          {qr('second', second.url, second.zoomLabel || 'Enlarge this code')}
          {second.head ? <p className="stage-join-k">{second.head}</p> : null}
          {second.note ? <p className="stage-join-note">{second.note}</p> : null}
        </div>
      ) : null}
    </aside>
  );
}
