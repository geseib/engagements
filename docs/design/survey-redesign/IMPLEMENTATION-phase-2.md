# Surveys — Phase 2 implementation plan (started 2026-09-23; Phase 1 is on test at 1f8dd04b)

> Drafted 2026-09-23 by a read-only planning pass over `working/survey-phase-0-1`;
> re-based on `origin/dev` 945c55e3 the same day (branch `working/survey-phase-2`).
> Two facts dev added since the draft, both folded in below:
> - **Billing**: `websocket/session-count.js` bills a session at its second
>   answered question, called only from `message.js:551`, and
>   `tests/billable-session-wiring.js:618-633` holds it the ONLY caller of
>   `recordBillableSession`. A survey PUT must call a guarded-identical `game/`
>   copy (`game/usage.js` already exists), and that test widens to both copies.
> - **Platform metrics**: answers are counted per round when next-question moves
>   the room on (`recordRoundClosed`, `game/platform-metrics.js:395`, called at
>   `next-question.js:1090`), by counting `QUESTION#nnn#ANSWER#` rows. A survey
>   has no rounds and never calls next-question, so it needs its own two
>   recorders (Track A, "Metrics" below) or it is invisible on the console.
> Test-first throughout (superpowers:test-driven-development). Never write either
> deploy phrase `tests/no-retired-twin-references.js` bans.

**Goal:** a host opens a survey session; people answer the five kinds on their
phones at their own pace, autosaved per answer; the wall shows the join block,
finished-of-joined and per-question progress; the host closes it (counts freeze
into `SURVEY#RESULTS`) and ends it. **Names** decides what is written and locks
when the survey opens. Results rendering is Phase 3; polls are Phase 6.

**Architecture:** a survey is a session with no rounds. STATE goes
`CREATED → SURVEY#OPEN → SURVEY#CLOSED → ENDED` and never touches
`ASK#`/`VOTE#`/`RESULTS#` or `next-question.js`. Phones write one encrypted row
per person (`SURVEY#RESP#<respondent>`) through a public player handler modelled
on `comments.js`; host routes use the Cognito authorizer + `callerMayDriveSession`.
One pure function (`game/survey-aggregate.js`) turns rows into `SURVEY#RESULTS`.

## 1. Findings the design rests on (file:line at the time of drafting)

- **Create** — `create-game.js:91` whitelist (a new field = destructure +
  `createGame()` arg `:195-228` + METADATA item `schema-compliant-manager.js:182-239`).
  Pin `{scope,setId,version}` (`:78-92`), read via `gameSetRef` (`set-version.js:482-489`).
  STATE `CREATED` (`:242-257`); shuffled category ORDER rows by default (`:402-417`).
- **Start** — `startSession` (`session-start.js:45-121`) is the only writer of the
  started TTL; STATE `STARTED`+`StartedAt` (`:50-68`); METADATA `Started`,
  `LastPlayedAt` (`:78-92`) — no start stamp on METADATA. `start-game.js:55-65`
  only from `CREATED`. `session-gate.js:57-69` refuses joins before `Started`.
- **Advance** — `next-question.js:799-816` accepts `CREATED`/`STARTED`/`ASK#`/
  `VOTE#`/`RESULTS#`, and **`action:'skip'` bypasses the check**; from `CREATED`
  it would serve `ASK#001` of a survey set. `ENDED` is written only when questions
  run out (`:1073-1113`); nothing emits `gameEnded` though both pages handle it
  (`GameHostPage.jsx:2031`, `PlayerPage.jsx:821`).
- **Host** — `phaseOfGameState` (`hostControls.js:159-165`): unknown → `LOBBY`;
  `ENDED` special-cased at `GameHostPage.jsx:5049-5051`. `HOST_PHASES`
  (`hostControls.js:52`) drives `hostControlsFor` (`:402`), exactly one primary.
  Survey still runs VOTE because `TYPES_THAT_SKIP_VOTE` is only trivia/wavelength
  (`:137`), which also makes `anonymityApplies('survey')` true (`anonymity.js:19-21`).
