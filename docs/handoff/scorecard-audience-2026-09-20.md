# Handoff — who may read a check, and Engage's own sets (2026-09-20)

Branch `working/scorecard-audience`, on top of `d6e286c1`. **Local only — not on dev, test or
prod.** Read `docs/handoff/scorecard-and-preview-2026-09-19.md` first; this continues it.

Two owner decisions, and a security defect the first of them exposed.

| | State |
|---|---|
| An author may see what the check measured on their own set | **Shipped**, API and screen |
| Engage's own shared sets get checks and cards | **Shipped**, with the automatic dispatch run by the console — see §3 |
| The disclosure the first decision exposed | **Fixed**, and a second one beside it that predated the branch |

---

## 1. The disclosure, which is the part to read first

The version list (`GET /admin/question-sets/{setId}/versions`) gated the MEASUREMENT —
`reviewTally`, `reviewObserved` — and left the four fields beside it on the same REVIEW row
ungated: the status, the per-question `findings`, the `reasons` and the decision `note`.

That was harmless only while nothing ever wrote a REVIEW row outside an organisation's own
partition. **Two writers do.**

| Writer | The row | Who could read it |
|---|---|---|
| `checkPlatformSet` (this branch) | Engage's own verdict on one of Engage's SHARED sets | every signed-in account — `readableScopes` gives everybody the platform scope |
| `publishSnapshot` (since publishing existed) | a public copy's row, carrying the **source organisation's** per-question findings and the **Engage reviewer's own note** | every signed-in account — public is in `readableScopes` too |

