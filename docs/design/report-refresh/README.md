# Session report PDF: title sections refresh (2026-10-31)

The owner: *"the PDF version title sections could use a real design refresh. to match the
professional look that we have given the site."*

Open `index.html` for the gallery and `pages.html` for the actual-size pages, which print.
This is a mockup set. No application code was changed.

## 1. Where the generator lives

**The PDF is built in the browser, not on the server.**

| Piece | File | What it does |
|---|---|---|
| The document | `src/src/components/GameReport.jsx` → `ReportDocument` | One `<article class="report-doc">`, filled from `POST games/{id}/report` (`lambda-functions/game/create-report.js`) |
| Its styles | `src/src/components/GameReport.css` | Screen styles plus a careful `@media print` block, all scoped under `.report-paper` |
| The PDF | `src/src/utils/saveReport.js` → `saveReportPdf` | Runs **html2pdf.js 0.10.3** (html2canvas 1.4.1 + jsPDF 3.0.1) on `.report-doc`, then POSTs the base64 to `save-report.js` |
| PDF settings | `src/src/config/reportPdf.js` → `reportPdfOptions` | Letter, 0.5in margins, JPEG 0.8 at scale 2 (falls back to 0.6 at 1.5), `pagebreak.avoid: ['.report-keep']` |
| Storage | `lambda-functions/game/save-report.js` | Stores the bytes; the server draws nothing |

The Build Room report (`buildroom/BuildReport.jsx`) is saved through the same `saveReportPdf`.
**Print** (`window.print()`) is a separate path. It does use the `@media print` sheet.

### Constraints that shape the design

1. **Every page is a picture.** html2canvas paints the DOM onto one canvas, which is cut into
   page-sized JPEGs. The text cannot be selected, and the canvas tops out at 32,000 px
   (`MAX_CANVAS_PX`).
2. **Size limit: 5.5 MB of base64** (`MAX_REPORT_BASE64`), set by Lambda's 6 MB invoke limit.
   Large areas of flat dark fill make the JPEG pages bigger. This is a second reason the
   default is paper.
3. **The print stylesheet never applies.** html2canvas paints screen media. `break-*`
   properties are read only through html2pdf's `pagebreak` option.
4. **Fonts: whatever the page has loaded.** html2canvas draws with the browser's own fonts.
   The site already loads Archivo (wdth 125, 700/800) and Inter (400–700) from Google Fonts
   (`public/index.html:57`), so **both can be used, and no new face is needed.** Proven: a
   proposal page run through the shipped html2pdf (`shots/proof-html2pdf-L2.png`) keeps
   Archivo expanded and the tracked caps.
5. **No CSS running heads.** `@page` margin boxes are not available, and html2pdf has no
   header option. Running heads and page numbers have to be **stamped with jsPDF after
   slicing**: `html2pdf().from(el).toPdf().get('pdf')`, then `setPage(i)` and text/lines on
   each page.
6. **SVG `<use>` does not render** in html2canvas (see the proof: the sparkle and the
   running-head marks are missing). Marks must be inline `<path>`s, as `BrandMark.jsx`
   already does.
7. **Icons drawn as data-URI SVG with `fill="var(--primary)"`** are rasterised outside the
   cascade (the html2canvas log shows this), so the colour never resolves.

## 2. What the real baseline showed

`_harness/` builds the real `ReportDocument` with webpack, renders it in Chromium, and runs
the exact `reportPdfOptions` first pass. The result is `baseline-today.pdf` (6 pages), with
PNGs in `shots/baseline-p-*.png`.

**The main finding, which is a bug and not just a matter of taste:** html2pdf clones
`.report-doc` into its own `html2pdf__container` overlay
(`node_modules/html2pdf.js/src/worker.js:121-123`). The clone no longer sits inside
`.report-container.report-paper`, so **every rule in GameReport.css misses**, and the report
is drawn by the old single-class report rules in `styles.css`. On screen the report looks
like the design. In the saved PDF it looks like the 2025 dashboard:

