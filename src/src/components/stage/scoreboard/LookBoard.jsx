import React, { useEffect, useRef } from 'react';
import { createDepartureEngine } from './departureEngine';
import { createOlympicEngine } from './olympicEngine';
import { createToteEngine } from './toteEngine';

/**
 * One of the three looks, hosting its engine.
 *
 * The engines (departureEngine.js, olympicEngine.js, toteEngine.js) are the
 * mockups' motion, ported: they own everything inside the container this
 * renders, and React owns nothing in there. This component is only their
 * lifecycle — create on mount, hand them the field and the page, re-measure on
 * a resize, tear down on unmount.
 *
 * A LOOK SWITCH IS A REMOUNT. Scoreboard.jsx keys this by the look, so V on
 * the stage (or the phone's picker) builds the new look fresh on the page the
 * room was on — "the board re-lays out in the new look on the current page".
 */
export const LOOKS = {
  departure: { create: createDepartureEngine, className: 'sb-sfb' },
  olympic: { create: createOlympicEngine, className: 'sb-olb' },
  tote: { create: createToteEngine, className: 'sb-tote' },
};

export default function LookBoard({
  look, rows, allRows, pageSize, view, replay = false, reduced = false, afterRound = null, onRound,
}) {
  const ref = useRef(null);
  const engineRef = useRef(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const onRoundRef = useRef(onRound);
  onRoundRef.current = onRound;
  const lastRef = useRef({ fieldKey: null, size: null, seq: null });
  const spec = LOOKS[look] || LOOKS.departure;

  useEffect(() => {
    const engine = spec.create(ref.current, {
      reduced: () => reducedRef.current,
      onRound: (n) => { if (typeof onRoundRef.current === 'function') onRoundRef.current(n); },
    });
    engineRef.current = engine;
    lastRef.current = { fieldKey: null, size: null, seq: null };

    // A resize — or a profile change, which moves the ladders — changes the
    // geometry the engines fitted to. Debounced, as the mockups do it.
    // Only a real change: a relayout abandons the page's entrance (and the
    // tote's replay) for the result, so a resize event that moved nothing
    // must not cost the room the motion.
    let timer = null;
    const box = () => (ref.current ? `${ref.current.clientWidth}x${ref.current.clientHeight}` : '');
    let measured = box();
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const now = box();
        if (now === measured || !engineRef.current) return;
        measured = now;
        engineRef.current.relayout();
      }, 150);
    };
    window.addEventListener('resize', onResize);
    // The fits read rendered text; if the display face is still loading, fit
    // again once it lands.
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (fonts && fonts.status !== 'loaded' && fonts.ready) {
      fonts.ready.then(() => { if (engineRef.current === engine) engine.relayout(); });
    }
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      engine.destroy();
      engineRef.current = null;
    };
  }, [spec]);

  // One key for "the field changed": who is on it, where, with what.
  const fieldKey = (allRows || []).map((r) => `${r.id}:${r.place}:${r.total}:${r.movement}`).join('|');

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const last = lastRef.current;
    if (last.fieldKey !== fieldKey || last.size !== pageSize) engine.loadField(allRows, pageSize);
    // The replay belongs to the page's arrival, never to a refetch of it.
    const arriving = last.seq !== view.seq;
    engine.show(rows, { replay: arriving && replay, page: view.page, afterRound });
    lastRef.current = { fieldKey, size: pageSize, seq: view.seq };
  // `rows` and `allRows` are derived from fieldKey + page; listing them would
  // re-run the show on every render of the parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKey, pageSize, view.seq, spec]);

  return <div ref={ref} className={spec.className} data-look={look} />;
}
