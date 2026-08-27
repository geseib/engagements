# Handoff — the public library, per-version moderation, scoped Workies

**Branch:** `dev`, last commit `cee5ec44`. The design is
`docs/superpowers/specs/2026-08-25-public-library-design.md` and it has been
through agent review; read §0 here first, then that.

**This file leads with what git cannot tell you.** Status is what `git log` is
for. What follows is the traps, the decisions that must not be re-litigated, and
the honest gap between what is built and what can be used.

---

## 0. WHERE THIS STANDS — read before touching anything

### The first thing to do

**Confirm `cee5ec44` actually deployed.** I could not: the SSO session expired
while the pipeline was still `InProgress` after ~25 minutes on `sam build`.

```bash
aws sso login --profile adminaccess
aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-dev \
  --max-items 1 --query 'pipelineExecutionSummaries[0].[status,sourceRevisions[0].revisionId]' --output text
aws lambda get-function-configuration --function-name engagedev-check-question-set \
  --query LastModified --output text
```

If `engagedev-check-question-set` does not exist, nothing below about checking or
publishing works, and that is the cause — not the code.

Verified live on dev before the session ended: `ContentGuardrail` and
`ContentGuardrailVersion` (both `CREATE_COMPLETE`, guardrail
`arn:aws:bedrock:us-east-1:239601476690:guardrail/ugftgdxrubb4`, published
version `1`) and `engagedev-publish-question-set`.

### What is built, and what that does NOT mean

| Piece | Built | Usable |
|---|---|---|
| Per-version review rows | yes | yes |
| Content guardrail + module | yes | yes |
| `POST /question-sets/{id}/check` | yes | **verify the deploy** |
| `POST/DELETE /question-sets/{id}/publish` | yes | yes, once a version passes |
| Prompt scoping foundation | yes | **no — see below** |
| Org-authored prompts | **no** | no |
| Publish a prompt | **no** | no |
| Any UI at all | **no** | no |

**THE WHOLE FEATURE IS API-ONLY.** Nothing in `src/` was touched. The share
dialog, the version list's review state, and the public library screen are all
drawn in `docs/design/tenancy-redesign/` and none of them is built. A person
cannot share a set through the product today.

**Org prompts are a foundation with no floor on it.**
`admin/shared/prompt-access.js` is complete and tested — keys, refs, access
rules, the scoped S3 body key — and **`create-ai-prompt.js` does not call any of
it**. It still writes to the bare `AIPROMPTS` partition. So an organisation
cannot author a Workie at all, which means the owner's test — *"sharing a
question set and a prompt created by a user in an org who is not an engage
admin"* — is half impossible. Wiring that handler is the smallest remaining
piece and it unblocks the larger half of the request.

---

## 1. The rules that were learned the hard way today

**1. A hard-coded `PK: 'SETS'` is a platform-only read.** Set METADATA is
scoped even though it is not versioned. `get-ai-summary.js` had two of these and
silently dropped every org set's custom instruction, AI context, persona and
promptId — `create-report.js:223` had already fixed the identical bug and
written the post-mortem, and two call sites were missed anyway.
`tests/set-versioning-flow.js` now fails on any of them in a runtime reader. The
older guard could not catch it because it deliberately exempts `SK: 'METADATA'`,
and that exemption *was* the hole.

**2. Review state is a ROW, never a field on `versions[]`.**
`delete-set-version.js:160` rewrites the whole array from a stale read, and
removing an element shifts every later index — so a worker that resolved "v3 is
`versions[2]`" would afterwards stamp `passed` onto a *different version*. That
is an approval laundering a later edit: the exact thing per-version state
exists to prevent. Keyed by the version number, it cannot shift.

**3. `get-set-versions.js` projects an explicit whitelist.** Storing a new field
faithfully still shows the client nothing. Adding state is two edits, always.

