# Build Room: one main button, one place, one vocabulary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Batches 2 and 3 of the 2026-10-08 consistency review in the Build Room: the main button is always the right-most in a pinned action row, only one is orange at a time, every act has one word, and everything held back lives in one Later list.

**Architecture:** Frontend only. One words file (`src/src/buildroom/words.js`) becomes the single source of button and list labels; a test fails if a retired word returns. The Host ask path, the Composer, the Stage dock and its window, the Queue/Parked panel and the brief's "For Claude, later" section are reworked to the mockups. The server keeps its data shapes (Queue items with status `later`, the brief's `later` list, kind `later` on decide) — the one Later list is a merged VIEW of the two.

**Tech Stack:** React (CRA), jest + RTL, plain node scripts in `tests/`.

**Spec:** the mockups `docs/design/build-room-batch-2-3/index.html` (B1-B6) ARE the design — build from them. Background: `docs/design/ux-consistency-review-2026-10-08/review.md` (P1, P3, F1, F2, F3, F8, F11, F12, F16, F27).

## Global Constraints

- Owner rulings 2026-10-08 (binding, they override the mockup where they differ):
  - F3: a clear winner is sent in ONE press — "Send B to Claude" — with "Change before sending" beside it, on the Host ask path AND the Stage.
  - F8: ONE list named "Later" holds parked room ideas and directions held for Claude. The only way in is the "Save for later" button. "Later" is NOT a choice in "Claude gets it as" (three kinds shown: Do now, Keep in mind, Ask Claude). The server's `later` kind stays accepted (old clients, the plugin).
  - A room idea saved for later tells its author — the participant's idea status already reads "Saved for later" (`BuildPlayer.jsx` IDEA_STATUS.later); keep it.
  - Tie re-vote keeps the word "Vote again" (one exception to the table; "Ask again" means edit and re-ask the whole question).
- Copy: laptops, tablets and phones, never phones only. No emoji in `src/src/buildroom/` (↗ is allowed). Orwell's rules.
- Design: `.claude/skills/engage-design/SKILL.md` — tokens, `.brm-` selectors, ≥12 px host text, X + bottom exit on dialogs, Esc closes; popovers use `useKeepOnScreen`. Measure every changed surface at ~660 and 375 px.
- Focus contract (`useNextFocus.js`): the step's primary keeps `data-next-primary`; no focus moves while typing; a dialog defers. Space never sends at the Change step (Ctrl/Cmd+Enter does); Space at Settle-with-winner presses "Send B to Claude" (the one-press ruling) — the line under the board says what Claude will be told.
- Gates before push: from `src/` `./node_modules/.bin/jest --maxWorkers=3`, `npm run lint` (0 errors), `npm run build`; from the root the backend loop `for f in tests/*.js; do case "$f" in *verify-question-set-ui.spec.js) continue;; esac; node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`, `node tests/build-room-copy.js`, `node tests/no-retired-twin-references.js`. A push to `dev` deploys dev.

## Review Focus

1. **Space at Settle with a clear winner now SENDS** (it used to move to step 4). It must never fire while typing, with a dialog open, or while the wheel turns; the line under the board must name exactly what goes.
2. **A wheel that lands** offers Send B to Claude only after it stops ("The wheel is turning…" while it turns), as today.
3. **Saving a room idea for later and later sending it** — the item leaves Later, appears in History, and the author's status follows ("Saved for later" → "Sent to Claude").
4. **Old data**: decisions already held with kind `later` show in the Later list as directions and can be sent; nothing in History breaks on them.
5. **375 px Host header**: Main menu stays visible, extras move into ···, no sideways scroll.

---

### Task 1: The words file and the vocabulary (B6), wheel words, Main menu in the header (B5), one Send icon

**Files:** Create `src/src/buildroom/words.js`, `src/src/__tests__/buildWords.test.js`. Modify `BuildRoomPage.jsx` (header ~1290 More menu, ended/wrapped bars ~790-810, every Send icon use), `buildScreens.js` (wheel labels ~233/254), `BuildAskPath.jsx` (wheel labels), `BuildRoom.css`. Extend `tests/build-room-copy.js` with the retired-word check.

**Interfaces produced:** `words.js` exports a frozen `W` object, e.g. `W.send(label) => \`Send ${label} to Claude\``, `W.change = 'Change before sending'`, `W.saveLater = 'Save for later'`, `W.later = 'Later'`, `W.spin = 'Spin the wheel'`, `W.spinAgain = 'Spin again'`, `W.voteAgain = 'Vote again'`, `W.askAgain = 'Ask again'`, `W.mainMenu = 'Main menu'`, `W.liveBuild = 'Open the live build ↗'`, plus every other row of the B6 table. Later tasks import from here; no new label literals in buildroom files.

