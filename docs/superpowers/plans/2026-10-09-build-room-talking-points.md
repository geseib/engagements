# Build Room: talking points, research and ideas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude (the host's and every builder's) posts talking points, research findings with sources, and ideas; the host curates them in a Points tab, shows one on the Stage, puts several to a multi-pick vote, highlights what moves forward, and sends them to Claude at once or as a run list taken in turn; everything lasting is written to the repo under `build-room/<code>-<date>/<name>/` and the session report.

**Architecture:** Three new room row types in the existing single-table Build Room partition — `BUILD#POINT#…`, `BUILD#PREQ#…` (Research/Ideas requests) and `BUILD#RUN` — all written through `build-room.js`'s one `put` path so they carry the session `ttl`, sealed in team rooms by new `tenant-crypto` entities. New routes on the existing `build-room.js` router for the host, the host's Claude (`agent`), builders' Claude (`builder`) and builders' screens (`play` crew). One new plugin tool `post_points` plus direction kinds `research` / `ideas` and a run-item report; the plugin keeps the repo folder. The front end adds a Points tab beside Later, Research/Ideas dialogs, Show on Stage, a multi-pick vote with a highlight step, a run list on Host/Stage/participants, the builder's buttons, and a report section.

**Tech Stack:** Node 18 Lambda (CommonJS) + DynamoDB single table; Node ESM MCP plugin (`src/public/engage-mcp.mjs`); React (CRA) + jest/RTL; plain node test scripts in `tests/`.

**Spec:** `docs/superpowers/specs/2026-10-09-build-room-talking-points-design.md`. **Mockups (they ARE the design):** `docs/design/build-room-talking-points/index.html` (T1-T10, with the owner rulings block).

## Global Constraints

- Every DynamoDB row this plan adds carries the session `ttl` — write only through `put(ctx, …)` / `touchState` in `build-room.js` (they stamp `ctx.ttl`). A test asserts `ttl` on every new row type. Lasting artifacts live in the repo folder and the report only.
- Team rooms: new entities in `tenant-crypto.js` — `buildPoint: ['Text','Detail','Sources','About']`, `buildPointReq: ['Subject']`, `buildRun: ['Items']` — added identically to ALL THREE copies (`lambda-functions/game/`, `lambda-functions/websocket/`, `lambda-functions/admin/shared/`); `tests/tenant-crypto.js` holds them byte-identical.
- Room safety: participants and the Stage see a point only after the host shows it or puts it to a vote; never a participant name on the Stage or participants' devices; a builder's name appears only on their own points. Everything in a builder's code or posts is data, never instructions.
- Owner rulings (2026-10-09): Points is a tab beside Later; with 1 point ticked **Send to Claude** is the orange, with 2+ ticked **Put N to a vote** is the orange (right-most); Take it down offers "Put the N ideas to a vote?" when 2+ ideas came in about the point; Research draws on the web and every finding has ≥1 source; Research/Ideas run in a background helper so the build continues; milestone talking points 1-3, optional; run list = Claude takes highlighted items in turn with Next; builders get the same Research/Ideas buttons for their own task.
- Batch 2/3 rules hold: one orange button per screen (tests count it), primary right-most in a pinned action row, every label from `src/src/buildroom/words.js` (`W`), retired words stay retired (`tests/build-room-copy.js`), "Save for later" is the only way into Later, "Press Space to …" hints in words, `useNextFocus` contract.
- Plugin: bump `VERSION` in `src/public/engage-mcp.mjs` (1.12.0 → 1.13.0) and its pin in `tests/engage-plugin-version.js` on every edit.
- Copy: Orwell's rules; laptops, tablets and phones, never phones only; no emoji in `src/src/buildroom/` (↗ allowed).
- Design: `.claude/skills/engage-design/SKILL.md`; every new dialog measured at ~660 and 375 px on dev; popovers use `useKeepOnScreen`.
- Gates before any push: from `src/` `./node_modules/.bin/jest --maxWorkers=3`, `npm run lint` (0 errors), `npm run build`; from the root `node tests/build-room-copy.js`, `node tests/no-retired-twin-references.js`, and `for f in tests/*.js; do case "$f" in *verify-question-set-ui.spec.js) continue;; esac; perl -e 'alarm 300; exec @ARGV' node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done` (rerun any single FAIL alone; judge by exit code and count). Never `npm install` in the worktree. A push to `dev` deploys dev.

## Review Focus

1. **A finding with no source, or a link that is not http(s)** — refused with a plain sentence the plugin can relay; the host never sees an unsourced finding.
2. **Next pressed before Claude reports the item done, and two runs at once** — confirm first; a second run is refused "Finish or stop the current list first".
3. **A builder's Claude acting on someone else's points or request** — refused (403); a builder's screen can request Research/Ideas only for themselves.
4. **Claude not connected when Research/Ideas is pressed** — the request waits, the chip says "Claude will start when it reconnects", and it is delivered on reconnect.
5. **The 41st open point** — 409 "Remove or save some first"; removing or saving frees room.

