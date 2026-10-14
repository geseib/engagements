# Brief: the tooling a fleet needs to skin every page

**For the next agent.** You build the tools and guidance; you do not migrate any surface and you
do not build Phase 0 (that is the first fleet job). Read first: repo `CLAUDE.md`,
`.claude/skills/engage-design/SKILL.md` + `references/`, then `SPEC.md`, `INVENTORY.md`,
`PLAN.md` in this folder.

## 0. Constraints

| | |
|---|---|
| Where | `scripts/skins/` (node CLIs), `src/src/testing/skinHarness.js` (jest helper — **not** under `__tests__/`: jest's `testMatch` runs every `.js` there as a suite), `src/src/__tests__/skin*Palette.test.js`, `docs/design/themes/` (worker prompt, checklist, records). |
| Runtime | Node 18 for anything jest loads (the pipeline); scripts may assume the local Node 22 but must not need it. |
| Dependencies | **No `npm install`.** Available without installing: `postcss` (in `src/node_modules`, via `css-loader`), `playwright` + `@playwright/test` (repo-root `node_modules`, Chromium 1181/1208 already in `~/Library/Caches/ms-playwright`). jest tests use **regex over text** (the repo's pattern), not postcss, so they cannot break on a transitive dep. |
| Names | nothing with `token` in it (`.gitignore:35`). Tests end `Palette.test.js`. |
| Not yours | product code. The one exception you may propose (not build without the owner's yes): the dev-only skin gallery route in §5.3. |
| Done | every tool has a `--help`, a self-test (`node scripts/skins/<tool>.js --selftest` exits 0 on a fixture and non-zero on a planted failure), and a worked example in §7's record format. |

## 1. Measure (`scripts/skins/measure.js`)

Reproduces every count in `INVENTORY.md` so workers and reviewers re-measure instead of trusting.

| Flag | Output |
|---|---|
| (none) | markdown tables = INVENTORY §1-§2, to stdout |
| `--json` | `{ file: { lines, ruleLiterals, declLiterals, fontLiterals, primary, secondary, amberTints, blueTints, paletteTests[], cssTests[] } }` |
| `--file <path>` / `--range SC-03` | one file / one `styles.css` unit (range found by its banner text, INVENTORY §3) |
| `--jsx` | quoted colour literals and `fill=`/`stroke=` in `.jsx`/`.js` (excl. `__tests__`) |

Algorithm (keep it byte-compatible with the gate in §4 — share one module, `scripts/skins/lib/scan.js`, and have the jest gate `require` a copy held equal by a test, or inline the same regexes):

1. Strip `/* … */` comments.
2. Split on `[;{}]`. A piece matching `^\s*--[\w-]+\s*:` is a **token declaration**, else a **rule declaration**.
3. Colour literal: `#[0-9a-fA-F]{3,8}\b` or `\b(rgba?|hsla?)\(` — **except** `rgb(var(--…-rgb) / a)`; plus the words `white`/`black` as a value.
4. Font literal: `font-family:` whose value does not start with `var(` or `inherit`; `font:` shorthand containing a quoted family or a known family word (`monospace`, `serif`, `sans-serif`, `system-ui`, `Georgia`, `Menlo`, …) outside `var()`.

### 1.4 `scripts/skins/deadSelectors.js --file <css> [--range SC-xx]`

For each class in the stylesheet, search `src/src/**/*.{js,jsx}` (excl. `__tests__`) for the
class as a string token, a template-literal fragment, or a `classnames`-style key. Report **live /
dead / unsure** (unsure = built dynamically, e.g. `` `phase-${x}` ``). Report only; a worker
deletes a dead rule after reading it. Expect many hits in SC-02 (legacy remote) and SC-07.

## 2. Test harness (`src/src/testing/skinHarness.js`)

Every palette test today retypes token values or reads them with `token(GLOBAL_CSS, ':root {', …)`
(`references/testing-a-surface.md` §1). After Phase 0a the values live in `styles/skins/*.css`
and `styles/roles.css`, so give tests one door:

```js
const H = require('../testing/skinHarness');
H.SKINS;                                   // ['classic','present'] read from config/skins.js
H.THEMES;                                  // ['dark','light']
H.role('--accent-text', { skin: 'present', theme: 'dark' });   // '#9CBEF0' (resolved through roles.css)
H.channel('--accent-rgb', { skin });       // [124,167,230]
H.css('components/QuestionSetsPanel.css'); // text, comments kept
H.scopeVar(css, '.qsets {', '--qsets-rule', { skin, theme }); // resolves var()/rgb(var()) chains
H.composite(['#0F1A2E', 'rgba(124,167,230,.16)', ...]);        // the audit's bgOf, as today
H.ratio(fg, bg); H.AA;                    // 4.5
H.eachSkinTheme((skin, theme) => { … });  // describe.each helper
```

Lift `lin/lum/ratio/alphaOver/bgOf` verbatim from `references/testing-a-surface.md` §1 (which lifts
them from `docs/design/admin-redesign/audit.html`). Resolution must follow the real cascade: a
role declared on `:root` and on `[data-theme]`, a skin's values on `:root[data-skin]`, Classic as
the bare-`:root` fallback, `rgb(var(--x-rgb) / a)` → rgba. Self-test: resolve every role in both
skins × both themes and compare to the SPEC §4 tables (a fixture copy of them).

Ship with it **the codemod for tests** (`scripts/skins/retarget-tests.js`): rewrites
`token(GLOBAL_CSS, ROOT|DUSK, '--x')` reads to `H.role('--x', { skin: 'classic', theme })` so 0a can
move ~60 palette tests mechanically. Report-only by default; `--apply` writes.

## 3. Codemod (`scripts/skins/codemod.js`)

Two modes. It never decides an accent-vs-action question on its own.

| Mode | Does |
|---|---|
| `--report --file <css> [--range]` | Lists every literal and every `var(--primary…)`/`var(--secondary)` with line, selector, property, and a **proposal**: exact role match (`rgba(155,168,190,.20)` → `var(--rule)`), channel form (`rgba(155,168,190,.28)` → `rgb(var(--slate-rgb) / .28)`), or **DECIDE** (every `--primary`/`--secondary`, every literal with no exact match). Writes `docs/design/themes/records/<unit>.decisions.json` with one entry per DECIDE, `choice: null`. |
| `--apply --file <css> --decisions <json>` | Applies exact and channel proposals, plus each DECIDE the worker filled in (`action`, `accent`, `accent-text`, `info`, `warn`, `keep:<reason>`). Refuses if any DECIDE is still `null`. Lowers the file's `skin-allowance` pragma to the new count. |
| `--tokens-only` | Phase 0b: touches only token declarations (scope palettes), never rules. |

Heuristics for the proposal text (shown, never applied without a decision): `background*` of a
selector containing `btn|button|primary|go|cta|submit` → `action`; `color`/`border-color` on
`chip|badge|pip|meter|count|selected|is-on|active|current|tab` → `accent` / `accent-text`;
`--secondary` on `a`, `link`, `connected`, `ws-` → `info`. The exact-match table is generated from
`styles/skins/classic.css` + `roles.css`, so it changes when values change.

## 4. The gate (`src/src/__tests__/skinLiteralsPalette.test.js`) and the allowances

Spec: SPEC §7. Build it with the scanner from §1, plus:

| Piece | Detail |
|---|---|
| Pragma | `/* skin-allowance: colour=<n> font=<n> */` in the first comment block of a stylesheet; in `styles.css`, `/* skin-allowance SC-03: colour=<n> font=<n> */` beside each unit banner, governing lines to the next marker. JSX: one pragma comment per file, `// skin-allowance: colour=<n>`. |
| Ratchet | count > allowance → fail "N new literals in X"; count < allowance → fail "lower X's allowance to N" (so allowances never go stale). |
| Seeding | `scripts/skins/seed-allowances.js --apply` writes every pragma at the measured count. Run once in Phase 0e, after 0b lands. |
| Also asserts | no `var(--primary` / `var(--secondary` in a file whose allowance is `colour=0`; no `data-skin` attribute in JSX outside `SkinProvider.jsx` and `SiteSkinPanel.jsx`; no `--sk-*` read outside `styles/roles.css`; no `--L-*`, `--floor`, `--hair`, `--*-t-*` declared in a skin file. |
| Messages | name the file, line, selector, the literal, and the codemod command that fixes it. |

## 5. Verification

### 5.1 Static Classic equivalence (`scripts/skins/classicEquivalence.js --base <git-ref> --files …`) — the primary gate

Rendering every authenticated surface is not possible from a worker (no sign-in), so prove
"Classic unchanged" statically: for each changed stylesheet, parse base and head with postcss,
**resolve every declaration** by substituting roles and `--sk-*` with Classic values under each
theme the file renders in (`dark`, `light` or both — the worker declares it in the record), and
compare resolved declarations selector by selector. Output: `0 differences` or a list. A
difference is either fixed or recorded as an accepted Classic delta. Self-test: a planted `.20` →
`.22` alpha change must be reported.

### 5.2 Screenshots (`scripts/skins/shoot.js`, `scripts/skins/diff.js`)

| | |
|---|---|
| Server | serve `src/dist` (after `npm run build`) from a tiny Node `http` server with `index.html` fallback; stub `/config.js`; intercept the API with `page.route` from fixtures in `scripts/skins/fixtures/` (`GET /site`, `/games/{id}`, `/games/{id}/state`, `/join/{code}`, …). Never call a real tier. |
| Skins | `page.addInitScript(() => localStorage.setItem('engage.skin', '<id>'))` before `goto`; also assert `document.documentElement.dataset.skin` after load. |
| Viewports | **375×812, 660×900, 1280×800**; the Presentation and stage additionally at **1920×1080** with each display profile class. |
| Routes | public: `/home`, `/how-it-works`, `/use-cases`, `/build-room`, `/reports`, `/help`, `/join`, `/auth`, `/privacy`, `/terms`, `/shared-report?…` (fixture), `/present?gameId=…` (fixture per moment: lobby, answering, voting, tally, navigator, read), `/play?gameId=…` (fixture per phase). Signed-in surfaces: via the gallery (§5.3). |
| Output | `docs/design/themes/shots/<unit>/<route>@<w>-<skin>.png` (git-ignored by a new `docs/design/themes/shots/.gitignore`), plus `index.html` showing Classic/Present side by side per route. |
| Diff | `diff.js --unit <id> --skin classic --base <dir>` uses `@playwright/test`'s comparator (pixelmatch inside); threshold 0; prints changed-pixel counts per shot. |
| Also measure | per the owner's rule (memory "Dialogs on screen"): every dialog and menu's `getBoundingClientRect()` vs `innerWidth` at 660 and 375 — layout must not move between skins; report any box whose rect differs between Classic and Present by > 0.5px. |

### 5.3 The skin gallery (proposal; owner's yes needed — it is product code)

A dev-only route `/dev/skins` (mounted only when `window.ENV === 'development'` **and** a
`?gallery=1` flag, excluded from the prod bundle by a `process.env.NODE_ENV` guard) that renders:
every `components/ui/*` component in every variant; and **fixture mounts** of presentational
surfaces that take a model as props (`PresentMoments`, `Scoreboard` looks, `ScoreCard`,
`SurveyResults` kinds, `QuestionPreview`, `RoundReport`, `TallyRow` lists, the admin panels with a
mocked `adminApi`). Each mount has a fixed id so `shoot.js --gallery` can screenshot it. Workers
add a fixture for their surface as part of their unit. Without the gallery, signed-in surfaces
fall back to §5.1 plus an owner walk on dev (memory: Google sign-in passes through in the Browser
pane).

## 6. Worker kit (write these files)

### 6.1 `docs/design/themes/WORKER-CHECKLIST.md`

1. Read SPEC §3-§4 and your unit row in PLAN. Re-derive your files/range; confirm nobody else's
   wave owns them.
2. `measure.js --file` each file; paste the "before" numbers into your record.
3. `deadSelectors.js`; delete dead rules (one commit, "remove dead CSS"), re-measure.
4. `codemod.js --report`; fill every DECIDE in `records/<unit>.decisions.json` using SPEC §4.4,
   with a one-line reason for every `keep:`.
5. `codemod.js --apply`; adopt the listed `components/ui/*` where the element already exists —
   **no layout change**.
6. Update/extend the palette test(s) you own with `H.eachSkinTheme`; AA on every pairing and tint.
7. Lower the `skin-allowance` pragma (the codemod does it; check).
8. `classicEquivalence.js --base <wave-start-ref>` → 0 differences (or deltas recorded).
9. `shoot.js` + `diff.js` for your routes/gallery fixtures; attach the side-by-side index.
10. Gates (PLAN §1). Commit. Write the record. Hand back.

### 6.2 `docs/design/themes/WORKER-PROMPT.md` (template the orchestrator fills)

```
You are converting {UNIT_ID} of the Engage site-skins migration.
Repo worktree: {WORKTREE}. Branch from {BASE_REF}. Do NOT push, deploy or npm install.
Read: CLAUDE.md, .claude/skills/engage-design/SKILL.md, docs/design/themes/{SPEC,PLAN}.md,
docs/design/themes/WORKER-CHECKLIST.md.
You own exactly these files (edit nothing else): {FILES}
styles.css range (if any): {SC_RANGE} — re-derive from its banner "{BANNER}".
Shared tests you own: {OWNED_TESTS}. Shared tests you must NOT edit (send assertions in your
record instead): {FOREIGN_TESTS}.
Components to adopt where the element already exists: {COMPONENTS}.
Theme(s) these sheets render in: {THEMES}.
Routes/gallery fixtures to shoot: {ROUTES}.
Done when: allowance pragmas at {TARGET}; classicEquivalence 0 differences (or each delta
recorded); every PLAN §1 gate green; record written to docs/design/themes/records/{UNIT_ID}.md.
Report: commit sha, before/after counts, decisions count by kind, deltas, tests touched,
anything you could not do and why.
```

### 6.3 Records (`docs/design/themes/records/<unit>.md` + `.decisions.json`)

| Section | Content |
|---|---|
| Header | unit id, commit sha, base ref, worker, date |
| Counts | before/after from `measure.js` per file: rule literals, decl literals, font literals, `--primary`, `--secondary` |
| Decisions | totals by kind (`action`/`accent`/`accent-text`/`info`/`warn`/`keep`) with the `keep` reasons listed |
| Classic | `classicEquivalence` output; accepted deltas with reason (owner reviews these in a batch) |
| Present | link to the shots index; anything that looks wrong but is "layout" (not this project's) |
| Tests | files touched; foreign assertions handed to their owners |
| Gates | the exact commands and their final lines (suite counts) |

The orchestrator rolls records into `docs/design/themes/PROGRESS.md` (one row per unit: status,
sha, before → after counts) and re-runs `measure.js` on the integration branch after each merge;
the INVENTORY totals are regenerated from it, never edited by hand.

## 7. Acceptance for this brief

| Deliverable | Accepted when |
|---|---|
| `measure.js` | reproduces INVENTORY §1 totals at `16e8c3dd` exactly (1,731 / 514 / 40 / 796 / 153) |
| `deadSelectors.js` | self-test finds a planted dead class and spares a template-built one |
| `skinHarness.js` + `retarget-tests.js` | a dry run over `__tests__/*Palette.test.js` lists every rewrite; applying it to a scratch copy keeps those suites green before 0a lands (Classic values identical) |
| `codemod.js` | report + apply round-trip on `ScoreCard.css` in a scratch copy, with a filled decisions file, yields allowance 0 and 0 Classic differences |
| gate test + `seed-allowances.js` | green at today's counts; adding one `#fff` anywhere fails with the fix command in the message |
| `classicEquivalence.js` | self-test as in §5.1 |
| `shoot.js` / `diff.js` | produce the side-by-side index for the public routes and `/present` fixtures in both skins (Present skin values may be a stub until 0a lands) |
| Worker kit | checklist, prompt template, record template committed in `docs/design/themes/` |
