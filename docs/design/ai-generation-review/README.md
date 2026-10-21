# AI generation: durable jobs, a notification, review, and accept into a new version

Status: **decided and built (2026-10-21)** on `working/build-room-host-redesign`, not deployed.
Parts 1 and 2 below are the investigation and the design as written for the decision. **The owner's
decisions and what was actually built are in "Decisions and what was built" just below; where the
two differ, that section wins.** Mockup: `index.html` in this folder.

## Decisions and what was built

### The owner's decisions (2026-10-21)

1. **A brand-new generated set waits as a draft** until accepted, so it does not count against the
   set allowance before then.
2. **Accepting a new set switches it on**, with an option to leave it off.
3. **Retention:** ready drafts are kept 30 days with a reminder at day 25; discards can be restored
   for 7 days; accepted drafts are kept 30 days as a record.
4. **No email.** Instead, **one general notifications icon** (an inbox with a bell and a count) in
   the app's top line. It covers question sets, the organisation, requests to the user, and so on;
   each entry, clicked, goes where it needs to go. It is built general: a notification store and
   route, kinds, read/unread, a deep link, a TTL. AI drafts are the first producer.
5. **Visibility:** a draft, before acceptance, is visible **only to its creator**. Once accepted it
   is an ordinary set or version in its library, and the library's normal rules apply.
6. **Destination default** (chosen by the main session; not answered by the owner): the library the
   console is in — Engage in the Engage console, the person's own space otherwise, and a team when
   they are working in that team. Always shown, changeable, offering only libraries the person may
   write to.
7. **Build everything**, every phase.

### What was built

**Server.**

| Piece | Where |
|---|---|
| Draft rows: header `<scope>GENDRAFTS / DRAFT#<id>`, items `<scope>GENDRAFT#<id> / ITEM#<nnnn>` | `lambda-functions/admin/shared/generation-drafts.js`; keys in `tenant.js` (`draftsIndexPk`, `draftItemsPk`; public refused) |
| Sealing | `tenant-crypto.js` entities `draft` (title, request, warnings, error), `draftItem` (item), `notification` (title, body); platform rows plaintext |
| TTL | generating/ready/failed: 30 days from the last run finishing; discarded: 7 days; accepted: 30 days. Items carry the header's ttl and are rewritten with it on every transition |
| Every whole-set run writes a draft | `shared/generation-handler.js` (trivia, polls, survey) and `ai-generate-scenarios.js`: POST validates the destination (`X-Engage-Org`) or the target set (`requireSetManager`) **before** any model call; the worker writes items as passes land, reads Stop between passes, seeds already-used titles, records token usage, notifies the creator. No set is created by a run any more |
| Regenerate one category / the remainder | the same generation POST with `{ draftId, regenerate: { category, count } \| { remaining: true } }`, rebuilt from the brief stored on the draft |
| Draft routes | `/admin/generation-drafts/{proxy+}` (GET, POST) on the **upload-questions** function (`upload-questions.js` dispatches to `admin/generation-drafts.js`): `list`, `{id}`, `{id}/items`, `{id}/cancel`, `{id}/accept`, `{id}/discard`, `{id}/restore`, `{id}/undo` |
| Accept, new set | server-side through the importer, as the caller, `reviewedDraft: true` → active unless left off (activating needs a shelf), stamped `aiReviewedAt`; the plan's 402 arrives here |
| Accept, adding to a set | claim (audited first; one claim, stale after 5 min) → the browser runs the editor's own merge and saves ONE new version through the importer's replace (`src/src/utils/draftAccept.js`) → complete, or release on a failed save |
| Undo after accepting an addition | `{id}/undo`: only the creator, only this accept, only while the version it wrote is live; runs the promote handler in-process (ownership guard, empty-version probe, audit). The general promote route stays Engage staff's |
| Audit | `draft.accept`, `draft.discard`, `draft.restore` (before the action; `Outcome` stamped on failure); `set.promote-version` on every promote, including undo |
| Notifications | `shared/notifications.js`: `USER#<sub>#NOTIFY / NOTE#<key>`, one row per thing (e.g. `draft#<id>`), kind, link, read, ttl = the draft's expiry (else 30 days); lazy day-25 reminder (turns unread again 5 days before expiry, no scheduler); removed when the draft is decided |
| Inbox route | `/me/notifications/{proxy+}` (GET, POST) on the **orgs** function beside `/me/attention`: `list`, `{id}/read`, `read-all` |
| Live entries fed into the bell | invitations to your verified email; people waiting for hosting approval and invitations running out (team owners/admins); the plan's session cap reached (owners/admins); sets the content check sent back (any member); and for Engage staff accounts waiting, plan requests waiting, sets in Moderation — all computed from what `/me/attention` already counts, so the bell and the scope tabs agree |
| "AI draft" tag | means `isAIGenerated && !active && !aiReviewedAt`; saving a version of an AI set also stamps `aiReviewedAt` |
| Batch guidance | still never stored, on a draft or anywhere (`shared/batch-guidance.js`); a regenerate is sent its own |
| Resources | no new Lambda; four HttpApi events (two per proxy family); `kms:Decrypt` added to the promote function (it now seals its audit entry) |

