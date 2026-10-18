# Build Room starters: research and recommendation

Owner, 2026-10-18: *"research on some starter templates for build rooms? we could store them in
github public folder, and those could be used to really move things forward. … some basic ones
could be creating a training site, or a interactive website, an infographic site, or a dashboard
site. … also how could participants provide content that could be useful. for example point to
a website or a repo that has a csv file used for data etc."*

Status: research only. Nothing here is built.

## Recommendation (read this first)

1. **One stack for all four: no-build static pages.** Plain HTML, one shared CSS file, small ES
   modules, and the few libraries we need copied into the starter (`demo/vendor/`), not loaded
   from a CDN and not installed with npm. Chart.js (MIT) for charts, Papa Parse (MIT) for CSV.
   It runs with `npx serve demo` or `python3 -m http.server -d demo`, which is what the plugin
   already tells Claude to do, and the `demo/` folder *is* the built copy that Share on Wi-Fi and
   Share remotely want.
2. **Store them in this repo at `src/public/starters/`** (the repo is public on GitHub, so this is
   the "github public folder"). Each tier's site serves its own copy, like `engage-mcp.mjs`. The
   plugin lays one down with a new `use_starter` tool, checking every file against a hash pinned
   in the plugin, the same way it pins cloudflared.
3. **The host picks the starter in the opening**, on the "What are we making?" step, with a
   `/engage:starter <name>` command as the fallback. Claude lays it down during the opening (it is
   setup, not product code), so the room sees a running "hello" page before building starts.
4. **Participants contribute through "Add a source"** on the phone: a link plus one line on what
   it is. It lands in the host's ideas inbox. Only when the host says "Use this" does the plugin
   download it, with size and type limits, into a git-ignored inbox. Claude reports what it found
   as a research finding, and copies it into `demo/data/` only after the host agrees. Every source
   is recorded in `SOURCES.md`.

**Build order** (updated 2026-10-18 after the wider search in "More starters from the wild";
the first step is unchanged): (1) the delivery mechanism plus the **dashboard** starter, because
the CSV story is the one the owner named and it proves the `data/` convention; (2) **decision
matrix** and (3) **branching scenario**: both are small, need no library, and show the room
shaping the result live, so they are the best demos for the least work. The branching
scenario also becomes the "What would you do?" part of the training site; (4) **infographic**,
which reuses the charts and data loader; (5) **training site**; (6) **clickable prototype**, which
replaces the plain "interactive website" because it is the same page with a stronger purpose;
(7) the phone **Add a source** flow. The rest of the catalogue follows in the order of the
ranking below. The dashboard is useful before step 7: the host can drop a CSV into
`demo/data/` by hand.

## How a Build Room starts today (what the starters plug into)

- The Connect panel starts Claude Code in `~/build-room/<name>`. On `connect`, `startProject`
  (`src/public/engage-mcp.mjs`) turns an empty folder into a git repo on `main` with README.md,
  DECISIONS.md, .gitignore and the commit "Start: <title>". A folder that already has code keeps
  its history, and the room's work goes on `build-room/<name>`.
- `/engage:kickoff` reads `room_status`. In **PHASE: OPENING** Claude sets up the project, writes
  no product code, may propose one probing question, drafts the brief, and waits until the host
  presses Start building.
- The opening has nine steps (`OPENING_STEPS` in `lambda-functions/game/build-store.js`). Step 1
  "What are we making?" picks from six editable `OPENING_KINDS`; step 8 "Tools and style" is
  answered by the host by default. The brief reaches Claude as text and as `.engage/brief.md`.
- The plugin's instructions and skill say: the result is always a web page; serve the demo from
  its own folder (`http://localhost:<port>/demo/index.html`), never the project root; write
  `.engage/share.json`; work at phone, tablet and laptop widths; when sharing remotely, serve a
  built copy.
- The plugin already downloads one thing safely: cloudflared, from a pinned version, checked
  against a pinned sha256 per platform, and stamped so it is not checked twice (`CLOUDFLARED`,
  `ensureCloudflared`).

So a starter is just the first commit's content: a `demo/` folder that already follows every
rule above, plus notes that tell Claude how it is put together.

## Why no-build static, and not the alternatives

