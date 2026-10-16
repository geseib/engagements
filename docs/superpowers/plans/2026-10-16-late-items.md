# Late Items (Session Flow v3, Phase 5, steps 2–5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Nothing that arrives late is lost. Late answers to a question for the room, comments after the round, and late round answers (step 1, already on dev) all carry a review label. The host sees them in one list and can show or mark them, and the report lists them under "Arrived late".

**Architecture:** Two kinds of late item are new rows: a late ask answer (`FOLLOWUP#nnn#ASK#<id>#LATE#<player>`) and an added-later comment (an ordinary comment row with `AddedLater`/`PostedDuring`). A third kind, the late round answer (`QUESTION#nnn#LATE#<player>`), exists since dev `50d99636`. All three gain `Reviewed: 'shown'|'read'|null` and `ReviewedAt`. Two host routes on the existing comments function (no new Lambda; the stack is near its resource limit) read and review them. The host sees them in the console's "Late & not reviewed" rail section on two screens, and in the Session panel's Rounds tab on one screen. The report lists them per round, inside the round rows.

**Tech Stack:** AWS Lambda (Node), DynamoDB single table, SAM `template-clean.yaml`, React (CRA).

**Spec:** `docs/tests_and_reviews/oct13-14 review/RECOMMENDATIONS.md` §4.4 (lines ~226–275), §4.5 "Include items not reviewed", and §7 as answered by the owner:
- **Q4:** comments stay open until 24 h after the session ends, with a host "Close comments" button. Late round answers are accepted only while the session runs.
- **Q5:** late answers are listed beside the read, not in it. Redo includes them and says so.
- **Q13:** in rounds that hid names, late items read "Response N".
- **Q14:** participants never see review labels.

## Global Constraints

- Labels, exactly as the owner wrote them: **"Not reviewed"**, **"Reviewed with the room"** (shown on the wall), **"Reviewed by the host"**. They appear to the host and in the report only, never on a phone or the wall (Q14).
- A late item is never added to votes, scores, tallies, the frozen ask count, Workie's read (unless the host presses Redo, Q5), or billing (`session-count.js`).
- Late round answers are accepted only while the session runs. Late ask answers and comments are accepted until 24 h after ENDED, unless the host pressed "Close comments" (Q4).
- No new Lambda function. The two new host routes go on the comments function: `GET /games/{id}/late` and `POST /games/{id}/late/review`. Both use Cognito plus `callerMayDriveSession`, and answer 404 to anyone else. Closing comments is the same POST with `{ kind: 'comments', how: 'close' }`; that avoids a third route and so a third set of resources.
- Encrypt like the parent row: a late ask answer as the ask-answer entity, comments as now. Any new encrypted field goes into all three `tenant-crypto.js` copies identically.
- ttl: 30 days on new late rows, as comments have.
- Names follow the round's Names setting (`isHidden` in create-report.js); in hid-names rounds a late item reads "Response N" (Q13).
- Words: plain, sentence case, "phone, laptop or tablet". Host words go in `config/followUpWords.js` or a new `config/lateWords.js`.
- Phone replies, verbatim from the spec:
  - Ask answer after results: "The results are already up. Your answer is kept, but not in the count."
  - Comment added later: no special phone text needed beyond the usual receipt.
- Gates before every dev push: all `node tests/*.js` (clear `.aws-sam`; skip `verify-question-set-ui.spec.js`), `cd src && CI=true npx jest`, `npm run lint` (0 errors), `npm run build`.
- Before the push to test: RELEASE_NOTES.md, help and README (CLAUDE.md, "Before every push to test").

## Review Focus

1. **A player sends an ask answer twice, once on time and once late.** Only the on-time one is kept; the late one is refused as a change (spec §4.4 edge cases).
2. **A comment arriving 23 h vs 25 h after ENDED, and after "Close comments".** 23 h is accepted and labelled added later; 25 h and after Close are refused with a plain message.
3. **Someone who is not the host calls `GET /late` or `POST /late/review`.** They get 404 and see nothing, including on another org's session.
4. **A hid-names round.** The late list and the report show "Response N" and never a name.
5. **"Include items not reviewed" off.** The report leaves out not-reviewed comments and late items, and says how many it left out.

## Tasks

### Task 1: Late answers to a question for the room (backend)
**Files:** `lambda-functions/game/followup-store.js` (add `writeLateAnswer`), `lambda-functions/game/followups.js` (the answer route: where it refuses after close or results, accept late instead while the window allows), and a new test `tests/late-ask-answers.js`.
- Row: `FOLLOWUP#nnn#ASK#<id>#LATE#<player>` holding Answer, Kind, ArrivedDuring, SubmittedAt, ttl 30 d, `Reviewed: null`. It sits outside the frozen tally and never changes counts.
- For Ideas, the late reply joins the host's idea list marked `late: true`. It must not enter a frozen `Ideas` record already written.
- The reply to the phone says it was kept but is not in the count; the phone shows the spec's sentence. Find how the phone gets the ask reply today and add `late: true`.
- Tests: on-time then late from the same player → late refused; late after results → kept, no count change; after ENDED + 24 h → refused; after "Close comments" → refused.

