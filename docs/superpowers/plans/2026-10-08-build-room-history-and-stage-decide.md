# Build Room: a past ask, the mockup viewer, and deciding on the Stage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** History opens any decided ask into a window with its choices, result, pick and what Claude was told; one mockup viewer with a Back that returns where it was opened; and the host decides from the Stage (To Claude, Edit with Send / Save for later / Re-ask / Discard) without going back to the Host screen.

**Architecture:** One new server action (`reask`) on the existing ask route. Two new front-end components (`BuildAskDetail.jsx` for the past-ask window, `MockupViewer.jsx` for the viewer and its open/back state) and a Stage decide window that wraps the existing `DecidePanel`. A small `viewer` state in BuildRoom records where a mockup was opened from, so Back returns exactly there.

**Tech Stack:** Node 18 Lambda (CommonJS) + React (CRA), jest, plain node test scripts.

**Spec:** the approved mockups `docs/design/build-room-history-and-stage-decide/index.html` (R1-R5). Owner, 2026-10-08: "when in history can we expand each item ... a modal would pop up with the visual of the choices and the result + the one picked. the show of the mockups ... contained by a button to go back to previous view (history if looking from there, build screen if viewing from there ... host screen ...). it should be super easy to quickly go back and forth between choices on the mockup". And: "on the stage mode (the word space is weird still it looks like a button not instructions) ... keep eyes here when possible. so 'to claude' would just send it. edit would bring up the modal offered at the host screen where you could pick between them, or edit before clicking send or save it for later, discard, or reask ... reask lets you edit before reasking".

## Global Constraints

- History and the Stage are projected: room-safe only — no player names, no host notes, no ClaudeNote.
- Copy: laptops, tablets and phones, never phones only. No emoji in `src/src/buildroom/`.
- Design: `.claude/skills/engage-design/SKILL.md` — tokens only, `.brm-` selectors, nothing below 12 px on host surfaces, every dialog has an X and a bottom exit, Esc closes; popovers use `useKeepOnScreen`; measure every new window at about 660 px and 375 px.
- Focus contract (`src/src/buildroom/useNextFocus.js`): no focus moves while typing; a dialog defers, never cancels.
- Space on the Stage at results sends the room's choice (owner approved R3). Space never fires while a dialog is open or a field has focus.
- Gates before push: from `src/` `./node_modules/.bin/jest --maxWorkers=3`, `npm run lint` (0 errors), `npm run build`; from the root `for f in tests/*.js; do case "$f" in *verify-question-set-ui.spec.js) continue;; esac; node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done` and `node tests/build-room-copy.js`. A push to `dev` deploys dev.

## Review Focus

1. **Re-ask on a live or voting ask** (the host edits before results): it must close the old ask first, and never leave two open asks.
2. **The viewer opened from the Stage Edit window**: Back returns to the Edit window with the pick and the typed direction intact.
3. **An ask with no mockups** (Ideas, a rating, a choice without pictures): History's window and the Stage Edit window still work; "view mockup" never appears for an option without a picture.
4. **To Claude on the Stage on a tie or with no votes**: not offered (Spin the wheel leads); Space does nothing harmful.
5. **History opened on a decided ask whose direction was held as For Claude, later and not yet sent**: says so ("Held for Claude, not sent yet"), never "Claude was told".

---

### Task 1: Server — re-ask an ask with edits

**Files:** Modify `lambda-functions/game/build-room.js` (the ask action router, near `WHEEL_ACTIONS` ~428 and the revote branch ~490-520). Test: `tests/build-room.js` (new section).

**Behaviour:** `POST build/asks/{askId}` `{ action: 'reask', prompt, detail?, options? }` (host only). Works on an ask that is `live`, `voting` or `results` (refuse `decided`, `discarded`, `proposed` with 409 and a sentence). It creates a new live ask of the same kind with the edited prompt/detail/options (normalised exactly as `createAsk` normalises; options keep their `imageId` when their label is unchanged), makes it current (closing any other open ask as `makeCurrent` does), and marks the old ask `Status: 'results'` (if it was open) with `RevotedAs: <newAskId>` — the same field the tie revote writes, so History and WheelPanel already say "Voted again as ask N". Log entry: kind `ask`, by `host`, text `Asked again: <prompt>`. Answer `{ ask: <new askView> }`.

