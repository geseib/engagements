# Create an engagement, and preview it — build plan

The design is in `RATIONALE.md` and the mockups in this folder. **Nothing is
built yet.** This plan waits for the owner's go-ahead and their answers to the
open questions in RATIONALE §f. Each phase below says which default it assumes.

Each phase ships on its own, is usable on dev, and leaves nothing half-wired.
Every phase follows the repo's rules:

- **Before any push**, run the backend suite (`node tests/*.js`, judged by exit
  code and suite count, with `.aws-sam` cleared first), the frontend suite
  (`cd src && npm test && npm run lint && npm run build`), and hold the
  baselines.
- **Deploy dev first.** Deploy test once the work looks right for the owner to
  review. Start prod only for work that has already sat on test.
- **Push the branch or the tag, never both.** Name the commit and the tier.
- **Every new or changed stylesheet** gets or extends a `*Palette.test.js`
  (engage-design skill §5). Never name a test file `*Token*`.
- **New selectors** go inside the existing scope of the sheet they join:
  `.gsd` for the dialog, the stage's own classes for `styles/stage.css`, and a
  new `.nyo` scope for the phone's "not open yet" screen.

---

## Phase 0 — fix what is broken today (small; ships first, on its own)

Each fix is independent of this design. Each one is also something the design
would otherwise inherit.

| Fix | Where | Test |
|---|---|---|
| **Workie reads the host's context as text on org sessions.** Decrypt METADATA (`decryptItem(summaryOrgId, 'session', …)`) right after the read at `:756-759`. Everything downstream (`:1213`, `:1222-1223`) then reads plaintext. | `lambda-functions/game/get-ai-summary.js` | **New** `tests/ai-summary-session-decrypt.js`: an org session whose METADATA carries envelopes produces a prompt containing the plaintext details and instructions, and no `[object Object]` anywhere. A platform session is unchanged. |
| **The mid-round approach switch works.** Gate `update-game.js` per field. `personaId` and `promptId` are accepted in any state except `ENDED`/`EXPIRED`. Every other field stays CREATED-only (`:151-157`). | `lambda-functions/game/update-game.js` | Extend `tests/update-game.js` and `tests/persona-controls.js`: `promptId` on a game in `ASK#001` and in `RESULTS#001` returns 200 and changes nothing else. `eventTitle` on the same game is still 400. |
| **Category names are readable.** Add `.gsd .category-button .category-name { color: inherit; }`. | `src/src/components/GameSetupDialog.css` | Extend `gameSetupPalette.test.js`: read `styles.css`'s `.category-name` rule too, and assert the dialog re-declares the name's colour. Composite the unselected name on the card at ≥ 4.5:1. |
| **The edit note stops saying categories are fixed.** New copy: "The format and question set are fixed once a session is created — create a new session to change either." | `GameSetupDialog.jsx:423-426` | `gameSetupDialog.test.jsx`: in edit mode the note does not mention categories. |
| **Hosts can read a document.** Add `'POST admin/parse-document'` to `HOST_ADMIN_ROUTES`. | `lambda-functions/auth/authorizer.js:248-358` | Extend `tests/authorizer-set-routes.js`: hosts are allowed on that exact pair, and the admins-only catch-all is unchanged for its neighbours. |

---

## Phase 1 — the simpler create dialog (frontend only)

**Assumes:** nothing from §f. The payload is unchanged.

- **`src/src/config/setupDefaults.js` (new, pure).**
  `advancedSummary({ gameType, anonymousResponses, randomizeQuestions, personaId, promptId, eventDetails, aiContext, personas, promptChoices, setPromptWillBeUsed })`
  returns `{ changed: [...], defaults: [...] }`. The summary sentence is built
  from that return value.
  - It is the one place that decides what "default" means for each field. Its
    defaults must equal `createGameBody`'s (`config/createGame.js:33-71`) and
    the create handler's (`create-game.js:211-222`).
- **`src/src/components/GameSetupDialog.jsx`:**
  - Keep in the main view: title, format, set with its link, and categories
    (helper copy: "None picked, so all N are in · M questions").
  - Add a native `<details className="gsd-adv">`, closed by default. Its
    `<summary>` carries `advancedSummary`'s sentence, with changed values first.
  - Inside it, four sub-sections in this order: Responses (Call & Answer only),
    Questions (shuffle), Workie (voice, approach, "Instructions for Workie"),
    and What people see when they join (event details).
  - Remove the plan sentence (`:741-749`). The summary line replaces it.
  - Add a sticky head (h2 and X) and a sticky foot, whose note reads "Nobody can
    join until you open the doors."
  - Route the X, Cancel and Escape through one `requestClose()`. When the form
    is dirty, turn the foot into the inline confirm: Keep editing / Discard. Use
    `closeOnEscape={() => !dirty}`, and let Escape open the confirm.
