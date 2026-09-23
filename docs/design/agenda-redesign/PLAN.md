# Events and agendas — build plan

> ## FUTURE / NOT SCHEDULED
> This is a plan for work nobody has started or scheduled. It changes no code,
> and nothing is deployed by it. Each phase can ship on its own. Before any
> phase ships, the usual gate holds:
> - the backend suite (`node tests/<file>.js`, judged by exit code);
> - the frontend suite, lint and `npm run build` in `src/`;
> - the recorded baselines.

Mockups and reasoning are in this folder (`index.html`, `RATIONALE.md`). File
and line references are as of 23 Sep 2026.

**Order and dependencies:**
- Phase 0 is four independent fixes to things the event would stand on.
- Phases 1–5 each add one visible capability.
- Phase 4 (email) is approved in principle but later.
- Phase 6 waits for the survey work.
- Phase 7 (event pricing) comes later.
- Phases 2, 3 and 5 each need Phase 1. Phase 4 needs Phase 3.

All twelve of the owner's decisions are applied throughout; 11 is a default
the owner may overrule. The shelved concept (event templates) is listed at
the end.

---

## Phase 0 — fix what the event would lean on

These are defects today, whether or not events are built. Each is small and
ships alone.

| # | Fix | Files | Test |
|---|---|---|---|
| 0a | **Saving a report requires sign-in.** Add `Auth:` (Cognito) to the route and `callerMayDriveSession` to the handler (404 when refused). Switch the client from `fetch` to `authFetch`. | `template-clean.yaml:2549-2556`, `lambda-functions/game/save-report.js`, `src/src/components/GameReport.jsx:141` | new `tests/save-report-auth.js` (anonymous caller and other-org caller both refused; owner succeeds); `tests/report-index-row.js` still green |
| 0b | **Targeted broadcasts reach their target.** `broadcastToGame` filters on `conn.IsHost`, but `connect.js` writes `ConnectionType`. Read `ConnectionType`. | `lambda-functions/websocket/schema-compliant-manager.js:636-638` (and the copies of the helper in `game/*` if they filter the same way) | new `tests/broadcast-target-filter.js`: a HOST-only message reaches only HOST rows |
| 0c | **The 7-day TTL applies on every start path.** `next-question.js:799` accepts `CREATED`, so the lobby's "Start First Round" never writes `startedTtl`. Apply it when the state leaves `CREATED`. | `lambda-functions/game/next-question.js`, `session-ttl.js` (both copies unchanged) | extend `tests/tenant-session-scoping.js` §9: starting from `CREATED` through `next-question` rewrites `ttl` on GAMES, METADATA, STATE and the index row |
| 0d | **Decide whether usage is recorded at all.** `recordBillableSession` has no caller. Wire it into the first successful join, or record that it stays unwired. Phase 1's billing rule depends on the answer. | `lambda-functions/game/join-game.js`, `lambda-functions/*/usage.js` | extend `tests/usage-metering.js`: the second join to the same session writes nothing new |

---

## Phase 1 — an open event of engagements under one code

**Ships:**
- **The agenda.** A host builds one of trivia, Call & Answer, poll and
  wavelength items, plus **breaks** (decision 7). Each item carries a
  **description**.
- **Before the day.** The agenda can be read on a phone or laptop: times,
  titles and descriptions, with nothing active (decision 11). Anyone with
  the code can see it.
- **Rehearsal.** The host can rehearse on the stage with the doors closed
  (decision 9).
- **On the day.** The host runs it from the stage under one code. Anyone with
  the code joins, with a typed name as today. Phones follow from item to item
  by themselves.
- **Standings.** The day's standings appear on the between-items and break
  screens (decision 6).
- **Not yet:** presentations, invitations, the hub. Reports save per item
  exactly as sessions do today.
- **Survey items wait for the survey work** (decision 11, by default); the
  event does not.

### Backend
- **Keys.** `lambda-functions/{game,websocket,admin/shared}/tenant.js` gain
  `eventsIndexPk(orgId)` → `ORG#<org>#EVENTS` and `eventPk(code)` →
  `EVENT#<code>`, identical in all three copies. No bare literal anywhere else.
- **Encryption.** `tenant-crypto.js` (all three copies) gains the `event`
  entity (Title, Place) and the `item` entity (Title).
- **Code reservation.** Extract the `GAMES` conditional put from
  `schema-compliant-manager.js:109-124` into one `reserveCode(db, {orgId, ttl,
  kind})`, used by both the session create and the new event create. The
  reservation row gains `Kind` only. (Its comment already explains why nothing
  else belongs on it.)
