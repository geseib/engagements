# Events M1b: a richer agenda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Survey items, presentation placeholders and a new "Activity" kind join the agenda; every item but a break names who leads it (sealed); an engagement item carries every option the create dialog offers — through one shared options component — stored as a sealed settings map that roadmap M3 turns into its session through an explicit mapping; and a session (made by hand now, from an item in M3) can carry a goal of N questions that the stage and the phone remote announce without ever blocking.

**Architecture:** The create dialog's options block (categories, Workie's briefing and the Advanced fold) moves out of `GameSetupDialog.jsx` into `components/SessionOptions.jsx`, unchanged to the byte (a DOM snapshot recorded before the move proves it), and the event item dialog renders the same component. An item's options are one map, `Settings`, keyed exactly as the create dialog's payload, checked by `events/item-settings.js` with create's own rules and sealed whole with the `item` entity beside a new sealed `LedBy`. The goal is a pure rule in `session-goal.js` (a byte-identical pair in `websocket/` and `game/`), stored as METADATA `Target` by `POST /games` and `PUT /games/{id}`, read back only on the two host doors, and turned into words by the stage's dock, the SESSION panel and the remote. No Lambda function and no route is added.

**Tech Stack:** Node 18 Lambdas (AWS SDK v3 `lib-dynamodb`), single-table DynamoDB, SAM `template-clean.yaml` (unchanged), React 18 (webpack + jest 30 + Testing Library), backend tests as standalone `node tests/<file>.js` scripts.