- [ ] **Step 1: failing tests** in `tests/build-room.js`: reask a results-state choice ask with an edited prompt and an added option C → 200; the new ask is current and live with three options; A and B keep their imageIds; the old ask has `revotedAs` equal to the new id; reask a live ask → the old one is closed (status results) and only the new one is open; reask a decided ask → 409; Claude (agent role) cannot reask → 403. Read how the suite seeds an ask with option images (search `imageId` in tests/build-room.js) and copy it.
- [ ] **Step 2: run, see them fail.** `node tests/build-room.js; echo $?`
- [ ] **Step 3: implement** (reuse `S.normalizeAsk`, `makeCurrent`, `touchState`, `announce`, `logEntry`; read the revote branch and share its "old ask points at the new one" write).
- [ ] **Step 4: run** `node tests/build-room.js` and every backend suite (the loop in Global Constraints) — no FAIL.
- [ ] **Step 5: commit.** Add the client call in `src/src/buildroom/buildHostApi.js`: `reask: (askId, body) => post(\`asks/${seg(askId)}\`, { action: 'reask', ...body })` (in the same commit).

---

### Task 2: History's past-ask window and the mockup viewer

**Files:** Create `src/src/buildroom/BuildAskDetail.jsx`, `src/src/buildroom/MockupViewer.jsx`, tests `src/src/__tests__/buildAskDetail.test.jsx`, `src/src/__tests__/mockupViewer.test.jsx`. Modify `src/src/buildroom/BuildRoomPage.jsx` (`HistoryScreen` ~1611, `StoryItem` ~1581, `BuildScreen` ~1540, the Host path's option tiles and queue mockup tiles where `BuildImage` shows an option picture ~1796/1810, BuildRoom state), `src/src/buildroom/BuildRoom.css`.

**Interfaces produced:** `<AskDetail ask room onClose onViewMockup(label) />`; `<MockupViewer ask startLabel backLabel onBack />`; BuildRoom state `viewer = { askId, label, from: 'history'|'build'|'host'|'stage-edit', backLabel }` with `openViewer(askId, label, from)` and `closeViewer()`.

**Behaviour (R1, R2):**
- In History, every decided story item for an ask (and every row in "Decided so far") is a button that opens `AskDetail` as a Modal: eyebrow `Ask N · <Kind> · decided h:mm`; the question; for a choice ask, one card per option (picture if `imageId`, letter, title, bar, count; the pick outlined with the Task-1-of-host-flow `askPathSummaries` settle wording, e.g. "Picked · the room's choice, 7 to 4"); for an Ideas ask, the ideas with their votes, the picked one marked; for a rating, the average and the 1-5 spread. Then the "Claude was told" box: the decision's direction text, its kind label (`claudeKindLabel`), the sent time; if it was held as For Claude, later and not yet delivered, "Held for Claude, not sent yet". Then the chain (`decisionChain`). Footer: "Click a mockup to look closer." and Close. Room-safe: no names, no host notes.
- Clicking a picture opens `MockupViewer` (R2): fills the screen (a Modal styled full-bleed), a Back button whose label names the origin ("Back to Ask 4", "Back to the build", "Back to the Host screen", "Back to Send to Claude"), the question, one tab per option that has a picture (the picked one says "picked"), ‹ › arrows, ← → keys, swipe on touch (pointer events, 50 px threshold), Esc = Back, "N of M". Back closes the viewer and leaves whatever was behind it exactly as it was (the AskDetail window stays open behind it when opened from there).
- The same viewer opens from: the Build screen's newest screenshot when it belongs to a choice ask's option (otherwise unchanged); the Host path's option tiles and the queue's waiting-vote mockup tiles (click a tile); the Stage Edit window's "view mockup" (Task 3).

- [ ] **Step 1: failing tests**: AskDetail renders a decided choice ask with two pictured options, the pick outlined with "the room's choice, 7 to 4", the direction and kind; a held-later decision says "Held for Claude, not sent yet"; an Ideas ask lists ideas and votes; no player name from the fixture's voters appears. MockupViewer: shows the start label, → moves to the next, ← back, Esc calls onBack, Back's text is the `backLabel`, only options with pictures get tabs. Page: clicking a History decided item opens the window; clicking its picture opens the viewer; Back returns to the window (still open).
- [ ] **Step 2: run, see them fail. Step 3: implement. Step 4: run** the Build Room suites + palette test. **Step 5: commit.**

---

### Task 3: Deciding on the Stage

**Files:** Modify `src/src/buildroom/BuildRoomPage.jsx` (`BuildStage` ~1430-1530 and its Dock; `DecidePanel` for a `framed` mode if needed), `src/src/buildroom/buildScreens.js` (`stageModel` results moves), `src/src/buildroom/BuildRoom.css`, `src/src/styles/stage.css` only if the Space hint style lives there (keep the change scoped to the Build Room dock: `.brm` or a Build Room class). Create `src/src/buildroom/BuildStageDecide.jsx`. Tests: `buildScreens.test.js`, `buildRoomPage.test.jsx`, new `buildStageDecide.test.jsx`.

**Behaviour (R3, R4, R5):**
- `stageModel` at results with a unique winner returns `primary: { action: 'to-claude', label: 'To Claude: <label>' }` and `secondary: { action: 'edit', label: 'Edit' }`; on a tie or no votes keep today's moves (Spin the wheel / Vote again, Decide on Host becomes Edit). Rating asks: primary "To Claude: <average>".
- To Claude sends the room's choice with its default direction (the same text DecidePanel would start with: `defaultDirection`/`directionFor`) as Do now through the existing decide call (`askAction(askId, { action: 'decide', ... })` exactly as DecidePanel posts it — read DecidePanel's `decide()` and reuse its body builder rather than duplicating it).
- The dock's Space hint is words, not a key cap: replace the Build Room dock's `<span className="kbd">SPACE</span>` with `<span className="brm-dockhint">Press <b>Space</b> to send</span>` at results ("Press Space to <the move's verb>" elsewhere: "Press Space to close", "to spin", "to open the vote"); muted label style, no border or box.
- Edit opens `StageDecide` (R4), a Modal over the Stage: the options (click to switch the pick; the alternate-pick wording as today), each pictured option has "view mockup" (opens the viewer with `from: 'stage-edit'`, Back returns here with the pick and the text intact), the direction text, "Claude gets it as" (the four kinds), and the footer: Discard (confirms first: "Discard Ask N? The votes stay in History."), Re-ask…, Save for later (= decide with kind For Claude, later), Send to Claude (primary; the chosen kind). X and Esc close without changing anything.
- Re-ask… turns the window into the question form (R5): the prompt, the detail, the options (edit, add, remove; pictures stay with options that keep their letter), "← Back to Send to Claude" (returns with everything intact), and Ask again (calls Task 1's `api.reask`). On success the window closes and the Stage shows the new live ask.

- [ ] **Step 1: failing tests**: stageModel's results moves (winner, tie, rating); To Claude posts the decide body DecidePanel would; the dock hint reads "Press Space to send" and has no `kbd` box; Space on the Stage at results sends; Edit opens the window; switching to A rewrites the direction; Save for later posts kind later; Discard asks first; Re-ask shows the form prefilled and Ask again calls reask with the edits; view mockup → viewer → Back keeps the edited direction.
- [ ] **Step 2: run, see them fail. Step 3: implement. Step 4: run** the full gates. **Step 5: commit.**

---

### Task 4: Gates, dev, and a look

- [ ] Every gate in Global Constraints passes.
- [ ] `git fetch origin && git merge-base --is-ancestor origin/dev HEAD && git push origin HEAD:dev` (merge first if dev moved; re-run gates).
- [ ] On dev (room 4443 or a fresh test room): a Choose ask with two options, vote, Stage → To Claude via Space; another ask → Edit → switch pick → Save for later; another → Re-ask with an edited question; History → open a decided ask → open a mockup (if any) → Back. Measure the windows at about 660 px and 375 px.
