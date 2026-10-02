/**
 * A Build Room screenshot (docs/design/build-room/PLAN.md, images).
 *
 * The bytes are private: the host reads them with its sign-in, a phone with
 * its seat ({playerName, clientId}). How to turn an imageId into something an
 * <img> can show is therefore the SURFACE's business, handed down once through
 * ImageLoader rather than threaded through every component that shows one.
 * The image opens full size in a new tab — the host clicks a mockup to put it
 * on the projector.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';

/** (imageId) => Promise<string url>. Null when the surface shows no images. */
export const ImageLoader = createContext(null);

export default function BuildImage({ imageId, caption, className = '', alt, linked = true }) {
  const load = useContext(ImageLoader);
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null);
    setFailed(false);
    if (!load || !imageId) return undefined;
    Promise.resolve(load(imageId)).then(
      (u) => { if (live) setUrl(u); },
      () => { if (live) setFailed(true); },
    );
    return () => { live = false; };
  }, [load, imageId]);
  if (!imageId || !load || failed) return null;
  const text = alt || caption || 'Screenshot';
  const img = url
    ? <img src={url} alt={text} loading="lazy" />
    : <span className="bimg-wait" role="img" aria-label={`${text} (loading)`} />;
  return (
    <figure className={`bimg ${className}`.trim()}>
      {linked && url ? <a href={url} target="_blank" rel="noopener noreferrer" title="Open full size">{img}</a> : img}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