- [ ] Step 1: failing tests — `buildWords.test.js` pins the B6 words; `tests/build-room-copy.js` fails if any retired word from B6 appears in `src/src/buildroom/*.jsx|js` ("Queue it", "Park", "Go with", "Spin instead", "Spin the wheel instead", "Back to the main menu", "For Claude, later" as a button/heading, …) — read B6 for the full list, exclude comments.
- [ ] Step 2: run, see them fail.
- [ ] Step 3: implement: words.js; wheel labels; Main menu (house icon) at the far left of the host header on every screen and state, removed from ··· and the ended/wrapped bars; at ≤480px the join code, ask pill, live build, Wi-Fi and Claude status move into ··· (B5a); paper-plane is the one Send icon.
- [ ] Step 4: full gates. Step 5: commit.

### Task 2: The Host ask path and the Composer (B1, B2)

**Files:** Modify `BuildAskPath.jsx`, `buildScreens.js` (`askPathStep`, `askPathSummaries`), `BuildRoomPage.jsx` (Composer/SendToClaude ~2660-2760, the Send step ~2380), `BuildRoom.css`. Tests: `buildAskPath.test.jsx`, `buildScreens.test.js`, `buildRoomPage.test.jsx` or a new page test.

**Behaviour:** per B1a-d and B2:
- Action row: primary right-most, secondaries to its left, ghosts left of those; pinned to the bottom of the open step body; a hint slot at the row's left ("Press Space to …" in words; a confirmation replaces it after a press). Finished steps fold above; steps to come are one line ("Next: 3 Settle · 4 Send to Claude").
- Settle, clear winner: Spin the wheel · Change before sending · **Send B to Claude** (primary, Space). A line under the board says what Claude will be told (the default direction and kind). Send posts the same body as Task-3-of-yesterday's `decideBody` with the room's choice and default direction.
- Settle, tie / no votes: Vote again · **Spin the wheel**. Wheel landed: Spin again · Change before sending · **Send B to Claude**.
- Change before sending (step 4): the direction and the three kinds (Do now, Keep in mind, Ask Claude); Record only · Save for later · **Send B to Claude** (Ctrl/Cmd+Enter; Space never sends here). The extra on/off switch labelled "Send to Claude" is removed.
- Composer: its Send is outline (secondary) whenever an ask path step or a What's next lead shows; "Queue it" becomes "Save for later".
- Exactly one orange button on the Host screen at any time — add a test that counts primaries per state.

- [ ] Steps: failing tests (each state's buttons in order, row pinned class, one-primary count, Space at winner sends once and never while typing / dialog / wheel turning, Change step Space does nothing) → fail → implement → full gates → commit.

### Task 3: The Stage (B3)

**Files:** Modify `buildScreens.js` (`stageModel` labels), `BuildRoomPage.jsx` (BuildStage dock), `BuildStageDecide.jsx` (title "Change before sending"; footer Close · Discard · Ask again… left, Save for later · Send B to Claude right; kinds without Later), `BuildRoom.css`. Tests: `buildStageDecide.test.jsx`, `buildScreens.test.js`, `buildLiveBuild.test.jsx`.

**Behaviour:** dock at results: Change before sending · **Send B to Claude** · "Press Space to send" — the same words as the Host. "Open the live build ↗" leaves the button row and becomes a small link under the dock status ("Open the build in a new tab"). The other dock moments (B3b) use the B6 words.

- [ ] Steps: failing tests → fail → implement → full gates → commit.

### Task 4: One Later list (B4)

**Files:** Modify `BuildRoomPage.jsx` (Queue's Parked section ~3060-3140, the brief's 'For Claude, later' section ~1394, What's next lead), `BuildWhatsNext.jsx` / `buildScreens.js` (`whatsNextMoves`: put-to-a-vote lead from Later), `BuildRoom.css`. Create `src/src/buildroom/BuildLater.jsx` if it keeps BuildRoomPage smaller. Tests: new `buildLater.test.jsx`, `buildScreens.test.js`.

**Behaviour:** per B4a: one "Later" list on the Host screen merging (a) Queue items with status `later` ("Idea from the room", with where it came from) and (b) `room.brief.later` items ("Direction for Claude"), newest first. Each item: Remove · Ask the room · **Send to Claude now** (ideas: the existing promote-to-Claude / promote-to-ask calls; directions: the existing send-later / brief edit calls — read how each is done today and reuse). Ticking 2-6 items offers "Put to a vote", and What's next leads with it. Every "Park" / "Queue it" / "For Claude, later" save path is "Save for later" and lands here. The Stage shows nothing from Later; History shows an item only once it leaves Later. The author's idea status stays "Saved for later" (no server change).

- [ ] Steps: failing tests (merge + tags, each action calls the right existing API, put-to-a-vote with 2-6 ticks, old `later`-kind held decision shows as a direction and sends) → fail → implement → full gates → commit.

### Task 5: Gates, push to dev, walk

- [ ] All gates; push `HEAD:dev`; watch `engagecicd-pipeline-dev`; walk room 4443 on dev: Host ask path through Collect → Settle (winner, Space sends) → History; a tie path; Change before sending; the Stage dock words and the demoted live-build link; Save for later from the Composer and from a Queue idea, then Send to Claude now from Later; the header at 375 px. Measure every window at 660 and 375 px.
