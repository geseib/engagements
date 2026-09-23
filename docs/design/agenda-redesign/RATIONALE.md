# Events and agendas — rationale

> **Future work, not scheduled.** This folder is design only: mockups and
> documents. No product code has been changed and nothing is deployed by it.

The owner's brief, verbatim:

> "in the future a bigger piece of work is going to be the ability to string
> together multiple types of sessions using the same code. so i as a host could
> say i want to have an agenda with 1\intro survey, 2\preso, 3\trivia/quiz,
> 4\call&answer, 5 different preso, 6\different quiz, 7\call and answer,
> 8\survey. and i could even create a schedule upload presos, and the invite
> people to a locked sessions they would get a code that they need to match with
> their email. that session would have an agenda page, link to all reports,
> presos, survey results. and when the host triggers an engagement the screen
> will go to the player mech that we have."

## Decisions and open questions

Twelve questions, all decided (11 by default, which the owner may overrule). The first draft's eleven keep
their original numbers; number 12 was raised by the answer to number 1. The
reasoning behind each is in §a–§c below. `index.html` shows the same list.

**Decided** (owner, 23 Sep 2026) — all twelve

1. **Billing — DECIDED (owner, 23 Sep 2026).** *"yes count for now as 1
   session. but i think ultimately these are more expensive sessions that are
   only avail on orgs. so instead of .25 they are $1 but you can have up to 16
   agenda items with 8 of them being engagement sessions."*
   - **Now:** a whole event counts as **one session**. It uses one of the plan's
     5 included sessions, then $0.25 on the Team plan (`pricing.js`). It is
     recorded once per event; the sessions its items create are not counted
     again.
   - **Later, event pricing:** an event becomes its own billable unit at **$1 per
     event** instead of $0.25 per session. It is **only available to
     organisations on the Team plan**; a Personal space does not get Events.
     Refined by decision 12: one event a month is included, then $1 each, on
     an allowance separate from sessions.
   - **Caps, from the first release:** at most **16 agenda items**, of which at
     most **8 are engagements** (Call & Answer, trivia, survey, poll,
     wavelength). Presentations fill the rest. The add menu disables the
     engagement kinds at 8 and says why; the server refuses a 17th item or a 9th
     engagement.
   - **Drawn as:** the end state. `01-events` is what a Team-plan organisation
     sees; `01b-events-personal` is what a Personal space sees instead (what an
     event is, and the one way in, **Request the Team plan**). Whether a
     Personal space gets events *before* event pricing ships is not settled by
     the answer's "ultimately"; the proposal is no, so nothing is taken away
     later. `02b-cap-reached` draws the cap.

2. **Invitations — DECIDED.** *"yes. but you are right for now no email is
   needed, perhpahs just the passcode."*
   - **How this design reads it** (the owner can correct this):
     - Each invitee gets a **personal passcode**: the six-character code,
       still stored only as a keyed fingerprint.
     - The host hands it out however they like: copy it, download the CSV,
       or print cards.
     - Joining is **the event code plus that passcode**, or a personal link
       carrying it.
     - **No email is typed to join, and none is sent.**
     - The invitation list records each person's **name**. An email is
       optional and only for the host's own records.
   - **Sending email from Engage is approved in principle for later** (PLAN
     Phase 4). Matching the email at the join comes back only if that ships.
   - **Drawn:** `06-invitations`, the `10-join` board and `p-01`…`p-04`.
3. **Reports for attendees — DECIDED.** *"yes, allow seeing full report.
   with an option to turn this off, so the report is not shared, or is only
   anonymous."*
   - **One setting, three values:** **Full** (the default), **Anonymous**
     (every name removed) or **Not shared**.
   - **Where it lives:** it is chosen per event when the event is made (05),
     and can be overridden per item in the hub (07).
   - **Anonymous is produced by the server.** It is a second saved PDF,
     rendered from a report payload the server has already stripped of
     names. It is never hidden on the client.
   - **Names can be removed but never added back.** Phones say "with names"
     when people join, so once anyone is in, Full can move to Anonymous or
     Not shared, and Not shared to Anonymous, but nothing can move to Full.
   - **For a survey item, Full still means no names.** Its shared results
     never carry names, whatever the survey's Names setting
     (`survey-redesign/RATIONALE.md` §3).
   - **Drawn:** `05`, `07`, `p-01` (the promise), `p-05` and `p-08` (the
     links).
4. **Presentations are PDF — DECIDED.** *"yes pdf would be the default way
   for now."* Converting .pptx is not in any phase.
5. **Decks are app-encrypted per organisation — DECIDED.** *"yes"*
   - Decks use the org envelope saved reports use: `save-report.js` writes
     `.pdf.enc` (`:82-94`), and `download-saved-report.js` opens it through a
     decrypting Lambda.
   - Events are org-only, so there is no orgless case to decide.
6. **Standings — DECIDED.** *"both"*
   - **Each scored item keeps its own standings**, in its report and on its
     own results screens, as today.
   - **The day has standings too.** They are the **sum of every scored
     item's final points**: trivia, plus Call & Answer's placement points.
     Surveys, polls, wavelength, talks and breaks add nothing.
   - **Where they are stored:** when an item ends, each player's final points
     are copied onto their attendee row (`Points {itemId: n}`, `DayTotal`).
     So the day outlives the 7-day sessions.
   - **Drawn:**
     - the day's standings beside the countdown on the break screen (s-05);
       the between-items screen gains the same column once anything has
       been scored;
     - a table in the hub (07);
     - "Your day: 4th of 38" on the final phone (p-08).
   - **Names follow the report setting (decision 3).** The wall and the hub
     show names when reports are Full; otherwise Player N.
