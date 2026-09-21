# Handoff — a new set is born at v1

**Worktree:** `.claude/worktrees/elegant-varahamihira-d675ac`
**Branch:** `working/elegant-varahamihira-d675ac`
**Commit:** `e53db4b1` — one commit, working tree clean, **not pushed**
**Base:** `eb7cbb23` (origin/dev at the time). `origin/dev` is now `fb0b074a`, **75 commits ahead**.
**Written:** 2026-09-20

---

## 0. What you are picking up, in one paragraph

Sets were reaching the public library with `sourceVersion` NULL. The cause was
not a broken writer: **no creation path set a version at all.** A new set was
created unversioned by design, and only a REPLACE ever minted one. That is
fixed — a new set now opens its version history at v1 — plus two consequences of
the null that were live bugs. The work is committed and fully green on its base.
**It does not merge cleanly onto today's dev**, and the conflict is not textual
noise: dev rewrote the same function for other reasons and still carries one of
the two bugs. Section 3 is the part that needs a person's judgement; everything
else is mechanical.

---

## 1. The finding (evidence, so you don't have to re-derive it)

`upload-questions.js` created every new set UNVERSIONED on purpose — its own
comment said *"a new set is version-less until it is migrated or first
replaced"* — and `copy-question-set.js` said it outright with
`activeVersion: null`. All three creation routes (CSV upload, AI generation,
manual builder) go through that one handler; `src/src/utils/questionRows.js:9`
states it is the only writer of question rows. So the AI generator was not
failing to set a version. **No creator set one.**

Measured on the live `engagedev` table, 2026-09-19 (`AWS_PROFILE=adminaccess`,
`us-east-1`):

| scope | sets | no `activeVersion` |
|---|---|---|
| platform (`PK=SETS`) | 21 | **15** |
| org `org_WLZyeb6wGSarf1grsXGxSM` | 4 | 3 |
| org `org_Y8LbpJ77xSLR6vZ8VRDbSi` | 2 | 2 |

Every unversioned one was created *after* versioning shipped (2026-08-08). Of
the four public sets, three carry `sourceVersion: NULL`; the only one with a
number (`80striviav3`, v2) happened to be replaced before it was shared.

**The lesson that generalises:** the per-version moderation record — REVIEW row,
share stamp, `sourceVersion`, snapshot key — was running in its degraded
null-handling branch for the *majority* of sets, and nothing ever errored. Also
`scripts/migrate-set-versions.js` could never finish, because it sweeps legacy
rows the importer kept making.

### Owner's two decisions (2026-09-20, asked and answered)

1. **A new set is born at v1**, *and* the consumers are fixed so sets already in
   the legacy state behave honestly.
2. **Nothing is migrated and nothing is swept.** Legacy stays a permanently
   supported READ state. **Do not run `scripts/migrate-set-versions.js`.**

---

## 2. What `e53db4b1` changes

**Production (7 files):**

- `lambda-functions/admin/shared/set-version.js` (+ the `game/` and
  `websocket/` copies, kept byte-identical — there is a drift test) — adds and
  exports `FIRST_VERSION = 1`.
- `lambda-functions/admin/upload-questions.js` — a non-replace import targets
  `FIRST_VERSION`; the new set's metadata carries `activeVersion: 1` and a
  `versions[]` entry. The legacy snapshot branch is **untouched**.
- `lambda-functions/admin/copy-question-set.js` — a copy lands at `#v1` with its
  own `versions[]`. The REVIEW/PUBLISHED filter stays and its comment now says
  why it is *more* necessary, not less: dropping it would put the library's
  verdict at the copy's own v1 key, which a publish naming no version resolves
  straight onto.
- `lambda-functions/admin/import-from-archive.js` — reported `version: null`
  hardcoded for a legacy CSV restore regardless of what the import wrote; now
  reports the real version.
- `src/src/utils/shareState.js` — **see §3.**

**Tests (13 files).** The substantive ones:

- `tests/set-versioning-flow.js` — new `makeLegacy(setId)` helper, a new section
  5b drilling a replace of a *genuinely* pre-versioning set, and the guard
  described in §5.
- `tests/copied-set-review.js` — a copy is born at v1 with its own history.
- The rest are fixture corrections (see §6 — read that before you "fix" one).

