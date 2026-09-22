# Rationale — the front page and the session page, refreshed

Mockups: `index.html` lists them. Built by `_src/build.py` from the approved
shells — `marketing-redesign/mk.css` and the audited stylesheet of
`host-redesign/02-ask-call-and-answer.html` are read at build time and only
`_src/refresh-home.css` and `_src/refresh-stage.css` are new — so every token,
wash, ladder and floor is byte-identical to what was audited and the refresh
reads as a diff. No file fetches anything (the build asserts it).

**Rendered, yes.** Every mockup was served on :8124 and looked at in the
browser pane at 1600×900 (the pane draws it at roughly 800×450 CSS px, so the
stage fitter dropped option F and the explanation on the results page — the
fitter working as audited, not a defect; at 1920×1080 the approved 07 holds all
of it). Three defects were found that way and fixed before this was written:
the two-column hero could not hold the approved 68px three-line headline; at
390px the forced line breaks produced seven lines and the amber band rose into
the lead; and the results reveal was playing underneath the phase wipe.

## Summary

1. The front page's largest defect is that the product is not in the first viewport: 88vh of sky over two buttons. The drawn RESULTS still now sits beside the headline.
2. Impeccable's craft floor names five scaffold tells; the shipped home uses all five. Kickers survive only where they carry the climb (Base camp, The summit).
3. Three filled-amber controls above the fold become one: the nav door and Join are outlines.
4. Motion on the home is one authored moment (the route draws itself with scroll, ahead of the climber that already moves) plus one performing block (the tally grows and counts up, once, in view). Headline rises once from an already-painted default.
5. Two photographs were requested and the owner supplied one candidate each; both are placed at the specified crops with a measured caption wash (§4a). A is usable as-is with the crop; B is usable but earns a re-shoot.
6. The stage's largest defect is a regression: shipped trivia RESULTS shows no question, no explanation and no CORRECT word — "correct" is a border colour alone. Restored.
7. The approved phase wipe never shipped; the band changes colour with no transition. A room heads-down on phones needs one beat. Shipped here as transforms and opacity, 1.4s, gone by itself.
8. The results reveal performs once: shares grow, percentages count up, the correct row lands last, standings show their deltas. Then stillness.
9. The home page promises answers appear on the front screen as they arrive; the stage shows a count. Arrivals on the wall closes the gap — or the copy must change (open question 1).
10. Nothing in the skill's binding rules moves: four ladders, floors, measured contrast, the fitter's chrome-before-content order, no idle motion, the encoder constraint for Call.

---

## 1. The front page

**For:** a team lead or facilitator arriving cold. **Must reach:** "I want to run one of these" and the account door.

### Critique of what ships

| # | Finding | Where |
|---|---|---|
| 1 | The hero is 88vh of scene above two buttons and a join card. No picture of the product exists until the third screen. A cold visitor cannot tell what this *is* from the first viewport. | `HomePage.css:20-33`, `HomePage.jsx:34-44` |
| 2 | Three filled amber controls above the fold: nav "Create a host account", hero primary, and Join (`jce-go` is `mk-btn-primary`). The eye has no single target. | `MarketingShell.jsx:526-532`, `mk.css:293` |
| 3 | A kicker on every section heading (7 of them), `01/02/03` numerals on the problem cards, three same-size cards then four same-size cards as page structure, a 3px coloured `border-left` on the material note. Impeccable's craft floor names each: *"A kicker or eyebrow above a heading… this one is a ban"*, *"Section numbers (01/02/03) unless the sequence itself carries information"*, *"Same-size cards of icon plus heading plus text as the page structure"*, *"A colored border-left… above 1px"*. | `HomePage.css:36-47, 88-99, 102-107`; `HomePage.jsx:49, 66, 98, 123, 158, 172` |
| 4 | No motion anywhere but hover colour. `useScrollProgress` feeds a parallax drift and moves the climber (`RidgeScene.jsx:97`), which is good — but the route is fully drawn from frame one, so the plan reads as already walked. | `RidgeScene.jsx:134`, `MarketingShell.css` (no `transition`/`animation`) |
| 5 | The tally in "The room reacts" is static bars. It is the product's one live moment and it does nothing. | `HomePage.jsx:127-145`, `HomePage.css:123-125` |
| 6 | A fact stated twice: each mode's paragraph and its first list item say the same thing ("A question, four options, one right answer" / "Everyone writes at once…"). | `content/home.js:618-623, 630-635` |
| 7 | The home page claims *"Answers appear on the front screen as they are submitted"*. The stage's ASK shows a count. | `content/home.js:115` vs `GameHostPage.jsx:5661-5668` |