So a customer could read Engage's internal finding about the shared library, and
`SetReviewBanner` rendered it to them as a statement about their own content ("this set was
not published… your copy is still private to your organisation"). And any organisation could
read another's question ids, categories, bands and the model's own sentences about them,
plus the reviewer's note, by naming the public set id.

**The fix is the row, not two fields of it.** `reviewFacts` in `get-set-versions.js` is one
whitelist behind one gate. A reader who may not manage the library gets exactly what they were
owed before either of those rows existed:

- **platform** — nothing. There was no row yesterday, so `unreviewed` is the unchanged silence.
- **public** — the STATUS alone. A copy is in the public library *because* it passed, so that
  much is already a public fact; whose questions were seen, at what band, and what the reviewer
  wrote are not.

Pinned in `tests/author-measurement.js` (12 cases). One assertion from the earlier commit was
**changed, deliberately**: it asserted `review === 'passed'` reaches a customer for a platform
set, commented "as it was", which was not true — before `checkPlatformSet` there was no row and
the answer was `unreviewed`. That assertion encoded the leak.

## 2. Decision 1 — the author's own measurement, end to end

`reviewTally` and `reviewObserved` now travel through `normalizeVersions` (the sole consumer
of that route; a field it does not name does not exist to the UI) and are drawn by
`SetReviewBanner` under **What the check measured**: the summary line, all five categories
with "none" written out, and **Seen and let through** — the near misses, which `findings` has
never carried. Rendered in the flagged state and in the waiting state, which previously said
only that somebody was looking.

- **Named by question LABEL, not text.** The staff card names observations by text because
  staff cannot decrypt an organisation's rows and read the public copy instead. This route has
  no `kms:Decrypt` grant and needs none: the surface rendering it *is* the set editor, which is
  already holding the plaintext questions those ids name, and "Edit Q14" is the control that
  jumps to one.
- **No tally draws no block.** A check made before measuring existed has none, and an empty
  block would read as "measured, and nothing found". `normalizeVersions` keeps `reviewTally`
  as `null` rather than defaulting it to `{}` for the same reason.
- **The words live in one file now.** `src/src/utils/reviewMeasurement.js` — the category
  words, the band words, `categoryRow`, `summaryLine`. `ScoreCard.jsx` had its own copy and the
  previous handoff named the drift as a risk while there was still one reader. Mirrors what
  `lambda-functions/admin/shared/review-card.js` already does for the two routes.

**The A1 boundary is enforced in the backend projection and asserted there.** The banner can
only render what it is handed; it is handed no reviewer, no `decidedAt`, no notice and no
snapshot key.

## 3. Decision 2 — Engage's own sets

### The trigger, and where it actually runs

The owner's trigger is **switched on**, **questions replaced while on**, and **on demand**.
Both write routes now answer `checkDue` (stated on every answer, true or false, so a client
never has to tell "not due" from "this build does not say") and **the console runs the check**:

| Route | When `checkDue` is true | Who fires the check |
|---|---|---|
| `POST /admin/toggle-question-set/{id}` | platform scope, `active` false → true | `AdminPage.handleToggleActive` |
| `POST /admin/upload-questions` (replace) | platform scope, row was active before the save | `QuestionsPanel.handleSave` |
| on demand | — | "Run the content check", `QuestionSetEditor` Versions panel |

**Neither route can dispatch the job itself, and this is a template limitation, not an
oversight.** A check is a job: the POST that starts one self-invokes the check function against
its 900-second budget, which needs `lambda:InvokeFunction` on that function.
`AdminToggleQuestionSetFunction` and `AdminUploadQuestionsFunction` hold `DynamoDBCrudPolicy`
and nothing else, so an invoke from inside either is an AccessDenied at run time — and since an
activation must never fail because of a check, it would have to be swallowed, which is a
trigger that looks like one and is not. **Moving the dispatch server-side is a four-line grant
in `template-clean.yaml` and nothing else**; this branch was not allowed to touch that file.

E3 holds either way, and more plainly with the console doing it: the write has already returned
and the set is already live before a byte of the check is sent, so the check can neither delay
the activation nor fail it. **What it is NOT is a guarantee** — a console closed between the
two calls leaves the check unrun. The on-demand control is the answer to that, and it is why
the control exists rather than being an extra.

E4 is unchanged from the earlier commit: `checkPlatformSet` reserves no organisation's cap and
records no units against one.

### The surfaces

- **`SetReviewBanner` has a platform branch.** Without one, a checked Engage set told staff
  "this set was not published", "nothing was shared" and "your copy is untouched — it is still
  private to your organisation": three false sentences in one paragraph about a set served to
  every organisation and owned by none, over two controls (Resubmit, appeal) with nobody to
  press them. It now says what is true — what the check measured, that the library is still
  serving the set, and that the moderation queue is where the outcome is answered.
- **`versionChip` has one too.** "needs changes" and "waiting for Engage" are a share's words;
  an unchecked Engage set reads "not checked", not "not shared", which would invite somebody to
  go and share a set every organisation already reads. (`shareStateOf` has had this branch since
  tenancy — it says "Everyone" — so the list row was honest while these two were not.)
- **The queue row is answerable.** A `PLATFORM#<setId>` row carries `recheck: false` and no
  `publicSetId`, so `ModerationPanel` fell through to **Review**, whose Approve and Reject the
  decide route refuses outright, while `leave` — the one decision it accepts for that shape —
  was never drawn. The row could be cleared by nobody and aged for ever in the queue and the
  nav badge: the exact failure "Leave it serving" was built to fix, for a different key. The
  panel now branches on the `scope` field `moderation-list.js` returns, offers "Leave it
  serving", and writes **Engage** in the Organisation cell instead of leaving it blank.
- **An unversioned Engage set can be checked.** Most of the shared library predates versioning,
  so its versions list is empty and there was no row to hang a control on. The control sits
  beside the empty state as well and sends **no version** (not `null`, which the route would
  read as a named version and refuse).

---

## 4. Open, with reasons

- **The automatic dispatch is client-side.** See §3. Two routes answer a fact that a closed
  console will not act on. The fix is the template grant.
- **Nothing caps a staff check of an Engage set**, the same gap the re-check has. Each press
  spends real guardrail calls on Engage's account, and the activation trigger means a burst of
  activations is a burst of checks.
- **The review dialog is never opened for a platform row** because the panel no longer offers
  Review for one — but the dialog itself is still written for an organisation's submission
  (`item.pointer.orgName`, "Note to the organisation (they read it on reject)"). If anything
  ever routes a platform row into it, those two read wrong.
- **`moderation-get.js` will serve a `PLATFORM#` entry** to any staff caller who constructs the
  URL, with no console surface behind it. Harmless today; it is staff-only either way.
- **A public copy's version list now says only "passed".** That is a deliberate narrowing (§1).
  Nothing in the UI read the fields that went away — `SetReviewBanner` returns null for
  `passed`, and `versionChip` still reads "checked" — but a future surface that wants a public
  copy's measurement must read it from the staff score card, which is where it lives.
- **No test drives `AdminPage.handleToggleActive` end to end.** The decision it makes is pinned
  in `src/src/__tests__/houseCheck.test.js` (`checkIsDue`, `startHouseCheck`,
  `houseCheckNotice`), and the server half in `tests/house-check-due.js`; the three-line call
  site between them is read, not executed, by the suites.

## 5. What was run

| | |
|---|---|
| Backend | 154 suites, 0 failed (151 at `d6e286c1`; +`author-measurement`, +`engage-set-check`, +`house-check-due`) |
| Frontend | 233 suites, 5619 tests, all passing (232 / 5575 at `d6e286c1`) |
| Lint | 0 errors, 10 warnings (baseline) |
| Build | exit 0, two known size warnings |
