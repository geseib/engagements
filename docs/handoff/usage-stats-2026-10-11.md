# Usage stats — handoff, 2026-10-11

Built from `docs/design/usage-stats/SPEC.md` (approved 2026-10-11, every §13
recommendation taken) and `PLAN.md`, Tasks 0–10, on branch
`working/build-room-host-redesign`.

## What is live where

**Nothing is live on any tier yet.** The work is committed on the branch and has
not been pushed: no tier has run it. History starts the day it reaches a tier
(SPEC §12, no backfill), so the "counting since" date per tier is the date of
the first session created after that tier's deploy:

| Tier | Counting since |
|---|---|
| dev | not deployed |
| test | not deployed |
| prod | not deployed |

Fill this table in when each tier runs it.

## What was built

**Counters** (`lambda-functions/*/platform-metrics.js`, three identical copies):
per-month rows by session type for platform (`PLATFORM#METRICS / MONTH#…#TYPE#…`),
team (`ORG#<org> / STATS#…#TYPE#…`) and account (`USER#<sub> / STATS#…#TYPE#…#ORG#<org|->`);
all-time rows per set and version (`<scope>SETSTATS / SET#<id>#V#<n>`, built by
`tenant.setStatsPk`); daily gauges (`…#GAUGE`). Every counter sits behind a
once-only guard on METADATA (`StatsCreatedAt`, `MetricsStartedAt`, `StatsCountedAt`,
the `MetricsRoundsServed` ratchet, `StatsAsks`/`StatsDecided` string sets,
`StatsRunAt` on an event). No ttl, no titles, nothing decrypted.

**Hooks**: create-game and event item sessions (created), both session-start
copies and Build Room kickoff (started), both session-count copies (counted, an
event's item included), next-question and survey open (questions, set rows),
join-game on a new seat (participants), Build Room asks/decisions/crew tasks,
copy and download of a set, event created/run/attendee.

**Daily job**: `admin/usage-reconcile.js` writes the gauges per team and
account, then the platform sum; on the 1st it also closes the month just ended.

**Routes** (two HttpApi events, no new function or table):

| Route | Function | Who | Check |
|---|---|---|---|
| `GET /orgs/{orgId}/stats?from&to` | GetUsageFunction | team owner or admin | authorizer ORG_ROUTE (hosts, admins may knock); handler `authorizeOrg(event, orgId, 'admin')` — context AND MEMBER row |
| `GET /platform/stats?org=` \| `?user=` \| `?set=<scope>:<org>:<id-or-ref>` \| `?library=platform\|public` | PlatformOrgsFunction | Engage staff | authorizer `['admins']`; handler `isPlatformAdmin`; team, team set and account opens write `recordAudit` (`stats.viewed`) first, 503 if it cannot |
| `GET /platform/observability?month=` (extended) | PlatformObservabilityFunction | Engage staff | unchanged |

**Screens**: Team → Activity (`UsageStatsPanel.jsx`, owners and admins);
Observability gains the month by type, teams this month and set lists, and
opens a team, account or set (`StaffStatsDrill.jsx`).

## Measured on screen

Both screens were rendered from the real components and stylesheets and
measured at 660 px and 375 px wide (element rect vs `innerWidth`): no element
past the right edge, `scrollWidth === innerWidth` on both, tables stacking into
labelled rows at 375. This was a static render of the components, not the
signed-in console: look again in the console on dev, inside AdminShell's chrome.

## Deviations from the plan

- The account drill (B3) is reached from a team's members, not from a search
  box: staff search by name or email would need a Cognito lookup this work did
  not add. Observability's tabs are Teams / Engage sets / Public sets.
- A staff open of an **account** is logged once, against the account (target
  `user`), not once per team the account belongs to.
- The gauge pass reads a team's set index once more alongside `countSets`
  (one extra Query per team per day) rather than reusing the meter's COUNT.
- Event item sessions now carry the event creator as `CreatedBy`, so the
  event's creator can delete them as their host (tenant.deleteRole).

## Still open for the owner

- Look at Activity and the staff drill-ins on dev at laptop, tablet and phone
  widths once it is deployed.
- §13 Q9 (a team sees use of its published public copy) and Q11 (whether a
  Build Room bills) remain later steps, as recommended.
