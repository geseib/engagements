# Handoff — Question set management, reimagined

**Status:** brief. No code has been written for any of this.
**For:** the team taking on question-set authoring and the AI generators.
**Read first:** `docs/handoff/RESUME.md` (**Landmines** is mandatory) and
`docs/superpowers/plans/2026-08-11-admin-question-sets-and-jobs.md`.

This is a *thinking* brief. It states the problem, gives you the conceptual
frame the owner is working from, points at the machinery that already exists,
and names the design questions you must answer. **It deliberately does not
answer most of them.** Where I have an opinion I say so and mark it as mine.

---

## 1. The idea everything else hangs off: the four kinds of round

The owner arrived at this and it is the most useful thing in this document.
Call-and-answer rounds differ by **what you hand the participant, and what they
do with it**:

| | You hand them | The work is | Example |
|---|---|---|---|
| **Produce** | nothing but a prompt | invention — the room is the source | *"What should we do first in Q1?"* |
| **Apply** | someone **else's** material | transfer across a boundary | *"Here's how a surgical team uses checklists. Where would that work here, and who would resist it?"* |
| **Improve** | **our own** material | revision | *"Here is our mission. Reword it."* |
| **Judge** | a thing, and ask for a verdict not a fix | evaluation | *"What's the strongest argument against this plan?"* |

**Apply and Improve are not the same thing, and the difference is ownership,
not mechanics.** Foreign material is safe — nobody in the room wrote it, so
nobody defends it and people reason freely. Our own material has an author who
is usually sitting right there. Apply rewards whoever sees the analogy; Improve
rewards whoever is willing to say the current version is weak. They pull
different answers out of different people, and a generator that cannot tell them
apart will write the wrong questions for one of them.

**Judge is worth keeping separate from Improve** because "make this better" and
"tell me what is wrong with this" attract different participants — the first the
confident, the second the sceptical, and you often want the second.

A fifth axis exists and is **not** in scope: **time** — rounds that operate on
what the room produced in an earlier round. Same four verbs, different source.
Worth designing so it is not impossible later.

---

## 2. The concrete defect that started this

**The AI question-set generator writes with one voice regardless of what is
being made.** Its prompt carries direction like *"improve"* baked in, so asking
it for an Apply-shaped set (take this lesson, land it here) yields a confusing
set that keeps telling participants to improve something they were never given.

The owner's suggested shape — **treat it as their proposal, not a specification**:

> a drop-down choice with those terms (and a brief definition like you have) or
> a "something else" choice, where they provide those details in the generator
> details box

**The first design question, and it is not obvious: is the kind a property of
the SET or of the QUESTION?** A set could legitimately mix — open with Produce
to warm the room, move to Improve once people are talking. If it is per-set the
model is simpler and the generator is easier to steer; if it is per-question the
generator has to be told per item and the editor has to show it. Decide
deliberately and write down why.

---

## 3. What the owner asked for, verbatim in substance

A **reimagined design, plan, then build** for question-set management, with
"consistent detailed management across the different views and management
points". The named capabilities:

**Authoring a new set**
- AI assistance to define the *overview*: categories, instructions, suggested
  Workie persona.
- An AI button to **generate questions**.
- **Add more questions** — including by pasting in source documents, so a
  document becomes the source material for generated questions. Explicitly for
  trivia, call-and-answer **and** wavelength.
- An AI button to **refine a single question**.
- Delete a specific question.

**Living with a set**
- Return at any time to edit a set.
- **Saving makes a version.** Either delete a version later, or be asked whether
  to archive the previous version before editing this one. Archive means the
  general archive.
- See **all questions laid out**, filtered by category, or searched.
- **Select a group of questions** and: create a new subset set from them, or add
  them to another existing set.

**Permissions**
- *"It is super important that hosts can only add these to question sets they or
  their group owns."*

**Groups — named, explicitly NOT to be built yet**
> *"which brings up a new capability Groups. I dont want to add this feature just
> yet, but we need to be aware that it likely will be asked for."*

**And separately:** fix the AI question-set generation choices so it produces
genuinely good sets — **primarily call-and-answer**, and also look at what would
improve the **trivia** generator.

---

## 4. What already exists — reuse it, do not rebuild it

Landing this on top of work from the last few days rather than beside it is most
of the job.