---

## 3. ⚠️ THE MERGE — this is the part that needs judgement

`git merge e53db4b1` onto `origin/dev` (`fb0b074a`) **conflicts in exactly two
files**, both shareState. Everything else auto-merges, including
`upload-questions.js`, which took 5 commits on dev:

```
CONFLICT (content): src/src/utils/shareState.js
CONFLICT (content): src/src/__tests__/shareState.test.js
```

**Do not resolve these textually.** Dev rewrote that whole block for unrelated
reasons (commits `01c9557b`, `6a189454`, `b6a133c7`, `45878a85`, `99fa8853`):
the vocabulary changed from *Public* to *Shared*, the `behind` label became
`Shared v2, yours is v3`, the key became `shared`, and `shareStateOf` gained a
third argument `{ canShare }` that steers the hover text.

**Dev still has the bug.** Its published branch reads:

```js
if (active && shared && active > shared) {
```

`shared` is null for any set shared while unversioned — the live stamp for
`serialmurdersthroughouttimetriviaforcrimebuffs` has **no `version` key at all**
— so the comparison short-circuits and the set reads a flat *Shared* forever
even after it has been replaced and moved on. That is precisely the state
`docs/superpowers/specs/2026-08-25-public-library-design.md:165` records
`sourceVersion` for.

### How to resolve

1. Take **dev's** version of both files wholesale (`git checkout --theirs`).
2. Re-apply the semantic fix, one line:

```js
// A missing share version is not unknown, it is v1: every path that mints v1
// from legacy content copies it verbatim (migrate-set-versions.js, and the
// snapshot a replace or a restore takes first). So v1 is not behind; v2 is.
if (active && active > (shared || 1)) {
```

3. **The label needs a branch too, not just the title.** Under dev's wording,
   `Shared v${shared}, yours is v${active}` renders as `Shared vnull, yours is
   v2` when `shared` is null. **This is a wording decision — ask the owner
   rather than inventing one.** Something like *"Shared earlier, yours is v2"*
   works, and the hover should keep dev's `canShare` split.
4. Re-add the two tests from this branch, rewritten into dev's vocabulary:
   - a set shared while unversioned and **since replaced** reads `behind`;
   - a set shared while unversioned and only **migrated to v1** does **not**.

**Verified no semantic clash:** dev's own test *"a published stamp with no
recorded version still says Shared"* passes `no activeVersion`, so
`active && …` is false and my rule leaves it alone. Dev's `behind` test uses
shared=2 / active=3, unaffected by `|| 1`.

---

## 4. Verification already done (and the trap that fakes a red tree)

At base `eb7cbb23`, measured against a pristine baseline worktree at the same
commit:

| gate | result |
|---|---|
| backend | **150 suites / 0 failed** (baseline identical) |
| frontend | **230 suites / 5476 tests**, all pass |
| lint | **0 errors**, 10 pre-existing warnings |
| build | exit 0, the two pre-existing bundle-size warnings |

**You must re-run all of this after the merge** — the numbers above are for the
old base, and dev has moved 75 commits.

### The trap

This worktree had **no `src/node_modules` and no `lambda-functions/node_modules`**.
Without them, 57 of 150 backend suites die with `stub(): could not resolve
@aws-sdk/client-dynamodb` and read as a mass regression, and `npx jest` exits 0
on a run that never happened. Both are now **symlinks to the main checkout**:

```
src/node_modules              -> /Users/georgeseib/Documents/projects/engage2/src/node_modules
lambda-functions/node_modules -> /Users/georgeseib/Documents/projects/engage2/lambda-functions/node_modules
```

They are gitignored on this branch and do **not** show in `git status`. Leave
them or `unlink` them when done — never `rm -r` with a trailing slash, which
recurses into the main checkout's real tree. `memory/engage2-running-the-suites.md`
documents this at length, including that `cp -Rc` (APFS clone, ~6s) is better
than a symlink because it survives a reinstall in the main checkout, and that
the main checkout has **five** such trees besides root (`src/`,
`lambda-functions/`, `.../websocket/`, `.../auth/`, `.../admin/`).

Commands:

