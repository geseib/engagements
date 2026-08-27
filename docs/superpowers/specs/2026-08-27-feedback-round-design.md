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

Consequences, all of them good:

- No new state machine, no new route to open the round, no round renumbering.
- The host's phone remote drives it for free.
- A host page reload lands back in the feedback round rather than on the tally.
- Stepping back to `results` or `field-notes` closes the composer without
  destroying anything — comments are rows, not session state.

## 2. Where the control lives

`docs/design/host-redesign/09-field-notes.html` is the AI feedback phase — state
chip "WHAT WE HEARD", the AI's read-back, and a bottom bar reading
`SETUP | Discussion prompt on screen | ‹ Results | SPACE | Next Round`.

`src/src/config/hostControls.js` gives `FIELD_NOTES` a primary of **Next Page**
while pages remain and **Next Round** on the last page, and assigns a secondary
("Skip the rest") only in the first case. On the last page the secondary slot is
free, which is exactly where **Request feedback** goes:

- `HOST_PHASES` gains `'FEEDBACK'`.
- `HOST_INTENTS` gains `FEEDBACK: 'feedback'`.
- On `FIELD_NOTES`, last page: primary stays `Next Round`; secondary becomes
  `{ id: 'request-feedback', label: 'Request feedback', icon: 'ChatCircleText',
  intent: HOST_INTENTS.FEEDBACK }`.
- On `FEEDBACK`, the primary is `Next Round` and the secondary is
  `Back to what we heard`, so the host is never trapped in the new beat.

Advancing the round (`Next Round`) from the feedback beat is unchanged — the
next round's `ROUND#nnn` row is a different row and opens on its own tally, the
property `stage-beat.js` already guarantees by keying the beat per round.

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
| `PlayerName`, `playerName`, `name` | author, three spellings — see §8 |
| `SubmittedAt` | ISO |
| `ttl` | 30 days — see §7 |

`AnchorKind` is validated against a closed set before it becomes part of an SK,
and `QuestionNumber` against `/^\d+$/` before padding — the same guard, for the
same reason, that `stage-beat.js:147` and `reveal-authors.js:73` already apply:
anything else writes a row nothing will ever read again.

## 7. TTL — 30 days, and why not 7 or 90

The table's TTLs are not arbitrary; they are three tiers.

| Tier | Rows | TTL |
|---|---|---|
| session scaffolding | `METADATA`, `STATE`, reservation, `QUEUE` | 90 days |
| **durable content** | `#AISummary`, `#RESULTS` (call-and-answer), `REPORT`, `PLAYER#…#SCORE` | **30 days** |
| raw inputs to a tally | `#ANSWER#`, `#VOTE#`, `PLAYER#` | 7 days |

A comment sits in the middle tier, and the brief's test — *"a comment that
outlives or predeceases the thing it comments on is a bug"* — picks the value
outright:

- **7 days is wrong.** The comment would expire while the AI summary and the
  results row it points at (both 30d) are still there, and while the `REPORT`
  row that must contain it (30d) is still being served. A report rebuilt on day
  8 would render every section with its comments silently missing — a
  disappearing annotation with no error anywhere.
- **90 days is wrong in the other direction.** The comment would outlive its
  anchor: on day 40 the summary, the results and the report are gone, and what
  survives is prose about material that no longer exists. `AnchorExcerpt` makes
  that legible rather than meaningless, but a dangling annotation is still not
  something to design for on purpose.
- **30 days is the only value where the annotation and the thing annotated
  share a fate.** A comment is readable for exactly as long as the report that
  is required to contain it.

A comment never annotates the raw `#ANSWER#` row (7d). It annotates a response
*as it appears in the results row and the report*, both of which are 30 days.

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
   it returns true, redacts with the existing `redactAnswers` — which strips
   exactly `['playerId', 'playerName', 'name']`, which is exactly what a comment
   carries. Today that branch never fires. It costs nothing, and it means that
   if the reveal semantics ever change, comments redact *with* responses instead
   of becoming the one surface in the product that leaks names. `anonymity.js`
   is byte-identical across two directories under a drift guard, so it is
   **not modified** — the existing generic functions are called as they are.

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
/** A comment on one section of a round's report:
 *  SK=COMMENT#<nnn>#<anchorKind>#<anchorRef>#<commentId>.
 *  `AnchorExcerpt` is a verbatim slice of the material being commented on —
 *  it is the same content as `Answer` or `SummaryText` and is encrypted for
 *  the same reason. `PlayerName` stays plaintext exactly as it does on
 *  `answer`: it is in the SK and cannot be hidden there, and the concession
 *  the privacy page makes is identifiers visible, content not. */
comment: Object.freeze(['Text', 'AnchorExcerpt', 'AnchorLabel']),
```

`AnchorLabel` is included because for a `response` anchor it may be a
participant's name once attributed ("Response 3 — Dana Whitfield").

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

- Query `begins_with(SK, 'COMMENT#')` alongside the existing prefixes, decrypt,
  group by round number.
- Each `detailedQuestions[i]` gains `comments: [{commentId, anchorKind,
  anchorRef, anchorLabel, anchorExcerpt, text, playerName?, submittedAt}]`,
  sorted by `submittedAt`. `playerName` is **absent, never null** when hidden —
  the same rule the file already applies to answers at `:344-354`, so
  `displayLabelFor` reads it correctly with no new logic.
- `gameStats` gains `totalComments`.

"Clearly called out as comments" is a rendering requirement in three places:

1. `RoundReport` — comments render under their anchor in a block headed
   **Comments**, visually distinct from `past-round__answers`.
2. `GameReport.jsx` — each round's section gains a `report-comments` block with
   a "Comments" heading, each comment prefixed by the anchor it is on
   ("On Response 3:"). This is also the print sheet, so the block gets the same
   `report-keep` break treatment the answers have.
3. **`GameHostPage.jsx` must forward it.** `GameReport`'s `reportData` is
   rebuilt from scratch at `GameHostPage.jsx:~4336`, and the file carries a
   comment saying anything not explicitly forwarded there is invisible to the
   report no matter what the backend sends. `questions: report.detailedQuestions`
   already carries the nested comments; `totalComments` must be added
   explicitly.

`config/sessionHistory.js`'s `roundsFrom()` must carry `comments` through, or
the host's `PastRound` shows none.

## 12. Files

**New**

- `lambda-functions/game/comments.js`
- `src/src/components/RoundReport.jsx` (extracted from `PastRound`)
- `src/src/components/RoundReport.css` (comment blocks only; the report body
  keeps its existing rules in `styles.css`)
- `src/src/config/comments.js` (anchor vocabulary + label helpers, shared by
  player and host)
- tests, §13

**Modified**

- `lambda-functions/game/stage-beat.js` — `BEATS` gains `'feedback'`
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