### Ranked changes

1. **The product in the first viewport.** `.mk-hero-top` becomes two columns (1.2fr / .8fr): copy left, the drawn trivia-RESULTS still right (TV device, correct row carrying the headline, shares beside options, a phone overlay showing "+120 pts"). The headline becomes four short lines at `clamp(40px, 3.5vw, 54px)` — the approved 68px three-liner needs 19ch the two-column hero no longer has. The contrast rule is unchanged: text stays in the top 55%; the device is a dark object with its own contrast and may enter the amber band. At 390px the still stacks under the lead and above the buttons, the phone overlay goes, and **the glow anchors to the hero's measured height** rather than 60% of 92vh — with the still in the hero the content out-measures a phone viewport and the band rose into the lead (found rendered).
2. **One filled amber per viewport.** Nav door and Join become outlines (`.mk-btn-ghost` treatment on the same class, so the React markup is untouched).
3. **Scaffold tells removed.** Problem statements become three columns on a hairline, no cards, no numerals. The four steps become a sequence on a rule with waypoint numerals — the order *is* information, so those survive. Material note: 1px rule, no tint. Kickers survive twice: Base camp and The summit carry the metaphor; the others were labels for headings that carry their own weight.
4. **The route draws itself.** `stroke-dasharray:1; pathLength=1`, `stroke-dashoffset` driven from the same progress the shipped hook produces, drawn 8% ahead of the climber; the flag brightens when progress passes 0.86 (the report). Reduced motion: drawn in full, still. Source: motion-primitives `scroll-progress`, applied to an SVG path instead of a bar.
5. **The tally performs.** Bars are declared at `width:0` with the real value in `--w`; an `IntersectionObserver` at 0.35 adds `.is-in` once and the counts count up in the same 700ms with a cubic ease-out. Source: motion-primitives `in-view` + `animated-number`; react-bits `CountUp`. It is the only motion the section gets.
6. **Headline rises once.** Four spans, 620ms, 90ms apart, `cubic-bezier(.16,1,.3,1)`, blur 6px→0. Visible by default; a failed script hides nothing. Source: react-bits `SplitText`/`BlurText`, motion-primitives `text-effect`, done by hand — no dependency.

Not borrowed, deliberately: spotlight/glow cards, magnetic buttons, gradient text, aurora/particle backgrounds. Each is on Impeccable's refuse list or is decoration without a job; the ridge is already the page's one material idea.

## 2. The session page (the stage)

**For:** a room looking up from phones; a host driving from a clicker. **Must do:** be legible at 25ft in four profiles and make each phase change unmissable.

### Critique of what ships

| # | Finding | Where |
|---|---|---|
| 1 | **Trivia RESULTS shows no question.** `QuestionCard phase="REVEAL"` is rendered without `withQuestion`, so `QuestionCard.jsx:74` returns the options alone. Mockup 07 restored the recap after CRITIQUE B7; the port lost it again. | `GameHostPage.jsx:5798-5803`, `QuestionCard.jsx:55-81` |
| 2 | **No explanation on RESULTS.** `answerDetails` renders nowhere on the stage; 07's `.qdetail` "Explanation" line was not ported. | `grep answerDetails GameHostPage.jsx` → none |
| 3 | **Correct is colour alone.** `.opt.correct` differs by border colour and fill tint; the CORRECT word-flag exists only as `CompletionFlag` in the meter. The spec's "never colour alone" is violated on the payoff screen. | `QuestionCard.jsx:64-69`, `stage.css:595-597` |
| 4 | **A fact stated twice.** The kicker "Question 4 · Results" repeats the rail's "Question 4 of 10" (hard rule 5). | `GameHostPage.jsx:5749-5751` |
| 5 | **No phase-change signal beyond a colour jump.** `PhaseBar` flips `data-phase`; `stage.css:210-216` has no transition. Mockup 16 (the wipe) was approved by every reviewer and shipped nowhere. | `PhaseBar.jsx:17-22` |
| 6 | **The join code is 26–31px at Room** (`--t-meta × 1.3`), ~10.7′ at 25ft — below the comfort band CRITIQUE B9 set. Once ASK begins the QR is gone; this is the only way in for a latecomer. | `stage.css:202-203` |
| 7 | **ASK shows only a count** for call-and-answer, while the home page promises arrivals on the front screen. | `GameHostPage.jsx:5661-5668` |
| 8 | **The standings never move** on the stage; RoomMeter has no standings slot and the file records the conflict as unresolved. | `GameHostPage.jsx:5784-5787` |
| 9 | 07's `.field.alpenglow` (a stronger bloom, bottom 40%) never reached `stage.css`; RESULTS looks like ASK. | `02-ask-call-and-answer.html:145`, `stage.css:149-158` |

