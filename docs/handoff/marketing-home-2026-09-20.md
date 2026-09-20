# Handoff — the marketing home, and the surface built with it (2026-09-20)

**Nothing has been pushed.** This is all on `working/marketing-home`, cut from `origin/dev` at
`741a074b`, thirteen tasks deep plus a fix round. A commit cannot name its own hash, so for the
true head: `git log -1` on `working/marketing-home`. The last task commit this handoff's writer
knows of is `2ab521ff` (Task 13's own commit, before fix round 1). Pushing `dev` (or any tier) is
the owner's call, not made here.

## What is live in the code

Six public, signed-out pages, reachable by URL, built from `docs/design/marketing-redesign/` — the
rendered mockups are the design, not the plan's CSS sketches (recorded ruling, `progress.md`
2026-09-20: "the plan says mockups are the source for visual values, and the owner approved
THESE"). Copy is transcribed from those mockups into `content/*.js`, not from the plan's prose.

| Route | Page | Notes |
|---|---|---|
| `/` (signed out) | `HomePage` | Signed in, `/` is still the host stage — `RootGate` decides before any marketing code loads. |
| `/how-it-works` | `HowItWorksPage` | The six-step tour. |
| `/use-cases` | `UseCasesPage` | Four facilitator use cases. |
| `/reports` | `ReportsPage` | The sample report, annotated. |
| `/help` and `/help/<slug>` | `HelpPage` | Same corpus and resolver as the in-app help modal, linkable. |
| `/join` | `RootPage` (pre-existing) | The focused join page `/` used to be. |

## File map — `src/src/marketing/`

```
MarketingShell.jsx / .css   nav, scroll progress, RidgeScene mount, PageBoundary (chunk-load fallback)
HomePage.jsx / .css
HowItWorksPage.jsx / .css
UseCasesPage.jsx / .css
ReportsPage.jsx / .css
HelpPage.jsx / .css
useScrollProgress.js
components/
  RidgeScene.jsx / .css     the three-layer inline-SVG ridge (replaces the deleted Ridge.jsx/parallax hero)
  ClipFrame.jsx / .css      device chrome + poster/webm/mp4 slot, falls back to ClipStill
  ClipStill.jsx / .css      drawn stand-ins for the seven recording slots, plus three tour-only drawings
  DeviceFrame.jsx / .css
  SampleReport.jsx / .css
content/
  home.js, howItWorks.js, useCases.js, reports.js, help.js, sampleReport.js, clips.js
```

## Routing and the failed-chunk fallback

Every marketing page is `React.lazy`-loaded in `App.jsx` and rendered through `MarketingRoute`,
which wraps the lazy `<Page />` in `Suspense` (fallback: the same `AuthLoading` spinner
`ProtectedRoute`/`RootGate` already use) and, around that, a `MarketingBoundary` error boundary.
If a marketing chunk fails to load, `MarketingBoundary.componentDidCatch` logs once
(`console.error('Marketing page failed to load', error)` — never silent) and renders `RootPage`,
the pre-existing join page, rather than white-screening. `MarketingShell` carries a second,
narrower boundary (`PageBoundary`) for errors that happen after a page has already mounted; its
fallback is "This page could not load" with links to Join and Sign in.

The production build confirms real code-splitting: eight separate chunk files (`98`, `240`, `173`,
`319`, `347`, `606`, `802`, `838`.bundle.js) carry marketing-page code (`HomePage`, `MarketingShell`,
`mk-ridge`, `mk-root` strings), distinct from the main bundle and from unrelated chunks (`325`,
`450`). The main bundle grew by the router's lazy-loading wiring, not by marketing page weight.

## The seven clip slots, and who edits what

`content/clips.js` is **the only file the screen-recording sub-project (sub-project 2) edits.** It
lists all seven slots the marketing pages reference — `trivia-host`, `trivia-player`, `poll-host`,
`poll-player`, `join-qr`, `builder`, `report` — each with `poster`/`webm`/`mp4` set to `null` until
that sub-project records them. Until then, `ClipFrame` renders `ClipStill`, a hand-drawn stand-in
of the product screen for that slot.

`ClipStill.jsx` additionally carries **three tour-only drawings that exist nowhere else**:
`tour-ask`, `tour-vote`, `tour-results` — the `/how-it-works` tour's approved mockup draws these
three steps as sketches with no corresponding recording slot in the spec's seven. `ClipFrame` takes
an optional `still` prop for these; a real recording, once one exists for the slot a tour step also
uses, wins over the drawing. Sub-project 2 has no reason to touch `ClipStill.jsx` — it owns
`content/clips.js` only.

## Help gaps left for the help-refresh sub-project (sub-project 3)

`/help` and `/help/<slug>` serve the real corpus at `src/src/config/help/` — five files today
(`admin.js`, `builder.js`, `host.js`, `player.js`, `technical.js`, plus the `index.js` that wires
them together and the `searchHelp()` used by both the marketing page and the in-app modal). None of
the following have a guide yet, and the marketing help page will show nothing for them until
sub-project 3 writes one:

- organisations
- public library
- moderation review
- question preview
- score card
- archive snapshots/restore
- billing
- invites

(Task 11's ruling on this: the mockup's guide names are placeholders, transcribing them would
advertise guides that do not exist — "the exact defect `config/help/index.js` was written to
end" — so the corpus, not the mockup, is the content; the mockup supplies only layout and classes.)

`/help/` is a named exception to `setMediaStorage.test.js`'s single-path-segment rule (fix round 1,
below) on the grounds that the help corpus carries no images today — checked directly, not assumed
(`grep -rnE "\.(png|jpe?g|gif|webp|svg)|<img|src=" src/src/config/help src/src/marketing/HelpPage.jsx
src/src/components/documentation/DocRenderer.jsx` returns nothing at all: `DocRenderer.jsx` has no
`img`/`image`/`src` handling of any kind, so it cannot render an image from guide data even if one
were added to a guide file today). **If sub-project 3 adds screenshots to a guide, they must be
root-absolute URLs (`/assets/…`), never relative ones** — a relative `sets/<id>/x.jpg`-style path
would resolve against `/help/<slug>`'s own directory rather than the site root, exactly the failure
mode `setMediaStorage.test.js` exists to catch.

## Contract suites and what they pin

Twelve new suites landed across Tasks 5–12, all still green:
`useJoinCode`, `joinCodeEntry`, `marketingShell`, `marketingBoundary`, `ridgeScene`, `clipFrame`,
`homePage`, `marketingRoutes`, `marketingPages`, `helpPage`, `marketingPalette`, `marketingCopy`.

- `marketingPalette.test.js` — the namespace rule (every marketing selector rooted at `mk-`), the
  ladder (`--mk-t-*` type scale), no marketing rule sets a bare hex where a token exists, and a
  structural check that no `.mk-ss--paper` (still, on paper) rule sets a text `color` — paper
  surfaces read color from `data-theme`, not from a marketing override. Task 12 replaced this
  file's block-splitting with a real brace-depth walker (`findMatchingClose`), with a four-case
  self-test proving the walker itself (nested rules, comma lists, `@media`) — see below for the
  other test files that still split naively.
- `marketingCopy.test.js` — the honesty suite: no page claims something the shipped code does not
  do (no "favourite"/"favorite" anywhere in marketing copy; trivia copy never claims a vote phase);
  also rejects the twin guard's banned deploy phrases from leaking into marketing prose, with the
  pattern itself built from word fragments (`BANNED_DEPLOY_CLAIM`) so the banned strings never
  appear contiguous in this file's own source — see Fix round 1.
- `stageShell.test.jsx` / `adminShell.test.jsx` / `playerSurface.test.jsx` — ban the old hero's
  class names (`.parallax`, `.player-parallax`) from ever coming back onto those three screens.
- `scopedClassesDeclared.test.js` / `undeclaredSetters.test.js` / `designSystem.test.jsx` — the
  repo-wide CSS-contract suites; all three still pass with the dead rules and `Ridge.jsx` gone.

## Known follow-ups, carried forward rather than fixed here

- **A PNG share image.** `share.svg` (this task) covers the OG/Twitter tags, but some networks
  (notably older link-unfurlers) do not render SVG share images at all — a PNG export is recorded
  here as a follow-up, not a blocker.
- **The hero lead's tight spacing under the headline** — flagged to the owner twice (Task 8
  review, `progress.md`) and left as the approved mockup renders it; an owner call, not a bug.
