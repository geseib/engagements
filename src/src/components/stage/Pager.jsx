import React, { useEffect } from 'react';
import {
  pageCount, clampPage, pagerLabel, pageIntentFor, DEFAULT_PAGE_SIZE,
} from '../../config/stagePaging';

/**
 * The way through a list that does not fit — ported from `05-vote.html`'s
 * `.pager` (a row of pips plus `Responses 1-3 of 20 - page 1 of 7 - ^ v to
 * page`), which is where this design already exists.
 *
 * WHY THE ROOM GETS A POSITION AND NOT A SCROLLBAR. Nobody twenty-five feet
 * away can see a 6px track, and a scroll offset is not a fact anyone can state
 * out loud. "Page 3 of 7" is. The pips carry the same fact pre-attentively, so
 * the back of the room reads the shape and the front reads the sentence.
 *
 * THE KEY HANDLER LIVES HERE, and that is a deliberate choice about testing.
 * GameHostPage cannot mount in jsdom, so a listener written inline there is a
 * listener nothing can exercise; seven precedents say extract the surface
 * instead. `config/stagePaging.js`'s `pageIntentFor` owns WHICH keys count and
 * this owns what happens when one does, so both halves are reachable.
 *
 * IT NEVER TOUCHES THE ADVANCE KEYS. `pageIntentFor` returns null for Space,
 * `Spacebar`, `ArrowRight`, `ArrowLeft`, `PageDown` and `PageUp`, and this
 * handler calls `preventDefault` only on a non-null result — so every one of
 * them passes through untouched to HostActionBar's window listener. Binding
 * anything a presenter clicker sends would have been the defect: a clicker
 * sends keys with no meaningful `event.target`, so there is no "only when
 * focused here" escape.
 *
 * `enabled` IS THE EXISTING SUPPRESSION MECHANISM, NOT A NEW ONE. The caller
 * passes `!shortcutsSuppressed({...})` — the same value the dock's SPACE
 * affordance and HostActionBar's listener are gated on — so a pinned QR, an
 * open modal or the expanded lesson takes the page keys away exactly as it
 * takes the advance key away, and nothing new has to be kept in step.
 * __tests__/pagerCallSite.test.js reads that argument at the call site,
 * because RESUME.md records that deleting an argument at a call site
 * reinstates a defect with the whole suite green.
 *
 * NOTHING RENDERS WHEN NOTHING IS HIDDEN. One page is not a page; a room with
 * three responses sees the list it always saw, with no pips and no instruction
 * about a control that would do nothing.
 *
 * `caption` IS FOR THE CONTENT THAT CANNOT BE COUNTED. Field Notes pages PROSE,
 * not items, and "lines 18–34 of 61" tells a room nothing it can use. Passing a
 * caption swaps that clause for the name of the section on screen — `Next
 * Steps · page 3 of 4 · ↑ ↓ to page` — and leaves the position and the key hint
 * exactly where they were. Callers that page prose hand `total` the PAGE COUNT
 * with `pageSize={1}`, because for prose the item IS the page; the from/to
 * arithmetic below still runs and is still correct, it is simply not printed.
 *
 * NOT DROPPABLE, AND THIS IS A DEPARTURE FROM THE MOCKUP THAT IS WORTH THE
 * WORDS. `05-vote.html` marks its pager `data-drop="1"` — the first thing the
 * fitter sacrifices. That is right for the mockup, where the pager ANNOTATES a
 * cut the fitter had already made and dropping it loses an annotation. It is
 * wrong here, where the pager announces a cut THE PAGER ITSELF MADE: without
 * the line, a room looking at three of twenty responses has nothing on screen
 * telling it there are seventeen more, and the host has no sign the keys do
 * anything. "A reduction with no recovery is a deletion" (design spec 7.10) —
 * the pager is the recovery. `.stage-authors-toggle` on RESULTS is the existing
 * precedent for a control kept out of the sacrifice list for the same shape of
 * reason.
 */
export default function Pager({
  total, page = 0, pageSize, noun = 'Responses', caption = '', onPage, enabled = true,
}) {
  // Normalised ONCE, and never re-derived from `total / pages`. `Math.ceil(4/2)`
  // is 2, not the 3 the slice actually took, so a re-derived size prints
  // "Responses 1–2 of 4" over three cards on the last short page.
  const per = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0
    ? Math.floor(Number(pageSize)) : DEFAULT_PAGE_SIZE;
  const pages = pageCount(total, per);
  const current = clampPage(page, pages);
  const movable = pages > 1 && typeof onPage === 'function';

  useEffect(() => {
    if (!enabled || !movable) return undefined;
    const onKeyDown = (event) => {
      const intent = pageIntentFor(event);
      // EVERY OTHER KEY LEAVES UNTOUCHED. No preventDefault, no
      // stopPropagation, no early swallow — Space and the arrows the clicker
      // sends reach HostActionBar exactly as they would if this were not here.
      if (!intent) return;
      // Only now: Down would otherwise scroll the document behind a stage that
      // is `height:100dvh; overflow:hidden`, which does nothing visible and
      // moves the focus ring off screen.
      event.preventDefault();
      // WRAPS. A presenter reaching the last page and pressing Down again gets
      // page 1 rather than a key that has silently stopped working; on a stage
      // with a printed position indicator the return is legible rather than
      // disorienting. Auto-repeat is allowed here, unlike the advance key,
      // because a page turn is reversible and its meaning does not change
      // between repeats — which is the whole reason HostActionBar refuses
      // `event.repeat`.
      const next = intent === 'next'
        ? (current + 1) % pages
        : (current - 1 + pages) % pages;
      onPage(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, movable, current, pages, onPage]);

  if (pages <= 1) return null;

  const from = current * per + 1;
  const to = Math.min(total, from + per - 1);

  return (
    <div className="pager" data-pager="" data-pages={pages} data-page={current}>
      {/* THE PIPS ARE BUTTONS. The mockup draws inert `<i>` dots, and inert is
          right for the room — but the host may be on a laptop with a trackpad
          and no keyboard hand free, and the dots are already drawn, already
          the right size, and already say which page is which. Making them
          activatable costs no stage and adds the only pointer route to a page
          that is not the arrow keys. */}
      {Array.from({ length: pages }, (unused, i) => (
        <button
          key={i}
          type="button"
          className={`pip${i === current ? ' on' : ''}`}
          aria-label={`Page ${i + 1} of ${pages}`}
          aria-current={i === current ? 'true' : undefined}
          onClick={() => onPage && onPage(i)}
        />
      ))}
      <span className="pgr-label">
        {pagerLabel({ caption, noun, from, to, total, page: current, pages })}
      </span>
    </div>
  );
}
