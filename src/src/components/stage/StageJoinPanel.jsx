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

export default function StageJoinPanel({ playUrl, joinUrl, code }) {
  return (
    <aside className="stage-join" aria-label="Join this session" data-testid="stage-join-panel">
      <div className="qr">
        <QRCodeSVG value={playUrl || ''} size={512} level="M" includeMargin={false} />
      </div>
      <p className="stage-join-k">{JOIN_PROMISE}</p>
      <p className="stage-join-url">{joinUrl}</p>
      <p className="stage-join-code">{code}</p>
    </aside>
  );
}
