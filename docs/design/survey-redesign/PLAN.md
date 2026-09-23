# Surveys and polls — build plan

Design: `RATIONALE.md` and the mockups in this folder. **Nothing is built yet.**
The plan waits for the owner's go-ahead. The owner settled Names and the share
link's default on 23 Sep (RATIONALE §5); two small questions are still open.

The phases are ordered so that each one ships on its own, is usable on dev, and
leaves nothing half-wired. Every phase follows the repo's rules:

- Before any push, the backend suite (`node tests/*.js`), the frontend suite and
  `npm run build` all run green with baselines held.
- Deploy to dev first. Deploy to test once it looks right for the owner to
  review. Start prod only for work that has sat on test.
- Name the commit and the tier deployed.

Every new stylesheet gets a `*Palette.test.js`, following the engage-design
skill.

---

## Phase 0: fix what is broken today (small; ships first, on its own)

| Fix | Where |
|---|---|
| The dead kind checkboxes: `includeMultiplechoice` / `includeTextentry` → the real keys | `SurveyAIBuilder.jsx:589-591` |
| "Export JSON and close" on the host shelf downloads nothing | `HostQuestionSetsDialog.jsx:926` |
| The AI summary reads poll options from `optionA..E`; poll rows store `options[]` | `get-ai-summary.js:2107-2115` |
| Stale line references in comments | `gameTypes.js:149`, `csvPreflight.js:162` |

**Tests:**
- Extend `tests/survey-generation-job.js` to cover the flags that reach the request.
- Add a unit test for the poll-options read in the summary.
- Add a builder test for export-and-close.

## Phase 1: the question model and authoring (surveys can be made and kept)

**Backend**
- `lambda-functions/shared/survey-kinds.js`: the kind table plus validation
  (required fields, bounds, and conversions between kinds). It is copied into
  `admin/` and `game/`, and a guarded-identical test keeps the copies equal, the
  way `session-ttl.js` and `set-version.js` are guarded.
- `upload-questions.js`:
  - Lift the survey rejection (`:286-300`) for a CSV that has a `Kind` column and
    for the survey JSON.
  - Add a survey branch beside the trivia and poll branches (`:1076-1093`) that
    writes `Kind` plus the fields for that kind.
  - Encrypt question content for org sets (the owner decided on 23 Sep): add
    `options`, `Scale`, `Labels`, `FollowUp` and `Placeholder` to the `question`
    list in **all three** copies of `tenant-crypto.js` (`admin/shared/`, `game/`,
    `websocket/`). `tests/tenant-crypto-wiring.js` keeps the copies equal.
    Existing plaintext poll options keep reading through the passthrough rule and
    are encrypted on their next save.
- `download-template.js` and `download-question-set.js`: a survey CSV (with a Kind
  column) and JSON that round-trip.
- `ai-generate-survey.js` (02, 03):
  - All five kinds.
  - Separate `source` and `goal` inputs, a count capped at 20, and the kind toggles.
  - A `setCreation` step that writes a draft (inactive) survey set through
    `generated-set.js`.
  - Outputs `kind` and normalises the legacy `type` values.

**Frontend**
- `config/surveyKinds.js`: the frontend's kind table (icon, label, fields,
  defaults, the one-line preview, conversion rules).
- `NewSetDialog` / `QuestionSetUploadPanel`: Survey with its four ways in (01).
- `QuestionsPanel`:
  - A Kind column and a preview line under each question.
  - The Add-question menu.
  - `QuestionForm` gets a kind switcher and one field group per kind (04, 05, 06).
  - The phone preview is the player in an iframe.
- `SurveyAIBuilder` reworked into the 02 form. `GeneratedItemsTable` gets a Kind
  column and a change-kind control (03).
- `csvPreflight.js`: survey rules replace `survey-unsupported`.
- **Survey stays in `UNPLAYABLE_GAME_TYPES` until Phase 2.** The "Not playable"
  chip is truthful until then.

**Tests**
- `tests/survey-kinds.js`: validation and conversions.
- `tests/survey-upload.js`: CSV/JSON → rows → download → identical.
- The survey generator: the draft set is created and holds the chosen kinds only.
- Frontend: `surveyKinds.test.js`, `questionFormKinds.test.jsx` (each kind's
  fields; a conversion asks first), `surveyConsolePalette.test.js`.

**On dev:** create a survey each of the four ways, edit it, save a new version,
and download it.

## Phase 2: running a survey and recording answers

**Session**
- `create-game` accepts a survey set.
- A survey session has three stages: collecting, closed, and ended.
  - While closed, the walk-through reuses `RESULTS#nnn` and `FIELD_NOTES`.
  - The exact state names are settled against GameHostPage's phase machine as
    the first task of this phase.
