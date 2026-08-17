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
 *
 * `caption` REPLACES THE FIRST FACT WHEN THE ITEMS ARE NOT COUNTABLE. Prose has
 * no honest "4–6 of 20": a room cannot be told it is looking at lines 18 to 34
 * of a summary and be any the wiser, and printing a line count invites the
 * reader to believe the count is stable when the model's next rewrite changes
 * it. What a room CAN use is the name of the section it is reading — which the
 * summary's own `##` heading already supplies — so Field Notes prints
 * `Next Steps · page 3 of 4 · ↑ ↓ to page`. The other two facts are unchanged,
 * so the line still says where you are and how to move.
 */
export function pagerLabel({
  caption = '', noun = 'Responses', from, to, total, page, pages,
} = {}) {
  const what = caption ? String(caption) : `${noun} ${from}–${to} of ${total}`;
  return `${what} · page ${page + 1} of ${pages} · ↑ ↓ to page`;
}

/* ===========================================================================
   PAGING PROSE, WHICH IS A DIFFERENT PROBLEM FROM PAGING A LIST
   ===========================================================================

 * The owner, on the pager that shipped for VOTE and RESULTS: *"it seems like we
 * still have some cutoff and no way to scroll down, as the entire page scrolls
 * down. should be able to flip through details. most apparent in the ai
 * feedback page results."*
 *
 * Field Notes is the state that escaped, because everything above pages a LIST
 * and Workie's summary is not one. `pageSlice` needs items; the summary is one
 * continuous markdown document. Three ways to cut it were on the table.
 *
 *   A MEASURED COLUMN — render it, read the box, cut where it stops fitting.
 *     Rejected for the two reasons the answer budget was already declared
 *     rather than measured, both of which bite HARDER here. jsdom reports every
 *     box as zero, so a measured cut is a feature no test in this repo can hold
 *     (RESUME.md, Landmines). And a measured cut MOVES: the fitter is running
 *     against this same box and changes `--fit` as a consequence of what is on
 *     the page, so a page boundary derived from the rendered height feeds back
 *     into the scale that produced it. The room would watch the text resize
 *     and the boundary walk.
 *
 *   BY RENDERED BLOCK, N BLOCKS TO A PAGE — simple, testable, and wrong in the
 *     one way that matters: a block is not a unit of stage. One paragraph and
 *     one twelve-item list are both "a block", and a page of three blocks is
 *     either two-thirds empty or twice over the screen depending on which
 *     three it got.
 *
 *   BY SECTION, WITH A LINE BUDGET — what this does, and it is the summary's
 *     OWN structure rather than one imposed on it. lambda-functions/game/
 *     personas.js `buildOutputContract()` tells the model, non-negotiably, to
 *     "reply using exactly these N headings, in this order, spelled exactly as
 *     shown, and add no other headings" — so a `##` heading is a boundary the
 *     AUTHOR drew, and cutting there cuts nothing in half. Default shape is
 *     three sections (Summary / Discussion Questions / Next Steps), which is
 *     three pages a host can flip like cards, each with its own name on the
 *     pager line.
 *
 * THE LINE BUDGET IS THE FALLBACK, AND IT IS NOT OPTIONAL. Two paths reach this
 * with no headings at all: get-ai-summary.js:201 stores `markdownResponse: raw`
 * when the model's reply does not parse, and a prompt may declare its own
 * shape. Sections alone would put the whole of that on one page, which is the
 * defect the owner reported. So a section that outruns the budget CONTINUES on
 * the next page — and the pager keeps printing the section's name, so a room
 * looking at a continuation still knows what it is reading.
 *
 * ------------------------------------------------------------------ the unit
 *
 * A LINE OF 34 CHARACTERS. `styles/stage.css` declares exactly one measure for
 * Field Notes body text — `.notes li span{max-width:34ch}` — and
 * `09-field-notes.html` clamps that same span to three lines under pressure.
 * So 34ch is the design's own line, not a guess, and the cost of a block is how
 * many of them its text needs. Computed from the SOURCE STRING and nothing
 * else, which is what makes it stable: the summary is written once per beat and
 * never changes under the host's eye, so unlike a measured cut this boundary
 * cannot move while the room is looking at it.
 *
 * It is an ESTIMATE and it is allowed to be. Paging removes the pressure; it
 * does not repeal the fitter, which is still behind this doing what it does.
 */

/** The stylesheet's own Field Notes measure: `.notes li span{max-width:34ch}`. */
export const PROSE_MEASURE = 34;

/**
 * How many 34-character lines of prose fit on one page, per display profile.
 *
 * Room is read off `09-field-notes.html`: its Field Notes body is a lead beside
 * three points, each point clamped at three lines — call it nine lines of point
 * plus the lead's own — across the two columns `.notes .notes-md{column-count:2}`
 * gives the markdown path. Eighteen.
 *
 * The other three keep the answer budget's ratios exactly, because they are the
 * same ladders being divided: TV's type is ~1.3x Room's on every rung and the
 * design spec says of TV in so many words that "less content fits", Call keeps
 * Room's ladder verbatim and changes treatment only, and Table's is ~0.65x with
 * the reader at arm's length. 18 : 12 : 18 : 30 is 3 : 2 : 3 : 5, six lines to
 * the response card.
 */