**Spec:**
- The owner's words of 26 Sep 2026 and the controller's ten rulings — both copied in full into **Decisions** below, which is binding. Executors need no other copy.
- `docs/superpowers/plans/2026-09-26-events-roadmap.md` (§3 the item model; §4 M3, M5; §5 Global Constraints) and `docs/superpowers/plans/2026-09-26-events-m1-event-and-builder.md` (M1's data model, routes, tests and conventions, which this plan extends).
- The screens: `docs/design/agenda-redesign/03-add-item.html` (the item dialog), `04-add-presentation.html` (the presentation dialog, whose upload is M5), `02-builder.html` and `02b-cap-reached.html` (the builder and the caps), `p-05a-before.html` and `p-05-agenda.html` (the public agenda row "Presentation · Dana Whitfield"); `docs/design/session-setup-redesign/` (the create dialog's Advanced fold, which the item dialog reuses). Serve `docs/design/agenda-redesign/` on :8124 and look before building a screen.
- `.claude/skills/engage-design/SKILL.md` — tokens, measured contrast, the 12px floor, dialog exits, never a modal from a modal.

---

## Before you start

1. **M1 must be on your branch.** `git log --oneline -1 -- lambda-functions/websocket/events/items.js` prints a commit (M1 landed on `dev` by `8abe3d83`). If it prints nothing, stop and report `BLOCKED: Events M1 is not on this branch`.
2. **Record the baseline** before Task 1 — the backend loop (below), `cd src && npm test`, `cd src && npm run lint`, `cd src && npm run build` — and keep a note of the suite counts and any failure that is already there. Every task leaves these where it found them, plus its own new suites.
3. **The backend loop** (judge by exit code and by the suite count):

```bash
rm -rf .aws-sam lambda-functions/dist lambda-functions/admin/.aws-sam
fail=0; n=0
for f in tests/*.js; do n=$((n+1)); node "$f" >/dev/null 2>&1 || { fail=$((fail+1)); echo "FAIL $f"; }; done
echo "suites=$n fail=$fail"
```

`tests/no-retired-twin-references.js` reads `git ls-files`: `git add` a new file before the loop, or that suite cannot see it. The loop is zsh-safe as written; do not add `echo =====` lines to it.

4. **Frontend runs** are `cd src && npm test -- <pattern>`; read the `Test Suites:` line. Never `npx jest`, never `npm install` (a populated worktree loses 85 packages). A missing package is `NEEDS_CONTEXT`.

## Global Constraints

Every task's requirements include these. They are the roadmap's §5, M1's constraints, and what this milestone adds.

- **Deploying.** The pipeline is the only route to dev, test and prod, and a push to a tier branch deploys. Work in your worktree, commit there, never push, never tag, never merge into another branch. Claude pushes `dev` only after the full gate (backend loop 0 failed, `cd src && npm test` green, lint 0 errors, build passing). Never push a branch and a tag together.
- **No new Lambda function and no new route** (ruling 9: the stack holds about 440 of CloudFormation's 500 resources). Everything here changes existing handlers — `websocket/create-game.js`, `game/update-game.js`, `game/get-game.js`, `game/get-game-state.js`, `websocket/events/items.js`, `get-event.js`, `get-agenda.js` — or adds a module one of them requires. `template-clean.yaml` is not edited.
- **Copies stay identical.** `tenant-crypto.js` exists in `lambda-functions/game/`, `websocket/` and `admin/shared/`: edit the `game/` copy, then `cp` it over the other two; `tests/tenant-crypto.js` §8 holds them equal. `session-goal.js` is a NEW pair, `lambda-functions/websocket/session-goal.js` and `lambda-functions/game/session-goal.js`: edit the `websocket/` copy, `cp` it over the `game/` one; `tests/session-goal.js` §4 holds them equal. `tenant.js`, `session-ttl.js` and `set-version.js` are not edited.
- **Sealed.** A person's name is personal data: an item's `LedBy` is sealed with the `item` entity. An item's `Settings` is sealed whole (it carries Workie's briefing, instructions and event details, which a session seals). Every read decrypts through `event-store` (`decryptItemRow` / `openItemRow`); an item whose words cannot be opened shows blank words and no settings, never ciphertext.
- **The goal is the host's.** METADATA `Target` is returned on `GET /games/{id}/host-details` and `GET /games/{id}/host-state` only; the public `GET /games/{id}/state` never carries it. Progress ("Question 3 of 5") is shown in the host's SESSION panel and on the remote, never on the rail or the wall.
- **One options UI.** The categories grid, the briefing section and the Advanced fold exist once, in `components/SessionOptions.jsx`; `__tests__/sessionOptions.test.jsx` fails if any of their markers appears in another source file. **GameSetupDialog's existing tests are not edited**: `gameSetupDialog.test.jsx`, `gameSetupPalette.test.js`, `gameSetupCallSite.test.js`, `surveySetupNames.test.jsx`, `workieSettings.test.jsx`, `hostQuestionSets.test.jsx`, `gameSession.test.js`, `createGamePayload.test.js` and `setupDefaults.test.js` stay green without a line changed. New behaviour gets new test files.
- **Host routes** keep M1's door: Cognito, `event-store.openEvent` (no caller id → no read), and the one 404 for another organisation's event. Nothing here changes a door.
- **Logs** trace the request, never a header or a body (`tests/lambda-event-not-logged.js`). In `events/` the Lambda parameter stays `request`.
- **Items are still born `planned`**; start, pause and end are M3's. Every edit stays conditioned on `State = planned`.
- **Pure modules the browser imports** — `events/agenda-rules.js` and `session-goal.js` — hold no `require`, no `process` and no clock; their tests read them as text to prove it.
- **Tests.** Backend: `node tests/<file>.js`, judged by exit code; async suites arm `tests/helpers/finish-guard.js` and call `suiteFinished()` before `process.exit`; handler suites use `tests/helpers/event-harness.js` (its table evaluates conditions and applies transactions all-or-nothing). Frontend: `cd src && npm test -- <pattern>`. The pipeline runs jest on Node 18: no Node-20+ API in code or tests.
- **Design.** Build from the mockups named in each task. Colour through tokens only; contrast measured in a `*Palette.test.js` (never `*Token*`: `.gitignore:35`); nothing under 12px; every dialog keeps its X and bottom exit through one `requestClose()`; never a modal from a modal; the item dialog stays one `Modal`.
- **Copy.** Plain words, short sentences. "Phone, laptop or tablet", never "phone" alone (the host's controller is "the remote"). Never write the phrases the twin guard bans (`tests/no-retired-twin-references.js`, `FALSE_RULE`) in any tracked file, this plan included.
- **Commits.** The subject says in plain words what now behaves differently; the body gives the why and names the tests. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The inputs the spec implies and no happy path exercises, most likely to bite a host first. Each has its test in the task named.

1. **"Use vN" onto a smaller version under a goal.** A trivia item pinned to v2 (12 questions) with a goal of 10; the host presses "Use v1" (8 questions). The server refuses in words ("Your goal of 10 is more than v1's 8 questions. Lower the goal, then use v1."), nothing changes, and the builder shows the sentence. A narrowed category list is reset to "every category" on a version change, and the builder says so. — Task 9 §3, Task 12.
2. **A goal typed wrong.** 0, a fraction, a word, or more questions than the set holds (at the version the session pins, not the set's newest): refused with the same sentence on `POST /games`, `PUT /games/{id}` and the item routes; the create dialog disables Create and says why, and the item dialog refuses Add in the same words, before anything is sent. Blank is "no goal", never an error. — Task 1 §1, Task 2 §1–§2, Task 4, Task 9 §2, Task 11.
3. **The host keeps going past the goal.** The notice shows once, on the goal's own round while its results are up; "Next" stays live; the next round's progress reads "Question 6 · your goal was 5"; a survey never shows a goal; the rail never prints one. — Task 1 §3, Task 5, Task 6.
4. **A reload in the middle of a session with a goal.** The stage restores the goal from the host door and the remote reads it from its poll; the public `/state` that every phone reads carries none. — Task 2 §3–§4, Task 5, Task 6.
5. **Rows written before M1b, and rows that cannot be read.** An engagement item added in M1 has no `Settings` and no `LedBy`: it lists, opens and saves with the create dialog's defaults. An item whose sealed words fail to open shows blank words, no leader and no settings — never an envelope. — Task 8 §3, Task 9 §3–§4.

## Decisions

### The controller's rulings (binding; the owner can overturn them on dev)

The owner, 26 Sep 2026, after creating the first event on dev:

> "couple of things i see that would be good. 1 Survey should work today, as we have surveys. presentations for now could be just placeholders. we also need a custom choice. where they could fill in what they want. It would also be good to be able to change the title of the session and enter the facilitator/speaker/presenter. It would also be nice if all of the options that you get when setting up each engagement is avail, and finally there should be a target number of items. even though the set contains 50 question they might have a goal of 5 questions. And we could alert the host/facilitator they have completed, but they could do extra if time permitted"

1. **Survey items** are enabled in the builder and on the server. They pick survey sets exactly as the other engagements pick theirs, and count toward the 8 engagements. Running them is M3, as for every engagement. — Task 7.
2. **Presentation placeholders**: title, presenter (see 4), planned length and description. No upload; the PDF copy is still M5. They count toward the 16 items and not the 8 engagements. The add menu stops saying "Coming soon", and the dialog says in one line that a PDF copy for attendees comes later. — Tasks 8, 10, 12.
3. **A custom item**: a new kind for anything else (networking, lunch with a speaker, open discussion, a workshop activity) with a title the host writes, an optional "Led by", a planned length and a description. It counts toward the 16 items and not the 8. — Tasks 8, 10, 12. *This plan names it* (see below).
4. **"Led by" on every item except a break**: one free-text name field, labelled "Facilitator" for an engagement, "Presenter" for a presentation, "Led by" for a custom item; shown on the builder row and on the public agenda (p-05a, p-05); sealed at rest in all three `tenant-crypto.js` copies. — Tasks 8, 10, 12.
5. **"Change the title of the session"**: an engagement's "Title on the agenda" is what its child session is called when M3 starts it, and the dialog says so beside the field. The event's own title is edited through "Edit details" (M1). — the mapping table below; Task 10.
6. **All the session options, per engagement item**, by extracting GameSetupDialog's options into a shared component both dialogs render — never a second copy — with GameSetupDialog's behaviour and tests unchanged. The item stores them as one settings map, validated on the server with create's caps and enums and an encrypted briefing; this plan names the exact item → `createGameBody` mapping so M3 cannot drift. The client-local toggles (auto-advance, scoreboard style, display profile) are out of scope. — Tasks 3, 9, 11.
7. **A goal of N questions** on an engagement item (1 up to the set's count at the pinned version; blank = none; the builder row reads "5 of 50 questions") **and on ordinary sessions now**: the create dialog's Goal field, stored on METADATA as `Target`, editable before the start through `PUT /games/{id}`. When the goal is reached the host is told on the stage and on the remote, in plain words, never blocking; "next" stays live; progress shows to the host only; a survey has none; M3 feeds the item's goal into the child session. — Tasks 1, 2, 4, 5, 6, 9, 11, 12.
8. **Caps.** The 16-item cap now bites (presentations and activities fill it); say it where you add, as M1 does. Breaks stay uncounted. — Task 12 (and the server's existing cap, proven for the new kinds in Task 8).
9. **No new Lambda functions**; new behaviour rides existing functions. — every task.
10. **Design**: build in the item dialog's visual language (03) and GameSetupDialog's Advanced block, reusing its component; tokens only; contrast measured; nothing under 12px; never a modal from a modal; "phone, laptop or tablet". — Tasks 3, 4, 10, 11, 12.

### What this plan decides that the rulings leave open

- **The custom kind is `custom` on the wire and "Activity" everywhere a person reads it** — the add menu, the Type column, the dialog heading ("Add an activity") and the public agenda's type label. One short plain word that fits every example the owner gave and every place it is printed; "Something else" does not fit the Type column. It sits under "Just on the agenda", beside Break, with the `UsersThree` icon. The owner can rename it by changing `TYPE_LABELS.custom` alone.
- **`LedBy` is one attribute for every kind**, at most 80 characters, optional everywhere (a talk is often booked before its speaker). 40-data-model's `Presenter` is this attribute. A break refuses a name rather than dropping it. On the builder row the name leads the source line, as 02 draws a talk's ("Marcus Oyelaran · …"); on the public agenda it is `ledBy`, for M2's "Presentation · Dana Whitfield".
- **The options are three components in one file**, because the create dialog draws them in three places: `SessionCategories` and `SessionBriefing` sit in its main view, and `SessionOptions` is the Advanced fold. They keep GameSetupDialog's class names and stay styled by `GameSetupDialog.css` under its `.gsd` scope (its palette test reads that sheet and must not change); the item dialog wraps them in a `.gsd` element, whose tokens are the same dusk card and field as the item dialog's surface, and a palette test holds them equal.
- **The prompt-library fetch moves with the Advanced fold.** It exists only to make the fold's "follows this set's own summary approach" honest and to fill its approach picker; it moves into `SessionOptions`, unchanged.
- **`Settings` uses the create dialog's payload keys** — `anonymousResponses`, `randomizeQuestions`, `names`, `target`, `categoryIds`, `personaId`, `promptId`, `aiContext`, `eventDetails`, `briefing` — and stores only the keys that apply to the item's format (`agenda-rules.settingKeysFor`). An untouched item stores the create dialog's untouched values (`SETTING_DEFAULTS`); an empty `categoryIds` means every category, as it does at create.
- **The server holds create's caps even where create itself does not**: `aiContext` ≤ 500 and `eventDetails` ≤ 300 are the create dialog's `maxLength`s; `create-game.js` never checked them (see below). `events/item-settings.js` checks them, and `tests/event-item-settings.js` §5 holds its numbers equal to `SessionOptions.jsx`'s.
- **"Use vN" and the options.** Re-pinning checks the stored goal against the new version's size and refuses in words if it no longer fits; it resets a narrowed category list to "every category" (a newer version may not have the same categories) and answers `categoriesReset: true`, which the builder says aloud.
- **The goal's words** live in `session-goal.js` so the stage and the remote say the same thing: progress "Question 3 of 5", then "Question 6 · your goal was 5"; the notice "That's your 5. Keep going if there's time, or end the session." (curly apostrophes). The goal counts the stage's round number, so a skipped question counts.
- **Where the stage says it.** The dock's status line — the room-safe sentence already there, which says "Results are on screen" at RESULTS — carries the notice on the goal's own round's RESULTS and FEEDBACK beats, and on its FIELD_NOTES when the read-back is one page (a longer read-back keeps its page position). The dock is part of the projected stage, so the room can read it; the words are ones a facilitator says aloud. Progress is never on the wall: it is in the SESSION panel's Questions tab and on the remote. *This is a reading of "the host is told on the stage" that the owner may want changed — see the report.*
- **The rail is untouched.** It already prints "Round 3 of 50" — the set's size — to the room, as it does today; the goal is not added to it.
- **A goal is bounded by the set's size at the version the session plays** (`questionCountAt`, following the runtime's own fallback — `resolvePartitionFromMeta`'s `pinned-missing` case, not `describeSet`'s display rule, which reports 0 + `pinnedMissing` so the builder can warn the host instead), and by 999 when the size is unknown. The category subset is not subtracted: the stage's existing "pool runs out" handling covers a goal the chosen categories cannot reach.

## Where the code disagrees with the inventory

- **The "Advanced" block is not the whole options UI.** Lines ~753–1049 of `GameSetupDialog.jsx` hold responses (or a survey's Names), shuffle, Workie and event details. **Categories** (~686–726) and **Workie's briefing** (~729–745) sit in the dialog's main view, outside the fold. Task 3 therefore extracts three components, not one.
- **Anonymous responses apply to Call & Answer and Poll only** (`config/anonymity.js` `anonymityApplies` = the formats with a vote). A survey gets Names instead; the inventory's "call-and-answer, poll, survey" is wrong for survey.
- **`create-game.js` enforces neither the 500-character Workie instructions cap nor the 300-character event-details cap.** Both exist only as the dialog's `maxLength`. The item route enforces them (Task 9); tightening `POST /games` itself is left alone here — flagged, not fixed.
- **The rail already shows the room "Round N of M"**, M being the set's size (`GameHostPage.jsx` `railContext`, `roundOf`). "Progress to the host only" is met by not adding the goal to it.
- **GameSetupDialog is not quite pure props**: it fetches `admin/ai-prompts` itself. The fetch moves into `SessionOptions` with the block it serves.
- **The console's set list has no `namesDefault`** (`admin/get-question-sets.js`). A survey item's Names therefore starts at Anonymous unless the host picks, exactly as the create dialog does for a set that carries none.

## Data model delta

| Row | Attribute | Shape | Sealed | Written by | Read by |
|---|---|---|---|---|---|
| `EVENT#<code>` / `ITEM#<id>` | `Type` | adds `custom`; `survey` and `presentation` are now written | no | `events/items.js` | everything that reads items |
| `ITEM#<id>` | `LedBy` | string, ≤ 80, `''` when nobody is named; absent on a break | **yes** (`item`) | `items.js` add, edit | `get-event.js` → `ledBy`; `get-agenda.js` → `ledBy` |
| `ITEM#<id>` | `Settings` | map, engagements only; keys = `agenda-rules.settingKeysFor(Type)`; absent on items added before M1b (read as defaults) | **yes**, whole map | `items.js` add, edit | `get-event.js` → `settings`. **Never** `get-agenda.js` |
| `GAME#<id>` / `METADATA` | `Target` | integer 1–999, ≤ the set's size at `QuestionSetVersion`; absent = no goal | no | `create-game.js` → `schema-compliant-manager.createGame`; `update-game.js` | `get-game.js` host-details → `target`; `get-game-state.js` host-state → top-level `target` |

`ENCRYPTED_FIELDS.item` becomes `['Title', 'Description', 'LedBy', 'Settings']` (Tasks 8 and 9). `Type`, `Order`, `Minutes`, `State` and `SetRef` stay plaintext.

## Routes delta (existing routes on existing functions)

| Route | Handler | Change |
|---|---|---|
| `POST /games` | `websocket/create-game.js` | accepts `target`; 400 on a survey, on anything but a whole number 1–999, or on more than the set holds at the version it will pin; nothing is reserved on a refusal |
| `PUT /games/{gameId}` | `game/update-game.js` | whitelist gains `target`; `null` clears; checked against the session's pinned version; still refused once started |
| `GET /games/{gameId}/host-details` | `game/get-game.js` | + `target` (null when none) |
| `GET /games/{gameId}/host-state` | `game/get-game-state.js` | + top-level `target` (its `gameMetadata` stays the public round's, key for key) |
| `GET /games/{gameId}/state` | `game/get-game-state.js` | unchanged — never `target` |
| `POST /events/{code}/items` | `websocket/events/items.js` | accepts `survey`, `presentation`, `custom`; `ledBy` (not on a break); `settings` (engagements only) |
| `PUT /events/{code}/items/{itemId}` | `websocket/events/items.js` | `ledBy`; `settings` (replaces the map); `version` re-checks the goal (400 `goal_over`) and answers `categoriesReset: true` when it reset a narrowed category list |
| `GET /events/{code}` | `websocket/events/get-event.js` | each item carries `ledBy` and, for an engagement that has them, `settings` |
| `GET /events/{code}/agenda` | `websocket/events/get-agenda.js` | each item carries `ledBy`; never `settings` |

The item dialog also calls two existing host routes it has not called before, through a new `utils/sessionSetupApi.js`: `GET admin/personas?gameType=` and `GET question-sets/{setId}/categories?scope=`.

## The item → session mapping (the M3 contract)

M3's `start-item` turns an item into its session. The chain is: the decrypted item as `GET /events/{code}` projects it → `agenda-rules.sessionFormOf(item)` (the create dialog's own payload) → `config/createGame.createGameBody(form)` (the `POST /games` body the create dialog sends) → `create-game.js` → the manager's `gameData` → METADATA. `__tests__/itemSessionMapping.test.js` (Task 9) pins the first three columns; the last two are `create-game.js`'s existing code.

| Item (projected) | `sessionFormOf` → payload key | `createGameBody` → `POST /games` | `create-game.js` → `gameData` | METADATA |
|---|---|---|---|---|
| `title` ("Title on the agenda") | `title` | `eventTitle` | `title` | `Title` (sealed) |
| `type` | `gameType` | `gameType` | `engagementType` | `GameType` |
| `setRef.setId` | `setId` | `questionSetId` | `questionSetId` | `QuestionSetId` |
| `setRef.scope` | `setScope` | `questionSetScope` | `questionSetScope` | `QuestionSetScope` |
| `setRef.version` | `setVersion` — **not read by `createGameBody`** | M3 adds `questionSetVersion` itself | `questionSetVersion` | `QuestionSetVersion` |
| `settings.categoryIds` (`[]` = every category) | `categoryIds` | `selectedCategories` | `selectedCategories` | `STATE#CATS` masks |
| `settings.randomizeQuestions` | `randomizeQuestions` | `randomizeQuestions` (`false` for a survey) | `hostPreferences.randomizeQuestions` | `HostPreferences.randomizeQuestions` |
| `settings.anonymousResponses` | `anonymousResponses` | `anonymousUntilReveal` (`false` where there is no vote) | `hostPreferences.anonymousUntilReveal` | `HostPreferences.anonymousUntilReveal` |
| `settings.names` (survey) | `names` | `names` (survey only) | `names` | `Names` |
| `settings.target` | `target` | `target` (not a survey; omitted when null) | `target` | `Target` |
| `settings.personaId` | `personaId` | `personaId` | `personaId` | `PersonaId` |
| `settings.promptId` | `promptId` | `promptId` | `promptId` | `PromptId` |
| `settings.aiContext` | `aiContext` | `aiContext` | `aiContext` | `AIContext` (sealed) |
| `settings.eventDetails` | `eventDetails` | `engagementInfo` | `details` | `Details` (sealed) |
| `settings.briefing` (C&A) | `briefing` | `briefing` (C&A only; omitted when null) | `briefing` | `Briefing` (sealed) |
| `ledBy`, `description`, `minutes` | — the agenda's own, never sent | — | — | — |
| (fixed) | — | `hostName: 'Host'` | `hostName` | `HostName` |

M3 must also stamp `EventRef` and skip the create gate and the meter (roadmap §4 M3); those are M3's, not this table's.

## File map

**Backend** (`lambda-functions/`)

| File | Change |
|---|---|
| `websocket/session-goal.js`, `game/session-goal.js` | new pair, pure: `checkTarget`, `questionCountAt`, `goalApplies`, `goalProgress`, `goalReachedLine` (Task 1) |
| `websocket/create-game.js`, `websocket/schema-compliant-manager.js` | `target` checked and stored as `Target` (Task 2) |
| `game/update-game.js` | `target` on the whitelist (Task 2) |
| `game/get-game.js`, `game/get-game-state.js` | `target` on the two host doors (Task 2) |
| `websocket/events/agenda-rules.js` | survey addable (Task 7); `custom`, Led by rules, `ADDABLE_TYPES`/`COMING_SOON` retired (Task 8); session-option keys, defaults and `sessionFormOf` (Task 9) |
| `websocket/events/items.js` | survey (Task 7); kinds and `LedBy` (Task 8); `settings`, "Use vN" re-check (Task 9) |
| `websocket/events/event-store.js` | `ledBy` (Task 8) and `settings` (Task 9) in `projectItem`; `openItemRow` blanks both |
| `websocket/events/get-agenda.js` | `ledBy` (Task 8) |
| `websocket/events/item-settings.js` | new: `checkItemSettings` (Task 9) |
| `game/tenant-crypto.js` and its two copies | `item`: + `LedBy` (Task 8), + `Settings` (Task 9) |

**Frontend** (`src/src/`)

| File | Change |
|---|---|
| `components/SessionOptions.jsx` | new: `SessionOptions`, `SessionCategories`, `SessionBriefing` (Task 3); the Goal field (Task 4) |
| `components/GameSetupDialog.jsx` | renders the three (Task 3); the goal (Task 4) |
| `components/GameSetupDialog.css` | the Goal field's rules (Task 4) |
| `config/setupDefaults.js`, `config/createGame.js`, `config/gameSession.js` | the goal in the Advanced line and the two bodies (Task 4); `sessionTarget` (Task 5); the dialog key list (Tasks 3–4) |
| `GameHostPage.jsx`, `config/hostControls.js`, `components/stage/SessionSetupPanel.jsx` | the goal on the stage (Task 5) |
| `config/hostRemote.js`, `HostRemote.jsx`, `HostRemote.css` | the goal on the remote (Task 6) |
| `components/EventItemDialog.jsx` | kinds, Led by, the title hint (Task 10); the options (Task 11) |
| `utils/sessionSetupApi.js` | new: personas and a set's categories for the item dialog (Task 11) |
| `components/EventBuilder.jsx`, `components/EventBuilder.css` | survey in the menu (Task 7); `.evb-sopts` (Task 11); the menu, the rows and the cap (Task 12) |

**Tests.** Backend (new): `tests/session-goal.js`, `tests/session-goal-routes.js`, `tests/event-item-kinds.js`, `tests/event-item-settings.js`; changed: `tests/event-agenda-rules.js`, `tests/event-caps.js`, `tests/event-public-reads.js`, `tests/tenant-crypto.js`. Frontend (new): `gameSetupDialogDom.test.jsx` (+ its `__snapshots__/` file), `sessionOptions.test.jsx`, `gameSetupGoal.test.jsx`, `sessionGoalPayload.test.js`, `sessionOptionsPalette.test.js`, `hostControlsGoal.test.js`, `sessionSetupPanelGoal.test.jsx`, `stageGoalWiring.test.js`, `hostRemoteGoal.test.jsx`, `itemSessionMapping.test.js`, `eventItemKinds.test.jsx`, `eventItemSettings.test.jsx`, `sessionSetupApi.test.js`, `eventBuilderKinds.test.jsx`; changed: `eventItemDialog.test.jsx`, `eventBuilder.test.jsx`.

---
### Task 1: A session's goal, written once — `session-goal.js`

The rule every later goal task reads: what a goal may be, how many questions a set has at a version, and where a running session stands against its goal, in the words the stage and the remote both say. Pure, and a byte-identical pair so both Lambda bundles can require it and the browser can import it.

**Files:**
- Create: `lambda-functions/websocket/session-goal.js`
- Create: `lambda-functions/game/session-goal.js` (a `cp` of the websocket copy)
- Create: `tests/session-goal.js`

**Interfaces:**
- Consumes: nothing.
- Produces (both copies, CommonJS, pure):
  - `TARGET_MAX = 999`; `ROUND_PHASES` = `['ASK','VOTE','RESULTS','FIELD_NOTES','FEEDBACK']`; `RESULT_PHASES` = `['RESULTS','FIELD_NOTES','FEEDBACK']`.
  - `goalApplies(gameType: string): boolean` — false for `survey` only.
  - `checkTarget(value, questionCount): {value: number|null} | {error: string}` — `''`/`null`/`undefined` → `{value: null}`.
  - `questionCountAt(setMeta, version): number` — 0 when unknown.
  - `goalReachedLine(target: number): string`.
  - `goalProgress({target, round, phase}): {progress: string, reached: boolean, line: string}`.

- [ ] **Step 1: Write the failing test**

Create `tests/session-goal.js`:

```js
/**
 * A SESSION'S GOAL — lambda-functions/websocket/session-goal.js and its
 * byte-identical copy in lambda-functions/game/ (events M1b).
 *
 * The owner, 26 Sep 2026: "even though the set contains 50 question they
 * might have a goal of 5 questions. And we could alert the host/facilitator
 * they have completed, but they could do extra if time permitted".
 *
 * rejects: a goal of 0, a fraction, a word or more than the set holds
 * accepted; a blank goal refused (blank is "no goal"); a survey offered a
 * goal; the size read from the active version for a session pinned to an
 * older one; the notice shown before the goal's own results, after the room
 * moved on past it, or with no goal at all; progress shown in the lobby or
 * after the end; the two copies drifting; a module the browser cannot import.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const FILE = path.join(REPO, 'lambda-functions/websocket/session-goal.js');
const G = require(FILE);

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

console.log('\n1. what a goal may be');
check('blank, null and undefined mean no goal', () => {
  for (const v of ['', null, undefined]) assert.deepStrictEqual(G.checkTarget(v, 50), { value: null });
});
check('a whole number up to the set\'s size is the goal', () => {
  assert.deepStrictEqual(G.checkTarget(5, 50), { value: 5 });
  assert.deepStrictEqual(G.checkTarget(50, 50), { value: 50 });
  assert.deepStrictEqual(G.checkTarget('7', 50), { value: 7 });
});
for (const bad of [0, -1, 2.5, 'five', '5.5', true, [], {}, 1000]) {
  check(`${JSON.stringify(bad)} is refused in plain words`, () =>
    assert.strictEqual(G.checkTarget(bad, 0).error, 'A goal is a whole number of questions, 1 or more.'));
}
check('more than the set holds is refused, naming the size', () =>
  assert.strictEqual(G.checkTarget(51, 50).error, 'This set has 50 questions, so the goal can be 50 at most.'));
check('one question reads as one question', () =>
  assert.strictEqual(G.checkTarget(2, 1).error, 'This set has 1 question, so the goal can be 1 at most.'));
check('an unknown size bounds the goal by the ceiling alone', () => {
  assert.deepStrictEqual(G.checkTarget(999, 0), { value: 999 });
  assert.deepStrictEqual(G.checkTarget(12, undefined), { value: 12 });
});
check('a survey has no goal; every round-based format does', () => {
  assert.strictEqual(G.goalApplies('survey'), false);
  assert.strictEqual(G.goalApplies(' Survey '), false);
  for (const t of ['trivia', 'call-and-answer', 'poll', 'wavelength', undefined]) {
    assert.strictEqual(G.goalApplies(t), true, String(t));
  }
});

console.log('\n2. how many questions a set has at a version');
const SET = {
  questionCount: 12, activeVersion: 3,
  versions: [{ version: 1, questionCount: 8 }, { version: 2 }, { version: 3, questionCount: 12 }],
};
check('a recorded version gives its own count', () => assert.strictEqual(G.questionCountAt(SET, 1), 8));
check('the active version, and no version at all, give the set\'s count', () => {
  assert.strictEqual(G.questionCountAt(SET, 3), 12);
  assert.strictEqual(G.questionCountAt(SET, null), 12);
});
check('a version that records no count falls back to the set\'s', () =>
  assert.strictEqual(G.questionCountAt(SET, 2), 12));
check('no set is size 0 (unknown)', () => assert.strictEqual(G.questionCountAt(null, 1), 0));

console.log('\n3. where a running session stands');
const NONE = { progress: '', reached: false, line: '' };
check('no goal: nothing to say', () =>
  assert.deepStrictEqual(G.goalProgress({ target: null, round: 3, phase: 'ASK' }), NONE));
check('before the first round and after the end: nothing', () => {
  assert.deepStrictEqual(G.goalProgress({ target: 5, round: 0, phase: 'LOBBY' }), NONE);
  assert.deepStrictEqual(G.goalProgress({ target: 5, round: 5, phase: 'ENDED' }), NONE);
});
check('mid-way: "Question 3 of 5", not reached', () =>
  assert.deepStrictEqual(G.goalProgress({ target: 5, round: 3, phase: 'VOTE' }),
    { progress: 'Question 3 of 5', reached: false, line: '' }));
check('the goal\'s own round, still answering: not reached yet', () =>
  assert.deepStrictEqual(G.goalProgress({ target: 5, round: 5, phase: 'ASK' }),
    { progress: 'Question 5 of 5', reached: false, line: '' }));
for (const phase of ['RESULTS', 'FIELD_NOTES', 'FEEDBACK', 'results']) {
  check(`the goal's own round on ${phase}: reached, with the notice`, () =>
    assert.deepStrictEqual(G.goalProgress({ target: 5, round: 5, phase }), {
      progress: 'Question 5 of 5',
      reached: true,
      line: 'That’s your 5. Keep going if there’s time, or end the session.',
    }));
}
check('kept going: progress says so, and the notice has done its job', () =>
  assert.deepStrictEqual(G.goalProgress({ target: 5, round: 6, phase: 'RESULTS' }),
    { progress: 'Question 6 · your goal was 5', reached: false, line: '' }));

console.log('\n4. one file, two bundles, and the browser');
check('the game/ copy is byte-identical to the websocket/ copy', () => {
  const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
  assert.strictEqual(read('lambda-functions/game/session-goal.js'), read('lambda-functions/websocket/session-goal.js'));
});
check('no require and no process in the code (comments aside)', () => {
  const code = fs.readFileSync(FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\brequire\s*\(/.test(code), 'it requires something');
  assert.ok(!/\bprocess\./.test(code), 'it reads process');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/session-goal.js; echo "exit=$?"`
Expected: it throws `Cannot find module '.../lambda-functions/websocket/session-goal.js'`, exit 1.

- [ ] **Step 3: Write the module**

Create `lambda-functions/websocket/session-goal.js`:

```js
/**
 * A SESSION'S GOAL — how many questions the host plans to ask (events M1b,
 * docs/superpowers/plans/2026-09-26-events-m1b-richer-agenda.md).
 *
 * The owner, 26 Sep 2026: "there should be a target number of items. even
 * though the set contains 50 question they might have a goal of 5 questions.
 * And we could alert the host/facilitator they have completed, but they could
 * do extra if time permitted".
 *
 * So a goal is a PLAN, never a stop: nothing on the server reads it to refuse
 * a round. It is stored on a session's METADATA as `Target` (create-game.js,
 * update-game.js), read back only on the host's doors (get-game.js
 * host-details, get-game-state.js host-state), and turned into words on the
 * stage and the remote by `goalProgress` below, so both say the same thing.
 *
 * COPIED BYTE FOR BYTE into lambda-functions/game/session-goal.js: create
 * lives in websocket/ and PUT /games/{id} in game/, and a Lambda bundle is its
 * CodeUri. tests/session-goal.js holds the two copies identical. The browser
 * imports the websocket copy, so it stays PURE: no require, no process, no
 * clock.
 */
const TARGET_MAX = 999;
const ROUND_PHASES = Object.freeze(['ASK', 'VOTE', 'RESULTS', 'FIELD_NOTES', 'FEEDBACK']);
const RESULT_PHASES = Object.freeze(['RESULTS', 'FIELD_NOTES', 'FEEDBACK']);

/** A survey is answered at each person's own pace: it has no rounds to count. */
function goalApplies(gameType) {
  return String(gameType || 'call-and-answer').trim().toLowerCase() !== 'survey';
}

/** A positive whole number, or null. */
function toCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A goal as typed or sent, checked. Blank means no goal. `questionCount` is
 * the set's size at the version the session plays; 0 or unknown bounds the
 * goal by TARGET_MAX alone.
 * @returns {{value: number|null}|{error: string}}
 */
function checkTarget(value, questionCount) {
  if (value === null || value === undefined || value === '') return { value: null };
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > TARGET_MAX) {
    return { error: 'A goal is a whole number of questions, 1 or more.' };
  }
  const count = toCount(questionCount);
  if (count && n > count) {
    return { error: `This set has ${count} question${count === 1 ? '' : 's'}, so the goal can be ${count} at most.` };
  }
  return { value: n };
}

/**
 * How many questions a set has at `version`: the entry in versions[] when it
 * records a count, else the set's own count, which is the active version's.
 * The rule websocket/events/event-store.js describeSet reasons from.
 */
function questionCountAt(setMeta, version) {
  if (!setMeta) return 0;
  const wanted = toCount(version);
  if (wanted !== null && Array.isArray(setMeta.versions)) {
    const entry = setMeta.versions.find((v) => toCount(v && v.version) === wanted);
    if (entry && toCount(entry.questionCount)) return Number(entry.questionCount);
  }
  return toCount(setMeta.questionCount) || 0;
}

/** The notice, in the words the stage and the remote both say. */
function goalReachedLine(target) {
  return `That’s your ${target}. Keep going if there’s time, or end the session.`;
}

/**
 * Where a running session stands against its goal. `round` is the round
 * number the stage shows; `phase` is the host's phase (ASK, VOTE, RESULTS,
 * FIELD_NOTES, FEEDBACK — anything else is between rounds or over).
 *   progress  "Question 3 of 5", then "Question 6 · your goal was 5";
 *             '' with no goal, before the first round and after the end
 *   reached   true only while the goal's own round is on its results
 *   line      the notice while `reached`, else ''
 */
function goalProgress({ target, round, phase } = {}) {
  const goal = toCount(target);
  const r = toCount(round);
  const p = String(phase || '').toUpperCase();
  if (!goal || !r || !ROUND_PHASES.includes(p)) return { progress: '', reached: false, line: '' };
  const progress = r <= goal ? `Question ${r} of ${goal}` : `Question ${r} · your goal was ${goal}`;
  const reached = r === goal && RESULT_PHASES.includes(p);
  return { progress, reached, line: reached ? goalReachedLine(goal) : '' };
}

module.exports = {
  TARGET_MAX, ROUND_PHASES, RESULT_PHASES,
  goalApplies, checkTarget, questionCountAt, goalReachedLine, goalProgress,
};
```

Then make the game copy: `cp lambda-functions/websocket/session-goal.js lambda-functions/game/session-goal.js`

- [ ] **Step 4: Run it and watch it pass**

Run: `node tests/session-goal.js; echo "exit=$?"`
Expected: every line `ok -`, `30 passed, 0 failed`, exit 0.

- [ ] **Step 5: The backend loop, then commit**

Run the backend loop (Before you start, item 3) after `git add` of the three new files. Expected: the baseline plus one suite, `fail=0`.

```bash
git add lambda-functions/websocket/session-goal.js lambda-functions/game/session-goal.js tests/session-goal.js
git commit -m "A session can carry a goal of N questions, checked and worded in one place

session-goal.js (a byte-identical pair in websocket/ and game/) says what a
goal may be (a whole number up to the set's size at the pinned version; blank
is none; never for a survey) and where a running session stands against it:
\"Question 3 of 5\", the notice on the goal's own results, and \"your goal was
5\" once the host keeps going. Nothing reads it yet. tests/session-goal.js.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The goal on a session, on the server — create, edit, and the two host doors

`POST /games` takes `target`, checks it against the set's size at the version the session will pin, and stores it as METADATA `Target`; `PUT /games/{id}` changes or clears it before the start; the host's two doors read it back. The public `/state` never carries it.

**Files:**
- Modify: `lambda-functions/websocket/create-game.js`
- Modify: `lambda-functions/websocket/schema-compliant-manager.js` (the METADATA item in `createGame`)
- Modify: `lambda-functions/game/update-game.js`
- Modify: `lambda-functions/game/get-game.js` (the host-details branch)
- Modify: `lambda-functions/game/get-game-state.js` (the `gameMetadata` projection)
- Create: `tests/session-goal-routes.js`

**Interfaces:**
- Consumes: `checkTarget`, `questionCountAt`, `goalApplies` (Task 1); `findSetMetadata` (`websocket/set-version.js`, already required by `create-game.js`); `gameSetRef`, `resolveSetPartition` (`game/set-version.js`, already required by `update-game.js`).
- Produces: `POST /games` body key `target`; `PUT /games/{gameId}` body key `target` (number, or `null` to clear; echoed as `updated.target`); METADATA attribute `Target`; `GET /games/{id}/host-details` → `target: number|null`; `GET /games/{id}/host-state` → top-level `target: number|null` (never inside `gameMetadata`: `tests/get-game-host-state.js` §4 holds the host door's `gameMetadata` equal to the public round's, key for key).

- [ ] **Step 1: Write the failing test**

Create `tests/session-goal-routes.js`:

```js
/**
 * A SESSION'S GOAL ON THE WIRE — POST /games (websocket/create-game.js),
 * PUT /games/{gameId} (game/update-game.js), and the two host doors that read
 * it back: GET /games/{id}/host-details (game/get-game.js) and
 * GET /games/{id}/host-state (game/get-game-state.js). Events M1b.
 *
 * rejects: a goal larger than the set, or a fraction, stored; a goal on a
 * survey; the size read from the set's newest version for a session pinned to
 * an older one; a refused goal that still makes a session; a PUT that cannot
 * clear a goal; a goal edited after the start; the public /state carrying the
 * goal to every phone.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const { installEventHarness, asHost, seedOrg, bodyOf } = require('./helpers/event-harness');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/create-game.js').handler;
const update = h.load('lambda-functions/game/update-game.js').handler;
const getGame = h.load('lambda-functions/game/get-game.js').handler;
const getState = h.load('lambda-functions/game/get-game-state.js').handler;

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const newSession = (body) => create({
  body: JSON.stringify({
    eventTitle: 'Offsite', gameType: 'trivia', questionSetId: 'space', questionSetScope: 'platform', ...body,
  }),
  requestContext: asHost(NW),
});
const put = (gameId, body) => update({
  pathParameters: { gameId }, body: JSON.stringify(body), requestContext: asHost(NW),
});
const door = (gameId, suffix) => ({
  pathParameters: { gameId },
  rawPath: `/games/${gameId}${suffix}`,
  requestContext: { ...asHost(NW), http: { method: 'GET', path: `/games/${gameId}${suffix}` } },
});
const metadata = (gameId) => table.get(`GAME#${gameId}`, 'METADATA');
const sessionCount = () => [...table.store.values()]
  .filter((r) => r.SK === 'METADATA' && String(r.PK).startsWith('GAME#')).length;

(async () => {
  table.clear();
  seedOrg(table, NW);
  table.put({
    PK: 'SETS', SK: 'SET#space', name: 'Space Trivia', engagementType: 'trivia', questionCount: 12,
    activeVersion: 2, versions: [{ version: 1, questionCount: 8 }, { version: 2, questionCount: 12 }],
  });

  console.log('\n1. creating a session with a goal');
  let gameId;
  await check('a goal within the set is stored on METADATA as Target', async () => {
    const res = await newSession({ target: 5 });
    assert.strictEqual(res.statusCode, 201, res.body);
    gameId = bodyOf(res).gameId;
    assert.strictEqual(metadata(gameId).Target, 5);
  });
  await check('no goal writes no Target', async () => {
    const res = await newSession({});
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.ok(!('Target' in metadata(bodyOf(res).gameId)));
  });
  for (const [label, body, error] of [
    ['more questions than the set holds', { target: 13 }, /This set has 12 questions/],
    ['more than an explicitly pinned older version holds', { target: 9, questionSetVersion: 1 }, /This set has 8 questions/],
    ['zero', { target: 0 }, /whole number of questions/],
    ['a fraction', { target: 2.5 }, /whole number of questions/],
    ['a word', { target: 'five' }, /whole number of questions/],
    ['a survey', { gameType: 'survey', target: 3 }, /survey .* no goal/],
  ]) {
    await check(`${label}: 400, and no session is made`, async () => {
      const before = sessionCount();
      const res = await newSession(body);
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.match(bodyOf(res).error, error);
      assert.strictEqual(sessionCount(), before);
    });
  }

  console.log('\n2. changing the goal before the start');
  await check('PUT sets a new goal', async () => {
    const res = await put(gameId, { target: 7 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).updated.target, 7);
    assert.strictEqual(metadata(gameId).Target, 7);
  });
  await check('PUT null clears it', async () => {
    const res = await put(gameId, { target: null });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(!('Target' in metadata(gameId)));
  });
  await check('the size is the PINNED version\'s, not the set\'s newest', async () => {
    const older = bodyOf(await newSession({ target: 4, questionSetVersion: 1 })).gameId;
    assert.strictEqual(metadata(older).QuestionSetVersion, 1);
    const over = await put(older, { target: 10 });
    assert.strictEqual(over.statusCode, 400, over.body);
    assert.match(bodyOf(over).error, /This set has 8 questions/);
    assert.strictEqual(metadata(older).Target, 4);
  });
  await check('a survey: 400', async () => {
    table.put({ PK: 'GAME#7777', SK: 'METADATA', orgId: NW, GameType: 'survey', QuestionSetId: 'space', QuestionSetScope: 'platform' });
    table.put({ PK: 'GAME#7777', SK: 'STATE', State: 'CREATED' });
    const res = await put('7777', { target: 3 });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /no goal/);
    assert.ok(!('Target' in table.get('GAME#7777', 'METADATA')));
  });
  await check('after the start: refused by the CREATED gate, as every edit is', async () => {
    table.put({ ...table.get(`GAME#${gameId}`, 'STATE'), State: 'STARTED' });
    const res = await put(gameId, { target: 3 });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.ok(!('Target' in metadata(gameId)));
    table.put({ ...table.get(`GAME#${gameId}`, 'STATE'), State: 'CREATED' });
  });

  console.log('\n3. the host reads it back');
  await put(gameId, { target: 6 });
  await check('host-details carries the goal, for the edit dialog', async () => {
    const res = await getGame(door(gameId, '/host-details'));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).target, 6);
  });
  await check('host-state carries it, for the stage and the remote', async () => {
    const res = await getState(door(gameId, '/host-state'));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).target, 6);
  });

  console.log('\n4. the room never reads it');
  await check('the public /state carries no goal, anywhere', async () => {
    const res = await getState({
      pathParameters: { gameId },
      rawPath: `/games/${gameId}/state`,
      requestContext: { http: { method: 'GET', path: `/games/${gameId}/state` } },
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(!('target' in bodyOf(res)));
    assert.ok(!/"target"/.test(res.body));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/session-goal-routes.js 2>/dev/null | grep -E "FAIL|passed"`, then `node tests/session-goal-routes.js >/dev/null 2>&1; echo "exit=$?"`
Expected: FAILs from §1 onward ("a goal within the set is stored" — `undefined !== 5`; the refusals answer 201), exit 1.

- [ ] **Step 3: `create-game.js` checks the goal before a code is drawn**

Below the line `const { normalizeBriefing, isCallAndAnswer } = require('./briefing');` add:

```js
const { checkTarget, questionCountAt, goalApplies } = require('./session-goal');
```

In the whitelist destructure, replace

```js
  const { eventTitle, engagementInfo, aiContext, gameType, questionSetId, questionSetVersion, randomizeQuestions, anonymousUntilReveal, selectedCategories, hostName, visibility, accessCode, personaId, promptId, questionSetScope, names, briefing } = JSON.parse(event.body || '{}');
```

with

```js
  const { eventTitle, engagementInfo, aiContext, gameType, questionSetId, questionSetVersion, randomizeQuestions, anonymousUntilReveal, selectedCategories, hostName, visibility, accessCode, personaId, promptId, questionSetScope, names, briefing, target } = JSON.parse(event.body || '{}');
```

Immediately below the line `  const setScope = await resolveSetScope(event, questionSetId, questionSetScope);` add:

```js

  /*
    THE GOAL (events M1b, session-goal.js): how many questions the host plans
    to ask — a plan, never a stop. Checked here, before a code is drawn,
    against the set's size at the version this session will pin: the explicit
    `questionSetVersion` when one is sent, else the set's active version, which
    is what createGame() pins. A survey has no rounds and so no goal. A refused
    goal writes nothing.
  */
  let sessionTarget = null;
  if (target !== undefined && target !== null && target !== '') {
    if (!goalApplies(gameType || 'call-and-answer')) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'A survey is answered at each person’s own pace, so it has no goal.' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    let count = 0;
    if (questionSetId) {
      try {
        const found = await findSetMetadata(docClient, process.env.TABLE_NAME, event, questionSetId, setScope || 'platform');
        if (found) {
          const pinned = questionSetVersion !== undefined && questionSetVersion !== null
            ? questionSetVersion : found.item.activeVersion;
          count = questionCountAt(found.item, pinned);
        }
      } catch (err) {
        console.warn(`⚠️ create: could not read set "${questionSetId}" to check the goal (${err.message}); bounding it by the ceiling alone`);
      }
    }
    const checked = checkTarget(target, count);
    if (checked.error) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: checked.error }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    sessionTarget = checked.value;
  }
```

In the `createGame(candidate, { … })` argument, replace

```js
          ...(sessionBriefing ? { briefing: sessionBriefing } : {}),
```

with

```js
          ...(sessionBriefing ? { briefing: sessionBriefing } : {}),
          // The goal, already checked above. Absent means no goal.
          ...(sessionTarget ? { target: sessionTarget } : {}),
```

- [ ] **Step 4: The manager writes `Target`**

In `lambda-functions/websocket/schema-compliant-manager.js`, in the METADATA item of `createGame`, replace

```js
        ...(gameData.promptId ? { PromptId: gameData.promptId } : {}),
```

with

```js
        ...(gameData.promptId ? { PromptId: gameData.promptId } : {}),
        // THE GOAL (events M1b, session-goal.js): how many questions the host
        // plans to ask. A plan, never a stop; absent means no goal. Read back
        // on the host's doors only (get-game.js host-details, get-game-state.js
        // host-state) and changed before the start by PUT /games/{id}. The third
        // of create-game.js's three edits for a new create field.
        ...(gameData.target ? { Target: gameData.target } : {}),
```

- [ ] **Step 5: `update-game.js` takes `target` before the start**

Below the line `const { normalizeBriefing, isCallAndAnswer } = require('./briefing');` add:

```js
const { checkTarget, questionCountAt, goalApplies } = require('./session-goal');
```

In the header's whitelist, replace

```js
 *   briefing            → Briefing         (Call & Answer only; null clears;
 *                                           encrypted; see briefing.js)
```

with

```js
 *   briefing            → Briefing         (Call & Answer only; null clears;
 *                                           encrypted; see briefing.js)
 *   target              → Target           (the goal, events M1b; not a
 *                                           survey; null clears; at most the
 *                                           pinned version's size —
 *                                           session-goal.js)
```

Replace

```js
const EDITABLE_FIELDS = [
  'eventTitle', 'engagementInfo', 'aiContext', 'personaId', 'promptId', 'visibility', 'anonymousUntilReveal',
  'categoryIds', 'names', 'briefing'
];
```

with

```js
const EDITABLE_FIELDS = [
  'eventTitle', 'engagementInfo', 'aiContext', 'personaId', 'promptId', 'visibility', 'anonymousUntilReveal',
  'categoryIds', 'names', 'briefing', 'target'
];
```

Insert the block below immediately above the `    /*` that opens the comment beginning `      Categories are validated and staged HERE, written LAST` (the comment directly above `    let stagedMasks = null;`):

```js
    if ('target' in body) {
      // THE GOAL (events M1b, session-goal.js). A plan, never a stop. null or
      // '' REMOVE it; a value is checked against the size of the set at the
      // version THIS session pinned — the version every round is served from —
      // never the set's newest.
      if (gameMeta.Item && !goalApplies(gameMeta.Item.GameType)) {
        return reply(400, { error: 'A survey is answered at each person’s own pace, so it has no goal.' });
      }
      names['#target'] = 'Target';
      if (body.target === null || body.target === '') {
        removes.push('#target');
        applied.target = null;
      } else {
        const full = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
        }));
        let count = 0;
        if (full.Item && full.Item.QuestionSetId) {
          const resolved = await resolveSetPartition(
            db, process.env.TABLE_NAME, gameSetRef(full.Item), full.Item.QuestionSetVersion
          );
          count = questionCountAt(resolved.metadata, resolved.version);
        }
        const checked = checkTarget(body.target, count);
        if (checked.error) return reply(400, { error: checked.error });
        values[':target'] = checked.value;
        sets.push('#target = :target');
        applied.target = checked.value;
      }
    }

```

- [ ] **Step 6: The two host doors read it back**

In `lambda-functions/game/get-game.js`, in the host-details `result`, replace

```js
        promptId: gameMetadata.Item.PromptId || '',
```

with

```js
        promptId: gameMetadata.Item.PromptId || '',
        // The goal (events M1b), for the same prefill: the edit's PUT sends
        // `target`, and null clears it. null when there is none.
        target: Number(gameMetadata.Item.Target) || null,
```

In `lambda-functions/game/get-game-state.js`, in `response`, replace

```js
      gameType: gameMetadata.Item.GameType || 'call-and-answer',
      gameMetadata: {
```

with

```js
      gameType: gameMetadata.Item.GameType || 'call-and-answer',
      /*
        THE GOAL, on the host's door only (events M1b): the stage and the
        remote say "Question 3 of 5" and "That's your 5" from it. A plan the
        host made is not the room's to read, so the public /state never
        carries it (tests/session-goal-routes.js §4). At the top level, never
        in gameMetadata: tests/get-game-host-state.js §4 holds the host door's
        gameMetadata equal to the public round's, key for key.
      */
      ...(onHostDoor ? { target: Number(gameMetadata.Item.Target) || null } : {}),
      gameMetadata: {
```

- [ ] **Step 7: Run it and watch it pass**

Run: `node tests/session-goal-routes.js 2>/dev/null | grep -E "FAIL|passed"`, then `node tests/session-goal-routes.js >/dev/null 2>&1; echo "exit=$?"`
Expected: `16 passed, 0 failed`, exit 0.

- [ ] **Step 8: The suites these handlers already have**

Run: `for f in tests/update-game.js tests/get-game-host-state.js tests/get-game-host-details.js tests/briefing.js tests/tenant-session-scoping.js tests/code-reuse-isolation.js tests/event-code-reservation.js tests/plan-gating.js tests/kms-grants-match-code.js tests/lambda-event-not-logged.js; do node "$f" >/dev/null 2>&1 && echo "ok $f" || echo "FAIL $f"; done`
Expected: every line `ok`.

- [ ] **Step 9: The backend loop, then commit**

```bash
git add tests/session-goal-routes.js lambda-functions/websocket/create-game.js lambda-functions/websocket/schema-compliant-manager.js lambda-functions/game/update-game.js lambda-functions/game/get-game.js lambda-functions/game/get-game-state.js
git commit -m "A session is created with a goal, can change it before the start, and only the host reads it back

POST /games takes target, checks it against the set's size at the version the
session will pin (session-goal.js), and stores METADATA.Target; a survey, a
fraction or more than the set holds is refused before a code is drawn.
PUT /games/{id} sets or clears it until the start, against the pinned version.
host-details returns it, and host-state at its top level (its gameMetadata
stays the public round's); the public /state never carries it.
tests/session-goal-routes.js.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: One copy of the session options — extract them from the create dialog, unchanged

The riskiest shared change, alone in its task. The create dialog's category grid, Workie's briefing and its Advanced fold move into `components/SessionOptions.jsx` as three components, and GameSetupDialog renders them. Nothing a host sees changes: a snapshot of the dialog's whole form, recorded in Step 1 **before** anything moves, must still match after the move, and every GameSetupDialog test runs unedited as the regression net. Nothing new renders the components yet (Task 11 does).

Screens: `docs/design/session-setup-redesign/` 01–04 (the create dialog as shipped) — nothing is redesigned here.

**Files:**
- Create: `src/src/__tests__/gameSetupDialogDom.test.jsx` (and the snapshot file jest writes beside it, `src/src/__tests__/__snapshots__/gameSetupDialogDom.test.jsx.snap`)
- Create: `src/src/components/SessionOptions.jsx`
- Modify: `src/src/components/GameSetupDialog.jsx`
- Create: `src/src/__tests__/sessionOptions.test.jsx`

**Interfaces:**
- Consumes: `advancedSummary` (`config/setupDefaults.js`), `anonymityApplies` (`config/anonymity.js`), `NAMES_MODES`, `namesMode` (`config/surveyNames.js`), `gameTypeMeta`, `normalizeGameType` (`config/gameTypes.js`), `authFetch`, `adminApiUrl`, `BriefingField`, `Icon`; `GameSetupDialog.css` (unchanged).
- Produces (`components/SessionOptions.jsx`):
  - default `SessionOptions({ idPrefix = 'gsd', gameType, value, onChange, personas = [], setPromptId = '', namesDefault = '', shuffleLocked = false })` — the Advanced fold. `value` = `{ anonymousResponses, randomizeQuestions, names, personaId, promptId, aiContext, eventDetails }`; `onChange(patch)` with those keys. Ids: `${idPrefix}-persona`, `-prompt`, `-ai-context`, `-details`. Task 4 adds `target` to `value` and a `questionCount` prop.
  - `SessionCategories({ idPrefix = 'gsd', categories, selected: Set<string>, editing = false, onToggle(name) })`.
  - `SessionBriefing({ value, onChange, onWorkingChange })`.

- [ ] **Step 1: Record the create dialog's form BEFORE anything moves**

Create `src/src/__tests__/gameSetupDialogDom.test.jsx`:

```jsx
/**
 * THE CREATE DIALOG'S FORM, AS HTML — components/GameSetupDialog.jsx and the
 * shared components/SessionOptions.jsx it renders (events M1b, Task 3).
 *
 * The options block became a shared component so the event item dialog can
 * render the same controls. This file pins the dialog's whole form, as HTML,
 * in seven shapes. It was recorded from the dialog BEFORE the block moved, and
 * the move had to reproduce it exactly. A later change to the shared block
 * updates the snapshot on purpose (`npm test -- gameSetupDialogDom -u`), and
 * the snapshot's diff is what the reviewer reads.
 *
 * React's generated ids (`useId`) are replaced by `:id:`; nothing else is.
 *
 * rejects: the extraction changing one attribute, id, class, word or order in
 * the create or edit form, for any format.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GameSetupDialog from '../components/GameSetupDialog';

const mockPrompts = [
  { promptId: 'lp-behavioral', name: 'LP Behavioural', gameType: 'call-and-answer', summaryPromptStatus: 'ok' },
  { promptId: 'trivia-vj', name: 'Trivia — VJ', gameType: 'trivia', summaryPromptStatus: 'ok' },
  { promptId: 'trivia-gen', name: 'Trivia generator', gameType: 'trivia', summaryPromptStatus: 'unusable' },
];
jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ prompts: mockPrompts }) })),
}));

const SETS = [
  { id: 'pricing', name: 'Strategic Pricing Plays', totalQuestions: 47, engagementType: 'call-and-answer', hasImages: false, promptId: 'lp-behavioral' },
  { id: 'space', name: 'Space Trivia', totalQuestions: 12, engagementType: 'trivia', hasImages: false },
  { id: 'mood', name: 'Room Mood', totalQuestions: 6, engagementType: 'poll', hasImages: false },
  { id: 'words', name: 'One Word', totalQuestions: 9, engagementType: 'wavelength', hasImages: false },
  { id: 'pulse', name: 'Kickoff pulse', totalQuestions: 5, engagementType: 'survey', hasImages: false, namesDefault: 'finished' },
];
const CATEGORIES = [
  { name: 'Leadership', questionCount: 20 },
  { name: 'Ops', questionCount: 27 },
];

const dialog = (props = {}) => render(
  <GameSetupDialog
    isFirstEngagement
    eventTitle="Q3 Offsite"
    onEventTitleChange={jest.fn()}
    questionSets={SETS}
    personas={[{ personaId: 'coach', name: 'Coach', tagline: 'warm and direct' }]}
    categories={CATEGORIES}
    activeCategoryIds={new Set(['Ops'])}
    onToggleCategory={jest.fn()}
    onQuestionSetChange={jest.fn()}
    onCancel={jest.fn()}
    onCreate={jest.fn()}
    {...props}
  />
);
const form = () => document.querySelector('.dialog-content').innerHTML.replace(/:r[0-9a-z]+:/gi, ':id:');
// The prompt library arrives a tick after mount; let it land before reading.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

test.each([
  ['call-and-answer', 'Call & Answer', 'platform:pricing'],
  ['trivia', 'Trivia', 'platform:space'],
  ['poll', 'Poll', 'platform:mood'],
  ['wavelength', 'Wavelength', 'platform:words'],
  ['survey', 'Survey', 'platform:pulse'],
])('create, %s, with a set picked', async (_type, pill, key) => {
  dialog();
  await settle();
  fireEvent.click(screen.getByRole('button', { name: pill }));
  fireEvent.change(screen.getByLabelText(/question set/i), { target: { value: key } });
  await settle();
  expect(form()).toMatchSnapshot();
});

test('edit, a Call & Answer session with every option changed', async () => {
  dialog({
    mode: 'edit',
    initialValues: {
      gameType: 'call-and-answer', questionSetId: 'pricing', questionSetScope: 'platform', title: 'Q3 retro',
      details: 'Why we meet.', aiContext: 'Be brief.', personaId: 'coach', promptId: 'lp-behavioral',
      randomizeQuestions: false, anonymousUntilReveal: false, selectedCategoryNames: ['Ops'],
      briefing: { text: 'Open issues are up 15%.', source: null, namesRemoved: 0, draftedAt: null, editedAt: null },
    },
  });
  await settle();
  expect(form()).toMatchSnapshot();
});

test('edit, a survey with Names chosen', async () => {
  dialog({
    mode: 'edit',
    initialValues: { gameType: 'survey', questionSetId: 'pulse', questionSetScope: 'platform', title: 'Pulse', names: 'named' },
  });
  await settle();
  expect(form()).toMatchSnapshot();
});
```

Run: `cd src && npm test -- gameSetupDialogDom`
Expected: `Tests: 7 passed`, and `› 7 snapshots written`. This snapshot is the untouched dialog. Commit it now, alone, so the move below is measured against a recorded baseline:

```bash
git add src/src/__tests__/gameSetupDialogDom.test.jsx src/src/__tests__/__snapshots__/gameSetupDialogDom.test.jsx.snap
git commit -m "The create dialog's whole form is pinned as HTML, in seven shapes, before its options move

gameSetupDialogDom.test.jsx records the form for each format with a set
picked, and for two edits, with React's generated ids normalised. It is the
regression net for moving the options into a shared component: the move must
reproduce it exactly.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Write the failing test for the shared component**

Create `src/src/__tests__/sessionOptions.test.jsx`:

```jsx
/**
 * THE SESSION OPTIONS, RENDERED ALONE — components/SessionOptions.jsx (events
 * M1b, Task 3): the create dialog's category grid, Workie's briefing and its
 * Advanced fold, which the event item dialog renders too.
 *
 * rejects: a control that does not report its change under the create
 * payload's own key; an id that ignores its prefix (two dialogs, one id); the
 * shuffle offered on a survey or live in an edit; the anonymity card on a
 * format with no vote; the approach picker offering another format's prompts
 * or a generator; a SECOND COPY of these controls anywhere in the frontend.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import SessionOptions, { SessionCategories, SessionBriefing } from '../components/SessionOptions';

const mockPrompts = [
  { promptId: 'lp-behavioral', name: 'LP Behavioural', gameType: 'call-and-answer', summaryPromptStatus: 'ok' },
  { promptId: 'trivia-vj', name: 'Trivia — VJ', gameType: 'trivia', summaryPromptStatus: 'ok' },
  { promptId: 'trivia-gen', name: 'Trivia generator', gameType: 'trivia', summaryPromptStatus: 'unusable' },
];
jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ prompts: mockPrompts }) })),
}));

const VALUE = {
  anonymousResponses: true, randomizeQuestions: true, names: 'anonymous',
  personaId: '', promptId: '', aiContext: '', eventDetails: '',
};
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const mount = (props = {}) => {
  const onChange = jest.fn();
  render(
    <div className="gsd">
      <SessionOptions
        idPrefix="t"
        gameType="call-and-answer"
        value={VALUE}
        onChange={onChange}
        personas={[{ personaId: 'coach', name: 'Coach' }]}
        {...props}
      />
    </div>,
  );
  return onChange;
};

describe('every control reports its change under the payload\'s own key', () => {
  test('anonymous responses, shuffle, voice, approach, instructions and details', async () => {
    const onChange = mount();
    await settle();
    fireEvent.click(screen.getByRole('checkbox', { name: /anonymous responses/i }));
    expect(onChange).toHaveBeenLastCalledWith({ anonymousResponses: false });
    fireEvent.click(screen.getByRole('checkbox', { name: /shuffle the question order/i }));
    expect(onChange).toHaveBeenLastCalledWith({ randomizeQuestions: false });
    fireEvent.change(screen.getByLabelText("Workie's voice"), { target: { value: 'coach' } });
    expect(onChange).toHaveBeenLastCalledWith({ personaId: 'coach' });
    fireEvent.change(screen.getByLabelText('Summary approach'), { target: { value: 'lp-behavioral' } });
    expect(onChange).toHaveBeenLastCalledWith({ promptId: 'lp-behavioral' });
    fireEvent.change(screen.getByLabelText('Instructions for Workie'), { target: { value: 'Be brief.' } });
    expect(onChange).toHaveBeenLastCalledWith({ aiContext: 'Be brief.' });
    fireEvent.change(screen.getByLabelText('Event details'), { target: { value: 'Why we meet.' } });
    expect(onChange).toHaveBeenLastCalledWith({ eventDetails: 'Why we meet.' });
  });

  test('every id carries the prefix, so two dialogs never share one', async () => {
    mount();
    await settle();
    for (const id of ['t-persona', 't-prompt', 't-ai-context', 't-details']) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(document.getElementById('gsd-persona')).toBeNull();
  });
});

describe('what each format is offered', () => {
  test('a survey gets Names, and no anonymity card and no shuffle', async () => {
    const onChange = mount({ gameType: 'survey' });
    await settle();
    expect(screen.queryByRole('checkbox', { name: /anonymous responses/i })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /shuffle/i })).toBeNull();
    const names = screen.getByRole('radiogroup', { name: 'Names' });
    fireEvent.click(within(names).getAllByRole('radio')[2]);
    expect(onChange).toHaveBeenLastCalledWith({ names: 'named' });
  });

  test('trivia has no vote to hide; its approach picker offers only its usable summary prompts', async () => {
    mount({ gameType: 'trivia' });
    await settle();
    expect(screen.queryByRole('checkbox', { name: /anonymous responses/i })).toBeNull();
    const options = within(screen.getByLabelText('Summary approach')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['The standard Trivia way (recommended)', 'Trivia — VJ']);
  });

  test('an edit locks the shuffle and says why', async () => {
    mount({ shuffleLocked: true });
    await settle();
    expect(screen.getByRole('checkbox', { name: /shuffle/i })).toBeDisabled();
    expect(screen.getByText(/Fixed once the session is created/)).toBeInTheDocument();
  });

  test('the set\'s own approach is named only when the library holds it', async () => {
    mount({ setPromptId: 'lp-behavioral' });
    await settle();
    const first = within(screen.getByLabelText('Summary approach')).getAllByRole('option')[0];
    expect(first).toHaveTextContent('What the set says (recommended)');
  });
});

describe('the categories and the briefing', () => {
  const CATS = [{ name: 'Leadership', questionCount: 20 }, { name: 'Ops', questionCount: 27 }];

  test('create: none picked means all of them, counted in questions', () => {
    const onToggle = jest.fn();
    render(<div className="gsd"><SessionCategories idPrefix="t" categories={CATS} selected={new Set()} onToggle={onToggle} /></div>);
    expect(screen.getByRole('group', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.getByText('None picked, so all 2 are in · 47 questions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ops/ }));
    expect(onToggle).toHaveBeenCalledWith('Ops');
  });

  test('edit: an empty selection is refused in words', () => {
    render(<div className="gsd"><SessionCategories categories={CATS} selected={new Set()} editing /></div>);
    expect(screen.getByText(/Select at least one category/)).toBeInTheDocument();
  });

  test('the briefing is headed as Call & Answer only', () => {
    render(<div className="gsd"><SessionBriefing value={null} onChange={jest.fn()} /></div>);
    expect(screen.getByRole('heading', { name: /Workie’s briefing/ })).toHaveTextContent('Call & Answer only');
  });
});

describe('one copy of the options, never two', () => {
  const SRC = path.join(__dirname, '..');
  const sources = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') sources(full, out);
      } else if (/\.jsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  };

  // rejects: the item dialog (or anything else) growing its own copy of a
  // control this file owns — the owner asked for the SAME options.
  test.each([
    'className="gsd-adv"',
    'Shuffle the question order',
    'Instructions for Workie',
    'className="gsd-three-opt"',
    'category-button-grid',
  ])('only SessionOptions.jsx draws %s', (marker) => {
    const holders = sources(SRC)
      .filter((file) => fs.readFileSync(file, 'utf8').includes(marker))
      .map((file) => path.relative(SRC, file));
    expect(holders).toEqual([path.join('components', 'SessionOptions.jsx')]);
  });

  test('the create dialog renders all three', () => {
    const src = fs.readFileSync(path.join(SRC, 'components', 'GameSetupDialog.jsx'), 'utf8');
    expect(src).toMatch(/<SessionOptions\b/);
    expect(src).toMatch(/<SessionCategories\b/);
    expect(src).toMatch(/<SessionBriefing\b/);
  });
});
```

Run: `cd src && npm test -- sessionOptions.test`
Expected: FAIL — `Cannot find module '../components/SessionOptions'`.

- [ ] **Step 3: Create the shared component**

Create `src/src/components/SessionOptions.jsx`. Its three return blocks are GameSetupDialog's own JSX, moved: the grid from `{newGameSetId && !isSurvey && (…)}`, the briefing from `{isCallAndAnswer && (…)}`, and the fold from `<details className="gsd-adv">` to its `</details>`, with the dialog's state names replaced by `value.*`, `anonymous`, `shuffled`, `aiContext`, `eventDetails`, `shuffleLocked` and `onChange({...})`, and the four ids built from `idPrefix`. The whole file:

```jsx
/**
 * THE SESSION OPTIONS, WRITTEN ONCE — the create dialog's category grid,
 * Workie's briefing and its Advanced fold, shared with the event item dialog
 * (docs/superpowers/plans/2026-09-26-events-m1b-richer-agenda.md, Task 3).
 *
 * The owner, 26 Sep 2026: "It would also be nice if all of the options that
 * you get when setting up each engagement is avail". So an agenda item offers
 * exactly what GameSetupDialog offers at creation, by rendering these same
 * three components — never a second copy of the controls
 * (__tests__/sessionOptions.test.jsx fails if one appears elsewhere):
 *
 *   SessionCategories  the category grid and the line that counts it
 *   SessionBriefing    Workie's briefing (Call & Answer only) — BriefingField
 *   SessionOptions     the Advanced fold: responses (or a survey's Names),
 *                      questions, Workie, and what people see when they join
 *
 * MOVED, NOT REWRITTEN. The markup, the classes and every sentence are
 * GameSetupDialog's as they were on 26 Sep 2026;
 * __tests__/gameSetupDialogDom.test.jsx recorded the create dialog's form
 * before the move and holds it to the byte.
 *
 * CONTROLLED. Every value arrives in `value` and leaves as a patch through
 * `onChange(patch)`, under the create payload's own keys (anonymousResponses,
 * randomizeQuestions, names, personaId, promptId, aiContext, eventDetails) —
 * the keys GameSetupDialog raises and an event item stores as its Settings.
 *
 * THE ONE FETCH, moved here from GameSetupDialog with the block it serves.
 * The Advanced line says "follows this set's own summary approach" only when
 * the prompt library really holds the set's prompt, and the approach picker
 * offers the library's summary prompts for this format. One request when the
 * block mounts. A failure leaves the list UNKNOWN (null), never "empty": an
 * unreadable library is not evidence about the set, and answering it with
 * "the standard way" would over-claim in the other direction.
 *
 * STYLED BY GameSetupDialog.css under its `.gsd` scope, whose tokens are the
 * dusk card and field. The create dialog is that scope; the item dialog wraps
 * these in a `.gsd` element (sessionOptionsPalette.test.js holds its tokens
 * equal to the item dialog's own surface).
 *
 * `idPrefix` names every id, so the create dialog keeps `gsd-persona` and the
 * item dialog gets ids of its own.
 */
import React, { useEffect, useRef, useState } from 'react';
import { gameTypeMeta, normalizeGameType } from '../config/gameTypes';
import { anonymityApplies } from '../config/anonymity';
import { NAMES_MODES, namesMode } from '../config/surveyNames';
import { advancedSummary } from '../config/setupDefaults';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import BriefingField from './BriefingField';
import Icon from './Icon';
import './GameSetupDialog.css';

/** "None picked, so all 4 are in · 12 questions" — what will be asked, not the chips. */
const questionsIn = (list) => {
  const n = list.reduce((sum, c) => sum + (Number(c.questionCount) || 0), 0);
  return `${n} question${n === 1 ? '' : 's'}`;
};

/**
 * THE CATEGORY GRID — the app's multi-select, kept deliberately. A set carries
 * 4-24 categories with wildly different counts; a single-value <select>
 * cannot say "these three, not those five".
 *
 * @param {object[]} categories  `{ name, questionCount }` for the chosen set
 * @param {Set}      selected    the chosen names
 * @param {boolean}  editing     an edit refuses an empty selection; a create
 *                               reads it as "all of them"
 * @param {Function} onToggle    (name) => void
 */
export function SessionCategories({
  idPrefix = 'gsd', categories = [], selected = new Set(), editing = false, onToggle,
}) {
  const labelId = `${idPrefix}-categories-label`;
  const picked = categories.filter((c) => selected.has(c.name));
  return (
    <div className="form-group">
      <span className="gsd-label" id={labelId}>Categories</span>
      <div className="category-selection">
        <div className="category-button-grid" role="group" aria-labelledby={labelId}>
          {categories.map((category) => (
            <button
              key={category.name}
              type="button"
              className={`category-button ${selected.has(category.name) ? 'selected' : ''}`}
              aria-pressed={selected.has(category.name)}
              onClick={() => onToggle?.(category.name)}
            >
              <span className="category-name">{category.name}</span>
              <span className="category-count">({category.questionCount})</span>
            </button>
          ))}
        </div>
        <small className="dialog-help-text">
          {/*
            Edit and create disagree about what an empty selection MEANS,
            and the copy has to carry the difference. Create's empty set
            is "the host never opened the picker" and falls back to all;
            an edit that ends empty is a host who deselected everything,
            and the save button refuses it rather than storing a session
            with no reachable questions.
          */}
          {editing
            ? (selected.size === 0
              ? 'Select at least one category — a session with none has no questions to ask.'
              : `${selected.size} of ${categories.length} categories enabled`)
            : (selected.size === 0
              ? `None picked, so all ${categories.length} are in · ${questionsIn(categories)}`
              : `${picked.length} of ${categories.length} categories · ${questionsIn(picked)}`)}
        </small>
      </div>
    </div>
  );
}

/**
 * WORKIE'S BRIEFING — main view, Call & Answer only (session-setup-redesign
 * 01, 03). The one Workie input that changes what Workie KNOWS; under
 * Advanced it would never be found. BriefingField owns every state.
 */
export function SessionBriefing({ value = null, onChange, onWorkingChange }) {
  return (
    <>
      <h3 className="gsd-section">
        Workie’s briefing<span className="gsd-tag">Call &amp; Answer only</span>
      </h3>
      <BriefingField
        value={value}
        onChange={onChange}
        onWorkingChange={onWorkingChange}
      />
    </>
  );
}

/**
 * THE ADVANCED FOLD (docs/design/session-setup-redesign, PLAN Phase 1). A
 * native <details>, closed on open; its summary is the plan in one sentence
 * (config/setupDefaults.js), any change first in amber, so closing it never
 * hides a decision. Always rendered, so a value set and folded away is still
 * in the form.
 *
 * @param {string}   gameType      the format the options are for
 * @param {object}   value         { anonymousResponses, randomizeQuestions,
 *                                   names, personaId, promptId, aiContext,
 *                                   eventDetails }
 * @param {Function} onChange      (patch) => void, keys as in `value`
 * @param {object[]} personas      the voices for this format
 * @param {string}   setPromptId   the chosen set's own summary prompt, if any
 * @param {string}   namesDefault  the chosen survey set's own Names default
 * @param {boolean}  shuffleLocked an edit: the order was drawn at creation
 */
export default function SessionOptions({
  idPrefix = 'gsd',
  gameType = 'call-and-answer',
  value = {},
  onChange = () => {},
  personas = [],
  setPromptId = '',
  namesDefault = '',
  shuffleLocked = false,
}) {
  const isSurvey = normalizeGameType(gameType) === 'survey';
  const anonymous = value.anonymousResponses !== false;
  const shuffled = value.randomizeQuestions !== false;
  const aiContext = value.aiContext || '';
  const eventDetails = value.eventDetails || '';
  const names = namesMode(value.names);
  const setNamesDefault = isSurvey && namesDefault ? namesMode(namesDefault) : null;

  // NULL IS "NOT KNOWN", AND IT IS NOT THE SAME AS EMPTY — see the header.
  const [knownPromptIds, setKnownPromptIds] = useState(null);
  // The same list, kept whole: the approach picker offers the summary
  // prompts written for this format.
  const [promptList, setPromptList] = useState([]);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const response = await authFetch(adminApiUrl('admin/ai-prompts'));
        if (!response || !response.ok) return;
        const data = await response.json().catch(() => ({}));
        const rows = (data.prompts || []).filter((p) => p && p.promptId);
        const ids = rows.map((p) => p.promptId);
        if (live) {
          setKnownPromptIds(new Set(ids));
          setPromptList(rows);
        }
      } catch (e) {
        // Left unknown on purpose — see the header. Nothing on screen
        // depends on this request.
      }
    })();
    return () => { live = false; };
  }, []);

  /** The chosen set's own summary prompt, and whether it can actually be honoured. */
  const setPromptWillBeUsed = Boolean(setPromptId)
    && (knownPromptIds === null || knownPromptIds.has(setPromptId));
  /*
    THE APPROACH PICKER'S LIST: summary prompts for THIS format. The same
    filter the set editor applies (QuestionSetEditor.jsx:willRunAsASummary) —
    a generator prompt, or one the list already knows cannot drive a summary,
    is not offered; 'unknown' is the normal verdict and is kept.
  */
  const promptChoices = promptList.filter((p) => normalizeGameType(p.gameType) === normalizeGameType(gameType)
    && p.summaryPromptStatus !== 'unusable'
    && p.promptType !== 'generation');

  /*
    ONE RADIO GROUP, KEYBOARD INCLUDED. Three buttons with role="radio" are a
    radio group only if they behave as one: a single tab stop (the checked
    option), and the arrow keys move the choice — wrapping at the ends, the
    way a native radio group does.
  */
  const namesRefs = useRef([]);
  const onNamesKey = (event, index) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + NAMES_MODES.length) % NAMES_MODES.length;
    onChange({ names: NAMES_MODES[next].id });
    namesRefs.current[next]?.focus?.();
  };

  /*
    ── WHAT THE ADVANCED LINE SAYS ────────────────────────────────────────────
    Every default in force, any change first. config/setupDefaults.js decides
    what "default" means; the names come from the lists this block holds (the
    whole prompt list, so an edit's seeded approach is named even when it is
    not one this format offers).
  */
  const summary = advancedSummary({
    gameType,
    anonymousResponses: anonymous,
    randomizeQuestions: shuffled,
    names: value.names,
    namesDefault,
    personaId: value.personaId || '',
    promptId: value.promptId || '',
    eventDetails,
    aiContext,
    personas,
    promptChoices: promptList,
    setPromptWillBeUsed,
  });

  return (
    <details className="gsd-adv">
      <summary>
        <span className="gsd-adv-k"><i className="gsd-chev" aria-hidden="true" />Advanced</span>
        <span className="gsd-adv-s" data-testid="gsd-adv-summary">
          {summary.lead && <b>{summary.lead}</b>}
          {summary.lead && summary.rest ? ' ' : ''}
          {summary.rest}
          {!summary.lead && <span className="gsd-adv-open-only"> Change any of them here.</span>}
        </span>
      </summary>

      <div className="gsd-adv-body">
        {/* Checked against this dialog's own type picker, not the live
            game's `currentGameType`, which still names whatever is on
            screen until the new game is created. A survey's Names takes
            the anonymity card's place. */}
        {(anonymityApplies(gameType) || isSurvey) && (
          <h3 className="gsd-section">Responses</h3>
        )}

        {anonymityApplies(gameType) && (
          <div className={`gsd-opt${anonymous ? ' is-on' : ''}`}>
            <label className="gsd-opt-head">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => onChange({ anonymousResponses: e.target.checked })}
              />
              <span className="gsd-opt-name">Anonymous responses</span>
              {/* aria-hidden: the checkbox already announces its own state,
                  and without this the browser folds "On" into the control's
                  accessible name and calls it "on". */}
              <span className="gsd-opt-state" aria-hidden="true">{anonymous ? 'On' : 'Off'}</span>
            </label>

            {/* KEEP THIS SENTENCE. The mockup says "Until you reveal them",
                which tells the host they hold a switch they do not hold:
                get-results.js:207-217 sets AuthorsRevealed UNCONDITIONALLY on
                entering RESULTS, and /reveal-authors is only an *early*
                reveal. A host who read the mockup's line and then closed
                voting to show the tally would have attributed every answer
                believing they had not. */}
            <p className="gsd-opt-does">
              Until voting closes, nobody sees who wrote which answer — not the room,
              not you. The room votes on the answers, not on the people. You can also
              reveal the names earlier if you want to.
            </p>

            <div className="gsd-preview">
              <div className="gsd-pv">
                <h6>While voting</h6>
                <p className="gsd-pv-ans">&ldquo;Freeze all discretionary discounting for thirty days&hellip;&rdquo;</p>
                <p className="gsd-pv-who">Response 1</p>
              </div>
              <div className="gsd-pv">
                <h6>After voting closes</h6>
                <p className="gsd-pv-ans">&ldquo;Freeze all discretionary discounting for thirty days&hellip;&rdquo;</p>
                <p className="gsd-pv-who named">Priya Raghavan &middot; +180 pts</p>
              </div>
            </div>

            <p className="gsd-opt-else">
              {anonymous
                ? <><b>Turn it off</b> and every answer is labelled with its author from the moment voting opens.</>
                : <><b>It is off</b> — every answer is labelled with its author from the moment voting opens.</>}
            </p>

            {/* Never overclaim. Shipped verbatim. */}
            <p className="gsd-opt-limit">
              This hides names, not identities. In a small group, people may still
              recognise each other’s answers.
            </p>
          </div>
        )}

        {isSurvey && (
          /*
            THE NAMES CARD — 07-start-survey.html, which draws it as "the
            shipped card, one control wider": the option card above, with its
            checkbox become a three-way choice. Every sentence is the value's
            own, from config/surveyNames.js — the chooser line, what it does,
            the phone's promise — so what the host chose and what the room is
            told cannot drift.

            "What you get" is a SAMPLE of the host's view in each mode, drawn
            from 07's own example and 33-people's statuses. It shows the shape
            of what comes back, not this survey's answers.
          */
          <>
            <div className="gsd-names">
              <div className="gsd-names-hd">
                <span className="gsd-opt-name">Names</span>
                <span className="gsd-names-st" aria-hidden="true">{names.label}</span>
              </div>
              <div className="gsd-three" role="radiogroup" aria-label="Names">
                {NAMES_MODES.map((mode, i) => {
                  const on = mode.id === names.id;
                  return (
                    <button
                      key={mode.id}
                      ref={(el) => { namesRefs.current[i] = el; }}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={on ? 0 : -1}
                      className="gsd-three-opt"
                      onClick={() => onChange({ names: mode.id })}
                      onKeyDown={(event) => onNamesKey(event, i)}
                    >
                      <b><i aria-hidden="true" />{mode.label}</b>
                      <span>{mode.hostLine}</span>
                    </button>
                  );
                })}
              </div>
              <p className="gsd-opt-does">{names.does}</p>
              <div className="gsd-preview">
                <div className="gsd-pv">
                  <h6>What their phone says</h6>
                  <p className="gsd-pv-ans" data-testid="names-phone-preview">
                    {names.phoneLead && <b>{names.phoneLead}</b>}
                    {names.phoneLead ? ' ' : ''}
                    {names.phoneLine}
                  </p>
                </div>
                <div className="gsd-pv">
                  <h6>What you get</h6>
                  <p className="gsd-pv-ans">&ldquo;Seeing the console actually run beat every slide about it.&rdquo;</p>
                  {names.id === 'named' ? (
                    <p className="gsd-pv-who named">Priya Raghavan</p>
                  ) : (
                    <p className="gsd-pv-who">Response 12 &middot; no name</p>
                  )}
                  {names.id === 'finished' && (
                    <>
                      <p className="gsd-pv-ans gsd-pv-gap">Priya Raghavan &middot; finished 2:12pm</p>
                      <p className="gsd-pv-who">People list &middot; no answers</p>
                    </>
                  )}
                </div>
              </div>
              {/* Never overclaim. The shipped card's own sentence, verbatim. */}
              <p className="gsd-opt-limit">
                This hides names, not identities. In a small group, people may still
                recognise each other’s answers.
              </p>
            </div>
            <p className="gsd-names-lock">
              <Icon name="Lock" weight="bold" size={13} color="currentColor" />
              {' Fixed once the survey opens — people answer on the promise their phone made them.'}
              {/* Only when the set really carries one: pointing the host at a
                  set-level default that does not exist would be a lie. */}
              {setNamesDefault && (
                <>{' This set’s default is '}<b>{setNamesDefault.label}</b>.</>
              )}
            </p>
          </>
        )}

        {!isSurvey && (
          <>
            <h3 className="gsd-section">Questions</h3>
            <div className={`gsd-opt${shuffled ? ' is-on' : ''}`}>
              <label className="gsd-opt-head">
                {/* Disabled in edit mode: the per-category order rows were
                    shuffled (or not) when the session was created, so the PUT
                    whitelist refuses this flag — a live checkbox here would
                    toggle something that silently fails to save. */}
                <input
                  type="checkbox"
                  checked={shuffled}
                  disabled={shuffleLocked}
                  onChange={(e) => onChange({ randomizeQuestions: e.target.checked })}
                />
                <span className="gsd-opt-name">Shuffle the question order</span>
                <span className="gsd-opt-state" aria-hidden="true">{shuffled ? 'On' : 'Off'}</span>
              </label>
              {/* Both branches, because the off state is the one nobody guesses. */}
              <p className="gsd-opt-does">
                {shuffled
                  ? 'Questions are drawn at random from the categories you picked, rather than in the order they were written.'
                  : 'Questions are asked in order, completing each category before moving to the next.'}
              </p>
              {shuffleLocked && (
                <p className="gsd-opt-limit">
                  Fixed once the session is created — the question order was drawn when
                  this session was set up.
                </p>
              )}
            </div>
          </>
        )}

        <h3 className="gsd-section">Workie</h3>

        <div className="form-group">
          <label htmlFor={`${idPrefix}-persona`}>Workie's voice</label>
          <select
            id={`${idPrefix}-persona`}
            value={value.personaId || ''}
            onChange={(e) => onChange({ personaId: e.target.value })}
            className="dialog-select"
          >
            {/* Adapting to the session is the designed default, not a
                fallback — a fixed persona is what made Workie refuse a
                holiday icebreaker as "insufficient for business analysis". */}
            <option value="">Adapt to the session (recommended)</option>
            {personas.map((persona) => (
              <option key={persona.personaId} value={persona.personaId}>
                {persona.name}{persona.tagline ? ` — ${persona.tagline}` : ''}
              </option>
            ))}
          </select>
          <small className="dialog-help-text">
            {value.personaId
              ? 'Workie keeps this voice for the whole session. You can change it between rounds.'
              : 'Workie reads the room and picks its own register — playful for an icebreaker, analytical for a retro.'}
          </small>
        </div>

        {/*
          THE SESSION'S SUMMARY APPROACH — the owner (2026-09-22): "how do I
          select the right prompt for the results screen ... and how can we
          change it during the session setup". Beside the voice, filtered to
          the format, and defaulting to what the Advanced line promises: the
          set's own approach if it names one, else the format standard. The
          pick lands on the game record (PromptId) and beats the set's.
        */}
        <div className="form-group">
          <label htmlFor={`${idPrefix}-prompt`}>Summary approach</label>
          <select
            id={`${idPrefix}-prompt`}
            value={value.promptId || ''}
            onChange={(e) => onChange({ promptId: e.target.value })}
            className="dialog-select"
          >
            <option value="">
              {setPromptWillBeUsed
                ? 'What the set says (recommended)'
                : `The standard ${gameTypeMeta(gameType).label} way (recommended)`}
            </option>
            {promptChoices.map((prompt) => (
              <option key={prompt.promptId} value={prompt.promptId}>
                {prompt.name}{prompt.category ? ` (${prompt.category})` : ''}
              </option>
            ))}
          </select>
          <small className="dialog-help-text">
            How Workie sums up each round on the results screen — the shape and content, where the voice is only the register. You can change it mid-session; it applies from the next round.
          </small>
        </div>


        {/*
          "AI CONTEXT", RENAMED FOR WHAT IT DOES. The prompt carries it as
          THE HOST'S INSTRUCTIONS and demands it in every section of the
          summary (personas.js) — rules, not background. Facts about the
          session are Event details' job, and the prompt reads those too.
        */}
        <div className="form-group">
          <label htmlFor={`${idPrefix}-ai-context`}>Instructions for Workie</label>
          <textarea
            id={`${idPrefix}-ai-context`}
            value={aiContext}
            onChange={(e) => onChange({ aiContext: e.target.value })}
            placeholder="Anything Workie must always do — e.g. ‘end every round with one question for the ops leads’"
            className="dialog-textarea"
            rows="2"
            maxLength="500"
          />
          <small className="dialog-help-text">
            Workie follows these in every round’s summary. Facts about the session belong in
            Event details, below.
            {' '}{aiContext.length}/500 characters
          </small>
        </div>

        <h3 className="gsd-section">What people see when they join</h3>

        <div className="form-group">
          <label htmlFor={`${idPrefix}-details`}>Event details</label>
          <textarea
            id={`${idPrefix}-details`}
            value={eventDetails}
            onChange={(e) => onChange({ eventDetails: e.target.value })}
            placeholder="What this session is for, in a sentence or two."
            className="dialog-textarea"
            rows="2"
            maxLength="300"
          />
          <small className="dialog-help-text">
            Shown to people on the screen they land on after joining. Workie reads it too.
            {' '}{eventDetails.length}/300 characters
          </small>
        </div>
      </div>
    </details>
  );
}
```

- [ ] **Step 4: GameSetupDialog renders the three, and keeps its state**

In `src/src/components/GameSetupDialog.jsx`, make these edits, in order.

(a) The header paragraph. Replace

```js
 * PURE-PROPS, WITH ONE NAMED EXCEPTION. Every FORM field arrives as a prop and
 * leaves in one payload, and that stays. The single `authFetch` in this file
 * reads the prompt library so the Advanced line can check a claim instead of
 * asserting one — evidence for a sentence, never a value the form owns. Its reasoning is at the fetch itself.
