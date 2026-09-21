# Marketing home and related pages — design

Date: 2026-09-20
Status: design approved in conversation, awaiting spec review
Scope: sub-project 1 of 3. Sub-projects 2 (screen clips) and 3 (help content
refresh) get their own specs; this one defines the slots they fill.

## 1. Purpose

The bare domain says nothing about the product. A signed-out visitor to `/`
gets `RootPage`: a 4-digit code entry and a sign-in aside, with no copy, no
imagery and no explanation. This spec replaces that with a marketing home page
that sells the product by its style and explains it truthfully, plus four
related public pages.

Primary audience: **team leaders and facilitators** running strategy sessions,
offsites, retros and workshops. The message: bring your own material, reach
better decisions in a gamified way, and leave with a report that captured
everything.

## 2. Decisions already made

| Question | Decision |
|---|---|
| Where does joining go when `/` becomes marketing? | A compact code entry stays in the hero. `RootPage` remains reachable at `/join`. |
| Audience | Team leaders and facilitators. |
| Hero art | Inline-SVG ridge parallax extended from the unmounted `Ridge.jsx`. No raster art, no third-party assets. |
| Screen videos | Scripted Playwright capture of the real app (sub-project 2). This spec ships poster stills in the slots. |
| Pages | `/` home, `/how-it-works`, `/use-cases`, `/reports`, `/help` (+ deep links). |
| Architecture | A marketing surface inside the existing React app, lazy-loaded. |

Rejected: static pre-rendered HTML in `src/public/` (duplicates tokens and the
join logic, sits outside the suites, needs CloudFront routing work); a separate
marketing site (second pipeline and domain, drifts from the design system).

## 3. Constraints inherited from the repo

- **The old parallax is banned.** `stageShell.test.jsx`, `adminShell.test.jsx`
  and `playerSurface.test.jsx` fail if a `.parallax` class returns. The new
  scene uses `.mk-ridge*` names only. It was removed because it hot-linked
  unlicensed third-party images; nothing here loads art from another origin.
- **Routing is a hand-rolled pathname switch** in `src/src/App.jsx`
  (`AppRouter`, line 172). The final fallthrough renders the protected
  `GameHostPage`, so every new public path needs an explicit branch placed
  before it.
- **Warm Summit design system** (`.claude/skills/engage-design`): dusk theme,
  one scoped type ladder per entry-class surface, namespaced classes (never a
  bare `.btn`/`.chip`/`.modal`), measured contrast composited up the ancestor
  chain, `--primary` never carries text on a light surface, `--danger` never
  carries text, no geometric assertions in tests.
- **Mockups are the design.** UI is built from rendered mockups in
  `docs/design`, served on :8124, not from prose.
- **Honesty.** Copy claims only what the product does. The report has no
  "favourites" field: "the team picked its favourites" is true only as a
  description of the vote and its per-answer breakdown, and is worded that way.
- **Media.** Anything in `src/public/` is copied verbatim to `dist/` and never
  enters the JS bundle. Each asset directory carries a `CREDITS.json`.

## 4. Architecture

### 4.1 Files

```
src/src/marketing/
  MarketingShell.jsx / .css     nav, footer, scoped --mk-* tokens and ladder
  HomePage.jsx / .css
  HowItWorksPage.jsx / .css
  UseCasesPage.jsx / .css
  ReportsPage.jsx / .css
  HelpPage.jsx / .css
  components/
    RidgeScene.jsx / .css       layered SVG scene, route line, climber marker
    ClipFrame.jsx / .css        video-with-poster slot
    DeviceFrame.jsx / .css      TV and phone bezels around a ClipFrame
    SampleReport.jsx / .css     static paper-theme report excerpt
  content/
    home.js, howItWorks.js, useCases.js, reports.js   copy as data
    sampleReport.js             fixture for SampleReport
  useScrollProgress.js          IntersectionObserver + rAF, reduced-motion aware
src/src/components/JoinCodeEntry.jsx / .css   extracted from RootPage
src/public/assets/marketing/    posters now, clips later, CREDITS.json
docs/design/marketing-redesign/ mockups 01-home … 05-help, RATIONALE.md
```

Copy lives in `content/*.js` so it can be edited and tested without touching
layout, matching how `config/help/` separates the help corpus from
`HelpSystem.jsx`.

### 4.2 Routing

New public branches in `AppRouter`, before the `/admin` branch:

| Path | Renders |
|---|---|
| `/how-it-works` | `HowItWorksPage` |
| `/use-cases` | `UseCasesPage` |
| `/reports` | `ReportsPage` |
| `/help`, `/help/<role>`, `/help/<role>/<guide>` | `HelpPage` |
| `/join` | `RootPage` (unchanged component) |

