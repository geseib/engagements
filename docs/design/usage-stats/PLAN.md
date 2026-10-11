# Monthly usage stats — plan

Build `SPEC.md` in small steps. Each task ends green: the backend suites (`node tests/<file>.js`,
judged by exit code and suite count), `cd src && npm test && npm run lint && npm run build`.
Push to `dev` only after a task's suites pass; nothing here needs a migration.

Order: counters first (they start history the day they ship), then routes, then screens.
Answer the open questions (SPEC §13) before Task 7; Tasks 1–6 hold under any answer.

## Task 0 — test fakes that can count

- `tests/helpers/paged-table.js`: add `UpdateExpression` `ADD a :n` (numbers and string
  sets), `if_not_exists`, and the conditions `attribute_not_exists(x)`,
  `attribute_exists(PK)`, `x < :n`, `NOT contains(x, :v)`. Anything else still throws.
- `tests/helpers/player-table.js` (used by `tests/platform-metrics.js`) already does
  `ADD n :one`; extend it for string sets and `NOT contains`, and add ADD to
  `paged-table.js` only for the suites that must prove paging.
- Test: `tests/paged-table-update.js` — each new clause, and that an unknown clause throws.

## Task 1 — the stats rows (one module, three copies)

Files: `lambda-functions/game/platform-metrics.js`, `websocket/platform-metrics.js`,
`admin/shared/platform-metrics.js` (byte-identical); `game/tenant.js`, `websocket/tenant.js`,
`admin/shared/tenant.js` (`setStatsPk`).

- `statsType(gameType)`: `build` passes; known spellings → `normalizeGameType`; else `other`.
- `fanOut(c, { type, orgId, userId }, counters)`: the three §6.1 updates, `Promise.all`,
  each failure logged and swallowed.
- `bumpSet(c, { scope, orgId, setId, version }, counters)`: §6.3; version `null` → `0`.
- Readers (admin copy uses them): `readScopeMonths(pk, skPrefix, from, to)` — paged Query,
  sums across types on read; `readSetRows(pk, setId?)`.
- Tests: `tests/usage-stats.js` — §1 copies identical (extend the check in
  `tests/platform-metrics.js` rather than add a second one); §2 key shapes for all three
  scopes and the orgless account key `#ORG#-`; §3 rows carry no `ttl`, no `Title`, no text;
  §4 a failing write never throws; §5 readers page (use `paged-table.js` with a tiny
  `pageSize`) and sum types; §6 `setStatsPk` for platform/org/public, and
  `tests/no-global-partition-literals.js` still passes.

## Task 2 — ride the existing hooks (E2, E4, E5)

Files: the three `platform-metrics.js` copies; `game/next-question.js:1113,1227`
(pass `metadata: gameMetadata.Item`); `game/start-game.js:116` (pass metadata and the set
ref); both `session-start.js:150` (pass metadata).

- `recordSessionStarted`, `recordRoundServed`, `recordSurveyOpened` take `metadata` and
  call `fanOut` and `bumpSet` only after their existing guard succeeds.
- Tests: extend `tests/platform-metrics.js` §2 — a retried start, a racing round, a double
  Open add nothing to the new rows; first served round adds `sessions +1` to the set row
  at the version served; an unversioned set lands on `V#0`.
- Extend `tests/platform-metrics-wiring.js` so each hook still passes the arguments.

## Task 3 — new session moments (E1, E3)

Files: `websocket/create-game.js:351`, `websocket/events/child-session.js:117`
(pass type, org, creator); `platform-metrics.js` `recordSessionCreated` gains the
`StatsCreatedAt` guard; new `recordSessionCounted`; `websocket/session-count.js:119-131` and
`game/session-count.js` (identical) call it once the charge is decided, including
`covered-by-event` and `unscoped`.

- Tests: `tests/billable-session-wiring.js` — counted once across racing second-question
  answers; an event's item session counts as counted with no ledger row; the two
  `session-count.js` copies stay identical. `tests/usage-stats.js` — created counts once
  when the recorder is called twice for one session.

## Task 4 — participants (E9, E14)

Files: `game/join-game.js:463-477` and `:195-205`; `websocket/events/attendee-store.js:137-141`.

- New `recordParticipant({ gameId, metadata })` (and `recordEventAttendee`) — called only
  after the conditional put succeeds.
- Tests: `tests/usage-stats-participants.js` — join, rejoin, refresh, handover, removed
  then rejoined: one count. Two names: two. Event attendee in three items: three item
  participants, one event attendee.

## Task 5 — Build Room (E2, E6, E7, E8)

