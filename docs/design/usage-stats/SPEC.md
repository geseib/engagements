# Monthly usage stats — spec

Status: PROPOSED, 2026-10-11. Nothing built. Mockups: `index.html`. Build order: `PLAN.md`.

The owner asked for monthly numbers for each account and each team, broken down by
session type, plus usage numbers for each question set and each of its versions. Team
owners and admins see their team. Engage staff see every account, every team and the
whole platform.

## 1. The decision in one paragraph

Count each event once, when it happens, into small counter rows that never expire.
This is how `platform-metrics.js` already works (`PLATFORM#METRICS`, dev 8b73618a); the
design extends that module and its hook points rather than adding a second system. Each
event touches one row per scope (account, team, platform) for its session type, plus one
row for the set when a set is involved. Totals across types are summed when read, never
stored. Two numbers are levels, not events — sessions that still exist, and sets held —
and the daily `usage-reconcile` job writes those as snapshots. No Scan, no new Lambda
function, no new table. Two new CloudFormation resources (two route permissions).

## 2. What exists today, and what this reuses

| Thing | Where | Reused how |
|---|---|---|
| Platform counters, one row per month | `lambda-functions/game/platform-metrics.js:18-31,117-119,194-211` (three byte-identical copies: `game/`, `websocket/`, `admin/shared/`) | Same module, same "never throws" rule (`:92-97`), new row kinds in the same partition |
| Once-only markers on the session's METADATA row | `platform-metrics.js:53-90` (`MetricsStartedAt`, `MetricsRoundsServed`, `MetricsAnswersCounted`) | Every new counter rides behind a marker of the same kind |
| The billing moment (second answered question) | `websocket/session-count.js:84-131`, `game/session-count.js` (identical) | "Counted" sessions hook here, once, after the charge is decided (`:119-131`) |
| Plan meter rows `ORG#<org>` / `USAGE#<yyyy-mm>` | `websocket/usage.js:13-14,162-215` | Sets held already kept as `setsCurrent`/`setsPeak`; counted sessions already kept as `sessionsRun`. Shown, not duplicated |
| Daily backstop over every org | `admin/usage-reconcile.js:104-136`, `cron(5 0 * * ? *)` (`template-clean.yaml:2399`) | Writes the two gauge snapshots |
| Staff usage page | `admin/orgs/platform-observability.js:220-280`, route `template-clean.yaml:1669-1708` | Gains a by-type table; reads the new platform rows |
| Partition builders | `game/tenant.js` (`setsMetadataPk`, `orgPk`, `userPk`, `scopePrefix`) | One new builder, `setStatsPk`, added to all three copies |
| Team roles | `tenant.js:71` `ORG_ROLES = ['owner','admin','member']`; table truth `ORG#<org>` / `MEMBER#<sub>` (`admin/orgs/shared/org-guards.js:15,442-449`) | Team view needs `admin` or `owner` via `authorizeOrg(event, orgId, 'admin')` (`org-guards.js:500-529`) |
| Staff check | `tenant.js:456` `isPlatformAdmin` (Cognito `admins`, the PLATFORM group, never a team role) | Staff routes |
| Staff action log | `admin/shared/audit-log.js:159` `recordAudit` | Staff opening one team or one account is logged |

## 3. Session types

Found in code. Seven, stored as the session's `GameType` on METADATA
(`websocket/schema-compliant-manager.js:222`), which is plaintext.

| Key | Label | Source |
|---|---|---|
| `call-and-answer` | Call & Answer | `game/game-types.js:23` |
| `trivia` | Trivia | same |
| `poll` | Poll | same |
| `wavelength` | Wavelength | same |
| `survey` | Survey | same |
| `build` | Build Room | `src/src/buildroom/buildHostApi.js:234`; created by `create-game.js` with `gameType: 'build'` |
| `event` | Event (agenda) | not a session; `websocket/events/create-event.js`. Its items run as ordinary sessions of the types above (`events/child-session.js:117`) |

