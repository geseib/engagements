# Handoff — the 2026-09-20 integration

**Branch:** `working/integration-2026-09-20`, checked out in the main checkout.
**Base:** local `dev` at `4395468b` (origin/dev `fb0b074a` + the marketing merge).
**Nothing has been pushed.** Pushing `dev` ships everything below as one deploy.

## 0. Why this exists

On 2026-09-20 the repo held 26 worktrees and 81 local branches left by parallel
sessions. Three of them had fixed the same flaky test without knowing about each
other; two had rewritten different sentences of one component. They were drained
through this one branch and gated once, so that one push is one deploy.

## 1. What is on it

| Work | Source branch | How it landed |
|---|---|---|
| Marketing home, `/how-it-works`, `/use-cases`, `/reports`, `/help`, `/join` | `working/marketing-home` | via local `dev`; see `marketing-home-2026-09-20.md` |
| The AI-draft test no longer times out under load | `gallant-wiles` + `compassionate-napier` | one `draftIt()` fix kept (panel-scoped, held node, 4000ms); napier's `testTimeout: 30000` kept, its comment corrected to the true inner wait |
| A takedown no longer says "0 of 30 questions were flagged" | `hopeful-gagarin` | clean |
| A refused re-share no longer claims the set is private | `vibrant-bhaskara` | hand-merged over the row above; both sessions' tests pass together |
| The projector reads `c`, `optionc`, `Option C` | `awesome-ritchie` (carries `affectionate-mcnulty`) | clean |
| The scorer resolves an answer through the question's filled slots, and scores org and public sets | `trivia-scoring-org-scope` (carries `trivia-scoring-slots`; replaces `blissful-curie`) | clean |
| A new set is born at v1 | `elegant-varahamihira` | its handoff's §3 recipe; see `set-version-contract-2026-09-20.md` |
| The category filter stops filtering once its category has gone | `kind-keller` | clean |
| A generated batch names the prompt that wrote it | `dreamy-carson` | clean |
| AI metadata drafting finds an organisation's own set | `bold-wing` | clean |
| The moderation queue's why line reads bands per category | `queue-band-words` | one conflict in `set-check-worker.js`; `checkReasons` landed inside the current re-check structure |
| A regenerated report is never less complete than the stored one | `ecstatic-villani` | test-file conflict only; both sides' tests kept |
| One unreadable set row no longer empties the list | `mystifying-tu` | extended: an unreadable row withholds Edit, Share, Open and Copy (Delete stays) |
| `scripts/worktree-cleanup.sh` | this session | new |

Two backend tests were corrected because the code they read had moved, not
because behaviour changed: `session-control-routes-authorization.js` now reads
`hooks/useJoinCode.js` for the unauthenticated join fetch (and checks that
neither caller grew its own copy); `set-topics.js` reads a new set's rows at
`#v1`.

## 2. Gates, measured at `7ccc9bc4`

| gate | result |
|---|---|
| backend, every `tests/*.js` except `*.spec.js`, after `rm -rf .aws-sam` | 161 suites / 0 failed |
| frontend, `cd src && npm test` | 266 suites / 6573 tests, exit 0 |
| lint | 0 errors, 10 pre-existing warnings |
| build | exit 0, two pre-existing bundle-size warnings |
| `no-retired-twin-references.js`, `no-global-partition-literals.js` | both exit 0 |

Re-run all of it if anything else is merged before the push.

## 3. Owner decisions recorded here so they are not re-opened

- **No backfill of trivia scores** (2026-09-20). Sessions already played on an org
  or public set keep their unscored answer rows; `get-results.js` sums the stored
  `PointsEarned` and nothing rewrites it. The scorer is fixed going forward only.
- **A set shared before it had a version reads "Shared earlier, yours is vN."**
  The handoff for the version contract asked for a wording; this is it.
- **`a1facf31` went in with `7f051b21`.** They are the two halves of one bug.
- **Legacy sets are never migrated.** Do not run `scripts/migrate-set-versions.js`.

## 4. Retired without merging

`heuristic-blackwell` and `laughing-proskuriakova` — superseded: `dev` already
decrypts a set's metadata when it publishes (`publish-question-set.js`,
`plainMeta`). One gap from the first survives as its own task: publishing a
non-active version stamps the public row with the ACTIVE version's
`questionCount`, `categoryCount` and `hasImages`.

Every branch that held commits `dev` lacked is tagged `archive/2026-09-20/<name>`.
Uncommitted diffs from six worktrees are in `.superpowers/rescue-2026-09-20/`
(git-ignored, this machine only).

## 5. Still open

- **Two tasks are running in their own sessions:** finishing the save-in-flight
  fix in `adoring-blackburn`, and porting the rest of `relaxed-wright`
  (`working/prompt-scope-port`: `ai-prompt-advisor.js` still reads only the
  platform prompt library, and no writer records which library a set's Workie
  came from). Merge each here when it reports green, re-gate, then push.
- **Four worktrees hold old uncommitted work with no report:** `busy-shannon`
  (2025-08), `dazzling-napier`, `mystifying-franklin`, `wizardly-pike` (2026-08).
  Snapshotted; the owner decides whether each is looked at or dropped.
- **Four old branches hold one unmerged commit each:**
  `claude/wavelength-ai-summary-commonwords`, `release/1.2.0`,
  `feature/archiver`, `fix/archive-art-export`.
- `copyPartition` copies REVIEW and PUBLISHED rows with no filter, so a replace
  carries the legacy verdict into v1. Benign today; an approval-laundering shape.
  Pre-existing and nobody's work yet.
- `HostQuestionSetsDialog`'s Rename and "Edit questions" are not withheld for an
  unreadable set row.

## 6. To ship

1. Fast-forward `dev` to this branch and push the BRANCH (never a tag as well).
   A push to `dev` is a deploy. Name the commit and the tier.
2. Check `engage.dev.seibtribe.us` signed out: `/` is the marketing home, a code
   typed into the hero joins, `/join` is the old page; then a trivia round on an
   org set scores.
3. `test` is merged into, never fast-forwarded. Prod only after test.
4. A day after the push, `scripts/worktree-cleanup.sh` (dry run), then `--apply`.
   Old worktrees whose work was re-implemented rather than merged need
   `--retire <dir>`: `keen-easley-a86895` once the prompt-scope port lands.
