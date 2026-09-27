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
- **The stage:**
  - `/host/event/<code>` → `components/event/EventStage.jsx`: before the day (s-01), between items
    (s-03), a break with countdown and +5 min (s-05), a talk or an activity (s-02). The dock's
    primary button is the next obvious step, and SPACE presses it. **AGENDA** opens every item with
    its own Start / Resume / Pause / End, plus "End the event…".
  - Starting an engagement runs the wipe and navigates to `/host?gameId=<child>&event=<code>`: today's
    host stage, plus an **AGENDA** dock door (pauses the item, or ends it if the session has ENDED).
    The lobby QR and code are the event's. "Back to Menu" goes to the agenda instead.
  - If another screen moves the day on, the item's stage goes back to the wall.
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

## Decisions taken on the owner's behalf (each is small to change)

| # | Taken | To change |
|---|---|---|
| D1 | Agenda mid-item pauses it; phones show "Paused". | `GameHostPage.goToAgenda` → `end` instead of `pause`. |
| D2 | One live item, any number paused. | `run.js start` → refuse while one is live. |
| D3 | Attendees may browse the agenda mid-item, with "Back to live". | Drop `plr-agenda` from PlayerShell. |
| D5 | Host agenda on the wall (AGENDA panel). No remote Agenda tab yet — see below. | — |
| — | A live talk's "Next:" ends the talk, then starts the next item. | `EventStage.plan`. |
| — | Dock labels follow the mockups: "Start trivia", "Start the survey", "Start The FY27 plan". | `startWords`. |

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

1. Console → Events → an event → **Run the event**. The wall should say Starting soon, show the
   event code and QR, and read "N joined".
2. On a phone, a laptop and a tablet, open `/play?event=<code>`, type a name once, and check that the
   agenda reads "Not started".
3. Start the first engagement on the wall. The phones switch by themselves with "You're in as …".
4. Mid-round press **AGENDA**. The phones say Paused. Start a talk: the phones say "Look up". Resume
   the engagement from the AGENDA panel: the phones return to the same round.
5. Reload a phone mid-item. It should land back in the item with the same name and score.
6. End the item, then the event.

## Gate at this commit

Backend 265 suites, 0 failed · frontend 393 suites, 9,498 tests · lint 0 errors (10 warnings,
baseline) · build passes · api.md 167 routes.
