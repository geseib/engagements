# Plan: fix the High and Medium findings from the two-event QA drive

**Source:** `docs/qa/2026-09-29-two-event-drive/README.md`. The finding numbers below are that report's.

**Scope:** the 2 High findings (#1, #2) and the 8 Medium ones (#3–#8, #20, #21). Two Low findings ride along because they touch the same code: #22 (goal notice visibility) and #25 (End on an item has no confirmation). Every other Low stays in the report for later.

## Workstreams

Each workstream is one subagent, working in its own git worktree off `dev`. The split follows the files each one touches, so they can run in parallel with few merge conflicts. Each ends with a commit on its worktree branch and a report: what changed, the tests added, and the suites run. **Subagents do not push.** The integrator (the main session) merges all branches into `dev`, runs the full baselines (backend suites, frontend jest, lint, build), and pushes once. That single push is the dev deploy.

| WS | Findings | Area | Main files |
|---|---|---|---|
| A | #1 High | An answer sent while offline is lost | `src/src/PlayerPage.jsx` (`handleSubmitAnswer`), `src/src/WebSocketClient.js` |
| B | #2 High, #25 | Running the day leaves items PAUSED | `lambda-functions/websocket/events/run.js`, `src/src/components/event/EventStage.jsx`, `EventAttendeePage.jsx` |
| C | #3, #20, #22 | Goal on the stage; results rank order; goal notice | `src/src/GameHostPage.jsx` (stage header, results list), `src/src/config/hostControls.js` (goal line) |
| D | #4 | Setting the question order ahead of time is hard to find | `src/src/components/EventItemDialog.jsx` / `EventBuilder.jsx`, the lobby, `components/stage/SessionSetupPanel.jsx` |
| E | #5, #21 | Silent Workie fallback; host controls on the room screen | the What We Heard stage component(s), the ai-summary backend for surveys |
| F | #6 | The wrong dock button is emphasised when the primary is disabled | `src/src/components/HostActionBar.jsx`, `src/src/styles/stage.css` |
| G | #7, #8 | Tablet player layout; wavelength on a laptop | player page CSS and layout only |

## What "done" means for each

- **A.**
  - A player never sees "Submitted" for an answer the server did not receive.
  - When the socket is down, the answer is kept, shown as "Not sent yet, will send when you're back online", and sent automatically on reconnect.
  - A reload doesn't lose it; persisting the pending answer in `sessionStorage` is acceptable.
  - Jest tests cover the `sendCleanMessage → false` path.
- **B.**
  - Going live on another item **ends** the current item (it reads DONE) instead of pausing it. The explicit Pause button still pauses.
  - An **open survey** is the exception, since only closing it freezes its results: going live on another item pauses it. It still reads PAUSED rather than DONE, because a survey cannot be ended while open, and the phones may still see it as paused.
  - The dock's suggested next step is the next unplayed item after the most recent one, never "Resume" on an earlier item. Once nothing is left, it is "End the event".
  - Phones show ended items as done.
  - End on an item row asks for confirmation.
  - Backend node tests and jest tests are updated accordingly.
- **C.**
  - When the session has a goal, the stage header shows it, e.g. "ROUND 1 · GOAL 2 OF 5". Passing the goal by any route (results or skip) shows a visible notice on the stage, not only dock text.
  - The results rows are ordered by the round's points, which is the same order as their 1st/2nd/3rd labels. Ties are broken consistently, and no row labelled Nth ever sits above one labelled N−1.
  - Tests cover both.
- **D.**
  - The agenda item dialog (for trivia, Call & Answer and polls) and the preview lobby offer "Set the running order", which opens the Session panel on its Questions tab.
  - If the item has no prepared session yet, the link prepares it (the same as Open) first.
- **E.**
  - When the ai-summary is the template fallback, the response says so (a `fallback: true` flag), and the host sees "Workie's read didn't run" with Redo.
  - On a closed survey, the "(NEXT QUESTION)" voice and approach menus are hidden.
  - Host-only controls (Voice, Approach, Briefing, Redo) are not drawn on the room-facing stage. They move to the Session panel or the phone remote, or they only appear on a host-marked screen.
  - Tests cover these.
- **F.**
  - When the primary action is disabled, it looks disabled.
  - A Skip secondary is never styled more prominently than the primary.
  - Skip Round and Skip Question keep working with one press.
  - A CSS-contract or jest test covers this.
- **G.**
  - At tablet widths (740–1100px) the player content uses the width, with a readable type size.
  - The wavelength form shows at least four word inputs above the fold on 1280×800.
  - Nothing else in the player layout regresses.
  - Existing CSS-contract tests pass, and new ones are added where the design skill requires.

## Rules for every subagent

- Read `CLAUDE.md`. For any UI or CSS work, load the `engage-design` skill first.
- Match the surrounding code and comment style.
- Run the relevant suites before committing. For the backend, that's `node tests/<file>.js`; see `docs/handoff/events-m2-handoff-2026-09-27.md` "Running the suites" for the undeclared packages, plus `@aws-sdk/client-lambda`. For the frontend, it's `cd src && npx jest <paths>` and `npm run lint`.
- Commit on the worktree's branch with a descriptive message. Do not push, tag, deploy or open a PR.