### Ranked changes

1. **Restore 07 on RESULTS**: recap (wraps, `--text`), the correct row as `hero-row` with the CORRECT word-flag, the explanation at body size in `--text`. Drop the kicker. This is a regression fix before it is a design.
2. **The phase wipe, shipped.** Band at 36%, `scaleY(.18)→1` in 200ms, dwell, fade by 1.4s, `visibility:hidden` at the end. Transforms and opacity only; a solid plate in Call (`:root.d-call .wipe{background:var(--bg)}`); absent under reduced motion, where the bar's 260ms colour cross-fade still marks the change. Subline in body size says what to do ("Write your answer on your phone" / "Look up").
3. **The reveal performs.** Every `.fill` is `scaleX(0)` and grows in 620ms with `cubic-bezier(.16,1,.3,1)`, rows 80ms apart capped at 450ms; percentages count up in step; the correct row's border turns green at +550ms and the flag slides in at +720ms; the explanation last. All delays are `calc(var(--rv) + …)` where `--rv` is the wipe's dwell, so the reveal begins as the band lifts (found rendered: it was playing underneath). Reduced motion: the final frame. Sources: motion-primitives `animated-number`, react-bits `CountUp`; the stagger is a list appearing as a list, capped, per Impeccable's animate reference.
4. **Arrivals on the wall.** The meter column widens (`clamp(300px,31vw,640px)`) and carries "Answered 31/40" plus the last three responses, unattributed, newest first, older ones dimmer. An arrival is an event, so it may move: one 240ms rise, and the count ticks with it. Nothing idles.
5. **The code a latecomer can read**: `--t-secondary` in the rail. The rail's sacrifice order (title first) is unchanged.
6. **Standings move**: rows that changed carry ▲n/▼n for this screen only; names wrap, never ellipse. Trivia has no anonymity, so score-beside-name is allowed here — the conflict at `GameHostPage.jsx:5784` needs the RoomMeter slot.

### Profiles and the encoder

Every new rule reads `--t-*` and `--hair`; nothing is a fixed px. TV and Table inherit their ladders unchanged. Call: the wipe and the arrivals use no blur, no gradient, no 1px line; the reveal is `transform`/`opacity`, which survives a codec better than a growing `width`. Timing does not depend on size, so all four profiles play the same sequence.

## 3. Sources borrowed, and why

| Pattern | Source | Used for | Why this one |
|---|---|---|---|
| Craft floor: kicker ban, 01/02/03, same-size cards, border-left >1px, "one authored moment", `cubic-bezier(.16,1,.3,1)`, exit faster than entrance | pbakaus/impeccable `reference/craft-floor.md`, `animate.md` | Home §3, all timing | It names the exact tells the shipped page has, and its motion rule matches the stage skill's "no idle motion" |
| Modes: Persuade vs Operate | impeccable `SKILL.md` | Home is Persuade (motion may carry voice); the stage is Operate (motion is feedback/state) | Explains why the two surfaces get different budgets |
| `scroll-progress` | motion-primitives | The route drawing with scroll | Applied to a path, not a bar: the product's own metaphor |
| `in-view` + `animated-number` / `CountUp` | motion-primitives, react-bits | The tally; the results percentages | Numbers changing is the product's live moment |
| `SplitText` / `BlurText` / `text-effect` | react-bits, motion-primitives | Headline rise | Once, from a painted default |
| `AnimatedList` | react-bits | Arrivals; standings deltas | A list appearing as a list, stagger capped |
| Anime.js / framer motion / kokonutui | listed in the brief | nothing | Everything above is expressible in CSS + 40 lines; mockups take no dependency by repo rule, and the product should not either |