- **`src/src/components/GameSetupDialog.css`**, all under `.gsd`:
  - `gsd-head` / `gsd-foot` (sticky) and `gsd-foot--confirm`;
  - `gsd-adv` and its summary grid;
  - captions raised to 12px (`.gsd-pv h6`, `.gsd-pv-who`, `.gsd-opt-state`);
  - a header comment with the measured ratios from `_src/ss-dialog.css`.
- **`config/anonymity.js`:** `anonymityApplies` follows `hostRunsVotePhase`. It
  narrows to Call & Answer automatically when the survey plan retires the poll's
  vote. Do not special-case it here.

**Tests**

- **New** `src/src/__tests__/setupDefaults.test.js`:
  - every default, per format;
  - a changed voice or anonymity is named first;
  - the anonymity clause is present only for Call & Answer;
  - the defaults equal the `createGameBody` defaults.
- **Extend** `gameSetupDialog.test.jsx`:
  - Advanced is closed on open, and the summary names the defaults;
  - Responses renders only for Call & Answer;
  - the Create guard is unchanged (`:197`);
  - the X and Cancel both call one close path;
  - a dirty form shows the confirm and does not call `onCancel`;
  - a clean form closes at once.
- **Extend** `gameSetupPalette.test.js`:
  - the confirm foot `#2A2E42` carries `--gsd-text` at ≥ 4.5:1;
  - the amber "changed" words on the card are ≥ 4.5:1;
  - nothing in the sheet is under 12px except any named dispensation.
- `createGamePayload.test.js` and `gameSetupCallSite.test.js` must pass
  unchanged. The payload does not move in this phase.

---

## Phase 2 — preview before opening

**Assumes:** Edit lives inside Preview (§f Q5); the doors cannot be closed again
(Q6); a waiting phone checks for 2 hours (Q9).

**Host page**

- **`src/src/config/hostControls.js`:** `hostControlsFor` takes `doorsOpen`.
  - For LOBBY with `doorsOpen === false`, the primary is
    `{ id: 'open-doors', label: 'Open the doors', intent: HOST_INTENTS.OPEN }`,
    never disabled.
  - The status reads "Look it over, then open the doors".
  - `doorsOpen` is derived from `gameState !== 'CREATED'`.
- **`src/src/GameHostPage.jsx`:**
  - After Create, `switchToGame(newGameId)` lands on the preview. Replace
    `:4404-4410`, which opens the history list.
  - A URL load of an unstarted session goes to the preview. Replace the bounce
    at `:1618-1624`. Continue by code (`:4154-4168`) does the same.
  - `runHostAction(OPEN)` POSTs `/games/{id}/start` (the call inside
    `startGameFromHistory`, `:4190-4221`, lifted into one helper that both
    callers use). It then re-reads state, so the stage becomes the normal lobby.
  - **Edit** in the dock renders `<GameSetupDialog mode="edit">` *over* the
    stage while `gameState === 'CREATED'`. It stays reachable from history for
    now. Save returns to the preview and re-reads the title and categories.
  - **Step through:** → and **Round N ›** fetch `GET /games/{id}/up-next?count=5`
    once. They render the ASK frame for item N read-only, with the preview
    kicker. ← goes back. Nothing is written.
  - Trivia asks once: "The room may see these — look anyway?" This is an inline
    strip in the dock, not a modal.
- **`src/src/components/stage/Rail.jsx`, `PhaseBar.jsx`, `RoomMeter.jsx`:**
  - the chip `preview` (dashed);
  - `data-phase="preview"` (dashed band);
  - a meter that shows the word **Closed**;
  - the kicker copy.
- **`src/src/styles/stage.css`:** `.chip.preview`, `.bar[data-phase="preview"]`
  and `.meter .doors`, sized from the profile ladder. Copy them from
  `_src/ss-stage.css`.
- **`src/src/components/SessionHistoryPanel.jsx`:** `rowActions` for an
  unstarted row becomes `{ preview: true, open: true }`. Preview is the primary
  (the safe act) and Open is the deliberate one. Update the docblock
  (`:50-79`) with the reason.

**Phone**

