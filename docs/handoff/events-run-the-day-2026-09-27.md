# Handoff — Events: join once, run the day, follow along (M2–M4), 27 Sep 2026

Read `CLAUDE.md` first; its deploy rules at the top are binding. This file supersedes the "Where things
stand" and "Recommended next steps" of `events-m2-handoff-2026-09-27.md` (kept beside it for its
rulings, install recipe and traps, which all still hold).

## What the owner asked for

> "the agenda build is there but need a way for host to launch them and to run them and players to join
> and get to play through out without having to rejoin different sessions throughout the day/event."

That is roadmap M2 (attendees join the event), M3 (the host runs the day) and M4 (attendees follow),
without M5 (presentation PDFs). The roadmap's recommended answers to D1–D5 were taken as the design;
the owner has not answered them, and each is a small change if overruled (see below).

## What shipped to dev

### Attendees join once (M2)
- `/play?event=<code>` → `components/event/EventAttendeePage.jsx`. A typed event code goes there
  from the join box (`hooks/useJoinCode.js` → `utils/joinCode.js` → `GET /join/{code}`), and from
  the player page after a 404 on that code.
- Name once → `POST /events/{code}/attendees` → an opaque 256-bit token, kept under
  `engage.event.<code>` in localStorage. A reload asks `GET /events/{code}/me` and never asks the
  name again. "Not you?" forgets the token.
- The trial branch's backend (`wip/events-m2-trial` T1–T3) was reviewed and adopted. The one review
  fix: the public agenda function's IAM is narrowed from DynamoDBCrudPolicy to the five calls it makes.
- "N joined" appears in the builder's facts, on the Events list, and on the wall's dock
  (`METADATA.AttendeeCount`, mirrored best-effort onto the org's list row).

### The host runs the day (M3)
- `POST /events/{code}/run` `{action, itemId}`: start / resume / pause / end / extend / end-event
  (`lambda-functions/websocket/events/run.js`, on the existing items function: one route, one
  permission, no new Lambda).
- Starting an engagement creates its session from the item's pinned set version and options, stamps
  `EventRef`/`EventItem` on it, and opens it (`child-session.js`, reusing `createGame` and a
  byte-identical copy of `session-start.js`). Starting while another item is live pauses that one
  (a break ends instead) in the same transaction. Two screens starting at once: one wins, the other
  gets a 409, and the loser's session is discarded along with its code.
- Pause sets `STATE.EventPaused`. While it is set, answers, votes, survey answers and comments are
  refused. The round's phase is untouched, so resume returns to exactly where it was.
- End ends the session with the same `endSession` the host's own End uses (a copy in the websocket
  bundle). An **open survey refuses** ("close it on the stage"), because only survey-host's close
  step freezes its results.
- Billing: an event's sessions bill under one ledger key (`LEDGER#<period>#SESSION#EVENT#<code>`),
  so a whole event is one session (decision 1), and the reconciler still counts it.
- **The stage** (reworked the same day — see "Second round" below for why):
  - `/host/event/<code>` → `components/event/EventStage.jsx` is the **agenda board**: every item on one
    line with **Open** (the host's screen only) and **Go live** (the host's screen AND everyone's
    phones), plus Resume / Pause / End where the item's state allows. The dock's primary is the next
    obvious step (SPACE presses it), with QR and END EVENT beside it.
  - Open on a talk or a break shows its screen (s-02, s-05 with countdown and +5 min) as a preview.
    Open on an engagement goes to `/host?gameId=<child>&event=<code>`: today's host stage, plus an
    **AGENDA** dock door. The lobby QR and code are the event's.
  - Every item screen that is not live carries **Bring everyone here** (Bring everyone back, if
    paused) as its primary. AGENDA only navigates; it never pauses anything.
- Builder: **Run the event** (opens the stage in a new tab), Live/Paused/Done chips on started items,
  and Edit disabled on them.

### Attendees follow (M4)
- The attendee page polls `GET /events/{code}/agenda?view=now` every 4 s while visible. That is two
  plain reads and no decryption; the page re-reads the full agenda when the opaque `rev` moves.
- Inside an item, the session's own socket carries `eventItemPaused / Resumed / Started / Ended`
  and `eventEnded`. PlayerPage hands them up (`event.onFrame`), so a pause lands at once.
- When the host starts an item: the switch beat (p-07), then PlayerPage for that session, joined by
  **token** (`join-game.js` `attendeeToken` → `game/event-attendee.js`). No code and no name.
  - Each attendee gets one seat per session, found again by `AttendeeId` on return.
  - Namesakes get "Sam 2", and a hand-typed seat is never taken over.
  - JoinGameFunction gained `kms:Decrypt`, to open the attendee's sealed name.
- Paused (D1): "The host will be back", with Open the agenda. The session stays mounted underneath.
- Agenda anywhere (D3): an **Agenda** button in the player bar (`components/event/eventBar.js`
  context → PlayerShell). The live session is hidden, not unmounted, and "Back to live" returns to it.
- Break (p-09), talk (p-06) and the end of the day (p-08) screens. Phone, tablet and laptop come from
  the player's own ladders.
- `WebSocketClient.disconnect()` now detaches the old socket's handlers. Before this, its late close
  killed the next socket's heartbeat, which bit every item change.

## Second round, same day: preview, go live, fits every screen