`RootGate` keeps its three branches; only the signed-out branch changes, from
`RootPage` to `HomePage`. A signed-in visitor to `/` still gets `GameHostPage`.

All marketing pages load through `React.lazy` behind one `Suspense` boundary
using the existing loading spinner, so hosts and players on `/play`, `/admin`
and the stage never download marketing code.

Navigation uses the existing `navigateTo` helper; sign-in and register links
call `rememberReturnPath()` first, exactly as `RootPage` does today.

### 4.3 JoinCodeEntry extraction

`RootPage.jsx` owns the 4-cell input, join-URL paste parsing (line 29), the
pre-flight `GET {API_BASE}games/{code}` (line 110) and the "Nothing is running
under {code}" notice. These move into `components/JoinCodeEntry.jsx` with two
presentations: `variant="page"` (RootPage, unchanged appearance) and
`variant="compact"` (hero). The logic exists once. `rootPage.test.jsx` keeps
passing against `/join`; the behaviour assertions that belong to the entry
itself move to a new `joinCodeEntry.test.jsx`.

### 4.4 RidgeScene

Extends the idea in `Ridge.jsx` (three ridge paths and a radial amber glow)
into a full-page backdrop:

- Four inline-SVG layers: sky with glow, back ridge, mid ridge, front ridge.
  Parallax depths 0 / 0.15 / 0.35 / 0.60, taken from
  `docs/design/parallax-art-brief.md` so a later raster set could drop in.
- A thin dashed **route line** up the mid ridge and a small **climber marker**
  whose position along the path is the page's scroll progress. Section anchors
  are waypoints: base camp (hero), questions, ideas, the vote, summit (report).
- Motion is `transform` only, driven by `useScrollProgress`. Under
  `prefers-reduced-motion: reduce` the layers are static and the marker sits at
  the summit.
- The brief's contrast constraint holds: amber stays in the bottom 40% of the
  hero, and `#F4EDE4` text clears 4.5:1 over the top 55%.
- `Ridge.jsx` itself is imported by nothing. It is deleted once `RidgeScene`
  covers its variants, rather than left as a second unmounted motif.

### 4.5 ClipFrame

`<video muted loop playsinline preload="none" poster=…>` with WebM and MP4
sources. It renders the poster alone when the clip file is absent from the
manifest, when `prefers-reduced-motion` is set, or when the video errors.
Playback starts only while the frame is in view. A manifest
(`content/clips.js`) lists each slot's poster, sources, caption and alt text;
sub-project 2 fills in sources without touching page code.

Slots defined by this spec:

| Slot id | Shows | Frame |
|---|---|---|
| `trivia-host` | question → answers lock → correct answer and standings | TV |
| `trivia-player` | phone answering | phone |
| `poll-host` | prompt → answers arriving → vote → results revealed | TV |
| `poll-player` | phone submitting an idea, then voting | phone |
| `join-qr` | lobby QR and players appearing | TV |
| `builder` | AI builder drafting a set from supplied material | laptop |
| `report` | report opening, scroll, PDF export | laptop |

## 5. Pages

### 5.1 Home — "the climb"

1. **Hero.** Ridge scene. Headline in the direction of *"Turn your team's own
   material into decisions everyone climbed toward."* Sub-line naming the two
   modes. CTAs: **Create a host account** (amber), **Sign in** (quiet), and the
   compact **Have a code?** entry.
2. **The problem.** Three short statements: a few voices dominate, ideas are
   lost, nobody remembers what was decided.
3. **Two ways to play.** Trivia (warm up, check knowledge) and call and answer
   (pose a prompt, collect every idea, vote). Each with a TV clip and a phone
   clip.
4. **Your own material.** Supply documents and topics; the AI builders draft
   question sets; you review, preview and edit before anything runs. Private
   organisation libraries are encrypted; a moderated public library gives a
   starting point.
5. **The room reacts.** Answers arrive live, the team votes, the strongest
   ideas rise — shown with the vote breakdown.
6. **Summit: the report.** A paper-theme `SampleReport` sheet slides up over
   the dusk page: every answer, vote and comment, the AI summary with
   discussion questions and next steps, final standings, PDF export, shareable
   link.
7. **Closing CTA** and footer (Privacy, Terms, Help).

### 5.2 /how-it-works

Six steps, each with its clip slot: Create a session from a set → Join by QR or
code → Ask → Vote → Results → Report. Notes the display profiles (room, TV,
call, table) and the phone remote as facilitator conveniences.

### 5.3 /use-cases

