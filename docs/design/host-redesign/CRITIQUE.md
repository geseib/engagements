# Design critique — host screen redesign

**Reviewer:** design critique pass
**Date:** 2026-08-09
**Under review:** `docs/superpowers/specs/2026-08-08-host-screen-redesign-design.md` and the 16 mockups in `docs/design/host-redesign/`
**Method:** every mockup rendered in Chromium at 1920×1080 and 1280×720 (plus 1440×900, 1366×768, 1600×900 for specific claims), computed styles and box geometry measured in-page, contrast computed from tokens, and ten stress mutations applied to the live DOM (long titles, six long trivia options, 40 long names, a 60-word cloud, realistic Workie output, long answers, long champion names).

---

## 1. Verdict

**Approve with required changes — and do not write a line of implementation code until they are made.**

The diagnosis in §1–2 of the spec is the best piece of thinking in this repository. "The host screen is a scrolling document that is being used as a display" is exactly right, the element inventory is honest to the point of being uncomfortable, and the three-approach comparison in §3 argues the losing options at their strongest instead of strawmanning them. Approach C is the correct answer, the dock-as-grid-row insight is genuinely load-bearing, and four of the sixteen states (`03-ask-trivia`, `07-results-trivia`, `10-ended`, `16-phase-wipe`) are handsome, confident, and would work in a real room tomorrow. None of that should be re-litigated. **The strategy is approved and locked.**

The artifact is not implementable as it stands, and the reason matters more than the individual defects: **the verification the spec cites as evidence cannot detect the way this design actually fails.** The sweep checks for page scroll, elements outside the stage box, and sub-20px text. But the stage is `overflow: hidden` on a `justify-content: center` flex column, so overflow does not produce a scrollbar and does not produce an out-of-bounds rect — it produces *silent, bidirectional decapitation of the content*, with no ellipsis and no scrollbar. The sweep is structurally incapable of failing. It passed sixteen pages because the sample copy was chosen to fit; add one sentence to Workie's output and the headline loses its first line at 1920×1080. Compounding this, the density multiplier — one of the four pillars — does not function at all (measured: identical type at all three densities), so the "Call" and "Table" pages that were swept are Room density three times, and two of the three mandated viewing contexts have never actually been rendered.

Two of the nine blockers below are not bugs; they are design decisions that have not been made — what happens when content exceeds the box, and what the three contexts actually differ by. Those need to be decided in the spec, the mockups re-rendered, and the sweep rebuilt to assert *clipping* rather than scrolling. That is a bounded amount of work on top of a document that is otherwise unusually good, which is why this is a gated approval and not a rejection.

---

## 2. Blocking issues

### B1. "Never scroll" is implemented as silent decapitation, and there is no content budget

**What breaks.** `.stage` is `overflow: hidden`; `.content` is `display:flex; flex-direction:column; justify-content:center; overflow:hidden`. When content exceeds the box, a centered flex column overflows *both ends equally* and `overflow:hidden` clips both. There is no scrollbar, no ellipsis, no fade, no indication whatsoever. The most important thing on the screen — the top of the question — is the first thing to disappear.

**The scenario.** A six-option trivia question with realistic option text, at 1920×1080, Room density. Measured: `.content` box 765px, content 903px. Rendered result (`stress/trivia-6-long-opts-1920.png`): the room sees the question as **"margin lift in B2B software?"** — the first two lines are gone above the clip — and options E and F sliced in half at the bottom. Nothing on screen indicates anything is missing. The host, looking at the same screen, has no way to know either.

This is not a contrived input. The spec itself describes the mitigations in §6.4 — "Five or six options switch to a single column at the next rung down", "Option text wraps to two lines maximum; beyond that the option grid drops a rung" — and **none of them exist in the CSS.** There is an unused `.opts.one` class and no line-clamp on `.opt .txt`. The adaptive behaviour is prose.

**What I'd do instead.** Three things, in order:
1. Change `.content` to `justify-content: flex-start` with a centering wrapper that can only center when it fits, so overflow is always at the bottom, never the top. Losing the tail of a list is survivable; losing the head of the question is not.
2. Write the missing section of the spec: **a content budget per state.** For each state, state the maximum content the layout accepts at each rung (e.g. trivia ASK: question ≤ 3 lines at `--t-primary`, 4 options ≤ 2 lines at `--t-secondary`), and the ordered ladder of responses when it is exceeded (drop a rung → single column → clamp with ellipsis → Expand beat). §9 rejects "auto-shrink to fit" on good grounds and says "*content* adapts" — but nowhere says how, and that omission is the single largest gap in the document.
3. Make the sweep assert clipping, not scrolling: for every element in the stage with hidden overflow, `scrollHeight <= clientHeight + 2 && scrollWidth <= clientWidth + 2`, with an explicit allowlist for the intentional `-webkit-line-clamp` cases. Run it against *adversarial* content, not the sample copy. This one assertion would have caught six of the nine blockers here.

---

### B2. The density parameter does not work, and when fixed it contradicts the floor rule

**What breaks.** Two independent failures in the same mechanism.

*(a) It is currently a no-op for type.* `--t-hero … --t-meta` are declared on `:root`, where `var(--k)` resolves to `1`. `body.d-table{--k:.62}` sets `--k` on `body` — a descendant — which does **not** re-evaluate a custom property declared on the ancestor. Measured at 1920×1080:

| page | body `--k` | `.q` | `.opt .txt` | `.chip` | `.btn` | dock height | meter width |
|---|---|---|---|---|---|---|---|
| `03-ask-trivia` (Room) | 1 | 60.5px | 40px | 20.5px | 35.2px | 140.4px | 494.8px |
| `12-density-table` | .62 | **60.5px** | **40px** | **20.5px** | **35.2px** | 103.5px | 356.2px |
| `13-density-call` | .82 | — | **50.3px** | **20.5px** | **35.2px** | 122.9px | 429.1px |
| `03` with `--k:.62` set on `:root` | .62 | 37.5px | 24.8px | 12.7px | 21.8px | 103.5px | 356.2px |

The type is byte-identical across all three densities. What *does* shrink is the box geometry — rail, dock, meter width, QR — because those rules live on descendants of `body`. So the density switch currently makes the containers smaller while leaving the contents full size. That is why the Table mockup clips "Wes Duncan" horizontally in half (`shots/12-density-table-1280x720.png`) and why the dock button ends up with 0.7px of clearance from the viewport edge at 1280×720 and 4.1px at 1440×900. The one control the spec promises can never be clipped (§7.1) currently survives on rounding.

*(b) When fixed, it breaks the hard floor.* `--t-meta: calc(clamp(20px, 1.9vh, 24px) * var(--k))` multiplies **after** the clamp, so any `k < 1` drops below the floor by construction:

| height | Room (k=1) | Call (k=.82) | Table (k=.62) |
|---|---|---|---|
| 1080 | 90.7 / 60.5 / 40 / 30.2 / **20.5** | 74.4 / 49.6 / 32.8 / 24.8 / **16.8** | 56.2 / 37.5 / 24.8 / **18.7** / **12.7** |
| 900 | 75.6 / 50.4 / 33.3 / 25.2 / 20 | 62 / 41.3 / 27.3 / 20.7 / **16.4** | 46.9 / 31.2 / 20.6 / **15.6** / **12.4** |
| 720 | 60.5 / 40.3 / 28 / 22 / 20 | 49.6 / 33.1 / 23 / **18** / **16.4** | 37.5 / 25 / **17.4** / **13.6** / **12.4** |

