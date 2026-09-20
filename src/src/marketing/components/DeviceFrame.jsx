import React from 'react';
import './DeviceFrame.css';

/**
 * The bezel around a screen clip. This is the ONE <figure> a clip renders —
 * ClipFrame does not nest a figure inside this one. `tv` and `laptop` sit on
 * a foot; `phone` carries a notch instead. `caption` becomes the figcaption.
 */
export default function DeviceFrame({ kind = 'tv', caption, children }) {
  return (
    <figure className={`mk-device mk-device--${kind}`}>
      <div className="mk-device-bezel">
        <div className="mk-device-screen">
          {kind === 'phone' && <div className="mk-device-notch" />}
          {children}
        </div>
      </div>
      {kind !== 'phone' && <div className="mk-device-foot" />}
      {caption && <figcaption className="mk-device-cap">{caption}</figcaption>}
    </figure>
  );
}
