# Handoff — Typed polls: a survey question the host asks, live on the wall (27 Sep 2026)

Read `CLAUDE.md` first; its deploy rules at the top are binding.

## What the owner asked for

> "There is a problem with the polls both how AI generator works and how it is presented (usually polls
> make you pick from choices), it seems to be too much like call and answer and the reality is it should
> be a short instant feedback version of the survey items. Should have all the same question mechanisms
> rate, pick from a few choices, binary (default yes/no but could be approve/decline, true/false) and then
> open ended. Any changes to the poll can be applied to survey, except with the poll again the question is
> asked and the options are registered on screen right away. Reuse as much code and endpoints as possible."

> "How can we ask the question and show the options both on player screen and the host screen. Think
> showing the options for poll can be the same one that starts showing the results."

> "For polls and surveys, having the Workie just comment on the results vs what is given about the event
> can be brief but thoughtful and provide insights and actions. Also it could make sense to have the
> ability to provide feedback just like we do for call and answer."

> "In the trivia results, if there are no answers, it's still ok to have Workie comment … if it's going
> in the report."

This is `docs/design/survey-redesign/PLAN.md` "Phase 6", with four kinds instead of five (rank is a
ballot, not a glance).

## How a poll plays now

- **The question model is the survey's.** `POLL_KINDS = ['choice','rating','yesno','text']`,
  `pollFieldsOf`, `validatePoll` in `lambda-functions/{game,admin/shared,websocket}/survey-kinds.js`
  (three byte copies). A row written before this has no `kind`: two or more `options` read as a choice,
  otherwise an open question. There is no data migration; the default applies on read.
- **ASK → RESULTS, no vote.** `hostControls.js` `TYPES_THAT_SKIP_VOTE` has `poll`; `start-vote.js` and
  the legacy socket vote request refuse a poll; anonymity (`game/anonymity.js`, event item settings)
  is Call & Answer only.
- **Phone:** `get-question.js` / `get-game-state.js` send `poll: { kind, …fields }`
  (`game/poll-question.js`). `PlayerPage` draws the survey's own input for the kind
  (`components/survey/*Input.jsx`) and sends `{answer: value, answerType: 'poll'}` over the socket.
- **Answer:** `websocket/message.js` checks the value against the question with the survey's
  `checkAnswer` (`survey-answer.js`, copied into the websocket bundle), refuses anything that is not an
  answer, and stores `Answer` (readable text, `pollAnswerText`) plus `PollValue` (structured). Both are
  in `ENCRYPTED_FIELDS.answer`.
- **Wall:** `components/stage/PollBoard.jsx` — the survey's result renderers at wall scale (`.svw`).
  The options are on the wall the moment the question is asked, at 0%, and fill in live: the host
  refetches `GET /answers/host` on each `playerAnswered`, which now returns
  `poll: { question, tally }` (`game/poll-round.js` `pollTally` = the survey's `aggregate` over the
  round's `PollValue`s). At RESULTS the same board stops moving.
- **Results:** `get-results.js` `handlePollResults` — no vote, no points; the `QUESTION#nnn#RESULTS`
  row keeps counts only (`PollCounts`), the open words stay in the encrypted answer rows.
- **Workie:** a poll round keeps the round machinery, so "What We Heard" and the feedback step apply as
  for Call & Answer. `get-ai-summary.js` gives the model the tally in the question's own words
  (`describePollTally`). The three poll prompts in `admin/default-ai-prompts.json` were rewritten:
  What the Room Said / What It Means (for the session's aim) / Next Steps, brief, counts only as printed.
  **They take effect only after reseeding:** `POST /admin/populate-defaults` with overwrite (names were
  kept, so sets stay attached).
- **Trivia and polls with no answers** now get a short Workie comment (the server no longer refuses; the
  host triggers it). The trivia prompts' empty-round rule now says: nobody answered, then the correct
  answer and its explanation, where the game stands, a light fact or joke only if the host's
  instructions ask. Same reseeding caveat.

## Authoring (merged from wip/typed-polls-authoring)

- Import: a poll CSV with a `Kind` column is read like a survey row (`validatePoll`), keeping its own
  Category; a rank row is skipped ("a poll can't be a rank question"). Legacy poll CSVs import as before.
- Download and the poll template write the survey's columns; a legacy set downloads with kinds filled in.
- Editor: a poll question is `SurveyQuestionFields` with `kinds={POLL_KINDS}`. Yes/no fields have
  presets — Yes/No (blank), Approve/Decline, True/False, Agree/Disagree — for surveys too.
- `sets/new/poll-how-we-work.csv` is now a typed set (5 choice, 2 rating, 2 yes/no, 1 open).

## Verified

- Backend: `tests/typed-polls.js` (26) and the updated contract suites; the full loop.
- Frontend: `pollBoard.test.jsx`, `playerTypedPoll.test.jsx`, and the suites that pinned polls as a
  voting type (moved to Call & Answer where they only needed "a voting type").
- End to end in Chromium against the real handlers (a local stack routed from `template-clean.yaml`
  over `tests/helpers`' fake DynamoDB and KMS, with a WebSocket bridge): host plus two phones, a choice,
  a rating, an Approve/Decline and an open question — options on the wall at once, bars filling live,
  each phone's own control, results, What We Heard, next poll. The host screen fits at 1280×720.

## Still open

- Survey Workie and feedback (pseudo-round `000`) — see the survey worker's branch/notes below.
- The editor's question preview (`QuestionCard`/`questionPreview`) does not draw poll kinds yet.
- The Names setting for polls (PLAN.md Phase 6) is not built; poll answers are shown without names.