(hero / primary / secondary / body / meta; **bold** = below the 20px floor of §7.7)

So §4.4 (three densities) and §7.7 ("no room-facing text below 20px … a hard rule") are mutually exclusive as written. One of them has to give.

*(c) Fixing the floor makes the parameter vanish.* Move the multiplier inside the clamp (`clamp(20px, calc(1.9vh * var(--k)), 24px)`) and the floors bind almost everything at laptop heights. At 768px tall, Room resolves to 64.5/43/28.4/22/20 and Table to 56/40/28/22/20 — identical on three of five rungs. At 720 they are identical on four of five. **The density parameter is a no-op precisely in the context it was invented for.**

**What I'd do instead.** Retire `--k` as a type multiplier and be honest that the three contexts differ by *content and treatment*, not by size — which the spec already half-knows, since its Call and Table descriptions are dominated by the "two structural switches" (flat field, 2px hairlines, roster restored, hints shown). Keep one type ladder driven by `vh` with px floors, and define the three contexts as three content profiles:
- **Room** — dot matrix, no hints, no skip on stage, photo field.
- **Call** — flat field, 2px rules, tighter measure, otherwise identical.
- **Table** — roster with names, `SPACE` hint and Skip inline, and *this* is where a modest type reduction is legitimate — but express it as a second explicit ladder with its own floors (e.g. 16px), not as a multiplier that silently defeats the first one. A laptop at 2–4ft has a different floor than a projector at 25ft; pretending one floor serves both is what created this contradiction.

Whatever is chosen, `12-density-table.html` and `13-density-call.html` must be re-rendered, because right now nobody — including the author — has seen what they look like.

---

### B3. The Console covers the primary action, kills the keyboard, and is invisible in fifteen of sixteen states

Three separate failures that compound into one.

**(a) It covers the control it is not allowed to cover.** `.console` is `position:absolute; top:0; right:0; bottom:0; width:min(560px,44vw)`. The primary action sits at the right edge of the dock (`padding-right: calc(2.4vw + 10px)` = 56px at 1920). The drawer therefore sits entirely on top of it. `shots/11-console-1920x1080.png` shows this: the ghost "Skip Round" is partly visible, the primary is gone. And §5.4 requires the `Space`/`ArrowRight` shortcut to be *suppressed* while the Console is open. So while the Console is open there is **no way to advance the session at all** — not by click, not by key. §7.1 says the advance control "cannot be … covered by a panel." The design's own Console is the only thing in the product that covers it.