export const PROSE_BUDGET = {
  room: 18,
  tv: 12,
  call: 18,
  table: 30,
};

export const DEFAULT_PROSE_BUDGET = 18;

export function proseBudgetFor(profile) {
  const size = PROSE_BUDGET[String(profile ?? '').toLowerCase()];
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_PROSE_BUDGET;
}

/**
 * What a run of markdown costs in lines, once its decoration is discounted.
 *
 * `**Lead phrase**: the rest` is fourteen characters of asterisk and bracket
 * that occupy no width on screen, and a link's href is the whole URL for a
 * label of two words. Counting the raw source would bill a page for characters
 * the room never sees, so the markers come off first. Never less than one: a
 * block occupies a line even when it is empty.
 */
export function proseCost(text) {
  const plain = String(text ?? '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/\[([^\]]*)\]\([^)\s]*\)/g, '$1')
    .replace(/[*_`|]/g, '')
    .trim();
  return Math.max(1, Math.ceil(plain.length / PROSE_MEASURE));
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*)$/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
const RULE_RE = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const ITEM_RE = /^\s{0,3}(?:[-*+]|\d+[.)])\s+/;
const QUOTE_RE = /^\s{0,3}>\s?/;
const ROW_RE = /^\s{0,3}\|.*\|\s*$/;

/**
 * The summary, cut into the smallest pieces a page boundary may fall between.
 *
 * THE GRAMMAR IS MarkdownRenderer's, DELIBERATELY. A boundary this file draws
 * in a place that file does not recognise is a boundary that reaches a
 * projector as raw characters — cut a table between its header and its
 * separator row and page two prints `| --- | --- |`. So fences, tables and
 * quote runs are ATOMIC here for the same reason they are atomic there.
 *
 * A LIST ITEM IS ITS OWN BLOCK, though, and that is the one place this is
 * finer-grained than the renderer. A list is the shape Workie's Discussion
 * Questions and Next Steps always take (personas.js asks for "two or three
 * numbered questions" and "two to four numbered, concrete actions"), and a
 * ten-item list held atomic is exactly the page-sized cliff this exists to
 * remove. Splitting between items is safe because the ordinal travels in the
 * source — `3. …` stays `3. …` — and MarkdownRenderer now carries that number
 * onto the `<ol start>` rather than restarting at 1. That mattering at all is
 * the same positional-label trap `pageSlice`'s `offset` exists for: a room
 * being asked about "question 1" that the host calls "question 3".
 */
export function proseBlocks(markdown) {
  const lines = String(markdown ?? '').split('\n');
  const blocks = [];
  let run = null;      // { kind, lines: [] } for the runs that accumulate
  const flush = () => {
    if (!run) return;
    const text = run.lines.join('\n');
    blocks.push({
      text,
      lines: run.kind === 'fence' || run.kind === 'table'
        ? Math.max(1, run.lines.length)
        : proseCost(text),
      heading: false,
      level: 0,
    });
    run = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (run && run.kind === 'fence') {
      run.lines.push(line);
      if (FENCE_RE.test(trimmed)) flush();
      continue;
    }
    if (FENCE_RE.test(trimmed)) { flush(); run = { kind: 'fence', lines: [line] }; continue; }

    if (!trimmed) { flush(); continue; }

    const heading = trimmed.match(HEADING_RE);
    if (heading) {
      flush();
      blocks.push({
        text: trimmed,
        lines: proseCost(heading[2]),
        heading: true,
        level: heading[1].length,
        title: heading[2].replace(/[*_`]/g, '').trim(),
      });
      continue;
    }

    // A rule is tested before a table row so a `| --- |` separator is never
    // eaten as one — the same ordering MarkdownRenderer uses, for the same
    // reason.
    if (RULE_RE.test(trimmed)) { flush(); blocks.push({ text: trimmed, lines: 1, heading: false, level: 0 }); continue; }

    if (ROW_RE.test(trimmed) && trimmed.length > 2) {
      if (!run || run.kind !== 'table') { flush(); run = { kind: 'table', lines: [] }; }
      run.lines.push(line);
      continue;
    }
    if (run && run.kind === 'table') flush();

    if (QUOTE_RE.test(trimmed)) {
      if (!run || run.kind !== 'quote') { flush(); run = { kind: 'quote', lines: [] }; }
      run.lines.push(line);
      continue;
    }
    if (run && run.kind === 'quote') flush();

    if (ITEM_RE.test(trimmed)) {
      // Each item stands alone. A continuation line indented under one is
      // flattened into it by the renderer, so it is appended here too rather
      // than becoming a paragraph that could be paged away from its item.
      flush();
      run = { kind: 'item', lines: [line] };
      continue;
    }
    if (run && run.kind === 'item') { run.lines.push(line); continue; }

    if (!run || run.kind !== 'para') { flush(); run = { kind: 'para', lines: [] }; }
    run.lines.push(line);
  }
  flush();
  return blocks;
}