```

with

```js
 * PURE PROPS. Every FORM field arrives as a prop and leaves in one payload,
 * and that stays. The options themselves — the category grid, Workie's
 * briefing and the Advanced fold — are components/SessionOptions.jsx, shared
 * with the event item dialog (events M1b), and the one fetch this file used
 * to make (the prompt library, the evidence behind the Advanced line's claim)
 * moved there with the block it serves.
```

(b) The imports. Replace

```js
import { anonymityApplies } from '../config/anonymity';
import { NAMES_MODES, NAMES_DEFAULT, namesMode } from '../config/surveyNames';
import { advancedSummary } from '../config/setupDefaults';
import Icon from './Icon';
```

with

```js
import { NAMES_DEFAULT, namesMode } from '../config/surveyNames';
import Icon from './Icon';
```

replace

```js
import BriefingField from './BriefingField';
```

with

```js
import SessionOptions, { SessionCategories, SessionBriefing } from './SessionOptions';
```

and delete these two lines:

```js
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
```

(c) Replace

```js
  const chosenSet = allSets.find((s) => sameSetRef(s, newGameSetRef)) || null;
  const setNamesDefault = isSurvey && chosenSet && chosenSet.namesDefault
    ? namesMode(chosenSet.namesDefault) : null;
  const names = namesMode(namesChoice);
```

with

```js
  const chosenSet = allSets.find((s) => sameSetRef(s, newGameSetRef)) || null;
```

(d) The fetch moves out. Delete everything from the `  /*` that opens the comment `    ── THE ONE FETCH IN THIS FILE, AND WHY IT IS ALLOWED TO BE HERE ───────────` down to and including the `  */` that closes the comment ending `    on open and Save then sent promptId: '', which REMOVEs it.` (the block holds the fetch `useEffect`, `chosenSetPromptId`, `setPromptWillBeUsed` and `promptChoices`), and put in its place:

```js
  /** The chosen set's own summary prompt, for the Advanced line's claim —
      SessionOptions checks it against the prompt library it reads. */
  const chosenSetPromptId = allSets.find((s) => s.id === newGameSetId)?.promptId || '';
```

(e) The Names keyboard moves out. Delete everything from the `  /*` that opens `    ONE RADIO GROUP, KEYBOARD INCLUDED.` down to and including the `  };` that closes `onNamesKey`, and put in its place:

```js
  /** SessionOptions reports each change under the payload's own key. */
  const changeOptions = (patch) => {
    if ('anonymousResponses' in patch) setAnonymousResponses(patch.anonymousResponses);
    if ('randomizeQuestions' in patch) setRandomizeQuestions(patch.randomizeQuestions);
    if ('names' in patch) pickNames(patch.names);
    if ('personaId' in patch) setNewGamePersonaId(patch.personaId);
    if ('promptId' in patch) setNewGamePromptId(patch.promptId);
    if ('aiContext' in patch) setGameAiContext(patch.aiContext);
    if ('eventDetails' in patch) setEventDetails(patch.eventDetails);
  };
```

(f) Delete the Advanced line's computation: everything from the `  /*` that opens `    ── WHAT THE ADVANCED LINE SAYS ────` down to and including the `  });` that closes `const summary = advancedSummary({`.

(g) Delete the category counting: the two comment lines beginning `  // "None picked, so all 4 are in · 12 questions" — the count of what will be` down to and including the `  };` that closes `const questionsIn = (list) => {`.

(h) The category grid. Replace the whole expression that begins

```jsx
          {newGameSetId && !isSurvey && (
            <div className="form-group">
              <span className="gsd-label" id="gsd-categories-label">Categories</span>
```

and ends at its closing

```jsx
            </div>
          )}
```

(the `</div>` at twelve spaces, directly before the `        </div>` that closes `gsd-row`) with

```jsx
          {newGameSetId && !isSurvey && (
            <SessionCategories
              categories={categories}
              selected={selectedCats}
              editing={isEdit}
              onToggle={(name) => (isEdit ? toggleEditCategory(name) : onToggleCategory?.(name))}
            />
          )}
```

(i) The briefing. Replace the whole expression that begins

```jsx
        {isCallAndAnswer && (
          <>
            <h3 className="gsd-section">
              Workie’s briefing<span className="gsd-tag">Call &amp; Answer only</span>
```

and ends at its closing `          </>` and `        )}`, with

```jsx
        {isCallAndAnswer && (
          <SessionBriefing value={briefing} onChange={setBriefing} onWorkingChange={setBriefingWorking} />
        )}
```

(j) The Advanced fold. Replace everything from the `        {/*` that opens the comment `          ── ADVANCED ────` down to and including the first `        </details>` after it with

```jsx
        {/*
          ── ADVANCED ─────────────────────────────────────────────────────────
          components/SessionOptions.jsx, shared with the event item dialog
          (events M1b). Always rendered, so a value set and folded away is
          still in the form.
        */}
        <SessionOptions
          idPrefix="gsd"
          gameType={engagementType}
          value={{
            anonymousResponses,
            randomizeQuestions,
            names: namesChoice,
            personaId: newGamePersonaId,
            promptId: newGamePromptId,
            aiContext: gameAiContext,
            eventDetails,
          }}
          onChange={changeOptions}
          personas={personas}
          setPromptId={chosenSetPromptId}
          namesDefault={chosenSet ? chosenSet.namesDefault : ''}
          shuffleLocked={isEdit}
        />
```

The dialog keeps every piece of state it had (`gameSession.test.js` reads its `useState` pairs); only the fetch's two pieces of state moved.

- [ ] **Step 5: The recorded form still matches, and every GameSetupDialog suite is green, unedited**

Run: `cd src && npm test -- gameSetupDialogDom gameSetupDialog gameSetupPalette gameSetupCallSite surveySetupNames workieSettings hostQuestionSets gameSession createGamePayload setupDefaults undeclaredSetters modal sessionOptions.test`
Expected: `Test Suites: 17 passed`, `Snapshots: 7 passed, 7 total`, and **no** `snapshots written` / `snapshots updated` line — the snapshot recorded in Step 1 matched as it was. If it does not match, the move changed the dialog: fix the move; never run `-u` in this task.

Run: `cd src && npx eslint src/components/GameSetupDialog.jsx src/components/SessionOptions.jsx`
Expected: no output (no unused import left behind).

- [ ] **Step 6: The full frontend suite, lint, build and the backend loop, then commit**

Run `cd src && npm test`, `cd src && npm run lint`, `cd src && npm run build`, and the backend loop (backend tests read frontend source). Expected: the baseline plus the two new suites, all green.

```bash
git add src/src/components/SessionOptions.jsx src/src/components/GameSetupDialog.jsx src/src/__tests__/sessionOptions.test.jsx
git commit -m "The create dialog's options are one shared component, drawn exactly as before

SessionOptions.jsx now holds the category grid, Workie's briefing and the
Advanced fold (with the prompt-library fetch that serves it), controlled
through the create payload's own keys, so the event item dialog can render
the same options (owner, 26 Sep: \"all of the options that you get when
setting up each engagement\"). GameSetupDialog renders the three and keeps
its state. gameSetupDialogDom.test.jsx, recorded before the move, still
matches; every GameSetupDialog suite is unedited and green.
sessionOptions.test.jsx pins the component and that no second copy exists.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: The goal in the create and edit dialog

The Goal field joins the shared options' Questions section (so every dialog that renders `SessionOptions` gets it); the create dialog seeds, bounds and raises it; `createGameBody`/`updateGameBody` send it; the Advanced line names it. A survey never shows it.

Screens: `docs/design/session-setup-redesign/` 02 (the Advanced fold open) — the field is built in its idiom (a `form-group` with the uppercase label, `dialog-input` at body size, a `dialog-help-text` line); no mockup draws it.

**Files:**
- Modify: `src/src/components/SessionOptions.jsx`
- Modify: `src/src/components/GameSetupDialog.jsx`
- Modify: `src/src/components/GameSetupDialog.css`
- Modify: `src/src/config/setupDefaults.js`
- Modify: `src/src/config/createGame.js`
- Modify: `src/src/config/gameSession.js` (the header's list of the dialog's own keys)
- Modify: `src/src/__tests__/__snapshots__/gameSetupDialogDom.test.jsx.snap` (updated by `-u`, reviewed)
- Create: `src/src/__tests__/gameSetupGoal.test.jsx`
- Create: `src/src/__tests__/sessionGoalPayload.test.js`
- Create: `src/src/__tests__/sessionOptionsPalette.test.js`

**Interfaces:**
- Consumes: `checkTarget`, `goalApplies` (Task 1; the browser imports `lambda-functions/websocket/session-goal.js` as a default import, `goalRules`, as `EventItemDialog` imports `agenda-rules`); `SessionOptions` (Task 3); host-details `target` (Task 2).
- Produces: `SessionOptions` `value.target: number|null` and prop `questionCount: number` (the Goal field, id `${idPrefix}-goal`, label "Goal"); GameSetupDialog's `onCreate` payload gains `target` (absent for a survey); `createGameBody` sends `target` when a goal is set (never for a survey); `updateGameBody` sends `target` only when the form has the key (`null` clears); `advancedSummary({…, target})` names "a goal of N questions".

- [ ] **Step 1: Write the failing tests**

Create `src/src/__tests__/gameSetupGoal.test.jsx`:

```jsx
/**
 * THE GOAL IN THE CREATE AND EDIT DIALOG — components/GameSetupDialog.jsx and
 * the Goal field of components/SessionOptions.jsx (events M1b, Task 4).
 *
 * The owner: "even though the set contains 50 question they might have a goal
 * of 5 questions".
 *
 * rejects: a goal the chosen set cannot meet reaching onCreate; a goal offered
 * on a survey, or sent for one; a blank goal treated as an error; an edit that
 * forgets the session's goal, or cannot clear it; the Advanced line hiding a
 * goal the host set.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GameSetupDialog from '../components/GameSetupDialog';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ prompts: [] }) })),
}));

const SETS = [
  { id: 'space', name: 'Space Trivia', totalQuestions: 12, engagementType: 'trivia', hasImages: false },
  { id: 'pulse', name: 'Kickoff pulse', totalQuestions: 5, engagementType: 'survey', hasImages: false },
];
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const setup = (overrides = {}) => {
  const props = {
    isFirstEngagement: true,
    eventTitle: 'Q3 Offsite',
    onEventTitleChange: jest.fn(),
    questionSets: SETS,
    personas: [],
    categories: [],
    activeCategoryIds: new Set(),
    onToggleCategory: jest.fn(),
    onQuestionSetChange: jest.fn(),
    onCancel: jest.fn(),
    onCreate: jest.fn(),
    ...overrides,
  };
  render(<GameSetupDialog {...props} />);
  return props;
};
const pickTrivia = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Trivia' }));
  fireEvent.change(screen.getByLabelText(/question set/i), { target: { value: 'platform:space' } });
};
const create = () => screen.getByRole('button', { name: 'Create engagement' });

describe('a goal at create', () => {
  test('a goal within the set travels in the payload, and the field says the set\'s size', async () => {
    const props = setup();
    await settle();
    pickTrivia();
    expect(screen.getByText('of 12 questions')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '5' } });
    fireEvent.click(create());
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ gameType: 'trivia', target: 5 }));
  });

  test('blank is no goal, and is not an error', async () => {
    const props = setup();
    await settle();
    pickTrivia();
    expect(create()).toBeEnabled();
    fireEvent.click(create());
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ target: null }));
  });

  // rejects: a goal the set cannot meet reaching the server as a surprise 400.
  test('more questions than the set holds disables Create and says why', async () => {
    const props = setup();
    await settle();
    pickTrivia();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '13' } });
    expect(create()).toBeDisabled();
    expect(screen.getByText('This set has 12 questions, so the goal can be 12 at most.')).toBeInTheDocument();
    fireEvent.click(create());
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  test('only digits are taken', async () => {
    setup();
    await settle();
    pickTrivia();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '5a!' } });
    expect(screen.getByLabelText('Goal')).toHaveValue('5');
  });

  test('the Advanced line names a goal the host set', async () => {
    setup();
    await settle();
    pickTrivia();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '5' } });
    expect(screen.getByTestId('gsd-adv-summary')).toHaveTextContent('Changed: a goal of 5 questions.');
  });

  test('a survey has no goal to set, and sends none', async () => {
    const props = setup();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Survey' }));
    fireEvent.change(screen.getByLabelText(/question set/i), { target: { value: 'platform:pulse' } });
    expect(screen.queryByLabelText('Goal')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open the survey' }));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect('target' in props.onCreate.mock.calls[0][0]).toBe(false);
  });
});

describe('a goal on an edit', () => {
  const EDIT = {
    mode: 'edit',
    initialValues: { gameType: 'trivia', questionSetId: 'space', questionSetScope: 'platform', title: 'Space night', target: 4 },
  };

  test('the session\'s goal is shown, and saved back', async () => {
    const props = setup(EDIT);
    await settle();
    expect(screen.getByLabelText('Goal')).toHaveValue('4');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ target: 4 }));
  });

  test('clearing it sends null, which removes it', async () => {
    const props = setup(EDIT);
    await settle();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ target: null }));
  });
});
```

Create `src/src/__tests__/sessionGoalPayload.test.js`:

```js
/**
 * THE GOAL ON THE WIRE, FROM THE BROWSER — createGameBody and updateGameBody
 * (config/createGame.js), events M1b Task 4. create-game.js and
 * update-game.js are whitelists, so the one tested definition of the key
 * lives here, beside createGamePayload.test.js (which is not edited).
 *
 * rejects: a blank goal sent at create; a goal sent for a survey; an edit
 * that cannot clear a goal; an edit that never mentioned the goal sending one;
 * a refused value dropped in silence instead of reaching the server's refusal.
 */
import { createGameBody, updateGameBody } from '../config/createGame';

const base = { title: 'Space night', gameType: 'trivia', setId: 'space', setScope: 'platform' };

describe('createGameBody', () => {
  test('a goal is sent as a number', () => {
    expect(createGameBody({ ...base, target: 5 }).target).toBe(5);
  });
  test('no goal sends no key', () => {
    for (const target of [undefined, null, '']) {
      expect('target' in createGameBody({ ...base, target })).toBe(false);
    }
  });
  test('a survey never sends one', () => {
    expect('target' in createGameBody({ ...base, gameType: 'survey', target: 5 })).toBe(false);
  });
  test('a value the rule refuses is sent as typed, for the server to refuse', () => {
    expect(createGameBody({ ...base, target: 0 }).target).toBe(0);
  });
});

describe('updateGameBody', () => {
  test('a goal the form carries is sent; null clears it', () => {
    expect(updateGameBody({ ...base, target: 7 }).target).toBe(7);
    expect(updateGameBody({ ...base, target: null }).target).toBeNull();
  });
  test('a form that says nothing about the goal sends no key', () => {
    expect('target' in updateGameBody(base)).toBe(false);
  });
  test('a survey never sends one', () => {
    expect('target' in updateGameBody({ ...base, gameType: 'survey', target: 3 })).toBe(false);
  });
});
```

Create `src/src/__tests__/sessionOptionsPalette.test.js`:

```js
/**
 * THE SESSION OPTIONS' COLOURS — the rules components/SessionOptions.jsx adds
 * to components/GameSetupDialog.css (events M1b), composited the way
 * gameSetupPalette.test.js composites the rest of that sheet (which is not
 * edited).
 *
 * Named *Palette*, never *Token* — .gitignore's unanchored `*token*` would hide
 * it from git.
 *
 * rejects: a goal the set cannot meet said in a colour that fails AA on the
 * card; the goal's rules leaving the `.gsd` scope; a raw colour in them.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'GameSetupDialog.css');
const GLOBAL = read('styles.css');

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function tokenIn(css, block, name) {
  const start = css.indexOf(block);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} is not declared in ${block}`);
  return parseHex(m[1]);
}
const AA = 4.5;
const card = () => tokenIn(CSS, '.gsd {', '--gsd-card');

