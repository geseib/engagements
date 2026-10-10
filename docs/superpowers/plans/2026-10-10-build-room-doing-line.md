# Build Room: what Claude is doing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One short line says what Claude is doing right now ("Scaffolding the site"), on the Host screen, the Stage and everyone's devices, and each finished step becomes one entry in History; the mechanical command lines move under a fold on the Host screen only.

**Architecture:** Two sources feed one "doing" record on the server. (A) The plugin's existing PostToolUse hook reads Claude Code's own to-do list (`TodoWrite`: the `in_progress` item's `activeForm`) and posts it with the activity it already pumps. (B) Claude states the line itself through a plugin call (`post_update` gains `doing` and `done` fields, or a small `now` tool) at the start of each piece of work; B wins while fresh. The server keeps the current line on `BUILD#ACTIVITY` (already sealed, already ttl'd) and, when a line ends, writes a `step` timeline entry (`BUILD#LOG`, kind `step`) with start time and duration. Screens read one shared `doingView` helper.

**Tech Stack:** Node ESM plugin (`src/public/engage-mcp.mjs`), Node 18 Lambda (`lambda-functions/game/build-room.js`, `build-store.js`), React + jest.

**Spec:** the owner (2026-10-10): "could we have claude always report a 4-7 word summary of its action like scaffolding site, researching social issues, mocking up 3 graph options" — chose both A and B. **Mockups (they ARE the design):** `docs/design/build-room-doing/index.html` D1-D6.

## Global Constraints

- Owner rulings 2026-10-10: History shows a to-do step in the item's own words, "Done: Build the bar chart" (no past-tense rewording); a step Claude stated itself uses the past-tense line Claude gave; the helper line ("A helper is researching contrast rules") shows on the Stage and devices as well as the Host; the command lines are folded by default on the Host and an opened fold is remembered for that host (per-browser preference is fine for this).
- D6 rules: 4-7 words, at most 50 characters, cut at the last whole word, no ellipsis; begins with an -ing verb; screens prepend "Claude is"; the server refuses a line containing `/`, a backtick, `@`, `://` or a file extension and falls back to the next source; never people's names (plugin instruction); commands never on the Stage, devices or in History.
- Precedence: Claude's own line (B) wins until Claude states a new one, waits for direction, or 15 minutes pass while the to-do list moves; else the to-do item (A); else today's words.
- A line ends when a new line starts, the to-do item is marked done, or Claude waits for direction → one `step` entry with duration.
- Stale after 3 minutes with no activity and Claude not waiting: "Claude was …" (host also sees "last seen N min ago").
- Every row via `put`/`touchState` (session ttl); `BUILD#ACTIVITY` is already sealed (`buildActivity`) — add the new fields to its sealed list in all three byte-identical `tenant-crypto.js` copies if they carry text.
- Plugin VERSION bump (1.13.1 → 1.14.0) and its pin on every edit.
- One orange per screen; words in `words.js`; laptops, tablets and phones; no emoji.
- Gates: full jest, lint 0 errors, build, `tests/build-room-copy.js`, `tests/no-retired-twin-references.js`, the backend loop.

## Review Focus

1. A line with a file path, command or link is never shown to the room (server refuses; next source wins).
2. Helper agents: does the PostToolUse hook see tool calls made inside a helper agent? Measure it (a scratch Claude Code session or the hook's documented input) and design the helper line on what is actually observable.
3. Claude waiting for direction ends the step, and the Stage never says "Claude is …" while Claude waits.
4. Clock skew between laptop and server (activity timestamps are already clamped to the last hour).
5. A long session: History grows by one entry per step, not per command.

---

### Task 1: Server — the doing record and step entries
**Files:** `lambda-functions/game/build-store.js` (normalize/merge doing on the activity row, `doingView`, `step` log kind for the host, Stage and phones; room-safe filter), `build-room.js` (`postActivity` accepts `{items, doing?: {text, past?, source:'todo'|'claude', helper?}}`; `post_update` route accepts `doing`/`done`; step entries on line end; waiting ends a step), the three `tenant-crypto.js` copies if needed. Tests: `tests/build-doing.js` (new) — precedence, length cut, refusal of unsafe lines, step on end with duration, waiting ends, stale, ttl and sealing in a team room, views per audience.
- [ ] Failing tests → implement → backend gates → commit.

### Task 2: Plugin — sources A and B
**Files:** `src/public/engage-mcp.mjs` (`activityLine` for `TodoWrite` reads the in-progress `activeForm` and the item marked done; `post_update` gains `doing` (present) and `done` (past) fields; the server instructions: at the start of each piece of work state what you are doing in 4-7 words beginning with an -ing verb, never names, never file paths or commands; helper agents: say "A helper is …" when you start one), `tests/engage-mcp.js`, `tests/engage-plugin-version.js` (1.14.0). Measure Review Focus 2 and record the finding in the interfaces note.
- [ ] Failing tests → implement → plugin tests → commit.

### Task 3: Screens
**Files:** `src/src/buildroom/BuildRoomPage.jsx` (`ClaudeActivity` headline + fold remembered per browser; header chip), `buildScreens.js` (`claudeState` uses the doing line; stageModel), the Stage view, `BuildPlayer.jsx` (Now view line), History (step entries grouping the posts made during the step), `words.js`, CSS. Tests per mockup frame D1-D5 incl. edge states and one orange.
- [ ] Failing tests → implement → full gates → commit.

### Task 4: Dev, walk, test, prod
- [ ] Push dev; install plugin 1.14.0 locally; walk with a key in room 4443 (post to-do updates and explicit lines through the API); promote to test (merge) and start prod (owner gate).
