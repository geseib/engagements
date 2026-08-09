# Admin console redesign — rationale

**Date:** 2026-08-09 · **Branch:** `dev` · **Status:** proposed
**Inventory:** [INVENTORY.md](INVENTORY.md) — written first, and the thing this is a response to.
**Mockups:** [index.html](index.html) — 22 states.
**Verification:** [audit.html](audit.html) — 6 assertions × 22 mockups × 2 viewports.
**Open forks:** [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

---

## 1. Scope, honestly

The brief asked for the six tabs plus nine named states, and invited me to cut scope rather
than sketch. I did not cut the count — 22 mockups exist — but I did cut *depth*, deliberately
and unevenly, and it is worth saying where.

**Designed properly** (the surfaces where a design decision changes an outcome): the question
set list and detail, CSV import, the generation job in all three of its states, the approval
queue, the two destructive confirmations, and sessions.

**Designed at a lower fidelity, on purpose**: prompts and archive. Both are drawn as one
coherent screen each, and both are blocked behind a product decision I cannot make from the
code. The prompt library has three UIs over one record type, an editor that creates duplicates
instead of updating, and no versioning in the editor despite versioning existing in the
lambda. The archive is an unauthenticated public service shared by all three environments
whose CSV format structurally cannot round-trip a set. Drawing a beautiful prompt editor on top
of a save path that duplicates records would be decoration. Both are in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) as questions, not as designs.

**Not designed**: the `/builder` route. It is 391 lines, it opens in a second tab, and it does
not know which set you were looking at. Folding it into this console is a real piece of work
and it would have been a thirteenth thing sketched instead of a twelfth thing finished.

---

## 2. The central problem, and the one decision that follows from it

The host screen's problem was that a scrolling document was being used as a display. The admin
console's is the mirror image, and it is worth naming as precisely:

> **The list and the thing it lists occupy the same scroll.**

Press Edit on row 34 of 41 and `editMode` flips, the page scroll-jumps down to a form rendered
*after* the list, and that form is flashed `#fff3cd` yellow with a `#ffc107` border by direct
DOM mutation for three seconds (`AdminPage.jsx:183–194`) — a light-theme colour on a dark
palette, and the only cue anywhere as to which of forty-one rows is open. When the flash
expires, nothing on screen identifies the set except the text inside the fields.

Everything else follows: the row grew five paragraphs because there was no detail view to put
them in; the upload form became an accordion because the page was already too long; the tab bar
scrolls away because it sits on top of a document.

**The decision: a list and its detail are two places, not two sections.** Opening a set replaces
the work area, gets its own breadcrumb, and has a pinned save bar that names the dirty fields.
No scroll-jump, no flash, no ambiguity about what you are editing.

The second-order consequence is the shell. Two axes now exist — *which kind of object* and
*which object* — and a horizontal tab strip already owns the top edge. Moving the sections into
a left nav frees the entire top edge for "where am I inside this object", which is where the
breadcrumb, the title and the primary action belong. It also gives the pending-user count a
permanent home, which matters more than it sounds (§7).

---

## 3. Type, derived rather than inherited

The brief was explicit: do not import the stage's ladders or its angular floors. It is right,
and the reason is worth stating rather than asserting, because the *method* transfers even
though every number changes.

The host spec's floor is angular: roughly **8.3 arcminutes of cap height**, chosen as a
legibility floor and then projected into pixels through a viewing distance and a pixel density.
20px is what that angle becomes at 25 feet on a ~20 ppi projected image. It is not a property
of type.

So I re-derived the same way for this surface.

**The geometry.** A laptop panel at roughly **120 CSS pixels per inch** (a 13.6″ MacBook Air is
2560×1664 physical at 2× scaling, so ~112 CSS ppi; a 1440p 27″ desktop panel is ~109; a 1080p
15.6″ laptop is ~141 — 120 is the middle of the range people actually use), read at about
**24 inches**. Cap height is ~0.72 of the em.

```
angle(px) = atan( (px / 120) × 0.72 / 24 )
          = px × 0.72 / 120 / 24  radians
          = px × 0.859 arcminutes
```