- **New functions** in `lambda-functions/events/`:
  - `create-event.js`
  - `get-events.js`
  - `get-event.js`
  - `update-event.js`
  - `items.js` (add / edit / remove / reorder by `Order`)
  - `start-item.js`
  - `end-item.js` ("Back to the agenda")
  - `end-event.js`
  - `resolve-code.js` (`GET /join/{code}`: kind, access, title, date — nothing
    more)
  - `attendees.js` (open events: a name → a signed attendee token)
- **`start-item.js`** calls the session manager's create with the item's
  pinned `SetRef`, then `start-game.js`'s logic. It stamps
  `METADATA.EventRef`, sets `EVENT.LiveItem` and broadcasts `eventItemStarted
  {gameId}` to the event's connections.
- **An event counts as one session** (the owner decided on 23 Sep).
  - The create gate (`websocket/create-game.js:162-172`) runs once, at event
    creation. Sessions created by `start-item.js` skip it.
  - The meter records the event once, under the ledger key
    `LEDGER#<period>#EVENT#<code>`. Sessions with `EventRef` are skipped. This
    depends on the meter being wired, which is Phase 0d; a separate task is
    already fixing `recordBillableSession` having no caller.
- **Caps: 16 items, at most 8 engagements** (owner, 23 Sep).
  - Enforced in the builder: the add menu disables the engagement kinds at 8
    and says why, and presentations stay available up to 16.
  - Enforced again on the server, in the item-write route: a 17th item or a 9th
    engagement is refused with a message the builder shows.
  - Tests: `tests/event-caps.js` covers 16 items allowed and a 17th refused, a
    9th engagement refused while a 9th presentation is allowed, and a reorder
    that changes no counts.
- **Who gets it: Team-plan organisations** (proposed under decision 1).
  - A Personal space keeps the Events nav item, and its page explains the
    Team plan with the shipped "Request the Team plan" dialog (01b,
    `AdminPage.jsx:2174`).
  - `POST /events` answers 402-plus-upgrade.
  - If the owner wants Personal spaces to have events before event pricing,
    drop this bullet; Phase 7 adds the gate instead.
  - Tests: `tests/event-plan-gate.js` covers a Personal space refused with
    the upgrade body, and a Team org allowed.
- **Item state and descriptions** (decision 11).
  - `ITEM.State` moves planned → active → done, only by the host's
    `…/start` and `…/end`.
  - `ITEM.Description` is encrypted with the `item` entity.
  - `GET /events/{code}/agenda` is public for an open event. It returns times,
    titles, types, presenters and descriptions for every item, and links only
    for active or done ones.
- **Breaks** (decision 7). `Type: "break"` rows carry `Minutes` and
  `Description` only. `tests/event-caps.js` asserts they are left out of both
  caps, and `start-item.js` refuses to create a session for one.
- **The day's standings** (decision 6).
  - `end-item.js` copies each player's final score from the child session
    (its `PLAYER#` rows, the numbers `create-report.js`'s
    `playerPerformance` reports) onto the attendee row: `Points.<itemId>` and
    `DayTotal`.
  - Only items whose type keeps scores (trivia, Call & Answer) add anything.
  - The wall shows names only when the event's report default is Full
    (decision 3).
- **Rehearsal** (decision 9) follows the session-setup design's Preview.
  - The stage shows the event while it is not LIVE, so joins are refused and
    a phone that scans waits.
  - Stepping through reads each engagement's pinned set version read-only.
  - No route it calls writes anything.
- **WebSocket.**
  - `connect.js` accepts `eventId` and writes `EVENT#<code>/CONNECTION#<connId>`.
  - `message.js` gains a `follow` action that adds `GAME#<child>/CONNECTION#<connId>`.
  - `disconnect.js` needs no change: it already removes every row with that
    connection's key (`:14-20`).
- **Joining an item.** `join-game.js` accepts an attendee token in place of a
  typed name for a session with `EventRef`. The player name comes from the
  attendee row, and the existing name-collision path suffixes duplicates.
- **Template.** Routes and functions for the above; `events/*` gets table
  access only. A new request header, if any, is a CORS change too (tenancy
  rule 1).

### Frontend
- **Console.**
  - `config/consoleSections.js` gains `events` (label "Events", `contentTheme:
    'dark'`) after `games`.
  - `AdminPage.jsx` mounts `components/EventsPanel.jsx` (the list) and
    `components/EventBuilder.jsx` (the place, with breadcrumb).
  - One stylesheet per screen, scoped (`EventsPanel.css`, `EventBuilder.css`).
