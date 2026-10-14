# Ask the room, from Workie's read: the build plan

Approved by the owner 2026-10-13 ("i like the feedback mockups … go"). The design is
`mockup.html` in this folder (option A: each ask names the section and point of the read
it came from). This plan replaces phases 4–5 of `docs/design/ca-followup-asks/PLAN.md`
and changes parts of its finished backend (`92a2921e`, T2–T7 and T9–T12).

Everything stays behind `FOLLOWUP_ASKS_ENABLED` (dev only). The frontend needs no switch
of its own: when the feature is off, the host's suggestions read
(`GET /games/{id}/followups/round/{nnn}`) answers 404, and every screen shows nothing.

Measured on dev before this plan (session 2543, round 1, 2026-10-13): the worker wrote
`FOLLOWUP#001#SUGGESTED` with 2 asks kept, 0 dropped, 1 marked reworded, 2.4 s, served by
Sonnet 5.5. The model call works live; the rework is the kinds, the anchors and the screens.

Rules for every task are the old plan's: the test first, backend suites judged by exit code
and suite count, `cd src && npm test && npm run lint && npm run build`, Node 18 in the
pipeline, duplicated files edited in every copy with their drift tests, nothing pushed while
a baseline is red.

## What changes from the first design

| | First design (ca-followup-asks) | This build |
|---|---|---|
| Kinds | agree (Agree / Not sure / Disagree), choice | **Ideas** (open text, 280 characters), **Choose** (2–4 options), **Rate** (a statement, 1–5, "1 · Disagree", "5 · Agree") |
| Where the host finds them | a drawer behind "Ask the room…" | **an icon beside the point of the read it came from**, on the laptop and the Remote; the wall shows the read without icons |
| How many | up to three | **at least one, up to three** |
| Results on the wall | counts | Choose: bars and counts. Rate: the average and the spread. Ideas: **only the answers the host picks**, never names |

## Phase A: the backend

**A1. The kinds.** `followup-kinds.js`: `KINDS = ['ideas', 'choice', 'rate']`. Rate maps to a
survey `rating` question (1–5, fixed end labels nobody relabels, as Build Room fixed its
scale); Ideas to a survey `text` question capped at 280; Choose unchanged. An `agree` row
(dev only, 30-day ttl) reads as nothing rather than being migrated.
Test: `tests/followup-kinds.js` rewritten for the three kinds; every kind round-trips through
`toSurveyQuestion` and `checkValue`.

**A2. The prompt.** `followup-prompt.json`: the three kinds; each ask carries
`anchor: { section, point }` (the heading exactly as the read printed it, and the 1-based
number of the bullet under it); "at least one, up to three". Rate keeps agree's copy rule
(words copied from one answer, at most 20). Ideas: one open question, at most 110
characters, no names, never personal.
Test: `tests/followup-prompt-shape.js` (variables filled, schema parses, kinds enum matches
`KINDS`).

**A3. The anchor check.** `followup-grounding.js` gains `anchorIn(markdown, anchor)`: the
section must be a heading of the stored read and the point a bullet under it. A miss keeps
the ask with `anchor: null` (shown after the read, never lost) and counts as a mark.
Test: `tests/followup-grounding.js` extended with the read headings as fixtures.

**A4. Counting.** `followup-store.js`: Rate is tallied by the survey's own `aggregate`
(average and the five counts); Ideas keeps each answer's text, sealed, and a `Picked` flag.
New host route `POST /followups/asks/{askId}/pick { answerId, picked }` (Cognito,
`callerMayDriveSession`, 404 otherwise). The public `live` read after close carries counts
for Choose and Rate and **only the picked texts** for Ideas, never a name.
Test: `tests/followups-routes.js` extended: pick refused for a rival org; an unpicked idea
never reaches the public read; Rate's average.

**A5. The `ask` beat.** Add `ask` to the closed set in every copy (`stage-beats.js`,
`config/hostControls.js`, `config/hostRemote.js`, the wall's beat reader). Send sets the
beat to `ask`; Cancel returns it to `field-notes`; Close keeps it (the results view).
Test: `tests/feedback-round-beat.js` (copies agree), `__tests__/hostRemote.test.js`.

## Phase B: the host's screens

**B1. Words.** `src/src/config/followUpWords.js`: Ideas / Choose / Rate, "Ask the room",
"Send to the room", "Question for the room", "Show results", "Cancel the question", "Ask
another", "Finish the open question first", "From answers 1, 2 and 3", "Reworded".

**B2. Where an ask sits.** `src/src/config/askAnchors.js` (pure): given the read's markdown
and the round's asks, which asks belong beside which bullet, and which go after the read.
`MarkdownRenderer` gains an optional `listItemAddon(section, point)` so the laptop's
What we heard pages draw an icon button at the end of the anchored bullet; the wall and the
phones pass nothing and draw no icons.
Test: `__tests__/askAnchors.test.js`; a render test that the wall's read has no icon.

**B3. The preview.** `components/AskPreview.jsx` on the shared dialog look: the kind
switch (Ideas / Choose / Rate), what the phones will show, "For you: …" with the answers it
came from, Edit, Cancel, Send to the room. One `requestClose()` for the X, Cancel and
Escape. Measured at 660 px and 375 px.
Test: rendering per kind; Send disabled until valid; switching kind keeps the words.

**B4. The step.** `roundStep`: a new moment `ASKING` (beat `ask`, an ask live) with primary
Show results (two presses while people are still answering) and secondary Cancel the
question; `ASKED` (closed) with primary Next round and secondary Ask another (back to the
read's last page). The dock status reads "3 of 5 answered". The Remote takes the same steps
from the same function (parity test).
Test: `roundStep.test.js`, `roundStepParity.test.js`, `hostControls.test.js`.

**B5. The laptop stage for `ask`.** Live: the ask and "Still to answer" (names only where
the round's settings already show them). Closed: the results per kind; for Ideas the list of
answers, each a button that puts it on the wall or takes it down (as featured comments do).

**B6. The Remote.** The read's sections it already lists gain the same icons and the same
preview (as a full-height sheet); then the dock steps from B4.

## Phase C: the wall and the phones

**C1. The wall.** `presentModel`: `ASK_LIVE` (the ask, its options or scale, "3 of 5
answered on their phone, laptop or tablet") and `ASK_RESULTS` (per kind, as the mockup's
section 4). `usePresentation` reads `GET /followup-play/live`; `followUpChanged` joins
`FOLLOW_FRAMES`.
Test: `presentModel.test.js`, `presentStage.test.jsx`; no name in any ASK model.

**C2. The phones, laptops and tablets.** `PlayerPage`: on RESULTS with the beat `ask`, a
`FollowUpCard` drawing the ask through `toSurveyQuestion` with the existing `ChoiceInput`,
`RatingInput` and `TextInput`; Send; change until closed; the result after close.
Test: `__tests__/followUpCard.test.jsx`: each kind, change then send, the closed view.

## Phase D: the report

`create-report.js` reads `FOLLOWUP#nnn#ASK#` rows; the round and session reports gain
"Questions for the room": each ask, where it came from, its result (picked ideas only), and
a cancelled ask marked as such. No name anywhere in the section.

## Shipping

Each phase goes to dev when its gates are green (behind the flag, so a half-built phase
shows nothing). After Phase C, one real session on dev, walked end to end in the browser
pane as on 2026-10-13. Then test for the owner's review; prod only after test.