| Option | For | Against, for a live room |
|---|---|---|
| **Plain HTML + vendored libs** (chosen) | No install, works offline, nothing to break on a corporate network, the folder is already the built copy, Claude edits it in seconds | No components or bundling; a bigger app outgrows it |
| Vite (vanilla or React) | Familiar, fast dev server, MIT | `npm install` from the registry, and Vite needs Node 20.19+ or 22.12+ ([create-vite](https://github.com/vitejs/vite/tree/main/packages/create-vite)) while the plugin asks only for Node 18. A build step before every remote share |
| Observable Framework | Made for dashboards and data reports, data loaders, ISC licence ([repo](https://github.com/observablehq/framework)) | npm install and a build; its own Markdown dialect to learn |
| Evidence.dev | SQL + Markdown reports, CSV and Google Sheets sources, MIT ([repo](https://github.com/evidence-dev/evidence)) | Needs SQL comfort; heavy install; the project is steering people to its new hosted Studio |
| reveal.js / Slidev for training | reveal.js is MIT and has a no-build "basic setup" ([repo](https://github.com/hakimel/reveal.js), [install](https://revealjs.com/installation/)) | A slide deck is not a training site; keep it as an option Claude can add |
| Pico CSS for the look | Classless, MIT | **Archived**, last release v2.1.1 ([repo](https://github.com/picocss/pico)); write our own small CSS instead |

The rule for the starters: **nothing in a starter may need the network to run.** Claude may still
add Vite, React, Observable Framework or anything else once the room asks for it; the starter's
CLAUDE.md says how ("move `demo/` into `src/`, add Vite, keep building to `demo/`").

Libraries to vendor (each with its LICENSE file beside it in `demo/vendor/`):

- **Chart.js 4**, MIT ([repo](https://github.com/chartjs/Chart.js)): bar, line, pie, doughnut,
  scatter. Small API Claude knows well. Canvas, so every chart also gets a text summary or table.
- **Papa Parse 5**, MIT, no dependencies, parses local or remote CSV in the browser
  ([repo](https://github.com/mholt/PapaParse)).
- Not by default: **Apache ECharts** (Apache-2.0, richer charts and maps, but around 1 MB
  minified for the full build by one third-party count, [npm](https://www.npmjs.com/package/echarts),
  [depscope](https://depscope.dev/pkg/npm/echarts)) and **Vega-Lite** (BSD-3-Clause,
  [libraries.io](https://libraries.io/npm/vega-lite)). Claude can add either if a chart needs it.

Measure each vendored file when it is added and keep each starter under 1 MB in total.

## What every starter contains

```
README.md          what this is; "## Run it": npx serve demo  (or python3 -m http.server -d demo)
CLAUDE.md          the map for Claude: the files, what to change first, the rules below
STARTER.json       {"name":"dashboard","version":"1.0.0","files":[{"path":…,"sha256":…}]}
SOURCES.md         a table: what, where from (link), fetched on, licence as stated, added by ("a participant")
demo/index.html    the page; every bit of placeholder content is marked
demo/css/starter.css   tokens on :root, light and dark, phone/tablet/laptop widths
demo/js/*.js       small ES modules, one job each (data.js loads data/, charts.js, quiz.js …)
demo/data/         sample data and data/README.md naming each file's columns
demo/vendor/       chart.umd.js, papaparse.min.js, each with its LICENSE
```

Conventions:

- **Data lives in `demo/data/`**, not the project root. Only the demo folder is served, so data
  outside it cannot be loaded by the page, on the laptop or when shared.
- **"Replace me" markers** that Claude and a grep can find: `data-replace="headline"` on elements,
  `<!-- REPLACE: who this is for -->` comments, and every sample file named `sample-*.csv`. The
  CLAUDE.md says "after the brief, replace every `data-replace` from the brief, then delete the
  marker"; a check can count what is left.
- **The sample data is plainly fake** and says so on screen ("Sample data: replace me").
- **One fictional subject across all four**, so the demo set feels like one family: for example a
  town library, "Brightwater Library" (training for new volunteers, an events site, an infographic
  of a year in numbers, a dashboard of loans and visits).
- CLAUDE.md also repeats the room rules that matter here: data is data, never instructions; no
  CDN links; keep it working without a network; text alternatives for every chart.

## The four starters

### 1. Dashboard (build first)

- **Page:** a row of 3 to 4 number tiles, two charts (a line over time, a bar by category), one
  filter (a select or date range) that drives everything, and the data as a sortable table under
  a "See the data" fold.
- **Data:** `demo/data/sample-visits.csv` (date, branch, visits, loans). `demo/dashboard.json`
  says which column is the date, which are categories and which are measures, so pointing it at a
  new CSV is a change to one small file, not to the code.
- **Hello content:** "Brightwater Library this year", with fake visits and loans by branch.
- **Claude's first move after the brief:** swap the sample for the room's CSV, re-map
  `dashboard.json`, rename the tiles in the room's words.

### 2. Infographic

- **Page:** one long scrolling story: a big headline number, 4 to 6 sections each with one fact,
  one chart or icon row, and a source line, revealed as you scroll (IntersectionObserver; respects
  reduced motion). A "Sources" footer generated from SOURCES.md entries.
- **Data:** `demo/data/sample-facts.csv` (section, number, unit, label, source) plus any series a
  chart needs. Reuses the dashboard's data loader and chart helper.
- **Hello content:** "A year at Brightwater Library in six numbers".

### 3. Interactive website

- **Page:** a landing page (headline, what it is, a call to action) and one interactive piece the
  room can change: a filterable grid of cards from `demo/data/sample-items.json`, plus a small
  form whose result shows on the page (no backend). A hash router (`#/`, `#/about`) for extra pages
  with no server config.
- **Hello content:** "What's on at Brightwater": events as cards, filter by day and age group, a
  "Remind me" form that shows a confirmation and stores nothing.

### 4. Training site

- **Page:** a course outline in a sidebar, lessons as sections (text, an image slot, a "Try it"
  box), a 3-question check at the end of each lesson with instant feedback, and progress kept in
  the browser's localStorage (wrapped in try/catch; works without it). A print view for a handout.
- **Data:** lessons and questions in `demo/data/sample-course.json`, so the room's content can be
  added without touching the code.
- **Hello content:** "Welcome, new Brightwater volunteer": three short lessons and a quiz each.
- Optional: CLAUDE.md says how to add a reveal.js slide mode if the room wants slides.

## More starters from the wild

Owner, 2026-10-18: *"find other starters based on what they find on the internet. do some
digging see what is cool ideas out there."* I looked at explorable explanations, data-journalism
visual essays, civic budget tools, design-sprint and team-workshop artefacts, roadmap templates,
event-site template categories, game jams, creative-coding challenges and music toys. The test
for each one: a room plus Claude can make a working first version in about an hour, as a static
page with no build step, using only permissive vendored libraries or none.

Some sites (ncase.me, pudding.cool, explorabl.es, revealjs.com) did not resolve from this
container. Where they are cited, the link comes from search results or other pages about them,
not from opening the page itself.

**One pattern across nearly all of them:** the content is a small JSON or CSV file that the room
fills, and Engage's three asks fill it directly. **Ideas** become items, cards, options or
branches. **Choose** picks the path, the look or the winner. **Rate** sets weights, scores and
feelings. Each starter's CLAUDE.md should say which file each kind of ask feeds. Most also share
four small parts: load data, draw a chart, sliders bound to state, and a hash router. Build those
once as `demo/kit/` and reuse them in every starter.

### The candidates

Each entry gives: what it is · what the room gives · the hello sample (Brightwater Library) ·
library · effort for Claude in an hour · real examples.

**Explain**

1. **Explorable "what if" simulator.** Sliders change a small model and the picture changes at
   once, so the reader learns by playing. This is Bret Victor's "explorable explanation" idea,
   and Nicky Case's *Parable of the Polygons* and *The Evolution of Trust* are the best-known
   examples ([Wikipedia](https://en.wikipedia.org/wiki/Explorable_explanation),
   [Evolution of Trust](https://www.exploring-economics.org/en/discover/the-evolution-of-trust/),
   [Why Simulate?](https://blog.ncase.me/why-simulate/),
   [awesome-explorables](https://github.com/blob42/awesome-explorables)) · the room gives the
   question, the rules and which slider matters (Choose) · hello: "Why the queue at the desk
   grows": arrivals and staff sliders, people drawn as dots · canvas plus Chart.js · medium:
   the model is the hard part, so keep it to 2 or 3 rules · **wow**.
2. **Calculator / estimator.** "What would it cost us?" Assumptions as inputs, the answer and a
   chart update live. The NYT rent-or-buy calculator is the model people praise
   ([Inman](https://www.inman.com/2014/05/22/new-york-times-raises-the-bar-on-rent-vs-buy-calculators/),
   [Get Rich Slowly](https://www.getrichslowly.org/the-new-york-times-rent-vs-buy-calculator/))
   · the room gives the assumptions and argues the defaults (Rate) · hello: "What does one more
   opening hour cost?" · none plus Chart.js · low. Best as a mode of the simulator, not a
   starter of its own.
3. **Timeline.** Dated events with a picture and a line each, scrolling sideways or down.
   Knight Lab's TimelineJS is the classic. It is MPL-2.0 and reads a JSON file as well as a
   Google Sheet ([repo](https://github.com/NUKnightLab/TimelineJS3),
   [Davidson](https://digitallearning.davidson.edu/timelinejs-projects/)) · the room gives the
   events, dates and image links (Ideas) · hello: "Brightwater Library, 1925 to 2025" · our own
   CSS timeline over `data/events.json`, because TimelineJS is heavier and loads fonts and
   media from the network · low.
4. **Story map.** A map whose places light up as you scroll the story
   ([Leaflet storymap template](https://github.com/JackDougherty/leaflet-storymap-layers),
   [Mapbox storytelling](https://labs.mapbox.com/education/impact-tools/interactive-storytelling))
   · the room gives places, stories and photo links · hello: "Five branches, five stories" ·
   Leaflet (BSD-2-Clause, about 40 kB gzipped, [repo](https://github.com/Leaflet/Leaflet)).
   **Catch:** map tiles need the network, and the OpenStreetMap tile policy blocks prefetching
   and offline use ([policy](https://operations.osmfoundation.org/policies/tiles/)). So the
   offline version is an SVG outline from Natural Earth, which is public domain
   ([datahub](https://datahub.io/core/geo-countries)), with live tiles only when the network
   allows · medium.
5. **Scrollytelling essay.** Pinned sections whose chart changes as you scroll, like The
   Pudding's visual essays ([Storybench](https://www.storybench.org/?p=8613),
   [The Pudding](https://pudding.cool/about)) · Scrollama (MIT, by a Pudding co-founder,
   [repo](https://github.com/russellsamora/scrollama)) or our own IntersectionObserver code.
   This is the infographic starter's "story mode", not a separate starter.

**Decide**

6. **Decision matrix.** Options down the side, criteria across the top, a weight slider per
   criterion, live weighted totals and a winner. Add a "does the winner hold if a weight moves?"
   check ([Lilly Tech Systems example](https://aischool.lillytechsystems.com/tools/decision-matrix.html))
   · the room gives options and criteria (Ideas) and the weights (Rate, averaged) · hello:
   "Where should the new branch go?": 3 sites, 4 criteria · none · low · it turns a vote
   into an artefact the team keeps and can argue with later.
7. **Budget balancer.** Spend a fixed pot across categories with sliders; it must balance, and
   the trade-off shows as you move. Cities run these as "Balancing Act" budget simulators at
   public budget workshops ([Hartford](https://www.americancityandcounty.com/?p=25634),
   [Greensboro](https://greensboro-nc.gov/departments/budget-evaluation/budget-simulator),
   [Courtenay](https://www.courtenay.ca/node/2381)) · the room gives the categories and its
   priorities, and each phone's split can be averaged into "the room's budget" · hello: "Spend
   Brightwater's $100,000" · none plus a Chart.js doughnut · low to medium · **wow** at
   community meetings and offsites.
8. **Roadmap board (Now / Next / Later).** Cards in three columns, dragged to reorder. It is the
   common no-dates product roadmap ([Aha!](https://www.aha.io/roadmapping/guide/templates/create/now-next-later-roadmap),
   [Savio](https://www.savio.io/product-roadmap/now-next-later-roadmaps/)) · it maps exactly to
   Engage's own build / Later / ideas lanes, and the room's ideas become cards and votes order
   them · hello: "What Brightwater does next" · SortableJS (MIT, touch support, no framework,
   [repo](https://github.com/SortableJS/Sortable)) · low.
9. **Journey map / persona.** Steps of someone's experience across the top, with what they do,
   feel (a Rate score drawn as a line) and the pain points. This is the "Map" day of a design
   sprint ([sprint cheat sheet](https://www.dsebastien.net/2021-02-09-design-sprint-2-0-cheatsheet/))
   · the room gives steps (Ideas) and feelings (Rate) · hello: "A new member's first month" ·
   own HTML grid. Mermaid (MIT) has a journey diagram, but it is large for one picture
   ([repo](https://github.com/mermaid-js/mermaid)) · low.

**Play**

10. **Branching scenario ("What would you do?").** A choose-your-own-adventure: a situation,
    two or three choices, consequences, several endings. Twine is the classic tool, but it is
    GPL and its story formats carry their own licences
    ([linuxlinks](https://www.linuxlinks.com/twine/),
    [twinery forum](https://twinery.org/forum/discussion/comment/8340/)). inkjs runs ink stories
    in the browser and is MIT ([repo](https://github.com/y-lohse/inkjs)). Simplest is our own
    20-line engine over `data/story.json` · the room writes branches (Ideas) and **votes the
    path live** (Choose), with the projector showing the story unfolding · hello: "Your first
    shift at the desk" · none · low · **wow**, and the strongest core for training.
11. **Personality quiz ("Which … are you?").** Answers are votes for results; the most-voted
    result wins ([Dragonfly Cave vote quiz](https://www.dragonflycave.com/free-quiz-scripts/),
    [Tally template](https://tally.so/templates/personality-quiz-template/mYGlvw)) · the room
    invents the results and the questions · hello: "Which Brightwater shelf are you?" · none ·
    low · light, social, and good to open an event with. Not a trivia game: Engage already runs
    those.
12. **Arcade mini-game.** One mechanic, one screen, a score: catch, dodge, or sort. Game jams show
    how much fits in tiny games: js13kGames 2025 had 197 entries on the theme "Black Cat"
    ([winners](https://dev.to/js13kgames/js13kgames-2025-winners-announced-20nl)) · the room
    spins the wheel for theme, hero and rule, and rates difficulty after playing · hello:
    "Shelve the books before closing" · KAPLAY (MIT, the community successor to the archived
    Kaboom.js, [repo](https://github.com/kaplayjs/kaplay),
    [note](https://jslegenddev.substack.com/p/kaboomjs-is-now-kaplay)) or plain canvas · medium
    · **wow**: the room plays it on their phones over Wi-Fi share.
13. **Sound toy / step sequencer.** A grid of steps and sounds, in the style of Chrome Music Lab,
    which is open source and built on Tone.js
    ([Google](https://developers.googleblog.com/introducing-chrome-music-lab/),
    [Music Lab](https://experiments.withgoogle.com/music-lab)) · the room picks the scale,
    instruments and tempo · hello: "The library's quiet hour, as a beat" · Tone.js (MIT,
    [repo](https://github.com/Tonejs/Tone.js)) · medium · fun, but niche and loud in a room.
14. **Generative poster.** Shapes, colour and the room's words drawn by code; press a key for a
    new variant, then print one. This is the Genuary creative-coding tradition
    ([Genuary 2025 notes](https://perthirtysix.com/genuary2025),
    [bit-101](https://bit-101.com/blog/posts/2023-12-29/community-creative-coding/)) · the room
    gives the palette (Choose), words (Ideas) and picks the keeper · hello: "Brightwater's 100th
    birthday poster" · plain canvas. p5.js is the usual tool, but it is LGPL-2.1
    ([repo](https://github.com/processing/p5.js)), so it fails the permissive rule · low to
    medium · **wow** as a closing artefact.

**Make a page for an event or a team**

15. **Clickable prototype.** 3 to 5 phone-sized screens linked by taps: the design sprint's
    "realistic but minimal" prototype that is ready to test in minutes
    ([sprint cheat sheet](https://www.dsebastien.net/2021-02-09-design-sprint-2-0-cheatsheet/))
    · the room picks each screen's direction with A/B mockups (already `/engage:ab-mockups`) ·
    hello: "Book a study room": four screens · none (hash router, phone frame) · low · the
    natural evolution of "interactive website".
16. **Event microsite.** Agenda, speakers, a venue page, FAQ and a QR code to the page.
    Conference is a template category of its own on Framer's marketplace
    ([Framer categories](https://marketplace.framer.com/marketplace/templates/category)) · the
    room gives agenda items and the questions people will ask · hello: "Brightwater Book Fair" ·
    qrcode-generator (MIT, [npm](https://npmjs.com/package/qrcode-generator)) · low ·
    immediately useful after the session.
17. **Team page / "Manual of Me".** One card per person: how to work with me, what I am good at,
    what to avoid ([Miro: The Manual of Me](https://miro.com/miroverse/the-manual-of-me-template),
    [Tanzu Labs](https://labspractices.com/practices/personal-user-manual/)) · each person
    answers the prompts · low effort, but it **cuts across Engage's rule never to name people in
    the room**: it needs explicit opt-in, the person's own words, and no remote sharing by
    default. Park it until that is designed.
18. **FAQ finder.** Searchable questions, plus a "find your answer" path of yes/no steps, with no
    AI and no backend · the room gives the questions people really ask · it is the branching
    engine (10) and the training site's content model, so it belongs inside those.

### Ranking: the ten to add to the catalogue

| # | Starter | Group | Why it makes the list | Wow? |
|---|---|---|---|---|
| 1 | Decision matrix | Decide | Smallest build; turns the room's votes into a lasting artefact | |
| 2 | Branching scenario | Play / Explain | Room votes the path live; also the core of training | **yes** |
| 3 | Clickable prototype | Make a page | Uses `/engage:ab-mockups` as is; design-sprint staple | |
| 4 | Budget balancer | Decide | Community meetings and offsites; real civic precedent | **yes** |
| 5 | Explorable simulator | Explain | The most impressive "aha" page in an hour | **yes** |
| 6 | Arcade mini-game | Play | Everyone plays it on their phone at the end | **yes** |
| 7 | Event microsite | Make a page | Useful the next day; low risk | |
| 8 | Timeline | Explain | Easy for a room to fill with Ideas; history and retros | |
| 9 | Roadmap board | Decide | Maps onto Engage's Later list; teams leave with a plan | |
| 10 | Generative poster | Play | Cheap, beautiful closing artefact to print | **yes** |

Together with the first four (dashboard, infographic, training, interactive website), the
catalogue groups as: **Show data** (dashboard, infographic with story mode), **Explain**
(training, simulator, timeline), **Decide** (decision matrix, budget, roadmap), **Play**
(branching scenario, arcade game, poster) and **Make a page** (clickable prototype, which takes
over from interactive website, plus the event microsite). Fourteen tiles is too many for the
opening's six-slot wheel, so the Making step picks a group and the starter is a second, smaller
choice.

**Later, or folded into others:** the calculator (a simulator mode), scrollytelling (infographic
story mode), the FAQ finder (training and branching), the story map (waits on an offline map
answer), the journey map (a good design-sprint add-on), the sound toy (niche), and the team page
(waits on a privacy design).

**For a demo to a new audience,** run the branching scenario with the room voting the path,
then the budget balancer, then end on the arcade game played on phones. That shows Ideas,
Choose and Rate each driving a page Claude builds on the spot.

**Licence rule check:** all chosen libraries are MIT or BSD (Chart.js, Papa Parse, SortableJS,
KAPLAY, Tone.js, qrcode-generator, Leaflet, Scrollama, inkjs), or the starter needs none.
Excluded: p5.js (LGPL-2.1) and Twine's runtime formats (GPL tool, mixed format licences).
TimelineJS (MPL-2.0) and Mermaid (MIT) are allowed but not needed.

## Where the choice plugs in

1. **The opening's Making step (recommended).** After step 1 picks a kind, the host's screen shows
   "Start from: none / dashboard / infographic / interactive / training", pre-selected from the kind
   ("A website or page" → interactive; the host can change it). Saved on BUILD#STATE as
   `Starter: {name, version}`, beside the brief. `room_status` then says
   `STARTER: dashboard 1.0.0 — lay it down with use_starter`. It also fills the brief's Tools and
   style line ("Plain HTML, Chart.js, no build step"), which the host can still edit.
2. **Fallback: `/engage:starter <name>`**, a new prompt, for a host without the UI or an older room.
3. Later, if wanted: a default starter on the New Build Room form, for hosts who always run the
   same kind of session.

`use_starter` only lays a starter into a **fresh** project (the "Start:" commit and nothing else).
In a folder that already has code it refuses and says why. It commits "Start from the dashboard
starter 1.0.0" so the room's first decision is a clean diff against it.

## Storage and delivery

- **Source:** `src/public/starters/<name>/` in this repo, plus `src/public/starters/index.json`
  (name, version, title, one line, which opening kinds it suits). The site's normal deploy
  publishes them to `https://engage.<tier>.seibtribe.us/starters/…`, so test serves test's
  starters and prod serves prod's, exactly like `engage-mcp.mjs`.
- **Pinning:** the plugin carries a `STARTERS` table like `CLOUDFLARED`: for each name, the
  version and the sha256 of its `STARTER.json`. The plugin fetches `STARTER.json`, checks it
  against the pin, then fetches each listed file and checks each file's sha256 against the
  manifest. Any mismatch: nothing is written and the host is told in one line. Files are written
  with the plugin's existing `safeWrite` (no paths outside the project, no symlinks).
- **Versioning:** changing a starter means a new version in its STARTER.json, a new pin in the
  plugin, and a plugin `VERSION` bump (already enforced by `tests/engage-plugin-version.js`). A
  room records which version it started from, and the starter's README says it too.
- **The plugin needs the site address.** It knows its tier's API (`ENGAGE_APIS`) but not the
  site; add `ENGAGE_SITES` beside it, same tiers.
- **For people outside a Build Room:** because the folder is public on GitHub, anyone can copy one
  with `npx giget gh:geseib/engagements/src/public/starters/dashboard my-dashboard`
  ([giget](https://socket.dev/npm/package/giget/overview/3.1.0)). No separate repo is needed now;
  split them out only if they start changing on a different rhythm from the app.
- **Why not `npm create` or degit inside the session:** both need the npm registry or GitHub's
  API from the host's laptop, mid-session, and neither checks content against a pin.
- **Tests:** a `tests/starters.js` that, for each starter, recomputes every hash, fails on any
  `http(s)://` script or stylesheet in `demo/` (no CDN), requires a LICENSE beside each vendored
  file, requires the README's "## Run it" section, and caps the size.

## Participants contributing content

### What they can give

| They have | What happens |
|---|---|
| A web page (an article, a policy, a product page) | Claude reads it for facts with Claude Code's WebFetch, which returns a model's answer about the page, not the file, so it suits text and not data |
| A CSV or JSON file at a public link | The plugin downloads the file itself into the inbox |
| A GitHub repo or a file in one | A `github.com/…/blob/…` link becomes the `raw.githubusercontent.com` link. A whole repo: the plugin lists its files through the API and the host picks which to fetch; it is never cloned and nothing in it is run |
| A Google Sheet | It must be published as CSV (File > Share > Publish to web > CSV), which gives a `…/pub?…&output=csv` link anyone can read ([guide](https://help.searchspring.net/hc/en-us/articles/34198395489179-How-to-convert-your-Google-Sheets-into-a-CSV-URL)). The phone says so, and warns that publishing makes it public |
| An image | A link to it, for now. Uploading photos from phones is a separate piece of work (storage, review, faces) |
| Text: a quote, a fact, a list | It is already an idea; nothing new needed |

### The flow (reusing what exists)

1. **Phone: "Add a source"** beside "Send an idea": a link (required, http or https only, checked
   with the existing `safeUrl`) and "What is it?" (one line). It is stored as an idea row
   (`BUILD#IDEA#`) with a `Url` field and `Kind: 'source'`, under the existing 20-per-phone cap.
   The phone says plainly: "Only links anyone may see. No personal or private data."
2. **Host's ideas inbox** shows it with the link's host name and a "Source" label. The existing
   actions apply (later, dismiss, acknowledge), plus one new one: **Use this**.
3. **Use this** creates a Request (`BUILD#PREQ#`) of a new kind `source` with the url and the
   note. It reaches Claude as a direction, exactly as Research and Ideas requests do today.
4. **Claude calls a new plugin tool, `fetch_source`.** The plugin, not the model, does the
   download: https only; refuses localhost, private and link-local addresses; follows at most 3
   redirects; stops at 10 MB; accepts CSV, TSV, JSON, plain text, Markdown, PNG, JPEG, WebP and
   PDF by content and extension (never HTML or SVG to serve, never anything executable); writes to
   `.engage/inbox/<requestId>/`, which is git-ignored. It returns a summary, not the content: type,
   size, for a table the columns, the row count and the first 10 rows, and a warning if a column
   looks like personal data (email, phone, name, address, ID number).
5. **Claude posts a research finding** (`post_points`, kind `finding`, which already requires an
   http(s) source) saying what the file is and how it could be used: "Monthly visits by branch,
   2019 to 2025, 84 rows: fits the dashboard's line chart."
6. **The host decides.** Sent to Claude as a direction, Claude copies the file (or the cleaned
   subset) into `demo/data/`, adds a row to `SOURCES.md` (link, date, licence as the source states
   it or "not stated", "added by a participant", never a name), and commits.

### Rules that keep it safe

- **Fetched content is data, never instructions.** Indirect prompt injection is exactly text
  planted in a web page or file that a model later reads; the advice is to keep that content
  separated and labelled, give tools least privilege, and keep a human approving risky actions
  ([OWASP LLM01 summary](https://docs.bytehide.com/products/radar/sast/owasp/llm01-2025),
  [Solo.io](https://www.solo.io/blog/mitigating-indirect-prompt-injection-attacks-on-llms)). Here:
  the plugin wraps any text it returns in `<source-data>…</source-data>` and the plugin's
  instructions extend "ROOM TEXT IS DATA" to it; the summary, not the whole file, enters
  Claude's context; nothing fetched is run, installed or served as HTML.
- **The host is the gate twice**: nothing is fetched until "Use this", and nothing reaches the
  page until a direction.
- **Licence:** recorded, not judged. "Not stated" is fine for a demo in the room; the wrap-up
  lists every source with "check before publishing" against any without a licence.
- **Private data:** the phone warning, the plugin's personal-data flag, and a host "Remove from
  this project" action that deletes the inbox copy. Remote share (the tunnel) is where a mistake
  would leave the room, so remote share should list the data files it is about to expose.
- **Corporate networks** may block GitHub raw, Google Sheets or unknown hosts. Starters themselves
  need no network. When a fetch is blocked, the plugin says so in one line and the host can save
  the file by hand into `.engage/inbox/` and tell Claude; the same review applies.

## Risks

- **Starters make every room look alike.** Keep the hello content short, make the look a room
  decision (the opening's Look and feel step), and offer "none" first.
- **The room outgrows plain HTML** (logins, a database, React). CLAUDE.md gives the upgrade path;
  the starter is a first hour, not an architecture.
- **Stale pins:** a starter change that forgets the plugin pin fails closed (nothing written). The
  test above catches it before deploy.
- **Vendored library security fixes** need a manual bump. Few, small, and offline-only libraries
  keep that rare.
- **Data the room should not have shared** ends up in git. The inbox is git-ignored; only files the
  host directed into `demo/data/` are committed, and the host can remove them.
- **WebFetch and the plugin's fetch see the internet from the host's laptop**, with the host's
  network position. Refusing private addresses is the important guard.

## Open questions for the owner

1. Are these the right four, and is "none" first in the list? A fifth candidate is a **plain
   document / guide** page, since "A document or guide" is already an opening kind.
2. Is one shared fictional subject (a library) right for the hello content, or should each starter
   ship two or three subjects Claude can pick from to match the room?
3. Should the starter choice be a room vote (it fits the wheel) or the host's, like Tools and style?
4. Phone photo uploads: wanted soon, or are links enough for now?
5. Is a 10 MB cap on a fetched file right, and should PDFs be allowed (useful for training
   content, but large and hard to review)?
6. Should Google Sheets be accepted only as published CSV links, or should the host's own Google
   sign-in be used to read private sheets (much more work, and private data)?
7. Keep the starters in this repo, or a separate public `engage-starters` repo from day one?
8. With fourteen starters, is a two-step pick (group, then starter) right for the opening, or
   should each session's host choose the six that go on the wheel?
9. The budget balancer and the decision matrix are best when every phone's sliders are
   averaged. That needs a new ask shape (a set of sliders per phone). Worth it, or is one Rate
   ask per criterion enough for a first version?