- Remove `survey` from `UNPLAYABLE_GAME_TYPES`.
- **Names** (07, 12):
  - The set gets a `namesDefault` field (Anonymous unless changed).
  - The session copies it into `METADATA.Names` at create. The host can change it
    in the start dialog.
  - `start-game.js` stamps `OpenedAt` and refuses any later change to `Names`.
    It already writes the start TTL, so this is the same write.
  - Three write paths:

    | Names | Answers written under | Also written |
    |---|---|---|
    | Anonymous | A random id the phone makes and keeps | Nothing |
    | Who finished | The same random id | `SURVEY#DONE#<player>`: name and status (started, then finished) |
    | Named | The player, with `Name` | Nothing |

  - The phone shows the matching promise above question 1, using the exact
    wording from the start dialog's preview.

**Routes** (template, authorizer, CORS)

| Route | Who | What it does |
|---|---|---|
| `PUT /games/{id}/survey/answers` | player | Idempotent write of one answer into the per-person map |
| `POST /games/{id}/survey/submit` | player | Marks the row complete |
| `GET /games/{id}/survey/mine` | player | Returns the person's own row, for resume |
| `POST /games/{id}/survey/close` | host | Rejects later writes, aggregates into `SURVEY#RESULTS`, broadcasts `surveyClosed` |
| `GET /games/{id}/survey/people` | host | Who finished and Named only: the People list |

**Rows**
- `SURVEY#RESP#<respondent>`: a random id from the phone, or the player when Named. Encrypted per org; expires at start + 7 days.
- `SURVEY#DONE#<playerId>`: Who finished only. Holds the name and a status (`started` at the first answer, `finished` on Send) but no answers and no respondent id. 7 days.
- `SURVEY#RESULTS`: 30 days.

**Aggregation:** `lambda-functions/game/survey-aggregate.js` is the ONLY counting
code (per kind, as in 40-data-model). The frontend formats its output and never
recounts.

**Player**
- A survey mode in `PlayerPage` with the pager dock, five kind inputs
  (`components/survey/*`), check-and-send, done, and resume.
- Additions to `PlayerSurface.css` under `.plr` (10, 11).
- **Accessibility:**
  - Radio groups and checkboxes carry their correct roles.
  - Ranking works without drag.
  - Inputs render at 15px or larger.

**Wall**
- The collecting screen (s-01): the join block stays up, with finished-of-joined
  and per-question progress.
- In Who finished and Named, the host can show who is still going, on request
  (s-07). Names are never shown next to an answer.
- Dock: a two-minute warning (broadcast) and Close.
- `surveyProgress` goes to host sockets only, as counts.

**Tests**
- `tests/survey-answers.js`:
  - an overwrite is idempotent
  - partial answers count
  - a closed survey rejects writes
  - a player can read only their own row
  - encryption round-trips
  - Anonymous: the stored answer row has no name and no player id
  - Who finished: the DONE row has no respondent id, and the answer row has no
    name
  - Named: resuming from a second device finds the same row
  - Names can't change after `OpenedAt`
- `tests/survey-aggregate.js`: a fixture made of the mockups' own numbers
  (`_src/content.py`: mean 4.03, recommend score +32, average places summing to 15).
- Player kind-input tests (roles, keyboard, required versus Skip).
- `surveyPhonePalette.test.js`.

**On dev:** run a real survey from two phones and a laptop; reload mid-survey;
close it.

## Phase 3: results in the console, on the wall, in the report

- `GET /games/{id}/survey-results` returns results plus the analysis when there
  is one, with names stripped.
- **Console:**
  - The results page under Sessions and on the set's Results tab (30).
  - The People tab (33) for Who finished (no answers column) and Named (answers
    in a dialog). The CSV includes names only when Named.
  - The open-answers page (31).
  - CSV export.
- **Wall walk-through:** one `KindResult` per kind (s-02 to s-06).
  - Choice reuses `QuestionCard`'s bars with a "Most picked" flag variant.
  - Rating and yes/no are the two new shapes.
  - Putting a quote on the wall reuses the feature verb and
    `blockquote.featured`, with no name.
- **Report:**
  - `create-report.js` gains a survey section read from `SURVEY#RESULTS`.
  - `GameReport.jsx` renders it (34).
  - PDFs save through the existing `save-report.js`.
- **Tests:**
  - A `KindResult` renders each kind from the fixture.
  - The report JSON contains the survey section.
  - `surveyStage` CSS contract (the reduced-motion paths, no geometric asserts).

## Phase 4: Workie's read