**One CSS pixel of type ≈ 0.86 arcminutes of cap height at this surface's geometry.** That
constant is the whole derivation; everything else is arithmetic.

| tier | px | arcmin | job |
|---|---|---|---|
| floor | **12** | 10.3 | counts, timestamps, chip text. Glanced, never read in runs. |
| label | **13** | 11.2 | field labels, column heads, secondary row text |
| **body** | **15** | 12.9 | rows, values, prose, and every input |
| heading | **19** | 16.3 | panel headings |
| title | **24** | 20.6 | screen title |
| numeral | **30** | 25.8 | the one display number a panel is allowed |

**Sanity check.** 16px web body text at 24 inches is 13.7 arcminutes; macOS system UI at 13px
is 11.2. A derivation for this surface that landed at 40px would mean the derivation was wrong,
not that the whole industry is. Landing at 15px next to a 16px convention is the check passing.

### 3.1 Where I disagree with the brief's framing

The brief said the host spec "exempts operator text at 13–20px" and implied I should stay in
that band. **My floor is 12px, which is below it, and I think that is correct.**

The host spec's own Table profile sets a 16px floor and justifies it by computing that 16px on
a ~120 ppi panel **at three feet** subtends 9.0 arcminutes — more than the 8.3 the 20px Room
floor buys at 25 feet. Fine. But the Table profile is a *stage* profile: §4.4 describes it as a
laptop being read by three to five people around a table, which is why 3 ft is the right
distance for it.

The admin console has exactly one reader, at 24 inches, and nobody else ever sees it. At that
distance:

```
12px at 24in  = 10.3 arcminutes
16px at 36in  =  9.2 arcminutes   ← the host spec's own Table floor
```

**My 12px floor is angularly larger than the host spec's 16px floor.** It is not a relaxation
of that rule; it is the same rule, re-derived for a reader who is two-thirds the distance away.
Holding 16px here would spend space over-serving an eye that is already closer than the number
was computed for — which is precisely the argument §4.2 makes for *lowering* Room's 20px to
Table's 16px. I am applying their reasoning one step further along the same axis.

The audit asserts the 12px floor on every text node in all 22 mockups.

### 3.2 One rule I took wholesale

Inputs render at the **body** tier, 15px, never at the label tier. A 13px input producing 15px
table text is the commonest way a dense console ends up illegible exactly where a mistake is
most expensive.

---

## 4. Density, and where I disagree with the host precedent

The brief says this surface is dense on purpose. It is, and I want to be specific about *which*
of the host spec's rules survive the move and which do not, because "restraint is good" is the
kind of principle that quietly gets applied where it does harm.

**Does not survive.**

- **"Never state the same fact twice in one viewport" (host §7.4) — kept, but re-scoped.** On a
  stage, the second instance is noise for thirty people. Here, one person is *comparing*: a
  table where the type appears in a chip and again in the filter select is not redundancy, it
  is a filter showing its state. I applied the rule to *facts about one object stated twice*
  (the set row printing five settings that the editor prints again) and not to *the same
  dimension appearing as both a control and a value*.
  I did apply it to my own chrome: the first cut of this design had a breadcrumb reading
  "Question sets" directly above an `<h1>` reading "Question sets". The breadcrumb now shows
  nothing on a root list, and on a detail screen it is a back link to the parent and never the
  object's own name.
- **The whole reduction/`fit()` machinery (host §4.2b).** It exists so a projected state fits
  one screen without scrolling. This surface scrolls, in one region, on purpose. There is
  nothing to fit.
- **"Never name a person" (host §7.15).** The opposite is required here: the whole job of the
  users screen is naming people.
- **Cards.** A card is a good container for one object read at a glance across a room. Forty-one
  of them is a wall. Every list here is a table with a 36px row.

**Survives, unchanged.**

- **The colour tokens** (§5), so the two surfaces stay one system.
- **"Never show an empty state that lies" (host §7.9).** Three of the current console's empty
  states lie: an archive outage renders as "No archive items found"; the prompt list prints the
  same sentence for "none exist" and "none match your filters"; the set list tells you to
  upload a set "above" when the upload form is below it and collapsed.