- **Player auth** — `comments.js:14-45`: player routes public, no identity; gate =
  "the room is doing this now" → 409 on wrong state (`:283-296`); org from METADATA
  (`:330-333`). Host routes `claims && callerMayDriveSession` (`:531-536`) — which
  lets an unauthenticated caller through (`tenant.js:323-330`), so the authorizer
  must be on the route. Real player proof: per-browser `clientId`
  (`playerClient_<game>`, `joinResult.js:20`) stamped `ClientId` on
  `PLAYER#<name>` (`join-game.js:80-89,185`).
- **Authorizer** — `requiredGroupsForRoute('GET','games/{gameId}/survey/people')`
  → `[]` ("GET + games is public", `authorizer.js:600-603`): a host-only GET needs
  an explicit rule. CORS already allows PUT (`template-clean.yaml:686`).
- **Encryption** — `encryptItem` whole top-level fields; `encryptValue`
  JSON-serialises maps (`tenant-crypto.js:563-589,628-639`), as `Votes` (`:261`).
  3 copies equal (`tests/tenant-crypto-wiring.js`); entity lists pinned
  (`tests/tenant-crypto.js:129-220`).
- **Broadcasts** — host-only: `ConnectionType = 'HOST'` over ALL host rows
  (`submit-vote.js:160-192`, `message.js:702-719`). Avoid `host-notify.js:45`
  (Items[0] only) and the manager's dead `IsHost` filter
  (`schema-compliant-manager.js:635-639`; `connect.js:37` writes `ConnectionType`).
  To everyone: `get-results.js:96-151`, `comments.js:136-177`.
- **Phone** — render chain ENDED (`PlayerPage.jsx:2494-2530`) → ASK (`:2536`;
  trivia `:2621-2684`; text `:2745-2790`) → lobby. `stateRank` (`:379-397`) ranks
  unknown states -1, so a stale `STARTED` could overwrite `SURVEY#OPEN`.
  `PlayerShell` exported from `PlayerPage.jsx:74`.
- **Stage** — meter dropped `.bar2` on purpose (`styles/stage.css:277-282`);
  `RoomMeter` names only on request (`RoomMeter.jsx:149,164`); lobby join block
  `GameHostPage.jsx:5743-5760`.
- **Create dialog** — `setsForType` (`GameSetupDialog.jsx:212`); pills from
  `PICKER_GAME_TYPES` (`:399`, `gameTypes.js:168`); Responses card `:542-600`,
  shuffle `:602-630`. Create → history modal (`GameHostPage.jsx:4395-4406`); only
  `QuickstartMenu.jsx:121` creates-and-starts.

## 2. THE CONTRACT

### States (STATE.State)
| State | Meaning | Reached by |
|---|---|---|
| `CREATED` | set up; Names editable | create |
| `SURVEY#OPEN` | collecting; phones may write | `POST /start` → `startSession(…, {state:'SURVEY#OPEN'})` |
| `SURVEY#CLOSED` | frozen; results written | `POST /survey/close` |
| `ENDED` | over | `POST /survey/end` |

Not `STARTED`: it would inherit lobby behaviour (`isLobbyState` `hostControls.js:181`
→ set auto-select `GameHostPage.jsx:2767`; remote "Start First Round"
`hostRemote.js:180-182`; next-question accepting `STARTED`). No digits after `#`,
so existing parsers treat them as inert (host restore `/#(\d+)/`
`GameHostPage.jsx:2254`; remote `parseGamePhase` → `UNKNOWN` `hostRemote.js:58-75`;
`get-game-state.js:195` fetches questions only for ASK/VOTE/RESULTS).
**Phase 3 note (deviates from PLAN):** walk-through = a stage page index inside
`SURVEY#CLOSED`, not `RESULTS#nnn` (avoids get-results/close-round semantics).
Host phases: `SURVEY#OPEN → COLLECTING`, `SURVEY#CLOSED → CLOSED` (join `HOST_PHASES`).
Phone `stateRank`: OPEN 1, CLOSED 2, ENDED max.

### METADATA
- `Names`: `'anonymous'|'finished'|'named'` (survey only). Payload `names` → set
  `namesDefault` → `'anonymous'`. Editable via `PUT /games/{id}` only while CREATED,
  conditioned on `attribute_not_exists(OpenedAt)`.
