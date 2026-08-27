# The feedback round — section-anchored comments on a round's report

Status: design, approved to build. Written 2026-08-27.

## 0. What was asked for

> "a request feedback button during the AI feedback phase. if so there is a new
> round where every one can comment on what they have heard, they should have a
> copy of the feedback report (the same item that is avail when you click the
> previous round in the session rounds screen. so they can read, copy paste. in
> fact there should be like in chat response they click on a section (the
> summary, the results, a specific user response) and the comments now can be
> seen in the resulting round of feedback (just like we show the responses in
> the previous rounds. these will get added to the round report and the over all
> report as well. clearly called out as comments. make this fit the same flow and
> style of the other parts of the system."

Six deliverables: a host control on the AI feedback phase; the report on every
participant's device; section-anchored commenting; comments shown the way
previous-round responses are shown; comments in the round report *and* the
session report, labelled as comments; and it has to look like the rest of the
site.

## 1. The one decision everything else follows from

**A feedback round is a third BEAT of RESULTS, not a new game state and not a
new round kind.**

Three candidate mechanisms existed. Two are wrong:

- **A new round kind** (`ROUND_KIND_IDS`) is wrong because a round kind is an
  *authoring* axis. It lives on the question set, steers the generator, and
  `lambda-functions/game/` never reads it at runtime
  (`admin/shared/round-kinds.js` header; confirmed — nothing under `game/`
  requires it). A feedback round is a runtime event with no authored question.
- **A new game state** (`FEEDBACK#nnn` beside `ASK#`/`VOTE#`/`RESULTS#`) is
  wrong because it would need its own round ordinal, and the comments have to
  land in `detailedQuestions[i]` — the round report *of the round being
  commented on*. A separate ordinal orphans them from the thing they annotate,
  and would also disturb `LessonNumber`, `roundOf`, and the question queue.

The right mechanism already exists. `lambda-functions/game/stage-beat.js` holds
`BEATS = ['results', 'field-notes']` — "which beat of RESULTS the room is on" —
durable on `PK=GAME#{id} / SK=ROUND#{nnn}`, per round, host-authenticated,
idempotent, bidirectional between the projector and the host's phone, and
broadcast as `stageBeatChanged`, a frame deliberately distinct from
`gameStateChanged` so it does *not* trigger a full client re-sync.

So: **`BEATS` becomes `['results', 'field-notes', 'feedback']`**, and its
frontend mirror `STAGE_BEATS` in `src/src/config/hostControls.js:60` gains the
same value. Both are documented as closed sets on purpose; adding one closed
value is the sanctioned way to extend them, and `tests/stage-beat-flow.js`
already pins the pair.

Consequences:

- No new state machine, no new route to open the round, no round renumbering.
- Stepping back to `results` or `field-notes` closes the composer without
  destroying anything — comments are rows, not session state.

**The beat mechanism does NOT extend by adding one value, and the first draft of
this section was wrong to say it did.** Review found three call sites that
collapse the beat back to a binary, each of which had to be widened by hand:

| Site | What it did |
|---|---|
| `lambda-functions/game/get-game-state.js:151-153` | `stageBeat` starts at `'results'` and is only raised on an exact `'field-notes'` match, so a stored `feedback` was reported to every client as `results`. This one is upstream of the rest: nothing that polls or reloads could learn a feedback round existed. |
| `src/src/GameHostPage.jsx:1976` | the same binary, so a host reload landed back on the tally. |
| `src/src/config/hostRemote.js:182-184` | anything not `'field-notes'` offers "What We Heard", so the phone offered to go *backwards* during a feedback round. |

Only `stageBeatFromFrame` (`hostControls.js:78-96`) extended cleanly, because it
gates on `STAGE_BEATS.includes(beat)` rather than on an equality test. That is
the shape the other three now follow — read against the closed set, the way
`get-game-state.js` already reads `stageFocus`.

## 2. Where the control lives

`docs/design/host-redesign/09-field-notes.html` is the AI feedback phase — state
chip "WHAT WE HEARD", the AI's read-back, and a bottom bar reading
`SETUP | Discussion prompt on screen | ‹ Results | SPACE | Next Round`.

`src/src/config/hostControls.js` gives `FIELD_NOTES` a primary of **Next Page**
while pages remain and **Next Round** on the last page, and assigns a secondary
("Skip the rest") only in the first case. On the last page the secondary slot is
free, which is where **Request feedback** goes:

- `HOST_PHASES` gains `'FEEDBACK'`.
- `HOST_INTENTS` gains `FEEDBACK: 'feedback'`.
- On `FIELD_NOTES`, last page: primary stays `Next Round`; secondary becomes
  `{ id: 'request-feedback', label: 'Request feedback', icon: 'ChatCircleText',
  intent: HOST_INTENTS.FEEDBACK }`.
- On `FEEDBACK`, the primary is `Next Round` and the secondary returns to the
  read-back, so the host is never trapped in the new beat.

**This crosses a written invariant, and the invariant is re-argued rather than
quietly widened.** `hostControls.test.js:328-334` asserts *"FIELD_NOTES adds no
secondary"* with the reason *"FIELD_NOTES is mid-round: a second button there is
one more thing to aim at while a room reads"*, and `:113-131` restricts a
secondary's intent to `SKIP` or `LEAVE`. Both fail as designed.

The invariant already carries one exception, granted mid-document because "the
single button was the worse aim". The argument for a second one:

- **This does not introduce a two-button bar to FIELD_NOTES; it fills the slot
  that bar already has, on the one page where it is currently empty.** Mid-
  document the host already sees Next Page + Skip the rest. The maximum number
  of aim points on this phase does not change.
- The alternatives are worse. Mid-round is where the invariant's reason bites
  hardest. The setup panel is reachable but buried, and the owner asked for a
  button *"during the AI feedback phase"* — a control the host has to go
  hunting for while a room waits is not that.
- The intents stay distinct, which is what the `:129` assertion says it is
  really protecting: a secondary must never duplicate the primary's intent.
  `FEEDBACK` ≠ `NEXT`, and on the `FEEDBACK` phase the secondary is
  `FIELD_NOTES` ≠ `NEXT`.

Advancing the round (`Next Round`) from the feedback beat is unchanged — the
next round's `ROUND#nnn` row is a different row and opens on its own tally, the
property `stage-beat.js` already guarantees by keying the beat per round.

**The host stage renders a `FEEDBACK` body.** Review raised this as genuinely
open: the phase derivation at `GameHostPage.jsx:4522` and `:4799` could either
leave `hostPhase` at `RESULTS` (in which case auto-mode's timer fires the
RESULTS primary and throws the room out of the feedback round with no host
action) or yield a new `FEEDBACK` phase (in which case `BAR_PHASE`, the six
stage-body guards, `interceptAdvance`, `onBackKey` and `STAGE_GROW` all need an
entry, or the projector goes blank).

The second, and the work is done rather than avoided. The room is looking at the
projector; a feedback round with nothing on the stage is not a round. The stage
shows the round being commented on and the comments arriving against each
section — which is the *"the comments now can be seen"* half of what was asked
for, and it is the same live-arrival shape the room already sees during ASK.

## 3. What the participant sees, and the principle it appears to violate

`docs/design/player-redesign/17-results-call.html` says, of the results phase:

> "Names are on the main screen now. The top responses and the discussion
> prompts are up there too — this page will not repeat them."

and `19-between-rounds.html` opens with "Nothing to do here."

The player's phone is deliberately a companion, not a second projector. The
owner is nonetheless explicit that in a feedback round participants get the
report on their own device, to read and copy-paste from.

**These do not conflict, and the reading matters.** The principle is *the phone
does not duplicate the stage while the participant has no task*. In a feedback
round the participant has a task — reading the report and commenting on
sections of it — and the commenting cannot happen anywhere but on the device
they are holding. The report is on the phone because it is the substrate of the
work, not because it is being mirrored.

So on `RESULTS#nnn` with beat `feedback`, the player page replaces the minimal
results card with the round report plus a comment composer.

## 4. Reusing the artifact, not rebuilding it

The owner named the artifact precisely: "the same item that is avail when you
click the previous round in the session rounds screen". That is
`src/src/components/PastRound.jsx` — reached from `SessionSetupPanel`'s
`history` tab via `onOpenRound(i)`, mounted at page root in `GameHostPage.jsx`.

`PastRound` is a `<Modal>`. A modal is right for a host looking something up
mid-session and wrong for the participant's primary surface: it owns Escape,
a focus trap and a scroll lock, it carries a close button that would strand the
participant on an empty page, and `RemoteSessionPanel` already establishes that
this codebase does not put modals over a phone's primary surface.

**So `PastRound`'s body is extracted into a presentational `RoundReport`
component and both surfaces render it.**

```
PastRound  = <Modal> + head + <RoundReport/> + prev/next nav      (host, unchanged)
PlayerPage = <RoundReport/> inline, in the player's dusk shell    (participant)
```

`RoundReport` keeps every existing class name (`past-round__question`,
`past-round__results`, `past-round__answers`, `past-round__summary`, …) so the
host's rendering, its stylesheet block in `styles.css:11651-11855` and the
existing `sessionHistory.test.jsx` assertions are all untouched. This is the
"reuse rather than build a second renderer" the brief demands, done as one
renderer in two containers rather than one component forced into two jobs.

Props that differ by container:

| prop | host | participant |
|---|---|---|
| `onRegenerate` | supplied → Regenerate button renders | omitted → no button |
| `onComment` | omitted → read-only | supplied → sections become commentable |
| `comments` | supplied → comments render under their anchors | same |

## 5. The three anchors

The owner named them: "the summary, the results, a specific user response".

| `anchorKind` | `anchorRef` | Region |
|---|---|---|
| `summary` | `''` | the whole AI summary section |
| `results` | `''` | the responses section as a whole |
| `response` | the row's **position index**, `'0'`, `'1'`, … | one participant response |

The question itself is deliberately **not** commentable. The owner listed three
things and the question is not among them; it is the prompt the room was given,
not something the room "heard".

**Position, never rank.** `create-report.js` gives tied scores equal ranks
(1, 1, 3), so two rows can both print "1". `PastRound` already closes its
spotlight handler over the row's own position `i` for exactly this reason, with
a long comment saying so. A comment keyed on the printed badge would attach to
the wrong response on any tie.

**A comment carries its own context.** Position is stable within a stored
report, but a comment that only says "index 2" is unreadable if anything ever
reshuffles, and is meaningless in the session report where the reader may not
have the round in front of them. So every comment stores, at write time:

- `AnchorLabel` — the human string, e.g. `"Response 3"`, `"AI summary"`
- `AnchorExcerpt` — the first ~140 characters of the thing being commented on

Both are rendered from the row. Nothing at read time re-resolves an index into
a response, which means no comment can ever be displayed against the wrong
thing.

## 6. Data model

```
PK  GAME#{gameId}
SK  COMMENT#{nnn}#{anchorKind}#{anchorRef}#{commentId}
```

`nnn` is the zero-padded `LessonNumber` — the same round key every other
round-scoped row uses, minted the same way (`round-key.js:currentRoundNumber`).
`commentId` is `{epochMillis}-{6 random hex}`: monotonic so a `begins_with`
query returns a round's comments in the order they were written, unique so two
people commenting on the same anchor in the same millisecond cannot collide.

This SK supports every read needed with a `begins_with` and no GSI:

| Query | Prefix |
|---|---|
| everything on one anchor | `COMMENT#003#response#2#` |
| everything on one round | `COMMENT#003#` |
| everything in the session (for the report) | `COMMENT#` |

Attributes:

| Attribute | Notes |
|---|---|
| `GameId`, `QuestionNumber` | `nnn`, padded |
| `CommentId` | as in the SK |
| `AnchorKind`, `AnchorRef`, `AnchorLabel`, `AnchorExcerpt` | §5 |
| `Text` | the comment itself |
| `playerName`, `name` | author — **lower-case only**, because those are the spellings `ANON_FIELDS` strips. See §8. |
| `SubmittedAt` | ISO |
| `ttl` | 30 days — see §7 |

`AnchorKind` is validated against a closed set before it becomes part of an SK,
and `QuestionNumber` against `/^\d+$/` before padding — the same guard, for the
same reason, that `stage-beat.js:147` and `reveal-authors.js:73` already apply:
anything else writes a row nothing will ever read again.

## 7. TTL — 30 days, and the argument that does *not* justify it

**This section was rewritten after review. The first version reached the right
number by an argument that is factually wrong, and the wrong argument mattered
more than the number, so both are recorded.**

The table's TTLs are three tiers:

| Tier | Rows | TTL |
|---|---|---|
| session scaffolding | `METADATA`, `STATE`, reservation, `QUEUE` | 90 days |
| durable content | `#AISummary`, `REPORT`, `PLAYER#…#SCORE`, `#RESULTS` (call-and-answer only) | 30 days |
| raw inputs to a tally | `#ANSWER#`, `#VOTE#`, `PLAYER#`, `#RESULTS` (wavelength, and the `CREATE_RESULTS` path) | 7 days |

**The argument that was wrong.** The first draft said 30 days is "the only value
where the annotation and the thing annotated share a fate". They do not share a
fate, at any TTL, for two reasons found in review:

1. **The report's responses are rebuilt from 7-day rows.**
   `create-report.js:301-302` filters the raw `QUESTION#{n}#ANSWER#` items —
   7 days (`websocket/message.js:374`) — and those feed `voteTallies`
   (`:392-401`), `rankedAnswers` (`:436-446`) and finally
   `detailedQuestions[i].answers` (`:518`). **On day 8 every round's `answers`
   array rebuilds empty.** The AI summary survives at 30 days; the responses do
   not. So two of the three anchors already point at material that has gone from
   a rebuilt report long before any comment TTL expires.
2. **The `REPORT` row's 30 days is measured from the last rebuild, not from the
   session.** `create-report.js:721-728` PUTs it unconditionally on every POST,
   and `config/sessionHistory.js:26-33` records that merely opening the host's
   history tab re-runs that POST. A report opened on day 10 lives to day 40;
   comments written on day 0 would be gone.

**Why 30 days is still the right number.** It matches the AI summary
(`get-ai-summary.js:1203`), the score rows (`get-results.js:588, 846`) and the
report's nominal life. It is the durable-content tier, and a comment is durable
content: it is an output that must survive into a report, not a raw input to a
tally like a vote, which exists only until the tally is computed and baked in.
7 days would put commentary in the same tier as the ballot; 90 would put it in
the same tier as the session scaffolding, which holds no content at all.

**What actually protects a comment's meaning is `AnchorExcerpt`, not the TTL.**
This is the real conclusion, and it promotes the excerpt from a nicety to the
load-bearing part of the design: from day 8 onward the excerpt is the **only
surviving copy** of the response a comment is about. That is why it is computed
at write time, stored on the row, and encrypted (§9) — it is a second copy of
customer content, and it is the copy that lasts.

**Known defect, named rather than assumed away.** That the report rebuilds
`answers` from expired 7-day rows is a pre-existing bug in `create-report.js`,
not something this feature introduces, and it is out of scope here. It is the
reason the excerpt exists. Anyone raising the comment TTL to "fix" a missing
response has misread which row expired.

## 8. Anonymity — a decision that turned out to be forced, and one that is not

**Forced.** `get-results.js:265` sets `AuthorsRevealed = true` unconditionally
when a round enters RESULTS, with a comment reading "Attribution returns
everywhere from here: results, Field Notes, standings, the report and the
archive export." The feedback beat is *inside* RESULTS and after field-notes, so
by the time a feedback round can open, the round it annotates is always
attributed. The stage's "Hide authors" control is display-only and calls
nothing. So comments in a feedback round are attributed. That is not a choice.

**Not forced, and taken deliberately — two of them.**

1. **Comments are still routed through the existing anonymity gate.** The
   handler calls `isHidden(metadata, round)` from `game/anonymity.js` and, when
   it returns true, redacts with the existing `redactAnswers`. Today that branch
   never fires. It costs nothing, and it means that if the reveal semantics ever
   change, comments redact *with* responses instead of becoming the one surface
   in the product that leaks names. `anonymity.js` is byte-identical across two
   directories under a drift guard, so it is **not modified** — the existing
   generic functions are called as they are.

   **The author is stored as `playerName`, lower-case, and this is load-bearing
   rather than incidental.** `ANON_FIELDS` is exactly
   `['playerId', 'playerName', 'name']` (`anonymity.js:25`). The first draft had
   the comment row carrying `PlayerName` as well, copying the `answer` row's
   spelling — and capital-P `PlayerName` is **not** in that list, so it would
   have survived redaction untouched. The future-proofing would not have worked,
   which was the entire stated reason for routing through the gate at all.

2. **The composer says so, in words, before anyone types.** Participants have
   spent the session under "Your name is not attached to it until voting closes"
   (`08-ask-call-typing.html`). Carrying that assumption into a comment would be
   the actual privacy failure here. The composer reads **"Your name will be
   shown with this comment."** — stated up front, not discovered afterwards.

Under redaction, comments are labelled positionally within their anchor group
("Comment 1", "Comment 2"), the same shape as "Response 1, 2, 3", so no
cross-comment identity can be inferred either.

## 9. Encryption

A comment is customer-authored prose, written by a named person, about a named
person's response. `tenant-crypto.js` gets a new entity:

```js
comment: Object.freeze(['Text', 'AnchorExcerpt', 'AnchorLabel']),
```

`AnchorExcerpt` is the one that is easy to miss: it is a verbatim slice of the
material being commented on, so it is a **second copy** of content the boundary
already protects one copy of. Encrypting `Text` alone would leave a
participant's actual words readable at rest while the commentary about them was
ciphertext — the same shape of mistake as encrypting `Answer` but not
`ProcessedWords`. `AnchorLabel` joins them because for a `response` anchor it
carries a participant's name once the round is attributed.

`AnchorKind`, `AnchorRef` and `QuestionNumber` stay plaintext because they are
**coordinates, not content**: `create-report.js` groups every comment in a
session by round and section in one pass and must not have to ask KMS a question
to do it.

`playerName` stays plaintext too, but **not for the reason the first draft
gave.** It said "it is in the SK and cannot be hidden there" — true of the
`answer` entity, whose SK is `QUESTION#{n}#ANSWER#{playerName}`, and false here:
`comment-keys.js` builds a key with no name in it. The real reason is that the
same participant's `PLAYER#{name}` and `QUESTION#{n}#ANSWER#{name}` rows already
carry that name in plaintext sort keys, so encrypting this third copy buys
nothing while costing a decrypt on every grouping pass.

All **three** byte-identical copies are edited (`game/`, `websocket/`,
`admin/shared/`); `tests/tenant-crypto.js` §8 fails the build otherwise. Any
function whose require tree reaches `tenant-crypto.js` needs `kms:Decrypt` in
`template-clean.yaml` or `tests/kms-grants-match-code.js` fails the build.

Comments nested inside `detailedQuestions` on the `REPORT` row are already
covered — `detailedQuestions` is in `ENCRYPTED_FIELDS.report`.

## 10. API

Two new routes on one new handler, `lambda-functions/game/comments.js`
(`CodeUri: lambda-functions/game/`), modelled on `submit-vote.js` — which is the
right analogue because it is the existing case of a participant writing a row
over HTTP that must survive into the report, with an org lookup and encryption.

| Route | Auth | Body / query |
|---|---|---|
| `POST /games/{gameId}/comments` | **public** | `{questionNumber, playerName, anchorKind, anchorRef, anchorLabel, anchorExcerpt, text}` |
| `GET /games/{gameId}/comments` | **public** | `?questionNumber=nnn` (optional; omitted returns the session) |
| `GET /games/{gameId}/feedback-round` | **public** | one round's report slice + its comments |

**The third route exists because the design originally had no answer to "how
does the participant get the report", and every obvious answer was wrong.**

- `POST /games/{gameId}/report` **writes**. Forty phones calling it is forty
  full-partition re-queries, forty KMS encrypts and forty overwrites of the same
  `SK: 'REPORT'` row per feedback round.
- `GET /games/{gameId}/report` is read-only but branches on an unverified
  `?role=` query parameter (`get-report.js:67`), and the non-host branch returns
  a leaderboard with **no `detailedQuestions` at all** — nothing to comment on.
  Passing `role=host` from a participant's phone would work, and would hand
  every phone in the room the whole session: every round, every response, and
  the standings. That is a much larger grant than a feedback round needs, taken
  by leaning on a check the code itself documents as unenforceable.

So `GET /games/{gameId}/feedback-round` is minimum-privilege by construction:

- it returns **one** round — the one currently on the `feedback` beat — and
  refuses with 409 when no round is, so it is not a general back door into a
  session;
- no leaderboard, no standings, no other round;
- comments included, redacted through the same `isHidden` gate;
- it reads the stored `REPORT` row rather than rebuilding, so a room of forty
  costs forty cheap reads and no writes.

The host's **Request feedback** therefore does two things in order: `POST
/report` to build the row, then `POST /stage-beat` with `beat: 'feedback'`. If
the first fails the round does not open, because a feedback round whose report
is missing is a blank screen on forty phones.

Public because participants hold no Cognito identity — the same reason
`POST /games/{gameId}/votes` is public. Opening the round is *not* public: it
goes through the existing host-authenticated `POST /games/{gameId}/stage-beat`.

Guards on POST: the game must exist; the round must be in `RESULTS#{nnn}` for
the round being commented on **and** on beat `feedback` (a comment posted into a
round the host has moved on from is refused, so the composer cannot write into
a closed round); `text` non-empty and ≤ `MAX_COMMENT` (1000 chars — long enough
for a real remark, short enough that it cannot become a second response);
`anchorKind` in the closed set; `questionNumber` numeric.

HTTP rather than the WebSocket `ANSWER#` path because a comment needs a status
code the participant can see. A WS send is fire-and-forget, and a comment
silently lost is worse than a response silently lost — the participant has no
tally afterwards to notice it missing from.

Broadcast on success: `{type: 'commentPosted', gameId, questionNumber,
anchorKind, anchorRef, commentCount}`. No comment text on the frame — clients
refetch, exactly as `authorsRevealed` does and for the same reason. The player
page debounces the refetch by 1s so a burst of comments in a 40-person room is
one fetch, not forty.

## 11. Reports

`create-report.js` is the single builder for both reports; a round report *is*
`detailedQuestions[i]` and the session report is the object wrapping the array.
So one change serves both, which is what the owner asked for.

- Query `begins_with(SK, 'COMMENT#')` alongside the existing prefixes
  (`:61-105`), decrypt beside `:147-153` with the new `comment` entity, group
  into a `Map` keyed by padded round number the way `roundsByNumber` is built at
  `:105-107`, and join at the `detailedQuestions.push({...})` at `:483-556`.
- Each `detailedQuestions[i]` gains `comments: [{commentId, anchorKind,
  anchorRef, anchorLabel, anchorExcerpt, text, playerName?, submittedAt}]`,
  sorted by `submittedAt`. `playerName` is **absent, never null** when hidden —
  the same rule the file already applies to answers at `:400` and `:440` under
  the `hideAuthors` guard at `:384`, so `displayLabelFor` reads it correctly
  with no new logic.
- `gameStats` gains `totalComments`.
- **`questionNumbers` must gain comments as a source.** Review found the gap:
  the union at `:264-292` is votes ∪ results ∪ aiSummaries. A round whose
  7-day vote and results rows have expired and which never produced a summary
  drops out of `detailedQuestions` entirely — taking its comments with it, with
  no error. Comments are a fourth source.

"Clearly called out as comments" is a rendering requirement in three places:

1. `RoundReport` — comments render under their anchor in a block headed
   **Comments**, visually distinct from `past-round__answers`.
2. `GameReport.jsx` — each round's section gains a `report-comments` block with
   a "Comments" heading, each comment prefixed by the anchor it is on
   ("On Response 3:"). This is also the print sheet, so the block gets the same
   `report-keep` break treatment the answers have.
3. **`GameHostPage.jsx` must forward it.** `GameReport`'s `reportData` is
   rebuilt from scratch at `GameHostPage.jsx:4337-4349`, and the file carries a
   comment saying anything not explicitly forwarded there is invisible to the
   report no matter what the backend sends. `questions: report.detailedQuestions`
   (`:4346`) already carries the nested comments; `totalComments` needs its own
   **top-level** key, because that object has no `gameStats` to pass through.

`config/sessionHistory.js`'s `roundsFrom()` must carry `comments` through, or
the host's `PastRound` shows none.

## 12. Files

**New** (as built)

- `lambda-functions/game/comments.js` — the three routes
- `lambda-functions/game/comment-keys.js` — the sort key, the closed anchor set,
  the ceilings and the monotonic id clock
- `lambda-functions/game/stage-beats.js` — the beat vocabulary, moved out of
  `stage-beat.js` once `get-game-state.js` became a second reader (§1)
- `src/src/config/comments.js` — anchor vocabulary and label helpers
- `src/src/components/RoundReport.jsx` / `.css` — the artifact, extracted from
  `PastRound`, plus the comment blocks
- `src/src/components/FeedbackRoundPanel.jsx` / `.css` — the participant surface
- `src/src/utils/commentsClient.js` — the three calls, injectable
- tests, §13

**Modified**

- `lambda-functions/game/stage-beat.js` — `BEATS` gains `'feedback'`
- `lambda-functions/game/get-game-state.js` — read `StageBeat` against the
  closed set instead of an equality test (§1)
- `src/src/config/hostRemote.js` — the phone's RESULTS action must not offer to
  go backwards during a feedback round (§1)
- `lambda-functions/game/create-report.js` — comments into both reports
- `lambda-functions/{game,websocket,admin/shared}/tenant-crypto.js` — `comment`
  entity, all three, byte-identical
- `template-clean.yaml` — `CommentsFunction`, two routes, KMS + DDB + WS policies
- `src/src/config/hostControls.js` — `STAGE_BEATS`, `HOST_PHASES`,
  `HOST_INTENTS`, the `FIELD_NOTES` secondary and the `FEEDBACK` case
- `src/src/config/sessionHistory.js` — carry `comments` through `roundsFrom`
- `src/src/components/PastRound.jsx` — render `<RoundReport>`
- `src/src/PlayerPage.jsx` — the feedback branch
- `src/src/GameHostPage.jsx` — the `feedback` beat, the intent, comment fetch,
  and forwarding `totalComments` to `GameReport`
- `src/src/WebSocketClient.js` — `commentPosted`
- `src/src/components/GameReport.jsx` + `.css` — the comments block

**Deliberately not modified**

- `lambda-functions/{game,websocket}/anonymity.js` — the existing generic
  functions do the job; editing a byte-identical pair for no behavioural gain
  is pure drift risk.
- `round-kinds.js` and its mirror — §1.

## 13. Testing

House rule: every test is watched failing first, for the reason predicted, and
expected values are constructed independently — never compared against another
field of the same response.

**Backend** (`node tests/<file>.js`, no jest):

- `tests/feedback-round-beat.js` — `feedback` is in `BEATS`; the frontend mirror
  agrees; the endpoint accepts it, writes `StageBeat` with `UpdateCommand` (a
  `Put` would un-reveal), and broadcasts; an unknown beat is still a 400.
- `tests/round-comments.js` — SK format built from independently constructed
  parts; the three anchor kinds; the closed-set and numeric guards; the
  round-and-beat gate; the length ceiling; `ttl` is exactly 30 days asserted
  against a separately computed value; ordering by `commentId`.
- `tests/comment-report-integration.js` — comments reach `detailedQuestions[i]`
  and `gameStats.totalComments`, with the expected report built by hand from
  fixture rows rather than by re-reading the handler's own output.
- `tests/tenant-crypto.js` — extend: `Text`, `AnchorExcerpt`, `AnchorLabel`
  ciphertext at rest, `PlayerName` plaintext; the three copies still identical.
- `tests/template-validates.js` + `sam validate --lint` for the new function.

**Frontend** (`cd src && CI=true npx jest`):

- `roundReport.test.jsx` — `RoundReport` renders the three sections; anchors
  fire with the row's position on a tie; comments render under their anchor;
  no Regenerate without `onRegenerate`; read-only without `onComment`.
- `pastRound` regression — the host's DOM is unchanged by the extraction.
- `feedbackRound.test.jsx` — the player's beat branch, the composer, the
  attribution notice, the debounce.
- `hostControls` — the new secondary and the `FEEDBACK` case.
- `gameReport.test.jsx` — the comments block, and a **call-site** assertion that
  `GameHostPage` forwards `totalComments` (source-read, comment-stripped, the
  existing idiom — `GameHostPage` will not mount under jsdom).
- `roundReportPalette.test.js` — per `engage-design` §5: contrast composited up
  the ancestor chain, no hex outside the token block, no `color: var(--danger)`,
  nothing under the 12px floor, every selector rooted at the scope class. Named
  `*Palette*`, never `*Token*` — `.gitignore:35` is an unanchored `*token*`.

No geometric assertions anywhere; jsdom has no layout engine.

## 14. Design decisions that could defensibly have gone the other way

1. **Beat, not state, not round kind** (§1) — a separate round ordinal would
   orphan comments from the round report they must appear in.
2. **TTL 30 days** (§7) — the only tier where annotation and anchor share a fate.
3. **Extract `RoundReport` rather than reuse `PastRound` whole** (§4) — a modal
   is wrong for a participant's primary surface; a second renderer is forbidden.
4. **The question is not commentable** (§5) — the owner named three sections.
5. **Anchor by position, plus a stored label and excerpt** (§5) — rank ties, and
   a comment must be readable in a report without its round beside it.
6. **Comments are attributed, and the composer says so** (§8) — forced by
   `get-results.js`, but the disclosure is a choice.
7. **HTTP, not the WebSocket answer path** (§10) — a lost comment has no tally
   to reveal its absence.
8. **Participants comment; the host reads** (§3) — the host's surface is a
   projector. A host commenting from the stage is not a thing; the host sees
   comments arrive and can read them in `PastRound`.

## 15. Out of scope, and named

- **Comment moderation / deletion.** Not asked for. A host cannot remove a
  comment; the round can be closed by moving the beat.
- **Replies to comments.** The owner said comments on sections, not threads on
  comments. One level.
- **Comments on a *past* round's report.** The feedback round is opened on the
  round the room just heard. `PastRound` renders comments read-only for older
  rounds.
- **The host's phone remote as a comment composer.** It drives the beat; it does
  not compose.
- **Fixing `create-report.js`'s rebuild of `answers` from expired 7-day rows**
  (§7). A pre-existing defect this feature does not introduce and is not the
  place to repair. It is why `AnchorExcerpt` exists.

## 16. What review changed

The design was reviewed against the code before implementation, per the house
standard in `docs/handoff/public-library-2026-08-27.md` §5. It found seven
things, and the corrections are folded into the sections above rather than
listed as errata. Recorded here because several of them were *the design being
confidently wrong*, not merely incomplete:

1. **§1's central premise was false.** "The beat mechanism extends by adding one
   value" — three call sites collapse it to a binary, one of them server-side
   and upstream of the others. Two were in no file list.
2. **§7's TTL argument was factually wrong** in three ways, while reaching the
   right number. Rewritten, and the real conclusion (`AnchorExcerpt`, not the
   TTL, is what protects a comment's meaning) promoted.
3. **§2 crossed a written invariant** without noticing. Now re-argued
   explicitly, with the counter-argument stated.
4. **§8's redaction claim did not work**: `PlayerName` is not in `ANON_FIELDS`,
   so the future-proofing the section existed for would have been inert.
5. **§9 gave a true-sounding reason that does not apply** to this entity —
   `comment`'s sort key carries no name.
6. **The design never said how a participant obtains the report.** Both obvious
   routes were wrong; a third, minimum-privilege one was added.
7. **A round with only comments would vanish from the report**, comments
   included, with no error.

Verified as correct and left alone: the sort-key format against every existing
query in the codebase (no `begins_with(SK, 'COMMENT')` anywhere, every `GAME#`
query prefix-scoped, and `clear-all-games` deletes whole partitions, which is
right for comments); the `get-results.js:265` unconditional reveal; that
`detailedQuestions` encryption covers nested comment arrays with no per-node
handling; and that `roundsFrom` whitelists fields and will silently drop
`comments` unless told.