7. **Breaks — DECIDED.** *"breaks should be listed but dont count toward any
   count as there is nothing to store or present other than perhaphs a
   timer."*
   - **Break is an agenda item type.** It has a title, a length, an optional
     description and a return time, and it has its own group in the add menu
     ("Just on the agenda").
   - **It counts for nothing.** It has no number, is left out of the 16-item
     and 8-engagement caps ("1 break (not counted)" in the builder's foot),
     is never billed, and stores nothing.
   - **On the wall** (s-05) it is a countdown to the planned return. The
     countdown stops at 0:00, and +5 min moves the return time.
   - **On the phone** (p-09) it says "Back at 10:28".
8. **Presenting — DECIDED.** *"i think for now we will assume the slides are
   being shared via their own preso mode. the only share is the copy for
   others to have and reference."*
   - **Engage never shows or drives slides.** There is no page rendering, no
     on-stage viewer and no next-slide control.
   - **The PDF is only a reference copy**, which attendees open from their
     agenda (a per-deck switch, on by default).
   - **The stage holds a quiet "Now presenting" screen** during a talk, for
     rooms where the projector stays on Engage.
   - **Outside presenters are no longer a question.** The first draft's
     question about a presenter from outside the org driving the slides
     falls away: nobody drives anything in Engage.
9. **Rehearsal — DECIDED.** *"yes. not sure what all that includes, but for
   now make it simple."*
   - **One button on the event:** "Rehearse on the stage" (02). It replaces
     the first draft's two stage buttons.
   - **It reuses the session-setup design's Preview model**
     (`session-setup-redesign/RATIONALE.md` §d): a *view* of something not
     yet open, not a stored state. Joins are refused, and a phone that scans
     waits.
   - **What it does:** the host steps through each item's stage screen, and
     an engagement's questions read-only from its pinned set.
   - **What it never does:** create a session, bill or count anything, save a
     report, touch the hub, or contact an invitee.
   - **The wall marks it** with the Preview's dashed chip and dashed band
     (s-06).
   - No rehearsal analytics and no practice answers.
10. **Keep for a year — DECIDED.** *"no only the report. but that brings up
    an interest concept (templates) - shelf that one for now."*
    - **"Keep reports for a year"** keeps only the saved reports, for 365
      days. Event rows and reference copies still go 90 days after the event.
    - **Event templates are shelved** (below). The new-event dialog's "Copy
      the agenda of…" picker is **removed**: it was templates half-built, and
      leaving it would define that concept by accident.
11. **Before the day, and the survey dependency — DECIDED BY DEFAULT (the
    owner may overrule).** The first draft asked this as "can events ship
    before surveys work?", which was unclear. In plain words: *do events have
    to wait until surveys can be played?*
    - **The default: no.** Events ship with trivia, Call & Answer, poll and
      wavelength. Survey appears in the add menu once `survey-redesign`
      ships.
    - **The owner's answer added a requirement:** *"i think events agendas can
      be visable, but the slides, surveys, and engagements should not be
      active until each one is activated during the event. but before hand
      people can visit the agenda see descriptions of the sessions etc."*
      - **A pre-event agenda page** (p-05a). It shows each item's time,
        title, type, presenter and **description**, a new field on every
        item (03, 04), each marked "Not started".
      - **Nothing is active beforehand.** No engagement can be answered and
        no survey opened. A presentation's reference copy appears only once
        the host starts that talk, and then it stays.
      - **Item state:** planned → active → done. Only the host's Start moves
        it.
      - **The same page serves before, during and after:** p-05a, then p-05,
        then p-08. On a laptop it is the player's laptop ladder, with the
        gutter absorbing the width (board 11).
    - **Who can see it before the day (a proposal, flagged):**
      - for an open event, anyone with the event code or link;
      - for an invite-only event, only someone who has entered their
        passcode. Entering it early takes that phone's seat, so on the day it
        is already in.
12. **Event pricing — DECIDED.** *"keep them separate with 1 free per month
    billed."*
    - **Events have their own allowance, separate from sessions.** On the
      Team plan one event a month is included, and each further event that
      month is $1.
    - **Events never draw on the 5 included sessions.** The Personal plan has
      no events (decision 1).
    - **Drawn:** the billing line in `05` and the note in `01`.

**Open** — none. Question 11 is decided by default and can be overruled.

**Shelved concept**

- **Event templates**: reuse an event's agenda as a template for the next
  one. It came up in the answer to 10 and is not in any phase. The copy
  picker was removed so nothing half-builds it.

---

Mockups: `index.html` lists them. Serve with the `all-design-mockups` launch
config (:8124) and open `/agenda-redesign/`. Built by `_src/build.py` from the
approved stylesheets, read at build time and never retyped:

| Surface | Base, inlined verbatim | What this set adds |
|---|---|---|
| Console (laptop) | `admin-redesign/_src/shell.css` | `_src/agenda-console.css` |
| Phone | `player-redesign/build.py` CSS (the shipped `PlayerSurface.css`) | `_src/agenda-phone.css` |
| Wall | `refresh-2026-09-22/_src/stage-base.css` + `refresh-stage.css` | `_src/agenda-stage.css` |
| Design-notes rail | tail of `marketing-redesign/mk.css` + `notes.js` | nothing |

Every new class is prefixed `ag-`. No `.ag-`, `.ev-`, `.event` or `.agenda`
selector exists anywhere in `src/src` or `docs/design` (searched across all 79
stylesheets). The helpers in `_src/build.py` are copied from
`survey-redesign/_src/build.py`, not imported, because that folder is being
edited at the same time. `write()` refuses any page that fetches something or
that contains one of the repo's banned deploy phrases.

**Rendered, and looked at.** Every page was opened in the browser pane: console
at 1600×1000, phones at 390×844, the wall at 1920×1080 in the Room profile.
These defects were found that way and fixed before this file was written:

- On the data-model page, the code blocks wrapped mid-key at three columns. It
  now uses two columns, with shorter lines.
- The new-event dialog cut off the place field.
- The phone's between-items screen said "Trivia is next" twice: once in the
  headline and again in the list. The headline now copies the approved
  between-rounds screen ("Nothing to do here.").
- The phase wipe vanished before a still page could show it. The trigger
  mockup now holds its visible frame; the product plays it once.
- The builder had two filled amber buttons.
- The invitation subject line was cut off with no `title` to recover it.
- Two `{{…}}` braces printed literally in design notes.

The second round, which applied the owner's answers 1–5, 8 and 12, was
rendered the same way. It found and fixed:

- The cap page's Agenda tab still counted 8 items against a table of 10.
- The "Now presenting" screen showed the code twice, once in the rail and
  once in the join block. The rail now drops it, as the between-items screen
  does.
- The presentation dialog's "copy for attendees" switch inherited the
  shell's muted, 600-weight `.field > label` style. It is restated as body
  copy.
- The "Goes after" select was cut off in a quarter-width column.
- A design note printed `{{id}}` literally again.

The third round (answers 6, 7, 9, 10 and 11) found and fixed:

- The wall's agenda list clipped its last row once a break made it 9 rows
  long. It now shows 7 rows and counts the rest ("and 2 more, until 11:43").
- The phone's break row said "Break" twice. It now says when to be back.
- The break and "Now presenting" screens repeated their rail chip in a
  kicker. Those kickers are gone or now say something else ("Back at
  10:28").
- The hub's run time ended before the new planned end.

Two traps found in the survey work were avoided up front:

- The admin shell owns `.top`, so nothing here uses that name.
- The player mockup's `font:800 … inherit` shorthand is invalid. It is restated
  as `font-family:inherit` plus a separate weight, at the top of
  `agenda-phone.css`.

---

## a. Where it stands today (23 Sep 2026)

Every line below was read in the file cited.

### 1. A session is one code, one set, one type

- **The code is the session's id.** It is 4 digits, drawn from 1000–9999
  (`websocket/create-game.js:192`). It is used as `GAME#<code>` everywhere.
  Creation makes up to 8 draws, then returns 503 (`create-game.js:187-254`).
- **The code is locked by a conditional put.** The put writes `PK=GAMES,
  SK=GAME#<code>` under `attribute_not_exists(PK)`, and the row holds only
  `orgId` and `ttl` (`websocket/schema-compliant-manager.js:109-124`). The
  org's index row is `ORG#<org>#GAMES` (`tenant.js:157-161`).
- **METADATA pins exactly one set and one type.** The scalar fields are
  `QuestionSetId`, `QuestionSetScope`, `QuestionSetVersion`, `GameType` and
  `orgId` (`schema-compliant-manager.js:192-205`). STATE starts at `CREATED`
  (`:242-257`).
- **Neither can change later.** `update-game.js:28-32` refuses to change the
  type or the set, because the category shuffles and `STATE#CATS` are derived
  from them. It also edits only `CREATED` sessions (`:151-155`).
- **A per-round pin already exists.** Every round writes `QUESTION#<n>#REF`
  with the set id, scope and version (`game/next-question.js:1108-1128`).
  `get-question.js:90-116` and `get-game-state.js:207-234` resolve the round's
  set from that row.
- **Nothing strings sessions together.** None of `switchSet`, `changeSet`,
  `nextSet` or `roundSet` exists. The only "switch game" leaves the session
  (`GameHostPage.jsx:4130-4143`). Its button is labelled "Back to Menu"
  (`components/stage/SessionSetupPanel.jsx:1069`).

### 2. Lifecycle and retention

- **Retention.** A session is kept 90 days unstarted and 7 days once started
  (`session-ttl.js:29-30`). `/start` applies the 7-day rule
  (`start-game.js:71`).
- **Gap: the lobby path keeps 90 days.** The lobby's "Start First Round"
  skips `/start`: `next-question.js:799` accepts `CREATED` directly. On that
  path the 7-day TTL is never written.
- **There is no end route.** `ENDED` is written only when `next-question`
  runs out of questions (`next-question.js:1052-1096`).
- **The host's phases:**
  - Raw states: `CREATED`, `STARTED`, `ASK#nnn`, `VOTE#nnn`, `RESULTS#nnn`,
    `ENDED`.
  - The host phase list is `HOST_PHASES` (`config/hostControls.js:52`).
  - `FIELD_NOTES` and `FEEDBACK` are beats inside RESULTS that exist only in
    the browser (`:89-91`).

### 3. How a phone joins and follows

- **The address.** Any path starting `/play` renders the player
  (`App.jsx:246-248`), which reads `?gameId=` (`PlayerPage.jsx:412-421`).
- **Typing a code.** The join box checks `GET games/{code}` and then
  navigates (`hooks/useJoinCode.js:69-99`). A 4-digit code is also assumed
  when a code is parsed out of a URL (`:14`).
- **Joining.** Joining is `POST /games/{id}/players`, with no sign-in
  (`template-clean.yaml:2872-2877`).
- **Identity.** The player's key is the typed name, `PLAYER#<name>`
  (`join-game.js:326-342`). Players are "deliberately unauthenticated"
  (`joinResult.js:9`), and no email is ever collected.
- **The WebSocket.**
  - `connect.js:9-11` takes one `gameId`. It writes `GAME#<id>/CONNECTION#<connId>`
    with a 2-hour ttl (`:30-43`).
  - `disconnect.js:14-20` scans for `SK=CONNECTION#<connId>` across every
    partition.
  - The player listens for 13 message types (`PlayerPage.jsx:667-823`) behind
    an ordering guard (`:379-395`).
- **A likely bug an event would inherit.** The broadcast helper's HOST and
  PARTICIPANTS filters test `conn.IsHost`
  (`schema-compliant-manager.js:636-638`). But `connect.js` writes
  `ConnectionType`, so a targeted broadcast reaches nobody.

### 4. Private sessions: backend only

- **The fields.** `Visibility` and `AccessCode` are stored on METADATA
  (`schema-compliant-manager.js:216-217`) from the create body
  (`create-game.js:91`, `:225-226`).
- **The check.** `game/session-gate.js:74-116` compares one shared code as a
  plain string. Missing code → 401. Wrong code → 403. Private with no code
  stored → 500.
- **The code is not encrypted.** `AccessCode` stays plaintext
  (`tenant-crypto.js:252`).
- **No host can turn it on.** The create request never sends either field;
  `createGame.js:99-101` says "the setup dialog has no visibility control
  today".
- **The phone's screen is a dead end.**
  - "This session is private." appears only after a 401
    (`PlayerPage.jsx:2254-2300`, `joinResult.js:77-78`).
  - It tells players to read the code off the main screen (`:2284`), and no
    screen shows it.
- **The earlier mockup.** `player-redesign/04-join-locked.html` proposed a
  host-chosen word on one screen with the name. Only its look was reused
  (`JoinNameCollision.jsx:65-67`).

### 5. Invitations and email

There are two unrelated "invites", and neither sends anything.

- **The session invite copies text.** `config/invite.js:141-183` builds text
  holding the `/play` link and the code. `InviteDialog.jsx:66-77` copies it to
  the clipboard. Its date is kept only while the dialog is open
  (`InviteDialog.jsx:42-43`).
- **The org-member invite writes records and sends no email.**
  - It writes `ORG#<org>/INVITE#<token>` plus `INVITEE#<email>`, and lasts 14
    days (`admin/orgs/invite-member.js:95-158`, `org-guards.js:216-243`).
  - Its header reads "IT SENDS NO EMAIL" (`invite-member.js:4-7`).
  - Delivery is a copied link or a `mailto:` (`TeamPanel.jsx:119-121`,
    `:327-335`).
  - **A code matched to an email already exists here.** Acceptance refuses a
    signed-in email that differs from the invitation's
    (`accept-invite.js:91-93`).
- **Where SES is used.**
  - Only as Cognito's sender, from `Engage <no-reply@seibtribe.us>`
    (`template-clean.yaml:5155-5158`).
  - `@aws-sdk/client-sesv2` is a dependency (`lambda-functions/package.json:16`),
    but nothing calls `SendEmailCommand`.
  - The only SES code is a kill switch that turns off sending for the whole
    account (`monitoring/actions.js:12`, `:22-24`).

### 6. Presentations: absent

- **No deck anywhere.** Nothing uploads, stores or displays a slide deck. No
  code handles pptx or Keynote.
- **The one file reader returns text.** `admin/parse-document.js`:
  - takes PDF, Word, text or Markdown up to 5 MB (`:25-37`, `:43-60`);
  - returns **text only** (`:74-79`), for question generation.
- **The upload pattern to copy.** Question images go up by presigned PUT
  (`media-upload-urls.js:165-169`): images only, up to 12 MB
  (`shared/set-media.js:52-67`).
- **Why decks can't go in the media bucket.** Its policy grants
  `s3:GetObject` to `*` on `${MediaBucket.Arn}/*`
  (`template-clean.yaml:4834-4844`). No prefix in it can be private.
- **The reports bucket is private.** It deletes objects tagged
  `retention=standard` after 90 days, and `permanent/` objects after 365
  (`:4749-4758`).
- **The stage never goes full screen.** Its largest image is 44% of the
  screen height (`styles/stage.css:833-834`).

### 7. Scheduling: absent

- No start time is stored anywhere. Searches for `scheduledAt`, `startsAt`,
  `.ics` and `VCALENDAR` find nothing.
- Players can't join a session before it has started
  (`session-gate.js:57-69`).

### 8. Reports: per session, per round

- **One session per report.** `create-report.js` reads only `GAME#<id>`
  (`:42`, `:55-179`).
- **Built per round.** It builds one section per round (`:418-699`), plus
  session totals including `playerPerformance` (`:826-908`).
- **The data lives 30 days.** It writes `GAME#<id>/REPORT` with a 30-day ttl
  (`:911-916`).
- **Saved reports outlive the session.**
  - `save-report.js` writes `REPORT#<game>#<savedAt>#<hex>` under
    `ORG#<org>#REPORTS` (`:161-182`).
  - It keeps them 90 days, or 365 if kept for a year.
  - The PDF is app-encrypted for an org (`:82-118`).
- **Saving has no sign-in.**
  - `POST /games/{id}/save-report` has no `Auth:`
    (`template-clean.yaml:2549-2556`).
  - It never calls `callerMayDriveSession`.
  - The client uses plain `fetch` (`GameReport.jsx:141`).
- **Where reports appear.**
  - The list is scoped to the caller's org (`get-reports.js:24-60`).
  - It is mounted in the console (`AdminPage.jsx:2044`) and on the host's
    Reports door (`HostReportsDialog.jsx:39`).
  - `GameReport.jsx` renders one section per round (`:465-474`), on paper
    (`:217`).

### 9. Tenancy

- **Keys.** Every key is built in `tenant.js`. Its three copies must be
  identical (`tests/tenant-keys.js:195-210`).
- **The literal guard.** `tests/no-global-partition-literals.js:90-112` fails
  the build on a bare `'SETS'` or `'GAMES'` string outside `tenant.js`.
- **Who may drive a session.** `callerMayDriveSession` (`tenant.js:323-330`)
  allows members of the session's org. Being in `admins` adds nothing, and
  routes answer 404, not 403.
- **Encryption.**
  - Fields are encrypted per entity (`tenant-crypto.js:148-362`).
  - An unknown entity throws (`:610-619`).
  - `PlayerName` stays plaintext (`:354`).
- **The handoff's rules.** `docs/handoff/multitenant-saas-2026-08-23.md`
  rules 1–5 (`:31-47`) and §7 (`:562-566`).

### 10. Billing

- **The unit is a session.** It is billed once, on the first successful join
  (`usage.js:21-35`). The meter is `recordBillableSession` (`usage.js:150-206`).
- **The meter is not wired.** No handler calls it; a grep finds only its
  three definitions.
- **The gate fires on every create.** It refuses a new session when the plan
  is used up (`websocket/create-game.js:162-172`).
- **The plans.** 5 sessions are included, then $0.25 each (Team) or an
  upgrade (Personal) (`pricing.js:47-94`).
- **So an event of eight items is eight sessions** under today's rules, and a
  Personal host could be refused at item 2 in front of the room.
- **Decided (owner, 23 Sep):** an event counts as one session for now. Later,
  events are Team-plan only, on their own allowance: one a month included,
  then $1 each, never drawn from the included sessions. Capped at 16 items
  with at most 8 engagements. See **Decisions and open questions**, numbers 1
  and 12.

### 11. Survey

- **Survey is unplayable** (`config/gameTypes.js:159`), and the backend
  mirror agrees (`game/game-types.js:23`).
- **The survey design leaves this question to us.**
  `survey-redesign/RATIONALE.md` §5, question 1, sets aside a closing survey
  inside another session as "a mixed-type session, which is **not** in this
  plan". This design answers it without mixing types: the closing survey is
  its own item.

---

## b. The model

**An event is an agenda that runs as ordinary sessions, in order, behind one
code.**

- **An event** belongs to an organisation. It has:
  - a title, a date, a start time, a time zone and a place;
  - an access rule: `open` (anyone with the code) or `invite` (the event code
    plus a personal passcode the host hands out; decision 2);
  - a default for what attendees get of each report: `full`, `anonymous` or
    `none` (decision 3);
  - one four-digit code;
  - an ordered list of items;
  - a state: `DRAFT → SCHEDULED → LIVE → ENDED`.
- **The one code:**
  - It is reserved when the event is created, in the same `GAMES` partition
    and under the same conditional put a session uses. So an event code and a
    session code can never collide.
  - The event's id is its code (`EVENT#5307`), just as a session's is
    (`GAME#<code>`).
  - The reservation row gains one field, `Kind: "event"`, so `/play?gameId=5307`
    needs one small read (`GET /join/{code}`) to learn which it is.
- **An item** is one of the kinds below. Every item has a title, a
  description (shown on the agenda before and during the event) and planned
  minutes. Its state moves planned → active → done, and only the host's
  Start moves it: nothing is answerable, and no copy can be opened, before
  an item is active (decision 11). The kinds:
  - an **engagement**: a type (survey, trivia, Call & Answer, poll or
    wavelength) plus a set, pinned to the version reviewed when it was added;
  - a **presentation**: a talk given from the presenter's own screen. It can
    carry an optional PDF **reference copy** for attendees. Engage never shows
    or drives the slides (decision 8).
  - a **break**: a return time and nothing else. It is not numbered, not
    counted in the caps, not billed, and stores nothing (decision 7).
  - The planned times are the event's start plus the running total.
- **When the host starts an engagement item**, the server runs today's create
  and start path for that item's set. The result is an ordinary session
  (`GAME#8816`), stamped `EventRef {code, itemId}`.
  - Nothing that plays a session changes: the phase machine, the reveal, the
    report and the set pin all still see one set of one type.
  - `EventRef` is read in exactly three places:
    - the join gate (an invite-only event's session refuses a bare code);
    - the usage meter (the event is billed, not each item);
    - the stage ("Back to the agenda").
- **Items become sessions late**, when the host presses Start. An event booked
  a month ahead therefore holds one code, not nine.
- **Phones follow; they are never re-joined.**
  - A phone joins the **event** once. In an open event that means typing a
    name. In an invite-only event it means the personal passcode; the name
    comes from the invitation list.
  - The phone keeps a signed attendee token.
  - When an item starts, each phone registers its existing connection under
    the new session and joins it as a player from its attendee row. No code
    is typed and no name is typed.
  - `disconnect.js` already removes every row with that connection's key.
- **A presentation lives on the presenter's screen, not Engage's**
  (decision 8).
  - If the projector stays on Engage, the stage holds on "Now presenting":
    the talk, the presenter, the one code, and what comes next.
  - Phones say "look up" and offer the reference copy, when it is shared.
- **Reports and results attach to items.** When an engagement ends, the stage
  saves that session's report through today's path, twice:
  - the full report;
  - an anonymous one, rendered from a payload the server has already stripped
    of names.
  - The item keeps both `REPORT#` keys.
  - **The hub** lists every item with its report, reference copy and results.
    It is built from saved reports, because session rows expire 7 days after
    start.
  - **The attendee agenda** shows, per item, what the setting allows (Full by
    default), plus reference copies and survey results that are shared.
  - **The event report** is a cover page followed by each item's existing
    report section.
- **The agenda page** is one page for before, during and after (p-05a, p-05,
  p-08).
  - For an open event, anyone with the code can see it.
  - For an invite-only event, only someone who has entered a passcode can
    see it (proposal, decision 11).
- **The day's standings** are the sum of every scored item's final points.
  They are copied onto attendee rows when each item ends (decision 6).
- **Rehearsal** is a view of the event on the stage with the doors closed.
  It writes nothing (decision 9).
- **Retention.**
  - Event, item, invitation and attendee rows are kept 90 days after the
    event, matching standard reports. "Keep reports for a year" extends only
    the reports (decision 10).
  - A session keeps its own 7 days.
  - Saved reports keep their 90 or 365 days.
  - Reference copies are kept 90 days from the event, not from the upload:
    they are re-tagged at event end so the bucket's 90-day rule counts from
    then. They are sealed in the org envelope (decision 5).

The rows, keys, lifetimes and routes are drawn in `40-data-model.html`.

---

## c. Decisions, one per part of the brief

### "string together multiple types of sessions using the same code"
**Decision:** an event is a sequence of ordinary sessions, not one mixed-type
session.

- **Why:** every reader assumes one type and one set. That covers the METADATA
  pin, the category shuffles and `STATE#CATS` that `update-game.js:28-32`
  refuses to disturb, `hostPhaseSequence`, the report builder, and the AI
  summary's type defaults.
- **The cost of the alternative:** a mixed session would mean rebuilding
  those derived rows mid-session and teaching every one of those readers
  about mixed types.
- **What the event model does instead:** it moves the join code up one level
  and leaves the session alone.

### "an agenda with 1\intro survey, 2\preso, 3\trivia/quiz, 4\call&answer …"
- **The builder is a place in the console** (01, 02), under Sessions,
  because an event has three tables: agenda, invitations, reports. The set
  editor is a place for the same reason (`AdminPage.jsx:1813`).
- **Adding an item.** The add menu has seven kinds in three groups:
  - "Answered on phones": survey, trivia, Call & Answer, poll, wavelength;
  - "Talks": presentation;
  - "Just on the agenda": break.
  - It is a popover, so the one dialog behind it is the set picker (03),
    which shows only sets of the chosen type.
- **The caps** (decision 1): at 8 engagements the five engagement kinds
  disable with the reason, and Talks and Break stay open (02b). Breaks count
  toward nothing.
- **Reordering.** Drag the grip, press ↑ / ↓, or use Alt+↑ / Alt+↓. Drag is
  never the only way (WCAG 2.5.7). Order is a field, so a reorder rewrites
  numbers, never keys.
- **Versions.** The version is pinned when the item is added, and "Use v3" is
  offered when a newer version exists. It is never updated silently.
- **Duplicates.** A set may appear twice, and says so ("On this agenda · 6").

### "create a schedule"
- **Four fields:** date, start, time zone, place (05). The end is derived
  from the items' planned minutes and shown once, in the table's foot.
- **Breaks are part of the schedule** (decision 7). A break row sits between
  items with a length and a return time. It moves the times after it and
  counts toward nothing.
- **Nothing starts itself.** The host triggers each item, in the owner's own
  words.
- **Lateness is host-only.** Drift from the plan appears in the stage's Setup
  drawer and on the host remote, never on the projected image. Phones show
  the plan's times, like a printed agenda.

### "upload presos"
**Decided (4, 5, 8).** The talk runs from the presenter's own presentation
mode. Engage keeps a PDF **reference copy** for attendees and nothing else.

- **The dialog** (04) asks for a title, a presenter, a planned length and
  where the item goes. The PDF is optional, with one switch per deck:
  "Attendees can open this copy". It is on by default.
  - The page count is read from the PDF on the server; `pdf-parse` is
    already a dependency of `parse-document.js`.
  - Nothing else is extracted, and no page is rendered.
- **PDF only.** The hint says PowerPoint, Keynote and Google Slides all save
  as PDF, instead of refusing a `.pptx` with no way forward.
- **Sealed per organisation**, exactly as saved reports are: the org envelope
  `save-report.js` writes (`:82-94`), opened through a decrypting Lambda as
  `download-saved-report.js` does.
  - **Upload:** an API request body stops at 10 MB. So the file goes by
    presigned PUT to a private `staging/` key with a one-day lifecycle rule.
    A Lambda then seals it into the envelope and deletes the staged copy.
    The limit is 25 MB.
  - **Download:** that Lambda answers in its response body, and a Lambda
    response stops near 6 MB (about 4.4 MB of PDF after base64). So a larger
    copy is decrypted into a short-lived object served by a 5-minute signed
    URL instead (PLAN Phase 2).
- **On the stage** (s-02), a presentation item shows "Now presenting": the
  talk, the presenter, the event code for latecomers, and what's coming up.
  - It uses the between-items screen's shape.
  - The dock's primary is the next item, so a talk can end early or on time
    with the same key.
- **On the phone** (p-06), the screen is the player's *watch* volume: it is a
  talk, look up, and "Slides — open or save" when the copy is shared.
- **Question 8 falls away.** The first draft asked whether an outside
  presenter could drive their own slides in Engage. Nobody drives slides in
  Engage, so there is nothing to grant.

### "invite people to a locked sessions … a code that they need to match with their email"
**Decided (2):** a personal passcode, and no email for now. This design's
reading of the answer is stated in the decision above, so the owner can
correct it.

- **Access is one choice** made when the event is created: open, or invite
  only. It can change until the first passcode is made.
- **The passcode:**
  - six characters from 30 symbols with no look-alikes (no 0/O, 1/I/L, 8/B),
    about 729 million combinations;
  - the server keeps `HMAC(passcode, secret key)` and a `PASS#` row pointing
    at the person, never the passcode, so a typed passcode is one read;
  - it is **shown once**, in a strip on the invitation list (06), with Copy,
    Download CSV and Print cards;
  - after that it can only be replaced, which retires the old one.
- **Handing it out is the host's job**, however they like: copy it into their
  own email or chat, mail-merge from the CSV, or print the cards.
  - The personal link carries the passcode after `#`. Browsers never send
    that part to a server or in a Referer header, so it never lands in a log.
- **The list records a name for each person**, so the host sees who came. An
  email is optional: an encrypted note for the host's own records, never a
  key and never used to join.
- **Joining** (p-01) is the event code, then the passcode. The name comes
  from the list. Before joining, the phone says reports are shared
  afterwards, with names (decision 3).
- **One message for every wrong passcode** (p-02): "That passcode doesn't let
  anyone into Q4 Kickoff". A typo, a replaced passcode and one from another
  event all read the same, so a guess learns nothing.
- **A pause, not a lock** (p-04). Five wrong tries start a 10-minute pause,
  counted per phone and per network address. The form returns on its own.
- **One phone per passcode, movable** (p-03). The other phone is told it has
  been moved.
- **Walk-ins** land in the same "just made" strip, to read out or print.
- **Email later.** Sending from `no-reply@seibtribe.us` through SES is
  approved in principle (PLAN Phase 4). Only then could the join also ask
  for an email.
- **Why today's private session isn't reused.** Its single shared
  `AccessCode` is a different mechanism: one secret for everyone, compared as
  plaintext.

### "that session would have an agenda page"
- **Before the day (p-05a):**
  - every item's time, title, type, presenter and description, each marked
    "Not started";
  - nothing to answer, no survey and no slides copy (decision 11);
  - on a laptop, the same page at the player's laptop ladder (board 11);
  - who can see it is the proposal in decision 11.
- **The phone's agenda (p-05)** is its *rest* screen between items: every
  item in order, with its state in a word (Done / Next). The headline copies
  the approved between-rounds screen.
- **At the end (p-08)** the same list becomes "what was shared":
  - each item's report as the setting allows: Full by default, "no names"
    for an Anonymous item, nothing for one not shared or not yet saved;
  - survey results and reference copies that are shared;
  - personal standings ("you came 5th of 36"), shown only on that person's
    phone.
- **It stays reachable** at the same `/play?gameId=5307` until the event
  expires. The passcode brings someone back, on the same phone or another.

### "link to all reports, presos, survey results"
**Decided (3):** attendees see full reports by default. One setting has three
values: **Full**, **Anonymous** and **Not shared**.

- **Where it lives.** The event's default is chosen in the new-event dialog
  (05) and shown at the top of the hub (07). Each row in the hub has its own
  "Attendees see" choice, which can differ from the default. Item 4, a candid
  Call & Answer, is drawn switched to Anonymous.
- **What Anonymous means.** Every name is removed:
  - standings show Player 1, 2, …;
  - answers show Response 1, 2, …;
  - voters and a featured comment's author are removed.
- **How Anonymous is made: by the server, never by hiding.**
  - When an item ends, the stage saves two PDFs through today's path.
  - The second is rendered from `GET /games/{id}/report?view=anonymous`,
    whose payload already has the names replaced.
  - The agenda serves one variant or the other. No client ever receives a
    name it has to hide.
- **Names can be removed, never added back.** The phone promised "with names"
  at join (p-01).
  - Allowed: Full → Anonymous → Not shared, and Not shared → Anonymous.
  - Refused: any move to Full after someone has joined under a no-names
    setting. `NamesPromised` on the event records the promise.
- **Surveys never carry names.** A survey item offers "Results · never names"
  or "Not shared", consistent with `survey-redesign` §3.
- **Reference copies** follow their per-deck switch, which can be changed
  here too.
- **The host's hub is one row per item:**
  - the full and anonymous PDFs, the reference copy, and the results;
  - the "Attendees see" choice;
  - attendance ("Invited, did not join").
- **It never pretends a save happened.** An item whose save failed shows "Not
  saved yet · Save now".
- **The event report** is the agenda and attendance as a cover, then each
  item's section. An attendee's copy uses each item's allowed variant.

### "when the host triggers an engagement the screen will go to the player mech that we have"
- **The wall (s-04).** "Start trivia" plays the refresh's phase wipe once,
  over that item's own lobby, with one extra line: "Your phone has switched —
  no code needed". The meter counts phones arriving.
- **The phone (p-07).** A 1.2-second beat names the item, then the phone is
  in **today's player, unchanged**. The board shows the approved
  `player-redesign/05` and `06` frames as they are.
- **One context at a time.** Between items the bar says "Q4 Kickoff". Inside
  an item, the item's own context ("Question 4 of 10") wins, so nothing in
  the player needs to know it is part of an event.
- **After the last round** the host gets "Back to the agenda", which returns
  the wall to the between-items screen (s-03) and the phones to their agenda.

### Two decisions the brief implies but does not ask

- **Billing (decided, 1 and 12).**
  - **Now:** an event counts as **one** session, not eight. The ledger key
    becomes `LEDGER#<period>#EVENT#<code>`, and sessions carrying `EventRef`
    are skipped.
  - **The gate runs once**, when the event is created, so nobody is refused
    at item 2 in front of the room.
  - **With event pricing:** events are Team-plan only and on their own
    allowance. One a month is included, then $1 each, and they never draw
    on the 5 included sessions.
  - **Caps:** 16 items, 8 of them engagements.
- **Where it runs.** The event is planned in the console and run from the
  stage (`GameHostPage`, in an event mode) and the host remote. It is joined
  on the phone.
  - Before the day, the same stage opens as a **rehearsal** (decision 9):
    Preview's view with the doors closed.
  - On the day its primary is "Open the doors", as Preview's is.

---

## d. What is reused, and from where

| Need | Reused |
|---|---|
| Console place, table, chips, dialogs | `admin-redesign/_src/shell.css`; `AdminShell` place + breadcrumb; the `.qsets` table idiom (lists are tables); `Modal` with one `requestClose()` and two exits |
| Code reservation | `schema-compliant-manager.js:109-124` (the `GAMES` conditional put), extracted rather than copied |
| Each engagement | the whole create + start path (`create-game.js`, `schema-compliant-manager.js`, `start-game.js`), the set pin (`set-version.js`, `REF` rows), the phase machine, the reveal |
| Phone mechanics | the shipped player unchanged (`PlayerPage.jsx`, `PlayerSurface.css`); its three volumes; the look-up cue; `.err`, `.inp.bad`, `.card`/`.stat` |
| Wall | rail, phase band, fitter, dock, the four ladders; `.joinblock`/`.qr` (the one QR); `.howto`; `.meter` count; the phase wipe (`refresh-stage.css` §1) |
| Following phones | `CONNECTION#` rows (`connect.js:30-43`) and the SK-wide cleanup in `disconnect.js:14-20` |
| Reference copies | the presigned-PUT pattern (`media-upload-urls.js:165-169`) into a staging key; the org envelope and `.pdf.enc` of `save-report.js:82-94`; the decrypting download of `download-saved-report.js`; the private reports bucket and its retention rules; `pdf-parse` (already behind `parse-document.js`) for the page count |
| Passcodes | the one-person, shown-once token idea of org invites (`org-guards.js:216-243`), without their email match; delivery by the host, as org invites do today with copy / `mailto:` (`TeamPanel.jsx:119-121`, `:327-335`) |
| Reports | `create-report.js` → `GameReport.jsx` → `save-report.js`, `REPORT#` rows, 90/365-day retention, now two variants per item; `ReportsPanel` for the long tail |
| Upgrade path for a Personal space | `PlanRequestDialog` ("Request the Team plan"), offered to a personal space at `AdminPage.jsx:2174` |
| Survey items | the survey design's model (self-paced, closed by the host, frozen share) from `survey-redesign/` |
| Keys and encryption | `tenant.js` key builders; `tenant-crypto.js` entities; `callerMayDriveSession` |
| Driving from the room | the standalone host remote (`config/hostRemote.js`) |

---

## e. Open questions for the owner

Moved to the top of this file, under **Decisions and open questions**, so they
are the first thing read rather than the last.
