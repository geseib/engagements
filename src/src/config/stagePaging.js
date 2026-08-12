/**
 * Paging the answer list, and the one key that drives it.
 *
 * THE PROBLEM THIS EXISTS FOR. On a dense round the responses exceed the stage
 * and are simply cut off. The fitter is not the answer and cannot be: it shrinks
 * type to `--fit` and stops at the profile floor, and `07-results-trivia.html`
 * already renders at `--fit: 0.55` with `data-clamped="on"` at 1280x720 on real
 * content — the floor is reached before a podium even exists. Once the floor
 * binds, the only levers left remove content, and a room cannot see what was
 * removed. So the list has to become finite and the host has to be able to move
 * through it.
 *
 * PAGING, NOT SCROLLING, AND THAT IS THE DESIGN'S OWN ANSWER. A scrollbar is
 * invisible from twenty-five feet and a scroll position is unnameable — "there
 * is more below" is not something a room can be told by a 6px track.
 * `05-vote.html` draws the answer instead: a row of pips plus
 * `Responses 1-3 of 20 - page 1 of 7 - ^ v to page`. A position that can be
 * READ is what makes the cut honest.
 *
 * ---------------------------------------------------------------- the budget
 *
 * PAGE SIZE IS DECLARED PER PROFILE, NOT MEASURED, and that is deliberate
 * twice over.
 *
 *   - A measured page size is a number that moves. It would recompute whenever
 *     an answer arrived, so the host's "page 2 of 5" would silently become
 *     "page 2 of 7" and the cards under their eye would change while the room
 *     watched. Nothing may reflow when the beat changes underneath it; a
 *     declared budget is the only version with that property.
 *   - A measured page size cannot be tested here at all. jsdom has no layout
 *     engine, so every geometric assertion returns zero and passes
 *     unconditionally — see docs/handoff/RESUME.md's Landmines. A budget is a
 *     number a test can hold.
 *
 * The numbers are derived, not guessed. `05-vote.html` shows THREE responses at
 * Room on a 20-response round ("Responses 1-3 of 20"), so Room is 3. TV's ladder
 * is roughly 1.3x Room's on every rung and the spec says of TV in so many words
 * that "the consequence is that LESS CONTENT FITS" (design spec 4.4), so TV is
 * 2. Call keeps Room's ladder verbatim and changes treatment only, so Call is
 * Room's 3. Table's ladder is roughly 0.65x Room's and the reader is at
 * arm's length, so Table is 5.
 *
 * This is a BUDGET, not a guarantee. A page of three 900-word responses still
 * overflows, and the fitter is still behind this doing what it does. Paging
 * removes the pressure; it does not repeal the fitter.
 *
 * ------------------------------------------------------------------- the key
 *
 * UP AND DOWN, AND NOTHING ELSE. `05-vote.html`'s own pager line says `^ v to
 * page`, so the binding is the design's, not an invention. It also happens to
 * be the only binding that is safe here, and the reasoning is worth writing out
 * because the failure mode is a live session:
 *
 *   - SPACE, `Spacebar` and `ArrowRight` advance the round
 *     (components/HostActionBar.jsx). A presenter's clicker sends keys with no
 *     meaningful `event.target`, so anything bound here is bound for the
 *     clicker too.
 *   - `ArrowLeft` is the clicker's other button and is reserved for stepping the
 *     beat backwards — `09-field-notes.html` draws a `< Results` secondary and
 *     the server supports `beat: 'results'` in both directions. Binding it to
 *     paging would take a key the design has already spent.
 *   - `PageDown` / `PageUp` are what many presenter remotes send INSTEAD of the
 *     arrows, depending on the mode they are switched to. They look free
 *     because nothing in this codebase listens for them; they are the least
 *     free keys on the list.
 *
 * `ArrowUp` / `ArrowDown` are sent by no presenter remote, are bound nowhere in
 * this product, and mean vertically what they do here. `pageIntentFor` returns
 * null for every other key, which is what keeps this from SWALLOWING the advance
 * keys — the handler must be able to see a Space and decline it, and a test
 * enumerates the ones it must decline.
 */

/**
 * How many responses fit on one page of stage, per display profile.
 *
 * Keys match config/displayProfile.js's PROFILES. A profile missing here falls
 * back to Room's budget rather than to something permissive: showing too few is
 * a page turn, showing too many is content off the bottom of a projector.
 */
export const PAGE_SIZE = {
  room: 3,
  tv: 2,
  call: 3,
  table: 5,
};

export const DEFAULT_PAGE_SIZE = 3;

export function pageSizeFor(profile) {
  const size = PAGE_SIZE[String(profile ?? '').toLowerCase()];
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_PAGE_SIZE;
}