- **Dialogs.** Add-item menu (a popover) and the set picker (`Modal`, one
  `requestClose()`, X plus a bottom exit). No modal opens from a modal.
- **Stage.**
  - `GameHostPage.jsx` gains an event mode.
  - New `components/stage/AgendaWall.jsx` draws:
    - the doors and between-items screens, with the day's standings;
    - the break countdown (s-05), which stops at 0:00, with +5 min;
    - the rehearsal marks (s-06), the Preview's dashed chip and band.
  - The wall's agenda list shows 7 rows and counts the rest; it never clips.
  - Start item → the child session's lobby with the wipe once (the existing
    `refresh-stage` motion).
  - "Back to the agenda" at the item's end.
- **Phone.**
  - The pre-event agenda (p-05a) and the break screen (p-09).
  - `hooks/useJoinCode.js` checks `GET /join/{code}` and routes to the event.
  - `PlayerPage.jsx` gains the attendee join (open: name), the agenda rest
    screen, the 1.2-second switch beat, and `follow` on `eventItemStarted`.
  - Inside an item, today's screens render untouched.

### Tests
- **Backend:**
  - `tests/event-keys.js`: builders exist in all three `tenant.js` copies and
    are identical.
  - `tests/no-global-partition-literals.js` passes with no new allowlist
    entry.
  - `tests/event-code-reservation.js`: an event and a session can never hold
    the same code; eight collisions give 503; failure cleanup releases the
    code.
  - `tests/event-item-start.js`:
    - the session is pinned to the item's `SetRef.version`;
    - it carries `EventRef`;
    - the started TTL is written;
    - `update-game.js` still refuses a type or set change;
    - the create gate is not re-run.
  - `tests/event-follow.js`: `follow` writes the child `CONNECTION#` row, and
    disconnect removes both.
  - `tests/event-routes-authorization.js`: another org's caller gets 404 on
    every host route; `GET /join/{code}` leaks no title beyond the event's own.
  - `tests/tenant-crypto.js` §8: the new entities, three identical copies.
  - `tests/event-item-state.js`:
    - the agenda route returns no link, survey or copy for a planned item;
    - only the host moves the state.
  - `tests/event-day-standings.js`:
    - the day total is the sum of scored items only;
    - a survey, poll, wavelength, talk or break adds nothing;
    - the totals survive the child sessions' expiry.
  - `tests/event-rehearsal.js`:
    - rehearsing creates no `GAME#` row, no `LEDGER#` row and no `REPORT#`
      row;
    - a join during rehearsal is refused.
- **Frontend:**
  - `__tests__/eventBuilder.test.jsx`: keyboard reorder recomputes times;
    "Use v3" is offered only when a newer version exists.
  - `__tests__/eventBuilderPalette.test.js`: the palette pattern (every
    pairing ≥ 4.5:1 composited up the ancestor stack; no hex outside the token
    block; scope-rooted selectors; nothing under 12px; `AdminPage` passes
    `contentTheme: 'dark'`).
  - `__tests__/agendaWall.test.js`: stage CSS contract read as text (ladder
    tokens only, reduced-motion path, the wipe once).
  - `__tests__/playerEventFollow.test.jsx`: the switch on `eventItemStarted`;
    one bar context at a time.
  - Extend `__tests__/useJoinCode.test.jsx`.

---

## Phase 2 — presentations: a talk, and a reference copy

**Decided:** 4 (PDF), 5 (encrypted per org) and 8 (the presenter presents
from their own presentation mode; Engage never shows or drives slides).

**Ships:**
- A presentation item: a title, a presenter, a planned length, and an
  optional PDF reference copy with an "Attendees can open this copy" switch
  (on by default).
- The stage's "Now presenting" holding screen.
- The phone's talk screen, with "Slides — open or save" when the copy is
  shared.

- **Upload and seal.** New `lambda-functions/events/decks.js`:
  - `POST /events/{code}/decks` returns one presigned PUT to
    `staging/decks/<org>/<code>/<deckId>.pdf` in the **private reports
    bucket**. It accepts `application/pdf` only, up to 25 MB, with a one-day
    lifecycle rule on `staging/`.
  - `POST …/decks/{id}/seal` reads the staged file and checks it really is a
    PDF. It counts pages with `pdf-parse`, already a dependency of
    `parse-document.js`.
  - It then writes `decks/<org>/<code>/<deckId>.pdf.enc` in the org envelope,
    exactly as `save-report.js:82-94` does, and deletes the staged object.
  - The IAM grants are limited to the `staging/decks/*` and `decks/*`
    prefixes.