describe('the goal', () => {
  test('a goal the set cannot meet is said in --danger-text, at AA on the card', () => {
    expect(CSS).toMatch(/\.gsd \.dialog-help-text\.gsd-goal-problem\s*\{[^}]*color:\s*var\(--danger-text\)/);
    expect(ratio(tokenIn(GLOBAL, ':root {', '--danger-text'), card())).toBeGreaterThanOrEqual(AA);
  });

  test('the unit beside the number is muted copy, at AA on the card', () => {
    expect(CSS).toMatch(/\.gsd \.gsd-goal-unit\s*\{[^}]*color:\s*var\(--gsd-muted\)/);
    expect(ratio(tokenIn(CSS, '.gsd {', '--gsd-muted'), card())).toBeGreaterThanOrEqual(AA);
  });

  test('its rules are scoped, sized from the ladder, and carry no raw colour', () => {
    const rules = [...CSS.matchAll(/^(\.gsd[^{]*gsd-goal[^{]*)\{([^}]*)\}/gm)];
    expect(rules.length).toBe(4);
    for (const [, , body] of rules) {
      expect(body).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/);
      expect(body).not.toMatch(/font-size:\s*\d/);
    }
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd src && npm test -- gameSetupGoal sessionGoalPayload sessionOptionsPalette`
Expected: FAIL — `Unable to find a label with the text of: Goal`; `createGameBody(...).target` is `undefined`; no `.gsd-goal-problem` rule.

- [ ] **Step 3: The Goal field in `SessionOptions.jsx`**

Below `import { advancedSummary } from '../config/setupDefaults';` add:

```js
import goalRules from '../../../lambda-functions/websocket/session-goal';
```

In the header, replace

```js
 * `onChange(patch)`, under the create payload's own keys (anonymousResponses,
 * randomizeQuestions, names, personaId, promptId, aiContext, eventDetails) —
```

with

```js
 * `onChange(patch)`, under the create payload's own keys (anonymousResponses,
 * randomizeQuestions, names, target, personaId, promptId, aiContext,
 * eventDetails) —
```

In the `SessionOptions` doc block, replace

```js
 * @param {boolean}  shuffleLocked an edit: the order was drawn at creation
 */
```

with

```js
 * @param {boolean}  shuffleLocked an edit: the order was drawn at creation
 * @param {number}   questionCount the chosen set's size, which bounds the goal
 *                                 (0 = unknown: the server bounds it)
 */
```

Replace

```js
  shuffleLocked = false,
}) {
```

with

```js
  shuffleLocked = false,
  questionCount = 0,
}) {
```

Below `  const setNamesDefault = isSurvey && namesDefault ? namesMode(namesDefault) : null;` add:

```js
  // THE GOAL (events M1b, session-goal.js): a whole number of questions, or
  // null for none. A survey has no rounds, so no goal.
  const target = value.target === undefined ? null : value.target;
  const goalProblem = isSurvey ? '' : (goalRules.checkTarget(target, questionCount).error || '');
```

In the `advancedSummary({ … })` call, replace

```js
    names: value.names,
```

with

```js
    names: value.names,
    target: isSurvey ? null : target,
```

In the `{!isSurvey && ( <> … </> )}` Questions block, replace

```jsx
              {shuffleLocked && (
                <p className="gsd-opt-limit">
                  Fixed once the session is created — the question order was drawn when
                  this session was set up.
                </p>
              )}
            </div>
          </>
```

with

```jsx
              {shuffleLocked && (
                <p className="gsd-opt-limit">
                  Fixed once the session is created — the question order was drawn when
                  this session was set up.
                </p>
              )}
            </div>

            {/*
              THE GOAL (events M1b). The owner: "even though the set contains
              50 question they might have a goal of 5 questions". A plan, not a
              stop: when the room reaches it the stage and the remote say so,
              and Next stays live. Blank is no goal.
            */}
            <div className="form-group">
              <label htmlFor={`${idPrefix}-goal`}>Goal</label>
              <div className="gsd-goal">
                <input
                  id={`${idPrefix}-goal`}
                  className="dialog-input"
                  inputMode="numeric"
                  value={target === null ? '' : String(target)}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    onChange({ target: digits === '' ? null : Number(digits) });
                  }}
                  aria-describedby={`${idPrefix}-goal-help`}
                  aria-invalid={goalProblem ? 'true' : undefined}
                />
                <span className="gsd-goal-unit">
                  {questionCount ? `of ${questionCount} questions` : 'questions'}
                </span>
              </div>
              <small
                id={`${idPrefix}-goal-help`}
                className={`dialog-help-text${goalProblem ? ' gsd-goal-problem' : ''}`}
              >
                {goalProblem || 'Blank plays until you end the session. When the room reaches the goal, the stage and the remote tell you, and you can keep going.'}
              </small>
            </div>
          </>
```

- [ ] **Step 4: The create dialog holds, bounds and raises the goal**

In `src/src/components/GameSetupDialog.jsx`:

(a) Below `import SessionOptions, { SessionCategories, SessionBriefing } from './SessionOptions';` add:

```js
import goalRules from '../../../lambda-functions/websocket/session-goal';
```

(b) Below `  const [briefingWorking, setBriefingWorking] = useState(false);` add:

```js
  // THE GOAL (events M1b): how many questions the host plans to ask, or null.
  // Seeded from the session on an edit (get-game.js host-details).
  const [target, setTarget] = useState(isEdit && Number.isInteger(seed.target) ? seed.target : null);
```

(c) Delete these three lines (`canCreate` moves below `chosenSet`, which it now needs):

```js
  // A draft still being written would be lost by a Create pressed now.
  const canCreate = Boolean(newGameSetId) && title.trim().length > 0
    && !(isCallAndAnswer && briefingWorking);
```

(d) Replace

```js
  const chosenSet = allSets.find((s) => sameSetRef(s, newGameSetRef)) || null;
```

with

```js
  const chosenSet = allSets.find((s) => sameSetRef(s, newGameSetRef)) || null;
  /*
    THE GOAL is bounded by the chosen set's size — the version a create pins.
    An edited session may pin an older version; update-game.js holds that
    bound and says so if this one is wrong.
  */
  const chosenCount = chosenSet ? Number(chosenSet.totalQuestions) || 0 : 0;
  const goalProblem = isSurvey ? '' : (goalRules.checkTarget(target, chosenCount).error || '');
  // A draft still being written would be lost by a Create pressed now, and a
  // goal the set cannot meet would only be refused by the server.
  const canCreate = Boolean(newGameSetId) && title.trim().length > 0
    && !(isCallAndAnswer && briefingWorking) && !goalProblem;
```

(e) In `changeOptions`, below `    if ('names' in patch) pickNames(patch.names);` add:

```js
    if ('target' in patch) setTarget(patch.target);
```

(f) In `submit`'s payload, replace

```js
      ...(isSurvey ? { names: namesChoice } : {}),
```

with

```js
      ...(isSurvey ? { names: namesChoice } : {}),
      // The goal, for every format but a survey; null is "no goal".
      ...(isSurvey ? {} : { target }),
```

(g) In the work-in-hand `snapshot`, replace

```js
    newGamePersonaId, newGamePromptId, randomizeQuestions, anonymousResponses, namesChoice,
```

with

```js
    newGamePersonaId, newGamePromptId, randomizeQuestions, anonymousResponses, namesChoice, target,
```

(h) In `<SessionOptions … />`, replace

```jsx
            names: namesChoice,
            personaId: newGamePersonaId,
```

with

```jsx
            names: namesChoice,
            target,
            personaId: newGamePersonaId,
```

and replace

```jsx
          shuffleLocked={isEdit}
        />
```

with

```jsx
          shuffleLocked={isEdit}
          questionCount={chosenCount}
        />
```

(i) On the Create button, replace

```jsx
            title={isCallAndAnswer && briefingWorking ? 'Waiting for Workie to finish the briefing' : undefined}
```

with

```jsx
            title={isCallAndAnswer && briefingWorking ? 'Waiting for Workie to finish the briefing' : (goalProblem || undefined)}
```

(j) In `src/src/config/gameSession.js`'s header, replace

```js
 *     editCategoryNames, knownPromptIds, namesChoice (a survey's Names),
```

with

```js
 *     editCategoryNames, knownPromptIds, namesChoice (a survey's Names),
 *     target (the goal of N questions, events M1b — and since then
 *     promptList and knownPromptIds live in components/SessionOptions.jsx),
```

- [ ] **Step 5: The Advanced line names the goal; the two bodies send it**

In `src/src/config/setupDefaults.js`, in `advancedSummary`'s parameters replace

```js
  randomizeQuestions = true,
  names,
```

with

```js
  randomizeQuestions = true,
  names,
  target = null,
```

and replace

```js
  if (!isSurvey) {
    if (randomizeQuestions === false) changed.push('questions asked in order');
    else room.push('questions shuffled');
  }
```

with

```js
  if (!isSurvey) {
    if (randomizeQuestions === false) changed.push('questions asked in order');
    else room.push('questions shuffled');
    // THE GOAL (events M1b): only a goal the host set is named — no goal is
    // the default, and says nothing.
    if (Number.isInteger(target) && target > 0) changed.push(`a goal of ${target} question${target === 1 ? '' : 's'}`);
  }
```

In `src/src/config/createGame.js`, replace

```js
import { DEFAULT_SCOPE } from '../utils/setRef';
```

with

```js
import { DEFAULT_SCOPE } from '../utils/setRef';
import goalRules from '../../../lambda-functions/websocket/session-goal';

/*
 * 6. **The goal is not a survey's** (events M1b, session-goal.js). A blank
 *    goal sends no key at create; an edit sends null to clear. A value the
 *    rule refuses is sent as typed, so the server refuses it out loud rather
 *    than this function dropping it in silence.
 */
const hasGoal = (value) => value !== undefined && value !== null && value !== '';
const targetOf = (value) => {
  const checked = goalRules.checkTarget(value, 0);
  return checked.error ? value : checked.value;
};
```

In `createGameBody`, replace

```js
    anonymousResponses = true,
    names,
  } = form;

  return {
    eventTitle: title,
    engagementInfo: eventDetails || null,
    aiContext: aiContext || null,
    gameType,
```

with

```js
    anonymousResponses = true,
    names,
    target,
  } = form;

  return {
    eventTitle: title,
    engagementInfo: eventDetails || null,
    aiContext: aiContext || null,
    gameType,
```

and replace

```js
    ...(briefingApplies(gameType) && briefingValue(form.briefing) ? { briefing: briefingValue(form.briefing) } : {}),
  };
}
```

with

```js
    ...(briefingApplies(gameType) && briefingValue(form.briefing) ? { briefing: briefingValue(form.briefing) } : {}),
    ...(goalRules.goalApplies(gameType) && hasGoal(target) ? { target: targetOf(target) } : {}),
  };
}
```

In `updateGameBody`, replace

```js
    ...(briefingApplies(gameType) && 'briefing' in form ? { briefing: briefingValue(form.briefing) } : {}),
  };
}
```

with

```js
    ...(briefingApplies(gameType) && 'briefing' in form ? { briefing: briefingValue(form.briefing) } : {}),
    // The goal: only when the form says something about it; null clears it.
    ...('target' in form && goalRules.goalApplies(gameType)
      ? { target: hasGoal(form.target) ? targetOf(form.target) : null } : {}),
  };
}
```

- [ ] **Step 6: The Goal field's rules**

In `src/src/components/GameSetupDialog.css`, immediately below the `.gsd .dialog-help-text { … }` rule, add:

```css

/* THE GOAL (events M1b): a short number and its unit on one line, in the
   Advanced fold's Questions section (SessionOptions.jsx). */
.gsd .gsd-goal {
  display: flex;
  align-items: center;
  gap: 10px;
}

.gsd .gsd-goal .dialog-input {
  width: 96px;
  text-align: center;
}

.gsd .gsd-goal-unit {
  font-size: var(--gsd-t-body);
  color: var(--gsd-muted);
}

/* A goal the set cannot meet, said in the colour destructive copy takes on
   dusk (sessionOptionsPalette.test.js measures it on the card). */
.gsd .dialog-help-text.gsd-goal-problem { color: var(--danger-text); }
```

- [ ] **Step 7: The new tests pass; the recorded form changes by the Goal field alone**

Run: `cd src && npm test -- gameSetupGoal sessionGoalPayload sessionOptionsPalette`
Expected: `Tests: 18 passed`.

Run: `cd src && npm test -- gameSetupDialogDom`
Expected: FAIL — `5 snapshots failed, 2 passed` (the five non-survey shapes gained the field; the two survey shapes did not). This change is by design. Update and review it:

Run: `cd src && npm test -- gameSetupDialogDom -u`, then `git diff --stat src/src/__tests__/__snapshots__/` and read `git diff src/src/__tests__/__snapshots__/gameSetupDialogDom.test.jsx.snap`.
Expected: `5 snapshots updated`; the diff ADDS, in each of the five non-survey shapes and nowhere else, one `<div class="form-group">` holding `<label for="gsd-goal">Goal</label>`, the `gsd-goal` input (`value=""`), `of N questions` (N = 47, 12, 6, 9 and 47) and the help line — and removes nothing. Anything else in the diff is a regression: fix it before going on.

- [ ] **Step 8: Every GameSetupDialog suite is still green, unedited**

Run: `cd src && npm test -- gameSetupDialogDom gameSetupDialog gameSetupPalette gameSetupCallSite surveySetupNames workieSettings hostQuestionSets gameSession createGamePayload setupDefaults undeclaredSetters modal sessionOptions gameSetupGoal sessionGoalPayload`
Expected: `Test Suites: 20 passed`, `Snapshots: 7 passed`.

- [ ] **Step 9: Full frontend suite, lint, build, backend loop; commit**

```bash
git add src/src/components/SessionOptions.jsx src/src/components/GameSetupDialog.jsx src/src/components/GameSetupDialog.css src/src/config/setupDefaults.js src/src/config/createGame.js src/src/config/gameSession.js src/src/__tests__/__snapshots__/gameSetupDialogDom.test.jsx.snap src/src/__tests__/gameSetupGoal.test.jsx src/src/__tests__/sessionGoalPayload.test.js src/src/__tests__/sessionOptionsPalette.test.js
git commit -m "A host can give a session a goal of N questions when creating or editing it

The shared options gain a Goal field in their Questions section (never for a
survey), bounded by the chosen set's size and said in words when it is over;
Create waits for a goal the set can meet. The Advanced line names a goal the
host set. createGameBody sends target when one is set; updateGameBody sends
it when the form has it, null to clear. The recorded form changed by the Goal
field alone. gameSetupGoal, sessionGoalPayload, sessionOptionsPalette.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: The goal on the stage — the dock's line and the SESSION panel's progress

While a session with a goal runs, the host's SESSION panel (Questions tab) says "Question 3 of 5"; on the goal's own round, once its results are up, the dock's status line says "That's your 5. Keep going if there's time, or end the session." The primary action is unchanged. The rail is not touched. The goal is per-game state, restored from host-state on a reload and set from the form on a create or an edit of the live session.

Screens: the stage's dock and the SESSION panel as shipped (`docs/design/host-redesign/11-console.html` for the panel) — only a sentence changes on each.

**Files:**
- Modify: `src/src/config/gameSession.js` (`sessionTarget`)
- Modify: `src/src/GameHostPage.jsx`
- Modify: `src/src/config/hostControls.js` (`statusTextFor`, `hostControlsFor`)
- Modify: `src/src/components/stage/SessionSetupPanel.jsx`
- Create: `src/src/__tests__/hostControlsGoal.test.js`
- Create: `src/src/__tests__/sessionSetupPanelGoal.test.jsx`
- Create: `src/src/__tests__/stageGoalWiring.test.js`

**Interfaces:**
- Consumes: `goalProgress` (Task 1); host-state's top-level `target` (Task 2); the create/edit payload's `target` (Task 4).
- Produces: `hostControlsFor({…, goalLine = ''})` — `status.text` is `goalLine` on RESULTS, FEEDBACK and a one-page FIELD_NOTES when non-empty; `SessionSetupPanel` prop `goal: {progress, reached, line} | null` (test id `goal-progress`); per-game key `sessionTarget` (initial `null`).

- [ ] **Step 1: Write the failing tests**

Create `src/src/__tests__/hostControlsGoal.test.js`:

```js
/**
 * THE GOAL ON THE STAGE'S DOCK — config/hostControls.js (events M1b, Task 5).
 *
 * The owner: "we could alert the host/facilitator they have completed, but
 * they could do extra if time permitted". So the notice is words on the
 * dock's status line, never a stop: the primary action is exactly what it
 * would have been without it.
 *
 * rejects: the notice changing or disabling the primary action; the notice
 * replacing a live round's status; a long read-back losing its page position
 * to the notice; the default results line lost when there is no goal.
 */
import { hostControlsFor } from '../config/hostControls';

const READY = { playerCount: 6, answeredCount: 6, votedCount: 6, answerCount: 6, hasQuestionSet: true };
const LINE = 'That’s your 5. Keep going if there’s time, or end the session.';

test('RESULTS: the notice takes the status line, and the primary is untouched', () => {
  const plain = hostControlsFor({ ...READY, gameType: 'trivia', phase: 'RESULTS' });
  const goal = hostControlsFor({ ...READY, gameType: 'trivia', phase: 'RESULTS', goalLine: LINE });
  expect(goal.status.text).toBe(LINE);
  expect(goal.primary).toEqual(plain.primary);
  expect(goal.primary.disabled).toBe(false);
});

test('with no goal line, RESULTS still says the results are on screen', () => {
  expect(hostControlsFor({ ...READY, gameType: 'trivia', phase: 'RESULTS' }).status.text).toBe('Results are on screen');
});

test('a feedback round carries it too', () => {
  expect(hostControlsFor({ ...READY, gameType: 'call-and-answer', phase: 'FEEDBACK', goalLine: LINE }).status.text).toBe(LINE);
});

test('a one-page read-back carries it; a longer one keeps its page position', () => {
  expect(hostControlsFor({ ...READY, gameType: 'call-and-answer', phase: 'FIELD_NOTES', goalLine: LINE }).status.text).toBe(LINE);
  expect(hostControlsFor({
    ...READY, gameType: 'call-and-answer', phase: 'FIELD_NOTES', goalLine: LINE, notesPage: 0, notesPages: 3,
  }).status.text).toBe('Reading page 1 of 3');
});

test('a live round keeps its own status, whatever it is handed', () => {
  expect(hostControlsFor({ ...READY, gameType: 'trivia', phase: 'ASK', goalLine: LINE }).status.text).toBe('All 6 answered');
});
```

Create `src/src/__tests__/sessionSetupPanelGoal.test.jsx`:

```jsx
/**
 * THE GOAL IN THE HOST'S SESSION PANEL — components/stage/SessionSetupPanel.jsx,
 * the Questions tab (events M1b, Task 5). "Question 3 of 5" is the host's; the
 * rail the room reads never shows it.
 *
 * rejects: progress missing when there is a goal; a line drawn when there is
 * none; the goal's own results not marked as reached.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

import SessionSetupPanel from '../components/stage/SessionSetupPanel';

const renderPanel = (props = {}) => render(
  <SessionSetupPanel
    onClose={() => {}}
    wsConnected
    players={[]}
    gameState="ASK#003"
    categories={[{ name: 'Pricing Power' }]}
    categoryCounts={{ '1-8': [7], '9-16': [], '17-24': [] }}
    categoryBitmasks={{ 'HostMask1-8': '10000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000' }}
    questions={[]}
    gameId="4821"
    profile="room"
    {...props}
  />,
);
const openQuestions = () => fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));

test('with a goal, the Questions tab says where the session stands', () => {
  renderPanel({ goal: { progress: 'Question 3 of 5', reached: false, line: '' } });
  openQuestions();
  expect(screen.getByTestId('goal-progress')).toHaveTextContent('Question 3 of 5');
});

test('on the goal\'s own results it says the goal is reached', () => {
  renderPanel({ goal: { progress: 'Question 5 of 5', reached: true, line: 'That’s your 5.' } });
  openQuestions();
  expect(screen.getByTestId('goal-progress')).toHaveTextContent('Question 5 of 5 · goal reached');
});

test('with no goal, nothing is drawn', () => {
  renderPanel({ goal: { progress: '', reached: false, line: '' } });
  openQuestions();
  expect(screen.queryByTestId('goal-progress')).toBeNull();
  renderPanel();
  expect(screen.queryAllByTestId('goal-progress')).toHaveLength(0);
});
```

Create `src/src/__tests__/stageGoalWiring.test.js`:

```js
/**
 * THE GOAL'S WIRING ON THE HOST PAGE — GameHostPage.jsx and config/gameSession.js
 * (events M1b, Task 5). Read as source, the way gameSession.test.js reads the
 * page: the page is wired to the functions whose behaviour hostControlsGoal
 * and sessionSetupPanelGoal pin.
 *
 * rejects: the goal surviving a switch to another session; a reload that
 * forgets it; a new session that does not carry the goal just set; the dock
 * or the panel not told; the rail printing it to the room.
 */
import fs from 'fs';
import path from 'path';
import { gameSessionKeys, initialGameSession } from '../config/gameSession';

const source = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
const bodyOf = (name) => {
  const start = source.indexOf(`const ${name} = `);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n  };', start));
};

test('the goal is per-game state, reset with the rest', () => {
  expect(gameSessionKeys()).toContain('sessionTarget');
  expect(initialGameSession().sessionTarget).toBeNull();
});

test('a reload restores it from host-state\'s top level', () => {
  expect(source).toMatch(/setSessionTarget\(Number\.isInteger\(gameStateData\.target\) \? gameStateData\.target : null\)/);
});

test('a new session carries the goal the host just set, and an edit of the live one follows', () => {
  expect(bodyOf('handleStartNewGame')).toMatch(/setSessionTarget\(Number\.isInteger\(form\.target\)/);
  expect(bodyOf('handleSaveGameEdits')).toMatch(/targetId === gameId && 'target' in form\) setSessionTarget\(/);
});

test('the dock hears it through hostControlsFor, and the panel gets the progress', () => {
  expect(source).toMatch(/goalRules\.goalProgress\(\{ target: sessionTarget, round: lessonNumber, phase: hostPhase \}\)/);
  expect(source).toMatch(/hostControlsFor\(\{[\s\S]*?goalLine: goal\.line,[\s\S]*?\}\);/);
  expect(source).toMatch(/<SessionSetupPanel[\s\S]*?remoteUrl=\{remoteUrl\}\s+goal=\{goal\}/);
});

test('the rail never prints the goal', () => {
  const at = source.indexOf('const railContext = ');
  const block = source.slice(at, source.indexOf(';\n', at));
  expect(block).not.toMatch(/sessionTarget|goal/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd src && npm test -- hostControlsGoal sessionSetupPanelGoal stageGoalWiring`
Expected: FAIL — the status stays `Results are on screen`; `goal-progress` is not found; `sessionTarget` is not a per-game key.

- [ ] **Step 3: The dock's line — `config/hostControls.js`**

Replace

```js
function statusTextFor(phase, {
  isSurvey, survey, playerCount, answeredCount, votedCount, hasQuestionSet, notesPage, notesPages,
}) {
```

with

```js
function statusTextFor(phase, {
  isSurvey, survey, playerCount, answeredCount, votedCount, hasQuestionSet, notesPage, notesPages, goalLine = '',
}) {
```

replace

```js
      return Number(notesPages) > 1
        ? `Reading page ${Number(notesPage) + 1} of ${notesPages}`
        : 'Discussion prompt on screen';
```

with

```js
      return Number(notesPages) > 1
        ? `Reading page ${Number(notesPage) + 1} of ${notesPages}`
        : (goalLine || 'Discussion prompt on screen');
```

replace

```js
    case 'RESULTS':
    default:
      return 'Results are on screen';
```

with

```js
    // The goal's own round, its results up (events M1b): the line that tells
    // the host the plan is met. Next stays live — it is words, not a stop.
    case 'RESULTS':
    default:
      return goalLine || 'Results are on screen';
```

In `hostControlsFor`'s parameters, replace

```js
  survey = null,
} = {}) {
  const resolvedPhase
```

with

```js
  survey = null,
  // The goal's notice (session-goal.js goalReachedLine), '' when there is
  // nothing to say. It takes the status line on the goal round's results.
  goalLine = '',
} = {}) {
  const resolvedPhase
```

and replace

```js
  const text = statusTextFor(resolvedPhase, {
    isSurvey, survey, playerCount, answeredCount, votedCount, hasQuestionSet, notesPage, notesPages,
  });
```

with

```js
  const text = statusTextFor(resolvedPhase, {
    isSurvey, survey, playerCount, answeredCount, votedCount, hasQuestionSet, notesPage, notesPages, goalLine,
  });
```

- [ ] **Step 4: The panel's progress — `SessionSetupPanel.jsx`**

Replace

```js
  historyLoading = false,
  onOpenRound = () => {},
}) {
```

with

```js
  historyLoading = false,
  onOpenRound = () => {},
  /* THE GOAL (events M1b): session-goal.js goalProgress for the live round,
     or null. The Questions tab says "Question 3 of 5" — the host's, not
     the room's, which is why it is here and not on the rail. */
  goal = null,
}) {
```

and in the Questions tab replace

```jsx
              <p className="setup-note" data-testid="questions-remaining">
                {`${remaining} questions remaining`}
              </p>
```

with

```jsx
              <p className="setup-note" data-testid="questions-remaining">
                {`${remaining} questions remaining`}
              </p>
              {goal && goal.progress && (
                <p className="setup-note" data-testid="goal-progress">
                  {goal.reached ? `${goal.progress} · goal reached` : goal.progress}
                </p>
              )}
```

- [ ] **Step 5: The goal is per-game state — `config/gameSession.js`**

Replace

```js
    sessionBriefed: false,
```

with

```js
    sessionBriefed: false,
    // --- and its goal (events M1b): how many questions the host plans to
    //     ask, or null. Per-game like the rest of this block — the last
    //     session's goal must never follow the host into the next one.
    sessionTarget: null,
```

- [ ] **Step 6: The host page holds it, restores it, and hands it on — `GameHostPage.jsx`**

(a) Below `import { createGameBody, updateGameBody } from './config/createGame';` add:

```js
import goalRules from '../../lambda-functions/websocket/session-goal';
```

(b) Below `  const [sessionBriefed, setSessionBriefed] = useState(false);` add:

```js
  // The live session's goal (events M1b, session-goal.js): how many questions
  // the host plans to ask, or null. The host's alone — the rail never shows it.
  const [sessionTarget, setSessionTarget] = useState(null);
```

(c) In `gameSessionSetters`, below `    sessionBriefed: setSessionBriefed,` add:

```js
    sessionTarget: setSessionTarget,
```

(d) In the restore, below `          setSessionBriefed(gameStateData.gameMetadata.briefed === true);` add:

```js
          // The goal rides at host-state's top level (get-game-state.js).
          setSessionTarget(Number.isInteger(gameStateData.target) ? gameStateData.target : null);
```

(e) At the end of `handleStartNewGame`, replace

```js
    setGamePromptId(form.promptId || '');
    setPromptSwitchStatus('');
  };
```

with

```js
    setGamePromptId(form.promptId || '');
    setPromptSwitchStatus('');
    setSessionTarget(Number.isInteger(form.target) ? form.target : null);
  };
```

(f) In `handleSaveGameEdits`, below `      if (targetId === gameId) setEventTitle(form.title);` add:

```js
      if (targetId === gameId && 'target' in form) setSessionTarget(Number.isInteger(form.target) ? form.target : null);
```

(g) Replace

```js
  const hostControls = hostControlsFor({
    gameType: currentGameType,
```

with

```js
  /*
    THE GOAL (events M1b, session-goal.js): "Question 3 of 5" for the host's
    SESSION panel and, on the goal's own round once its results are up, the
    dock's line — "That's your 5. Keep going if there's time, or end the
    session." Never the rail: the room sees the round, not the plan.
  */
  const goal = isSurvey
    ? { progress: '', reached: false, line: '' }
    : goalRules.goalProgress({ target: sessionTarget, round: lessonNumber, phase: hostPhase });

  const hostControls = hostControlsFor({
    gameType: currentGameType,
```

and in the same call replace

```js
    notesPage,
    notesPages,
  });
```

with (`goalLine` goes ABOVE `notesPage`: `hostControls.test.js` pins the call's tail as `notesPage, notesPages, })`)

```js
    goalLine: goal.line,
    notesPage,
    notesPages,
  });
```

(h) In the `<SessionSetupPanel … />` element, replace

```jsx
          remoteUrl={remoteUrl}
```

with (after `remoteUrl`, never above it: `hostPanelRemoteQr.test.js` looks for `remoteUrl={remoteUrl}` within 2,000 characters of `<SessionSetupPanel`)

```jsx
          remoteUrl={remoteUrl}
          goal={goal}
```

- [ ] **Step 7: Run them and watch them pass, with the suites around them**

Run: `cd src && npm test -- hostControlsGoal sessionSetupPanelGoal stageGoalWiring hostControls.test sessionSetupPanel gameSession setupPanelCallSite stageShell GameHostPage undeclaredSetters hostPanelRemoteQr`
Expected: `Test Suites: 11 passed`.

- [ ] **Step 8: Full frontend suite, lint (no new warning), build, backend loop; commit**

```bash
git add src/src/config/gameSession.js src/src/GameHostPage.jsx src/src/config/hostControls.js src/src/components/stage/SessionSetupPanel.jsx src/src/__tests__/hostControlsGoal.test.js src/src/__tests__/sessionSetupPanelGoal.test.jsx src/src/__tests__/stageGoalWiring.test.js
git commit -m "The stage tells the host when a session's goal is reached, and never stops the room

On the goal's own round, once its results are up, the dock's status line says
\"That's your 5. Keep going if there's time, or end the session.\" The primary
action is exactly what it was. The SESSION panel's Questions tab says
\"Question 3 of 5\", then \"your goal was 5\" once the host keeps going; the rail
the room reads is untouched. sessionTarget is per-game, restored from
host-state, set by a create and by an edit of the live session.
hostControlsGoal, sessionSetupPanelGoal, stageGoalWiring.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The goal on the phone remote

The remote's status card says "Question 3 of 5" under its headline, and on the goal's own round, once its results are up, shows the notice in the remote's notice style. The buttons are unchanged. It reads host-state's top-level `target`, which its poll already fetches.

Screens: `docs/design/host-redesign/17-remote.html` (the status card and its notice flash, as shipped).

**Files:**
- Modify: `src/src/config/hostRemote.js` (`remoteGoal`)
- Modify: `src/src/HostRemote.jsx`
- Modify: `src/src/HostRemote.css` (`.hr-goal`)
- Create: `src/src/__tests__/hostRemoteGoal.test.jsx`

**Interfaces:**
- Consumes: `goalApplies`, `goalProgress` (Task 1); `parseGamePhase` (already in `config/hostRemote.js`); host-state's top-level `target` (Task 2).
- Produces: `remoteGoal(stateResponse): {progress, reached, line}` exported from `config/hostRemote.js`; test ids `remote-goal`, `remote-goal-reached`.

- [ ] **Step 1: Write the failing test**

Create `src/src/__tests__/hostRemoteGoal.test.jsx`:

```jsx
/**
 * THE GOAL ON THE HOST'S PHONE — config/hostRemote.js remoteGoal and the
 * remote's status card (HostRemote.jsx), events M1b Task 6.
 *
 * rejects: the remote reading the goal from gameMetadata (host-state keeps it
 * at the top level); the notice before the goal's own results, or with no
 * goal; a survey showing a goal; the notice replacing or disabling the
 * primary button.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostRemote from '../HostRemote';
import { remoteGoal } from '../config/hostRemote';

jest.mock('../auth/authFetch', () => ({
  ...jest.requireActual('../auth/authFetch'),
  authFetch: jest.fn((url, init) => (init && init.method === 'POST'
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'OK' }) })
    : global.fetch(url, init))),
}));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));

const LINE = 'That’s your 5. Keep going if there’s time, or end the session.';

describe('remoteGoal', () => {
  test('mid-way, from host-state\'s top-level target', () => {
    expect(remoteGoal({ state: 'VOTE#002', gameType: 'poll', target: 4, gameMetadata: { gameType: 'poll' } }))
      .toEqual({ progress: 'Question 2 of 4', reached: false, line: '' });
  });
  test('the goal\'s own results: reached, with the notice', () => {
    expect(remoteGoal({ state: 'RESULTS#005', gameType: 'trivia', target: 5 }))
      .toEqual({ progress: 'Question 5 of 5', reached: true, line: LINE });
  });
  test('a goal inside gameMetadata is not where host-state puts it', () => {
    expect(remoteGoal({ state: 'ASK#001', gameType: 'trivia', gameMetadata: { target: 5 } }).progress).toBe('');
  });
  test('nothing for a survey, before the first round, after the end, or with no answer yet', () => {
    const none = { progress: '', reached: false, line: '' };
    expect(remoteGoal({ state: 'SURVEY#OPEN', gameType: 'survey', target: 4 })).toEqual(none);
    expect(remoteGoal({ state: 'CREATED', gameType: 'trivia', target: 4 })).toEqual(none);
    expect(remoteGoal({ state: 'ENDED', gameType: 'trivia', target: 4 })).toEqual(none);
    expect(remoteGoal(null)).toEqual(none);
  });
});

function serve({ state, gameType = 'call-and-answer', target = null }) {
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/host-details')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    if (u.includes('/host-state')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          gameId: '4821', state, stageBeat: 'results', currentQuestion: 5, gameType, target,
          gameMetadata: { title: 'Q3 Leadership Offsite', gameType },
        }),
      });
    }
    if (u.includes('/players')) {
      return Promise.resolve({ ok: true, json: async () => ({ players: [], stats: { totalPlayers: 0 } }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

async function connect() {
  render(<HostRemote />);
  fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '4821' } });
  fireEvent.click(screen.getByRole('button', { name: /connect/i }));
  const status = screen.getByText(/^(Live|Offline)$/);
  await waitFor(() => expect(status).toHaveTextContent(/^Live$/));
}

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
});

describe('the status card', () => {
  test('mid-way: "Question 3 of 5" under the headline, and no notice', async () => {
    serve({ state: 'ASK#003', target: 5 });
    await connect();
    expect(await screen.findByTestId('remote-goal')).toHaveTextContent('Question 3 of 5');
    expect(screen.queryByTestId('remote-goal-reached')).toBeNull();
  });

  test('the goal\'s own results: the notice, and the primary is still the one it would be', async () => {
    serve({ state: 'RESULTS#005', target: 5 });
    await connect();
    expect(await screen.findByTestId('remote-goal-reached')).toHaveTextContent(LINE);
    expect(screen.getByRole('button', { name: /what we heard/i })).toBeEnabled();
  });

  test('no goal: nothing extra on the card', async () => {
    serve({ state: 'RESULTS#005', target: null });
    await connect();
    await screen.findByRole('button', { name: /what we heard/i });
    expect(screen.queryByTestId('remote-goal')).toBeNull();
    expect(screen.queryByTestId('remote-goal-reached')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd src && npm test -- hostRemoteGoal`
Expected: FAIL — `remoteGoal is not a function`.

- [ ] **Step 3: `remoteGoal` — `config/hostRemote.js`**

Below `import { normaliseScoreboard, scoreboardAvailability } from './scoreboard';` add:

```js
import goalRules from '../../../lambda-functions/websocket/session-goal';
```

Immediately above the line `/* ------------------------------------------------- what went wrong, in words */` add:

```js
/**
 * THE GOAL, ON THE HOST'S PHONE (events M1b, session-goal.js). The same words
 * the stage's dock and SESSION panel say, from the same rule: "Question 3 of
 * 5" under the headline, and on the goal's own round, once its results are
 * up, "That's your 5. Keep going if there's time, or end the session." Never
 * a stop: the primary button is exactly what it would have been.
 *
 * The goal rides at host-state's TOP level (`target`), because the host door's
 * gameMetadata is held equal to the public round's. A survey has none.
 *
 * @returns {{progress: string, reached: boolean, line: string}}
 */
export function remoteGoal(stateResponse) {
  const payload = stateResponse && typeof stateResponse === 'object' ? stateResponse : {};
  const gameType = payload.gameType || payload.gameMetadata?.gameType;
  if (!goalRules.goalApplies(gameType)) return { progress: '', reached: false, line: '' };
  const { phase, round } = parseGamePhase(payload.state);
  return goalRules.goalProgress({ target: payload.target, round, phase });
}

```

- [ ] **Step 4: The status card — `HostRemote.jsx` and `HostRemote.css`**

In `HostRemote.jsx`, replace

```js
  accessDeniedMessage,
} from './config/hostRemote';
```

with

```js
  accessDeniedMessage,
  remoteGoal,
} from './config/hostRemote';
```

below `  const progress = useMemo(() => roundProgress(snapshot), [snapshot]);` add:

```js
  // The goal (events M1b): the same words the stage says, from the same rule.
  const goal = useMemo(() => remoteGoal(snapshot), [snapshot]);
```

replace

```jsx
              <h1 className="hr-status-phase">{summary.headline}</h1>
```

with

```jsx
              <h1 className="hr-status-phase">{summary.headline}</h1>
              {goal.progress && <p className="hr-goal" data-testid="remote-goal">{goal.progress}</p>}
