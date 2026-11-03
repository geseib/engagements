# Desk reviews: the console's left rail

Three reviews of `index.html` / `1-*.png` … `8-*.png`, made at the desk on 3 Nov 2026, each
in a reviewer's voice. Revisions made because of them are listed at the end and are
already in the README and mockup.

## 1. The owner

> I asked for 5/6 in the closed People header and you said no. Convince me.

- **O1. The count.** Frame 2 does convince: the 5 of 6 is right there in big type, and
  "waiting on Marcus" is the thing I'd actually say out loud ("Marcus, we're waiting on
  you"). Fine. But with 30 people "waiting on Marcus, Ana +17" is useless. *(→ H2.)*
- **O2. Orange.** I said orange "or whatever theme is applied" because I wanted it to
  catch my eye. Frame 5 vs frame 4 shows why green is right: if 6/6 were orange I would
  read it as Sam again. Agree. The green should be noticeable though, not just a border:
  the 10% wash helps.
- **O3. The "!"**. I imagined an exclamation mark. The dot plus the name says more than a
  "!" would. Agree, as long as it is the same dot as the line.
- **O4. Scores always.** Yes. I liked seeing them muted while people answer and brighter
  at results; it tells me when to read them out.
- **O5. "top: Priya, 40"** in the closed header: I'd keep it. It's what I'd glance for.
- **O6.** Does People still pop open when someone asks? *Yes, once (D3). If you close it
  the header holds the mark.* Good: the current lock annoyed me in the dev walk.

## 2. A weekly host (runs a Friday team quiz, 8–25 people, Trivia and C&A)

- **H1.** First thing I noticed in frame 1: names are readable now. On dev today I see
  "Ana Lucí…" and hover to find out who. The ✓ and … are obvious; I don't need the words.
- **H2.** With 25 people at the start of a round, "waiting on Ana, Ben +21" is noise.
  Above some number, just tell me how many. **Revised:** past 12 people still out the
  clause reads "waiting on 14"; names return when it drops to a dozen or fewer. (That number
  is the rail's own and only appears when names would be useless.)
- **H3.** I fold People during Trivia to watch the queue. Frame 7's closed headers would
  let me do that and still see who's slow. That's the whole ask, really.
- **H4.** Rows not re-sorting at Results: I'd briefly like them ranked. But S shows the
  board, and I'd lose my place. Fine as is.
- **H5.** "–" for a score before round 1 is scored: better than a column of zeros that
  looks like everyone failed.
- **H6.** Late as a little dot and "2 to review", not orange: good. On dev the orange
  Late count made me think something was wrong every round with comments.

## 3. An accessibility reviewer (WCAG 2.1 AA)

- **A1. Contrast.** Measured, composited (README §6): lowest new pairing 5.14:1
  (`--muted` on tile 1's success wash). The lit header's name in `--accent-text` on the
  wash 7.75:1 Classic, 8.00:1 Present. Pass.
- **A2. Tooltips are not accessible.** The full "waiting on" list and the truncated
  "next:" title live in `title=`, which keyboard and screen-reader users never get.
  **Revised:** the summary's accessible name carries the full sentence (README D7); the
  visible text may truncate, the name may not.
- **A3. Glyph status.** ✓ and … differ by shape, not only colour (1.4.1 pass). Each glyph
  needs `role="img"` and an `aria-label` ("answered", "still writing"), not just `title`.
  Already in the implementation note; keep it.
- **A4. Motion.** One 240ms fade of paint only, never repeating; reduced motion draws the
  end state (2.3.1, 2.3.3 pass). The 120ms caret rotation must also stop under reduced
  motion; it does.
- **A5. Announcements.** Good that the header has no live region: the line's
  `aria-live="polite"` already speaks the request, and two regions would say it twice.
  Tile 1's "Everyone's in" is the only other announcement; fine.
- **A6. The disclosure.** The caret is decorative (`aria-hidden`); `<details>`/`<summary>`
  exposes expanded/collapsed. Removing the no-op click (F4) fixes a control that
  announced "button" and did nothing.
- **A7. Target size.** The ⋯ shrank from 32px to 28px in the compact row. 2.5.8 (AA, 2.2)
  needs 24px; pass, but do not go lower.

## Revisions made

| From | Change | Where |
|---|---|---|
| Making frame 1 (before review) | Status became a glyph in the rail; the 92px word slot left names ~90px | README D7, frames 1, 3, 6, 8 |
| H2 / O1 | Past 12 still out, "waiting on 14" instead of names | README D7 |
| A2 | Full "waiting on" list in the summary's accessible name, not only `title=` | README D7 |
| A3 | Glyph needs `role="img"` + `aria-label`, not just `title` | README §5 |