**(b) There is no way in.** `console-edge` appears in the body of exactly one file — `11-console.html`, the state where the Console is *already open*, so it is drawn behind the drawer. In the other fifteen states there is no edge tab, no button, no glyph, nothing. The only documented entry points are the `\` key and a "hover-revealed" tab. Nobody hovers a projector. And `\` is not a key that exists in a fixed place: on a German Mac layout it is ⌥⇧7, on French AZERTY it is ⌥⇧:, and on several layouts it is behind AltGr. The entire operator surface of this design is behind a keystroke that a meaningful fraction of hosts cannot type and none of them can discover.

**(c) The most common conference-room setup is locked out.** A host presenting with a wireless clicker can advance (clickers send Right/PageDown, which `HostActionBar` handles) but cannot open the Console — clickers have no `\`. So a host standing away from the laptop can advance rounds and do nothing else: no skip, no re-pick, no category change, no "who are we waiting on." This is the exact host the brief says must be fully capable without a phone.

**What I'd do instead.**
- Reserve the dock as a no-overlay zone: make the Console `bottom: <dock height>` rather than `bottom: 0`, or shift the primary left by the drawer width while it is open. The primary must remain visible and clickable at all times, including with the Console open. Then it can keep closing on advance, which is the right behaviour.
- Give the Console a permanent, small, room-ignorable affordance in the dock — a `⋯` glyph at the far left of the status line, at `--t-meta`, in `--muted`. It costs one glyph of stage, it is discoverable, it is clickable by trackpad, and it is invisible from the back row. Keep `\` as the accelerator; add `Esc`-to-open only if `Esc` is otherwise unbound.
- Add a visible close control and a documented focus trap. Right now the Console can only be dismissed by a key, which is the same failure as (b) in reverse.
- Delete "Signed in as george.seib@gmail.com · Administrator" from the panel entirely. §7.2 says "the room must never see … no email address." Moving it into a panel whose own banner reads *"the room can see this panel"* does not satisfy that rule; it converts a guarantee into a hope, and since the Console is where skip / re-pick / categories / density all live, the host will be opening it regularly, in front of the room.
- `Skip round` is styled with `--danger` red. §4.3 reserves red for destructive. Skipping a round is not destructive, and red is the wrong signal on the control a host reaches for under time pressure.

---

### B4. The rail clips mid-word at realistic titles, and the promised ellipsis cannot render

**What breaks.** §5.1 promises "A long event title truncates; it never pushes the code off screen," implemented as `overflow:hidden` + `text-overflow: ellipsis` on `.rail-meta`. But `.rail-meta` is `display:flex` with separate `<span>` children. `text-overflow` applies to block containers with inline content; it has no effect here. The children are simply clipped by the parent's hidden overflow, mid-glyph, with no ellipsis.

**The scenario.** Measured slack in the rail (content width vs available width), with the *substitute* fonts the mockups load:

| state | 1920 | 1600 | 1280 |
|---|---|---|---|
| `01-lobby` ("Q3 Leadership Offsite — Pricing Strategy") | +107px | **−150px** | **−445px** |
| `10-ended` | +290px | +29px | **−266px** |
| `03-ask-trivia` | +644px | +374px | +79px |

`shots/01-lobby-1280x720.png` shows the result: the rail reads "…— PRICING STRATEGY / **CALL &**" hard-cut against "JOIN". The game type and the category are gone, with no ellipsis and no visual signal that anything was removed.

1600px is not an edge case — it is the spec's own Room/Table auto-switch threshold. And the mockups fall back to system faces; production self-hosts **Archivo Expanded**, a materially wider face. A 15% width increase on the lobby rail's 1813px need overflows 1920. **The lobby rail will clip on the real projector with the real font and the sample title in the mockup.**

**What I'd do instead.** Give `.rail-meta` a single text node (or `min-width:0` on a block child that owns the string) so ellipsis actually renders; set explicit shrink priority so the round number and the join code are the last things to go, not the first; and cap the event title with a `ch` measure rather than letting it consume all available space. Then re-measure everything width-sensitive with Archivo Expanded actually loaded — the 26ch question measure, the option two-line wrap, and the button widths are all currently measured against the wrong font.

---

### B5. Field Notes — the state invented to solve the overflow problem — overflows at the reference resolution

**What breaks.** `09-field-notes.html` at **1920×1080**, with the author's own copy, already clips: `.content` box 765px, content 798px. `shots/09-field-notes-1920x1080.png` shows prompt 3 stopping mid-sentence at "Ask who we are". Add one clause to each prompt — still well inside what Workie produces — and the *headline* loses its first line too (`stress/fieldnotes-real-length-1920.png`: the room reads "…nobody proposed telling a customer why.").

The cause is a plain unit error. The markup sets `style="max-width:52ch"` on `.content`, which has no `font-size` of its own, so `ch` resolves against the inherited 16px body font → a **520px** column. The text inside runs at `--t-body` (30px), so the intended 52-character measure is actually ~26 characters. The result is a column occupying 27% of a 1920px stage, with 65% of the screen empty and the text clipped. The fix is available and free — the space is right there.

This matters disproportionately because Field Notes is the design's answer to "the AI summary is long and must scroll" (§9). It is the one state whose entire justification is that it fits. It doesn't.

**What I'd do instead.** Set the measure on the text elements at their own font size, not on the container at the inherited one. Use the width: two columns at 1920 (headline left, prompts right), or one column at ~34ch of `--t-body`. And enforce the content budget the spec already gestures at — "Workie's prompt should be adjusted to produce a single sentence under 90 characters" is the right instinct, but it needs to be a hard truncation in the view as well, because the model will not always comply.

---

### B6. Wavelength RESULTS is not designed

**What breaks.** The spec gives the word cloud three sentences (§6.10). The mockup gives it **twelve absolutely-positioned spans with hand-authored `left`/`top` percentages and hand-authored font sizes** — while the provenance line directly above them reads "61 WORDS · 34 DISTINCT." The screen contradicts itself: it announces 34 and shows 12, with no "+22 more" and no stated rule for which 12.

`.cloud .w` is `position:absolute; white-space:nowrap` with no collision detection, no packing algorithm, and no boundary handling. Feeding it 60 realistic terms (`stress/cloud-60-words-1920.png`) produces overlap throughout — "Discounting" collides with "Waterfall", "Value story" with "Terms", "Renewals" with "Rebates", "Confidence" with "Invoicing". The single amber word, which §4.3 makes the focal point of the view, is the one most likely to be obscured.

**The scenario.** A twelve-person wavelength round producing 34 distinct terms — the exact data the mockup claims to be showing.

**What I'd do instead.** Decide the reduction explicitly and say it on screen: top *N* terms by frequency where N is derived from available area and the 20px floor, plus a line reading "34 distinct terms · showing the top 14 · all of them in the report." Then specify the placement algorithm (spiral packing with measured bounding boxes and a collision test is the standard answer and is ~40 lines) or abandon the cloud shape for a ranked, sized list, which for a room at 25 feet is arguably the better read anyway. Also fix the colour: `Anchoring` is rendered in `--secondary` blue for no stated reason, which puts two accents on a view §4.3 says gets one.

---

### B7. Two RESULTS states never show the question they are the result of

**What breaks.** `07-results-trivia` shows the correct answer, the distribution, the explanation and the standings — and never the question. `06-results-call-and-answer` shows three answers under the kicker "The room funded these" — and never the prompt. The rail says "QUESTION 4 OF 10", which identifies the question without stating it.

§2.5 of the spec explicitly verdicts `trivia-question-recap` as **ROOM, reduced** — keep it. The mockups dropped it without argument. §7.10 forbids exactly this: a reduction with no recovery is a deletion, and deletions belong in §2, argued.

**The scenario.** Anyone in the room who looked at their phone during ASK — which is *everybody*, because answering happens on the phone — looks up at RESULTS and sees "A 5% list-price increase held through renewal · CORRECT · 42%" with no idea what was asked. The design's own premise is that players are heads-down on their phones during ASK; that premise makes the recap load-bearing, not optional.

**What I'd do instead.** Restore a one-line recap at `--t-body` above the distribution, clamped to one line with ellipsis, in `--text` not `--muted`. There is ample room on both screens.

---

### B8. VOTE shows six half-sentences

**What breaks.** `.card .ans` is clamped to two lines at `--t-body × 1.02` inside a two-column grid. At 1920×1080 with the mockup's own sample answers, **all six cards are truncated** — every one ends in an ellipsis (`shots/05-vote-1920x1080.png`). At 1280×720 the cards are 158px wide and hold roughly six words. Meanwhile the lower third of the content column and 75% of the meter column are empty.

**The scenario.** The room looks up during voting to see six sentence-fragments and a page counter. The spec's justification is that "every player is holding the full list on their phone" — but if the phone carries the content, the six cards are ceremony, and if the big screen is meant to be "the shared focus" (§6.7) then a shared focus made of half-sentences is not one. Note also that the carousel this replaces, for all its faults, showed one answer *whole*.

**What I'd do instead.** Pick one. Either (a) three cards per page, full width, four-line clamp, at `--t-body` — fewer answers, each actually readable, more pages, same auto-rotation; or (b) drop the answer text entirely and make VOTE a live tally of rank + author + bar, which is honest about the phone owning the text. (a) is better. What is not defensible is showing six answers and rendering none of them.

Related, and cheap: card 1's `.fill` at 100% width reads as a selected state rather than a proportional bar. Cap the leader's fill at ~90% or use a distinct treatment.

---

### B9. Phase legibility rests on a 20px pill, and the ladder is one rung short for the big-TV case

**What breaks.** The brief calls phase legibility "the single most important thing a big screen does." Between transitions, the room's only persistent phase signal is the `.chip` at **20.5px** in the top-left corner, plus a scrim change on the photo field.

Applying the spec's own arcminute model (1920 across 96in = 20 ppi, 25ft = 300in, cap height ≈ 0.72 × font size):

| element | size | subtends | spec's own comfort band |
|---|---|---|---|
| question | 60px | **24.8′** | 20–24′ ✓ |
| trivia option | 40px | 16.5′ | below |
| session code (rail) | 26px | 10.7′ | well below |
| **phase chip, round number, join URL** | **20px** | **8.3′** | ~1/3 of comfort; ~1.6× bare acuity |

The 20px floor was derived as a minimum for *labels*. The design then routes the phase state, the round number, the join address and the session code into that same tier. A room does not read the chip; at best it recognises a coloured blob. The strongest persistent phase cue on the screen is actually the dock's primary label ("Show Results" at 35px) — which is a happy accident of §3.4's dual-purpose argument, not a designed signal.

Worse, the chip's colour does not uniquely encode phase: LOBBY and VOTE are both `--secondary` blue; ASK and COMPLETE are both `--primary` amber. So the colour half of the signal is ambiguous and the word half is 8 arcminutes tall.

**And the model only covers projectors.** The brief says "projector / big TV." A 75″ TV is ~65″ wide; at 1920 that is 29.5 ppi, not 20. At 20 feet from a 75″ TV the question drops to 16.7′ (below comfort) and the 20px tier to **5.6′ — at the acuity limit, i.e. not readable at all**. The big-TV case, which is the more common modern setup, is unmodelled and the whole ladder is roughly one rung short for it.

**What I'd do instead.**
- Promote the phase to something a room perceives without reading: a full-width 6–8px colour bar directly under the rail in the phase colour, or a large phase word at `--t-secondary` occupying the left of the rail. It costs almost no vertical space and it is the cheapest possible fix for the screen's most important job.
- Give each phase a unique hue, or pair the colour with a distinct shape/icon so LOBBY≠VOTE and ASK≠COMPLETE at a glance.
- Add a second sizing model for the TV case (≥28 ppi) and either raise the ladder or state a supported viewing distance. Right now the spec's central physical claim is derived for one display type and asserted for two.
- The 700ms wipe is excellent and should stay — but 700ms is short for a room that is heads-down on phones. Consider 1200ms, and consider whether the wipe should persist until the first response arrives.

---

## 3. Non-blocking improvements

1. **The meter column is the design's largest unforced waste.** It reserves `19vw × k + 130px` = 495px at 1920 — 26% of the stage — in every non-solo state, and uses 150–250px of ~800px vertically. Its `border-left` hairline runs the full 780px beside 200px of content, which is the single clearest visual tell that this is a grid somebody didn't finish. Either size the column to its content, move the meter into the rail as a compact bar + count, or give the column a second job (the "waiting on" names, see #3).
2. **`--muted` is used for body copy the room must read**, in direct contradiction of §4.3's own rule. The trivia explanation on `07` is `.qdetail` → `--muted` ("A 1% price improvement lifts operating profit about 11%…") — a full sentence the room is expected to read. Same class, same problem, on every ASK detail line. Contrast is fine (7.24:1 nominal, ~5.1:1 after the spec's black-lift model), so this is a hierarchy decision, not an accessibility one — but the spec made the decision and the mockups ignored it.
3. **"Who are we waiting on" is now only obtainable by projecting a control panel.** The dot matrix answers "how many," which is the right room question. But a facilitator's job is to nudge *Dana*, and the only recovery the spec offers is the Console — which means learning who is missing requires showing the room an operator surface. Put the names in the dock status line ("Waiting on Dana, Tomás, Jordan") — it is already a room-facing line, and naming who we are waiting for is a legitimate room-facing nudge, not operator chrome.
4. **`10-ended` states the champion twice in one viewport** — as the hero *and* as the 1st podium card — which is precisely §7.4. Drop the 1st card and let the podium show 2nd and 3rd flanking the hero, or drop the hero.
5. **`10-ended` still shows "JOIN eng.seibtribe.us/play · 4821."** §6.12 says the join line disappears at ENDED and is replaced by the session summary. The mockup shows both, so a finished session still invites people to join.
6. **`04-ask-wavelength` labels the meter "SENT WORDS 5 / 12"** while the dock reads "5 of 12 answered." Two nouns for one fact, and "sent words" is factually wrong — 5 of 12 *people* have sent words; the cloud later counts 61 words. Use "ANSWERED."
7. **The `SPACE` hint and `Skip` button appear at Room density in every mockup**, contradicting §4.4 ("keyboard hints hidden") and §5.3 ("Table density only"). Decide which is right — I think showing them is fine and the spec is over-strict — but the spec and the mockups must agree before an implementer reads both.
8. **Vertical rhythm is inconsistent across states.** ASK centers `.content` while the meter is top-aligned, so the two columns share no horizon; RESULTS top-aligns both and looks measurably better for it. Pick one. The centered variant is what produces the "under-filled" reading on `04` and `14`.
9. **The lobby QR is 247px at 1280×720**, below the 300px minimum §5.1 states. Also, the lobby's event title now lives only in the 20px rail; §2.2 said the lobby title is the one place the event title belongs, at hero scale. The lobby is the moment people most need confirmation they are in the right session, and it currently states the session name at 8 arcminutes.
10. **No focus styles, no ARIA, no `prefers-reduced-motion` anywhere in the mockups.** The motion rule is in the spec (§6.14) and is correct; it just isn't demonstrated. Focus matters more than it looks: at Table density the host drives this by keyboard, `.btn` sets `border:0`, and the default UA focus ring on `#0F1A2E` is thin. Add a 2px `--primary` focus ring, and define focus management for the Console drawer (trap, restore on close).
11. **Completion is now only signalled by two colour changes** (dock status → `--success`, meter bar → `--success`). Deleting the full-screen "All Players Have Answered!" alert was correct — but that alert was also the peripheral cue that let a host who was *talking to the room* know it was time to move. Consider a brief non-modal pulse on the dock status, or let the primary button change state visibly. The spec's own argument in §6.14 (a room that misses the beat stalls) applies to the host too.
12. **`.stage` uses `width: 100vw`.** On any platform where a classic scrollbar can appear this overflows by the gutter width. `100%` is safer and equivalent here.

