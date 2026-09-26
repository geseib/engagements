# Events and agendas: roadmap to dev

> **For agentic workers:** this is a ROADMAP. It covers several subsystems, so
> each milestone gets its own task-level plan in `docs/superpowers/plans/`,
> written when the milestone before it lands. The plan for M1 is
> `2026-09-26-events-m1-event-and-builder.md`. Execute each milestone's plan
> with superpowers:subagent-driven-development (maker/checker).

**Goal:** a Team-plan host builds an agenda of engagements, talks and breaks
under one join code and runs the day. Host and attendees move freely between
the agenda and each item. Attendees follow on a phone, tablet, laptop or
desktop.

**Architecture:** an event is a new `EVENT#<code>` record with ordered item
rows. Every engagement still runs as an ordinary one-set, one-type session,
created when the host starts that item and stamped with `EventRef`. A talk and
a break are agenda items with no session. Attendees join the event once and
receive a signed attendee token. Their connection is subscribed to the event
and to whichever item is live. The stage and the phone remote gain an event
mode, and the player page gains an event shell (agenda, talk, break, paused)
around today's unchanged engagement screens.

**Tech stack:** React (webpack + jest), AWS Lambda (Node 18 in the pipeline),
API Gateway HTTP + WebSocket, single-table DynamoDB, S3, Cognito, SAM.

**Spec:**
- `docs/design/agenda-redesign/`: the design. Read RATIONALE.md, PLAN.md and
  the mockups (open `index.html`).
- The owner's 12 decisions of 23 Sep 2026, listed at the top of RATIONALE.md.
- The owner's brief of 26 Sep 2026. It adds four requirements, all covered
  below:
  - the host can go back to the agenda from inside an engagement and return
    to it;
  - the host has an agenda view while the event runs;
  - attendees move back and forth between the agenda, a talk's slides and
    the live engagement;
  - attendee screens work on laptop, desktop and tablet as well as phone.

---

## 1. Where it stands (26 Sep 2026)

- **Built:** nothing. The design is 30 mockups and a phased plan, and there is
  no event code on dev.
- **Groundwork (PLAN.md Phase 0):**
  - 0a, 0c and 0d are already on dev.
  - 0b, the host-only broadcast filter, is Task 10a of the 26 Sep bug sweep
    (`2026-09-26-bugsweep.md`).
- **Other sweep fixes the event builds on:**
  - Task 2: a code whose old rows still exist is never reissued. This matters
    more for events, which hold one code much longer.
  - Task 4: a host can end a session. `end-item` reuses that helper.
  - Task 3: an older round cannot be re-closed. Event resume depends on round
    state never rewinding.
- **Reusable today (from the code map):**
  - Leaving a session and coming back already restores phase, answers, votes,
    roster and scores (`GameHostPage.jsx` `switchToGame`, ~1200).
  - The player's engagement screens are already responsive at three widths:
    `PlayerSurface.css`, phone, then 768px tablet, then 1200px laptop.
  - Reports-bucket storage, per-org encryption and the passkey download
    pattern are ready for slide copies.
- **Gaps the 23 Sep plan does not cover (the 26 Sep brief):**
  - **Leaving an engagement part-way.** `ITEM.State` is planned → active →
    done. "Back to the agenda" appears only after an item's last round
    (PLAN.md ~167, RATIONALE ~763), and there is no paused state.
  - **The host's agenda during the day.** The only agenda-shaped screen is
    the wall (`s-03-between`). No host-private view lists the items to start,
    resume or end.
  - **Attendees moving back and forth.** The phone screens are each shown
    alone. None shows how an attendee opens the agenda or the slides while an
    item is live and then gets back to it.
  - **Larger screens.** The `p-*` mockups carry the tablet and laptop
    ladders in their CSS, but only `p-05a` is drawn at laptop width. The
    agenda, talk, switch, break and paused screens have never been seen
    wider.
- **Phones lose their name between sessions today.** The ENDED screen is a
  dead end (`PlayerPage.jsx` ~2561) and the typed name is stored per game
  (`playerName_<gameId>`). The attendee token (M2) is what lets a phone
  follow along without typing the code or its name again.

## 2. Decisions the owner needs to make (each has a recommendation)

The milestones assume the recommendation. Changing one changes only the
milestone named.