- the title block has lost its eyebrow caps, the meta labels and the rule; the date is italic and centred;
- "Session" and "About this session" run together on one line; "The taskHow could you…" is missing its space;
- the AI analysis is a card inside a card; answers are yellow gradient cards with emoji medals and orange pills carrying white text;
- comments have no shape: label, excerpt, text and author run together as plain lines ("Aisha OkaforShown to the room");
- standings are orange tiles with a red "Session Champion" badge;
- the round 2 heading is cut in half across the page break (the section header is not `.report-keep`);
- there is no running head, no page number, and no end except "End of report" in the corner.

Also: the date printed is **the day the report was built** (`new Date()`), not the day of
the session. `create-report.js` already sends `startedAt`, `createdAt` and `hostName`, but
`GameHostPage.jsx` (around line 6194) rebuilds `reportData` without them, so the cover has
no date or host to show.

## 3. The frames

| Frame | Shows |
|---|---|
| L1 | Session cover: brand tab, ridge with the amber mark, kicker, title, standfirst, Held / Hosted by / Format, summary strip (people, rounds, responses, top-voted response) |
| L2 | About this session (session details and set description, each with its source), attendance, **round opener**, the task, **Workie's read** |
| L3 | **What the room said** (ranked, points bar, vote breakdown), **Comments** |
| L4 | Next round opener (the pattern repeats); the **trivia answer-choices** variant |
| L5 | **Standings**, **Appendix: how to read this report**, end mark |
| E1 | **Event roll-up** cover |
| E2 | The day at a glance: the agenda as contents, one key result per item, Workie's read of the day, totals across the day |
| E3 | A session inside the roll-up: part opener (`1/4`), then its rounds |
| A1, A3 | The cover and a round page on A4 (210 × 297 mm), same margins |
| L1/L2 grey-noink | Greyscale with background graphics off |
| V1 | Dusk cover, for sharing on screen only |

## 4. Key decisions

1. **Paper is the default; dusk is an accent.** White page, navy `#1B2942` ink. Dusk
   appears as the brand tab and Workie's 3pt bar. Full dusk is offered only as V1, for
   reports shared on screen. It costs ink and JPEG bytes.
2. **Amber never carries text.** `#F6A94C` is 1.96:1 on white, so it is used for the
   mountain, the kicker tick, the top-voted rule and the summary-strip key rule. Amber
   *words* use `#9A5B18` (5.4:1), the paper amber the product already uses
   (`QuestionSetsPanel.css:592`).
3. **One kicker for every section**: a 14pt amber tick plus tracked caps
   (`ROUND 1 OF 3 / BIG BETS`). Each section is then identified by its shape, not its colour:
   the round opener uses a big numeral, Workie's read is a framed panel with a dusk bar,
   responses are a ranked list, comments are indented behind a rule, and standings are a table.
4. **Workie's read comes before the evidence**, as the code orders it today and as the
   survey report mockup does. It is labelled "AI analysis of the responses, not the host's
   words". The tint is optional ink; the frame and bar alone keep it distinct (grey-noink frame).
5. **The cover leads with the result.** The strip carries three counts and the top-voted
   response with its points. For a survey it would hold the headline statistic.
6. **Two faces, the site's own**: Archivo expanded for display, Inter for text. Print ladder:
   7 / 7.5 / 9 / 10 / 11 / 15–17 / 20 / 34 pt. Furniture never goes below 6.5pt.
7. **Every distinction survives greyscale** through a rule, a numeral or a word (Top-voted,
   Correct, Session champion, Shown to the room), never through colour alone.
8. **Copy**: "Player applications" becomes **What the room said**; "AI Analysis" becomes
   **Workie's read**; the emoji medals are dropped (rank numerals already carry the rank).

## 5. Implementation map

**Fix the clone first. It is a one-line class of change, and it would ship most of
GameReport.css's existing design to the PDF on its own.** Pass html2pdf an element that
carries its own scope: put `report-paper` and `data-theme="light"` on the `<article>`
itself, or re-root the GameReport.css selectors at `.report-doc`. Then add a `.report-pdf`
mode class, set on the clone through `html2canvas.onclone`, which applies the print-ink rules
(white page, black rules) that html2canvas cannot read from `@media print`.