---

## 4. What is genuinely good — do not break these

1. **The diagnosis.** §1 identifies one cause behind three symptoms and proves it from the CSS. §2's element inventory with ROOM / OPERATOR / REDUNDANT / CUT verdicts is the right instrument, applied honestly, and §2.8's "the room is told how many people have answered in five places at once" is the sentence that earns the whole redesign. Keep the inventory as a living document.
2. **Approach C is the right answer, and §3 earns it.** Separating the two audiences *temporally* rather than spatially is the correct insight, and the observation that the mode-reset `useEffect` makes Big Screen "not a mode, a trap" is the kind of specific, disqualifying evidence that should decide architecture decisions and rarely does.
3. **The dock as a grid row rather than `position: fixed`.** "`fixed` guarantees the control is visible; a grid row guarantees it is *placed*" is exactly right and is the most durable idea in the document. (Which is why B3 — the Console covering it — is so painful; fix that and this holds.)
4. **`07-results-trivia` is the best screen in the set.** Letting the correct row carry the headline weight instead of restating the answer above the list is a real piece of design judgement, and the note in §6.9 explaining why the earlier draft was wrong is the kind of reasoning that should survive into the code comments. The distribution reads as one object. Don't touch it except to add the question recap.
5. **`16-phase-wipe`.** Unmissable, well-typed, right duration ballpark, and the §6.14 argument for why four simultaneous signals is not redundancy here is correct and well distinguished from §7.4. This is the strongest answer to the phase-legibility problem and should be the model for fixing B9.
6. **`03-ask-trivia` at 1920 and `10-ended`.** Confident, legible, correctly hierarchised. The amber letter badges give the room a scan target; the podium reads instantly. These are the proof that the system works when the content fits.
7. **The dot matrix.** Forty dots at `1.5vh + 8px` genuinely reads from the back row and is a better answer than forty names. This is the single best reduction in the spec.
8. **Colour discipline and contrast.** Measured against the Warm Summit tokens: `--text` 14.97:1, `--primary` 8.86:1, `--success` 6.66:1, `--muted` 7.24:1 on `--bg`; ~10.5 / 6.2 / 4.7 / 5.1 under the spec's own black-lift model. All pass WCAG AA at their sanctioned sizes, and the spec's lift table is *more* conservative than a straight measurement — good instinct. "Never colour alone" is genuinely honoured: the correct answer carries teal + 2px border + a `CORRECT` word-flag, and the dots differ in fill as well as hue. The Call-density reasoning about hairlines and gradients under video compression is a level of specificity most specs never reach.
9. **§7's eleven negative constraints.** Framing the design as a list of things it must never do — each testable — is the right way to hand this to an implementer, and §7.10 ("a reduction with no recovery is a deletion") is a rule worth keeping permanently. The irony of this critique is that most of the blockers above are §7 violations found by taking §7 seriously.
10. **ENDED as a first-class state**, and deleting the `showConfirmation` end-of-game flow. §2.7 finds a real bug (decline the dialog and the game never reaches `ENDED`) and removes it by construction rather than patching it. That is the right shape of fix.

---

## 5. What I could not assess

