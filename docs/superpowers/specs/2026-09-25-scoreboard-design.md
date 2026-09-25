# Scoreboard — a full-screen standings moment, in three looks

2026-09-25 · designed with the owner in conversation; the owner asked to build it
("I love all of those, and want them all, with a host ability to switch the view").

## What the owner wants

A scoreboard that is a pleasure to watch. It borrows from Olympic results boards,
horse-race tote boards and airline departure boards. It flashes up the top of the field,
then flips to the next page of places. The host opens it from the remote, a keyboard
shortcut, or a button on the Players tab of the session menu. There are three looks,
and the host can switch between them. Later the look may join an overall theme; for
now the setting sits under "Scoreboard" and nothing else.

## Decisions (owner, 2026-09-25)

| Question | Decision |
|---|---|
| Game types | **Trivia and Call & Answer only.** Poll, Wavelength and Survey get no board and no button. |
| When it can open | **Any time, once at least one round is scored.** It shows totals as of the **last fully scored round**. A round is scored only when its results are counted (get-results, at RESULTS), so a round in progress never shows partial points. |
| Anonymity | The owner's ruling: "I don't think it matters as long as scores are not tallied until all votes are in." Names with totals may show at any time. Accepted consequence: right after a Call & Answer round is scored, before names are revealed, a big jump can hint who wrote the top answer. This reverses the recorded rule "a full roster WITH SCORES never goes on the wall" (`src/src/config/podium.js` header, `GameHostPage.jsx` comments near the RESULTS solo layout). Update those comments to point here. |
| Movement | **▲n / ▼n since the previous scored round**, `NEW` for a player with no previous place, `–` for unchanged. |
| Paging | **Auto-flip, and the host can step.** It opens on page 1, flips through every page, returns to page 1 and holds. ←/→ step manually. |
| Looks | **All three**, from the approved mockups: A · Departure board (split-flap), B · Olympic board (lanes), C · Tote board (bulb numerals, rows racing to new places). The host switches the look. |

## The approved mockups — they ARE the design

`docs/design/scoreboard-2026-09-25/` (committed on `working/scoreboard-mockups`, 60509a0c):
`a-departure-board.html`, `b-olympic-board.html`, `c-tote-board.html`, `index.html`. Build the
three looks from the rendered mockups (serve them and look before coding: `python3 -m
http.server --directory docs/design` and open `/scoreboard-2026-09-25/`), including:

- their geometry, type, colours and contrast;
- the exact page-change motion described in each file's header;
- the "blank wake-up" (A);
- the leader sweep (B);
- the after-round-5 → after-round-6 replay on first open (C).

**The contrast fixes the mockup author called out:**
- NEW uses the lighter periwinkle `#A7C3EF`.
- The bronze rank block's dark numeral measures 3.35:1 after the projector model. Fix it with a lighter bronze or a light numeral, at ≥ 4.5:1.

**The font:** the mockups load Archivo at its expanded width. Production's
`src/public/index.html` requests "Archivo Expanded", which Google does not serve, and a
separate task is fixing that. Use the app's display-font token so the boards pick up
the fix.

## Design

### 1. What the room sees
- **A full-screen overlay above the stage content.** It lives inside the stage's own layer (not in the sidebar, not on the remote). It does NOT go through the fitter. Its page size is declared per display profile:

| Profile | Places per page |
|---|---|
| room | 10 |
| table | 10 |
| tv | 5 |
| call | 5 |

- **Header:** the session title, "After round N" (N is the last scored round), and "1–10 of 14".
- **Each row:**
  - the place, using competition ranking (1, 2, 3, =4, =4, 6). The `=` marks a tie.
  - the name, which wraps and is never cut off.
  - the points.
  - the movement.
- **Removed players** are not on the board.
- **Paging and motion:**
  - It auto-flips at the mockups' pace (a new page about every 7-8 s; back on page 1 about 15 s after opening on Room), then holds on page 1.
  - ←/→ steps manually. Stepping cancels the auto-flip for this opening.
- **Motion rules** (tests enforced by `src/src/__tests__/stageMotion.test.js`):
  - keyframes may animate only transform, opacity, border-color and visibility;
  - every animated selector needs an `animation: none` rule under `prefers-reduced-motion: reduce`, where a page change becomes an instant swap.