The owner, testing: *"a host should be able to launch these if they exist from their main screen …
move back and forth between them … a host may bring up the agenda and switch to the second agenda item
but that doesn't open it for the players. Instead a different button … would switch to the host screen
and trigger the players as well. That way host can rehearse, preview etc. … this button on the bottom
of the screen … Finally need to make sure everything fits on the host's laptop/tablet/room screen.
They should not have to scroll."*

- **Launch from the main screen:** `components/WelcomeEvents.jsx`, under "Start an engagement": the
  org's running and upcoming events (running first, two at most so the page fits a laptop, the rest
  counted), each with Open → its board. Nothing is drawn for a host with no events.
- **Preview (backend):** `run.js` `prepare` makes an engagement's session in CREATED — unjoinable
  (session-gate: "Game not started"), no public link — and records `GameId` on the item, which stays
  `planned`. Go live (`start`) OPENS that same session (`child-session.js openChildSession`) instead
  of making another. Editing or removing the item, deleting the event, or ending the day with it
  still planned discards a prepared session, and its code with it.
  Talks refuse `prepare` (`not_an_engagement`); their preview is client-side only.
- **Go live after a finished item:** if the previous live item's session has ENDED, starting the next
  marks it done (`eventItemEnded`) instead of pausing it.
- **Fit, measured in Chromium** (a headless build against a local mock API, 27 Sep): welcome, the
  board at 9 and 18 items, talk and break screens, and the item lobby, at 1280×720, 1366×768,
  1024×768, 768×1024, 1180×820 and 1920×1080 — no page scroll, no dock button off-screen, no agenda
  row or "Coming up" row cut off, in all 54 combinations. What that took:
  - The board fits by measuring (`fitBoard`): as many columns as the height needs; dense rows past
    520px columns; `data-narrow` (no kind icon, closer gaps) under 440px. It is written to the DOM,
    not React state: the state version **crashed the page** ("Maximum update depth exceeded") on a
    1280→1366 resize.
  - "Coming up" gives rows to its "and N more" line until every row it shows is whole.
  - `styles/stage.css`: below 900px the dock wraps and the lobby's join block stacks. This was a
    **pre-existing** fault for every session: at 768 wide the dock ran 200px off-screen and the code
    was cut to "482".
  - Welcome: a two-column layout from 740px (portrait tablet) and tighter rhythm on short laptops. The
    library column overflowed 1280×720 before the Events block existed.
  - In an event, "Back to Menu" is gone from the item's dock: it duplicated AGENDA, and pushed SESSION
    off a 1024 dock.

## Decisions taken on the owner's behalf (each is small to change)

| # | Taken | To change |
|---|---|---|
| D1 | ~~Agenda mid-item pauses it.~~ **Superseded by the owner's second round:** AGENDA only navigates; Pause is its own button on the board row. | — |
| D2 | One live item, any number paused. | `run.js start` → refuse while one is live. |
| D3 | Attendees may browse the agenda mid-item, with "Back to live". | Drop `plr-agenda` from PlayerShell. |
| D5 | Host agenda on the wall (AGENDA panel). No remote Agenda tab yet — see below. | — |
| — | A live talk's "Go live: <next>" ends the talk, then starts the next item. | `EventStage.plan`. |
| — | Dock labels: "Go live: trivia", "Go live: the survey", "Go live: The FY27 plan". | `startWords`. |
| — | Arriving at the board while an engagement is live does NOT jump to it; the row says Live. | `EventStage` load. |

## Not built (next, in order of value)

1. **The day's standings** (decision 6): copy each scored item's final points onto attendee rows at
   `end`, and show "The day so far" on the break screen (s-05) and "Your day: 4th of 38" (p-08).
   Seats already carry `AttendeeId`, which is the join this needs.
2. **The phone remote's Agenda tab** (r-01/r-02). The remote still drives each item's session, as
   today.
3. **M5 presentations**: the PDF reference copy.
4. **Rehearsal** (s-06), the M0 mockups (s-07, s-08, r-01, r-02, p-10, p-11, p-12), invite-only
   events.
5. Carried from M1b and still open: `delete-set-version` should warn about event items pinned to that
   version; `clear-all-games`' stale-code edge.

## Verify on dev (walk it)

1. The host's main screen shows the event under **Run an event**; Open goes to its board. (Console →
   Events → **Run the event** still works too.) The board says Starting soon and "N joined".
2. On a phone, a laptop and a tablet, open `/play?event=<code>`, type a name once, and check that the
   agenda reads "Not started".
3. **Open** the second item. The host's screen shows it with "Preview — the phones are not here yet";
   the phones do not move. **AGENDA** returns to the board.
4. **Go live** on the first engagement (or "Bring everyone here" on its preview). The phones switch by
   themselves with "You're in as …".
5. Mid-round press **AGENDA**: nothing pauses, the row says Live. Press **Pause** on the row: the
   phones say Paused. **Resume**: they return to the same round.
6. Reload a phone mid-item. It should land back in the item with the same name and score.
7. End the item, then the event. Try each host screen on a laptop, a tablet (both ways) and the room
   screen: nothing should scroll.

## Gate at this commit

Backend 265 suites, 0 failed (`tests/verify-question-set-ui.spec.js` is a Playwright spec, not a node
suite) · frontend 395 suites, 9,521 tests · lint 0 errors (10 warnings, baseline) · build passes ·
api.md 167 routes.