| # | Question | Recommendation | Affects |
|---|---|---|---|
| D1 | When the host goes back to the agenda part-way through an engagement, what do attendees see? | The item is **paused**. Phones show "Paused — the host will be back", with the agenda one tap away. The wall shows the agenda with the item marked Paused. Answers already given are kept; answering reopens on Resume. | M3, M4 |
| D2 | Can more than one item be paused at once? | **Yes.** One item is live at a time, and any number can be paused. Starting another item pauses the live one first. Each paused item keeps a Resume button until the host ends it. Standings count an item only when it is ended. | M3 |
| D3 | Can an attendee browse the agenda while an item is live? | **Yes.** The attendee screen has an "Agenda" button everywhere. While an item is live, the agenda shows a "Back to live" bar and the live item's row is highlighted. Answering happens only on the item screen. Nothing is lost by looking away. | M4 |
| D4 | How does an attendee view a talk's slides? | **In the browser's own PDF viewer, opened in a new tab.** The copy is available once the talk starts (decision 8). "Open slides" and "Save a copy" sit on the talk screen and on that item's agenda row; the in-app screen stays on "Now presenting" behind it. This adds no PDF library, and the phone, tablet, laptop and desktop viewers all handle it. Alternative: an embedded viewer on tablet and laptop (costs a dependency, and on iPhone an embedded PDF shows only its first page). | M5 |
| D5 | Where is the host's agenda during the day? | **Two places, the same actions.** (a) The stage toolbar gets "Agenda": the wall switches to the between-items screen, and the host-only controls in the toolbar (Start, Resume, End item, End event) follow that screen. (b) The phone remote gets an Agenda tab listing every item with its state and the same actions. The agenda is public, so showing it on the wall reveals nothing private. | M3 |
| D6 | Should the feature ship to dev behind a switch? | **Yes.** `EVENTS_ENABLED` is off by default on test and prod and on for dev. It hides the Events console section and refuses `POST /events` when off, following the `TEAM_WORKIE_AUTHORING` precedent (`lambda-functions/admin/shared/prompt-access.js` ~51–61). Each milestone can then ship to dev as it is done without showing half a feature on test. | M1 |

## 3. Item and navigation model (with D1–D5 applied)

**Item state** (stored on `ITEM`, moved only by host routes):

```
planned ──start──▶ live ──agenda (pause)──▶ paused ──resume──▶ live
                    │                          │
                    └──────────end─────────────┴──▶ done
break:   planned ──start──▶ live ──end──▶ done      (never paused, no session)
talk:    planned ──start──▶ live ──end──▶ done      (pausable like an engagement)
```

- `EVENT.LiveItem` names the one live item, or none (the agenda is up).
  Starting an item while another is live pauses that one first, in the same
  write (a transaction with `ConditionExpression`s on both rows). Two host
  screens cannot then start two items at once.
- **Pausing an engagement:**
  - the item is marked paused;
  - `EVENT.LiveItem` is cleared;
  - a pause flag is written on the child session's STATE row, and answer and
    vote writes refuse while it is set;
  - `eventItemPaused` is broadcast.
  - **The round's phase is not changed.** Resume therefore returns to exactly
    the phase it left, using the restore the host page already has.

**Host.** Three surfaces share one set of actions:
- **Console builder:** planning before the day.
- **Stage:** the wall plus the toolbar.
- **Phone remote:** a control surface with an Agenda tab.

The actions are Start, Pause, Resume, End item and End event.

**Attendee.** One shell with three places, and today's screens inside the
item:

- **Agenda:** before the day, between items and during a break. While an item
  is live it carries "Back to live".
- **Item:** today's engagement screens, unchanged. A talk shows "Now
  presenting" with the slides links. A paused item shows the paused screen.
- **Slides:** the talk's PDF in a new tab. The app screen stays where it was.

When the host starts an item, a phone that is on the agenda switches to it,
with the 1.2-second switch beat (p-07). A phone that is looking at done items
gets the switch as well; no answer is lost, because none can be pending on an
item that is not live.

## 4. Milestones

Every milestone lands on dev the same way:
1. A task-level plan.
2. Maker/checker execution in worktrees.
3. One integration branch and the full gate (backend loop, frontend suite,
   lint, build), with baselines held.
4. A push to `dev` (Claude may deploy dev).
5. A walk in the browser pane at phone (375), tablet (768) and laptop (1280)
   widths, with screenshots in the handoff.

A milestone is not done until it has been walked on dev.

### M0: design the missing screens (no code)

Mockups first, because the mockups are the design. Build them in
`docs/design/agenda-redesign/` with the approved stylesheets, the same way as
the others, and add them to `index.html`.

- **Stage:**
  - `s-07-paused`: the wall with the agenda up and the paused item marked
    "Paused", Resume in the toolbar;
  - `s-08-toolbar`: the event-mode toolbar inside an engagement, with the
    Agenda button.