**Browser.**

| Piece | Where |
|---|---|
| The bell | `components/NotificationsBell.jsx` in `AdminShell`'s top line; count of unread; a click marks a stored entry read and goes where it points, switching library first when it must (`utils/notificationsApi.js`, `destinationOf`) |
| The review | `components/DraftReview.jsx`: destination named; keep/leave/edit per question (saved as you go); per-category keep-all; regenerate a category or the remainder with its token estimate; Stop while running; accept (name, shelf, switch on) or accept into a set (one new version, Undo); discard (7-day restore); decided drafts show what was decided and the way back |
| Where the review opens | a place in the console's Question sets (`?draft=<id>` deep link); a dialog over the set editor (QuestionsPanel); a dialog over the host's set dialog |
| The list | `components/DraftsStrip.jsx` above the sets (waiting, running, restorable), "Review · N" on a set's row, nav badge counts waiting drafts with flagged sets |
| Builders | `hooks/useDraftRun.js` shared by all four: destination (`DestinationField`, list read only when asked), slot keyed by set, resume instead of auto-starting a second run, hand-off to the review; the running panel promises a draft and the bell, with a real Stop |
| Help | `config/help/admin.js` (AI builders: drafts, the bell, accept and undo, public after), `builder.js`, `host.js` |

### Hooks left for later

- **The host's own screens** (`GameHostPage`, the remote) have no bell; the console's top line is
  the only one. `NotificationsBell` is self-contained and can be dropped into any top line.
- **More stored producers.** Anything that should notify can call `notifications.notify(db, { sub,
  key, kind, orgId, title, body, link, expiresAt })`. Natural next ones: a share decided by the
  content check or by Moderation (today a live entry only while flagged), a plan request decided,
  a member approved, an archive restore finished.
- **Team admins seeing a teammate's pending draft**: deliberately not built (decision 5).
- **A new set's undo** is deleting it from the list; only additions have a version to go back to.

---


## The owner's report

