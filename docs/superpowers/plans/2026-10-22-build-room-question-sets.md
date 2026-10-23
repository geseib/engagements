# Build Room question sets by kind of build

Owner, 22 Oct 2026: *"question sets for build rooms really is the prompts for the room for
various parts of the build. like there might be different questions for a training site, vs
a game, vs a paper etc. how would we make this, with as much reuse of code and components as
possible, understanding that ... going in to a build room we may not have picked what we are
building, but an early choice might change which question set we want or need."*
Then: *"of course the plugin could also have a skill ... a button request that gets back from
claude code an artifact in the repo/folder that we can use as a question set as well."*
And: *"yes, add it to the plan and build 1–4 first."*

## What exists (reused, not rebuilt)

- A set tagged `build-room` (Call and Answer or Poll) is offered in the host's Ask the room
  library; each question becomes Ideas, Choose or Rate (`buildroom/readyQuestions.js`).
- Categories in session order: Who it is for, Start, Think differently, While building,
  Before wrapping up (`docs/design/build-room-host-redesign/starter-set.md`).
- The opening's step 1, What are we making?, saves its answer in the brief (`lines.kind`).
- The set editor, tags (stored kebab-case, `shared/tags.js`), versions, AI generation, and the
  AI drafts behind the bell (keep, leave, edit, accept, undo).
- Research and Ideas requests (`BUILD#PREQ#`) that Claude picks up and answers.

## Steps

1. **Kind tags on sets.** `for-<kind>` beside `build-room` (tags are kebab-case, so not
   `for:`). A set may carry several; none means it suits any kind. No schema change.
2. **One list of kinds.** `website, app, game, tool, document, explore, training, dashboard`,
   in `build-store.js` (`BUILD_KINDS`, `kindKeyOf`). Step 1's answer, even a host-edited
   option ("A training site", "A paper"), is read into one of them by its words; anything
   else is no kind. Host and Claude reads carry `buildKind`.
3. **The library follows the kind.** Sets for the room's kind first, then the general ones,
   the rest folded under Other sets. Before step 1 is answered: general sets first. Nothing
   is locked; changing the kind changes the order.
4. **Claude gets the same questions.** The host's page, once the kind is known, hands the
   matching sets' askable questions to the room (`POST build/ready`, sealed for teams, at
   most 3 sets and 40 questions). Claude's `room_status` lists them by section: READY
   QUESTIONS for a game. Claude prefers them when it asks the room, adapting the words to
   what it has built. Its asks still go to the host first.
5. **Kind-specific opening questions** (later). A set's Opening category adds or replaces
   probes after a step once its kind is chosen ("What does the player do in the first ten
   seconds?"). Server change.
6. **Starter sets per kind** (built 23 Oct: `sets/build-room-<kind>.csv` and `-pulse.csv` for training, game, document, dashboard; `scripts/install-build-room-kind-sets.sh`; notes in `docs/design/build-room-host-redesign/starter-sets-by-kind.md`). Written by hand
   in the first starter set's style rather than by the set generator, five sections each, for
   the owner to edit.
7. **Claude writes a set** (built 22 Oct; plugin 1.26.0). A host button, Ask Claude for questions,
   makes a request of a new kind `questions`. A plugin skill says what a good Build Room set
   is (the five sections, only Ideas / Choose 2-6 / Rate 1-5, readable from the back of the
   room, what Claude does with each answer) and uses the brief, the decisions and the code.
   Claude writes `build-room/questions/<kind>-<name>.json` in the repo (committed, so it
   travels with the project), and a plugin tool sends it to Engage, which checks it like the
   importer and drops what the room cannot answer, saying why. It lands as an AI draft in the
   host's bell: keep, leave, edit, then accept as a new set or add to one (versioned, undo),
   tagged `build-room` and `for-<kind>`. Until accepted it shows in this session's library as
   From Claude (not saved yet). Claude never offers one unasked (off for now).

## Decisions taken without the owner (say so in the reply)

- Kinds: today's six plus training and dashboard, to match the starter templates. A paper is
  a document.
- The library reorders; it does not ask the host to confirm a set.

## Step 7 as built (22 Oct)

- Host: Ask Claude for questions in Ask the room's library (optional words; blank asks for
  the room's kind) makes a `questions` request (`BUILD#PREQ#`, host only; builders cannot).
- Claude: the build-room skill's Writing a question set; the file
  `build-room/questions/<kind>-<name>.json`; the tool `share_question_set` (path checked under
  build-room/questions/, at most 64 KB, valid JSON) posts it to `POST build/question-sets`.
- Server: kept as `BUILD#QSET#` (sealed for teams: Title, Questions, File), what a room cannot
  ask dropped and said why, the request marked done, a host-only timeline line. The host's
  read carries `claudeSets`; Claude, phones and the wall do not.
- Library: Claude's sets first, marked From Claude (dashed), askable at once. Save to my sets
  makes one or two drafts through `POST /admin/generation-drafts/from-build` (Call and Answer
  for Ideas, Poll for Choose and Rate; a set has one type), tagged `build-room` and
  `for-<kind>`, ready at once, with a bell note; then the existing review. The room's copy is
  marked saved.