- `OpenedAt`: ISO, written by `startSession` `if_not_exists` = `StartedAt`, every
  session type (Phase 5's share clock anchor).
- `randomizeQuestions` forced `false` for survey.

### Rows
- **`SURVEY#RESP#<respondent>`** — `Answers` (map, encrypted as one field: new
  entity `surveyResponse: ['Answers']` in all 3 tenant-crypto copies), `Answered`
  (plaintext list of qids — live counts without decrypting), `Complete`, `Rev`
  (optimistic lock), `Session` (= METADATA.CreatedAt; guards a reused 4-digit code),
  `ttl = startedTtl(OpenedAt)`. **Named only:** `Name`, `StartedAt`, `CompletedAt`.
  **Anonymous & Who finished: no timestamps** (an `UpdatedAt` would line up with
  `DONE.FinishedAt` and link name to answers — 40-data-model's `UpdatedAt` is dropped
  for those modes).
- **`SURVEY#DONE#<playerName>`** (Who finished only) — `Name`, `Status`
  (`started`→`finished`), `FinishedAt`, `Session`, `ttl`. No respondent id, no progress.
- **`SURVEY#RESULTS`** — `Version:1`, `N`, `Finished`, `PerQuestion`, `Order`,
  `TextPages` (`{qid: pageCount}`, only qids with texts), `orgId`, `Names`,
  `OpenedAt`, `ClosedAt`, `Session`, set ref + version, `ttl = ClosedAt + 30d`.
  Self-contained (METADATA expires at start + 7d first). Written LAST and
  conditionally (`attribute_not_exists(PK) OR Session <> :session`): its
  existence means every page it names was written.
- **`SURVEY#RESULTS#TEXT#<qid>#<page>`** (page `000`, `001`, …) — `Qid`, `Page`,
  `Texts` (encrypted, `surveyResults: ['Texts']`: `[{id,text,v?}]` for that qid —
  open answers, write-ins, whys, ids `<qid>:<k>` continuing across pages in
  order), `orgId`, `Session`, `ttl` = the main item's. Cut at ≤ 256 KB of JSON
  per page (≈ 342 KB sealed), because one item holding every text passes the
  400 KB item limit at a few hundred respondents. A reader fetches exactly the
  keys `TextPages` names (no reader exists until Phase 3).
- **Respondent id** — Anonymous/Who finished: phone mints `r_` + 22 base64url
  (128 bits) under `surveyResp_<gameId>_<openedAt>` — per session, since join codes
  are reused; minted once GET /survey has said `openedAt`; never derived from `clientId`; server
  checks `/^r_[A-Za-z0-9_-]{22}$/`. Named: respondent = player name, server checks
  `PLAYER#<name>.ClientId === clientId` (legacy row without ClientId accepted, like
  join). The server derives the key from `Names`; never trusts a client-sent key.
- **qid** = the question SK without `QUESTION#` (e.g. `c001#003`), validated against
  the pinned partition.

### Answer values
| kind | value | server check |
|---|---|---|
| rating | integer | within scale (`1-5`,`1-10`,`0-10`; `stars`=1–5) |
| choice | `[index…]` or `[index…, {other}]` | distinct, in range, exactly 1 unless `allowMultiple`; ≤ `maxPicks`; `other` only if `allowOther`, ≤280 |
| yesno | `{v:'yes'\|'no'\|'unsure', why?}` | `unsure` only if offered; `why` only when `followUpWhen` matches, ≤280 |
| rank | `[index…]` in order | distinct, in range, length ≥1 |
| text | string | trimmed, ≤ `maxLength` (cap 2000) |
| any | `null` | clears the key |
Indexes are canonical option order; `shuffle` is display-only, seeded by respondent + qid.

### Routes (player: public like `/comments`; host: Cognito + `claims && callerMayDriveSession` → 404)
| method/path | who | body | 200 | errors |
|---|---|---|---|---|
| `GET /games/{id}/survey` | player | — | `{title,state,names,openedAt,warnedAt,questions:[{qid,n,kind,title,detail,required,…}]}` — questions decrypted from the set's org, `title` (the session's, `''` if none) from the session's | 404 not a survey; 409 not started |
| `PUT /games/{id}/survey/answers` | player | `{qid,value,respondentId?,player?:{name,clientId}}` | `{qid,saved:true,rev,answered:n,complete}` | 400 bad value/qid; 403 `NOT_YOU`; 409 `SURVEY_CLOSED`/`NOT_OPEN`; **503 `BUSY`** (conflict budget spent) / **503 `CONFLICT`** (Rev lost 3×) — retryable |
| `POST /games/{id}/survey/submit` | player | `{respondentId?,player?}` | `{complete:true,answered}` | 422 `{code:'NOTHING_ANSWERED',missing:[required qids]}` (nothing answered); 422 `{code:'MISSING',missing}`; 409 closed; 503 `BUSY`/`CONFLICT` — retryable, incl. a Who-finished DONE write that failed |
| `POST /games/{id}/survey/mine` | player | `{respondentId?,player?}` | `{answers,answered,complete,rev}` | 403; 404 no row |
| `POST /games/{id}/survey/close` | host | — | `{n,finished,perQuestion,closedAt}` (no texts); idempotent | 409 not open/closed; 503 `BUSY` |
| `POST /games/{id}/survey/warning` | host | — | `{warnedAt}` | 409 not open; 503 `BUSY` |
| `POST /games/{id}/survey/end` | host | — | `{state:'ENDED'}` (freezes first if `SURVEY#RESULTS` is missing) | 409 not closed; 503 `BUSY` |
| `GET /games/{id}/survey/progress` | host | — | the `surveyProgress` payload | — |
| `GET /games/{id}/survey/people` | host | — | `{people:[{name,status:'finished'\|'partway'\|'not-started'}]}` | 409 in Anonymous |
`mine` is POST (deviates from PLAN's GET): it carries a clientId/respondent
capability that must stay out of URLs and logs (precedent `POST /games/get-results`).
**409 is a fact about the survey** (closed / not open) and the phone stops on it;
**every retryable failure is a 503** (`BUSY`, `CONFLICT`) and the phone retries.
**DynamoDB throttling is `BUSY`, on every survey route, player and host** — never a
500: `ThrottlingException`, `ProvisionedThroughputExceededException`,
`RequestLimitExceeded`, or a cancellation reason `ThrottlingError` /
`ProvisionedThroughputExceeded`. Every answer writes the one partition `GAME#<id>`,
so a big room reaches its write cap (dev, a 240-answer burst:
`TableWriteKeyRangeThroughputExceeded`). Writes retry in the conflict budget below;
a throttled read answers 503 `BUSY` at once (the SDK has already retried it).
Once sent, `Complete` stays true even if an answer is later cleared.
`next-question`, `start-vote` and `get-results` (both routes) refuse a survey: 409,
STATE untouched.

**PUT algorithm:** read METADATA+STATE in parallel → validate against the question →
ConsistentRead the RESP row, decrypt, set one key, re-encrypt → `TransactWriteCommand`
with a **ConditionCheck STATE `State = 'SURVEY#OPEN'`** + Put conditioned
`attribute_not_exists(PK) OR Rev = :rev`: STATE check failed → 409; Rev failed →
re-read, ≤3 then 503 `CONFLICT` (precedent `toggle-category.js:231`); cancellation
reason `TransactionConflict` (every concurrent answer holds STATE — DynamoDB locks
a ConditionCheck's item too) **or throttling** → jittered backoff, 8 tries ≲1.6 s of
our own waiting and no new try after 8 s of clock (a throttled send has already
spent the SDK's back-off; eight of them could reach the 30 s timeout, which is a
500 at the edge) (`game/survey-retry.js`), then 503 `BUSY`
→ if new row and Who finished: conditional DONE `started` (after verifying the player)
→ `countAnsweredQuestion(db, table, gameId, qid, meta)` (a `game/` copy of
`session-count.js`, so surveys bill at their 2nd answered question) → only if
`Answered`/`Complete` changed: Query `SURVEY#RESP#` ConsistentRead projecting
`Answered, Complete` → broadcast progress. (The row is written by then, so a
failed count read is logged and the PUT still answers 200.)

**Close:** conditional STATE OPEN→CLOSED + `ClosedAt` (retrying
`TransactionConflictException` and throttling; the freeze's page and results
writes retry in the same budget) → Query `SURVEY#RESP#` ConsistentRead, **paginate**
`LastEvaluatedKey` → decrypt, filter to current `Session`, `aggregate(questions,
rows)` → Put the text pages → conditional Put `SURVEY#RESULTS` → only the close whose
Put landed records metrics and broadcasts; a racing one returns the stored counts.

### Broadcasts
| type | to | payload |
|---|---|---|
| `surveyProgress` | host sockets only (`ConnectionType='HOST'`, all rows) | `{gameId,started,finished,perQuestion:[{qid,answered}],at}` — counts only; `at` is when the (strongly consistent) count read STARTED, so the stage's newest-`at`-wins rule follows read order |
| `surveyClosingSoon` | all | `{gameId,minutes:2,warnedAt}`; also STATE `WarnedAt` for reloads |
| `surveyClosed` | all | `{gameId,newState:'SURVEY#CLOSED',n,finished,closedAt}` |
| `gameEnded` | all | `{gameId,state:'ENDED'}` |

### Aggregate (`game/survey-aggregate.js`, the only counting code)
`aggregate(questions, rows) → {N, Finished, Order, PerQuestion:{qid:…}, Texts:{qid:[…]}}`;
`n` = rows where the qid is present (partial rows count).
rating `{n,counts,mean,topTwo}` (+ for `0-10` `{detractors,passives,promoters,score}`,
score = %9–10 − %0–6); choice `{n,counts,other}`; yesno `{n,counts:{yes,no,unsure},whys}`;
rank `{n,avgPlace,firsts,placeHist}` — **unplaced items share the mean of the unfilled
places** (the only rule under which the mockup's averages sum to 15); text `{n,answerIds}`.
Text ids `<qid>:<k>` after a deterministic shuffle (ids never carry respondent order).

## 3. Step 0 (main session) — DONE
- `src/src/config/surveyNames.js` (ESM): `NAMES_MODES` (`id,label,hostLine,does,
  phoneLead,phoneLine,wallLine`; phone lines verbatim from p-01/p-11/p-12),
  `NAMES_DEFAULT`, `namesMode(id)` (unknown → default), `namesPayloadFor({gameType,names})`
  (survey only). Every sentence a person reads about a Names value lives here once.
- `lambda-functions/game/survey-names.js` (CJS): `NAMES`, `NAMES_DEFAULT`,
  `normalizeNames()`, `SURVEY_OPEN`, `SURVEY_CLOSED`.
- `tests/survey-names-agree.js` (reads the ESM as text); `src/src/__tests__/surveyNames.test.js`.
- The "does" lines for Anonymous and Named were derived from 40-data-model's "Host
  gets" (the mockups wrote only Who finished's): Anonymous "Nobody is recorded.
  You'll see totals and the words people write, never who wrote them."; Named "Each
  answer is kept with the person's name. You'll see who said what in the console and
  the CSV. The wall, the shared link and the report never show a name." 

## 4. Tracks (parallel after Step 0)

### Track A — backend session + routes
Files: `create-game.js` + `schema-compliant-manager.js` (accept `names`; force
`randomizeQuestions` off for survey; store `Names`); `session-start.js`
(`{state='STARTED'}` option; `OpenedAt` `if_not_exists`); `start-game.js` (survey →
`state:'SURVEY#OPEN'`); `next-question.js` (add `GameType` to the METADATA projection
`:757`; refuse a survey 409 BEFORE the state/skip checks `:799-816`); `update-game.js`
(`names` in the whitelist `:70` with the `OpenedAt` condition); `get-game.js` +
`get-game-state.js` (`names, openedAt, warnedAt` `:311-343`); new `game/`:
`survey-questions.js` (pinned, active, SK-ordered, decrypted, per-container cache),
`survey-answer.js` (value checks), `survey-broadcast.js` (`toHosts`, `toAll`, 410
cleanup), `survey-answers.js` (player handler, routeKey routing like `comments.js:606-640`),
`survey-host.js`; guarded-identical copies into `game/` of `survey-kinds.js` (from
`admin/shared/`) and `session-count.js` (from `websocket/`); tenant-crypto ×3
(`surveyResponse`, `surveyResults`); `template-clean.yaml` `SurveyAnswersFunction` +
`SurveyHostFunction` (KMS Decrypt, DynamoDBCrud, ManageConnections, like
`CommentsFunction` `:3063-3131`); `auth/authorizer.js` explicit hosts/admins rule for
`GET games/{gameId}/survey/(progress|people)` (route template + concrete-path regex);
`tests/helpers/player-table.js` gains `TransactWriteCommand` (ConditionCheck, Put,
Update, atomic) and ConsistentRead/`LastEvaluatedKey` paging (today Get/Put/Query/
Delete/Update/BatchGet only, `:290-295`).
**Metrics** (`platform-metrics.js`, all copies, guarded as today): `recordSurveyOpened
({gameId, questions, set, questionId})` — once per session (the same METADATA marker
condition as `recordRoundServed`), `sessionsServed +1`, `roundsServed +questions` (a
survey serves every question at once), bucket kept on METADATA; `recordSurveyClosed
({gameId, answers, metadata})` — once (the `ANSWERS_MARKER` condition), `answersStored
+answers` where answers = Σ per-question `n` from the aggregate. Called from start (survey
branch) and close; both swallow errors like the round recorders. Extend
`tests/platform-metrics.js` / `-wiring.js`.
Tests `tests/survey-answers.js`: idempotent overwrite (one row, one Answered entry,
one progress frame); partial answers count (A q1+q2 unsent, B q1 sent → q1.n=2,
q2.n=1, N=2, Finished=1); closed rejects (PUT after close 409; PUT interleaved with
close fails its ConditionCheck, row unchanged); own row only (Named wrong clientId
403; malformed respondent 400; `mine` never returns another row); encryption
(`Answers` envelope, sentence absent from raw partition, `mine` plaintext);
Anonymous (RESP keys ⊆ `{PK,SK,Answers,Answered,Complete,Rev,Session,ttl}`, no
name/clientId in its JSON, no DONE rows); Who finished (DONE has no respondent id,
RESP no name/timestamps, `started`→`finished` on Send); Named (host handover +
rejoin `claimExisting` → `mine` with the new clientId returns the same row, old one
403); Names locked after `OpenedAt` (PUT 400; racing start fails its condition);
answer checks per kind; billing (2nd distinct answered qid writes one ledger row);
`surveyProgress` to HOST connection ids only, counts only; next-question refuses a
survey (from CREATED and with `skip`), no REF rows; start opens (STATE `SURVEY#OPEN`,
`OpenedAt = StartedAt`, ttl `startedTtl`; extend `tests/lobby-start-ttl.js` §4 —
still one writer); close (no token / other org 404; second close returns stored
results, no second broadcast; paginates; ignores a previous session's rows on the
same code). Extend `tests/session-control-routes-authorization.js`
(MUST_BE_CLOSED `:84-93` + close/warning/end/progress/people; MUST_STAY_OPEN
`:96-110` + the four player routes; `requiredGroupsForRoute` for
`GET games/1234/survey/people`).

### Track B — aggregation (pure)
`lambda-functions/game/survey-aggregate.js`. Tests `tests/survey-aggregate.js` with
the mockups' own numbers (`_src/content.py`): rating q1 [1,2,6,15,14] → n 38, mean
4.03; 0–10 q2 (6,13,18) → +32; choice q3 [14,11,7,4,2]; multi q4 with write-in: 36
respondents, other 3, shares sum > 100%; yesno q5 (24,11,3), whys under `no`; rank q6
(top 3 of 5): average places sum to 15 ± 0.05, firsts sum 35; text q7/q8 n 31/27 with
as many `answerIds`/`Texts`. A row holding only q1 counts toward q1 alone. Output
contains no respondent id or name (serialise and search). A grep guard: nothing else
under `lambda-functions/` or `src/src/` computes `avgPlace` or a survey mean.

### Track C — the phone
`PlayerShell` → `components/PlayerShell.jsx` (re-exported from `PlayerPage.jsx`; avoids
a circular import) + optional `progress` prop (strip `--p`); `components/survey/`:
`SurveyRunner.jsx` (loading → answering(i) → review → sent → closed), `RatingInput`,
`ChoiceInput`, `YesNoInput`, `RankInput`, `TextInput`, `surveyAnswers.js`
(`isAnswered`, `summaryFor`, `seededOrder`), `useSurveyAutosave.js` (ONE in-flight save
per phone — the row is one conditional write, so two would race for its lock — later saves
queued, latest per qid wins; text saves on 600 ms idle or blur; Saving / Saved / Not saved –
retrying), `respondent.js` (`getRespondentId(gameId, storage, openedAt)`, in-memory fallback with
a note); `utils/playerPhase.js` (`stateRank` from `PlayerPage.jsx:379-387` + survey
ranks); `PlayerPage.jsx` (survey + joined → `<SurveyRunner>` after all hooks, before the
ENDED branch; `surveyClosed`/`surveyClosingSoon` handlers; survey ENDED shows no
score); `PlayerSurface.css` `.plr-scale/.plr-step`, `.plr-yn`, `.plr-rank`, `.plr-rev`,
`.plr-saved`, `.plr-pair`, `.plr-rule`, `.plr-qno/.plr-req`, `.plr-ends`, `.plr-follow`
(cut from `_src/survey-phone.css`). Names promise = `<p className="plr-anon">`
(`PlayerPage.jsx:2931`) with `phoneLine`, **question 1 only** (p-01/p-11/p-12). Two-minute
warning reuses `.plr-banner` `role="status"`.
Tests: `surveyInputs.test.jsx` (rating radiogroup with arrow roving + stars; choice
radios vs checkboxes + up-to-N line; labelled write-in; yesno none preselected, why only
on a matching answer; rank tap-to-place + "Move X up/down" buttons, no drag needed; text
counter enforces maxLength); `surveyRunner.test.jsx` (promise line = `phoneLine` per
mode; required → Next disabled with the reason, optional → Skip; each answer PUTs qid +
value; reload + `mine` resumes at the first unanswered; review lists skipped optionals;
Send → rest-volume done screen with no dock; `surveyClosed` → closed screen; warning
banner); `respondent.test.js` (format, per-game key, ≠ `getClientId`);
`playerPhase.test.js` (`STARTED` can't overwrite `SURVEY#OPEN`);
`surveyPhonePalette.test.js` (#0F1A2E on #F6A94C 8.86:1; inputs ≥15px).

### Track D — host stage + setup dialog
`config/hostControls.js`: `COLLECTING`, `CLOSED` in `HOST_PHASES`; map the survey
states; `'survey'` into `TYPES_THAT_SKIP_VOTE` (→ `anonymityApplies('survey')` false, the
old card hides itself; update `hostRemote.js` `TYPES_WITH_NO_VOTE_AT_RUNTIME` + its
test); intents `OPEN_SURVEY`, `CLOSE_SURVEY`, `WARN_SURVEY`, `END_SURVEY`; survey×LOBBY
primary "Open the survey" (no player requirement); COLLECTING primary "Close the survey"
(`confirm:true`) + secondary "Two-minute warning"; CLOSED primary "End the session";
survey×ENDED "Back to Menu". `config/gameTypes.js`: survey `phases`
`['COLLECTING','CLOSED']`; **empty `UNPLAYABLE_GAME_TYPES`** and update
`gameTypesSurvey.test.js`. `GameHostPage.jsx`: survey entries in `STAGE_GROW` (`:77`),
`BAR_PHASE` (`:5209`); `meter` (`:5225`) heading "Finished", `finished /
players.length` + per-question rows; `revealNames` (`:5303`) fetches `/survey/people`
on reveal (Who finished/Named only); dock status "N finished · N partway · N not
started"; `runHostAction` (`:5120`) new intents, Close confirms first; content branch →
`components/stage/SurveyCollecting.jsx` (join block from `:5743-5760`); socket handlers
`surveyProgress`, `surveyClosed`. New `hooks/useSurveyProgress.js`. `RoomMeter.jsx`
`REVEAL_LABEL.COLLECTING = 'Still going'` + optional `rows` prop rendering `.sprog`.
`Rail.jsx` `CHIP` (`:32-39`): COLLECTING "Answering", CLOSED "Closed".
`styles/stage.css`: `.sprog`, `.stitle`, `.ssub` — **not `.bar2`**.
`GameSetupDialog.jsx` for survey: the Names card (three-way `role="radiogroup"`, seeded
from the set's `namesDefault` else Anonymous; does-line, two-panel preview whose phone
panel uses `phoneLine`, limit line, lock note); hide shuffle and categories; submit
"Open the survey". `createGame.js`: `namesPayloadFor` in `createGameBody` and
`updateGameBody`; `randomizeQuestions:false` for survey. Create handler
(`GameHostPage.jsx:4378-4406`): for survey create → `POST /start` → `switchToGame`
(QuickstartMenu precedent). Optional: set-level `namesDefault` on Details, validated as
a closed list in `edit-question-set.js` like `roundKind`.
Tests: `hostControls.test.js` (survey × LOBBY/COLLECTING/CLOSED/ENDED exactly one
primary; Close `confirm`); `surveyStage.test.jsx` (join block + QR stay; "Finished n /
joined" + a row per question; Anonymous offers no names; Who finished names only after
reveal under `data-list-kind="waiting"` / "Still going"; never a name beside an
answer); `surveyStagePalette.test.js` (`.sprog`; `.bar2` absent);
`surveySetupNames.test.jsx` (Survey in the pills; three radios, Anonymous default;
preview = `phoneLine`; Anonymous-responses and shuffle cards hidden; payload carries
`names`); `createGamePayload.test.js` (`names` survey only); `gameSetupCallSite.test.js`
(survey create calls `/start`, no history); `hostRemote.test.js`
(`primaryAction('SURVEY#OPEN','survey')` null).

### Integration
Merge A–D; full backend loop (count suites), `npm test`, lint, build; dev; a real
survey from two phones + a laptop in each Names mode — reload mid-survey, warn, close,
end.

## 5. Risks and awkward meetings with the code
1. **A reused 4-digit code can mix two sessions** — the reservation expires at start +
   7d, DynamoDB deletes up to ~48h late (`session-ttl.js:17-18`); `SURVEY#RESULTS` lives
   30d in the same `GAME#<id>` partition. → stamp `Session = METADATA.CreatedAt` on every
   survey row and filter on it; Phase 3 should consider moving results to
   `ORG#<org>#SURVEYS` (as reports moved to `ORG#<org>#REPORTS`).
2. **Timestamps could break Who finished** (`UpdatedAt` vs `DONE.FinishedAt`) → none on
   RESP rows in Anonymous/Who finished; never log a respondent id beside a player name.
3. **Open answers would vanish before results** (text lives only in 7-day RESP rows) →
   freeze into `SURVEY#RESULTS.Texts` (encrypted, synthetic ids) at close.
4. **Survey answers bypass billing** (`session-count.js` is only called from
   `message.js`) → call `countAnsweredQuestion` from the PUT.
5. **"Open the survey" vs create → history → Start** → create-and-start for surveys
   (QuickstartMenu precedent); no populated lobby, matching s-01.
6. **SPACE on an irreversible primary** (dock binds SPACE, `GameHostPage.jsx:5506`) →
   Close always confirms.
7. **s-01's `.bar2`** re-adds what `stage.css:277-282` removed → keep the single
   fraction; the per-question rows are a different fact.
8. **`/people` would be open to any signed-in account** (`[]` like `GET …/up-next`,
   `/queue`, `/exclusions` today) → explicit rule for the survey routes; file the three
   existing ones as a separate task.
9. **Harness gaps** — `player-table.js` lacks TransactWrite and paging; budget it in
   Track A.
10. **Out of scope, stated plainly:** the remote can't drive a survey (states parse
    `UNKNOWN`); private sessions: survey routes don't re-check the access code
    (consistent with votes/comments/get-question); Anonymous resume is same-browser only;
    Named People answers readable 7 days until Phase 3 decides.
11. **Set-level `namesDefault` isn't in Phase 1's contract** → optional in Track D; the
    create dialog defaults to Anonymous either way.
12. **Who finished can be de-anonymised by watching.** A host who watches `/people`
    alongside the live per-question counts (`surveyProgress`) sees a name move to
    "partway" or "finished" at the moment a question's count ticks up, so can infer
    which questions a named person answered — and with a small n, which open answer
    is theirs. Phase 3's results must apply a minimum-n rule before showing texts or
    themes, and the live counts in Who finished may need coarsening (batched, or
    rounded, while the list is on screen).
13. **`progressFor` is a full consistent Query per change** — every first answer to a
    question (and every Send) re-reads every `SURVEY#RESP#` row, projected, to
    rebuild the counts. Fine for rooms; revisit near 1,000 respondents (a counter row,
    or a debounced broadcast).
14. **The results item still grows with the texts' ids.** The words are paged, but
    `PerQuestion` keeps each question's text ids (`answerIds`, `otherIds`, `whys`),
    ~16 bytes a text. That bounds `SURVEY#RESULTS` at roughly 20,000 texts; Phase 3
    can derive those lists from the pages (every text on a page carries its id and
    `v`) if a survey ever gets near it.
