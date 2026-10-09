# Build Room handoff, 2026-10-06

Where the Build Room work stands at the end of the 2026-10-05/06 session, and what is left.

## Where things are

| | Commit | Has |
|---|---|---|
| Working branch `working/build-room-host-redesign` | `29194a12` | Everything below. It equals `origin/dev`. |
| **dev** | `29194a12` | Everything below. Live, and each deploy was checked on the site. |
| **test** | `10517487` | Up to the "Claude has it" fix only. 17 commits behind dev. |
| **prod** | `42fe1e6f` | None of this work. |

Plugin on dev: **1.10.0** (`src/public/engage-mcp.mjs`). Hosts update it through the Connect panel's
"Check for the latest Engage plugin" step.

## Built this session (all on dev)

- **Host redesign.** One queue (Claude's asks first, then everything else oldest first) with filters, ticks
  and a bulk bar. Ideas can go to a vote. A vote can wait for Claude's mockups, then be marked Ready;
  Open next lines it up behind the open ask. The plan is in `docs/design/build-room-host-redesign/PLAN.md`.
- **What Claude gets (7c).**
  - Four kinds: Do now, Keep in mind, **For Claude, later** (held: nothing reaches Claude until Send now)
    and Ask Claude.
  - The room brief.
  - The queue's "Later" button is now **Park**.
- **Ready questions (7b).**
  - `ClaudeGets` and `ClaudeNote` question columns.
  - Sets tagged `build-room`, with an "In a Build Room" section in the set editor and a library in
    Ask the room. A question the room has already been asked is marked "Asked · ask N".
  - Starter sets in `sets/build-room-*.csv`, **installed on dev only**.
- **History (5)** and the **participants' Now / Ideas / History tabs (7)**, for phones and laptops.
- **Votes.**
  - The wheel can be used wherever the room could vote, and a tie offers a spin or a revote.
  - You can vote for your own idea.
  - The winner is the default; clicking any option asks "Go with the room's choice?" or
    "Pick an alternate?", on the Host screen and the Stage.
  - Claude hears only "Question: answer". How the decision was made is recorded.
  - Rate questions use one fixed scale (1 needs work, 5 is great), and the meaning is added only when the
    decision carries a score.
- **End caps** (`docs/design/build-room-endcaps/PLAN.md`).
  - Start: the Connect panel's command makes `~/build-room/<name>` and runs git init, README and
    DECISIONS.
  - Commits: a hidden snapshot each turn; the `commit` tool makes one commit per decision, and the
    project's own git hooks run.
  - Close: the wrap-up checklist asks before stopping servers.
  - All of it is written down in the `engage:build-room` skill.
- **The opening** (`docs/design/build-room-opening/`: mockups `index.html` O1 to O4, and `PLAN.md`).
  - Nine working-backwards steps fill the brief, and the brief doubles as the path.
  - Step 1 offers ask the room, spin the wheel, or pick for the room.
  - Claude can suggest follow-up questions and draft the brief (`draft_brief`).
  - Start building asks you to confirm, and isn't on the Stage. **Back to the opening** undoes it.
- **Smaller fixes.**
  - Claude asks through Engage, never in the terminal. This was the stall in room 6717.
  - The "Claude has it" label is only shown when Claude really has it.
  - The "Claude Code has stopped" notice offers to copy `/engage:continue`.
  - Back to the main menu: in More, on the wrapped-up bar, and on the ended bar.
  - Menus open on screen.
  - `scripts/install-question-set.js` dry runs no longer write; this fix is on the working branch.

## What is left

### Delivery
1. **Review dev**, then **promote to test**. Test is *merged into*, never fast-forwarded; see the memory
   note "Promoting to test":
   ```bash
   git fetch origin && git checkout -B promote-test origin/test
   git merge origin/dev -m "Merge dev into test: Build Room ..." && git push origin promote-test:test
   ```
2. **Install the starter sets on test.** Sign in first with `aws sso login --profile adminaccess`.
   ```bash
   AWS_PROFILE=adminaccess node scripts/install-question-set.js engagetest sets/build-room-starters.csv --type call-and-answer --title "Build Room starters" --topic business-work --tags build-room --description "Short questions that help a room steer a build." --apply
   AWS_PROFILE=adminaccess node scripts/install-question-set.js engagetest sets/build-room-pulse.csv --type poll --title "Build Room pulse" --topic business-work --tags build-room --description "A 1 to 5 pulse on what the room is building: 1 needs work, 5 is great." --apply
   ```
   Run each once without `--apply` first. It now writes nothing in that mode.
3. **Prod:** prod is a fast-forward of test (`git push origin origin/test:refs/heads/prod`), and it stops
   at the owner's approval gate. Install the starter sets on `engageprod` before approving.

### Still to build
- **The queue.**
  - Room feedback on a preview as its own card (today it is an ordinary idea).
  - Crew items in the queue.
  - "Rate each 1 to 5" in the vote dialog.
- **History.** Link each item to what it led to (idea → vote → decision → screenshot) and store that link
  (`RelatesTo`). Today the path is worked out from the asks. Also a wrap-up side column.
- **The Build screen.** A live preview of the dev server inside the page isn't possible, because an https
  page cannot frame `http://localhost`. It shows the newest screenshot plus "Open the build".
- **People / scores** (step 8). This is waiting on the owner; the options are in
  `docs/design/build-room-host-redesign/scores.html`.
- **The opening.**
  - Check `claude "/engage:connect <key>"` really runs a slash command as Claude Code's first prompt.
    The fallback is to type `/engage:connect` inside the new folder.
  - Phones show no Ideas-tab state for opening steps.
  - The first-run "How a Build Room works" card pushes the opening panel down.
- **The remote** (step 9). Marked later in the plan.

## Running the gate

These all run from the worktree root. The baselines are 286 backend suites, 444 frontend suites, 0 lint
errors and 10 lint warnings.
```bash
for f in tests/*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done   # skip tests/verify-question-set-ui.spec.js
cd src && ./node_modules/.bin/jest --maxWorkers=3 && npm run lint && npm run build
node tests/build-room-copy.js                                               # no emoji in Build Room files
```
- **Plugin version:** every edit to `src/public/engage-mcp.mjs` bumps `VERSION`. `node tests/engage-plugin-version.js`
  prints the new pin to paste into that test.
- **Encryption copies:** the three `tenant-crypto.js` copies (game, websocket, admin/shared) must stay
  byte-identical.
- **Deploy:** a push to `dev` is a deploy. Watch it with
  `AWS_PROFILE=adminaccess aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-dev`.

## Files that matter
- **Server:** `lambda-functions/game/build-room.js` (the handler) and `build-store.js` (the views, the brief,
  the opening, the wheel).
- **Host page:**
  - `src/src/buildroom/BuildRoomPage.jsx`
  - `BuildOpening.jsx`
  - `buildScreens.js` (pure helpers: the queue, the story, pickVerdict, the kinds)
  - `readyQuestions.js`
  - `BuildWheel.jsx`
- **Phones:** `src/src/buildroom/BuildPlayer.jsx`
- **Plugin and skill:** `src/public/engage-mcp.mjs` (`BUILD_ROOM_SKILL` and `CLOSE_STEPS` are inside it).
- **Tests:**
  - `tests/build-room.js`
  - `tests/engage-mcp.js`
  - `tests/engage-plugin.js`
  - `src/src/__tests__/buildRoomPage.test.jsx`, `buildPlayer.test.jsx`, `buildScreens.test.js`
