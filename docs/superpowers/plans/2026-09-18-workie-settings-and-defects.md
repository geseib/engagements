# Workie settings a builder can find, and the five defects behind them — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** whoever builds a question set can see and set what Workie does with it, from every surface that edits a set, and nothing in that chain lies or stores an id that resolves to nothing.

**Architecture:** two fields already exist on a set's metadata row — `personaId` (the voice) and `promptId` (how each round is summed up). Both resolve at runtime today and the resolution works. What is missing is a builder-facing surface on the host's editor, honest copy where a value cannot be honoured, and validation so a dangling id is never stored in the first place. This plan adds one shared resolver on the backend, uses it at every write, and presents both fields as one "Workie" group with plain language and honest empty states.

**Tech Stack:** React (`src/src`), Node 22 Lambdas (`lambda-functions/admin`), DynamoDB single table, jest + plain node test scripts.

**Spec:** none. This is a defect-and-clarity pass argued from a read-only investigation recorded in this plan's Findings section; the prior research map `docs/handoff/2026-09-02-workie-selection-map.md` is partly superseded and Task 6 corrects it.

## Findings this plan argues from (all verified 2026-09-18)

- The set fields are `promptId` and `personaId` on `<scope>SETS` / `SET#<id>`; neither is encrypted.
- The persona overlay **works**: `GameSetupDialog` and the live stage write the game row's `PersonaId`, and `get-ai-summary.js` puts that persona's `voice` at the head of the Bedrock prompt, changing the words of round summaries from the next round.
- The prompt **resolves** through the org library then the platform library, falling back to a game-type default with a recorded reason.
- `GET admin/ai-prompts` and `GET admin/personas` are both allowed to hosts in `lambda-functions/auth/authorizer.js`.
- `HostQuestionSetsDialog.jsx` never fetches either list, and its `QuestionSetEditor` mount passes neither, so its selects render one dead option each. Its create panel sets `showSummaryPrompt={false}` **deliberately** — that stays.
- Writes accept any string: `edit-question-set.js` `OPTIONAL_FIELDS`, `upload-questions.js`.
- `copy-question-set.js` spreads `...meta`, carrying `promptDropped` and an org `promptId` the destination cannot read.
- `BuilderPage.jsx` (routed at `/builder`) hardcodes seven prompt ids and defaults `promptId: 'lessons-learned'`; the seeder mints random ids, so these resolve to nothing.
- `GameSetupDialog.jsx` claims "This question set brings its own summary approach" from the mere presence of `promptId`.

## Global Constraints

- **Never write a partition-key literal** (`SETS`, `GAMES`, `PUBLIC#…`, `ORG#…`) outside `tenant.js`; `tests/no-global-partition-literals.js` fails the build. Keys come from `set-version.js` / `tenant.js` helpers.
- **Do not modify** `tenant.js`, `tenant-crypto.js`, `question-set-access.js`, or any of the three guarded-identical `set-version.js` copies.
- **No new request header.** The template's `AllowHeaders` is `Content-Type,Authorization,X-Engage-Org`; `tests/cors-allows-sent-headers.js` enforces it.
- **No new route without the authorizer first.** Every route this plan touches already exists and is already grouped; if a task believes it needs a new one, it stops and reports.
- **The design contract** (`.claude/skills/engage-design/SKILL.md`): selectors rooted at the screen's scope class, tokens only outside the token block, the 12/13/15/19/24/30 ladder with nothing under 12px, no top-level selector declared twice, `title=` on truncating text, one `Modal`, never a modal opened from inside a modal, no geometric assertions in jest.
- **Tests:** backend are plain node scripts judged by exit code (`node tests/<file>.js`); frontend is `cd src && CI=true npx jest __tests__/<file>`. **Never `npm install`** — `node_modules` are symlinks to the main checkout.
- **Every test is watched failing first.** RED evidence is literal terminal output, never a reconstruction.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Baselines to hold: backend 145 suites / 4060 passed / 0 failed; frontend 219 suites / 5167; lint 0 errors / ≤10 warnings.

---

### Task 1: `shared/workie-refs.js` — one resolver, and writes that refuse a dangling id

**Files:**
- Create: `lambda-functions/admin/shared/workie-refs.js`
- Modify: `lambda-functions/admin/edit-question-set.js` (the `OPTIONAL_FIELDS` write path), `lambda-functions/admin/upload-questions.js` (the metadata write that stores `promptId`)
- Test: `tests/workie-refs.js` (new)

