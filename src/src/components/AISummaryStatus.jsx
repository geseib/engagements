import React from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import Pager from './stage/Pager';
import {
  pageSizeFor, pageSlice, proseBudgetFor, prosePageSlice,
} from '../config/stagePaging';

/**
 * The Field Notes body: whichever of Workie's four states is true right now.
 *
 * WHY THIS IS A COMPONENT. It was inline in GameHostPage's FIELD_NOTES branch,
 * where it had exactly three states — writing, written, and a placeholder. The
 * placeholder ("Nothing to read back yet — this fills in once responses are in")
 * is what a host saw when the *trigger request itself failed*, which is a
 * sentence that is not true and offers nothing to do about it. Adding a fourth
 * state is the fix; making it a component is what lets the fourth state be
 * tested, because GameHostPage cannot be rendered in jsdom — it dies on the auth
 * provider — and six earlier fixes in this repo took the same route.
 *
 * FAILURE OUTRANKS EVERYTHING. A failure is shown even while an automatic retry
 * is pending: the honest thing to put in front of a room is "this went wrong and
 * I am trying again", not a spinner that hides the first half of that. `retrying`
 * only changes the button, never whether the message is there.
 *
 * Classes are the stage's own (`qdetail`, `notes`, `lead`, `btn`) — the failure
 * block introduces no styling of its own, so it inherits the stage's type scale
 * and stays legible from the back of a room.
 *
 * ------------------------------------------------------------- and it PAGES
 *
 * This is the state the first pager missed. VOTE and RESULTS page a list of
 * answers; Field Notes is one continuous document, so `pageSlice` had nothing
 * to slice and the summary simply ran off the bottom of `.content`, which is
 * `overflow:hidden` — no scrollbar, no announcement, and on a projector no way
 * for the room to get at it. The owner: *"should be able to flip through
 * details. most apparent in the ai feedback page results."*
 *
 * BOTH SHAPES PAGE, BY DIFFERENT RULES, BECAUSE THEY ARE DIFFERENT THINGS.
 * The markdown body is prose and is cut by `prosePageSlice` at the model's own
 * `##` boundaries with a line budget behind it (config/stagePaging.js carries
 * the argument). The structured body is already a LIST of points, so it takes
 * the same `pageSlice` and the same per-profile budget as the answer cards —
 * and 09-field-notes.html draws exactly three points at Room, which is
 * `PAGE_SIZE.room`.
 *
 * THE LEAD STAYS ON EVERY PAGE OF THE STRUCTURED SHAPE, and that is free rather
 * than generous: `.notes.two` is a two-column grid with the lead in one column
 * and the points in the other, so the lead costs the points no vertical stage
 * at all. It is the thesis sentence; a room reading point 7 with the claim it
 * supports gone off screen is worse off than before.
 *
 * PAGING IS OPT-IN VIA `onPage`. Without a handler nothing is sliced and no
 * pager is drawn — the whole summary renders as it always did. A caller that
 * cannot page (no state to hold the index) must not get a silently truncated
 * summary and a control that does nothing.
 *
 * `enabled` IS THE CALLER'S `!shortcutsSuppressed({...})`, passed straight
 * through to Pager. Not re-derived here: a second suppression rule beside the
 * existing one is a rule that drifts from it.
 */
export default function AISummaryStatus({
  loading = false,
  insights = null,
  failure = null,
  retrying = false,
  onRetry = null,
  profile = 'room',
  page = 0,
  onPage = null,
  enabled = true,
}) {
  if (failure) {
    return (
      <div className="ai-summary-failure" role="alert">
        <p className="qdetail ai-summary-failure-headline"><b>{failure.headline}</b></p>
        <p className="qdetail ai-summary-failure-detail">{failure.detail}</p>
        {onRetry && (
          <button
            type="button"
            className="btn ghost ai-summary-retry-btn"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? 'Trying again…' : 'Try again'}
          </button>
        )}
      </div>
    );
  }

  if (loading) {
    return <p className="qdetail">Workie is reading the responses…</p>;
  }

  const paged = typeof onPage === 'function';

  if (insights && insights.markdownResponse) {
    // The markdown path is ONE child, so the two-column `.notes` grid would
    // squeeze it into half the stage; stage.css splits that one with CSS
    // columns instead.
    const slice = paged
      ? prosePageSlice(insights.markdownResponse, page, proseBudgetFor(profile))
      : { content: insights.markdownResponse, section: '', page: 0, pages: 1 };
    return (
      <>
        <div className="notes">
          <MarkdownRenderer content={slice.content} className="notes-md" />
        </div>
        {/* `total` IS THE PAGE COUNT and `pageSize` is 1: for prose the item
            being paged is the page itself, and `caption` means the from/to
            clause is never printed. A room cannot use "lines 18–34 of 61"; it
            can use the name of the section it is looking at, which the
            summary's own heading supplies. The fallback names the state rather
            than leaving the line to open on a bare "· page 2 of 4". */}
        {paged && (
          <Pager
            total={slice.pages}
            pageSize={1}
            page={slice.page}
            caption={slice.section || 'What we heard'}
            onPage={onPage}
            enabled={enabled}
          />
        )}
      </>
    );
  }

  if (insights) {
    // `two` is the mockup's own two-column Field Notes grid (09-field-notes):
    // width is the cheapest lever on the stage, and this state needs it most.
    // It only applies to the structured path, which has two children to split.
    //
    // THE MARKS ARE BUILT BEFORE THE SLICE, NOT AFTER. Numbering a page with a
    // fresh counter labels page two's first question "1" while the host, and
    // the session report, call it "4" — the same positional-label trap
    // pageSlice's `offset` exists for on the answer cards.
    const points = [
      ...(insights.discussionTopics || []).map((text, idx) => ({ mark: String(idx + 1), text })),
      ...(insights.nextSteps || []).map((text) => ({ mark: '→', text })),
    ];
    const size = pageSizeFor(profile);
    const slice = paged
      ? pageSlice(points, page, size)
      : { items: points, page: 0, pages: 1 };
    return (
      <>
        <div className="notes two">
          {/* Markdown, not a bare string: the structured path still carries
              the model's **bold** in its summary text, and a <p> printed the
              asterisks on the wall.
              It is OUTSIDE the slice on purpose — the grid gives it its own
              column, so repeating the thesis on every page costs the points no
              vertical stage and stops page 3 from being claims with no claim. */}
          <MarkdownRenderer content={insights.summary} className="lead" />
          <ol>
            {slice.items.map((point, idx) => (
              <li key={`${point.mark}-${idx}`}><b>{point.mark}</b><span>{point.text}</span></li>
            ))}
          </ol>
        </div>
        {/* Only when the caller is actually holding a page index. Pips drawn
            over an unpaged list are a control that does nothing, and the list
            underneath them is the whole list. */}
        {paged && (
          <Pager
            total={points.length}
            pageSize={size}
            page={slice.page}
            noun="Notes"
            onPage={onPage}
            enabled={enabled}
          />
        )}
      </>
    );
  }

  return (
    <p className="qdetail">
      Nothing to read back yet — this fills in once responses are in.
    </p>
  );
}