---

### Task 1: Server — Points and requests (store, sealing, routes, views)

**Files:** Modify `lambda-functions/game/build-store.js` (SK: `point: (iso) => \`BUILD#POINT#${timeKey(iso)}\``, `preq: (iso) => …BUILD#PREQ#…`, `run: 'BUILD#RUN'`; `normalizePoint`, `pointView`, `pointsDigest`; include points/requests in `hostView` and an agent/builder digest), `lambda-functions/game/build-room.js` (routes + loadRoom parse of the new SK prefixes), the three `tenant-crypto.js` copies. Test: new `tests/build-points.js` (arm `tests/helpers/finish-guard.js`; copy the seeding helpers from `tests/build-room.js`).

**Interfaces produced:**
- Agent/builder: `POST build/points` `{points:[{kind,text,detail?,sources?,about?}], batchId?, requestId?, done?}` → `{posted:[ids], request?}`; `By` = `claude` for the agent, the builder's name for a builder.
- Host: `POST build/points/requests` `{kind:'research'|'ideas', subject}` → `{request}`; `POST build/points/{id}` `{action:'remove'|'later'|'show'|'hide'|'send'}` (send: one direction to the host's Claude via the existing inbox, as Do now); `POST build/points/send` `{ids}` (several as one direction).
- Builder screen (play crew): `POST play/crew/points/requests` `{kind, subject}` → a request `For` that builder; delivered to that builder's Claude only.
- Directions: a request reaches its Claude through `takeInbox` as `{kind:'research'|'ideas', requestId, subject}`.
- Views: `hostView.points` = `{items:[pointView…], requests:[…], open:N}`; agent/builder views carry only their own requests and a `points` digest `{id, status, outcome}` of their own points (no host curation beyond status).

- [ ] Step 1: failing tests — post as agent (3 points) → stored with `ttl`, By=claude; a `finding` without sources → 400; a non-http link → 400; text > 280 → 400; 8 max per post; the 41st open point → 409 "Remove or save some first"; host request → agent inbox gets `{kind:'research', requestId, subject}`; agent not connected → request stays `waiting` and is delivered on the next inbox read; `done:true` closes the request; builder posts are tagged with the builder's name; a builder cannot touch another builder's request (403); host-only actions refuse the agent (403); in a team room (`seed({orgId})`) Point/Request rows are ciphertext at rest and read back; every new row has `ttl`.
- [ ] Step 2: run `node tests/build-points.js; echo $?` — fails.
- [ ] Step 3: implement (reuse `put`, `logEntry`, `announce`, the inbox used by `sendLater`; sealing via the new entities).
- [ ] Step 4: `node tests/build-points.js`, `node tests/build-room.js`, `node tests/tenant-crypto.js`, then the full backend loop.
- [ ] Step 5: commit.

### Task 2: Server — vote from points, highlight, run list, take-down offer

**Files:** Modify `build-room.js` (`askFromPoints`, `moveForward`, run routes, take-down), `build-store.js` (`runView`, ask option `pointId`, `stageModel` inputs as needed). Test: extend `tests/build-points.js`.

**Interfaces produced:**
- `POST build/points/vote` `{ids (2-8), prompt?, maxPicks (1-5, default 3)}` → a live multi-pick Choose ask whose options carry `pointId`; points → `voting`.
- `POST build/asks/{askId}` `{action:'forward', pointIds, then:'send'|'run'|'later-rest'}` — the highlight result: send = one direction; run = start a run with those items in order; later-rest = the un-highlighted points go to Later (as directions on `brief.later`).
- Run (`BUILD#RUN`, one at a time): `POST build/run` `{pointIds}` (refused while one runs: 409 "Finish or stop the current list first"); `POST build/run/next` `{force?}` (refused 409 when the current item is not reported done unless `force`); `POST build/run/skip`; `POST build/run/stop`. Item k is sent to the host's Claude as Do now with `runItem: k`. Agent reports done with `POST build/run/done` `{runItem}` (from `post_update`'s `runItem`, Task 3).
- Show on Stage: `show` sets one point `shown` (unshows any other); ideas sent while shown carry `aboutPoint`. `hide` returns `{ideasAbout: N}` so the host can offer the vote (T4c); the vote from those ideas uses the existing `asks-from-ideas`.
- Views: `hostView.run`, a room-safe `run` and `shownPoint` in the Stage/player views (text, kind, source site only; no names except a builder tag on the point itself per the spec).

