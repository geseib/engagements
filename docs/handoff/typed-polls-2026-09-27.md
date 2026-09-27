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

## The AI generator (merged from wip/typed-polls-ai)

- `admin/ai-generate-polls.js` takes `kinds` (any of the four; none means all) and writes typed
  questions: one idea each, 2–5 options that read at a glance, scale ends that mean something, a binary
  whose two words fit, and open answers only where the room's own words are the point. An item with
  neither a kind nor options is dropped. It is never turned into a text box, which was the bug the
  owner saw ("a medium Poll item … didn't give options but an open text box").
- `admin/shared/kind-generation.js` holds the kind fields' schema and repairs. The survey generator
  (refactored onto it, output unchanged), the poll generator and the one-question drafter
  (`ai-generate-questions.js`) all use it.
- `shared/generated-set.js` `pollsToCsv` and `src/src/utils/pollDraft.js` `pollItemsToCsv` write the
  survey contract's columns, and `pollDraft.test.js` holds them byte-identical.
  `PER_ITEM_TOKENS.poll` is now 690.
- `PollAIBuilder`: a kinds picker replaces "Allow multiple selections"; the review table has a Kind
  column; the editor is `SurveyQuestionFields` with the four poll kinds (no Ranking).

## Ask next vs Ask now (#29, merged from wip/ask-next-queue)

- **Ask next** puts the question at the head of the queue. It is a new `first` op on the existing
  `POST /games/{id}/queue` (`queue-order.js`, mirrored in `config/questionQueue.js`), and the round
  on screen is untouched.
- **Ask now** is the old jump (`next-question` select). On the stage it confirms mid-round; on the
  phone it arms with "Tap again to ask now".
- The phone remote's Questions tab mounts the stage's own `QueueList` (`variant="touch"`) over the same
  queue and `GET /up-next`, so the remote shows the same running order as the host screen.

## Verified

- Backend: `tests/typed-polls.js` (26) and the updated contract suites; the full loop.
- Frontend: `pollBoard.test.jsx`, `playerTypedPoll.test.jsx`, and the suites that pinned polls as a
  voting type (moved to Call & Answer where they only needed "a voting type").
- End to end in Chromium against the real handlers (a local stack routed from `template-clean.yaml`
  over `tests/helpers`' fake DynamoDB and KMS, with a WebSocket bridge): host plus two phones, a choice,
  a rating, an Approve/Decline and an open question — options on the wall at once, bars filling live,
  each phone's own control, results, What We Heard, next poll. The host screen fits at 1280×720.
- The same stack now serves the shipped prompts (populate-defaults over an in-memory S3), a canned
  model reply and the summary's self-invoke, so What We Heard runs the real pipeline. Three drives,
  all green at the push: the typed poll (6), the event day (14), and a survey in an event (9): two
  phones answer four kinds, the host closes it, What We Heard, Request feedback, a nameless comment on
  the wall, back, end, and the dock swept from 1000 to 1920 wide.

## A closed survey: What We Heard and feedback (merged from wip/survey-workie-feedback)

- A survey has no rounds, so its read and its feedback ride the round machinery at pseudo-round
  `000`. On close the stage keeps the frozen counts and the primary becomes **What We Heard**. The
  last page offers **End the session** and **Request feedback**; the feedback wall has **End the
  session** and **Back to What We Heard**.
- `get-ai-summary.js` reads the survey whole from its FROZEN results (`survey-host.js`
  `surveyResultsPayload`, described per question by `game/survey-digest.js` as the new
  `{surveyResults}` variable). It returns a 409 before close and a 400 for any round but `000`, and no
  name reaches the prompt. A new default prompt, **"Survey Read-Back - What We Heard"**, needs the
  same reseeding; until then a survey gets the plain built-in summary stating its respondent count.
- `comments.js` takes comments on `000` only while the survey is CLOSED, and strips the name from
  every survey comment (the composer says so). The report gets a "What we heard" section above the
  survey charts. The phone's feedback round is `kind: 'survey'`, so `RoundReport` titles its rows
  "Results by question" with no "Response N" author beside them.

## Stage fixes found driving it

- **Dock in an event:** AGENDA beside SESSION ran the feedback beat's dock 12–148px past the edge
  from 1150 to 1440 wide (SESSION clipped at 1280×720). In an event the key hints go sooner, and
  `Dock.jsx` measures itself: if the row still overflows it wraps (`data-crowded`). Swept 1000–1920.
- **Workie points on the stage** ran their lead into the text ("Most of the room answeredthe
  counts"). `MarkdownRenderer` drops the colon for the old big-screen notes to stack; the stage now
  puts it back (`.notes-md .md-lead::after`).

## Still open

- The editor's question preview (`QuestionCard`/`questionPreview`) does not draw poll kinds yet.
- The Names setting for polls (PLAN.md Phase 6) is not built; poll answers are shown without names.
- Pre-existing, found by the survey worker: on a round-type feedback round the phone is sent the
  report's shape (`questionData.title`, `answerText`) while the panel reads `title` and `answer`, so
  titles and response texts can come up blank on phones. The survey round sends both shapes.
- Template variables tagged for surveys (responses, votes, scores) are always empty for a survey
  read; their tags want re-checking.
- Settings → Rounds lists a survey's read as "Round 000".
