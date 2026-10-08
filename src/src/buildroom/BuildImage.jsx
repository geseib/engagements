/**
 * A Build Room screenshot (docs/design/build-room/PLAN.md, images).
 *
 * The bytes are private: the host reads them with its sign-in, a phone with
 * its seat ({playerName, clientId}). How to turn an imageId into something an
 * <img> can show is therefore the SURFACE's business, handed down once through
 * ImageLoader rather than threaded through every component that shows one.
 * A picture opens IN the app (owner, 2026-10-08: "clicking on it take me to a
 * new tab that i have to close to get back"): the surface hands down an
 * ImageViewer opener, and a picture that has no opener is simply a picture. It
 * never opens a tab by itself; the viewer carries a small "Open full size" link
 * for putting it on a second screen.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';

/** (imageId) => Promise<string url>. Null when the surface shows no images. */
export const ImageLoader = createContext(null);

/** ({imageId, caption}) => void. Null where a surface has no viewer. */
export const ImageViewer = createContext(null);

/** The url for one image, or null while it loads (or if it cannot). */
export function useImageUrl(imageId) {
  const load = useContext(ImageLoader);
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (!load || !imageId) return undefined;
    Promise.resolve(load(imageId)).then((u) => { if (live) setUrl(u); }, () => {});
    return () => { live = false; };
  }, [load, imageId]);
  return url;
}

export default function BuildImage({ imageId, caption, className = '', alt, linked = true, onOpen = null }) {
  const load = useContext(ImageLoader);
  const openImage = useContext(ImageViewer);
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
  const open = onOpen || (linked && openImage ? () => openImage({ imageId, caption: caption || alt || '' }) : null);
  return (
    <figure className={`bimg ${className}`.trim()}>
      {open && url
        ? <button type="button" className="bimg-open" onClick={open} aria-label={`Look closer: ${text}`} title="Look closer">{img}</button>
        : img}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