| Change | Where |
|---|---|
| Scope survives the clone; `.report-pdf` ink mode via `onclone` | `GameReport.jsx` (`<article>`), `GameReport.css`, `utils/saveReport.js` |
| Cover: new `ReportCover` (brand tab, ridge, facts, strip), `break-after: page` | `GameReport.jsx` (replaces `.report-titleblock`) |
| Forward `startedAt`, `hostName` (and `createdAt`) into `reportData` | `GameHostPage.jsx` around line 6194 |
| Round opener (numeral + kicker + heading), task between rules; make `.report-question-header` `.report-keep` | `GameReport.jsx` question map, `GameReport.css` |
| Workie's read panel; inline SVG mark instead of `<Icon>` data-URI | `ReportAISummary` |
| Ranked responses with points bar; drop emoji `rankDisplay` from the PDF | answers block (`rankDisplay` is built in `create-report.js:747`) |
| Comments shape | `ReportComments` (the CSS mostly exists and is just not reaching the PDF) |
| Standings as a table; appendix block | final-scores section |
| Running head/foot + "Page n of N", stamped on each page | `utils/saveReport.js`: `.toPdf().get('pdf')` loop before `outputPdf` |
| Margins `[0.75, 0.75, 0.85, 0.75]` in, to leave room for the stamps; optional A4 | `config/reportPdf.js` `reportPdfOptions` |
| Trivia per-option counts (L4) | **needs data**: `create-report.js` does not send per-option tallies today |
| Event roll-up (E1–E3) | **new document**: an event-level route that merges the items' report payloads; "Workie's read of the day" needs a new summary. Data for the agenda exists (`get-reports.js` returns `startsAt`, `items`) |

**Fonts to embed.** Nothing new for the body: html2canvas uses the loaded web fonts. For
the jsPDF-stamped head and foot, either use the built-in Helvetica (zero bytes, slightly off
brand), or `addFileToVFS` + `addFont` Inter Regular and SemiBold static TTFs (about 320 KB
each before subsetting). Measure against the 5.5 MB budget before choosing Inter.

**Tests that exist and will move.**
- `src/src/__tests__/reportPdfSize.test.jsx` asserts `jsPDF` is letter/portrait and
  `pagebreak` is `['.report-keep']`; margins are not asserted, so add that when they change.
- `src/src/__tests__/gameReport.test.jsx` (68 cases) reads GameReport.css's print block as
  text and asserts the document's structure, the `document.title` print header, and the
  front matter.
- `src/src/__tests__/reportShare.test.jsx`, `buildReport.test.jsx`,
  `talkingPointsReport.test.jsx`, `reportFollowUps.test.jsx`, `reportLate.test.jsx`.
- Backend: `tests/report-front-matter.js`, `tests/report-payload-flow.js`,
  `tests/session-report-honesty.js`, `tests/survey-report-results.js`.
- **Missing, and needed:** a test that the element handed to html2pdf carries its own scope
  (the bug in §2). Read `saveReport.js`/`GameReport.jsx` as text and assert that the
  `.report-doc` element has `report-paper` (or that GameReport.css selectors are rooted at
  `.report-doc`). jsdom cannot check the rendering itself.

## 6. Open questions for the owner

- Should the event roll-up be built, or is a per-session cover enough for now?
- On the cover, host name or team name, or both? (`hostName` is a free string today.)
- Keep names on the PDF responses by default, as the screen does?

## 7. Reproducing

`_harness/` holds the fixture (`fixture.js`: the owner's question and four answers plus two
rounds from `demo-sets/what-we-should-be-known-for.csv`), the webpack entry, the baseline
runner (`run.js`), the page shooter (`shoot.js`) and the html2pdf proof (`h2p-proof.js`). They
were run from a scratch directory with the Google Fonts files downloaded beside them, so
adjust the paths if you run them again. Playwright:
`/opt/node22/lib/node_modules/playwright`, Chromium `/opt/pw-browsers/chromium-1194`.
PNGs: `pdftoppm -r 100`.