- **Remote:**
  - `r-01-agenda`: the phone remote's Agenda tab, each item with its state
    and the one action that fits (Start, Resume, End);
  - `r-02-confirm`: the confirmation shown before ending an item or the event.
- **Attendee:**
  - `p-10-paused`: the item-paused screen;
  - `p-11-agenda-live`: the agenda opened during a live item, with the "Back
    to live" bar;
  - `p-12-slides`: a talk with its slides opened.
- **Larger screens:** tablet (768) and laptop (1280) renders of `p-05`,
  `p-06`, `p-07`, `p-09`, `p-10` and `p-11` on the index board.
- **Done when:** the owner has looked at the board and answered D1–D5.

Estimate: one design session. **Needs the owner's eyes before M3/M4 code
starts.** M1 and M2 do not wait for it: their screens are already drawn
(01–07, p-05a, p-05, 10-join).

### M1: the event, its agenda and the builder (console)

Ships (behind `EVENTS_ENABLED`):
- Events in the console for Team-plan orgs, and the Personal-space
  explanation (01, 01b).
- New event (05), and the agenda builder (02, 02b): reorder, times that follow
  the order, and caps of 16 items and 8 engagements.
- Add an engagement (03), with set, pinned version, title, description and
  length.
- Add a break.
- Presentations appear in the add menu but are disabled with "Coming soon".
- The public read of the agenda (`GET /events/{code}/agenda`) and the code
  resolver (`GET /join/{code}`).

Backend work, per PLAN.md Phase 1 "Backend":
- keys in the three `tenant.js` copies;
- the `event` and `item` crypto entities;
- `reserveCode(db, {orgId, ttl, kind})` extracted and shared;
- `lambda-functions/events/` CRUD and item routes;
- server-side caps;
- the Team-plan gate;
- `EVENTS_ENABLED`.

`ITEM.State` is created with `planned` only.

Task-level plan: `2026-09-26-events-m1-event-and-builder.md`.

### M2: attendees join the event and read the agenda

Ships:
- `useJoinCode` asks `GET /join/{code}`. An event code routes to the event:
  the attendee types a name once and gets a signed attendee token
  (`attendees.js`), kept in `localStorage` under the event code.
- The attendee shell:
  - the pre-event agenda (p-05a), with every item "Not started" and its
    description;
  - the agenda at rest (p-05);
  - both at phone, tablet and laptop widths, from `PlayerSurface.css`'s
    ladders.
- A reload lands the attendee back where they were, identified by the token.

Tests: token signing and expiry, the join resolver, and a phone, tablet and
laptop render contract for the new screens (the existing `PlayerSurface`
CSS-contract test pattern).

### M3: running the day, host side

Ships:
- The event routes: `start-item`, `pause-item`, `resume-item`, `end-item` and
  `end-event`.
  - `start-item` creates the child session from the item's pinned set version
    and starts it. It stamps `EventRef`, skips the create gate and the meter,
    and makes the live/paused swap in one transaction (§3).
  - `end-item` reuses the sweep's end-session helper (Task 4) and copies the
    day's points (decision 6).
- The pause flag on the child STATE row is honoured by answer, vote and
  results writes.
- The stage's event mode, from `components/stage/AgendaWall.jsx`:
  - doors open (s-01);
  - between items, with the day's standings (s-03);
  - breaks with a countdown and +5 min (s-05);
  - Start item runs the wipe into the child lobby (s-04);
  - the toolbar's Agenda / Resume / End item (s-07, s-08);
  - "Now presenting" for a talk (s-02; slides arrive in M5).
- The phone remote's Agenda tab (r-01, r-02).
- Rehearsal with the doors closed (s-06). It writes nothing: no `GAME#`,
  `LEDGER#` or `REPORT#` row.
- A stage reload restores event mode: `LiveItem`, the paused items, and the
  child session through `switchToGame`.
- The event counts as one session (decision 1). The meter records
  `LEDGER#<period>#EVENT#<code>` once and skips `EventRef` sessions.

### M4: attendees follow, and move back and forth

Ships:
- **WebSocket:**
  - `connect.js` accepts an event connection (`EVENT#<code>/CONNECTION#…`);
  - `message.js` gains `follow`, which adds the child `GAME#<id>/CONNECTION#…`
    row;
  - the frames `eventItemStarted`, `eventItemPaused`, `eventItemResumed`,
    `eventItemEnded` and `eventEnded` are sent to the event's connections,
    host-only frames through the fixed filter (sweep Task 10a).
- **Joining an item:** `join-game.js` takes the attendee token in place of a
  typed name for an `EventRef` session. No code and no name are asked for.
