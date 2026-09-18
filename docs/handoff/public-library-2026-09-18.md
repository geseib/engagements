# Handoff — the public library and its moderation pipeline, Stages 1 and 2

**Branch:** `dev`, live as **`e6eacead`** (2026-09-18 17:26 GMT); **`test`** carries the same tree as the merge
**`5bdd786b`**. Prod has seen none of it. Spec:
`docs/superpowers/specs/2026-09-17-public-library-moderation-design.md`. Plans:
`docs/superpowers/plans/2026-09-17-public-library-stage-1.md` (done) and
`docs/superpowers/plans/2026-09-18-public-library-stage-2.md` (done, 13 tasks). This file supersedes
`docs/handoff/public-library-2026-08-27.md` for everything about sharing, review and moderation; that
file remains the record of the design conversation beneath it.

**Still unbuilt, by design (spec §1):** Stage 3 (reports on public sets; dismiss / take down from the queue /
keep with a notice for REPORTED rows), Stage 4 (the content-notice picker on approve and the notice editor on
the score card — `decide` already accepts and stores `notice` ids), Stage 5 (the access-log write when a
reviewer opens a set — the seam is marked in `moderation-get.js`). Also Book 3: archive provenance and sync
states across dev and test (design notes in the owner's memory, not yet a spec).

---

## 0. WHERE THIS STANDS — read this first

- Every Stage 1 and Stage 2 task passed a task-scoped review; the whole branch passed a final review and one
  fix wave; the gate is green at `e6eacead`: backend **145 suites / 4060 passed / 0 failed**, frontend
  **219 suites / 5167 tests**, lint **0 errors / 10 warnings** (all pre-existing), build with its 2 known
  asset-size warnings, `sam validate --lint` valid.
- **The drive has not been run by anyone with a signed-in host.** Spec §13 steps 1–5 on dev, then test:
  share a set with one deliberately violent question → the Moderation queue shows it with "N uncertain
  questions" and how long it waited → Review shows that question first with its band word → Reject with a
  note → the author's editor shows the note leading the banner → resubmit or approve a second set → "Public
  v1" → another organisation copies it and previews it → platform Public library → Score card → Take down
  with a note → gone for everyone, the author's editor shows the note, the card 404s → two tabs on one queue
  item, decide in one, the other says "Already decided by <you>". Anything that does not match is a bug in
  this code, not in the drive.
- The API Gateway hosts (`ouv6fztlig…/dev`, `69abatw833…/test`) were not reachable from the machine that
  shipped this (connection timeouts, sandboxed and not), so the unauthenticated `GET /admin/moderation → 401`
  probe was never run. The Moderation page loading in the console is the equivalent proof.
- The owner's AWS SSO token had expired on 2026-09-18; `aws sso login --profile adminaccess` is the owner's
  to run before any pipeline watch. Pushes need no credentials.

## 1. THE MAP — what exists and where

**Backend (`lambda-functions/admin/`)** — every staff handler re-asks `tenant.canManageScope(event,
tenant.PLATFORM, '')` (the `admins` group AND no active organisation) and takes the reviewer's name only
from `requestContext.authorizer.lambda`:

| Route | Handler | Does |
|---|---|---|
| `GET /admin/moderation` | `moderation-list.js` | the queue, oldest first, a whitelisted projection of the `MODERATION` pointer rows |
| `GET /admin/moderation/{sk}` | `moderation-get.js` | the pointer, the org's REVIEW facts, the S3 snapshot shaped uncertain-first with all five judged set fields, `setFindings`, the log |
| `POST /admin/moderation/decide` | `moderation-decide.js` | approve publishes the judged snapshot; reject flags with a note; see §2 |
| `GET|DELETE /admin/public-library/{publicSetId}` | `public-library-item.js` | the standing (score-card data) and takedown; see §2 |

Shared: `shared/snapshot-store.js` (S3 read/delete), `shared/moderation-queue.js` (`queueSk`, `queueKey`,
`upsertQueueRow`, `deleteQueueRow`, `listQueue`), `shared/set-review.js` (`readReview`, `writeReview`,
`transitionReview` — a conditional Put on the current status; `REVIEW_FIELDS` now carries `reviewer`,
`decidedAt`, `notice`), `shared/publish-set.js` (`publishSnapshot(db, table, snapshot, { review,
sourceOrgName, promptDropped, resume })`, `unpublishSet` — writes NO stamp), `shared/share-stamp.js`
(`writeShareStamp(db, table, ref, stamp, { onlyIfPublicSetId })`, conditional on the row existing;
`readShareStamp` is the pure `(meta) => meta.share`), `shared/review-log.js`, `shared/publishable.js`
(`SET_FIELDS`, `buildSnapshot` — every snapshot carries `source`).

**Routes:** the four are closed by the authorizer's existing `admin` catch-all
(`lambda-functions/auth/authorizer.js`, the comment beside it names them); `tests/authorizer-staff-routes.js`
pins concrete percent-encoded paths. The template functions are least-privilege (list read-only; get read +
S3 read; decide CRUD + S3; item CRUD, no S3). None reaches `tenant-crypto`, so none has a KMS grant.

**Frontend (`src/src/`)** — `utils/moderationRow.js` (the queue's words: band words, never scores);
`components/ModerationPanel.jsx/.css` (`.modq`: the queue table + `ReviewDialog`); `components/ScoreCard.jsx/.css`
(`.scard`: standing, timeline, latest findings, `TakedownDialog`); `components/PublicLibraryPanel.jsx/.css`
(`.publib`: org mode Preview / Copy to my team, platform mode Score card / Unpublish, mounted on
`QuestionSetsPanel`'s `rowActions` render prop — which also drops the State column and shows "by <org>");
`config/consoleSections.js` `publiclibrary`; `AdminPage.jsx` wires the three places, the score-card
breadcrumb, `handleUnpublish` (throws on failure so the dialog keeps the note) and the moderation nav count.

## 2. THE RULES THE CODE EMBODIES — do not re-litigate, do not break

1. **A decision is complete only when the queue row is gone.** It is the last write on both paths. A queue
   row beside a decided REVIEW row is an IN-FLIGHT decision: `passed` + approve resumes, `flagged` + reject
   resumes, the other verb answers 409 "Already decided by <name>" (the body carries `reviewer` and
   `status`), a queue row with NO review row (the org deleted the version while it was queued) is decidable
   from the snapshot alone. `decided` is logged the moment the transition succeeds and back-filled on resume.
2. **`publishSnapshot({ resume: true })`** reuses the active public version only when the public meta row
   already records this `sourceVersion` + `contentHash` + source org/set. Without it, a re-share of identical
   content deliberately makes a NEW public version (Stage 1's contract, pinned by
   `tests/publish-question-set.js`). Only the resume path passes it.
3. **Takedown order:** log `taken-down` → the guarded stamp (`onlyIfPublicSetId`, D11: an org that re-shared
   as a different public set keeps its newer stamp) → queue-row deletes → `unpublishSet` LAST, so a crashed
   takedown is finished by the next click. The org's REVIEW row is never written by takedown.
4. **Nothing writes a partition-key literal** outside `tenant.js`; keys come from `queueKey`, `setMetadataKey`,
   `setPartition`, `reviewKey`, `publishedKey`. `tests/no-global-partition-literals.js` fails the build otherwise.
5. **Snapshots carry `source`**; a snapshot whose source does not name the sk's org and set is refused as gone.
6. **Dialogs with a note field** (`ReviewDialog`, `TakedownDialog`, `UnpublishDialog`): Escape and backdrop are
   gated on `!busy && !note.trim()`; the X and the bottom exit stay live through one `requestClose`; a failed
   action keeps the note and shows the message INSIDE the dialog with the confirm re-enabled.
7. **The three stylesheets** obey the design skill (`.claude/skills/engage-design`): scoped selectors, tokens
   only outside the token block, no top-level selector declared twice, `title=` on truncating text, and the
   palette tests assert every `--<scope>-t-*` token ≥ 12px (the literal-px check alone was vacuous).
8. Quoted user text is set in curly quotes (U+201C/U+201D), as everywhere else in the console.

## 3. HOW TO RUN AND SHIP

- Backend: `node tests/<file>.js`, judged by EXIT CODE (a grep for "failed" false-flags suites). Frontend:
  `cd src && CI=true npx jest` / `npm run lint` / `npm run build`. Template: `sam validate --lint --template
  template-clean.yaml` (local, no credentials). The full gate is the loop in the Stage 2 plan's Task 13.
- **Never `npm install` in a populated worktree** — `node_modules` there are symlinks to the main checkout.
- **A push to `dev` deploys dev.** Test is MERGED into (`git checkout -B promote-test origin/test && git merge
  --no-ff <sha> -m "Merge branch 'dev' into test" && git push origin promote-test:test`), never fast-forwarded.
  Push the branch OR a tag, never both. Prod halts at the owner's approval gate.
- Commits carry a `Co-Authored-By:` trailer naming the model that wrote them. It is **not** a fixed
  project constant: this stage's commits say `Claude Fable 5.1`, the Workie work of the same day says
  `Claude Opus 5`. Use whatever the current session's attribution guidance gives you, and do not
  "correct" older commits to match — the trailer is a record of who wrote that commit.

## 4. TRAPS FOUND WHILE BUILDING — the next stage will meet the same ones

- Plan text can contradict its own tests. Three plan defects shipped in Stage 2's plan and were caught by
  review: the review row moved to `passed` BEFORE the publish (a crash wedged the item); takedown deleted the
  public rows BEFORE telling the organisation; a `STAFF_ROUTE` block in the authorizer was unreachable behind
  the `admin` catch-all. Rule on the conflict, ledger it, fix the code — do not weaken the test.
- `readShareStamp` is `(meta) => meta.share`, not an async reader; `unpublishSet` writes no stamp; a test
  snapshot fixture without `source` publishes to the id `-`.
- Cheap implementers may paste a RED transcript that does not match Node's real `assert` output; reviewers
  should compare the format. jsdom prints "Not implemented: navigation" — noise, not a failure.
- Two controls with the accessible name "Close" in one dialog make `getByRole` ambiguous; content that
  appears after a fetch needs `findBy*`, not `getBy*`.
- The harness `tests/helpers/moderation-harness.js` evaluates `ConditionExpression`s, including dotted paths
  (`#share.publicSetId`), and its document client is one singleton whose `send` a test may wrap for a
  one-shot fault (see `tests/takedown.js`).

## 5. PARKED, WITH REASONS

- The orphan approve (org deleted the version while queued) has no replay convergence: a crash between the
  publish and the queue delete would publish a second public version on retry; `resume: true` there is the
  likely remedy (safe: the four-fact match only reuses a version already live). Rare path × crash window.
- The score card for Engage's own sets (spec §10.5) is unassigned; `onOpenScoreCard` from the queue leaves
  `?section=moderation` in the URL; a resumed approve whose S3 snapshot expired (30-day lifecycle) is
  refused; duplicate `published` log rows on a resume after a queue-delete crash; ungated concurrent resumes;
  `.qsets-sub`'s empty title reads "—"; the scard dead-token guard reads un-stripped CSS;
  `ModerationDecideFunction`'s `S3CrudPolicy` is bucket-wide (matches the check function's grant).
- Clearing a content notice on a re-approve without one is Stage 4's (`notice-cleared` exists in EVENTS).

## 6. WHAT TO DO NEXT

1. Run the drive (§0). Fix what does not match before Stage 3.
2. Stage 3: brainstorm → spec section → plan, per the spec's §1 staging. Reported rows use the queue's
   `PUBLIC#<id>` and `PLATFORM#<id>` sk shapes, which `moderation-get.js` and `moderation-decide.js` already
   parse and refuse; `moderation-list` already projects `reports`.
3. Book 3 (archive provenance + three sync states, tested across dev and test) after Stage 3, per the owner.