- **"A reduction with no recovery is a deletion" (host §7.10).** Everything I cut from the set
  list row is in the set detail, one click away, and the rationale says so.
- **"Never gate a surface behind a keystroke alone" (host §7.12).**
- **The `text-overflow` trap (host §5.1).** Every truncating element here is a single text node
  with `min-width:0`, never a flex container with span children, where `text-overflow` is
  inert. Audit A2 enforces it.

**One place I think the host spec is wrong, and it cost me nothing to fix here.** §7.4 forbids
stating a fact twice *in one viewport* but the spec's own §5.3 correctly carves out an exception:
the meter owns the number and the dock owns the judgement, "because they answer different
questions". That exception is the actual rule, and the blanket statement is a simplification of
it. I have used the real rule throughout: the sets list shows a count *and* a filter state; the
job screen shows "34 / 100" *and* "pass 3 of 6", because one is progress and the other is shape.

---

## 5. Colour

Warm Summit tokens, unchanged: `--bg #0F1A2E`, `--surface #1B2942`, `--surface-2 #25375A`,
`--text #F4EDE4`, `--primary #F6A94C`, `--success #4FB286`, `--danger #E5645E`.

**No black-lift model.** The host spec designs against a projector raising the effective
background toward `#2A3550`, costing ~1.6× of every ratio. There is no projector here, so every
ratio is measured against the real token. Measured, unlifted:

| pair | on `--bg` | on `--surface` | on `--surface-2` |
|---|---|---|---|
| `--text` | 14.97 | 12.53 | 10.20 |
| `--muted #B6C2D4` | 9.65 | 8.08 | 6.58 |
| `--success-text #6FD0A4` | 9.30 | 7.79 | 6.34 |
| `--primary` | 8.86 | 7.42 | 6.03 |
| `--secondary` | 7.06 | 5.91 | 4.81 |
| `--success #4FB286` | 6.66 | 5.58 | 4.54 |
| **`--danger #E5645E`** | 5.23 | **4.38** | **3.56** |

The host spec's two text tints (`--muted` lightened to `#B6C2D4`, `--success-text #6FD0A4`)
are carried over unchanged even though the unlifted background would let the originals pass.
Two surfaces sharing a palette that diverges by one hex value each is worse than either
alternative.

**One new token, by the same argument the host spec used for `--success-text`.**
`--danger #E5645E` measures **4.38:1 on `--surface`** and **3.56:1 on `--surface-2`** — under
the 4.5:1 AA bar for normal text. Destructive copy is precisely the text a person must read
carefully, and it lives in modals, which sit on `--surface`. So:

```css
--danger-text: #EF8C86;   /* 7.26 / 6.08 / 4.94 on bg / surface / surface-2 */
--danger-deep: #B03A34;   /* filled destructive button; --text on it is 5.16:1 */
--danger:      #E5645E;   /* unchanged: borders, rules, bar fills */
```

`--danger-deep` exists because a filled `#E5645E` button carries white at only **3.32:1**.
This should be folded back into `warm-summit-design-spec.md`.

**Red means destructive, only.** Kept. It is used for: the delete controls, the delete
confirmations, the three list rows carrying a data defect, and the CSV validation failures.
Nothing else.

WCAG 2.1 AA is asserted by audit A4 on every text node, compositing alpha up the ancestor chain
rather than reading the element's own background — reading only the element's own background is
how dark-on-dark passes an audit.

---

## 6. The generation job — the state nobody had drawn

This is the largest new piece of design and the one I would ship first.

**The facts.** Generation is a server-side worker with a 15-minute ceiling. `POST` returns
`202 {jobId, status:'queued'}` and self-invokes. `GET …/{jobId}` returns
`{status, phase, requested, completed, items[], warnings[], meta, error}`. The job row lives in
DynamoDB for **three days**. The client polls every 2s and gives up at 10 minutes.

**What the UI does with all that:** a CSS spinner and one line of text. That is the entire
in-progress state.