**4. Publishing is NOT `copy-question-set.js` reversed.** Four differences, each
a way to ship something that looks right: the copy destroys version history
(`activeVersion: null, versions: []`), it RENAMES on collision (`freeSetId`:
`teamretro` → `teamretro2`), it refuses an org source, and it encrypts on the
way *in* where publish must decrypt on the way *out*. Getting the last one
backwards produces a public set full of base64 that passes a row count.

**5. Scoping a DynamoDB partition does not reach S3.** Prompt bodies live at
`prompts/<gameType>/<promptId>/v<n>.json` with only `s3Key` on the row. Scoping
the partition alone would have left two orgs overwriting each other's Workie
text. `promptBodyKey` handles it; platform keys are unchanged, so it is zero
migration in S3 too.

**6. `bedrock:ApplyGuardrail` is not `bedrock:InvokeModel`.** The model policies
elsewhere in the template do not cover it.

**7. Validate the template with `sam validate --lint`, not just
`tests/template-validates.js`.** A new CloudFormation resource type that fails
to deploy takes the pipeline with it.

---

## 2. Decisions taken — do not re-litigate these

Each was argued and each closes off something tempting.

**D1 — a published set is a SNAPSHOT of the version that passed.** Editing to v3
does not touch the public copy; the library serves v2 until somebody
deliberately shares again. *Rejected:* auto-unpublish on edit (a typo fix
withdraws a set 400 teams copied, and they find out from a support ticket) and
auto-submit (an edit is not a decision to publish).

**D2 — prompts get the three scopes.** An org can author its own Workie.

**D3 — sharing a set OFFERS to share its Workie in the same action**, and they
land as two separate public entities so one Workie can back many sets.

**Publishing is a copy, not a flag.** Forced, not chosen: org content is
encrypted per tenant and public content is not, and the table has **no GSIs**, so
a `visibility: public` flag on an org row could not be listed without a Scan.
Both reasons matter — the second holds even with encryption off.

**Personas stay platform-only.** `personasPk()` ignores any scope passed to it,
written as a function so the next person must delete it and read why. A persona
is a curated voice; nothing asked for a customer-authored one.

**There is no org-level default prompt.** An org's Workie is chosen explicitly
by a set or not used. This is what keeps `create-ai-prompt.js`'s `isDefault`
sweep and `get-ai-summary.js`'s `Scan` — both of which query `PK = 'AIPROMPTS'`
— working untouched. Agent review flagged a cross-scope default collision; this
is the answer, and the answer is that it cannot arise.

**Moderation has FOUR outcomes, not two.** `05-share-review.html` promises
pass, flagged, and *"if the check is unsure — it goes to a person at Engage"*;
`06-share-rejected.html` adds an appeal. `escalated` **blocks** —
`11-moderation.html` is a queue of sets "waiting for a person", not a
notification. The first draft of the spec quoted one bullet short and got this
wrong.

**Bands, not scores.** Guardrails answers `NONE|LOW|MEDIUM|HIGH`. HIGH refuses,
MEDIUM escalates, LOW/NONE pass. The mockup's "(0.41)" is illustrative and
nothing can produce it. Collapsing MEDIUM into either end is the mistake: into
HIGH and the check refuses a war-history set, into NONE and the moderation queue
never receives anything.

**Prompt-attack detection is for PROMPTS only.** A Workie is executable text; a
trivia question *about* prompt injection is not an attack.

**Everything unknown fails toward a person.** A Bedrock error, an empty set, and
an *unconfigured guardrail* all escalate. That last one is tested specifically:
shipping without the resource wired must not silently approve everything.

---

## 3. What is still open, in the order worth taking

1. **Wire `create-ai-prompt.js` to `createPromptRef`.** Smallest piece, unblocks
   half the owner's test. `get-ai-prompts.js` needs `readablePromptRefs` in the
   same change or a new org prompt is invisible the moment it is written.
2. **`update-ai-prompt.js` / `delete-ai-prompt.js`** — ownership via
   `canManagePrompt`, and copy-on-write for a prompt you do not own, mirroring
   what `QuestionSetEditor` already does for sets.