**Ownership is already built and enforced** (`800742bb`):
- `lambda-functions/admin/shared/question-set-access.js` — `canManageSet` /
  `requireSetManager`, enforced **in the handlers**, not the UI.
- `createdBy` on the `SETS` row holds the Cognito **`sub`** (not username or
  email — this pool has mutable emails).
- Sets with no owner are treated as **admin-owned**, because until that change
  every route was admins-only, so every legacy set genuinely was made by an
  admin. No backfill was needed.
- `auth/authorizer.js` — `HOST_ADMIN_ROUTES`, five **exact** `"METHOD path"`
  pairs. Deliberately not a prefix: `startsWith('admin/question-sets')` would
  also open the version routes, including a DELETE.

**Versioning already exists.** `shared/set-version.js`, `SET#<id>#v<n>`
partitions, `activeVersion`, a `versions[]` array, `findGamesPinnedToVersion`,
and `interpretVersionDelete` on the frontend. **The owner's "saving makes a
version" is not a new system — it is a change to when the existing one fires.**
Understand what is there before designing anything.

**Frontend surfaces rebuilt recently and worth matching:**
`QuestionSetsPanel.jsx`, `QuestionSetUploadPanel.jsx`, `QuestionSetDeleteDialog.jsx`,
`QuestionSetEditor.jsx` (~850 lines, already the detail place),
`HostQuestionSetsDialog.jsx` (the host-facing entry). `QuestionSetUploadPanel`
already takes **permission props rather than being forked** — follow that.

**Generation machinery:** `shared/generation-handler.js`,
`shared/generation-jobs.js`, `shared/structured-generation.js`, and the handlers
`ai-generate-questions.js`, `ai-generate-trivia.js`, `ai-generate-scenarios.js`,
`ai-generate-polls.js`, `ai-generate-survey.js`. Note
`ai-generate-scenarios.js` carries a **byte-for-byte inline copy** of the shared
flow — any change to job semantics has to be made twice.

**Prompt quality tooling, built this week and directly applicable:**
`src/src/utils/promptPreflight.js` — three tiers, and it will catch the class of
defect that makes generators produce junk. Its known gaps are listed at the end
of the sweep commit; the highest-value missing check is **output-structure
contradiction**.

**The generation prompts themselves** live in
`lambda-functions/admin/default-ai-prompts.json` — which ships **nineteen**
templates, not the four game-type keys it appears to. Read it carefully.

---

## 5. The hard design questions. Answer these before you build

1. **Set-level or question-level kind?** (§2.) Everything else follows.
2. **What is a question's identity across sets?** Questions live at
   `PK=SET#<id>`, `SK=QUESTION#<cat>#<nnn>`. "Add these to another set" and
   "make a subset set" mean **copying rows**. Do the copies stay linked? Does
   editing the original propagate? **My opinion: copies should be independent,
   and say so in the UI** — shared identity means a host editing their set can
   silently change a set they do not own, which collides head-on with the
   permission rule.
3. **How does "saving makes a version" interact with the existing versioning?**
   Every save creating a version could produce dozens per session. What is a
   version *for* here — rollback, or pinning what a played game used? Note games
   pin versions, and `findGamesPinnedToVersion` exists precisely because deleting
   one breaks history.
4. **Archive is a real blocker, not a detail.** The archive service is **not in
   this repo**. `GET https://archive.seibtribe.us/archive/items` returns 200
   unauthenticated and CORS advertises `DELETE` with `Origin: *`.
   `ArchivePanel.jsx` hardcodes that URL six times with plain `fetch` and no
   auth. **"Archive the previous version" cannot be built responsibly until that
   is fixed, and fixing it needs a deploy outside this pipeline.** Decide whether
   to scope archive out, or to raise it as its own piece of work.
5. **Groups — do not build, but do not foreclose.** Ownership is currently a
   single `createdBy` sub. The cheap insurance is that every permission check
   already goes through `canManageSet`, so a group check has exactly one place
   to land later. **Do not scatter ownership logic**, and do not model anything
   that assumes an owner is a single person.
6. **Pasted source documents.** Where does the text live — request-only, or
   stored with the set? Storing it makes regeneration and provenance possible and
   raises retention questions. Note `ttl` is for SESSION data only
   (`docs/02-data-model.md`); prompt writers previously stamped TTLs on records
   that then silently vanished a year later.