- **The real fonts.** The mockups fall back to system faces by design (`index.html` footer says so). Production self-hosts **Archivo Expanded**, which is materially wider. Every width-sensitive claim in this review and in the spec — the 26ch/44ch measures, the rail's no-wrap promise, button widths, the two-line option clamp, the podium name ellipses — is measured against the wrong metrics, and the direction of error is always *worse*. B4 in particular is likely to be worse than I have described. Nothing here is trustworthy until the mockups are re-rendered with the production faces.
- **The actual projector.** I measured pixels and computed arcminutes; I did not stand 25 feet from a lit conference room. The black-lift model in §4.3 is a reasonable assumption, not a measurement. Somebody should put `03-ask-trivia` and `07-results-trivia` on the real hardware, in the real ambient light, and read them from the back wall. That single test is worth more than this entire document.
- **Video-call rendering.** I could not encode these through Zoom or Teams. The reasoning about hairlines and gradient banding is sound in principle, but "2px and flat" is a hypothesis until somebody screen-shares `13-density-call` and looks at it on a laptop over a real connection — which, given B2, is currently impossible because that page is not rendering Call density at all.
- **Motion and timing.** Static HTML. The 700ms wipe, the 8-second auto-page, the reduced-motion hold, the transition between states, and whether the auto-pager fights a host who is mid-sentence are all unassessable here. The 8-second VOTE rotation in particular needs a live test: a page that changes under a room mid-read is a known irritant, and 8 seconds for six truncated answers is aggressive.
- **The live product.** I reviewed the spec's characterisation of `GameHostPage.jsx`, `hostControls.js` and `HostActionBar.jsx` rather than the files themselves, and I did not verify the line references in §2. The spec's account is internally consistent and specific enough that I am inclined to trust it, but the claim that `hostControls.js` and `HostActionBar.jsx` "survive nearly intact" is an assertion I did not test.
- **Whether hosts will actually find the Console.** B3 is my judgement, not evidence. The cheapest way to settle it is to put a host in front of `01-lobby.html` with no instructions and ask them to change the question set. I would expect a 0% success rate, but I would rather be shown than believe myself.
- **A note on the working tree.** `src/src/GameHostPage.jsx` and `lambda-functions/websocket/start-vote.js` show as modified, and `tests/vote-state-broadcast.js` as untracked, though the branch was clean at the start of this review. Those changes are not mine — I did not touch `src/` or `lambda-functions/` — but somebody should confirm what they are before this work starts.

---

# Re-review

**Reviewer:** same design critique pass, second look
**Date:** 2026-08-09
**Under review:** revision 5 of the spec (§10–§11) and the 21 mockups, plus `audit.js` / `audit.html`
**Method:** an independent harness (my own, not `audit.js`) rendered 19 stage mockups at 4 profiles × 2 viewports = 152 renders, measuring every truncating leaf element on the stage and in the dock, the unused space in every `.content` box, the reduction state (`--fit`, `data-clamped`, hidden `[data-drop]`, `main.solo`), rail slack, and the primary action's hit test. Then targeted experiments on the live pages at true 1280×720 and 1920×1080, including forcing alternative fitter states to test whether a better presentation was available.

---

## 1. Verdict

**Approve with required changes.**

This is a much better artifact than the one I reviewed three days ago, and the improvement is not cosmetic — the two failures that made revision 1 unimplementable are genuinely gone, and I verified both rather than taking the changelog's word for it. Across 152 renders **not one element of room-facing body content is abbreviated**: no clamped trivia option, no cut answer card, no truncated recap, no clipped Field Notes prompt, at any profile, at either viewport. That is the single hardest thing in this project and it is done.

The required changes are far fewer and narrower than last time. But one of them is a hard regression that round 5 introduced and nobody caught, and it is visible in a room: **pressing "Reveal who wrote these" at 1280×720 deletes two of the three answers from the screen.** `06-results-call-and-answer` shows three cards; `21-results-revealed` — the same round, one press later — shows one, keeps a 233px standings column, and leaves 117px of the content box empty. The reveal beat is specified as the moment the screen "visibly delivers something." At the second of the two mandated viewports it visibly takes two thirds of the content away.

That defect and the four others below are mechanical, not structural. The strategy is still right, the fitter is now real, and the anonymity reasoning in §5.6 is the best new thinking in the document. Fix the lever order, the selector list, the rail drop order and three lines of copy, and this ships.

---

## 2. The original nine blockers, verified

| | Issue | Status |
|---|---|---|
| B1 | Silent bidirectional decapitation; no content budget | **Resolved** |
| B2 | `--k` a no-op; floor contradiction | **Resolved in the tokens; inverted in the rendering** |
| B3 | Console covers the primary, kills the keyboard, invisible in 15/16 | **Resolved** |
| B4 | Rail clips mid-word; inert `text-overflow` | **Partially resolved** |
| B5 | Field Notes overflows at the reference resolution | **Resolved** |
| B6 | Wavelength RESULTS not designed | **Resolved** |
| B7 | Two RESULTS states omit the question | **Resolved, and extended to VOTE** |
| B8 | VOTE shows six half-sentences | **Resolved at 1920; regressed at 1280** |
| B9 | Phase legibility rests on a 20px pill | **Resolved** |

### B1 — resolved

`.content` is `flex-start` with `margin-block: auto` on the child, so overflow can only appear at the bottom. The base-stylesheet clamps are gone; the clamps that remain are gated behind `.content[data-clamped]`, which the fitter applies only as a terminal state. I confirmed the fix generalises rather than being local to `03-ask-trivia`: measuring every clamped-or-ellipsised leaf under `.stage` across `02`, `03`, `05`, `06`, `07`, `09`, `15`, `21` and eleven others, at four profiles and two viewports, the only truncations anywhere are `.rail-title`, `.dock .status`, and one stat-card name on `10-ended` — all chrome, none content. Unused space in `.content` at Room/TV/Call is 0–47px on the dense states, against 131px before. `09-field-notes` — the state whose entire justification was that it fits — fits at all eight configurations.

The inverse failure the changelog says it hit and fixed (over-reduction leaving large gaps) is fixed for Room, TV and Call. It is **not** fixed for Table, and it is not fixed at 1280 — see N1 and §5.

### B2 — resolved in the tokens, inverted in the rendering

The four literal ladders on the root element work. Measured on `03-ask-trivia` at 1920×1080:

| | Room | TV | Call | Table |
|---|---|---|---|---|
| phase chip | 20.5px | 26.0px | 20.5px | 16.2px |
| primary button | 33.6px | 43.5px | 33.6px | 23.6px |
| declared `--floor` | 20px | 26px | 20px | 16px |
| hairline | 1px | 1px | **2px** | 1px |
| field | photo | photo | **flat** | photo |
| phase bar | 8px | 12px | 10px | 5px |

That is a real parameter where a no-op used to be, and the four-ladder replacement for `--k` is the right shape.

**But the room reads content, not chrome, and after the fitter the profile inverts on the states that matter.** Measured, same viewport, `.card .ans` / `.q`:

| state | Room | TV | Call |
|---|---|---|---|
| `05-vote` answer text | 30.2px | **26.8px** | 30.2px |
| `06-results` answer text | 30.2px | **27.7px** | 30.2px |
| `03-ask-trivia` question | 59.2px | 58.8px | **55.6px** |
| `03-ask-trivia` option | 39.1px | 38.2px | **36.7px** |
| `02-ask` question | 69.2px | 73.9px | **65.4px** |

