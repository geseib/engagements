# Build Room: the Session panel (players, moving devices, organised settings) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Build Room host gets the same Session side panel the other engagements have — Players (see everyone, unlock a name so someone can move device, remove and bring back) and an organised Settings tab — and is told the moment someone asks to take a name.

**Architecture:** Extract the Players tab of `src/src/components/stage/SessionSetupPanel.jsx` into a shared `PlayersList` component used by both the existing panel and a new `BuildSessionPanel.jsx`. The Build Room host listens for `handoverRequested`, `playerRemoved`, `playerRestored` on the websocket (as `GameHostPage.jsx` does ~2119) and refetches players through the same routes. Settings regroups everything now in the header's `···` menu. Two small server additions: Lock again and Not now.

**Tech Stack:** React (CRA) + jest/RTL; Node 18 Lambda routes under `lambda-functions/game/`.

**Spec:** the owner's words (2026-10-09): "we need the sidebar menu like is in the other engagement types, i need the full capabilities of seeing the players, the ability to unlock a player to allow them to move devices. to remove players, etc." and "i was not able to allow a player to move devices ... and the host screen didnt get notice." **Mockups (they ARE the design):** `docs/design/build-room-sidebar/index.html` (S1-S6).

## Global Constraints

- Owner rulings 2026-10-09: removing a builder takes them out of the room AND off the crew (their Claude is unlinked, their lane closes, merged work stays; Bring back restores the seat, they reconnect their Claude); a name-takeover request never names the player on screens the room sees (Build, History, Stage) — the name shows on the Host screen and in Players; keep "List names on the room meter", off by default.
- The same words as the other engagements: Unlock name, Let them take it, Remove, Bring back; plus Lock again and Not now. Every label from `src/src/buildroom/words.js` (W) for Build Room surfaces; RETIRED words stay retired.
- One orange per screen: the request strip's Let them take it is filled but never orange (What's next keeps the orange); Space never answers the request.
- Room safety: no participant names on Build, History or Stage beyond what they show today; counts only.
- Design: `.claude/skills/engage-design/SKILL.md`; panel X + bottom Close + Esc; ≥12px; measure at 660 and 375 px on dev.
- The other engagements must behave exactly as before after the extraction (their tests stay green unchanged, or changed only for the moved component's import).
- Gates: from `src/` full jest, `npm run lint` (0 errors), `npm run build`; root `node tests/build-room-copy.js`, `node tests/no-retired-twin-references.js`, the backend loop. Never `npm install`.

## Review Focus

1. A request arriving while the panel is closed and the host is on the Stage — the SESSION count lights; nothing on the Stage names the player.
2. Two host devices — removing on one updates the other (`playerRemoved`/`playerRestored`).
3. Removing a builder — their Claude's key stops working and their lane closes; their merged work is untouched; Bring back gives a seat but not the old key.
4. The other engagements' Players tab after the extraction — identical behaviour (unlock, grant, remove, undo).
5. A long room (50+) — search and filters; nothing overflows at 375 px.

---

### Task 1: Shared PlayersList + server additions

**Files:** Create `src/src/components/stage/PlayersList.jsx` (moved from SessionSetupPanel's Players tab, props-driven: rows, onUnlock, onGrant, onRemove, onRestore, onLock, onRefuse, extra column renderer), modify `SessionSetupPanel.jsx` to use it; server: find the handover/remove routes (`lambda-functions/game/request-handover.js`, the grant route used by GameHostPage ~3283, the remove/restore route behind `setPlayerRemoved`) and add **Lock again** (revoke an unlocked, not-yet-taken name) and **Not now** (refuse a pending request; the asking device is told "The host said not now"). Builder removal: unlink the builder's key and close their lane (find the crew key/lane rows in `build-room.js`). Tests: existing setup-panel tests unchanged and green; new `playersList.test.jsx`; server tests for lock, refuse, builder removal (key refused afterwards, lane closed, team room sealing unaffected, ttl on any new row).

- [ ] Failing tests → fail → implement → gates → commit.

### Task 2: The Build Room Session panel and the request strip

**Files:** Create `src/src/buildroom/BuildSessionPanel.jsx`; modify `BuildRoomPage.jsx` (SESSION button replaces `···` at the far right of the header, `\` opens it, Stage dock's last button; the joined count becomes a button into Players; websocket listeners for `handoverRequested`, `playerRemoved`, `playerRestored` → refetch players; the S6 request strip on the Host screen, the nameless pill on Build/History, the count on SESSION on the Stage), `words.js`, `BuildRoom.css`, `BuildPlayer.jsx` (the asking device's "The host said not now" and a builder's removed state). Settings groups per S3: The room; Claude; Crew; This session (End session last, alone). Remove `···`; at ≤480 px the header extras go to the panel's top line. "List names on the room meter" setting, off by default, wired to the Stage room meter.

- [ ] Failing tests (panel opens by button and `\`; Players actions call the routes; request strip appears on the event, Let them take it grants, Not now refuses, Space ignored; Build/History/Stage show no name; one orange per screen with the strip; ··· gone and every item reachable in Settings) → fail → implement → gates → commit.

### Task 3: Gates, dev, walk

- [ ] Gates; push `HEAD:dev`; on dev room 4443 with a participant tab: request a takeover from a second tab → the host strip appears → Let them take it → the second tab takes the name; Not now path; Remove and Bring back; a builder removed (if a crew room is handy); the panel at 660 and 375 px.