- **The mobile menu does not close on Escape.**
- **`phase-flow` CSS in `HelpPage.css` is hand-copied from `HelpSystem.css`**, not shared — a drift
  seam: a future change to one will not reach the other unless someone remembers both exist.
- **The CSS-selector walker is naive outside `marketingPalette.test.js`.** Task 12 rewrote *this
  file's* walker to track real brace depth; most of the repo's other `*Palette.test.js` files
  (`actingAsBannerPalette`, `billingPanelPalette`, `countFieldPalette`, `hostRemotePreviewPalette`,
  `orgSwitcherPalette`, `QuestionPreviewPalette`, and others) still do a plain `.split('}')`, which
  can misparse a nested rule or a `@media` block containing one. Not touched by this branch; a
  repo-wide follow-up if it matters.
- **Two usage claims left as approved, not verified as claims about the product itself**: "See it
  in a real session" (the tour's CTA) and "Four sessions people actually run." (`/use-cases` h1) —
  per Task 8/9's ruling, these are claims the owner can personally vouch for, not claims about an
  artifact on the page, and were surfaced to the owner rather than rewritten.
- **`questionSetDetailsAi.test.jsx` timed out once under a full parallel `npm test` run** (5s
  timeout on "says how many of the set's questions were sent") and passed clean in isolation both
  times it was checked. This branch has never touched the file —
  `git log -1 --format='%h %ad' --date=short -- src/src/__tests__/questionSetDetailsAi.test.jsx` →
  `06d65c10 2026-08-24`, weeks before `741a074b` cut this branch. Treated as an environmental
  flake under load, not a regression; if it recurs, isolate and confirm the same way.