TV's ladder is ~32% above Room's at the token level and the fitter spends all of it: `--fit` lands at 0.71–0.74 on the dense states, so TV renders content at Room's size on trivia and **smaller than Room** on VOTE and RESULTS. The TV profile exists because Room's type is under the comfort band on a 65-inch panel. On the two states with the most text, it delivers less than Room does. §4.4 anticipates "less content fits" as the intended consequence; what actually happens is that nothing is dropped and the type is simply scaled back to — or below — the ladder TV was invented to escape.

Call is the same story from the other direction: the tokens are Room's verbatim, as designed, but `--measure: 24ch` forces more lines, the fitter compensates, and Call renders 6% *smaller* than Room on every content-heavy state I measured. The encoder argument in §4.2 is correct and the implementation contradicts it.

### B3 — resolved

Verified rather than assumed. At 1920×1080 the Console's bottom edge is at y=940 and the dock's top edge is at y=940; at 1280×720, 626 and 626. `document.elementFromPoint` at the primary button's centre returns the button itself on `11-console` and on `18-question-browser`, at both viewports. `⋯ SETUP` measures **124×48**, meets the target minimum, and carries the word. No email address, no "Big Screen", no "Names in the Console", no "Workie" appears in the body of any of the 21 files — I grepped all of them after stripping scripts and comments. The apology caption is gone. This one is fully closed, and the resolution in §5.4 (split the surface by what the information *is*, rather than writing a better caption) is better than the fix I asked for.

### B4 — partially resolved

The ellipsis now renders: `.rail-title` is a single text node, `display:block`, `min-width:0`, and A7 exists to stop it regressing. Good.

Two things are not fixed, and one of them is new.

**The declared shrink order is implemented backwards, and it can drop the session code.** §5.1 says: "drop the **event title** first, then the word 'JOIN', then the join **URL**, always keeping the session code and the round context." The markup says:

```html
<span class="rail-title" data-drop="4">…</span>
<div class="rail-join" data-drop="3">
  <span data-drop="2">JOIN</span>
  <span data-drop="1">eng.seibtribe.us/play</span>
  <code>4821</code>
</div>
```

`dropGroups()` sorts ascending and drops lowest first. So the order is URL → "JOIN" → **the entire join block including `<code>4821</code>`** → title. The one element the spec promises can never go is third in line, and the one it promises goes first is last. Every stage file carries the same inversion.

**The rail's ordered sacrifice is dead code anyway.** `fitChrome()` only acts when `overAny(rail)` is true, and the rail can never overflow because `.rail-title{flex:0 1 auto}` absorbs all the pressure by shrinking. So the drop mechanism never fires; the title just gets smaller and smaller. Measured, `.rail-title` visible fraction of its own content:

| state | 1920 Room | 1280 Room |
|---|---|---|
| `01-lobby` | 62% (471/765px) | 42% |
| `03-ask-trivia` | 62% | **14%** (101/747px) |
| `09-field-notes` | 62% | **7%** (50/747px) |
| `05-vote` | 62% | 22% |

At 1280 the event title is rendered as "Q3 Le…" — visual noise where the spec's own mechanism would have removed it cleanly. And at 1920 the 34ch cap fires while the rail has 395–615px of unused width. That is a reduction firing while space is free — the exact class of bug revision 3 was written to eliminate, reproduced on the horizontal axis where nothing checks for it.

### B5, B6, B7, B9 — resolved

`09-field-notes`: the `ch`-on-a-container unit error is gone, two-column at ≥1600, and it fits everywhere at Room/TV/Call. `08-results-wavelength`: ranked weighted flow, "60 distinct · showing the top 16" on screen, "All 60 terms in the session report" below, one amber accent. `06` and `07` both carry the recap, and `05-vote` inherited it — which I did not ask for and which is right. `10-ended` no longer states the champion twice and no longer invites people to join a finished session. The phase bar is real: 8/12/10/5px by profile, four distinct hues, COMPLETE a doubled striped amber band. The dot matrix is gone from every file; the Table roster keeps names and ticks.

`16-phase-wipe` is untouched, which is correct.

### B8 — resolved at 1920, regressed at 1280

Three full-width cards at four lines, leader fill capped, at 1920 in all four profiles, with no truncation. That is the fix.

At 1280×720 in Room, TV and Call, `05-vote` renders **one card**. See N1.

---

## 3. The rebuttals

I asked to be judged on the merits rather than on agreement, so here it is.

**1. The clicker should not summon the Console — the designer is right.** The argument that a host twenty feet from the laptop cannot read a 15px drawer, and that a clicker-summoned Console is therefore a panel you can open and not use while the room watches, is correct and I did not think it through. `Left`/`PageUp` as step-back is the right second verb and completes the set. Fully accepted; my original recommendation was worse than what shipped.

**2. The 20px floor is angular, and Table's 16px is more generous — the designer is right, and states it better than I did.** I framed §4.4 and §7.7 as "mutually exclusive as written." They were not; I had reified a projection as the rule. 16px at ~120 ppi and three feet subtends ~9.0′ against the Room floor's ~8.3′ at 25 feet, so Table is the *stricter* of the two. Restating §7.7 in angular terms with four enforceable pixel projections is the correct resolution and is better than the "second explicit ladder" I proposed, because it explains *why* there are four rather than asserting that there should be. Fully accepted.

**3. The question browser shows no correct answers at all — the designer is right, and this is the strongest new reasoning in the document.** "There is no display profile in which the stage is unobserved" is a genuine invariant, not a rationalisation, and it correctly kills the mask-with-reveal middle option as a trap rather than a feature. Generalising it into *anything whose value depends on the room not seeing it does not exist on the stage; it lives on the remote* — and then, in §5.6.2, finding that the rule needed a second clause and adding it rather than bending the first — is the kind of move that makes a spec worth inheriting. Fully accepted.

**4. How-to-play belongs on the stage as a lobby beat — the designer is right.** §2.1 observed that the instructions are addressed to players and concluded they should be hidden from players. That was a non sequitur and catching it is good self-editing. Forty-seven words, four lines, tips cut, an action rather than a document in the Console. Accepted — with one addition under N4: this is the natural place to tell the room that responses are anonymous, and it does not.

**5. Call keeps Room's type and changes only treatment — the designer is right in principle and has not delivered it.** The encoder argument is sound: a 20px glyph downscaled 1920→1280 and re-encoded arrives as ~13px of artefacts, and shrinking for Call would compound the loss. I accept the reasoning entirely. But the tighter 24ch measure means Call renders 6% below Room on every content-heavy state (see B2), so the profile that must not shrink is the one that shrinks most. This is not a disagreement about the argument; it is that the argument has not reached the pixels. A5 cannot see it because A5 measures chrome.

---

## 4. New blocking issues

### N1. The reveal beat deletes two of the three answers, and the fitter pulls its levers in the order its own spec forbids

**Measured on the live page at 1280×720, Room profile.**

| | `06-results` (anonymous) | `21-results-revealed` |
|---|---|---|
| answer cards shown | **3** | **1** |
| meter column | dropped (`main.solo`) | **kept, 233px** |
| unused space in `.content` | 14px of 511 | **117px of 511** |
| on-screen note | — | "3rd place · 2nd place — in the session report" |