- **`src/src/components/NotOpenYet.jsx` (new) and `NotOpenYet.css` (`.nyo`
  scope).** It renders the `not-started` refusal (`joinResult.js:89-91`) for the
  typed join and for the quiet auto-join alike.
  - It polls `GET /games/{id}` every 5 seconds while `document.visibilityState`
    is `visible`, for up to 2 hours.
  - When `started` flips, it calls `performJoin` with the typed name.
  - When the 2 hours are up, it shows "Still not open — tap to check again".
- **`src/src/PlayerPage.jsx`:** `applyJoinFailure` (`:540-565`) routes
  `not-started` to `NotOpenYet`, in both loud and quiet modes.

**Backend**

- Nothing new. `session-gate.js` and `get-game.js` are unchanged.
  `tests/join-name-collision.js` must stay green: the gate order is the security
  property (`session-gate.js:14-21`).

**Tests**

- `hostControls.test.js`:
  - LOBBY with the doors closed has the primary `open-doors`, enabled even with
    0 players;
  - LOBBY with the doors open is unchanged.
- `sessionHistoryPanel.test.jsx`: an unstarted row shows Preview and Open; a
  started row is unchanged.
- **New** `hostPreviewStage.test.js`, a source contract (the host page cannot be
  driven to a stage in jsdom; see `hostSummaryApproach.test.js`):
  - Create no longer opens the history list;
  - OPEN posts `/start`;
  - step-through reads `up-next` and writes nothing.
- **New** `notOpenYet.test.jsx`, with fake timers:
  - it polls only while visible;
  - it joins exactly once when `started` flips;
  - it keeps the typed name;
  - it stops at 2 hours.
- **New** `notOpenYetPalette.test.js`.
- **Extend** `stageShell.test.jsx` and the stage CSS contract for the preview
  chip and band: no fixed px, and the ladder is honoured.

---

## Phase 3 — the briefing (Call & Answer)

**Assumes:** reports record only which rounds were briefed (§f Q1); no OCR (Q2);
general knowledge only when briefed (Q3); the briefing is fixed once the doors
open (Q4).

**Shared rules**

- **`lambda-functions/game/briefing.js` (new, pure):**
  - `normalizeBriefing(value)`: at most 1,500 characters, trimmed, control
    characters stripped. `null` means clear.
  - `buildDraftPrompt(text)`: the summariser's instructions, as RATIONALE §c
    describes them.
  - `BRIEFING_CAP`.
- Copy `briefing.js` to `lambda-functions/websocket/briefing.js`, because
  create lives there. A guarded-identical assertion keeps the copies equal, the
  way `session-ttl.js` is guarded.
- **`lambda-functions/game/personas.js`:** add `buildBriefingLayer({ briefing })`.
  It returns `''` when there is no briefing. Otherwise it returns the block
  printed on page 40, word for word.

**Read and summarise**

- **`lambda-functions/admin/parse-document.js`:** also return `pages`
  (`data.numpages`) and `truncated`. This is additive, so existing callers are
  untouched.
- **`src/src/utils/documentText.js` (new):** lift `FileUploadPrompt`'s readers
  (`readFileAsText`, `readFileAsBase64` and the parse call,
  `FileUploadPrompt.jsx:49-133`) into one function. `FileUploadPrompt` then uses
  it too, so there is one pipeline.
- **`lambda-functions/game/draft-briefing.js` (new):**
  - Route: `POST /games/briefing/draft`, Cognito, hosts and admins. Check that
    the path matches none of the authorizer's public words.
  - Input: `{ text, fileName, pages, truncated }`, with `text` at most 50,000
    characters.
  - It calls Haiku 4.5 (the inference profile at `get-ai-summary.js:2622`) and
    returns `{ briefing, namesRemoved }`. It stores nothing.
  - Timeout 28 seconds. If the p95 on dev exceeds about 20 seconds, move it to
    the generation-job pattern.
- **`template-clean.yaml`:** add the function, the route and the Bedrock
  permission, mirroring `get-ai-summary`'s. **This is a template change**, so it
  deploys through the pipeline like any other.

**Store**

- **`lambda-functions/websocket/create-game.js`** needs all three edits the
  whitelist comment demands (`:86-91`):
  1. add `briefing` to the destructure;
  2. pass it to `createGame()`;
  3. write `Briefing` on the METADATA item in `schema-compliant-manager.js`
     (`:182-239`).
  - Refuse it unless `gameType === 'call-and-answer'`, and cap it with
    `normalizeBriefing`.
