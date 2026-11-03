# The console's left rail, closed and open

Design only, 3 Nov 2026. No application code changed. Mockup: `index.html`
(render with `node docs/design/console-rail/shoot.js`, which also checks the 12px floor
and overflow). Reviews and the revisions they produced: `reviews.md`.

The owner, 3 Nov, verbatim:

> "review the 2 screen view and what data could be in the left bar including when a section
> is closed. Just an idea but may not be right is the players could have 5/6 answered or 1 of
> 4 voted. And alerts like a player attention ! Or the player alert bar does is flash/fade in
> and have an orange color or if all have answered 6/6 turn that box orange or whatever theme
> is applied. And should scores always show next to the player lists?"

Scope: the **two-screen** console only. On one screen the laptop is the room's screen and
the People column is not drawn (PLAN §3.3 table; `HostConsole.jsx:99` `noRail`), so
everything here is private.

## The answer, in five lines

1. **Every closed header says one useful thing the rest of the screen does not.** People
   closed says **who** is still out ("6 here · waiting on Marcus"), never the count, which
   tile 1 already says at 30px in the same viewport.
2. **Someone needs you while People is closed:** the header wears the Needs-you line's own
   amber edge and wash with the person's name. Same look, same moment, same single 240ms
   fade: one alarm in two places, not two alarms.
3. **Everyone's in is celebrated once, on tile 1**, which already turns green. It settles
   from blue to the theme's success colour once (600ms). Not orange: orange means "needs you".
4. **Scores always show in scored formats** (Call & Answer, Trivia), muted while the room
   answers or votes, in text colour at Results. Never in Poll, Wavelength or Survey.
5. **The rail's person rows become the shared PersonRow, at a compact density**: the
   status as a glyph (✓ / …) so a name gets ~170px instead of ~90px.

## PNGs

| | |
|---|---|
| `1-answering-people-open.png` | Answering, People open. Carets, "6 here", glyph status, muted scores. |
| `2-answering-people-closed.png` | Answering, People closed: "6 here · waiting on Marcus"; Round queue open; Late as a Soon dot. |
| `3-voting.png` | Voting, 1 of 4: ✓ voted / … not yet. |
| `4-everyones-in.png` | Tile 1 green; the People header's waiting clause simply leaves. |
| `5-needs-you-people-closed.png` | Sam asks; the line, the bell and the closed People header, one look. |
| `6-results-scores.png` | Trivia results: ✓/✗ before the score, scores in text colour, Show scoreboard. |
| `7-headers-every-moment.png` | Every section's closed header in every moment; Present skin; the one motion. |
| `8-person-row-by-format.png` | The row by format and phase: when a score shows; the compact rail density; names lagging the count. |

---

## 1. What ships today (read from the code)

| Fact | Where |
|---|---|
| Three sections: Round queue, People, Late & not reviewed. No fourth. | `config/consoleRail.js:9`, `ConsoleRail.jsx:204-206` |
| A section is a `<details>` whose `open` React owns; one section open at a time. | `ConsoleRail.jsx:24-34`, `:74-76` |
| The section that matters opens by itself on a moment change (Answering/Voting → People; Read → Late; Lobby/Ended → Queue); the host's click holds until the moment changes. | `consoleRail.js:11-27`, `ConsoleRail.jsx:75` |
| **Headers show the same summary open or closed.** Queue: "2 of 21". People: "N here". Late: the bare count, "0" when empty. | `ConsoleRail.jsx:88`, `:111`, `:183`; `consoleRail.js:34-36` |
| **No disclosure mark.** The native marker is hidden and nothing replaces it, so a header gives no sign it opens or which state it is in. | `HostConsole.css:62-63` |
| People's count of answered/voted was moved off the header on purpose ("the count leaves the People header", session-start D3); the pulse owns it. | `consoleRail.js:29-36`, `consolePulse.js:16-18`, `:229-239` |
| Tile 1 already shows "Answered 5 of 6" with a bar, and "✓ Everyone's in" with a green edge, green bar and success-text sub; `aria-live="polite"` on the sub. No animation. | `ConsolePulse.jsx:270-279`, `ConsolePulse.css:87-96` |
| Person rows in the rail are **not** `PersonRow`: the rail draws its own `<li>` (mark glyph · name · " · answered" · fact). `PersonRow` is used by the Session menu's People view and the Build Room. | `ConsoleRail.jsx:16-17`, `:143-161`; `components/stage/SessionPeople.jsx` |
| Scores: C&A and Trivia carry the running score; Trivia adds ✓/✗ after the reveal; others none. | `consoleRail.js:60-88` |
| While anyone asks for their name, People is **forced open and its header click does nothing**; the header says "1 needs you" in accent text. | `ConsoleRail.jsx:81`, `:111-114` |
| Late's header goes accent-coloured for **any** waiting item. | `ConsoleRail.jsx:183`, `HostConsole.css:65` |
| On a hidden round where names lag the count, `waitingRoster` returns null and the rail draws **no rows at all**. | `consoleRail.js:101-110` |
| The Needs-you line: fixed 56px, amber edge + 8% warn wash on `is-now`; no animation. | `NeedsYou.css:33-51`, `NeedsYouLine.jsx:24-33` |
| The skins: Classic's `--accent` is orange, **Present's is periwinkle**; `--warn` is amber and `--success` green in both. | `styles/skins/classic.css:43,63,70`; `present.css:31,51,57,75` |