/**
 * The document, cut into pages.
 *
 * Two rules, in this order:
 *
 *   1. A TOP-LEVEL HEADING ALWAYS OPENS A PAGE. `##` is the boundary the
 *      output contract makes the model draw, so a section never begins halfway
 *      down a page under the tail of the one before it. `###` and below do NOT
 *      break — they are structure INSIDE a section, and breaking on them would
 *      shred a section the model deliberately subdivided.
 *   2. OTHERWISE, FILL TO THE BUDGET. A block that would put the page over goes
 *      on the next one — unless the page is empty, in which case it goes on
 *      anyway: an oversized block gets a page to itself rather than looping
 *      forever, and the fitter takes it from there.
 *
 * AND A HEADING NEVER ENDS A PAGE. A page whose last block is a heading names a
 * section whose body is on the next page — the room reads a title, the host
 * turns, and the title is gone. Any trailing headings are carried over with the
 * block that displaced them.
 *
 * AND A HEADING IS NEVER A PAGE ON ITS OWN, which is the same fault in its
 * other half and shipped as a bug:
 *
 *     "the word summary is by itself and you have to page often, several times
 *      there is just the title of the section: Summary, Next Steps. that makes
 *      for a confusing experience."
 *
 * Reported on TV and Projector, and TV is where it bit hardest because its
 * budget is the smallest of the four (12 lines) so the least content has to
 * overflow before it fires. The mechanism: a heading opened a page, the very
 * next block was bigger than what remained, the carry above popped the heading
 * off to travel with it — and then a guard put the heading BACK and closed the
 * page anyway, emitting the title alone. That guard's comment said it was
 * avoiding "an empty page and an orphan pair"; it was manufacturing the orphan.
 *
 * When everything on the page is headings there is nothing to break AFTER, so
 * the answer is not to break at all. The oversized block joins its title and
 * overflows the budget by design — the fitter is still behind this — because a
 * title with its body beats a title alone, and a block that was already over
 * budget gains nothing from a split that cannot make it smaller.
 *
 * The two rules together are one invariant, and it is worth stating as one
 * because either half alone reintroduces the other: EVERY PAGE CONTAINS AT
 * LEAST ONE BLOCK THAT IS NOT A HEADING.
 *
 * Returns `[{ text, section }]` — `section` being the `##` in force at the top
 * of that page, carried forward onto continuations so page 3 of Next Steps
 * still says Next Steps.
 */
export function prosePages(markdown, budget) {
  const per = Number.isFinite(Number(budget)) && Number(budget) > 0
    ? Math.floor(Number(budget)) : DEFAULT_PROSE_BUDGET;
  const blocks = proseBlocks(markdown);
  if (!blocks.length) return [];

  const groups = [];
  let current = [];
  let used = 0;
  const close = () => { if (current.length) groups.push(current); current = []; used = 0; };

  /** Is there anything on this page yet that is not a title? */
  const hasBody = () => current.some((b) => !b.heading);

  blocks.forEach((block) => {
    if (block.heading && block.level <= 2) {
      // Break only when there is a body to break AFTER. Two headings in a row —
      // `## Next Steps` immediately followed by `### This week`, which is a
      // shape the model does produce — would otherwise close a page holding
      // nothing but the first of them.
      if (hasBody()) close();
    } else if (current.length && used + block.lines > per) {
      const carried = [];
      while (current.length && current[current.length - 1].heading) carried.unshift(current.pop());
      if (!current.length) {
        /*
          EVERYTHING WE HAD WAS HEADINGS, so there is nothing to break after and
          we do not break. Put them back and let the oversized block join them.

          This branch used to restore the headings and then `close()` anyway,
          which is precisely how "just the title of the section: Summary, Next
          Steps" reached a projector. The page now runs over budget instead —
          deliberately, and harmlessly: the block was already too big for a page
          of its own, so no boundary available here makes it fit, and the fitter
          scales what lands. `used` is left alone because `current` is restored
          to exactly what it was.
        */
        current = carried;
      } else {
        close();
        current = carried;
        used = carried.reduce((n, b) => n + b.lines, 0);
      }
    }
    current.push(block);
    used += block.lines;
  });
  close();

  let section = '';
  return groups.map((group) => {
    if (group[0].heading && group[0].level <= 2) section = group[0].title || '';
    return { text: group.map((b) => b.text).join('\n\n'), section };
  });
}

/**
 * One page of the summary, and where it sits — `pageSlice`'s shape for prose.
 *
 * Clamped, not reset, for the same reason the answer list is: a Redo rewrites
 * the summary underneath a host who has already paged into it, and landing on
 * the last page that exists beats a blank projector.
 */
export function prosePageSlice(markdown, index, budget) {
  const all = prosePages(markdown, budget);
  const pages = Math.max(1, all.length);
  const page = clampPage(index, pages);
  const chosen = all[page] || { text: '', section: '' };
  return { content: chosen.text, section: chosen.section, page, pages };
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