Four design decisions, each of which costs no backend work:

**6.1 The job outlives the modal that started it.** "Close — this keeps running" is the
*primary* action on the running screen, not an escape hatch. The `jobId` goes to
`localStorage`, so a reload or a closed tab resumes; a chip in the top bar shows running jobs
and opens a tray. Today the id lives in a local `const` inside `handleConfigSubmit`, and the
timeout message advises you to "reopen the builder to check", which is impossible.

**6.2 Show the numbers that are already on the wire.** `completed`/`requested` becomes "34 of
100". `items[]` — which *already reaches component state during polling* and is then hidden
behind the `isGenerating ?` branch — becomes the list of questions landing.
`warnings[]` gets displayed, for the first time.

**6.3 The progress bar is indeterminate, and that is the honest choice.** `updateJobProgress`
fires once per completed model call, and one call fits 17–67 items depending on type. For any
request at or below that (the common case) there is **exactly one update**, at the end. A
smoothly filling bar would be inventing motion that does not exist. So: a real fraction that
jumps, an indeterminate sweep for liveness, and a sentence saying why it jumps. This is the same
argument the host spec makes against its timer ring — the objection there was never to clocks,
it was to *a fraction drawn as a duration*. A determinate bar over per-pass progress is the same
lie in the other direction.

**6.4 There is no Cancel button, and the screen says why.** No cancel endpoint exists. The
`isCancelled` hook in `pollGenerationJob` is client-side only and no caller passes it; even
wired, the worker would keep burning tokens. Drawing a Cancel button that stops you watching
while the cost continues is worse than not drawing one. The screen states this in one line
under "If you leave".

**6.5 Partial failure is named as partial failure.** This is the defect the failed-job screen
exists for. Today, a job that dies *with* items already written sets those items and renders
the review UI; `Generation failed: …` is shown nowhere. **Failure looks exactly like success.**
The screen now says "stopped at 41 of 100", shows which pass failed, shows the warnings, shows
that sixteen more were dropped server-side as near-duplicates, and offers three real outcomes —
keep the 41, ask for the remaining 59, discard — where today the only control in any failure
branch is "← Back to Configuration".

It does *not* offer "resume". The job row is terminal; a resume would have to start a fresh job
that does not know what the first one wrote, and would produce duplicates.

**6.6 Review is a table with per-item reject.** Today it is a one-item-at-a-time carousel with
Previous/Next, and there is no way to drop a single generated item — you accept all of them or
none. One bad question therefore means importing it and fixing it later, or discarding
eighty-three good ones.

---

## 7. The approval queue

Registration lands people in `pending`. An admin moves them to `hosts` or `admins`. That is the
moment a new host is either welcomed or forgotten, and it is currently the **second of four
filter tabs**, labelled `Pending (3)`, on a screen nothing else links to.

Three changes:

- **It is a queue, at the top of the screen, with its own frame** — and the frame stays when the
  queue is empty. A section that disappears when it has nothing in it is a section you stop
  looking for, which is the one property an approval queue must not have.
- **The verb is named.** Today a pending person shows the same four buttons as everyone else —
  Pending / Host / Admin / Disabled — with the one they are already in disabled. Nothing
  indicates which is the approval. `Approve as host` is now the primary; `Admin` and `Reject`
  are secondary; the four-way move stays on member rows where it belongs.
- **The wait is visible**, in the queue header and as a count in the left nav that is on screen
  from every other page in the console. "Oldest has waited 21 days" is the number that makes
  someone act.

**The Joined column shows "—" for every user, and I drew it that way.** The lambda returns
`created`; the table reads `createdAt`. Drawing plausible dates would have hidden a one-word
bug; dropping the column would have hidden it differently. The mockup carries the defect and
names it in the note under the table. The "21 days" figure is derivable the moment that field
is read correctly.

---

## 8. Destructive actions

