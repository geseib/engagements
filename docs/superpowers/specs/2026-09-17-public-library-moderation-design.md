# The public library: sharing, moderation, reports and content notices

**Date:** 2026-09-17. **Status:** approved design, awaiting an implementation plan.
**Supersedes** the UI and moderation sections of
[`2026-08-25-public-library-design.md`](2026-08-25-public-library-design.md); that spec's
§0–§2 (publish is a copy; review state is a row per version; four outcomes) and its
handoff's §2 decisions ([`docs/handoff/public-library-2026-08-27.md`](../../handoff/public-library-2026-08-27.md))
still bind and are not restated here. **Prompts are out of this document entirely** — the
owner: *"sets first. prompts need way more review."*

The mockups are the design: `docs/design/tenancy-redesign/05-share-review.html`,
`06-share-rejected.html`, `07-public-library.html`, `11-moderation.html`. Where this
document departs from one it says so and why. Serve them with
`python3 -m http.server 8124 --directory docs/design`; press **N** to hide the notes.

This design was reviewed by a separate agent before approval. Its findings are folded in
and marked **[R#]** where the design changed because of one, so the next reader can tell a
decision from a correction.

---

## 0. The decisions, and what already exists

### Owner decisions (settled — critique the execution, not the call)

| # | Decision |
|---|---|
| D1 | Approval is **as drawn**: the automated check publishes on pass; a person sees only what escalated, was appealed, or was reported. |
| D2 | Engage staff, in platform mode, **decide the queue and can take down** anything already public. |
| D3 | The check is a **job** (the `generation-jobs.js` pattern), not a request. |
| D4 | The moderation queue is a **pointer partition**, found by Query. No index. |
| D5 | **Sets only.** The one prompt-shaped rule kept: a public copy never references an org Workie. |
| D6 | On `07`: no "Copied N times" column (nothing counts copies), and the format chips become the `ListControls` selects every list uses. |
| D7 | Every review is a **record** (§4); anyone signed in can **report** a public or Engage set (§6); a reviewer can approve **with a content notice** that a host must acknowledge at setup and at start (§7). |
| D8 | An org admin may clear an inherited content notice on their **own private copy** (logged); notices on public and Engage rows are staff-only. |
| D9 | A snapshot is deleted on reject/dismiss; a 30-day S3 lifecycle is the backstop; a passed snapshot *is* the public copy. |
| D10 | "You'll hear back" is a **row state plus a nav badge**. No email in this book. |
| D11 | Takedown writes a **metadata-only, conditional** stamp on the org's set row, and it is logged — it is how the author learns why. |
| D12 | The **audience** sees the content notice too: on the join screen and on the stage's first card. |
| D13 | **Players do not report** in this book; the store and queue are shaped so a player entry point is additive. |
| D14 | Acknowledgment is asked at **setup and at start** in the UI; the server is **hard at create, soft at start** (§7.4). |

### Already built (verified 2026-09-17, on `dev` and `test`)

- `admin/shared/set-review.js` — `REVIEW` and `PUBLISHED` rows per version; statuses
  `unreviewed` (absence) · `checking` · `passed` · `flagged` · `escalated` · `appealed`;
  `mayPublish` is true only for `passed`. `writeReview` is a full-row Put (`:113`).
- `admin/shared/content-guardrail.js` — Bedrock `ApplyGuardrail`, one call per question,
  `SET_CATEGORIES = VIOLENCE, SEXUAL, HATE, INSULTS, MISCONDUCT` (`:69`). Bands: HIGH →
  flagged, MEDIUM → escalated, LOW/NONE → passed. Errors, an empty set and an unconfigured
  guardrail all escalate. Returns `{type, band}` per finding — **no prose**.
- `admin/check-question-set.js` — `POST /question-sets/{setId}/check {version}`,
  synchronous, sends **only** `Title` and `Detail` (`:97-104`; `plain.answerDetails` reads a
  field stored as `AnswerDetails`, so reveals are never checked) **[R1]**.
- `admin/publish-question-set.js` — decrypted snapshot copy of a passed version into the
  public scope; stable public id `<orgIdStripped>-<setId>` (`:73`); stamps
  `sourceOrgId/sourceSetId/sourceVersion` (`:171-173`); per-row sequential deletes on
  unpublish (`:220`). Caller: org admin/owner; a personal-space owner qualifies.
- `admin/copy-question-set.js` — copies a public/platform set into an org as a new
  unversioned set; copies start unreviewed (`1936901f`); carries `sourceScope` (`:172`).
- `admin/get-set-versions.js` — projects `review` and `reviewFindings` per version.
- `admin/get-question-sets.js`, `admin/get-ai-prompts.js` — list ORG → PLATFORM → PUBLIC;
  `src/src/utils/setOwnerTag.js` tags rows Yours / Team / Engage / Public.
- `admin/shared/tenant.js` — `canManageScope`: platform = staff **and** platform mode;
  **public = nobody directly**; org = member at or above `minRole`. `readableScopes` gives
  every account PLATFORM + PUBLIC.
- `admin/shared/generation-jobs.js` + `generation-handler.js` — the job pattern: `AIJOBS`
  partition, `createJob` → self-invoke (`InvocationType: 'Event'`) → 900s worker →
  client polls (`src/src/utils/generationJob.js`, `components/GenerationJobPanel.jsx`).
  The GET returns **any** job to **any** caller holding its id (`generation-handler.js:272-276`) **[R4]**.
- `auth/authorizer.js` — `PUBLISH_ROUTE = /^question-sets\/[^/]+\/(publish|check)$/`
  (`:473`); after it, `path.includes('games')` and `path.includes('join'|'answer'|'vote')`
  are **fail-open** (`:550-558`, `hasPermission([], …)` is true at `:209-212`) **[R3]**.
- `src/src/config/consoleSections.js` — `library` (org consoles) and `moderation` (platform)
  sections exist; `AdminPage.jsx` renders placeholder paragraphs for both (`:1745-1770`).
- `src/src/components/PrivacyPanel.jsx` renders an access log from `log.entries`
  (`{who:{kind,name}, what, reason, touched, when}`, `:68-122`); **nothing writes one** and
  there is no reader endpoint.
- The table has no GSIs. Org content is ciphertext per tenant; public and platform content
  is plaintext. The product sends no email. `shared/usage.js` has a per-org ledger with
  `recordSetCount` / `countSets` (`:222-269`). `shared/ddb-delete.js` batches deletes.

---

## 1. Scope

**In:** everything a question set needs to be shared, checked, decided, recorded, reported,
labelled and used — backend, screens, tests, deployed to dev and then test.

**Out, deliberately:** prompts (D5); email (D10); players reporting (D13); a copy counter;
re-checking already-public content when the guardrail configuration changes; Stripe; any
prod deploy. Each is listed in §12 with what would change if it came in.

**Stages** (§11) — the first two form the first implementation plan:

1. The pipeline made honest: what the check reads, the job, the lock, the record, the share
   stamp, the authorizer, the share dialog, the list column, the needs-changes state.
2. The queue, the decision, the snapshot, takedown, the score card, the staff public library,
   the org public library.
3. Reports.
4. Content notices and acknowledgments, host and audience.
5. The access log writer and reader.

---

## 2. The lifecycle

One author action — **Submit for review** — on a version, from the set editor's Versions
panel or the list row. It creates a check job and returns `202 {jobId}`. The worker:

```
checking ──guardrail per question──▶ passed     → publish, in the same worker run
                                   ▶ flagged    → the author sees 06
                                   ▶ escalated  → queue row; a person decides
flagged ──author: "Ask for a human review"──▶ appealed → queue row
escalated | appealed ──staff──▶ passed (+ publish)  |  flagged (+ staff note)
public ──anyone: report──▶ queue row (reason: reported) ──staff──▶ dismiss | take down | keep with a notice
public ──org admin: unpublish | staff: take down──▶ not public; taken-down versions read as flagged with the staff note
```

`escalated` **blocks** — `11` is a queue of sets "waiting for a person", not a notification.
No new states. **The worker publishes on pass** because `05` promises "if it passes, the
set appears in the public library" and a browser closed mid-poll must not leave a
passed-but-unpublished set. The job row stores the caller (`callerUserId`, `callerOrgId`,
role at submit time) and the POST is gated on org admin/owner before any job exists, so the
worker acts with an authority checked up front.

---

## 3. Data

Partition keys come from the helpers in `tenant.js` / `set-version.js`, never literals
(`tests/no-global-partition-literals.js`). New partitions are named here once and declared
in `tenant.js` beside the others.

### 3.1 The `share` stamp on the org set's METADATA row **[R12]**

```
share: { version, status, at, publicSetId, publicVersion, note, contentHash }
```

Written by the worker (`checking`, then the outcome), by the decision, by publish, by
unpublish and by takedown. It is the **list's cache**: "Who can see it" (§9.3) reads it
and nothing else, so the list does not become one `REVIEW` read per version per set. The
per-version `REVIEW` row **stays the gate** and the per-version `PUBLISHED` row stays the
fact the Versions panel reads. `note` is the staff note (reject / takedown), a separate
field from anything a reporter wrote **[R11]**. It is plaintext metadata: the stamp is
written with `UpdateCommand` on named attributes and never by a read-modify-write Put of
the row, so platform-mode takedown can write it without holding the org key and without
touching anything else on the row (D11) **[R7]**.

### 3.2 The queue — `PK = MODERATION` **[R5][R14]**

```
PK = MODERATION
SK = <orgId>#<setId>#v<n>          org-authored          (stable: a repeat report bumps, never re-keys)
SK = PLATFORM#<setId>              Engage's own set      (reports only)
SK = PUBLIC#<publicSetId>          a public copy         (reports only)
attributes: reasons: Set<'escalated'|'appealed'|'reported'>, waitingSince, latestAt,
            orgId, orgName, setId, title, version, gameType, questionCount,
            bands: { category: band } for the uncertain questions,
            uncertainQuestionIds: [...], appealMessage,
            reports: { count, byType: { <type>: n } },
            snapshotKey                                  (S3, §3.3)
```

Rows are **≤4KB pointers**. A Query on the partition returns the whole queue; at tens of
rows it is sorted by `waitingSince` in memory. **No TTL** — a queue row must not vanish;
an alarm on the oldest `waitingSince` is the safeguard. Deleted by the decision.

### 3.3 The snapshot — S3, not DynamoDB **[R5][R6]**

The worker already holds the decrypted questions to run the guardrail. It writes them —
metadata's publishable fields, category names, every question's publishable fields, and
the per-question findings — as one object:

```
s3://<AIPromptsBucket>/moderation/<orgId>/<setId>/v<n>/<checkedAt>.json
```

under the admin functions' existing bucket grant, with a **30-day lifecycle rule** as the
backstop (D9). The reviewer reads the snapshot; approve **publishes from the snapshot**
(§5.1), which makes "approve exactly what was reviewed" literal and means approve never
decrypts the org partition. On reject or dismiss the decision handler deletes the object
(D9). A passed snapshot is what became the public copy and needs no separate retention.

### 3.4 The review log — `PK = REVIEWLOG#<scope>#<orgId|->#<setId>`

Append-only, platform-owned, plaintext, one row per event:

```
SK = <ISO>#<seq>#<event>
event ∈ checked | escalated | appealed | decided | reported | taken-down | unpublished |
        republished | notice-set | notice-cleared | access
```

`checked` carries version, outcome, per-question `{questionId, category, band}` and the
`contentHash`; `appealed` the author's message; `decided` the reviewer's username, the
decision, the note and the notice; `reported` the type, the note (as stored, §6.2), the
question number and the reporting **org id** — never the reporter's name to anyone but
staff; `notice-cleared` the org admin who cleared an inherited notice (D8). It holds
**nothing an author has not already asked to make public**, except the report text, which
is the reporter's. No TTL: it is the record.

### 3.5 Report counts on the set row

`reports: { count, lastAt, byType }` on the public or platform set's METADATA row, atomic
`ADD`, so lists show "3 reports" without reading the log. A dedupe row per
`(account, set)` — `PK = REPORTS#<setKey>`, `SK = <userId>`, 90-day TTL — makes a repeat an
update, not a second report.

### 3.6 Content notices on the set row

`sensitivity: [id, …]` on the public or platform set's METADATA row; carried onto the org
copy by `copy-question-set.js` (with `sensitivitySource: publicSetId`); recorded in the
log. `edit-question-set.js` ignores `sensitivity` in an org payload **unless** the row's
`sensitivitySource` names the copy's origin and the caller is org admin/owner — that is the
D8 clearance, and it logs `notice-cleared`. New versions of an org's own set keep the tag;
re-publishing keeps it unless a reviewer changes it.

### 3.7 The acknowledgment on the game row

`contentNotice: { ids, ackAtCreate: {at, by}, ackAtStart: {at, by} | null }` on
`GAME#<id>/METADATA`, written by create and start (§7.4).

---

## 4. The check, made honest

### 4.1 `publishableText()` — one module, three readers **[R1]**

`admin/shared/publishable.js` defines, for a set, exactly the text that leaves the org when
it is published — and the check judges **that**, the record hashes **that**, and publish
copies **that**. Per question: `Title`, `Detail`, `AnswerDetails`, `OptionA..F`,
`CustomInstructions` (whatever of these the game type carries). Set level: `name`,
`description`, `customInstruction`, `aiContextInstruction`, `roundKindBrief` (the editable
`OPTIONAL_FIELDS` of `edit-question-set.js:44`), and every category `Name`. The set-level
text is evaluated as one extra subject (`(set)`), so a rude description cannot ride a
clean question list.

**Images escalate.** A version with any image row is sent to a person with the reason
`images`, because the guardrail's text categories cannot see them. The snapshot records
the image keys and the review modal renders them the way the editor's media panel does,
so the person deciding sees what the room would. Whether publish already carries the
image objects to a public prefix is verified in the plan; if it does not, stage 2 adds
that copy, since a public set whose images live under an org prefix is not public.
Enabling the guardrail's image modality is a later change and does not alter the state
machine.

**The Workie pin.** No row stores a `promptScope`, so "is this an org Workie" is one
`GetItem` on the platform `AIPROMPTS/AIPROMPT#<promptId>`: if absent, the public copy drops
`promptId` and records `promptDropped: true`; the share dialog says so *before* Submit.

### 4.2 The job **[D3]**

`check-question-set.js` takes the three-mode dispatch the AI builders use
(`shared/generation-handler.js` shape): POST creates the job (`kind: 'set-check'`,
`request: {setId, version, publish, declaredNotice}`, caller) and self-invokes; `GET
…/check/{jobId}` polls; `__workerMode` works. **The poll is tenant-scoped**: it returns 404
unless `callerOrgId(event)` equals the job's `callerOrgId` **[R4]**. Job `items` carry
`{questionId, category, band}` and never question text, so a leaked jobId discloses only
that a question exists.

**The lock** **[R13]**: the `checking` write is a conditional Put on the `REVIEW` row
(`attribute_not_exists(status) OR status <> :checking OR checkedAt < :stale`, stale =
15 minutes). A second submit while one runs is refused with 409 and the dialog says
"already being checked". A `checking` older than 15 minutes is rendered everywhere as
"didn't finish — submit again", never as in-progress.

**The budget**: per question, `context.getRemainingTimeInMillis()` is checked; a set that
would overrun stops cleanly and escalates with the reason `timeout` — the outcome still
lands in the row. Guardrail calls are recorded as units on the org's usage ledger
(`shared/usage.js`) and submits are capped per org per day (config, default 20).

### 4.3 The findings, and the sentence `06` promises **[R8]**

Bedrock returns a category and a band. `06` shows a sentence that separates *what was
flagged* from *the subject* ("asking a room to describe injuries in detail is the part that
was flagged, not the safety topic"), and its rationale calls that sentence load-bearing:
without it the author concludes the checker is broken. So for **flagged and escalated
questions only** — a handful per set — the worker makes one Haiku call per question to
write `findings[].explanation` (≤ 240 chars, plain text), with the band sentence as the
fallback when the call fails. The explanation is shown to the author (their own content)
and to the reviewer; it is rendered as text, never as markup.

### 4.4 The declared notice

`05` gains a checkbox: *"This set deliberately contains material some rooms won't expect"*
with the notice picker (§7.1). A declared notice routes the version to a person
**whatever the check says** (`reason: 'declared'`), so a legitimate-but-graphic set gets a
human label instead of a machine refusal.

---

## 5. Publish, unpublish, takedown

### 5.1 One publish routine, two callers

`publish-question-set.js`'s copy becomes `admin/shared/publish-set.js`:
`publishFromSnapshot(db, s3, snapshotKey, target)`. The worker calls it on pass; the
decision calls it on approve. Both publish **what was reviewed** (§3.3). It writes the
public partition (metadata, categories, questions — plaintext), stamps
`sourceOrgId / sourceOrgName / sourceSetId / sourceVersion` **[R15]**, writes the
version's `PUBLISHED` row, updates the org row's `share` stamp, and appends `republished`
or `checked` to the log. The `contentHash` (sha256 over the canonical JSON of the
snapshot) is stored on `REVIEW`, in the log and on the public row — **a fact for the
record, not a gate** **[R2]**: publishing from the snapshot is what guarantees the
reviewed content is the published content.

### 5.2 Unpublish (org admin/owner) and takedown (staff)

`DELETE /question-sets/{setId}/publish` is unchanged in authority and now deletes the
public partition with `shared/ddb-delete.js` batches **[R7]** — five public versions of a
200-question set were 1,000 sequential deletes against a 30s ceiling. It writes the
`share` stamp `{status: 'unpublished', at}`, leaves the version's `REVIEW` row at `passed`
(the org may share again without a re-check while the content is unchanged — the next
submit re-checks anyway), deletes any open queue row for the set, and logs `unpublished`.
"Who can see it" reads *Private* again.

`DELETE /admin/public-library/{publicSetId}` (staff, platform mode) reads `source*` off the
public row, deletes the public partition, appends `taken-down` with the note to the log,
and writes the org row's `share` stamp `{status: 'flagged', note, at}` with a condition on
`share.publicSetId = :id` (D11). **It never touches the org's `REVIEW` row** — a Put there
would erase the org's own findings and hash. The author's editor reads the note from the
stamp and renders `06`.

---

## 6. Moderation and reports

### 6.1 The queue and the decision

`GET /admin/moderation` — Query `PK = MODERATION`, sorted oldest-first in memory.
`GET /admin/moderation/{sk}` — the pointer plus the snapshot's contents (uncertain
questions first). Opening it writes an `access` event (§8).
`POST /admin/moderation/decide {sk, decision, note, notice}`:

| decision | writes |
|---|---|
| `approve` | `REVIEW` ← `passed` (reviewer, note, notice); publish from the snapshot; `sensitivity` on the public row; log `decided`; delete the queue row |
| `reject` | `REVIEW` ← `flagged` (note kept separate from findings); `share` stamp; delete the snapshot; log; delete the queue row |
| `dismiss` (reported rows) | log `decided:dismiss`; counts kept; a cooldown row so the same type from the same account cannot re-queue it for 7 days **[R11]** |
| `take down` (reported rows) | §5.2 |
| `keep with a notice` (reported rows) | `sensitivity` on the public row; log `notice-set`; delete the queue row |

All staff-only, platform mode, exact-match routes under `/admin/`. The decision's REVIEW
write is a conditional Put on `status IN (escalated, appealed)` so two reviewers cannot
both decide.

### 6.2 Reports **[R11]**

`POST /question-sets/{setId}/report {type, note, questionNumber}` for a public or Engage
set (scope resolved by `findSetForCaller`; an org's own private set is refused — report
your own team's content to your own admin). Any signed-in account.

- `type` from the fixed list: `inaccurate` · `offensive` · `graphic` · `dangerous` ·
  `copyright` · `low-quality` · `other`.
- `note` ≤ 500 chars; email addresses and URLs stripped before storage.
- One open report per `(account, set)`; a repeat updates it. **Caps:** 10 open reports per
  account, 20 per account per day; the endpoint answers 429 with the reason.
- Effect: log `reported`, `ADD reports.count`, queue row created or bumped
  (`reasons ∪ {reported}`, `reports.byType`). The reporter's identity is visible to staff
  in the log and nowhere else; the author never sees it or the note.

---

## 7. Content notices

### 7.1 The vocabulary — one module, mirrored, pinned

`admin/shared/content-notices.js` and `src/src/config/contentNotices.js`, byte-for-byte the
same table, pinned by a drift test (`tests/content-notices-parity.js`, the shape of
`tests/tenant-crypto.js` §8):

| id | label | the sentence a host reads |
|---|---|---|
| `graphic-medical` | Graphic medical detail | This set describes injuries, procedures or symptoms in clinical detail. |
| `violence` | Violence or injury | This set depicts violence or serious injury. |
| `mature-language` | Mature language | This set contains strong language. |
| `sexual-content` | Sexual content | This set refers to sexual content. |
| `substance-use` | Substance use | This set discusses drugs or alcohol in detail. |
| `self-harm` | Self-harm | This set refers to self-harm or suicide. |
| `distressing-events` | Distressing real events | This set covers real events some people will find distressing. |

### 7.2 Who sets it

The reviewer on approve ("Approve with a content notice") or later from the score card;
the author at submission (§4.4). An org admin may clear an inherited notice on their own
copy (D8, §3.6).

### 7.3 Where it shows

A "Content notice" chip on the set row in the list, the public library, the Versions panel
and the score card, its `title` carrying the labels (a reduction with recovery).

### 7.4 Where it bites — hard at create, soft at start (D14)

- **Setup.** `GameSetupDialog` shows the sentences when the picked set carries notices;
  **Create stays disabled** until *"I've read this and it's right for this room"* is ticked.
  `websocket/create-game.js` (which already resolves the set) **refuses with 409
  `{contentNotice: [ids]}`** when the set is tagged and the body carries no
  `acknowledgeContentNotice: true`; the ack is written to the game row (§3.7).
- **Start.** The host's Start shows the sentences again as a one-click "Start anyway"
  (a small `Modal`), and the request carries the ack. `start-game.js` **refuses only a
  game whose row has no acknowledgment at all** — one created straight through the API —
  and otherwise records `ackAtStart` when present and starts either way. So the UI asks
  twice, the server guarantees once, and a stale bundle can never strand a host with a
  room waiting. This is the "never gate a running session" rule applied one step earlier.
- **The audience** (D12). The join screen shows the sentence(s) under the session title;
  the stage's first card — before the first question — shows them for one beat as a plain
  title card. No acknowledgment is asked of a participant.

---

## 8. The access log — the promise `11` makes **[R6]**

`11`: *"The organisation sees an entry in their access log naming you — because they asked
for it to be published, not because you looked."* The log has a renderer and no writer.
This book adds the writer and the reader, minimally:

- **Writer:** `GET /admin/moderation/{sk}` (opening a snapshot) and `decide` append
  `PK = ORG#<orgId>#ACCESS`, `SK = <ISO>#<seq>` —
  `{who: {kind: 'engage', name: callerUsername}, what, reason: 'submitted for review',
  touched: {setId, version}, when}` — idempotent per reviewer / set / day. The same row is
  appended to the review log as `access` (§3.4).
- **Reader:** `GET /orgs/{orgId}/access-log` (org admin/owner), newest first, paged;
  `AdminPage.jsx:1796` passes it to `<PrivacyPanel log={…}>`.

Support access outside this pipeline (the break-glass grant) stays unbuilt.

---

## 9. Routes and permissions

| route | who | notes |
|---|---|---|
| `POST /question-sets/{setId}/check` | org admin/owner | creates the job; 409 while one runs |
| `GET /question-sets/{setId}/check/{jobId}` | same org as the job | 404 otherwise **[R4]** |
| `POST /question-sets/{setId}/appeal` | org admin/owner | only from `flagged` |
| `POST /question-sets/{setId}/report` | any signed-in account | public/platform sets only; caps |
| `DELETE /question-sets/{setId}/publish` | org admin/owner | batch deletes |
| `GET /admin/moderation`, `GET /admin/moderation/{sk}`, `POST /admin/moderation/decide` | `admins` **and** platform mode | exact-match |
| `DELETE /admin/public-library/{publicSetId}` | `admins` **and** platform mode | takedown |
| `GET /orgs/{orgId}/access-log` | org admin/owner | §8 |

**The authorizer** **[R3]**: `PUBLISH_ROUTE` becomes
`^question-sets\/[^/]+\/(publish|check(\/[A-Za-z0-9_-]+)?|appeal|report)$`, and each new
template string is listed beside it. `tests/authorizer-*.js` gain cases whose set ids
contain `join`, `answer`, `vote` and `games` (e.g. `callandanswer`, `partygames`), asserting
every new route requires a group — the exact ids that today fall through to the open rules.
`GET /orgs/{orgId}/access-log` is org-scoped through
`canManageScope(event, ORG, orgId, 'admin')`, the rule publish already uses. The queue
SK travels in the `{sk}` path parameter percent-encoded (`#` → `%23`); handlers decode it
and refuse anything that does not parse back into one of §3.2's three shapes.

**Template:** eight routes; the check function gains the self-invoke grant, the S3 put/get/
delete on the moderation prefix, and Bedrock InvokeModel for Haiku (§4.3); the decide and
takedown functions gain the S3 get/delete; the moderation prefix gets the lifecycle rule.
No new request header, so `AllowHeaders` is untouched (`tests/cors-allows-sent-headers.js`
proves it). `tests/kms-grants-match-code.js` fails the moment a function that requires
`tenant-crypto` lacks the grant, which is the order to do things in.

---

## 10. Screens

Every screen is built on the shipped idiom (`.claude/skills/engage-design/SKILL.md`):
one namespaced stylesheet per screen, tokens only, measured contrast, tables not cards,
one `Modal`, X and bottom exit through one `requestClose()`, `resolvedTab` on every gate.

### 10.1 Share — `05`

A `Modal` from the list row and the Versions panel. The mockup's copy verbatim, plus: the
version being shared; *"Published without your Workie — Engage's default is used"* when
the pin will be dropped; the declared-notice checkbox and picker (§4.4). Submit turns the
dialog into the `GenerationJobPanel` shape ("Checking 12 of 30"). Outcome in place:
passed → *"Now in the public library"*; escalated → *"Gone to a person at Engage. The
outcome will show on this set's row."* (**copy change** from "you'll hear back", D10);
flagged → closes onto §10.2. Closing keeps the job running. A 409 (already checking)
renders as a sentence, not an error.

### 10.2 Needs changes — `06`

The editor's state when the `share` stamp says `flagged` (from the check, a rejection or a
takedown — the staff note goes first in the banner). Banner, the flagged questions each
with its `explanation` (§4.3) and "Edit Q14" focusing the row, "the other 28 passed",
**Resubmit** in the head, and *"Ask for a human review"* → `appealed` → the banner reads
*"Waiting for a person at Engage"*. A new component (`.srev`), **token-only, contrast
measured on both grounds**, because the editor is still part-paper on the monolith
stylesheet (`docs/design/AUDIT.md:176`); a dusk island inside it would be the defect the
player shell just had removed, mirrored.

### 10.3 The list column and the Versions panel

`QuestionSetsPanel` gains **Who can see it**, in org consoles only, read from the `share`
stamp: *Private · Public v2 · Public, behind (v3 not shared) · Checking… · Didn't finish ·
Needs changes · Waiting for Engage*, and the Content notice chip. The Versions panel shows
per-version chips from `review` + `PUBLISHED`: `v2 · public`, `v3 · flagged`, `v3 ·
checking`. A nav badge on Question sets counts sets in `flagged` (D10).

### 10.4 The public library — `07`

Org consoles: the `library` section renders `QuestionSetsPanel` reading the public scope —
"by Meridian Delivery" from `sourceOrgName`, Copy is the shipped `onCopy`, Preview opens
the read-only editor, **Report a problem** (§10.6). Overrides (D6): no copies column; the
`ListControls` selects. The *"your own published sets appear here too"* note stays.

Platform console: a new **Public library** section (`publiclibrary`, between Shared library
and Moderation): the same table with **Unpublish** as the row action behind a small `Modal`
that states the consequence — gone for everyone; the organisation keeps their copy and
sees your note — with a required note. Rows link to the score card. No mockup; it is `07`
with one action changed.

### 10.5 Moderation — `11` — and the score card

`ModerationPanel` (`.modq`). Head: *"N sets the check would not decide on its own. Oldest
has waited 2 days."* Table: set (title, format · N questions), organisation, why —
**band words**, *"Appealed: <message>"*, *"Reported ×3 · graphic (2), inaccurate (1)"*,
*"Declared: graphic medical detail"*, *"Images"* — waiting, Review. The disclosure note
stays. Empty state: *"Nothing is waiting — the check decided everything on its own."*

Review opens a full-height `Modal`: the snapshot's questions, **uncertain and reported
questions first** with category, band and explanation, the reporter's types and notes
(never names), a note field, and the decisions of §6.1 as buttons; "Approve with a content
notice" opens the picker inline (never a modal from a modal).

**The score card** (`.scard`) is a *place* in the platform console the way the set
editor is a place in the org console — the work area shows it when a row is chosen, with
the breadcrumb back to the list; it is not a modal (it holds a table and a timeline).
Identity and standing — *"Public
v2 · approved by Dai, 19 Aug · content notice: graphic medical detail · 3 reports"* — the
timeline from the review log, reports by type, the latest check's per-question findings
with the uncertain ones first, and the notice editor for staff. Reached from every queue
row, from the staff Public library, and from the Shared library for Engage's own sets.

### 10.6 Report a problem

A small `Modal` from any row badged Engage or Public — library, list, setup dialog: the
type as a radio list (§6.2), the optional note, the optional question number, Send. A 429
renders as its reason. Success: *"Sent to Engage. You won't be named to the author."*

### 10.7 Setup, start, join, stage

`GameSetupDialog`: the notice block with the sentences and the required checkbox (§7.4).
`GameHostPage` Start: the "Start anyway" `Modal`. Join screen: the sentence(s) under the
title. Stage: the first card, one beat, plain — the stage's own ladder, not the console's.

---

## 11. Error handling and edge cases

- A worker crash mid-check: the lock's 15-minute staleness turns `checking` into "didn't
  finish — submit again"; re-running overwrites the same row. No partial publish is
  possible: publish runs only after the outcome row is written.
- A 504 cannot occur: the POST returns in milliseconds; the worker has 900s and a budget.
- Two reviewers decide at once: the conditional Put refuses the second; the screen says
  "already decided by X".
- Approve after the org deleted the set or the version: publish from the snapshot still
  succeeds (the snapshot is self-contained); the `share` stamp update is conditional and
  simply does not apply; the log records it.
- A report on a set that is unpublished meanwhile: accepted, logged, no queue row (nothing
  to decide); the count stays on the platform copy's history.
- A declared notice plus a clean check: escalated with `reason: declared`; the reviewer's
  only real question is the label.
- Takedown of a set copied by other orgs: their copies are theirs (copies are independent
  by design); the notice, if any, travels with the copy; nothing else propagates.
- Unpublish by the org while a report is open: the queue row is deleted (nothing to
  decide) and the log says so.
- A stale bundle at start: §7.4 — the server starts a game that has any ack.
- Snapshot upload fails: the check escalates with `reason: snapshot`; nothing publishes.

---

## 12. Testing

The bar from the handoff stands: **every test is watched failing first.** Baselines
(backend suite count and pass count, frontend suites/tests, lint, build) are recorded in
the plan before the first change and held at every push.

**Backend (`tests/*.js`, node):**
- `publishable-text.js` — the module's output for every game type; a fixture with
  `AnswerDetails`, options, instructions, set prose and category names asserts each reaches
  the guardrail and the hash and the copy (the [R1] regression).
- `set-check-job.js` — three-mode dispatch, the lock (second POST → 409; stale → allowed),
  the budget (escalates with `timeout`), tenant-scoped poll (other org → 404), items carry
  no text, explanations only for flagged/escalated, declared → escalated, images →
  escalated, pass → published in the same run.
- `moderation-queue.js` — pointer size ≤ 4KB, stable SK, bump on repeat, decide branches
  and their writes, conditional decide, snapshot deleted on reject/dismiss, publish from
  snapshot equals reviewed content byte-for-byte, org partition untouched on approve.
- `takedown.js` — public partition gone, org `REVIEW` row **unchanged**, stamp written
  conditionally, log entry, batch deletes (a 200-question × 5-version fixture).
- `reports.js` — caps, dedupe, note stripping, reporter identity absent from every
  non-staff response, own-org refused.
- `content-notices-parity.js` — the two vocabularies are identical; `create-game` 409s
  without the ack; `start-game` refuses only a game with no ack; copy carries the notice;
  org edit clears it only on an inherited copy by an admin, and logs it.
- `access-log.js` — writer idempotence, reader scoping.
- `authorizer-*.js` — the slug traps (`callandanswer`, `partygames`, `joinery`, `votes`).
- Existing guards run unchanged: `no-global-partition-literals.js`,
  `cors-allows-sent-headers.js`, `kms-grants-match-code.js`, `template-validates.js`, plus
  `sam validate --template template-clean.yaml --region us-east-1 --lint`.

**Frontend (jest under `src/`):**
- Behaviour per screen (`shareDialog`, `needsChanges`, `moderationPanel`, `scoreCard`,
  `reportDialog`, `contentNoticeAck`): outcomes rendered from job states; Resubmit and
  appeal call the right routes; Create disabled until ticked; Start-anyway carries the ack.
- `*Palette.test.js` per new stylesheet (`.srev` on **both** grounds, `.modq`, `.scard`),
  `scopedClassesDeclared`, `rowActionsReachable`, `modalReachability`, `adminOneSection`
  (the new section renders alone), `closedRoutesUseAuthFetch`.
- `tests/verify-question-set-ui.spec.js` (Playwright, deployed UI) gains the share → library
  path as `qa-host-a`, and the bundle grep that rules out a stale tier first.

---

## 13. Rollout

Dev after each stage, by branch push, once the backend suite, the frontend suite and the
build hold their baselines. Test once stages 1–2 run end to end on dev, driven by hand:
share a clean set as `qa-host-a` → visible to `qa-host-b` → copied; a flagged set → `06`
→ edit → resubmit → passed; appeal → queue → approve and reject; takedown → the author's
`06` shows the note. The Bedrock guardrail is a template resource, so test gets its own on
that deploy. Prod is not started by this book. Test data the drive creates is named `QA …`
and is safe to delete.

---

## 14. Out of scope, and what would change

| item | why out | if it came in |
|---|---|---|
| Prompts | D5 — their own review | `checkPromptText` exists; the pipeline is the same shape; the public S3 body key already exists in `promptBodyKey` |
| Email on decision | D10 — the product's first outbound mail | one SES send keyed off the job's `callerUserId`; the copy on `05`/`11` changes back |
| Players reporting | D13 | a second entry point on the player surface into §6.2's store |
| Copy counter | nothing counts copies; a write per copy | `ADD copies` in `copy-question-set.js`; `07`'s column returns |
| Re-check on guardrail change | a background sweep | iterate the public scope through `publishableText` |
| Image modality | §4.1 escalates instead | enable the guardrail's image filter; images stop escalating |
| Break-glass support access | §8 covers only the pipeline's own reads | the grant flow in `08-privacy.html` |

---

## 15. Review findings map

| ref | finding | where it landed |
|---|---|---|
| R1 | the check read title + body only; `answerDetails` casing bug; options, instructions, set prose, categories, images unchecked | §4.1 |
| R2 | the hash bound the immutable part; ciphertext cannot be hashed | §5.1 — a record, not a gate; publish from the snapshot |
| R3 | new routes fall into the authorizer's fail-open rules | §9 |
| R4 | the job poll is not tenant-scoped; items carry text | §4.2 |
| R5 | a 400KB queue row makes every list read every snapshot | §3.2, §3.3 |
| R6 | approve decrypted the org partition; the access-log line had no writer | §3.3, §8 |
| R7 | takedown's Put would erase the org's review row; sequential deletes | §5.2, §3.1 |
| R8 | `06`'s sentence is prose the guardrail cannot produce | §4.3 |
| R9 | "you'll hear back" has no channel | D10, §10.1 |
| R10 | the double acknowledgment | D14, §7.4 |
| R11 | reports unbounded per account; reporter text reaching the author | §6.2, §3.1 |
| R12 | list states were an N+1 | §3.1 |
| R13 | no submit lock; `checking` could stick; cost uncontrolled by Engage | §4.2 |
| R14 | a timestamped queue SK re-keys on every bump | §3.2 |
| R15 | `07`'s attribution needed the org name on the public row | §5.1 |

Cost, for the record: at Guardrails' content-filter price, a 30-question set is ~$0.005 to
check and a 200-question set ~$0.03; a thousand submits a month is under $5. Per-question
calls are the right granularity — batching saves cents and loses the attribution `06`
depends on. The lever that matters is the lock and the per-org cap.
