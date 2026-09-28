import { useEffect, useRef, useState } from 'react';
import { openPdfAt } from '../../utils/pdfDeck';

/**
 * A PRESENTATION'S SLIDES, OPENED — the stage's and a phone's. `deckId` names
 * the deck (the item and the upload), and while it stays the same the PDF is
 * fetched and opened once; a new id (a replaced deck, another talk) opens the
 * new one, and null closes it. `signedRead` is asked for the signed URL each
 * time a deck is opened — the stage's readDeck, a phone's getDeck — and held
 * through a ref, so a new function on every render does not re-open anything.
 *
 * Returns `{ doc, loading, error, retry }`: pdf.js's document once it is open,
 * and a sentence for the screen when it could not be.
 */
export default function useSlides(signedRead, deckId) {
  const read = useRef(signedRead);
  read.current = signedRead;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ doc: null, loading: false, error: '' });

  useEffect(() => {
    if (!deckId) {
      setState({ doc: null, loading: false, error: '' });
      return undefined;
    }
    let live = true;
    let opened = null;
    setState({ doc: null, loading: true, error: '' });
    (async () => {
      try {
        const signed = await read.current();
        const doc = await openPdfAt(signed.url);
        if (!live) {
          // Closed (or moved on) while it was opening: nobody will show it.
          if (doc && typeof doc.destroy === 'function') doc.destroy();
          return;
        }
        opened = doc;
        setState({ doc, loading: false, error: '' });
      } catch (error) {
        if (live) setState({ doc: null, loading: false, error: 'The slides could not be loaded.' });
      }
    })();
    return () => {
      live = false;
      if (opened && typeof opened.destroy === 'function') opened.destroy();
    };
  }, [deckId, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