### 2. The three looks, and switching between them
- **A session setting `scoreboardStyle`**, one of `departure | olympic | tote`, default `departure`. It is stored on the session's `STATE` row, beside the open/closed state, in the `Scoreboard` attribute below. It is plaintext: a word from a fixed list.
- **The host switches it in three places:**
  - the Settings tab of the session menu, under "Scoreboard";
  - the remote, with a style picker beside the Scoreboard button;
  - the keyboard: `V` cycles the look while the board is open.
- **A switch applies live.** The board re-lays out in the new look on the current page.

### 3. Opening, paging and closing
- **One session-level state on the server** (not per-round like stage focus, and so it also works in ENDED):
  - `STATE.Scoreboard = { open: boolean, style, openedAt, page }`
  - route: `POST /games/{gameId}/scoreboard` with `{ open?, style?, step?: 'next' | 'prev' }`
  - authorised by `callerMayDriveSession`, as `stage-focus.js` is
  - broadcast `{ type: 'scoreboardChanged', open, style, page, openedAt }`
- **Restore:**
  - `get-game-state.js` returns `scoreboard` so a refreshed host page restores it.
  - The remote reads it from the same `/state` poll it already makes.
- **Host page keys** (registered where the stage's other shortcuts live; they must not fire while typing in a field or while the session menu is open):
  - `S` opens and closes the board;
  - with the board open: `←`/`→` page, `V` cycles the look, `Esc` closes;
  - `Space` closes the board and does NOT advance the game in the same press.
  - Add S and V to the "Keys" list on the Settings tab and to `config/help/host.js`.
- **The remote** (`HostRemote.jsx` / `config/hostRemote.js`) gets a "Scoreboard" control: open or close, next page, and the style picker. It is disabled with a reason:
  - "Scores appear after the first round" before any round is scored;
  - no control at all for other game types.
- **The Players tab** (`components/stage/SessionSetupPanel.jsx`) gets a "Show scoreboard on screen" / "Hide scoreboard" button above the roster, disabled with the same reasons.

### 4. The data
- **`GET /games/{gameId}/players`** (`lambda-functions/game/get-players.js`, already public, already sorted by total) gains, for every player:
  - `rank` (competition ranking);
  - `movement`: a number (positive means up) or the string `'new'`.

  It also returns `afterRound`, the last scored round. Today only the top 3 get a rank; keep the existing `ranking` object for its current readers.
- **Movement needs the previous places.** When `get-results.js` adds a round's points to a player's `PLAYER#<name>#SCORE` row (both the Call & Answer path and `handleTriviaResults`), it also writes `prevScore` (the total before this round) beside `score` and `afterRound`.
  - Previous standing = rank by `row.afterRound === latestRound ? row.prevScore : row.score`, where `latestRound` is the highest `afterRound` across the rows.
  - A player with no row before `latestRound` (joined since) is `new`.
  - Rows written before this change have no `prevScore`. Treat them as `movement: 0`, and treat the board's first scored round as all `new`.
- **The board fetches the list** when it opens and on each `scoreboardChanged`. It uses `scoresRevision` or the existing results broadcasts to refetch after a round is scored while the board is open.

### 5. What never changes
- The podium at RESULTS/ENDED keeps its behaviour.
- Answers stay anonymous as the anonymity settings say. The board shows totals, never which answer was whose.
- Nothing about the board is logged except its open/close/style transitions (no names).

## Testing

Tests first, watched failing.

**Backend** (plain `node tests/<file>.js`, exit code, finish-guard):
- ranking with ties (competition ranking);
- movement from `prevScore`, including a player who scored nothing this round, a new player, and legacy rows without `prevScore`;
- `prevScore` written on both scoring paths;
- the scoreboard route: authorisation (another org's host gets 403), persistence on STATE, broadcast shape, `step` and `style` validation, refusal for Poll, Wavelength and Survey;
- `get-game-state` returns `scoreboard`.

**Frontend** (jest):
- each look renders the rows, ties, movement and wrapped names;
- page size per profile;
- the auto-flip sequence with fake timers, ending held on page 1;
- ←/→ stepping;
- V cycling and live style switching;
- S, Esc and Space behaviour, including that Space does not advance;
- reduced motion gives an instant swap, and `stageMotion.test.js` rules pass for the new CSS;
- the remote control and the Players-tab button, with their disabled reasons;
- no control for other game types.

Then the full backend loop, jest, lint and build must hold their baselines.

## Out of scope

- An overall theme system (later).
- Sound.
- Team or Wavelength boards.
- Survey or Poll.
- Changing the podium.