## 4. Image requests (the owner can act on these)

Two for the home page. None for the working stage states — the art brief already assigns raster to the lobby and ENDED and vector to everything worked in; ASK and RESULTS are worked in.

**A. "The room, looking up"** — sits in *The room reacts*, beside the tally, 4:3, ~1600px, WebP ≤180KB. A real meeting room, dusk-lit, 12–20 people seated, most holding phones, all faces turned up toward an off-frame screen at the front — the moment a result lands. Shot from behind and slightly above the back row so the screen's glow is on their faces and the screen itself is out of frame (the product still is drawn beside it; a photographed screen would date). Warm amber key from the screen, cool blue ambient. Low-key: no face brighter than mid-grey, so `--mk-text` over a 70% wash still clears 4.5:1. No laptops, lanyards or brand marks.

**B. "The summit, held"** — sits beside the report in *The summit*, 3:4 on desktop and a 16:9 crop on mobile, ~1400px tall, WebP ≤160KB. A single sheet on a dark table held at its top corners by two hands from opposite sides. Overhead, tight crop; the sheet is the brightest thing in frame and blank or out of focus (the report is drawn). It should feel like agreement, not paperwork. Contrast: the sheet is never under text.

Both go in `src/public/assets/hero/` with a `CREDITS.json` entry per the art brief §7, licence filled in for real.

### 4a. The supplied images

The owner supplied one 1024×1024 JPEG per request in `docs/design/test-images/`
(2×2 grids were expected; a single candidate each means there is no choice to
make within a set — the verdicts below are against the brief, not against
siblings). They are now referenced from `01-home.html` and `01m-home-mobile.html`
by relative path (`../test-images/…`), an exception to the self-contained rule
recorded in `_src/build.py`'s `photo()`; no derived file was written — the crops
are `object-fit: cover` + `object-position`.

**A. `engage_photo_participants.jpeg` — usable with a crop, as a figure.**
Subject and mood are right: faces turned up toward an off-frame screen, phones in
hand, amber key on the faces, cool blue ambient, the screen out of frame. Two
departures from the brief: it is a three-quarter view from the front-side, not
from behind the back row (so faces are lit, and the front woman's cheek is well
above mid-grey), and there is a lanyard badge bottom-left and a small watermark
bottom-right. *Treatment:* 4:3 cover crop centred at 52% height (source rows
≈133–901), which drops both the badge and the watermark; used as a figure with
its caption in a `wash-a` band at the foot — no body text sits over it, so the
mid-grey face rule is moot. *Re-shoot only if* the from-behind framing is wanted;
if so the prompt should add "no badges, no lanyards, no watermark, faces in
shadow lit only by the screen".

**B. `engage_photo_paper.jpeg` — usable with a crop; a re-shoot would be better.**
Overhead, the sheet is the brightest thing in frame and effectively blank. But it
reads as a legal handover: three hands, a suit with French cuffs, a document
sliding across a desk — not two people reading one page. The tiny printed block
near the sheet's foot is illegible at any size the page uses but is still text on
a "blank" sheet. *Treatment:* 3:4 cover crop at 54% width (source columns
≈170–938), which keeps both parties' hands; 16:9 at 55% height on mobile. *Prompt
for the re-shoot:* "one sheet held flat at its top corners by two hands from
opposite sides, shirtsleeves, no jacket cuffs, sheet fully blank, overhead,
tight crop, dark table" — the current frame is the fallback.

**Contrast, measured.** Brightest 16×16 block of each crop, composited under the
caption band (`--mk-wash-a`, rgba(15,26,46,.9)), against `--mk-text` #F4EDE4:

| image | brightest region | under wash-a | `--mk-text` | `--mk-muted` |
|---|---|---|---|---|
| participants (a window, not a face) | #B6C8CF | #202B3E | **12.25:1** | 5.92:1 |
| paper (the sheet) | #DCDED5 | #242E3F | **11.76:1** | 5.68:1 |