- **`lambda-functions/game/update-game.js`:**
  - add `briefing` to `EDITABLE_FIELDS`;
  - accept it CREATED-only;
  - `null` REMOVEs the attribute, and a value goes through `store()` so it is
    encrypted.
- **Every copy of `tenant-crypto.js`** (game, websocket, admin/shared): add
  `'Briefing'` to `ENCRYPTED_FIELDS.session`.
- **`lambda-functions/game/get-game.js`:** the host branch returns `briefing`,
  decrypted. The public branch never does.
- **`src/src/config/createGame.js`:** `createGameBody` and `updateGameBody`
  carry `briefing`. It is sent only for Call & Answer, and `null` clears it.

**Use**

- **`lambda-functions/game/get-ai-summary.js`:**
  - METADATA is already decrypted (Phase 0).
  - Pass `briefing: metadata.Briefing?.text`, then
    `prompt = … ${hostLayer}${buildBriefingLayer({ briefing })}`.
  - Freeze `BriefingUsed: true` on the AI summary item.
  - Do **not** add the briefing to `contextSections` or `buildContextBlock`.
- **The host stage:** a "Briefing on" chip in `fn-controls`
  (`GameHostPage.jsx` FIELD_NOTES branch). It never shows the file name.

**Dialog**

- **`GameSetupDialog.jsx`:** the briefing section, Call & Answer only, with its
  states:
  - empty;
  - working (read, then write);
  - ready (an editable textarea, the source line, the names-removed count,
    Replace and Remove);
  - limit (over 4 MB, slides, scanned under 200 characters, password,
    truncated);
  - failed (with Try again).
  - Switching format away hides the section and leaves it out of the payload.
    Switching back restores it while the dialog stays open.
  - The edit mode prefill comes from `get-game.js`'s host branch.
- **`GameSetupDialog.css`:** `gsd-brief*`, using the tints and measured ratios
  in `_src/ss-dialog.css`.

**Tests**

- **New** `tests/briefing-prompt.js`:
  - the layer is appended after the host layer and nowhere else;
  - it is absent when there is no briefing;
  - it names the two rules it widens;
  - it contains the four guard lines;
  - it is not inside `contextSections` or `SESSION CONTEXT`.
- **New** `tests/draft-briefing.js`, with a mocked Bedrock client:
  - a fixture carrying two names returns `namesRemoved: 2`;
  - output is capped at 1,500 characters;
  - input over 50,000 characters is refused;
  - nothing is written to the table.
- **Extend** `tests/update-game.js`:
  - `briefing` while CREATED is 200 and encrypted at rest;
  - `null` removes it;
  - a started game returns 400;
  - 1,501 characters returns 400.
- **Extend** `tests/persona-controls.js` (the create path):
  - a Call & Answer create stores `Briefing`;
  - a trivia create with a briefing returns 400;
  - a missing key stores nothing.
- **Extend** `tests/tenant-crypto-wiring.js`: all three copies list `Briefing`.
- **New** or extended get-game test: the host branch has `briefing`; the public
  branch has no `briefing` key.
- **Extend** `tests/parse-document*` (or add one): `pages` and `truncated` are
  present, and truncation still happens at 50,000 characters.
- **Jest:**
  - `gameSetupDialog.test.jsx` covers every briefing state, the format switch,
    and Replace and Remove;
  - **new** `documentText.test.js`;
  - `gameSetupPalette.test.js` covers the periwinkle, amber and danger tints.
- **The measured run.** A new script, `scripts/measure-briefing.js`, runs the
  MTTR fixture (the answers and briefing in `_src/content.py`) five times
  against Haiku on dev. It prints the four checks from RATIONALE §c. Record the
  result in the handoff before the phase is called done, the way game 4567's
  run was recorded.

---

## Phase 4 — only if the owner says so (§f)

- The report prints "What Workie was told" (Q1).
- OCR for scanned PDFs (Q2).
- General knowledge allowed in every Call & Answer session, as a template
  change rather than a briefing permission (Q3).
- Editing the briefing after the doors open, applied from the next round (Q4).
- Private sessions under Advanced (Q7).

---

## Order and size

| Phase | Size | Depends on |
|---|---|---|
| 0 | small; five independent fixes | nothing |
| 1 | medium; frontend only | 0 (the category fix and the edit note) |
| 2 | medium; frontend, no backend | 1 (the dialog renders over the stage) |
| 3 | large; backend, template and frontend | 0 (decrypt, host parse-document), 1 (the dialog's main view) |

Phases 2 and 3 are independent of each other, and either can go first after
Phase 1.
