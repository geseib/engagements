# Follow-up asks: the build plan

For after the owner approves the mockups (`index.html`) and answers the open questions in `SPEC.md` §11. This plan assumes the recommended answers; where an answer would change a task, the task says so. It builds **the smallest version** (SPEC §12): agree and pick-one, one live at a time, dev only behind `FOLLOWUP_ASKS_ENABLED`.

Rules for every task: the test comes first and fails for the right reason; backend suites are `node tests/<file>.js`, judged by exit code and suite count; the frontend runs `cd src && npm test && npm run lint && npm run build`; jest runs on Node 18 in the pipeline, so no Node 20 APIs; async suites arm `tests/helpers/finish-guard.js`; a duplicated file is edited in every copy in the same commit and its drift test extended. Nothing is pushed to a tier branch until the baselines hold.

## Phase 1: pure pieces (no I/O, no UI)

**T1. The beat.** Add `ask` to the closed set: `lambda-functions/game/stage-beats.js` `BEATS` becomes `['results', 'field-notes', 'ask', 'feedback']`; `src/src/config/hostControls.js` `STAGE_BEATS` and `PHASE_FOR_BEAT` (`ask: 'FOLLOW_UP'`) and the phase list; `src/src/config/hostRemote.js` `BEATS_PAST_THE_READ_BACK` gains `ask`.
Test: extend `tests/feedback-round-beat.js` (the copies agree; `resolveBeat('ask') === 'ask'`) and `__tests__/hostRemote.test.js` (no backwards offer out of `ask`).