/**
 * How many pages a list of `total` items needs.
 *
 * Never less than 1, so callers can divide and compare without guarding: an
 * empty list is one empty page, not zero pages, and `clampPage` below relies on
 * that to avoid returning -1.
 */
export function pageCount(total, size) {
  const n = Number(total);
  const per = Number(size);
  if (!Number.isFinite(n) || n <= 0) return 1;
  if (!Number.isFinite(per) || per <= 0) return 1;
  return Math.max(1, Math.ceil(n / per));
}

/**
 * The page index that is actually reachable.
 *
 * ANSWERS ARRIVE WHILE THE HOST IS PAGING. During VOTE the list grows under
 * them, and on a re-fetch it can shrink. A host parked on page 5 when the list
 * drops to two pages must land on the last page that exists, not on a blank
 * stage — which is what a raw index does. Clamped rather than reset, so a page
 * turn is never undone by an unrelated arrival.
 */
export function clampPage(index, pages) {
  const i = Number(index);
  const n = Number(pages);
  const last = Number.isFinite(n) && n > 0 ? Math.floor(n) - 1 : 0;
  if (!Number.isFinite(i) || i < 0) return 0;
  return Math.min(Math.floor(i), last);
}

/**
 * The slice on screen, WITH ITS ABSOLUTE OFFSET.
 *
 * `offset` is the whole point of the return shape and is not a convenience.
 * Every anonymous response on this stage is labelled positionally —
 * `displayLabelFor(answer, index)` renders `Response ${index + 1}`, and
 * PlayerPage renders the same label from the same index on every phone in the
 * room. Slice the array and map the page with a fresh `idx` and page two's
 * first card is labelled "Response 1" on the projector while it says "Response
 * 4" in twelve hands. The offset is what keeps the two agreeing, and
 * __tests__/stagePaging.test.js holds it.
 *
 * `from` / `to` are 1-based and inclusive because that is what the pager line
 * prints; `offset` is the 0-based index to add to a map's counter.
 */
export function pageSlice(items, index, size) {
  const list = Array.isArray(items) ? items : [];
  const per = Number.isFinite(Number(size)) && Number(size) > 0
    ? Math.floor(Number(size)) : DEFAULT_PAGE_SIZE;
  const pages = pageCount(list.length, per);
  const page = clampPage(index, pages);
  const offset = page * per;
  const slice = list.slice(offset, offset + per);
  return {
    items: slice,
    offset,
    from: list.length ? offset + 1 : 0,
    to: offset + slice.length,
    page,
    pages,
    total: list.length,
  };
}

/**
 * The pager's own sentence, from `05-vote.html`'s pager line verbatim.
 *
 * Three facts, in the order the mockup puts them: which responses these are,
 * which page this is, and how to move. The last clause is the only operator
 * instruction the room ever sees on this line and it earns its place — a
 * position indicator that does not say how to change position is a status
 * light.
 */
export function pagerLabel({ noun = 'Responses', from, to, total, page, pages } = {}) {
  return `${noun} ${from}–${to} of ${total} · page ${page + 1} of ${pages} · ↑ ↓ to page`;
}

const TYPING_TAGS = { INPUT: true, TEXTAREA: true, SELECT: true };

/**
 * Is this key event a page turn, and which way?
 *
 * Returns 'next', 'prev', or null — and NULL IS THE IMPORTANT RETURN. A handler
 * built on this sees every keystroke on the window, including the three that
 * advance the round, and declines them without touching them. Nothing here
 * calls preventDefault or stopPropagation; that is the caller's job and only on
 * a non-null result, so a Space that reaches this function leaves through it
 * unchanged and lands on HostActionBar exactly as it did before.
 *
 * THE THREE REFUSALS, each of which is a live defect if dropped:
 *
 *   - MODIFIERS. Shift+Arrow is a text selection and Cmd/Ctrl+Arrow is a
 *     browser or OS gesture. Neither is a page turn.
 *   - TYPING TARGETS. A `<select>` is driven by the arrow keys — and the stage
 *     has two of them in reach (the persona picker on FIELD_NOTES, the profile
 *     picker in the session panel). Stealing Down from an open select is the
 *     most obvious way this feature breaks something that already worked.
 *   - THE SESSION PANEL. It is deliberately NOT part of `shortcutsSuppressed`
 *     (see utils/hostOverlays.js: it stops at the top of the dock and the
 *     primary stays live beneath it), so the narrow hazard it does introduce is
 *     handled the same way HostActionBar handles it — by where the key landed,
 *     not by geometry.
 */
export function pageIntentFor(event) {
  if (!event) return null;
  const key = event.key;
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  const target = event.target;
  if (target && target.tagName && TYPING_TAGS[target.tagName]) return null;
  if (target && target.isContentEditable) return null;
  if (target && typeof target.closest === 'function' && target.closest('.setup-panel')) return null;
  return key === 'ArrowDown' ? 'next' : 'prev';
}
