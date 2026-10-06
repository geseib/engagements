# Build Room host redesign: build plan (second pass)

Prerequisite: the owner has answered `RATIONALE.md` §12, at least questions 1, 2 and 5.

Every step ships on its own and leaves the page working. Verify each one with:

- the frontend suite;
- the backend tests it touches;
- `tests/build-room-copy.js`;
- `npm run build`;
- a render in the browser pane compared with its mockup.

A push to `dev` deploys; push finished steps only (CLAUDE.md).

## Ground rules

- **Nothing a test or the owner relies on is deleted.**
  - The 49 tests in `__tests__/buildRoomPage.test.jsx` find controls by role and name.
    Moved controls keep their names: "Open to the room", "Answer for the room",
    "Send to Claude", "Close", "Discard", "Reconnect", "Sign in again".
  - The Present tests are rewritten with the same intent. On the Stage, Build and History
    screens, no host-only control, idea author, host note or proposed ask is rendered.
    P still switches what the room sees.
- **Build on the shipped stage.**
  - The Stage screen mounts `components/stage/Stage.jsx` with `Rail`, `RoomMeter` and
    `Dock`. The fitter and the four display profiles come with it.
  - Host chrome stays in the `.brm` scope, and `buildRoomPalette.test.js` measures every
    new pairing and tint.
- **Pure functions first.** Where possible a step starts with a pure function and its
  unit tests, then the component.
- **The server owns names.** Anything that derives per-person data (queue, People,
  chains) is computed in `build-store.js` `hostView` / `publicView`. The phone view never
  carries what it should not.

## Step 0. Spike: can Engage frame the local build? (half a day, no product code)

- On engage.dev, open a scratch page (or the console) and frame a local Vite server in
  the owner's Chrome, Edge, Safari and Firefox.
- Record for each:
  - whether a permission prompt appears;
  - what Allow does;
  - what is remembered;
  - what `allow="local-network-access"` on the iframe changes.
- Also try a dev server that sends `X-Frame-Options: SAMEORIGIN` (Rails, Django).
- Write the result into this folder.
- If no browser frames it, the Build screen ships as C8 only: the screenshot, plus Open in
  a new tab.

## Steps

**1. The header and the four screens.**
- Add `BuildHeader.jsx`:
  - the title;
  - the Host, Stage, Build and History tabs (keys 1–4; P flips Host and the last projected
    screen);
  - the ask pill;
  - Claude status;
  - the join code with the QR on hover (reuse `QrZoom`);
  - the menu: Connect, Crew, Auto, Wrap up, Report, End.
- `view` state replaces `present`.
- In this step Host is today's page minus its header; Stage is today's stage. Build and
  History show placeholders.
- **Mockups:** every C page's header.

**2. The Stage screen.**
- Stage mounts the shipped `Stage` with the current ask, results, crew board or idle
  content.
- The dock has Close / Open voting and Answer for the room, with Space.
- No host-only element on it (the rewritten Present test).
- **Mockups:** C6.

**3. The Host screen: Now and the composer.**
- The Now card states:
  - building: activity, Show the build, Preview the work;
  - live: counts, Close, Answer for the room, Edit, with Discard and Reopen under Edit;
  - results: `DecidePanel` with Adjust;
  - first run: How it works.
- The composer replaces `NextPanel` and the timeline's quick log. Its routes:
  - Send to Claude (`postDirection`);
  - Ask the room (`AskComposer`, prefilled);
  - Queue it (step 4);
  - Log it (`postLog` with kind verbal).
- **Mockups:** C1, C4, C5.

**4. The queue.**
- Server work:
  - `hostView` returns `queue`: proposed asks, ideas with status new or later, preview
    feedback, crew shares incoming, and host items, each with `source`, `kind`, `text`,
    `createdAt` and a stable id.
  - Pure ordering function: Claude's asks first, then oldest. It has unit tests.
- New in the backend:
  - a host-created idea (`Source: 'host'`) for Queue it;
  - an idea status `later`;
  - `POST build/asks-from-ideas` (`{ ideaIds, kind: choice|rating, maxPicks, prompt, open, askForMockups }`),
    defaulting to `kind: choice`, `maxPicks: 1` (Pick one, owner 2026-10-05),
    which creates the ask and marks the ideas promoted.
    - With `askForMockups`, the ask is created **proposed**, so the room cannot see it,
      and today's "make a mockup of each, attach it to its option" direction is posted to
      Claude. The vote waits in the queue as Claude's `share_image` calls fill each
      option (C3b).
    - When every option has a picture, `hostView` marks the item **Ready**. It never
      opens by itself (owner, 2026-10-05).
    - **Open next** (`action: 'openNext'`) stores the ask as next. Closing the current ask
      opens it, and the host is told. This is the only automatic opening, and the host
      asked for it.
    - The host can still Open now (options without a picture show their words only),
      Close the current ask and open this, Edit, or Cancel. Cancel returns the ideas to the queue as new.
  - Each is tested in `tests/build-room.js`, including the delete and authorisation
    rules.