Three of these are defects in their own right, independent of the owner's question: no
disclosure mark; a header that is a focusable button doing nothing (a dead control, hard
rule 2) while someone asks; Late lit amber for a *Soon* item (PLAN §4.1 says Soon is a dot,
never amber).

---

## 2. Decisions

### D1. A closed header says one thing worth reading, never a fact on screen already

Hard rule 5 (one fact, once per viewport) is the governing rule. The pulse sits in the
centre column of the same viewport at all times on two screens, so whatever it says, the
rail does not repeat. What the pulse cannot say is **who**; that is the rail's job closed
as well as open ("the tile keeps the number, the People column keeps the names",
`ConsolePulse.jsx:231-232`).

| Section | Open header | Closed header adds | Never |
|---|---|---|---|
| **Round queue** | "2 of 21" | "· next: Pricing for the EU launch" (truncates, `title=` has it whole). Lobby: "21 rounds · first: …". Ended: "12 of 12 · done". | "next" while open: the list below says it. |
| **People**, answering/voting | "6 here" | "· waiting on Marcus"; two names in full; three to 12 "Marcus, Ana +3"; past 12 "waiting on 14". Full list in the accessible name and `title=`. | "5/6 answered", "1 of 4 voted": tile 1's fact. |
| **People**, everyone's in | "6 here" | nothing: the waiting clause leaves. | "Everyone's in": tile 1's moment. |
| **People**, results (scored) | "6 here" | "· top: Priya, 40". Ended: "6 took part · top: Priya, 90". | A ranking: that is the scoreboard. |
| **People**, someone asks | — | "● Sam needs you · 6 here", the mark (D3). | Buttons: the Needs-you line has them. |
| **Late** | "2 to review" | the same, with a small accent dot (Soon). Empty: "none" in muted, never "0". | Amber text, edge or wash. |

"Waiting on" reads the same list the rows read (`waitingRoster`), so it can never disagree
with them; when the names lag the count it says nothing rather than something wrong.

### D2. A caret on every header

CaretRight closed, rotated 90° open, `--muted`, 12px, in a fixed first column so titles
align. The rotation is 120ms and off under reduced motion. The `<summary>` stays the
native control (already focusable, Enter/Space).

### D3. Attention in the rail is the mark, in the Needs-you line's own paint

When a Now item concerns a person (today: the name request, PLAN §4.2 row 1):

- **People open:** the asker's row lifts to the top, amber, with Let them / Not now in the
  row, as shipped.
- **People closed:** the header takes `border-left: 3px solid var(--accent)` and the 8%
  `--warn-rgb` wash over `--bg`, the same pair `.ny-line.is-now` and `.prow.is-asking` use,
  plus an 8px accent dot and the **name** in `--accent-text` ("Sam needs you"; two:
  "Sam, Ana need you"; three or more: "3 need you").
- **No more force-open-and-lock.** People opens **once** when a request arrives (it is a
  moment change, like the others in `OPENS`); the host may close it again and the header
  carries the mark. The header click always works.
- **Not a second alarm**: one item, one list, one look in three places (bell number,
  line, mark), which is PLAN §2 principle 1 and §4.3 word for word. The header has no
  buttons and no live region of its own (the line's `aria-live` already announces it; two
  would read it twice).
- Late remains **Soon**: a dot and "2 to review" in text colour. Lighting it amber taught
  hosts that amber means "whenever", which is exactly what §4.3 warns about.
- In the **Present** skin the edge, dot and name are periwinkle, because they are
  `--accent`/`--accent-text`; the wash stays the warn tint, as on the line today. Nothing
  here names a colour; it names a role.

