# The hard rules, and the incidents that produced them

A rule with no reason gets "tidied up" by the next agent. Each one below carries the
defect it was written against.

---

## 1. The container rule

`docs/design/admin-container-rule.md` (decided 2026-08-13, owner-approved).

> **One `<Modal>` primitive. Everything routes through it. Variants are props, not new
> shells.**

| Situation | Container |
|---|---|
| Make or edit one thing (new set, new question, edit question) | **Modal** |
| Confirm or destroy | **Modal**, small variant |
| Long multi-step work (AI generation, CSV import) | **Modal**, full-height variant |
| Change something you need to watch while changing it (category toggles, live game controls) | **Stay inline** |

The last row is the only exception and it is real: a modal that covers the thing you are
judging is worse than no modal.

**The problem it fixes runs in both directions.** A grep for `modal` in `.jsx` class names
returns roughly ten distinct shells — `modal-content`, `ai-modal`, `ai-assistant-modal`,
`ai-prompt-editor-modal`, `ai-scenario-builder-modal`, `poll-ai-builder-modal`,
`reports-modal`, `confirmation-modal`, `quickstart-modal`, `save-report-modal`,
`help-system-modal`, `issue-form-modal` — plus four `*Dialog.jsx` components that each
re-implement backdrop, escape, focus and scroll locking their own way. Meanwhile the two
flows people use most (add a question, create a question set) used **no container at all**:
they appended a form below the list you were reading.

**Explicitly rejected:**

- *Appending a form below the list and scrolling to it.* It loses the list, scroll
  restoration is unreliable, and on a forty-question set the form lands off-screen.
  "Move focus down to the edit" is the same idea, rejected for the same reason.
- *A side drawer for edit-in-a-list.*

### Never open a modal from inside a modal

`admin-container-rule.md:68-69`. That is why `CategoryPicker` creates a category by turning
its own row into a text input rather than opening a second dialog. If a step inside a
dialog needs its own surface, inline it.

### But a list and its detail are two PLACES, not two sections

RATIONALE §2, and it is the decision the whole admin redesign follows from:

> Press Edit on row 34 of 41 and `editMode` flips, the page scroll-jumps down to a form
> rendered *after* the list, and that form is flashed `#fff3cd` yellow with a `#ffc107`
> border by direct DOM mutation for three seconds (`AdminPage.jsx:183-194`) — a
> light-theme colour on a dark palette, and the only cue anywhere as to which of
> forty-one rows is open.

A place gets the whole work area, its own title, and a breadcrumb back to its parent.

