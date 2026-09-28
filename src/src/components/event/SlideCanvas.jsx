import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { drawPage, isCancelled } from '../../utils/pdfDeck';

/**
 * ONE SLIDE, AS LARGE AS ITS BOX ALLOWS — letterboxed, never cropped, never
 * stretched, never scrolled. The box is the element this renders (`className`
 * gives it its place); it is measured, and the page is drawn to fit it, again
 * whenever it changes size (a resize, a rotated tablet, the dock taking a
 * second line) or the page changes. The canvas is positioned inside the box,
 * so what it draws can never change what is measured.
 *
 * `label` is the slide said in words for a screen reader ("FY26 in review,
 * Slide 3 of 12"): a canvas is otherwise silent. A draw the page has moved on
 * from is cancelled, not reported; a real failure goes to `onError`.
 */
export default function SlideCanvas({ doc, page, className, label, onError }) {
  const box = useRef(null);
  const canvas = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const failed = useRef(onError);
  failed.current = onError;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => {
      const width = Math.floor(el.clientWidth);
      const height = Math.floor(el.clientHeight);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer) observer.observe(el);
    else window.addEventListener('resize', measure);
    return () => {
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    if (!doc || !canvas.current || !size.width || !size.height) return undefined;
    const controller = new AbortController();
    drawPage(doc, page, canvas.current, size, { signal: controller.signal }).catch((error) => {
      if (!controller.signal.aborted && !isCancelled(error) && failed.current) failed.current(error);
    });
    return () => controller.abort();
  }, [doc, page, size]);

  return (
    <div className={className} ref={box}>
      <canvas ref={canvas} role="img" aria-label={label} />
    </div>
  );
}
