// src/src/components/console/panels/ReadPanel.jsx
import React, { useEffect, useRef } from 'react';
import MarkdownRenderer from '../../MarkdownRenderer';
import CW from '../../../config/consoleWords';
import { prosePageSlice } from '../../../config/stagePaging';
import ReadCheckNote from '../../ReadCheckNote';
import Button from '../../ui/Button';

/**
 * Workie's read, as the host works with it (host console spec): the whole read,
 * drawn with the same renderer, and — when the host opens Ask the room — the
 * composer beside it in the right column instead of a dialog.
 *
 * WHICH PART THE WALL SHOWS (owner, 16 Oct 2026). Given the wall's `page` and
 * prose `budget`, the read is drawn as the wall's own slices
 * (config/stagePaging.js prosePageSlice, the function and budget the wall
 * pages with, so the marking matches it exactly). The slice on the wall now
 * carries an accent bar along its left edge and "On the wall" on its first
 * line, and is scrolled into view when the page changes. Without a page the
 * read is drawn whole, as before.
 *
 * THE READ CHECK'S NOTE (`readCheck`, from the host's door only): one small
 * line under the heading when Workie's read still uses words the answers do
 * not support. The console is the host's screen; the wall never draws it.
 */
function slicesOf(markdown, budget) {
  const first = prosePageSlice(markdown, 0, budget);
  const out = [first];
  for (let i = 1; i < first.pages; i += 1) out.push(prosePageSlice(markdown, i, budget));
  return out;
}

function ReadSlices({ markdown, page, budget, askAddon }) {
  const onWallRef = useRef(null);
  const slices = slicesOf(markdown, budget);
  const current = Math.min(Math.max(0, page), slices.length - 1);
  useEffect(() => {
    const el = onWallRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [current, markdown]);
  return slices.map((slice, i) => {
    const on = i === current;
    return (
      <div key={i} ref={on ? onWallRef : null} className={`hc-read-page${on ? ' is-onwall' : ''}`} data-page={i}>
        {on ? <p className="hc-onwall-k">{CW.onTheWallShort}</p> : null}
        <MarkdownRenderer content={slice.content} className="hc-md" listItemAddon={askAddon} />
      </div>
    );
  });
}

/*
  THE READ THAT DID NOT ARRIVE (experience plan §4.2 row 5, step 1e). The
  one-screen stage has had a failure state with Retry since the stage's
  AISummaryStatus; the console drew an empty "Workie's read" card with the main
  button unlocked. Same failure model (`failure` = { headline, detail }, the
  page's aiSummaryFailure), same handlers, the console's own card: Retry
  (the automatic-retry button, "Trying again…" while it runs) and Redo.
*/
export function ReadFailureCard({ failure, onRetry = null, onRedo = null, retrying = false }) {
  return (
    <div className="hc-card hc-failcard" role="alert" data-testid="read-failure">
      <h3 className="hc-card-h">{CW.readTitle}</h3>
      <p className="hc-fail-h"><b>{failure.headline || CW.readFailed}</b></p>
      {failure.detail ? <p className="hc-muted">{failure.detail}</p> : null}
      <div className="hc-fail-acts">
        {typeof onRetry === 'function' ? (
          <Button size="sm" variant="quiet" onClick={onRetry} disabled={retrying}>{retrying ? CW.retrying : CW.retry}</Button>
        ) : null}
        {typeof onRedo === 'function' ? (
          <Button size="sm" variant="quiet" onClick={onRedo} disabled={retrying}>{CW.redo}</Button>
        ) : null}
      </div>
    </div>
  );
}

export default function ReadPanel({
  kicker, markdown, askAddon = null, afterRead = null, composer = null, page = null, budget = null, readCheck = null,
  failure = null, onRetry = null, onRedo = null, retrying = false, loading = false,
}) {
  const sliced = Number.isInteger(page) && Number(budget) > 0 && Boolean(markdown);
  const writing = loading && !String(markdown || '').trim();
  const read = failure ? <ReadFailureCard failure={failure} onRetry={onRetry} onRedo={onRedo} retrying={retrying} /> : writing ? (
    <div className="hc-card" data-testid="read-writing">
      <h3 className="hc-card-h">{CW.readTitle}</h3>
      <p className="hc-muted" role="status">{CW.readWriting}</p>
    </div>
  ) : (
    <div className="hc-card">
      {/* "The wall shows this page" only beside a read that exists: while Workie
          is still writing there is nothing on the wall to point at (review #38). */}
      <h3 className="hc-card-h">{sliced || !String(markdown || '').trim() ? CW.readTitle : `${CW.readTitle} · ${CW.readOnWall}`}</h3>
      {String(markdown || '').trim() ? <ReadCheckNote readCheck={readCheck} className="hc-muted" /> : null}
      {sliced
        ? <ReadSlices markdown={markdown} page={page} budget={budget} askAddon={askAddon} />
        : <MarkdownRenderer content={markdown || ''} className="hc-md" listItemAddon={askAddon} />}
      {afterRead}
    </div>
  );
  const kick = <p className="hc-kicker">{kicker}</p>;
  /* While composing, the kicker rides in the read's column so both columns
     start at the top of the main area: the composer can then be exactly the
     main area's height (HostConsole.css) and its Send never falls below the
     fold (walk, 15 Oct: Send at y≈1259 on a 768px laptop). */
  if (composer) {
    return (
      <section className="hc-panel is-composing">
        <div className="hc-cols is-read">
          <div className="hc-panel">{kick}{read}</div>
          {composer}
        </div>
      </section>
    );
  }
  return (
    <section className="hc-panel">
      {kick}
      <div className="hc-cols is-one">{read}</div>
    </section>
  );
}