Bare, `--mk-text` on those regions is 1.49:1 and 1.17:1, which is why nothing
but the wash band may carry a word. Over a 70% wash the figures fall to 7.30:1 /
6.49:1 for `--mk-text` and **3.53:1 / 3.14:1 for `--mk-muted`** — under AA — so
only `--mk-text` is used in the band and the wash stays at .9. Measured with a
pure-Python PNG decode of `sips`-converted copies (no PIL on this machine).

## 5. What must not change, and why

- **The four literal ladders and floors** (`stage.css:43-94`, skill §2). Every new stage rule reads `--t-*`; the `--k` scalar failure is the reason.
- **Chrome before content, and no clamps in base CSS** (`stage.css:268-275`, CRITIQUE N1). The new elements carry no `data-drop` and no clamp; the arrivals column is chrome and goes with the meter.
- **No idle motion on the stage** (skill, spec §6.14). Everything here plays once on an event and ends in stillness; nothing loops; the one existing loop (`wl-sheen`, a waiting state) is untouched.
- **Measured contrast, composited** (hard rule 4). No new colour; `--success-text` for the flag, `--muted` only for labels.
- **The amber stays in the bottom 40%** (art brief §4). The hero still is the only thing allowed into it, because it is not text.
- **Only `--mk-text` in the join card** (marketing RATIONALE §8). Join's button changed treatment, not its copy colour.
- **Honesty lines**: trivia has no vote phase; the zero-vote answer is kept; the vote count is a vote count.

## 6. Implementation sequence

1. **Home: structure and washes** (`HomePage.jsx`, `HomePage.css`, `content/home.js`; `RidgeScene.jsx` reads the hero's measured height under 720px). Tests: extend `homePagePalette` (or the existing marketing palette test) to assert no `mk-kicker` outside `#top` and `#summit`, no `.mk-stmt-n`, `border-left` ≤1px on `.mk-material-note`, one `mk-btn-primary` inside `.mk-hero`; contrast of the still's chips composited on `--mk-ridge-front→--mk-bg`.
2. **Home: motion** (`useScrollProgress` → route dashoffset; tally observer; headline spans). Tests: CSS-as-text asserts every `animation`/`transition` in `HomePage.css` has a `prefers-reduced-motion` counterpart; the tally's `--w` values equal the content's `width` numbers; no geometric assertions.
3. **Stage: RESULTS regression** (`QuestionCard.jsx` REVEAL gains recap, `answerDetails` line and `.flag`; drop the kicker). Tests: extend `questionCardDom.test.jsx`'s frozen markup; `stageShell` asserts `.opt.correct` contains a `.flag` with text.
4. **Stage: the wipe and the reveal** (`PhaseBar` renders `.wipe` on phase change, keyed so it plays once; `.fill` animation; `--rv`). Tests: palette test asserts `--rv` is declared on `.stage`, every keyframe in `stage.css` touches only `transform`/`opacity`/`border-color`/`visibility`, and each has a reduced-motion rule; `:root.d-call .wipe` has no `backdrop-filter`.
5. **Stage: arrivals and standings** (RoomMeter gains an `arrivals` list gated by a session setting and a standings slot with deltas; rail code tier). Tests: `RoomMeter` renders no author on an arrival; the count and the arrivals never both appear when `data-auto-solo` mirrors the count (audit A12); the rail's `data-drop` order is unchanged.

## 7. Open questions

1. **Arrivals on the wall — default on?** They are the moment the marketing sells and the strongest live beat; they also anchor later writers. *Recommend:* a session setting, default on for call-and-answer, off for wavelength, and the home copy left as it is. If the owner says off, change `content/home.js:115` in the same PR.
2. **Which still goes in the hero — RESULTS trivia or VOTE?** *Recommend:* RESULTS trivia; it reads at thumbnail size (one green row, four bars) where a vote page does not.
3. **Keep the "Base camp" and "The summit" kickers?** Impeccable would delete all seven. *Recommend:* keep those two; they are the metaphor, not labels.
4. **Wipe dwell — 1.4s or 1.2s?** CRITIQUE B9 suggested up to 1200ms for the room; the reveal now waits for it. *Recommend:* 1.4s on Room/TV, 1.0s on Table, where the host is reading at arm's length.
5. **Headline copy at four lines** — "Your team's own / material, turned into / decisions everyone / climbed toward." is the approved sentence re-broken. *Recommend:* accept; the alternative (a shorter new line) is a copy decision, not a design one.