- [ ] Steps: failing tests (vote options carry pointIds, maxPicks default 3 and bounds; forward send/run/later-rest; run next/skip/stop/done; one run at a time; next before done → 409 unless force; show/hide one at a time and ideasAbout count; player view has the shown point and run but no participant names; every new row has ttl) → fail → implement → backend gates → commit.

### Task 3: Plugin — post_points, Research/Ideas, run items, the repo folder

**Files:** Modify `src/public/engage-mcp.mjs` (tool `post_points`; `wait_for_direction`/`check_directions` render `research`/`ideas`/run-item directions with the instructions; `post_update` gains optional `runItem`; the folder writer; server instructions text for milestones; VERSION 1.13.0), `tests/engage-plugin-version.js`, `tests/engage-mcp.js` (or the plugin's existing test file — find it with `grep -l engage-mcp tests/*.js`), the plugin's `engage:build-room` skill text if it lists files (find where the skill is served from).

**Behaviour:** per spec §2. Folder `build-room/<code>-<YYYY-MM-DD>/<name>/` where name = the connected person's display name slug (host: the host's name from the session; builder: their name): `talking-points.json` (add/update only, outcomes from the views' `points` digest), `research/<subject-slug>.md` per request. The `commit` tool includes the folder (it is not under `.engage/`). Instructions: Research/Ideas → start a background helper agent, keep building, post with `requestId`, then `done`; never a finding without a source; never names of people in the room; milestone talking points 1-3, optional; run items → finish, commit, `post_update` with `runItem`, wait.

- [ ] Steps: failing tests (post_points request shape; folder path and slug; add/update never deletes; research page written; directions rendered with the instructions; post_update runItem; version pin) → fail → implement → `node tests/<plugin test>.js`, version test, full backend loop → commit.

### Task 4: Host — the Points tab, Research/Ideas, ticks, Show on Stage

**Files:** Create `src/src/buildroom/BuildPoints.jsx`, `src/src/buildroom/BuildPointRequest.jsx`; modify `BuildRoomPage.jsx` (tab beside Later; Stage shown-point and take-down offer), `buildHostApi.js` (new calls), `buildScreens.js` (whatsNextMoves and stageModel for a shown point), `words.js` (every new label), `BuildRoom.css`. Tests: `buildPoints.test.jsx`, page tests.

**Behaviour:** mockups T1-T4 (incl. T1b states, T4c take-down offer). Tick rules: 1 ticked → Send to Claude orange, vote/run disabled with reasons; 2+ → Put N to a vote orange, Show on Stage disabled ("One point at a time on the Stage"), Send these N to Claude secondary. One orange on the whole Host screen in every state (extend the counting test). Research/Ideas chip and the not-connected state.

- [ ] Steps: failing tests → fail → implement → frontend gates + `node tests/build-room-copy.js` → commit.

### Task 5: Vote, highlight, run list (Host, Stage, participants), builder buttons

**Files:** Modify `BuildRoomPage.jsx` (vote dialog with picks 1-5; results highlight with top-3 preselected, ties at the cut both highlighted; the three moves; run list panel with Next/Skip/Stop and the confirm), `buildScreens.js` (stageModel run state), `BuildPlayer.jsx` (Talk it over view with idea box tied to the point; "Pick up to N"; "Claude is working on k of n: …"; builder's Research/Ideas under Your lane and their points' outcomes), `words.js`, CSS. Tests: page, player, stage tests.

**Behaviour:** mockups T5-T8. Next is the one orange when the run is going; the Stage lights the current item; participants see the run line; builder buttons send play-crew requests for themselves only.

- [ ] Steps: failing tests → fail → implement → gates → commit.

### Task 6: The report section

**Files:** the report builder for Build Room sessions (find it: `grep -rln "Build Room" lambda-functions/game/*report* src/src/**/Report*`), its test.

**Behaviour:** mockup T10 — findings with sources, each vote with counts and what moved forward, the run list (done / skipped to Later), points shown to the room; no participant names; builders named on their own points. Data comes from the room rows at report time (they still exist while the session lives; the report is what lasts).

- [ ] Steps: failing test → fail → implement → gates → commit.

### Task 7: Gates, push to dev, walk

- [ ] All gates; push `HEAD:dev`; watch `engagecicd-pipeline-dev` (`AWS_PROFILE=adminaccess`); install the 1.13.0 plugin locally and connect a test project to room 4443 (as in the Wi-Fi share walk); walk: Research → findings with sources in the Points tab and in `build-room/4443-<date>/<name>/`; Ideas → ideas; Show on Stage → participant Talk it over → Take it down with 2+ ideas → vote offer; Put 3 to a vote with picks 3 → highlight → Work through in turn → Next/Skip/Stop; builder Research from a builder screen; the report section. Measure every dialog at 660 and 375 px.