A stored type is mapped with `normalizeGameType` (`game-types.js:36`) except `build`, which
passes through, and anything unrecognised, which counts as `other`. Legacy spellings
(`polls`, `quiz`, `callandanswer`) land on their canonical key.

Agenda items that are not sessions (presentation, activity, break —
`events/agenda-rules.js:67`) are not counted.

## 4. What a "question" is, per type

| Type | One "question" | Hook |
|---|---|---|
| Call & Answer, Trivia, Poll, Wavelength | A round put in front of the room | `game/next-question.js:1227` → `recordRoundServed` (`platform-metrics.js:287`) |
| Survey | Every question, when the survey opens | `game/start-game.js:116` → `recordSurveyOpened` (`platform-metrics.js:463`) |
| Build Room | An ask put to the room (goes live) | `game/build-room.js:320` `makeCurrent` (every caller: `:311,440,503,639,1011,1076,1100,2294`) and `:396` (`reaskAction` writes a live ask without `makeCurrent`) |

Build Room also gets two counters of its own, because its timeline is more than asks:
**decisions** (an ask the host decides, `build-room.js:485` and `:2340`) and **crew tasks**
(`build-room.js:1459`). Recommendation: "questions" for a Build Room means asks put to
the room; decisions and tasks sit beside it (open question 2).

## 5. The events

Every event: hook → once-only guard → counters. "Fan-out" means the three scope rows of §6
for the session's type: account (the session's `CreatedBy`), team (`orgId`), platform.

