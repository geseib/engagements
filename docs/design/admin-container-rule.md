# The container rule for admin

*Decided 2026-08-13. Owner-approved.*

## The problem this fixes

Admin grew a modal per screen instead of a modal per kind of task. A grep for
`modal` in `.jsx` class names returns roughly ten distinct shells —
`modal-content`, `ai-modal`, `ai-assistant-modal`, `ai-prompt-editor-modal`,
`ai-scenario-builder-modal`, `poll-ai-builder-modal`, `reports-modal`,
`confirmation-modal`, `quickstart-modal`, `save-report-modal`,
`help-system-modal`, `issue-form-modal` — plus four `*Dialog.jsx` components
that each re-implement backdrop, escape, focus and scroll locking their own way.

Meanwhile the two flows people use most — add a question, create a question set
— use no container at all. They append a form below the list you were reading.

So the inconsistency runs in both directions: too many shells for the rare
things, none at all for the common ones.

## The rule

**One `<Modal>` primitive. Everything routes through it. Variants are props,
not new shells.**

| Situation | Container |
|---|---|
| Make or edit one thing (new set, new question, edit question) | **Modal** |
| Confirm or destroy | **Modal**, small variant |
| Long multi-step work (AI generation, CSV import) | **Modal**, full-height variant |
| Change something you need to watch while changing it (category toggles, live game controls) | **Stay inline** |

The last row is the only exception and it is a real one: a modal that covers the
thing you are judging is worse than no modal. Everything else is a modal.

### Two things we explicitly rejected

**Appending a form below the list, then scrolling to it.** This is the current
behaviour and it is the thing being removed. It loses the list, scroll
restoration is unreliable, and on a forty-question set the form lands off-screen.
"Move focus down to the edit" is the same idea and is rejected for the same
reason.

**A side drawer for edit-in-a-list.** A drawer's one advantage over a modal is
keeping list context visible. The sibling browser below gives us that context
*inside* the modal, which means the drawer buys nothing and costs a second
container to be consistent about. Modal only.

## The sibling browser

The add-question modal shows three to five existing questions from the chosen
category, headed *"Writing alongside these."*

This is not decoration. It is the AI prompt made visible. Question generation
needs the set's voice, and today the model is conditioned on set context the
author cannot see. Showing the siblings makes one list serve two purposes: the
human's "what am I matching?" and an honest statement of what the model is
writing against. If the two ever disagree, that is a bug we want visible.

## Categories

A type-to-filter combobox, not a `<select>`. Sets run five to twenty categories;
a plain select is a scroll.

- **Show counts** — `Strategy · 12`, `Culture · 3`. This is the at-a-glance view
  of the whole category set, and it surfaces a lopsided set without a separate
  screen.
- **`+ New category` pinned at the bottom, created inline** — the row becomes a
  text input in place. Never open a second modal from inside a modal.
- **Hard cap at 24, enforced in the UI with an explanation.**

### Why 24 and not "no limit"

Categories are packed into three eight-bit host masks (`HostMask1-8`,
`HostMask9-16`, `HostMask17-24`). A category at index 25 or beyond never reaches
the mask, which means **a host can never toggle it** — the questions in it are
unreachable in a live session.

The authoritative writer is
`lambda-functions/websocket/schema-compliant-manager.js:211` (`bitPosition <= 24`,
with no `else` branch) and `:322` (`categoryIndex < 24` for the counts arrays).
`lambda-functions/admin/update-game-categories.js` contains the same cap at
`:30`, but treat it as semi-dead: no frontend code calls its route, and it
matches categories by `SK`-derived id (`c001`) against human names, so its
`findIndex` never hits. An earlier draft of this document cited it as the
enforcement point; the live path is `schema-compliant-manager.js`.

Today nothing refuses the 25th category. It is accepted, stored, and silently
inert. A `+ New category` button that lets someone build an unusable category is
worse than no button, so the cap is enforced at the point of creation with the
reason stated, not silently swallowed.

### The larger hazard behind the cap: silent reindexing

The cap is the visible half of a sharper problem. **Category identity is
positional, and the position is derived from first appearance in the CSV.**

`upload-questions.js:442,558,727-733` re-derives the category list from scratch
on every save, in the order categories first appear while parsing rows top to
bottom, assigning `c001…cNNN`. Every consumer then treats that array index as the
bit position — `schema-compliant-manager.js:176`, `config/setupPanel.js:57`,
`toggle-category.js:91`, `GameHostPage.jsx:4762`, which sends the position over
the wire as `categoryId`.

There is no per-question write. Every add is a full-set CSV replace. So:

- Adding a question whose category is new, **anywhere but at the end of the row
  list**, shifts every category that first appears later by one position. The bit
  that meant "Strategy" now means "Culture".
- At 24 categories, an insertion early in the file pushes whichever category
  lands at index 24 out of maskable range entirely — permanently untoggleable.
- The existing ↑/↓ row-reorder buttons (`QuestionsPanel.jsx:702-719`) can cause
  the same reindexing today, with no new feature involved.

Live games are protected: both `update-game-categories.js:98-103` and
`get-categories.js:26` resolve through the game's pinned `QuestionSetVersion`.
New games started on the new version get the new indexing.

**Consequences for the design.** A new category must be appended so that its
first appearance falls after every existing category's, which keeps existing
positions stable. And the combobox's counts must be derived from the **working
copy** (`rows`) — not `set.categoryCount`, a stale integer from the last save
(`QuestionSetEditor.jsx:303,539`), and not `GET /question-sets/{setId}/categories`,
which serves the persisted version and which the admin editor deliberately does
not call (`QuestionSetEditor.jsx:530-535`). A combobox reading "Strategy · 12"
while the unsaved working copy holds 14 would be a new lie in a panel whose whole
design is about telling the truth about unsaved state.