So the pre-reveal screen shows three answers, and the screen one press later — same round, same data, plus three author lines — shows one, while a standings column and a fifth of the content box sit unused beside it. §5.6.4 says "the reveal visibly delivers something, which is the right shape for a beat that costs a press." At the second mandated viewport it visibly removes two thirds of the content.

**The root cause is a lever-order inversion, and it is general — it is not specific to the reveal.** §4.2b states the rule twice and attributes it to all three evaluators:

> **Chrome is sacrificed before content, always.** The meter is chrome; its column is taken before a word is cut.

`fitContent()` does the opposite:

```js
if (searchScale(box, clean)) return;
… dropGroups(box) …          // drops CONTENT: the 2nd and 3rd answer cards
if (widen(box)) …            // only now takes the meter's column
box.dataset.clamped = 'on';  // terminal
```

`data-drop="2"` and `data-drop="3"` on `05-vote`, `06` and `21` are the third-place and second-place answer cards. They are dropped *before* `widen()` is ever reached. The stated control flow and the implemented control flow disagree, and the disagreement costs the room an answer.

**I verified a better presentation was available.** On the live `21-results-revealed` at 1280×720 I restored the dropped groups, took the meter's column, and re-ran the scale search by hand:

- 3 cards + meter taken, at every scale from 1.0 down to the floor: needs 665px in a 511px box. Genuinely does not fit — dropping one card is legitimate.
- **2 cards + pager and card 3 dropped + meter taken, at 0.9: needs 469px of 511. Fits, with 42px spare.**

So the correct landing is two answers and no meter. What ships is one answer and a meter. The same inversion produces the one-card `05-vote` at 1280 in Room, TV and Call.

**Required:** move `widen()` above `dropGroups()` in `fitContent()`, re-search, and only drop content if taking the meter's column still is not enough. Then re-render `05`, `06`, `21` and re-check `07`.

*Related, cheap:* on `05-vote` the drop announcement reads "3rd on this page · 2nd on this page — **in the session report**". They are not in the report; they are on page 2 of the ballot. The `announce()` suffix is hardcoded and is wrong for VOTE.

### N2. The dock status line — room-facing copy by the design's own definition — is abbreviated

`.dock .status` sets `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`, so A2 and A7 wave it through, and it is not in `CONTENT_SEL`, so A11 never looks at it. It is truncating today:

| state | profile / viewport | shown |
|---|---|---|
| `15-edge-minimum` "Nobody has answered yet — the join code is on the header" | TV @1920 | **67%** |
| `15-edge-minimum` | Room / TV / Call @1280 | **73–74%** |
| `21-results-revealed` "Results are on screen" | TV @1920 | **68%** → "Results are o…" |
| `06-results` "Ranked on merit — nobody knows whose is whose yet" | TV @1920 | 98% |

§5.3 makes the status line one of the two things the dock exists to carry, and §7.14 says room-facing content is never abbreviated. The status line is either content — in which case it must not be cut and belongs in `CONTENT_SEL` — or it is chrome, in which case §5.3 needs to stop describing it as the design's primary state signal. It cannot be both.

The `15-edge-minimum` case is the worst one, because it is the state a Chief of Staff named as her second-most-embarrassing scenario: nobody has answered, the primary is disabled, and the one sentence explaining what to do is cut off mid-word on a shared screen.

### N3. The rail drop order is inverted and can remove the session code

Covered under B4. Two mechanical fixes: renumber `data-drop` on the rail so the title goes first and the code is never in a dropped subtree, and either give `.rail-title` `flex:none` with a drop threshold or have `fitChrome()` measure the title's own overflow rather than the rail's, so the declared sacrifice can actually fire instead of the title decaying to 7%.

### N4. The anonymity guarantee is contradicted by its own screens, absent where it would change behaviour, and set below the readable floor

This is the new feature and the reason for round 5, so it deserves the same scrutiny as the rest.

**a) Two adjacent screens state different rules.** `05-vote` kicker: *"answers are anonymous until the vote closes."* `06-results` kicker, one beat later, after the vote has closed: *"still anonymous."* Under §5.6.4 anonymity ends when the host presses Reveal, not when voting closes — and §5.6.7 explicitly contemplates a host who never reveals at all. The VOTE screen therefore states a rule the product does not implement, and it undercuts the reveal beat: if the room was told anonymity expires at the close of voting, the press that ends it reads as ceremony.

**b) It is stated at 20.5px in `--secondary`.** The only room-facing anonymity statement during VOTE renders at 20.52px — the Room floor, ~8.3 arcminutes at 25 feet. §5.1's own argument for replacing the phase chip with a band is that 20px at that distance is "recognisable as a coloured blob, not readable." The guarantee that is supposed to change how forty people vote is set at the one size this document has already ruled unreadable from the back row.

**c) It is absent at ASK.** `02-ask-call-and-answer` — the screen up while people compose their answers — says nothing about anonymity. Neither does `19-how-to-play`, the lobby beat whose entire job is to tell the room how this works. A participant learns their answer is unattributed *after* they have written it. The stated purpose is vote bias, so VOTE is the necessary place; but candour at composition time is the larger behavioural effect and the design gets it for free by moving one line earlier.

**d) The distinctive half of the promise is never made to the room.** §5.6.2's hard-won ruling is that *nobody* sees authorship, host included, and §5.6.2's own third justification is "it is a promise made in public." The room is told "anonymous." It is never told "not even the host" — that sentence appears only on `20-setup` (host-only, pre-session) and on `17-remote` (host-only). From the room's seat this is indistinguishable from every other tool's anonymity, which means hidden from peers and visible to whoever is driving. The strongest thing about this feature is invisible to the people it is for.

**e) One state does imply anonymity it does not deliver, in the other direction.** `21-results-revealed` shows the full standings — "Priya Raghavan 1,240, Wes Duncan 980, Aisha Bello 870…" — beside three attributed cards reading "+200 / +140 / +80 pts". That is correct post-reveal. But the same standings block is what §5.6.4 identifies as attribution by arithmetic, and nothing on `21` marks the standings as newly unfrozen. A room that saw no meter on `06` and a full leaderboard on `21` has no explanation for where it came from. A one-line kicker on the meter ("standings updated at the reveal") closes it.

*Copy drift, low severity:* the `20-setup` preview promises "Priya Raghavan · **+180 pts**"; `21-results-revealed` delivers "+200 pts".

### N5. §7.2 is now violated by the design's own Console

§7.2: *"The room must never see operator chrome. No email address, no 'Sign Out', no category counts, no unasked questions with their correct answers…"*

`11-console.html`, on a panel §5.4 now declares deliberately and honestly non-private, and therefore projected: **"Pricing Power — 7 left · on", "Competitive Response — 9 left · on", "Packaging — 6 left · on", "Discount Discipline — 9 left · off"** and a **"Sign out"** button. Two of the four items §7.2 enumerates, shipped on the stage, by the design.

The email was deleted using exactly this argument. The other two survived it. Either §7.2's list is wrong — plausible; category counts really are harmless and "Sign out" is a word, not a secret — or the panel is. But a negative constraint that the design itself breaks is worse than no constraint, because it teaches the next implementer that §7 is decorative. Given that §7 is the best-designed part of this document, that is the expensive kind of inconsistency.

### N6. Regression sweep — drift across three rounds

Found by reading the spec against the mockups. None individually blocking; collectively they are the tell that §6 and §4.4 were not re-read after §5 and §11 changed.