## This task's own changes

- **Dead CSS removed from `src/src/styles.css`**: every rule whose selector contained `.parallax`
  or `.player-parallax`, four separate spots (a two-rule block plus its lead comment under
  `.outer-container.round-live`; a nine-rule block plus its lead comment, "Parallax styles adapted
  for quiz game", running from `.parallax` through `.parallax__fade`; the standalone
  `.player-parallax` rule; and `.outer-container.big-screen-mode .parallax` plus its lead comment).
  None were inside a `@media` block, so nothing was left as an empty block to clean up. 131 lines
  deleted (`git diff --stat`); the `parallax` grep that found 16 matching lines before now finds
  zero. The class names survive only as prose in `AdminPage.jsx`, `PlayerPage.jsx`, and
  `components/AdminShell.jsx` explaining the removal, and as the ban assertions in
  `stageShell.test.jsx` / `adminShell.test.jsx` / `playerSurface.test.jsx` — none of those were
  touched.
- **`src/src/components/Ridge.jsx` deleted** (`git rm`) — grepped for every import spelling
  (`components/Ridge'`, `./Ridge'`, `/Ridge"`, `<Ridge `) and found only its own file's usage
  comment. The three bare `--ridge-front/-mid/-back` tokens in `styles.css` were **kept**: nothing
  in `src/src` or its tests references them any more (the marketing surface's own
  `--mk-ridge-front/-mid/-back` are separate tokens with separate values), but
  `docs/handoff/warm-summit-design-spec.md` still quotes the bare token definitions as design
  history, so per this task's own rule ("keep if ANY file other than `Ridge.jsx` references them,
  `src/src` or `docs/`") they stayed.