**Consequence, not danger.** The current dialogs state severity ("This action cannot be
undone!") and no consequence. Severity is not information; the person already knows delete is
delete.

The pattern the product should adopt already exists in it.
`DELETE /admin/question-sets/{setId}/versions/{n}` answers **200 with `pinnedByGames` instead of
deleting**, and `QuestionSetEditor` names those games and asks again. That is exactly right.

`DELETE /admin/question-sets/{setId}` — which removes every version, every question and every
category — performs no such check. And the consequence is worse than for a version, because
`create-report.js` reads the **live** set when a report is first requested: deleting a set
decides, permanently, which past sessions can still produce a report and which cannot.

So the delete-set confirmation names each session that used the set and says, per session, what
this delete decides: report already saved (unaffected), live right now (breaks mid-round), no
report saved (can never be built). **This needs one backend change**, stated on the screen and
in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) — give set-delete the contract version-delete already
has.

Two more rules:

- **Offer the reversible neighbour.** Nine times in ten "delete this set" means "stop offering
  it to hosts", which is what the Active toggle already does. Naming the non-destructive
  alternative inside the destructive dialog prevents more damage than any amount of red.
- **Type-to-confirm, twice in the whole console.** Delete-all-sessions and delete-a-set-with-
  history. Anywhere else it is friction theatre, and friction theatre trains people to type
  without reading.

And: **count before you ask.** The current delete-all reports `itemsDeleted` *after* the fact.
The number that matters — 1 live session with 38 players, 6 saved reports, ~2,400 answers — is
the one you see before you press it.

---

## 9. Smaller decisions, with their reasons

**Landing tab.** Question sets, not AI Prompts. Every other screen in the console is downstream
of a question set.

**"Game Management" → "Sessions", with a list.** `GET /games` is deployed and returns everything
a list needs. A tab that can only delete, and only by an id it does not show you, is not
management.

**Five creation paths, ranked, in one chooser.** This kills the duplicated engagement-type
select (INVENTORY §3.5) by asking for the type *inside* the path that needs it. Each path states
what it is best for and what it costs — importing from archive is marked as lossy because it is,
and marking it is the difference between a choice and a trap.

**CSV validation happens before the round trip.** `summarizeCsv()` already parses the file in
the browser, quote-aware. Everything on the validation screen comes from that parse plus the
importer's own published rules. Three tiers: stops the import, would be skipped silently, known
importer gaps. The server already returns `skippedRowCount` and the first fifty `skippedRows`
with reasons — and the only place that surfaces is one clause appended to a success message
*after* the write.

**The screen names the product's own bugs.** The poll `Option1..5` vs `Options` mismatch, the
survey path that can never be played, the image filenames with no files behind them. A design
that hides a known defect behind a green tick is worse than no design.

**One prompt library.** Generators and summaries are the same record with different shapes;
there are three UIs for them today with two incompatible status-badge schemes and two different
game-type lists, one of which omits Survey. The six records the API already flags as unusable or
malformed get the top of the page instead of a badge in a scrolling grid.

**Environment is stated everywhere.** A chip in the top bar of every screen, a read-only block
in Settings, and a repeat in the footer of the delete-all dialog. Three tiers exist, the archive
is shared across all of them, and until now no admin screen said which one was loaded.

**Settings are described by who sees the result.** Both debug toggles print AI prompt text onto
the **host's** screen, which may be a projector. That is a warning, not a feature description.

---

## 10. What I rejected

**A modal for the set editor.** Rejected: four panels, a version table and a questions table do
not fit a modal, and a modal cannot be linked to or reloaded into.

**Keeping the tab bar and just fixing each tab.** Rejected for the reason in §2: it leaves the
list and its detail on the same scroll, which is the actual cause. It also leaves the pending
count with nowhere to live.

**A determinate progress bar on the generation job.** Rejected in §6.3. Available, and a lie.

**A Cancel button on a running job.** Rejected in §6.4. It cannot do what it says.

**Masking the correct answers in the generated-question review table.** Considered — the host
spec makes exactly this argument for the question browser. Rejected here for the opposite
reason: this surface is genuinely private (one person, arm's length, and it is the *authoring*
context), so hiding the answers would remove the one thing you need in order to review them.
The host spec's rule — *anything whose value depends on the room not seeing it does not exist on
the stage* — is a rule about shared surfaces, and importing it here would be exactly the
mistake §4 warns about.