1. **§4.4's profile table is stale in two rows.** "`SPACE` hint: hidden / hidden / hidden / **shown**" — §5.3 reverses this and the mockups show the hint in all four profiles (verified: 20.5 / 26 / 20.5 / 16.2px). "Roster: dots above 12 / dots above 8 / dots above 12" — §5.2 deletes the dot matrix and no mockup contains one.
2. **§6.3, §6.4, §6.5 still specify dock strings that §5.2/§5.3/§11.4 forbid.** "31 of 40 answered · waiting on Dana, Tomás, Jordan and 6 more" (§6.3) names people on the stage — §7.15. "All 40 answered" (§6.4) and "17 of 40 answered…" (§6.5) are counts, where §5.3 requires a judgement and A12 counts numerals. The mockups do the right thing ("Some are still answering", "Safe to move on"); the spec still tells an implementer to do the wrong one.
3. **§6.3 sanctions a 6-line clamp on the question**, which §4.2b and A11 treat as a budget failure. Reconcile the wording; as written, §6.3 instructs an implementer to build a state the audit is designed to fail.
4. **§8's assertion table still says "Nine assertions"** and lists A1–A9. A10, A11 and A12 — the three that caught the worst defect in the project — are missing from the table an implementer will port from. The failure-count table above it is also still 16 pages / 128 checks.
5. **`10-ended`: "Aleksandra Wiś…"** — the "Most-backed contributor" name is truncated to 58–60% at 1920 in every profile, and 81–85% at 1280. One human name on the terminal screen of a four-hour session, cut in half.
6. **`15-edge-minimum`** offers a "Show join code" secondary while its own status line says "the join code is on the header" and the rail shows `JOIN eng.seibtribe.us/play · 4821`. Three statements, one fact, on the state that has the least to say.
7. **`18-question-browser`** lists row 13 — verbatim the question the stage behind it is currently asking — as unasked, with an `Ask next` button.

---

## 5. The audit's remaining blind spot

The structural point stands and is worth restating: **this audit is written by the agent whose work it certifies, and its checks are shaped like "is the fitter's own choice self-consistent?" rather than "is this the best presentation available?"** Every new check in revision 3 has that shape, and it is why the suite reports 168/0 on a build where the reveal beat throws away two answers.

Concretely, five gaps, in descending order of what they cost:

**1. A10 asks whether space was exhausted *given the reduction the fitter chose*. It never asks whether a cheaper reduction was available.** The tolerance is derived from the height of the group that *was* dropped — `eps = max(32, biggest line × 1.15, smallestStep)` — so dropping a large thing always licenses leaving a large gap. On `21-results-revealed` at 1280, two answer cards were dropped and 117px left unused; because a card is ~117px tall, epsilon swallows it and A10 passes. The check therefore cannot distinguish *out of levers* from *levers pulled in the wrong order*, which is the same defect it was written to catch, one abstraction level up. **The fix is an oracle rather than a tolerance:** enumerate the legal states (drop-count × solo × scale) and assert that the chosen one maximises content shown. It is about thirty lines and it would have caught N1 on the first run.

**2. A10 does not run at all when no reduction fired**, so a state that simply under-fills is invisible to it. Unused space in `.content` with no reduction of any kind, at 1920×1080:

| state | Table | Room |
|---|---|---|
| `09-field-notes` | **312px of 828 (38%)** | 116px |
| `05-vote` | 280px (34%) | 13px |
| `04-ask-wavelength` | 253px (31%) | 183px |
| `01-lobby` | 244px (29%) | 194px |
| `21-results-revealed` | 210px (25%) | −1px |

The evaluator complaint that `04-ask-wavelength` was "60% empty… a layout that gave up" was never about a reduction — it was under-filling — and A10 as written could not have caught it either. `data-grow` is the intended answer and it is not reaching these states at Table.

**3. "Room-facing content" is a hardcoded selector string**, so abbreviation is policed only where the designer already thought to look. `CONTENT_SEL` omits `.dock .status`, `.rail-title`, `.kicker`, `.pager`, `.pod .nm` and the `10-ended` stat names — and three of those are demonstrably truncating today (N2, B4, N6.5). The comment says chrome is excluded "on purpose," which is defensible for a podium name and indefensible for the dock's one status sentence. An allowlist of what may truncate is safer than an allowlist of what may not: invert it, and every new element is protected by default.

**4. A5 measures chrome specifically because the fitter cannot touch it** — a documented, deliberate choice, with a good-sounding reason ("content sizes are post-fit… making a working parameter look broken"). But the room reads content. A5 can therefore only ever prove that the *tokens* differ, never that the *room* sees a difference, and on the dense states the difference is zero or negative (TV answer text 26.8px against Room's 30.2px on `05-vote`). The check was written to stop "Call = Room" decaying into "Call does not exist"; it now passes while TV has quietly decayed into Room-or-worse. A5 needs a second clause that measures rendered content and fails when a larger profile renders smaller than a smaller one.

**5. A10/A11 only look inside `.content`.** The rail is subject to the identical rule on the horizontal axis — a declared reduction firing with 395–615px of free width — and nothing checks it. `fitChrome()` has the same "reduction while space unused" pathology and no assertion covers it.

One thing to keep: the discipline of demonstrating each new check failing against `_baseline/` and `_prev/` before trusting it is exactly right, and the honesty of §11.2's two recorded traps (sub-pixel line-height, and the meter clipping itself) is the kind of note that saves the next person a day.

---

## 6. Craft

**At twenty-five feet, yes — this now reads as a designed product.** `03-ask-trivia` at 1920 renders six complete options in a 2×3 grid at 39px with a four-line question above them and no ellipsis anywhere; that is the screen the VP said would embarrass her, and it no longer would. `07-results-trivia` is still the best thing in the set. `08-results-wavelength` went from twelve hand-placed spans to a frequency-ordered flow that states its own reduction, which is a real piece of design thinking rather than a patch. The phase bar is the right answer to B9 and costs almost nothing. The meter is sized to its content, so the unfinished-grid tell is gone. `10-ended` leading with what the room decided rather than a leaderboard is the single best judgement call in revision 3, and it came from taking a reviewer seriously rather than from the spec's own logic.

**On a laptop, not yet.** Table is systematically under-filled — up to 38% of the content box empty with no reduction firing — which reads as a layout that stopped rather than one that landed. That is the same criticism the evaluators made of `04-ask-wavelength`, moved to a different profile.

**At 1280×720 it still reads as patched, and that is where the remaining work is.** One answer card on VOTE and on the reveal; the event title decayed to "Q3 Le…"; the dock status cut mid-word on three states. 1280 is not an edge case — it is the second of the two viewports the brief pins and the resolution a great many projectors actually run at.

The overall shape is now one system rather than four rounds of repair. The fitter is a real mechanism with a stated invariant; the four ladders are a real parameter; the rule *anything whose value depends on the room not seeing it does not exist on the stage* is a genuine architectural principle that was discovered rather than asserted, and it survived contact with a feature it was not designed for. What is left is one wrong line in `fitContent()`, one selector list, one set of `data-drop` numbers, and four sentences of copy.

**The single most important thing still wrong:** the fitter sacrifices content before it sacrifices chrome, in direct contradiction of the rule §4.2b states twice — and the most visible symptom is that pressing "Reveal who wrote these" at 1280×720 takes two of the three answers off the screen.