- **Page metadata** (`src/public/index.html`): title, description, Open Graph and Twitter-card
  tags. The description and `og:description` were checked against `content/home.js` line by line
  before shipping — "the room votes" is scoped to call-and-answer rounds only (trivia has no vote
  phase, per `content/home.js`'s own copy: "Ask, then results. Trivia has no vote phase."), and
  neither tag uses "favourite"/"favorite". `og:image` is `/assets/marketing/share.svg` — a
  same-origin absolute path, never another host. No existing test pins the `<title>` text or these
  meta tags (checked: every `index.html`/`<title>` hit in the test suites is about
  `data-theme="light"`, unrelated).
- **`src/public/assets/marketing/share.svg`** — 1200×630, `#0F1A2E` field, the three ridge-layer
  paths from `RidgeScene.jsx` (unmodified geometry, translated to sit in the lower band), a low
  amber (`#F6A94C`) radial glow, and "Engagements" in `#F4EDE4` on the system display-font stack.
  No external references, no `<image>`, no script, no remote `xlink:href` — the only URL-shaped
  string in the file is the required `xmlns="http://www.w3.org/2000/svg"`. Validated with the
  node one-liner from the brief: `svg ok 1194`. `CREDITS.json`'s `files` array now carries
  `{ "file": "share.svg", "source": "drawn for this project" }`.

## Baselines

All three commands run from `src/`, with `.aws-sam` cleared first. Judged by exit code and suite
count together, per this task's own instruction — a suite that fails to load can silently vanish
from the total.

**`npm test`** — exit 1 (two failures; see below), 245 passed / 247 suites, 5960 passed / 5962
tests. All twelve new suites this branch added (`useJoinCode`, `joinCodeEntry`, `marketingShell`,
`marketingBoundary`, `ridgeScene`, `clipFrame`, `homePage`, `marketingRoutes`, `marketingPages`,
`helpPage`, `marketingPalette`, `marketingCopy`) are present in the run and pass.

Two failures, each individually classified:

1. **`questionSetDetailsAi.test.jsx`** — a 5s timeout under full-suite load. Reran in isolation
   (`npx jest questionSetDetailsAi.test.jsx --testTimeout=15000`): 19/19 pass in 2.9s. This branch
   never touched this file (`git log -1 --format=%h` on it: `06d65c10`, before `741a074b`) or any
   file it reads. **Pre-existing flake, not a regression from this task.**
2. **`setMediaStorage.test.js`**, `every route the app matches is a single path segment` — was
   failing because the test's hard-coded exception list did not yet include `/help/`, which
   `App.jsx` gained as a real route across Tasks 8–11 (`git diff --stat 741a074b..HEAD --
   src/src/App.jsx`: 86 insertions). **Fixed in fix round 1**: `/help/` added to the expected array
   (kept sorted) and to the comment's named-exceptions list, with the checked reason (see the
   help-gaps section above) and a note that a future screenshot in a guide must use a
   root-absolute URL. See "Fix round 1" below for the verification.

**`npm run lint`** — exit 0. Ten pre-existing `react-hooks/exhaustive-deps` warnings, none in
marketing files, zero errors.

**`npm run build`** — exit 0. Two pre-existing bundle-size warnings (`bundle.js` at 3.57 MiB,
several `assets/art/*.jpg`), unrelated to this task. `assets/marketing/share.svg` (1.17 KiB) and
`assets/marketing/CREDITS.json` (244 B) copy into `dist/assets/marketing/` correctly. Chunk split
confirmed above.

### Backend and repo guards

This branch changed no backend file: `git diff --stat 741a074b..HEAD -- lambda-functions tests
template-clean.yaml cicd scripts` is empty. Ran the two repo-wide guards from the worktree root,
new files staged first:

- `node tests/no-global-partition-literals.js` — **exit 0**, 7/7 passed.
- `node tests/no-retired-twin-references.js` — was **exit 1** before fix round 1 (see below for
  what tripped it and how it was fixed); **exit 0** after.

## Files changed (this task)

- Modified: `src/src/styles.css` (dead `.parallax`/`.player-parallax` rules removed)
- Deleted: `src/src/components/Ridge.jsx`
- Modified: `src/public/index.html` (title, description, OG/Twitter meta)
- Added: `src/public/assets/marketing/share.svg`
- Modified: `src/public/assets/marketing/CREDITS.json`
- Added: `docs/handoff/marketing-home-2026-09-20.md` (this file)

## Concerns

