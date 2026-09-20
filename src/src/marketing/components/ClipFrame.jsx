import React, { useEffect, useRef } from 'react';
import DeviceFrame from './DeviceFrame';
import ClipStill from './ClipStill';
import { CLIPS } from '../content/clips';
import { prefersReducedMotion } from '../useScrollProgress';
import './ClipFrame.css';

/** `clip` overrides the manifest entry — for tests, and for the capture script's preview. */
export default function ClipFrame({ slot, clip: override }) {
  const clip = override || CLIPS[slot];
  const ref = useRef(null);
  const playable = Boolean(clip && (clip.webm || clip.mp4)) && !prefersReducedMotion();

  // Play only while on screen. No autoplay attribute: seven looping videos
  // decoding at once on a phone is a cost nobody watching one of them agreed to.
  useEffect(() => {
    const video = ref.current;
    if (!playable || !video || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { const p = video.play(); if (p && p.catch) p.catch(() => {}); } else video.pause();
    }, { threshold: 0.4 });
    observer.observe(video);
    return () => observer.disconnect();
  }, [playable]);

  if (!clip) return null;

  return (
    <DeviceFrame kind={clip.frame} caption={clip.caption}>
      {playable ? (
        <video ref={ref} className="mk-clip-media" muted loop playsInline preload="none" poster={clip.poster || undefined} aria-label={clip.alt}>
          {clip.webm && <source src={clip.webm} type="video/webm" />}
          {clip.mp4 && <source src={clip.mp4} type="video/mp4" />}
        </video>
      ) : clip.poster ? (
        <img className="mk-clip-media" src={clip.poster} alt={clip.alt} loading="lazy" />
      ) : (
        <ClipStill slot={slot} alt={clip.alt} />
      )}
    </DeviceFrame>
  );
}