**T2. The kinds.** `lambda-functions/game/followup-kinds.js` (pure): `KINDS = ['agree', 'choice']` (open added in phase 6), the fixed agree answers `{ yesLabel: 'Agree', noLabel: 'Disagree', unsure: true }`, `normalizeFollowUp(body)` returning `{value}` or `{error}` in words the host can act on (Build Room's `normalizeAsk` shape), `toSurveyQuestion(ask)` mapping agree to a `yesno` question and pick-one to a single-pick `choice`, and `checkValue(ask, value)` using the survey's validation.
Test: `tests/followup-kinds.js`: caps and trims, 2 to 4 options, options frozen once answered, every kind round-trips through `toSurveyQuestion`, an unknown kind refused with a readable error.

**T3. The grounding check.** `lambda-functions/game/followup-grounding.js` (pure): `checkSuggestions(asks, answers, rosterNames)` → kept asks with `marks` (`reworded`, `long`) and a `dropped` count, per SPEC §4.2.
Test: `tests/followup-grounding.js` with the prototype's own outputs as fixtures (`docs/design/ca-followup-asks/prototype/prototype-runs.json`): Haiku r3's backfill statement kept; Sonnet r3's 26-word statement dropped; every choice ask marked reworded; Sonnet r2's 115-character question marked long; a statement carrying a roster name dropped; punctuation and case ignored when copying is judged.

**T4. The numbered answers.** A builder beside `responsesText` in `get-ai-summary.js` (extracted to `lambda-functions/game/numbered-answers.js` so it can be tested alone): ranked order, `n. (p vote points) "…"`, never a name, ties kept in the read's order.
Test: `tests/numbered-answers.js`: no name appears for a named round; numbering matches the read's ranked list.

## Phase 2: the model call

**T5. The prompt file.** `sets/prompt-callandanswer-followups.json` from `prompt-draft.json → followUpAsks` (instructions, tool, max tokens). Not installed yet.
Test: `tests/followup-prompt-shape.js`: every `{variable}` it names is one the builder fills; the tool schema parses; no banned deploy phrase (`tests/` twin guard) in the file.

**T6. The call.** `lambda-functions/game/followup-asks.js`: `suggestFollowUps({ read, answers, task, ... })` builds the prompt, sends it through `claudeRoute.send(bedrock, cmd, { site: 'followup-asks' })` with a forced tool choice and no prefill, reads the `tool_use` block, runs T3, returns the checked list. A missing tool call, a malformed input, or a thrown call returns `{ asks: [], reason }` and logs one structured line (the site, the model, a reason word; never the prompt, never the answers, never the reply).
Test: `tests/followup-asks-call.js` with a stubbed Bedrock client: a good tool call; no tool call; a tool call with junk; a throttle; the 5.5 route's rewrite (forced → `auto`) leaves the call site unchanged. Plus `tests/answer-content-not-logged.js` extended to this file.

**T7. Wire it into the worker.** In `get-ai-summary.js`, after the read is stored and `aiSummaryReady` is broadcast, for a Call & Answer round with `FOLLOWUP_ASKS_ENABLED` on and a non-fallback read: call T6 and write `FOLLOWUP#nnn#SUGGESTED` (sealed, 30-day `ttl`, `ForSummaryAt`), then broadcast `followUpChanged`. A failure here never touches the read.
Test: extend `tests/ai-summary-*.js` harness: flag off writes nothing; fallback read writes nothing; a thrown asks call leaves the stored read byte-identical.

**T8. Measure on dev before any UI** (a gate, not code). Install the prompt on dev only (`scripts/install-ai-prompt.js --apply`), run one Call & Answer session with the agentic SDLC set, and read the `SUGGESTED` rows: does Haiku 5.5 / Sonnet 5.5 call the tool every time, how many asks survive the check, how many are marked. Write the numbers into `PROTOTYPE.md`. If fewer than half the rounds yield one sendable ask, stop and revise the prompt before phase 3.

## Phase 3: storage and routes

**T9. Keys and sealing.** `lambda-functions/game/followup-keys.js` (`FOLLOWUP#nnn#SUGGESTED`, `#ASK#id`, `#ASK#id#A#name`; every prefix ends in `#`, as `comment-keys.js` does). `ENCRYPTED_FIELDS.followup` in all three `tenant-crypto.js` copies.
Test: `tests/followup-keys.js`; the tenant-crypto drift test covers the new entity; a sealed row round-trips.

**T10. The function and its routes.** `lambda-functions/game/followups.js`, one Lambda with a `{proxy+}` family in `template-clean.yaml` (count the stack's resources first; it is near 500). Host routes behind the Cognito authorizer and `callerMayDriveSession`; the two public routes (`live`, `answer`) without. Send refuses outside `RESULTS#nnn` and while another ask is live; send sets the round's beat to `ask`; close freezes the tally with `aggregate`; cancel returns the beat to `field-notes`; every write broadcasts `followUpChanged`.
Test: `tests/followups-routes.js` with a paged in-memory table (`tests/helpers/paged-table.js`): a rival org's host is refused; a second live ask is refused; a closed ask's tally survives its answer rows being deleted; the public `live` read never carries `why`, `FromAnswers` or suggestions.

**T11. Answers.** The public answer route, gated as `comments.js writeComment` is: STATE, a live ask of that round, a `PLAYER#` row, the `ClientId` when stamped. One row per person, overwritten on change, 7-day `ttl`.
Test: `tests/followup-answer-gate.js`: a non-member refused; a wrong `ClientId` refused; a change overwrites; a value of the wrong shape refused; an answer after close refused; nothing reaches `session-count.js`.

**T12. Next round closes a live ask.** `next-question.js` (or wherever the round advances) closes any live follow-up with its tally before moving STATE.
Test: extend the next-question suite.

## Phase 4: the screens

Build from the mockups, and look at them on :8124 before coding (memory: mockups are the design). Every dialog and popover measured at about 660px and 375px, rect against `innerWidth`; `keepOnScreen.js` for anything that floats.

**T13. Words.** `src/src/config/followUpWords.js`: one place for every label, reusing Build Room's strings where the act is the same ("Ask the room", "Show results", "Press Space to …", "Finish the open question first").
Test: a copy test in the style of `tests/build-room-copy.js`: no "Request feedback" left on the last page of the read when the flag is on.

**T14. The dock.** `hostControls.js`: on the read's last page the second button is "Ask the room…" (with the ready count) when the flag is on; on `FOLLOW_UP` live, "Show results" and "Cancel the question"; on `FOLLOW_UP` closed, "Next round" and "Ask another…".
Test: `__tests__/hostControls.test.js` for each state, flag on and off; the two-button maximum holds.

**T15. The drawer.** `src/src/components/FollowUpPanel.jsx` + `.css` (scoped `.fu`, laptop ladder, dusk theme declared on its root, a `*Palette.test.js` per engage-design): the list (F2), the editor (F3), one `requestClose()` for the X, Cancel, Back and Escape.
Test: rendering tests for each state; "Your words" appears when an edited line stops matching; Send disabled until valid; the palette test.

**T16. The Stage beat.** `src/src/components/stage/FollowUpStage.jsx` on the Room ladder: live (F4) and results (F5), counts only.
Test: rendering tests; no percentage sign anywhere in the output.

**T17. The phone card.** In `PlayerPage.jsx`, on RESULTS with the beat `ask`, a `FollowUpCard` that maps the ask through `toSurveyQuestion` and renders the existing `YesNoInput` / `ChoiceInput`; Send; change until closed; the counts after close (F6). Same component on laptops and tablets (F7).
Test: `__tests__/followUpCard.test.jsx`: each kind, change-then-send, the closed view, a socket `followUpChanged` refetch.

**T18. The Host Remote.** Show results, Cancel the question and Next round for a live ask; nothing more in this build.
Test: `__tests__/hostRemote.test.js` for the `ask` beat.

## Phase 5: the report

**T19.** `create-report.js` reads `FOLLOWUP#nnn#ASK#` rows; `RoundReport.jsx` and `GameReport.jsx` gain the Follow-up questions section (F8); the PDF follows.
Test: `tests/session-report-*.js` extended: an ask's counts, origin line and a cancelled ask appear; no name appears in the section for a named round.

## Phase 6: after the first real session

- **T20.** Open asks (`TextInput`, short), with the comments wall's handling for text on the Stage.
- **T21.** The suggestion list and the editor on the Host Remote.
- **T22.** "Redo the read with the follow-up": a counts-only `{followUps}` line in a Redo of the same round.

## Shipping

Dev only, behind `FOLLOWUP_ASKS_ENABLED`, after T19. One real session on dev with the agentic SDLC set, measured (T8's numbers again, plus how often the host edited before sending and how many answered against how many voted). Then the owner's review on test; prod only after it has sat on test (CLAUDE.md deployment rule). Each deploy names its commit and tier.