7. **What makes a *good* generated call-and-answer set?** This is already
   written down and tested. `sets/agentic-sdlc-call-and-answer.md` records
   predicted divergence per question, and
   `docs/superpowers/reviews/2026-08-11-agentic-sdlc-dry-run-hypothesis.md`
   Part 1 §A gives five falsifiable criteria (H1–H5) — divergence, escalation,
   no vendor answers, practitioner-answerable, breadth. **Those are the target
   the generator should be steered at.** The four kinds in §1 are how you steer
   it; H1–H5 are how you tell whether it worked.
8. **Trivia is a different problem.** Trivia has a correct answer, so
   "divergence" is meaningless and plausible distractors are everything. Do not
   reuse the call-and-answer criteria there. Note difficulty is stored on all
   100 questions of the 80s set and **never scored** — every question is 10
   points.

---

## 6. Constraints and landmines specific to this area

- **`AdminPage.jsx` cannot be mounted in jsdom** — `useAuth` hard-throws. Extract
  components that render on their own; there are many precedents. `AdminPage.test.jsx`
  has failed 8/8 since it was written and asserts a UI that no longer exists;
  fixing or deleting it is a **deliberate separate decision**.
- **Tests that assert nothing are this repo's dominant failure mode.** Every test
  carries a `// rejects:` comment naming the change it would catch, and you break
  the implementation and watch it go red. A test never seen failing does not
  count. This has caught real defects repeatedly, including one this week where a
  test asserted a function was *called* but not that its input carried anything.
- **jsdom has no layout engine.** Geometric assertions pass unconditionally.
- **The importer is the contract.** `upload-questions.js` decides what a valid
  set is. `scripts/install-question-set.js`'s dry run now parses for real with no
  AWS credentials and reports skipped rows — use it.
- **Silent row loss is the defect to fear.** Every AI-generated poll set once
  imported with zero options because emitters wrote `Option1..5` and the importer
  reads one pipe-separated `Options` column.
- **Survey cannot be played.** `upload-questions.js` rejects survey uploads
  outright; the picker holds it behind `UNPLAYABLE_GAME_TYPES`.
- **`install-ai-prompt.js` builds a DynamoDB client before it parses**, so its
  dry run dies on "Region is missing" having validated nothing — the same defect
  `install-question-set.js` was repaired for. Small fix, not yet done.
- **Two prompts claim `isDefault` for every game type**, and only poll resolves
  in favour of `sets/`. `scripts/cull-ai-prompts.js` exists.

**Baselines to hold** (measured at `148ea278`):

| | |
|---|---|
| Backend | 40 suites / 1343 passed / 0 failed |
| Frontend | 5 failed suites / 31 failed / **1629 passed** — the five are `AdminPage`, `App`, `GameHostPage`, `PlayerPage`, `WebSocketClient`, all pre-existing |
| Build | `cd src && npm run build` compiles, 2 pre-existing size warnings |

`tests/host-connection-dedup.js` is a known order-dependent flake — 8/0 alone,
7/1 in the loop. Ignore it; do not chase it.

**Deployment:** `CLAUDE.md` now says dev is Claude's to deploy, test and prod are
the owner's. **In practice tag pushes currently fail with HTTP 403 from the
session container while branch pushes succeed** — so a deploy needs the owner
until that credential scope changes. Verified four ways; a `--dry-run` tag push
succeeds and the real one does not.

---

## 7. How I would approach it — offered, not prescribed

1. **Settle §5.1 and §5.2 first.** Set-level vs question-level kind, and whether
   copied questions stay linked. Every screen depends on both, and both are
   expensive to change later.
2. **Fix the generator before rebuilding the console.** It is the smaller,
   better-defined piece, it is the thing the owner named first, and H1–H5 give
   you a way to tell whether it worked. A good generator also changes what the
   management UI needs to do.
3. **Treat the question library as its own surface.** "See all questions,
   filter, search, select, act on the selection" is not the set editor with
   extra buttons — it is a different screen with a different primary object (the
   question, not the set). My opinion: build it as such.
4. **Scope archive out unless you are also fixing the archive service.** Offer
   version *delete* with its existing consequence warnings, and raise archive
   separately.
5. **Write down what you did not build.** The most useful documents in this repo
   are the ones that say plainly what is missing.