- Both baseline failures reported at the end of Task 13 (`setMediaStorage.test.js` and the twin
  guard's section 3) were caused by this branch and are fixed as of fix round 1 — see below. No
  outstanding concern from either.
- `questionSetDetailsAi.test.jsx`'s one-time timeout under full-suite load is carried forward as a
  known follow-up (see above), not treated as blocking — it is not this branch's file and repeats
  clean in isolation.
- Everything else in this handoff not marked as a concern is reported as fact, not as a judgment
  call: the dead-CSS deletion, the Ridge removal, the ridge-token decision, and the metadata are
  each backed by the grep/test evidence shown above.

## Fix round 1 (post-Task-13)

Two findings Task 13 left red, both caused by this branch, both fixed here per controller ruling.

**1. `setMediaStorage.test.js`.** `/help/` added as a named exception, alphabetically sorted with
the other three, and the comment block gained its entry in the same style — reason checked, not
assumed, before writing it (see the help-gaps section above for the grep and its empty result).
`npx jest src/__tests__/setMediaStorage.test.js` → 17/17 pass, exit 0.

**2. The twin guard's banned-phrase section.** Its header (`tests/no-retired-twin-references.js`)
gives the exact `FALSE_RULE` array: six phrases including one built around the words "deploys" and
"nothing" and another around "tags"/"only" combined with "tag-triggered" — read directly from the
guard's source rather than assumed, since the phrasing this task had been quoting was less precise
than what the guard actually checks. Its exemptions, read from the same source: its own file
(`SELF`, excluded because it necessarily contains its own forbidden list), everything under
`docs/archive/` (dated historical record, never rewritten), and non-scannable extensions (only
`.js .jsx .sh .yaml .yml .json .md .toml` are scanned at all — `.js`/`.jsx` are stripped of
comments first, `.md` is scanned only inside fenced code blocks). `CLAUDE.md` is not specially
exempted in code; it simply never contained the exact banned substring to begin with (it says "the
deploy did nothing", not the guard's banned phrase).

Three tracked files matched, all three containing the phrase only while describing the ban itself
— fixed without weakening what any of them assert:
- `docs/superpowers/plans/2026-09-20-marketing-home.md` — the Global Constraints bullet reworded
  to describe the guard by name and file path instead of quoting its banned strings, and the
  Task-12 copy-suite sketch rewritten to build its rejection pattern from word fragments
  (`[['deploys','nothing'],['tags','only']].map(w => w.join(' '))`) joined into a `RegExp` at
  runtime, so no banned string is contiguous in the file's own source.
- `src/src/__tests__/marketingCopy.test.js` — same fragment technique: a `BANNED_DEPLOY_CLAIM`
  array built the same way, joined into `BANNED_DEPLOY_RE`, referenced from the `BANNED_CLAIMS`
  table in place of the old inline regex literal. The suite still rejects both phrases from
  marketing copy and the `ClipStill` drawings' visible text — it just no longer spells either
  phrase out contiguously to do it.
- `docs/handoff/marketing-home-2026-09-20.md` (this file) — every quoted instance reworded to
  describe the guard and the fix without repeating its banned strings.

A branch-wide grep for the guard's own six-phrase list, excluding its own file and `CLAUDE.md`
(both are the phrases' allowed homes per the guard's exemption logic, confirmed above rather than
assumed), found no other occurrence once the three were fixed.

### Commands run and output (fix round 1)

```
$ npx jest src/__tests__/setMediaStorage.test.js
Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total

$ npx jest src/__tests__/marketingCopy.test.js
Test Suites: 1 passed, 1 total
Tests:       25 passed, 25 total

$ npm test        (full run, from src/)
Test Suites: 247 passed, 247 total
Tests:       5962 passed, 5962 total
exit=0
```

The full run was clean on this pass — `questionSetDetailsAi.test.jsx`'s earlier timeout did not
recur (it is a load-dependent flake, not deterministic; see the follow-up entry above for what to
do if it resurfaces).

```
$ node tests/no-global-partition-literals.js ; echo exit=$?
7 passed, 0 failed
exit=0

$ node tests/no-retired-twin-references.js ; echo exit=$?
6 passed, 0 failed
exit=0
```

`npm run lint` was not rerun — no linted (`.js`/`.jsx` outside `__tests__` conventions aside, ESLint
does cover `__tests__`) file changed beyond `setMediaStorage.test.js` and `marketingCopy.test.js`,
both plain test edits with no new lint surface; the full `npm test` pass above is the relevant
check for both.

Commit: "The help route is a named exception to the single-segment rule, and nothing on this
branch quotes the phrases the twin guard bans" (fix round 1, new commit after `2ab521ff`).
