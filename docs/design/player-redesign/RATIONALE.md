# The player's own device — design rationale

**Date:** 2026-08-09 · **Status:** proposed · **Branch:** `dev` (design only; nothing under `src/` is touched)
**Scope:** `src/src/PlayerPage.jsx`, the player block of `src/src/styles.css`. No backend change is
*required*; four are *recommended* and are named in §11.
**Inventory:** [`INVENTORY.md`](INVENTORY.md) — read it first. **Mockups:** [`index.html`](index.html), 23 states.
**Verification:** [`audit.html`](audit.html) + `audit.js` — 10 assertions × 23 mockups × 3 device
profiles = 690, all passing. One of them ([§10.1](#101-the-audit-changed-the-design-once)) changed the design.
**Open questions:** [`OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md).

---

## 1. The problem, stated precisely

The host screen's problem was crowding. The player's screen has the opposite problem, and it
needs naming just as exactly:

> **The player's screen was never designed. It was assembled from whatever the host screen had
> lying around, and then it stopped.**

The evidence is in the class names. Trivia options are `category-item` — the class from the
admin category picker. The waiting screen, the results heading and the score rows are the
host's components at phone size. The parallax hero is the host's parallax hero, three
cross-origin `.webp` files, rendered above the question on the slowest connection in the room.
And the ballot — the one screen that is genuinely, structurally different from anything the
host does — is the screen with two competing implementations and a placeholder reading
`Pick player...` on a ballot that has, by design, no players on it.

The consequences are in [`INVENTORY.md`](INVENTORY.md) §7. Four states in the state machine have
no design at all (ended, between rounds, offline, send-failed), two of the five game types have
no ASK design (poll, survey), and one very ordinary sequence — vote, then reload — renders a
**blank page**.

So this document is not a reduction, the way the host spec was. It is mostly addition, and the
discipline it needs is different: the host spec had to justify every deletion; this one has to
justify every *presence*. The rule it uses to do that is §2.

---

## 2. The central question: the stage and the phone

Nobody has confronted this and the brief is right that it is the whole design.

The host spec's entire argument is that the room should look **up**, together, at one shared
surface: type derived for 25 feet, one idea per screen, the roster demoted, the operator's
controls hidden behind a keystroke so the audience never sees them. That argument is sound. It
is also fragile, because there are forty competing screens in the room, each one 14 inches from
a face, each one brighter and closer and more personal than the projector — and the product
currently gives every one of them a permanent animated pulse and a floating action button.

### 2.1 What I rejected

**A. The phone as a second display.** Mirror the question, the progress, the tallies, the
leaderboard. *Rejected:* it makes the shared screen optional, and a session where everyone is
looking down is a session that did not need a room. It also duplicates the exact content the
host spec spent forty pages learning to show once.

**B. The phone as a pure input device — a numeric keypad and nothing else.** *Rejected:* it
fails the remote and hybrid participant, who has no stage; it fails the person who arrives at
round four; and it fails the ordinary case of looking down to type and losing the question.

**C. Let the player choose.** A density or "focus mode" toggle. *Rejected on the host spec's
own evidence:* `bigScreenMode` is a mode a host must notice, remember and re-apply under
pressure, and `useEffect(() => setBigScreenMode(false), [])` silently drops them out of it on
every reload. A mode is worse on the player's screen than on the host's, because there are
forty of them and no one to fix it.

### 2.2 The answer: three volumes, set by the state machine

Every state is exactly one of these, and the player never chooses:

| | **ACT** | **REST** | **WATCH** |
|---|---|---|---|
| When | ASK before submit; VOTE before submit; the join sequence | answered, voted, between rounds, lobby | RESULTS, session ended |
| Claim on attention | **The phone wins.** It is the only place the task can be done. | **The phone yields.** | **The stage wins.** |
| Dock | yes — one primary action | **none** | **none** |
| Amber | yes — the current task | none | at most one, on a personal number |
| Motion | none | none | none |
| Content | the question, the affordance, the instruction | a receipt, and how to get back in | *only* what is personal and therefore cannot be on the stage |

Two things make this more than a mood board.

**First, the absence of the dock is structural.** In REST and WATCH there is no `.dock`
element — not a disabled button, not a greyed bar. If there is nothing to do, there must be
nothing that looks pressable. Audit check **A9** fails any REST or WATCH screen that grows a
dock or an amber fill, which is the only reason the rule will survive contact with a future
feature request. It already caught one violation of my own ([§10.1](#101-the-audit-changed-the-design-once)).

**Second, the division of content is derived, not chosen.** The host spec §7.15 states that the
stage must **never name a person**. Take that seriously and it hands you the split:

> **Anything person-specific belongs on the phone. Anything room-wide belongs on the stage.
> Neither repeats the other.**

That single line resolves almost every question on RESULTS. The distribution of trivia answers,
the word cloud, the winning responses, the AI discussion prompts, the leaderboard: room-wide,
stage, and the phone does not show them. Which option *you* picked, what *your* response earned,
which of *your* words the room shared, where *you* stand: person-specific, phone, and the stage
cannot show them without breaking its own rule. Neither surface is a smaller copy of the other.
They are two halves of one screen that happens to be in two places.

It also kills the current results copy — *"Check the main screen for detailed results and AI
insights!"* — which reads as an apology for a missing feature. The replacement is not an
apology. It is a statement of where a thing lives, in every WATCH state, in the same position,
with the same up-arrow: **the look-up cue**.

### 2.3 The one time the phone interrupts

A phase change into ACT. That is the only moment the phone is allowed to pull a head down, and
it is legitimate, because the room's attention is *supposed* to move to the phones then — the
host has just asked everyone to answer.

The mechanism is deliberately weak: the phase strip changes colour and the dock appears with
its label. **No sound. No vibration.** Forty phones buzzing in unison is an attack on a room,
and the Vibration API is unavailable in iOS Safari anyway, so a design that leaned on it would
be unbuildable on the majority device. A player who is genuinely looking up will be told by the
host, out loud, which is what the host is for.

### 2.4 Volume, applied to the countdown

The host spec §5.1 reverses itself and adds an optional host-armed countdown, because three
evaluators asked for one. If a host arms it, the player's phone should show it — **but only in
ACT states, at `--L-meta`, in the bar**. A player looking down to type is the one person in the
room who cannot see the stage clock, and they are also the one person the clock is about. It
must never appear in REST or WATCH (there is nothing to hurry), it must never turn the screen
red, and it must never disable the submit at zero — for the same reason the host's version does
not advance the round: taking the action away at a fixed moment is worse than the silence it
solves.

---

## 3. Type: deriving the ladder rather than inheriting one

The brief is explicit that the stage's ladder and its angular floors must not be reused, and it
is right: they are the product of a 25-foot viewing distance and a ~20 ppi projected image, and
none of those numbers survive the trip to a phone. The *method* survives.

### 3.1 The method

Comfortable sustained reading of unfamiliar text wants a cap height subtending roughly **20–24
arcminutes**. Given a viewing distance *D* and a display density *ppi*:

```
cap height (in) = D × tan(θ)
font size (px)  = cap × ppi ÷ 0.72        (0.72 = cap-height ratio of the UI face)
```

A useful sanity check before trusting it: a 16px paragraph on an iPhone (≈142 CSS ppi) held at
14 inches has a cap height of `16 × 0.72 / 142 = 0.081 in`, subtending
`atan(0.081/14) = 19.9′`. Sixteen pixels on a phone is the bottom of the same comfort band the
host spec derived for a projector. The method transfers; only the numbers change.

### 3.2 The three contexts, and their densities

CSS pixels, not physical pixels — that is the unit the design controls.

| | Phone | Tablet | Laptop |
|---|---|---|---|
| Reference device | iPhone-class, 375 CSS px wide | iPad-class, @2x | 13″ notebook panel |
| CSS ppi | ~142 | ~132 | ~110 |
| Viewing distance | 14 in | 18 in | 24 in |

### 3.3 The ladders

The same five angular sizes at each distance. The pixel numbers differ; the *apparent* size does
not, which is the point.

| Rung | Angle | Phone | Tablet | Laptop |
|---|---|---|---|---|
| hero — one object owns the screen | 42′ | **34px** | 40px | 45px |
| primary — the question | 30′ | **24px** | 28px | 32px |
| secondary — answers, options, buttons | 24′ | **19px** | 22px | 26px |
| body — detail, instructions, inputs | 20′ | **16px** | 19px | 21px |
| meta — labels | 16′ | **13px** | 15px | 17px |

Declared as four literal ladders on `:root` at three breakpoints. **Never as a multiplier** —
the host spec's §4.2 records at length what happens when a custom property multiplies another
declared on the same element (it substitutes against that element's own value, silently, and
every profile renders identically). One literal ladder per breakpoint cannot fail that way.

They are written in `rem`, not `px`, so a reader who has raised their browser or OS text size
takes the whole ladder with them — WCAG 1.4.4. The px figures above are the values at a 16px
root, which is what the derivation produced.

### 3.4 The floor is not angular here, and that matters

On the projector, the floor is angular: the host spec derives 20px from 8.3′ at 25 feet. Run the
same calculation for a phone and you get `14 × tan(8.3′) × 142 / 0.72 = **6.7px**` — which is
nonsense as a design floor, and would be nonsense to adopt.

**The floor on a phone is not set by the eye.** It is set by three other things, and the largest
one wins:

1. **iOS zooms the page** when a focused `<input>` or `<textarea>` has a font-size under 16px.
   That is a hard product floor for anything typed into: below it, the layout jumps on focus and
   the player loses their place. All inputs are `--L-secondary` (19px) and never smaller.
2. **Glare, motion and one-handed grip.** A phone is read standing up, at the back of a room,
   sometimes with the screen at an angle. That is worth two or three arcminutes of margin over a
   desk-reading number.
3. **A label a designer will not shrink further.** 13px is the number below which the ladder
   stops being a ladder and starts being a way of hiding content.

So the floor is stated as a per-device pixel number — **13 / 15 / 17** — and audit check **A5**
enforces it per profile. This is a deliberate departure from the host spec's framing (its §4.2
restates the floor "in angular terms"), and it is a departure I would defend anywhere: an
angular floor is the right abstraction when the *reader's distance* is the binding constraint,
and it is the wrong one when the *platform* is.

### 3.5 Width is a proxy for distance, and it is a bad one

I should say this plainly rather than let a media query imply a certainty it does not have. The
breakpoints select a ladder by viewport width; the ladder is derived from viewing distance.
Those correlate, and they are not the same thing. An iPad held in bed is 14 inches away and gets
the 18-inch ladder. A laptop on a lectern is 36 inches away and gets the 24-inch one.

Three responses, in order of how much I like them:

- **Accept it.** The error is at most one rung, and one rung is 20% — noticeable, not harmful.
  This is what ships.
- **Let the reader fix it.** The `rem` ladder means the browser's own text-size control is a
  working distance adjustment, on every platform, with no UI of ours. This is why §3.3 is in
  `rem` and it is the real answer.
- **Ask.** Rejected outright. The host gets display profiles because there is one host and a
  Console to put them in. Offering forty participants a settings screen before they can answer a
  question is a worse product than getting the ladder slightly wrong.

---

## 4. Colour

Warm Summit tokens, unchanged: `--bg #0F1A2E`, `--text #F4EDE4`, `--primary #F6A94C`,
`--success #4FB286`. Text uses `--muted #B6C2D4` and `--success-text #6FD0A4`.

### 4.1 The black-lift model does not apply here, and I kept its consequences anyway

The host spec §4.3 designs against a *lifted* background — a projector in a lit room raises
`#0F1A2E` toward `#2A3550` and costs about 1.6× of every ratio — and it is that model, not the
tokens, that forced `--muted` from `#9BA8BE` to `#B6C2D4`.

A phone is a direct-view emissive panel. There is no lift. Measured against the real
background, at a normal indoor brightness:

| Pair | Ratio | Verdict |
|---|---|---|
| `--text` on `--bg` | **13.2:1** | anything |
| `--muted #B6C2D4` on `--bg` | **9.8:1** | anything |
| `--success-text #6FD0A4` on `--bg` | **9.2:1** | anything |
| `--primary #F6A94C` on `--bg` | **8.8:1** | anything |
| `--bg` on an amber button | **8.8:1** | the primary action |
| `--muted` on `--surface #182640` | **8.6:1** | anything |
| `--primary` on `--surface` | **7.7:1** | flags, the pressed rank |

The old `#9BA8BE` would also have passed here — 6.1:1 unlifted, comfortably over the 4.5:1 bar.
**I kept the new tints anyway.** Two surfaces of one product diverging on their body-text grey
is the kind of drift that is invisible for a year and then impossible to unpick, and the phone
gains nothing from the extra darkness. This is a case where consistency beats local
optimisation, and it is worth being explicit that it was a choice rather than an oversight.

Audit check **A6** measures every text-bearing element against its own resolved background —
walking ancestors, compositing alpha — at all three profiles. AA (4.5:1 normal, 3:1 large) is
the floor and nothing is close to it.

### 4.2 Red

Red means destructive, only. So:

- A **wrong trivia answer is not red.** It is `--muted`, plus the words "Your answer", against
  a correct row carrying a 2px `--success` rule *and* the word "Correct". The current code uses
  `--danger` and a 16px ✗ icon, which is both a semantic error and colour doing the work alone.
- A **form error is not red.** `02-join-code-bad` uses `--primary` amber, an icon, and a
  sentence that names both plausible causes of a four-digit typo. Amber for an error is unusual
  and I would defend it: the alternative is either breaking the token rule or inventing a sixth
  colour for the one screen a participant sees before they have any context.

### 4.3 One amber — amended

The host spec's rule is "one amber per view. Never two." I am breaking it, deliberately, and it
is worth arguing rather than quietly ignoring.

On a projector, two amber objects are two competing focal points for forty pairs of eyes that
cannot interact with either. On a phone, amber means one thing and one thing only:
**this is the task you are doing now.** A selected trivia option and the Submit button it just
enabled are not two ideas; they are one idea in two places, and separating them by colour would
make the causal link *less* legible, not more.

So the amended rule is **one amber idea per view**, and the corollaries are strict:

- REST and WATCH spend no amber at all (enforced: **A9**).
- Nothing decorative is ever amber.
- The `Show all` control on a long ballot response is *not* amber — it is muted and underlined.
  Expanding a response is not the task; ranking it is. That distinction is the whole test, and
  the first draft of `13-vote` failed it: three amber objects, one of which was a disclosure
  triangle.

---

## 5. Layout

### 5.1 The shell

Three regions, `flex-direction: column` on `body`, `overflow: hidden`:

```
bar     4px phase strip + one line: round position · category · you
stage   flex:1, min-height:0, the only scrolling region in the document
dock    the primary action — ACT states only
```

- **The bar never wraps and never grows.** Ordered horizontal sacrifice, as the host spec §5.1
  does it: the **category** goes first and goes *whole* rather than shrinking to a stub — below
  the tablet breakpoint it is not rendered at all, because it is on the shared screen anyway.
  The round position and your name are never sacrificed. The ctx is a single text node with
  `min-width: 0`, which is the fix the host spec had to make twice before its ellipsis actually
  rendered.
- **The dock is a flex row, not `position: fixed`.** A grid or flex row has no fold. This is the
  same move `5363a6db` made for the host and it is worth making the same way, because
  `position: fixed` on iOS Safari interacts badly with the collapsing URL bar and with the
  keyboard. `padding-bottom` carries `env(safe-area-inset-bottom)`.
- **Wide windows are absorbed by the gutter, not the content.** A phone layout stretched to
  1280px is not a laptop design; it is a phone design nobody stopped. Content caps at 620–660px
  and the gutter takes the rest.

### 5.2 Scrolling is allowed here, and that is not a contradiction

The host spec's headline is that the stage must never scroll. The player's stage scrolls, and
the two positions are the same position, stated by the commit the host spec supersedes:

> *scrolling to READ is fine, scrolling to ACT is not.*

On a projector nobody can scroll, so "read" and "act" collapse and the only safe rule is
*never*. On a phone the reader has the scrollbar in their hand: scrolling to read is free,
expected, and better than any reduction I could apply. Scrolling to **act** remains forbidden,
and the shell makes it structurally impossible — the dock is outside the scrolling region.
Audit **A2** asserts the page itself never scrolls and **A3** asserts the dock is fully on
screen at rest, at every profile.

The practical consequence, and it is a real one: a 247-character question is nine lines at the
primary rung and owns most of `07-ask-call`. That is correct. It is the content.

### 5.3 Except when the keyboard is up — the one reduction, and it is recoverable

With a soft keyboard there are roughly 430 usable pixels, and a nine-line question and a
composer cannot both have them. This is the screen that decides whether §5.2 works, so it is
its own mockup: `08-ask-call-typing`.

On focus the question **condenses** to three lines at body size and pins itself above the
composer, with `Show the whole question ↓`.

The host spec is emphatic that "room-facing content is never abbreviated" and that a reduction
may only fire when space is exhausted (its A10/A11). I am departing from the first half and
keeping the second, on one distinction that I think is the important one:

> **On the stage, a truncation is final — the reader cannot act. On the phone, the reader is
> holding the control. A truncation the reader can undo is not a deletion; it is a fold.**

So the rule for this surface is: **a reduction must be reversible by the player, must announce
itself, and must be triggered by a real constraint** — here, focus, which is a proxy for the
keyboard because no browser reliably reports the keyboard's height. Silent clipping is as
forbidden here as it is there. The two other folds in the design are the same shape: `Show all`
on a long ballot response, and the ballot pager.

---

## 6. The ballot

This is the screen that is genuinely the player's own — the host has nothing like it — and it
is where the current implementation is furthest from what the product now claims.

### 6.1 One ballot, not two modes

Quick Vote and Detailed Vote are deleted; the card ballot survives. Reasons, in order:

1. **Quick Vote contradicts the feature.** Its placeholder is literally `Pick player...`
   (`PlayerPage.jsx:1913`), on a ballot whose premise is that no players are attached to it.
2. **20 characters** (`:1921–1923`) is roughly three words of a response somebody spent a minute
   writing, with the remainder in a `title` attribute that a phone cannot show.
3. **A native `<select>` on iOS is a full-screen wheel.** The ballot is invisible while you
   choose from it, which means you cannot compare while ranking — the entire cognitive task.
4. **The response numbers are hidden inside the wheel.** The host says "look at response six".
   On Quick Vote you cannot look at response six without opening a dropdown.
5. Two implementations of one screen is how the trivia and results branches drifted, and it is
   how a mode toggle becomes a support question.

The replacement is one card per response: the number, the text, and three 44×44 rank buttons in
the row itself. Ranking is one tap, changing your mind is one tap, and the ballot never leaves
the screen.

### 6.2 Positional numbering is load-bearing and is never touched

`Response N` is 1-based, absolute, in array order, and matches `displayLabelFor` in
`config/anonymity.js` exactly. **The design never reorders, filters, sorts or reindexes a
ballot** — not by length, not to put your own last, not to hide an empty one. Vote indices map
to array position, and stable numbers across the whole ballot are what let a host say "six and
eleven" and be understood by forty people at once.

Audit **A8** asserts the rendered numbers are 1-based, strictly increasing and contiguous, on
every ballot screen and every page of a paged one. It is there to fail the day somebody adds a
sort control.

### 6.3 The anonymity copy

The room-facing sentence, verbatim, above the ballot, every time, not dismissible:

> **Nobody sees who wrote what — the host included — until voting closes.**
> This hides names, not identities.

The qualifier is not a footnote and it is not optional. It is the difference between a true
statement and an overclaim, and the product has to be able to say the true one out loud: a room
of twelve where somebody writes in their own voice about their own team is not anonymous in any
cryptographic sense, and telling participants otherwise would be a promise the software cannot
keep. The word "anonymous" does not appear on the player's screen at all. Audit **A7** asserts
both sentences, verbatim, on every screen carrying a ballot.

Two more places the copy has to be honest, both of them *before* the ballot:

- The **join screen** says what a name is for, at the moment the name is typed: *"On rounds
  where the room votes, your name is not shown next to your answer until voting closes."*
- The **composer** says it again, next to the thing being written: *"The room will see this
  response and vote on it. Your name is not attached to it until voting closes."*

That is the only sequence that gets consent at the right moment. Telling someone at the ballot
that their answer was unattributed is telling them after they wrote it.

**Your own row is marked** and remains rankable. `ownAnswerIndex` matches on submitted text,
which is correct and is not a leak (`anonymity.js:154`). Whether you should be *able* to rank
yourself is a product question, not a design one — see OPEN-QUESTIONS §3.

### 6.4 Paging — where I disagree with the brief, then mostly comply

The brief asks for "a long one that needs paging", and my first instinct was that it is wrong:
on a phone, scrolling is native, continuous and lossless, and paging is an interaction we would
be inventing for a device that already has one.

I changed my mind on one argument, and it is not an ergonomic argument:

> **Pages give the room a shared handle.** Fixed pages of eight mean response 11 is on page 2
> for every person in the room, always. A facilitator can say "everyone look at page two" and
> forty phones agree. Continuous scroll has no such handle — "scroll down a bit" is not an
> instruction.

That is the same argument as the numbering, one level up, so it is consistent with the thing
this ballot is for. So: **paging above 12 responses, fixed pages of 8, absolute ranges shown
(`Responses 9–16 of 20`), and the slot bar carries selections made on any page.** Below 12 it
is one continuous list, because three screens of scroll is the point where people lose their
place and two is not.

The three qualifications I would hold to:

1. **A page is a reading aid, never a data operation.** It does not filter, reorder, or
   renumber. `14-vote-long` shows page 2 with picks live on pages 1 and 3.
2. **The pager appears top and bottom.** A pager only at the bottom of a 20-card list is a
   pager nobody finds.
3. **If the slot bar could not persist across pages, paging would be indefensible** and I would
   have argued the point rather than conceded it. It can, so I concede it.

### 6.5 The receipt

Every submission — answer, title, words, ballot — produces a REST screen that shows **what was
submitted**. Today `handleSubmitAnswer` clears `answerInput`, `selectedTriviaAnswer` and
`wavelengthWords` on send (`:1172–1174`), so the only surviving record is `mySubmittedAnswer`,
which exists solely to find your own ballot row and is never displayed.

This is a small change with a disproportionate effect on how the room behaves. A player who can
see what they wrote can follow along when the host reads response four aloud. A player who
cannot is guessing, and a person who is guessing whether the room is discussing their idea is
not participating in the discussion.

---

## 7. Continuity: late, offline, and gone

The brief names three, and the code handles roughly one.

**Rejoining (`22-rejoin`)** is the fix for the blank page in INVENTORY §7.1. The rule: a rejoin
must always **state what it found**. "Your previous game state has been restored" is a claim;
"You had already voted — your response was Response 4, your ballot was 2 · 5 · 11, your total is
27" is evidence. It also means the rejoin screen is the same component in every phase and cannot
render empty, because it is built from what was recovered rather than from what happened to be
re-fetched.

**Offline (`21-offline`)** replaces a status chip whose click handler is
`window.location.reload()` — offered to a player mid-sentence, whose text lives in React state
and nowhere else. The replacement:

- A banner above the bar. Amber, never red: being offline is not destructive.
- It says what is safe, specifically: *"Your text is safe on this phone and will send as soon
  as you are back."* That requires a `localStorage` draft, which is the change that makes the
  sentence true, and the sentence must not ship before the change does.
- **The reload is withheld while there is unsent work**, and offered only when there is not.
  A remedy that destroys the thing it is protecting is not a remedy.
- The dock stays, disabled, saying *"Send when reconnected"*. The player keeps their place.

**Sending, and failing.** `handleSubmitAnswer` does `sendCleanMessage(...)` then immediately
`setHasAnswered(true)` (`:1165–1176`). There is no ack, no error path, and `hasAnswered` locks
out a retry for the rest of the round. "Answer Submitted!" is, in the failure case, false.
The receipt in §6.5 is what makes this fixable cheaply: show it only once the answer is
*confirmed*, and confirmation already exists as `checkPlayerAnswer` (`:551–563`) against an
endpoint that is already deployed. One call, once, ~1.5s after send. §11.

**Late arrival** needs the question rendered during VOTE, which today it is not — see
INVENTORY §5. A player who joins at round three and is immediately handed a ballot is being
asked to rank six answers to a question nobody showed them.

---

## 8. One-handed use

The default posture in the brief is somebody standing at the back of a room holding a phone in
one hand, and it drives four things:

1. **The primary action is the last element in the document and the lowest on screen**, full
   width, 56px tall, in the dock. A thumb reaches the bottom third comfortably and the bottom
   corners easily; nothing important is in the top corners.
2. **Everything tappable is ≥44×44.** Audit **A4** measures every `button`, `a`, `input`,
   `textarea` and `select` at all three profiles and fails on either dimension — including the
   easy places to cheat, like the ✕ inside a wavelength chip (44×44 with negative margins) and
   the pager cells.
3. **No target sits within 8px of another.** The three rank buttons are the tightest row in the
   design and they carry an 8px gap at every profile.
4. **No gesture is required for anything.** No swipe to rank, no long-press, no drag to
   reorder. Drag-to-rank is the obvious "nicer" ballot and it is wrong here: it is undiscoverable,
   it is two-handed in practice, it fights the scroll container it lives inside, and it is
   unusable with a screen reader or a switch device. Three buttons are boring and work for
   everybody.

---

## 9. What this design must never do

The host spec's §7 equivalent, stated so a later change can be measured against it.

1. **Never reorder, filter or renumber a ballot.** (A8)
2. **Never say "anonymous".** Say what happens, and always with the qualifier. (A7)
3. **Never show another named participant's answer, score or rank on a player's phone.** The
   ballot is unattributed until the host reveals; standings are yours and a count.
4. **Never reproduce the room's aggregate on the phone** — no tallies, no "9 of 12 answered",
   no leaderboard, no word cloud. It is the stage's job and forty copies of it is forty reasons
   to look down.
5. **Never offer an action in REST or WATCH.** (A9)
6. **Never lose typed text.** No control that reloads, navigates away, or clears a composer
   without saying so first.
7. **Never let the primary action leave the screen.** (A2, A3)
8. **Never truncate irreversibly.** Every fold has a control that opens it. (§5.3)
9. **Never require a gesture, a hover, or a second hand.**
10. **Never add a settings screen.** The player joins with four digits and a name, and that is
    the entire configuration surface. Anything that needs configuring is a design that has not
    finished.
11. **Never animate anything that means "wait".** The current pulsing dot is motion in the
    peripheral vision of a room that is supposed to be listening to somebody.
12. **Never load an external asset.** (A10)

---

## 10. Where this argues with its sources

### 10.1 The audit changed the design once

`03-join-ended` — the "that session has finished" screen — was WATCH, and it has a button:
*Enter a different code*. Check **A9** failed it, three times, one per profile, and the failure
was right: I had written a rule saying WATCH screens have nothing to press and then shipped one
with something to press.

The resolution is a boundary I had not stated. **The volume model begins at join-success.**
Before a player is in a session there is no stage to compete with, no room looking up, and no
shared surface — the phone is the entire product. All join-sequence screens are therefore ACT,
including the dead ends. The rule survives intact and is now stated rather than assumed.

I would not have found this by looking at the mockups. Sixteen green screenshots hid nine
defects on the host project; ten assertions × 23 × 3 found this one in nine seconds.

### 10.2 Disagreements with the host spec

- **The angular floor.** Its §4.2 restates the type floor "in angular terms" as the general
  rule. On a phone that produces 6.7px, and the real floor is set by iOS's 16px input-zoom
  threshold and by glare. The floor is angular when distance is the binding constraint and
  platform-set when it is not. (§3.4)
- **"One amber per view."** Amended to one amber *idea*. A selected option and the button it
  enables are one idea. (§4.3)
- **"The stage never scrolls."** Kept for the stage, rejected for the phone, on the strength of
  the commit the host spec supersedes: scrolling to read is fine, scrolling to act is not. (§5.2)
- **"Room-facing content is never abbreviated."** Amended to: a reduction the reader can undo is
  a fold, not a deletion. The stage's reader cannot act; the phone's reader is holding the
  control. (§5.3)
- **Display profiles as an explicit choice.** Right for one host with a Console. Wrong for forty
  participants: the profile is a media query and the reader's own text-size setting is the
  adjustment. (§3.5)
- **The `.rest`/`.watch` states have no equivalent on the stage at all**, and I think that is a
  gap in the host spec rather than in this one: its ENDED and between-rounds beats still carry a
  dock with a primary action, which is the host's job. Fine there, and the asymmetry is worth
  noting because a future shared component library will want to reconcile them.

### 10.3 Disagreements with the brief

- **Paging.** I think continuous scroll is better ergonomically and I do it below 12. I adopted
  paging above 12 for a reason the brief did not give — a page is a *shared handle*, the same
  argument as the numbering — rather than for the reason it implied, which was length. (§6.4)
- **"Design for the range and say how."** I did, and I want to be clear that width is a poor
  proxy for viewing distance and that the honest fix is the reader's own text-size control, not
  a cleverer breakpoint. (§3.5)
- **"Decide when the phone should pull attention."** I have taken this further than asked and
  made it *structural* rather than editorial: no dock, no amber, enforced by an audit check. A
  rule about attention that lives only in prose will not survive the next feature.
- **The framing that this is a redesign.** For nine of the twenty-three states it is not; it is
  a first design. Between-rounds, ended, offline, send-failed, rejoin-with-answer, poll ASK,
  survey ASK, the ballot's anonymity copy, and the question during VOTE do not exist in any form
  today. That distinction matters for estimating the work: this is not a restyle.
- **One thing the brief got exactly right that I want to underline**, because I tried to design
  around it and failed: *"the ballot is positional."* Every alternative I considered — sorting
  by length so short answers do not get skipped, floating your own to the bottom, hiding
  duplicates — breaks the room's shared reference and is worse for the reason the brief gives.

---

## 11. Buildability

Nothing here needs a new backend endpoint. Four changes are needed in `PlayerPage.jsx` and one
is worth doing on the server.

**Cheap, existing APIs, no new state:**

1. **Poll and survey ASK.** One branch (`:1691–1695`) that renders `detail` alongside `title`.
2. **Between rounds vs lobby.** `lastRankRef.current > 0` (`:147`) already distinguishes "a
   round has happened" from "nothing has happened". `isWaitingState && lastRankRef.current > 0`
   is the between-rounds condition, with no new fetch.
3. **ENDED.** `applyGameState('ENDED')` already runs (`:424`) and ranks above everything. It
   needs a branch *before* `isWaitingState`, which currently swallows it.
4. **The VOTE blank page.** Delete `&& answers.length > 0` from `:1855` and let the
   already-voted path render the receipt. The receipt data (`votes`) is already in state.
5. **The receipt.** `mySubmittedAnswer` already holds the text (`:109`); the ballot slots are
   already in `votes`.
6. **Confirmed submission.** After `sendCleanMessage`, poll `checkPlayerAnswer` (`:551`) once
   after ~1.5s before showing "in", and surface a retry if it comes back false. Endpoint exists.

**Needs a small addition:**

7. **Offline drafts.** `localStorage` per `gameId`+question, written on change, cleared on
   confirmed send. This is what makes the offline copy true.
8. **Distinguishing join failures.** The join endpoint returns one `error` string for wrong
   code, ended session and full session, so `02`/`03`/`04` cannot currently be told apart on the
   client. A discriminated code on the 4xx is the smallest fix.

**One thing that is safe by accident and should be made safe on purpose:**

9. `17-results-call` says "yours was Response 4" — the same number the ballot used. That
   requires the answers array to be in the same order at VOTE and at RESULTS. It currently is,
   *and it has to be*, because vote indices map to array position (`:1241–1243`) and a reorder
   between phases would already be misattributing votes. So the design does not add a
   constraint; it makes an existing, unstated one visible. It should be asserted in a backend
   test rather than left as a coincidence.

**What is impossible today, and where I would not design around it:** nothing. Every state in
this deck is buildable on the current backend. The one thing I looked for and could not find is
a signal for *"this participant is remote and has no shared screen"* — which would let the
WATCH states carry a one-line summary instead of an up-arrow. That is a product question, not a
missing API. See OPEN-QUESTIONS §1.
