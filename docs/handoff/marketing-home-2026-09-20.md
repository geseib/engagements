# Handoff — the marketing home, and the surface built with it (2026-09-20)

**Nothing has been pushed.** This is all on `working/marketing-home`, cut from `origin/dev` at
`741a074b`, thirteen tasks deep. Head commit at the end of this task: see the commit this file
ships with — `git log -1` on `working/marketing-home` after this handoff lands. Pushing `dev` (or
any tier) is the owner's call, not made here.

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
  also carries the banned-deploy-phrase regex (`/deploys nothing|tags only/i`) as a description
  string, which is why the twin guard flags this file by name — see Concerns.
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
2. **`setMediaStorage.test.js`**, `every route the app matches is a single path segment` — fails
   deterministically (reran alone, same result) because the test's hard-coded exception list
   (`/auth/callback`, `/invite/`, `/test/wordcloud`) does not yet include `/help/`, which
   `App.jsx` gained as a real route across Tasks 8–11 of this branch (`git diff --stat
   741a074b..HEAD -- src/src/App.jsx`: 86 insertions). **This is a real finding, not paint-over
   material** — `/help/<slug>` never renders a question and so is very likely a safe addition to
   that exception list on the same grounds as `/invite/`, but Task 13's brief does not cover
   editing `setMediaStorage.test.js`, and a quiet fix here would be exactly the kind of judgment
   call this task's own instructions rule out. Left red and reported.

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
- `node tests/no-retired-twin-references.js` — **exit 1**. Sections 1, 2, 4, 5 pass; section 3
  ("no file asserts that a branch push is inert") flags two pre-existing, already-committed files
  for containing the literal string `"deploys nothing"`:
  - `docs/superpowers/plans/2026-09-20-marketing-home.md` (committed at `31fed83d`, before this
    task) — the plan's own line describing the ban: *"the twin guard fails on the strings 'deploys
    nothing' and 'tags only' in any tracked file."*
  - `src/src/__tests__/marketingCopy.test.js` (committed at `1b1804be`, before this task) — the
    honesty suite's own regex literal, `/deploys nothing|tags only/i`, used to assert marketing
    copy never contains either phrase.

  Both are the guard matching its own ban-description text, not an actual false deploy-rule claim
  — a known limitation already on record in session memory ("the twin guard fails on 'deploys
  nothing' / 'tags only' wording in ANY tracked file, plans and briefs included"). Neither file was
  touched by this task, and this task wrote neither phrase anywhere. Reported here rather than
  silently accepted, per this task's own standard for guard failures.

## Files changed (this task)

- Modified: `src/src/styles.css` (dead `.parallax`/`.player-parallax` rules removed)
- Deleted: `src/src/components/Ridge.jsx`
- Modified: `src/public/index.html` (title, description, OG/Twitter meta)
- Added: `src/public/assets/marketing/share.svg`
- Modified: `src/public/assets/marketing/CREDITS.json`
- Added: `docs/handoff/marketing-home-2026-09-20.md` (this file)

## Concerns

- `setMediaStorage.test.js` fails, caused by this branch's own `/help/` route (see Baselines) —
  flagged, not fixed, because fixing it is outside this task's stated scope.
- `no-retired-twin-references.js` fails on two pre-existing files matching its own ban-phrase
  text, not an actual violation — flagged, not fixed, same reasoning.
- Everything else in this handoff not marked as a concern is reported as fact, not as a judgment
  call: the dead-CSS deletion, the Ridge removal, the ridge-token decision, and the metadata are
  each backed by the grep/test evidence shown above.