### Task 2: Comments after the round (backend)
**Files:** `lambda-functions/game/comments.js` (`writeComment` gate), and a new test `tests/comments-after-round.js`.
- Accept when the round has been shown: the `ROUND#nnn` row exists and the state is `RESULTS#nnn`, a later round, or ENDED within 24 h and not closed. Store `PostedDuring: state.State` and `AddedLater: true` when the room was elsewhere. The membership check is unchanged.
- "Close comments": the session gets `CommentsClosedAt` on METADATA, written by the Task 3 route. After it, late ask answers and comments are refused with "Comments are closed for this session."
- Tests: a comment during RESULTS#001 is not added later; one during ASK#002 about round 1 is added later; ENDED at 23 h is accepted; at 25 h refused; after close refused.

### Task 3: Review state and the host routes
**Files:** `lambda-functions/game/comments.js` (two handlers), `template-clean.yaml` (two routes on the existing comments function, with the same authorizer and CORS as its other host route), a `tests/template-routes` check if the repo has one for routes, and a new test `tests/late-review.js`.
- `GET /games/{id}/late` returns `{ rounds: [{ round, roundNoun, items: [{ kind: 'answer'|'askAnswer'|'comment', ref, round, text, label, arrivedAt, arrivedDuring, author|null, reviewed: null|'shown'|'read' }] }], counts: { notReviewed } }`. Names follow the round's Names setting (Q13): when hidden, `author: null` with `label: 'Response N'` where a response number applies.
- `POST /games/{id}/late/review { kind, round, ref, how: 'shown'|'read' }` sets `Reviewed`/`ReviewedAt` on that row. `{ kind: 'comments', how: 'close' }` sets METADATA `CommentsClosedAt`. Either way it broadcasts `lateChanged` to hosts.
- Putting an item on the wall: comments reuse the comment feature route; Ideas reuse the Ideas pick; a late round answer has no wall view today, so for it "Show on the wall" is not offered (rule it and say so in the report). Showing an item on the wall also sets `Reviewed: 'shown'`.
- Tests: Review Focus 3 (404 for a non-host and for another org); the counts; Review Focus 4 (hidden names); closing.

### Task 4: The host sees the late list
**Files:** `src/src/config/lateWords.js` (new), `src/src/components/LateList.jsx` (new; the list with "Show on the wall" and "Mark reviewed"), `src/src/GameHostPage.jsx` (fetch `/late` on load, on `lateChanged` and `lateAnswerKept`, after a comment lands), the console rail's Late section (`ConsoleRail.jsx`: items and count from props; its "Review them" link opens the list), the one-screen Session panel's Rounds tab (`SessionSetupPanel.jsx`: the same LateList under a "Late & not reviewed" heading), the status line, and tests.
- Status line: add "· 1 late answer kept" (or "· N items not reviewed") to the step's status. At ENDED: "2 items not reviewed · Review". The main button stays "Open session report".
- Kinds read "Late answer", "Late answer to a question", "Comment added later". The labels are the owner's three.
- Words test as `consoleRail.test.js` does. No phone, wall or Present file may import LateList or lateWords (source-scan test, Q14).

### Task 5: The report's "Arrived late" and "Include items not reviewed"
**Files:** `lambda-functions/game/create-report.js` (per round `late: { answers, askAnswers, comments }` with labels; written inside the round entry so it lands in `REPORT#R#nnn`), the report components (`GameReport.jsx`, `RoundReport.jsx`, and `ReportFollowUps.jsx` for ask answers), a session setting `IncludeNotReviewed` (default on) in the Settings tab with its words, and tests.
- The heading is "Arrived late". Each item carries its label. When the setting is off, not-reviewed comments and late items are left out and a line says how many: "2 comments not reviewed are left out of this report, at the host's choice."
- Q5 Redo: when the host presses Redo on Workie's read, include late round answers and add the line "Includes N answers that arrived late." Find get-ai-summary's input assembly; when the request is not a Redo, late rows stay out.

### Task 6: Notes, help, README, and the walk
- RELEASE_NOTES.md gets a new top entry (New, Fixed, What to look at, Known gaps).
- Host help: the late list and Close comments. Player help: comments after the round, and the late ask answer reply.
- README if needed.
- Push to dev and walk on dev with the bot: a late round answer, a late ask answer, a comment after the round, Show on the wall / Mark reviewed, Close comments, and the report. Then test with a review tag.