Four scenarios, each a short before/after with the set type used: strategy
offsite, retrospective, decision workshop, team trivia warm-up. Each ends with
the same two CTAs.

### 5.4 /reports

An annotated `SampleReport` with callouts for each captured element, then
export and sharing (PDF, print, saved link with temporary or permanent
retention), then anonymity: names can be hidden per session.
`SampleReport` renders fixture data under `data-theme="light"`; it does not
import `GameReport`, which is bound to live session data and the print sheet.

### 5.5 /help

The existing `HELP_ROLES` corpus rendered as a page through `DocRenderer`, with
a role/guide sidebar and URLs `/help/<role>/<guide>` resolved by the existing
`resolveHelpTarget`. Unknown ids fall back to the role index. The modal
`HelpSystem` and every `HelpButton` entry point are unchanged. Content gaps
(organisations, public library, moderation, preview, score card, archive,
billing, invites) and screenshots are sub-project 3.

## 6. Styling

- Tokens scoped on `.mk-root`: `--mk-*` colours aliasing the global dusk
  tokens, and one ladder `--mk-t-1 … --mk-t-7` with a larger display step for
  headlines. Nothing under 12px.
- Every class is `.mk-*`. `JoinCodeEntry` uses `.jce-*`.
- The report section is the only paper surface and sets
  `data-theme="light"` on its own subtree, with markup and theme converted
  together.
- Breakpoints: single column under 720px, with phone clips stacked under TV
  clips; the nav collapses to brand + Sign in + a menu button.
- The dead `.parallax` rules in `src/src/styles.css` (1795–1900, 407–418, 2697,
  7746–7747) are deleted in this work; no JSX references them.

## 7. Page metadata

`src/public/index.html` gains a real `<title>`, description and Open Graph /
Twitter tags with one static share image in `assets/marketing/`. Each marketing
page sets `document.title` on mount. No pre-rendering in this spec.

## 8. Error handling

- Join pre-flight failure or 404: the existing notice, inline in the hero.
- Missing or failing clip: poster still, no broken control.
- Lazy chunk load failure: an error boundary in `MarketingShell` showing a
  plain retry message with working Sign in and Join links.
- Unknown `/help/...` target: role index, not a blank page.

## 9. Testing

New frontend suites, following `references/testing-a-surface.md`:

- `marketingPalette.test.js` — contract checks 2.1–2.8 across every marketing
  stylesheet, including the paper subtree.
- `marketingRoutes.test.jsx` — each new path renders its page signed out
  without hitting `ProtectedRoute`; `/join` renders `RootPage`.
- `rootGate.test.jsx` updated — signed out → `HomePage`; signed in →
  `GameHostPage`; loading → spinner.
- `homePage.test.jsx` — sections present, CTAs reach `/auth` and
  `/auth?mode=register` with the return path remembered, hero join navigates
  on a valid code and shows the notice on 404.
- `joinCodeEntry.test.jsx` — parsing, pre-flight, both variants.
- `ridgeScene.test.jsx` — no `.parallax` class, no external image URL, static
  under reduced motion.
- `clipFrame.test.jsx` — poster-only when sources are absent or motion is
  reduced.
- `helpPage.test.jsx` — deep links resolve, aliases work, unknown ids fall
  back; `helpEntryPoints.test.jsx` still passes untouched.
- `marketingCopy.test.js` — honesty pins: no "favourite" claim outside the
  vote wording, no mention of a capability absent from a small allow-list.

Repo-wide enforcers (`scopedClassesDeclared`, `undeclaredSetters`,
`designSystem`) must pass unchanged. Baselines for the backend suite, frontend
suite, lint and `npm run build` hold before anything reaches a tier branch.

## 10. Delivery order

1. Mockups in `docs/design/marketing-redesign/` (01-home, 02-how-it-works,
   03-use-cases, 04-reports, 05-help, plus a mobile home), reviewed on :8124.
   **Owner review gate before any React.**
2. `JoinCodeEntry` extraction and `/join`, with tests — no visible change.
3. `MarketingShell`, tokens, `RidgeScene`, `ClipFrame`, `DeviceFrame`.
4. `HomePage`, then the `RootGate` switch.
5. `/how-it-works`, `/use-cases`, `/reports` with `SampleReport`.
6. `/help` route.
7. Metadata, dead-CSS removal, `Ridge.jsx` removal.
8. Dev, then test once it is worth looking at.

## 11. Out of scope

- Recording the clips and the Playwright capture script (sub-project 2).
- Help content rewrite and screenshots (sub-project 3).
- Pricing page, blog, analytics, pre-rendering/SEO beyond meta tags.
- Commissioned raster hero art.
- Any backend or template change.