**Interfaces:**
- Produces: `resolvePromptRef(db, tableName, promptId, { orgId })` → `{ ok: true, prompt }` | `{ ok: false, reason: 'missing' | 'unreadable' }`; `resolvePersonaRef(db, tableName, personaId)` → `{ ok: true, persona }` | `{ ok: false, reason: 'missing' | 'inactive' }`. An empty/absent id is `{ ok: true, prompt: null }` — clearing a value is always allowed.
- Consumes: the prompt library lookup that `get-ai-summary.js` already uses (`promptLibrariesFor(orgId)`: the org partition then the platform partition). **Read that function first and reuse its key construction rather than rebuilding it**; if it is not exported, export it without changing its behaviour, or lift it into this module and have `get-ai-summary.js` require it from here. Say in the report which you did.
- Personas are platform-global (`PK='AIPROMPTS'`, `SK='PERSONA#<id>'`), so `resolvePersonaRef` takes no org.

- [ ] **Step 1: Write the failing test** — `tests/workie-refs.js`, on `tests/helpers/moderation-harness.js` (it installs the DynamoDB stub and the KMS stub; `H.install()`, `H.seedRow`, `H.reset`, `H.test`, `H.summary`). Cases: an absent id resolves ok with a null value; a platform prompt id resolves; an org prompt id resolves for that org and is `unreadable` for a different org; a missing id is `missing`; an active persona resolves; an inactive persona is `inactive`. Then two handler cases: `edit-question-set` with a dangling `promptId` answers 400 naming the field, and with a valid one stores it; the same for `personaId`.
- [ ] **Step 2: Run it and paste the literal failure** (`Cannot find module` first).
- [ ] **Step 3: Implement.** The resolver, then the two call sites. A refusal is `400 { error: 'That summary prompt no longer exists. Choose another, or clear it to use the default for this game type.' }` (and the persona equivalent naming the voice). Keep the message plain: it is read by a builder, not an engineer.
- [ ] **Step 4: Run** `node tests/workie-refs.js`, then the neighbours: `tests/question-set-ownership.js`, `tests/share-projection.js`, `tests/publish-question-set.js`, `tests/no-global-partition-literals.js`. Paste each last line with its exit code.
- [ ] **Step 5: Commit** — `A question set can no longer point at a summary prompt or a voice that does not exist`

---

### Task 2: a copy carries only what the destination can use

**Files:**
- Modify: `lambda-functions/admin/copy-question-set.js` (the `...meta` spread, ~:165)
- Test: `tests/copy-question-set-workie.js` (new), or extend the existing copy suite if one covers this file — check first and say which you chose.

**Interfaces:** Consumes Task 1's `resolvePromptRef` / `resolvePersonaRef`.

- [ ] **Step 1: Write the failing test.** Copying a set whose `promptId` lives in the source org's library into a different org: the copy stores no `promptId`. Copying a set with a platform `promptId`: the copy keeps it. `promptDropped` is never carried onto a copy under any circumstance. A dangling `personaId` is dropped; a live one is kept.
- [ ] **Step 2: Run it and paste the failure.**
- [ ] **Step 3: Implement.** Resolve both ids against the DESTINATION's readable libraries before storing; drop what does not resolve. Always delete `promptDropped` from the copied metadata — it describes a publish that happened to a different row.
- [ ] **Step 4: Run** the new suite plus `tests/question-set-ownership.js` and `tests/publish-question-set.js`.
- [ ] **Step 5: Commit** — `Copying a set into another organisation leaves behind the prompt that organisation cannot read`

---

### Task 3: the legacy builder page stops inventing prompt ids

**Files:**
- Modify: `src/src/BuilderPage.jsx` (the hardcoded `<option>` list ~:334, the two `promptId: 'lessons-learned'` defaults ~:22 and ~:140)
- Test: `src/src/__tests__/builderPagePrompts.test.jsx` (new)

**Interfaces:** `GET admin/ai-prompts` via `authFetch` + `adminApiUrl`, the same call the console's editor makes — read how `AdminPage.jsx` loads `availablePrompts` and mirror it.

- [ ] **Step 1: First, decide whether this page is live.** Check `src/src/App.jsx` routing and grep the app for links to `/builder`. **If nothing links to it**, the change is to delete the prompt `<select>` and both hardcoded defaults, leaving the set to take the game-type default — report that you found it unreachable and say so in the commit body. **If it is reachable**, do Steps 2-4.
- [ ] **Step 2: Write the failing test** — the page renders one option per fetched prompt, defaults to the empty "Use the default for this game type" option, and never renders the literal `lessons-learned`.
- [ ] **Step 3: Run it and paste the failure.**
- [ ] **Step 4: Implement** the fetch, the empty default, and the removal of the hardcoded ids.
- [ ] **Step 5: Run** the new suite plus any existing `builder` suite, then `cd src && npm run lint 2>&1 | tail -3`.
- [ ] **Step 6: Commit** — `The builder page offers the prompts that exist instead of seven ids that do not`