**Reconciling the two:** a detail with several panels and its own tables is a *place* in
the console (RATIONALE §10 rejects a modal for the set editor: "four panels, a version
table and a questions table do not fit a modal, and a modal cannot be linked to or
reloaded into") and a *modal* only where there is no console to be a place in — which is
how the same `QuestionSetEditor` is a full work area at `AdminPage.jsx:975` and a
`.qsets-editor-frame` modal on the host's shelf.

---

## 2. Every dialog needs an X **and** a bottom exit

Commit `4fd425d6`, from the owner: *"there is no way to back out of 'edit question set'
for the host (no x in upper right, or cancel bottom - add both. that should be pretty
standard across our UX."*

The stranding surface, precisely: four panels inside a scrim that is
`closeOnBackdrop={false}` with `max-height: 86vh; overflow: auto`. The only exit was the
Cancel at the foot of the **first** panel. Scroll to the Questions panel — the entire
reason a host opens the editor — with an edit in hand: the Details Cancel has scrolled out
of frame, the backdrop is inert by design, Escape declines because
`closeOnEscape={() => !editorDirty}` and the copy is dirty, and on a tablet there is no
Escape key at all. **Nothing on screen leads out.**

The rules that came out of it:

1. **Both controls route through ONE `requestClose()`** which confirms when the working
   copy is dirty and otherwise closes. A Cancel that silently discarded a half-finished
   edit would have been worse than no Cancel.
2. **Every exit is gated on the handler being supplied.** A dead X is the control people
   reach for first, so it must not be the one that does nothing.
3. **A deliberately dead control is allowed, but it must be a decision with a stated
   reason.** The delete dialog's X is dead *while a delete is in flight*, because a live
   one would unmount the only surface that can report the outcome.
4. **A confirmation guarding a working copy is itself a dialog** and goes through `Modal`,
   where DOM containment makes Escape mean "go back and keep them" rather than falling
   through to the close it is guarding.

---

## 3. Escape is gated on unsaved work, never simply disabled

`closeOnEscape={() => !dirty}` and `closeOnBackdrop={false}` protect a draft. They do not
substitute for a visible exit — see rule 2. The gate is evaluated **at keypress time**
(`Modal.jsx:135-138` reads `latest.current`), so the listener never closes over a stale
`busy` flag and never re-subscribes.

---

## 4. Contrast is measured, and composited up the ancestor chain

AA is **4.5:1** for normal text. Two failure modes the naive check misses:

**Reading only the element's own background is how dark-on-dark passes an audit.** A
tinted panel's own background is a transparent `rgba`, so the check must walk **up** from
the text node compositing every alpha layer it passes. That is what `bgOf()` does
(lifted verbatim from `docs/design/admin-redesign/audit.html` into every `*Palette` test).

**A tint is invisible in a token table.** `#EF8C86` measured on `--bg` says nothing about
`#EF8C86` on `--bg` + `rgba(229,100,94,.09)` + a `--surface` panel. Assert the real stack.

**No black-lift model on a laptop.** The host spec designs against a projector raising the
effective background toward `#2A3550`, costing ~1.6× of every ratio. The admin console is
one person at 24in; every ratio there is measured against the real token.

**The finding this rule exists for:** `--danger #E5645E` is 4.38:1 on `--surface` and
3.56:1 on `--surface-2` — under AA. `--danger-text` and `--danger-deep` exist because of
it, and `questionSetsPalette.test.js:231-238` asserts `color: var(--danger)` appears
nowhere.

---

## 5. Truncation, and the `text-overflow` trap

**A truncating element must be a single text node with `min-width: 0`.** `text-overflow`
on a flex container with span children is **inert** — the name "truncates" by being
silently cut instead. Host spec §5.1, admin audit A2. Shipped examples:
`AdminShell.css:229-238` (`.adm-name`), `:357-373` (`.adm-work-head h1`),
`QuestionSetsPanel.css:267-285` (`.qsets-nm` / `.qsets-sub`).

**A reduction with no recovery is a deletion** (host §7.10). Put the full string on
`title=` so the clip is a reduction. `AdminShell.jsx:186` does exactly this.

---

## 6. Overflow that cannot be reached

Three shipped incidents, one shape: *a container that reads as scrollable and is not.*

| incident | fix | pinned by |
|---|---|---|
| A dialog taller than the viewport on an iPad, centred by `align-items: center` with no `overflow` on the scrim and no `max-height` on the card — overflowing top **and** bottom at once, footer unreachable, no Escape key on a tablet | scrim: `align-items: flex-start` + `overflow-y: auto` + `padding`; card: `margin: auto` so it still centres while it fits, `max-height` in `dvh` before `vh` | `__tests__/modalReachability.test.js` |
| The setup panel's Switch-game button "did not work" — the body was `flex: 1; overflow-y: auto` with no `min-height`, and a flex item's default `min-height: auto` resolves to content height, so the overflow never existed for `overflow-y` to act on | `min-height: 0` on the body, `flex: none` on header and tabs | same file |
| Edit / Rename clipped on their **left** edge — `.qsets-tbl td` is `overflow: hidden` and the action group was `justify-content: flex-end`, so once the buttons exceeded the cell the group overflowed toward the **start**, where a hidden overflow is unreachable by any scroll, drag or resize | `margin-left: auto` on the first child (right-aligns while it fits, collapses to zero when it does not) plus `flex-wrap` | `__tests__/rowActionsReachable.test.js` |

`align-items: center` on a scrolling scrim is the single most-repeated bug in this repo —
it has recurred **four** times. `dvh` before `vh` for iOS: `vh` there is the *large*
viewport, measured as if the toolbars were hidden.

**`table-layout: fixed` on every table.** Under auto layout the declared widths are hints,
and one `white-space: nowrap` chip sets a min-content width that grows the whole table —
audit A1 found four tables forcing horizontal scroll this way.

---

## 7. Honesty rules

- **Never show an empty state that lies** (host §7.9). Three of the shipped console's
  empty states did: an archive outage rendered as "No archive items found"; the prompt
  list printed one sentence for "none exist" and "none match your filters"; the set list
  told you to upload a set "above" when the form was below it and collapsed.
- **Never state a fact about ONE OBJECT twice in a viewport** (host §7.4, re-scoped by
  RATIONALE §4). A dimension appearing as both a control and a value is a filter showing
  its state, not redundancy. The rule was applied to this design's own chrome: the
  breadcrumb no longer repeats the `<h1>`.
- **Destructive dialogs state the consequence, not the severity** (RATIONALE §8).
  "This action cannot be undone!" is not information — the person already knows delete is
  delete. Name what breaks: which sessions used the set, and per session what this delete
  decides.
- **Offer the reversible neighbour.** Nine times in ten "delete this set" means "stop
  offering it to hosts", which the Active toggle already does. Naming the non-destructive
  alternative inside the destructive dialog prevents more damage than any amount of red.
- **Count before you ask.** The number that matters — 1 live session with 38 players, 6
  saved reports, ~2,400 answers — is the one you see *before* you press it, not the
  `itemsDeleted` you get after.
- **Type-to-confirm exactly twice in the whole console** (delete-all-sessions,
  delete-a-set-with-history). Anywhere else it is friction theatre, and friction theatre
  trains people to type without reading.
- **The screen names the product's own bugs.** A design that hides a known defect behind a
  green tick is worse than no design.

---

## 8. Namespacing

Every selector in a component stylesheet is rooted at one scope class that no other
stylesheet uses. Both halves are required:

1. **Every selector here starts with the scope class**, so nothing leaks out.
2. **`styles.css` declares nothing in that scope**, so nothing leaks in.

The incident: the first cut of the question-sets screen was scoped `.qs`, and `styles.css`
already owned `.qs-editor`, `.qs-panel`, `.qs-empty` and sixteen more for the (still
paper-theme) set editor. `.qs-empty { color: #5E6167; font-style: italic }` repainted the
new dark empty state grey and italic; `.qs-panel` gave the creation panel a paper
background. **No component test can catch this** — jest maps CSS to `identity-obj-proxy`
and loads no stylesheet, so the collision exists only in the bundle. The two assertions at
`questionSetsPalette.test.js:284-300` are the substitute, and the second one re-asserts
the premise (`.qs-empty` IS taken) so it cannot quietly become vacuous.

Taken prefixes: `qsets`, `adm`, `sp`, `um`, `wel`, `entry`, `au`, `hr`, `hrc`, `hrq`,
`git`, `gjp`, `plib`, `pvi`, `ppf`, `pap`, `pc`, `round`, `issue`, `help`, `report`,
`join`, `qs` (legacy, `styles.css`), plus everything in `styles.css` and `stage.css`.

---

## 9. Theme and markup convert in the SAME change

The rule stated in both directions:

- Dusk markup on a paper field → `#F4EDE4` body copy on white, **1.2:1**.
- Paper markup on a dusk field → `#333` on `#0F1A2E`, **1.4:1**.

The Question sets tab shipped as the second one. `AdminPage.jsx` passing
`contentTheme: 'dark'` and `QuestionSetsPanel.css` existing happened in **one** commit,
and `questionSetsPalette.test.js:197-204` pins the pairing. `promptEditorPalette.test.js:150-161`
pins the *opposite* for Prompts: that section must have **no** `contentTheme` for as long
as its markup is paper.

---

## 10. Tests: no geometric assertions

**jsdom has no layout engine.** It computes no heights, does no overflow, scrolls nothing,
and `getBoundingClientRect()` returns zeroes for every element on the page. A test that
renders a dialog and asserts the footer is visible passes just as happily against the
broken stylesheet — which is exactly how 1,859 passing tests sat on top of the iPad
overflow bug.

So: assert **relationships jsdom does model** (`compareDocumentPosition` for "after the
last panel", presence, roles, accessible names, handler wiring) and assert **CSS as text**
for anything visual. Say the limit out loud in the file header: green means "the fix has
not been reverted", not "this works on an iPad".

Also: jsdom does not resolve `var(--text)` across a stylesheet it never loaded, so build
the paint stack yourself from values read out of the CSS.