Files: `game/build-room.js:320` (`makeCurrent`), `:396` (`reaskAction`), `:485`, `:2340`,
`:1459`, `:1236` (`markKickedOff` calls `recordSessionStarted`).

- New `recordBuildAsk`, `recordBuildDecision` (string-set guard on METADATA),
  `recordBuildTask`.
- Tests: `tests/build-room-stats.js` — open, close, reopen one ask: 1. Reask: 2. Wheel
  revote: 2. Decide twice: 1. Kickoff twice: started 1. No sealed field is read.

## Task 6 — sets copied and downloaded, events (E10–E13)

Files: `admin/copy-question-set.js:276`; `admin/download-question-set.js` (after `:72-100`);
`websocket/events/create-event.js:132`; `websocket/events/run.js:262-268`.

- Tests: `tests/set-stats.js` — a copy of platform v2 bumps the platform set's `V#2`
  `copies`, never the copy's; a download of `?version=1` bumps `V#1`; a download that
  fails (404, empty set) bumps nothing. `tests/event-run.js` — run twice: started 1.

## Task 7 — gauges in the daily job

Files: `admin/usage-reconcile.js:104-136`.

- Per org: paged Query of `gamesIndexPk(org)`, projected `GameType, CreatedBy, ttl`,
  filter `#ttl > :now`; group by type and creator; reuse the `countSets` pass and group by
  `createdBy`. `SET` the §6.2 rows for this month (and last month on the 1st). Platform
  row = sum, written last.
- Tests: `tests/usage-metering.js` (extend; it covers the reconciler) or a new `tests/usage-stats-gauges.js` — run twice, same rows; an expired-but-not-
  yet-deleted session is not counted; uses `paged-table.js` with a small page so a
  one-page read fails the test.

## Task 8 — routes

Files: `admin/get-usage.js` (dispatch `GET /orgs/{orgId}/stats`); `admin/orgs/platform-orgs.js`
(`GET /platform/stats`); `admin/orgs/platform-observability.js` (add `byType` from the
platform rows); `auth/authorizer.js:526` (add `platform/stats` → `['admins']`);
`template-clean.yaml` — one event on `GetUsageFunction` (`:2280`), one on
`PlatformOrgsFunction` (`:1606`).

- Team route: `authorizeOrg(event, orgId, 'admin')`; months (≤ 24), gauges, members
  (one Query per member's `USER#` partition, filtered to this org), library sets; plan
  numbers (`USAGE#`) for months before counting began, labelled.
- Staff route: `isPlatformAdmin`; `recordAudit` first for `?org=` and `?user=`; refuse
  if the audit write fails.
- Tests: `tests/usage-stats-routes.js` — member refused 403, admin and owner allowed, a
  stale context with no MEMBER row refused; another org's id refused; staff only on
  `/platform/stats` (extend `tests/authorizer-staff-routes.js` and
  `tests/org-route-authorization.js`); audit row written before the answer; no `decryptItem` reachable from
  either handler (extend `tests/kms-grants-match-code.js`); `tests/template-validates.js` and the
  route checks built on `tests/helpers/template-routes.js` pass; resource count rises by exactly 2.

## Task 9 — team screen

Files: new `src/src/components/UsageStatsPanel.jsx` + `.css` (scope `.ust`);
`src/src/config/consoleSections.js` (new team section "Activity", owners and admins only);
mockup frames A1–A2.

- Month picker, by-type table, members table, sets table; names for sets joined by id
  from the set list the console already holds. Tables stack into labelled rows under
  600 px. One primary control: Download CSV (built in the browser).
- Tests: `src/src/__tests__/usageStatsPanel.test.jsx` (fetch URL, empty month says
  "Nothing ran in October" not zeros, member hidden from non-admins),
  `usageStatsPalette.test.js` (contrast, measured), `consoleSections.test.js`.

## Task 10 — staff screens

Files: `src/src/components/ObservabilityPanel.jsx` (by-type table, teams list),
new `StaffStatsDrill.jsx` (team, account, set views reuse `UsageStatsPanel` parts);
mockup frames B1–B4.

- Org set names never shown to staff: an org set is "Team set" plus its id.
- Tests: `observabilityPanel.test.jsx` (extend), `staffStatsDrill.test.jsx`.

## Task 11 — handoff

Write `docs/handoff/usage-stats-<date>.md`: what is live on which tier, the counting-since
date per tier, the open questions still open. Measure every screen at ~660 px and 375 px
(rect vs innerWidth), per the dialogs-on-screen rule.