- **Open.** `GET /events/{code}/decks/{id}` decrypts through the Lambda as
  `download-saved-report.js` does. The caller is the host, or an attendee
  when the copy is shared **and the talk is active or done** (decision 11).
  Before that, the agenda shows the description only.
  - A Lambda response body stops near 6 MB, about 4.4 MB of PDF after
    base64. A larger copy is decrypted into `tmp/decks/…` (one-day lifecycle
    rule) and served by a 5-minute signed URL.
  - This bends "decrypted through a Lambda" for big files only. The owner
    should see it before it ships.
- **The `deck` entity** (FileName, Presenter) is added to `tenant-crypto.js`,
  all three copies.
- **At event end**, sealed copies are re-tagged `retention=standard`, so the
  bucket's 90-day rule counts from the event.
- **Frontend.**
  - `components/AddPresentationDialog.jsx` (04): one `Modal`, one
    `requestClose()`, an X plus a bottom exit.
  - The stage's `AgendaWall.jsx` gains the "Now presenting" state (s-02),
    which reuses the between-items shape.
  - `PlayerPage.jsx` gets the talk screen (p-06).
  - No new frontend dependency: nothing renders PDF pages.
- **Tests:**
  - `tests/deck-upload-routes.js`:
    - only PDFs, only up to 25 MB, org-scoped;
    - IAM limited to the two prefixes, checked against `template-clean.yaml`;
    - staged objects expire.
  - `tests/deck-seal.js`:
    - the sealed object is an org envelope that `decryptValue` opens back to
      the same bytes;
    - no plaintext remains under `decks/`;
    - a non-PDF is refused.
  - `tests/deck-download.js`:
    - the host is served;
    - an attendee is served only when the copy is shared and the item is
      active or done;
    - another org gets 404;
    - a copy over the body limit goes the signed-URL way.
  - `tests/deck-retention.js`: the end-of-event re-tag carries
    `retention=standard`.
  - `tests/tenant-crypto.js` §8: the `deck` entity, three identical copies.
  - `__tests__/agendaWall.test.js`: the presenting state has no slide
    controls.
  - `__tests__/playerTalkScreen.test.jsx`: the copy link only when shared.

---

## Phase 3 — invite-only events, with personal passcodes

**Decided (2):** no email for now. Each person gets a personal passcode the
host hands out. Joining is the event code plus that passcode.

**Ships:**
- Invite-only access and the invitation list: a name per person, and an
  email optionally, for the host's records only.
- A passcode per person, shown once to copy, download (CSV) or print (cards).
- The passcode join and its three failure screens: not recognised, in use,
  too many tries.
- Walk-ins.
- **No email is typed or sent.**

- **Rows.**
  - `INVITE#<inviteId>`: Name and Email encrypted as the new `invite`
    entity; `PassHmac`; `SeatClient`.
  - `PASS#<passHmac>` → `inviteId`, so a typed passcode is one read.
  - `TRIES#<clientId>` and `TRIES#IP#<hash>`: 10-minute ttl.
  - `ATTENDEE#`.
  - The HMAC key is a server-side secret held the way the other secrets are
    (KMS or SSM). `tests/kms-grants-match-code.js` is the existing pattern
    for proving the grants match.
- **Routes** in `lambda-functions/events/invites.js`:
  - add people, which returns passcodes **once**;
  - replace a passcode, which retires the old `PASS#` row in the same
    transaction;
  - remove a person.
  - The CSV and the print sheet are built in the browser from the one
    response that carries the passcodes. No route can return a passcode
    again.
- **`attendees.js`** accepts `{passcode}`:
  - one error body for every wrong passcode (unknown, replaced, or from
    another event);
  - a pause after five wrong tries, per phone and per network address;
  - a `seat-in-use` answer that the phone turns into "Move it to this phone".
- **The join gate.** `game/session-gate.js` gains an event branch. A session
  whose `EventRef` points at an invite-only event refuses a bare code and
  accepts only an attendee token. The existing shared `AccessCode` path is
  untouched.
- **The pre-event agenda of an invite-only event** is shown only after a
  passcode (proposal, decision 11). Entering it early takes that phone's
  seat.