```

and immediately above the JSX comment that begins `{/* WHO THE ROOM IS WAITING FOR — 17-remote.html's` add:

```jsx
            {/* THE GOAL IS MET (events M1b): said once, on the goal's own
                round while its results are up. Words, never a stop — the
                primary below is exactly what it would have been. */}
            {goal.reached && (
              <p className="hr-flash hr-flash--notice" role="status" data-testid="remote-goal-reached">
                <Icon name="Target" weight="fill" size={18} color="currentColor" />
                {goal.line}
              </p>
            )}

```

In `HostRemote.css`, immediately above the `.hr-status-phase {` rule, add:

```css
/* THE GOAL (events M1b): "Question 3 of 5", under the headline. Muted, as the
   kicker above it is, on the same card — the pairing .hr-status-kicker
   already carries, so no new colour is measured. 14px, above the floor. */
.hr-goal {
  margin: 6px 0 0;
  font-size: .875rem;
  font-weight: 600;
  color: var(--muted);
}

```

- [ ] **Step 5: Run it, with every remote suite**

Run: `cd src && npm test -- hostRemote`
Expected: `Test Suites: 10 passed` (the nine existing `hostRemote*` suites and this one).

- [ ] **Step 6: Full frontend suite, lint, build, backend loop; commit**

```bash
git add src/src/config/hostRemote.js src/src/HostRemote.jsx src/src/HostRemote.css src/src/__tests__/hostRemoteGoal.test.jsx
git commit -m "The phone remote says where a session stands against its goal, and when it is met

\"Question 3 of 5\" sits under the status card's headline; on the goal's own
round, once its results are up, the remote's notice says \"That's your 5.
Keep going if there's time, or end the session.\" The buttons are exactly what
they were. remoteGoal reads host-state's top-level target through the same
session-goal.js rule the stage uses. hostRemoteGoal.test.jsx.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Survey items, on both sides

The owner: "Survey should work today, as we have surveys." A survey item picks a survey set, exactly as the other engagements pick theirs, and counts toward the 8 engagements. The server accepts it and the builder's add menu offers it. Running it is M3's, as for every engagement. Presentations stay "Coming soon" until Task 8 and Task 12.

Screens: `02-builder.html`'s add menu (Survey is already drawn there, first under "Answered by the room"); `03-add-item.html` (the survey item uses the same set picker).

**Files:**
- Modify: `lambda-functions/websocket/events/agenda-rules.js` (`ADDABLE_TYPES`, `COMING_SOON`)
- Modify: `src/src/components/EventBuilder.jsx` (the engagement kinds in the add menu)
- Create: `tests/event-item-kinds.js`
- Modify: `tests/event-agenda-rules.js` (§6), `tests/event-caps.js` (§2), `src/src/__tests__/eventBuilder.test.jsx`

**Interfaces:**
- Consumes: M1's `pinSet`, `capRefusal`, the add route.
- Produces: `ADDABLE_TYPES` includes `survey`; `COMING_SOON` holds `presentation` only; the builder's engagement kinds are disabled only by the caps.

- [ ] **Step 1: Write the failing test**

Create `tests/event-item-kinds.js` (Task 8 extends it):

```js
/**
 * THE KINDS OF AGENDA ITEM, AND WHO LEADS THEM — POST and PUT
 * /events/{code}/items (lambda-functions/websocket/events/items.js), read back
 * by GET /events/{code} and GET /events/{code}/agenda. Events M1b.
 *
 * The owner, 26 Sep 2026: "Survey should work today, as we have surveys.
 * presentations for now could be just placeholders. we also need a custom
 * choice ... enter the facilitator/speaker/presenter."
 *
 * rejects: a survey item that pins a set of another type, or does not count
 * as an engagement; the ninth engagement let in because it is a survey.
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
const getEvent = h.load('lambda-functions/websocket/events/get-event.js').handler;
const agenda = h.load('lambda-functions/websocket/events/get-agenda.js').handler;
const rules = h.load('lambda-functions/websocket/events/agenda-rules.js');
const { isEnvelope } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
let code;
const add = (body) => items(request({
  method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, body, requestContext: asHost(NW),
}));
const edit = (itemId, body) => items(request({
  method: 'PUT', path: `/events/${code}/items/${itemId}`, pathParameters: { code, itemId }, body, requestContext: asHost(NW),
}));
const meta = () => table.get(`EVENT#${code}`, 'METADATA');
const rowOf = (itemId) => table.get(`EVENT#${code}`, `ITEM#${itemId}`);
const hostRead = async () => bodyOf(await getEvent(request({
  path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW),
})));
const publicRead = async () => bodyOf(await agenda(request({ path: `/events/${code}/agenda`, pathParameters: { code } })));

async function freshEvent() {
  table.clear();
  seedOrg(table, NW);
  table.put({
    PK: 'SETS', SK: 'SET#kickoff', name: 'Kickoff pulse', engagementType: 'survey', questionCount: 5,
    activeVersion: 1, versions: [{ version: 1, questionCount: 5 }],
  });
  table.put({
    PK: 'SETS', SK: 'SET#space', name: 'Space Trivia', engagementType: 'trivia', questionCount: 12,
    activeVersion: 2, versions: [{ version: 1, questionCount: 8 }, { version: 2, questionCount: 12 }],
  });
  code = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', startsAt: startsIn(20), timeZone: 'Europe/London' },
  }))).event.code;
}

(async () => {
  console.log('\n1. a survey item');
  await freshEvent();
  await check('a survey item pins a survey set and counts as an engagement', async () => {
    const res = await add({ type: 'survey', title: 'Before we start', minutes: 8, setRef: { scope: 'platform', setId: 'kickoff' } });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.deepStrictEqual(bodyOf(res).item.setRef, { scope: 'platform', orgId: '', setId: 'kickoff', version: 1 });
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount], [1, 1]);
  });
  await check('a survey item refuses a set of another type', async () => {
    const res = await add({ type: 'survey', title: 'x', minutes: 8, setRef: { scope: 'platform', setId: 'space' } });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /Trivia set, and this item is Survey/);
  });
  await check('the ninth engagement may not be a survey either', async () => {
    table.put({ ...meta(), ItemCount: 8, EngagementCount: 8 });
    const res = await add({ type: 'survey', title: 'x', minutes: 8, setRef: { scope: 'platform', setId: 'kickoff' } });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).error, rules.CAP_SENTENCES.engagements);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

Run: `node tests/event-item-kinds.js | grep -E "FAIL|passed"; node tests/event-item-kinds.js >/dev/null 2>&1; echo "exit=$?"`
Expected: FAIL "a survey item pins a survey set" — 400 `Survey items are coming soon.`; exit 1.

- [ ] **Step 2: Survey items may be added — `agenda-rules.js`**

Replace

```js
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
```

with

```js
/**
 * What a host may ADD in this release. Survey items joined on 26 Sep 2026
 * (owner: "Survey should work today, as we have surveys"): a survey item picks
 * a survey set and counts as an engagement, exactly as the others do, and
 * running it is roadmap M3's, as for every engagement. Presentations wait for
 * their dialog (events M1b Task 8); the item route refuses what is not here, so
 * a stale client cannot add one.
 */
const ADDABLE_TYPES = Object.freeze(['trivia', 'call-and-answer', 'poll', 'wavelength', 'survey', BREAK]);
const COMING_SOON = Object.freeze({
  [PRESENTATION]: 'Presentations are coming soon.',
});
```

- [ ] **Step 3: The builder offers every engagement kind below the caps — `EventBuilder.jsx`**

In the header, replace

```js
 *     still announced; Break stays open. Presentation and Survey are always
 *     `aria-disabled`, "Coming soon": they are roadmap M5 and PLAN Phase 6.
 *     Activating an aria-disabled item does nothing.
```

with

```js
 *     still announced; Break stays open. Every engagement kind, survey
 *     included, is offered below the caps (events M1b). Presentation is
 *     `aria-disabled`, "Coming soon", until its dialog lands. Activating an
 *     aria-disabled item does nothing.
```

and replace the engagement kinds' map

```jsx
                {MENU_ENGAGEMENTS.map(([type, sentence]) => {
                  const soon = !rules.ADDABLE_TYPES.includes(type);
                  const capped = Boolean(engagementReason);
                  const disabled = soon || capped;
                  return (
                    <button
                      key={type}
                      type="button"
                      role="menuitem"
                      className="evb-menu-item"
                      aria-disabled={disabled ? 'true' : undefined}
                      aria-describedby={capped && !soon ? 'evb-capwhy' : undefined}
                      onClick={() => { if (disabled) return; openAdd(type); }}
                    >
                      <Icon name={TYPE_ICONS[type]} weight="bold" size={17} color="var(--primary)" />
                      <div>
                        <b>{rules.TYPE_LABELS[type]}</b>
                        <span>{soon ? `Coming soon. ${sentence}` : (capped ? '' : sentence)}</span>
                      </div>
                    </button>
                  );
                })}
```

with

```jsx
                {MENU_ENGAGEMENTS.map(([type, sentence]) => {
                  const capped = Boolean(engagementReason);
                  return (
                    <button
                      key={type}
                      type="button"
                      role="menuitem"
                      className="evb-menu-item"
                      aria-disabled={capped ? 'true' : undefined}
                      aria-describedby={capped ? 'evb-capwhy' : undefined}
                      onClick={() => { if (capped) return; openAdd(type); }}
                    >
                      <Icon name={TYPE_ICONS[type]} weight="bold" size={17} color="var(--primary)" />
                      <div>
                        <b>{rules.TYPE_LABELS[type]}</b>
                        <span>{capped ? '' : sentence}</span>
                      </div>
                    </button>
                  );
                })}
```

- [ ] **Step 4: The M1 tests that pinned "Survey is coming" now pin the opposite**

In `tests/event-agenda-rules.js` §6, replace

```js
check('presentations and survey items are listed but not addable', () => {
  assert.ok(R.ITEM_TYPES.includes('presentation') && R.ITEM_TYPES.includes('survey'));
  assert.ok(!R.ADDABLE_TYPES.includes('presentation') && !R.ADDABLE_TYPES.includes('survey'));
  assert.ok(R.COMING_SOON.presentation && R.COMING_SOON.survey);
});
```

with

```js
check('survey items may be added now; presentations are listed but not addable yet', () => {
  assert.ok(R.ITEM_TYPES.includes('presentation') && R.ITEM_TYPES.includes('survey'));
  assert.ok(R.ADDABLE_TYPES.includes('survey') && !R.ADDABLE_TYPES.includes('presentation'));
  assert.ok(R.COMING_SOON.presentation && !R.COMING_SOON.survey);
});
```

In `tests/event-caps.js`, in the header replace ` * a presentation or survey item added before its release; removing an item` with ` * a presentation added before its release; removing an item`, and delete this row from §2's table:

```js
    ['a survey item, before PLAN Phase 6', { type: 'survey', title: 'x', minutes: 5 }, /Survey items are coming soon/],
```

In `src/src/__tests__/eventBuilder.test.jsx`, replace

```jsx
  it('Presentation and Survey are listed, aria-disabled, and say they are coming', async () => {
    serve(DAY.slice(0, 3));
    await mount();
    openMenu();
    expect(item('Presentation')).toHaveAttribute('aria-disabled', 'true');
    expect(item('Presentation')).not.toBeDisabled();
    expect(item('Presentation')).toHaveTextContent('Coming soon.');
    expect(item('Survey')).toHaveAttribute('aria-disabled', 'true');
    expect(item('Survey')).not.toBeDisabled();
    expect(item('Survey')).toHaveTextContent('Coming soon.');
  });
```

with

```jsx
  it('Presentation is listed, aria-disabled, and says it is coming; Survey opens its dialog', async () => {
    serve(DAY.slice(0, 3));
    await mount();
    openMenu();
    expect(item('Presentation')).toHaveAttribute('aria-disabled', 'true');
    expect(item('Presentation')).not.toBeDisabled();
    expect(item('Presentation')).toHaveTextContent('Coming soon.');
    expect(item('Survey')).not.toHaveAttribute('aria-disabled');
    expect(item('Survey')).not.toHaveTextContent('Coming soon.');
    fireEvent.click(item('Survey'));
    expect(screen.getByRole('heading', { name: 'Add Survey' })).toBeInTheDocument();
  });
```

- [ ] **Step 5: Run them**

Run: `for f in tests/event-item-kinds.js tests/event-agenda-rules.js tests/event-caps.js; do node "$f" >/dev/null 2>&1 && echo "ok $f" || echo "FAIL $f"; done`
Expected: three `ok` lines (`event-item-kinds.js` prints `3 passed, 0 failed`).

Run: `cd src && npm test -- eventBuilder eventItemDialog`
Expected: `Test Suites: 3 passed` (`eventBuilder.test.jsx`, `eventBuilderPalette.test.js`, `eventItemDialog.test.jsx`).

- [ ] **Step 6: The backend loop and the frontend suite; commit**

```bash
git add lambda-functions/websocket/events/agenda-rules.js src/src/components/EventBuilder.jsx tests/event-item-kinds.js tests/event-agenda-rules.js tests/event-caps.js src/src/__tests__/eventBuilder.test.jsx
git commit -m "A host can add a survey to an event's agenda

Owner, 26 Sep: \"Survey should work today, as we have surveys.\" A survey item
picks a survey set as the other engagements pick theirs and counts toward the
8 engagements; the server accepts it and the builder's add menu offers it.
Presentations stay coming until their dialog lands. tests/event-item-kinds.js;
event-agenda-rules §6, event-caps §2 and eventBuilder.test.jsx now pin it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Presentations, activities and "Led by" on the server

A presentation (a placeholder until M5's PDF copy) and an activity (`custom`, "Activity") can be added; both count toward the 16 items and never the 8 engagements. Every item but a break may name who leads it — `ledBy`, stored as `LedBy`, sealed with the `item` entity — and the host's read and the public agenda return it. `ADDABLE_TYPES` and `COMING_SOON` retire: every kind is addable.

**Files:**
- Modify: `lambda-functions/websocket/events/agenda-rules.js`
- Modify: `lambda-functions/websocket/events/items.js`
- Modify: `lambda-functions/websocket/events/event-store.js` (`projectItem`, `openItemRow`)
- Modify: `lambda-functions/websocket/events/get-agenda.js`
- Modify: `lambda-functions/game/tenant-crypto.js`, then `cp` over `lambda-functions/websocket/tenant-crypto.js` and `lambda-functions/admin/shared/tenant-crypto.js`
- Modify: `tests/event-item-kinds.js` (new sections), `tests/event-agenda-rules.js` (§6), `tests/event-caps.js` (§2), `tests/event-public-reads.js` (§1), `tests/tenant-crypto.js` (§7b)

**Interfaces:**
- Consumes: Task 7's kinds test.
- Produces (`agenda-rules.js`): `CUSTOM = 'custom'`; `ITEM_TYPES` = `['trivia','call-and-answer','poll','wavelength','survey','presentation','custom','break']`; `TYPE_LABELS.custom = 'Activity'`; `LED_BY_MAX = 80`; `LED_BY_LABELS`; `hasLeader(type): boolean`; `ledByLabel(type): 'Facilitator'|'Presenter'|'Led by'|''`; `checkLedBy(input, type): {value: string}|{error}`. `ADDABLE_TYPES` and `COMING_SOON` are no longer exported. `checkItemFields` is unchanged (its value stays `{title, description, minutes}`, so the item dialog's payload does not change until Task 10).
- Produces (wire): `POST /events/{code}/items` accepts `presentation`, `custom` and `ledBy`; `PUT …/items/{itemId}` accepts `ledBy` (`''` clears); `projectItem` → `ledBy: string` on every item; `GET /events/{code}/agenda` items → `ledBy`. `ENCRYPTED_FIELDS.item` = `['Title','Description','LedBy']`.

- [ ] **Step 1: Write the failing tests**

In `tests/event-item-kinds.js`, replace the header's `rejects:` paragraph

```js
 * rejects: a survey item that pins a set of another type, or does not count
 * as an engagement; the ninth engagement let in because it is a survey.
 */
```

with

```js
 * rejects: a survey item that pins a set of another type, or does not count
 * as an engagement; the ninth engagement let in because it is a survey; a
 * presentation or an activity counted as an engagement, or let in as the
 * 17th item; a leader's name stored in the clear, on a break, or longer than
 * 80; a name that cannot be cleared; an unreadable row showing ciphertext.
 */
```

and insert the block below immediately above the suite's closing summary line (the `console.log` that prints `passed, … failed`, just above `suiteFinished();`):

```js
  console.log('\n2. a presentation and an activity: counted items, never engagements');
  await freshEvent();
  let talk; let lunch;
  await check('a presentation is added with its presenter, sealed', async () => {
    const res = await add({ type: 'presentation', title: 'The FY27 plan', ledBy: 'Marcus Oyelaran', minutes: 35, description: 'The three bets.' });
    assert.strictEqual(res.statusCode, 201, res.body);
    talk = bodyOf(res).item;
    assert.strictEqual(talk.ledBy, 'Marcus Oyelaran');
    assert.strictEqual(talk.setRef, undefined);
    assert.ok(isEnvelope(rowOf(talk.itemId).LedBy));
    assert.strictEqual(plainRow(NW, rowOf(talk.itemId)).LedBy, 'Marcus Oyelaran');
  });
  await check('an activity is added with nobody leading it', async () => {
    const res = await add({ type: 'custom', title: 'Lunch with the speakers', minutes: 45 });
    assert.strictEqual(res.statusCode, 201, res.body);
    lunch = bodyOf(res).item;
    assert.strictEqual(lunch.type, 'custom');
    assert.strictEqual(lunch.ledBy, '');
  });
  await check('both count toward the 16 items and neither toward the 8 engagements', () =>
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount, meta().BreakCount], [2, 0, 0]));
  await check('the 17th item may not be a presentation either: the items sentence', async () => {
    table.put({ ...meta(), ItemCount: 16 });
    const res = await add({ type: 'presentation', title: 'One too many', minutes: 10 });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.deepStrictEqual(bodyOf(res), { error: rules.CAP_SENTENCES.items, cap: 'items' });
    table.put({ ...meta(), ItemCount: 2 });
  });
  for (const [label, body, error] of [
    ['a break with somebody leading it', { type: 'break', minutes: 15, ledBy: 'Sam' }, /A break is not led by anyone/],
    ['a name longer than 80 characters', { type: 'custom', title: 'x', minutes: 5, ledBy: 'x'.repeat(81) }, /80 characters/],
    ['an activity with no title', { type: 'custom', minutes: 5 }, /title/],
  ]) {
    await check(`${label}: 400, nothing written`, async () => {
      const before = meta().ItemCount + meta().BreakCount;
      const res = await add(body);
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.match(bodyOf(res).error, error);
      assert.strictEqual(meta().ItemCount + meta().BreakCount, before);
    });
  }
  await check('the name is edited, and cleared', async () => {
    let res = await edit(lunch.itemId, { ledBy: 'Dana Whitfield' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).item.ledBy, 'Dana Whitfield');
    assert.strictEqual(plainRow(NW, rowOf(lunch.itemId)).LedBy, 'Dana Whitfield');
    res = await edit(lunch.itemId, { ledBy: '' });
    assert.strictEqual(bodyOf(res).item.ledBy, '');
  });
  await check('an edit that leaves the name out keeps it, and returns no ciphertext', async () => {
    const res = await edit(talk.itemId, { minutes: 40 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).item.ledBy, 'Marcus Oyelaran');
    assert.ok(!/"ct"/.test(res.body));
  });

  console.log('\n3. who leads it, read back');
  await check('the host\'s read carries ledBy on every item', async () => {
    const body = await hostRead();
    assert.deepStrictEqual(body.items.map((i) => [i.type, i.ledBy]), [['presentation', 'Marcus Oyelaran'], ['custom', '']]);
  });
  await check('the public agenda carries the name, for "Presentation · Marcus Oyelaran"', async () => {
    const body = await publicRead();
    assert.deepStrictEqual(body.items.map((i) => [i.type, i.ledBy]), [['presentation', 'Marcus Oyelaran'], ['custom', '']]);
  });
  await check('an item whose words cannot be opened shows no name and no ciphertext', async () => {
    const row = rowOf(talk.itemId);
    table.put({ ...row, LedBy: { v: 1, iv: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAA==', ct: 'AAAA' } });
    const res = await getEvent(request({ path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW) }));
    const bad = bodyOf(res).items.find((i) => i.itemId === talk.itemId);
    assert.deepStrictEqual([bad.decryptFailed, bad.ledBy, bad.title], [true, '', '']);
    assert.ok(!/"ct"/.test(res.body));
    table.put(row);
  });
  await check('an item added before M1b (no LedBy at all) reads as nobody named, and edits', async () => {
    const res = await add({ type: 'trivia', title: 'Old quiz', minutes: 10, setRef: { scope: 'platform', setId: 'space' } });
    const id = bodyOf(res).item.itemId;
    const { LedBy, ...m1Row } = rowOf(id);
    table.put(m1Row);
    const edited = await edit(id, { minutes: 12 });
    assert.strictEqual(edited.statusCode, 200, edited.body);
    assert.strictEqual(bodyOf(edited).item.ledBy, '');
  });

```

In `tests/event-agenda-rules.js` §6, replace the check `'survey items may be added now; presentations are listed but not addable yet'` (Task 7) with:

```js
check('every kind may be added: five engagements, a presentation, an activity and a break', () => {
  assert.deepStrictEqual([...R.ITEM_TYPES],
    ['trivia', 'call-and-answer', 'poll', 'wavelength', 'survey', 'presentation', 'custom', 'break']);
  assert.strictEqual(R.ADDABLE_TYPES, undefined);
  assert.strictEqual(R.COMING_SOON, undefined);
});
check('an activity is called Activity, and counts as an item, never an engagement', () => {
  assert.strictEqual(R.TYPE_LABELS.custom, 'Activity');
  assert.deepStrictEqual(R.countItems([{ type: 'custom' }, { type: 'presentation' }, { type: 'trivia' }]),
    { items: 3, engagements: 1, breaks: 0 });
  assert.strictEqual(R.capRefusal({ items: 15, engagements: 8 }, 'custom'), null);
  assert.strictEqual(R.capRefusal({ items: 16, engagements: 8 }, 'custom').cap, 'items');
});
check('who leads an item, by kind', () => {
  for (const t of ['trivia', 'call-and-answer', 'poll', 'wavelength', 'survey']) assert.strictEqual(R.ledByLabel(t), 'Facilitator', t);
  assert.strictEqual(R.ledByLabel('presentation'), 'Presenter');
  assert.strictEqual(R.ledByLabel('custom'), 'Led by');
  assert.strictEqual(R.ledByLabel('break'), '');
  assert.ok(!R.hasLeader('break') && R.hasLeader('custom') && R.hasLeader('poll') && !R.hasLeader('party'));
});
check('a name is optional, trimmed and capped; a break carries none', () => {
  assert.deepStrictEqual(R.checkLedBy('  Marcus Oyelaran ', 'presentation'), { value: 'Marcus Oyelaran' });
  assert.deepStrictEqual(R.checkLedBy(undefined, 'custom'), { value: '' });
  assert.match(R.checkLedBy('x'.repeat(81), 'custom').error, /80 characters/);
  assert.match(R.checkLedBy('Sam', 'break').error, /not led by anyone/);
  assert.deepStrictEqual(R.checkLedBy('', 'break'), { value: '' });
  assert.strictEqual(R.LED_BY_MAX, 80);
});
```

In `tests/event-caps.js`, in the header replace ` * a presentation added before its release; removing an item` with ` * removing an item`, and delete this row from §2's table:

```js
    ['a presentation, before M5', { type: 'presentation', title: 'x', minutes: 30 }, /Presentations are coming soon/],
```

In `tests/event-public-reads.js` §1, replace

```js
      ['at', 'description', 'itemId', 'minutes', 'state', 'title', 'type', 'until']);
```

with

```js
      ['at', 'description', 'itemId', 'ledBy', 'minutes', 'state', 'title', 'type', 'until']);
```

In `tests/tenant-crypto.js` §7b, replace

```js
check('item seals exactly its title and description', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.item].sort(), ['Description', 'Title']));
```

with

```js
check('item seals exactly its title, description and leader', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.item].sort(), ['Description', 'LedBy', 'Title']));
```

and in the check `'an agenda item round-trips, and its words are not in the stored row'` replace

```js
    Title: 'How well do you know our customers?', Description: 'Ten questions. Scored.' };
  const enc = await C.encryptItem(org, 'item', row);
  assert.ok(C.isEnvelope(enc.Title) && C.isEnvelope(enc.Description));
  assert.strictEqual(enc.Minutes, 15);
  assert.ok(!JSON.stringify(enc).includes('customers'));
  const back = await C.decryptItem(org, 'item', enc);
  assert.strictEqual(back.Title, row.Title);
  assert.strictEqual(back.Description, row.Description);
```

with

```js
    Title: 'How well do you know our customers?', Description: 'Ten questions. Scored.', LedBy: 'Priya Raman' };
  const enc = await C.encryptItem(org, 'item', row);
  assert.ok(C.isEnvelope(enc.Title) && C.isEnvelope(enc.Description) && C.isEnvelope(enc.LedBy));
  assert.strictEqual(enc.Minutes, 15);
  assert.ok(!JSON.stringify(enc).includes('customers'));
  assert.ok(!JSON.stringify(enc).includes('Priya'));
  const back = await C.decryptItem(org, 'item', enc);
  assert.strictEqual(back.Title, row.Title);
  assert.strictEqual(back.Description, row.Description);
  assert.strictEqual(back.LedBy, row.LedBy);
```

- [ ] **Step 2: Run them and watch them fail**

Run: `for f in tests/event-item-kinds.js tests/event-agenda-rules.js tests/event-public-reads.js tests/tenant-crypto.js; do node "$f" 2>&1 | grep -m3 FAIL; done`
Expected: FAILs — a presentation answers 400 `Presentations are coming soon.`; `R.ledByLabel is not a function`; the agenda's keys lack `ledBy`; `item` does not seal `LedBy`.

- [ ] **Step 3: The kinds and the leader — `agenda-rules.js`**

Replace

```js
const ENGAGEMENT_TYPES = Object.freeze(['trivia', 'call-and-answer', 'poll', 'wavelength', 'survey']);
const PRESENTATION = 'presentation';
const BREAK = 'break';
const ITEM_TYPES = Object.freeze([...ENGAGEMENT_TYPES, PRESENTATION, BREAK]);
```

and the whole `ADDABLE_TYPES` / `COMING_SOON` block below it (Task 7's version, from its `/**` through `});`) with

```js
const ENGAGEMENT_TYPES = Object.freeze(['trivia', 'call-and-answer', 'poll', 'wavelength', 'survey']);
const PRESENTATION = 'presentation';
/**
 * AN ACTIVITY — the owner's "custom choice ... where they could fill in what
 * they want" (26 Sep 2026): networking, lunch with a speaker, an open
 * discussion, a workshop activity. A title the host writes, an optional
 * leader, a length and a description. Nothing to answer and no session; it
 * counts toward the 16 items and never toward the 8 engagements. `custom` on
 * the wire, "Activity" wherever a person reads it (TYPE_LABELS).
 */
const CUSTOM = 'custom';
const BREAK = 'break';
/**
 * Every kind may be added (events M1b). A presentation is a placeholder until
 * roadmap M5 brings its PDF copy: a title, a presenter, a length and a
 * description, on the agenda and counted as an item.
 */
const ITEM_TYPES = Object.freeze([...ENGAGEMENT_TYPES, PRESENTATION, CUSTOM, BREAK]);
```

In `TYPE_LABELS`, replace

```js
  [PRESENTATION]: 'Presentation',
  [BREAK]: 'Break',
});
```

with

```js
  [PRESENTATION]: 'Presentation',
  [CUSTOM]: 'Activity',
  [BREAK]: 'Break',
});
```

Below `const DESCRIPTION_MAX = 600;` add:

```js
/**
 * WHO LEADS AN ITEM (events M1b): one free-text name on every item but a
 * break, labelled for its kind. Optional — a talk is often booked before its
 * speaker. A person's name is personal data: items.js stores it as `LedBy`,
 * sealed with the `item` entity.
 */
const LED_BY_MAX = 80;
const LED_BY_LABELS = Object.freeze({
  engagement: 'Facilitator',
  [PRESENTATION]: 'Presenter',
  [CUSTOM]: 'Led by',
});
const hasLeader = (type) => ITEM_TYPES.includes(type) && type !== BREAK;
/** "Facilitator", "Presenter" or "Led by"; '' for a break. */
function ledByLabel(type) {
  if (isEngagement(type)) return LED_BY_LABELS.engagement;
  return LED_BY_LABELS[type] || '';
}
```

Immediately below the closing `}` of `checkItemFields` add:

```js

/**
 * Who leads an item, checked (events M1b): a trimmed name of at most
 * LED_BY_MAX characters, '' for nobody. A break is led by nobody, and a name
 * sent for one is refused rather than dropped.
 * @returns {{value: string}|{error: string}}
 */
function checkLedBy(input, type) {
  const ledBy = text(input);
  if (type === BREAK) return ledBy ? { error: 'A break is not led by anyone.' } : { value: '' };
  if (ledBy.length > LED_BY_MAX) return { error: `A name can be ${LED_BY_MAX} characters at most.` };
  return { value: ledBy };
}
```

In `module.exports`, replace

```js
  MAX_ITEMS, MAX_ENGAGEMENTS, MAX_BREAKS,
  ENGAGEMENT_TYPES, PRESENTATION, BREAK, ITEM_TYPES, ADDABLE_TYPES, COMING_SOON,
  TYPE_LABELS, TYPE_ALIASES, CAP_SENTENCES,
  TITLE_MAX, PLACE_MAX, DESCRIPTION_MAX, MIN_MINUTES, MAX_MINUTES,
```

with

```js
  MAX_ITEMS, MAX_ENGAGEMENTS, MAX_BREAKS,
  ENGAGEMENT_TYPES, PRESENTATION, CUSTOM, BREAK, ITEM_TYPES,
  TYPE_LABELS, TYPE_ALIASES, CAP_SENTENCES,
  TITLE_MAX, PLACE_MAX, DESCRIPTION_MAX, LED_BY_MAX, LED_BY_LABELS, MIN_MINUTES, MAX_MINUTES,
  hasLeader, ledByLabel,
```

and replace

```js
  isTimeZone, parseStartsAt, checkEventFields, checkItemFields,
```

with

```js
  isTimeZone, parseStartsAt, checkEventFields, checkItemFields, checkLedBy,
```

- [ ] **Step 4: `LedBy` is sealed — `tenant-crypto.js`, all three copies**

In `lambda-functions/game/tenant-crypto.js`, replace

```js
  /** One agenda item: PK=EVENT#<code>, SK=ITEM#<id>. Its title and its
   *  description are what the host wrote for the room. `Type`, `Order`,
   *  `Minutes`, `State` and `SetRef` — a pointer to a question set, as a
   *  session's `QuestionSetId` is — are structure, and stay plaintext. */
  item: Object.freeze(['Title', 'Description']),
```

with

```js
  /** One agenda item: PK=EVENT#<code>, SK=ITEM#<id>. Its title and its
   *  description are what the host wrote for the room; `LedBy` is the name of
   *  who leads it (events M1b) — a person's name, personal data. `Type`,
   *  `Order`, `Minutes`, `State` and `SetRef` — a pointer to a question set,
   *  as a session's `QuestionSetId` is — are structure, and stay plaintext. */
  item: Object.freeze(['Title', 'Description', 'LedBy']),
```

then: `cp lambda-functions/game/tenant-crypto.js lambda-functions/websocket/tenant-crypto.js && cp lambda-functions/game/tenant-crypto.js lambda-functions/admin/shared/tenant-crypto.js`

- [ ] **Step 5: The routes — `items.js`**

In the header, replace

```js
 *   PUT    /events/{code}/items/{itemId}   edit: title, description, minutes,
 *                                          and "Use vN" for an engagement
