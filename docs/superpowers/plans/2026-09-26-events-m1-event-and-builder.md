# Events M1: the event, its agenda and the builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Team-plan organisation can make an event, reserve its four-digit code, and build its agenda of engagements and breaks in the console — reordered, timed, capped at 16 items and 8 engagements on both sides of the wire — with a public agenda read and a code resolver ready for M2, all behind `EVENTS_ENABLED`.

**Architecture:** An event is `EVENT#<code>` (METADATA plus one `ITEM#<id>` row per agenda item) listed under `ORG#<org>#EVENTS`, its code reserved in the same global `GAMES` registry as a session's through one shared module, `websocket/code-reservation.js`. Seven Lambda handlers live in `lambda-functions/websocket/events/` (the websocket bundle already carries the code lock, the plan gate and the crypto they need), and one pure module, `events/agenda-rules.js`, holds the caps, the times and the event's lifetime for the handlers and the console alike. The console gains an Events section (list, Personal-space page, new-event dialog) and a builder place with its item dialog, each a mountable component with its own scoped stylesheet.

**Tech Stack:** Node 18 Lambdas (AWS SDK v3 `lib-dynamodb`), single-table DynamoDB with `TransactWriteItems`, SAM `template-clean.yaml` (HTTP API + the Lambda `CognitoAuthorizer`), React 18 (webpack + jest + Testing Library), backend tests as standalone `node tests/<file>.js` scripts.

**Spec:**
- `docs/superpowers/plans/2026-09-26-events-roadmap.md` — §M1, decisions D1–D6, §5 Global Constraints, §6 Review Focus.
- `docs/design/agenda-redesign/PLAN.md` Phase 1 (Backend, Frontend "Console", Tests) and `RATIONALE.md` (the twelve decisions; §b "The model"; §d "What is reused").
- The mockups are the design: `01-events.html`, `01b-events-personal.html`, `02-builder.html`, `02b-cap-reached.html`, `03-add-item.html`, `05-new-event.html`, `40-data-model.html` (sources in `_src/console.py`, `_src/data.py`, `_src/agenda-console.css`). Serve `docs/design/agenda-redesign/` on :8124 and look at them before building a screen.
- `.claude/skills/engage-design/SKILL.md` and its `references/` — tokens, the container rule, dialog exits, measured contrast, CSS-contract tests.

Every piece of code in this plan was written and run in a scratch copy of `ef38018e`, where each task's tests were seen to fail before its change and pass after it. All fifteen tasks were then applied together to a copy of `427d579d` — `dev` with the bug sweep merged, the tree this plan targets — and re-run: the whole backend loop green, the frontend suite 355 suites / 8,740 tests with one failure that fails the same way on an untouched `427d579d` (`promptWorkbench.test.js`, "the routes cover exactly the codes promptPreflight.js emits" — not this milestone's; record it in your baseline), lint 0 errors and the same 10 warnings, and `npm run build` passing.

---

## Before you start

1. **Bug sweep Task 2 must be on your branch.** It landed as `8a793241` and `dce1cddd` (merged by `427d579d`): step 0 of `createGame` in `lambda-functions/websocket/schema-compliant-manager.js` refuses a code whose `GAME#` partition still holds any row, and `tests/code-reuse-isolation.js` proves it through the real `create-game.js` handler. Task 3 below moves that check into `code-reservation.js`, where the session draw and the event draw both ask it before the lock, extends it to `EVENT#`, and deletes step 0. Check with `git log --oneline -1 -- tests/code-reuse-isolation.js`. If that prints nothing, stop and report `BLOCKED: bug sweep Task 2 is not on this branch` — do not implement the rule a second time.
2. **Record the baseline** on your branch before Task 1: the backend loop (below), `cd src && npm test`, `cd src && npm run lint`, `cd src && npm run build`. Every task must leave these where it found them, plus its own new suites.
3. **The backend loop** (judge by exit code, and by the suite count):

```bash
rm -rf .aws-sam lambda-functions/dist lambda-functions/admin/.aws-sam
fail=0; n=0
for f in tests/*.js; do n=$((n+1)); node "$f" >/dev/null 2>&1 || { fail=$((fail+1)); echo "FAIL $f"; }; done
echo "suites=$n fail=$fail"
```

`tests/no-retired-twin-references.js` reads `git ls-files`: stage a new file (`git add`) before the loop, or that suite cannot see it.

## Global Constraints

Every task's requirements include these. They are the roadmap's §5, plus what this milestone adds.

- **Deploying.** The pipeline is the only route to dev, test and prod, and a push to a tier branch deploys. Work in your worktree, commit there, never push, never tag, never merge into another branch. Claude pushes `dev` only after the full gate: the backend loop with 0 failed, `cd src && npm test` green, lint with 0 errors, the build passing. Never push a branch and a tag together.
- **Tenancy.** Nothing outside `tenant.js` writes a bare `'SETS'` or `'GAMES'` partition literal (`tests/no-global-partition-literals.js`). Org content — the event's name and place, each item's title and description — is sealed with the `event` and `item` entities, and every read decrypts. Another organisation's caller gets 404 on every host route.
- **Copies stay identical.** `tenant.js` and `tenant-crypto.js` exist as three copies (`lambda-functions/game/`, `websocket/`, `admin/shared/`). Edit one, copy it over the other two, and `tests/tenant-keys.js` §8 and `tests/tenant-crypto.js` §8 hold them equal.
- **One bundle for events.** The event handlers live in `lambda-functions/websocket/events/` with `CodeUri: lambda-functions/websocket/` and `Handler: events/<file>.handler`. Not a new `lambda-functions/events/` directory: CodeUri is per-directory with no layers, so that would need fourth copies of `tenant.js`, `tenant-crypto.js`, `usage.js`, `pricing.js`, `pricing-adjust.js` and `plan-limit.js`, and a second copy of the code lock.
- **The switch.** `EVENTS_ENABLED` is `on` for dev only (`template-clean.yaml` Globals, `!If [IsDev, 'on', 'off']`), read at call time on the `TEAM_WORKIE_AUTHORING` precedent (`admin/shared/prompt-access.js:51–61`). Off, `POST /events` answers 404 and the console has no Events section.
- **Host routes** carry `Auth: Authorizer: CognitoAuthorizer`, are named in `auth/authorizer.js`'s anchored `EVENT_HOST_ROUTE` rule (hosts|admins), and open an event only through `event-store.openEvent` — membership of the event's organisation (`tenant.callerMayManageEvent`), else the one 404. `GET /events/{code}/agenda` and `GET /join/{code}` are public: an attendee has no account.
- **Every function that reaches `tenant-crypto`** carries `kms:Decrypt` on `!GetAtt TenantKey.Arn` (`tests/kms-grants-match-code.js` walks the require graph and fails otherwise).
- **Logs** trace the request (method, path, code, item, caller id), never a header or a body (`tests/lambda-event-not-logged.js`). In `events/` the Lambda parameter is named `request`: there an "event" is the thing a host plans.
- **Items are born `planned`.** No route in M1 moves `State`; start, pause, resume and end are M3's. Every edit and removal is conditioned on `State = planned`.
- **Tests.** Backend: `node tests/<file>.js`, judged by exit code; async suites arm `tests/helpers/finish-guard.js`; event suites use `tests/helpers/event-harness.js` (Task 3), whose table is `tests/helpers/player-table.js` — it evaluates conditions, applies transactions all-or-nothing and pages a Query when `table.pageSize` is set (the `paged-table.js` model; the event suites need transactions, which only `player-table.js` models). Frontend: `cd src && npm test -- <pattern>`, never `npx jest`; read the `Test Suites:` line. The pipeline runs Node 18: no Node-20+ API in code or tests.
- **Never `npm install`** in a worktree (it prunes the other suites' dependencies). A missing package is `NEEDS_CONTEXT`.
- **Design.** Build from the rendered mockups, not from prose. One stylesheet per screen, every selector under its scope class (`.evts` for the Events place and the new-event dialog, `.evb` for the builder and the item dialog); colour through tokens, a hex only inside the scope's token block; the console ladder 12/13/15/19/30; `table-layout: fixed`; row actions `margin-left: auto` on the first child, never `flex-end`; a truncating name is one text node with `min-width: 0` and a `title=`; every dialog through `Modal` with an X and a bottom exit through one `requestClose()` that asks before dropping typed work; never a modal from a modal; the scrim scrolls (`align-items: flex-start; overflow-y: auto`) and the card centres with `margin: auto`. Each stylesheet has a `*Palette.test.js` (never `*Token*`: `.gitignore:35`).
- **Copy.** Plain words, short sentences. Say "phone, laptop or tablet", never "phone" alone. Never write the phrases the twin guard bans (`tests/no-retired-twin-references.js`, FALSE_RULE) in any tracked file.
- **Commits.** The subject says in plain words what now behaves differently; the body gives the why and names the tests. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The inputs the spec implies, most likely to bite a host first. Each has its test in the task named.

1. **Two hosts edit one agenda at once.** A co-host fills the eighth engagement between this host's read and write: exactly one lands, the other is refused with the menu's own sentence and the dialog keeps every choice (03's note). A reorder built on an agenda that has since changed is refused, never applied over an insert. — Task 7 §4, Task 8 §2, Task 13.
2. **Code lifetime** (roadmap §6.5). An event's code is never handed to a session while the event or its old rows exist — reserved, or lapsed with its `EVENT#` rows still there — and the session delete route cannot release it. — Task 3 §4–§5.
3. **The date moves.** An event re-dated to next month keeps every row — the code, the list row, METADATA, each item — on the new date's clock, in one write. — Task 6 §2.
4. **A tab that is out of date.** The switch is off, or the space is on the Personal plan: `POST /events` refuses with a sentence the dialog shows, and nothing is reserved. — Task 4 §1–§2, Task 12.
5. **A set that changed after it was added.** Its version stays pinned; a newer one is offered as "Use vN" and applied only on a click; a set that is gone says so on its row and does not break the read; another organisation's set can never be pinned, even by naming its `orgId`. — Task 5 §2, Task 7 §2, Task 14.

## Decisions this plan makes that the roadmap and design leave open

- **Where the handlers live:** `lambda-functions/websocket/events/`, in the websocket bundle (see Global Constraints). PLAN.md says `lambda-functions/events/`.
- **How the console learns the switch:** `GET /orgs` answers `features: { events }` (`admin/orgs/list-my-orgs.js`), read from the same variable the event routes read. The `TEAM_WORKIE_AUTHORING` precedent has no frontend channel at all (`promptsReadOnlyFor` hard-codes it), and a `config.js` flag written by the buildspecs would be a second source for one switch.
- **The bug sweep's check moves.** Step 0 of `createGame` (bug sweep Task 2) becomes `code-reservation.js`'s `codeHasRows`, asked by `reserveCode` before every claim, and step 0 is deleted. Left where it was, it would run twice for a session, not at all for an event, and not at all for roadmap M3's item sessions unless each caller remembered it. Its test, `tests/code-reuse-isolation.js`, stays unchanged and green: it drives the real `create-game.js` handler, so it proves the move kept the behaviour, including the shape of the Query (consistent, `Limit: 1`, no filter).
- **`reserveCode`'s shape:** `reserveCode(db, {orgId, ttl, kind, claim})`. An event create uses the default claim (the conditional `GAMES` put); a session create passes `claim: (code) => createGame(code, …)`, because `createGame` must keep taking the lock itself — `tests/tenant-session-scoping.js` §5 calls it directly with a fixed code and relies on its own release. `Kind: "event"` is written on an event's reservation only; a session's stays exactly `{orgId, ttl}` (that suite asserts the keys).
- **An event's lifetime:** `ttl` = UTC midnight two days after the event's date (after its last minute in every zone), or now if later, plus 90 days — on the code, the list row, METADATA and every item; rewritten with the date. RATIONALE §b says "90 days after the event"; the day plus the child sessions' 7 days (M3) fit inside it, and the draw still refuses the code while any `EVENT#` row remains.
- **Draft and Scheduled:** `State` is stored `SCHEDULED` at creation (M3 moves it to LIVE and ENDED); the list shows **Draft** while an event has no counted item. The design names both and draws no transition between them.
- **Survey items:** listed in the add menu, disabled, "Coming soon", and refused by the server. Surveys play today, but the roadmap puts survey items in PLAN Phase 6, and M3's start/pause/end has not been designed for a self-paced survey.
- **Invite-only:** shown in the new-event dialog, disabled, "Coming soon" (PLAN Phase 3); the server refuses `access: invite`, and the public agenda answers 404 for an invite-only event.
- **Breaks have a ceiling of 16.** Decision 7 counts breaks toward nothing; a bound is still needed so a whole agenda (16 + 16 rows) fits one DynamoDB transaction (100 items) when it is reordered or re-dated.
- **Removing an item:** "Remove from agenda" in the item's Edit dialog, confirmed inline. 02b says "Remove any engagement row" but draws no control.
- **A break's dialog:** 03's form without the set picker; the mockups draw none.
- **Presentation's item type** is `presentation` (40-data-model's `"slides"` was mockup shorthand, like its `"call"` and `"wave"`); engagements use the game-type ids (`trivia`, `call-and-answer`, `poll`, `wavelength`, `survey`) so M3 can create each item's session as-is.
- **Reordering** is `PUT /events/{code}/items` with the whole order (40-data-model's "POST PUT DELETE /events/{code}/items[/{id}]"); an insert takes a `position` and renumbers in the same transaction.
- **Copy trimmed to what ships:** 01b and the new-event dialog state today's rule — an event counts as one session (decision 1) — not the drawn end state of event pricing (decision 12, PLAN Phase 7), passcodes or reports.
- **Dates are capped at a year ahead** (a code held for years is a code nobody else can have); past dates are allowed.
- **The add menu's first group reads "Answered by the room"**, not 02's "Answered on phones": the copy rule is "phone, laptop or tablet", never "phone" alone, and the long form does not fit an uppercase group heading.

## Where the design and the code disagree

- **The mockups' weekdays are one day off.** 9 Oct 2026 is a Friday, not "Thu"; 14 Oct a Wednesday; 22 Oct a Thursday. The tests use the real calendar.
- **03's "Last run" column has no data behind it.** No set list route carries a last-run date; the picker drops the column rather than invent one.
- **03's picker says "trivia sets in Northwind Traders"**, but a host may pick from Engage's and the public library too (`GET /admin/question-sets` returns all three); the label says "Trivia sets".
- **PLAN.md's line numbers are stale** (e.g. `AdminPage.jsx:2174` — the file has 2,153 lines; `PlanRequestDialog` mounts near line 1862). This plan cites the tree at `427d579d`; every edit is anchored on text, and a `~` line number is only a guide.
- **The Invitations and Reports tabs and "Rehearse on the stage"** (02) are later phases (PLAN 3 and 5, roadmap M3). A tab strip with one tab is a control people learn to ignore, so the builder has none yet.

## File map

**Backend** (`lambda-functions/`)

| File | Change |
|---|---|
| `game/tenant.js`, `websocket/tenant.js`, `admin/shared/tenant.js` | `eventsIndexPk`, `eventPk`, `callerMayManageEvent` (Task 1) |
| `game/tenant-crypto.js` and its two copies | entities `event` and `item` (Task 1) |
| `websocket/events/agenda-rules.js` | new, pure: caps, fields, times, lifetime, date words (Task 2) |
| `websocket/code-reservation.js` | new: `drawCode`, `codeHasRows`, `claimCode`, `releaseCode`, `reserveCode` (Task 3) |
| `websocket/schema-compliant-manager.js`, `websocket/create-game.js`, `admin/delete-game.js` | use the shared lock and draw; step 0 moves into the draw; refuse an event's code (Task 3) |
| `websocket/events/event-http.js` | new: responses, trace, body, switch (Task 4) |
| `websocket/events/event-store.js` | new: keys and projections (Task 4), reads (Task 5), race helpers (Task 6) |
| `websocket/events/create-event.js` | new: `POST /events` (Task 4) |
| `websocket/events/get-events.js`, `get-event.js` | new: `GET /events`, `GET /events/{code}` (Task 5) |
| `websocket/events/update-event.js` | new: `PUT /events/{code}` (Task 6) |
| `websocket/events/items.js` | new: add and remove (Task 7), edit and reorder (Task 8) |
| `websocket/events/get-agenda.js`, `resolve-code.js` | new: the two public reads (Task 9) |
| `auth/authorizer.js` | `EVENT_HOST_ROUTE` (Task 4) |
| `admin/orgs/list-my-orgs.js` | `features: { events }` (Task 15) |
| `template-clean.yaml` | `IsDev`, `EVENTS_ENABLED`, seven functions (Tasks 4–9) |

**Frontend** (`src/src/`)

| File | Change |
|---|---|
| `utils/eventsApi.js` | new: the console's calls (Task 11) |
| `components/EventsPanel.jsx`, `EventDetailsDialog.jsx`, `EventsPanel.css` | new: 01, 01b, 05 (Task 12) |
| `components/EventItemDialog.jsx`, `EventBuilder.css` | new: 03, a break, edit, remove (Task 13) |
| `components/EventBuilder.jsx`, `EventBuilder.css` (appended), `Icon.jsx` | 02, 02b (Task 14) |
| `config/consoleSections.js`, `AdminPage.jsx` | the section and the place (Task 15) |

**Tests:** `tests/event-keys.js`, `tests/event-agenda-rules.js`, `tests/helpers/event-harness.js`, `tests/event-code-reservation.js`, `tests/event-create.js`, `tests/event-host-reads.js`, `tests/event-update.js`, `tests/event-caps.js`, `tests/event-item-edit.js`, `tests/event-public-reads.js`, `tests/event-routes-authorization.js`, `tests/events-switch.js`; `tests/tenant-crypto.js` extended. `src/src/__tests__/eventsApi.test.js`, `eventsPanel.test.jsx`, `eventsPanelPalette.test.js`, `eventItemDialog.test.jsx`, `eventBuilderPalette.test.js`, `eventBuilder.test.jsx`; `consoleSections.test.js`, `adminOneSection.test.jsx` and `modalReachability.test.js` extended.

---

### Task 1: An event's keys, its membership guard, and two sealed entities

An event is two partitions, `ORG#<org>#EVENTS` and `EVENT#<code>`, built in `tenant.js` like every other partition. Its words are sealed with two new entities. Nothing reads or writes them yet; this task is the vocabulary the rest stands on.

**Files:**
- Modify: `lambda-functions/game/tenant.js` (then copy over `lambda-functions/websocket/tenant.js` and `lambda-functions/admin/shared/tenant.js`)
- Modify: `lambda-functions/game/tenant-crypto.js` (then copy over `lambda-functions/websocket/tenant-crypto.js` and `lambda-functions/admin/shared/tenant-crypto.js`)
- Create: `tests/event-keys.js`
- Modify: `tests/tenant-crypto.js` (a new section before §8)

**Interfaces:**
- Consumes: nothing new.
- Produces (all three `tenant.js` copies):
  - `eventsIndexPk(orgId: string): string` → `'ORG#<org>#EVENTS'`; throws `/requires an orgId/` on a blank org.
  - `eventPk(code: string|number): string` → `'EVENT#<code>'`; throws `/four-digit code/` unless the code is exactly four digits.
  - `callerMayManageEvent(event, eventRow): boolean` — true only for a caller in some Cognito group whose active org, or one of whose `orgIds`, is `eventRow.orgId`. False for a row with no `orgId`, a caller in no group, and Engage staff who are not members.
- Produces (all three `tenant-crypto.js` copies): `ENCRYPTED_FIELDS.event = ['Title', 'Place']`, `ENCRYPTED_FIELDS.item = ['Title', 'Description']`.

- [ ] **Step 1: Write the failing key test**

Create `tests/event-keys.js`:

```js
/**
 * AN EVENT'S KEYS, AND WHO MAY TOUCH ITS ROWS — the tenant.js copies.
 *
 * An event is two partitions (docs/design/agenda-redesign/40-data-model.html):
 * the organisation's list, `ORG#<org>#EVENTS`, and the event itself,
 * `EVENT#<code>`. Both are built in tenant.js and nowhere else, as every
 * partition that carries content is (tests/no-global-partition-literals.js).
 *
 * The guard beside them, `callerMayManageEvent`, is `callerMayDriveSession`'s
 * membership rule without its two lenient doors: no orgless row and no caller
 * in no group gets through, because neither exists for an event.
 *
 * rejects: an events index built without its org; an EVENT# key built from
 * junk (a blank, three digits, a `#`); a copy that lacks the builders or
 * builds different keys; the event guard admitting an orgless row, an
 * anonymous caller, Engage staff who are not members, or another
 * organisation's member; the session guard changing on the way past.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const COPIES = ['game', 'websocket', 'admin/shared']
  .map((dir) => ({ dir, T: require(path.join(REPO, 'lambda-functions', dir, 'tenant.js')) }));
const T = COPIES[0].T;

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}
const as = (lambda) => ({ requestContext: { authorizer: { lambda } } });

console.log('\n1. the two partitions');
check('the organisation\'s list is ORG#<org>#EVENTS', () =>
  assert.strictEqual(T.eventsIndexPk('org_nw'), 'ORG#org_nw#EVENTS'));
check('an event is EVENT#<code>', () =>
  assert.strictEqual(T.eventPk('5307'), 'EVENT#5307'));
check('a numeric code builds the same key as its digits', () =>
  assert.strictEqual(T.eventPk(5307), 'EVENT#5307'));
check('an event partition is never a session partition', () =>
  assert.notStrictEqual(T.eventPk('5307'), 'GAME#5307'));
for (const blank of ['', '   ', null, undefined]) {
  check(`eventsIndexPk(${JSON.stringify(blank)}) throws`, () =>
    assert.throws(() => T.eventsIndexPk(blank), /requires an orgId/));
}
for (const bad of ['', '530', '53071', '53a7', '5307#ITEM', 'EVENT#5307', null, undefined]) {
  check(`eventPk(${JSON.stringify(bad)}) throws`, () =>
    assert.throws(() => T.eventPk(bad), /four-digit code/));
}

console.log('\n2. every copy builds the same keys');
for (const { dir, T: C } of COPIES) {
  check(`${dir}/tenant.js exports the builders and the guard`, () => {
    for (const name of ['eventsIndexPk', 'eventPk', 'callerMayManageEvent']) {
      assert.strictEqual(typeof C[name], 'function', `${name} is missing`);
    }
    assert.strictEqual(C.eventsIndexPk('org_x'), 'ORG#org_x#EVENTS');
    assert.strictEqual(C.eventPk('1234'), 'EVENT#1234');
  });
}

console.log('\n3. only the owning organisation\'s members');
const ROW = { orgId: 'org_nw' };
check('a member acting for the organisation', () =>
  assert.ok(T.callerMayManageEvent(as({ groups: 'hosts', orgId: 'org_nw', orgIds: 'org_nw' }), ROW)));
check('a member acting for another of their organisations', () =>
  assert.ok(T.callerMayManageEvent(as({ groups: 'hosts', orgId: 'org_me', orgIds: 'org_me,org_nw' }), ROW)));
// rejects: the cross-tenant read this whole file exists to stop.
check('another organisation\'s member: no', () =>
  assert.ok(!T.callerMayManageEvent(as({ groups: 'hosts', orgId: 'org_md', orgIds: 'org_md' }), ROW)));
check('Engage staff who are not members: no', () =>
  assert.ok(!T.callerMayManageEvent(as({ groups: 'admins,hosts', orgId: '', orgIds: '' }), ROW)));
// rejects: callerMayDriveSession's anonymous door carried over.
check('an anonymous caller: no', () =>
  assert.ok(!T.callerMayManageEvent({}, ROW)));
check('a context naming the org but no group: no', () =>
  assert.ok(!T.callerMayManageEvent(as({ orgId: 'org_nw', orgIds: 'org_nw' }), ROW)));
// rejects: callerMayDriveSession's orgless door carried over.
check('a row with no organisation: no, even for its would-be members', () =>
  assert.ok(!T.callerMayManageEvent(as({ groups: 'hosts', orgId: 'org_nw', orgIds: 'org_nw' }), {})));
check('no row at all: no', () =>
  assert.ok(!T.callerMayManageEvent(as({ groups: 'hosts', orgId: 'org_nw', orgIds: 'org_nw' }), null)));
check('the session guard is unchanged: an orgless session still passes', () =>
  assert.ok(T.callerMayDriveSession(as({ groups: 'hosts', orgId: 'org_md' }), {})));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Add the entity checks to `tests/tenant-crypto.js`**

Insert this block immediately above the line `// ---------- 8. The three bundle copies are byte-identical ----------`:

```js
// ---------- 7b. An event and its agenda items (roadmap M1) ----------
// The host writes an event's name and place, and each item's title and
// description, for the room — org content, sealed as a session's title is.
// Everything the builder and the public agenda arithmetic reads (when, how
// long, what kind, which set) stays plaintext.
console.log('\n7b. an event and its items');
check('event seals exactly its title and place', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.event].sort(), ['Place', 'Title']));
check('item seals exactly its title and description', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.item].sort(), ['Description', 'Title']));
check('the schedule, the counts and the set pointer stay plaintext', () => {
  for (const f of ['StartsAt', 'TimeZone', 'Access', 'State', 'AttendeeReports', 'ItemCount', 'EngagementCount', 'BreakCount']) {
    assert.ok(!C.ENCRYPTED_FIELDS.event.includes(f), `event would encrypt ${f}`);
  }
  for (const f of ['Type', 'Order', 'Minutes', 'State', 'SetRef']) {
    assert.ok(!C.ENCRYPTED_FIELDS.item.includes(f), `item would encrypt ${f}`);
  }
});
check('an agenda item round-trips, and its words are not in the stored row', async () => {
  const org = await newOrg('org_event_fields');
  const row = { PK: 'EVENT#5307', SK: 'ITEM#it_0a1b2c3d', Type: 'trivia', Order: 3, Minutes: 15,
    Title: 'How well do you know our customers?', Description: 'Ten questions. Scored.' };
  const enc = await C.encryptItem(org, 'item', row);
  assert.ok(C.isEnvelope(enc.Title) && C.isEnvelope(enc.Description));
  assert.strictEqual(enc.Minutes, 15);
  assert.ok(!JSON.stringify(enc).includes('customers'));
  const back = await C.decryptItem(org, 'item', enc);
  assert.strictEqual(back.Title, row.Title);
  assert.strictEqual(back.Description, row.Description);
});

```

- [ ] **Step 3: Run both and watch them fail**

```bash
node tests/event-keys.js; echo "exit=$?"
node tests/tenant-crypto.js | tail -12; echo "exit=$?"
```

Expected: `event-keys.js` FAILs from its first check, `T.eventsIndexPk is not a function` (exit 1); `tenant-crypto.js` FAILs "event seals exactly its title and place" with `C.ENCRYPTED_FIELDS.event is not iterable` and the round trip with `tenant-crypto: unknown entity "item"` (exit 1).

- [ ] **Step 4: Add the key builders to `lambda-functions/game/tenant.js`**

Insert immediately above the `/**` that opens the comment `WHERE SAVED REPORTS ARE LISTED.`:

```js
/**
 * AN EVENT'S TWO PARTITIONS (docs/design/agenda-redesign/40-data-model.html).
 *
 *   PK: ORG#<org>#EVENTS  SK: EVENT#<code>   the org's list of its events
 *   PK: EVENT#<code>      SK: METADATA       the event itself
 *                         SK: ITEM#<id>      one row per agenda item
 *
 * The code IS the id, exactly as a session's is (`GAME#<code>`), and it is
 * reserved in the same global `GAMES` registry (websocket/code-reservation.js),
 * so an event and a session can never hold the same four digits. `EVENT#`
 * stays global for the reason `GAME#` does: an attendee reaches it by code
 * alone, knowing nothing of any organisation.
 *
 * A code is exactly four digits. Anything else throws, rather than building
 * `EVENT#undefined` or a key with a `#` smuggled into it.
 */
function eventsIndexPk(orgId) {
  const id = clean(orgId);
  if (!id) throw new Error('tenant: eventsIndexPk requires an orgId');
  return `ORG#${id}#EVENTS`;
}

const EVENT_CODE = /^\d{4}$/;
function eventPk(code) {
  const c = clean(typeof code === 'number' ? String(code) : code);
  if (!EVENT_CODE.test(c)) {
    throw new Error(`tenant: eventPk requires a four-digit code, got ${JSON.stringify(code)}`);
  }
  return `EVENT#${c}`;
}

```

- [ ] **Step 5: Add the guard, immediately above `function readableScopes(event) {`**

```js
/**
 * MAY THIS SIGNED-IN CALLER PLAN OR RUN THIS EVENT?
 *
 * The membership rule `callerMayDriveSession` settled, for the same reason: an
 * event names its owning organisation on its own row, so there is no library
 * for an active-org choice to resolve. Any member of that organisation may
 * plan its events, as any member may run its sessions.
 *
 * TWO DELIBERATE DIFFERENCES FROM THAT FUNCTION. It waves through a row with
 * no `orgId` and a caller in no group, because pre-tenancy sessions and
 * anonymous participants exist. Neither exists for an event: every event is
 * made inside an organisation (create-event.js refuses without one), and every
 * route that asks this sits behind the Cognito authorizer. So both are
 * refused here — a guard with no reason to be lenient is not lenient.
 *
 * Being Engage staff is not membership, as everywhere in this file. Callers
 * answer a refusal with 404, never 403: a 403 would confirm that a guessed
 * code names somebody else's event.
 *
 * @returns {boolean} true when the caller may act on this event
 */
function callerMayManageEvent(event, eventRow) {
  const eventOrg = clean(eventRow && eventRow.orgId);
  if (!eventOrg) return false;
  if (!callerGroups(event).length) return false;
  if (callerOrgId(event) === eventOrg) return true;
  return callerOrgIds(event).includes(eventOrg);
}

```

- [ ] **Step 6: Export them**

In `module.exports`, replace

```js
  scopePrefix, setsMetadataPk, setContentPk, promptsMetadataPk, personasPk, gamesIndexPk, orgPk, userPk,
```

with

```js
  scopePrefix, setsMetadataPk, setContentPk, promptsMetadataPk, personasPk, gamesIndexPk, orgPk, userPk,
  eventsIndexPk, eventPk,
```

and replace

```js
  callerMayDriveSession,
  requireOrg,
```

with

```js
  callerMayDriveSession, callerMayManageEvent,
  requireOrg,
```

- [ ] **Step 7: Add the two entities to `lambda-functions/game/tenant-crypto.js`**

Replace the closing lines of `ENCRYPTED_FIELDS`

```js
  surveyResults: Object.freeze(['Texts']),
});
```

with

```js
  surveyResults: Object.freeze(['Texts']),

  /** An event (docs/design/agenda-redesign/40-data-model.html): its METADATA
   *  row, PK=EVENT#<code>, and the organisation's list row,
   *  PK=ORG#<org>#EVENTS / SK=EVENT#<code>. The same two strings ride on both
   *  rows, so both are sealed — the `session` entity's reasoning about its
   *  index row, again. `StartsAt`, `TimeZone`, `Access`, `State`,
   *  `AttendeeReports` and the three counts are when, switches and counts,
   *  and stay plaintext. */
  event: Object.freeze(['Title', 'Place']),

  /** One agenda item: PK=EVENT#<code>, SK=ITEM#<id>. Its title and its
   *  description are what the host wrote for the room. `Type`, `Order`,
   *  `Minutes`, `State` and `SetRef` — a pointer to a question set, as a
   *  session's `QuestionSetId` is — are structure, and stay plaintext. */
  item: Object.freeze(['Title', 'Description']),
});
```

- [ ] **Step 8: Copy both files over their twins**

```bash
cp lambda-functions/game/tenant.js lambda-functions/websocket/tenant.js
cp lambda-functions/game/tenant.js lambda-functions/admin/shared/tenant.js
cp lambda-functions/game/tenant-crypto.js lambda-functions/websocket/tenant-crypto.js
cp lambda-functions/game/tenant-crypto.js lambda-functions/admin/shared/tenant-crypto.js
```

- [ ] **Step 9: Run them green, with the suites that hold the copies**

```bash
for t in event-keys tenant-crypto tenant-keys no-global-partition-literals tenant-infrastructure; do node tests/$t.js > /dev/null 2>&1; echo "$t exit=$?"; done
```

Expected: every line `exit=0`; `event-keys.js` reports `28 passed, 0 failed`, `tenant-crypto.js` four more passes than before.

- [ ] **Step 10: Commit**

```bash
git add tests/event-keys.js tests/tenant-crypto.js lambda-functions/game/tenant.js lambda-functions/websocket/tenant.js lambda-functions/admin/shared/tenant.js lambda-functions/game/tenant-crypto.js lambda-functions/websocket/tenant-crypto.js lambda-functions/admin/shared/tenant-crypto.js
git commit -m "An event has keys and sealed words: EVENT#<code>, ORG#<org>#EVENTS, and a membership guard

tenant.js (all three copies) builds an event's two partitions and refuses a
code that is not four digits; callerMayManageEvent is callerMayDriveSession's
membership rule without its orgless and anonymous doors, since neither exists
for an event. tenant-crypto.js seals the event's Title and Place and each
item's Title and Description (entities event and item).

Tests: tests/event-keys.js (new), tests/tenant-crypto.js §7b.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The agenda's rules, written once for the server and the console

One pure module decides what an event may hold (16 items, 8 engagements, breaks uncounted), when each item starts (the start plus the running total), what a host may type, and how long an event is kept. The item route (Task 7) and the builder (Task 14) both import it, so a rule pinned here holds on both sides of the wire.

**Files:**
- Create: `lambda-functions/websocket/events/agenda-rules.js`
- Create: `tests/event-agenda-rules.js`

**Interfaces:**
- Consumes: nothing (it must `require` nothing — the browser imports it).
- Produces (`module.exports`):
  - constants `MAX_ITEMS` (16), `MAX_ENGAGEMENTS` (8), `MAX_BREAKS` (16), `ENGAGEMENT_TYPES` (`['trivia','call-and-answer','poll','wavelength','survey']`), `PRESENTATION` (`'presentation'`), `BREAK` (`'break'`), `ITEM_TYPES`, `ADDABLE_TYPES` (`['trivia','call-and-answer','poll','wavelength','break']`), `COMING_SOON` (`{survey, presentation}` → sentence), `TYPE_LABELS`, `TYPE_ALIASES`, `CAP_SENTENCES` (`{engagements, items, breaks}`), `TITLE_MAX` (120), `PLACE_MAX` (120), `DESCRIPTION_MAX` (600), `MIN_MINUTES` (1), `MAX_MINUTES` (240), `ACCESS_CHOICES`, `ACCESS_NOW` (`['open']`), `REPORT_DEFAULTS` (`['full','anonymous','none']`), `DAY`, `KEEP_DAYS` (90), `MAX_DAYS_AHEAD` (366);
  - `canonicalSetType(raw) → string` (`''` for a type no event can play; blank → `'call-and-answer'`);
  - `isEngagement(type) → boolean`, `isCounted(type) → boolean`;
  - `countItems(items) → {items, engagements, breaks}` (reads `type` or `Type`);
  - `capRefusal(counts, type) → null | {cap: 'items'|'engagements'|'breaks', message}`;
  - `isTimeZone(zone) → boolean`; `parseStartsAt('YYYY-MM-DDTHH:MM') → {y, mo, d, h, mi} | null`;
  - `checkEventFields(input, {nowSeconds?}) → {value: {title, place, startsAt, timeZone, access, attendeeReports}} | {error}`;
  - `checkItemFields(input, type) → {value: {title, description, minutes}} | {error}`;
  - `clock(minutes) → 'H:MM'`; `agendaTimes(startsAt, items) → {rows: items with at/until, endsAt, totalMinutes}`; `formatDuration(total) → '2 h 43 min'`;
  - `eventTtl(startsAt, nowSeconds) → epoch seconds`;
  - `formatEventDay(startsAt) → 'Fri 9 Oct 2026'`, `formatStartTime(startsAt) → '9:00'`, `formatEventWhen(startsAt) → 'Fri 9 Oct · 9:00'`.

- [ ] **Step 1: Write the failing test**

Create `tests/event-agenda-rules.js`:

```js
/**
 * THE AGENDA'S RULES — lambda-functions/websocket/events/agenda-rules.js.
 *
 * One file decides the caps, the planned times and an event's lifetime, and
 * both the item route and the console's builder read it. So a rule pinned
 * here is pinned on both sides of the wire.
 *
 * The times fixture is the design's own agenda (docs/design/agenda-redesign/
 * _src/content.py): a 9:00 start, lengths 8, 30, 15, 20, a 15-minute break,
 * 35, 12, 20 and 8 — planned to end at 11:43, "2 h 43 min planned".
 *
 * rejects: a 17th item or a 9th engagement admitted; a break counted toward
 * either cap; a reorder that leaves a time where it was; an unreal date or
 * clock accepted; an event kept for a fixed 90 days from creation (an event
 * booked for next month would vanish before its day); a module the browser
 * cannot import (a require or a process read); the type aliases drifting from
 * game-types.js.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const FILE = path.join(REPO, 'lambda-functions/websocket/events/agenda-rules.js');
const R = require(FILE);

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}
const DAY = 24 * 60 * 60;

console.log('\n1. the caps: 16 items, 8 of them engagements, breaks count for nothing');
check('the numbers are the owner\'s', () => {
  assert.strictEqual(R.MAX_ITEMS, 16);
  assert.strictEqual(R.MAX_ENGAGEMENTS, 8);
});
check('a break counts toward neither cap', () =>
  assert.deepStrictEqual(R.countItems([{ type: 'trivia' }, { type: 'break' }, { Type: 'poll' }, { type: 'presentation' }]),
    { items: 3, engagements: 2, breaks: 1 }));
check('the 16th item is allowed', () =>
  assert.strictEqual(R.capRefusal({ items: 15, engagements: 7 }, 'trivia'), null));
check('a 17th item is refused with the sentence', () =>
  assert.deepStrictEqual(R.capRefusal({ items: 16, engagements: 7 }, 'trivia'),
    { cap: 'items', message: R.CAP_SENTENCES.items }));
check('a 9th engagement is refused while a 9th presentation is allowed', () => {
  assert.deepStrictEqual(R.capRefusal({ items: 8, engagements: 8 }, 'poll'),
    { cap: 'engagements', message: R.CAP_SENTENCES.engagements });
  assert.strictEqual(R.capRefusal({ items: 8, engagements: 8 }, 'presentation'), null);
});
check('a break is allowed at both caps', () =>
  assert.strictEqual(R.capRefusal({ items: 16, engagements: 8, breaks: 3 }, 'break'), null));
check('breaks have a ceiling of their own', () =>
  assert.strictEqual(R.capRefusal({ breaks: R.MAX_BREAKS }, 'break').cap, 'breaks'));
check('the refusal names the limit in the builder\'s words', () =>
  assert.strictEqual(R.CAP_SENTENCES.engagements,
    'This event has 8 engagements, the most one can hold. Remove one to add another.'));

console.log('\n2. the times follow the order');
const DESIGN = [8, 30, 15, 20, 15, 35, 12, 20, 8].map((minutes, i) => ({ id: `i${i}`, minutes }));
check('the design\'s agenda starts where the mockup says', () => {
  const { rows, endsAt, totalMinutes } = R.agendaTimes('2026-10-09T09:00', DESIGN);
  assert.deepStrictEqual(rows.map((r) => r.at),
    ['9:00', '9:08', '9:38', '9:53', '10:13', '10:28', '11:03', '11:15', '11:35']);
  assert.strictEqual(rows[4].until, '10:28');
  assert.strictEqual(endsAt, '11:43');
  assert.strictEqual(R.formatDuration(totalMinutes), '2 h 43 min');
});
check('moving an item moves every time after it, and nothing before', () => {
  const moved = [DESIGN[0], DESIGN[3], DESIGN[2], DESIGN[1], ...DESIGN.slice(4)];
  const { rows, endsAt } = R.agendaTimes('2026-10-09T09:00', moved);
  assert.deepStrictEqual(rows.slice(0, 4).map((r) => r.at), ['9:00', '9:08', '9:28', '9:43']);
  assert.strictEqual(endsAt, '11:43');
});
check('Minutes (a stored row) works as well as minutes', () =>
  assert.strictEqual(R.agendaTimes('2026-10-09T13:30', [{ Minutes: 45 }]).endsAt, '14:15'));
check('an agenda that runs past midnight wraps the clock', () =>
  assert.strictEqual(R.agendaTimes('2026-10-09T23:30', [{ minutes: 45 }]).endsAt, '0:15'));
check('under an hour reads in minutes', () => assert.strictEqual(R.formatDuration(45), '45 min'));

console.log('\n3. a start is a real day and a real clock');
check('a real start parses', () =>
  assert.deepStrictEqual(R.parseStartsAt('2026-10-09T09:00'), { y: 2026, mo: 10, d: 9, h: 9, mi: 0 }));
for (const bad of ['2026-02-30T09:00', '2026-10-09 09:00', '2026-10-09T24:00', '2026-10-09T09:60', '9:00', '', null]) {
  check(`${JSON.stringify(bad)} is refused`, () => assert.strictEqual(R.parseStartsAt(bad), null));
}
check('9 Oct 2026 is a Friday', () => {
  assert.strictEqual(R.formatEventDay('2026-10-09T09:00'), 'Fri 9 Oct 2026');
  assert.strictEqual(R.formatEventWhen('2026-10-09T09:00'), 'Fri 9 Oct · 9:00');
  assert.strictEqual(R.formatStartTime('2026-10-09T13:05'), '13:05');
});

console.log('\n4. an event is kept 90 days after its day, never less than 90 from now');
const NOW = Date.UTC(2026, 8, 26, 12, 0) / 1000;           // 26 Sep 2026, 12:00 UTC
check('a future event: two days after its date, plus 90', () =>
  assert.strictEqual(R.eventTtl('2026-10-09T09:00', NOW), Date.UTC(2026, 9, 11) / 1000 + 90 * DAY));
// rejects: session-ttl's creation clock — an event booked for next month
// would expire weeks after its own day, or before it for one booked far ahead.
check('an event months ahead outlives its day by the full 90', () =>
  assert.ok(R.eventTtl('2027-06-01T09:00', NOW) > Date.UTC(2027, 5, 1) / 1000 + 89 * DAY));
check('an event dated in the past is kept 90 days from now', () =>
  assert.strictEqual(R.eventTtl('2026-01-01T09:00', NOW), NOW + 90 * DAY));
check('the day after the date has ended everywhere on Earth', () =>
  assert.ok(R.eventTtl('2026-10-09T23:59', NOW) - 90 * DAY > Date.UTC(2026, 9, 10, 11, 59) / 1000));

console.log('\n5. the details a host types');
const GOOD = { title: '  Q4 Kickoff ', place: 'Harbour Room', startsAt: '2026-10-09T09:00', timeZone: 'Europe/London' };
check('good details come back trimmed, open, reports Full', () =>
  assert.deepStrictEqual(R.checkEventFields(GOOD, { nowSeconds: NOW }).value,
    { title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: '2026-10-09T09:00', timeZone: 'Europe/London', access: 'open', attendeeReports: 'full' }));
for (const [label, patch, error] of [
  ['no name', { title: ' ' }, /name/],
  ['no start', { startsAt: '2026-10-09' }, /date and a start/],
  ['an unknown zone', { timeZone: 'Mars/Base' }, /time zone/],
  ['invite-only, before Phase 3', { access: 'invite' }, /Invite-only events are not available yet/],
  ['an unknown access', { access: 'private' }, /who can join/],
  ['an unknown report default', { attendeeReports: 'some' }, /each report/],
  ['a date more than a year out', { startsAt: '2028-01-01T09:00' }, /within the next year/],
  ['a 121-character name', { title: 'x'.repeat(121) }, /120 characters/],
]) {
  check(`${label} is refused`, () =>
    assert.match(R.checkEventFields({ ...GOOD, ...patch }, { nowSeconds: NOW }).error || '', error));
}
check('an item needs a title, unless it is a break', () => {
  assert.match(R.checkItemFields({ minutes: 10 }, 'trivia').error, /title/);
  assert.deepStrictEqual(R.checkItemFields({ minutes: 10 }, 'break').value,
    { title: 'Break', description: '', minutes: 10 });
});
for (const minutes of [0, 241, 2.5, 'fifteen', null]) {
  check(`a length of ${JSON.stringify(minutes)} is refused`, () =>
    assert.match(R.checkItemFields({ title: 'x', minutes }, 'trivia').error || '', /whole number of minutes/));
}

console.log('\n6. which kinds exist, and which may be added now');
check('presentations and survey items are listed but not addable', () => {
  assert.ok(R.ITEM_TYPES.includes('presentation') && R.ITEM_TYPES.includes('survey'));
  assert.ok(!R.ADDABLE_TYPES.includes('presentation') && !R.ADDABLE_TYPES.includes('survey'));
  assert.ok(R.COMING_SOON.presentation && R.COMING_SOON.survey);
});
check('a set row\'s type reads as an engagement type, old spellings included', () => {
  assert.strictEqual(R.canonicalSetType('quiz'), 'trivia');
  assert.strictEqual(R.canonicalSetType('callandanswer'), 'call-and-answer');
  assert.strictEqual(R.canonicalSetType(undefined), 'call-and-answer');
  assert.strictEqual(R.canonicalSetType('banana'), '');
});
check('the aliases are game-types.js\'s, both copies', () => {
  for (const rel of ['lambda-functions/game/game-types.js', 'lambda-functions/admin/shared/game-types.js']) {
    assert.deepStrictEqual({ ...R.TYPE_ALIASES }, { ...require(path.join(REPO, rel)).ALIASES }, rel);
  }
});

console.log('\n7. the browser can import it');
check('no require and no process in the code (comments aside)', () => {
  const code = fs.readFileSync(FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\brequire\s*\(/.test(code), 'it requires something');
  assert.ok(!/\bprocess\./.test(code), 'it reads process');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/event-agenda-rules.js; echo "exit=$?"
```

Expected: `Error: Cannot find module '…/lambda-functions/websocket/events/agenda-rules.js'`, exit 1.

- [ ] **Step 3: Write the module**

Create `lambda-functions/websocket/events/agenda-rules.js`:

```js
/**
 * THE AGENDA'S RULES — what an event may hold, when each item starts, and how
 * long the event's rows are kept. Written once, and read on both sides of the
 * wire: the event routes in this folder, and the console's builder
 * (src/src/components/EventBuilder.jsx, EventItemDialog.jsx and
 * EventDetailsDialog.jsx import this file, as PlanRequestDialog.jsx imports
 * lambda-functions/game/pricing.js).
 *
 * PURE. No AWS SDK, no `process`, no DOM, and no clock of its own: a caller
 * that needs "now" passes it. That is what lets one file be the rule in a
 * Lambda and in a browser, and lets tests/event-agenda-rules.js pin it with no
 * stubs. `require` must never appear in this file; that test reads it as text.
 *
 * ── THE CAPS (owner, 23 Sep 2026, decision 1) ─────────────────────────────
 * "up to 16 agenda items with 8 of them being engagement sessions".
 *   - A BREAK counts toward neither (decision 7): "breaks should be listed but
 *     dont count toward any count".
 *   - A break is still a row, so it has a ceiling of its own, MAX_BREAKS. Not
 *     a limit anybody asked for: a bound that keeps a whole agenda (16 + 16
 *     rows) inside one DynamoDB transaction (100 items) when it is reordered
 *     or re-dated.
 *
 * ── THE TIMES ──────────────────────────────────────────────────────────────
 * "The planned times are the event's start plus the running total"
 * (RATIONALE §b). Nothing is stored per item: move one and every time after it
 * moves, on the server and in the builder alike, because both call
 * `agendaTimes`. `startsAt` is the event's LOCAL wall-clock start,
 * `YYYY-MM-DDTHH:MM`, read in the event's own `timeZone` (40-data-model:
 * `StartsAt "2026-10-09T09:00"`, `TimeZone "Europe/London"`). Times print as
 * that wall clock, 24-hour, never converted: the agenda is a printed plan and
 * reads the same on every phone, laptop or tablet.
 *
 * ── HOW LONG AN EVENT IS KEPT ──────────────────────────────────────────────
 * RATIONALE §b: event rows are kept 90 days after the event. A session's clock
 * (session-ttl.js) runs from its creation, 90 days unstarted, 7 once started.
 * An event is booked weeks ahead, so its clock runs from its DATE, and never
 * from before now. `eventTtl` takes UTC midnight two days after the event's
 * date — later than the last minute of that date in every time zone on Earth
 * (UTC-12 to UTC+14) — plus 90 days. The code's reservation carries the same
 * figure, so the code outlives the day and its child sessions' 7 days by more
 * than 80 days, and websocket/code-reservation.js refuses the code to anyone
 * while an EVENT# row is still there (DynamoDB deletes lazily).
 */

const MAX_ITEMS = 16;
const MAX_ENGAGEMENTS = 8;
const MAX_BREAKS = 16;

const ENGAGEMENT_TYPES = Object.freeze(['trivia', 'call-and-answer', 'poll', 'wavelength', 'survey']);
const PRESENTATION = 'presentation';
const BREAK = 'break';
const ITEM_TYPES = Object.freeze([...ENGAGEMENT_TYPES, PRESENTATION, BREAK]);

/**
 * What a host may ADD in this release. Survey items wait for the event's
 * survey design (PLAN Phase 6) and presentations for roadmap M5; the add menu
 * lists both, disabled, with COMING_SOON, and the item route refuses both so a
 * stale client cannot add one.
 */
const ADDABLE_TYPES = Object.freeze(['trivia', 'call-and-answer', 'poll', 'wavelength', BREAK]);
const COMING_SOON = Object.freeze({
  survey: 'Survey items are coming soon.',
  [PRESENTATION]: 'Presentations are coming soon.',
});

const TYPE_LABELS = Object.freeze({
  trivia: 'Trivia',
  'call-and-answer': 'Call & Answer',
  poll: 'Poll',
  wavelength: 'Wavelength',
  survey: 'Survey',
  [PRESENTATION]: 'Presentation',
  [BREAK]: 'Break',
});

/**
 * Set rows store `engagementType` under older spellings too. A verbatim copy
 * of ALIASES in lambda-functions/game/game-types.js and src/src/config/
 * gameTypes.js — the websocket bundle carries no game-types.js — and
 * tests/event-agenda-rules.js holds them equal.
 */
const TYPE_ALIASES = Object.freeze({
  callandanswer: 'call-and-answer',
  call_and_answer: 'call-and-answer',
  calland: 'call-and-answer',
  quiz: 'trivia',
  polls: 'poll',
});

/** A set row's type as an engagement type, or '' for one no event can play. */
function canonicalSetType(raw) {
  const key = String(raw == null ? '' : raw).trim().toLowerCase();
  // A set row with no type predates the field; create-game.js has always
  // played one as Call & Answer.
  if (!key) return 'call-and-answer';
  if (ENGAGEMENT_TYPES.includes(key)) return key;
  return TYPE_ALIASES[key] || '';
}

const isEngagement = (type) => ENGAGEMENT_TYPES.includes(type);
const isCounted = (type) => type !== BREAK;

/** `{items, engagements, breaks}` for a list of items (`type` or `Type`). */
function countItems(items) {
  const out = { items: 0, engagements: 0, breaks: 0 };
  for (const it of items || []) {
    const type = it && (it.type || it.Type);
    if (type === BREAK) {
      out.breaks += 1;
    } else {
      out.items += 1;
      if (isEngagement(type)) out.engagements += 1;
    }
  }
  return out;
}

/** The sentences a refusal says, in the builder's menu and from the server alike. */
const CAP_SENTENCES = Object.freeze({
  engagements: `This event has ${MAX_ENGAGEMENTS} engagements, the most one can hold. Remove one to add another.`,
  items: `This event has ${MAX_ITEMS} items, the most one can hold. Remove one to add another.`,
  breaks: `This event has ${MAX_BREAKS} breaks, the most one can hold.`,
});

/** Why an item of `type` cannot join an agenda holding `counts`, or null. */
function capRefusal(counts, type) {
  const c = counts || {};
  if (type === BREAK) {
    return (Number(c.breaks) || 0) >= MAX_BREAKS ? { cap: 'breaks', message: CAP_SENTENCES.breaks } : null;
  }
  if ((Number(c.items) || 0) >= MAX_ITEMS) return { cap: 'items', message: CAP_SENTENCES.items };
  if (isEngagement(type) && (Number(c.engagements) || 0) >= MAX_ENGAGEMENTS) {
    return { cap: 'engagements', message: CAP_SENTENCES.engagements };
  }
  return null;
}

// ── Fields ──────────────────────────────────────────────────────────────────
const TITLE_MAX = 120;
const PLACE_MAX = 120;
const DESCRIPTION_MAX = 600;
const MIN_MINUTES = 1;
const MAX_MINUTES = 240;
/** Who can join. `invite` is PLAN Phase 3; the dialog shows it, disabled. */
const ACCESS_CHOICES = Object.freeze(['open', 'invite']);
const ACCESS_NOW = Object.freeze(['open']);
/** What attendees get of each report (decision 3); Full unless changed. */
const REPORT_DEFAULTS = Object.freeze(['full', 'anonymous', 'none']);

const DAY = 24 * 60 * 60;
const KEEP_DAYS = 90;
const MAX_DAYS_AHEAD = 366;

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** Is this an IANA time zone this runtime knows? */
function isTimeZone(zone) {
  const z = text(zone);
  if (!z) return false;
  try {
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone: z }).resolvedOptions().timeZone);
  } catch (e) {
    return false;
  }
}

/** `YYYY-MM-DDTHH:MM` on a real calendar day, as numbers, or null. */
function parseStartsAt(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text(value));
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, mo, d, h, mi };
}

/**
 * An event's details, checked and normalised — for the new-event dialog and
 * for POST and PUT /events alike. `nowSeconds`, when given, bounds how far
 * ahead a date may be: a code held for years is a code nobody else can have.
 * @returns {{value?: object, error?: string}}
 */
function checkEventFields(input, { nowSeconds } = {}) {
  const i = input || {};
  const title = text(i.title);
  if (!title) return { error: 'Give the event a name.' };
  if (title.length > TITLE_MAX) return { error: `A name can be ${TITLE_MAX} characters at most.` };
  const place = text(i.place);
  if (place.length > PLACE_MAX) return { error: `A place can be ${PLACE_MAX} characters at most.` };
  const startsAt = text(i.startsAt);
  const s = parseStartsAt(startsAt);
  if (!s) return { error: 'Choose a date and a start time.' };
  if (Number.isFinite(nowSeconds)) {
    const day = Date.UTC(s.y, s.mo - 1, s.d) / 1000;
    if (day > nowSeconds + MAX_DAYS_AHEAD * DAY) return { error: 'Choose a date within the next year.' };
  }
  const timeZone = text(i.timeZone);
  if (!isTimeZone(timeZone)) return { error: 'Choose a time zone.' };
  const access = text(i.access) || 'open';
  if (!ACCESS_CHOICES.includes(access)) return { error: 'Choose who can join.' };
  if (!ACCESS_NOW.includes(access)) return { error: 'Invite-only events are not available yet.' };
  const attendeeReports = text(i.attendeeReports) || 'full';
  if (!REPORT_DEFAULTS.includes(attendeeReports)) return { error: 'Choose what attendees get of each report.' };
  return { value: { title, place, startsAt, timeZone, access, attendeeReports } };
}

/**
 * An item's own words and length. A break may leave its title blank; it is
 * then called "Break".
 * @returns {{value?: {title, description, minutes}, error?: string}}
 */
function checkItemFields(input, type) {
  const i = input || {};
  const title = text(i.title) || (type === BREAK ? 'Break' : '');
  if (!title) return { error: 'Give the item a title for the agenda.' };
  if (title.length > TITLE_MAX) return { error: `A title can be ${TITLE_MAX} characters at most.` };
  const description = text(i.description);
  if (description.length > DESCRIPTION_MAX) {
    return { error: `A description can be ${DESCRIPTION_MAX} characters at most.` };
  }
  const minutes = Number(i.minutes);
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    return { error: `A planned length is a whole number of minutes, ${MIN_MINUTES} to ${MAX_MINUTES}.` };
  }
  return { value: { title, description, minutes } };
}

// ── Times ───────────────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');

/** Minutes after midnight as a 24-hour wall clock, `9:05`; wraps past midnight. */
function clock(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}:${pad2(m % 60)}`;
}

/**
 * Every item's planned start and end, in agenda order, and when the day ends.
 * Items are taken in the order given; each needs `minutes` (or `Minutes`).
 * @returns {{rows: Array<object>, endsAt: string, totalMinutes: number}}
 */
function agendaTimes(startsAt, items) {
  const s = parseStartsAt(startsAt);
  const start = s ? s.h * 60 + s.mi : 0;
  let t = start;
  const rows = (items || []).map((item) => {
    const minutes = Number(item && (item.minutes !== undefined ? item.minutes : item.Minutes)) || 0;
    const row = { ...item, at: clock(t), until: clock(t + minutes) };
    t += minutes;
    return row;
  });
  return { rows, endsAt: clock(t), totalMinutes: t - start };
}

/** `2 h 43 min`, or `45 min`. */
function formatDuration(totalMinutes) {
  const total = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Epoch seconds at which an event dated `startsAt` may be forgotten. */
function eventTtl(startsAt, nowSeconds) {
  const s = parseStartsAt(startsAt);
  const now = Number.isFinite(nowSeconds) ? Math.floor(nowSeconds) : 0;
  const afterTheDay = s ? Math.floor(Date.UTC(s.y, s.mo - 1, s.d + 2) / 1000) : now;
  return Math.max(afterTheDay, now) + KEEP_DAYS * DAY;
}

// ── Words for a date ────────────────────────────────────────────────────────
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function weekdayOf(s) {
  return WEEKDAYS[new Date(Date.UTC(s.y, s.mo - 1, s.d)).getUTCDay()];
}

/** `Fri 9 Oct 2026` — the facts strip and the agenda page. */
function formatEventDay(startsAt) {
  const s = parseStartsAt(startsAt);
  return s ? `${weekdayOf(s)} ${s.d} ${MONTHS[s.mo - 1]} ${s.y}` : '';
}

/** `9:00` — the start, as the agenda prints times. */
function formatStartTime(startsAt) {
  const s = parseStartsAt(startsAt);
  return s ? clock(s.h * 60 + s.mi) : '';
}

/** `Fri 9 Oct · 9:00` — the events list's When column. */
function formatEventWhen(startsAt) {
  const s = parseStartsAt(startsAt);
  return s ? `${weekdayOf(s)} ${s.d} ${MONTHS[s.mo - 1]} · ${formatStartTime(startsAt)}` : '';
}

module.exports = {
  MAX_ITEMS, MAX_ENGAGEMENTS, MAX_BREAKS,
  ENGAGEMENT_TYPES, PRESENTATION, BREAK, ITEM_TYPES, ADDABLE_TYPES, COMING_SOON,
  TYPE_LABELS, TYPE_ALIASES, CAP_SENTENCES,
  TITLE_MAX, PLACE_MAX, DESCRIPTION_MAX, MIN_MINUTES, MAX_MINUTES,
  ACCESS_CHOICES, ACCESS_NOW, REPORT_DEFAULTS, DAY, KEEP_DAYS, MAX_DAYS_AHEAD,
  canonicalSetType, isEngagement, isCounted, countItems, capRefusal,
  isTimeZone, parseStartsAt, checkEventFields, checkItemFields,
  clock, agendaTimes, formatDuration, eventTtl,
  formatEventDay, formatStartTime, formatEventWhen,
};
```

- [ ] **Step 4: Run it green**

```bash
node tests/event-agenda-rules.js | tail -1; echo "exit=$?"
```

Expected: `45 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/websocket/events/agenda-rules.js tests/event-agenda-rules.js
git commit -m "The agenda's rules are one pure module: 16 items, 8 engagements, breaks uncounted, times from the start

agenda-rules.js decides the caps (decision 1, breaks uncounted per decision
7), the planned times (the start plus the running total), what a host may
type for an event and an item, and an event's lifetime: 90 days after its
day, never less than 90 from now. The server's item route and the console's
builder both import it, so a rule holds on both sides of the wire.

Tests: tests/event-agenda-rules.js (the design's own 9:00-11:43 agenda).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: One code space and one lock for sessions and events

An event reserves its four-digit code in the same `GAMES` registry, under the same `attribute_not_exists(PK)` put, as a session (PLAN Phase 1 "Code reservation"). The put and the draw move out of `schema-compliant-manager.js` and `create-game.js` into `code-reservation.js`, which both creates use. Bug sweep Task 2's rule — a code whose `GAME#` partition still holds any row is not drawn — moves with them: out of step 0 of `createGame`, into the draw, where an event's create asks it too; and it extends to `EVENT#`. The session delete route stops being able to release an event's code. This task also builds the test harness every event suite uses.

**Files:**
- Create: `lambda-functions/websocket/code-reservation.js`
- Modify: `lambda-functions/websocket/schema-compliant-manager.js` (the `./tenant` import at line 5; the header comment's step-0 sentence at ~61–66; step 0 itself at ~83–142; the reservation put at ~193–208; the release and its comment at ~582–598)
- Modify: `lambda-functions/websocket/create-game.js` (imports at lines 1–8; the draw loop from ~224 to the `console.log(\`✅ Game …\`)` line at ~313)
- Modify: `lambda-functions/admin/delete-game.js` (after the reservation read, ~62–66)
- Create: `tests/helpers/event-harness.js`
- Create: `tests/event-code-reservation.js`

**Interfaces:**
- Consumes: `eventPk(code)`, `GAMES_RESERVATION_PK` from `websocket/tenant.js` (Task 1).
- Produces (`websocket/code-reservation.js`):
  - `MAX_CODE_ATTEMPTS` (8), `CODE_KINDS` (`['session','event']`), `class CodeSpaceExhausted extends Error` (`name`, `attempts`);
  - `drawCode() → string` (`Math.floor(1000 + Math.random() * 9000)` — keep exactly this: suites force codes through `Math.random`);
  - `codeHasRows(db, tableName, code) → Promise<boolean>` — a strongly consistent `Query` with `Limit: 1` on `GAME#<code>`, then on `EVENT#<code>`;
  - `claimCode(db, {code, orgId, ttl, kind, tableName}) → Promise<void>` — the lock; throws `ConditionalCheckFailedException` when held. Row: `{PK:'GAMES', SK:'GAME#<code>', orgId?, Kind:'event' (events only), ttl}`;
  - `releaseCode(db, {code, tableName}) → Promise<void>`;
  - `reserveCode(db, {orgId, ttl, kind, claim, draw, attempts, tableName}) → Promise<string>` — draws until `codeHasRows` is false and `claim(code)` succeeds; `ConditionalCheckFailedException` from the claim means draw again; any other error propagates; after `attempts` throws `CodeSpaceExhausted`.
- Produces (`tests/helpers/event-harness.js`): `installEventHarness({eventsEnabled}) → {table, sent, REPO, load(rel)}`, `asHost(orgId, {groups, orgIds, userId, orgRole})`, `request({method, path, pathParameters, body, requestContext})`, `seedOrg(table, orgId, {plan, type, name})`, `startsIn(days, clockTime) → 'YYYY-MM-DDTHH:MM'`, `drawing(...codes)`, `offerCodes(...codes) → restore()`, `bodyOf(res)`, `REPO`.

- [ ] **Step 1: Write the harness**

Create `tests/helpers/event-harness.js`:

```js
/**
 * THE EVENT SUITES' TABLE, SDK AND KMS — installed once, before any handler
 * loads (roadmap M1, docs/superpowers/plans/2026-09-26-events-m1-event-and-builder.md).
 *
 * Every event suite drives real handlers against player-table.js's fake, which
 * EVALUATES ConditionExpressions and applies TransactWrites all-or-nothing, as
 * DynamoDB does. That matters more here than anywhere: the agenda's caps are
 * held by a transaction condition, and a fake that accepted every write would
 * pass a builder that lets two hosts add a ninth engagement. It also pages a
 * Query when `table.pageSize` is set, which is how a suite proves a handler
 * follows LastEvaluatedKey (the same model as paged-table.js; the event suites
 * need transactions, which only player-table.js models).
 *
 * THE SDK IS INTERCEPTED BY REQUEST STRING (Module._load), not by resolved
 * path. The websocket and admin bundles each carry their own node_modules, and
 * a path stub quietly misses one of them — the suite then dies on credentials
 * instead of on an assertion.
 *
 * KMS is tenant-crypto-stub.js's: it refuses a Decrypt with a missing or
 * mismatched encryption context, and `installTestKeyLoader` gives every bundle
 * copy a data key per org, different per org, so a cross-tenant decrypt still
 * fails here as it would in production.
 */
const path = require('path');
const Module = require('module');
const {
  createTable,
  GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
  BatchGetCommand, TransactWriteCommand,
} = require('./player-table');
const kmsStubs = require('./tenant-crypto-stub');

const REPO = path.join(__dirname, '..', '..');

/**
 * @param {{eventsEnabled?: string|null}} [opts] the EVENTS_ENABLED value to
 *   start with; null leaves it unset.
 * @returns {{table, sent, REPO, load: (rel: string) => any}}
 */
function installEventHarness({ eventsEnabled = 'on' } = {}) {
  const table = createTable();
  const sent = [];
  const stubs = new Map([
    ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
    ['@aws-sdk/lib-dynamodb', {
      DynamoDBDocumentClient: { from: () => table.doc },
      GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
      BatchGetCommand, TransactWriteCommand,
    }],
    ['@aws-sdk/client-kms', kmsStubs.makeKmsStub().exports],
    ['@aws-sdk/client-apigatewaymanagementapi', {
      ApiGatewayManagementApiClient: class {
        async send(command) { sent.push(command.input); return {}; }
      },
      PostToConnectionCommand: class { constructor(input) { this.input = input; } },
    }],
  ]);
  const realLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (stubs.has(request)) return stubs.get(request);
    return realLoad.call(this, request, parent, isMain);
  };

  process.env.TABLE_NAME = 'test-table';
  process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
  process.env.AWS_REGION = 'us-east-1';
  process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
  if (eventsEnabled === null) delete process.env.EVENTS_ENABLED;
  else process.env.EVENTS_ENABLED = eventsEnabled;

  kmsStubs.installTestKeyLoader();
  return { table, sent, REPO, load: (rel) => require(path.join(REPO, rel)) };
}

/** The authorizer's context for a signed-in host acting for `orgId`. */
function asHost(orgId, { groups = 'hosts', orgIds = orgId, userId = 'u_host', orgRole = 'member' } = {}) {
  return { authorizer: { lambda: { userId, groups, orgId, orgIds, orgRole } } };
}

/** An HTTP API (payload 2.0) request, as a handler receives it. */
function request({ method = 'GET', path: routePath = '/', pathParameters = {}, body, requestContext = null } = {}) {
  return {
    pathParameters,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    requestContext: { ...(requestContext || {}), http: { method, path: routePath } },
  };
}

/** An organisation's METADATA row: its plan decides the Team-plan gate. */
function seedOrg(table, orgId, { plan = 'team', type = 'team', name = orgId } = {}) {
  table.put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, plan, type, name });
}

/** `YYYY-MM-DDTHH:MM`, `days` from now (UTC date), for a start the rules accept. */
function startsIn(days, clockTime = '09:00') {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${clockTime}`;
}

/** A forced draw: offer these codes in order, then fail loudly. */
function drawing(...codes) {
  const queue = codes.map(String);
  return () => {
    if (!queue.length) throw new Error('the draw asked for more codes than the test offered');
    return queue.shift();
  };
}

/** Make `Math.random` offer these four-digit codes to drawCode(), in order. */
function offerCodes(...codes) {
  const queue = codes.slice();
  const real = Math.random;
  Math.random = () => {
    if (!queue.length) throw new Error('Math.random was asked for more codes than the test offered');
    return (Number(queue.shift()) - 1000 + 0.5) / 9000;
  };
  return () => { Math.random = real; };
}

const bodyOf = (res) => JSON.parse(res.body);

module.exports = {
  installEventHarness, asHost, request, seedOrg, startsIn, drawing, offerCodes, bodyOf, REPO,
};
```

- [ ] **Step 2: Write the failing test**

Create `tests/event-code-reservation.js`:

```js
/**
 * ONE CODE SPACE, ONE LOCK, FOR SESSIONS AND EVENTS —
 * lambda-functions/websocket/code-reservation.js.
 *
 * An event reserves its four-digit code in the same `GAMES` registry, under
 * the same `attribute_not_exists(PK)` put, as a session (PLAN Phase 1,
 * "Code reservation"). So the two can never hold the same number, and a code
 * is never drawn while rows of an older session or event remain under it
 * (bug sweep 2026-09-26 Task 2's rule, extended to EVENT#).
 *
 * rejects: an event reservation without `Kind: "event"`; a session
 * reservation that grows a field; a claim over a held code; a code drawn while
 * its GAME# or EVENT# partition still has rows; an unbounded draw; a session
 * create handed an event's code, reserved or lapsed; the session delete route
 * releasing an event's code.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, seedOrg, drawing, offerCodes, bodyOf,
} = require('./helpers/event-harness');

const h = installEventHarness();
const { table } = h;
const R = h.load('lambda-functions/websocket/code-reservation.js');
const createGame = h.load('lambda-functions/websocket/create-game.js').handler;
const deleteGame = h.load('lambda-functions/admin/delete-game.js').handler;

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}
const reservation = (code) => table.get('GAMES', `GAME#${code}`);
const newSession = () => createGame({
  body: JSON.stringify({ eventTitle: 'Room', gameType: 'trivia' }),
  requestContext: asHost('org_nw'),
});

(async () => {
  console.log('\n1. the lock');
  table.clear();
  await check('an event reservation is {orgId, Kind: "event", ttl} and nothing else', async () => {
    const code = await R.reserveCode(table.doc, { orgId: 'org_nw', ttl: 1900000000, kind: 'event', draw: drawing('5307') });
    assert.strictEqual(code, '5307');
    assert.deepStrictEqual(reservation('5307'),
      { PK: 'GAMES', SK: 'GAME#5307', orgId: 'org_nw', Kind: 'event', ttl: 1900000000 });
  });
  // rejects: Kind leaking onto sessions — tenant-session-scoping.js holds the
  // session row to exactly {orgId, ttl}.
  await check('a session reservation stays {orgId, ttl}', async () => {
    await R.claimCode(table.doc, { code: '6120', orgId: 'org_nw', ttl: 1800000000, kind: 'session' });
    assert.deepStrictEqual(Object.keys(reservation('6120')).sort(), ['PK', 'SK', 'orgId', 'ttl']);
  });
  await check('claiming a held code throws ConditionalCheckFailedException and changes nothing', async () => {
    await assert.rejects(
      () => R.claimCode(table.doc, { code: '5307', orgId: 'org_md', ttl: 1, kind: 'session' }),
      (e) => e.name === 'ConditionalCheckFailedException');
    assert.strictEqual(reservation('5307').orgId, 'org_nw');
  });
  await check('an unknown kind or a missing ttl throws before anything is written', async () => {
    await assert.rejects(() => R.claimCode(table.doc, { code: '7001', ttl: 1, kind: 'party' }), /unknown kind/);
    await assert.rejects(() => R.claimCode(table.doc, { code: '7001', kind: 'event' }), /ttl/);
    assert.strictEqual(reservation('7001'), undefined);
  });

  console.log('\n2. a code is not drawn while its old rows remain');
  table.clear();
  table.put({ PK: 'GAME#4821', SK: 'PLAYER#Ada#SCORE', ttl: 1 });   // a lapsed session's 30-day row
  table.put({ PK: 'EVENT#3001', SK: 'ITEM#it_0000abcd', ttl: 1 });  // an expired event's agenda row
  await check('stale GAME# and EVENT# rows are skipped; the third draw is taken', async () => {
    const code = await R.reserveCode(table.doc, { orgId: 'org_nw', ttl: 1, kind: 'event', draw: drawing('4821', '3001', '7777') });
    assert.strictEqual(code, '7777');
    assert.strictEqual(reservation('4821'), undefined);
    assert.strictEqual(reservation('3001'), undefined);
    assert.ok(table.get('GAME#4821', 'PLAYER#Ada#SCORE') && table.get('EVENT#3001', 'ITEM#it_0000abcd'),
      'the stale rows were touched');
  });
  await check('each partition check is strongly consistent and reads one row', () => {
    const checks = table.log.filter((e) => e.type === 'query'
      && /^(GAME|EVENT)#(4821|3001|7777)$/.test(e.input.ExpressionAttributeValues[':pk']));
    assert.ok(checks.length >= 3, `only ${checks.length} partition checks were made`);
    for (const q of checks) {
      assert.strictEqual(q.input.ConsistentRead, true);
      assert.strictEqual(q.input.Limit, 1);
    }
  });

  console.log('\n3. eight collisions, then CodeSpaceExhausted');
  table.clear();
  const taken = ['1000', '1001', '1002', '1003', '1004', '1005', '1006', '1007'];
  taken.forEach((c) => table.put({ PK: 'GAMES', SK: `GAME#${c}`, ttl: 1 }));
  await check('eight held codes exhaust the draw', async () => {
    await assert.rejects(
      () => R.reserveCode(table.doc, { orgId: 'org_nw', ttl: 1, kind: 'event', draw: drawing(...taken) }),
      (e) => e instanceof R.CodeSpaceExhausted && e.attempts === 8);
  });
  await check('the session create still answers the honest 503', async () => {
    const restore = offerCodes(...taken);
    try {
      seedOrg(table, 'org_nw');
      const res = await newSession();
      assert.strictEqual(res.statusCode, 503, res.body);
      assert.match(bodyOf(res).error, /Could not allocate a session code/);
    } finally { restore(); }
  });

  console.log('\n4. sessions and events share one space');
  table.clear();
  seedOrg(table, 'org_nw');
  await R.reserveCode(table.doc, { orgId: 'org_nw', ttl: 2000000000, kind: 'event', draw: drawing('5307') });
  table.put({ PK: 'EVENT#5307', SK: 'METADATA', orgId: 'org_nw' });
  await check('a session create never takes a reserved event code', async () => {
    const restore = offerCodes(5307, 6120);
    try {
      const res = await newSession();
      assert.strictEqual(res.statusCode, 201, res.body);
      assert.strictEqual(bodyOf(res).gameId, '6120');
      assert.strictEqual(reservation('5307').Kind, 'event');
    } finally { restore(); }
  });
  // rejects: trusting the reservation alone. DynamoDB deletes it lazily, and
  // its absence must not hand the event's number to a session.
  await check('nor an event code whose reservation has lapsed while its rows remain', async () => {
    table.store.delete(table.keyOf('GAMES', 'GAME#5307'));
    const restore = offerCodes(5307, 7001);
    try {
      const res = await newSession();
      assert.strictEqual(res.statusCode, 201, res.body);
      assert.strictEqual(bodyOf(res).gameId, '7001');
      assert.strictEqual(table.get('GAME#5307', 'METADATA'), undefined, 'a session was written under the event code');
    } finally { restore(); }
  });

  console.log('\n5. the session routes leave an event\'s code alone');
  table.clear();
  await R.reserveCode(table.doc, { orgId: 'org_nw', ttl: 2000000000, kind: 'event', draw: drawing('5307') });
  await check('POST /admin/clear-game with an event\'s code answers 404 and keeps the reservation', async () => {
    const res = await deleteGame({
      pathParameters: { gameId: '5307' },
      requestContext: { ...asHost('org_nw'), http: { method: 'POST', path: '/admin/clear-game/5307' } },
    });
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.ok(reservation('5307'), 'the event\'s code was released');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 3: Run it and watch it fail**

```bash
node tests/event-code-reservation.js; echo "exit=$?"
```

Expected: `Error: Cannot find module '…/lambda-functions/websocket/code-reservation.js'`, exit 1.

- [ ] **Step 4: Write the module**

Create `lambda-functions/websocket/code-reservation.js`:

```js
/**
 * THE FOUR-DIGIT CODE, DRAWN AND LOCKED — for a session and for an event.
 *
 * A participant types four digits knowing nothing of any organisation, so the
 * code space is one global space (tenant.js, GAMES_RESERVATION_PK). A session
 * reserves its code there; since roadmap M1 an event does too, with the same
 * lock, so an event and a session can never hold the same number
 * (docs/design/agenda-redesign/40-data-model.html).
 *
 * ── THE LOCK ───────────────────────────────────────────────────────────────
 * `claimCode` is a conditional Put on `GAMES / GAME#<code>` under
 * `attribute_not_exists(PK)` (issue #26: a colliding draw once overwrote a
 * living session row by row). A collision throws
 * ConditionalCheckFailedException before anything else is written.
 *
 * NOTHING ELSE BELONGS ON THAT ROW. It once carried a whole session brief in a
 * partition every account could Query. A session's reservation is exactly
 * `{orgId, ttl}`: `orgId` says which org's index row to clean up when the code
 * is released. An event's adds `Kind: "event"` — routing, not content — so
 * `GET /join/{code}` can tell the two apart in one read. A session writes no
 * `Kind`; absent means a session, which is also what every row written before
 * events existed means.
 *
 * ── THE DRAW: A CODE WHOSE OLD ROWS REMAIN IS NOT FREE ────────────────────
 * The reservation expires with its session or event, but other rows outlive
 * it: a session's score rows, AI summaries and report live 30 days, and
 * DynamoDB deletes lazily (up to ~48h late). A code drawn again while those
 * rows are there would inherit them (bug sweep 2026-09-26, Task 2, which put
 * this check first as step 0 of schema-compliant-manager.js createGame; it
 * lives here now so that every draw — a session's, an event's, and roadmap
 * M3's item sessions' — asks it once, in one place). So a candidate is
 * skipped while its `GAME#<code>` partition holds ANY row — and while its
 * `EVENT#<code>` partition does: an expired event's agenda must never become
 * a new event's, nor a new session's code share a number with an event
 * somebody may still open.
 *
 *   - Each check is a strongly consistent Query with Limit 1.
 *   - A row past its `ttl` but not yet deleted still counts as taken. That is
 *     deliberate: "past its ttl" is not "gone".
 *   - ORDER: check the partitions, THEN take the lock. A second creator cannot
 *     write `GAME#` or `EVENT#` rows without first winning the same `GAMES`
 *     put, so nothing can appear in a checked partition between the check and
 *     a lock this draw wins. A race can only make the check too cautious,
 *     never too permissive.
 *   - No FilterExpression (a `ttl > :now` filter would make a row past its
 *     ttl look absent — the exact bug); tests/code-reuse-isolation.js asserts
 *     the Query's shape.
 *
 * Eight draws, then CodeSpaceExhausted, which the routes answer with an
 * honest 503: eight straight collisions means the space is effectively full,
 * and creating by luck past that point would be the same bug with better odds.
 */
const { QueryCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { GAMES_RESERVATION_PK, eventPk } = require('./tenant');

const MAX_CODE_ATTEMPTS = 8;
const CODE_KINDS = Object.freeze(['session', 'event']);

/** A random four-digit code, 1000–9999. */
const drawCode = () => Math.floor(1000 + Math.random() * 9000).toString();

class CodeSpaceExhausted extends Error {
  constructor(attempts) {
    super(`no free four-digit code after ${attempts} draws`);
    this.name = 'CodeSpaceExhausted';
    this.attempts = attempts;
  }
}

const reservationKey = (code) => ({ PK: GAMES_RESERVATION_PK, SK: `GAME#${code}` });

async function partitionHoldsRows(db, tableName, pk) {
  const res = await db.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': pk },
    Limit: 1,
    ConsistentRead: true,
  }));
  return Boolean(res && Array.isArray(res.Items) && res.Items.length);
}

/** Does anything — a session's rows or an event's — still live under this code? */
async function codeHasRows(db, tableName, code) {
  if (await partitionHoldsRows(db, tableName, `GAME#${code}`)) return true;
  return partitionHoldsRows(db, tableName, eventPk(code));
}

/**
 * THE LOCK. Throws ConditionalCheckFailedException when the code is held.
 * @param {{code: string, orgId?: string, ttl: number, kind?: 'session'|'event', tableName?: string}} spec
 */
async function claimCode(db, {
  code, orgId = '', ttl, kind = 'session', tableName = process.env.TABLE_NAME,
} = {}) {
  if (!CODE_KINDS.includes(kind)) throw new Error(`code-reservation: unknown kind ${JSON.stringify(kind)}`);
  if (!Number.isFinite(ttl)) throw new Error('code-reservation: a ttl (epoch seconds) is required');
  const org = typeof orgId === 'string' ? orgId.trim() : '';
  await db.send(new PutCommand({
    TableName: tableName,
    ConditionExpression: 'attribute_not_exists(PK)',
    Item: {
      ...reservationKey(code),
      ...(org ? { orgId: org } : {}),
      ...(kind === 'event' ? { Kind: 'event' } : {}),
      ttl,
    },
  }));
}

/** Give a code back. Only ever for a create that failed after its own claim. */
async function releaseCode(db, { code, tableName = process.env.TABLE_NAME } = {}) {
  await db.send(new DeleteCommand({ TableName: tableName, Key: reservationKey(code) }));
}

/**
 * Draw codes until one is free and claimed, and return it.
 *
 * `claim(code)` is what takes the lock. The default is `claimCode` with this
 * call's `orgId`, `ttl` and `kind` — what an event create uses. A session
 * create passes its own: `createGame(code, …)`, whose FIRST write is
 * `claimCode`, so the lock and the session's rows stay one operation with one
 * release path (schema-compliant-manager.js). Either way a
 * ConditionalCheckFailedException means "lost the race, draw again"; any
 * other error is not this loop's to swallow and propagates.
 *
 * @returns {Promise<string>} the code
 * @throws {CodeSpaceExhausted} after `attempts` draws found nothing free
 */
async function reserveCode(db, {
  orgId = '', ttl, kind = 'session', claim = null, draw = drawCode,
  attempts = MAX_CODE_ATTEMPTS, tableName = process.env.TABLE_NAME,
} = {}) {
  const take = claim || ((code) => claimCode(db, { code, orgId, ttl, kind, tableName }));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const code = String(draw());
    if (await codeHasRows(db, tableName, code)) {
      console.warn(`⚠️ code ${code} still has rows — drawing again (${attempt}/${attempts})`);
      continue;
    }
    try {
      await take(code);
      return code;
    } catch (error) {
      if (error && error.name === 'ConditionalCheckFailedException') {
        console.warn(`⚠️ code ${code} is already reserved — drawing again (${attempt}/${attempts})`);
        continue;
      }
      throw error;
    }
  }
  throw new CodeSpaceExhausted(attempts);
}

module.exports = {
  MAX_CODE_ATTEMPTS, CODE_KINDS, CodeSpaceExhausted,
  drawCode, codeHasRows, claimCode, releaseCode, reserveCode,
};
```

- [ ] **Step 5: Run it again — the wiring is still missing**

```bash
node tests/event-code-reservation.js 2>/dev/null | grep -E "FAIL|passed"
```

Expected: exactly two FAILs — `nor an event code whose reservation has lapsed while its rows remain` (the session draw does not yet look at `EVENT#`) and `POST /admin/clear-game with an event's code answers 404 and keeps the reservation` — and `9 passed, 2 failed`.

- [ ] **Step 6: The manager takes the lock through `claimCode`, and step 0 moves out**

In `lambda-functions/websocket/schema-compliant-manager.js`, replace the import

```js
const { GAMES_RESERVATION_PK, gamesIndexPk, PLATFORM } = require('./tenant');
```

with

```js
const { gamesIndexPk, PLATFORM } = require('./tenant');
const { claimCode, releaseCode } = require('./code-reservation');
```

Keep the long `// THE ID RESERVATION, and it is load-bearing (issue #26)…` comment, and replace the put that follows it

```js
    await db.send(new PutCommand({
      ConditionExpression: 'attribute_not_exists(PK)',
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: GAMES_RESERVATION_PK,
        SK: `GAME#${gameId}`,
        // NOTHING ELSE BELONGS ON THIS ROW. It used to carry the whole session
        // brief — title, host name, visibility — in a partition every account
        // could Query, which is how `GET /games` returned every session in the
        // environment. `orgId` is here for one reason: it is the only thing that
        // says which org's index row to clean up when the code is released, and
        // without it a deleted session's code stays reserved for 90 days.
        ...(orgId ? { orgId } : {}),
        ttl
      }
    }));
    reserved = true;
```

with

```js
    //
    // The Put itself lives in code-reservation.js now, shared with an event's
    // create so the two can never hold one code (roadmap M1). It is still this
    // function's first write, still `attribute_not_exists(PK)`, and the row is
    // still exactly `{orgId, ttl}` for a session.
    await claimCode(db, { code: gameId, orgId, ttl, kind: 'session' });
    reserved = true;
```

Delete step 0 — the draw asks the same question now, before the lock, for sessions and events alike (`codeHasRows`, Step 4). Delete everything from the line `    /*` that opens the comment `0. IS THIS CODE ALREADY SPOKEN FOR — by ANY row, not just the reservation?` down to and including this, and the blank line after it:

```js
    if (stillHeld.Items && stillHeld.Items.length > 0) {
      const err = new Error(`GAME#${gameId} still holds rows from a previous session`);
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }
```

Keep the `QueryCommand` import: the manager still queries the set. Two comments pointed at step 0. In the header comment above `const createGame`, replace

```js
 * cost only 90 days of an id nobody could list or reach. Now that step 0
 * below treats ANY row in `GAME#<id>` as "taken", a create that fails
 * partway through can retire that code FOR GOOD — nothing yet reclaims it,
 * and nothing should be assumed to. The release deliberately does not run
 * for a ConditionalCheckFailed, because that row belongs to the session that
 * won the race.
```

with

```js
 * cost only 90 days of an id nobody could list or reach. Now that the draw
 * (code-reservation.js `codeHasRows`) treats ANY row in `GAME#<id>` as
 * "taken", a create that fails partway through can retire that code FOR
 * GOOD — nothing yet reclaims it, and nothing should be assumed to. The
 * release deliberately does not run for a ConditionalCheckFailed, because
 * that row belongs to the session that won the race.
```

and in the comment above the release (`// RELEASE THE POINTERS — not the whole partition.`), replace

```js
    // rule this task added (step 0, above), a create that fails partway
    // through can now retire the code FOR GOOD until the fuller fix — session
    // stamps on every row — exists. Not attempted at all when the failure IS
```

with

```js
    // rule this task added (code-reservation.js `codeHasRows` since roadmap
    // M1), a create that fails partway through can now retire the code FOR
    // GOOD until the fuller fix — session stamps on every row — exists. Not
    // attempted at all when the failure IS
```

In the `catch` that releases the code, replace

```js
        await db.send(new DeleteCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: GAMES_RESERVATION_PK, SK: `GAME#${gameId}` }
        }));
        if (orgId) {
```

with

```js
        await releaseCode(db, { code: gameId });
        if (orgId) {
```

- [ ] **Step 7: The session create draws through `reserveCode`**

In `lambda-functions/websocket/create-game.js`, replace the first line

```js
const { createGame } = require('./schema-compliant-manager');
```

with

```js
const { createGame } = require('./schema-compliant-manager');
const { reserveCode, CodeSpaceExhausted } = require('./code-reservation');
```

and the comment above `docClient`

```js
/** Read-only, for the scope search below. The write path has its own client. */
```

with

```js
/** Read-only: the scope search below and the code draw's partition checks.
 *  The write path (the manager) has its own client. */
```

Then replace everything from the `/*` that opens the comment `DRAW UNTIL THE ID IS ACTUALLY FREE (issue #26).` down to — not including — the line ``  console.log(`✅ Game ${gameId} created successfully`);`` (the `MAX_ID_ATTEMPTS` loop, its 500 and its 503) with:

```js
  /*
    DRAW UNTIL THE CODE IS ACTUALLY FREE (issue #26), in the one loop sessions
    and events share (code-reservation.js). A candidate is skipped while its
    GAME# or EVENT# partition still holds any row — a lapsed session's 30-day
    rows, an event's agenda — and `createGame` is the claim: its FIRST write is
    the conditional GAMES put, so a collision throws before anything is touched
    and the loop draws again. Eight draws, then an honest 503: eight straight
    collisions means the space is effectively full.
  */
  let gameId = null;
  try {
    gameId = await reserveCode(docClient, {
      kind: 'session',
      orgId,
      claim: async (candidate) => {
        console.log(`🎮 Creating game ${candidate} with title: ${eventTitle}, questionSetId: ${questionSetId}, randomize: ${randomizeQuestions}, visibility: ${visibility || 'public'}`);
        await createGame(candidate, {
          title: eventTitle || 'Engagement Session',
          engagementType: gameType || 'call-and-answer',
          questionSetId: questionSetId,
          // Optional explicit version pin. Omitted by the normal create flow, in
          // which case createGame() resolves the set's activeVersion and pins THAT
          // — the game keeps reading the questions it started on even after the set
          // is replaced. Supplying it lets a host deliberately run an older version.
          questionSetVersion: questionSetVersion,
          // WHICH partition that set id lives in — platform, this org's, or public.
          // The id alone stopped naming one partition when sets became per-org, so
          // the game pins the pair (tenant.js header).
          questionSetScope: setScope,
          orgId,
          selectedCategories: selectedCategories || [],
          hostPreferences: {
            randomizeQuestions: isSurvey ? false : randomizeQuestions !== false, // Default to true if not specified
            // Default ON, per the owner: a host who never touches setup still gets
            // an anonymous round. Only an explicit false opts out.
            anonymousUntilReveal: anonymousUntilReveal !== false
          },
          aiContext: aiContext,
          // The host's voice pick. Empty means "adapt to the session" — the
          // designed default — not "fall back to the legacy template".
          personaId: (personaId || '').trim(),
          // The host's summary-approach pick. Empty means "what the set says, else
          // the format's standard" — get-ai-summary.js:sessionPromptId.
          promptId: (promptId || '').trim(),
          // WHAT A SURVEY WRITES ABOUT PEOPLE — anonymous / finished / named.
          // Survey only; the manager falls back to the set's namesDefault, then
          // to anonymous, and stores it on METADATA.Names (survey-names.js).
          ...(isSurvey ? { names } : {}),
          // Call & Answer only, and already checked above. Absent means unbriefed.
          ...(sessionBriefing ? { briefing: sessionBriefing } : {}),
          details: engagementInfo || '',
          hostName: hostName || 'Host',
          visibility: visibility || 'public',
          accessCode: accessCode || null,
          debugMode: false
        });
      },
    });
  } catch (error) {
    if (error instanceof CodeSpaceExhausted) {
      console.error('❌ Could not allocate a free game id after', error.attempts, 'attempts');
      return {
        statusCode: 503,
        body: JSON.stringify({ error: 'Could not allocate a session code — too many sessions are live. Try again, or delete old sessions.' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    // Any other failure is the old 500, answered HERE: an unhandled throw turns
    // the friendly error into a raw invocation failure.
    console.error('❌ Create game error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to create game', details: error.message }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
```

The `createGame(...)` argument is the same object the loop passed before, field for field; only its place moved. The 503 sentence is unchanged. Leave `tests/code-reuse-isolation.js` exactly as it is: it drives the real handler, so its passing is the proof that moving step 0 kept the behaviour — the stale-partition skip, the 503 when every draw is held, and the Query's shape (`ConsistentRead: true`, `Limit: 1`, no `FilterExpression`), which `codeHasRows` keeps. Its header still says the draw's retry loop is in `create-game.js`; that loop is now `reserveCode`, and the sentence can wait for the next change to that suite.

- [ ] **Step 8: The session delete route leaves an event's code alone**

In `lambda-functions/admin/delete-game.js`, replace

```js
    let orgId = (reservation.Item && reservation.Item.orgId) || '';
```

with

```js
    /*
      AN EVENT'S CODE IS NOT A SESSION'S TO RELEASE. Events reserve their code
      in this same registry (websocket/code-reservation.js, `Kind: 'event'`),
      and without this check the route would delete that reservation for
      anyone who typed the event's code — leaving an event nobody can join.
      Events have their own routes; here the code names no session.
    */
    if (reservation.Item && reservation.Item.Kind === 'event') {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'No session has that code.' })
      };
    }
    let orgId = (reservation.Item && reservation.Item.orgId) || '';
```

- [ ] **Step 9: Run it green, with every suite that creates or deletes a session**

```bash
for t in event-code-reservation code-reuse-isolation tenant-session-scoping plan-gating billable-session-wiring platform-metrics-wiring lobby-start-ttl update-game set-versioning-flow survey-names-agree persona-controls; do node tests/$t.js > /dev/null 2>&1; echo "$t exit=$?"; done
```

Expected: every line `exit=0`; `event-code-reservation.js` reports `11 passed, 0 failed`. The manager still logs `❌ Error creating game … ConditionalCheckFailedException` for each collision the tests force — that is its existing log line, not a failure. If a suite that drives `create-game.js` now dies on `QueryCommand is not a constructor`, its own `@aws-sdk/lib-dynamodb` stub lacks `QueryCommand`: add the class to that suite's stub (a test-only change) — never weaken `codeHasRows`.

- [ ] **Step 10: Run the whole backend loop** (Before you start, item 3). Expected: `fail=0`.

- [ ] **Step 11: Commit**

```bash
git add lambda-functions/websocket/code-reservation.js lambda-functions/websocket/schema-compliant-manager.js lambda-functions/websocket/create-game.js lambda-functions/admin/delete-game.js tests/helpers/event-harness.js tests/event-code-reservation.js
git commit -m "Sessions and events draw their code from one space: a code with GAME# or EVENT# rows is never drawn

code-reservation.js now owns the four-digit lock (the conditional GAMES put)
and the draw. The bug sweep's rule - a code whose GAME# partition still
holds rows is not handed out - moves from createGame's step 0 into the draw,
so an event's create asks it too, and extends to EVENT#: an event's number
is never given to a session, reserved or lapsed. An
event's reservation carries Kind \"event\"; a session's stays {orgId, ttl}.
createGame still takes the lock itself (reserveCode passes it as the claim).
POST /admin/clear-game refuses an event's code instead of releasing it.

Tests: tests/event-code-reservation.js (new), tests/helpers/event-harness.js
(new); tests/tenant-session-scoping.js and tests/code-reuse-isolation.js
unchanged and green - the second proves step 0's move kept its behaviour.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: `POST /events` — a Team-plan organisation makes an event, behind the switch

The first route: `EVENTS_ENABLED` decides whether it answers at all (roadmap D6); the Team plan decides who may use it (decision 1, drawn as 01b); the code is reserved as an event's; the list row and METADATA are written with the name and place sealed and every row on the event's clock. The route's template entry, the authorizer's rule for every event host route, and the switch's per-tier value land here too.

**Files:**
- Create: `lambda-functions/websocket/events/event-http.js`
- Create: `lambda-functions/websocket/events/event-store.js`
- Create: `lambda-functions/websocket/events/create-event.js`
- Modify: `lambda-functions/auth/authorizer.js` (after the `ORG_ROUTE || INVITE_ROUTE || MY_INVITES_ROUTE` block, ~444–446)
- Modify: `template-clean.yaml` (Conditions after `IsProd` at line 63; Globals after `CONTENT_GUARDRAIL_VERSION` at line 137; a new function above `  StartVoteFunction:` at line 323)
- Create: `tests/event-create.js`

**Interfaces:**
- Consumes: `eventsIndexPk`, `eventPk`, `requireOrg`, `callerOrgId` (`websocket/tenant.js`); `encryptItem` (`websocket/tenant-crypto.js`); `reserveCode`, `releaseCode`, `CodeSpaceExhausted` (Task 3); `readAllowance` (`websocket/usage.js`); `upgradeRequired`, `UPGRADE_REQUIRED_STATUS` (`websocket/pricing.js`); `planLimitResolve` (`websocket/plan-limit.js`); `checkEventFields`, `eventTtl` (Task 2); the harness (Task 3).
- Produces:
  - `event-http.js`: `json(status, body)`, `notFound()` (404 `{error: 'No event has that code.'}`), `callerSub(request)`, `methodOf(request)`, `trace(label, request)`, `readBody(request) → object | {} | null`, `eventsEnabled() → boolean` (`EVENTS_ENABLED` trimmed, lower-cased, `=== 'on'`).
  - `event-store.js`: `META_SK` (`'METADATA'`), `INDEX_PREFIX` (`'EVENT#'`), `indexSk(code)`, `codeOf(row)`, `projectEvent(row) → {code, title, place, startsAt, timeZone, access, state, itemCount}` plus, for METADATA, `{engagementCount, breakCount, attendeeReports, createdAt, updatedAt}`.
  - `POST /events` body `{title, place?, startsAt: 'YYYY-MM-DDTHH:MM', timeZone, access?: 'open', attendeeReports?: 'full'|'anonymous'|'none'}` → `201 {event}`; `404 {code:'events_disabled'}` while off; `403` with no active org; `400 {error}`; `402` upgrade body with `limit.kind: 'events'` for a Personal plan; `503` when no code is free; `500` after releasing the code.
  - Rows: `GAMES/GAME#<code> {orgId, Kind:'event', ttl}`; `ORG#<org>#EVENTS/EVENT#<code> {orgId, Title*, Place*, StartsAt, TimeZone, Access, State:'SCHEDULED', ItemCount:0, ttl}`; `EVENT#<code>/METADATA {…the same, EngagementCount:0, BreakCount:0, AttendeeReports, CreatedBy, CreatedAt, UpdatedAt}` (\* sealed, entity `event`).
  - Authorizer: `EVENT_HOST_ROUTE = /^events(\/[^/]+(\/items(\/[^/]+)?)?)?$/` → `['hosts','admins']`.

- [ ] **Step 1: Write the failing test**

Create `tests/event-create.js`:

```js
/**
 * POST /events — lambda-functions/websocket/events/create-event.js.
 *
 * A Team-plan organisation makes an event: its code reserved in the one code
 * space (Kind "event"), its list row and its METADATA written with the name
 * and place sealed, every row kept until 90 days after the event's day. The
 * route is behind EVENTS_ENABLED (roadmap D6) and the Team plan (decision 1).
 *
 * rejects: the route answering while the switch is off; the switch on for any
 * tier but dev; a Personal space getting an event, or getting a bare 403 where
 * the upgrade body belongs; plaintext names at rest; rows kept on different
 * clocks; a failed create leaving a reserved code or a listed half-event;
 * a full code space answered with anything but a 503.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, offerCodes, bodyOf,
} = require('./helpers/event-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const rules = h.load('lambda-functions/websocket/events/agenda-rules.js');
const { isEnvelope } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const TEAM = 'org_team';
const SOLO = 'org_solo';
const STARTS = startsIn(30);
const DETAILS = {
  title: 'Q4 Kickoff', place: 'Harbour Room, 4th floor', startsAt: STARTS,
  timeZone: 'Europe/London', attendeeReports: 'anonymous',
};
const post = (body, orgId = TEAM, ctx) => create(request({
  method: 'POST', path: '/events', body, requestContext: ctx === undefined ? asHost(orgId) : ctx,
}));
const rowsIn = (pk) => [...table.store.values()].filter((r) => r.PK === pk);
function reset() {
  table.clear();
  seedOrg(table, TEAM, { plan: 'team' });
  seedOrg(table, SOLO, { plan: 'free', type: 'personal' });
}

(async () => {
  console.log('\n1. the switch (roadmap D6)');
  reset();
  await check('off: 404, and no code is reserved', async () => {
    process.env.EVENTS_ENABLED = 'off';
    try {
      const res = await post(DETAILS);
      assert.strictEqual(res.statusCode, 404, res.body);
      assert.strictEqual(bodyOf(res).code, 'events_disabled');
      assert.strictEqual(rowsIn('GAMES').length, 0);
    } finally { process.env.EVENTS_ENABLED = 'on'; }
  });
  await check('the template switches it on for dev and off everywhere else', () => {
    const template = fs.readFileSync(path.join(h.REPO, 'template-clean.yaml'), 'utf8');
    assert.match(template, /IsDev: !Equals \[!Ref Environment, "dev"\]/);
    assert.match(template, /EVENTS_ENABLED: !If \[IsDev, 'on', 'off'\]/);
  });

  console.log('\n2. Team-plan organisations only (decision 1)');
  reset();
  await check('a Personal space gets 402 with the upgrade body, and nothing is written', async () => {
    const res = await post(DETAILS, SOLO);
    assert.strictEqual(res.statusCode, 402, res.body);
    const body = bodyOf(res);
    assert.strictEqual(body.code, 'upgrade_required');
    assert.strictEqual(body.limit.kind, 'events');
    assert.match(body.error, /Events are part of the Team plan/);
    assert.ok(body.upgrade && body.upgrade.planId === 'team');
    assert.ok(body.resolve && body.resolve.role);
    assert.strictEqual(rowsIn('GAMES').length, 0);
  });
  await check('an organisation whose plan cannot be read is not refused', async () => {
    const res = await post(DETAILS, 'org_unlisted');
    assert.strictEqual(res.statusCode, 201, res.body);
  });
  await check('a caller acting for no organisation is refused before anything else', async () => {
    const res = await post(DETAILS, TEAM, asHost(''));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  console.log('\n3. the rows');
  reset();
  const made = await post(DETAILS);
  const event = bodyOf(made).event;
  await check('201 with the event, its code and an empty agenda', () => {
    assert.strictEqual(made.statusCode, 201, made.body);
    assert.match(event.code, /^\d{4}$/);
    assert.deepStrictEqual({ ...event, code: 'x', createdAt: 'x', updatedAt: 'x' }, {
      code: 'x', title: 'Q4 Kickoff', place: 'Harbour Room, 4th floor', startsAt: STARTS,
      timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 0,
      engagementCount: 0, breakCount: 0, attendeeReports: 'anonymous', createdAt: 'x', updatedAt: 'x',
    });
  });
  const code = event.code;
  const reservation = table.get('GAMES', `GAME#${code}`);
  const listRow = table.get(`ORG#${TEAM}#EVENTS`, `EVENT#${code}`);
  const meta = table.get(`EVENT#${code}`, 'METADATA');
  await check('the code is reserved as an event\'s', () => {
    assert.deepStrictEqual(Object.keys(reservation).sort(), ['Kind', 'PK', 'SK', 'orgId', 'ttl']);
    assert.strictEqual(reservation.Kind, 'event');
  });
  await check('the name and place are sealed on both rows, and open with the org\'s key', () => {
    for (const row of [listRow, meta]) {
      assert.ok(isEnvelope(row.Title) && isEnvelope(row.Place), `${row.PK} holds plaintext`);
      assert.ok(!JSON.stringify(row).includes('Kickoff'), `${row.PK} leaks the name`);
      assert.strictEqual(plainRow(TEAM, row).Title, 'Q4 Kickoff');
      assert.strictEqual(plainRow(TEAM, row).Place, 'Harbour Room, 4th floor');
    }
  });
  await check('METADATA holds the schedule, the counts, the report default and who made it', () => {
    assert.strictEqual(meta.orgId, TEAM);
    assert.strictEqual(meta.StartsAt, STARTS);
    assert.strictEqual(meta.TimeZone, 'Europe/London');
    assert.strictEqual(meta.Access, 'open');
    assert.strictEqual(meta.State, 'SCHEDULED');
    assert.deepStrictEqual([meta.ItemCount, meta.EngagementCount, meta.BreakCount], [0, 0, 0]);
    assert.strictEqual(meta.AttendeeReports, 'anonymous');
    assert.strictEqual(meta.CreatedBy, 'u_host');
  });
  // rejects: session-ttl's creation clock, which would expire an event booked
  // for next month weeks after its day — and rows on different clocks.
  await check('all three rows are kept until 90 days after the event\'s day', () => {
    const expected = rules.eventTtl(STARTS, Math.floor(Date.now() / 1000));
    for (const row of [reservation, listRow, meta]) assert.strictEqual(row.ttl, expected, row.PK);
    assert.ok(expected > Date.now() / 1000 + 119 * 24 * 3600, 'not ~120 days out for an event a month away');
  });

  console.log('\n4. what the dialog may send');
  reset();
  for (const [label, patch, error] of [
    ['no name', { title: '' }, /name/],
    ['an unknown zone', { timeZone: 'Mars/Base' }, /time zone/],
    ['invite-only (PLAN Phase 3)', { access: 'invite' }, /Invite-only events are not available yet/],
    ['a date two years out', { startsAt: startsIn(730) }, /within the next year/],
  ]) {
    await check(`${label}: 400 with the reason, and no code reserved`, async () => {
      const res = await post({ ...DETAILS, ...patch });
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.match(bodyOf(res).error, error);
      assert.strictEqual(rowsIn('GAMES').length, 0);
    });
  }
  await check('a body that is not JSON: 400', async () => {
    const res = await post('{not json');
    assert.strictEqual(res.statusCode, 400, res.body);
  });

  console.log('\n5. a failed create leaves nothing');
  reset();
  await check('METADATA failing to write: 500, the code released and the list row gone', async () => {
    table.inject((c) => c.type === 'put' && c.input.Item && c.input.Item.SK === 'METADATA'
      && String(c.input.Item.PK).startsWith('EVENT#'), () => new Error('injected write failure'), 1);
    const res = await post(DETAILS);
    assert.strictEqual(res.statusCode, 500, res.body);
    assert.strictEqual(rowsIn('GAMES').length, 0, 'the code stayed reserved');
    assert.strictEqual(rowsIn(`ORG#${TEAM}#EVENTS`).length, 0, 'a half-made event is listed');
  });
  await check('eight held codes: the honest 503', async () => {
    const taken = ['2000', '2001', '2002', '2003', '2004', '2005', '2006', '2007'];
    taken.forEach((c) => table.put({ PK: 'GAMES', SK: `GAME#${c}`, ttl: 1 }));
    const restore = offerCodes(...taken);
    try {
      const res = await post(DETAILS);
      assert.strictEqual(res.statusCode, 503, res.body);
    } finally { restore(); }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/event-create.js; echo "exit=$?"
```

Expected: `Error: Cannot find module '…/lambda-functions/websocket/events/create-event.js'`, exit 1.

- [ ] **Step 3: Write `event-http.js`**

Create `lambda-functions/websocket/events/event-http.js`:

```js
/**
 * THE EVENT ROUTES' SHARED PLUMBING — responses, the request trace, the body,
 * the caller and the EVENTS_ENABLED switch. Nothing here reads the table.
 *
 * The routes' Lambda parameter is called `request`, not `event`, in every file
 * of this folder: here an "event" is the thing a host plans.
 */
const HEADERS = Object.freeze({ 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });

function json(statusCode, body) {
  return { statusCode, headers: { ...HEADERS }, body: JSON.stringify(body) };
}

/**
 * Every refusal of an event this caller may not touch reads exactly like an
 * event that does not exist. A 403 would confirm that a guessed code names
 * somebody else's event (tenant.js, callerMayDriveSession).
 */
const notFound = () => json(404, { error: 'No event has that code.' });

/** The caller's user id, from the Lambda authorizer or a JWT claim; '' if none. */
function callerSub(request) {
  const auth = (request && request.requestContext && request.requestContext.authorizer) || {};
  const lambda = auth.lambda || {};
  const claims = (auth.jwt && auth.jwt.claims) || auth.claims || {};
  return String(lambda.userId || claims.sub || '').trim();
}

function methodOf(request) {
  const http = (request && request.requestContext && request.requestContext.http) || {};
  return String(http.method || '').toUpperCase();
}

/**
 * Which request this was, never what it carried: method, path, code, item and
 * caller. No header (the bearer token is one) and no body (an agenda is org
 * content). tests/lambda-event-not-logged.js holds that rule for every file
 * under lambda-functions/.
 */
function trace(label, request) {
  const http = (request && request.requestContext && request.requestContext.http) || {};
  const params = (request && request.pathParameters) || {};
  console.log(label, JSON.stringify({
    method: http.method || null,
    path: http.path || null,
    code: params.code || null,
    itemId: params.itemId || null,
    sub: callerSub(request) || null,
  }));
}

/** The body as an object; `{}` when there is none; null when it is not a JSON object. */
function readBody(request) {
  const raw = request && request.body;
  if (raw === undefined || raw === null || raw === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * THE SWITCH (roadmap D6), on the TEAM_WORKIE_AUTHORING precedent
 * (admin/shared/prompt-access.js): read at call time so a test can set it, and
 * on only for the exact word. template-clean.yaml's Globals set it per tier:
 * on for dev, off for test and prod. admin/orgs/list-my-orgs.js reads the same
 * variable the same way to tell the console whether to show Events;
 * tests/events-switch.js holds the two together.
 */
const eventsEnabled = () => String(process.env.EVENTS_ENABLED || '').trim().toLowerCase() === 'on';

module.exports = { json, notFound, callerSub, methodOf, trace, readBody, eventsEnabled };
```

- [ ] **Step 4: Write `event-store.js` — keys and the event's projection**

Create `lambda-functions/websocket/events/event-store.js` (Task 5 grows it):

```js
/**
 * AN EVENT'S ROWS — their keys, how they are read, and what a response says
 * about them (docs/design/agenda-redesign/40-data-model.html).
 *
 *   PK: GAMES             SK: GAME#<code>    the code (code-reservation.js)
 *   PK: ORG#<org>#EVENTS  SK: EVENT#<code>   the org's list row
 *   PK: EVENT#<code>      SK: METADATA       the event
 *   PK: EVENT#<code>      SK: ITEM#<id>      one agenda item each
 *
 * The partition keys come from tenant.js; the sort keys are spelled here and
 * nowhere else. Title, Place and each item's Title and Description are sealed
 * (tenant-crypto.js, entities `event` and `item`); every reader decrypts.
 */
const META_SK = 'METADATA';
const INDEX_PREFIX = 'EVENT#';

const indexSk = (code) => `${INDEX_PREFIX}${code}`;

/** The code a METADATA row (PK=EVENT#<code>) or a list row (SK=EVENT#<code>) is about. */
function codeOf(row) {
  const pk = String((row && row.PK) || '');
  if (pk.startsWith(INDEX_PREFIX)) return pk.slice(INDEX_PREFIX.length);
  return String((row && row.SK) || '').replace(/^EVENT#/, '');
}

/**
 * An event as a response names it, from a DECRYPTED METADATA or list row.
 * The list row carries no report default and no engagement or break counts,
 * so those appear only for METADATA.
 */
function projectEvent(row) {
  const r = row || {};
  const out = {
    code: codeOf(r),
    title: typeof r.Title === 'string' ? r.Title : '',
    place: typeof r.Place === 'string' ? r.Place : '',
    startsAt: r.StartsAt || '',
    timeZone: r.TimeZone || '',
    access: r.Access || 'open',
    state: r.State || 'SCHEDULED',
    itemCount: Number(r.ItemCount) || 0,
  };
  if (r.SK === META_SK) {
    out.engagementCount = Number(r.EngagementCount) || 0;
    out.breakCount = Number(r.BreakCount) || 0;
    out.attendeeReports = r.AttendeeReports || 'full';
    out.createdAt = r.CreatedAt || null;
    out.updatedAt = r.UpdatedAt || null;
  }
  return out;
}

module.exports = { META_SK, INDEX_PREFIX, indexSk, codeOf, projectEvent };
```

- [ ] **Step 5: Write the handler**

Create `lambda-functions/websocket/events/create-event.js`:

```js
/**
 * POST /events — a new event, its code reserved, its agenda empty.
 * docs/design/agenda-redesign/05-new-event.html; roadmap M1.
 *
 * Refused, in this order:
 *   - while EVENTS_ENABLED is off on this tier (404, roadmap D6);
 *   - with no organisation to act for (403, tenant.requireOrg);
 *   - details that do not check out (400, agenda-rules.checkEventFields);
 *   - from a Personal-plan organisation (402 plus the upgrade body session
 *     creation uses): events are Team-plan only (RATIONALE decision 1, drawn
 *     as 01b). An organisation whose plan cannot be read is NOT refused —
 *     `readAllowance` fails open for sessions and this follows it: a DynamoDB
 *     blip must not read as "you are on the wrong plan".
 *
 * The session create gate (mustUpgradeForSession) is not asked separately: a
 * Team plan meters and is never gated (pricing.js metersOverage), and every
 * other plan is refused above.
 *
 * WRITES, in order: the code (code-reservation.js, `Kind: "event"`), the
 * organisation's list row, the METADATA row. Title and Place are sealed on
 * both rows. All three carry the same `ttl` (agenda-rules.eventTtl). A failure
 * after the code is taken removes the list row and gives the code back, so a
 * failed create leaves nothing behind — the session manager's rule.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('../tenant');
const { encryptItem } = require('../tenant-crypto');
const { reserveCode, releaseCode, CodeSpaceExhausted } = require('../code-reservation');
const { readAllowance } = require('../usage');
const { upgradeRequired, UPGRADE_REQUIRED_STATUS } = require('../pricing');
const { planLimitResolve } = require('../plan-limit');
const rules = require('./agenda-rules');
const { json, readBody, trace, callerSub, eventsEnabled } = require('./event-http');
const { META_SK, indexSk, projectEvent } = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;

const TEAM_ONLY = 'Events are part of the Team plan, and this space is on the Personal plan.';

exports.handler = async (request) => {
  trace('create-event', request);
  if (!eventsEnabled()) {
    return json(404, { error: 'Events are not switched on here yet.', code: 'events_disabled' });
  }
  const refused = tenant.requireOrg(request);
  if (refused) return refused;
  const orgId = tenant.callerOrgId(request);

  const body = readBody(request);
  if (!body) return json(400, { error: 'The request body is not valid JSON.' });
  const nowSeconds = Math.floor(Date.now() / 1000);
  const checked = rules.checkEventFields(body, { nowSeconds });
  if (checked.error) return json(400, { error: checked.error });
  const v = checked.value;

  try {
    const allowance = await readAllowance(orgId);
    if (allowance.planId === 'personal') {
      return json(UPGRADE_REQUIRED_STATUS, {
        ...upgradeRequired('sessions', allowance),
        error: TEAM_ONLY,
        limit: { kind: 'events', planId: allowance.planId, used: 0, included: 0 },
        resolve: await planLimitResolve(request, allowance),
      });
    }

    const ttl = rules.eventTtl(v.startsAt, nowSeconds);
    let code;
    try {
      code = await reserveCode(db, { orgId, ttl, kind: 'event' });
    } catch (error) {
      if (error instanceof CodeSpaceExhausted) {
        return json(503, { error: 'Could not find a free event code. Try again in a moment.' });
      }
      throw error;
    }

    const now = new Date(nowSeconds * 1000).toISOString();
    const shared = {
      orgId,
      Title: v.title,
      Place: v.place,
      StartsAt: v.startsAt,
      TimeZone: v.timeZone,
      Access: v.access,
      State: 'SCHEDULED',
      ItemCount: 0,
      ttl,
    };
    const listRow = { PK: tenant.eventsIndexPk(orgId), SK: indexSk(code), ...shared };
    const metaRow = {
      PK: tenant.eventPk(code),
      SK: META_SK,
      ...shared,
      EngagementCount: 0,
      BreakCount: 0,
      AttendeeReports: v.attendeeReports,
      CreatedBy: callerSub(request),
      CreatedAt: now,
      UpdatedAt: now,
    };

    let listed = false;
    try {
      // No condition on the list row: the code is ours (the lock is held and
      // its EVENT# partition was empty), so a leftover list row for the same
      // code — possible only while DynamoDB is still reaping an old one — is
      // simply replaced.
      await db.send(new PutCommand({ TableName: TABLE(), Item: await encryptItem(orgId, 'event', listRow) }));
      listed = true;
      await db.send(new PutCommand({
        TableName: TABLE(),
        Item: await encryptItem(orgId, 'event', metaRow),
        ConditionExpression: 'attribute_not_exists(PK)',
      }));
    } catch (error) {
      console.error(`❌ create-event: writing event ${code} failed; releasing the code:`, error && error.message);
      try {
        if (listed) {
          await db.send(new DeleteCommand({ TableName: TABLE(), Key: { PK: listRow.PK, SK: listRow.SK } }));
        }
        await releaseCode(db, { code });
      } catch (releaseError) {
        console.error(`❌ create-event: could not release ${code}:`, releaseError && releaseError.message);
      }
      return json(500, { error: 'Could not create the event. Nothing was kept; try again.' });
    }

    return json(201, { event: projectEvent(metaRow) });
  } catch (error) {
    console.error('❌ create-event failed:', error && error.message);
    return json(500, { error: 'Could not create the event. Try again.' });
  }
};
```

- [ ] **Step 6: Switch it on for dev only, and add the route**

In `template-clean.yaml`, under `Conditions:`, replace

```yaml
  IsProd: !Equals [!Ref Environment, "prod"]
```

with

```yaml
  IsProd: !Equals [!Ref Environment, "prod"]
  # Events (roadmap D6): switched on for dev only. See EVENTS_ENABLED in Globals.
  IsDev: !Equals [!Ref Environment, "dev"]
```

In `Globals: Function: Environment: Variables:`, replace

```yaml
        CONTENT_GUARDRAIL_VERSION: !GetAtt ContentGuardrailVersion.Version
```

with

```yaml
        CONTENT_GUARDRAIL_VERSION: !GetAtt ContentGuardrailVersion.Version
        # EVENTS (roadmap D6, docs/superpowers/plans/2026-09-26-events-roadmap.md).
        # On for dev only, so each milestone can land on dev as it is finished
        # without showing half a feature on test or prod. Read at call time by
        # websocket/events/event-http.js `eventsEnabled` (POST /events refuses
        # while it is off) and by admin/orgs/list-my-orgs.js (the console hides
        # Events). Turned on for test when the owner asks (roadmap M6).
        EVENTS_ENABLED: !If [IsDev, 'on', 'off']
```

Insert immediately above the line `  StartVoteFunction:` (keep the blank line between resources):

```yaml
  ## Events (docs/design/agenda-redesign; roadmap M1)
  #
  # IN THE websocket BUNDLE ON PURPOSE. An event reserves its code with the
  # module a session does (websocket/code-reservation.js), and CodeUri is
  # per-directory with no layers: a lambda-functions/events/ bundle of its own
  # would need a fourth copy of tenant.js, tenant-crypto.js, usage.js,
  # pricing.js, pricing-adjust.js and plan-limit.js, and a second copy of the
  # code lock. Handlers live in websocket/events/.
  CreateEventFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-create-event'
      CodeUri: lambda-functions/websocket/
      Handler: events/create-event.handler
      Events:
        CreateEvent:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /events
            Method: post
            # A host's route. requiredGroupsForRoute answers hosts|admins
            # through its anchored EVENT_HOST_ROUTE rule; the handler adds the
            # organisation and the Team-plan gate.
            Auth:
              Authorizer: CognitoAuthorizer
      Policies:
        # Seals the event's name and place with the org's data key.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
        - DynamoDBCrudPolicy:
            TableName: !Ref GameTable
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

- [ ] **Step 7: Name the host routes in the authorizer**

In `lambda-functions/auth/authorizer.js`, replace

```js
  if (ORG_ROUTE.test(path) || INVITE_ROUTE.test(path) || MY_INVITES_ROUTE.test(path)) {
    return ['hosts', 'admins'];
  }
```

with

```js
  if (ORG_ROUTE.test(path) || INVITE_ROUTE.test(path) || MY_INVITES_ROUTE.test(path)) {
    return ['hosts', 'admins'];
  }

  // ── EVENTS: THE HOST'S ROUTES (docs/design/agenda-redesign) ──────────────
  //
  // `events`, `events/{code}`, `events/{code}/items` and
  // `events/{code}/items/{itemId}`. Named here, and not left to the trailing
  // default that happens to give the same answer, for the reason the block
  // above records: the `path.includes('join' | 'answer' | 'vote')` rule sits
  // between here and there, and an id travels in the path. Anchored, and
  // matching the route template (`routeKey`) and a concrete path (the
  // `rawPath` fallback) alike. WHICH event a caller may touch is decided per
  // row by tenant.callerMayManageEvent, which answers 404.
  //
  // NOT here: GET /events/{code}/agenda and GET /join/{code}. They carry no
  // authorizer at all — an attendee has no account.
  const EVENT_HOST_ROUTE = /^events(\/[^/]+(\/items(\/[^/]+)?)?)?$/;
  if (EVENT_HOST_ROUTE.test(path)) {
    return ['hosts', 'admins'];
  }
```

- [ ] **Step 8: Run it green, with the suites that read the template and the authorizer**

```bash
for t in event-create kms-grants-match-code tenant-infrastructure lambda-event-not-logged no-global-partition-literals authorizer-staff-routes authorizer-set-routes org-route-authorization session-control-routes-authorization template-validates; do node tests/$t.js > /dev/null 2>&1; echo "$t exit=$?"; done
```

Expected: every line `exit=0`; `event-create.js` reports `17 passed, 0 failed`. `template-validates.js` runs the SAM transform when the `sam` CLI is installed, and it must pass: it is the check that `!If [IsDev, 'on', 'off']` in Globals transforms.

- [ ] **Step 9: Run the whole backend loop.** Expected: `fail=0`.

- [ ] **Step 10: Commit**

```bash
git add lambda-functions/websocket/events/event-http.js lambda-functions/websocket/events/event-store.js lambda-functions/websocket/events/create-event.js lambda-functions/auth/authorizer.js template-clean.yaml tests/event-create.js
git commit -m "A Team-plan organisation can make an event on dev: POST /events, behind EVENTS_ENABLED

The event reserves its code as an event's, writes its list row and METADATA
with the name and place sealed, and keeps every row until 90 days after its
day. EVENTS_ENABLED is on for dev only (IsDev in the template's Globals) and
POST /events answers 404 while it is off. A Personal-plan space gets the 402
upgrade body with limit.kind events; an unreadable plan is not refused, as
readAllowance fails open for sessions. A failed write gives the code back.
The authorizer names every event host route (EVENT_HOST_ROUTE), so an id
spelling join, vote or answer cannot turn one public.

Tests: tests/event-create.js (new).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: The host's reads — `GET /events` and `GET /events/{code}`

The organisation's list (01) and one event with its agenda (02). The list is one paged Query of the org's own partition. One event opens only for a member of its organisation — anyone else, and any unknown or malformed code, gets the same 404. Each engagement item says what the builder's row needs about its set: its name, its size, the version it would play today (for "Use vN"), or that it is gone.

**Files:**
- Modify: `lambda-functions/websocket/events/event-store.js` (replace the whole file)
- Create: `lambda-functions/websocket/events/get-events.js`
- Create: `lambda-functions/websocket/events/get-event.js`
- Modify: `template-clean.yaml` (two functions above `  StartVoteFunction:`)
- Create: `tests/event-host-reads.js`

**Interfaces:**
- Consumes: `eventPk`, `eventsIndexPk`, `callerMayManageEvent`, `ORG`, `requireOrg`, `callerOrgId` (Task 1, `websocket/tenant.js`); `decryptItem` (`websocket/tenant-crypto.js`); `getSetMetadata`, `toVersion` (`websocket/set-version.js`); Task 4's `event-http.js`.
- Produces (`event-store.js`, in addition to Task 4's): `ITEM_PREFIX` (`'ITEM#'`), `itemSk(itemId)`, `itemIdOf(row)`, `isCode(code)` (four digits), `isItemId(itemId)` (`/^it_[0-9a-f]{8}$/`), `queryAll(db, tableName, pk, prefix, {consistent}) → rows` (every page), `readMeta(db, tableName, code) → row | null` (consistent), `sortItems(rows)`, `readItems(db, tableName, code) → rows` (agenda order), `openEvent(db, tableName, request, code) → METADATA row | null`, `decryptEvent(orgId, row)`, `decryptItemRow(orgId, row)`, `projectItem(row) → {itemId, order, type, title, description, minutes, state, setRef?: {scope, orgId, setId, version}}`, `describeSet(db, tableName, setRef) → {missing, name, questionCount, latestVersion} | null`.
- Produces (routes): `GET /events → 200 {events: projectEvent[]}` soonest first (`403` with no active org); `GET /events/{code} → 200 {event, items: (projectItem & {set?})[]}` or the one `404`.

- [ ] **Step 1: Write the failing test**

Create `tests/event-host-reads.js`:

```js
/**
 * THE HOST'S READS — GET /events and GET /events/{code}
 * (lambda-functions/websocket/events/get-events.js, get-event.js).
 *
 * The list is one organisation's and only that organisation's; one event
 * comes back with its agenda in order, every word decrypted, and each
 * engagement saying what the builder needs about its set — its name, its
 * question count, the version it would play today, or that it is gone.
 *
 * rejects: another organisation's events in a list; a list that stops at the
 * first 1 MB page; ciphertext in a response; an agenda out of order; another
 * organisation's member, an anonymous caller or a malformed code getting
 * anything but the one 404; a missing set breaking the builder's read.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const getEvents = h.load('lambda-functions/websocket/events/get-events.js').handler;
const getEvent = h.load('lambda-functions/websocket/events/get-event.js').handler;
const { encryptItem } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const MD = 'org_md';
const make = async (orgId, title, days) => bodyOf(await create(request({
  method: 'POST', path: '/events', requestContext: asHost(orgId),
  body: { title, place: `${title} room`, startsAt: startsIn(days), timeZone: 'Europe/London' },
}))).event;
const list = (orgId, ctx) => getEvents(request({ path: '/events', requestContext: ctx || asHost(orgId) }));
const read = (code, ctx) => getEvent(request({ path: `/events/${code}`, pathParameters: { code }, requestContext: ctx }));
async function seedItem(code, itemId, fields) {
  table.put(await encryptItem(NW, 'item', {
    PK: `EVENT#${code}`, SK: `ITEM#${itemId}`, State: 'planned', ttl: 1, ...fields,
  }));
}

(async () => {
  table.clear();
  seedOrg(table, NW);
  seedOrg(table, MD);

  console.log('\n1. GET /events is the acting organisation\'s list');
  const later = await make(NW, 'Partner day', 40);
  const soon = await make(NW, 'Q4 Kickoff', 10);
  const theirs = await make(MD, 'Their offsite', 20);
  await check('soonest first, decrypted, and none of another organisation\'s', async () => {
    const res = await list(NW);
    assert.strictEqual(res.statusCode, 200, res.body);
    const { events } = bodyOf(res);
    assert.deepStrictEqual(events.map((e) => e.title), ['Q4 Kickoff', 'Partner day']);
    assert.deepStrictEqual(events.map((e) => e.code), [soon.code, later.code]);
    assert.strictEqual(events[0].place, 'Q4 Kickoff room');
    assert.ok(!events.some((e) => e.code === theirs.code));
  });
  // rejects: a single-page read — the day the list outgrows 1 MB it goes blind.
  await check('it reads every page', async () => {
    await make(NW, 'Third', 50);
    await make(NW, 'Fourth', 60);
    table.pageSize = 2;
    try {
      const { events } = bodyOf(await list(NW));
      assert.strictEqual(events.length, 4);
    } finally { table.pageSize = null; }
  });
  await check('a caller acting for no organisation is refused', async () => {
    const res = await list('', asHost(''));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  console.log('\n2. GET /events/{code} is the agenda, in order, with its sets');
  const code = soon.code;
  table.put(await encryptItem(NW, 'set', {
    PK: `ORG#${NW}#SETS`, SK: 'SET#custq4', name: 'Customer knowledge — Q4',
    engagementType: 'trivia', questionCount: 10, activeVersion: 3, versions: [{ version: 2 }, { version: 3 }],
  }));
  await seedItem(code, 'it_00000002', { Type: 'break', Order: 2, Minutes: 15, Title: 'Break', Description: 'Coffee' });
  await seedItem(code, 'it_00000001', {
    Type: 'trivia', Order: 1, Minutes: 15, Title: 'How well do you know our customers?', Description: 'Ten questions.',
    SetRef: { scope: 'org', orgId: NW, setId: 'custq4', version: 2 },
  });
  await seedItem(code, 'it_00000003', {
    Type: 'poll', Order: 3, Minutes: 10, Title: 'Where next?', Description: '',
    SetRef: { scope: 'platform', orgId: '', setId: 'gone', version: 1 },
  });
  const res = await read(code, asHost(NW));
  const body = bodyOf(res);
  await check('200 with the event and its items in agenda order', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body.event.title, 'Q4 Kickoff');
    assert.deepStrictEqual(body.items.map((i) => i.itemId), ['it_00000001', 'it_00000002', 'it_00000003']);
  });
  await check('every word decrypted, no envelope anywhere', () => {
    assert.strictEqual(body.items[0].title, 'How well do you know our customers?');
    assert.strictEqual(body.items[1].description, 'Coffee');
    assert.ok(!/"ct":/.test(res.body), 'an envelope reached the response');
  });
  await check('an engagement says its set, its pin and the version it would play today', () =>
    assert.deepStrictEqual({ setRef: body.items[0].setRef, set: body.items[0].set }, {
      setRef: { scope: 'org', orgId: NW, setId: 'custq4', version: 2 },
      set: { missing: false, name: 'Customer knowledge — Q4', questionCount: 10, latestVersion: 3 },
    }));
  await check('a break has no set', () => {
    assert.strictEqual(body.items[1].setRef, undefined);
    assert.strictEqual(body.items[1].set, undefined);
  });
  await check('a set that is gone says so, and the read still succeeds', () =>
    assert.strictEqual(body.items[2].set.missing, true));

  console.log('\n3. one 404 for everything that is not yours');
  const notFound = bodyOf(await read('9999', asHost(NW)));
  for (const [label, c, ctx] of [
    ['another organisation\'s member', code, asHost(MD)],
    ['a signed-in account with no group', code, { authorizer: { lambda: { userId: 'u', orgId: NW, orgIds: NW } } }],
    ['no identity at all', code, undefined],
    ['a malformed code', '53a7', asHost(NW)],
  ]) {
    await check(`${label}: the same 404 as an unknown code`, async () => {
      const r = await read(c, ctx);
      assert.strictEqual(r.statusCode, 404, r.body);
      assert.deepStrictEqual(bodyOf(r), notFound);
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/event-host-reads.js; echo "exit=$?"
```

Expected: `Error: Cannot find module '…/lambda-functions/websocket/events/get-events.js'`, exit 1.

- [ ] **Step 3: Grow `event-store.js` with the reads**

Replace the whole of `lambda-functions/websocket/events/event-store.js` with:

```js
/**
 * AN EVENT'S ROWS — their keys, how they are read, and what a response says
 * about them (docs/design/agenda-redesign/40-data-model.html).
 *
 *   PK: GAMES             SK: GAME#<code>    the code (code-reservation.js)
 *   PK: ORG#<org>#EVENTS  SK: EVENT#<code>   the org's list row
 *   PK: EVENT#<code>      SK: METADATA       the event
 *   PK: EVENT#<code>      SK: ITEM#<id>      one agenda item each
 *
 * The partition keys come from tenant.js; the sort keys are spelled here and
 * nowhere else. Title, Place and each item's Title and Description are sealed
 * (tenant-crypto.js, entities `event` and `item`); every reader decrypts.
 */
const { GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { eventPk, callerMayManageEvent, ORG } = require('../tenant');
const { decryptItem } = require('../tenant-crypto');
const { getSetMetadata, toVersion } = require('../set-version');

const META_SK = 'METADATA';
const INDEX_PREFIX = 'EVENT#';
const ITEM_PREFIX = 'ITEM#';
const CODE = /^\d{4}$/;
const ITEM_ID = /^it_[0-9a-f]{8}$/;

const indexSk = (code) => `${INDEX_PREFIX}${code}`;

/** The code a METADATA row (PK=EVENT#<code>) or a list row (SK=EVENT#<code>) is about. */
function codeOf(row) {
  const pk = String((row && row.PK) || '');
  if (pk.startsWith(INDEX_PREFIX)) return pk.slice(INDEX_PREFIX.length);
  return String((row && row.SK) || '').replace(/^EVENT#/, '');
}

/**
 * An event as a response names it, from a DECRYPTED METADATA or list row.
 * The list row carries no report default and no engagement or break counts,
 * so those appear only for METADATA.
 */
function projectEvent(row) {
  const r = row || {};
  const out = {
    code: codeOf(r),
    title: typeof r.Title === 'string' ? r.Title : '',
    place: typeof r.Place === 'string' ? r.Place : '',
    startsAt: r.StartsAt || '',
    timeZone: r.TimeZone || '',
    access: r.Access || 'open',
    state: r.State || 'SCHEDULED',
    itemCount: Number(r.ItemCount) || 0,
  };
  if (r.SK === META_SK) {
    out.engagementCount = Number(r.EngagementCount) || 0;
    out.breakCount = Number(r.BreakCount) || 0;
    out.attendeeReports = r.AttendeeReports || 'full';
    out.createdAt = r.CreatedAt || null;
    out.updatedAt = r.UpdatedAt || null;
  }
  return out;
}

const itemSk = (itemId) => `${ITEM_PREFIX}${itemId}`;
const itemIdOf = (row) => String((row && row.SK) || '').replace(/^ITEM#/, '');
const isCode = (code) => CODE.test(String(code || ''));
const isItemId = (itemId) => ITEM_ID.test(String(itemId || ''));

/**
 * Every row of one partition (optionally one SK prefix), following
 * LastEvaluatedKey to the end. A Query stops at 1 MB, and a one-page read of
 * an organisation's list goes blind the day it grows
 * (tests/event-host-reads.js pages it).
 */
async function queryAll(db, tableName, pk, prefix = '', { consistent = false } = {}) {
  const rows = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: prefix ? 'PK = :pk AND begins_with(SK, :sk)' : 'PK = :pk',
      ExpressionAttributeValues: prefix ? { ':pk': pk, ':sk': prefix } : { ':pk': pk },
      ...(consistent ? { ConsistentRead: true } : {}),
      ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
    }));
    rows.push(...((page && page.Items) || []));
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

/** An event's METADATA row, strongly consistent, or null. */
async function readMeta(db, tableName, code) {
  if (!isCode(code)) return null;
  const res = await db.send(new GetCommand({
    TableName: tableName,
    Key: { PK: eventPk(code), SK: META_SK },
    ConsistentRead: true,
  }));
  return (res && res.Item) || null;
}

/** Agenda order: `Order`, then the row key, so equal numbers still sort the same way twice. */
function sortItems(rows) {
  return (rows || []).slice().sort((a, b) => (Number(a.Order) || 0) - (Number(b.Order) || 0)
    || String(a.SK).localeCompare(String(b.SK)));
}

/** Every ITEM row of an event, in agenda order. */
async function readItems(db, tableName, code) {
  return sortItems(await queryAll(db, tableName, eventPk(code), ITEM_PREFIX, { consistent: true }));
}

/**
 * THE HOST ROUTES' DOOR. The event's METADATA row when this caller may act on
 * it, else null — for a malformed code, an unknown one and somebody else's
 * alike, so the caller answers every case with the same 404.
 */
async function openEvent(db, tableName, request, code) {
  const meta = await readMeta(db, tableName, code);
  if (!meta) return null;
  return callerMayManageEvent(request, meta) ? meta : null;
}

const decryptEvent = (orgId, row) => decryptItem(orgId, 'event', row);
const decryptItemRow = (orgId, row) => decryptItem(orgId, 'item', row);

/** An agenda item as a response names it, from a DECRYPTED row. */
function projectItem(row) {
  const r = row || {};
  const out = {
    itemId: itemIdOf(r),
    order: Number(r.Order) || 0,
    type: r.Type || '',
    title: typeof r.Title === 'string' ? r.Title : '',
    description: typeof r.Description === 'string' ? r.Description : '',
    minutes: Number(r.Minutes) || 0,
    state: r.State || 'planned',
  };
  if (r.SetRef && typeof r.SetRef === 'object') {
    out.setRef = {
      scope: r.SetRef.scope || 'platform',
      orgId: r.SetRef.orgId || '',
      setId: r.SetRef.setId || '',
      version: r.SetRef.version === undefined ? null : r.SetRef.version,
    };
  }
  return out;
}

/**
 * What the builder says about an item's set: its name, its question count,
 * the version it would play today, or that it is gone. A set is read in the
 * one library its SetRef names — an org set only ever in the event's own
 * organisation — and never searched for.
 */
async function describeSet(db, tableName, setRef) {
  if (!setRef || !setRef.setId) return null;
  const ref = { scope: setRef.scope, orgId: setRef.scope === ORG ? setRef.orgId : '', setId: setRef.setId };
  let row = null;
  try {
    row = await getSetMetadata(db, tableName, ref);
  } catch (error) {
    console.warn(`⚠️ event-store: could not read set ${ref.scope}/${ref.setId}: ${error && error.message}`);
  }
  if (!row) return { missing: true, name: null, questionCount: 0, latestVersion: null };
  let name = typeof row.name === 'string' ? row.name : null;
  if (ref.scope === ORG && ref.orgId) {
    try {
      const plain = await decryptItem(ref.orgId, 'set', { name: row.name });
      name = typeof plain.name === 'string' ? plain.name : null;
    } catch (error) {
      name = null;
    }
  }
  return { missing: false, name, questionCount: Number(row.questionCount) || 0, latestVersion: toVersion(row.activeVersion) };
}

module.exports = {
  META_SK, INDEX_PREFIX, ITEM_PREFIX,
  indexSk, itemSk, itemIdOf, codeOf, isCode, isItemId,
  queryAll, readMeta, readItems, sortItems, openEvent,
  decryptEvent, decryptItemRow, projectEvent, projectItem, describeSet,
};
```

- [ ] **Step 4: Write the list**

Create `lambda-functions/websocket/events/get-events.js`:

```js
/**
 * GET /events — the acting organisation's events, soonest first.
 * docs/design/agenda-redesign/01-events.html.
 *
 * One paged Query of one partition, `ORG#<org>#EVENTS`: another
 * organisation's list is a partition this request never names — the
 * isolation `get-games-list` gets the same way. Names and places are sealed
 * on the list row and decrypted here. ONE unreadable row does not empty the
 * list (the lesson get-question-sets.js records): it is returned with blank
 * words and `decryptFailed`, and logged.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const tenant = require('../tenant');
const { json, trace } = require('./event-http');
const S = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;

exports.handler = async (request) => {
  trace('get-events', request);
  const refused = tenant.requireOrg(request);
  if (refused) return refused;
  const orgId = tenant.callerOrgId(request);
  try {
    const rows = await S.queryAll(db, TABLE(), tenant.eventsIndexPk(orgId), S.INDEX_PREFIX);
    const events = [];
    for (const row of rows) {
      try {
        events.push(S.projectEvent(await S.decryptEvent(orgId, row)));
      } catch (error) {
        console.warn(`⚠️ get-events: could not decrypt ${row.SK} for ${orgId}: ${error && error.message}`);
        events.push({ ...S.projectEvent({ ...row, Title: '', Place: '' }), decryptFailed: true });
      }
    }
    events.sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)) || a.code.localeCompare(b.code));
    return json(200, { events });
  } catch (error) {
    console.error('❌ get-events failed:', error && error.message);
    return json(500, { error: 'Could not load events. Try again.' });
  }
};
```

- [ ] **Step 5: Write the one-event read**

Create `lambda-functions/websocket/events/get-event.js`:

```js
/**
 * GET /events/{code} — one event and its agenda, for the builder.
 * docs/design/agenda-redesign/02-builder.html.
 *
 * The host's read: Cognito, then tenant.callerMayManageEvent; anything else
 * — another organisation's event, an unknown code, a malformed one — is the
 * same 404. Items come back in agenda order, decrypted, and each engagement
 * carries what the builder's row says about its set (event-store.describeSet):
 * its name, its question count, the version it would play today — which is
 * how the builder knows to offer "Use v3" — or that it is gone.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { json, notFound, trace } = require('./event-http');
const S = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;

exports.handler = async (request) => {
  trace('get-event', request);
  const code = String((request.pathParameters || {}).code || '');
  try {
    const meta = await S.openEvent(db, TABLE(), request, code);
    if (!meta) return notFound();
    const event = S.projectEvent(await S.decryptEvent(meta.orgId, meta));
    const rows = await S.readItems(db, TABLE(), code);
    const items = [];
    for (const row of rows) {
      const item = S.projectItem(await S.decryptItemRow(meta.orgId, row));
      if (item.setRef) item.set = await S.describeSet(db, TABLE(), item.setRef);
      items.push(item);
    }
    return json(200, { event, items });
  } catch (error) {
    console.error('❌ get-event failed:', error && error.message);
    return json(500, { error: 'Could not load the event. Try again.' });
  }
};
```

- [ ] **Step 6: Add the two routes**

In `template-clean.yaml`, insert immediately above the line `  StartVoteFunction:`:

```yaml
  GetEventsFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-get-events'
      CodeUri: lambda-functions/websocket/
      Handler: events/get-events.handler
      Events:
        GetEvents:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /events
            Method: get
            Auth:
              Authorizer: CognitoAuthorizer
      Policies:
        # Opens the event names on the organisation's list.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
        - DynamoDBReadPolicy:
            TableName: !Ref GameTable
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

and, after it:

```yaml
  GetEventFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-get-event'
      CodeUri: lambda-functions/websocket/
      Handler: events/get-event.handler
      Events:
        GetEvent:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /events/{code}
            Method: get
            Auth:
              Authorizer: CognitoAuthorizer
      Policies:
        # Opens the event, its items and an org set's name.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
        - DynamoDBReadPolicy:
            TableName: !Ref GameTable
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

- [ ] **Step 7: Run it green**

```bash
for t in event-host-reads event-create kms-grants-match-code template-validates; do node tests/$t.js > /dev/null 2>&1; echo "$t exit=$?"; done
```

Expected: every line `exit=0`; `event-host-reads.js` reports `12 passed, 0 failed`. To see the paging check bite, change `} while (ExclusiveStartKey);` in `queryAll` to `} while (false && ExclusiveStartKey);`: "it reads every page" must FAIL; put it back.

- [ ] **Step 8: Run the whole backend loop.** Expected: `fail=0`.

- [ ] **Step 9: Commit**

```bash
git add lambda-functions/websocket/events/event-store.js lambda-functions/websocket/events/get-events.js lambda-functions/websocket/events/get-event.js template-clean.yaml tests/event-host-reads.js
git commit -m "A host can list their organisation's events and open one: GET /events, GET /events/{code}

The list is every page of the acting organisation's own partition, soonest
first, names decrypted; one unreadable row is flagged, not fatal. One event
opens only for a member of its organisation, and every other case - another
organisation, no group, an unknown or malformed code - is the same 404. Each
engagement says its set's name, size and current version, or that it is gone,
which is what the builder needs for its rows and for Use vN.

Tests: tests/event-host-reads.js (new; pages the list with table.pageSize).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Editing an event's details — `PUT /events/{code}`, and a new date moves every row's expiry

"Edit details" (02's facts strip) opens the new-event dialog filled in and saves through this route. A rename reaches both rows, sealed. A new date rewrites the `ttl` of the code, the list row, METADATA and every item in one transaction: an event moved to next month must not lose its agenda on the old date's clock.

**Files:**
- Modify: `lambda-functions/websocket/events/event-store.js` (two helpers and the export)
- Create: `lambda-functions/websocket/events/update-event.js`
- Modify: `template-clean.yaml` (one function above `  StartVoteFunction:`)
- Create: `tests/event-update.js`

**Interfaces:**
- Consumes: `openEvent`, `decryptEvent`, `readItems`, `projectEvent`, `indexSk`, `META_SK` (Task 5); `checkEventFields`, `eventTtl` (Task 2); `encryptItem`; `eventPk`, `eventsIndexPk`, `GAMES_RESERVATION_PK`.
- Produces (`event-store.js`): `AGENDA_CHANGED` (the one sentence a lost race answers with), `isCancelled(error) → boolean` (`TransactionCanceledException`). Task 7 and Task 8 use both.
- Produces (route): `PUT /events/{code}` body — any of `{title, place, startsAt, timeZone, access, attendeeReports}`; fields left out keep their values → `200 {event}`; `400 {error}` (nothing written); `404`; `409 {code: 'agenda_changed'}` when the transaction is cancelled (the code's reservation must be an event's — `Kind = event`).

- [ ] **Step 1: Write the failing test**

Create `tests/event-update.js`:

```js
/**
 * PUT /events/{code} — lambda-functions/websocket/events/update-event.js.
 *
 * "Edit details": the name, place, date, start, zone and report default. The
 * name and place are re-sealed on both rows; a new date moves the expiry of
 * every row the event owns, in one transaction.
 *
 * rejects: a rename that reaches METADATA but not the list (or the reverse);
 * plaintext written back; a date change that leaves any row — the code, an
 * item — on the old date's clock; a date change that could touch a session's
 * code; a bad value half-saved; a foreign member editing.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const update = h.load('lambda-functions/websocket/events/update-event.js').handler;
const rules = h.load('lambda-functions/websocket/events/agenda-rules.js');
const { isEnvelope, encryptItem } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const put = (code, body, ctx = asHost(NW)) => update(request({
  method: 'PUT', path: `/events/${code}`, pathParameters: { code }, body, requestContext: ctx,
}));

(async () => {
  table.clear();
  seedOrg(table, NW);
  seedOrg(table, 'org_md');
  const first = startsIn(20);
  const { code } = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: first, timeZone: 'Europe/London' },
  }))).event;
  table.put(await encryptItem(NW, 'item', {
    PK: `EVENT#${code}`, SK: 'ITEM#it_00000001', Type: 'break', Order: 1, Minutes: 15,
    Title: 'Break', State: 'planned', ttl: table.get(`EVENT#${code}`, 'METADATA').ttl,
  }));
  const rows = () => ({
    reservation: table.get('GAMES', `GAME#${code}`),
    list: table.get(`ORG#${NW}#EVENTS`, `EVENT#${code}`),
    meta: table.get(`EVENT#${code}`, 'METADATA'),
    item: table.get(`EVENT#${code}`, 'ITEM#it_00000001'),
  });

  console.log('\n1. a rename reaches both rows, sealed');
  const renamed = await put(code, { title: 'Q4 Kickoff, day one', place: 'Riverside Hall' });
  await check('200 with the new details, the rest kept', () => {
    assert.strictEqual(renamed.statusCode, 200, renamed.body);
    const { event } = bodyOf(renamed);
    assert.strictEqual(event.title, 'Q4 Kickoff, day one');
    assert.strictEqual(event.place, 'Riverside Hall');
    assert.strictEqual(event.startsAt, first);
  });
  await check('both rows carry the new words, sealed', () => {
    const { list, meta } = rows();
    for (const row of [list, meta]) {
      assert.ok(isEnvelope(row.Title) && isEnvelope(row.Place));
      assert.strictEqual(plainRow(NW, row).Title, 'Q4 Kickoff, day one');
      assert.strictEqual(plainRow(NW, row).Place, 'Riverside Hall');
    }
  });
  await check('the same date leaves every expiry alone', () => {
    const { reservation, list, meta, item } = rows();
    const ttl = meta.ttl;
    for (const row of [reservation, list, item]) assert.strictEqual(row.ttl, ttl);
  });

  console.log('\n2. a new date moves every row\'s expiry, together');
  const later = startsIn(200);
  await check('the code, the list row, METADATA and every item follow the new date', async () => {
    const res = await put(code, { startsAt: later });
    assert.strictEqual(res.statusCode, 200, res.body);
    const expected = rules.eventTtl(later, Math.floor(Date.now() / 1000));
    for (const [name, row] of Object.entries(rows())) assert.strictEqual(row.ttl, expected, `${name} stayed on the old clock`);
    assert.strictEqual(rows().meta.StartsAt, later);
    assert.strictEqual(rows().list.StartsAt, later);
  });
  // rejects: the reservation's update without its Kind condition, which would
  // let a date change write onto a session's code.
  await check('a code that is not an event\'s cancels the whole change', async () => {
    const held = table.get('GAMES', `GAME#${code}`);
    table.put({ PK: held.PK, SK: held.SK, orgId: held.orgId, ttl: held.ttl });   // a session's shape
    try {
      const res = await put(code, { startsAt: startsIn(100) });
      assert.strictEqual(res.statusCode, 409, res.body);
      assert.strictEqual(rows().meta.StartsAt, later, 'METADATA moved anyway');
    } finally { table.put(held); }
  });

  console.log('\n3. refusals change nothing');
  for (const [label, patch] of [
    ['an empty name', { title: '  ' }],
    ['an unknown zone', { timeZone: 'Mars/Base' }],
    ['invite-only', { access: 'invite' }],
  ]) {
    await check(`${label}: 400, nothing written`, async () => {
      const before = JSON.stringify(rows());
      const res = await put(code, patch);
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.strictEqual(JSON.stringify(rows()), before);
    });
  }
  await check('another organisation\'s member: 404, nothing written', async () => {
    const before = JSON.stringify(rows());
    const res = await put(code, { title: 'Mine now' }, asHost('org_md'));
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(JSON.stringify(rows()), before);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/event-update.js; echo "exit=$?"
```

Expected: `Error: Cannot find module '…/lambda-functions/websocket/events/update-event.js'`, exit 1.

- [ ] **Step 3: Add the race helpers to `event-store.js`**

Replace

```js
module.exports = {
  META_SK, INDEX_PREFIX, ITEM_PREFIX,
  indexSk, itemSk, itemIdOf, codeOf, isCode, isItemId,
  queryAll, readMeta, readItems, sortItems, openEvent,
  decryptEvent, decryptItemRow, projectEvent, projectItem, describeSet,
};
```

with

```js
/**
 * Every write that loses a race answers with this sentence, and nothing of it
 * landed: each is one TransactWrite, all or nothing.
 */
const AGENDA_CHANGED = 'The event changed while you were saving. Nothing was saved; reload it and try again.';

/** A cancelled TransactWrite: a condition failed, or another write held a row. */
const isCancelled = (error) => Boolean(error && error.name === 'TransactionCanceledException');

module.exports = {
  META_SK, INDEX_PREFIX, ITEM_PREFIX, AGENDA_CHANGED,
  indexSk, itemSk, itemIdOf, codeOf, isCode, isItemId, isCancelled,
  queryAll, readMeta, readItems, sortItems, openEvent,
  decryptEvent, decryptItemRow, projectEvent, projectItem, describeSet,
};
```

- [ ] **Step 4: Write the handler**

Create `lambda-functions/websocket/events/update-event.js`:

```js
/**
 * PUT /events/{code} — change an event's details: name, date, start, time
 * zone, place, the report default. "Edit details" in the builder's facts
 * strip (02-builder.html) opens the new-event dialog (05) filled in.
 *
 * Any field the body leaves out keeps its value; the result is checked as a
 * whole by agenda-rules.checkEventFields, exactly as a create is. Access stays
 * `open` until invitations exist (PLAN Phase 3).
 *
 * ── A NEW DATE MOVES EVERY ROW'S EXPIRY, IN ONE WRITE ─────────────────────
 * An event's rows are kept until 90 days after its day (agenda-rules.eventTtl).
 * When the date changes, the code's reservation, the list row, METADATA and
 * every item row get the new `ttl` in ONE transaction: an event moved to next
 * month must not lose its agenda on the old date's clock, and no row may be
 * left on the other. The reservation is conditioned on `Kind = event`, so
 * this route can never touch a session's code. At most 16 + 16 items plus
 * three rows: inside DynamoDB's 100.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('../tenant');
const { encryptItem } = require('../tenant-crypto');
const rules = require('./agenda-rules');
const { json, notFound, readBody, trace } = require('./event-http');
const S = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

exports.handler = async (request) => {
  trace('update-event', request);
  const code = String((request.pathParameters || {}).code || '');
  try {
    const meta = await S.openEvent(db, TABLE(), request, code);
    if (!meta) return notFound();
    const body = readBody(request);
    if (!body) return json(400, { error: 'The request body is not valid JSON.' });

    const current = await S.decryptEvent(meta.orgId, meta);
    const merged = {
      title: has(body, 'title') ? body.title : current.Title,
      place: has(body, 'place') ? body.place : current.Place,
      startsAt: has(body, 'startsAt') ? body.startsAt : current.StartsAt,
      timeZone: has(body, 'timeZone') ? body.timeZone : current.TimeZone,
      access: has(body, 'access') ? body.access : current.Access,
      attendeeReports: has(body, 'attendeeReports') ? body.attendeeReports : current.AttendeeReports,
    };
    const nowSeconds = Math.floor(Date.now() / 1000);
    const checked = rules.checkEventFields(merged, { nowSeconds });
    if (checked.error) return json(400, { error: checked.error });
    const v = checked.value;

    const now = new Date(nowSeconds * 1000).toISOString();
    const sealed = await encryptItem(meta.orgId, 'event', { Title: v.title, Place: v.place });
    const moved = v.startsAt !== meta.StartsAt;
    const ttl = moved ? rules.eventTtl(v.startsAt, nowSeconds) : meta.ttl;

    const names = {
      '#t': 'Title', '#pl': 'Place', '#sa': 'StartsAt', '#tz': 'TimeZone', '#ac': 'Access', '#ttl': 'ttl',
    };
    const values = {
      ':t': sealed.Title, ':pl': sealed.Place, ':sa': v.startsAt, ':tz': v.timeZone, ':ac': v.access, ':ttl': ttl,
    };
    const tx = [
      {
        Update: {
          TableName: TABLE(),
          Key: { PK: tenant.eventPk(code), SK: S.META_SK },
          UpdateExpression: 'SET #t = :t, #pl = :pl, #sa = :sa, #tz = :tz, #ac = :ac, #ttl = :ttl, #ar = :ar, #ua = :now',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { ...names, '#ar': 'AttendeeReports', '#ua': 'UpdatedAt' },
          ExpressionAttributeValues: { ...values, ':ar': v.attendeeReports, ':now': now },
        },
      },
      {
        Update: {
          TableName: TABLE(),
          Key: { PK: tenant.eventsIndexPk(meta.orgId), SK: S.indexSk(code) },
          UpdateExpression: 'SET #t = :t, #pl = :pl, #sa = :sa, #tz = :tz, #ac = :ac, #ttl = :ttl',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        },
      },
    ];
    if (moved) {
      tx.push({
        Update: {
          TableName: TABLE(),
          Key: { PK: tenant.GAMES_RESERVATION_PK, SK: `GAME#${code}` },
          UpdateExpression: 'SET #ttl = :ttl',
          ConditionExpression: 'attribute_exists(PK) AND #k = :event',
          ExpressionAttributeNames: { '#ttl': 'ttl', '#k': 'Kind' },
          ExpressionAttributeValues: { ':ttl': ttl, ':event': 'event' },
        },
      });
      for (const row of await S.readItems(db, TABLE(), code)) {
        tx.push({
          Update: {
            TableName: TABLE(),
            Key: { PK: row.PK, SK: row.SK },
            UpdateExpression: 'SET #ttl = :ttl',
            ConditionExpression: 'attribute_exists(SK)',
            ExpressionAttributeNames: { '#ttl': 'ttl' },
            ExpressionAttributeValues: { ':ttl': ttl },
          },
        });
      }
    }

    try {
      await db.send(new TransactWriteCommand({ TransactItems: tx }));
    } catch (error) {
      if (!S.isCancelled(error)) throw error;
      return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });
    }

    return json(200, {
      event: S.projectEvent({
        ...meta,
        Title: v.title, Place: v.place, StartsAt: v.startsAt, TimeZone: v.timeZone,
        Access: v.access, AttendeeReports: v.attendeeReports, UpdatedAt: now, ttl,
      }),
    });
  } catch (error) {
    console.error('❌ update-event failed:', error && error.message);
    return json(500, { error: 'Could not save the event. Nothing was changed; try again.' });
  }
};
```

- [ ] **Step 5: Add the route**

In `template-clean.yaml`, insert immediately above the line `  StartVoteFunction:`:

```yaml
  UpdateEventFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-update-event'
      CodeUri: lambda-functions/websocket/
      Handler: events/update-event.handler
      Events:
        UpdateEvent:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /events/{code}
            Method: put
            Auth:
              Authorizer: CognitoAuthorizer
      Policies:
        # Opens and re-seals the event's name and place.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
        - DynamoDBCrudPolicy:
            TableName: !Ref GameTable
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

- [ ] **Step 6: Run it green**

```bash
for t in event-update event-host-reads event-create kms-grants-match-code template-validates; do node tests/$t.js > /dev/null 2>&1; echo "$t exit=$?"; done
```

Expected: every line `exit=0`; `event-update.js` reports `9 passed, 0 failed`.

- [ ] **Step 7: Run the whole backend loop.** Expected: `fail=0`.

- [ ] **Step 8: Commit**

```bash
git add lambda-functions/websocket/events/event-store.js lambda-functions/websocket/events/update-event.js template-clean.yaml tests/event-update.js
git commit -m "A host can change an event's details, and a new date moves every row's expiry with it

PUT /events/{code} takes any of the name, place, date, start, zone and report
default, checks the whole as a create is checked, and re-seals the words on
both rows. A new date rewrites the ttl of the code, the list row, METADATA
and every item in one transaction, so no row stays on the old date's clock;
the code's update is conditioned on Kind = event, so a session's code is
never touched.

Tests: tests/event-update.js (new).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Adding and removing agenda items, with the caps held by the write

`POST /events/{code}/items` adds an engagement (pinned to a set version) or a break, at a position; `DELETE /events/{code}/items/{itemId}` removes one that has not started. The caps — 16 items, 8 of them engagements, breaks uncounted — are checked first so a refusal carries the builder's own sentence, and held again by the transaction that writes the item: the counters' update is conditioned on `EngagementCount < 8` (and `ItemCount < 16`), so two hosts adding the ninth engagement at once cannot both land (02's note). An insert renumbers the rows after it in the same transaction.

**Files:**
- Create: `lambda-functions/websocket/events/items.js`
- Modify: `template-clean.yaml` (one function above `  StartVoteFunction:`)
- Create: `tests/event-caps.js`

**Interfaces:**
- Consumes: `openEvent`, `readMeta`, `readItems`, `itemSk`, `itemIdOf`, `isItemId`, `indexSk`, `META_SK`, `projectItem`, `isCancelled`, `AGENDA_CHANGED` (Tasks 4–6); `ADDABLE_TYPES`, `COMING_SOON`, `checkItemFields`, `capRefusal`, `isEngagement`, `isCounted`, `canonicalSetType`, `TYPE_LABELS`, `CAP_SENTENCES`, `MAX_*`, `BREAK` (Task 2); `getSetMetadata`, `knownVersions`, `toVersion` (`websocket/set-version.js`); `SCOPES`, `ORG`, `eventPk`, `eventsIndexPk`; `encryptItem`.
- Produces (routes):
  - `POST /events/{code}/items` body `{type, title, description?, minutes, position?, setRef?: {scope, setId, version?}}` → `201 {item: projectItem}`. `type` must be in `ADDABLE_TYPES`; `presentation` and `survey` answer 400 with `COMING_SOON`. An engagement needs `setRef`: an `org` set is looked up in the EVENT's organisation only (the request's `orgId` is ignored); the set must exist, be active and be of the item's type; `version` defaults to the set's `activeVersion` (null for a never-versioned set). `position` is the new item's 0-based index in the whole agenda (breaks included), default the end. Refusals: `400 {error}`; `409 {error: CAP_SENTENCES.x, cap}`; `409 {error: AGENDA_CHANGED, code: 'agenda_changed'}`.
  - `DELETE /events/{code}/items/{itemId}` → `200 {removed: itemId}`; `404`; `409 {code: 'not_planned'}` for an item that has started.
  - Item row: `EVENT#<code>/ITEM#it_<8 hex> {Type, Order, Minutes, Title*, Description*, State:'planned', SetRef?: {scope, orgId, setId, version}, CreatedAt, UpdatedAt, ttl: the event's}`. Counters: METADATA `ItemCount`, `EngagementCount`, `BreakCount`; the list row's `ItemCount`.

- [ ] **Step 1: Write the failing test**

Create `tests/event-caps.js`:

```js
/**
 * ADDING AND REMOVING AGENDA ITEMS, AND THE CAPS THE SERVER HOLDS —
 * POST /events/{code}/items and DELETE /events/{code}/items/{itemId}
 * (lambda-functions/websocket/events/items.js).
 *
 * The owner's caps (decision 1): 16 items, at most 8 of them engagements;
 * breaks count for nothing (decision 7). The builder disables what cannot be
 * added — and the server refuses it again, in the same words, inside the same
 * transaction as the write, so two hosts adding at once cannot slip past.
 *
 * rejects: a 17th item or a 9th engagement written; a break counted; a
 * refusal worded differently from the builder's menu; two concurrent adds
 * both landing the 8th-and-9th engagement; an insert that leaves two rows at
 * one place; a set from another organisation's library pinned to this
 * agenda; a set of the wrong type; an unpinned version; plaintext titles;
 * a presentation or survey item added before its release; removing an item
 * that has started; counts left behind by a removal.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const rules = h.load('lambda-functions/websocket/events/agenda-rules.js');
const { encryptItem, isEnvelope } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const MD = 'org_md';
let code;
const add = (body, ctx = asHost(NW)) => items(request({
  method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, body, requestContext: ctx,
}));
const remove = (itemId, ctx = asHost(NW)) => items(request({
  method: 'DELETE', path: `/events/${code}/items/${itemId}`, pathParameters: { code, itemId }, requestContext: ctx,
}));
const meta = () => table.get(`EVENT#${code}`, 'METADATA');
const listRow = () => table.get(`ORG#${NW}#EVENTS`, `EVENT#${code}`);
const itemRows = () => [...table.store.values()]
  .filter((r) => r.PK === `EVENT#${code}` && String(r.SK).startsWith('ITEM#'))
  .sort((a, b) => a.Order - b.Order);
const trivia = (title, extra = {}) => ({
  type: 'trivia', title, description: 'Ten questions.', minutes: 15,
  setRef: { scope: 'org', setId: 'custq4' }, ...extra,
});
const poll = (title) => ({ type: 'poll', title, minutes: 10, setRef: { scope: 'platform', setId: 'pulse' } });

async function freshEvent() {
  table.clear();
  seedOrg(table, NW);
  seedOrg(table, MD);
  table.put(await encryptItem(NW, 'set', {
    PK: `ORG#${NW}#SETS`, SK: 'SET#custq4', name: 'Customer knowledge — Q4', engagementType: 'trivia',
    questionCount: 10, activeVersion: 3, versions: [{ version: 1 }, { version: 2 }, { version: 3 }],
  }));
  table.put({ PK: 'SETS', SK: 'SET#pulse', name: 'Pulse', engagementType: 'polls', questionCount: 3, activeVersion: 1, versions: [{ version: 1 }] });
  table.put({ PK: 'SETS', SK: 'SET#legacy', name: 'Legacy', questionCount: 4 });
  table.put({ PK: 'SETS', SK: 'SET#off', name: 'Off', engagementType: 'trivia', active: false, activeVersion: 1 });
  table.put(await encryptItem(MD, 'set', {
    PK: `ORG#${MD}#SETS`, SK: 'SET#theirs', name: 'Their quiz', engagementType: 'trivia', activeVersion: 1,
  }));
  code = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', startsAt: startsIn(20), timeZone: 'Europe/London' },
  }))).event.code;
}

(async () => {
  console.log('\n1. an engagement, pinned and sealed');
  await freshEvent();
  const first = await add(trivia('How well do you know our customers?'));
  const item = bodyOf(first).item;
  await check('201: planned, first on the agenda, pinned to the set\'s current version', () => {
    assert.strictEqual(first.statusCode, 201, first.body);
    assert.match(item.itemId, /^it_[0-9a-f]{8}$/);
    assert.strictEqual(item.state, 'planned');
    assert.strictEqual(item.order, 1);
    assert.deepStrictEqual(item.setRef, { scope: 'org', orgId: NW, setId: 'custq4', version: 3 });
  });
  await check('the row is sealed, carries the event\'s expiry, and the counts moved on both rows', () => {
    const row = itemRows()[0];
    assert.ok(isEnvelope(row.Title) && isEnvelope(row.Description));
    assert.strictEqual(plainRow(NW, row).Title, 'How well do you know our customers?');
    assert.strictEqual(row.ttl, meta().ttl);
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount, meta().BreakCount], [1, 1, 0]);
    assert.strictEqual(listRow().ItemCount, 1);
  });
  await check('an explicit older version is pinned as asked', async () => {
    const res = await add(trivia('Again', { setRef: { scope: 'org', setId: 'custq4', version: 2 } }));
    assert.strictEqual(bodyOf(res).item.setRef.version, 2);
  });
  await check('an older spelling of the type still matches (polls → poll)', async () => {
    const res = await add(poll('Where next?'));
    assert.strictEqual(res.statusCode, 201, res.body);
  });
  await check('a set that has never been versioned pins no version', async () => {
    const res = await add({ type: 'call-and-answer', title: 'Old set', minutes: 10, setRef: { scope: 'platform', setId: 'legacy' } });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.strictEqual(bodyOf(res).item.setRef.version, null);
  });

  console.log('\n2. what may not be pinned');
  for (const [label, body, error] of [
    ['another organisation\'s set, even named with its orgId', trivia('x', { setRef: { scope: 'org', orgId: MD, setId: 'theirs' } }), /not in a library this event can use/],
    ['a set of another type', { type: 'poll', title: 'x', minutes: 5, setRef: { scope: 'org', setId: 'custq4' } }, /Trivia set, and this item is Poll/],
    ['a set switched off', trivia('x', { setRef: { scope: 'platform', setId: 'off' } }), /switched off/],
    ['a version the set never had', trivia('x', { setRef: { scope: 'org', setId: 'custq4', version: 9 } }), /version/],
    ['no set at all', { type: 'trivia', title: 'x', minutes: 5 }, /Choose a question set/],
    ['a presentation, before M5', { type: 'presentation', title: 'x', minutes: 30 }, /Presentations are coming soon/],
    ['a survey item, before PLAN Phase 6', { type: 'survey', title: 'x', minutes: 5 }, /Survey items are coming soon/],
    ['a kind that does not exist', { type: 'party', title: 'x', minutes: 5 }, /not a kind of agenda item/],
    ['a length of zero', trivia('x', { minutes: 0 }), /whole number of minutes/],
  ]) {
    await check(`${label}: 400, nothing written`, async () => {
      const before = itemRows().length;
      const res = await add(body);
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.match(bodyOf(res).error, error);
      assert.strictEqual(itemRows().length, before);
    });
  }
  await check('the other organisation\'s library was never even read', () =>
    assert.ok(!table.log.some((e) => e.type === 'get' && e.input.Key.PK === `ORG#${MD}#SETS`)));

  console.log('\n3. the caps, in the builder\'s words');
  await freshEvent();
  for (let i = 1; i <= 8; i += 1) await add(trivia(`Quiz ${i}`));
  await check('eight engagements fit', () => assert.strictEqual(meta().EngagementCount, 8));
  await check('a 9th engagement: 409 with the menu\'s sentence, nothing written', async () => {
    const res = await add(poll('One too many'));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.deepStrictEqual(bodyOf(res), { error: rules.CAP_SENTENCES.engagements, cap: 'engagements' });
    assert.strictEqual(itemRows().length, 8);
  });
  await check('a break still fits, and counts for nothing', async () => {
    const res = await add({ type: 'break', minutes: 15, description: 'Coffee on the landing.' });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.strictEqual(bodyOf(res).item.title, 'Break');
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount, meta().BreakCount], [8, 8, 1]);
    assert.strictEqual(listRow().ItemCount, 8);
  });
  await check('at 16 items (presentations fill the rest in M5) a 17th is refused', async () => {
    table.put({ ...meta(), ItemCount: 16, EngagementCount: 7 });
    const res = await add(trivia('Seventeenth'));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).cap, 'items');
    assert.strictEqual(bodyOf(res).error, rules.CAP_SENTENCES.items);
  });

  console.log('\n4. two hosts at once: exactly one 8th engagement lands');
  await freshEvent();
  for (let i = 1; i <= 7; i += 1) await add(trivia(`Quiz ${i}`));
  // rejects: a cap held by the read alone. Both adds read 7 and pass; only
  // the transaction's `EngagementCount < 8` can stop the second.
  await check('the add that loses the race is refused with the cap\'s sentence', async () => {
    const gate = table.hold((c) => c.type === 'transactWrite');
    const slow = add(trivia('Host A'));
    await gate.reached;
    const fast = await add(poll('Host B'));
    gate.release();
    const late = await slow;
    assert.strictEqual(fast.statusCode, 201, fast.body);
    assert.strictEqual(late.statusCode, 409, late.body);
    assert.strictEqual(bodyOf(late).error, rules.CAP_SENTENCES.engagements);
    assert.strictEqual(meta().EngagementCount, 8);
    assert.strictEqual(itemRows().length, 8);
  });

  console.log('\n5. a position inserts, and the numbers stay whole');
  await freshEvent();
  await add(trivia('A'));
  await add(trivia('C'));
  await check('position 1 puts B between A and C, and renumbers C', async () => {
    const res = await add(trivia('B', { position: 1 }));
    assert.strictEqual(bodyOf(res).item.order, 2);
    assert.deepStrictEqual(itemRows().map((r) => [plainRow(NW, r).Title, r.Order]), [['A', 1], ['B', 2], ['C', 3]]);
  });
  await check('no position means the end', async () => {
    await add({ type: 'break', minutes: 5 });
    assert.strictEqual(itemRows()[3].Type, 'break');
  });

  console.log('\n6. removing');
  const victim = itemRows()[0];
  const victimId = victim.SK.slice('ITEM#'.length);
  await check('a planned engagement goes, and both counts come down', async () => {
    const res = await remove(victimId);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(table.get(`EVENT#${code}`, victim.SK), undefined);
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount, meta().BreakCount], [2, 2, 1]);
    assert.strictEqual(listRow().ItemCount, 2);
  });
  await check('removing a break moves only the break count', async () => {
    const brk = itemRows().find((r) => r.Type === 'break');
    await remove(brk.SK.slice('ITEM#'.length));
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount, meta().BreakCount], [2, 2, 0]);
  });
  await check('an item that has started cannot be removed', async () => {
    const started = itemRows()[0];
    table.put({ ...started, State: 'live' });
    const res = await remove(started.SK.slice('ITEM#'.length));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'not_planned');
    assert.ok(table.get(`EVENT#${code}`, started.SK));
  });
  await check('an unknown item, and another organisation\'s member: 404', async () => {
    assert.strictEqual((await remove('it_ffffffff')).statusCode, 404);
    const own = itemRows()[1].SK.slice('ITEM#'.length);
    assert.strictEqual((await remove(own, asHost(MD))).statusCode, 404);
    assert.ok(table.get(`EVENT#${code}`, `ITEM#${own}`), 'a foreign member removed an item');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/event-caps.js; echo "exit=$?"
```

Expected: `Error: Cannot find module '…/lambda-functions/websocket/events/items.js'`, exit 1.

- [ ] **Step 3: Write the handler (add and remove; Task 8 adds edit and reorder)**

Create `lambda-functions/websocket/events/items.js`:

```js
/**
 * AN EVENT'S AGENDA ITEMS. docs/design/agenda-redesign/02, 02b, 03.
 *
 *   POST   /events/{code}/items            add one, at a position
 *   DELETE /events/{code}/items/{itemId}   remove one that has not started
 *   PUT    /events/{code}/items            reorder: { order: [itemId, …] }
 *   PUT    /events/{code}/items/{itemId}   edit: title, description, minutes,
 *                                          and "Use vN" for an engagement
 *
 * Every route opens the event through event-store.openEvent: another
 * organisation's event, an unknown code and a malformed one are the same 404.
 *
 * ── THE CAPS ARE HELD BY THE WRITE, NOT BY A READ ─────────────────────────
 * 16 items, 8 of them engagements, breaks uncounted (agenda-rules.js). The
 * builder disables what cannot be added and says why, and this route checks
 * METADATA's counts first so a refusal carries the builder's own sentence.
 * Neither can stop two hosts adding the ninth engagement at the same moment
 * (02-builder: "so two hosts editing at once cannot slip past it"). So the
 * item's Put rides in ONE transaction with the METADATA counters' update,
 * conditioned `ItemCount < 16` (and `EngagementCount < 8` for an engagement),
 * and the loser's whole transaction is cancelled: none of it lands.
 *
 * ── ORDER IS A FIELD ──────────────────────────────────────────────────────
 * RATIONALE §c: "a reorder rewrites numbers, never keys". Every row carries
 * `Order`, 1..n. An insert renumbers the rows after it in the same transaction
 * as the Put, each update conditioned on the number it read, so a concurrent
 * change cancels the lot rather than leaving two rows with one number.
 *
 * ── ONLY A PLANNED ITEM CHANGES ───────────────────────────────────────────
 * An item is born `planned` (decision 11: nothing is active before the host
 * starts it on the day). Starting, pausing and ending belong to roadmap M3,
 * and none of them is here. Every edit and removal here is conditioned on
 * `State = planned`, so an item that has started cannot be changed under the
 * room.
 */
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('../tenant');
const { encryptItem } = require('../tenant-crypto');
const { getSetMetadata, knownVersions, toVersion } = require('../set-version');
const rules = require('./agenda-rules');
const { json, notFound, readBody, trace, methodOf } = require('./event-http');
const S = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
const PLANNED = 'planned';
const NOT_PLANNED = 'This item has started, so it cannot be changed here.';

const countsOf = (meta) => ({
  items: Number(meta.ItemCount) || 0,
  engagements: Number(meta.EngagementCount) || 0,
  breaks: Number(meta.BreakCount) || 0,
});
const newItemId = () => `it_${crypto.randomBytes(4).toString('hex')}`;

/** Where a new item goes: its 0-based index in the whole agenda, breaks included. */
function clampPosition(value, length) {
  const n = Number(value);
  if (!Number.isInteger(n)) return length;
  return Math.max(0, Math.min(length, n));
}

/**
 * THE COUNTERS, moved in the same transaction as the row they count. With
 * `capFor`, the update also carries the cap that `type` must still be under,
 * so a race lost between this route's read and its write cancels the write.
 */
function counterUpdate(code, delta, now, capFor) {
  const conditions = ['attribute_exists(PK)'];
  const values = { ':di': delta.items, ':de': delta.engagements, ':db': delta.breaks, ':now': now };
  if (capFor === rules.BREAK) {
    conditions.push('#bc < :maxB');
    values[':maxB'] = rules.MAX_BREAKS;
  } else if (capFor) {
    conditions.push('#ic < :maxI');
    values[':maxI'] = rules.MAX_ITEMS;
    if (rules.isEngagement(capFor)) {
      conditions.push('#ec < :maxE');
      values[':maxE'] = rules.MAX_ENGAGEMENTS;
    }
  }
  return {
    TableName: TABLE(),
    Key: { PK: tenant.eventPk(code), SK: S.META_SK },
    UpdateExpression: 'SET #ua = :now ADD #ic :di, #ec :de, #bc :db',
    ConditionExpression: conditions.join(' AND '),
    ExpressionAttributeNames: { '#ua': 'UpdatedAt', '#ic': 'ItemCount', '#ec': 'EngagementCount', '#bc': 'BreakCount' },
    ExpressionAttributeValues: values,
  };
}

/** The organisation's list shows each event's count of items; breaks are not items. */
function listCountUpdate(orgId, code, delta) {
  return {
    TableName: TABLE(),
    Key: { PK: tenant.eventsIndexPk(orgId), SK: S.indexSk(code) },
    UpdateExpression: 'ADD #ic :d',
    ConditionExpression: 'attribute_exists(PK)',
    ExpressionAttributeNames: { '#ic': 'ItemCount' },
    ExpressionAttributeValues: { ':d': delta },
  };
}

/** Give one row a new place, only if it still holds the place this route read. */
function orderUpdate(row, order, now) {
  return {
    TableName: TABLE(),
    Key: { PK: row.PK, SK: row.SK },
    UpdateExpression: 'SET #o = :n, #ua = :now',
    ConditionExpression: 'attribute_exists(SK) AND #o = :was',
    ExpressionAttributeNames: { '#o': 'Order', '#ua': 'UpdatedAt' },
    ExpressionAttributeValues: { ':n': order, ':was': Number(row.Order) || 0, ':now': now },
  };
}

/**
 * PIN THE SET an engagement plays: `{scope, orgId, setId, version}`.
 *
 * An ORG set is always the EVENT's organisation's. The `orgId` a browser
 * sends is never read, so no request can point an agenda at another team's
 * library — the set is looked for in exactly one partition and is absent,
 * not forbidden, anywhere else. The version is the one asked for if the set
 * has it, else the set's current one: pinned when added, and changed later
 * only by an explicit "Use vN" (PUT), never silently (RATIONALE §c).
 */
async function pinSet(meta, type, requested) {
  const scope = String((requested && requested.scope) || '').trim();
  const setId = String((requested && requested.setId) || '').trim();
  if (!setId || !tenant.SCOPES.includes(scope)) return { error: 'Choose a question set for this item.' };
  const ref = { scope, orgId: scope === tenant.ORG ? meta.orgId : '', setId };
  const row = await getSetMetadata(db, TABLE(), ref);
  if (!row) return { error: 'That question set is not in a library this event can use.' };
  if (row.active === false) return { error: 'That question set is switched off. Switch it on in Question sets first.' };
  const setType = rules.canonicalSetType(row.engagementType);
  if (setType !== type) {
    return { error: `That is a ${rules.TYPE_LABELS[setType] || 'different kind of'} set, and this item is ${rules.TYPE_LABELS[type]}.` };
  }
  const active = toVersion(row.activeVersion);
  let version = active;
  if (requested && requested.version !== undefined && requested.version !== null) {
    version = toVersion(requested.version);
    if (version === null || !(knownVersions(row).includes(version) || version === active)) {
      return { error: 'That version of the question set does not exist.' };
    }
  }
  return { setRef: { scope, orgId: ref.orgId, setId, version } };
}

async function readItem(code, itemId) {
  if (!S.isItemId(itemId)) return null;
  const res = await db.send(new GetCommand({
    TableName: TABLE(),
    Key: { PK: tenant.eventPk(code), SK: S.itemSk(itemId) },
    ConsistentRead: true,
  }));
  return (res && res.Item) || null;
}

// ── POST: add ───────────────────────────────────────────────────────────────
async function addItem(request, meta, code) {
  const body = readBody(request);
  if (!body) return json(400, { error: 'The request body is not valid JSON.' });
  const type = String(body.type || '').trim();
  if (rules.COMING_SOON[type]) return json(400, { error: rules.COMING_SOON[type] });
  if (!rules.ADDABLE_TYPES.includes(type)) return json(400, { error: 'That is not a kind of agenda item.' });
  const fields = rules.checkItemFields(body, type);
  if (fields.error) return json(400, { error: fields.error });

  const capped = rules.capRefusal(countsOf(meta), type);
  if (capped) return json(409, { error: capped.message, cap: capped.cap });

  let setRef = null;
  if (rules.isEngagement(type)) {
    const pinned = await pinSet(meta, type, body.setRef);
    if (pinned.error) return json(400, { error: pinned.error });
    setRef = pinned.setRef;
  }

  const rows = await S.readItems(db, TABLE(), code);
  const position = clampPosition(body.position, rows.length);
  const now = new Date().toISOString();
  const itemId = newItemId();
  const plain = {
    PK: tenant.eventPk(code),
    SK: S.itemSk(itemId),
    Type: type,
    Order: position + 1,
    Minutes: fields.value.minutes,
    Title: fields.value.title,
    Description: fields.value.description,
    State: PLANNED,
    ...(setRef ? { SetRef: setRef } : {}),
    CreatedAt: now,
    UpdatedAt: now,
    ttl: meta.ttl,
  };
  const counted = rules.isCounted(type);
  const delta = { items: counted ? 1 : 0, engagements: rules.isEngagement(type) ? 1 : 0, breaks: counted ? 0 : 1 };
  const tx = [
    { Put: { TableName: TABLE(), Item: await encryptItem(meta.orgId, 'item', plain), ConditionExpression: 'attribute_not_exists(SK)' } },
    { Update: counterUpdate(code, delta, now, type) },
  ];
  if (counted) tx.push({ Update: listCountUpdate(meta.orgId, code, 1) });
  [...rows.slice(0, position), null, ...rows.slice(position)].forEach((row, i) => {
    if (row && Number(row.Order) !== i + 1) tx.push({ Update: orderUpdate(row, i + 1, now) });
  });

  try {
    await db.send(new TransactWriteCommand({ TransactItems: tx }));
  } catch (error) {
    if (!S.isCancelled(error)) throw error;
    // Lost a race. If it was the cap, say the cap's sentence — that is what
    // the other host's add has just made true.
    const fresh = await S.readMeta(db, TABLE(), code);
    if (!fresh) return notFound();
    const capNow = rules.capRefusal(countsOf(fresh), type);
    if (capNow) return json(409, { error: capNow.message, cap: capNow.cap });
    return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });
  }
  return json(201, { item: S.projectItem(plain) });
}

// ── DELETE: remove ──────────────────────────────────────────────────────────
async function removeItem(meta, code, itemId) {
  const row = await readItem(code, itemId);
  if (!row) return notFound();
  if (row.State !== PLANNED) return json(409, { error: NOT_PLANNED, code: 'not_planned' });
  const counted = rules.isCounted(row.Type);
  const delta = { items: counted ? -1 : 0, engagements: rules.isEngagement(row.Type) ? -1 : 0, breaks: counted ? 0 : -1 };
  const now = new Date().toISOString();
  const tx = [
    {
      Delete: {
        TableName: TABLE(),
        Key: { PK: row.PK, SK: row.SK },
        ConditionExpression: 'attribute_exists(SK) AND #st = :planned',
        ExpressionAttributeNames: { '#st': 'State' },
        ExpressionAttributeValues: { ':planned': PLANNED },
      },
    },
    { Update: counterUpdate(code, delta, now, null) },
  ];
  if (counted) tx.push({ Update: listCountUpdate(meta.orgId, code, -1) });
  try {
    await db.send(new TransactWriteCommand({ TransactItems: tx }));
  } catch (error) {
    if (!S.isCancelled(error)) throw error;
    return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });
  }
  return json(200, { removed: itemId });
}

exports.handler = async (request) => {
  trace('event-items', request);
  const params = request.pathParameters || {};
  const code = String(params.code || '');
  const itemId = params.itemId === undefined ? null : String(params.itemId);
  const method = methodOf(request);
  try {
    const meta = await S.openEvent(db, TABLE(), request, code);
    if (!meta) return notFound();
    if (method === 'POST' && itemId === null) return await addItem(request, meta, code);
    if (method === 'DELETE' && itemId !== null) return await removeItem(meta, code, itemId);
    return json(404, { error: 'Endpoint not found' });
  } catch (error) {
    console.error('❌ event-items failed:', error && error.message);
    return json(500, { error: 'Could not change the agenda. Nothing was changed; try again.' });
  }
};
```

- [ ] **Step 4: Add the route**

In `template-clean.yaml`, insert immediately above the line `  StartVoteFunction:`:

```yaml
  EventItemsFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-event-items'
      CodeUri: lambda-functions/websocket/
      Handler: events/items.handler
      Events:
        AddEventItem:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /events/{code}/items
            Method: post
            Auth:
              Authorizer: CognitoAuthorizer
        RemoveEventItem:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /events/{code}/items/{itemId}
            Method: delete
            Auth:
              Authorizer: CognitoAuthorizer
      Policies:
        # Seals and opens item titles and descriptions.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
        - DynamoDBCrudPolicy:
            TableName: !Ref GameTable
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

- [ ] **Step 5: Run it green**

```bash
for t in event-caps event-update event-host-reads event-create kms-grants-match-code template-validates; do node tests/$t.js > /dev/null 2>&1; echo "$t exit=$?"; done
```

Expected: every line `exit=0`; `event-caps.js` reports `26 passed, 0 failed`.

- [ ] **Step 6: Watch the race check bite**

In `addItem`, change `{ Update: counterUpdate(code, delta, now, type) },` to `{ Update: counterUpdate(code, delta, now, null) },` and run `node tests/event-caps.js 2>/dev/null | grep -E "FAIL|passed"`: exactly "the add that loses the race is refused with the cap's sentence" must FAIL. Put it back and run it green again.

- [ ] **Step 7: Run the whole backend loop.** Expected: `fail=0`.

- [ ] **Step 8: Commit**

```bash
git add lambda-functions/websocket/events/items.js template-clean.yaml tests/event-caps.js
git commit -m "A host can add engagements and breaks to an agenda, and the server holds the caps

POST /events/{code}/items adds an engagement pinned to its set's version, or
a break, at a position; DELETE removes one that has not started. 16 items,
8 of them engagements, breaks uncounted: the route answers the builder's own
sentence, and the counters' update inside the item's transaction is
conditioned on the cap, so two hosts adding at once cannot both land the
ninth. An org set is only ever read from the event's own organisation.
Presentations and survey items are refused as coming soon.

Tests: tests/event-caps.js (new; the race is driven with player-table's hold).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Editing and reordering agenda items

`PUT /events/{code}/items/{itemId}` changes an item's title, description and length, and — for an engagement — its pinned version ("Use vN" on the builder's row, never applied silently, RATIONALE §c). `PUT /events/{code}/items` writes the whole agenda's order: each row's `Order` rewritten, keys never. A reorder built on an agenda that has since changed (a missing, extra or repeated id, or a concurrent insert) is refused, never applied.

**Files:**
- Modify: `lambda-functions/websocket/events/items.js` (an import, two functions, two router lines)
- Modify: `template-clean.yaml` (two events on `EventItemsFunction`)
- Create: `tests/event-item-edit.js`

**Interfaces:**
- Consumes: everything Task 7 consumes, plus `decryptItemRow` (Task 5) and `UpdateCommand` (`@aws-sdk/lib-dynamodb`); Task 7's `readItem`, `pinSet`, `orderUpdate`, `PLANNED`, `NOT_PLANNED`.
- Produces (routes):
  - `PUT /events/{code}/items/{itemId}` body — any of `{title, description, minutes, version}`; fields left out keep their values; `version` only for an engagement, and only a version the pinned set has → `200 {item}`; `400 {error}`; `404`; `409 {code: 'not_planned'}`; `409 {code: 'agenda_changed'}`.
  - `PUT /events/{code}/items` body `{order: [itemId, …]}` — the whole agenda, each item once → `200 {order}` (no write when nothing moved); `400` without an `order` array; `409 {code: 'agenda_changed'}` for anything else or a cancelled transaction.

- [ ] **Step 1: Write the failing test**

Create `tests/event-item-edit.js`:

```js
/**
 * EDITING AND REORDERING AGENDA ITEMS —
 * PUT /events/{code}/items/{itemId} and PUT /events/{code}/items
 * (lambda-functions/websocket/events/items.js).
 *
 * Edit: an item's title, description and length, and for an engagement "Use
 * vN" — the pinned version changes only when the host asks (RATIONALE §c).
 * Reorder: the whole agenda's order, each row's `Order` rewritten, keys never.
 *
 * rejects: an edit written in plaintext; a version the set never had; a
 * version asked of a break; an edit to an item that has started; a reorder
 * built on an agenda that has since changed (a missing, extra or repeated
 * id); a reorder that moves the counts; a reorder that loses a concurrent
 * insert; a foreign member reordering.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const { encryptItem, isEnvelope } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
let code;
const call = (method, itemId, body, ctx = asHost(NW)) => items(request({
  method,
  path: itemId ? `/events/${code}/items/${itemId}` : `/events/${code}/items`,
  pathParameters: itemId ? { code, itemId } : { code },
  body,
  requestContext: ctx,
}));
const meta = () => table.get(`EVENT#${code}`, 'METADATA');
const rowOf = (itemId) => table.get(`EVENT#${code}`, `ITEM#${itemId}`);
const orderNow = () => [...table.store.values()]
  .filter((r) => r.PK === `EVENT#${code}` && String(r.SK).startsWith('ITEM#'))
  .sort((a, b) => a.Order - b.Order)
  .map((r) => r.SK.slice('ITEM#'.length));

(async () => {
  table.clear();
  seedOrg(table, NW);
  seedOrg(table, 'org_md');
  table.put(await encryptItem(NW, 'set', {
    PK: `ORG#${NW}#SETS`, SK: 'SET#custq4', name: 'Customer knowledge — Q4', engagementType: 'trivia',
    activeVersion: 3, versions: [{ version: 2 }, { version: 3 }],
  }));
  code = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', startsAt: startsIn(20), timeZone: 'Europe/London' },
  }))).event.code;
  const quiz = bodyOf(await call('POST', null, {
    type: 'trivia', title: 'Quiz', minutes: 15, setRef: { scope: 'org', setId: 'custq4', version: 2 },
  })).item.itemId;
  const brk = bodyOf(await call('POST', null, { type: 'break', minutes: 15 })).item.itemId;
  const talk = bodyOf(await call('POST', null, {
    type: 'trivia', title: 'Second quiz', minutes: 12, setRef: { scope: 'org', setId: 'custq4' },
  })).item.itemId;

  console.log('\n1. editing an item');
  await check('title, description and length change; the words stay sealed', async () => {
    const res = await call('PUT', quiz, { title: 'How well do you know our customers?', description: 'Scored.', minutes: 20 });
    assert.strictEqual(res.statusCode, 200, res.body);
    const { item } = bodyOf(res);
    assert.deepStrictEqual([item.title, item.description, item.minutes], ['How well do you know our customers?', 'Scored.', 20]);
    assert.ok(isEnvelope(rowOf(quiz).Title));
    assert.strictEqual(plainRow(NW, rowOf(quiz)).Description, 'Scored.');
    assert.strictEqual(item.setRef.version, 2, 'an edit moved the pinned version');
  });
  await check('a field left out keeps its value', async () => {
    const res = await call('PUT', quiz, { minutes: 18 });
    assert.strictEqual(bodyOf(res).item.title, 'How well do you know our customers?');
  });
  await check('"Use v3" re-pins the set, and only when asked', async () => {
    const res = await call('PUT', quiz, { version: 3 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(rowOf(quiz).SetRef, { scope: 'org', orgId: NW, setId: 'custq4', version: 3 });
  });
  for (const [label, itemId, body, status, match] of [
    ['a version the set never had', quiz, { version: 7 }, 400, /version/],
    ['a version for a break', brk, { version: 2 }, 400, /Only an engagement/],
    ['an empty title', quiz, { title: '' }, 400, /title/],
    ['an unknown item', 'it_ffffffff', { title: 'x' }, 404, /No event has that code/],
  ]) {
    await check(`${label}: ${status}`, async () => {
      const res = await call('PUT', itemId, body);
      assert.strictEqual(res.statusCode, status, res.body);
      assert.match(bodyOf(res).error, match);
    });
  }
  await check('an item that has started cannot be edited', async () => {
    table.put({ ...rowOf(talk), State: 'done' });
    const res = await call('PUT', talk, { title: 'Too late' });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'not_planned');
    table.put({ ...rowOf(talk), State: 'planned' });
  });

  console.log('\n2. reordering the agenda');
  const counts = () => [meta().ItemCount, meta().EngagementCount, meta().BreakCount];
  const before = counts();
  await check('the whole order is written, and nothing but the order', async () => {
    const res = await call('PUT', null, { order: [talk, quiz, brk] });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(orderNow(), [talk, quiz, brk]);
    assert.deepStrictEqual([rowOf(talk).Order, rowOf(quiz).Order, rowOf(brk).Order], [1, 2, 3]);
    assert.deepStrictEqual(counts(), before, 'a reorder changed the counts');
  });
  await check('the same order again writes nothing', async () => {
    const writes = table.log.length;
    const res = await call('PUT', null, { order: [talk, quiz, brk] });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(!table.log.slice(writes).some((e) => e.type === 'transactWrite'));
  });
  for (const [label, order] of [
    ['one item missing', [talk, quiz]],
    ['an item named twice', [talk, quiz, quiz]],
    ['an item that is not on this agenda', [talk, quiz, 'it_ffffffff']],
  ]) {
    await check(`${label}: 409 and nothing moved`, async () => {
      const res = await call('PUT', null, { order });
      assert.strictEqual(res.statusCode, 409, res.body);
      assert.strictEqual(bodyOf(res).code, 'agenda_changed');
      assert.deepStrictEqual(orderNow(), [talk, quiz, brk]);
    });
  }
  // rejects: a reorder applied over an insert it never saw, which would leave
  // two rows at one place.
  await check('an insert that lands mid-reorder cancels the reorder', async () => {
    const gate = table.hold((c) => c.type === 'transactWrite');
    const slow = call('PUT', null, { order: [brk, quiz, talk] });
    await gate.reached;
    const insert = await call('POST', null, { type: 'break', minutes: 5, position: 0 });
    gate.release();
    const late = await slow;
    assert.strictEqual(insert.statusCode, 201, insert.body);
    assert.strictEqual(late.statusCode, 409, late.body);
    const orders = orderNow().map((id) => rowOf(id).Order);
    assert.deepStrictEqual(orders, [1, 2, 3, 4], 'two rows share a place');
  });
  await check('another organisation\'s member: 404', async () => {
    const res = await call('PUT', null, { order: orderNow().reverse() }, asHost('org_md'));
    assert.strictEqual(res.statusCode, 404, res.body);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/event-item-edit.js 2>&1 | grep -v "^event-items\|^create-event" | tail -6; echo "exit=$?"
```

Expected: FAIL lines ending in `{"error":"Endpoint not found"}` (`404 !== 200`, `404 !== 409`), then `event-item-edit.js: SUITE DID NOT FINISH` — the race check waits for a reorder transaction the route never sends, and the finish guard turns that into exit 1.

- [ ] **Step 3: Import `UpdateCommand`**

In `lambda-functions/websocket/events/items.js`, replace

```js
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
```

with

```js
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
```

- [ ] **Step 4: Add the edit and the reorder**

Insert immediately above `exports.handler = async (request) => {`:

```js
// ── PUT /items/{itemId}: edit ───────────────────────────────────────────────
async function editItem(request, meta, code, itemId) {
  const body = readBody(request);
  if (!body) return json(400, { error: 'The request body is not valid JSON.' });
  const row = await readItem(code, itemId);
  if (!row) return notFound();
  if (row.State !== PLANNED) return json(409, { error: NOT_PLANNED, code: 'not_planned' });

  const current = await S.decryptItemRow(meta.orgId, row);
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const fields = rules.checkItemFields({
    title: has('title') ? body.title : current.Title,
    description: has('description') ? body.description : current.Description,
    minutes: has('minutes') ? body.minutes : current.Minutes,
  }, row.Type);
  if (fields.error) return json(400, { error: fields.error });

  let setRef = row.SetRef || null;
  if (has('version')) {
    if (!rules.isEngagement(row.Type) || !setRef) return json(400, { error: 'Only an engagement plays a version of a set.' });
    const pinned = await pinSet(meta, row.Type, { ...setRef, version: body.version });
    if (pinned.error) return json(400, { error: pinned.error });
    setRef = pinned.setRef;
  }

  const now = new Date().toISOString();
  const sealed = await encryptItem(meta.orgId, 'item', { Title: fields.value.title, Description: fields.value.description });
  const names = { '#t': 'Title', '#d': 'Description', '#m': 'Minutes', '#ua': 'UpdatedAt', '#st': 'State' };
  const values = { ':t': sealed.Title, ':d': sealed.Description, ':m': fields.value.minutes, ':now': now, ':planned': PLANNED };
  let expression = 'SET #t = :t, #d = :d, #m = :m, #ua = :now';
  if (setRef) {
    expression += ', #sr = :sr';
    names['#sr'] = 'SetRef';
    values[':sr'] = setRef;
  }
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE(),
      Key: { PK: row.PK, SK: row.SK },
      UpdateExpression: expression,
      ConditionExpression: 'attribute_exists(SK) AND #st = :planned',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  } catch (error) {
    if (error && error.name === 'ConditionalCheckFailedException') {
      return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });
    }
    throw error;
  }
  return json(200, {
    item: S.projectItem({
      ...row, Title: fields.value.title, Description: fields.value.description, Minutes: fields.value.minutes,
      ...(setRef ? { SetRef: setRef } : {}),
    }),
  });
}

// ── PUT /items: reorder ─────────────────────────────────────────────────────
async function reorderItems(request, code) {
  const body = readBody(request);
  if (!body) return json(400, { error: 'The request body is not valid JSON.' });
  const order = Array.isArray(body.order) ? body.order.map(String) : null;
  if (!order) return json(400, { error: 'Send the whole agenda\'s order: { order: [itemId, …] }.' });

  const rows = await S.readItems(db, TABLE(), code);
  const byId = new Map(rows.map((row) => [S.itemIdOf(row), row]));
  // The whole agenda, each item once — anything else was read from an agenda
  // that has since changed, and applying it would lose or duplicate a place.
  const whole = order.length === rows.length && new Set(order).size === order.length && order.every((id) => byId.has(id));
  if (!whole) return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });

  const now = new Date().toISOString();
  const tx = [];
  order.forEach((id, i) => {
    const row = byId.get(id);
    if (Number(row.Order) !== i + 1) tx.push({ Update: orderUpdate(row, i + 1, now) });
  });
  if (tx.length) {
    try {
      await db.send(new TransactWriteCommand({ TransactItems: tx }));
    } catch (error) {
      if (!S.isCancelled(error)) throw error;
      return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });
    }
  }
  return json(200, { order });
}

```

- [ ] **Step 5: Route the two PUTs**

In `exports.handler`, replace

```js
    if (method === 'DELETE' && itemId !== null) return await removeItem(meta, code, itemId);
```

with

```js
    if (method === 'DELETE' && itemId !== null) return await removeItem(meta, code, itemId);
    if (method === 'PUT' && itemId === null) return await reorderItems(request, code);
    if (method === 'PUT' && itemId !== null) return await editItem(request, meta, code, itemId);
```

- [ ] **Step 6: Add the two routes to the function**

In `template-clean.yaml`, in `EventItemsFunction`, insert immediately above its `      Policies:` line (after the `RemoveEventItem` event):

```yaml
        ReorderEventItems:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /events/{code}/items
            Method: put
            Auth:
              Authorizer: CognitoAuthorizer
        EditEventItem:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /events/{code}/items/{itemId}
            Method: put
            Auth:
              Authorizer: CognitoAuthorizer
```

- [ ] **Step 7: Run it green**

```bash
for t in event-item-edit event-caps kms-grants-match-code template-validates; do node tests/$t.js > /dev/null 2>&1; echo "$t exit=$?"; done
```

Expected: every line `exit=0`; `event-item-edit.js` reports `15 passed, 0 failed`.

- [ ] **Step 8: Run the whole backend loop.** Expected: `fail=0`.

- [ ] **Step 9: Commit**

```bash
git add lambda-functions/websocket/events/items.js template-clean.yaml tests/event-item-edit.js
git commit -m "A host can edit an agenda item, move it to a newer set version, and reorder the agenda

PUT /events/{code}/items/{itemId} changes an item's words and length, and
re-pins an engagement's set version only when asked (Use vN). PUT
/events/{code}/items writes the whole order, each row's Order conditioned on
the number it read, so a reorder built on an agenda that has since changed
- a missing or repeated id, or an insert that landed meanwhile - is refused
and nothing moves. A started item cannot be edited.

Tests: tests/event-item-edit.js (new).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: The two public reads — `GET /events/{code}/agenda` and `GET /join/{code}`

Anyone with the code may read an open event's agenda before the day (decision 11): times, titles, kinds, lengths, descriptions and states — nothing an agenda does not need, and no link into an item until the host starts it. The resolver tells the join box (roadmap M2, `hooks/useJoinCode.js`) whether a code is a session or an event, with the event's title and date and nothing more.

**Files:**
- Create: `lambda-functions/websocket/events/get-agenda.js`
- Create: `lambda-functions/websocket/events/resolve-code.js`
- Modify: `template-clean.yaml` (two functions above `  StartVoteFunction:`)
- Create: `tests/event-public-reads.js`

**Interfaces:**
- Consumes: `readMeta`, `readItems`, `decryptEvent`, `decryptItemRow`, `itemIdOf`, `isCode`, `notFound` (Tasks 4–5); `agendaTimes` (Task 2); `GAMES_RESERVATION_PK`.
- Produces (routes, no authorizer):
  - `GET /events/{code}/agenda` → `200 {event: {code, title, place, startsAt, timeZone, endsAt, state}, items: [{itemId, type, title, description, minutes, at, until, state, gameId?}]}`; `gameId` only for an item whose `State` is `live`, `paused` or `done` and that carries a `GameId` (none in M1; M3 relies on the rule); `404` for an unknown code, a malformed one, and an event whose `Access` is not `open` (PLAN Phase 3).
  - `GET /join/{code}` → `200 {code, kind: 'event', access, title, startsAt, timeZone}` for an event (reservation `Kind: 'event'`); `200 {code, kind: 'session'}` for a session (a reservation without `Kind`, or a `GAME#<code>/METADATA` row whose reservation has lapsed); `404 {error: 'Nothing is running with that code.'}`; `400` unless four digits.

- [ ] **Step 1: Write the failing test**

Create `tests/event-public-reads.js`:

```js
/**
 * THE TWO PUBLIC READS — GET /events/{code}/agenda and GET /join/{code}
 * (lambda-functions/websocket/events/get-agenda.js, resolve-code.js).
 *
 * Anyone with the code may read an open event's agenda before the day
 * (decision 11) — times, titles, kinds, descriptions — and nothing an agenda
 * does not need. The resolver tells the join box whether a code is a session
 * or an event, with the event's title and date and no more.
 *
 * rejects: an agenda that carries a set, an org, a creator or a report
 * setting; a link into an item before the host starts it; times that do not
 * follow the order; an invite-only agenda shown with no passcode; the
 * resolver saying more than kind, access, title and date; a session's code
 * resolved as anything but a session; a lapsed reservation losing a session.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const agenda = h.load('lambda-functions/websocket/events/get-agenda.js').handler;
const resolve = h.load('lambda-functions/websocket/events/resolve-code.js').handler;
const { encryptItem } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const read = (code) => agenda(request({ path: `/events/${code}/agenda`, pathParameters: { code } }));
const join = (code) => resolve(request({ path: `/join/${code}`, pathParameters: { code } }));
const add = (code, body) => items(request({
  method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, body, requestContext: asHost(NW),
}));

(async () => {
  table.clear();
  seedOrg(table, NW);
  table.put(await encryptItem(NW, 'set', {
    PK: `ORG#${NW}#SETS`, SK: 'SET#custq4', name: 'Customer knowledge — Q4', engagementType: 'trivia', activeVersion: 2,
  }));
  const startsAt = `${startsIn(20).slice(0, 10)}T09:00`;
  const { code } = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', place: 'Harbour Room', startsAt, timeZone: 'Europe/London' },
  }))).event;
  await add(code, { type: 'trivia', title: 'How well do you know our customers?', description: 'Ten questions.', minutes: 15, setRef: { scope: 'org', setId: 'custq4' } });
  await add(code, { type: 'break', minutes: 15, description: 'Coffee on the landing.' });
  await add(code, { type: 'trivia', title: 'Warm-up', minutes: 8, setRef: { scope: 'org', setId: 'custq4' }, position: 0 });

  console.log('\n1. the agenda, before the day');
  const res = await read(code);
  const body = bodyOf(res);
  await check('200 for anyone with the code, with the event\'s name, place and times', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(body.event, {
      code, title: 'Q4 Kickoff', place: 'Harbour Room', startsAt, timeZone: 'Europe/London', endsAt: '9:38', state: 'SCHEDULED',
    });
  });
  await check('items in order, timed from the start, with their words', () => {
    assert.deepStrictEqual(body.items.map((i) => [i.at, i.until, i.type, i.title]), [
      ['9:00', '9:08', 'trivia', 'Warm-up'],
      ['9:08', '9:23', 'trivia', 'How well do you know our customers?'],
      ['9:23', '9:38', 'break', 'Break'],
    ]);
    assert.strictEqual(body.items[2].description, 'Coffee on the landing.');
  });
  // rejects: decision 11 — nothing is reachable before the host starts it.
  await check('every item is planned, and none carries a link', () => {
    for (const item of body.items) {
      assert.strictEqual(item.state, 'planned');
      assert.strictEqual(item.gameId, undefined);
    }
  });
  await check('no set, organisation, creator, report setting or count reaches the page', () => {
    assert.deepStrictEqual(Object.keys(body.items[0]).sort(),
      ['at', 'description', 'itemId', 'minutes', 'state', 'title', 'type', 'until']);
    for (const leak of ['custq4', NW, 'u_host', 'setRef', 'SetRef', 'attendeeReports', 'ItemCount', 'orgId']) {
      assert.ok(!res.body.includes(leak), `the agenda leaks ${leak}`);
    }
  });
  await check('an item the host has started links to its session (the rule M3 relies on)', async () => {
    const started = [...table.store.values()].find((r) => r.PK === `EVENT#${code}` && r.Type === 'break');
    table.put({ ...started, State: 'done', GameId: '8816' });
    const again = bodyOf(await read(code));
    assert.strictEqual(again.items[2].gameId, '8816');
    assert.strictEqual(again.items[0].gameId, undefined);
    table.put(started);
  });
  await check('an invite-only event\'s agenda is not public (PLAN Phase 3)', async () => {
    const meta = table.get(`EVENT#${code}`, 'METADATA');
    table.put({ ...meta, Access: 'invite' });
    try {
      assert.strictEqual((await read(code)).statusCode, 404);
    } finally { table.put(meta); }
  });
  await check('an unknown or malformed code: 404', async () => {
    assert.strictEqual((await read('9999')).statusCode, 404);
    assert.strictEqual((await read('abcd')).statusCode, 404);
  });

  console.log('\n2. what a code opens');
  await check('an event: kind, access, title and date — nothing else', async () => {
    const r = await join(code);
    assert.strictEqual(r.statusCode, 200, r.body);
    assert.deepStrictEqual(bodyOf(r), {
      code, kind: 'event', access: 'open', title: 'Q4 Kickoff', startsAt, timeZone: 'Europe/London',
    });
  });
  table.put({ PK: 'GAMES', SK: 'GAME#4821', orgId: NW, ttl: 1 });
  table.put({ PK: 'GAME#4821', SK: 'METADATA', orgId: NW, Title: 'secret session title' });
  table.put({ PK: 'GAME#1190', SK: 'METADATA', orgId: NW });
  await check('a session: kind only', async () => {
    const r = await join('4821');
    assert.deepStrictEqual(bodyOf(r), { code: '4821', kind: 'session' });
  });
  await check('a session whose reservation has lapsed is still a session', async () =>
    assert.deepStrictEqual(bodyOf(await join('1190')), { code: '1190', kind: 'session' }));
  await check('a code that names nothing: 404; a malformed one: 400', async () => {
    assert.strictEqual((await join('7777')).statusCode, 404);
    assert.strictEqual((await join('77a7')).statusCode, 400);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/event-public-reads.js; echo "exit=$?"
```

Expected: `Error: Cannot find module '…/lambda-functions/websocket/events/get-agenda.js'`, exit 1.

- [ ] **Step 3: Write the agenda read**

Create `lambda-functions/websocket/events/get-agenda.js`:

```js
/**
 * GET /events/{code}/agenda — the agenda anyone with the code may read, before
 * the day, during it and after (p-05a, p-05, p-08; RATIONALE decision 11).
 *
 * PUBLIC, and so it says as little as an agenda needs: the event's name,
 * place and schedule, and per item its planned time, title, kind, length,
 * description and state. Never the organisation, the question set, who made
 * it, the report default or the counts. And no LINK into an item — its
 * session's code — until the host has started that item: "nothing is active
 * beforehand" (decision 11). Every item is `planned` in this release, so no
 * link is ever given yet; the rule is here so roadmap M3 cannot forget it.
 *
 * Open events only. An invite-only event's agenda is shown only after a
 * passcode (PLAN Phase 3), which does not exist yet, so one answers 404 like
 * a code that names nothing.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const rules = require('./agenda-rules');
const { json, notFound, trace } = require('./event-http');
const S = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
/** The states in which an attendee may follow an item into its session. */
const LINKED_STATES = Object.freeze(['live', 'paused', 'done']);

exports.handler = async (request) => {
  trace('get-agenda', request);
  const code = String((request.pathParameters || {}).code || '');
  try {
    const meta = await S.readMeta(db, TABLE(), code);
    if (!meta || !meta.orgId || (meta.Access || 'open') !== 'open') return notFound();
    const event = await S.decryptEvent(meta.orgId, meta);
    const rows = [];
    for (const row of await S.readItems(db, TABLE(), code)) rows.push(await S.decryptItemRow(meta.orgId, row));
    const { rows: timed, endsAt } = rules.agendaTimes(meta.StartsAt, rows);
    return json(200, {
      event: {
        code,
        title: event.Title || '',
        place: event.Place || '',
        startsAt: meta.StartsAt || '',
        timeZone: meta.TimeZone || '',
        endsAt,
        state: meta.State || 'SCHEDULED',
      },
      items: timed.map((row) => {
        const state = row.State || 'planned';
        return {
          itemId: S.itemIdOf(row),
          type: row.Type || '',
          title: typeof row.Title === 'string' ? row.Title : '',
          description: typeof row.Description === 'string' ? row.Description : '',
          minutes: Number(row.Minutes) || 0,
          at: row.at,
          until: row.until,
          state,
          ...(LINKED_STATES.includes(state) && row.GameId ? { gameId: String(row.GameId) } : {}),
        };
      }),
    });
  } catch (error) {
    console.error('❌ get-agenda failed:', error && error.message);
    return json(500, { error: 'Could not load the agenda. Try again.' });
  }
};
```

- [ ] **Step 4: Write the resolver**

Create `lambda-functions/websocket/events/resolve-code.js`:

```js
/**
 * GET /join/{code} — what does this code open? (PLAN Phase 1, resolve-code.js)
 *
 * One read of the code's reservation answers it: `Kind: "event"` is an event
 * (websocket/code-reservation.js), anything else a session. The join screen
 * (roadmap M2, hooks/useJoinCode.js) asks this first and routes on `kind`.
 *
 * PUBLIC, AND IT SAYS NOTHING MORE THAN THE CODE ALREADY OPENS:
 *   event    kind, access, and the title and date the join screen shows —
 *            exactly what the event's own public agenda shows anyway;
 *   session  kind only. Whatever a session shows a player is GET /games/{id}'s
 *            to say, as today.
 * Never an organisation, a creator, an item, a set or a count.
 *
 * A session older than its reservation (lapsed, or from before reservations
 * carried `orgId`) is still found by its METADATA row. A code that names
 * nothing is 404; a malformed one 400.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { GAMES_RESERVATION_PK } = require('../tenant');
const { json, trace } = require('./event-http');
const S = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
const NOTHING = () => json(404, { error: 'Nothing is running with that code.' });

exports.handler = async (request) => {
  trace('resolve-code', request);
  const code = String((request.pathParameters || {}).code || '').trim();
  if (!S.isCode(code)) return json(400, { error: 'A join code is four digits.' });
  try {
    const res = await db.send(new GetCommand({
      TableName: TABLE(),
      Key: { PK: GAMES_RESERVATION_PK, SK: `GAME#${code}` },
    }));
    const reservation = res && res.Item;
    if (reservation && reservation.Kind === 'event') {
      const meta = await S.readMeta(db, TABLE(), code);
      if (!meta || !meta.orgId) return NOTHING();
      const event = await S.decryptEvent(meta.orgId, { Title: meta.Title });
      return json(200, {
        code,
        kind: 'event',
        access: meta.Access || 'open',
        title: event.Title || '',
        startsAt: meta.StartsAt || '',
        timeZone: meta.TimeZone || '',
      });
    }
    if (reservation) return json(200, { code, kind: 'session' });
    const session = await db.send(new GetCommand({
      TableName: TABLE(),
      Key: { PK: `GAME#${code}`, SK: 'METADATA' },
    }));
    if (session && session.Item) return json(200, { code, kind: 'session' });
    return NOTHING();
  } catch (error) {
    console.error('❌ resolve-code failed:', error && error.message);
    return json(500, { error: 'Could not look that code up. Try again.' });
  }
};
```

- [ ] **Step 5: Add the two public routes**

In `template-clean.yaml`, insert immediately above the line `  StartVoteFunction:`:

```yaml
  EventAgendaFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-event-agenda'
      CodeUri: lambda-functions/websocket/
      Handler: events/get-agenda.handler
      Events:
        GetEventAgenda:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /events/{code}/agenda
            Method: get
            # PUBLIC: an attendee has no account. The handler shows an open
            # event's agenda and nothing an agenda does not need.
      Policies:
        # Opens the event's and its items' words for the public agenda.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
        - DynamoDBReadPolicy:
            TableName: !Ref GameTable
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

and, after it:

```yaml
  ResolveJoinCodeFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-resolve-join-code'
      CodeUri: lambda-functions/websocket/
      Handler: events/resolve-code.handler
      Events:
        ResolveJoinCode:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /join/{code}
            Method: get
            # PUBLIC: the join box asks it before anybody has an identity.
      Policies:
        # Opens an event's title for the join screen.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
        - DynamoDBReadPolicy:
            TableName: !Ref GameTable
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

- [ ] **Step 6: Run it green**

```bash
for t in event-public-reads kms-grants-match-code template-validates cors-allows-sent-headers; do node tests/$t.js > /dev/null 2>&1; echo "$t exit=$?"; done
```

Expected: every line `exit=0`; `event-public-reads.js` reports `11 passed, 0 failed`.

- [ ] **Step 7: Run the whole backend loop.** Expected: `fail=0`.

- [ ] **Step 8: Commit**

```bash
git add lambda-functions/websocket/events/get-agenda.js lambda-functions/websocket/events/resolve-code.js template-clean.yaml tests/event-public-reads.js
git commit -m "Anyone with an event's code can read its agenda, and a code says whether it is a session or an event

GET /events/{code}/agenda is public for an open event: planned times from the
start, titles, kinds, lengths and descriptions, and no link into an item
until the host starts it (decision 11). No set, organisation, creator or
setting reaches it. GET /join/{code} answers kind, access, title and date for
an event and kind alone for a session - including one whose reservation has
lapsed - for the join box M2 builds.

Tests: tests/event-public-reads.js (new).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Every event route is closed the same way — the template, the authorizer and the handlers together

Tasks 4–9 each proved their own route. This task proves the set as a whole, the way the repo's other route suites do (`tests/get-report-authorization.js`): each host route carries the authorizer in the template AND is named hosts|admins by `requiredGroupsForRoute` (by template and by a concrete path, including item ids that spell `join`, `vote` or `answer`) AND answers another organisation's member, a caller in no group, Engage staff who are not members, and a malformed code with exactly the 404 an unknown code gets. The public routes carry no authorizer. The code under test already exists, so the test is proven by breaking the code and watching it fail.

**Files:**
- Create: `tests/event-routes-authorization.js`

**Interfaces:**
- Consumes: every handler from Tasks 4–9; `routesFromTemplate`, `findRoute`, `assertScannerWorks` (`tests/helpers/template-routes.js`); `requiredGroupsForRoute`, `hasPermission` (`lambda-functions/auth/authorizer.js`); the harness (Task 3).
- Produces: nothing new in the product.

- [ ] **Step 1: Write the test**

Create `tests/event-routes-authorization.js`:

```js
/**
 * EVERY EVENT ROUTE IS CLOSED THE SAME WAY — the template, the authorizer and
 * the handlers, together (roadmap M1; tenancy rule: "another org's caller
 * gets 404 on every host route").
 *
 * Three halves, like every closed route in this repo (tests/helpers/
 * template-routes.js explains why either alone is a false fix):
 *   - template-clean.yaml attaches CognitoAuthorizer to each host route, and
 *     to neither public one;
 *   - auth/authorizer.js answers hosts|admins for each host route, by template
 *     and by a concrete path — including ids that spell "join", "vote" or
 *     "answer", which the generic rule would otherwise wave through;
 *   - each handler answers another organisation's member, a caller in no
 *     group and a malformed code with the SAME 404 an unknown code gets.
 *
 * rejects: a host route left public in the template; a pending account let in
 * by the generic `includes('join')` rule; a public route that grew an
 * authorizer (an attendee has no account); a foreign member told anything
 * but "no such event".
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const path = require('path');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');
const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');

const h = installEventHarness();
const { table } = h;
const load = (file) => h.load(path.join('lambda-functions/websocket/events', file)).handler;
const create = load('create-event.js');
const HANDLERS = {
  'GET /events/{code}': load('get-event.js'),
  'PUT /events/{code}': load('update-event.js'),
  'POST /events/{code}/items': load('items.js'),
  'PUT /events/{code}/items': load('items.js'),
  'PUT /events/{code}/items/{itemId}': load('items.js'),
  'DELETE /events/{code}/items/{itemId}': load('items.js'),
};
const { requiredGroupsForRoute, hasPermission } = h.load('lambda-functions/auth/authorizer.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const HOST_ROUTES = [
  ['POST', '/events'], ['GET', '/events'],
  ['GET', '/events/{code}'], ['PUT', '/events/{code}'],
  ['POST', '/events/{code}/items'], ['PUT', '/events/{code}/items'],
  ['PUT', '/events/{code}/items/{itemId}'], ['DELETE', '/events/{code}/items/{itemId}'],
];
const PUBLIC_ROUTES = [['GET', '/events/{code}/agenda'], ['GET', '/join/{code}']];

(async () => {
  console.log('\n1. the template');
  const routes = routesFromTemplate();
  await check('the scanner parses routes and sees Auth', () => assertScannerWorks(routes));
  for (const [method, p] of HOST_ROUTES) {
    await check(`${method} ${p} carries CognitoAuthorizer`, () => {
      const route = findRoute(routes, method, p);
      assert.ok(route, 'the route is not in the template');
      assert.strictEqual(route.authorizer, 'CognitoAuthorizer');
    });
  }
  for (const [method, p] of PUBLIC_ROUTES) {
    await check(`${method} ${p} is public`, () => {
      const route = findRoute(routes, method, p);
      assert.ok(route, 'the route is not in the template');
      assert.strictEqual(route.authorizer, null);
    });
  }

  console.log('\n2. the authorizer demands a host');
  const concrete = ['events', 'events/{code}', 'events/5307', 'events/{code}/items', 'events/5307/items',
    'events/{code}/items/{itemId}', 'events/5307/items/it_0a1b2c3d',
    // An id that spells a word the generic public rule matches with includes().
    'events/5307/items/join', 'events/5307/items/vote', 'events/5307/items/answer'];
  for (const p of concrete) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      await check(`${method} ${p} requires hosts or admins, and refuses a pending account`, () => {
        assert.deepStrictEqual(requiredGroupsForRoute(method, p), ['hosts', 'admins']);
        assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute(method, p)), false);
      });
    }
  }

  console.log('\n3. the handlers answer one 404');
  table.clear();
  seedOrg(table, 'org_nw');
  seedOrg(table, 'org_md');
  const { code } = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost('org_nw'),
    body: { title: 'Q4 Kickoff', startsAt: startsIn(20), timeZone: 'Europe/London' },
  }))).event;
  const itemId = 'it_0a1b2c3d';
  const callAs = (key, ctx, c = code) => {
    const [method, route] = key.split(' ');
    return HANDLERS[key](request({
      method,
      path: route.replace('{code}', c).replace('{itemId}', itemId),
      pathParameters: route.includes('{itemId}') ? { code: c, itemId } : { code: c },
      body: { title: 'x', type: 'break', minutes: 5, order: [] },
      requestContext: ctx,
    }));
  };
  for (const key of Object.keys(HANDLERS)) {
    const unknown = bodyOf(await callAs(key, asHost('org_nw'), '9999'));
    for (const [label, ctx, c] of [
      ['another organisation\'s member', asHost('org_md'), code],
      ['a signed-in account in no group', { authorizer: { lambda: { userId: 'u', orgId: 'org_nw', orgIds: 'org_nw' } } }, code],
      ['Engage staff who are not members', asHost('', { groups: 'admins,hosts', orgIds: '' }), code],
      ['a malformed code', asHost('org_nw'), '53a7'],
    ]) {
      await check(`${key} — ${label}: the unknown code's 404`, async () => {
        const res = await callAs(key, ctx, c);
        assert.strictEqual(res.statusCode, 404, res.body);
        assert.deepStrictEqual(bodyOf(res), unknown);
      });
    }
  }
  await check('and nothing any of them sent was written', () => {
    const rows = [...table.store.values()].filter((r) => r.PK === `EVENT#${code}`);
    assert.deepStrictEqual(rows.map((r) => r.SK), ['METADATA']);
    assert.strictEqual(table.get(`EVENT#${code}`, 'METADATA').ItemCount, 0);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run it**

```bash
node tests/event-routes-authorization.js 2>/dev/null | tail -1; echo "exit=$?"
```

Expected: `76 passed, 0 failed`, exit 0.

- [ ] **Step 3: Break the authorizer and watch it fail**

In `lambda-functions/auth/authorizer.js`, change `if (EVENT_HOST_ROUTE.test(path)) {` to `if (false && EVENT_HOST_ROUTE.test(path)) {`. Run `node tests/event-routes-authorization.js 2>/dev/null | tail -1`: expected `64 passed, 12 failed` — the `join`, `vote` and `answer` item ids fall to the generic public rule. Put the line back.

- [ ] **Step 4: Break the handlers' door and watch it fail**

In `lambda-functions/websocket/events/event-store.js` `openEvent`, change `return callerMayManageEvent(request, meta) ? meta : null;` to `return meta;`. Run it again: expected `63 passed, 13 failed` — every foreign caller is served, and the last check finds rows written. Put the line back and run it green.

- [ ] **Step 5: Run the whole backend loop.** Expected: `fail=0`.

- [ ] **Step 6: Commit**

```bash
git add tests/event-routes-authorization.js
git commit -m "Every event route is proven closed: the template, the authorizer and the handlers, together

Each host route carries CognitoAuthorizer, is named hosts|admins by the
authorizer (item ids spelling join, vote or answer included), and answers
another organisation's member, a caller in no group, staff who are not
members and a malformed code with the unknown code's 404, writing nothing.
The agenda and the code resolver stay public.

Tests: tests/event-routes-authorization.js (new; watched failing against a
disabled EVENT_HOST_ROUTE and an open openEvent).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: The console's calls to the event routes

One small module holds every URL the event screens use, each call through `authFetch` (the routes sit behind the authorizer; `authFetch` carries the token and the active organisation). A refusal throws an error that keeps the server's own sentence, status and body, so the builder can show "This event has 8 engagements, the most one can hold" exactly as the server said it and tell a cap (`cap`) from a changed agenda (`code: 'agenda_changed'`).

**Files:**
- Create: `src/src/utils/eventsApi.js`
- Create: `src/src/__tests__/eventsApi.test.js`

**Interfaces:**
- Consumes: `authFetch` (`src/src/auth/authFetch.js`), `adminApiUrl` (`src/src/utils/adminApi.js`); the routes of Tasks 4–8.
- Produces: `class EventsApiError extends Error {status, body}`; `listEvents() → Promise<event[]>`; `getEvent(code) → Promise<{event, items}>`; `createEvent(fields) → Promise<event>`; `updateEvent(code, fields) → Promise<event>`; `addItem(code, item) → Promise<{item}>`; `updateItem(code, itemId, fields) → Promise<{item}>`; `removeItem(code, itemId) → Promise<{removed}>`; `reorderItems(code, order) → Promise<{order}>`.

- [ ] **Step 1: Write the failing test**

Create `src/src/__tests__/eventsApi.test.js`:

```js
/**
 * utils/eventsApi.js — the console's calls to the event routes.
 *
 * rejects: a call that bypasses authFetch (the routes sit behind the
 * authorizer); a wrong method or path; a refusal that loses the server's
 * sentence or its body (the builder shows the cap's sentence as the server
 * said it, and tells a cap from a changed agenda by the body).
 */
import {
  EventsApiError, listEvents, getEvent, createEvent, updateEvent,
  addItem, updateItem, removeItem, reorderItems,
} from '../utils/eventsApi';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

const answer = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

beforeEach(() => { authFetch.mockReset(); window.API_BASE = 'https://api.test/dev/'; });

describe('each call goes where the route is, through authFetch', () => {
  it.each([
    ['listEvents', () => listEvents(), 'GET', 'events', undefined, { events: [] }],
    ['getEvent', () => getEvent('5307'), 'GET', 'events/5307', undefined, { event: {}, items: [] }],
    ['createEvent', () => createEvent({ title: 'Q4' }), 'POST', 'events', { title: 'Q4' }, { event: { code: '5307' } }],
    ['updateEvent', () => updateEvent('5307', { title: 'Q5' }), 'PUT', 'events/5307', { title: 'Q5' }, { event: {} }],
    ['addItem', () => addItem('5307', { type: 'break', minutes: 5 }), 'POST', 'events/5307/items', { type: 'break', minutes: 5 }, { item: {} }],
    ['updateItem', () => updateItem('5307', 'it_0a1b2c3d', { version: 3 }), 'PUT', 'events/5307/items/it_0a1b2c3d', { version: 3 }, { item: {} }],
    ['removeItem', () => removeItem('5307', 'it_0a1b2c3d'), 'DELETE', 'events/5307/items/it_0a1b2c3d', undefined, { removed: 'it_0a1b2c3d' }],
    ['reorderItems', () => reorderItems('5307', ['a', 'b']), 'PUT', 'events/5307/items', { order: ['a', 'b'] }, { order: ['a', 'b'] }],
  ])('%s', async (_name, run, method, path, body, reply) => {
    authFetch.mockImplementation(() => answer(reply));
    await run();
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe(`https://api.test/dev/${path}`);
    expect(init.method).toBe(method);
    if (body === undefined) expect(init.body).toBeUndefined();
    else expect(JSON.parse(init.body)).toEqual(body);
  });
});

describe('what comes back', () => {
  it('listEvents gives the list, and an empty one when the body has none', async () => {
    authFetch.mockImplementation(() => answer({ events: [{ code: '5307' }] }));
    await expect(listEvents()).resolves.toEqual([{ code: '5307' }]);
    authFetch.mockImplementation(() => answer({}));
    await expect(listEvents()).resolves.toEqual([]);
  });
  it('createEvent gives the event', async () => {
    authFetch.mockImplementation(() => answer({ event: { code: '5307', title: 'Q4' } }, 201));
    await expect(createEvent({})).resolves.toEqual({ code: '5307', title: 'Q4' });
  });
  it('a refusal throws with the server\'s sentence, status and body', async () => {
    authFetch.mockImplementation(() => answer({ error: 'This event has 8 engagements, the most one can hold. Remove one to add another.', cap: 'engagements' }, 409));
    const err = await addItem('5307', {}).catch((e) => e);
    expect(err).toBeInstanceOf(EventsApiError);
    expect(err.message).toMatch(/8 engagements/);
    expect(err.status).toBe(409);
    expect(err.body.cap).toBe('engagements');
  });
  it('a refusal with no body still says something', async () => {
    authFetch.mockImplementation(() => Promise.resolve({ ok: false, status: 500, json: async () => { throw new Error('no json'); } }));
    await expect(getEvent('5307')).rejects.toThrow('HTTP 500');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd src && npm test -- eventsApi 2>&1 | tail -8
```

Expected: `Cannot find module '../utils/eventsApi' from 'src/__tests__/eventsApi.test.js'`; `Test Suites: 1 failed`.

- [ ] **Step 3: Write the module**

Create `src/src/utils/eventsApi.js`:

```js
/**
 * THE CONSOLE'S CALLS TO THE EVENT ROUTES (lambda-functions/websocket/events/).
 *
 * One small module so the screens hold no URLs: EventsPanel, EventBuilder,
 * EventDetailsDialog and EventItemDialog import these and nothing else.
 * Every call goes through `authFetch`, which carries the Cognito token and the
 * active organisation (X-Engage-Org) — the event routes sit behind the
 * authorizer and a bare `fetch` would be refused.
 *
 * A refusal throws EventsApiError carrying the server's own sentence (`error`),
 * its status and its body, so a screen can show "This event has 8 engagements,
 * the most one can hold" exactly as the server said it, and tell a cap (409
 * with `cap`) from a changed agenda (409 with `code: 'agenda_changed'`).
 */
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from './adminApi';

export class EventsApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'EventsApiError';
    this.status = status;
    this.body = body || {};
  }
}

async function call(path, { method = 'GET', body } = {}) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await authFetch(adminApiUrl(path), init);
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) throw new EventsApiError(parsed.error || `HTTP ${res.status}`, res.status, parsed);
  return parsed;
}

const enc = encodeURIComponent;

/** The acting organisation's events, soonest first. */
export async function listEvents() {
  const body = await call('events');
  return Array.isArray(body.events) ? body.events : [];
}

/** `{ event, items }` — one event and its agenda, in order. */
export const getEvent = (code) => call(`events/${enc(code)}`);

export async function createEvent(fields) {
  return (await call('events', { method: 'POST', body: fields })).event;
}

export async function updateEvent(code, fields) {
  return (await call(`events/${enc(code)}`, { method: 'PUT', body: fields })).event;
}

/** `{ item }`. `item` is `{ type, title, description, minutes, position, setRef? }`. */
export const addItem = (code, item) => call(`events/${enc(code)}/items`, { method: 'POST', body: item });

/** `{ item }`. `fields` may carry `version` — "Use vN". */
export const updateItem = (code, itemId, fields) =>
  call(`events/${enc(code)}/items/${enc(itemId)}`, { method: 'PUT', body: fields });

export const removeItem = (code, itemId) =>
  call(`events/${enc(code)}/items/${enc(itemId)}`, { method: 'DELETE' });

/** The whole agenda's order, every item once. */
export const reorderItems = (code, order) =>
  call(`events/${enc(code)}/items`, { method: 'PUT', body: { order } });
```

- [ ] **Step 4: Run it green**

```bash
cd src && npm test -- eventsApi 2>&1 | tail -5
```

Expected: `Tests: 12 passed, 12 total`.

- [ ] **Step 5: Commit**

```bash
git add src/src/utils/eventsApi.js src/src/__tests__/eventsApi.test.js
git commit -m "The console has one module for the event routes, and a refusal keeps the server's own words

utils/eventsApi.js calls GET/POST/PUT /events, GET /events/{code} and the
item routes through authFetch, and throws EventsApiError carrying the
server's sentence, status and body, so the builder can show a cap's sentence
verbatim and tell a cap from a changed agenda.

Tests: src/src/__tests__/eventsApi.test.js (new).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: The Events place — the list, the Personal-space page and the new-event dialog

Built from 01-events, 01b-events-personal and 05-new-event (open them on :8124 before you start). A Team-plan organisation sees its events as a table with a search and an Upcoming/Past filter; a space on any other plan sees one honest page — what an event is, and the one way in — instead of a greyed-out builder. "New event" opens the dialog: name, date, start, zone, place, who can join (invite-only shown, disabled, "Coming soon"), the report default, and the rule that an event counts as one session. Both surfaces are mountable components; AdminPage wires them in Task 15.

**Files:**
- Create: `src/src/components/EventsPanel.jsx`
- Create: `src/src/components/EventDetailsDialog.jsx`
- Create: `src/src/components/EventsPanel.css`
- Create: `src/src/__tests__/eventsPanel.test.jsx`
- Create: `src/src/__tests__/eventsPanelPalette.test.js`
- Modify: `src/src/__tests__/modalReachability.test.js` (`STAGE2_SCRIMS`, ~46–52)

**Interfaces:**
- Consumes: `listEvents`, `createEvent`, `updateEvent` (Task 11); `checkEventFields`, `formatEventWhen`, `TITLE_MAX`, `PLACE_MAX`, `MAX_ITEMS`, `MAX_ENGAGEMENTS` from `lambda-functions/websocket/events/agenda-rules` (imported as `import rules from '../../../lambda-functions/websocket/events/agenda-rules'`, as `PlanRequestDialog.jsx` imports `game/pricing`); `Modal` (with `theme="dark"`), `Icon`.
- Produces:
  - `EventsPanel` (default) props `{teamPlan, creating, onCreatingChange(open), onOpen(code, title), onRequestPlan?, onShowPlan?}`; named `NewEventButton({onClick})`, `todayIso(now?) → 'YYYY-MM-DD'`, `isUpcoming(event, today) → boolean`.
  - `EventDetailsDialog` (default) props `{initial?: event, onClose, onSaved(event)}` — create without `initial.code`, edit with it (Task 14 opens it from the builder); named `browserZone()`, `zoneOptions(first) → string[]`.
  - Scope class `.evts`; scrim `.evts-scrim`, card `.evts-modal`; test ids `event-row`, `events-empty`, `events-nomatch`, `events-team-only`.

- [ ] **Step 1: Write the failing behaviour test**

Create `src/src/__tests__/eventsPanel.test.jsx`:

```jsx
/**
 * THE EVENTS PLACE, RENDERED — components/EventsPanel.jsx and
 * EventDetailsDialog.jsx (docs/design/agenda-redesign/01, 01b, 05).
 *
 * rejects: a Personal space shown a builder, or asking the server for events
 * it cannot have; Past as a second page instead of a filter; one empty state
 * for "nothing exists" and "nothing matches"; a failed load dressed as an
 * empty list; a dialog with one exit, or one that drops typed words without
 * asking; invite-only offered as if it worked; a refusal that closes the
 * dialog and loses what was typed.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EventsPanel, { NewEventButton, isUpcoming, todayIso } from '../components/EventsPanel';
import { zoneOptions } from '../components/EventDetailsDialog';

jest.mock('../utils/eventsApi', () => ({
  listEvents: jest.fn(),
  createEvent: jest.fn(),
  updateEvent: jest.fn(),
}));
const api = require('../utils/eventsApi');

const DAY = 86400000;
const dayFromNow = (n) => todayIso(new Date(Date.now() + n * DAY));
const EVENTS = [
  { code: '5307', title: 'Q4 Kickoff', place: 'Harbour Room, 4th floor', startsAt: `${dayFromNow(10)}T09:00`, timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 8 },
  { code: '6120', title: 'Sales onboarding, cohort 7', place: 'Online', startsAt: `${dayFromNow(15)}T13:30`, timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 0 },
  { code: '2289', title: 'Partner day', place: 'Riverside Hall', startsAt: `${dayFromNow(-20)}T10:00`, timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 11 },
];
const props = (over = {}) => ({
  teamPlan: true, creating: false, onCreatingChange: jest.fn(), onOpen: jest.fn(),
  onRequestPlan: jest.fn(), onShowPlan: jest.fn(), ...over,
});
const rows = () => screen.queryAllByTestId('event-row');

beforeEach(() => {
  jest.clearAllMocks();
  api.listEvents.mockResolvedValue(EVENTS);
  window.confirm = jest.fn(() => false);
});

describe('a Team-plan organisation (01)', () => {
  it('lists upcoming events with their facts, and calls an empty agenda a Draft', async () => {
    render(<EventsPanel {...props()} />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0]).toHaveTextContent('Q4 Kickoff');
    expect(rows()[0]).toHaveTextContent('Harbour Room, 4th floor');
    expect(rows()[0]).toHaveTextContent('5307');
    expect(rows()[0]).toHaveTextContent('Anyone with the code');
    expect(rows()[0]).toHaveTextContent('Scheduled');
    expect(rows()[1]).toHaveTextContent('Draft');
    expect(screen.getByRole('button', { name: /upcoming 2/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Past is a filter, not a second page', async () => {
    render(<EventsPanel {...props()} />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /past 1/i }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Partner day');
  });

  it('a search that matches nothing says so, with the way back', async () => {
    render(<EventsPanel {...props()} />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'zzz' } });
    expect(screen.getByTestId('events-nomatch')).toHaveTextContent('No upcoming event matches “zzz”.');
    fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(rows()).toHaveLength(2);
  });

  it('opening an event hands its code and title up, from the name or from Open', async () => {
    const p = props();
    render(<EventsPanel {...p} />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Q4 Kickoff' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Sales onboarding, cohort 7' }));
    expect(p.onOpen.mock.calls).toEqual([['5307', 'Q4 Kickoff'], ['6120', 'Sales onboarding, cohort 7']]);
  });

  it('nothing made yet: one sentence and the way to make one', async () => {
    api.listEvents.mockResolvedValue([]);
    const p = props();
    render(<EventsPanel {...p} />);
    await waitFor(() => expect(screen.getByTestId('events-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('events-nomatch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /new event/i }));
    expect(p.onCreatingChange).toHaveBeenCalledWith(true);
  });

  it('a failed load says so, and is not the empty state', async () => {
    api.listEvents.mockRejectedValue(new Error('Could not load events. Try again.'));
    render(<EventsPanel {...props()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load events'));
    expect(screen.queryByTestId('events-empty')).toBeNull();
  });
});

describe('a space not on the Team plan (01b)', () => {
  it('explains the Team plan and never asks for events', () => {
    const p = props({ teamPlan: false });
    render(<EventsPanel {...p} />);
    expect(screen.getByTestId('events-team-only')).toHaveTextContent('Events are part of the Team plan');
    expect(api.listEvents).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Request the Team plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'What the Team plan adds' }));
    expect(p.onRequestPlan).toHaveBeenCalled();
    expect(p.onShowPlan).toHaveBeenCalled();
  });

  it('offers the request only to someone who may make it', () => {
    render(<EventsPanel {...props({ teamPlan: false, onRequestPlan: undefined })} />);
    expect(screen.queryByRole('button', { name: 'Request the Team plan' })).toBeNull();
    expect(screen.getByTestId('events-team-only')).toHaveTextContent('Only an owner of this organisation can request the Team plan.');
  });
});

describe('New event (05)', () => {
  const openDialog = async (over = {}) => {
    const p = props({ creating: true, ...over });
    render(<EventsPanel {...p} />);
    await screen.findByRole('dialog');
    return p;
  };

  it('both exits close a clean dialog, and ask before dropping typed words', async () => {
    const p = await openDialog();
    const exits = screen.getAllByRole('button', { name: 'Close' });
    expect(exits).toHaveLength(2);
    exits.forEach((b) => fireEvent.click(b));
    expect(p.onCreatingChange.mock.calls).toEqual([[false], [false]]);
    expect(window.confirm).not.toHaveBeenCalled();
    p.onCreatingChange.mockClear();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Q4 Kickoff' } });
    exits.forEach((b) => fireEvent.click(b));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(p.onCreatingChange).not.toHaveBeenCalled();
  });

  it('creates an open event from the date, the start and the zone', async () => {
    api.createEvent.mockResolvedValue({ code: '5307', title: 'Q4 Kickoff' });
    const p = await openDialog();
    const date = dayFromNow(30);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Q4 Kickoff' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: date } });
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/London' } });
    fireEvent.change(screen.getByLabelText(/^Place/), { target: { value: 'Harbour Room' } });
    fireEvent.click(screen.getByLabelText(/Anonymous/));
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(p.onOpen).toHaveBeenCalledWith('5307', 'Q4 Kickoff'));
    expect(api.createEvent).toHaveBeenCalledWith({
      title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: `${date}T09:30`,
      timeZone: 'Europe/London', access: 'open', attendeeReports: 'anonymous',
    });
    expect(p.onCreatingChange).toHaveBeenCalledWith(false);
  });

  it('says what is missing before sending anything', async () => {
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the event a name.');
    expect(api.createEvent).not.toHaveBeenCalled();
  });

  it('invite-only is shown, disabled, and says it is coming', async () => {
    await openDialog();
    const invite = screen.getByLabelText(/Only people you invite/);
    expect(invite).toBeDisabled();
    expect(screen.getByText(/Coming soon\. Each person will get their own passcode/)).toBeInTheDocument();
  });

  it('a refusal keeps the dialog open with the server\'s sentence and what was typed', async () => {
    api.createEvent.mockRejectedValue(new Error('Events are part of the Team plan, and this space is on the Personal plan.'));
    const p = await openDialog();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Q4 Kickoff' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: dayFromNow(30) } });
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/London' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Events are part of the Team plan');
    expect(screen.getByLabelText('Name')).toHaveValue('Q4 Kickoff');
    expect(p.onOpen).not.toHaveBeenCalled();
  });
});

describe('the pieces', () => {
  it('NewEventButton is a named button inside the events scope', () => {
    const onClick = jest.fn();
    const { container } = render(<NewEventButton onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /new event/i }));
    expect(onClick).toHaveBeenCalled();
    expect(container.querySelector('.evts .evts-btn--primary')).not.toBeNull();
  });
  it('upcoming means today or later, by the event\'s own date', () => {
    expect(isUpcoming({ startsAt: '2026-10-09T09:00' }, '2026-10-09')).toBe(true);
    expect(isUpcoming({ startsAt: '2026-10-08T23:00' }, '2026-10-09')).toBe(false);
  });
  it('the zone list starts with the one given and always has UTC', () => {
    const zones = zoneOptions('Europe/London');
    expect(zones[0]).toBe('Europe/London');
    expect(zones).toContain('UTC');
    expect(new Set(zones).size).toBe(zones.length);
  });
});
```

- [ ] **Step 2: Write the failing palette test**

Create `src/src/__tests__/eventsPanelPalette.test.js`:

```js
/**
 * THE EVENTS PLACE'S CSS CONTRACT — components/EventsPanel.css.
 *
 * jest maps CSS to identity-obj-proxy and jsdom resolves no custom property,
 * so the contract is pinned by reading the stylesheet AS TEXT and doing the
 * arithmetic (.claude/skills/engage-design/references/testing-a-surface.md).
 * Tokens are READ from styles.css, never retyped: change one and these
 * numbers move. `bgOf` is the audit's own compositing walk
 * (docs/design/admin-redesign/audit.html).
 *
 * Named `*Palette`, never `*Token*`: `.gitignore:35` is an unanchored
 * `*token*`, and a file named for tokens never reaches CI.
 *
 * WHAT GREEN MEANS: the arithmetic holds and the rules jsdom cannot see have
 * not been reverted. It cannot prove the screen reads well on a real panel.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'EventsPanel.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
function bgOf(el, win) {
  let node = el; const stack = [];
  while (node && node.nodeType === 1) {
    const c = win.getComputedStyle(node).backgroundColor;
    const m = String(c).match(/[\d.]+/g);
    if (m) {
      const a = m.length > 3 ? parseFloat(m[3]) : 1;
      if (a > 0) { stack.push([m.slice(0, 3).map(Number), a]); if (a >= 0.999) break; }
    }
    node = node.parentElement;
  }
  if (!stack.length) return [15, 26, 46];
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
function tint(name) {
  const m = MY_CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in EventsPanel.css`);
  return m[1];
}
function composited(layers) {
  document.body.innerHTML = '';
  let host = document.body;
  for (const background of layers) {
    const el = document.createElement('div');
    el.style.backgroundColor = background;
    host.appendChild(el);
    host = el;
  }
  return bgOf(host, window);
}
const on = (fgHex, layers) => ratio(parseHex(fgHex), composited(layers));

const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const T = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
  dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
  onAccent: token(MY_CSS, '.evts {', '--evts-on-accent'),
};
const AA = 4.5;
const FIELD = [T.bg];
const PANEL = [T.bg, T.surface];

describe('the flat pairings this place paints', () => {
  test.each([
    ['names, dates and codes on the work field', T.text, FIELD],
    ['places, column heads and counts on the work field', T.muted, FIELD],
    ['dialog copy on the dialog surface', T.text, PANEL],
    ['dialog hints on the dialog surface', T.muted, PANEL],
    ['a name hovered amber on the field', T.primary, FIELD],
    ['the ink on a filled amber button', T.onAccent, [T.primary]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the tinted composites', () => {
  test('a selected option in the dialog (amber tint on the surface, over --bg)', () => {
    // .evts-opt paints --bg itself, so the walk stops there: [bg, surface, bg, tint].
    expect(on(T.text, [T.bg, T.surface, T.bg, tint('--evts-row-sel')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, T.surface, T.bg, tint('--evts-row-sel')])).toBeGreaterThanOrEqual(AA);
  });
  test('the pressed filter and a hovered row, on the field', () => {
    expect(on(T.text, [T.bg, tint('--evts-row-sel')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, tint('--evts-row-hover')])).toBeGreaterThanOrEqual(AA);
  });
  test('the note in the dialog, and an error on its tint', () => {
    expect(on(T.muted, [T.bg, T.surface, tint('--evts-tint-note')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.dangerText, [T.bg, T.surface, tint('--evts-tint-danger')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.dangerText, [T.bg, tint('--evts-tint-danger')])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the contract', () => {
  test('the ladder, the 12px floor and the 48px two-line rows', () => {
    for (const [step, px] of [['floor', 12], ['label', 13], ['body', 15], ['head', 19]]) {
      expect(MY_CSS).toMatch(new RegExp(`--evts-t-${step}:\\s*${px}px`));
    }
    expect(MY_CSS).toMatch(/--evts-row-h:\s*48px/);
    const sizes = [...stripped(MY_CSS).matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    sizes.forEach((n) => expect(n).toBeGreaterThanOrEqual(12));
  });
  test('every selector is rooted at .evts, and styles.css declares nothing there', () => {
    const selectors = stripped(MY_CSS).match(/^[^\s@}][^{]*(?=\{)/gm) || [];
    expect(selectors.length).toBeGreaterThan(20);
    selectors.forEach((sel) => sel.split(',').forEach((s) => expect(s.trim()).toMatch(/^\.evts(\b|-|\.|\s|:)/)));
    expect(stripped(GLOBAL_CSS)).not.toMatch(/\.evts\b/);
  });
  test('no hex outside the token block, and --danger never carries text', () => {
    const css = stripped(MY_CSS);
    const start = css.indexOf('.evts {');
    const outside = css.slice(0, start) + css.slice(css.indexOf('}', start));
    expect(outside).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l))).toEqual([]);
  });
  test('every custom property used is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, MY_CSS]) for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    const used = [...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });
  test('the table is fixed-layout and its row actions never use flex-end (hard rules 9 and 11)', () => {
    const css = stripped(MY_CSS);
    expect(css).toMatch(/\.evts-tbl\s*\{[^}]*table-layout:\s*fixed/);
    expect(css).toMatch(/\.evts-rowact > :first-child\s*\{\s*margin-left:\s*auto;\s*\}/);
    expect(css).not.toMatch(/\.evts-rowact\s*\{[^}]*justify-content:\s*flex-end/);
  });
  test('a truncating name is one text node with min-width 0 (hard rule 8)', () => {
    const nm = stripped(MY_CSS).match(/\.evts-nm\s*\{([^}]*)\}/)[1];
    expect(nm).toMatch(/min-width:\s*0/);
    expect(nm).toMatch(/text-overflow:\s*ellipsis/);
  });
});
```

- [ ] **Step 3: Pin the new scrim**

In `src/src/__tests__/modalReachability.test.js`, replace

```js
  ['PublicLibraryPanel.css', '.publib-scrim', '.publib-dialog'],
].map(([file, scrim, card]) => ({
```

with

```js
  ['PublicLibraryPanel.css', '.publib-scrim', '.publib-dialog'],
  // Events (roadmap M1): the new-event dialog.
  ['EventsPanel.css', '.evts-scrim', '.evts-modal'],
].map(([file, scrim, card]) => ({
```

- [ ] **Step 4: Run them and watch them fail**

```bash
cd src && npm test -- eventsPanel modalReachability 2>&1 | grep -E "Cannot find|ENOENT|Test Suites:"
```

Expected: `Cannot find module '../components/EventsPanel'`, `ENOENT … EventsPanel.css` for the palette test and for `modalReachability.test.js`; `Test Suites: 3 failed`.

- [ ] **Step 5: Write the stylesheet**

Create `src/src/components/EventsPanel.css`:

```css
/* components/EventsPanel.jsx, EventDetailsDialog.jsx — the Events place.
   ==========================================================================
   Built from docs/design/agenda-redesign/01-events.html, 01b-events-personal
   .html and 05-new-event.html, whose styles are _src/agenda-console.css over
   admin-redesign/_src/shell.css. Those classes are translated here under one
   scope, `.evts`: the namespace tests hold each screen to one scope class,
   and `styles.css` owns the bare `.btn` / `.chip` / `.modal` names.

   Dusk, on AdminShell's dark work field (consoleSections.js gives `events`
   contentTheme 'dark'). The ladder is the console's: 12 / 13 / 15 / 19 / 30.
   Rows are 48px, not 36: each carries a name and a place line (.evts-nm +
   .evts-sub), which the 15/13 pair does not fit in 36
   (agenda-console.css, `.ag-agenda td{height:48px}`).

   MEASURED, composited on the real stack (eventsPanelPalette.test.js):
     --text  #F4EDE4 on --bg 14.97, on --surface 12.53
     --muted #9BA8BE on --bg  7.61, on --surface  6.37
     --primary #F6A94C on --bg 8.86; #0F1A2E on --primary 8.86 (a filled button)
     --muted on the selected option (#F6A94C @10% over --surface)  5.04
     --muted on the note box (#9BA8BE @6% over --surface)           5.46
     --danger-text on its tint (#E5645E @9% over --surface)          5.50
   ========================================================================== */
.evts {
  --evts-t-floor: 12px;
  --evts-t-label: 13px;
  --evts-t-body: 15px;
  --evts-t-head: 19px;
  --evts-t-numeral: 30px;
  --evts-row-h: 48px;

  /* The ink on a filled amber button. Invariant dusk navy, not var(--bg):
     under a paper ancestor --bg is paper, and #FBF7F1 on amber is 1.9:1. */
  --evts-on-accent: #0F1A2E;
  /* Not global tokens (see UserManagement.css): an undefined custom property
     invalidates the whole declaration it sits in. */
  --evts-font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  --evts-rule: rgba(155, 168, 190, .20);
  --evts-rule-strong: rgba(155, 168, 190, .34);
  --evts-row-hover: rgba(155, 168, 190, .055);
  --evts-row-sel: rgba(246, 169, 76, .10);
  --evts-tint-note: rgba(155, 168, 190, .06);
  --evts-tint-danger: rgba(229, 100, 94, .09);
  --evts-scrim: rgba(6, 11, 22, .72);

  color: var(--text);
  font: 400 var(--evts-t-body)/1.45 var(--font-ui);
  font-variant-numeric: tabular-nums;
}
.evts *,
.evts *::before,
.evts *::after { box-sizing: border-box; }
.evts :focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 3px; }

/* The head's "New event": AdminShell's actions slot is outside the panel, so
   the button carries the scope on a wrapper of its own. */
.evts.evts-headact { display: inline-flex; }

/* ------------------------------------------------------------- buttons --- */
.evts-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  border-radius: 6px; border: 1px solid var(--evts-rule-strong); background: transparent;
  color: var(--text); font: 600 var(--evts-t-label)/1 var(--font-ui); cursor: pointer; white-space: nowrap;
}
.evts-btn:hover:not(:disabled) { background: var(--evts-row-hover); border-color: var(--muted); }
.evts-btn:disabled { opacity: .42; cursor: not-allowed; }
.evts-btn--primary { background: var(--primary); border-color: var(--primary); color: var(--evts-on-accent); font-weight: 700; }
.evts-btn--primary:hover:not(:disabled) { background: var(--primary); border-color: var(--primary); filter: brightness(1.08); }
.evts-btn--lg { height: 36px; padding: 0 16px; font-size: var(--evts-t-body); }
.evts-btn--sm { height: 26px; padding: 0 9px; font-size: var(--evts-t-floor); }
.evts-btn--ghost { border-color: transparent; color: var(--muted); }

/* ------------------------------------------------------------ messages --- */
.evts-alert {
  display: flex; align-items: center; gap: 9px; margin: 0 0 14px; padding: 9px 12px;
  border: 1px solid var(--evts-rule-strong); border-left: 3px solid var(--danger); border-radius: 6px;
  background: var(--evts-tint-danger); color: var(--danger-text);
}
.evts-loading { color: var(--muted); }

/* ------------------------------------------------------------- filters --- */
.evts-filters { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 0 0 12px; }
.evts-search { position: relative; flex: 0 1 300px; min-width: 170px; display: flex; align-items: center; }
.evts-search > svg { position: absolute; left: 9px; pointer-events: none; color: var(--muted); }
.evts-input {
  font: 400 var(--evts-t-body)/1.4 var(--font-ui); color: var(--text); background: var(--bg);
  border: 1px solid var(--evts-rule-strong); border-radius: 6px; padding: 6px 9px; min-height: 32px; width: 100%;
}
.evts-search .evts-input { padding-left: 29px; }
.evts-input::placeholder { color: var(--muted); opacity: .62; }
.evts-input:focus { outline: 2px solid var(--primary); outline-offset: 1px; border-color: var(--primary); }
.evts-seg { display: inline-flex; border: 1px solid var(--evts-rule-strong); border-radius: 6px; overflow: hidden; }
.evts-seg button {
  border: 0; border-right: 1px solid var(--evts-rule); background: transparent; color: var(--muted);
  font: 600 var(--evts-t-label)/1 var(--font-ui); padding: 0 11px; height: 30px; cursor: pointer;
}
.evts-seg button:last-child { border-right: 0; }
.evts-seg button[aria-pressed="true"] { background: var(--evts-row-sel); color: var(--text); }
.evts-seg .evts-dim { margin-left: 4px; font-size: var(--evts-t-floor); }
.evts-dim { color: var(--muted); }

/* --------------------------------------------------------------- table --- */
.evts-tbl { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
.evts-tbl th {
  text-align: left; font-size: var(--evts-t-floor); font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
  color: var(--muted); padding: 0 10px 7px; white-space: nowrap; border-bottom: 1px solid var(--evts-rule-strong);
}
.evts-tbl td {
  padding: 0 10px; height: var(--evts-row-h); border-bottom: 1px solid var(--evts-rule);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.evts-tbl tbody tr:hover td { background: var(--evts-row-hover); }
.evts-tbl .evts-num { text-align: right; }
.evts-col-when { width: 170px; }
.evts-col-items { width: 64px; }
.evts-col-who { width: 190px; }
.evts-col-code { width: 70px; }
.evts-col-state { width: 110px; }
.evts-col-acts { width: 84px; }
/* A truncating name is ONE text node with min-width 0 (hard rule 8), and the
   full string rides on title= so the clip is a reduction, not a deletion. */
.evts-nm {
  display: block; max-width: 100%; min-width: 0; padding: 0; border: 0; background: none; cursor: pointer;
  color: var(--text); font: 600 var(--evts-t-body)/1.3 var(--font-ui); text-align: left;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.evts-nm:hover { color: var(--primary); }
.evts-sub {
  display: block; min-width: 0; font-size: var(--evts-t-label); color: var(--muted);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.evts-when { font-size: var(--evts-t-label); color: var(--muted); }
.evts-mono { font-family: var(--evts-font-mono); font-size: 14px; }
.evts-chip {
  display: inline-flex; align-items: center; gap: 5px; font-size: var(--evts-t-floor); font-weight: 600;
  padding: 2px 7px; border-radius: 999px; border: 1px solid var(--evts-rule-strong); color: var(--muted); line-height: 1.5;
}
.evts-chip--type { color: var(--text); }
.evts-chip--off { border-style: dashed; }
/* Row actions: margin-left auto on the first child, never flex-end (hard rule 9). */
.evts-rowact { display: flex; gap: 5px; flex-wrap: wrap; }
.evts-rowact > :first-child { margin-left: auto; }

/* ------------------------------------------------------ the empty states --- */
.evts-empty { max-width: 64ch; margin: 56px auto; text-align: center; }
.evts-empty h3 { font-family: var(--font-display); font-size: var(--evts-t-head); font-weight: 700; margin: 12px 0 7px; }
.evts-empty p { color: var(--muted); margin: 0 0 18px; line-height: 1.55; }
.evts-empty p b { color: var(--text); }
.evts-acts { display: flex; gap: 9px; justify-content: center; flex-wrap: wrap; }
.evts-nomatch { margin: 24px 0; color: var(--muted); }
.evts-nomatch p { margin: 0 0 10px; }

/* --------------------------------------------------------------- dialog --- */
/* The scrim scrolls; the card centres with margin:auto (hard rule 10). */
.evts-scrim {
  position: fixed; inset: 0; z-index: 60; background: var(--evts-scrim);
  display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 28px 24px;
}
.evts-modal {
  margin: auto; width: min(760px, 100%); background: var(--surface); border: 1px solid var(--evts-rule-strong);
  border-radius: 12px; box-shadow: 0 24px 64px rgba(0, 0, 0, .5); color: var(--text); overflow-wrap: anywhere;
}
.evts-modal-head { display: flex; gap: 10px; align-items: flex-start; padding: 16px 18px 10px; }
.evts-modal-head h2 { margin: 0; font: 800 var(--evts-t-head)/1.2 var(--font-display); }
.evts-modal-head p { margin: 4px 0 0; font-size: var(--evts-t-label); color: var(--muted); }
.evts-grow { flex: 1 1 auto; min-width: 0; }
.evts-x {
  flex: none; width: 32px; height: 32px; border: 0; border-radius: 6px; background: transparent;
  color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer;
}
.evts-x:hover { color: var(--text); background: var(--evts-row-hover); }
.evts-modal-body { padding: 0 18px 4px; }
.evts-modal-foot {
  display: flex; gap: 9px; align-items: center; padding: 14px 18px 16px; margin-top: 12px;
  border-top: 1px solid var(--evts-rule);
}
.evts-foot-note { font-size: var(--evts-t-label); color: var(--muted); }
.evts-step + .evts-step { margin-top: 16px; }
.evts-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; border: 0; padding: 0; margin: 0; }
.evts-label { font-size: var(--evts-t-label); font-weight: 600; color: var(--muted); padding: 0; }
.evts-hint { margin: 6px 0 0; font-size: var(--evts-t-label); color: var(--muted); line-height: 1.45; }
.evts-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.evts-span2 { grid-column: span 2; }
.evts-span4 { grid-column: 1 / -1; }
.evts-opts { display: flex; gap: 8px; }
.evts-opt {
  flex: 1 1 0; min-width: 0; display: flex; gap: 11px; align-items: flex-start; padding: 11px 13px; cursor: pointer;
  border: 1px solid var(--evts-rule-strong); border-radius: 9px; background: var(--bg); color: var(--text);
}
.evts-opt[data-checked="true"] { border-color: var(--primary); background: var(--evts-row-sel); }
.evts-opt--off { cursor: not-allowed; }
.evts-opt input { margin: 2px 0 0; accent-color: var(--primary); }
.evts-opt b { display: block; font-size: var(--evts-t-body); font-weight: 700; }
.evts-opt span { display: block; margin-top: 2px; font-size: var(--evts-t-label); color: var(--muted); line-height: 1.45; }
.evts-note {
  display: flex; gap: 10px; align-items: flex-start; margin: 16px 0 0; padding: 10px 13px;
  border-left: 3px solid var(--muted); border-radius: 0 6px 6px 0; background: var(--evts-tint-note);
  font-size: var(--evts-t-label); color: var(--muted); line-height: 1.5;
}
.evts-note b { color: var(--text); }
.evts-error {
  margin: 12px 0 0; padding: 9px 12px; border-left: 3px solid var(--danger); border-radius: 0 6px 6px 0;
  background: var(--evts-tint-danger); color: var(--danger-text); font-size: var(--evts-t-label);
}
```

- [ ] **Step 6: Write the dialog**

Create `src/src/components/EventDetailsDialog.jsx`:

```jsx
import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import { createEvent, updateEvent } from '../utils/eventsApi';
import './EventsPanel.css';

/**
 * NEW EVENT, AND "EDIT DETAILS" — docs/design/agenda-redesign/05-new-event.html.
 *
 * Name, date, start, time zone and place, who can join, and what attendees get
 * of each report. With `initial` (an event from GET /events/{code}) it edits
 * that event through PUT; without, it creates one through POST and hands the
 * new event (its code chosen by the server) to `onSaved`.
 *
 * WHAT THIS RELEASE CHANGES FROM THE DRAWING, and why:
 *   - "Only people you invite" is shown, disabled, "Coming soon": invitations
 *     are PLAN Phase 3. The server refuses `invite` the same way.
 *   - The billing note states today's rule (decision 1: an event counts as
 *     one session) rather than the drawn end state of event pricing
 *     (decision 12, PLAN Phase 7), which has not shipped.
 *
 * Checked with the same agenda-rules.checkEventFields the server runs, so a
 * refusal is said here before it is sent — and the server's own sentence is
 * shown if it refuses anyway (a Personal space in a stale tab: 402).
 *
 * TWO EXITS, ONE CLOSE: the X and Close both go through `requestClose`, which
 * asks before discarding typed words; Escape and the backdrop are gated on the
 * same (hard rules 2 and 3).
 */

export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (e) {
    return 'UTC';
  }
}

/** Every zone this browser knows, `first` first. */
export function zoneOptions(first) {
  let all = [];
  try {
    all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch (e) {
    all = [];
  }
  const out = [first, ...all.filter((z) => z !== first)];
  if (!out.includes('UTC')) out.push('UTC');
  return out.filter(Boolean);
}

const REPORT_CHOICES = [
  { value: 'full', label: 'Full', sentence: 'Each item’s report as you see it, names included.' },
  { value: 'anonymous', label: 'Anonymous', sentence: 'The same reports with every name removed.' },
  { value: 'none', label: 'Not shared', sentence: 'Reports stay in the console.' },
];

export default function EventDetailsDialog({ initial = null, onClose, onSaved }) {
  const editing = Boolean(initial && initial.code);
  const [baseline] = useState(() => {
    const start = (initial && initial.startsAt) || '';
    return {
      title: (initial && initial.title) || '',
      date: start.slice(0, 10),
      time: start.slice(11, 16) || '09:00',
      timeZone: (initial && initial.timeZone) || browserZone(),
      place: (initial && initial.place) || '',
      reports: (initial && initial.attendeeReports) || 'full',
    };
  });
  const [title, setTitle] = useState(baseline.title);
  const [date, setDate] = useState(baseline.date);
  const [time, setTime] = useState(baseline.time);
  const [timeZone, setTimeZone] = useState(baseline.timeZone);
  const [place, setPlace] = useState(baseline.place);
  const [reports, setReports] = useState(baseline.reports);
  const [zones] = useState(() => zoneOptions(baseline.timeZone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const dirty = title !== baseline.title || date !== baseline.date || time !== baseline.time
    || timeZone !== baseline.timeZone || place !== baseline.place || reports !== baseline.reports;

  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm('Close without saving? What you typed will be lost.')) return;
    onClose();
  };

  const submit = async (e) => {
    if (e) e.preventDefault();
    const fields = { title, place, startsAt: `${date}T${time}`, timeZone, access: 'open', attendeeReports: reports };
    const checked = rules.checkEventFields(fields, { nowSeconds: Math.floor(Date.now() / 1000) });
    if (checked.error) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const event = editing ? await updateEvent(initial.code, checked.value) : await createEvent(checked.value);
      onSaved(event);
    } catch (err) {
      setError(err.message || 'The event was not saved.');
      setBusy(false);
    }
  };

  return (
    <Modal
      overlayClassName="evts evts-scrim"
      contentClassName="evts-modal"
      labelledBy="evts-details-title"
      onClose={requestClose}
      closeOnBackdrop={() => !dirty && !busy}
      closeOnEscape={() => !dirty && !busy}
      theme="dark"
    >
      <form onSubmit={submit} noValidate>
        <header className="evts-modal-head">
          <div className="evts-grow">
            <h2 id="evts-details-title">{editing ? 'Event details' : 'New event'}</h2>
            <p>
              {editing
                ? 'The name, the day and the place, as the agenda shows them.'
                : 'Name it, say when and where, and choose who can join. You build the agenda next, from empty.'}
            </p>
          </div>
          <button type="button" className="evts-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
        </header>

        <div className="evts-modal-body">
          <div className="evts-field evts-step">
            <label className="evts-label" htmlFor="evts-name">Name</label>
            <input id="evts-name" className="evts-input" value={title} maxLength={rules.TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="evts-grid evts-step">
            <div className="evts-field">
              <label className="evts-label" htmlFor="evts-date">Date</label>
              <input id="evts-date" type="date" className="evts-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="evts-field">
              <label className="evts-label" htmlFor="evts-time">Starts</label>
              <input id="evts-time" type="time" className="evts-input" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="evts-field evts-span2">
              <label className="evts-label" htmlFor="evts-zone">Time zone</label>
              <select id="evts-zone" className="evts-input" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div className="evts-field evts-span4">
              <label className="evts-label" htmlFor="evts-place">
                Place <span className="evts-dim">· optional, shown on the agenda</span>
              </label>
              <input id="evts-place" className="evts-input" value={place} maxLength={rules.PLACE_MAX} onChange={(e) => setPlace(e.target.value)} />
            </div>
          </div>

          <fieldset className="evts-field evts-step">
            <legend className="evts-label">Who can join</legend>
            <div className="evts-opts" role="radiogroup" aria-label="Who can join">
              <label className="evts-opt" data-checked="true">
                <input type="radio" name="evts-access" defaultChecked />
                <div>
                  <b>Anyone with the code</b>
                  <span>Like a session today: the code on the main screen is all anyone needs, and they type their own name.</span>
                </div>
              </label>
              <label className="evts-opt evts-opt--off" data-checked="false">
                <input type="radio" name="evts-access" disabled />
                <Icon name="Lock" weight="bold" size={18} color="var(--primary)" />
                <div>
                  <b>Only people you invite</b>
                  <span>Coming soon. Each person will get their own passcode, which you hand out.</span>
                </div>
              </label>
            </div>
          </fieldset>

          <fieldset className="evts-field evts-step">
            <legend className="evts-label">Reports for attendees, afterwards</legend>
            <div className="evts-opts" role="radiogroup" aria-label="Reports for attendees">
              {REPORT_CHOICES.map((choice) => (
                <label key={choice.value} className="evts-opt" data-checked={String(reports === choice.value)}>
                  <input
                    type="radio"
                    name="evts-reports"
                    value={choice.value}
                    checked={reports === choice.value}
                    onChange={() => setReports(choice.value)}
                  />
                  <div><b>{choice.label}</b><span>{choice.sentence}</span></div>
                </label>
              ))}
            </div>
            <p className="evts-hint">The default for every item’s report.</p>
          </fieldset>

          <div className="evts-note evts-step">
            <Icon name="CreditCard" weight="bold" size={16} color="currentColor" />
            <div>
              <b>An event counts as one session, however many items it runs.</b> Up to {rules.MAX_ITEMS} items,
              {' '}{rules.MAX_ENGAGEMENTS} of them engagements.
            </div>
          </div>

          {error && <p className="evts-error" role="alert">{error}</p>}
        </div>

        <footer className="evts-modal-foot">
          <button type="button" className="evts-btn" onClick={requestClose} disabled={busy}>Close</button>
          <span className="evts-grow" />
          {!editing && <span className="evts-foot-note">The join code is chosen when you create it.</span>}
          <button type="submit" className="evts-btn evts-btn--primary" disabled={busy}>
            {busy ? 'Saving…' : (editing ? 'Save' : 'Create event')}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 7: Write the panel**

Create `src/src/components/EventsPanel.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import EventDetailsDialog from './EventDetailsDialog';
import { listEvents } from '../utils/eventsApi';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import './EventsPanel.css';

/**
 * EVENTS — the list (01-events.html), or, for a space not on the Team plan,
 * what an event is and the one way in (01b-events-personal.html).
 *
 * A place with a table, not a dialog: an event is an agenda, and the builder
 * it opens is a place too (EventBuilder.jsx, with a breadcrumb back here).
 * AdminPage owns which is on screen and draws "New event" in the work head
 * (NewEventButton below); this component owns the list, its filter and the
 * new-event dialog.
 *
 * Mountable on its own, like every console panel (AdminPage cannot be
 * mounted in jsdom): props in, calls through utils/eventsApi.js.
 *
 * @param {boolean}  teamPlan          the active organisation is on the Team plan
 * @param {boolean}  creating          the new-event dialog is open
 * @param {Function} onCreatingChange  (open: boolean) => void
 * @param {Function} onOpen            (code, title) => void — open the builder
 * @param {Function} [onRequestPlan]   opens "Request the Team plan"; absent for
 *                                     someone who may not ask (not the owner)
 * @param {Function} [onShowPlan]      opens Plan & usage; absent when this
 *                                     person has no such section
 */

/** Today as YYYY-MM-DD on this viewer's own calendar. */
export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Upcoming is today or later, by the event's own date — a plan, not a timer. */
export const isUpcoming = (event, today) => String((event && event.startsAt) || '').slice(0, 10) >= today;

/** The work head's primary action; carries the scope so its tokens resolve. */
export function NewEventButton({ onClick }) {
  return (
    <span className="evts evts-headact">
      <button type="button" className="evts-btn evts-btn--primary evts-btn--lg" onClick={onClick}>
        <Icon name="Plus" weight="bold" size={16} color="currentColor" /> New event
      </button>
    </span>
  );
}

function TeamPlanOnly({ onRequestPlan, onShowPlan }) {
  return (
    <div className="evts">
      <div className="evts-empty" data-testid="events-team-only">
        <Icon name="CalendarBlank" weight="duotone" size={40} color="var(--primary)" />
        <h3>Events are part of the Team plan</h3>
        <p>
          An event puts a whole agenda behind one code — quizzes, Call &amp; Answer, polls and breaks, in the
          order you run them. This space is on the Personal plan.
        </p>
        <div className="evts-acts">
          {onRequestPlan && (
            <button type="button" className="evts-btn evts-btn--primary evts-btn--lg" onClick={onRequestPlan}>
              Request the Team plan
            </button>
          )}
          {onShowPlan && (
            <button type="button" className="evts-btn evts-btn--lg" onClick={onShowPlan}>What the Team plan adds</button>
          )}
        </div>
        {!onRequestPlan && <p className="evts-hint">Only an owner of this organisation can request the Team plan.</p>}
        <p className="evts-hint">Until then, <b>Sessions</b> runs one engagement at a time, exactly as today.</p>
      </div>
    </div>
  );
}

export default function EventsPanel({
  teamPlan, creating = false, onCreatingChange, onOpen, onRequestPlan, onShowPlan,
}) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(Boolean(teamPlan));
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [when, setWhen] = useState('upcoming');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setEvents(await listEvents());
    } catch (err) {
      setError(err.message || 'Could not load events.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (teamPlan) load();
  }, [teamPlan, load]);

  if (!teamPlan) return <TeamPlanOnly onRequestPlan={onRequestPlan} onShowPlan={onShowPlan} />;

  const today = todayIso();
  const upcoming = events.filter((e) => isUpcoming(e, today));
  const past = events.filter((e) => !isUpcoming(e, today)).reverse();
  const inView = when === 'upcoming' ? upcoming : past;
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? inView.filter((e) => `${e.title} ${e.place} ${e.code}`.toLowerCase().includes(needle))
    : inView;
  const open = (event) => onOpen(event.code, event.title);

  return (
    <div className="evts">
      {error && (
        <div className="evts-alert" role="alert">
          <Icon name="Warning" weight="fill" size={16} color="currentColor" />
          <span>{error}</span>
        </div>
      )}
      {loading && events.length === 0 && <p className="evts-loading">Loading events…</p>}

      {!loading && !error && events.length === 0 && (
        <div className="evts-empty" data-testid="events-empty">
          <Icon name="CalendarBlank" weight="duotone" size={40} color="var(--primary)" />
          <h3>No events yet</h3>
          <p>
            An event puts a whole agenda behind one code: engagements and breaks, in the order you run them.
            You name it first, then build its agenda.
          </p>
          <div className="evts-acts">
            <button type="button" className="evts-btn evts-btn--primary evts-btn--lg" onClick={() => onCreatingChange(true)}>
              <Icon name="Plus" weight="bold" size={16} color="currentColor" /> New event
            </button>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <>
          <div className="evts-filters">
            <label className="evts-search">
              <Icon name="MagnifyingGlass" weight="bold" size={14} color="currentColor" />
              <input
                className="evts-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search events"
                aria-label="Search events"
              />
            </label>
            <div className="evts-seg" role="group" aria-label="Show">
              <button type="button" aria-pressed={when === 'upcoming'} onClick={() => setWhen('upcoming')}>
                Upcoming <span className="evts-dim">{upcoming.length}</span>
              </button>
              <button type="button" aria-pressed={when === 'past'} onClick={() => setWhen('past')}>
                Past <span className="evts-dim">{past.length}</span>
              </button>
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="evts-nomatch" data-testid="events-nomatch">
              {needle ? (
                <>
                  <p>No {when} event matches “{search.trim()}”.</p>
                  <button type="button" className="evts-btn" onClick={() => setSearch('')}>Clear the search</button>
                </>
              ) : (
                <>
                  <p>{when === 'upcoming' ? 'Nothing is coming up.' : 'Nothing has happened yet.'}</p>
                  <button type="button" className="evts-btn" onClick={() => setWhen(when === 'upcoming' ? 'past' : 'upcoming')}>
                    {when === 'upcoming' ? 'Show past events' : 'Show upcoming events'}
                  </button>
                </>
              )}
            </div>
          ) : (
            <table className="evts-tbl">
              <thead>
                <tr>
                  <th>Event</th>
                  <th className="evts-col-when">When</th>
                  <th className="evts-col-items evts-num">Items</th>
                  <th className="evts-col-who">Who can join</th>
                  <th className="evts-col-code">Code</th>
                  <th className="evts-col-state">State</th>
                  <th className="evts-col-acts" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map((event) => (
                  <tr key={event.code} data-testid="event-row">
                    <td>
                      <button type="button" className="evts-nm" title={event.title} onClick={() => open(event)}>
                        {event.title || 'Untitled event'}
                      </button>
                      {event.place && <span className="evts-sub" title={event.place}>{event.place}</span>}
                    </td>
                    <td className="evts-when">{rules.formatEventWhen(event.startsAt)}</td>
                    <td className="evts-num">{event.itemCount}</td>
                    <td>{event.access === 'invite' ? 'Invite only' : 'Anyone with the code'}</td>
                    <td className="evts-mono">{event.code}</td>
                    <td>
                      {event.itemCount > 0
                        ? <span className="evts-chip evts-chip--type">Scheduled</span>
                        : <span className="evts-chip evts-chip--off">Draft</span>}
                    </td>
                    <td>
                      <div className="evts-rowact">
                        <button type="button" className="evts-btn evts-btn--sm" onClick={() => open(event)} aria-label={`Open ${event.title}`}>
                          Open
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {creating && (
        <EventDetailsDialog
          onClose={() => onCreatingChange(false)}
          onSaved={(event) => {
            onCreatingChange(false);
            onOpen(event.code, event.title);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run them green, with the design-system suites**

```bash
cd src && npm test -- eventsPanel modalReachability designSystem 2>&1 | grep -E "✕|Tests:|Test Suites:"
```

Expected: no `✕`; `Test Suites: 4 passed` (`eventsPanel.test.jsx` 16 tests, `eventsPanelPalette.test.js` 15). Then `cd src && npm run lint`: 0 errors, the warnings count unchanged.

- [ ] **Step 9: Look at it against the mockups.** Mount nothing new in the app yet (Task 15 does); compare the markup and the stylesheet with `01-events.html`, `01b-events-personal.html` and `05-new-event.html` on :8124 — the facts each row states, the order of the dialog's groups, the two exits.

- [ ] **Step 10: Commit**

```bash
git add src/src/components/EventsPanel.jsx src/src/components/EventDetailsDialog.jsx src/src/components/EventsPanel.css src/src/__tests__/eventsPanel.test.jsx src/src/__tests__/eventsPanelPalette.test.js src/src/__tests__/modalReachability.test.js
git commit -m "The Events place: a Team plan's list and new-event dialog, a Personal space's one honest page

EventsPanel lists the organisation's events (01): name and place, when,
items, who can join, code, Draft or Scheduled, with a search and Upcoming /
Past as a filter, and two different empty states. A space not on the Team
plan gets 01b: what an event is and Request the Team plan, never a greyed-out
builder. EventDetailsDialog (05) creates or edits an event; invite-only is
shown disabled as coming soon, and the billing line states today's rule. Both
exits go through one requestClose. EventsPanel.css is scoped .evts and
measured.

Tests: eventsPanel.test.jsx, eventsPanelPalette.test.js (new);
modalReachability.test.js pins .evts-scrim.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Add an engagement, add a break, edit or remove an item — the item dialog

Built from 03-add-item. Adding an engagement shows only the sets of the chosen type (older spellings included, switched-off sets left out), the version that will be pinned ("v3 · latest"), and "On this agenda · 6" where a set is already used; the title, planned length, "Goes after" and description follow. A break is the same form without the picker (03 draws none). Editing names the set rather than changing it, and "Remove from agenda" confirms inline — never a modal from a modal. A refusal (a co-host filled the last place) shows the server's sentence and keeps every choice. The builder opens this dialog in Task 14; its styles start the builder's stylesheet.

**Files:**
- Create: `src/src/components/EventItemDialog.jsx`
- Create: `src/src/components/EventBuilder.css` (the scope, the tokens and the dialog; Task 14 appends the builder)
- Create: `src/src/__tests__/eventItemDialog.test.jsx`
- Create: `src/src/__tests__/eventBuilderPalette.test.js` (the dialog's contract; Task 14 appends the builder's)
- Modify: `src/src/__tests__/modalReachability.test.js` (`STAGE2_SCRIMS`)

**Interfaces:**
- Consumes: `addItem`, `updateItem`, `removeItem` (Task 11); `BREAK`, `TYPE_LABELS`, `isEngagement`, `canonicalSetType`, `checkItemFields`, `TITLE_MAX`, `DESCRIPTION_MAX` (Task 2); `Modal`, `Icon`; the console's sets as `GET /admin/question-sets` projects them (`{id, scope, orgId, name, engagementType, activeVersion, questionCount, active, decryptFailed?}` — `admin/get-question-sets.js`).
- Produces: `EventItemDialog` (default) props `{code, mode: 'add'|'edit', type, item?, items, sets, onClose(), onSaved(), onRemoved(itemId)}`. Add sends `addItem(code, {type, title, description, minutes, position, setRef?: {scope, orgId, setId, version}})` with `position` from "Goes after" (0 = at the start, `i + 1` = after row `i`); edit sends `updateItem(code, itemId, {title, description, minutes})`. Scope `.evb`; scrim `.evb-scrim`, card `.evb-modal` (`.evb-modal--wide` with the picker); test ids `set-row`, `remove-confirm`.

- [ ] **Step 1: Write the failing behaviour test**

Create `src/src/__tests__/eventItemDialog.test.jsx`:

```jsx
/**
 * ADD AN ENGAGEMENT OR A BREAK, EDIT OR REMOVE AN ITEM —
 * components/EventItemDialog.jsx (docs/design/agenda-redesign/03-add-item.html).
 *
 * rejects: sets of another type offered; a switched-off set offered; the
 * version sent differing from the one shown; a duplicate set added without
 * saying so; "Goes after" ignored; a cap refusal that closes the dialog or
 * drops the choices; a remove with no confirmation, or confirmed in a second
 * modal; a dialog with one exit.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EventItemDialog from '../components/EventItemDialog';

jest.mock('../utils/eventsApi', () => ({
  addItem: jest.fn(),
  updateItem: jest.fn(),
  removeItem: jest.fn(),
}));
const api = require('../utils/eventsApi');

const SETS = [
  { id: 'custq4', scope: 'org', orgId: 'org_nw', name: 'Customer knowledge — Q4', engagementType: 'trivia', activeVersion: 3, questionCount: 10, active: true },
  { id: 'fy27', scope: 'org', orgId: 'org_nw', name: 'FY27 plan — check-in', engagementType: 'quiz', activeVersion: 1, questionCount: 8, active: true },
  { id: 'friction', scope: 'org', orgId: 'org_nw', name: 'Friction finder', engagementType: 'call-and-answer', activeVersion: 5, questionCount: 4 },
  { id: 'offq', scope: 'platform', orgId: null, name: 'Switched off', engagementType: 'trivia', activeVersion: 1, active: false },
];
const ITEMS = [
  { itemId: 'it_00000001', order: 1, type: 'poll', title: 'Before we start', minutes: 8, description: '', state: 'planned' },
  { itemId: 'it_00000002', order: 2, type: 'break', title: 'Break', minutes: 15, description: '', state: 'planned' },
  { itemId: 'it_00000003', order: 3, type: 'trivia', title: 'FY27 plan quiz', minutes: 12, description: '', state: 'planned',
    setRef: { scope: 'org', orgId: 'org_nw', setId: 'fy27', version: 1 }, set: { name: 'FY27 plan — check-in', questionCount: 8, latestVersion: 1, missing: false } },
];
const base = (over = {}) => ({
  code: '5307', mode: 'add', type: 'trivia', items: ITEMS, sets: SETS,
  onClose: jest.fn(), onSaved: jest.fn(), onRemoved: jest.fn(), ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => false);
});

describe('adding an engagement', () => {
  it('offers only active sets of the chosen type, older spellings included', () => {
    render(<EventItemDialog {...base()} />);
    expect(screen.getByRole('heading', { name: 'Add Trivia' })).toBeInTheDocument();
    const rows = screen.getAllByTestId('set-row').map((r) => r.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/Customer knowledge — Q4.*v3 · latest.*10/);
    expect(rows[1]).toMatch(/FY27 plan — check-in/);
    expect(screen.queryByText('Friction finder')).toBeNull();
    expect(screen.queryByText('Switched off')).toBeNull();
  });

  it('says when a set is already on the agenda, by the item\'s number', () => {
    render(<EventItemDialog {...base()} />);
    expect(screen.getAllByTestId('set-row')[1]).toHaveTextContent('On this agenda · 2');
  });

  it('picking a set fills an untouched title, and sends the version it shows', async () => {
    api.addItem.mockResolvedValue({ item: {} });
    const p = base();
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    expect(screen.getByLabelText('Title on the agenda')).toHaveValue('Customer knowledge — Q4');
    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'How well do you know our customers?' } });
    fireEvent.change(screen.getByLabelText('Planned length'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Goes after'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Ten questions. Scored.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith('5307', {
      type: 'trivia', title: 'How well do you know our customers?', description: 'Ten questions. Scored.',
      minutes: 15, position: 1, setRef: { scope: 'org', orgId: 'org_nw', setId: 'custq4', version: 3 },
    });
  });

  it('asks for a set before sending anything', () => {
    render(<EventItemDialog {...base()} />);
    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'Quiz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a question set');
    expect(api.addItem).not.toHaveBeenCalled();
  });

  // rejects: 03's last note broken — a co-host filled the last place.
  it('a cap refusal shows the server\'s sentence and keeps every choice', async () => {
    api.addItem.mockRejectedValue(new Error('This event has 8 engagements, the most one can hold. Remove one to add another.'));
    const p = base();
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This event has 8 engagements');
    expect(screen.getByLabelText('Customer knowledge — Q4')).toBeChecked();
    expect(screen.getByLabelText('Title on the agenda')).toHaveValue('Customer knowledge — Q4');
    expect(p.onSaved).not.toHaveBeenCalled();
  });

  it('both exits close a clean dialog; a chosen set is not dropped without asking', () => {
    const p = base();
    render(<EventItemDialog {...p} />);
    const exits = screen.getAllByRole('button', { name: 'Close' });
    expect(exits).toHaveLength(2);
    fireEvent.click(exits[0]);
    expect(p.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    fireEvent.click(exits[1]);
    expect(window.confirm).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('adding a break', () => {
  it('has no set, is called Break unless renamed, and goes where it is put', async () => {
    api.addItem.mockResolvedValue({ item: {} });
    const p = base({ type: 'break' });
    render(<EventItemDialog {...p} />);
    expect(screen.getByRole('heading', { name: 'Add a break' })).toBeInTheDocument();
    expect(screen.queryByTestId('set-row')).toBeNull();
    expect(screen.getByLabelText('Title on the agenda')).toHaveValue('Break');
    fireEvent.change(screen.getByLabelText('Goes after'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith('5307', { type: 'break', title: 'Break', description: '', minutes: 15, position: 0 });
  });
});

describe('editing and removing', () => {
  const edit = (over = {}) => base({ mode: 'edit', type: 'trivia', item: ITEMS[2], ...over });

  it('edits the words and the length, and names the set without offering to change it', async () => {
    api.updateItem.mockResolvedValue({ item: {} });
    const p = edit();
    render(<EventItemDialog {...p} />);
    expect(screen.getByRole('heading', { name: 'Edit Trivia' })).toBeInTheDocument();
    expect(screen.getByText('Plays FY27 plan — check-in · v1.')).toBeInTheDocument();
    expect(screen.queryByTestId('set-row')).toBeNull();
    expect(screen.queryByLabelText('Goes after')).toBeNull();
    fireEvent.change(screen.getByLabelText('Planned length'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', { title: 'FY27 plan quiz', description: '', minutes: 20 });
  });

  it('removing asks in place, and Keep it keeps it', async () => {
    api.removeItem.mockResolvedValue({ removed: 'it_00000003' });
    const p = edit();
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove from agenda' }));
    expect(screen.getByTestId('remove-confirm')).toHaveTextContent('Remove “FY27 plan quiz” from the agenda?');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(api.removeItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from agenda' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(p.onRemoved).toHaveBeenCalledWith('it_00000003'));
    expect(api.removeItem).toHaveBeenCalledWith('5307', 'it_00000003');
  });
});
```

- [ ] **Step 2: Write the failing palette test**

Create `src/src/__tests__/eventBuilderPalette.test.js`:

```js
/**
 * ONE EVENT'S AGENDA — THE CSS CONTRACT of components/EventBuilder.css, the
 * builder (02, 02b) and its item dialog (03).
 *
 * Read as text and composited on the real paint stack, as every *Palette test
 * here is (.claude/skills/engage-design/references/testing-a-surface.md).
 * Named `*Palette`, never `*Token*` (`.gitignore:35`).
 *
 * WHAT GREEN MEANS: the arithmetic holds and the rules jsdom cannot see have
 * not been reverted — not that the screen reads well on a real panel.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('components', 'EventBuilder.css');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
function bgOf(el, win) {
  let node = el; const stack = [];
  while (node && node.nodeType === 1) {
    const c = win.getComputedStyle(node).backgroundColor;
    const m = String(c).match(/[\d.]+/g);
    if (m) {
      const a = m.length > 3 ? parseFloat(m[3]) : 1;
      if (a > 0) { stack.push([m.slice(0, 3).map(Number), a]); if (a >= 0.999) break; }
    }
    node = node.parentElement;
  }
  if (!stack.length) return [15, 26, 46];
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
function tint(name) {
  const m = MY_CSS.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in EventBuilder.css`);
  return m[1];
}
function composited(layers) {
  document.body.innerHTML = '';
  let host = document.body;
  for (const background of layers) {
    const el = document.createElement('div');
    el.style.backgroundColor = background;
    host.appendChild(el);
    host = el;
  }
  return bgOf(host, window);
}
const on = (fgHex, layers) => ratio(parseHex(fgHex), composited(layers));

const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';
const T = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
  onAccent: token(MY_CSS, '.evb {', '--evb-on-accent'),
};
const AA = 4.5;
const PANEL = [T.bg, T.surface];

describe('the item dialog (03)', () => {
  test.each([
    ['dialog copy on the dialog surface', T.text, PANEL],
    ['labels and hints on the dialog surface', T.muted, PANEL],
    ['an input on its --bg well inside the dialog', T.text, [T.bg, T.surface, T.bg]],
    ['the ink on a filled amber button', T.onAccent, [T.primary]],
    ['"On this agenda" in amber on a picker row', T.primary, PANEL],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
  test('the picked set\'s row, and an error on its tint', () => {
    expect(on(T.text, [T.bg, T.surface, tint('--evb-row-sel')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, T.surface, tint('--evb-row-sel')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.dangerText, [T.bg, T.surface, tint('--evb-tint-danger')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, [T.bg, T.surface, tint('--evb-tint-danger')])).toBeGreaterThanOrEqual(AA);
  });
});

describe('the contract', () => {
  test('the ladder, the 12px floor and the 48px agenda rows', () => {
    for (const [step, px] of [['floor', 12], ['label', 13], ['body', 15], ['head', 19], ['numeral', 30]]) {
      expect(MY_CSS).toMatch(new RegExp(`--evb-t-${step}:\\s*${px}px`));
    }
    expect(MY_CSS).toMatch(/--evb-row-h:\s*48px/);
    const sizes = [...stripped(MY_CSS).matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    sizes.forEach((n) => expect(n).toBeGreaterThanOrEqual(12));
  });
  test('every selector is rooted at .evb, and styles.css declares nothing there', () => {
    const selectors = stripped(MY_CSS).match(/^[^\s@}][^{]*(?=\{)/gm) || [];
    expect(selectors.length).toBeGreaterThan(20);
    selectors.forEach((sel) => sel.split(',').forEach((s) => expect(s.trim()).toMatch(/^\.evb(\b|-|\.|\s|:)/)));
    expect(stripped(GLOBAL_CSS)).not.toMatch(/\.evb\b/);
  });
  test('no hex outside the token block, and --danger never carries text', () => {
    const css = stripped(MY_CSS);
    const start = css.indexOf('.evb {');
    const outside = css.slice(0, start) + css.slice(css.indexOf('}', start));
    expect(outside).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l))).toEqual([]);
  });
  test('every custom property used is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, MY_CSS]) for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    const used = [...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });
  test('the picker is a fixed-layout table', () => {
    expect(stripped(MY_CSS)).toMatch(/\.evb-pick-tbl\s*\{[^}]*table-layout:\s*fixed/);
  });
});
```

- [ ] **Step 3: Pin the new scrim**

In `src/src/__tests__/modalReachability.test.js`, replace

```js
  ['EventsPanel.css', '.evts-scrim', '.evts-modal'],
].map(([file, scrim, card]) => ({
```

with

```js
  ['EventsPanel.css', '.evts-scrim', '.evts-modal'],
  // …and the add-item dialog.
  ['EventBuilder.css', '.evb-scrim', '.evb-modal'],
].map(([file, scrim, card]) => ({
```

- [ ] **Step 4: Run them and watch them fail**

```bash
cd src && npm test -- eventItemDialog eventBuilderPalette modalReachability 2>&1 | grep -E "Cannot find|ENOENT|Test Suites:"
```

Expected: `Cannot find module '../components/EventItemDialog'`, `ENOENT … EventBuilder.css` twice; `Test Suites: 3 failed`.

- [ ] **Step 5: Write the stylesheet's first half**

Create `src/src/components/EventBuilder.css`:

```css
/* components/EventBuilder.jsx, EventItemDialog.jsx — one event's agenda.
   ==========================================================================
   Built from docs/design/agenda-redesign/02-builder.html, 02b-cap-reached
   .html and 03-add-item.html (_src/agenda-console.css over admin-redesign
   shell.css), under one scope, `.evb`. The add-item dialog is part of this
   screen and shares its tokens, as QuestionSetsPanel.css holds its dialogs.

   Dusk, on AdminShell's dark work field. Ladder 12 / 13 / 15 / 19 / 30.
   Agenda rows are 48px: a title and a source line each
   (agenda-console.css: "the pair does not fit 36 at the 15/13 ladder").

   MEASURED, composited (eventBuilderPalette.test.js):
     --text / --muted on --surface (the panel)            12.53 / 6.37
     --muted on a break row (#9BA8BE @3.5% over --surface)      5.71
     --text / --muted on the moving row (amber @10%)     10.42 / 5.04
     --text / --muted on the cap's reason (amber @8%)    10.84 / 5.24
     --primary on --surface (the code, "the most…")            7.42
     #0F1A2E on --primary (a filled button)                    8.86
   ========================================================================== */
.evb {
  --evb-t-floor: 12px;
  --evb-t-label: 13px;
  --evb-t-body: 15px;
  --evb-t-head: 19px;
  --evb-t-numeral: 30px;
  --evb-row-h: 48px;

  --evb-on-accent: #0F1A2E;
  --evb-font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  --evb-rule: rgba(155, 168, 190, .20);
  --evb-rule-strong: rgba(155, 168, 190, .34);
  --evb-row-hover: rgba(155, 168, 190, .055);
  --evb-row-sel: rgba(246, 169, 76, .10);
  --evb-tint-cap: rgba(246, 169, 76, .08);
  --evb-tint-brk: rgba(155, 168, 190, .035);
  --evb-tint-danger: rgba(229, 100, 94, .09);
  --evb-scrim: rgba(6, 11, 22, .72);

  color: var(--text);
  font: 400 var(--evb-t-body)/1.45 var(--font-ui);
  font-variant-numeric: tabular-nums;
}
.evb *,
.evb *::before,
.evb *::after { box-sizing: border-box; }
.evb :focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 3px; }

/* ------------------------------------------------------------- buttons --- */
.evb-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  border-radius: 6px; border: 1px solid var(--evb-rule-strong); background: transparent;
  color: var(--text); font: 600 var(--evb-t-label)/1 var(--font-ui); cursor: pointer; white-space: nowrap;
}
.evb-btn:hover:not(:disabled) { background: var(--evb-row-hover); border-color: var(--muted); }
.evb-btn:disabled { opacity: .42; cursor: not-allowed; }
.evb-btn--primary { background: var(--primary); border-color: var(--primary); color: var(--evb-on-accent); font-weight: 700; }
.evb-btn--primary:hover:not(:disabled) { background: var(--primary); border-color: var(--primary); filter: brightness(1.08); }
.evb-btn--sm { height: 26px; padding: 0 9px; font-size: var(--evb-t-floor); }
.evb-btn--icon { width: 26px; padding: 0; justify-content: center; }
.evb-btn--ghostdanger { border-color: transparent; color: var(--danger-text); }
.evb-btn--ghostdanger:hover:not(:disabled) { border-color: var(--danger-text); background: var(--evb-tint-danger); }
.evb-dim { color: var(--muted); }
.evb-grow { flex: 1 1 auto; min-width: 0; }

/* --------------------------------------------------------------- dialog --- */
/* The scrim scrolls; the card centres with margin:auto (hard rule 10). */
.evb-scrim {
  position: fixed; inset: 0; z-index: 60; background: var(--evb-scrim);
  display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 28px 24px;
}
.evb-modal {
  margin: auto; width: min(760px, 100%); background: var(--surface); border: 1px solid var(--evb-rule-strong);
  border-radius: 12px; box-shadow: 0 24px 64px rgba(0, 0, 0, .5); color: var(--text); overflow-wrap: anywhere;
}
.evb-modal--wide { width: min(940px, 100%); }
.evb-modal-head { display: flex; gap: 10px; align-items: flex-start; padding: 16px 18px 10px; }
.evb-modal-head h2 { margin: 0; font: 800 var(--evb-t-head)/1.2 var(--font-display); }
.evb-modal-head p { margin: 4px 0 0; font-size: var(--evb-t-label); color: var(--muted); }
.evb-x {
  flex: none; width: 32px; height: 32px; border: 0; border-radius: 6px; background: transparent;
  color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer;
}
.evb-x:hover { color: var(--text); background: var(--evb-row-hover); }
.evb-modal-body { padding: 0 18px 4px; }
.evb-modal-foot {
  display: flex; gap: 9px; align-items: center; flex-wrap: wrap; padding: 14px 18px 16px; margin-top: 12px;
  border-top: 1px solid var(--evb-rule);
}
.evb-step + .evb-step { margin-top: 16px; }
.evb-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.evb-label { font-size: var(--evb-t-label); font-weight: 600; color: var(--muted); }
.evb-hint { margin: 6px 0 0; font-size: var(--evb-t-label); color: var(--muted); line-height: 1.45; }
.evb-input {
  font: 400 var(--evb-t-body)/1.4 var(--font-ui); color: var(--text); background: var(--bg);
  border: 1px solid var(--evb-rule-strong); border-radius: 6px; padding: 6px 9px; min-height: 32px; width: 100%;
}
.evb-input::placeholder { color: var(--muted); opacity: .62; }
.evb-input:focus { outline: 2px solid var(--primary); outline-offset: 1px; border-color: var(--primary); }
.evb-textarea { min-height: 58px; resize: vertical; line-height: 1.5; }
.evb-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.evb-span2 { grid-column: span 2; }
.evb-span4 { grid-column: 1 / -1; }
.evb-len { display: flex; align-items: center; gap: 8px; }
.evb-len .evb-input { width: 78px; text-align: center; }
.evb-search { position: relative; display: flex; align-items: center; max-width: 300px; margin: 0 0 8px; }
.evb-search > svg { position: absolute; left: 9px; pointer-events: none; color: var(--muted); }
.evb-search .evb-input { padding-left: 29px; }
/* The set picker: the sets of ONE type, as a table (lists are tables). */
.evb-pick { border: 1px solid var(--evb-rule); border-radius: 8px; overflow: auto; max-height: 260px; background: var(--bg); }
.evb-pick-tbl { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
.evb-pick-tbl th {
  text-align: left; font-size: var(--evb-t-floor); font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
  color: var(--muted); padding: 8px 10px 7px; border-bottom: 1px solid var(--evb-rule-strong); background: var(--bg);
}
.evb-pick-tbl td {
  height: 40px; padding: 0 10px; border-bottom: 1px solid var(--evb-rule); background: var(--surface);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.evb-pick-tbl tr[aria-selected="true"] td { background: var(--evb-row-sel); }
.evb-pick-tbl .evb-col-r { width: 34px; text-align: center; }
.evb-pick-tbl .evb-col-plays { width: 130px; }
.evb-pick-tbl .evb-col-qs { width: 56px; text-align: right; }
.evb-pick-tbl .evb-col-here { width: 180px; }
.evb-ver { font-size: var(--evb-t-floor); color: var(--muted); font-weight: 600; }
.evb-chip {
  display: inline-flex; align-items: center; font-size: var(--evb-t-floor); font-weight: 600; line-height: 1.5;
  padding: 2px 7px; border-radius: 999px; border: 1px solid var(--evb-rule-strong); color: var(--muted); white-space: nowrap;
}
.evb-chip--warn { color: var(--primary); }
.evb-error {
  margin: 12px 0 0; padding: 9px 12px; border-left: 3px solid var(--danger); border-radius: 0 6px 6px 0;
  background: var(--evb-tint-danger); color: var(--danger-text); font-size: var(--evb-t-label);
}
.evb-confirm {
  display: flex; gap: 9px; align-items: center; flex-wrap: wrap; width: 100%; padding: 9px 12px;
  border-left: 3px solid var(--danger); border-radius: 0 6px 6px 0; background: var(--evb-tint-danger);
}
.evb-confirm p { margin: 0; flex: 1 1 260px; min-width: 0; font-size: var(--evb-t-label); color: var(--text); }
```

- [ ] **Step 6: Write the dialog**

Create `src/src/components/EventItemDialog.jsx`:

```jsx
import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import { addItem, updateItem, removeItem } from '../utils/eventsApi';
import './EventBuilder.css';

/**
 * ADD AN ENGAGEMENT, ADD A BREAK, EDIT OR REMOVE AN ITEM —
 * docs/design/agenda-redesign/03-add-item.html.
 *
 *   mode 'add', an engagement type  the set picker (sets of that type only),
 *                                   the title, length, place and description
 *   mode 'add', type 'break'        the same fields without a set; 03 draws no
 *                                   break dialog, so this is 03's form minus
 *                                   its picker
 *   mode 'edit'                     title, length, description; the set is
 *                                   named, not changed (a different set is a
 *                                   different item: remove this one and add
 *                                   that). "Remove from agenda" confirms INLINE
 *                                   — never a modal from a modal.
 *
 * The version shown in the picker ("v3 · latest") is the one that will be
 * pinned; the server pins it again and holds it until the host presses
 * "Use vN" on the row. A set may appear twice on one agenda, and says so
 * ("On this agenda · 6"). The add menu opens this only below the caps; if a
 * co-host fills the last place meanwhile, the server refuses Add with the
 * menu's own sentence and the choices here are KEPT (03's last note).
 *
 * @param {string}   code      the event
 * @param {'add'|'edit'} mode
 * @param {string}   type      the item's kind (agenda-rules.ITEM_TYPES)
 * @param {object}   [item]    edit: the item, as GET /events/{code} gives it
 * @param {object[]} items     the agenda now, in order — for "Goes after" and
 *                             "On this agenda"
 * @param {object[]} sets      the console's question sets (GET /admin/question-sets)
 */
function numbered(items) {
  let n = 0;
  return items.map((it) => (it.type === rules.BREAK ? null : (n += 1)));
}

export default function EventItemDialog({
  code, mode, type, item = null, items = [], sets = [], onClose, onSaved, onRemoved,
}) {
  const editing = mode === 'edit';
  const isBreak = type === rules.BREAK;
  const picking = !editing && rules.isEngagement(type);
  const numbers = numbered(items);
  const label = rules.TYPE_LABELS[type] || 'item';

  const [baseline] = useState(() => ({
    title: editing ? item.title : (isBreak ? 'Break' : ''),
    minutes: String(editing ? item.minutes : 15),
    description: editing ? item.description : '',
    position: items.length,
    setKey: '',
  }));
  const [title, setTitle] = useState(baseline.title);
  const [titleTouched, setTitleTouched] = useState(editing);
  const [minutes, setMinutes] = useState(baseline.minutes);
  const [description, setDescription] = useState(baseline.description);
  const [position, setPosition] = useState(baseline.position);
  const [setKey, setSetKey] = useState(baseline.setKey);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const keyOf = (s) => `${s.scope || 'platform'}|${s.id}`;
  const candidates = picking
    ? sets.filter((s) => s.active !== false && !s.decryptFailed && rules.canonicalSetType(s.engagementType) === type)
    : [];
  const needle = search.trim().toLowerCase();
  const shownSets = needle ? candidates.filter((s) => String(s.name || '').toLowerCase().includes(needle)) : candidates;
  const chosen = candidates.find((s) => keyOf(s) === setKey) || null;
  const hereAt = (s) => {
    const i = items.findIndex((it) => it.setRef && it.setRef.setId === s.id
      && (it.setRef.scope || 'platform') === (s.scope || 'platform'));
    return i >= 0 ? numbers[i] : null;
  };

  const dirty = title !== baseline.title || minutes !== baseline.minutes || description !== baseline.description
    || position !== baseline.position || setKey !== baseline.setKey;

  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm('Close without saving? What you chose will be lost.')) return;
    onClose();
  };

  const choose = (s) => {
    setSetKey(keyOf(s));
    if (!titleTouched) setTitle(s.name || '');
  };

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (picking && !chosen) {
      setError('Choose a question set for this item.');
      return;
    }
    const checked = rules.checkItemFields({ title, description, minutes: Number(minutes) }, type);
    if (checked.error) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (editing) {
        await updateItem(code, item.itemId, checked.value);
      } else {
        await addItem(code, {
          type,
          ...checked.value,
          position,
          ...(chosen ? {
            setRef: {
              scope: chosen.scope || 'platform', orgId: chosen.orgId || '', setId: chosen.id,
              version: chosen.activeVersion === undefined ? null : chosen.activeVersion,
            },
          } : {}),
        });
      }
      onSaved();
    } catch (err) {
      // Everything chosen stays: the host reads the reason and decides.
      setError(err.message || 'The item was not saved.');
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await removeItem(code, item.itemId);
      onRemoved(item.itemId);
    } catch (err) {
      setError(err.message || 'The item was not removed.');
      setBusy(false);
      setConfirmingRemove(false);
    }
  };

  const heading = editing ? `Edit ${isBreak ? 'break' : label}` : (isBreak ? 'Add a break' : `Add ${label}`);

  return (
    <Modal
      overlayClassName="evb evb-scrim"
      contentClassName={`evb-modal${picking ? ' evb-modal--wide' : ''}`}
      labelledBy="evb-item-title"
      onClose={requestClose}
      closeOnBackdrop={() => !dirty && !busy}
      closeOnEscape={() => !dirty && !busy}
      theme="dark"
    >
      <form onSubmit={submit} noValidate>
        <header className="evb-modal-head">
          <div className="evb-grow">
            <h2 id="evb-item-title">{heading}</h2>
            <p>
              {picking && `Pick the set. It plays as its own ${label} session, started by you, under the event's code.`}
              {!picking && isBreak && 'A return time on the agenda. Not counted, and not billed.'}
              {editing && !isBreak && item.set && item.set.name && `Plays ${item.set.name}${item.setRef && item.setRef.version ? ` · v${item.setRef.version}` : ''}.`}
            </p>
          </div>
          <button type="button" className="evb-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
        </header>

        <div className="evb-modal-body">
          {picking && (
            <div className="evb-field evb-step">
              <span className="evb-label" id="evb-pick-label">Question set · {label} sets</span>
              <label className="evb-search">
                <Icon name="MagnifyingGlass" weight="bold" size={14} color="currentColor" />
                <input
                  className="evb-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${label} sets`}
                  aria-label={`Search ${label} sets`}
                />
              </label>
              {candidates.length === 0 ? (
                <p className="evb-hint">No {label} sets yet. Make one in Question sets, then add it here.</p>
              ) : (
                <div className="evb-pick">
                  <table className="evb-pick-tbl" aria-labelledby="evb-pick-label">
                    <thead>
                      <tr>
                        <th className="evb-col-r" aria-label="Pick" />
                        <th>Set</th>
                        <th className="evb-col-plays">Plays</th>
                        <th className="evb-col-qs">Qs</th>
                        <th className="evb-col-here" aria-label="On this agenda" />
                      </tr>
                    </thead>
                    <tbody>
                      {shownSets.map((s) => {
                        const selected = keyOf(s) === setKey;
                        const here = hereAt(s);
                        return (
                          <tr key={keyOf(s)} aria-selected={selected} data-testid="set-row">
                            <td className="evb-col-r">
                              <input type="radio" name="evb-set" checked={selected} onChange={() => choose(s)} aria-label={s.name} />
                            </td>
                            <td title={s.name}>{s.name}</td>
                            <td>
                              <span className="evb-ver">
                                {s.activeVersion ? `v${s.activeVersion} · latest` : 'unversioned'}
                              </span>
                            </td>
                            <td className="evb-col-qs">{s.questionCount || 0}</td>
                            <td>{here && <span className="evb-chip evb-chip--warn">On this agenda · {here}</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="evb-grid evb-step">
            <div className="evb-field evb-span2">
              <label className="evb-label" htmlFor="evb-title">Title on the agenda</label>
              <input
                id="evb-title"
                className="evb-input"
                value={title}
                maxLength={rules.TITLE_MAX}
                onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
              />
            </div>
            <div className="evb-field">
              <label className="evb-label" htmlFor="evb-minutes">Planned length</label>
              <div className="evb-len">
                <input
                  id="evb-minutes"
                  className="evb-input"
                  inputMode="numeric"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ''))}
                />
                <span className="evb-dim">min</span>
              </div>
            </div>
            {!editing && (
              <div className="evb-field">
                <label className="evb-label" htmlFor="evb-after">Goes after</label>
                <select id="evb-after" className="evb-input" value={position} onChange={(e) => setPosition(Number(e.target.value))}>
                  <option value={0}>At the start</option>
                  {items.map((it, i) => (
                    <option key={it.itemId} value={i + 1}>
                      {numbers[i] ? `${numbers[i]} · ${it.title}` : `Break · ${it.title}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="evb-field evb-span4">
              <label className="evb-label" htmlFor="evb-description">
                Description <span className="evb-dim">· on the agenda, before and during the event</span>
              </label>
              <textarea
                id="evb-description"
                className="evb-input evb-textarea"
                value={description}
                maxLength={rules.DESCRIPTION_MAX}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <p className="evb-hint">
            The title and description are what the room sees, and every phone, laptop or tablet that joins.
            {picking && ' The set’s own name stays in the console.'}
          </p>
          {error && <p className="evb-error" role="alert">{error}</p>}
        </div>

        <footer className="evb-modal-foot">
          {editing && confirmingRemove ? (
            <div className="evb-confirm" data-testid="remove-confirm">
              <p>Remove “{item.title}” from the agenda? The times after it move up.</p>
              <button type="button" className="evb-btn" onClick={() => setConfirmingRemove(false)} disabled={busy}>Keep it</button>
              <button type="button" className="evb-btn evb-btn--ghostdanger" onClick={remove} disabled={busy}>Remove</button>
            </div>
          ) : (
            <>
              {editing && (
                <button type="button" className="evb-btn evb-btn--ghostdanger" onClick={() => setConfirmingRemove(true)} disabled={busy}>
                  Remove from agenda
                </button>
              )}
              <button type="button" className="evb-btn" onClick={requestClose} disabled={busy}>Close</button>
              <span className="evb-grow" />
              <button type="submit" className="evb-btn evb-btn--primary" disabled={busy}>
                {busy ? 'Saving…' : (editing ? 'Save' : 'Add to agenda')}
              </button>
            </>
          )}
        </footer>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 7: Run them green**

```bash
cd src && npm test -- eventItemDialog eventBuilderPalette modalReachability 2>&1 | grep -E "✕|Tests:|Test Suites:"
```

Expected: no `✕`; `Test Suites: 3 passed` (`eventItemDialog.test.jsx` 9 tests, `eventBuilderPalette.test.js` 11). Then `cd src && npm run lint`: 0 errors, the warnings count unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/src/components/EventItemDialog.jsx src/src/components/EventBuilder.css src/src/__tests__/eventItemDialog.test.jsx src/src/__tests__/eventBuilderPalette.test.js src/src/__tests__/modalReachability.test.js
git commit -m "The item dialog: add an engagement from its type's sets, add a break, edit or remove an item

EventItemDialog (03) offers only active sets of the chosen type, shows the
version it will pin and where a set is already on the agenda, and places the
item where Goes after says. A break is the same form without the picker. Edit
names the set rather than changing it; Remove confirms inline, never in a
second modal. A refusal shows the server's sentence and keeps every choice.
EventBuilder.css starts with the .evb scope and the dialog, measured.

Tests: eventItemDialog.test.jsx, eventBuilderPalette.test.js (new);
modalReachability.test.js pins .evb-scrim.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: The agenda builder — facts, a timed agenda, reorder three ways, "Use vN", the add menu and the caps

Built from 02-builder and 02b-cap-reached. The facts strip says each fact once, the code as the one numeral. The agenda table shows each item's planned time — the start plus the running total, from the same `agendaTimes` the public agenda uses — so a move re-times every row after it at once. Reorder by the grip, by the ↑/↓ buttons, or by Alt+↑/Alt+↓ on a focused row (WCAG 2.5.7: drag is never the only way); a refused save puts the rows back and says why. "Use vN" appears only where a newer version of the pinned set exists. The add menu groups the kinds as 02 does; at 8 engagements they disable with the reason above them at full contrast (02b) and Break stays open; Presentation and Survey are listed, disabled, "Coming soon". The foot counts both caps once.

**Files:**
- Create: `src/src/components/EventBuilder.jsx`
- Modify: `src/src/components/EventBuilder.css` (append the builder)
- Modify: `src/src/components/Icon.jsx` (add `DotsSixVertical`, the grip)
- Create: `src/src/__tests__/eventBuilder.test.jsx`
- Modify: `src/src/__tests__/eventBuilderPalette.test.js` (append the builder's contract)

**Interfaces:**
- Consumes: `getEvent`, `reorderItems`, `updateItem` (Task 11); `EventDetailsDialog` (Task 12); `EventItemDialog` (Task 13); from agenda-rules `countItems`, `agendaTimes`, `formatDuration`, `formatEventDay`, `formatStartTime`, `CAP_SENTENCES`, `MAX_ITEMS`, `MAX_ENGAGEMENTS`, `MAX_BREAKS`, `ADDABLE_TYPES`, `TYPE_LABELS`, `BREAK`; GET /events/{code}'s item shape (`setRef`, `set: {name, questionCount, latestVersion, missing}`, Task 5).
- Produces: `EventBuilder` (default) props `{code, sets, onTitle?(title)}` — calls `onTitle` after each load and after "Edit details" saves; test ids `event-facts`, `agenda-row`, `agenda-at`, `agenda-foot`, `agenda-empty`; the cap's reason is `#evb-capwhy`, and each disabled engagement kind points at it with `aria-describedby`.

- [ ] **Step 1: Write the failing behaviour test**

Create `src/src/__tests__/eventBuilder.test.jsx`:

```jsx
/**
 * ONE EVENT'S AGENDA, RENDERED — components/EventBuilder.jsx
 * (docs/design/agenda-redesign/02-builder.html, 02b-cap-reached.html).
 *
 * The fixture is the design's own day (content.py): 9:00, lengths 8, 30, 15,
 * 20, a 15-minute break, 35, 12, 20, 8 — eight engagements, one break,
 * ending 11:43. It is exactly at the engagement cap, which is 02b.
 *
 * rejects: times that do not follow a move; a keyboard reorder that is not
 * saved, or that loses focus; a failed save that leaves the rows moved; "Use
 * v3" offered when no newer version exists, or applied without a click; the
 * cap's kinds disabled with no reason, or the reason at the disabled
 * opacity's mercy; Break closed at the engagement cap; Presentation and Survey
 * offered as if they worked; the foot counting a break.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EventBuilder from '../components/EventBuilder';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';

jest.mock('../utils/eventsApi', () => ({
  getEvent: jest.fn(),
  reorderItems: jest.fn(),
  updateItem: jest.fn(),
  addItem: jest.fn(),
  removeItem: jest.fn(),
  createEvent: jest.fn(),
  updateEvent: jest.fn(),
}));
const api = require('../utils/eventsApi');

const EVENT = {
  code: '5307', title: 'Q4 Kickoff', place: 'Harbour Room, 4th floor', startsAt: '2026-10-09T09:00',
  timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 8, engagementCount: 8, breakCount: 1,
  attendeeReports: 'full',
};
const eng = (n, type, title, minutes, setName, version, latest) => ({
  itemId: `it_0000000${n}`, order: n, type, title, description: '', minutes, state: 'planned',
  setRef: { scope: 'org', orgId: 'org_nw', setId: `set${n}`, version },
  set: { name: setName, questionCount: 10, latestVersion: latest, missing: false },
});
const DAY = [
  eng(1, 'poll', 'Before we start', 8, 'Kickoff pulse', 3, 3),
  eng(2, 'wavelength', 'FY26 in one word', 30, 'One word', 1, 1),
  eng(3, 'trivia', 'How well do you know our customers?', 15, 'Customer knowledge — Q4', 2, 3),
  eng(4, 'call-and-answer', 'What’s slowing us down?', 20, 'Friction finder', 5, 5),
  { itemId: 'it_00000005', order: 5, type: 'break', title: 'Break', description: '', minutes: 15, state: 'planned' },
  eng(6, 'poll', 'Where should Q1 start?', 35, 'Q1 priorities', 1, 1),
  eng(7, 'trivia', 'FY27 plan quiz', 12, 'FY27 plan — check-in', 1, 1),
  eng(8, 'call-and-answer', 'What would you change first?', 20, 'First moves', 2, 2),
  eng(9, 'poll', 'How did today go?', 8, 'Day pulse', 4, 4),
];
const times = () => screen.getAllByTestId('agenda-at').map((c) => c.textContent);
const titles = () => screen.getAllByTestId('agenda-row').map((r) => r.querySelector('.evb-nm').textContent);
const serve = (items = DAY) => api.getEvent.mockResolvedValue({ event: EVENT, items });
const mount = async (props = {}) => {
  render(<EventBuilder code="5307" sets={[]} {...props} />);
  await waitFor(() => expect(screen.getAllByTestId('agenda-row').length).toBeGreaterThan(0));
};

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => false);
  serve();
  api.reorderItems.mockResolvedValue({ order: [] });
  api.updateItem.mockResolvedValue({ item: {} });
});

describe('the facts and the plan', () => {
  it('says each fact once, the code as the numeral, and hands the title up', async () => {
    const onTitle = jest.fn();
    await mount({ onTitle });
    const facts = screen.getByTestId('event-facts');
    expect(facts).toHaveTextContent('Fri 9 Oct 2026');
    expect(facts).toHaveTextContent('9:00 · Europe/London');
    expect(facts).toHaveTextContent('Harbour Room, 4th floor');
    expect(facts).toHaveTextContent('Anyone with the code');
    expect(facts.querySelector('.evb-code')).toHaveTextContent('5307');
    expect(onTitle).toHaveBeenCalledWith('Q4 Kickoff');
  });

  it('times are the start plus the running total — the design\'s day', async () => {
    await mount();
    expect(times()).toEqual(['9:00', '9:08', '9:38', '9:53', '10:13', '10:28', '11:03', '11:15', '11:35']);
    const foot = screen.getByTestId('agenda-foot');
    expect(foot).toHaveTextContent('Ends 11:43 · 2 h 43 min planned · 8 of 16 items · 8 of 8 engagements');
    expect(foot).toHaveTextContent('the most an event can hold');
    expect(foot).toHaveTextContent('1 break (not counted)');
  });

  it('a break is listed, unnumbered, with its return time', async () => {
    await mount();
    const row = screen.getAllByTestId('agenda-row')[4];
    expect(row).toHaveClass('evb-row--brk');
    expect(row.querySelector('.evb-no')).toHaveTextContent('–');
    expect(row).toHaveTextContent('Back at 10:28 · not counted, not billed');
    expect(screen.getAllByTestId('agenda-row')[5].querySelector('.evb-no')).toHaveTextContent('5');
  });

  it('an engagement says its set, the version it plays and its size', async () => {
    await mount();
    expect(screen.getAllByTestId('agenda-row')[2]).toHaveTextContent('Customer knowledge — Q4 · v2 · 10 questions');
  });
});

describe('reordering', () => {
  it('Alt+↓ on a focused row moves it, re-times the day, saves the order and keeps focus', async () => {
    await mount();
    const row = screen.getAllByTestId('agenda-row')[2];
    row.focus();
    fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true });
    expect(titles().slice(2, 4)).toEqual(['What’s slowing us down?', 'How well do you know our customers?']);
    expect(times().slice(2, 5)).toEqual(['9:38', '9:58', '10:13']);
    await waitFor(() => expect(api.reorderItems).toHaveBeenCalledWith('5307',
      ['it_00000001', 'it_00000002', 'it_00000004', 'it_00000003', 'it_00000005', 'it_00000006', 'it_00000007', 'it_00000008', 'it_00000009']));
    expect(document.activeElement).toBe(screen.getAllByTestId('agenda-row')[3]);
  });

  it('the ↑ and ↓ buttons move a row; the first cannot go up nor the last down', async () => {
    await mount();
    expect(screen.getByRole('button', { name: 'Move Before we start up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move How did today go? down' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move FY26 in one word up' }));
    expect(titles().slice(0, 2)).toEqual(['FY26 in one word', 'Before we start']);
    expect(times().slice(0, 2)).toEqual(['9:00', '9:30']);
    await waitFor(() => expect(api.reorderItems).toHaveBeenCalledTimes(1));
  });

  it('a row can be dragged to a new place', async () => {
    await mount();
    const rows = screen.getAllByTestId('agenda-row');
    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[2]);
    fireEvent.drop(rows[2]);
    expect(titles().slice(0, 3)).toEqual(['FY26 in one word', 'How well do you know our customers?', 'Before we start']);
    await waitFor(() => expect(api.reorderItems).toHaveBeenCalled());
  });

  it('a refused save puts the rows back and says why', async () => {
    api.reorderItems.mockRejectedValue(Object.assign(new Error('The event changed while you were saving. Nothing was saved; reload it and try again.'), { body: {} }));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Move FY26 in one word up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The event changed while you were saving');
    expect(titles()[0]).toBe('Before we start');
  });
});

describe('the pinned version', () => {
  it('"Use v3" is offered only where a newer version exists, and applies on a click', async () => {
    await mount();
    const offers = screen.getAllByRole('button', { name: /^Use v\d+$/ });
    expect(offers.map((b) => b.textContent)).toEqual(['Use v3']);
    expect(within(screen.getAllByTestId('agenda-row')[2]).getByRole('button', { name: 'Use v3' })).toBe(offers[0]);
    expect(api.updateItem).not.toHaveBeenCalled();
    fireEvent.click(offers[0]);
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', { version: 3 }));
    await waitFor(() => expect(api.getEvent).toHaveBeenCalledTimes(2));
  });

  it('a set that is gone says so on its row', async () => {
    serve([{ ...DAY[0], set: { missing: true, name: null, questionCount: 0, latestVersion: null } }]);
    await mount();
    expect(screen.getByText('This question set is no longer available')).toHaveClass('evb-sub--bad');
  });
});

describe('the add menu (02, 02b)', () => {
  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /add item/i }));
  const item = (name) => screen.getByRole('menuitem', { name: new RegExp(`^${name}`) });

  it('at 8 engagements the kinds are disabled with the reason above them; Break stays open', async () => {
    await mount();
    openMenu();
    const reason = document.getElementById('evb-capwhy');
    expect(reason).toHaveTextContent(rules.CAP_SENTENCES.engagements);
    expect(reason).toHaveTextContent('Breaks can still be added.');
    for (const name of ['Trivia', 'Call & Answer', 'Poll', 'Wavelength']) {
      expect(item(name)).toBeDisabled();
      expect(item(name)).toHaveAttribute('aria-describedby', 'evb-capwhy');
    }
    expect(item('Break')).toBeEnabled();
  });

  it('below the cap an engagement kind opens its dialog, and the menu closes', async () => {
    serve(DAY.slice(0, 3));
    await mount();
    openMenu();
    expect(document.getElementById('evb-capwhy')).toBeNull();
    fireEvent.click(item('Trivia'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Add Trivia' })).toBeInTheDocument();
  });

  it('Presentation and Survey are listed, disabled, and say they are coming', async () => {
    serve(DAY.slice(0, 3));
    await mount();
    openMenu();
    expect(item('Presentation')).toBeDisabled();
    expect(item('Presentation')).toHaveTextContent('Coming soon.');
    expect(item('Survey')).toBeDisabled();
    expect(item('Survey')).toHaveTextContent('Coming soon.');
  });

  it('Escape closes the menu', async () => {
    await mount();
    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Edit opens the item\'s own dialog', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit FY27 plan quiz' }));
    expect(screen.getByRole('heading', { name: 'Edit Trivia' })).toBeInTheDocument();
  });

  it('an empty agenda says what to do, and the foot still adds up', async () => {
    serve([]);
    render(<EventBuilder code="5307" sets={[]} />);
    expect(await screen.findByTestId('agenda-empty')).toHaveTextContent('Nothing on the agenda yet.');
    expect(screen.getByTestId('agenda-foot')).toHaveTextContent('Ends 9:00 · 0 min planned · 0 of 16 items');
  });
});
```

- [ ] **Step 2: Append the builder's contract to the palette test**

Append to the end of `src/src/__tests__/eventBuilderPalette.test.js`:

```js

describe('the agenda place (02, 02b)', () => {
  test.each([
    ['titles and times on the panel', T.text, PANEL],
    ['source lines and the foot on the panel', T.muted, PANEL],
    ['the join code and "the most an event can hold" in amber', T.primary, PANEL],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
  });
  test('a break row, the row being moved, and the cap\'s reason', () => {
    expect(on(T.muted, [T.bg, T.surface, tint('--evb-tint-brk')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, [T.bg, T.surface, tint('--evb-row-sel')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, T.surface, tint('--evb-row-sel')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, [T.bg, T.surface, tint('--evb-tint-cap')])).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, [T.bg, T.surface, tint('--evb-tint-cap')])).toBeGreaterThanOrEqual(AA);
  });
  test('the cap\'s reason is never drawn at the disabled opacity', () => {
    const note = stripped(MY_CSS).match(/\.evb-capnote\s*\{([^}]*)\}/)[1];
    expect(note).not.toMatch(/opacity/);
  });
  test('the agenda is fixed-layout and its row actions never use flex-end (hard rules 9 and 11)', () => {
    const css = stripped(MY_CSS);
    expect(css).toMatch(/\.evb-tbl\s*\{[^}]*table-layout:\s*fixed/);
    expect(css).toMatch(/\.evb-rowact > :first-child\s*\{\s*margin-left:\s*auto;\s*\}/);
    expect(css).not.toMatch(/\.evb-rowact\s*\{[^}]*justify-content:\s*flex-end/);
  });
  test('a truncating title is one text node with min-width 0 (hard rule 8)', () => {
    const nm = stripped(MY_CSS).match(/\.evb-nm\s*\{([^}]*)\}/)[1];
    expect(nm).toMatch(/min-width:\s*0/);
    expect(nm).toMatch(/text-overflow:\s*ellipsis/);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

```bash
cd src && npm test -- eventBuilder 2>&1 | grep -E "Cannot find|✕|Test Suites:"
```

Expected: `Cannot find module '../components/EventBuilder' from 'src/__tests__/eventBuilder.test.jsx'`; in the palette suite the builder's checks fail — `TypeError: Cannot read properties of null (reading '1')` for the `.evb-capnote` and `.evb-nm` rules that do not exist yet, and the fixed-layout `.evb-tbl` match — `Test Suites: 2 failed`.

- [ ] **Step 4: Add the grip icon**

In `src/src/components/Icon.jsx`, the name `DeviceMobile,` appears twice — in the `@phosphor-icons/react` import list and in the `ICONS` map. After each, add a line `  DotsSixVertical,`. (`__tests__/designSystem.test.jsx` asserts every entry resolves; Phosphor ships `DotsSixVertical`.)

- [ ] **Step 5: Append the builder to the stylesheet**

Append to the end of `src/src/components/EventBuilder.css`:

```css

/* ======================================================= the agenda place ==
   Everything below is the builder itself (EventBuilder.jsx). */
.evb-alert {
  display: flex; align-items: center; gap: 9px; margin: 0 0 14px; padding: 9px 12px;
  border: 1px solid var(--evb-rule-strong); border-left: 3px solid var(--danger); border-radius: 6px;
  background: var(--evb-tint-danger); color: var(--danger-text);
}
.evb-alert > span { flex: 1 1 auto; min-width: 0; }
.evb-loading { color: var(--muted); }

/* The event's facts: each said once, each with its label. The code is the
   one display numeral the place is allowed. */
.evb-facts {
  display: flex; flex-wrap: wrap; margin: 0 0 14px; border: 1px solid var(--evb-rule);
  border-radius: 10px; background: var(--surface);
}
.evb-fact { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding: 10px 16px; border-right: 1px solid var(--evb-rule); }
.evb-fact:last-child { border-right: 0; }
.evb-lab { font-size: var(--evb-t-floor); font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); }
.evb-v { font-size: var(--evb-t-body); font-weight: 600; white-space: nowrap; }
.evb-code { font: 800 var(--evb-t-numeral)/1 var(--font-display); letter-spacing: .08em; color: var(--primary); }
.evb-facts-acts { flex-direction: row; align-items: center; margin-left: auto; }

.evb-panel { position: relative; margin: 0 0 14px; border: 1px solid var(--evb-rule); border-radius: 10px; background: var(--surface); }
.evb-panel-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding: 11px 14px; border-bottom: 1px solid var(--evb-rule); }
.evb-panel-head h2 { margin: 0; font: 700 var(--evb-t-head)/1.2 var(--font-display); }
.evb-note { margin: 0; font-size: var(--evb-t-label); color: var(--muted); }
.evb-menuwrap { position: relative; margin-left: auto; }

/* The agenda table: the console's table plus a grip, a place and a time. */
.evb-tbl { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
.evb-tbl th {
  text-align: left; font-size: var(--evb-t-floor); font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
  color: var(--muted); padding: 9px 10px 7px; white-space: nowrap; border-bottom: 1px solid var(--evb-rule-strong);
}
.evb-tbl td {
  height: var(--evb-row-h); padding: 0 10px; border-bottom: 1px solid var(--evb-rule);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.evb-tbl tbody tr:hover td { background: var(--evb-row-hover); }
.evb-tbl .evb-row--brk td { background: var(--evb-tint-brk); }
.evb-tbl .evb-row--moving td { background: var(--evb-row-sel); }
.evb-col-grip { width: 30px; }
.evb-col-no { width: 34px; }
.evb-col-at { width: 66px; }
.evb-col-type { width: 158px; }
.evb-col-len { width: 74px; }
.evb-col-acts { width: 196px; }
.evb-grip { color: var(--muted); text-align: center; cursor: grab; }
.evb-no { text-align: right; font-weight: 700; font-size: var(--evb-t-label); color: var(--muted); }
.evb-at { font-weight: 700; }
.evb-len-cell { text-align: right; }
.evb-nm { display: block; min-width: 0; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.evb-row--brk .evb-nm { font-weight: 500; color: var(--muted); }
.evb-sub { display: block; min-width: 0; font-size: var(--evb-t-label); color: var(--muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.evb-sub--bad { color: var(--danger-text); }
/* A type is an icon AND a word, everywhere (colour never alone). */
.evb-type {
  display: inline-flex; align-items: center; gap: 5px; font-size: var(--evb-t-floor); font-weight: 600; line-height: 1.5;
  padding: 2px 8px 2px 6px; border-radius: 999px; border: 1px solid var(--evb-rule-strong); color: var(--text); white-space: nowrap;
}
.evb-type--brk { border-color: transparent; color: var(--muted); }
/* Row actions: margin-left auto on the first child, never flex-end (hard rule 9). */
.evb-rowact { display: flex; gap: 5px; flex-wrap: wrap; }
.evb-rowact > :first-child { margin-left: auto; }
.evb-foot { padding: 11px 14px; font-size: var(--evb-t-label); color: var(--muted); }
.evb-foot b { color: var(--text); }
.evb-warn { margin-left: 6px; font-size: var(--evb-t-floor); font-weight: 700; color: var(--primary); }

/* The add menu: a popover under its button, so the one dialog behind it is
   the set picker — never a modal opened from a modal. */
.evb-menu {
  position: absolute; z-index: 40; top: 36px; right: 0; width: 392px; padding: 6px;
  border: 1px solid var(--evb-rule-strong); border-radius: 10px; background: var(--surface);
  box-shadow: 0 20px 48px rgba(0, 0, 0, .5);
}
.evb-menu-h { margin: 8px 10px 4px; font-size: var(--evb-t-floor); font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.evb-menu-item {
  display: flex; gap: 11px; align-items: flex-start; width: 100%; padding: 8px 10px; border: 0; border-radius: 7px;
  background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer;
}
.evb-menu-item:hover:not(:disabled) { background: var(--evb-row-hover); }
.evb-menu-item:disabled { opacity: .5; cursor: not-allowed; }
.evb-menu-item b { display: block; font-size: var(--evb-t-body); }
.evb-menu-item span { display: block; font-size: var(--evb-t-label); color: var(--muted); line-height: 1.4; }
.evb-menu-rule { border: 0; border-top: 1px solid var(--evb-rule); margin: 5px 4px; }
/* The cap's reason: full contrast, above the kinds it disables. A disabled
   control is exempt from contrast; the sentence saying why is not. */
.evb-capnote {
  margin: 2px 10px 8px; padding: 8px 10px; border-left: 3px solid var(--primary); border-radius: 0 6px 6px 0;
  background: var(--evb-tint-cap); font-size: var(--evb-t-label); color: var(--muted); line-height: 1.45;
}
.evb-capnote b { color: var(--text); font-weight: 600; }
```

- [ ] **Step 6: Write the builder**

Create `src/src/components/EventBuilder.jsx`:

```jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import EventDetailsDialog from './EventDetailsDialog';
import EventItemDialog from './EventItemDialog';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import { getEvent, reorderItems, updateItem } from '../utils/eventsApi';
import './EventBuilder.css';

/**
 * ONE EVENT'S AGENDA — docs/design/agenda-redesign/02-builder.html and
 * 02b-cap-reached.html. A place in the console (AdminPage draws the event's
 * name as the title and "Events" as the breadcrumb back).
 *
 *   - The facts, once each: date, start and zone, place, who can join, the
 *     code. "Edit details" opens the new-event dialog filled in.
 *   - The agenda table. Times are the start plus the running total
 *     (agenda-rules.agendaTimes, the same function the server's public agenda
 *     uses), so a move re-times every row after it at once.
 *   - Reorder three ways (RATIONALE §c, WCAG 2.5.7 — drag is never the only
 *     way): the grip, the ↑/↓ buttons, and Alt+↑/Alt+↓ on a focused row.
 *     Each move is saved as the whole order; a refusal puts the rows back
 *     and says why.
 *   - "Use vN" on an engagement whose set has a newer version than the one
 *     pinned — never applied silently.
 *   - The add menu, grouped as 02 draws it. At 8 engagements the engagement
 *     kinds disable WITH the reason above them (02b); Break stays open.
 *     Presentation and Survey are listed, disabled, "Coming soon": they are
 *     roadmap M5 and PLAN Phase 6.
 *   - The foot: the end time, the planned length and both caps, counted once.
 *
 * NOT HERE YET, and why: the Invitations and Reports tabs (PLAN Phases 3 and
 * 5) — a tab strip with one tab is a control people learn to ignore — and
 * "Rehearse on the stage" (roadmap M3).
 *
 * @param {string}   code     the event
 * @param {object[]} sets     the console's question sets, for the set picker
 * @param {Function} [onTitle] (title) => void — the place's heading follows a rename
 */
const TYPE_ICONS = {
  trivia: 'Brain',
  'call-and-answer': 'ChatCircleText',
  poll: 'ChartBar',
  wavelength: 'Waves',
  survey: 'ListChecks',
  presentation: 'Monitor',
  break: 'Clock',
};
const MENU_ENGAGEMENTS = [
  ['survey', 'A form people fill in at their own pace.'],
  ['trivia', 'Questions with one right answer. Scored, with standings.'],
  ['call-and-answer', 'Everyone writes an answer, then the room votes for the best.'],
  ['poll', 'One question at a time; each result revealed on the main screen.'],
  ['wavelength', 'Everyone gives a few words; the room’s shared language appears.'],
];

function sourceLine(item, until) {
  if (item.type === rules.BREAK) return { text: `Back at ${until} · not counted, not billed`, bad: false };
  if (!item.set) return { text: '', bad: false };
  if (item.set.missing) return { text: 'This question set is no longer available', bad: true };
  const version = item.setRef && item.setRef.version ? ` · v${item.setRef.version}` : '';
  return { text: `${item.set.name || 'Question set'}${version} · ${item.set.questionCount} questions`, bad: false };
}

export default function EventBuilder({ code, sets = [], onTitle }) {
  const [event, setEvent] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dragFrom, setDragFrom] = useState(null);
  const rowRefs = useRef({});
  const focusAfterMove = useRef(null);
  const menuRef = useRef(null);
  /* The caller's callback, read through a ref: AdminPage passes a fresh arrow
     on every render, and as a dependency of `load` it would reload the event
     on every render. */
  const titleRef = useRef(onTitle);
  titleRef.current = onTitle;

  const load = useCallback(async () => {
    try {
      const body = await getEvent(code);
      setEvent(body.event);
      setItems(Array.isArray(body.items) ? body.items : []);
      setError('');
      if (titleRef.current && body.event) titleRef.current(body.event.title);
    } catch (err) {
      setError(err.message || 'Could not load the event.');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (focusAfterMove.current && rowRefs.current[focusAfterMove.current]) {
      rowRefs.current[focusAfterMove.current].focus();
      focusAfterMove.current = null;
    }
  });

  useEffect(() => {
    if (!menuOpen) return undefined;
    const away = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);

  const move = async (from, to) => {
    if (to < 0 || to >= items.length || from === to) return;
    const before = items;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    focusAfterMove.current = moved.itemId;
    try {
      await reorderItems(code, next.map((it) => it.itemId));
      setError('');
    } catch (err) {
      setItems(before);
      setError(err.message || 'The new order was not saved.');
      if (err.body && err.body.code === 'agenda_changed') load();
    }
  };

  const pinLatest = async (item) => {
    try {
      await updateItem(code, item.itemId, { version: item.set.latestVersion });
      await load();
    } catch (err) {
      setError(err.message || 'The version was not changed.');
    }
  };

  if (loading && !event) return <div className="evb"><p className="evb-loading">Loading the event…</p></div>;
  if (!event) {
    return (
      <div className="evb">
        <div className="evb-alert" role="alert"><span>{error || 'This event could not be opened.'}</span></div>
      </div>
    );
  }

  const counts = rules.countItems(items);
  const { rows, endsAt, totalMinutes } = rules.agendaTimes(event.startsAt, items);
  const itemsFull = counts.items >= rules.MAX_ITEMS;
  const engagementsFull = counts.engagements >= rules.MAX_ENGAGEMENTS;
  const breaksFull = counts.breaks >= rules.MAX_BREAKS;
  const engagementReason = itemsFull ? rules.CAP_SENTENCES.items : (engagementsFull ? rules.CAP_SENTENCES.engagements : '');
  let n = 0;

  const openAdd = (type) => {
    setMenuOpen(false);
    setDialog({ mode: 'add', type });
  };
  const afterWrite = async () => {
    setDialog(null);
    await load();
  };

  return (
    <div className="evb">
      {error && (
        <div className="evb-alert" role="alert">
          <Icon name="Warning" weight="fill" size={16} color="currentColor" />
          <span>{error}</span>
        </div>
      )}

      <div className="evb-facts" data-testid="event-facts">
        <div className="evb-fact"><span className="evb-lab">Date</span><span className="evb-v">{rules.formatEventDay(event.startsAt)}</span></div>
        <div className="evb-fact">
          <span className="evb-lab">Starts</span>
          <span className="evb-v">{rules.formatStartTime(event.startsAt)} <span className="evb-dim">· {event.timeZone}</span></span>
        </div>
        {event.place && <div className="evb-fact"><span className="evb-lab">Place</span><span className="evb-v">{event.place}</span></div>}
        <div className="evb-fact"><span className="evb-lab">Who can join</span><span className="evb-v">Anyone with the code</span></div>
        <div className="evb-fact"><span className="evb-lab">Join code</span><span className="evb-code">{event.code}</span></div>
        <div className="evb-fact evb-facts-acts">
          <button type="button" className="evb-btn" onClick={() => setDetailsOpen(true)}>
            <Icon name="PencilSimple" weight="bold" size={14} color="currentColor" /> Edit details
          </button>
        </div>
      </div>

      <section className="evb-panel">
        <header className="evb-panel-head">
          <h2>Agenda</h2>
          <p className="evb-note">The host starts each item. Times are the plan, not a timer.</p>
          <div className="evb-menuwrap" ref={menuRef}>
            <button
              type="button"
              className="evb-btn evb-btn--primary"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name="Plus" weight="bold" size={14} color="currentColor" /> Add item
            </button>
            {menuOpen && (
              <div className="evb-menu" role="menu" aria-label="Add to the agenda">
                <h6 className="evb-menu-h">Answered by the room{engagementsFull ? ` · ${counts.engagements} of ${rules.MAX_ENGAGEMENTS}` : ''}</h6>
                {engagementReason && (
                  <p className="evb-capnote" id="evb-capwhy">
                    <b>{engagementReason.split('. ')[0]}.</b> {engagementReason.split('. ').slice(1).join('. ')}
                    {!breaksFull && ' Breaks can still be added.'}
                  </p>
                )}
                {MENU_ENGAGEMENTS.map(([type, sentence]) => {
                  const soon = !rules.ADDABLE_TYPES.includes(type);
                  const disabled = soon || Boolean(engagementReason);
                  return (
                    <button
                      key={type}
                      type="button"
                      role="menuitem"
                      className="evb-menu-item"
                      disabled={disabled}
                      aria-describedby={engagementReason && !soon ? 'evb-capwhy' : undefined}
                      onClick={() => openAdd(type)}
                    >
                      <Icon name={TYPE_ICONS[type]} weight="bold" size={17} color="var(--primary)" />
                      <div>
                        <b>{rules.TYPE_LABELS[type]}</b>
                        <span>{soon ? `Coming soon. ${sentence}` : (engagementReason ? '' : sentence)}</span>
                      </div>
                    </button>
                  );
                })}
                <hr className="evb-menu-rule" />
                <h6 className="evb-menu-h">Talks</h6>
                <button type="button" role="menuitem" className="evb-menu-item" disabled>
                  <Icon name={TYPE_ICONS.presentation} weight="bold" size={17} color="var(--primary)" />
                  <div>
                    <b>Presentation</b>
                    <span>Coming soon. A talk from the presenter’s own screen, with an optional PDF copy for attendees.</span>
                  </div>
                </button>
                <hr className="evb-menu-rule" />
                <h6 className="evb-menu-h">Just on the agenda</h6>
                <button type="button" role="menuitem" className="evb-menu-item" disabled={breaksFull} onClick={() => openAdd(rules.BREAK)}>
                  <Icon name={TYPE_ICONS.break} weight="bold" size={17} color="var(--primary)" />
                  <div>
                    <b>Break</b>
                    <span>{breaksFull ? rules.CAP_SENTENCES.breaks : 'A return time on the agenda. Not counted, not billed.'}</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </header>

        {items.length === 0 ? (
          <p className="evb-foot" data-testid="agenda-empty">
            Nothing on the agenda yet. <b>Add item</b> puts the first one here; the times follow from the start.
          </p>
        ) : (
          <table className="evb-tbl">
            <thead>
              <tr>
                <th className="evb-col-grip" aria-label="Drag" />
                <th className="evb-col-no">#</th>
                <th className="evb-col-at">Time</th>
                <th>Item</th>
                <th className="evb-col-type">Type</th>
                <th className="evb-col-len">Length</th>
                <th className="evb-col-acts" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((item, index) => {
                const isBreak = item.type === rules.BREAK;
                if (!isBreak) n += 1;
                const line = sourceLine(item, item.until);
                const newer = item.set && !item.set.missing && item.set.latestVersion
                  && item.setRef && item.setRef.version && item.set.latestVersion > item.setRef.version;
                const rowClass = [isBreak ? 'evb-row--brk' : '', dragFrom === index ? 'evb-row--moving' : ''].filter(Boolean).join(' ');
                return (
                  <tr
                    key={item.itemId}
                    ref={(el) => { rowRefs.current[item.itemId] = el; }}
                    className={rowClass || undefined}
                    tabIndex={0}
                    data-testid="agenda-row"
                    draggable
                    onDragStart={() => setDragFrom(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, index); setDragFrom(null); }}
                    onDragEnd={() => setDragFrom(null)}
                    onKeyDown={(e) => {
                      if (!e.altKey || e.target !== e.currentTarget) return;
                      if (e.key === 'ArrowUp') { e.preventDefault(); move(index, index - 1); }
                      if (e.key === 'ArrowDown') { e.preventDefault(); move(index, index + 1); }
                    }}
                  >
                    <td className="evb-grip" title="Drag to move, or Alt+↑ / Alt+↓">
                      <Icon name="DotsSixVertical" weight="bold" size={14} color="currentColor" />
                    </td>
                    <td className="evb-no">{isBreak ? <span title="Breaks are not numbered or counted">–</span> : n}</td>
                    <td className="evb-at" data-testid="agenda-at">{item.at}</td>
                    <td>
                      <span className="evb-nm" title={item.title}>{item.title}</span>
                      {line.text && <span className={`evb-sub${line.bad ? ' evb-sub--bad' : ''}`} title={line.text}>{line.text}</span>}
                    </td>
                    <td>
                      <span className={`evb-type${isBreak ? ' evb-type--brk' : ''}`}>
                        <Icon name={TYPE_ICONS[item.type] || 'Circle'} weight="bold" size={13} color="currentColor" />
                        {rules.TYPE_LABELS[item.type] || item.type}
                      </span>
                    </td>
                    <td className="evb-len-cell">{item.minutes} min</td>
                    <td>
                      <div className="evb-rowact">
                        {newer && (
                          <button type="button" className="evb-btn evb-btn--sm" onClick={() => pinLatest(item)}>
                            Use v{item.set.latestVersion}
                          </button>
                        )}
                        <button type="button" className="evb-btn evb-btn--sm evb-btn--icon" aria-label={`Move ${item.title} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>
                          <Icon name="ArrowUp" weight="bold" size={13} color="currentColor" />
                        </button>
                        <button type="button" className="evb-btn evb-btn--sm evb-btn--icon" aria-label={`Move ${item.title} down`} disabled={index === rows.length - 1} onClick={() => move(index, index + 1)}>
                          <Icon name="ArrowDown" weight="bold" size={13} color="currentColor" />
                        </button>
                        <button type="button" className="evb-btn evb-btn--sm" aria-label={`Edit ${item.title}`} onClick={() => setDialog({ mode: 'edit', type: item.type, item })}>
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="evb-foot" data-testid="agenda-foot">
          Ends <b>{endsAt}</b> · {rules.formatDuration(totalMinutes)} planned · <b>{counts.items}</b> of {rules.MAX_ITEMS} items
          {' '}· <b>{counts.engagements}</b> of {rules.MAX_ENGAGEMENTS} engagements
          {(itemsFull || engagementsFull) && <span className="evb-warn">· the most an event can hold</span>}
          {counts.breaks > 0 && <> · {counts.breaks} break{counts.breaks === 1 ? '' : 's'} <span className="evb-dim">(not counted)</span></>}
        </p>
      </section>

      {dialog && (
        <EventItemDialog
          code={event.code}
          mode={dialog.mode}
          type={dialog.type}
          item={dialog.item}
          items={items}
          sets={sets}
          onClose={() => setDialog(null)}
          onSaved={afterWrite}
          onRemoved={afterWrite}
        />
      )}
      {detailsOpen && (
        <EventDetailsDialog
          initial={event}
          onClose={() => setDetailsOpen(false)}
          onSaved={(saved) => {
            setDetailsOpen(false);
            setEvent({ ...event, ...saved });
            if (titleRef.current) titleRef.current(saved.title);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run them green**

```bash
cd src && npm test -- eventBuilder eventItemDialog designSystem modalReachability 2>&1 | grep -E "✕|not wrapped in act|Tests:|Test Suites:"
```

Expected: no `✕` and no act() warning; `Test Suites: 5 passed` (`eventBuilder.test.jsx` 16 tests, `eventBuilderPalette.test.js` 18). Then `cd src && npm run lint`: 0 errors — note `pinLatest` is deliberately not named `use…`, which `react-hooks/rules-of-hooks` would read as a hook.

- [ ] **Step 8: Look at it against the mockups.** Compare with `02-builder.html` and `02b-cap-reached.html` on :8124: the facts strip, the seven columns and their widths, a break row's tint and dash, the foot, the menu's three groups and the cap's reason above the disabled kinds.

- [ ] **Step 9: Commit**

```bash
git add src/src/components/EventBuilder.jsx src/src/components/EventBuilder.css src/src/components/Icon.jsx src/src/__tests__/eventBuilder.test.jsx src/src/__tests__/eventBuilderPalette.test.js
git commit -m "The agenda builder: a timed agenda, reorder three ways, Use vN, and the caps said where you add

EventBuilder (02, 02b) shows the event's facts once and its agenda timed from
the start by the same agendaTimes the public agenda uses, so a move re-times
every row after it. Rows move by the grip, the arrow buttons or Alt+arrows on
a focused row; a refused save puts them back and says why. Use vN appears
only where a newer version exists. At 8 engagements the add menu disables
the engagement kinds with the reason above them at full contrast and leaves
Break open; Presentation and Survey are listed as coming soon.

Tests: eventBuilder.test.jsx (new, the design's own 9:00-11:43 day);
eventBuilderPalette.test.js grows the builder's contract.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: Events in the console, behind the switch

`GET /orgs` tells the console whether this tier has Events on (`features.events`, read from the same `EVENTS_ENABLED` as the event routes). With it on, every org console gets **Events** right after Sessions — a Personal space too, so the feature can be found and its page can explain the plan (01b) — and platform mode never does. AdminPage mounts the list, or one event's builder as a place with "‹ Events" as its breadcrumb (the set editor's shape), puts "New event" in the work head for a Team-plan organisation, and sends "Request the Team plan" to the existing dialog.

**Files:**
- Modify: `lambda-functions/admin/orgs/list-my-orgs.js` (above `listMyOrgs`, ~38; the response, ~93–98)
- Create: `tests/events-switch.js`
- Modify: `src/src/config/consoleSections.js` (`SECTION`, `sectionsFor`)
- Modify: `src/src/__tests__/consoleSections.test.js` (a new `describe` at the end)
- Modify: `src/src/AdminPage.jsx` (imports; state beside `orgsLoaded` ~285; the `GET /orgs` effect ~297; `consoleIdentity` ~379–385; `handleNavigate` ~826–842 and the `popstate` handler ~870–878; `NEW_SECTION_HEADS` ~1414; the shell's `breadcrumb`, `title`, `subtitle` and `actions` ~1531–1582; the section bodies, above `{resolvedTab === 'orgs' && onPlatform && <PlatformOrgsPanel />}` ~1856)
- Modify: `src/src/__tests__/adminOneSection.test.jsx` (`MARKERS`, `serve`, a new `describe`)

**Interfaces:**
- Consumes: `eventsEnabled` (Task 4, `event-http.js`) — for the parity test; `EventsPanel`, `NewEventButton` (Task 12); `EventBuilder` (Task 14); `planFor` (`lambda-functions/game/pricing.js`, already imported by `PlanRequestDialog.jsx`); AdminPage's `questionSets`, `orgRole`, `activeOrg`, `visibleIds`, `handleNavigate`, `setShowPlanRequest`.
- Produces: `GET /orgs → {orgs, activeOrgId, features: {events: boolean}}`; `sectionsFor({…, eventsEnabled})` places `SECTION.events` (`{id:'events', label:'Events', icon:'CalendarBlank', contentTheme:'dark'}`) after `games` in the personal and org consoles when `eventsEnabled === true`.

- [ ] **Step 1: Write the failing switch test**

Create `tests/events-switch.js`:

```js
/**
 * THE EVENTS SWITCH, READ THE SAME WAY IN BOTH PLACES (roadmap D6).
 *
 * EVENTS_ENABLED decides two things: whether POST /events answers
 * (websocket/events/event-http.js `eventsEnabled`) and whether the console
 * shows Events at all — which it learns from GET /orgs `features.events`
 * (admin/orgs/list-my-orgs.js). Two readers of one variable can drift: a
 * console that shows the builder while the server refuses every create is a
 * page of controls that do nothing.
 *
 * rejects: the two readers disagreeing about any value; the switch on for
 * anything but the exact word "on"; GET /orgs dropping `features`.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const { installEventHarness, asHost, request, bodyOf } = require('./helpers/event-harness');

const h = installEventHarness({ eventsEnabled: null });
const { eventsEnabled } = h.load('lambda-functions/websocket/events/event-http.js');
const listMyOrgs = h.load('lambda-functions/admin/orgs/list-my-orgs.js').handler;

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

(async () => {
  for (const [value, on] of [
    [undefined, false], ['', false], ['off', false], ['yes', false], ['true', false],
    ['on', true], ['ON', true], [' on ', true],
  ]) {
    await check(`EVENTS_ENABLED=${JSON.stringify(value)}: both say ${on ? 'on' : 'off'}`, async () => {
      if (value === undefined) delete process.env.EVENTS_ENABLED; else process.env.EVENTS_ENABLED = value;
      assert.strictEqual(eventsEnabled(), on);
      const res = await listMyOrgs(request({
        method: 'GET', path: '/orgs',
        requestContext: asHost('', { groups: 'hosts', orgIds: '', userId: 'u_switch' }),
      }));
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.deepStrictEqual(bodyOf(res).features, { events: on });
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Write the failing nav test**

Append to the end of `src/src/__tests__/consoleSections.test.js`:

```js
describe('Events (roadmap M1), behind the switch', () => {
  // rejects: Events reaching test or prod before the owner asks (roadmap D6).
  test('off by default: nobody has an Events section', () => {
    for (const who of [TEAM_ADMIN, TEAM_MEMBER, PERSONAL]) expect(ids(who)).not.toContain('events');
  });
  test('on: a team admin and a team member get Events right after Sessions', () => {
    for (const who of [TEAM_ADMIN, TEAM_MEMBER]) {
      const list = ids({ ...who, eventsEnabled: true });
      expect(list[list.indexOf('games') + 1]).toBe('events');
    }
  });
  // rejects: hiding the door from a Personal space (01b explains the plan instead).
  test('on: a personal space gets Events too, so the Team plan can be explained', () => {
    const list = ids({ ...PERSONAL, eventsEnabled: true });
    expect(list[list.indexOf('games') + 1]).toBe('events');
  });
  test('on: platform mode and an account with no org never get Events', () => {
    expect(ids({ ...PLATFORM, eventsEnabled: true })).not.toContain('events');
    expect(ids({ ...NO_ORG, eventsEnabled: true })).not.toContain('events');
  });
  test('a truthy value that is not true does not switch it on', () => {
    expect(ids({ ...TEAM_ADMIN, eventsEnabled: 'on' })).not.toContain('events');
  });
  test('the section is dusk and says what an event is', () => {
    const section = sectionById({ ...TEAM_ADMIN, eventsEnabled: true }, 'events');
    expect(section.contentTheme).toBe('dark');
    expect(section.icon).toBe('CalendarBlank');
    expect(section.subtitle).toMatch(/One join code for a whole agenda/);
  });
});
```

- [ ] **Step 3: Write the failing page test**

In `src/src/__tests__/adminOneSection.test.jsx`, add `Events` to `MARKERS` — replace

```js
  'Public library': '.publib',
};
```

with

```js
  'Public library': '.publib',
  Events: '.evts',
};
```

— let `serve` carry features — replace

```js
function serve(orgs = [HOME]) {
  global.fetch = jest.fn(async (url) => (String(url).includes('/orgs')
    ? { ok: true, status: 200, text: async () => '{}', json: async () => ({ orgs }) }
```

with

```js
function serve(orgs = [HOME], features = undefined) {
  global.fetch = jest.fn(async (url) => (String(url).includes('/orgs')
    ? { ok: true, status: 200, text: async () => '{}', json: async () => ({ orgs, ...(features ? { features } : {}) }) }
```

— and append at the end of the file:

```js
describe('Events (roadmap M1), behind the switch', () => {
  const TEAM = {
    orgId: 'org_TEAMteamTEAMteamTEAMte', name: 'Northwind Traders', type: 'team', yourRole: 'owner', plan: 'team',
  };

  // rejects: Events mounting beside another section, or headed with another's sentence.
  it('switched on, ?section=events opens Events on its own, with New event in the head', async () => {
    mockGroups = ['hosts'];
    mockActiveOrg = TEAM.orgId;
    window.history.pushState({}, '', '/admin?section=events');
    serve([TEAM], { events: true });
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Events']));
    expect(document.querySelector('h1')).toHaveTextContent('Events');
    expect(document.querySelector('.adm-sub')).toHaveTextContent(/One join code for a whole agenda/);
    expect(screen.getByRole('button', { name: /new event/i })).toBeInTheDocument();
  });

  // rejects: the switch being a nav decoration the URL can walk round.
  it('switched off, the same link falls back to one section', async () => {
    mockGroups = ['hosts'];
    mockActiveOrg = TEAM.orgId;
    window.history.pushState({}, '', '/admin?section=events');
    serve([TEAM]);
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Question sets']));
    expect(screen.queryByRole('button', { name: /^events$/i })).toBeNull();
  });

  it('a Personal space gets the page that explains the Team plan, and no New event', async () => {
    mockGroups = ['hosts'];
    mockActiveOrg = HOME.orgId;
    window.history.pushState({}, '', '/admin?section=events');
    serve([HOME], { events: true });
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(screen.getByTestId('events-team-only')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /new event/i })).toBeNull();
  });
});
```

- [ ] **Step 4: Run them and watch them fail**

```bash
node tests/events-switch.js 2>/dev/null | tail -1; echo "exit=$?"
cd src && npm test -- consoleSections adminOneSection 2>&1 | grep -E "✕|Test Suites:"
```

Expected: `events-switch.js` — every row FAILs (`features` is `undefined`, never `{events: …}`), exit 1; the frontend — three nav tests fail ("on: a team admin and a team member…", "on: a personal space…", "the section is dusk…"; the three "never" tests already hold) and two page tests fail ("switched on, ?section=events opens Events…", "a Personal space gets the page…"); `Test Suites: 2 failed`.

- [ ] **Step 5: `GET /orgs` says whether Events is on**

In `lambda-functions/admin/orgs/list-my-orgs.js`, replace

```js
async function listMyOrgs(event) {
```

with

```js
/*
  WHICH SWITCHED FEATURES THIS TIER HAS ON (roadmap D6). The console reads it
  to decide whether Events is in the nav at all. The same variable, read the
  same way, is what makes POST /events refuse
  (websocket/events/event-http.js `eventsEnabled`); tests/events-switch.js
  holds the two together. A property of the tier, not of any organisation, so
  it sits beside the list rather than on an org in it.
*/
const eventsEnabled = () => String(process.env.EVENTS_ENABLED || '').trim().toLowerCase() === 'on';

async function listMyOrgs(event) {
```

and replace

```js
    activeOrgId: tenant.callerOrgId(event),
  });
```

with

```js
    activeOrgId: tenant.callerOrgId(event),
    features: { events: eventsEnabled() },
  });
```

- [ ] **Step 6: The nav has an Events section, behind the switch**

In `src/src/config/consoleSections.js`, in `SECTION`, replace

```js
  library: {
    id: 'library',
```

with

```js
  /*
    EVENTS (docs/design/agenda-redesign 01, 01b; roadmap M1) — one code for a
    whole agenda. Under Sessions, because every engagement in an event runs as
    a session. Shown only while the tier has the feature switched on
    (`eventsEnabled`, from GET /orgs `features.events`, roadmap D6). A space
    not on the Team plan still gets the item, so the feature can be found: its
    page explains the plan (01b) rather than hiding the door.
  */
  events: {
    id: 'events',
    label: 'Events',
    icon: 'CalendarBlank',
    title: 'Events',
    subtitle: 'One join code for a whole agenda: engagements and breaks, in the order you run them.',
    contentTheme: 'dark',
  },
  library: {
    id: 'library',
```

In `sectionsFor`'s doc comment, replace

```js
 *                                  say "Your space" and "Engage".
 * @returns {Array<{id:string,label:string,items:Array<object>}>}
```

with

```js
 *                                  say "Your space" and "Engage".
 * @param {boolean} [input.eventsEnabled] GET /orgs `features.events`: this
 *                                  tier has Events switched on (roadmap D6)
 * @returns {Array<{id:string,label:string,items:Array<object>}>}
```

Replace the signature

```js
export function sectionsFor({
  groups = [], orgRole = '', orgType = '', orgName = '', mode = '',
} = {}) {
```

with

```js
export function sectionsFor({
  groups = [], orgRole = '', orgType = '', orgName = '', mode = '', eventsEnabled = false,
} = {}) {
```

and, right after it, replace

```js
  const type = String(orgType || '');
  const role = String(orgRole || '').toLowerCase();
```

with

```js
  const type = String(orgType || '');
  const role = String(orgRole || '').toLowerCase();
  /* Events sit right after Sessions in every org console, and nowhere while
     the switch is off. Platform mode never gets them: it has no sessions. */
  const events = eventsEnabled === true ? [SECTION.events] : [];
```

Then in the personal group replace

```js
      group('space', 'Your space', [
        SECTION.questionsets,
        SECTION.games,
        SECTION.library,
```

with

```js
      group('space', 'Your space', [
        SECTION.questionsets,
        SECTION.games,
        ...events,
        SECTION.library,
```

and in the org group replace

```js
  const content = group('org', orgName || 'Your organisation', [
    SECTION.questionsets,
    SECTION.games,
    SECTION.library,
```

with

```js
  const content = group('org', orgName || 'Your organisation', [
    SECTION.questionsets,
    SECTION.games,
    ...events,
    SECTION.library,
```

- [ ] **Step 7: AdminPage mounts the list and the builder place**

In `src/src/AdminPage.jsx`:

1. Imports — replace `import PrivacyPanel from './components/PrivacyPanel';` with

```js
import PrivacyPanel from './components/PrivacyPanel';
import EventsPanel, { NewEventButton } from './components/EventsPanel';
import EventBuilder from './components/EventBuilder';
import pricing from '../../lambda-functions/game/pricing';
```

2. State — replace `  const [orgsLoaded, setOrgsLoaded] = useState(false);` with

```js
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  /* WHICH SWITCHED FEATURES THIS TIER HAS ON — GET /orgs `features`
     (admin/orgs/list-my-orgs.js). Only `events` exists (roadmap D6). */
  const [features, setFeatures] = useState({});
  /* EVENTS: the event open in the builder place, `{code, title}`, or null
     for the list; and whether the new-event dialog is open. */
  const [eventPlace, setEventPlace] = useState(null);
  const [creatingEvent, setCreatingEvent] = useState(false);
```

3. The `GET /orgs` effect — replace `        setOrgs(list);` with

```js
        setOrgs(list);
        setFeatures(data.features && typeof data.features === 'object' ? data.features : {});
```

4. `consoleIdentity` — replace

```js
    mode: onPlatform ? PLATFORM_MODE : '',
  };
```

with

```js
    mode: onPlatform ? PLATFORM_MODE : '',
    eventsEnabled: features.events === true,
  };
  /* The Team plan by the same rule the server gates on (pricing.js planFor):
     anything but an explicit 'team' plan is not the Team plan. */
  const eventsTeamPlan = Boolean(activeOrg) && pricing.planFor(activeOrg).id === 'team';
```

5. `handleNavigate` — replace

```js
      // Leaving a section closes any place open inside it — the score card is
      // the Public library's version of the detail place editingSet is above.
      setScoreCardId('');
    }
```

with

```js
      // Leaving a section closes any place open inside it — the score card is
      // the Public library's version of the detail place editingSet is above.
      setScoreCardId('');
      // …and the event builder is the Events section's.
      setEventPlace(null);
      setCreatingEvent(false);
    }
```

and in the `popstate` handler replace

```js
          setScoreCardId('');
        }
        return next;
```

with

```js
          setScoreCardId('');
          setEventPlace(null);
        }
        return next;
```

6. `NEW_SECTION_HEADS` — replace `  const NEW_SECTION_HEADS = {` with

```js
  const NEW_SECTION_HEADS = {
    events: {
      id: 'events',
      title: 'Events',
      subtitle: 'One join code for a whole agenda: engagements and breaks, in the order you run them.',
      contentTheme: 'dark',
    },
```

7. The shell — replace

```js
        breadcrumb={
          billingPlace && resolvedTab === 'billing'
```

with

```js
        breadcrumb={
          eventPlace && resolvedTab === 'events'
            ? { parentLabel: 'Events', onBack: () => setEventPlace(null) }
            : billingPlace && resolvedTab === 'billing'
```

replace

```js
        title={
          billingPlace && resolvedTab === 'billing'
```

with

```js
        title={
          eventPlace && resolvedTab === 'events'
            ? (eventPlace.title || `Event ${eventPlace.code}`)
            : billingPlace && resolvedTab === 'billing'
```

replace

```js
        subtitle={
          (billingPlace && resolvedTab === 'billing') || editingSet
```

with

```js
        subtitle={
          (eventPlace && resolvedTab === 'events') || (billingPlace && resolvedTab === 'billing') || editingSet
```

and replace

```js
        actions={(
          <>
```

with

```js
        actions={(
          <>
            {resolvedTab === 'events' && activeOrg && !eventPlace && eventsTeamPlan && (
              <NewEventButton onClick={() => setCreatingEvent(true)} />
            )}
```

8. The section body — replace `          {resolvedTab === 'orgs' && onPlatform && <PlatformOrgsPanel />}` with

```jsx
          {/* EVENTS (docs/design/agenda-redesign 01, 01b, 02): the list, or one
              event's agenda as a place with a breadcrumb back — the set
              editor's shape. `events` is only in the nav while GET /orgs says
              features.events, so `resolvedTab` cannot be it otherwise. */}
          {resolvedTab === 'events' && activeOrg && (eventPlace ? (
            <EventBuilder
              code={eventPlace.code}
              sets={questionSets}
              onTitle={(title) => setEventPlace((place) => (place && place.title !== title ? { ...place, title } : place))}
            />
          ) : (
            <EventsPanel
              teamPlan={eventsTeamPlan}
              creating={creatingEvent}
              onCreatingChange={setCreatingEvent}
              onOpen={(code, title) => setEventPlace({ code, title })}
              onRequestPlan={orgRole === 'owner' || activeOrg.type === 'personal' ? () => setShowPlanRequest(true) : undefined}
              onShowPlan={visibleIds.includes('billing') ? () => handleNavigate('billing') : undefined}
            />
          ))}

          {resolvedTab === 'orgs' && onPlatform && <PlatformOrgsPanel />}
```

The `onTitle` updater returns the same object when the title has not changed, so a reload of the builder does not re-render the page for nothing; `EventBuilder` reads `onTitle` through a ref, so the fresh arrow each render does not reload the event.

- [ ] **Step 8: Run them green**

```bash
node tests/events-switch.js 2>/dev/null | tail -1
for t in personal-orgs org-lifecycle; do node tests/$t.js > /dev/null 2>&1; echo "$t exit=$?"; done
cd src && npm test -- consoleSections adminOneSection adminOrgWiring adminDeepLink AdminPage consoleModes 2>&1 | grep -E "✕|Tests:|Test Suites:"
```

Expected: `8 passed, 0 failed`; both backend suites `exit=0`; no `✕`, `Test Suites: 6 passed`.

- [ ] **Step 9: The full gate.** The backend loop: `fail=0`. `cd src && npm test`: every suite green (the baseline's count plus the six new suites of Tasks 11–14). `cd src && npm run lint`: 0 errors, the warnings count unchanged. `cd src && npm run build`: passes with its two size warnings.

- [ ] **Step 10: Know what the browser will show before dev has it.** `cd src && npm start` runs the console against engagedev. Until this branch reaches dev, engagedev's `GET /orgs` carries no `features`, so Events stays hidden locally — that is the switch working, not a fault. The walk in the browser happens on dev after the push (see "Landing M1 on dev" below).

- [ ] **Step 11: Commit**

```bash
git add lambda-functions/admin/orgs/list-my-orgs.js tests/events-switch.js src/src/config/consoleSections.js src/src/__tests__/consoleSections.test.js src/src/AdminPage.jsx src/src/__tests__/adminOneSection.test.jsx
git commit -m "Events appears in the console where the tier has it switched on: the list, and each event's builder as a place

GET /orgs answers features.events from the same EVENTS_ENABLED the event
routes read, and the nav gains Events after Sessions in every org console
while it is on - a Personal space too, whose page explains the Team plan -
and never in platform mode. AdminPage mounts the list or one event's builder
with Events as its breadcrumb, puts New event in the work head for a
Team-plan organisation, and sends Request the Team plan to the existing
dialog.

Tests: tests/events-switch.js (new); consoleSections.test.js and
adminOneSection.test.jsx grow Events cases.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Landing M1 on dev (after Task 15, per roadmap §4)

1. **One integration branch.** Merge the task branches in order; resolve nothing by hand in `tenant.js` or `tenant-crypto.js` — re-copy the game copy over the other two and let `tests/tenant-keys.js` §8 and `tests/tenant-crypto.js` §8 judge.
2. **The full gate** on the integration branch: the backend loop `fail=0` (its suite count is the baseline plus the eleven new event suites), `cd src && npm test` green, `npm run lint` 0 errors, `npm run build` passing.
3. **Push `dev`** (the branch, never a tag as well). Watch `engagecicd-pipeline-dev` to green (`AWS_PROFILE=adminaccess`); name the commit and the tier in the handoff.
4. **Walk it on https://engage.dev.seibtribe.us at 1280 wide** (and once at 768: the console is a laptop surface, but a host may open it on a tablet), signed in, with screenshots in the handoff:
   - a Team-plan organisation: Events in the nav after Sessions; an empty list; New event (05), both exits, a create; the builder (02) with its facts; add trivia from the picker (03), a break, a poll; reorder with the arrows and with Alt+arrows; Use vN after saving a new version of a set; fill the eighth engagement and open the menu (02b); Edit and Remove;
   - a Personal space: Events shows 01b, and Request the Team plan opens the existing dialog;
   - `curl https://ouv6fztlig.execute-api.us-east-1.amazonaws.com/dev/events/<code>/agenda` and `…/join/<code>` without a token: the agenda and `{kind:'event', …}`;
   - on test, which is off: no Events in the nav (after the next promotion, not now).
5. **Not done until walked** (roadmap §4). Fix what the walk finds with a maker/checker pair before calling M1 landed.

---

## Self-Review

**1. Spec coverage — the roadmap's M1 list**

| M1 requirement | Where |
|---|---|
| Events in the console for Team-plan orgs, and the Personal-space explanation (01, 01b) | Task 12 (`EventsPanel`, `TeamPlanOnly`), Task 15 (nav, mounting, the plan rule `planFor`) |
| New event (05) | Task 12 (`EventDetailsDialog`, create), Task 14 (edit from the facts strip), Task 4 (`POST /events`), Task 6 (`PUT /events/{code}`) |
| The agenda builder (02, 02b): reorder, times that follow the order | Task 14 (three ways; `agendaTimes`), Task 8 (`PUT …/items`), Task 2 (the arithmetic) |
| Caps of 16 items and 8 engagements, in the builder AND on the server | Task 2 (`capRefusal`, `CAP_SENTENCES`), Task 7 (the transaction's condition, the race test), Task 14 (the menu at the cap, 02b) |
| Add an engagement (03): set, pinned version, title, description, length | Task 13 (picker, version shown, "On this agenda"), Task 7 (`pinSet`, the event's org only), Task 8 ("Use vN") |
| Add a break | Task 13 (break mode), Task 7 (uncounted, `BreakCount`) |
| Presentations in the add menu, disabled, "Coming soon" | Task 14 (menu), Task 7 (server refuses `presentation`), Task 2 (`COMING_SOON`) |
| `GET /events/{code}/agenda` — times, titles, types, descriptions; no links for planned items | Task 9 |
| `GET /join/{code}` — kind, access, title, date, nothing more | Task 9 |
| Keys in the three `tenant.js` copies (`eventsIndexPk`, `eventPk`) | Task 1 |
| `event` and `item` crypto entities in the three `tenant-crypto.js` copies | Task 1 |
| `reserveCode(db, {orgId, ttl, kind})`, extracted and used by session and event create; consistent with bug sweep Task 2; no code drawn while `EVENT#` rows exist | Task 3 (and Before you start, item 1) |
| `lambda-functions/events/` CRUD + items routes | Tasks 4–9, in `websocket/events/` (a decision, stated above) |
| The Team-plan 402 gate | Task 4 |
| `EVENTS_ENABLED` (D6), following `TEAM_WORKIE_AUTHORING`, and the frontend's channel | Task 4 (template, `eventsEnabled`, POST refused), Task 15 (`GET /orgs` `features`, nav) |
| `ITEM.State` created `planned` only | Task 7 (born planned), Tasks 7–8 (every write conditioned on it), Task 9 (no link before a start) |
| Event lifetime / ttl, justified | Task 2 (`eventTtl` and its header), Task 4 (all rows), Task 6 (moves with the date) |

**PLAN.md Phase 1, the bullets that are M1's:** keys (Task 1); encryption — PLAN names the `item` entity's Title only, and the roadmap and PLAN's own "ITEM.Description is encrypted with the item entity" put Description in too (Task 1); code reservation with `Kind` only on the reservation (Task 3); `create-event.js`, `get-events.js`, `get-event.js`, `update-event.js`, `items.js`, `resolve-code.js` (Tasks 4–9; the agenda read is `get-agenda.js`, which PLAN's list lacks); caps in the builder and on the server with `tests/event-caps.js` (Tasks 7, 14); Team-plan gate — PLAN names `tests/event-plan-gate.js`, which is §2 of `tests/event-create.js` here; breaks left out of both caps (Tasks 2, 7); `tests/event-keys.js`, `tests/no-global-partition-literals.js` with no new allowlist entry, `tests/event-code-reservation.js`, `tests/event-routes-authorization.js`, `tests/tenant-crypto.js` §8 (the new §7b sits beside it); console section after `games` with `contentTheme: 'dark'` (Task 15); `EventsPanel.jsx` and `EventBuilder.jsx` with one scoped stylesheet each (Tasks 12–14); the add menu as a popover and the set picker as the one `Modal` (Tasks 13–14); `__tests__/eventBuilder.test.jsx` ("keyboard reorder recomputes times"; "Use v3 only when a newer version exists") and `eventBuilderPalette.test.js` (Tasks 13–14). The `tests/event-item-state.js` checks ("no link … for a planned item; only the host moves the state") are in `tests/event-public-reads.js` §1 and `tests/event-caps.js` / `tests/event-item-edit.js`.

**Deliberately not M1** (the roadmap's later milestones): `start-item`/`end-item`/`end-event`, the child session and `EventRef`, the meter's event ledger, the day's standings, rehearsal (M3); attendees, tokens, `useJoinCode`, the attendee agenda screens (M2); WebSocket `follow` (M4); presentations and decks (M5); invitations (PLAN 3); the hub and report sharing (PLAN 5).

**2. Placeholder scan.** Searched the plan for "TBD", "TODO", "implement later", "fill in", "appropriate", "similar to Task", "as above", "etc." in steps: none. Every code step is the full file or an exact find-and-replace; every test step is the full test; every run step names the command and its expected output. Line numbers are "~" where a parallel change (the bug sweep) may shift them, and each edit is anchored on text, not on a number.

**3. Name consistency.** Checked across tasks: `eventsIndexPk`, `eventPk`, `callerMayManageEvent` (Task 1 → 4, 5, 10); `reserveCode`, `claimCode`, `releaseCode`, `codeHasRows`, `CodeSpaceExhausted` (Task 3 → 4); `event-store` exports grow in Tasks 4 → 5 → 6 and every later import names an export that exists by then (`isCancelled` and `AGENDA_CHANGED` land in Task 6, first used in Tasks 6–8); `agenda-rules` names are the same in the handlers and in `EventsPanel`, `EventDetailsDialog`, `EventItemDialog`, `EventBuilder`; `eventsApi` function names are the same in Task 11 and in the three components and their `jest.mock` factories; the route paths in `template-clean.yaml`, `authorizer.js`, the handlers and `eventsApi.js` agree (`/events`, `/events/{code}`, `/events/{code}/items`, `/events/{code}/items/{itemId}`, `/events/{code}/agenda`, `/join/{code}`); test ids used by tests exist in the components (`event-row`, `events-empty`, `events-nomatch`, `events-team-only`, `set-row`, `remove-confirm`, `event-facts`, `agenda-row`, `agenda-at`, `agenda-foot`, `agenda-empty`).

**4. Review Focus coverage.** Each of the five lines above has its test in the task it names: the race (Task 7 §4, `table.hold`; Task 8's insert-during-reorder; Task 13's kept choices), code lifetime (Task 3 §4–§5), the moved date (Task 6 §2, including the `Kind` condition), the out-of-date tab (Task 4 §1–§2; Task 12's refusal test), the changed set (Task 5 §2, Task 7 §2, Task 8 §1, Task 14's "Use v3" and missing-set tests).