- **Frontend.**
  - `components/EventInvitations.jsx` (06): the list, the "just made" strip,
    the card sheet.
  - `PlayerPage.jsx`: the passcode join (p-01…p-04).
  - A personal link carries the passcode after `#` and fills the field.
- **Tests:**
  - `tests/event-passcodes.js`:
    - every passcode uses the 30-symbol alphabet;
    - only the HMAC is stored (no row holds a passcode);
    - replace retires the old one;
    - every wrong passcode returns the same body;
    - the pause starts after five tries;
    - moving the seat drops the old connection;
    - the list route never returns a passcode.
  - `tests/event-invite-routes-authorization.js`.
  - `tests/event-gate.js`:
    - a bare code for an invite-only event's session is refused;
    - an attendee token is allowed;
    - the `AccessCode` behaviour is unchanged (`tests/get-game-access-code.js`
      still green).
  - `__tests__/playerPasscodeJoin.test.jsx`: the fragment fills the field and
    is never sent in a request URL.
  - `__tests__/eventInvitationsPalette.test.js`.

---

## Phase 4 — sending invitations by email (later)

**Approved in principle** (decision 2), not scheduled. Phase 3 stands on its
own without it.

**Ships:** Send / Resend from Engage, Bounced status, and a calendar file.

- `lambda-functions/events/send-invites.js` uses `@aws-sdk/client-sesv2`,
  already a dependency. It sends from the identity Cognito already uses
  (`template-clean.yaml:5155-5158`), once the SES account is confirmed out of
  the sandbox.
- The email becomes required for anyone sent an invitation.
- **Sending shows passcodes a second time**, since the email must carry one.
  So Send **replaces** the passcode and mails the new one; a retry must never
  mint a third.
- **Whether the join then also asks for the email** (the owner's original
  "match with their email") is decided when this phase is picked up.
- Bounce and complaint notifications (SES → SNS → a small handler) set
  `INVITE.Delivery`.
- The account-wide sending kill switch (`monitoring/actions.js`) must stop
  these sends too.
- A `.ics` attachment carries the event's stored time zone.
- **Tests:**
  - `tests/event-invite-send.js` (SES mocked):
    - a retry sends the same passcode;
    - the kill switch blocks sending;
    - a bounce updates `Delivery`.
  - `tests/template-validates.js` still green.

---

## Phase 5 — the hub, the attendee agenda, and reports for attendees

**Decided (3):** attendees see full reports by default. The setting has three
values: Full, Anonymous, Not shared.

**Ships:**
- "Reports and files": every item's full and anonymous reports, reference
  copy and results.
- The report setting: the event default, plus a per-item override.
- The attendee's agenda with links.
- The event report PDF.

- **The setting.**
  - `EVENT.AttendeeReports` holds the default: `full`, `anonymous` or `none`.
  - `ITEM.Share` holds the per-item value: `inherit`, `full`, `anonymous` or
    `none`. For a presentation it is `copy` or `none`.
  - `EVENT.NamesPromised` is set at the first join while the default is
    Full.
  - The server refuses any change that would add names after that: a move to
    Full from Anonymous or Not shared.
  - Survey items accept only `results` or `none`.
- **Anonymous, produced by the server.**
  - `GET /games/{id}/report?view=anonymous` is `create-report.js`'s payload
    with every name replaced before it leaves the Lambda:
    - `playerPerformance` names become "Player N", by rank;
    - answer and vote authors become "Response N";
    - `revealAuthors` output is dropped;
    - a featured comment's author is removed;
    - any `PLAYER#` name inside round data is replaced.
  - Identifiers keep a stable number within one report, so "Response 7" is
    the same answer in the list and the chart.
  - The client only renders what it is given. **No client-side hiding.**
- **Auto-save, twice.** When an item ends, the stage saves the full PDF and
  the anonymous one through the existing `GameReport` → `save-report` path,
  which Phase 0a made authenticated. The anonymous PDF is saved with
  `Variant: 'anonymous'` on its `REPORT#` row, and the item records both
  keys.
  - A failed save shows as "Not saved yet · Save now" while the 30-day
    `GAME#/REPORT` row still exists (`create-report.js:911-916`).
- **`GET /events/{code}/agenda`** (attendee token) returns:
  - items;
  - per item, a link to the variant its setting allows, or none;
  - the shared reference copies and survey results;
  - the caller's own standing.
  - It never returns the full variant when the setting is Anonymous, and
    never another attendee's name outside a Full report.
- **The event report.** A cover page (the agenda and attendance), then each
  item's section, composed on the client with the same `html2pdf.js`
  `GameReport` uses. Attendees get a version that uses each item's allowed
  variant.