```

with

```js
 *   PUT    /events/{code}/items/{itemId}   edit: title, description, minutes,
 *                                          who leads it, and "Use vN" for an
 *                                          engagement
 *
 * THE KINDS (events M1b): five engagements (survey included), a presentation
 * (a placeholder until roadmap M5's PDF copy), an activity (`custom`) and a
 * break. Every kind but a break may name who leads it — `ledBy`, stored as
 * `LedBy` and sealed with the item's words.
```

In `addItem`, replace

```js
  const type = String(body.type || '').trim();
  if (rules.COMING_SOON[type]) return json(400, { error: rules.COMING_SOON[type] });
  if (!rules.ADDABLE_TYPES.includes(type)) return json(400, { error: 'That is not a kind of agenda item.' });
  const fields = rules.checkItemFields(body, type);
  if (fields.error) return json(400, { error: fields.error });
```

with

```js
  const type = String(body.type || '').trim();
  if (!rules.ITEM_TYPES.includes(type)) return json(400, { error: 'That is not a kind of agenda item.' });
  const fields = rules.checkItemFields(body, type);
  if (fields.error) return json(400, { error: fields.error });
  const leader = rules.checkLedBy(body.ledBy, type);
  if (leader.error) return json(400, { error: leader.error });
```

and in its `plain` row replace

```js
    Description: fields.value.description,
    State: PLANNED,
```

with

```js
    Description: fields.value.description,
    // Who leads it (sealed below with Title and Description); a break has none.
    ...(rules.hasLeader(type) ? { LedBy: leader.value } : {}),
    State: PLANNED,
```

Replace the whole `editItem` function — from `async function editItem(request, meta, code, itemId) {` to its closing `}` above `// ── PUT /items: reorder` — with:

```js
async function editItem(request, meta, code, itemId) {
  const body = readBody(request);
  if (!body) return json(400, { error: 'The request body is not valid JSON.' });
  const row = await readItem(code, itemId);
  if (!row) return itemGone();
  if (row.State !== PLANNED) return json(409, { error: NOT_PLANNED, code: 'not_planned' });

  const current = await S.decryptItemRow(meta.orgId, row);
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const leads = rules.hasLeader(row.Type);
  const fields = rules.checkItemFields({
    title: has('title') ? body.title : current.Title,
    description: has('description') ? body.description : current.Description,
    minutes: has('minutes') ? body.minutes : current.Minutes,
  }, row.Type);
  if (fields.error) return json(400, { error: fields.error });
  const leader = rules.checkLedBy(has('ledBy') ? body.ledBy : current.LedBy, row.Type);
  if (leader.error) return json(400, { error: leader.error });

  let setRef = row.SetRef || null;
  if (has('version')) {
    if (!rules.isEngagement(row.Type) || !setRef) return json(400, { error: 'Only an engagement plays a version of a set.' });
    const pinned = await pinSet(meta, row.Type, { ...setRef, version: body.version });
    if (pinned.error) return json(400, { error: pinned.error });
    setRef = pinned.setRef;
  }

  const now = new Date().toISOString();
  const words = {
    Title: fields.value.title,
    Description: fields.value.description,
    ...(leads ? { LedBy: leader.value } : {}),
  };
  const sealed = await encryptItem(meta.orgId, 'item', words);
  const names = { '#t': 'Title', '#d': 'Description', '#m': 'Minutes', '#ua': 'UpdatedAt', '#st': 'State' };
  const values = { ':t': sealed.Title, ':d': sealed.Description, ':m': fields.value.minutes, ':now': now, ':planned': PLANNED };
  let expression = 'SET #t = :t, #d = :d, #m = :m, #ua = :now';
  if (leads) {
    expression += ', #lb = :lb';
    names['#lb'] = 'LedBy';
    values[':lb'] = sealed.LedBy;
  }
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
  // Projected from the DECRYPTED row, so nothing sealed reaches the response.
  return json(200, {
    item: S.projectItem({
      ...current, ...words, Minutes: fields.value.minutes,
      ...(setRef ? { SetRef: setRef } : {}),
    }),
  });
}
```

(The update still names only Title, Description, Minutes, UpdatedAt, LedBy and SetRef — never the row's `ttl` — so `tests/event-item-edit.js`'s date-move race stays held.)

- [ ] **Step 6: The reads — `event-store.js` and `get-agenda.js`**

In `event-store.js`'s `openItemRow`, replace

```js
    return { ...row, Title: '', Description: '', decryptFailed: true };
```

with

```js
    return { ...row, Title: '', Description: '', LedBy: '', decryptFailed: true };
```

and in `projectItem` replace

```js
    description: typeof r.Description === 'string' ? r.Description : '',
    minutes: Number(r.Minutes) || 0,
    state: r.State || 'planned',
  };
```

with

```js
    description: typeof r.Description === 'string' ? r.Description : '',
    // Who leads it (events M1b); '' for a break and for nobody named.
    ledBy: typeof r.LedBy === 'string' ? r.LedBy : '',
    minutes: Number(r.Minutes) || 0,
    state: r.State || 'planned',
  };
```

In `get-agenda.js`, replace

```js
 * PUBLIC, and so it says as little as an agenda needs: the event's name,
 * place and schedule, and per item its planned time, title, kind, length,
 * description and state.
```

with

```js
 * PUBLIC, and so it says as little as an agenda needs: the event's name,
 * place and schedule, and per item its planned time, title, kind, who leads
 * it (events M1b — p-05's "Presentation · Dana Whitfield"), length,
 * description and state. Never an engagement's session options.
```

and in the item projection replace

```js
          description: typeof row.Description === 'string' ? row.Description : '',
          minutes: Number(row.Minutes) || 0,
```

with

```js
          description: typeof row.Description === 'string' ? row.Description : '',
          ledBy: typeof row.LedBy === 'string' ? row.LedBy : '',
          minutes: Number(row.Minutes) || 0,
```

- [ ] **Step 7: Run every event suite and the frontend event suites**

Run: `for f in tests/event-item-kinds.js tests/event-agenda-rules.js tests/event-caps.js tests/event-public-reads.js tests/event-item-edit.js tests/event-host-reads.js tests/tenant-crypto.js tests/event-routes-authorization.js tests/event-create.js tests/event-update.js tests/kms-grants-match-code.js tests/lambda-event-not-logged.js tests/no-global-partition-literals.js; do node "$f" >/dev/null 2>&1 && echo "ok $f" || echo "FAIL $f"; done`
Expected: every line `ok`.

Run: `cd src && npm test -- eventBuilder eventItemDialog eventsPanel`
Expected: `Test Suites: 5 passed` — the item dialog's payload is unchanged, because `checkItemFields` still returns `{title, description, minutes}`.

- [ ] **Step 8: The backend loop and the frontend suite; commit**

```bash
git add lambda-functions/websocket/events/agenda-rules.js lambda-functions/websocket/events/items.js lambda-functions/websocket/events/event-store.js lambda-functions/websocket/events/get-agenda.js lambda-functions/game/tenant-crypto.js lambda-functions/websocket/tenant-crypto.js lambda-functions/admin/shared/tenant-crypto.js tests/event-item-kinds.js tests/event-agenda-rules.js tests/event-caps.js tests/event-public-reads.js tests/tenant-crypto.js
git commit -m "An agenda holds presentations and activities, and names who leads each item, sealed

Owner, 26 Sep: presentations \"could be just placeholders\", \"a custom choice\",
and \"enter the facilitator/speaker/presenter\". A presentation and an activity
(custom on the wire, \"Activity\" to people) are counted items, never
engagements, and the 17th is refused with the items sentence. Every item but a
break may carry a leader's name, at most 80 characters, stored as LedBy and
sealed in all three tenant-crypto copies; the host's read and the public agenda
return it as ledBy, and an unreadable row shows none. tests/event-item-kinds.js
§2-§3; event-agenda-rules §6, event-caps §2, event-public-reads §1 and
tenant-crypto §7b follow.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: An engagement item's session options, on the server — and the M3 mapping pinned

An engagement item carries the create dialog's options as one map: checked by `events/item-settings.js` with create's rules, sealed whole as `Settings`, returned on the host's read and never on the public agenda. "Use vN" re-checks the goal against the new version and resets a narrowed category list. `agenda-rules.sessionFormOf` turns an item into the create dialog's payload, and a frontend test pins it through `createGameBody` — the mapping table M3 follows.

**Files:**
- Modify: `lambda-functions/websocket/events/agenda-rules.js` (the session-option section)
- Create: `lambda-functions/websocket/events/item-settings.js`
- Modify: `lambda-functions/websocket/events/items.js`
- Modify: `lambda-functions/websocket/events/event-store.js`
- Modify: `lambda-functions/game/tenant-crypto.js`, then `cp` over the two other copies
- Create: `tests/event-item-settings.js`
- Modify: `tests/event-agenda-rules.js` (new §8), `tests/tenant-crypto.js` (§7b)
- Create: `src/src/__tests__/itemSessionMapping.test.js`

**Interfaces:**
- Consumes: `checkTarget`, `questionCountAt` (Task 1); `createGameBody` with `target` (Task 4); Task 8's `LedBy`.
- Produces (`agenda-rules.js`): `SETTING_DEFAULTS`, `SETTING_KEYS`, `settingKeysFor(type): string[]`, `settingsFor(type, values): object`, `sessionFormOf(item): {title, gameType, setId, setScope, setVersion, …settings}`.
- Produces (`item-settings.js`): `checkItemSettings(type, input, {questionCount}): {value: object|null}|{error}`; `AI_CONTEXT_MAX = 500`, `EVENT_DETAILS_MAX = 300`.
- Produces (wire): `POST …/items` and `PUT …/items/{itemId}` accept `settings`; `projectItem` → `settings` when the row has them; `PUT` with `version` answers `400 {code:'goal_over'}` or `200 {…, categoriesReset: true}`. `ENCRYPTED_FIELDS.item` = `['Title','Description','LedBy','Settings']`. `pinSet` also returns `setRow`.

- [ ] **Step 1: Write the failing tests**

Create `tests/event-item-settings.js`:

```js
/**
 * AN ENGAGEMENT ITEM'S SESSION OPTIONS — the `settings` of POST and PUT
 * /events/{code}/items (items.js, events/item-settings.js), sealed whole on the
 * row as `Settings`, read back by GET /events/{code} and never by the public
 * agenda. Events M1b.
 *
 * The owner, 26 Sep 2026: "It would also be nice if all of the options that
 * you get when setting up each engagement is avail".
 *
 * rejects: an option the format does not have (a briefing on trivia, Names on
 * a poll, a goal on a survey) stored; create's caps (500, 300, 1,500) not
 * held; a goal bigger than the pinned version; options on a presentation;
 * the options readable in the stored row or on the public agenda; "Use vN"
 * silently keeping a goal the new version cannot meet, or a category list it
 * may not have; an item added before M1b (no Settings) failing to edit; an
 * unreadable row showing its options as ciphertext.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf, REPO,
} = require('./helpers/event-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const getEvent = h.load('lambda-functions/websocket/events/get-event.js').handler;
const agenda = h.load('lambda-functions/websocket/events/get-agenda.js').handler;
const rules = h.load('lambda-functions/websocket/events/agenda-rules.js');
const S = h.load('lambda-functions/websocket/events/item-settings.js');
const { isEnvelope } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
let code;
const add = (body) => items(request({
  method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, body, requestContext: asHost(NW),
}));
const edit = (itemId, body) => items(request({
  method: 'PUT', path: `/events/${code}/items/${itemId}`, pathParameters: { code, itemId }, body, requestContext: asHost(NW),
}));
const rowOf = (itemId) => table.get(`EVENT#${code}`, `ITEM#${itemId}`);
const itemCount = () => [...table.store.values()].filter((r) => r.PK === `EVENT#${code}` && String(r.SK).startsWith('ITEM#')).length;
const space = (extra = {}) => ({ type: 'trivia', title: 'Space night', minutes: 15, setRef: { scope: 'platform', setId: 'space' }, ...extra });
const BRIEF = { text: 'Open issues are up 15%.', source: null, namesRemoved: 0, draftedAt: null, editedAt: null };
const TRIVIA = {
  randomizeQuestions: false, categoryIds: ['Ops'], target: 5,
  personaId: 'coach', promptId: 'trivia-vj', aiContext: 'Be brief.', eventDetails: 'Why we meet.',
};

(async () => {
  table.clear();
  seedOrg(table, NW);
  table.put({ PK: 'SETS', SK: 'SET#space', name: 'Space Trivia', engagementType: 'trivia', questionCount: 12, activeVersion: 2, versions: [{ version: 1, questionCount: 8 }, { version: 2, questionCount: 12 }] });
  table.put({ PK: 'SETS', SK: 'SET#friction', name: 'Friction finder', engagementType: 'call-and-answer', questionCount: 4, activeVersion: 1, versions: [{ version: 1, questionCount: 4 }] });
  table.put({ PK: 'SETS', SK: 'SET#mood', name: 'Room mood', engagementType: 'poll', questionCount: 6, activeVersion: 1, versions: [{ version: 1, questionCount: 6 }] });
  table.put({ PK: 'SETS', SK: 'SET#kickoff', name: 'Kickoff pulse', engagementType: 'survey', questionCount: 5, activeVersion: 1, versions: [{ version: 1, questionCount: 5 }] });
  code = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', startsAt: startsIn(20), timeZone: 'Europe/London' },
  }))).event.code;

  console.log('\n1. what an engagement stores');
  let quiz;
  await check('trivia keeps every option it has, sealed whole', async () => {
    const res = await add(space({ settings: TRIVIA }));
    assert.strictEqual(res.statusCode, 201, res.body);
    quiz = bodyOf(res).item;
    assert.deepStrictEqual(quiz.settings, TRIVIA);
    const row = rowOf(quiz.itemId);
    assert.ok(isEnvelope(row.Settings), 'Settings is stored in the clear');
    assert.ok(!JSON.stringify(row).includes('Be brief.'));
    assert.deepStrictEqual(plainRow(NW, row).Settings, TRIVIA);
  });
  await check('no options at all stores the create dialog\'s untouched defaults', async () => {
    const res = await add(space());
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.deepStrictEqual(bodyOf(res).item.settings, rules.settingsFor('trivia', {}));
  });
  await check('Call & Answer keeps its briefing and its anonymity', async () => {
    const res = await add({ type: 'call-and-answer', title: 'Friction', minutes: 20, setRef: { scope: 'platform', setId: 'friction' }, settings: { anonymousResponses: false, briefing: BRIEF } });
    assert.strictEqual(res.statusCode, 201, res.body);
    const { settings } = bodyOf(res).item;
    assert.strictEqual(settings.anonymousResponses, false);
    assert.deepStrictEqual(settings.briefing, BRIEF);
  });
  await check('a survey keeps its Names and nothing about rounds', async () => {
    const res = await add({ type: 'survey', title: 'Pulse', minutes: 8, setRef: { scope: 'platform', setId: 'kickoff' }, settings: { names: 'named' } });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.deepStrictEqual(Object.keys(bodyOf(res).item.settings), ['names', 'personaId', 'promptId', 'aiContext', 'eventDetails']);
    assert.strictEqual(bodyOf(res).item.settings.names, 'named');
  });

  console.log('\n2. what is refused, in words, with nothing written');
  for (const [label, body, error] of [
    ['a briefing on trivia', space({ settings: { briefing: BRIEF } }), /Call & Answer sessions only/],
    ['Names on a poll', { type: 'poll', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'mood' }, settings: { names: 'named' } }, /Names applies to a survey only/],
    ['a goal on a survey', { type: 'survey', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'kickoff' }, settings: { target: 3 } }, /no goal/],
    ['a goal bigger than the set', space({ settings: { target: 13 } }), /This set has 12 questions/],
    ['a goal bigger than the older version pinned', space({ setRef: { scope: 'platform', setId: 'space', version: 1 }, settings: { target: 9 } }), /This set has 8 questions/],
    ['501 characters of instructions', space({ settings: { aiContext: 'x'.repeat(501) } }), /500 characters/],
    ['301 characters of event details', space({ settings: { eventDetails: 'x'.repeat(301) } }), /300 characters/],
    ['a briefing over 1,500 characters', { type: 'call-and-answer', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'friction' }, settings: { briefing: 'x'.repeat(1501) } }, /1,500/],
    ['anonymity that is neither on nor off', { type: 'poll', title: 'x', minutes: 5, setRef: { scope: 'platform', setId: 'mood' }, settings: { anonymousResponses: 'yes' } }, /on or off/],
    ['an option that does not exist', space({ settings: { triviaTimer: 30 } }), /is not a session option/],
    ['25 categories', space({ settings: { categoryIds: Array.from({ length: 25 }, (_, i) => `C${i}`) } }), /Choose categories/],
    ['options on a presentation', { type: 'presentation', title: 'x', minutes: 5, settings: {} }, /Only an engagement has session options/],
  ]) {
    await check(`${label}: 400`, async () => {
      const before = itemCount();
      const res = await add(body);
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.match(bodyOf(res).error, error);
      assert.strictEqual(itemCount(), before);
    });
  }

  console.log('\n3. editing');
  await check('PUT settings replaces the map', async () => {
    const res = await edit(quiz.itemId, { settings: { target: 7 } });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res).item.settings, rules.settingsFor('trivia', { target: 7 }));
    assert.strictEqual(plainRow(NW, rowOf(quiz.itemId)).Settings.target, 7);
  });
  await check('an edit that sends no settings leaves them as they were', async () => {
    await edit(quiz.itemId, { settings: TRIVIA });
    const res = await edit(quiz.itemId, { minutes: 20 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res).item.settings, TRIVIA);
  });
  await check('"Use v1" under a goal v1 cannot meet: refused in words, nothing changed', async () => {
    await edit(quiz.itemId, { settings: { ...TRIVIA, target: 10 } });
    const res = await edit(quiz.itemId, { version: 1 });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.deepStrictEqual(bodyOf(res), {
      error: 'Your goal of 10 is more than v1’s 8 questions. Lower the goal, then use v1.', code: 'goal_over',
    });
    assert.strictEqual(rowOf(quiz.itemId).SetRef.version, 2);
    assert.strictEqual(plainRow(NW, rowOf(quiz.itemId)).Settings.target, 10);
  });
  await check('"Use v1" with a goal that fits resets a narrowed category list, and says so', async () => {
    await edit(quiz.itemId, { settings: { ...TRIVIA, target: 7 } });
    const res = await edit(quiz.itemId, { version: 1 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).categoriesReset, true);
    assert.deepStrictEqual(bodyOf(res).item.settings.categoryIds, []);
    assert.strictEqual(bodyOf(res).item.settings.target, 7);
    assert.strictEqual(rowOf(quiz.itemId).SetRef.version, 1);
  });
  await check('an item added before M1b (no Settings) edits, and keeps none', async () => {
    const res = await add(space({ title: 'Old quiz' }));
    const id = bodyOf(res).item.itemId;
    const { Settings, ...m1Row } = rowOf(id);
    table.put(m1Row);
    const edited = await edit(id, { minutes: 12 });
    assert.strictEqual(edited.statusCode, 200, edited.body);
    assert.strictEqual(bodyOf(edited).item.settings, undefined);
    assert.ok(!('Settings' in rowOf(id)));
  });
  await check('options sent for a presentation on an edit: 400', async () => {
    const talk = bodyOf(await add({ type: 'presentation', title: 'Talk', minutes: 30 })).item;
    const res = await edit(talk.itemId, { settings: { target: 3 } });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /Only an engagement has session options/);
  });

  console.log('\n4. who reads them');
  await check('the host\'s read carries them, decrypted', async () => {
    const body = bodyOf(await getEvent(request({ path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW) })));
    assert.strictEqual(body.items.find((i) => i.itemId === quiz.itemId).settings.target, 7);
  });
  await check('the public agenda never does', async () => {
    const res = await agenda(request({ path: `/events/${code}/agenda`, pathParameters: { code } }));
    assert.strictEqual(res.statusCode, 200, res.body);
    for (const item of bodyOf(res).items) assert.ok(!('settings' in item), `${item.itemId} leaks its settings`);
    assert.ok(!res.body.includes('Be brief.'));
  });
  await check('a row whose words cannot be opened shows no options, and no ciphertext', async () => {
    const row = rowOf(quiz.itemId);
    table.put({ ...row, Settings: { v: 1, iv: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAA==', ct: 'AAAA' } });
    const res = await getEvent(request({ path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW) }));
    const bad = bodyOf(res).items.find((i) => i.itemId === quiz.itemId);
    assert.strictEqual(bad.decryptFailed, true);
    assert.strictEqual(bad.settings, undefined);
    assert.ok(!/"ct"/.test(res.body));
    table.put(row);
  });

  console.log('\n5. create\'s caps, held equal to the dialog\'s');
  await check('500 and 300 are SessionOptions.jsx\'s own maxLengths', () => {
    const src = fs.readFileSync(path.join(REPO, 'src/src/components/SessionOptions.jsx'), 'utf8');
    const near = (marker) => src.slice(src.indexOf(marker), src.indexOf(marker) + 700);
    assert.strictEqual(S.AI_CONTEXT_MAX, 500);
    assert.strictEqual(S.EVENT_DETAILS_MAX, 300);
    assert.match(near('-ai-context`}'), new RegExp(`maxLength="${S.AI_CONTEXT_MAX}"`));
    assert.match(near('-details`}'), new RegExp(`maxLength="${S.EVENT_DETAILS_MAX}"`));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
```

In `tests/event-agenda-rules.js`, insert immediately above the line `console.log('\n7. the browser can import it');`:

```js
console.log('\n8. what an engagement item carries of its session');
check('the options each format has, in the create dialog\'s own names', () => {
  assert.deepStrictEqual(R.settingKeysFor('trivia'), ['randomizeQuestions', 'categoryIds', 'target', 'personaId', 'promptId', 'aiContext', 'eventDetails']);
  assert.deepStrictEqual(R.settingKeysFor('wavelength'), R.settingKeysFor('trivia'));
  assert.deepStrictEqual(R.settingKeysFor('poll'), ['anonymousResponses', 'randomizeQuestions', 'categoryIds', 'target', 'personaId', 'promptId', 'aiContext', 'eventDetails']);
  assert.deepStrictEqual(R.settingKeysFor('call-and-answer'), ['anonymousResponses', 'randomizeQuestions', 'categoryIds', 'target', 'briefing', 'personaId', 'promptId', 'aiContext', 'eventDetails']);
  assert.deepStrictEqual(R.settingKeysFor('survey'), ['names', 'personaId', 'promptId', 'aiContext', 'eventDetails']);
  for (const t of ['presentation', 'custom', 'break']) assert.deepStrictEqual(R.settingKeysFor(t), [], t);
});
check('untouched options are the create dialog\'s defaults, and never share an array', () => {
  const a = R.settingsFor('trivia', {});
  a.categoryIds.push('x');
  assert.deepStrictEqual(R.settingsFor('trivia', {}).categoryIds, []);
  assert.deepStrictEqual(R.settingsFor('survey'), { names: 'anonymous', personaId: '', promptId: '', aiContext: '', eventDetails: '' });
});
check('a key the format does not have is dropped, not carried', () =>
  assert.ok(!('briefing' in R.settingsFor('trivia', { briefing: { text: 'x' } }))));
check('an item becomes the create dialog\'s payload, its pinned version beside it', () =>
  assert.deepStrictEqual(R.sessionFormOf({
    type: 'survey', title: 'Pulse', ledBy: 'Sam', description: 'Five questions.',
    setRef: { scope: 'platform', orgId: '', setId: 'kickoff', version: 3 }, settings: { names: 'named' },
  }), {
    title: 'Pulse', gameType: 'survey', setId: 'kickoff', setScope: 'platform', setVersion: 3,
    names: 'named', personaId: '', promptId: '', aiContext: '', eventDetails: '',
  }));

```

In `tests/tenant-crypto.js` §7b, replace

```js
check('item seals exactly its title, description and leader', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.item].sort(), ['Description', 'LedBy', 'Title']));
```

with

```js
check('item seals exactly its title, description, leader and session options', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.item].sort(), ['Description', 'LedBy', 'Settings', 'Title']));
```

and in the round-trip check replace

```js
    Title: 'How well do you know our customers?', Description: 'Ten questions. Scored.', LedBy: 'Priya Raman' };
```

with

```js
    Title: 'How well do you know our customers?', Description: 'Ten questions. Scored.', LedBy: 'Priya Raman',
    Settings: { target: 5, aiContext: 'End with one question for the ops leads.' } };
```

replace `  assert.ok(C.isEnvelope(enc.Title) && C.isEnvelope(enc.Description) && C.isEnvelope(enc.LedBy));` with `  assert.ok(C.isEnvelope(enc.Title) && C.isEnvelope(enc.Description) && C.isEnvelope(enc.LedBy) && C.isEnvelope(enc.Settings));`, add below `  assert.ok(!JSON.stringify(enc).includes('Priya'));` the line `  assert.ok(!JSON.stringify(enc).includes('ops leads'));`, and add below `  assert.strictEqual(back.LedBy, row.LedBy);` the line `  assert.deepStrictEqual(back.Settings, row.Settings);`.

Create `src/src/__tests__/itemSessionMapping.test.js`:

```js
/**
 * AN EVENT ITEM → THE SESSION ROADMAP M3 WILL MAKE FROM IT — the contract the
 * plan's mapping table states (docs/superpowers/plans/
 * 2026-09-26-events-m1b-richer-agenda.md), pinned. agenda-rules.sessionFormOf
 * turns an item into the create dialog's own payload; createGameBody — the
 * function the create dialog itself uses — turns that into the POST /games
 * body. So an item and a session made by hand with the same choices are the
 * same session.
 *
 * rejects: an item option that reaches the body under another name, or not at
 * all; the item's description, leader or length leaking into the session; an
 * untouched item that differs from an untouched create dialog.
 */
import { createGameBody } from '../config/createGame';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';

const BRIEF = { text: 'Open issues are up 15%.', source: null, namesRemoved: 0, draftedAt: null, editedAt: null };
const item = (over = {}) => ({
  itemId: 'it_00000004', type: 'call-and-answer', title: 'What’s slowing us down?', description: 'Write it, then vote.',
  ledBy: 'Priya Raman', minutes: 20, state: 'planned',
  setRef: { scope: 'org', orgId: 'org_nw', setId: 'friction', version: 5 },
  ...over,
});

test('every option of a Call & Answer item reaches the body under create\'s own name', () => {
  const it = item({
    settings: {
      anonymousResponses: false, randomizeQuestions: false, categoryIds: ['Ops'], target: 4, personaId: 'coach',
      promptId: 'lp-behavioral', aiContext: 'End with one question.', eventDetails: 'Why we meet.', briefing: BRIEF,
    },
  });
  expect(createGameBody(rules.sessionFormOf(it))).toEqual({
    eventTitle: 'What’s slowing us down?',
    engagementInfo: 'Why we meet.',
    aiContext: 'End with one question.',
    gameType: 'call-and-answer',
    questionSetId: 'friction',
    questionSetScope: 'org',
    randomizeQuestions: false,
    selectedCategories: ['Ops'],
    personaId: 'coach',
    promptId: 'lp-behavioral',
    hostName: 'Host',
    anonymousUntilReveal: false,
    briefing: BRIEF,
    target: 4,
  });
});

test('the pinned version travels beside the form, for M3 to send as questionSetVersion', () => {
  expect(rules.sessionFormOf(item()).setVersion).toBe(5);
  expect('questionSetVersion' in createGameBody(rules.sessionFormOf(item()))).toBe(false);
});

test('a survey item sends its Names, and never a shuffle, a goal or a vote to hide', () => {
  const it = item({
    type: 'survey', title: 'How did today go?', setRef: { scope: 'platform', orgId: '', setId: 'kickoff', version: 1 },
    settings: { names: 'finished', personaId: '', promptId: '', aiContext: '', eventDetails: '' },
  });
  const body = createGameBody(rules.sessionFormOf(it));
  expect(body.names).toBe('finished');
  expect(body.randomizeQuestions).toBe(false);
  expect(body.anonymousUntilReveal).toBe(false);
  expect('target' in body).toBe(false);
});

test.each(['trivia', 'call-and-answer', 'poll', 'wavelength', 'survey'])(
  'an untouched %s item is an untouched create dialog',
  (type) => {
    const fromItem = createGameBody(rules.sessionFormOf({ type, title: 'T', setRef: { scope: 'platform', orgId: '', setId: 'x', version: 1 } }));
    const fromDialog = createGameBody({ title: 'T', gameType: type, setId: 'x', setScope: 'platform' });
    expect(fromItem).toEqual(fromDialog);
  },
);

test('the description, the leader and the length are the agenda\'s, never the session\'s', () => {
  const body = JSON.stringify(createGameBody(rules.sessionFormOf(item({ settings: {} }))));
  expect(body).not.toMatch(/Write it, then vote|Priya Raman/);
  expect(body).not.toMatch(/"minutes"|"ledBy"|"description"/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `for f in tests/event-item-settings.js tests/event-agenda-rules.js tests/tenant-crypto.js; do node "$f" 2>&1 | grep -m3 -E "FAIL|Error"; done` and `cd src && npm test -- itemSessionMapping`
Expected: `Cannot find module …/events/item-settings.js`; `R.settingKeysFor is not a function`; `item` does not seal `Settings`; `rules.sessionFormOf is not a function`.

- [ ] **Step 3: The session-option section — `agenda-rules.js`**

Insert immediately above the line `// ── Times ───────────────────────────────────────────────────────────────────`:

```js
// ── An engagement's session options (events M1b) ───────────────────────────
/**
 * WHAT AN ENGAGEMENT ITEM CARRIES OF THE SESSION IT BECOMES. The owner, 26
 * Sep 2026: "It would also be nice if all of the options that you get when
 * setting up each engagement is avail". The item dialog renders the create
 * dialog's own options (src/src/components/SessionOptions.jsx), and the item
 * stores what they say as one map, `Settings`, under the create dialog's own
 * payload keys — so roadmap M3 turns an item into a session with
 * `sessionFormOf` below and the create dialog's createGameBody, and cannot
 * drift (src/src/__tests__/itemSessionMapping.test.js).
 *
 * Which options a format has is the create dialog's rule:
 *   every engagement   personaId, promptId, aiContext, eventDetails
 *   not a survey       randomizeQuestions, categoryIds, target
 *   a vote to hide     anonymousResponses   (call-and-answer, poll)
 *   a survey           names
 *   call-and-answer    briefing
 * `SETTING_DEFAULTS` is what the create dialog sends for an untouched form
 * (config/setupDefaults.js); an empty `categoryIds` means every category, as
 * it does at create.
 */
const SETTING_DEFAULTS = Object.freeze({
  anonymousResponses: true,
  randomizeQuestions: true,
  names: 'anonymous',
  target: null,
  categoryIds: Object.freeze([]),
  personaId: '',
  promptId: '',
  aiContext: '',
  eventDetails: '',
  briefing: null,
});
const SETTING_KEYS = Object.freeze(Object.keys(SETTING_DEFAULTS));
const ANONYMITY_TYPES = Object.freeze(['call-and-answer', 'poll']);
const WORKIE_KEYS = Object.freeze(['personaId', 'promptId', 'aiContext', 'eventDetails']);

/** The option keys an item of `type` stores; [] for anything but an engagement. */
function settingKeysFor(type) {
  if (!isEngagement(type)) return [];
  if (type === 'survey') return ['names', ...WORKIE_KEYS];
  return [
    ...(ANONYMITY_TYPES.includes(type) ? ['anonymousResponses'] : []),
    'randomizeQuestions', 'categoryIds', 'target',
    ...(type === 'call-and-answer' ? ['briefing'] : []),
    ...WORKIE_KEYS,
  ];
}

/** Only the keys that apply to `type`: each given value, else its default (an array is always a fresh copy). */
function settingsFor(type, values) {
  const given = values && typeof values === 'object' ? values : {};
  const out = {};
  for (const key of settingKeysFor(type)) {
    const value = given[key] === undefined ? SETTING_DEFAULTS[key] : given[key];
    out[key] = Array.isArray(value) ? value.slice() : value;
  }
  return out;
}

/**
 * An item as the create dialog's payload (GameSetupDialog → createGameBody).
 * `setVersion` rides beside it: createGameBody has no version input, and M3
 * sends it as `questionSetVersion`, which create-game.js already accepts. The
 * item's description, leader and length are the agenda's own, and stay out.
 */
function sessionFormOf(item) {
  const i = item || {};
  const ref = i.setRef || {};
  return {
    title: i.title || '',
    gameType: i.type,
    setId: ref.setId || '',
    setScope: ref.scope || '',
    setVersion: ref.version === undefined ? null : ref.version,
    ...settingsFor(i.type, i.settings),
  };
}

```

In `module.exports`, replace

```js
  canonicalSetType, isEngagement, isCounted, countItems, capRefusal,
```

with

```js
  canonicalSetType, isEngagement, isCounted, countItems, capRefusal,
  SETTING_DEFAULTS, SETTING_KEYS, settingKeysFor, settingsFor, sessionFormOf,
```

- [ ] **Step 4: The checker — create `lambda-functions/websocket/events/item-settings.js`**

```js
/**
 * AN ENGAGEMENT ITEM'S SESSION OPTIONS, CHECKED — the server's half of the
 * item dialog's options (src/src/components/SessionOptions.jsx), for POST and
 * PUT /events/{code}/items (items.js). Events M1b.
 *
 * The rules are create's own. The keys are the create dialog's payload keys
 * (agenda-rules.settingKeysFor decides which a format has); an option a format
 * does not have is refused in the sentence create-game.js or update-game.js
 * would use, never dropped; Names is one of survey-names.js's three; a goal is
 * session-goal.js's, bounded by the set's size at the item's pinned version;
 * the briefing is briefing.js's (1,500 characters); and the two text caps are
 * the create dialog's own maxLengths — 500 for Workie's instructions, 300 for
 * the event details — which create-game.js has never checked itself.
 * tests/event-item-settings.js §5 holds these numbers equal to the dialog's.
 *
 * The map this returns is complete for the format (every key that applies,
 * defaults filled), and items.js seals it whole as `Settings`.
 */
const rules = require('./agenda-rules');
const { normalizeBriefing } = require('../briefing');
const { NAMES } = require('../survey-names');
const { checkTarget } = require('../session-goal');

const AI_CONTEXT_MAX = 500;
const EVENT_DETAILS_MAX = 300;
const ID_MAX = 128;
const CATEGORY_MAX = 24;
const CATEGORY_NAME_MAX = 120;

/** What each option says when the format does not have it. */
const NOT_THIS_FORMAT = Object.freeze({
  anonymousResponses: 'Anonymous responses apply to Call & Answer and Poll only.',
  randomizeQuestions: 'A survey is read in the order it was written, so it has no shuffle.',
  categoryIds: 'A survey has no categories.',
  target: 'A survey is answered at each person’s own pace, so it has no goal.',
  names: 'Names applies to a survey only.',
  briefing: 'A briefing applies to Call & Answer sessions only',
});

/**
 * @param {string} type           the item's kind
 * @param {object} input          the `settings` the request sent (or undefined)
 * @param {{questionCount?: number}} opts  the pinned version's size
 * @returns {{value: object|null}|{error: string}}
 */
function checkItemSettings(type, input, { questionCount = 0 } = {}) {
  const sent = input !== undefined && input !== null;
  if (!rules.isEngagement(type)) {
    return sent ? { error: 'Only an engagement has session options.' } : { value: null };
  }
  if (sent && (typeof input !== 'object' || Array.isArray(input))) {
    return { error: 'Session options are a set of named choices.' };
  }
  const given = sent ? input : {};
  const applies = rules.settingKeysFor(type);
  for (const key of Object.keys(given)) {
    if (!rules.SETTING_KEYS.includes(key)) return { error: `“${key}” is not a session option.` };
    if (!applies.includes(key)) return { error: NOT_THIS_FORMAT[key] };
  }

  const s = rules.settingsFor(type, given);
  const out = {};
  for (const key of applies) {
    const v = s[key];
    if (key === 'anonymousResponses' || key === 'randomizeQuestions') {
      if (typeof v !== 'boolean') {
        return { error: key === 'anonymousResponses' ? 'Anonymous responses is on or off.' : 'Shuffle is on or off.' };
      }
      out[key] = v;
    } else if (key === 'names') {
      const mode = String(v == null ? '' : v).trim().toLowerCase();
      if (!NAMES.includes(mode)) return { error: `Names is one of: ${NAMES.join(', ')}.` };
      out[key] = mode;
    } else if (key === 'target') {
      const checked = checkTarget(v, questionCount);
      if (checked.error) return { error: checked.error };
      out[key] = checked.value;
    } else if (key === 'categoryIds') {
      if (!Array.isArray(v)) return { error: 'Choose categories from the set.' };
      const chosen = [...new Set(v.map((c) => (typeof c === 'string' ? c.trim() : '')))];
      if (chosen.length > CATEGORY_MAX || chosen.some((c) => !c || c.length > CATEGORY_NAME_MAX)) {
        return { error: 'Choose categories from the set.' };
      }
      out[key] = chosen;
    } else if (key === 'personaId' || key === 'promptId') {
      if (typeof v !== 'string' || v.trim().length > ID_MAX) {
        return { error: key === 'personaId' ? 'That is not one of Workie’s voices.' : 'That is not a summary approach.' };
      }
      out[key] = v.trim();
    } else if (key === 'aiContext') {
      if (typeof v !== 'string') return { error: 'Instructions for Workie are text.' };
      if (v.length > AI_CONTEXT_MAX) return { error: `Instructions for Workie can be ${AI_CONTEXT_MAX} characters at most.` };
      out[key] = v;
    } else if (key === 'eventDetails') {
      if (typeof v !== 'string') return { error: 'Event details are text.' };
      if (v.length > EVENT_DETAILS_MAX) return { error: `Event details can be ${EVENT_DETAILS_MAX} characters at most.` };
      out[key] = v;
    } else if (key === 'briefing') {
      const checked = normalizeBriefing(v);
      if (checked.error) return { error: checked.error };
      out[key] = checked.value;
    }
  }
  return { value: out };
}

module.exports = {
  AI_CONTEXT_MAX, EVENT_DETAILS_MAX, ID_MAX, CATEGORY_MAX, CATEGORY_NAME_MAX,
  checkItemSettings,
};
```

- [ ] **Step 5: `Settings` is sealed — `tenant-crypto.js`, all three copies**

In `lambda-functions/game/tenant-crypto.js`, replace Task 8's

```js
  /** One agenda item: PK=EVENT#<code>, SK=ITEM#<id>. Its title and its
   *  description are what the host wrote for the room; `LedBy` is the name of
   *  who leads it (events M1b) — a person's name, personal data. `Type`,
   *  `Order`, `Minutes`, `State` and `SetRef` — a pointer to a question set,
   *  as a session's `QuestionSetId` is — are structure, and stay plaintext. */
  item: Object.freeze(['Title', 'Description', 'LedBy']),
```

with

```js
  /** One agenda item: PK=EVENT#<code>, SK=ITEM#<id>. Its title and its
   *  description are what the host wrote for the room; `LedBy` is the name of
   *  who leads it (events M1b) — a person's name, personal data. `Settings`
   *  is an engagement's session options, sealed WHOLE: it carries Workie's
   *  briefing, instructions and event details, which a session seals too.
   *  `Type`, `Order`, `Minutes`, `State` and `SetRef` — a pointer to a
   *  question set, as a session's `QuestionSetId` is — are structure, and
   *  stay plaintext. */
  item: Object.freeze(['Title', 'Description', 'LedBy', 'Settings']),
```

then: `cp lambda-functions/game/tenant-crypto.js lambda-functions/websocket/tenant-crypto.js && cp lambda-functions/game/tenant-crypto.js lambda-functions/admin/shared/tenant-crypto.js`

- [ ] **Step 6: The routes — `items.js`**

(a) In the header, replace

```js
 * `LedBy` and sealed with the item's words.
```

with

```js
 * `LedBy` and sealed with the item's words. An engagement also carries its
 * session options — the create dialog's own, checked by item-settings.js and
 * sealed whole as `Settings` — which roadmap M3 feeds into the item's
 * session (agenda-rules.sessionFormOf).
```

(b) Below `const rules = require('./agenda-rules');` add:

```js
const { checkItemSettings } = require('./item-settings');
const { questionCountAt } = require('../session-goal');
```

(c) `pinSet` returns the set's row too. In its doc block replace

```js
 * only by an explicit "Use vN" (PUT), never silently (RATIONALE §c).
 */
```

with

```js
 * only by an explicit "Use vN" (PUT), never silently (RATIONALE §c).
 *
 * The set's row comes back too (`setRow`), so a goal can be checked against
 * the size of the version pinned.
 */
```

and replace `  return { setRef: { scope, orgId: ref.orgId, setId, version } };` with `  return { setRef: { scope, orgId: ref.orgId, setId, version }, setRow: row };`.

(d) In `addItem`, replace

```js
  let setRef = null;
  if (rules.isEngagement(type)) {
    const pinned = await pinSet(meta, type, body.setRef);
    if (pinned.error) return json(400, { error: pinned.error });
    setRef = pinned.setRef;
  }
```

with

```js
  let setRef = null;
  let settings = null;
  if (rules.isEngagement(type)) {
    const pinned = await pinSet(meta, type, body.setRef);
    if (pinned.error) return json(400, { error: pinned.error });
    setRef = pinned.setRef;
    // The session options (events M1b), checked by create's rules; a goal
    // against the size of the version just pinned.
    const checked = checkItemSettings(type, body.settings, {
      questionCount: questionCountAt(pinned.setRow, setRef.version),
    });
    if (checked.error) return json(400, { error: checked.error });
    settings = checked.value;
  } else if (body.settings !== undefined && body.settings !== null) {
    return json(400, { error: 'Only an engagement has session options.' });
  }
```

and in its `plain` row replace

```js
    ...(setRef ? { SetRef: setRef } : {}),
    CreatedAt: now,
```

with

```js
    ...(setRef ? { SetRef: setRef } : {}),
    // Sealed whole with the item's words (tenant-crypto `item`).
    ...(settings ? { Settings: settings } : {}),
    CreatedAt: now,
```

(e) In `editItem` (Task 8's version), replace

```js
  let setRef = row.SetRef || null;
  if (has('version')) {
    if (!rules.isEngagement(row.Type) || !setRef) return json(400, { error: 'Only an engagement plays a version of a set.' });
    const pinned = await pinSet(meta, row.Type, { ...setRef, version: body.version });
    if (pinned.error) return json(400, { error: pinned.error });
    setRef = pinned.setRef;
  }
```

with

```js
  let setRef = row.SetRef || null;
  let setRow = null;
  const versionAsked = has('version');
  if (versionAsked) {
    if (!rules.isEngagement(row.Type) || !setRef) return json(400, { error: 'Only an engagement plays a version of a set.' });
    const pinned = await pinSet(meta, row.Type, { ...setRef, version: body.version });
    if (pinned.error) return json(400, { error: pinned.error });
    setRef = pinned.setRef;
    setRow = pinned.setRow;
  }

  /*
    THE SESSION OPTIONS (events M1b). `settings` replaces the whole map,
    checked by create's rules (item-settings.js). "Use vN" alone keeps the map
    but re-checks it against the version it moves to: a goal the new version
    cannot meet is refused in words, and a narrowed category list is reset to
    every category (a newer version may not have the same ones), which the
    reply says (`categoriesReset`) so the builder can. `undefined` below
    leaves the stored map alone — an item added before M1b keeps none.
  */
  if (has('settings') && !rules.isEngagement(row.Type)) {
    return json(400, { error: 'Only an engagement has session options.' });
  }
  let settings;
  let categoriesReset = false;
  if (rules.isEngagement(row.Type) && (has('settings') || versionAsked)) {
    if (!setRow && setRef) {
      setRow = await getSetMetadata(db, TABLE(), {
        scope: setRef.scope, orgId: setRef.scope === tenant.ORG ? meta.orgId : '', setId: setRef.setId,
      });
    }
    const questionCount = questionCountAt(setRow, setRef && setRef.version);
    if (has('settings')) {
      const checked = checkItemSettings(row.Type, body.settings, { questionCount });
      if (checked.error) return json(400, { error: checked.error });
      settings = checked.value;
    } else {
      const kept = rules.settingsFor(row.Type, current.Settings);
      if (kept.target && questionCount && kept.target > questionCount) {
        return json(400, {
          error: `Your goal of ${kept.target} is more than v${setRef.version}’s ${questionCount} questions. Lower the goal, then use v${setRef.version}.`,
          code: 'goal_over',
        });
      }
      const moved = !row.SetRef || row.SetRef.version !== setRef.version;
      if (moved && kept.categoryIds && kept.categoryIds.length) {
        kept.categoryIds = [];
        categoriesReset = true;
      }
      settings = kept;
    }
  }
```

replace

```js
  const sealed = await encryptItem(meta.orgId, 'item', words);
```

with

```js
  const sealed = await encryptItem(meta.orgId, 'item', {
    ...words, ...(settings !== undefined ? { Settings: settings } : {}),
  });
```

replace

```js
  if (setRef) {
    expression += ', #sr = :sr';
    names['#sr'] = 'SetRef';
    values[':sr'] = setRef;
  }
  try {
```

with

```js
  if (setRef) {
    expression += ', #sr = :sr';
    names['#sr'] = 'SetRef';
    values[':sr'] = setRef;
  }
  if (settings !== undefined) {
    expression += ', #sx = :sx';
    names['#sx'] = 'Settings';
    values[':sx'] = sealed.Settings;
  }
  try {
```

and replace the final return

```js
  return json(200, {
    item: S.projectItem({
      ...current, ...words, Minutes: fields.value.minutes,
      ...(setRef ? { SetRef: setRef } : {}),
    }),
  });
}
```

with

```js
  return json(200, {
    item: S.projectItem({
      ...current, ...words, Minutes: fields.value.minutes,
      ...(setRef ? { SetRef: setRef } : {}),
      ...(settings !== undefined ? { Settings: settings } : {}),
    }),
    ...(categoriesReset ? { categoriesReset: true } : {}),
  });
}
```

- [ ] **Step 7: The read — `event-store.js`**

Replace `const { decryptItem } = require('../tenant-crypto');` with `const { decryptItem, isEnvelope } = require('../tenant-crypto');`.

In `openItemRow` replace

```js
    return { ...row, Title: '', Description: '', LedBy: '', decryptFailed: true };
```

with

```js
    return { ...row, Title: '', Description: '', LedBy: '', Settings: null, decryptFailed: true };
```

and in `projectItem` replace

```js
  if (r.decryptFailed) out.decryptFailed = true;
  if (r.SetRef && typeof r.SetRef === 'object') {
```

with

```js
  if (r.decryptFailed) out.decryptFailed = true;
  // An engagement's session options (events M1b), decrypted. Never an
  // envelope: a row that could not be opened carries none (openItemRow).
  if (r.Settings && typeof r.Settings === 'object' && !Array.isArray(r.Settings) && !isEnvelope(r.Settings)) {
    out.settings = r.Settings;
  }
  if (r.SetRef && typeof r.SetRef === 'object') {
```

`get-agenda.js` is not touched: it never reads `Settings`, and `tests/event-item-settings.js` §4 proves it.

- [ ] **Step 8: Run them, with every event suite**

Run: `for f in tests/event-item-settings.js tests/event-item-kinds.js tests/event-agenda-rules.js tests/event-caps.js tests/event-public-reads.js tests/event-item-edit.js tests/event-host-reads.js tests/tenant-crypto.js tests/kms-grants-match-code.js tests/lambda-event-not-logged.js tests/no-global-partition-literals.js tests/event-routes-authorization.js; do node "$f" >/dev/null 2>&1 && echo "ok $f" || echo "FAIL $f"; done`
Expected: every line `ok`.

Run: `cd src && npm test -- itemSessionMapping eventBuilder eventItemDialog`
Expected: `Test Suites: 4 passed`.

- [ ] **Step 9: The backend loop and the frontend suite; commit**

```bash
git add lambda-functions/websocket/events/agenda-rules.js lambda-functions/websocket/events/item-settings.js lambda-functions/websocket/events/items.js lambda-functions/websocket/events/event-store.js lambda-functions/game/tenant-crypto.js lambda-functions/websocket/tenant-crypto.js lambda-functions/admin/shared/tenant-crypto.js tests/event-item-settings.js tests/event-agenda-rules.js tests/tenant-crypto.js src/src/__tests__/itemSessionMapping.test.js
git commit -m "An engagement item keeps the create dialog's session options, sealed, for M3 to play

POST and PUT /events/{code}/items take settings under the create payload's own
keys, checked by create's rules (item-settings.js: the format's own options, the
500/300/1,500 caps, Names, a goal within the pinned version) and sealed whole
as Settings. The host's read returns them; the public agenda never does. \"Use
vN\" refuses a goal the new version cannot meet and resets a narrowed category
list, saying so. agenda-rules.sessionFormOf + createGameBody is the item-to-
session mapping M3 follows, pinned by itemSessionMapping.test.js.
tests/event-item-settings.js; event-agenda-rules §8; tenant-crypto §7b.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: The item dialog — presentations, activities, "Led by", and the title that names the session

The item dialog learns the two new kinds and the leader. A presentation is 04's form without its upload, with one line saying the PDF copy for attendees comes later; an activity is the same form headed "Add an activity" and led by "Led by"; every kind but a break has an optional name field labelled for its kind; an engagement's "Title on the agenda" says it also names the session. The builder still cannot open the new kinds (Task 12); this task's tests open the dialog directly.

Screens: `04-add-presentation.html` (the presentation form: Title, Presenter, Goes after, Planned length, Description — its "A copy for attendees" block is M5's and is replaced by one line); `03-add-item.html` (an engagement's form, the Facilitator field beside the title).

**Files:**
- Modify: `src/src/components/EventItemDialog.jsx`
- Modify: `src/src/__tests__/eventItemDialog.test.jsx` (one expectation)
- Create: `src/src/__tests__/eventItemKinds.test.jsx`

**Interfaces:**
- Consumes: `PRESENTATION`, `CUSTOM`, `hasLeader`, `ledByLabel`, `checkLedBy`, `LED_BY_MAX` (Task 8).
- Produces: `addItem(code, {type, title, description, minutes, position?, setRef?, ledBy?})` — `ledBy` only when a name was typed; `updateItem(code, itemId, {title, description, minutes, ledBy?})` — `ledBy` always for a kind with a leader, `''` to clear. Ids `evb-ledby`, `evb-title-hint`.

- [ ] **Step 1: Write the failing test**

Create `src/src/__tests__/eventItemKinds.test.jsx`:

```jsx
/**
 * PRESENTATIONS, ACTIVITIES AND WHO LEADS AN ITEM — components/EventItemDialog.jsx
 * (04-add-presentation.html without its upload; events M1b Task 10).
 *
 * The owner: presentations "could be just placeholders", "a custom choice",
 * and "enter the facilitator/speaker/presenter".
 *
 * rejects: a presentation offered a set picker or an upload; the PDF copy
 * promised now; a leader field on a break; an empty name sent on an add, or
 * held back on an edit (so it could never be cleared); a name longer than the
 * server takes sent at all; an engagement's title that does not say it names
 * the session.
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
];
const ITEMS = [
  { itemId: 'it_00000001', order: 1, type: 'poll', title: 'Before we start', minutes: 8, description: '', ledBy: '', state: 'planned' },
];
const base = (over = {}) => ({
  code: '5307', mode: 'add', type: 'presentation', items: ITEMS, sets: SETS,
  onClose: jest.fn(), onSaved: jest.fn(), onRemoved: jest.fn(), ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => false);
  api.addItem.mockResolvedValue({ item: {} });
  api.updateItem.mockResolvedValue({ item: {} });
});

describe('a presentation (04, without the upload)', () => {
  it('is titled, led by its presenter, timed and described, and says the PDF copy comes later', async () => {
    const p = base();
    render(<EventItemDialog {...p} />);
    expect(screen.getByRole('heading', { name: 'Add a presentation' })).toBeInTheDocument();
    expect(screen.queryByTestId('set-row')).toBeNull();
    expect(screen.getByText(/A PDF copy for attendees comes later\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'The FY27 plan' } });
    fireEvent.change(screen.getByLabelText(/^Presenter/), { target: { value: 'Marcus Oyelaran' } });
    fireEvent.change(screen.getByLabelText('Planned length'), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith('5307', {
      type: 'presentation', title: 'The FY27 plan', description: '', minutes: 35, ledBy: 'Marcus Oyelaran',
    });
  });

  it('with nobody named, the add sends no ledBy at all', async () => {
    const p = base();
    render(<EventItemDialog {...p} />);
    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'The FY27 plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith('5307', { type: 'presentation', title: 'The FY27 plan', description: '', minutes: 15 });
  });
});

describe('an activity', () => {
  it('is headed "Add an activity", led by "Led by", and needs a title', async () => {
    render(<EventItemDialog {...base({ type: 'custom' })} />);
    expect(screen.getByRole('heading', { name: 'Add an activity' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Led by/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give the item a title for the agenda.');
    expect(api.addItem).not.toHaveBeenCalled();
  });

  it('editing sends the name even when it was cleared, so it can be removed', async () => {
    const lunch = { itemId: 'it_0000000c', order: 2, type: 'custom', title: 'Lunch', minutes: 45, description: '', ledBy: 'Dana Whitfield', state: 'planned' };
    const p = base({ mode: 'edit', type: 'custom', item: lunch });
    render(<EventItemDialog {...p} />);
    expect(screen.getByRole('heading', { name: 'Edit activity' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Led by/)).toHaveValue('Dana Whitfield');
    fireEvent.change(screen.getByLabelText(/^Led by/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_0000000c', { title: 'Lunch', description: '', minutes: 45, ledBy: '' });
  });
});

describe('who leads an engagement, and what its title names', () => {
  it('a Facilitator field sits beside the title, and the title says it names the session', () => {
    render(<EventItemDialog {...base({ type: 'trivia' })} />);
    expect(screen.getByLabelText(/^Facilitator/)).toBeInTheDocument();
    expect(screen.getByLabelText('Title on the agenda')).toHaveAccessibleDescription('Also the session’s name on the stage when you start it.');
  });

  it('the name field takes no more than the server keeps (80 characters)', () => {
    render(<EventItemDialog {...base({ type: 'custom' })} />);
    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'Networking' } });
    const field = screen.getByLabelText(/^Led by/);
    expect(field).toHaveAttribute('maxLength', '80');
  });
});

describe('a break is led by nobody', () => {
  it('has no leader field, and its title names no session', () => {
    render(<EventItemDialog {...base({ type: 'break' })} />);
    expect(screen.queryByLabelText(/^(Facilitator|Presenter|Led by)/)).toBeNull();
    expect(screen.queryByText('Also the session’s name on the stage when you start it.')).toBeNull();
  });
});
```

In `src/src/__tests__/eventItemDialog.test.jsx` (editing now always sends the leader, so it can be cleared), replace

```jsx
    expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', { title: 'FY27 plan quiz', description: '', minutes: 20 });
```

with

```jsx
    expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', { title: 'FY27 plan quiz', description: '', minutes: 20, ledBy: '' });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd src && npm test -- eventItemKinds eventItemDialog`
Expected: FAIL — no heading "Add a presentation" (it reads "Add Presentation"); no field labelled Presenter; the edit sends no `ledBy`.

- [ ] **Step 3: The dialog — `EventItemDialog.jsx`**

(a) In the header's mode table, replace

```js
 *   mode 'add', type 'break'        the same fields without a set; 03 draws no
 *                                   break dialog, so this is 03's form minus
 *                                   its picker
```

with

```js
 *   mode 'add', type 'break'        the same fields without a set; 03 draws no
 *                                   break dialog, so this is 03's form minus
 *                                   its picker
 *   mode 'add', a presentation      04-add-presentation's form without its
 *                                   upload (roadmap M5): title, presenter,
 *                                   length, description, and one line saying
 *                                   the PDF copy for attendees comes later
 *   mode 'add', an activity         the same form, led by "Led by" — the
 *                                   owner's "custom choice" (events M1b)
```

and immediately above ` * @param {string}   code      the event` add:

```js
 * WHO LEADS IT (events M1b). Every kind but a break has one optional name,
 * labelled for its kind — Facilitator, Presenter or Led by
 * (agenda-rules.ledByLabel) — sent as `ledBy`. An add sends it only when a
 * name was typed; an edit always sends it, so it can be cleared. An
 * engagement's "Title on the agenda" is also what its session is called when
 * roadmap M3 starts it, and the field says so.
 *
```

(b) Below `const AT_END = 'AT_END';` add:

```js
/** The headings that are not "Add <Kind>" / "Edit <Kind>" (04 draws "Add a presentation"). */
const HEADINGS = {
  [rules.PRESENTATION]: ['Add a presentation', 'Edit presentation'],
  [rules.CUSTOM]: ['Add an activity', 'Edit activity'],
  [rules.BREAK]: ['Add a break', 'Edit break'],
};
```

(c) Below `  const label = rules.TYPE_LABELS[type] || 'item';` add:

```js
  const leads = rules.hasLeader(type);
  const leaderLabel = rules.ledByLabel(type);
```

(d) In `baseline`, replace

```js
    description: editing ? item.description : '',
    after: AT_END,
```

with

```js
    description: editing ? item.description : '',
    ledBy: editing ? (item.ledBy || '') : '',
    after: AT_END,
```

(e) Below `  const [description, setDescription] = useState(baseline.description);` add:

```js
  const [ledBy, setLedBy] = useState(baseline.ledBy);
```

(f) Replace

```js
  const dirty = title !== baseline.title || minutes !== baseline.minutes || description !== baseline.description
    || after !== baseline.after || setKey !== baseline.setKey;
```

with

```js
  const dirty = title !== baseline.title || minutes !== baseline.minutes || description !== baseline.description
    || ledBy !== baseline.ledBy || after !== baseline.after || setKey !== baseline.setKey;
```

(g) In `submit`, replace

```js
    if (checked.error) {
      setError(checked.error);
      return;
    }
    let position = null;
```

with

```js
    if (checked.error) {
      setError(checked.error);
      return;
    }
    const leader = rules.checkLedBy(ledBy, type);
    if (leader.error) {
      setError(leader.error);
      return;
    }
    let position = null;
```

replace

```js
        await updateItem(code, item.itemId, checked.value);
```

with

```js
        await updateItem(code, item.itemId, { ...checked.value, ...(leads ? { ledBy: leader.value } : {}) });
```

and in the `addItem` call replace

```js
          type,
          ...checked.value,
```

with

```js
          type,
          ...checked.value,
          ...(leads && leader.value ? { ledBy: leader.value } : {}),
```

(h) Replace

```js
  const heading = unreadable
    ? 'This item could not be read'
    : (editing ? `Edit ${isBreak ? 'break' : label}` : (isBreak ? 'Add a break' : `Add ${label}`));
```

with

```js
  const heading = unreadable
    ? 'This item could not be read'
    : (HEADINGS[type] || [`Add ${label}`, `Edit ${label}`])[editing ? 1 : 0];
```

(i) In the header's `<p>`, below the line `              {!unreadable && !picking && isBreak && 'A return time on the agenda. Not counted, and not billed.'}` add:

```jsx
              {!unreadable && type === rules.PRESENTATION && 'A talk given from the presenter’s own screen. While it runs, every phone, laptop or tablet says “look up”.'}
              {!unreadable && type === rules.CUSTOM && 'Anything else on the day: networking, lunch with a speaker, an open discussion. It sits on the agenda, with nothing to answer.'}
```

(j) Replace the title field's input and the close of its `evb-field`

```jsx
              <input
                id="evb-title"
                className="evb-input"
                value={title}
                maxLength={rules.TITLE_MAX}
                onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
              />
            </div>
```

with

```jsx
              <input
                id="evb-title"
                className="evb-input"
                value={title}
                maxLength={rules.TITLE_MAX}
                onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
                aria-describedby={rules.isEngagement(type) ? 'evb-title-hint' : undefined}
              />
              {rules.isEngagement(type) && (
                <span className="evb-hint" id="evb-title-hint">
                  Also the session’s name on the stage when you start it.
                </span>
              )}
            </div>
            {leads && (
              <div className="evb-field evb-span2">
                <label className="evb-label" htmlFor="evb-ledby">
                  {leaderLabel} <span className="evb-dim">· optional</span>
                </label>
                <input
                  id="evb-ledby"
                  className="evb-input"
                  value={ledBy}
                  maxLength={rules.LED_BY_MAX}
                  placeholder="Their name"
                  onChange={(e) => setLedBy(e.target.value)}
                />
              </div>
            )}
```

(The grid is four columns: title and leader share the first row, two columns each — 04's Presenter beside Goes after, 03's Facilitator beside the title — and a break's form is unchanged.)

(k) Replace the hint paragraph

```jsx
          <p className="evb-hint">
            The title and description are what the room sees, and every phone, laptop or tablet that joins.
            {picking && ' The set’s own name stays in the console.'}
          </p>
```

with

```jsx
          <p className="evb-hint">
            {leads
              ? 'The title, the description and the name are what the room sees, and every phone, laptop or tablet that joins.'
              : 'The title and description are what the room sees, and every phone, laptop or tablet that joins.'}
            {picking && ' The set’s own name stays in the console.'}
            {type === rules.PRESENTATION && ' A PDF copy for attendees comes later.'}
          </p>
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd src && npm test -- eventItemKinds eventItemDialog eventBuilder`
Expected: `Test Suites: 4 passed` (`eventItemKinds`, `eventItemDialog`, `eventBuilder`, `eventBuilderPalette`).

- [ ] **Step 5: Full frontend suite, lint, build, backend loop; commit**

```bash
git add src/src/components/EventItemDialog.jsx src/src/__tests__/eventItemDialog.test.jsx src/src/__tests__/eventItemKinds.test.jsx
git commit -m "The item dialog adds a presentation or an activity, and names who leads any item

A presentation is 04's form without its upload, saying the PDF copy for
attendees comes later; an activity is headed \"Add an activity\". Every kind
but a break has an optional name, labelled Facilitator, Presenter or Led by,
sent only when typed on an add and always on an edit so it can be cleared.
An engagement's title says it also names the session on the stage.
eventItemKinds.test.jsx.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: The item dialog — every session option, from the shared component

Once an engagement's set is chosen (or, on an edit, from the start), the item dialog renders the create dialog's own options — `SessionCategories`, `SessionBriefing` for Call & Answer, and the `SessionOptions` fold with its Goal — inside a `.gsd` wrapper. What they say travels as `settings`, only the keys the format has. The goal is bounded by the pinned version's size. The dialog reads the format's voices and the set's categories through a new `utils/sessionSetupApi.js`.

Screens: `03-add-item.html` (the item dialog; the options follow its fields) and `docs/design/session-setup-redesign/` 01–02 (the options block as the create dialog draws it — reused, not redrawn).

**Files:**
- Create: `src/src/utils/sessionSetupApi.js`
- Modify: `src/src/components/EventItemDialog.jsx`
- Modify: `src/src/components/EventBuilder.css` (`.evb-sopts`)
- Modify: `src/src/__tests__/eventItemDialog.test.jsx` (a mock and three expectations)
- Modify: `src/src/__tests__/sessionOptionsPalette.test.js` (a new block)
- Create: `src/src/__tests__/eventItemSettings.test.jsx`
- Create: `src/src/__tests__/sessionSetupApi.test.js`

**Interfaces:**
- Consumes: `SessionOptions`, `SessionCategories`, `SessionBriefing` (Tasks 3–4); `settingsFor`, `isEngagement` (Task 9); `checkTarget` (Task 1); `NAMES_DEFAULT`, `namesMode` (`config/surveyNames.js`); the item's `settings` and `set.questionCount` as `GET /events/{code}` projects them.
- Produces: `listPersonas(gameType): Promise<object[]>`, `listSetCategories(setId, scope): Promise<object[]>` (`utils/sessionSetupApi.js`); the item dialog sends `settings: agenda-rules.settingsFor(type, …)` on every engagement add and edit; test id `item-session-options`; ids prefixed `evb-so-`.

- [ ] **Step 1: Write the failing tests**

Create `src/src/__tests__/eventItemSettings.test.jsx`:

```jsx
/**
 * EVERY SESSION OPTION ON AN ENGAGEMENT ITEM — components/EventItemDialog.jsx
 * rendering the create dialog's own options (components/SessionOptions.jsx),
 * events M1b Task 11.
 *
 * The owner: "It would also be nice if all of the options that you get when
 * setting up each engagement is avail, and finally there should be a target
 * number of items."
 *
 * rejects: options offered before a set is chosen (nothing to bound the goal
 * by); a category list read from the wrong library; a goal larger than the
 * pinned version sent; an option the format does not have sent; an edit that
 * forgets the item's options; a briefing still being drafted lost to Add; a
 * changed option dropped without asking.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import EventItemDialog from '../components/EventItemDialog';

jest.mock('../utils/eventsApi', () => ({
  addItem: jest.fn(),
  updateItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../utils/sessionSetupApi', () => ({
  listPersonas: jest.fn(async () => [{ personaId: 'coach', name: 'Coach' }]),
  listSetCategories: jest.fn(async () => [{ name: 'Leadership', questionCount: 4 }, { name: 'Ops', questionCount: 6 }]),
}));
const api = require('../utils/eventsApi');
const lists = require('../utils/sessionSetupApi');

const SETS = [
  { id: 'custq4', scope: 'org', orgId: 'org_nw', name: 'Customer knowledge — Q4', engagementType: 'trivia', activeVersion: 3, questionCount: 10, active: true },
  { id: 'friction', scope: 'org', orgId: 'org_nw', name: 'Friction finder', engagementType: 'call-and-answer', activeVersion: 5, questionCount: 4, active: true },
  { id: 'kickoff', scope: 'platform', orgId: null, name: 'Kickoff pulse', engagementType: 'survey', activeVersion: 1, questionCount: 5, active: true },
];
const base = (over = {}) => ({
  code: '5307', mode: 'add', type: 'trivia', items: [], sets: SETS,
  onClose: jest.fn(), onSaved: jest.fn(), onRemoved: jest.fn(), ...over,
});
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => false);
  api.addItem.mockResolvedValue({ item: {} });
  api.updateItem.mockResolvedValue({ item: {} });
});

describe('adding an engagement', () => {
  it('offers the options once a set is chosen, reading its categories from its own library', async () => {
    render(<EventItemDialog {...base()} />);
    expect(screen.queryByTestId('item-session-options')).toBeNull();
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    expect(await screen.findByRole('button', { name: /Ops/ })).toBeInTheDocument();
    expect(lists.listSetCategories).toHaveBeenCalledWith('custq4', 'org');
    expect(lists.listPersonas).toHaveBeenCalledWith('trivia');
    expect(screen.getByLabelText('Goal')).toBeInTheDocument();
    expect(screen.getByText('of 10 questions')).toBeInTheDocument();
  });

  it('what the host chooses is sent as the item\'s settings, and only the keys trivia has', async () => {
    const p = base();
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    fireEvent.click(await screen.findByRole('button', { name: /Ops/ }));
    await screen.findByRole('option', { name: 'Coach' });
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /shuffle the question order/i }));
    fireEvent.change(screen.getByLabelText("Workie's voice"), { target: { value: 'coach' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith('5307', expect.objectContaining({
      settings: {
        randomizeQuestions: false, categoryIds: ['Ops'], target: 5,
        personaId: 'coach', promptId: '', aiContext: '', eventDetails: '',
      },
    }));
  });

  it('a goal larger than the set stops Add and says why', async () => {
    const p = base();
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    await settle();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This set has 10 questions, so the goal can be 10 at most.');
    expect(api.addItem).not.toHaveBeenCalled();
  });

  it('Call & Answer offers the briefing and anonymous responses', async () => {
    render(<EventItemDialog {...base({ type: 'call-and-answer' })} />);
    fireEvent.click(screen.getByLabelText('Friction finder'));
    await settle();
    expect(screen.getByRole('heading', { name: /Workie’s briefing/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /anonymous responses/i })).toBeChecked();
  });

  it('a survey offers Names and no goal, and sends its Names', async () => {
    const p = base({ type: 'survey' });
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByLabelText('Kickoff pulse'));
    await settle();
    expect(screen.queryByLabelText('Goal')).toBeNull();
    expect(lists.listSetCategories).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Names' })).getAllByRole('radio')[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem.mock.calls[0][1].settings).toEqual({
      names: 'named', personaId: '', promptId: '', aiContext: '', eventDetails: '',
    });
  });
});

describe('editing an engagement', () => {
  const ITEM = {
    itemId: 'it_00000003', order: 1, type: 'trivia', title: 'FY27 plan quiz', minutes: 12, description: '', ledBy: '', state: 'planned',
    setRef: { scope: 'org', orgId: 'org_nw', setId: 'custq4', version: 2 },
    set: { name: 'Customer knowledge — Q4', questionCount: 8, latestVersion: 3, missing: false },
    settings: { randomizeQuestions: true, categoryIds: ['Ops'], target: 4, personaId: 'coach', promptId: '', aiContext: 'Be brief.', eventDetails: '' },
  };

  it('seeds from the item\'s own settings, bounded by the PINNED version, and sends them back', async () => {
    const p = base({ mode: 'edit', item: ITEM });
    render(<EventItemDialog {...p} />);
    await screen.findByRole('button', { name: /Ops/ });
    expect(screen.getByLabelText('Goal')).toHaveValue('4');
    expect(screen.getByText('of 8 questions')).toBeInTheDocument();
    expect(screen.getByLabelText('Instructions for Workie')).toHaveValue('Be brief.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', expect.objectContaining({ settings: ITEM.settings }));
  });

  it('a changed option is not dropped without asking', async () => {
    const p = base({ mode: 'edit', item: ITEM });
    render(<EventItemDialog {...p} />);
    await settle();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '6' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]);
    expect(window.confirm).toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
  });
});
```

Create `src/src/__tests__/sessionSetupApi.test.js`:

```js
/**
 * THE ITEM DIALOG'S TWO LISTS — utils/sessionSetupApi.js (events M1b Task 11).
 *
 * rejects: the wrong route or a scope left off (an org's set read in Engage's
 * library); a refusal or a dropped connection breaking the dialog instead of
 * leaving the list empty.
 */
import { listPersonas, listSetCategories } from '../utils/sessionSetupApi';

jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
});

test('the voices for a format', async () => {
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ personas: [{ personaId: 'coach' }] }) });
  expect(await listPersonas('call-and-answer')).toEqual([{ personaId: 'coach' }]);
  expect(authFetch).toHaveBeenCalledWith('https://api.test/admin/personas?gameType=call-and-answer');
});

test('a set\'s categories, read in the library its reference names', async () => {
  authFetch.mockResolvedValue({ ok: true, json: async () => ({ categories: [{ name: 'Ops', questionCount: 6 }] }) });
  expect(await listSetCategories('custq4', 'org')).toEqual([{ name: 'Ops', questionCount: 6 }]);
  expect(authFetch).toHaveBeenCalledWith('https://api.test/question-sets/custq4/categories?scope=org');
});

test('a refusal, a dropped connection or no set is an empty list', async () => {
  authFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
  expect(await listPersonas('trivia')).toEqual([]);
  authFetch.mockRejectedValueOnce(new Error('offline'));
  expect(await listSetCategories('custq4', 'org')).toEqual([]);
  expect(await listSetCategories('', 'org')).toEqual([]);
});
```

Append to `src/src/__tests__/sessionOptionsPalette.test.js`:

```js

/*
  THE ITEM DIALOG WEARS THE SAME GROUND (events M1b, Task 11). The shared
  options are styled by this sheet's `.gsd` tokens wherever they are drawn; in
  the event item dialog they sit on EventBuilder.css's modal, whose surface is
  the dusk `--surface`. Every pairing gameSetupPalette.test.js measures on
  --gsd-card and --gsd-field therefore holds there only while those two ARE the
  dusk surface and surface-2 — so that is what this pins.
*/
describe('the options inside the event item dialog', () => {
  const dusk = (name) => {
    const block = GLOBAL.slice(GLOBAL.indexOf('[data-theme="dark"] {'));
    const m = block.slice(0, block.indexOf('}')).match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
    if (!m) throw new Error(`${name} is not declared for dusk`);
    return m[1].toUpperCase();
  };
  const gsd = (name) => {
    const body = CSS.slice(CSS.indexOf('.gsd {'), CSS.indexOf('}', CSS.indexOf('.gsd {')));
    return body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`))[1].toUpperCase();
  };

  test('the card and the field are the item dialog\'s own dusk surface and surface-2', () => {
    expect(gsd('--gsd-card')).toBe(dusk('--surface'));
    expect(gsd('--gsd-field')).toBe(dusk('--surface-2'));
  });

  test('the item dialog places the block with no colour of its own', () => {
    const EVB = read('components', 'EventBuilder.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = EVB.match(/\.evb-sopts\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).not.toMatch(/color|background|#|rgba/);
  });
});
```

In `src/src/__tests__/eventItemDialog.test.jsx`, replace

```jsx
jest.mock('../utils/eventsApi', () => ({
  addItem: jest.fn(),
  updateItem: jest.fn(),
  removeItem: jest.fn(),
}));
const api = require('../utils/eventsApi');
```

with

```jsx
jest.mock('../utils/eventsApi', () => ({
  addItem: jest.fn(),
  updateItem: jest.fn(),
  removeItem: jest.fn(),
}));
const api = require('../utils/eventsApi');
// The session options' two lists (events M1b); eventItemSettings.test.jsx
// exercises them. Empty here, so these tests read the M1 dialog as it was.
jest.mock('../utils/sessionSetupApi', () => ({
  listPersonas: jest.fn(async () => []),
  listSetCategories: jest.fn(async () => []),
}));
/* What an untouched trivia item sends as its options (events M1b):
   agenda-rules.settingsFor('trivia', {}) — the create dialog's defaults. */
const TRIVIA_DEFAULTS = {
  randomizeQuestions: true, categoryIds: [], target: null, personaId: '', promptId: '', aiContext: '', eventDetails: '',
};
```

then, in "picking a set fills an untouched title, and sends the version it shows", replace

```jsx
      minutes: 15, position: 1, setRef: { scope: 'org', orgId: 'org_nw', setId: 'custq4', version: 3 },
    });