### D4. One motion, once

The owner's "flash/fade in": **fade, never flash**.

- The line's amber state and the People header's mark fade in **together, once**: the
  edge, wash and dot go from transparent to full in 240ms ease-out. The words appear at
  once (only paint fades). Cleared: no fade-out, it simply goes calm.
- It runs when an item **arrives** (a new item id), not on every render or reconnect, and
  it never loops. A repeating flash would be a second alarm that never stops, the opposite of
  "calm when empty", and anything over three flashes a second is WCAG 2.3.1 territory.
- `prefers-reduced-motion: reduce` draws the end state immediately.
- Everyone's in uses the same shape on **tile 1 only**: border and a 10% success wash
  settle in over 600ms. stage.css already has the keyframe idea (`@keyframes land`,
  `styles/stage.css:1115`).

### D5. Everyone's in turns the theme's **success** colour, on the tile, not the rail

The owner offered "turn that box orange or whatever theme is applied". Recommended: the
theme's **success** role, and only on tile 1, which already does it (`ConsolePulse.css:87-96`);
this adds the one-shot settle and a faint wash. Orange is `--accent` in Classic, and
`--accent` in the console means "someone needs you": a 6/6 box in orange reads as a
problem from across the laptop. The rail's People header goes quiet ("6 here"): with
nobody to wait on, there is nothing to say.

### D6. Scores: always, in scored formats; quiet until they change

| Format | Answering / voting | Results / Scores step |
|---|---|---|
| Call & Answer | running score, `--muted` | running score, `--text` 700 |
| Trivia | running score, `--muted`; "–" before the first scored round | ✓/✗ then score, `--text` (shipped mark) |
| Poll, Wavelength | slot empty (no score exists) | slot empty |
| Survey | progress "6 of 9" (PLAN §3.2b), not a score | (no results phase) |
| Build Room | ideas given (PLAN §3.2b) | — |

Why always: the slot never empties and refills, so the columns never jump (PLAN §3.2b fixes
the slot); the host uses scores to talk ("Priya's on 40, Marcus, catch her"); the laptop
is private so there is no room-safety cost. Why muted mid-round: a score cannot change
until Results, so it should not compete with the ✓/… the host is scanning. The step to
`--text` at Results is a colour change, not motion.

### D7. Per-person status is a glyph in the rail, a word elsewhere