**Inline row editing in the set list.** Rejected: it would recreate the current problem in
miniature — the index carrying the whole book.

**A bulk-select column on the set list.** Rejected for now. The only bulk operation the backend
supports is archive export, which has its own screen. Adding checkboxes for an operation that
does not exist is inventing a feature in a mockup.

**Cards for the archive.** Rejected. 214 items.

**Designing the media panel.** It is a declared seam with a documented contract and an owner. I
drew what is true today (images arrive through the CSV's Image column, upload is not wired) and
left it.

---

## 11. Where else I disagree with the brief

**"Six tabs: games, questionsets, prompts, archive, users, settings."** The tab order in the
code is AI Prompts, Question Sets, Game Management, Archive, Users, Settings, and it opens on
AI Prompts. Both the order and the default are wrong for the same reason, and I changed both.

**"There is also a separate `/builder` route."** I did not design it (§1). I think folding it in
is right eventually, but it is its own piece of work and pretending otherwise would have
produced a sketch.

**"Deleting a question set that a past session used must not silently break that session's
report."** Correct, and stronger than stated: the report is built from the live set *on demand*,
so whether a past session can produce a report at all depends on whether anyone happened to ask
for one before the delete. The UI cannot fix that alone — it needs the endpoint to answer the
question. I have specified the change rather than drawn around it.

**On the host spec's precedent generally.** The thing worth copying from it is not its numbers —
almost none of them transfer — but its two working methods: derive the constraint rather than
assert it, and choose content that will expose the design rather than flatter it. Both are used
here. The numbers are all new.

---

## 12. Verification

[audit.html](audit.html) runs six assertions over 22 mockups at 1440×900 and 1280×800 — 264
assertions.

| | asserts | written because |
|---|---|---|
| **A1** | neither the document nor any scroll container inside it scrolls sideways | the first version only checked the document; a negative test showed it was unfalsifiable, because `.work-body` is `overflow:auto` and swallowed a 3000px child. Strengthened, it immediately failed **four tables** whose fixed column widths exceeded the container at both viewports. |
| **A2** | no element clips text without a truncation that can actually render | the host spec's §5.1 trap: `text-overflow` on a flex container is inert |
| **A3** | no text below the 12px floor derived in §3 | type creep |
| **A4** | WCAG 2.1 AA on every text node, against its composited background | `--danger` on `--surface` at 4.38:1, which is how §5 gained `--danger-text` |
| **A5** | every control ≥24px on its short edge, measuring the label where a checkbox has one | 22px variable chips and 13px bare checkboxes |
| **A6** | no inline SVG wider than 40px | a `.ico` with no width rule rendered at 300×150 in the jobs tray |

**Every check was demonstrated failing before it was trusted.** A negative test injects a known-
bad element per assertion into a loaded mockup and confirms it fires; that test is what revealed
A1 was inert, and A1 was rewritten because of it. A4, A5 and A6 each failed on real mockups
before they were fixed:

| defect found by the audit | fix |
|---|---|
| A4 — `.subnav` count text at **1.57:1** on `05-set-replace` | the subnav rules lived in the *set-detail page's* CSS block, so on the replace screen the buttons fell back to the UA's light `buttonface`. Shared component, moved to the shared stylesheet. |
| A5 — variable chips 22px; bare checkboxes 13–15px | chips to a 24px minimum; checkboxes wrapped in a `label.cbx` with negative-margin padding, giving a 26px target without moving the 16px box |
| A6 — jobs-tray glyph at 858×858 | `.ico` only ever got a size from `.btn .ico` and `.nav-item .ico`; an inline SVG anywhere else fell back to the default replaced-element size |
| A1 — four tables forcing horizontal scroll | `table-layout: fixed`. Under auto layout the declared widths are hints, and a nowrap chip sets a min-content width that grows the whole table. |

The checks are pure functions over a rendered document plus a viewport and know nothing about
how the page got there, so they port into component tests unchanged.