- The page:
  - the queue column with filters;
  - per-item routes;
  - multi-select with the bulk bar;
  - the "Put N ideas to a vote" dialog (Modal: X and Cancel, one `requestClose`).
- **Mockups:** C1, C2, C3, C3b.

**5. History.**
- Server work:
  - add `RelatesTo` to log rows written by idea actions, decisions, directions and
    `share_image`;
  - a pure `historyChains(room)` with tests.
- The page:
  - the Host column (editable entries, delete rule, newest first, screenshots inline);
  - the History screen at the Room ladder, with Everything, Decisions and Artifacts
    filters;
  - the wrap-up side column.
- `Timeline`, `ShotsPanel` and `AskList` become views of this one list, so no capability
  is lost.
- **Mockups:** C9, C10, C12.

**6. The Build screen.**
- Shape it from the step 0 result.
- The frame (`sandbox` without `allow-top-navigation`) shows:
  - the newest local link (a showing entry, the preview, or the outcome demo);
  - a tab per option's local link during a Choose ask.
- Reload and Open in a new tab are always present.
- A load timeout falls back to C8.
- The room-safe ask pill sits over the frame.
- **Mockups:** C7, C8.

**7. Phones.**
- `BuildPlayer.jsx` gains a History tab: the decisions, Claude's posts and the pictures
  (from `publicView`, which already carries `images` and the room's log).
- Preview feedback moves onto its picture.
- "In a vote now" and "Sent to Claude" idea states join `IDEA_STATUS`.
- **Mockups:** C11.

**7b. Ready questions (C13, C15).**
- Ship the two starter sets drafted in `starter-set.md` (owner, 2026-10-05):
  - "Build Room starters" (Call and Answer) and "Build Room pulse" (Poll, rating 1–5);
  - both tagged `build-room`, with topic `business-work`;
  - categories Start / While building / Before wrapping up.

  Move the CSVs into `sets/` once the importer reads `ClaudeGets` and `ClaudeNote`. Upload
  them to the platform library on each tier through the normal upload path, never by
  writing rows directly.
- Add two optional question fields, `ClaudeGets` and `ClaudeNote`, in
  `upload-questions.js` and `edit-question-set.js`. `ClaudeNote` goes in the
  tenant-crypto question field list.
- The set editor shows an "In a Build Room" section when the set carries `build-room`.
- A pure `buildAskFromQuestion(question, set)` maps a question to `{kind, prompt, detail,
  options, lowLabel, highLabel, claudeGets, claudeNote}`, or to `null` with a reason. It
  is unit-tested on every poll kind.
- The Ask the room dialog lists sets from `GET /question-sets` with
  `tags.includes('build-room')`, and reads questions by scope and id.

**7c. What Claude gets (C14).**
- Log rows gain `ForAgentAs`: do-now, keep, later or ask.
- `hostView` and the agent view return `brief: { forWhom, keep[], later[] }`, built from
  the rows plus host edits (a `BUILD#BRIEF` row).
- Plugin: `renderInbox` renders the four kinds with the texts on C14, and `room_status`
  prints the brief. The plugin writes `.engage/brief.md` on change.
  - `post_update` gains `kind: 'answer'`.
  - Bump `VERSION` and the pin in `tests/engage-plugin-version.js`.
- Wrap-up: the `wrap-up` prompt asks Claude to propose brief items worth keeping. The
  host picks, and Claude writes only those.

**8. People, and polish.**
- The People tab with counts (scores only after the owner's answer; `scores.html`).
- Measure every screen at Room, TV, Call and Table.
- Update `docs/design/AUDIT.md`.
- Push to dev, look on `engage.dev.seibtribe.us`, then test.

**9. (Later) The remote.**
- A build view of `/remote`: the Now card, the queue and the composer on a phone, laptop
  or tablet, so the laptop can stay on the Stage or Build screen (first pass, A3).

## Which component moves where

| Today (BuildRoomPage.jsx unless named) | After |
|---|---|
| `RoomHeader`, `AgentChip`, `ConnectionChip`, `AutoSwitch` | `BuildHeader` (and its menu); the connection bar |
| `ReviewCard` | a queue item (Claude ask); Edit expands today's fields |
| `AskStage`, `ChoiceBoard`, `RatingBoard`, `SuggestBoard`, `Whys` | the Stage screen; a summary in the Now card |
| `DecidePanel` | the Now card at results |
| `IdleStage`, `WrappedStage` | the Stage screen (idle) and History's closing column |
| `JoinFoot`, `QrZoom` | the Stage meter; the header code |
| `NextPanel` | the composer + the Now card |
| `AskList`, `ShotsPanel`, `Timeline` | History (Host column, History screen, filters) |
| `ClaudeActivity` | the Now card + the Claude tab |
| `IdeasInbox` | the queue |
| `CrewBoard`, `StageTabs` | the Stage screen in crew mode |
| `CrewIncoming` | queue items (Crew) |
| `CrewTasks`, `RunCrewCodeSwitch` | the Crew dialog |
| Dialogs (Connect, Wrap up, Crew, Early look, End, Compose) | unchanged |