- **The attendee shell:**
  - the switch beat (p-07) on `eventItemStarted`;
  - the paused screen (p-10);
  - the Agenda button and the "Back to live" bar (p-11);
  - the break screen (p-09);
  - the end screen (p-08);
  - inside an item, today's screens untouched.
- **Late joiners:** someone who joins while an item is live lands in it; if
  it is paused, they see the paused screen.

### M5: presentations

Ships:
- A presentation item (04): title, presenter, length and description, plus an
  optional PDF copy.
  - The upload goes to the reports bucket through a presigned PUT, then a seal
    step. It is encrypted per org as saved reports are (decision 5), and PDF
    only (decision 4).
- The talk runs as an item (start / pause / end).
- The wall shows "Now presenting" (s-02), and Engage never shows the slides
  (decision 8).
- Attendees get "Open slides" and "Save a copy" (p-06, p-12) once the talk
  has started, through a decrypting download route (the
  `download-saved-report.js` pattern).
- Before the talk starts, the copy is not reachable (decision 11), and the
  route refuses.

### M6: the whole day, end to end, then test

- A scripted walk on dev in the browser pane:
  - build a four-item agenda (trivia, talk, break, Call & Answer);
  - rehearse;
  - run it with a phone-width, a tablet-width and a laptop-width attendee;
  - pause the trivia part-way, run the talk, resume the trivia, end it;
  - check the standings and the reports.
- Fix what the walk finds (maker/checker).
- Turn `EVENTS_ENABLED` on for test only when the owner asks, then promote to
  test by merge. Test is merged into, never fast-forwarded.

### Later (not in this roadmap; each is a PLAN.md phase)

Invite-only events with personal passcodes (Phase 3), email invitations
(Phase 4), the hub and reports for attendees (Phase 5), survey items (Phase 6,
after the survey work) and event pricing (Phase 7).

## 5. Global Constraints (every milestone)

- **Deploying:**
  - The pipeline is the only route to dev, test and prod, and a push to a tier
    branch deploys.
  - Claude pushes `dev` only after the full gate: the backend loop with 0
    failed, `cd src && npm test` green, lint with 0 errors, and the build
    passing.
  - Never push a branch and a tag together.
- **Tenancy:**
  - Nothing outside `tenant.js` writes a bare partition literal.
  - Org content (event title, place, item titles and descriptions, deck
    names) is encrypted with a new crypto entity. Every read of it decrypts.
  - Another org's caller gets 404 on every host route.
- **Copies stay identical:** `tenant.js`, `tenant-crypto.js`, `session-ttl.js`
  and `set-version.js` exist as copies, and tests hold them equal.
- **Sets:** a child session plays the item's pinned `{scope, orgId, setId,
  version}` through `gameSetRef`/`refSetRef`. A bare id reads as a platform
  set.
- **Host sockets:** a HOST connection needs a single-use host ticket, and
  `message.js` obeys host frames only from the sender's own HOST row.
- **Players:** the attendee UI supports phone, tablet (≥768px) and laptop
  (≥1200px) through `PlayerSurface.css`'s ladders. Copy says "phone, laptop
  or tablet", never "phone" alone.
- **Design:** build from the rendered mockups in
  `docs/design/agenda-redesign/`, not from prose. Use the engage-design
  skill's rules: tokens, the container rule, dialog exits, measured
  contrast and CSS-contract tests.
- **Tests:**
  - backend: `node tests/<file>.js` by exit code, async suites arming
    `tests/helpers/finish-guard.js`, and paged reads tested with
    `tests/helpers/paged-table.js`;
  - frontend: `cd src && npm test`, never `npx jest`;
  - the pipeline runs Node 18.

## 6. Review Focus (for every milestone's reviewers)

1. **A reload in the middle of an item.**
   - An attendee's device that reloads lands in the live item, with the same
     name and score. If the item is paused, it lands on the paused screen,
     never on the join form.
   - The host's stage that reloads restores event mode and the live or paused
     item.
2. **Two host screens act at once.** Stage and remote press Start on
   different items within a second. Exactly one item ends up live, the other
   is refused with a message, and no child session is orphaned.
3. **An attendee looks away and comes back.** They open the agenda or the
   slides during a live question, and the question closes meanwhile. "Back
   to live" shows the current phase. An answer they had already sent is
   counted once.
4. **Late joiners and leavers.**
   - An attendee who joins during a break, a talk or a paused item sees that
     screen.
   - An attendee who closes the tab and reopens it hours later rejoins
     without typing anything, while the event is open.
5. **Code lifetime.**
   - An event's code is never handed to a new session while the event or its
     children have rows (sweep Task 2's rule, extended to `EVENT#`).
   - A child session's own id never collides with the event code.