- **"Keep reports for a year"** copies only the saved reports to
  `permanent/`, following `save-report.js`'s permanent rule (decision 10).
  Event rows and reference copies still expire 90 days after the event.
- **The day's standings table** in the hub (07), from the attendee rows'
  `Points` (decision 6), with names under the event's report setting.
- **Frontend.**
  - `components/EventHub.jsx` (07), with the setting strip and a choice per
    row.
  - The setting in the new-event dialog (05).
  - The phone's promise line at join (p-01).
  - The `PlayerPage.jsx` agenda links (p-05, p-08).
- **Tests:**
  - `tests/report-anonymous-view.js`:
    - for a fixture session with named players, voters, a revealed round and
      a featured comment, the anonymous payload contains **none** of the
      names anywhere (a deep string search);
    - numbering is stable;
    - the full view is unchanged.
  - `tests/event-report-sharing.js`:
    - the default is applied;
    - a per-item override wins;
    - adding names after `NamesPromised` is refused;
    - survey items reject `full`;
    - the agenda serves only the allowed variant.
  - `tests/event-hub-report-keys.js`: item end records both keys; a missing
    save is reported, not hidden.
  - `tests/event-agenda-projection.js`: only what the setting allows; the
    caller's standing only for the caller.
  - Extend `tests/report-retention.js` and `tests/report-index-row.js`
    (`Variant`).
  - `__tests__/eventHubPalette.test.js`.

---

## Phase 6 — survey items (after the survey work)

**Depends on** the survey design shipping (`docs/design/survey-redesign/PLAN.md`):
Survey is unplayable today (`config/gameTypes.js:159`).

**Ships:** survey as an item type, for the intro and closing items. Its frozen
share link appears in the hub and on the attendee agenda.

- **Tests:** `tests/event-survey-item.js`: a survey item starts as an
  ordinary survey session; closing it records its results link on the item.
  The survey work's own tests stay green.

---

## Phase 7 — event pricing (later)

**Decided (1 and 12):** events are organisations-only, and a **separate
allowance** from sessions: *"keep them separate with 1 free per month
billed."* On the Team plan, 1 event a month is included and each further
event that month is $1. Events never draw on the 5 included sessions. The
Personal plan has no events.

- **Pricing.** `pricing.js` (both copies): `TEAM_PLAN` gets `includedEvents:
  1, perEvent: 100` (cents). `PERSONAL_PLAN` gets no events.
- **Usage.** The event ledger row from Phase 1 becomes its own counter,
  `eventsRun` on `USAGE#<period>`, separate from `sessionsRun`.
  - `readUsage`, `readAllowance` and the Plan & usage panel show events on
    their own line: "Events: 1 included, then $1.00".
  - An event's month is the month of its first join, when it is billed.
- **Invoices.** A new line, "Events × $1.00", counts only events beyond the
  included one. Invoices already issued are frozen and never backfilled; the
  change applies from the next period.
- **Gate.** Creating an event from a Personal space is refused with the same
  402-plus-upgrade shape session creation uses. The Events page there shows
  01b: what an event is, and "Request the Team plan". If Phase 1 already
  ships Team-only (the proposal under decision 1), this gate is already in
  place.
- **The new-event dialog** (05) states the allowance where the event is made:
  "Your first event each month is included; after that, $1 each."
- **Tests** (`tests/event-pricing.js`, extending `tests/pricing.js` and
  `tests/usage-metering.js`):
  - the first event in a period is free;
  - the second is billed $1;
  - the sessions allowance is untouched by any event, and by the sessions an
    event's items create;
  - a Personal space can't create one;
  - an event whose first join falls in November bills in November;
  - an invoice already issued is unchanged.

---

## Not in any phase

All twelve questions in `RATIONALE.md` (top) are decided. Question 11 is
decided by default and the owner may overrule it.

- **Keeping event rows and reference copies for a year** (decision 10: only
  reports are kept).
- **Rehearsal extras** (decision 9 keeps it simple): no rehearsal analytics,
  and no practice answers.
- **Shelved (decision 10): event templates.** Reusing an event's agenda as a
  template for the next one. The new-event dialog's "Copy the agenda of…"
  picker was removed so nothing half-builds it.
- **Ruled out by decisions 4 and 8:**
  - converting .pptx;
  - showing or driving slides on the stage;
  - a slide remote;
  - rendering PDF pages.
  - The first draft's question about presenters from outside the org
    driving slides falls away with these.