- **One structured call** on close (and on Redo), following the
  `structured-generation.js` pattern with forced tool use. It returns:
  - lead, body, next steps and caveat
  - per-question notes
  - open-answer themes (answer ids per theme)
  - `heldBack` ids for answers that name a person
- **Stored as** `SURVEY#ANALYSIS` (30 days), written and broadcast with the
  existing 202-then-worker pattern.
- **Voice and Approach** resolve exactly as `PersonaId` / `PromptId` do today.
  Add a survey default prompt to `default-ai-prompts.json` and a survey note to
  `personas.js`.
- **Console:**
  - Workie's read panel, with Redo plus a steer and "Edit the words" (marked as
    edited).
  - Per-question notes.
  - Theme filters.
  - Held-back answers with Release.
- **Wall:** "What we heard" reads the survey analysis.
- **Tests:** `tests/survey-analysis.js` with Bedrock stubbed, covering:
  - the output contract
  - that no names enter the prompt
  - held-back ids stay out of every shared path
  - that Redo keeps the edited flag honest

## Phase 5: sharing results back

- **Storage:** `SHARES / SHARE#<token>`, where the token carries 128 random bits.
  The snapshot is built from results and analysis, never from answer rows, and
  goes to the reports bucket, encrypted for org sets.
- **Expiry:** `OpenedAt` plus the chosen window.
  - The default is 2 days, and the default reach is anyone with the link (the
    owner's rule).
  - 7, 30 and 90 days are offered, counted from the same moment.
  - Sharing after the window has passed defaults to the next window still in the
    future.
- **Routes:**
  - `POST /games/{id}/survey/share` (create, update, revoke)
  - `GET /r/{token}`: public; returns 404 once revoked or expired
- **Rules enforced on the server:**
  - only the questions the host included
  - no chart with fewer than 5 answers
  - no held-back answers
- **Frontend:**
  - The share dialog (32).
  - An `/r/:token` route that renders the shared page in the player shell (11).
  - The ENDED screen gains "See the results" through a `surveyShared` broadcast.
  - "Put it on the wall" shows the QR code.
  - "You" marks come from local storage only.
- **Tests:**
  - The snapshot excludes held-back answers, charts under the threshold, and
    unticked questions.
  - Revoked or expired returns 404.
  - Expiry is anchored to `OpenedAt`, not to when the link was created or first
    viewed.
  - No name appears, even when the survey was Named.
  - An update rewrites the snapshot.

## Phase 6: polls on the same five kinds (paced by the host)

- **The free-text poll with a vote is retired** (the owner decided on 23 Sep).
  Poll questions gain `Kind`, with multiple choice as the default.
  - A poll row without a `Kind` is read as **multiple choice** when it has two or
    more `options`, and as an **open answer** (no vote) otherwise. There is **no
    data migration**; the default is applied on read, the way the set-version
    contract does it.
- **Polls lose the vote phase:**
  - `hostControls.js` adds `poll` and `survey` to `TYPES_THAT_SKIP_VOTE`.
  - `gameTypes.js` phases become `['ASK', 'RESULTS']`.
  - `handleFinishQuestion` in GameHostPage goes straight to results for a poll.
  - `anonymityApplies` therefore narrows to Call & Answer. Polls take the
    **Names** setting instead, with the same rule for the answer row key as a
    survey.
  - The poll branch of the vote tally in `get-results.js` and the poll path to
    the free-text textarea in `PlayerPage.jsx` are removed.
- **Backend:**
  - `get-question.js` and `get-game-state.js` send the options and the fields for
    each kind.
  - `message.js` writes `ANSWER#` rows with `AnswerType = kind`.
  - `get-results.js` counts each question with `survey-aggregate.js`.
- **Player:** ASK renders the kind input from Phase 2.
- **Wall:** RESULTS renders the Phase 3 `KindResult` after each question.
- **Tests:**
  - A poll of each kind runs end to end.
  - A legacy poll row with `options` plays as multiple choice.
  - A legacy poll row without `options` plays as an open answer.
  - No poll ever enters VOTE.
  - `anonymityApplies('poll')` is false and the Call & Answer toggle is unchanged.
  - Legacy plaintext options decrypt through the passthrough rule, and re-save
    as envelopes.

---

## What is deliberately left out

- **Mixed-type sessions.** A survey closing out a trivia session, and the wider
  agenda of surveys, presentations and games under one code, are a separate
  future body of work. Its first mockups are in `docs/design/agenda-redesign/`.
- **Branching logic** ("if No, skip to Q7"). The "why?" follow-up covers the
  common case without a logic editor.
- **Sending results by email.** The link, the QR and the push to phones cover
  handing them out.
- **Comparing sessions over time.** The set's Results tab lists the runs, but
  there is no cross-session trend chart yet.