```bash
cd src && npm test          # plain jest — NEVER npx react-scripts test
cd src && npm run lint && npm run build
for f in tests/*.js; do case "$f" in *.spec.js) continue;; esac; node "$f" >/dev/null 2>&1 || echo "FAILED: $f"; done
```

---

## 5. The guard that pins the actual bug

In section 2 of `tests/set-versioning-flow.js`:

```js
check('a newly created set resolves to v1, not to the legacy partition', () => {
  const meta = plainRow(ORG, store.get(`ORG#${ORG}#SETS|SET#demoset`));
  const r = resolver.resolvePartitionFromMeta({ scope: 'org', orgId: ORG, setId: 'demoset' }, meta, undefined);
  assert.strictEqual(r.version, 1, 'the share path would record a null version');
  ...
});
```

That is the exact junction `check-question-set.js:79` resolves through before
handing a version to the worker, the share stamp and `publish-set.js`'s
`sourceVersion`. **Run against the unmodified base it fails with
`the share path would record a null version — null !== 1`** — the reported bug
reproduced at its source. Keep this test through the merge; it is the one that
proves the fix, and it is independent of the shareState wording.

---

## 6. Do not "fix" these fixtures back

Several suites used `importSet(...)` as a way to *obtain* a legacy set. Once an
import is versioned, that silently stops testing the legacy path — the test goes
on passing while covering nothing. They now build the state explicitly with
`makeLegacy(setId)` (moves `#v1` rows to the unsuffixed partition, strips
`activeVersion`/`versions`). If you see a test reach for an import to get a
legacy set, use the helper instead.

Deliberately still unversioned, and correct that way:

- `tests/tenant-crypto-wiring.js` — the pre-encryption "Legacy Retro" fixture
  (`ORG_CONTENT`, not `ORG_CONTENT_V1`).
- `tests/platform-console.js` — the seeded legacy platform set.
- `tests/tenant-set-scoping.js` — the seeded platform set at `SET#<id>`.

---

## 7. Open items — flagged, deliberately not done

1. ~~**`public-library-item.js` `Number(meta.sourceVersion) || 0`.**~~
   **CLOSED — already on dev, verified 2026-09-20.** The `scorecard-recheck`
   work has landed and fixed **both** sites: `standing()` (`:108`) and the
   DELETE/takedown handler (`:211`) now use `toVersion(meta.sourceVersion)`, and
   the queue delete is unconditional, so the orphan row at `…#v0` that the
   `if (version)` guard used to leave behind is gone. Nothing to do. Recorded
   here only so it is not re-opened.
2. **`copyPartition` copies REVIEW and PUBLISHED rows.** It queries the whole
   partition with no SK filter, so the legacy→v1 snapshot a replace takes carries
   the legacy verdict into v1. `publish-set.js` and `copy-question-set.js` both
   filter those rows explicitly; `copyPartition` does not. Benign **today** (v1 is
   a verbatim copy of content that did pass), but it is an approval-laundering
   shape and the module's own docstring is about preventing exactly that.
   Pre-existing; untouched by this commit.
3. **`vnull` in `snapshotKeyFor`** (`set-check-worker.js:45`) — a null version
   interpolates to the literal `.../vnull/...`. Unique and harmless, and it only
   fires for genuinely legacy sets now. Left alone as unrequested churn; mentioned
   because it appears in the original evidence.
4. **Nothing is deployed.** No push, no tag. Per `CLAUDE.md`, a branch push to
   `dev` *is* a deploy, so the merge must be green locally first.

---

## 8. Suggested close-out

1. Merge `origin/dev` into the branch (or rebase), resolving §3 — get the owner's
   call on the label wording.
2. Re-run all four gates (§4). Run the frontend suite **twice**: `questionSetDetailsAi.test.jsx`
   has a known load flake, and `memory/engage2-running-the-suites.md` notes the
   pipeline runs no tests at all, so the local gate is the only gate.
3. Push to `dev` (this deploys dev). Name the commit and the tier in the reply.
4. Watch dev, then merge to `test` — `test` is **merged into, never
   fast-forwarded**; it has diverged by design.
5. Prod only after test has been looked at; it halts at `ApprovalForProd`.

Related memory: `engage2-set-version-contract`, `engage2-running-the-suites`,
`engage2-game-set-pair`, `engage2-promoting-to-test`.
