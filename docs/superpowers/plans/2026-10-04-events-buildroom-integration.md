# Events and Build Rooms as engagements like any other — plan (2026-10-04)

The owner, 2026-10-04: *"why are these not treated as other types of engagements that i can see
listed in sessions, and reports, etc. … They have connect to the current systems for creating and
editing those types of engagements. They also need lifecycle management, to all of their artifacts
as well. just like the other types engagements. we can leave the current front page entry points in
though."*

Already decided by the owner: **an event is ONE row** in every list of sessions, labelled Event with
its item count. Opening it shows its agenda items, each linking to that item's own session and
report. **An item's session (it carries `EventRef`) is never also a top-level row.** A Build Room is
likewise one row, labelled Build Room.

Branch `working/events-buildroom-integration`, cut from `origin/dev` at `087e2bbc`.

## 1. Where things stand (measured, not assumed)

- **Events run** (M2–M4 shipped: join once, run the day, follow along, slides). `EVENTS_ENABLED` is
  `!If [IsProd, 'off', 'on']` — on for dev **and test** since 27 Sep (plans-and-events handoff), off
  on prod. This work does not touch the switch; every new event surface reads it.
- **An event is not a session.** Its rows are `EVENT#<code>` (METADATA, ITEM#, ATTENDEE#) plus a
  list row `ORG#<org>#EVENTS`. Each engagement item becomes an ordinary session at Go live (or at
  preview, `run.js prepare`) through `createGame`, with `EventRef`/`EventItem` on METADATA only.
- **Today the event's item sessions leak into both session lists** as ordinary rows (they get an
  `ORG#<org>#GAMES` index row; nothing marks them), with Edit/Start buttons that act outside the
  agenda. The event itself is listed nowhere but the Events place.
- **A Build Room IS a session** (`GameType: 'build'`): it already appears in both session lists
  (labelled Build Room, Continue/Report). Its report is a live page (`/build?…&view=report`) that is
  never saved, so it never reaches Reports and dies with the room's rows 7 days after start.

## 2. Every surface that lists or counts sessions, and what it will show

| Surface | File | Today | After |
|---|---|---|---|
| Console → Sessions | `src/src/components/SessionsPanel.jsx` ← `GET /games` (`game/get-games-list.js`) | sessions incl. Build Rooms (chip) and event item sessions (unmarked) | **one Event row** per event (chip "Event", "N items", expand → each item with its type, state, Open/Report); item sessions gone from the top level; **Type filter** (every format + Build Room + Event, Event only while the switch is on); Delete on an event row deletes the event and everything under it |
| Host → Your sessions / Session reports | `components/SessionHistoryPanel.jsx` ← `GameHostPage.fetchGamesList` ← `GET /games` | same as above | same rows; event row actions **Open** (its stage `/host/event/<code>`), **Edit** (the agenda `/host/event/<code>/agenda`), **Link** (the attendee link); item rows Continue (`/host?gameId=<child>&event=<code>`) and Report; **Type filter** beside the search |
| Console → Reports, host Reports dialog | `components/ReportsPanel.jsx` (+ `HostReportsDialog.jsx`) ← `GET /reports` (`game/get-reports.js`) | saved PDFs, no type | **Type column + filter**; an item's saved report is grouped under **one Event row** (expand → every item: its saved report's Share/PDF, or "No report saved"); a Build Room's saved report is a row labelled Build Room |
| Build Room report | `buildroom/BuildReport.jsx` | print only | **Save report** (Keep for 90 days / Keep for 1 year) through the same `POST /games/{id}/save-report`, so it is retained, shared with a passkey and listed exactly like any other report |
| Front page | `WelcomeScreen.jsx`, `WelcomeEvents.jsx` | Create engagement, Quick start, Build Room link, Run an event | **unchanged** (owner: leave the entry points) |
| Usage / observability / platform orgs / billing | `ObservabilityPanel`, `PlatformOrgsPanel`, `BillingPanel`, `InvoicePanel` | counters, not lists | **not applicable** — they enumerate no sessions. Events already count once (`eventsRun`); Build Rooms are not metered. Billing is out of scope by rule. |
| Remote session panel, single report, shared report | `RemoteSessionPanel`, `GameReport`, `SharedReportPage` | one session | not lists; unchanged |
| Events place | `EventsPanel`, `WelcomeEvents` | the org's events | unchanged; still the builder's home |

