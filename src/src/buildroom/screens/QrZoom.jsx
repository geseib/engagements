/**
 * A CODE, BIG ENOUGH TO SCAN FROM THE BACK OF THE ROOM (moved from
 * BuildRoomPage.jsx in B6).
 */
import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Modal from '../../components/Modal';
import { copyText } from '../../utils/copyText';
import { W } from '../words';
import { shownAddress } from '../BuildWifiShare';

/** The full join link, copied with one click, so the host can paste it into a chat or an email. */
export function CopyLinkButton({ url, className, children }) {
  const [said, setSaid] = useState('');
  const copy = async (e) => {
    e.stopPropagation(); // inside the enlarged QR, a click anywhere else closes it
    const ok = await copyText(url);
    setSaid(ok ? 'Link copied' : 'Press and hold to copy');
    setTimeout(() => setSaid(''), 2500);
  };
  return (
    <button type="button" className={className} onClick={copy} title={`Copy ${url}`} aria-label={`Copy the join link ${url}`}>
      {children}
      <span className="brm-copied" role="status">{said}</span>
    </button>
  );
}

/**
 * The QR, big enough to scan from the back of the room (owner, 2026-10-04).
 * A click anywhere puts it away; the link under it copies instead.
 */
export function QrZoom({ playUrl, gameId, onClose, demoLink = '' }) {
  if (demoLink) {
    // The demo's code alone, for a long room (two codes, 2026-10-11). Its key
    // is in the code, never in the words: the address shows host and port only.
    return (
      <Modal overlayClassName="brm-qrzoom" contentClassName="brm-qrzoom-card" onClose={onClose} label="Demo QR code">
        <div className="brm-qrzoom-body" onClick={onClose}>
          <div className="brm-qrzoom-qr" role="img" aria-label="QR code to open the demo">
            <QRCodeSVG value={demoLink} size={512} level="M" includeMargin={false} />
          </div>
          <div className="brm-qrzoom-url">{shownAddress(demoLink)}</div>
          <div className="brm-qrzoom-code">{W.stageSameWifi}</div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal overlayClassName="brm-qrzoom" contentClassName="brm-qrzoom-card" onClose={onClose} label="Join QR code">
      <div className="brm-qrzoom-body" onClick={onClose}>
        <div className="brm-qrzoom-qr" role="img" aria-label={`QR code to join at ${playUrl}`}>
          <QRCodeSVG value={playUrl} size={512} level="M" includeMargin={false} />
        </div>
        <CopyLinkButton url={playUrl} className="brm-qrzoom-url">{playUrl}</CopyLinkButton>
        <div className="brm-qrzoom-code">Code <b>{gameId}</b></div>
      </div>
    </Modal>
  );
}