```

with

```jsx
      minutes: 15, position: 1, setRef: { scope: 'org', orgId: 'org_nw', setId: 'custq4', version: 3 },
      settings: TRIVIA_DEFAULTS,
    });
```

in "appending after the last item (the default) omits position entirely", replace

```jsx
      type: 'trivia', title: 'Customer knowledge — Q4', description: '', minutes: 15,
      setRef: { scope: 'org', orgId: 'org_nw', setId: 'custq4', version: 3 },
    });
```

with

```jsx
      type: 'trivia', title: 'Customer knowledge — Q4', description: '', minutes: 15,
      setRef: { scope: 'org', orgId: 'org_nw', setId: 'custq4', version: 3 },
      settings: TRIVIA_DEFAULTS,
    });
```

and in "edits the words and the length, and names the set without offering to change it", replace Task 10's

```jsx
    expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', { title: 'FY27 plan quiz', description: '', minutes: 20, ledBy: '' });
```

with

```jsx
    expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', {
      title: 'FY27 plan quiz', description: '', minutes: 20, ledBy: '', settings: TRIVIA_DEFAULTS,
    });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd src && npm test -- eventItemSettings sessionSetupApi sessionOptionsPalette eventItemDialog`
Expected: FAIL — `Cannot find module '../utils/sessionSetupApi'`; no `item-session-options`; no `.evb-sopts` rule; the adds send no `settings`.

- [ ] **Step 3: The two lists — create `src/src/utils/sessionSetupApi.js`**

```js
/**
 * THE TWO LISTS THE EVENT ITEM DIALOG NEEDS FOR ITS SESSION OPTIONS — Workie's
 * voices for a format and a set's categories (events M1b). The create dialog's
 * page reads the same two routes itself (GameHostPage fetchPersonas and
 * fetchCategories); the console has no such page, so the item dialog asks
 * here.
 *
 * Both go through authFetch — both routes carry the Cognito authorizer — and
 * neither failure is fatal: with no voices the picker offers "Adapt to the
 * session", which is the default anyway, and with no categories the grid is
 * simply not drawn (the item then plays every category).
 */
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from './adminApi';

/** The voices that suit `gameType` (admin/personas honours each voice's gameTypes). */
export async function listPersonas(gameType) {
  try {
    const query = gameType ? `?gameType=${encodeURIComponent(gameType)}` : '';
    const res = await authFetch(adminApiUrl(`admin/personas${query}`));
    if (!res || !res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.personas) ? body.personas : [];
  } catch (e) {
    return [];
  }
}