3. **Publish a prompt** — mirrors `publish-question-set.js`; use
   `checkPromptText`, which already turns prompt-attack on.
4. **The UI.** Share dialog (`05`), the version list's review state, the public
   library (`07`), the rejection screen with its appeal (`06`), the moderation
   queue (`11`). All drawn.
5. **Make the check a job.** It is synchronous today — one `ApplyGuardrail` per
   question, inline. Safe to move because the outcome lands in the review ROW
   and not in the response, so a worker writing the same row changes nothing
   downstream. Until then a set large enough to exhaust the 300s timeout leaves
   the version visibly `checking`, which is why that is a state and not a
   transient.
6. **The pin for prompts.** `get-ai-summary.js:1050` reads `promptId` off the
   SET's metadata row (and `:1046` reads `personaId`), not the game's. Once prompts are scoped the set must pin
   `{promptScope, promptId}` and `copy-question-set.js` must carry it, or a
   copied set holds a dangling cross-scope reference. **Assume this is broken
   until a test says otherwise** — it is the same defect class as
   `questionSetScope`, and review listed the runtime call sites in the spec's §3.

### Older, still open, from the previous handoff

`GET /games/{id}?role=host` needs no auth; nothing is ever billed
(`recordBillableSession` is imported by nobody); there is no way to end a
session (`ENDED` is only written when the pool runs dry); re-closing a round
re-awards points. The `correctAnswer` leak on `/state` **is fixed** — but note
that route's `gameMetadata` is still in the base response, so title, hostName,
questionSetId, selectedCategories and personaId remain public.

---

## 4. Environment and test data

**Accounts on test:** `qa-host-a@example.com`, `qa-host-b@example.com`, both in
`hosts`, each with a personal org. Made with
`./scripts/create-test-users.sh engagetest adminaccess`; `check` mode on that
script diagnoses a sign-in failure, and there are four causes the sign-in screen
cannot distinguish because `PreventUserExistenceErrors` is ENABLED.

A **personal-org owner qualifies** as the org admin publishing requires, so
qa-host-a can publish without being an Engage admin — which is the owner's test.

**`./scripts/audit-set-scopes.sh <stack> adminaccess`** answers "did the tenancy
fix take" and "how much is misfiled" from the partitions rather than the screen.
Read-only.

**One AI set sits in test's shared library by decision:** `lessonsfromtheband`,
by `george@seibtribe.com`, 2026-08-24, from before the tenancy fix. The owner
looked at it and chose to leave it. The audit flags it every run; that is the
script working, not a finding. **Dev has never been audited** and has had far
more QA traffic.

**`tests/verify-question-set-ui.spec.js`** drives the deployed UI with Playwright.
`ENGAGE_PASSWORD` comes from the environment; the first test needs no
credentials and greps the deployed bundle, so a stale tier is ruled out before
anything else is read as a regression.

---

## 5. How to work on this

Baselines at handoff: backend **102 suites / 3265 passed / 0 failed**, frontend
**189 suites / 4720 tests**, lint 0 errors and 11 known `exhaustive-deps`
warnings, clean build with the 2 known size warnings.

```bash
for t in tests/*.js; do node "$t"; done      # aggregate with grep -E '^[0-9]+ passed'
cd src && CI=true npx jest && npm run lint && npm run build
sam validate --template template-clean.yaml --region us-east-1 --lint
```

Every test added in this work was watched failing first, and several were
watched failing again with the fix reverted. Two were rewritten after passing
for the wrong reason. That is the bar here — a green test that was never seen
red proves nothing about the thing it names.

**Use a reviewer agent on the design before writing code.** It paid for itself
three times in one session: it found a live production bug, caught a storage
design that reintroduced the very defect it was meant to prevent, and found that
the spec had quoted a mockup one bullet short and built the wrong state machine
on it. Verify what it reports against the code before acting — one of its
findings was aimed at the wrong row — but do not skip it.