| # | Event | Hook (file:line) | Once-only guard | Counters |
|---|---|---|---|---|
| E1 | Session created | `websocket/create-game.js:351`; `websocket/events/child-session.js:117` | NEW marker `StatsCreatedAt` on METADATA, conditional `attribute_not_exists` | fan-out `created +1` |
| E2 | Session started | `websocket/session-start.js:150` and `game/session-start.js:150` (via `recordSessionStarted`, `platform-metrics.js:251`); Build Room: `game/build-room.js:1236` `markKickedOff` (calls `recordSessionStarted`) | existing `MetricsStartedAt` (`platform-metrics.js:256-270`) | fan-out `started +1` |
| E3 | Session counted (billing rule: 2nd answered question) | `websocket/session-count.js:119-131` and `game/session-count.js` (same lines; survey path via `game/survey-answers.js:477`) | NEW marker `StatsCountedAt`, conditional | fan-out `counted +1` |
| E4 | Question served | `next-question.js:1227` → `recordRoundServed` | existing `MetricsRoundsServed` ratchet (`platform-metrics.js:305-319`) | fan-out `questions +1`; set row `questions +1`; and if `firstForSession`, set row `sessions +1` |
| E5 | Survey opened | `start-game.js:116` → `recordSurveyOpened` | same ratchet (`platform-metrics.js:478-492`) | fan-out `questions +n`; set row `questions +n`, `sessions +1` |
| E6 | Build ask put to the room | `build-room.js:320` (`makeCurrent`) and `:396` (`reaskAction`) | NEW: `ADD StatsAsks :{askId}` on METADATA with `NOT contains(StatsAsks, :askId)` — a string set; a reopened ask bounces | fan-out `questions +1` |
| E7 | Build decision | `build-room.js:485`, `:2340` | NEW: same, string set `StatsDecided` | fan-out `decisions +1` |
| E8 | Build crew task | `build-room.js:1459` | task id is new per create; none needed | fan-out `tasks +1` |
| E9 | Participant joined | `game/join-game.js:463-477` (new player) and `:195-205` (event attendee's seat) | the existing put's `attribute_not_exists(SK)`; count only when it succeeds | fan-out `participants +1` |
| E10 | Set copied | `admin/copy-question-set.js:276` (after the copy is written) | none; each copy is a real copy | source set row `copies +1` (version from `:172`) |
| E11 | Set downloaded | `admin/download-question-set.js`, once after the questions are read (`:72-100`), before the two `200` returns (`:136`, `:353`) | none; each download is real | set row `downloads +1` (version `resolved.version`, `:72`) |
| E12 | Event created | `websocket/events/create-event.js:132` | runs after the conditional put (`:117`) succeeds | team/account/platform `event` rows `created +1` |
| E13 | Event run (first goes live) | `websocket/events/run.js:262-268` | NEW marker `StatsRunAt` on the event METADATA, conditional | `event` rows `started +1` |
| E14 | Event attendee | `websocket/events/attendee-store.js:137-141` | the existing conditional put | `event` rows `participants +1` |

Nothing runs per answer. The answer path stays as it is (`platform-metrics.js:75-81`
explains why); E3 runs once per session, at the moment the meter already runs.

**Participants, exactly.** One per new player seat in a session, at the moment the seat is
first written. A reconnect, a phone refresh, a handover and a removed player rejoining all
reuse the seat, so none count again. A person in two sessions counts twice — which is the
owner's example (two sessions, 10 + 2 = 12). The host is not a player. Rehearsal joins
count; "counted" sessions are shown beside them so a reader can tell (open question 4).

**Event sessions.** An event's item sessions count under their own types like any other
session, carrying the event's org and creator. The `event` row counts events, runs and
attendees. Screens never add the `event` row into "all sessions", so nothing is counted
twice.

## 6. The rows

All rows: numbers and ids only. No title, no question text, no names. No `ttl`.

### 6.1 Type rows (counters), one per scope, month and type

| Scope | PK | SK |
|---|---|---|
| Platform | `PLATFORM#METRICS` (existing) | `MONTH#<yyyy-mm>#TYPE#<type>` |
| Team | `ORG#<org>` (`orgPk`, existing partition beside `USAGE#`) | `STATS#<yyyy-mm>#TYPE#<type>` |
| Account | `USER#<sub>` (`userPk`, existing partition beside `PROFILE`) | `STATS#<yyyy-mm>#TYPE#<type>#ORG#<org>` (`#ORG#-` when orgless) |

Attributes: `created`, `started`, `counted`, `questions`, `participants`; Build Room adds
`decisions`, `tasks`. Plus `period`, `type`, `orgId` (account rows), `updatedAt`,
`firstRecordedAt`.

The account row carries the team in its key so a team admin can see one member's work for
that team only, and staff can sum a person's work across teams.

The existing platform readers ignore the new SK: `readRecordedMetrics` matches only
`^MONTH#yyyy-mm$` and `#CATEGORY#` (`platform-metrics.js:601,617`).

The one update, for every scope (example: a Trivia round served for team `o1`):

```
UpdateItem
  Key: { PK: 'ORG#o1', SK: 'STATS#2026-10#TYPE#trivia' }
  UpdateExpression:
    'ADD #c0 :n0 SET #period = :p, #type = :t, #u = :now, #first = if_not_exists(#first, :now)'
  ExpressionAttributeNames:  { '#c0': 'questions', '#period': 'period', '#type': 'type',
                               '#u': 'updatedAt', '#first': 'firstRecordedAt' }
  ExpressionAttributeValues: { ':n0': 1, ':p': '2026-10', ':t': 'trivia', ':now': '<iso>' }
```

Flat attributes, never a nested map: `ADD` creates a missing attribute, but a path into a
missing map fails. The three scope writes go out together (`Promise.all`), each caught and
logged, as `bumpMonth` does (`platform-metrics.js:194-211`).

Why one row per type, not one row per month with every type in it: a type row stays under
1 KB, so each `ADD` costs 1 write unit; one fat row is ~2 KB and costs 2 per write. Reading
a month is one Query of at most 8 small rows either way.

Why no "all types" row: it would be a fourth write per event to store a sum the reader can
do over 8 rows.

### 6.2 Gauge rows (snapshots), written daily

| Scope | PK | SK |
|---|---|---|
| Platform | `PLATFORM#METRICS` | `MONTH#<yyyy-mm>#GAUGE` |
| Team | `ORG#<org>` | `STATS#<yyyy-mm>#GAUGE` |
| Account | `USER#<sub>` | `STATS#<yyyy-mm>#GAUGE#ORG#<org>` |

Attributes: `existing` (map, type → sessions not yet expired), `setsHeld` (number),
`snapshotAt`. Written with `SET` (absolute), so a rerun changes nothing.

Written by `usage-reconcile.js` inside its per-org loop (`:104-136`), which already Queries
the org's set index (`countSets`, `usage.js:350`). It adds one paged Query of the org's
session index `ORG#<org>#GAMES` (`tenant.gamesIndexPk`), projected to `GameType`,
`CreatedBy`, `ttl`, filtered `#ttl > :now` because DynamoDB deletes late (up to ~48 h).
Every attribute read is plaintext (`tenant-crypto.js:283-293` lists what is sealed).
The same pass groups by `CreatedBy` for the account rows, and by `createdBy` over the set
rows for account `setsHeld`. The platform row is the sum, written at the end of the run.

The run at 00:05 UTC on the 1st writes the closing snapshot of the month just ended (the
state 5 minutes after it ended) and the first of the new month. "Existing" for the
current month is today's figure; a closed month shows its month-end figure.

Orgless sessions sit in no org index, so they are not in `existing`. They still count in
the type rows.

### 6.3 Set rows (all time, per version)

| Set lives in | PK | SK |
|---|---|---|
| Engage's library | `SETSTATS` | `SET#<setId>#V#<n>` |
| A team's library | `ORG#<org>#SETSTATS` | same |
| Public library | `PUBLIC#SETSTATS` | same |

PK built by a new `tenant.setStatsPk(scope, orgId)` = `scopePrefix(scope, orgId) + 'SETSTATS'`,
added to all three `tenant.js` copies, so no partition literal leaves `tenant.js`
(`tests/no-global-partition-literals.js`). `<n>` is the version; `0` means an unversioned
set — a permanently supported read state, never migrated.

Attributes: `sessions` (sessions that served at least one question from it), `questions`,
`copies`, `downloads`, `setId`, `version`, `scope`, `orgId`, `firstAt`, `lastAt`.

```
UpdateItem
  Key: { PK: 'ORG#o1#SETSTATS', SK: 'SET#teamretro#V#3' }
  UpdateExpression: 'ADD #q :one, #s :one SET #id = :id, #v = :v, #sc = :scope, #o = :org,
                     #first = if_not_exists(#first, :now), #last = :now'
```

All versions together = the sum of the set's rows (one Query, `begins_with(SK, 'SET#<id>#V#')`).
A team's whole library = one paged Query of `ORG#<org>#SETSTATS`.

The version counted is the version actually served: `resolvedSet.version` for rounds
(`next-question.js:879-884,1190`), the survey's pinned set for surveys (`start-game.js:116-121`),
`resolved.version` for downloads and copies.

Set rows are all-time, not monthly. Monthly per-set history doubles every set write;
open question 6.

### 6.4 Once-only markers (on rows that already expire)

| Marker | Row | Kind |
|---|---|---|
| `StatsCreatedAt` | `GAME#<id>` / `METADATA` | conditional `attribute_not_exists` |
| `MetricsStartedAt` (existing) | same | same |
| `StatsCountedAt` | same | same |
| `MetricsRoundsServed` (existing) | same | ratchet |
| `StatsAsks`, `StatsDecided` | same | string set, `NOT contains` |
| `StatsRunAt` | `EVENT#<code>` / `METADATA` | conditional |

Markers live on the session's own row and expire with it, as the existing ones do
(`platform-metrics.js:88-90`). A reused session code gets a fresh METADATA row, so a marker
never outlives its session.

## 7. Idempotency

- Every counter is written only after its guard succeeds. A retried or racing call bounces
  off the guard (§6.4) and writes nothing.
- The guard is written first, the counters second. A failure between them loses that
  count; it never doubles one. Same accepted trade as today (`platform-metrics.js:92-97`).
- These handlers are HTTP and WebSocket calls, which Lambda does not retry. Nothing here
  reads a stream (streams deliver at least once — `usage.js:44-52`).
- Gauges are `SET`, never `ADD`, so the daily job can run any number of times.
- A recorder never throws and never blocks the action it rides on.

## 8. Retention

Counter, gauge and set rows carry no `ttl` and are kept. Same reasoning as `USAGE#` and
`PLATFORM#METRICS` (`usage.js:54-68`, `platform-metrics.js:36-40`): a count is a record of
what happened, and a counter with a `ttl` is a history that silently shortens. Size is
small (§10). Open question 7 offers a cap.

## 9. Who sees what

| Who | Sees | Route | Check |
|---|---|---|---|
| Team owner or admin | Their team: months by type, gauges, each member's numbers for this team, their own library's sets | `GET /orgs/{orgId}/stats?from=yyyy-mm&to=yyyy-mm` | authorizer `ORG_ROUTE` (`auth/authorizer.js:444,463`) lets hosts knock; handler `authorizeOrg(event, orgId, 'admin')` (`org-guards.js:500`) checks context AND the MEMBER row |
| Team member (role `member`) | Nothing new | — | refused 403 by the same check |
| Engage staff | Platform by type (added to the Observability page); every team; any account; any set | `GET /platform/observability` (existing, extended) and `GET /platform/stats?org=` \| `?user=` \| `?set=<scope>:<org>:<id>` | authorizer adds `platform/stats` → `['admins']` beside `platform/observability` (`authorizer.js:526`); handler re-asks `isPlatformAdmin` (`tenant.js:456`) |

Staff opening one team or one account writes `recordAudit` first
(action `stats.viewed`, role `platform-admin`, target `{type: 'org'|'user', id}`), per the
2026-10-04 rule that staff actions are logged. No reason is asked: it is numbers, not
content. Open question 3.

This reverses one sentence. `admin/get-usage.js:15-22` says staff may not read a team's
usage without a logged, reasoned grant. The owner's request ("staff see each user, each
team") overrides it for counts. Staff already see each team's `sessionsRun` and sets on
the Organisations page (`admin/orgs/platform-orgs.js:84-92`), so the line was already
crossed for numbers. Titles stay out: org set names are sealed (`tenant-crypto.js:150`),
the stats rows hold ids only and the stats handlers never call `decryptItem` (a test pins
it), and the staff screens show an org set by its id. The team's own view gets names from the set list the
console already loads (decrypted for the member), joined by id in the browser.

## 10. Cost

On-demand table (`template-clean.yaml:155`): $1.25 per million write units, $0.25 per
million read units, storage $0.25/GB-month.

**Writes, one typical session** — Call & Answer, 10 questions, 20 people, platform set:

| Event | New writes |
|---|---|
| created (marker + 3) | 4 |
| started (3; marker exists) | 3 |
| counted (marker + 3) | 4 |
| 10 questions (3 + 1 set row each; marker exists) | 40 |
| 20 joins (3 each) | 60 |
| **Total** | **≈111 write units ≈ $0.00014** |

10,000 such sessions a month ≈ 1.1 M writes ≈ **$1.40/month**. The daily gauge job adds
one Query and 1 + (active hosts) writes per team per day — cents.

**Reads, one view.** Team month: one Query, ≤ 9 small rows, ~0.5 RCU. Team 12-month view:
one Query, ≤ 108 rows, ~4 RCU, plus one Query per member (20 members ≈ 10 RCU) and one
paged Query of the library's set rows. Staff platform view: the existing Observability
query plus ≤ 9 more rows per month. Staff "all teams this month": one Query per team, eight
at a time, the pattern `platform-observability.js:52-58` already accepts. Every read is a
key Query; nothing Scans.

**Storage.** ~3 KB per team per month; 1,000 teams for a year ≈ 36 MB ≈ $0.01/month.

**Hot rows.** The platform type row takes every event on the platform; a 300-person room
joining in 30 s is ~10 writes/s on it, against DynamoDB's ~1,000 writes/s per item. If
the platform ever nears that, shard the platform rows by a suffix (`#S<0-9>`) and sum on
read. Not now.

## 11. CloudFormation

Stack is ~440 of 500 resources. This adds **2**:

- `AWS::Lambda::Permission` for `GET /orgs/{orgId}/stats` as a new event on
  `GetUsageFunction` (`template-clean.yaml:2280-2316`; read-only, already serves
  `/orgs/{orgId}/usage`).
- `AWS::Lambda::Permission` for `GET /platform/stats` as a new event on
  `PlatformOrgsFunction` (`template-clean.yaml:1606-1660`; it already writes audit rows).

The routes themselves go into the HttpApi definition, not new resources. No new function,
table, policy, alarm or schedule. Every recording function already holds a write policy
(spot-checked: download `:4984`, join `:3675`).

## 12. Backfill

No backfill. History starts at deploy, as it did for `PLATFORM#METRICS`
(`platform-metrics.js:13-14`). Session rows expire at 7 or 90 days, answers at 7, so most
of the past is gone, and a partial backfill would mix exact months with guesses.

What the screens show for earlier months instead, read-only, no writes: each team's
`USAGE#<month>.sessionsRun` (counted sessions, exact, from the ledger) and `setsPeak`.
They are labelled "from your plan" and carry no type split. No migration script runs
without the owner, and unversioned sets are never touched.

## 13. Open questions for the owner

Each has a recommendation; a "yes" to all of them is the design above.

1. **Which "sessions" number leads?** Created, started and counted all get counted.
   *Recommend:* lead with **counted** (two questions answered — the billing rule), show
   created and started beside it. A rehearsal is not a session to most readers.
2. **What is a Build Room "question"?** *Recommend:* an ask put to the room. Show
   decisions and crew tasks as two extra Build Room numbers. Not timeline log lines —
   those include Claude's own progress notes.
3. **Staff drill-in: logged, reason or not?** *Recommend:* log every staff open of one
   team or one account in the audit log (the team can see it there); ask no reason.
   Platform totals are not logged.
4. **Participants: count everyone who joined, or only people in counted sessions?**
   *Recommend:* everyone who joined, shown next to counted sessions. Cheaper and exact; a
   rehearsal with three testers adds three.
5. **Should team admins see each member's numbers?** *Recommend:* yes, counts only.
6. **Per-set numbers by month, or all time?** *Recommend:* all time, per version, plus a
   total. Monthly per set doubles every set write; add it later if wanted.
7. **Keep stats forever?** *Recommend:* yes. ~$0.01/month per thousand teams. A cap
   (say 36 months, by `ttl`) is a one-line change later, but cannot recover deleted months.
8. **Do teams see how often they used Engage's or the Public library's sets?**
   *Recommend:* not in v1. Their own library's sets only. Staff see all.
9. **Does a team that published a set to the Public library see its usage there?**
   *Recommend:* yes, in a later step — counts only, labelled "your published copy".
10. **Do hosts see their own numbers?** *Recommend:* not in v1. Owners and admins only, as
    asked.
11. **Should Build Rooms bill?** Not part of this work, but found: a Build Room never
    reaches the meter (`session-count.js` is called only by `websocket/message.js:678`
    and `game/survey-answers.js:477`), so it is never "counted". *Recommend:* stats show
    Build Room "counted" as "—" until the owner decides a rule.
12. **A CSV download on the stats screens?** The mockups put it there as each screen's
    one primary control. Built in the browser from the same response, no new route.
    *Recommend:* yes.
13. **Before deploy, months show the plan numbers (§12) — or nothing?** *Recommend:* show
    them, labelled.
14. **A team set's id is its slug** (`admin/upload-questions.js` lower-cases the title), so
    showing staff the id can echo a sealed title. *Recommend:* staff see "Team set" plus
    the first 8 hex of a hash of the id, never the id itself.
15. **"Used by N teams" on a set** (mockup B4) needs a distinct-team count per set, which
    counters cannot give without a marker row per (set, team). *Recommend:* leave it out.