/** A set's categories, `{ name, questionCount }`, read in the library `scope` names. */
export async function listSetCategories(setId, scope) {
  if (!setId) return [];
  try {
    const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
    const res = await authFetch(adminApiUrl(`question-sets/${encodeURIComponent(setId)}/categories${query}`));
    if (!res || !res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.categories) ? body.categories : [];
  } catch (e) {
    return [];
  }
}
```

- [ ] **Step 4: The options in the dialog — `EventItemDialog.jsx`**

(a) Replace the imports

```js
import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import { addItem, updateItem, removeItem } from '../utils/eventsApi';
import './EventBuilder.css';
```

with

```js
import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import SessionOptions, { SessionCategories, SessionBriefing } from './SessionOptions';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import goalRules from '../../../lambda-functions/websocket/session-goal';
import { NAMES_DEFAULT, namesMode } from '../config/surveyNames';
import { addItem, updateItem, removeItem } from '../utils/eventsApi';
import { listPersonas, listSetCategories } from '../utils/sessionSetupApi';
import './EventBuilder.css';
```

(b) Immediately above ` * @param {string}   code      the event` add:

```js
 * EVERY SESSION OPTION (events M1b; owner: "all of the options that you get
 * when setting up each engagement"). Once an engagement's set is chosen, the
 * dialog renders the create dialog's own options — SessionCategories,
 * SessionBriefing (Call & Answer) and the SessionOptions fold, never a copy —
 * wrapped in the `.gsd` scope whose tokens they wear. What they say travels as
 * `settings`, under the create payload's own keys, for exactly the keys the
 * format has (agenda-rules.settingsFor); an edit seeds from the item's own. The
 * goal is bounded by the pinned version's size, and Add waits while Workie is
 * still drafting a briefing.
 *
```

(c) Below `  const [confirmingRemove, setConfirmingRemove] = useState(false);` add:

```js

  /* THE SESSION OPTIONS (events M1b). `options` holds SessionOptions' keys;
     the categories and the briefing are held beside it, as the create dialog
     holds them. An edit seeds from the item's settings; an item added before
     M1b has none, and reads as the create dialog's defaults. */
  const engagement = rules.isEngagement(type);
  const isSurvey = type === 'survey';
  const seeded = rules.settingsFor(type, editing ? item.settings : {});
  const [options, setOptions] = useState(() => ({
    anonymousResponses: seeded.anonymousResponses !== false,
    randomizeQuestions: seeded.randomizeQuestions !== false,
    names: seeded.names || NAMES_DEFAULT,
    target: seeded.target === undefined ? null : seeded.target,
    personaId: seeded.personaId || '',
    promptId: seeded.promptId || '',
    aiContext: seeded.aiContext || '',
    eventDetails: seeded.eventDetails || '',
  }));
  const [chosenCats, setChosenCats] = useState(() => new Set(seeded.categoryIds || []));
  const [briefing, setBriefing] = useState(seeded.briefing || null);
  const [briefingWorking, setBriefingWorking] = useState(false);
  const [namesTouched, setNamesTouched] = useState(editing);
  const [personas, setPersonas] = useState([]);
  const [categories, setCategories] = useState([]);
```

(d) Below `  const chosen = candidates.find((s) => keyOf(s) === setKey) || null;` add:

```js

  /* The set the options are about: the one chosen in the picker, or the one
     an edited item pins. Its size bounds the goal — the pinned version's own
     count on an edit (event-store.describeSet), the picked version's on an add. */
  const optionsSet = editing
    ? (item.setRef ? { setId: item.setRef.setId, scope: item.setRef.scope || 'platform' } : null)
    : (chosen ? { setId: chosen.id, scope: chosen.scope || 'platform' } : null);
  const questionCount = editing
    ? Number(item.set && item.set.questionCount) || 0
    : Number(chosen && chosen.questionCount) || 0;
  const setPromptId = editing
    ? ((sets.find((s) => item.setRef && s.id === item.setRef.setId && (s.scope || 'platform') === (item.setRef.scope || 'platform')) || {}).promptId || '')
    : ((chosen && chosen.promptId) || '');
  const showOptions = engagement && !unreadable && Boolean(optionsSet);
  const optionsKey = optionsSet ? `${optionsSet.scope}|${optionsSet.setId}` : '';
  const goalProblem = engagement && !isSurvey
    ? (goalRules.checkTarget(options.target, questionCount).error || '')
    : '';

  useEffect(() => {
    if (!engagement) return undefined;
    let live = true;
    listPersonas(type).then((list) => { if (live) setPersonas(list); });
    return () => { live = false; };
  }, [engagement, type]);

  useEffect(() => {
    if (!optionsSet || isSurvey) return undefined;
    let live = true;
    listSetCategories(optionsSet.setId, optionsSet.scope).then((list) => { if (live) setCategories(list); });
    return () => { live = false; };
  }, [optionsKey, isSurvey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The settings this item stores: only the keys its format has. */
  const settingsNow = () => rules.settingsFor(type, {
    ...options,
    categoryIds: Array.from(chosenCats),
    briefing: briefing && briefing.text && briefing.text.trim() ? briefing : null,
  });
  const [settingsBaseline] = useState(() => JSON.stringify(settingsNow()));
  const toggleCategory = (name) => setChosenCats((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const changeOptions = (patch) => {
    if ('names' in patch) setNamesTouched(true);
    setOptions((prev) => ({ ...prev, ...patch }));
  };
```

(e) Replace Task 10's

```js
  const dirty = title !== baseline.title || minutes !== baseline.minutes || description !== baseline.description
    || ledBy !== baseline.ledBy || after !== baseline.after || setKey !== baseline.setKey;
```

with

```js
  const dirty = title !== baseline.title || minutes !== baseline.minutes || description !== baseline.description
    || ledBy !== baseline.ledBy || after !== baseline.after || setKey !== baseline.setKey
    || (engagement && JSON.stringify(settingsNow()) !== settingsBaseline) || briefingWorking;
```

(f) Replace

```js
  const choose = (s) => {
    setSetKey(keyOf(s));
    if (!titleTouched) setTitle(s.name || '');
  };
```

with

```js
  const choose = (s) => {
    const changed = keyOf(s) !== setKey;
    setSetKey(keyOf(s));
    if (!titleTouched) setTitle(s.name || '');
    if (changed) {
      // A different set has different categories; its goal bound moves too.
      setChosenCats(new Set());
      setCategories([]);
      // A survey set may carry its own Names default — it seeds the choice
      // until the host picks, as the create dialog does.
      if (isSurvey && !namesTouched) {
        setOptions((prev) => ({ ...prev, names: namesMode(s.namesDefault).id }));
      }
    }
  };
```

(g) In `submit`, replace Task 10's

```js
    const leader = rules.checkLedBy(ledBy, type);
    if (leader.error) {
      setError(leader.error);
      return;
    }
    let position = null;
```

with

```js
    const leader = rules.checkLedBy(ledBy, type);
    if (leader.error) {
      setError(leader.error);
      return;
    }
    if (goalProblem) {
      setError(goalProblem);
      return;
    }
    const settings = engagement ? { settings: settingsNow() } : {};
    let position = null;
```

replace

```js
        await updateItem(code, item.itemId, { ...checked.value, ...(leads ? { ledBy: leader.value } : {}) });
```

with

```js
        await updateItem(code, item.itemId, {
          ...checked.value, ...(leads ? { ledBy: leader.value } : {}), ...settings,
        });
```

and at the end of the `addItem` call replace

```js
              version: chosen.activeVersion === undefined ? null : chosen.activeVersion,
            },
          } : {}),
        });
```

with

```js
              version: chosen.activeVersion === undefined ? null : chosen.activeVersion,
            },
          } : {}),
          ...settings,
        });
```

(h) Below the hint paragraph (Task 10's, ending `{type === rules.PRESENTATION && ' A PDF copy for attendees comes later.'}` and `</p>`), inside the `{!unreadable && (<>…</>)}` fragment, replace

```jsx
            {type === rules.PRESENTATION && ' A PDF copy for attendees comes later.'}
          </p>
          </>)}
```

with

```jsx
            {type === rules.PRESENTATION && ' A PDF copy for attendees comes later.'}
          </p>
          {showOptions && (
            /* THE CREATE DIALOG'S OWN OPTIONS, never a copy
               (components/SessionOptions.jsx), in the `.gsd` scope whose
               tokens they wear — the same dusk card and field this dialog's
               surface is (sessionOptionsPalette.test.js). */
            <div className="gsd evb-sopts" data-testid="item-session-options">
              {!isSurvey && categories.length > 0 && (
                <SessionCategories
                  idPrefix="evb-so"
                  categories={categories}
                  selected={chosenCats}
                  onToggle={toggleCategory}
                />
              )}
              {type === 'call-and-answer' && (
                <SessionBriefing value={briefing} onChange={setBriefing} onWorkingChange={setBriefingWorking} />
              )}
              <SessionOptions
                idPrefix="evb-so"
                gameType={type}
                value={options}
                onChange={changeOptions}
                personas={personas}
                setPromptId={setPromptId}
                namesDefault={!editing && chosen ? chosen.namesDefault : ''}
                questionCount={questionCount}
              />
            </div>
          )}
          </>)}
```

(i) The submit button waits for a briefing still being drafted. Replace

```jsx
                <button type="submit" className="evb-btn evb-btn--primary" disabled={busy}>
```

with

```jsx
                <button
                  type="submit"
                  className="evb-btn evb-btn--primary"
                  disabled={busy || briefingWorking}
                  title={briefingWorking ? 'Waiting for Workie to finish the briefing' : undefined}
                >
```

- [ ] **Step 5: Place the block — `EventBuilder.css`**

Below the line `.evb-modal--wide { width: min(940px, 100%); }` add:

```css
/* An engagement's session options (events M1b): the create dialog's own block
   (SessionOptions.jsx), styled by its sheet under the `.gsd` scope it carries;
   this only places it under the item's own fields. */
.evb-sopts { margin-top: 16px; }
```

- [ ] **Step 6: Run them, with every suite the dialog touches**

Run: `cd src && npm test -- eventItemSettings sessionSetupApi sessionOptionsPalette eventItemDialog eventItemKinds eventBuilder gameSetupPalette sessionOptions.test`
Expected: `Test Suites: 9 passed` (the options are still drawn by `SessionOptions.jsx` alone, so `sessionOptions.test.jsx`'s single-copy check stays green).

Run: `cd src && npx eslint src/components/EventItemDialog.jsx src/utils/sessionSetupApi.js`
Expected: no output.

- [ ] **Step 7: Full frontend suite, lint, build, backend loop; commit**

```bash
git add src/src/utils/sessionSetupApi.js src/src/components/EventItemDialog.jsx src/src/components/EventBuilder.css src/src/__tests__/eventItemDialog.test.jsx src/src/__tests__/sessionOptionsPalette.test.js src/src/__tests__/eventItemSettings.test.jsx src/src/__tests__/sessionSetupApi.test.js
git commit -m "An engagement on the agenda offers every option the create dialog offers

Owner, 26 Sep: \"all of the options that you get when setting up each
engagement\". Once its set is chosen, the item dialog renders the create
dialog's own SessionCategories, SessionBriefing and SessionOptions (with the
Goal), never a copy, and sends what they say as settings — only the keys the
format has. The goal is bounded by the pinned version; Add waits for a
briefing still being drafted. The voices and categories come from the two
existing routes, through utils/sessionSetupApi.js. eventItemSettings,
sessionSetupApi, sessionOptionsPalette; eventItemDialog's payloads now carry
the untouched defaults.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: The builder — the full add menu, the 16-item cap said where you add, and rows that name the leader and the goal

The add menu offers Presentation (under Talks) and Activity (under Just on the agenda) below the caps. At 16 items every counted kind is closed, `aria-disabled` with the items sentence at the top of the menu, and Break alone stays open; at 8 engagements only the engagement kinds close, and the note says presentations and activities still fit. Each row's source line leads with who leads the item and says an engagement's goal against the pinned size ("5 of 50 questions"). "Use vN" that reset a narrowed category list says so.

Screens: `02-builder.html` (the menu's three groups; a talk's row, "Marcus Oyelaran · …"), `02b-cap-reached.html` (the cap's reason above the kinds it closes, Break open).

**Files:**
- Modify: `src/src/components/EventBuilder.jsx`
- Modify: `src/src/__tests__/eventBuilder.test.jsx` (Task 7's menu test becomes the full menu's)
- Create: `src/src/__tests__/eventBuilderKinds.test.jsx`

**Interfaces:**
- Consumes: `PRESENTATION`, `CUSTOM`, `TYPE_LABELS`, `CAP_SENTENCES` (Task 8); the item projection's `ledBy` (Task 8) and `settings.target` (Task 9); `PUT …/items/{itemId}`'s `categoriesReset` and `goal_over` (Task 9); the item dialog's new kinds (Task 10).
- Produces: menu items named `Presentation` and `Activity`; `TYPE_ICONS.custom = 'UsersThree'`; the row source line `[ledBy · ]<set> · vN · <goal of N | N> questions`.

- [ ] **Step 1: Write the failing tests**

Create `src/src/__tests__/eventBuilderKinds.test.jsx`:

```jsx
/**
 * THE BUILDER WITH EVERY KIND — components/EventBuilder.jsx (02, 02b; events
 * M1b Task 12): the add menu with presentations and activities, the 16-item
 * cap said where you add, the rows that name who leads each item and an
 * engagement's goal, and "Use vN" that had to reset a category list.
 *
 * rejects: a counted kind left open at 16 items, or closed without its
 * reason; Break closed by a cap that does not count it; presentations and
 * activities closed by the engagement cap; a row that hides its leader or
 * its goal; a category reset nobody is told about.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EventBuilder from '../components/EventBuilder';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';

jest.mock('../utils/eventsApi', () => ({
  deleteEvent: jest.fn(),
  getEvent: jest.fn(),
  reorderItems: jest.fn(),
  updateItem: jest.fn(),
  addItem: jest.fn(),
  removeItem: jest.fn(),
  createEvent: jest.fn(),
  updateEvent: jest.fn(),
}));
jest.mock('../utils/sessionSetupApi', () => ({
  listPersonas: jest.fn(async () => []),
  listSetCategories: jest.fn(async () => []),
}));
const api = require('../utils/eventsApi');

const EVENT = {
  code: '5307', title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: '2026-10-09T09:00',
  timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 0, engagementCount: 0, breakCount: 0,
  attendeeReports: 'full',
};
const eng = (n, extra = {}) => ({
  itemId: `it_000000${String(n).padStart(2, '0')}`, order: n, type: 'trivia', title: `Quiz ${n}`, description: '', ledBy: '',
  minutes: 10, state: 'planned', setRef: { scope: 'org', orgId: 'org_nw', setId: `set${n}`, version: 2 },
  set: { name: `Set ${n}`, questionCount: 50, latestVersion: 2, missing: false }, ...extra,
});
const talk = (n, extra = {}) => ({
  itemId: `it_000000${String(n).padStart(2, '0')}`, order: n, type: 'presentation', title: `Talk ${n}`, description: '',
  ledBy: '', minutes: 20, state: 'planned', ...extra,
});
const serve = (items) => api.getEvent.mockResolvedValue({ event: EVENT, items });
const mount = async () => {
  render(<EventBuilder code="5307" sets={[]} />);
  await waitFor(() => expect(screen.getAllByTestId('agenda-row').length).toBeGreaterThan(0));
};
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /add item/i }));
const item = (name) => screen.getByRole('menuitem', { name: new RegExp(`^${name}`) });
const lines = () => screen.getAllByTestId('agenda-row').map((r) => (r.querySelector('.evb-sub') || {}).textContent || '');

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => false);
  api.updateItem.mockResolvedValue({ item: {} });
});

describe('the caps, said where you add', () => {
  it('at 16 items every counted kind is closed with the items sentence; Break stays open', async () => {
    serve([...Array.from({ length: 8 }, (_, i) => eng(i + 1)), ...Array.from({ length: 8 }, (_, i) => talk(i + 9))]);
    await mount();
    openMenu();
    const reason = document.getElementById('evb-capwhy');
    expect(reason).toHaveTextContent(rules.CAP_SENTENCES.items);
    expect(reason).toHaveTextContent('Breaks can still be added.');
    for (const name of ['Trivia', 'Survey', 'Presentation', 'Activity']) {
      expect(item(name)).toHaveAttribute('aria-disabled', 'true');
      expect(item(name)).toHaveAttribute('aria-describedby', 'evb-capwhy');
    }
    expect(item('Break')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(item('Presentation'));
    expect(screen.queryByRole('heading', { name: 'Add a presentation' })).toBeNull();
  });

  it('at 8 engagements the note says presentations and activities still fit, and they stay open', async () => {
    serve(Array.from({ length: 8 }, (_, i) => eng(i + 1)));
    await mount();
    openMenu();
    expect(document.getElementById('evb-capwhy')).toHaveTextContent('Presentations and activities still fit.');
    expect(item('Poll')).toHaveAttribute('aria-disabled', 'true');
    expect(item('Presentation')).not.toHaveAttribute('aria-disabled');
    expect(item('Activity')).not.toHaveAttribute('aria-disabled');
  });
});

describe('the rows', () => {
  it('lead with who leads the item, and an engagement says its goal against the pinned size', async () => {
    serve([
      eng(1, { ledBy: 'Priya Raman', settings: { target: 5 } }),
      eng(2),
      talk(3, { ledBy: 'Marcus Oyelaran' }),
      { itemId: 'it_00000004', order: 4, type: 'custom', title: 'Lunch', description: '', ledBy: '', minutes: 45, state: 'planned' },
    ]);
    await mount();
    expect(lines()).toEqual([
      'Priya Raman · Set 1 · v2 · 5 of 50 questions',
      'Set 2 · v2 · 50 questions',
      'Marcus Oyelaran',
      '',
    ]);
    expect(screen.getAllByTestId('agenda-row')[3]).toHaveTextContent('Activity');
  });
});

describe('"Use vN" and the categories', () => {
  it('a version change that reset a narrowed category list says so', async () => {
    serve([eng(1, { setRef: { scope: 'org', orgId: 'org_nw', setId: 'set1', version: 1 }, set: { name: 'Set 1', questionCount: 50, latestVersion: 2, missing: false } })]);
    api.updateItem.mockResolvedValue({ item: {}, categoriesReset: true });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Use v2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('v2 is in use, with every category on. Open the item to narrow them again.');
  });

  it('a goal the new version cannot meet is refused in the server\'s words', async () => {
    serve([eng(1, { setRef: { scope: 'org', orgId: 'org_nw', setId: 'set1', version: 1 }, set: { name: 'Set 1', questionCount: 50, latestVersion: 2, missing: false } })]);
    api.updateItem.mockRejectedValue(Object.assign(
      new Error('Your goal of 40 is more than v2’s 30 questions. Lower the goal, then use v2.'),
      { status: 400, body: { code: 'goal_over' } },
    ));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Use v2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your goal of 40 is more than v2’s 30 questions.');
  });
});
```

In `src/src/__tests__/eventBuilder.test.jsx`, replace Task 7's test

```jsx
  it('Presentation is listed, aria-disabled, and says it is coming; Survey opens its dialog', async () => {
    serve(DAY.slice(0, 3));
    await mount();
    openMenu();
    expect(item('Presentation')).toHaveAttribute('aria-disabled', 'true');
    expect(item('Presentation')).not.toBeDisabled();
    expect(item('Presentation')).toHaveTextContent('Coming soon.');
    expect(item('Survey')).not.toHaveAttribute('aria-disabled');
    expect(item('Survey')).not.toHaveTextContent('Coming soon.');
    fireEvent.click(item('Survey'));
    expect(screen.getByRole('heading', { name: 'Add Survey' })).toBeInTheDocument();
  });
```

with

```jsx
  it('Survey, Presentation and Activity each open their dialog below the caps', async () => {
    serve(DAY.slice(0, 3));
    await mount();
    for (const [name, heading] of [['Survey', 'Add Survey'], ['Presentation', 'Add a presentation'], ['Activity', 'Add an activity']]) {
      openMenu();
      expect(item(name)).not.toHaveAttribute('aria-disabled');
      expect(item(name)).not.toHaveTextContent('Coming soon');
      fireEvent.click(item(name));
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    }
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd src && npm test -- eventBuilderKinds eventBuilder.test`
Expected: FAIL — no menu item named "Activity"; Presentation is `aria-disabled`; the rows lack the leader and the goal; "Use v2" says nothing about the categories.

- [ ] **Step 3: The builder — `EventBuilder.jsx`**

(a) In the header, replace Task 7's

```js
 *     still announced; Break stays open. Every engagement kind, survey
 *     included, is offered below the caps (events M1b). Presentation is
 *     `aria-disabled`, "Coming soon", until its dialog lands. Activating an
 *     aria-disabled item does nothing.
```

with

```js
 *     still announced; Break stays open. Every engagement kind, survey
 *     included, is offered below the caps (events M1b). A presentation and an
 *     activity are counted items: at 16 items every counted kind is
 *     aria-disabled with the items sentence at the top of the menu, and Break
 *     alone stays open; at 8 engagements only the engagement kinds close, and
 *     the note says presentations and activities still fit. Activating an
 *     aria-disabled item does nothing.
 *   - Each row's source line leads with who leads it (02 draws a talk's
 *     "Marcus Oyelaran · …"), and an engagement with a goal says "5 of 50
 *     questions". "Use vN" that had to turn a narrowed category list back to
 *     every category says so.
```

(b) In `TYPE_ICONS`, replace

```js
  presentation: 'Monitor',
  break: 'Clock',
};
```

with

```js
  presentation: 'Monitor',
  custom: 'UsersThree',
  break: 'Clock',
};
```

(c) Replace the whole `sourceLine` function with:

```js
function sourceLine(item, until) {
  if (item.type === rules.BREAK) return { text: `Back at ${until} · not counted, not billed`, bad: false };
  // Who leads it comes first, as 02 draws a talk's line (events M1b).
  const lead = (text, bad = false) => ({ text: [item.ledBy, text].filter(Boolean).join(' · '), bad });
  if (!item.set) return lead('');
  if (item.set.missing) return lead('This question set is no longer available', true);
  const version = item.setRef && item.setRef.version ? ` · v${item.setRef.version}` : '';
  // The pinned version was deleted from the set (final review M1). Its count
  // would be a guess, so the line says what happened instead.
  if (item.set.pinnedMissing) return lead(`${item.set.name || 'Question set'}${version} is no longer in the set`, true);
  // A goal reads against the pinned version's size: "5 of 50 questions".
  const goal = item.settings && item.settings.target;
  const size = goal ? `${goal} of ${item.set.questionCount} questions` : `${item.set.questionCount} questions`;
  return lead(`${item.set.name || 'Question set'}${version} · ${size}`);
}
```

(d) In `pinLatest`, replace

```js
    try {
      await updateItem(code, item.itemId, { version: item.set.latestVersion });
      await load();
    } catch (err) {
```

with

```js
    try {
      const saved = await updateItem(code, item.itemId, { version: item.set.latestVersion });
      await load();
      // A narrowed category list does not survive a version change; the
      // server reset it to every category (events M1b), and the host is told.
      if (stillCurrent(forCode) && saved && saved.categoriesReset) {
        setError(`v${item.set.latestVersion} is in use, with every category on. Open the item to narrow them again.`);
      }
    } catch (err) {
```

(A refused "Use vN" — `goal_over` — already reaches the host: the existing `catch` reloads and shows the server's sentence.)

(e) Replace

```jsx
  const openAdd = (type) => {
    setMenuOpen(false);
    setDialog({ mode: 'add', type });
  };
```

with

```jsx
  const openAdd = (type) => {
    setMenuOpen(false);
    setDialog({ mode: 'add', type });
  };
  /* A counted kind that is not an engagement — a presentation or an activity.
     Only the 16-item cap closes it (events M1b). */
  const countedKind = (type, sentence) => (
    <button
      type="button"
      role="menuitem"
      className="evb-menu-item"
      aria-disabled={itemsFull ? 'true' : undefined}
      aria-describedby={itemsFull ? 'evb-capwhy' : undefined}
      onClick={() => { if (itemsFull) return; openAdd(type); }}
    >
      <Icon name={TYPE_ICONS[type]} weight="bold" size={17} color="var(--primary)" />
      <div>
        <b>{rules.TYPE_LABELS[type]}</b>
        <span>{itemsFull ? '' : sentence}</span>
      </div>
    </button>
  );
```

(f) The cap's reason. Replace

```jsx
              <div className="evb-menu" role="menu" aria-label="Add to the agenda">
                <h6 className="evb-menu-h">Answered by the room{engagementsFull ? ` · ${counts.engagements} of ${rules.MAX_ENGAGEMENTS}` : ''}</h6>
                {engagementReason && (
                  <p className="evb-capnote" id="evb-capwhy">
                    <b>{engagementReason.split('. ')[0]}.</b> {engagementReason.split('. ').slice(1).join('. ')}
                    {!breaksFull && ' Breaks can still be added.'}
                  </p>
                )}
```

with

```jsx
              <div className="evb-menu" role="menu" aria-label="Add to the agenda">
                {/* THE CAP, SAID WHERE YOU ADD (02b; events M1b). At 16 items
                    it closes every counted kind, so its reason leads the menu;
                    at 8 engagements it closes only those, and sits with them. */}
                {itemsFull && (
                  <p className="evb-capnote" id="evb-capwhy">
                    <b>{engagementReason.split('. ')[0]}.</b> {engagementReason.split('. ').slice(1).join('. ')}
                    {!breaksFull && ' Breaks can still be added.'}
                  </p>
                )}
                <h6 className="evb-menu-h">Answered by the room{engagementsFull ? ` · ${counts.engagements} of ${rules.MAX_ENGAGEMENTS}` : ''}</h6>
                {!itemsFull && engagementReason && (
                  <p className="evb-capnote" id="evb-capwhy">
                    <b>{engagementReason.split('. ')[0]}.</b> {engagementReason.split('. ').slice(1).join('. ')}
                    {' Presentations and activities still fit.'}
                    {!breaksFull && ' Breaks can still be added.'}
                  </p>
                )}
```

(`engagementReason` is already the items sentence at 16 items and the engagements sentence at 8.)

(g) Presentation and Activity. Replace

```jsx
                <h6 className="evb-menu-h">Talks</h6>
                <button type="button" role="menuitem" className="evb-menu-item" aria-disabled="true">
                  <Icon name={TYPE_ICONS.presentation} weight="bold" size={17} color="var(--primary)" />
                  <div>
                    <b>Presentation</b>
                    <span>Coming soon. A talk from the presenter’s own screen, with an optional PDF copy for attendees.</span>
                  </div>
                </button>
                <hr className="evb-menu-rule" />
                <h6 className="evb-menu-h">Just on the agenda</h6>
```

with

```jsx
                <h6 className="evb-menu-h">Talks</h6>
                {countedKind(rules.PRESENTATION, 'A talk from the presenter’s own screen. A PDF copy for attendees comes later.')}
                <hr className="evb-menu-rule" />
                <h6 className="evb-menu-h">Just on the agenda</h6>
                {countedKind(rules.CUSTOM, 'Anything else on the day: networking, lunch with a speaker, an open discussion.')}
```

The Break item below stays exactly as it is.

- [ ] **Step 4: Run them, with every builder and item suite**

Run: `cd src && npm test -- eventBuilder eventItem`
Expected: `Test Suites: 6 passed` (`eventBuilder.test`, `eventBuilderPalette`, `eventBuilderKinds`, `eventItemDialog`, `eventItemKinds`, `eventItemSettings`).

- [ ] **Step 5: The full gate; commit**

Run the backend loop, `cd src && npm test`, `cd src && npm run lint` and `cd src && npm run build`. Expected: the backend loop at the baseline plus four suites with `fail=0`; the frontend suite at the baseline plus fourteen suites, all passing, `Snapshots: 7 passed`; lint 0 errors and no new warning; the build passing.

```bash
git add src/src/components/EventBuilder.jsx src/src/__tests__/eventBuilder.test.jsx src/src/__tests__/eventBuilderKinds.test.jsx
git commit -m "The agenda builder offers presentations and activities, says the 16-item cap where you add, and names each item's leader and goal

The add menu offers Presentation and Activity below the caps. At 16 items
every counted kind is closed with the items sentence leading the menu and
Break stays open; at 8 engagements the note says presentations and activities
still fit. A row leads with who leads it and an engagement says \"5 of 50
questions\"; \"Use vN\" that reset a narrowed category list says so.
eventBuilderKinds.test.jsx; eventBuilder.test.jsx's menu test covers all three
new kinds.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Landing M1b on dev (after Task 12, per roadmap §4)

1. **One integration branch.** Merge the task branches in order. Resolve nothing by hand in `tenant-crypto.js` or `session-goal.js`: re-copy the source copy (`game/tenant-crypto.js`, `websocket/session-goal.js`) over the others and let `tests/tenant-crypto.js` §8 and `tests/session-goal.js` §4 judge. If `gameSetupDialogDom.test.jsx.snap` conflicts, keep Task 4's version and re-run `gameSetupDialogDom` without `-u`.
2. **The full gate** on the integration branch: the backend loop `fail=0` (its suite count is the baseline plus `session-goal`, `session-goal-routes`, `event-item-kinds` and `event-item-settings`), `cd src && npm test` green (the baseline plus fourteen suites), `npm run lint` 0 errors and no new warning, `npm run build` passing.
3. **Push `dev`** (the branch, never a tag as well). Watch `engagecicd-pipeline-dev` to green (`AWS_PROFILE=adminaccess`); name the commit and the tier in the handoff.
4. **Walk it on https://engage.dev.seibtribe.us** at 1280 wide (and once at 768), signed in to a Team-plan space, with screenshots in the handoff:
   - the event from the owner's first try (1124): add a survey item from a survey set; add a presentation naming its presenter; add an activity ("Lunch with the speakers"); name a facilitator on an engagement; open an engagement, open Advanced, set a goal of 5 and a category, save — the row says "Name · Set · vN · 5 of N questions";
   - fill the agenda to 16 counted items and open the menu (every counted kind closed with the reason, Break open);
   - press "Use vN" on an item whose goal the new version cannot meet (the sentence), and on one with narrowed categories (the reset notice);
   - `curl https://ouv6fztlig.execute-api.us-east-1.amazonaws.com/dev/events/<code>/agenda` without a token: every item has `ledBy`, none has `settings`;
   - a hand-made session: create a trivia session with a goal of 3, start it, play to round 3's results — the dock says "That's your 3. Keep going if there's time, or end the session.", Next still works, and the SESSION panel's Questions tab says "Question 3 of 3" then "Question 4 · your goal was 3"; open the remote on a phone-width pane and see the same; reload the stage mid-round and the goal is still there.
5. **Not done until walked** (roadmap §4). Fix what the walk finds with a maker/checker pair before calling M1b landed.

---

## Self-Review

**1. Spec coverage — the owner's words and the rulings**

| Requirement | Where |
|---|---|
| "Survey should work today" — survey items, survey sets, counted as engagements (ruling 1) | Task 7 (rules, server, menu); Task 9 (a survey's options: Names, no goal); Task 11 (its dialog) |
| "presentations for now could be just placeholders" — title, presenter, length, description; no upload; PDF line; 16 not 8 (ruling 2) | Task 8 (server, cap), Task 10 (04's form, the PDF line), Task 12 (menu) |
| "a custom choice" — `custom`/"Activity", title, optional Led by, length, description; 16 not 8 (ruling 3) | Task 8, Task 10, Task 12; Decisions (the name) |
| "enter the facilitator/speaker/presenter" — Led by on every non-break item, labelled per kind, on the builder row and the public agenda, sealed in all three copies (ruling 4) | Task 8 (`LedBy`, `checkLedBy`, crypto, `get-agenda` `ledBy`), Task 10 (the field), Task 12 (the row) |
| "change the title of the session" — the item's title names the child session, said at the field (ruling 5) | the mapping table; Task 9 (`sessionFormOf` → `eventTitle`, pinned by `itemSessionMapping.test.js`); Task 10 (the hint) |
| "all of the options that you get when setting up each engagement" — one shared component, GameSetupDialog unchanged; a settings map checked with create's rules; the explicit mapping (ruling 6) | Task 3 (extraction, DOM snapshot, unedited suites), Task 9 (`item-settings.js`, `Settings`, mapping test), Task 11 (the dialog), the mapping table |
| "a target number of items … alert … could do extra" — the goal on items and on sessions, METADATA `Target`, PUT pre-start, the non-blocking notice on the stage and the remote, host-only progress, none for a survey, M3 feeds it (ruling 7) | Task 1 (rule, words), Task 2 (create/PUT/doors), Task 4 (create dialog), Task 5 (stage), Task 6 (remote), Task 9 (item goal, "Use vN"), Task 11 (item dialog), Task 12 (row); the mapping table's `target` row |
| Caps — the 16-item cap bites, said where you add; breaks uncounted (ruling 8) | Task 8 (server refuses the 17th presentation), Task 12 (menu) |
| No new Lambda functions (ruling 9) | Global Constraints; the routes delta (existing routes only); `template-clean.yaml` untouched |
| Design (ruling 10) | Task 3 (reused component), Task 4 (Goal field, palette), Task 6 (`.hr-goal`), Task 10 (03/04), Task 11 (`.gsd` wrapper, palette), Task 12 (02/02b) |
| Out of scope: running an event (M2/M3); client-local toggles; M5's upload | not built; Decisions |

**2. Placeholder scan.** Searched for "TBD", "TODO", "implement later", "fill in", "appropriate", "similar to Task", "as above", "etc." in steps: none. Every new file is written out whole; every edit is an exact replace or an insertion anchored on quoted text; every run step names its command and expected output. Line numbers appear only as `~` guides.

**3. Name consistency.** `goalRules` (the default import of `lambda-functions/websocket/session-goal.js`) in `createGame.js`, `SessionOptions.jsx`, `GameSetupDialog.jsx`, `GameHostPage.jsx`, `hostRemote.js`, `EventItemDialog.jsx`; `checkTarget`, `questionCountAt`, `goalApplies`, `goalProgress`, `goalReachedLine` (Task 1) → Tasks 2, 4–6, 9, 11. `target` is the key everywhere a goal travels (payload, bodies, `Settings`, host-details, host-state's top level); `Target` is the METADATA attribute; `sessionTarget` the page's state. `settingKeysFor`, `settingsFor`, `sessionFormOf`, `SETTING_DEFAULTS`, `SETTING_KEYS` (Task 9) → Task 11 and `item-settings.js`. `checkLedBy`, `hasLeader`, `ledByLabel`, `LED_BY_MAX`, `CUSTOM` (Task 8) → Tasks 10, 12. `SessionOptions`/`SessionCategories`/`SessionBriefing` props (Task 3; `target`/`questionCount` added in Task 4) match every caller. Test ids used by tests exist in the components: `gsd-adv-summary`, `goal-progress`, `remote-goal`, `remote-goal-reached`, `item-session-options`, `set-row`, `agenda-row`, `agenda-at`.

**4. Review Focus coverage.** (1) "Use vN" under a goal — Task 9 §3 (`goal_over`, `categoriesReset`), Task 12 (both said in the builder). (2) A goal typed wrong — Task 1 §1, Task 2 §1–§2, Task 4 (`gameSetupGoal`), Task 9 §2, Task 11 (`eventItemSettings`). (3) Past the goal — Task 1 §3, Task 5 (`hostControlsGoal`, `stageGoalWiring`'s rail check), Task 6. (4) A reload — Task 2 §3–§4 (host doors carry it, public `/state` never), Task 5 (`stageGoalWiring` restore), Task 6 (the remote reads host-state's top level). (5) Old and unreadable rows — Task 8 §3 (no `LedBy`, an unopenable name), Task 9 §3–§4 (no `Settings`, unopenable options).

**Verified in a scratch copy.** Every task's code and tests were applied, in order, to a scratch copy of this worktree at `8abe3d83` and run: after each task, its new suites and the existing suites it names passed (the failures each Step 2 predicts follow from code that step has not yet written; they were observed for Tasks 2 and 4, and Task 5's first draft broke `hostControls.test.js` and `hostPanelRemoteQr.test.js`, which is why its steps now place `goalLine` above `notesPage` and `goal={goal}` after `remoteUrl`); the recorded create-dialog snapshot matched unchanged after Task 3 and changed only by the Goal field in Task 4; at the end the backend loop was green but for two suites that fail for reasons outside this plan (`no-retired-twin-references.js` needs a git checkout, which the scratch copy was not; `verify-question-set-ui.spec.js` fails on this worktree untouched), the frontend suite was 386 suites / 9,387 tests green with 7 snapshots, and lint was 0 errors with the baseline's 10 warnings.