The rail adopts `PersonRow` (PLAN §3.2b, as the Session menu's view already does) with a
**compact density**: the doing-now slot is 20px and draws ✓ (answered/voted, `--success-text`)
or … (writing / answering / not yet, `--muted`), with the word as the glyph's
`aria-label` and `title`. Shape distinguishes them, not colour. Reason: at the shipped
slot widths (`PersonRow.css:30`, 92px + 64px + 32px) a 340px column leaves a name about
90px: "Priya Ra…", "Ana Lucí…" (drawn and seen while making frame 1). The full-width row
(Session menu, phone remote) keeps the words.

- The rows and the "waiting on" clause and tile 1 all read one list, so they always agree.
- **The full "waiting on" list is in the summary's accessible name**, not only `title=`
  (keyboard and screen-reader users never see a tooltip): `aria-label="People, 6 here,
  waiting on Marcus Webb, Ana Lucía Ortega and Lee Chen, collapsed"` (review A2).
- **Large rooms:** past 12 people still out, the clause says "waiting on 14" rather than
  two names and "+12"; a name list that long helps no one and the count is then the
  rail's only quick read of how far off the room is (review H2). This is the one place
  the rail states a number, and only above that threshold.
- **Rows never re-sort during a round** (the host finds Marcus where Marcus was), and not at
  Results either: ranking is the scoreboard's, one S away. The asker lift is the one move,
  and it is sanctioned (§3.2b).
- **When names lag the count**, keep the names and blank only the status (—), rather than
  drawing no rows (`consoleRail.js:110`). An empty People section mid-round reads as
  "everyone left".

---

## 3. Forks, with recommendations

| # | Fork | Options | Recommend |
|---|---|---|---|
| F1 | Count in the closed People header? | (a) "6 here · 5/6 answered" (owner's idea); (b) "6 here · waiting on Marcus" | **(b)**. (a) is tile 1's number again, smaller, in the same viewport (hard rule 5; D3 removed it once already). (b) is the fact only the rail has. Note: (b) carries the count implicitly when 1-2 are out. |
| F2 | Everyone's in colour | (a) accent/orange on the rail and tile; (b) success green on tile 1 only | **(b)**. Orange is the needs-you colour; good news must not look like a request. |
| F3 | Repeating flash vs one fade | (a) flash until handled; (b) one 240ms fade, then held | **(b)**. The held amber is the persistent signal; motion is only the arrival. |
| F4 | People when someone asks | (a) force open and lock (shipped); (b) open once, closable, header carries the mark | **(b)**. Removes a dead control; the mark survives closing. |
| F5 | Scores mid-round | (a) always; (b) only at Results; (c) never in the rail | **(a), muted mid-round.** (b) empties and refills a slot each round. |
| F6 | Status in the rail | (a) words in a 92px slot; (b) glyph, word as label | **(b)**, for the name's width. |
| F7 | Leader in the closed header at Results | (a) "top: Priya, 40"; (b) nothing | **(a)**, light: the one results fact the laptop shows nowhere else without S. Drop it if the owner reads it as ranking. |
| F8 | Count while the Session menu sheet covers the pulse | (a) the closed header carries "5 of 6" only while the sheet is open; (b) never | **(b)** for now: the sheet is a brief, set-once place. Revisit if hosts work in it mid-round. |

---

## 4. What is new, what moves, what goes

**New:** carets; closed-only summaries ("next:", "waiting on", "top:"); the People
header's Now mark; the one-shot fade on the line and the header; the 600ms settle and 10%
wash on tile 1; "none" for an empty Late; "–" for a not-yet-scored score; the compact
PersonRow density.

**Moves:** the rail's rows from hand-rolled `<li>` (`ConsoleRail.jsx:143-161`) to
`PersonRow`; the asker's buttons stay in the lifted row (as today) and in the line.

**Goes:** force-open-and-lock for People (`ConsoleRail.jsx:81,114`); Late's amber
(`is-alert` on a Soon item, `:183`); "0" as Late's empty summary; the empty People
section on a lagging hidden round.

**Unchanged:** which section opens per moment; the pulse's words and numbers; the bell;
the Needs-you line's words, height and buttons; Show scoreboard.

---

## 5. Implementation notes

- `config/consoleRail.js`: replace `peopleSummary` with `railSummaries({ moment, open,
  counts, waiting, asking, leader, nowRound, nextRound, total, late })` returning
  `{ queue, people, late }`, each `{ text, title, level: 'calm'|'soon'|'now' }`. Pure,
  so the one-fact rule is unit-testable: assert no closed summary matches the pulse's
  `COUNT_LEAD` (`consolePulse.js:239`) or "Everyone's in".
- `ConsoleRail.jsx` `Section`: pass `open` into the summary choice; render a caret
  (`Icon name="CaretRight"`); `data-level` on the summary for the paint; drop the no-op
  `onToggle` and the `askers.length > 0 ||` from `peopleOpen`; add `people` to the
  opens-by-itself path when the asker set grows (compare ids, as the fade does).
- Fade trigger: a `data-arrived` attribute set for one frame when the Now item ids gain a
  new id, shared by `NeedsYouLine` and the header so they start together.
  `@media (prefers-reduced-motion: reduce) { animation: none }`.
- People rows: `PersonRow` with a `density="rail"` prop (doing slot 20px, the glyph as `role="img"` with an `aria-label`, plus `title`);
  `PersonRow.css` grows `.prow--rail { grid-template-columns: 8px minmax(0,1fr) 20px 48px 28px }`.
- Contrast to add to `personRowPalette.test.js` / a new `consoleRailPalette.test.js`
  (composited on rail `--bg` #0F1A2E; Classic): `--text` 14.97, on the 8% warn wash 13.10;
  `--muted` 7.24 / 6.33; `--accent-text` 8.86 / 7.75 (Present #9CBEF0: 9.14 / 8.00);
  `--success-text` 9.30. All clear AA.
- Tests that will move: `consoleRail.test.js` (summaries), `consoleRailNeeds.test.jsx`
  (force-open goes), `consolePeopleScores.test.jsx`, `lateRailLine.test.js`
  (Late's summary text). No geometric assertions (hard rule 13).
- Help: `config/help/host-two-screens.js:320` (People) must describe the closed header
  and the mark; `:78` comment "People says N here" changes.

## 6. Contrast (measured, not eyeballed)

Script-composited on dusk: the 8% `--warn-rgb` wash over `--bg` for the lit header,
over `--surface` for the line; the 10% success wash over `--surface` for tile 1.
Lowest pairing on any new surface: `--muted` on the tile's success wash, 5.14:1.