Search: event rows match on their title, code and every item title; item sessions are still found
by their code through the event row.

## 3. Create and edit through the common flow

- **Create dialog** (`GameSetupDialog.jsx`, opened by Create engagement): the Format pills gain
  **Event** (only while the switch is on for the tier; on Free it is shown with the plan sentence and
  no way forward but the plan) and **Build Room**. Picking either replaces the set/categories/options
  with one plain sentence about what it is, and the primary button hands over to the screen that
  already exists — no rebuild:
  - Event → the existing `EventDetailsDialog` (title carried over) → the existing agenda builder
    (`/host/event/<code>/agenda`), exactly as WelcomeEvents' New event does.
  - Build Room → the existing setup screen (`/build`, title carried over as `?title=`).
  - No new state in the dialog (the format id already holds the choice; `gameSession.test.js`).
- **Edit** is reachable from the rows: event row → Edit (host) / Open (console, the Events place's
  builder). A Build Room is started the moment it is made, so — like every started session — it
  offers Continue, not Edit; its settings live in the room.
- The front page entry points stay exactly as they are.

## 4. Lifecycle — what ordinary sessions get, and what events and Build Rooms will get

| Artifact | Ordinary session today | Event / Build Room after | Enforced in |
|---|---|---|---|
| Session rows | 90 d unstarted, 7 d from start (`session-ttl.js`); no extension on activity | event item sessions and Build Rooms: unchanged — they ARE sessions on the same clock | `schema-compliant-manager`, `session-start` |
| Event rows (METADATA, ITEM#, ATTENDEE#, list row, code) | — | unchanged: 90 d after the event's day (`agenda-rules.eventTtl`), restamped together on a date move | `create-event`, `update-event`, `items` |
| Index row marks its parent | — | **new**: an item session's `ORG#…#GAMES` row carries `EventRef`/`EventItem` (plaintext), so no list shows it twice | `schema-compliant-manager.createGame` |
| Delete one | `POST /admin/clear-game/{id}`: whole partition, index row, reservation; S3 untouched | **event**: `DELETE /events/{code}` now allowed once nothing is live or paused (was: only before anything started). Cascades to items, list row, code, attendees, decks, and **every item session** — each one only after its METADATA proves it is this event's item (a code reused after the item session expired is somebody else's and is never touched). **Reports are kept** (decision 10, and the ordinary rule: reports outlive sessions). **item session**: clear-game refuses it ("delete the event") — it belongs to the event, as an event code already is refused. **Build Room**: clear-game as before, and its S3 images/patches now go with their rows (below) | `events/delete-event.js`, `events/child-session.js`, `admin/delete-game.js` |
| Delete all | `POST /admin/clear-all-games`: every indexed session | skips item sessions (by `EventRef` on METADATA, legacy rows included); the console deletes each event through its own route first, and says which (a live one) it kept | `admin/clear-all-games.js`, `SessionsPanel` |
| Saved report | 90 d / 1 y, passkey, one per session, outlives the session | same rule for event items (unchanged path) and **now for Build Rooms**; the index row gains `GameType`, `EventRef`, `EventItem` (plaintext) so the list can type and group it | `game/save-report.js`, `BuildReport.jsx` |
| S3 objects a row points at | report PDFs on bucket rules; nothing else | **new**: when an event `ITEM#` row is removed — delete, or TTL — its deck (`decks/…`) goes too; when a Build Room `BUILD#IMG#` / `BUILD#SHR#` row is removed, its image / patches go too. Done by the table's existing stream consumer (it already runs on every change). The 30-day `builds/` lifecycle rule stays as the backstop | `admin/usage-stream.js` + `admin/shared/artifact-sweep.js` |
| Build Room keys | — | rows under `GAME#<id>` with the room's ttl; die with the room, revoked by a delete | unchanged |
| Archive / snapshot | question sets and prompts only, never sessions | not applicable to events or rooms either | — |
| Set-version pins | session index rows carry `QuestionSetVersion` | event items carry `SetRef.version`; delete-set-version's warning about items is still open (carried from M1b) | — |
| Billing | billed at the 2nd answered question | **unchanged**; an event bills once at first Go live; nothing here touches the meter | — |
| Encryption | Title/HostName sealed on index rows; reportIndex Title, passkey | every new read decrypts (`event`, `item`, `session`, `reportIndex`); new fields are plaintext ids and types only | — |