> "in question generating. im not sure what is going on, but the experience could be improved. at
> the engage admin level, i went to add 2 new categories with 10 questions each, i was told i could
> close and come back and this was running. but when i came back i didnt see anything. not sure
> what happened to this work. how can the experience be improved. any time adding a new question
> set thats ai generated, or adding to it. there needs to be notification in the system/alert
> somewhere. an approval to accept the work that was created, and a new version of the question set
> is created for example. but this should also last even if it takes a few days before the admin
> gets back. is the generated questions put in a S3 CSV file and then merged as part of the version
> save? the agent should think deeply about this process, and create a great user experience that
> is cost effective and reversible (both at the acceptance phase and after (via versioning). also
> once reviewed the review tag should turn off in the question set list."

And, added during the investigation:

> "also there should be clear understanding if im saving this under my account, a team, or engage
> (if im an admin) public sets for now are created after saved in the personal or team accounts."

---

## Part 1: what happens today

Line numbers are from `474c8b14`.

### 1.1 The two paths share one engine

Every AI builder (`TriviaAIBuilder`, `PollAIBuilder`, `AIScenarioBuilder`, `SurveyAIBuilder`)
calls the same server factory, `makeGenerationHandler`
(`lambda-functions/admin/shared/generation-handler.js:70`).

1. **POST** `/admin/ai-generate-{trivia|scenarios|polls|survey}` writes a job row and returns
   **202** at once (`generation-handler.js:306-352`). The row is
   `PK=AIJOBS, SK=AIJOB#<jobId>` (`generation-jobs.js:51-64`). The caller's user, org and org role
   are captured onto the row (`generation-jobs.js:142-150`).
2. The same Lambda **invokes itself** with `InvocationType: 'Event'` and `__workerMode: true`
   (`generation-handler.js:338-342`). The worker runs with the function's 900 s timeout
   (`template-clean.yaml:4858`, `:4947`). There are no SQS queues and no Step Functions. Lambda's
   default async retry applies (no `EventInvokeConfig`, `generation-jobs.js:339-340`), and
   `claimJob` makes sure only one delivery generates (`generation-jobs.js:363-383`).
3. The worker calls the model in passes and **writes every item it has so far onto the job row**
   after each pass (`generation-handler.js:221-228`), sealed under the caller's org key when there
   is one (`generation-jobs.js:79-81`).
4. **The client polls** `GET …/{jobId}` every 2 s, for at most 16 minutes
   (`src/src/utils/aiBatchClient.js:108`, `:120`). The GET is answered only for the user, org and
   builder that started the job. Anyone else gets a 404 (`generation-handler.js:285-288`,
   `generation-jobs.js:103-109`).
5. **The job row lives 3 days.** `ttl` is set once at creation and never refreshed
   (`generation-jobs.js:55`, `:159`). After that the poll gets a 404, which the client reads as
   "That job has expired" (`TriviaAIBuilder.jsx:153-160`).
6. **The browser remembers one job id per endpoint** in `localStorage` under
   `engage.generationJob.<endpoint-leaf>`, e.g. `engage.generationJob.ai-generate-trivia`
   (`src/src/utils/generationJob.js:202-215`, `:226-239`). Starting a second job on the same
   builder overwrites the first one's slot.

Nothing is written to S3 at any point. Generated items exist only in the job row's `items`
attribute. When they become a set, they go through an **in-memory CSV string** handed to the
importer (`generated-set.js:327-356`). That answers the owner's question: there is no S3 CSV, and
nothing is merged at version-save time.

### 1.2 "Generate a new set": the worker makes the set itself

For whole-set runs the worker creates the set **before** it marks the job terminal
(`generation-handler.js:252-254`, `shared/generated-set.js:264-383`). It builds a CSV and calls
`upload-questions.js` in-process with a synthetic event (`generated-set.js:233-248`, `:355-356`),
passing `isAIGenerated: true`. The new set and every question row start **inactive**
(`upload-questions.js:1127`, `:1237`). It is a real set in the library from that moment, version 1,
and it counts against the stored-set allowance (the 402 path, `generated-set.js:361-366`).

This was the fix for an earlier version of the same complaint. The "World Leaders" set is
described in `generated-set.js:4-14`. For a **new set**, leaving the page does produce something:
an "AI draft" row in the list.

### 1.3 "Add categories or questions to an existing set": the work is held only by the browser

This is the path the owner took. In the set editor, **Add questions**
(`components/AddQuestionsDialog.jsx`) offers "this set's categories" or "new categories", with
presets of 2, 3, 5 or 10 per category. "2 new categories × 10" is one job of 20. Pressing it opens
the builder already generating (`autoStart: true`, `AddQuestionsDialog.jsx:169-173`), portalled
from `QuestionsPanel.jsx:1760-1790`.

- The builder sends `appendOnly: true` (`TriviaAIBuilder.jsx:222`, `PollAIBuilder.jsx:224`,
  `AIScenarioBuilder.jsx:791`). On the server that **makes no set at all**
  (`generated-set.js:279`). The items wait on the job row.
- The only thing that turns those items into questions is the open editor. When the builder
  reaches review and the person presses "Add N", `acceptGenerated` (`QuestionsPanel.jsx:715-765`)
  appends the rows and saves a **new version straight away and live**
  (`saveRows` → `upload-questions.js` replace → `activeVersion` flipped,
  `upload-questions.js:1379-1446`). There is no draft version. Appended rows are written
  `Active: true`, because a version save does not send `isAIGenerated`.
- **While it runs, the panel tells the person they may leave, and promises a draft.**
  `GenerationJobPanel` is rendered with `createsSet` set unconditionally, in append mode as well
  (`TriviaAIBuilder.jsx:617`, `PollAIBuilder.jsx:627`, `AIScenarioBuilder.jsx:1513`). So under
  "If you leave" it shows:
  - the button **"Close — this keeps running"** (`GenerationJobPanel.jsx:170-173`);
  - "The job id is kept in this browser, so a reload or a closed tab picks it back up. The job
    record stays readable for three days." (`:183-188`);
  - **"The set gets made without you. … Leaving now still leaves you a draft."** (`:193-202`).
    That is **false in append mode**. Nothing is made without the person.
  - The builder help says the same: "It runs in the background and appears when it is done, so you
    can close the dialog" (`src/src/config/help/builder.js:161`).

### 1.4 What happens on return

- **The admin console has no "running or ready" indicator anywhere.** `recallAllGenerationJobs()`
  is read only by the host's dialog (`HostQuestionSetsDialog.jsx:152`, strip at `:503-519`), not
  by `AdminPage` or `QuestionSetsPanel`. The Question sets nav badge counts only flagged shares
  (`AdminPage.jsx:1649`). The set's row shows nothing pending.
- **Opening the set editor does not resume anything.** The builder that would resume is mounted
  only while `addBuilder` is set (`QuestionsPanel.jsx:1760`).
- **Pressing Add questions again starts a new paid job and drops the old one.** On mount the
  builder runs its resume effect, which picks up the stored id (`TriviaAIBuilder.jsx:177-184`,
  `AIScenarioBuilder.jsx:552-559`), *and* its `autoStart` effect, which posts a fresh job and
  overwrites the slot (`TriviaAIBuilder.jsx:238-242`, `PollAIBuilder.jsx:236-240`,
  `AIScenarioBuilder.jsx:572-618`). Nothing checks for a stored job before auto-starting. The
  comment in `__tests__/aiBuilderCloseConfirm.test.jsx:8-10` names this exact overwrite. The fix
  there only added a confirmation on the review screen, which is no help to someone who closed
  while the job was still running.
- **Opening the same builder from "New set" picks up the append job in the wrong mode.** The slot
  is keyed by endpoint, not by set or mode (`generationJob.js:211-215`). So the new-set builder
  resumes it and offers "Load into System", which makes a separate set.
- **After 3 days the items are gone** (job-row TTL). DynamoDB deletes up to about 48 h late.

### 1.5 What "AI draft" / "Review" in the set list means

`QuestionSetsPanel.jsx:609-619` shows **"AI draft"** when `isAIGenerated && active === false`, and
the row's main button reads **"Review"** (`:710-716`). It is set by the importer's
`isAIGenerated → active:false` (`upload-questions.js:1127`). The **only** thing that clears it is
switching the set on (`/admin/toggle-question-set/{setId}`, `template-clean.yaml:5341`). After
that it reads "AI" for ever, because `isAIGenerated` never changes. Three consequences:

- Reviewing a set without switching it on leaves the chip saying "AI draft". The chip measures
  *active*, not *reviewed*. That is the "review tag" the owner wants turned off.
- An append run never sets the chip, because the appended version goes live at once.
- The per-version content check (`shared/set-review.js`: `REVIEW` rows, used for sharing and
  moderation) is a different "review". It is not shown as this chip.

### 1.6 How failures show

The worker keeps partial work on failure (`generation-jobs.js:253-275`), and `GenerationJobPanel`
shows "stopped at N of M", warnings and the error string (`GenerationJobPanel.jsx:218-394`). That
works only for someone watching the builder. A failure while nobody watches is recorded only on a
row that expires in 3 days. There is no cancel (`GenerationJobPanel.jsx:35-39`).

### 1.7 Where the work is saved (scope), today

- **The destination is never chosen or shown in the AI builders.** The server uses whichever
  organisation is active at the moment of the POST. The `X-Engage-Org` header comes from the
  console's org switcher (`src/src/auth/authFetch.js:26-31`). The authorizer honours it only for a
  member (`lambda-functions/auth/pick-active-org.js:74-80`). The org and role are copied onto the
  job row and replayed to the importer (`generated-set.js:233-248`).
- `createSetRef` then decides (`admin/shared/question-set-access.js:255-295`):
  - with an active org (a **personal space** is an org of type `personal`; a **team** is an org),
    the set goes to `ORG#<org>#SETS`, sealed under that org's key;
  - in the **Engage console** (header `~platform`, which is not a membership, so no org) the
    worker's synthetic event has no groups and no org. That counts as an internal write, and the
    set goes to the platform library `SETS`.
- **CSV upload** does take an explicit `scope` (`QuestionSetUploadPanel.jsx:93-107`), and
  `AdminPage.jsx:1951` passes `'platform'` in the Engage console. The AI path takes no scope.
  - The CSV path's comment warns that without `scope` an Engage admin "would silently get a set
    in their own personal space".
  - The AI path avoids that only because `~platform` resolves to no org. Nothing guards it if the
    switcher changes.
- **What each person sees:**
  - an **Engage admin** sees nothing in the builder telling them it goes to Engage;
  - an **org admin or member** sees nothing telling them it goes to their team or personal space;
  - a **host** using `HostQuestionSetsDialog` gets the active org, also unstated.
  - After saving, the row chip says Yours, Team, Engage or Public (`src/src/utils/setOwnerTag.js`).
- **Public** is never a creation destination. A set becomes `PUBLIC#SETS` by being *published* from
  an org library after the content check (`admin/publish-question-set.js`,
  `shared/publish-set.js`, `shared/set-review.js`).
- **Adding to an existing set** writes into that set's own library, because the save is a replace
  of `replaceSetId`. That is correct, and also unstated.
- **A hidden risk for new sets:** if the person switches org between starting and returning, the
  draft sits in the library they started from. The list they come back to does not show it.

### 1.8 The most likely cause

**The owner used Add questions → 2 new categories × 10 on an existing set. That is an
`appendOnly` job, and by design it makes no set and no version on the server. The 20 generated
questions were written onto a job row (`AIJOBS / AIJOB#<jobId>`, 3-day TTL) and waited for the
open editor to press "Add 20". The running panel nonetheless showed "Close — this keeps running"
and "The set gets made without you … leaving now still leaves you a draft", because `createsSet`
is passed unconditionally (`TriviaAIBuilder.jsx:617` and its two siblings). On return nothing in
the admin console pointed at the finished job. Reopening the editor did not resume it. Pressing
Add questions again would have auto-started a new job and overwritten the stored id. The work
probably finished and was then simply never applied. If more than 3 days passed, it has expired.**

Other explanations that cannot be ruled out without logs:

| Hypothesis | What would confirm it |
|---|---|
| A. The job completed and was never applied (most likely) | CloudWatch `/aws/lambda/<stack>-admin-ai-generate-{trivia\|scenarios\|polls}`: `🚀 Dispatched … job <id> for 20 items`, then `✅ Job <id> complete: 20 items`, and **no** following `upload-questions` replace for that set. The set's `versions[]` on its metadata row (`ORG#<org>#SETS` or `SETS`, `SK=SET#<setId>`) has no entry from that day. |
| B. Reopening auto-started a second job that replaced the first | Two `Dispatched` lines minutes apart for the same user. The second one was possibly applied or abandoned too. |
| C. The job failed while unwatched | `❌ Job <id> failed:` in the same log group, or a row with `status: error`. Model throttling or a quota refusal would show here. |
| D. The job ran in a different library than the one viewed (new-set runs only) | The dispatch log's org, versus the console scope the owner returned to. Not applicable to an append. |

The rows to inspect, if within 3 days plus up to 48 h: `PK=AIJOBS, SK=AIJOB#<jobId>`, fields
`status`, `completed`, `requested`, `errorMessage`, `callerOrgId`, `updatedAt`. The job id is in
the owner's browser at `localStorage['engage.generationJob.ai-generate-<type>']`, unless a later
run overwrote it. `items` is sealed for an org caller.

---

## Part 2: the designed experience

### 2.1 Principles

1. **The server finishes the work, and a person accepts it.** Generation produces a *draft* that
   lives on the server, under the destination library, for as long as review takes. The browser is
   never the only place it lives.
2. **Nothing touches the live set before acceptance.** Accepting writes a new version through the
   existing replace path. Rejecting writes nothing.
3. **Reversible twice.**
   - Before accepting, a draft can be discarded and restored for 7 days.
   - After accepting, the previous version is one press away (`promote-set-version.js`, which
     already exists and is the rollback).
4. **One model call per item, ever.** Reading, editing, partly accepting and coming back later
   cost nothing. Only "regenerate" calls the model, and only for the part regenerated.
5. **The destination is chosen and always stated.** The draft lives in the library it will be
   saved into.
6. **The chip means what it says.** "Review" in the list means "a draft is waiting for you", and it
   goes away when that draft is decided.

### 2.2 States

```
Generation draft (one per run)

 queued ─► generating ─┬─► ready ──────┬─► accepted (version vN written; draft kept 30 d as receipt)
                       │   (full)      ├─► partly accepted (same, with the rejected items noted)
                       ├─► ready       └─► discarded (restorable for 7 d, then expires)
                       │   (partial: failed or timed out, with N of M kept)
                       └─► failed (nothing produced; retry offered, nothing to review)

 ready ─► expiring (day 25 of 30: reminder) ─► expired (gone; audit entry remains)
```

`ready`, `partly accepted` and `failed` are what raise a notification. `generating` shows progress
but does not notify.

### 2.3 What the admin sees

**Start (new set or Add questions).** The existing one-press flows stay. They gain one line, the
**destination**:

- *New set:* "Save into: **Your space** ▾". The choices are only the libraries this person may
  write to: Your space, each team where their role is member or above, and **Engage** for staff.
  It defaults to the console's current scope. Fine print: "Public is not a choice here. Publish a
  set from Your space or a team once it is saved."
- *Add questions:* no picker, and one plain sentence instead: "Adds to **History Quiz** in
  **Northwind team**. You will review them before anything changes."

**While it runs.** `GenerationJobPanel`, with honest copy:

- "Close — you'll be notified when it is ready" (replaces "this keeps running").
- "The draft is kept for 30 days in *Northwind team*. Nothing changes in the set until you accept
  it." This replaces both the "leaves you a draft" promise, which append mode broke, and the
  browser-storage line.
- A **Stop** button that really stops. The worker re-reads `cancelRequested` on the draft row
  between passes. It stops after the current pass, and that pass is still kept.

**Coming back: the notification.** We reuse surfaces that already exist instead of building a
notification system.

1. **Nav badge** on *Question sets* (`AdminShell` `item.badge`, `AdminPage.jsx:1649`). It counts
   drafts that are ready for this person in this scope, added to the flagged-share count. A badge
   is "the one number that decays if nobody looks" (`AdminShell.jsx:127-130`), which is exactly
   this.
2. **An alert strip** at the top of the sets list, in the `qsets-alert` pattern that
   `HostQuestionSetsDialog.jsx:503-519` already uses. For example: "2 AI drafts are ready to
   review · *History Quiz*: 20 questions in 2 new categories · ready 3 days ago · **Review**".
   It is fed by the server, not by `localStorage`, so it works on any device and days later.
3. **On the set's row**: a chip "**Review · 20**" with the primary button "Review". For a
   new-set draft, a placeholder row in the list, in the destination library, reading
   "*Generating… 8 of 20*" or "*Ready to review*".
4. **Overview** landing (`OverviewPanel`): one line under "Needs you".
5. ~~An email when a draft becomes ready~~ — **decided: no email.** The general bell in the top
   line carries it instead, with the day-25 reminder (see "Decisions and what was built").

Every surface names the destination ("in Your space", "in Northwind team", "in Engage").

**The review screen.** It is a place, not a modal-on-modal, at
`Question sets › History Quiz › AI draft`. See the mockup.

- Header: what was asked ("20 questions in 2 new categories", any batch guidance, and the prompt
  that ran: `promptSource`), the destination, when it was made, and when it expires.
- **Grouped by category.** Each category has a header with a checkbox, a count, and a
  **Regenerate this category** button. For an append to existing categories, the header shows the
  count before and after ("History 8 → 18").
- **Each question** has *Keep* (default) or *Leave out*, and an *Edit* that opens the existing
  question form inline. Defects are already detected (`answerDefect`, `scenarioDefect`) and are
  shown on the row. A question with a defect is left out by default.
- **Footer**: "Accept 18 of 20 → saves **version 5** of *History Quiz* in **Northwind team**",
  then "Discard draft", then "Decide later" (closes; nothing lost).
- **Edits save to the draft as you go.** It is the review of a document, not a form you can lose.

**Accept.** One press. A new version is written with only the kept items, through
`upload-questions.js` replace on the existing set. For a new set, the importer's create runs with
the chosen scope. Result: "Version 5 saved. Version 4 is kept: **Undo** (switch back to v4)". Undo
is `promote-set-version` to the prior version. All accepted versions stay in `versions[]` as
today. The draft is marked `accepted` with the version number, and the chip and badge clear.

- *New set:* accepting creates the set as **active** (the review was the review), or inactive if
  the person unticks "Switch on now". The "AI draft" chip is replaced by draft state, as described
  in §2.6.
- *Partial accept:* the same, with only the kept questions. Left-out items stay readable in the
  receipt for 30 days, in case the person wants one back. Bringing one back is a further, free
  accept that writes the next version.

**Reject or discard.** "Discard draft" asks once: "Discard 20 generated questions? You can restore
this draft for 7 days." It writes nothing to the set. The badge and chip clear. An undo toast and
a "Recently discarded" line in the strip stay for 7 days.

**Regenerate a category.** This re-runs the model for one category only, with the same brief plus
the other categories' titles as "already used", so it does not repeat. Only that block of the
draft is replaced. The old block is kept until the new one lands; a failed regenerate leaves it
alone. This is the only action on the review screen that costs anything, and the button shows the
estimate (§2.7).

**Failures and partial results.** A partial run lands as `ready (partial)`, with "18 of 20
generated: the last pass failed (reason)". There are two buttons:
*Review the 18*, and *Generate the remaining 2 into this draft*. The second is a resume, because
the draft holds what exists. That is unlike today, where "Try again" starts a separate job
(`GenerationJobPanel.jsx:376-385`). A run with nothing produced notifies as **failed**, with the
reason and *Try again*. There is nothing to review.

### 2.4 Data model

These keys follow the tenancy rules. **Every partition string is built in `tenant.js`**, because
`tests/no-global-partition-literals.js` forbids bare literals.

| Row | PK | SK | Holds | TTL |
|---|---|---|---|---|
| Draft header | `ORG#<org>#GENDRAFTS` (platform: `GENDRAFTS`) | `DRAFT#<draftId>` | status, kind, engagementType, destination `{scope, orgId}`, `targetSetId` (append) or set metadata (new), `requested`/`produced` counts, category list, creator `{sub, name}`, createdAt/readyAt/decidedAt, `acceptedVersion`, `cancelRequested`, promptSource, token usage, and the sealed `title`/`brief` | 30 days from **ready**; 7 days from **discard**; 30 days from **accept** (as a receipt) |
| Draft item | `ORG#<org>#GENDRAFT#<draftId>` (platform: `GENDRAFT#<draftId>`) | `ITEM#<catIdx>#<n>` | one generated question, its `decision` (keep/leave), `edited` flag, and its sealed content fields | same as the header (written together; the sweep below catches drift) |
| Job row (existing) | `AIJOBS` | `AIJOB#<jobId>` | progress only; points at `draftId` | 3 days (unchanged) |
| Audit | `ORG#<org>#AUDIT` (+ `PLATFORM#AUDIT` for staff) | existing | `generation.start`, `.ready`, `.accept`, `.discard`, `.restore`, `.regenerate`, `.expire` | 1 year (existing) |

**Why DynamoDB rows and not an S3 object.**

- **Size fits.** A draft is at most 100 items of 1–3 KB each. It is well inside DynamoDB's item
  limits as one row per item, and the job row already carries the same items today.
- **Sealing already works.** `tenant-crypto.js` seals named fields per org. An S3 draft would need
  its own envelope encryption to meet the same rule, a second bucket policy, and a lifecycle rule
  per state (ready, discarded, accepted all need different expiries, which S3 lifecycle cannot key
  on cheaply).
- **Per-item edits are single small writes.** Per-item keep and leave-out decisions, and edits as
  you go, become one `UpdateItem` each, instead of a whole-object rewrite with a lost-update race
  between two tabs.
- **Listing ready drafts is one query** on the scope's `GENDRAFTS` partition. That is what the
  badge and the strip need.
- **Cost is negligible.** At on-demand rates, writing 20 items, reading them a few times, and
  storing about 60 KB for a month costs a tiny fraction of the model call that produced them.

S3 becomes worth it only if drafts ever carry media (generated images). In that case, put the media
in the existing assets bucket under a `drafts/<scope>/<draftId>/` prefix with a 30-day lifecycle,
and keep the text in DynamoDB.

**The worker writes items into the draft rows as each pass lands**, not into the job row. The job
row stays a thin progress record. For new sets, `createSetForJob` stops creating an inactive set:
the set is created at **accept**.

- This removes the "AI draft set counts against my allowance" problem.
- It removes the duplicate-name refusal mid-run, because the name is checked at accept and can be
  edited there.
- **Decision for the owner:** this changes the "World Leaders" fix (`generated-set.js:4-14`). With
  drafts, leaving still leaves something, which was that fix's whole point. It is now a draft
  rather than an inactive set.

**Expiry sweep.** A daily scheduled function already exists in spirit (`usage-reconcile.js`
pattern). It:

- writes the `generation.expire` audit entry;
- marks drafts approaching expiry so the "expires in 5 days" line and the optional email can fire;
- deletes orphaned item partitions.

DynamoDB TTL does the actual deletion. No reader treats `ttl` as "gone", because deletion is lazy;
readers filter on `ttl < now`.

### 2.5 API routes

All go behind `CognitoAuthorizer`, and each handler re-checks `canManageScope` /
`requireSetManager` (for append) against the **draft's recorded destination**, never the request's
header.

| Route | Does |
|---|---|
| `POST /admin/ai-generate-*` (existing) | Gains a `destination` `{scope, orgId}`, validated against `canManageScope` **at POST time** and written onto the job and draft. A missing destination keeps today's behaviour for old clients. Returns `{ jobId, draftId }`. |
| `GET /admin/generation-drafts?status=ready,generating,failed` | The current scope's drafts for the strip, badge and row chips. Headers only, no item content. |
| `GET /admin/generation-drafts/{draftId}` | Header plus items (opened, i.e. unsealed), for the review screen. |
| `PATCH /admin/generation-drafts/{draftId}/items/{itemKey}` | Keep or leave out, or an edited field set. No model call. |
| `POST /admin/generation-drafts/{draftId}/accept` | `{ itemKeys? }` (default: all kept). Calls the importer (create or replace) in-process, writes `acceptedVersion`, audits, and returns `{ setId, version, previousVersion }`. **Idempotent.** It is a conditional on `status = ready`, so a double click makes one version. |
| `POST /admin/generation-drafts/{draftId}/discard` and `/restore` | State flip and audit. Restore is allowed within 7 days. |
| `POST /admin/generation-drafts/{draftId}/regenerate` | `{ category }` or `{ remaining: true }`. Dispatches a worker against the same draft. |
| `POST /admin/generation-drafts/{draftId}/cancel` | Sets `cancelRequested`, which the worker reads between passes. |
| `POST /admin/question-sets/{setId}/versions/{v}/promote` (existing) | The post-accept undo. |

**Who can see a draft.**

- **Its creator**, always.
- ~~Org admins and owners of that org~~ — **decided: no.** Before acceptance a draft is its
  creator's alone; once accepted it is an ordinary set or version in its library.
- **Engage staff in Engage mode**, for platform drafts.
- **Accepting into an existing set** needs `requireSetManager` on that set at accept time, not
  only at start time.

### 2.6 The "review" tag, defined

- **Draft pending** (new): on any set with a ready draft against it, a chip **"Review · N"** and
  the primary button "Review". For a new set, the placeholder row carries it. It clears when the
  draft is accepted, discarded, or expires.
- **"AI draft"** (today's `isAIGenerated && !active`) is retired as a review signal, since new
  sets are no longer created inactive before review.
  - Sets that exist today in that state keep showing it until switched on, so nothing in the
    library silently changes meaning.
  - A set can still be switched off for other reasons. That shows the existing inactive treatment,
    not a review chip.
- **"AI"** (provenance) stays. It now has a version-level meaning too: `versions[].note` says
  "AI: 18 questions in 2 new categories, accepted by George".

### 2.7 Cost

- **One model call per item, ever.** Reading, editing, partly accepting, discarding and restoring
  are DynamoDB-only.
- **Show the estimate before starting** and on Regenerate.
  - `structured-generation.js` already knows `perItemTokens(kind)` and `maxTokensFor`, and the
    model price is in `shared/pricing.js`. "About N output tokens (≈ $x)" is a pure function and
    costs nothing to compute.
  - Show the **actual** usage on the draft from the response's `usage` fields, which neither
    `structured-generation.js` nor the worker reads today.
- **Batch size stays as today** (`itemsPerCall`). A 20-item job is usually one pass. Regenerating
  a category asks only for that category's count.
- **Resume, not restart.** "Generate the remaining 2" asks for 2, not 20. Today's retry starts a
  second full job.
- **No polling while nobody watches.** The badge and strip read once on console load and on focus.
  The review screen polls only while its draft is `generating`, every 5 s rather than 2 s.

### 2.8 Reversibility, end to end

| Moment | Undo |
|---|---|
| While generating | **Stop** (cancel flag). The passes already done are kept in the draft. |
| On the review screen | Leave out or keep any item, any number of times. Nothing is written to the set. |
| After discard | **Restore**, for 7 days. |
| After accept | **Undo** in the toast, and later in Versions: promote the previous version. Games already running keep their pinned version (`set-version.js` resolution order). |
| After a partial accept | Left-out items stay in the receipt for 30 days and can be accepted into a further version. |

### 2.9 Tenancy and encryption

- **The destination is recorded on the draft at POST** from a validated choice. The header can no
  longer change it, and the worker never infers it (it fails closed, as `workerCaller` does).
- **Item content, title, brief, batch guidance and edits are sealed** under the destination org's
  key: new `ENCRYPTED_FIELDS.draft` and `.draftItem` in `tenant-crypto.js`, copied to all three
  bundles per the drift tests. Platform drafts are plaintext, by the existing decision.
- **Drafts are never public.** Public happens only through the existing publish, which runs the
  content check on a saved version.
- **Audit entries carry ids and counts only**, per `audit-log.js` rules: draftId, setId, version,
  kept and left-out counts.

---

## Phased build plan

Each phase ships on its own and is useful alone.

**Phase 0: stop telling people something untrue (an hour, frontend only).**
- Pass `createsSet={!isAppend(appendTo)}` in the three builders. In append mode the panel says:
  "These come back here for you to add. Leaving is safe for 3 days: reopen *Add questions* on this
  set to pick them up."
- In append mode, **resume instead of auto-starting** when a stored job exists, and key the slot by
  set as well as endpoint (`engage.generationJob.<leaf>.<setId>`), so the new-set builder cannot
  pick up an append job.
- In the set editor, on open, check the stored slot for this set and show "20 generated questions
  are waiting: **Review and add**".
- Update `config/help/builder.js:161` to match.

**Phase 1: state the destination.** Add the destination line and picker to the builders and to
Add questions, and send `destination` on the POST. The server validates it and records it. No
storage change.

**Phase 2: server-side drafts and accept.** Add the `GENDRAFTS` rows, the worker writing into them,
the `GET`/`PATCH`/`accept`/`discard` routes and the review screen. Accept creates the new version;
the toast's Undo is the promote. Append runs and new-set runs both go through it. The new-set
worker stops creating an inactive set.

**Phase 3: notification.** The nav badge, the sets-list strip, the row chip "Review · N",
placeholder rows for new-set drafts, and the Overview line. Retire "AI draft" for new drafts.

**Phase 4: regenerate, resume, cancel, cost.** Regenerate per category, generate the remaining
items into the same draft, a real Stop, and the cost estimate and actual usage.

**Phase 5: retention and reach.** The expiry sweep and reminder, audit entries for expiry, restore
after discard, org-admin visibility and (if chosen) email.

## Acceptance criteria

1. A generation started from **Add questions**, closed while running, and reopened **3 or more
   days later on another device** shows a notification. Pressing it opens a review of exactly what
   was generated, and accepting writes **one** new version of that set containing only the kept
   items.
2. Before acceptance, the live set and its `activeVersion` are unchanged. A game started meanwhile
   plays the old version.
3. After acceptance, **Undo** restores the previous version in one press.
4. **Discard** writes nothing to the set and can be restored for 7 days.
5. Re-reading, editing, leaving out, accepting and discarding make **zero** model calls.
   Regenerating a category calls the model only for that category's count.
6. The set list's review chip and the nav badge appear when a draft is ready and **disappear** when
   it is accepted, discarded or expired.
7. A failed or partial run notifies too, says how many were produced and why it stopped, and
   offers to generate the remainder into the same draft.
8. **Destination.**
   - The builder and Add questions show where the work will be saved, before starting and on
     accept.
   - The choice is limited to the person's writable libraries: Your space, their teams, and Engage
     for staff.
   - Adding to a set states that set's library.
   - Public is not offered, and the UI says that publishing comes after saving.
9. **Notifications** and the review screen name the destination library.
10. **Sealing.** An org draft's item content is sealed under that org's key. A draft cannot be read
    from another org. Accept writes only into the recorded destination, even if the console has
    since switched org.
11. **Audit.** Every start, accept, discard, restore and expiry appears in the org's audit log with
    who did it and the counts.
12. **Help and README.** `config/help/*` describes the flow, and `helpContent.test.js` passes.

## Open questions for the owner

**Answered 2026-10-21** — see "Decisions and what was built" at the top. Kept for the record.

1. **New-set drafts.** Should a brand-new generated set also wait as a draft (proposed), instead of
   being created inactive straight away (today, the "World Leaders" fix)? The proposal means the
   set does not exist, or count against the allowance, until it is accepted.
2. **Accept means switched on?** Proposed: accepting a new set makes it active, with an untick
   "Switch on now". Or should it stay off until a separate switch?
3. **Retention.**
   - Proposed: a ready draft is kept 30 days, with a reminder at day 25.
   - A discarded draft is restorable for 7 days.
   - An accepted draft's receipt is kept 30 days.
4. **Email.** Do you want an email when a draft is ready, and when one is about to expire? It
   needs SES wired, which is not in the path today.
5. **Team visibility.** May a team's admins see, and discard, a teammate's pending draft? Today
   only the creator can see a job.
6. **Engage admin defaults.** In the Engage console, should the destination default to **Engage**
   (as today), or to Your space with Engage as an explicit choice?
7. **Phase 0 first?** It fixes the false promise and the overwrite in about an hour, without the
   server work. Should it go to dev ahead of the rest?