---

### Task 4: a host can see Workie's settings on the set they are editing

**Files:**
- Modify: `src/src/components/HostQuestionSetsDialog.jsx` (fetch both lists; pass them to the `QuestionSetEditor` mount ~:845)
- Test: `src/src/__tests__/hostWorkieSettings.test.jsx` (new)

**Interfaces:** `GET admin/ai-prompts` and `GET admin/personas` through `authFetch`; both are allowed to hosts in `lambda-functions/auth/authorizer.js` — confirm that before you write the fetch, and if either is admins-only, STOP and report rather than adding a route.

- [ ] **Step 1: Write the failing test.** Opening the host dialog's editor for a set shows the voice select populated from the fetched personas and the summary-prompt select populated from the fetched prompts; choosing one and saving sends it. A failed fetch leaves the rest of the editor working.
- [ ] **Step 2: Run it and paste the failure.**
- [ ] **Step 3: Implement.** Fetch once when the dialog opens, not per render. **`showSummaryPrompt={false}` on the quick-create panel stays as it is** — that is a deliberate choice recorded in the file, and this task changes the EDITOR only.
- [ ] **Step 4: Run** the new suite, `__tests__/hostQuestionSets*.test.jsx` if any exist, and lint.
- [ ] **Step 5: Commit** — `A host editing a set can set its voice and its summary approach, not just an admin`

---

### Task 5: one Workie group, plain words, and no promise the product cannot keep

**Files:**
- Modify: `src/src/components/QuestionSetEditor.jsx` (the two controls ~:1210-1257), its stylesheet if a rule is needed, `src/src/components/GameSetupDialog.jsx` (~:594)
- Test: `src/src/__tests__/workieSettings.test.jsx` (new); extend the editor's palette test only if you add a CSS rule

**Interfaces:** the dialog checks a set's `promptId` against the fetched prompt list rather than trusting its presence. If `GameSetupDialog` does not already hold that list, fetch it there the same way; do not add a backend projection for this.

- [ ] **Step 1: Write the failing tests.** (a) The editor shows one **Workie** group containing two labelled rows — *Its voice* and *How it sums up each round* — each with one line of plain help. (b) When no personas are configured the voice control says so in words ("No voices are set up on this environment yet") instead of showing a single silent option; same for prompts. (c) `GameSetupDialog` claims "brings its own summary approach" ONLY when the set's `promptId` is in the fetched list; when it is set but unresolvable it says the standard-summary sentence instead.
- [ ] **Step 2: Run them and paste the failures.**
- [ ] **Step 3: Implement.** Keep the existing control semantics; this is grouping, wording and honesty, not a new mechanism. Any CSS is rooted at the editor's existing scope class, tokens only, nothing under 12px, no selector declared twice.
- [ ] **Step 4: Run** the new suite, the editor's existing suites, `__tests__/gameSetup*.test.jsx`, `__tests__/scopedClassesDeclared.test.js`, `__tests__/modalReachability.test.js`, and lint.
- [ ] **Step 5: Commit** — `Workie's voice and its summary approach read as one setting, and the setup dialog only promises what will happen`

---

### Task 6: the gate, the corrected docs, and the tiers

**Files:** `docs/handoff/2026-09-02-workie-selection-map.md` (supersession banner), `docs/handoff/public-library-2026-09-18.md` (the attribution line)

- [ ] **Step 1: The full gate.** `bash <scratchpad>/gate.sh <worktree> workie-wave` — backend suites ≥145 / 0 failed, frontend ≥219, lint 0 errors / ≤10 warnings, build, template valid. Paste it whole.
- [ ] **Step 2: Correct the two docs.** The 2026-09-02 map gets a banner naming what this plan changed and what its own list got wrong (the org prompt is visible; hosts may read the persona list; the ownership check on changing a persona exists; and, after Task 4, hosts can set both on a set). The Stage 2 handoff's line calling `Co-Authored-By: Claude Fable 5.1` "the project's literal convention" is corrected to the current attribution.
- [ ] **Step 3: Push.** `git push origin HEAD:dev` — a push to `dev` deploys dev. Then promote to test by merging, never fast-forwarding: `git checkout -B promote-test origin/test && git merge --no-ff <sha> -m "Merge branch 'dev' into test" && git push origin promote-test:test`. Name both commits and both tiers.
- [ ] **Step 4: Tell the owner what to check**, including the one thing this plan cannot verify from here: whether persona rows are seeded on each tier (`scripts/seed-personas.js`; there is no write API), which is the difference between a picker with real voices and a picker with one option.