## 5. Data model and resources

- No new index, no new table, no new Lambda, no new route. **Resource count change: 0.**
- New plaintext attributes: `EventRef`, `EventItem` on new item sessions' index rows; `GameType`,
  `EventRef`, `EventItem` on new report index rows. Older rows are read through fallbacks (the
  event's items name their `GameId`; METADATA is batch-read for an older report row).
- IAM: `UsageStreamFunction` gains `s3:DeleteObject` on `decks/*` and `builds/*` of the media bucket
  and a `MEDIA_BUCKET` variable. `GetGamesListFunction` / `GetReportsFunction` read `EVENT#` rows
  with the read policy they have.
- `GET /games` now pages its index Query (it read one page). `GET /reports` too.

## 6. Open questions for the owner

1. An event with items that ran can now be deleted (once nothing is live). Its saved reports stay.
   Is that the rule you want, or should a run event only be deletable as a whole with its reports?
2. Should Delete all sessions also delete events? Built: yes, through the event route, keeping any
   event with a live or paused item.
3. A Build Room's report is now saved like any other. Should rooms also save it automatically at
   End, as nothing else does today?
4. Not fixed, found on the way: `POST /admin/clear-game/{id}` checks no ownership (any host can
   clear any org's session by code); a report index row is keyed by a four-digit code that can be
   redrawn while the report lives.

## 7. As built (2026-10-04)

All of sections 2–5 were built as planned, test-first. What differs from the plan, and what was
found on the way:

- **Event delete after a run** keeps the old safety rule in a narrower form: refused while an item is
  `live` or `paused` (`item_running`), allowed for `planned` and `done`. Each item's write is
  conditioned on the state the request read.
- **Delete all** in the console deletes events first through `DELETE /events/{code}`, then calls
  clear-all-games, which now leaves item sessions alone; a refused (running) event is named in the
  alert and stays in the list.
- **Build Room report**: Save report sits in the report's bar with the keep choice inline (no dialog
  over the report). The save path is `utils/saveReport.js`, which the session report now uses too.
- **Found while looking in a browser** and fixed: the console Sessions table drew Players and Rounds
  at zero width (the column widths summed to 100% without them), and a Build Room row's Open/Report/
  Delete overflowed toward the hidden start of a `flex-end` group (hard rule 9). `Printer` was not
  in `Icon.jsx`, so every Print button drew the fallback circle.
- `docs/architecture/api.md` was already stale on dev (the Build Room routes were missing); it is
  regenerated. No route was added.

Tests added: `tests/engagement-session-list.js`, `tests/engagement-report-list.js`,
`tests/engagement-lifecycle.js`, `tests/artifact-sweep.js`; `src/src/__tests__/engagementRows.test.jsx`,
`src/src/__tests__/createOtherEngagements.test.jsx`. Each backend suite was run red against the
previous code first.

Not done, on purpose: a link from a single item session's report back to its event (the event row
in Reports is the hub); delete-set-version's warning about event items pinned to a version (carried
from M1b); the ownership check on `POST /admin/clear-game` and the recycled-code report row (§6.4).
