# Comments on the phone: make it obvious what each one is about

Design, 1 Nov 2026. Mockups only; no application code changed.

- `index.html` holds every frame, with notes beside each.
- `1-*.png` are the frames rendered at 2x by `node docs/design/phone-comments/shoot.js` (Playwright, Chromium 1194).
- `reviews.md` holds three desk reviews and what each one changed.

The owner, 1 Nov 2026:

> when the participants are asked to comment it is not super apparent the comment buttons go with AI read vs responses. the headers for the sections are the smallest text and both comment 'buttons' appear to go with the responses. even though 1 is for the AI. and then when they pick response, are they commenting on all responses or each separately. how do we know which response they are commenting on.

## 1. The problem, as shipped

**Where this screen lives.** It is the participant's panel: `FeedbackRoundPanel` wrapping `RoundReport`. A participant opens it with **Feedback** on any results screen (`PlayerPage.jsx:4661-4671`, rendered at `:3604-3652`). The host can also open it on every phone at once with "Request feedback" (`PlayerPage.jsx:4414`). Both routes show the same component, so they share the same faults.

| # | Fault | Where |
|---|---|---|
| 1 | The section headings are the smallest, faintest text on the screen: 0.8rem (12.8px), all capitals, `opacity: .6`. A `##` heading inside Workie's read renders as an h3 at about 19px in amber, so it is larger than the heading of the section it sits in. | `styles.css:11901-11908`; `MarkdownRenderer.jsx:310-317`; `FeedbackRoundPanel.css:270-278` |
| 2 | Every "Comment" renders as plain 16px text, not the 12px amber pill the stylesheet describes. `--rr-c-*` is declared only on `.rr-c`, the comment-list box. The `.rr-c__add` buttons sit outside that box, so their colour, border and font-size are invalid at computed-value time and fall back to inherited text. The result is that each button is larger than its heading. | `RoundReport.css:50-62` vs `:160-176`; `RoundReport.jsx:130-137` |
| 3 | A response row is a three-column grid with four children (rank, text, author, Comment), so the row's Comment wraps onto its own line under the row. The row background is `rgba(0,0,0,.04)`, invisible on dusk, so the button floats between its own response and the next one. | `styles.css:11919-11927`; `RoundReport.css:185-188` |
| 4 | The "Comment" beside **Responses** is anchored to `results`, which means the whole round. Its visible label says only "Comment", and so does every per-response button. Nothing on screen says "all" or "one". This is the owner's "are they commenting on all responses or each separately". | `RoundReport.jsx:286-293`, `:358-363` |
| 5 | Workie's Comment sits directly under the responses' comment box. Only the faint heading from fault 1 separates it from the responses, so it reads as the responses' second button. The phone also calls it "AI summary" while the rest of the product says "Workie's read". | `RoundReport.jsx:405-417`; `config/comments.js:107` |
| 6 | Comments on every response and on the whole round share one list under Responses. Which thing a comment belongs to has to be read from a 12px label. | `RoundReport.jsx:232-234`, `:370` |
| 7 | **When the response list is empty** (nobody answered, or the list is still loading), exactly two "Comment"s are left, one under the other. This is the owner's description word for word. The empty text also says "Nobody voted on this round.", which has been wrong since 14 Oct 2026: `get-results` now tallies every response at 0 when nobody votes, so its empty `voteTallies` (the early return) means nobody **answered**. | `PlayerPage.jsx:261-268`, `:3584-3590`; `get-results.js:891-910`, `:912-936` |
| 8 | The composer's subject is a 12px all-capitals "COMMENTING ON" above a 13px label. If you switch target while text is in the box, the text is silently dropped. | `FeedbackRoundPanel.jsx:202-212`, `:135-139` |
| 9 | The panel numbers responses by **rank** ("Response 1"), but the results screen numbers them by **ballot** ("You wrote response 4"). The phone also orders ties differently from the report, so "Response 2" can refer to a different response on the two surfaces. | `PlayerPage.jsx:4612-4632` vs `config/comments.js:105-118`; `PlayerPage.jsx:231-235` vs `create-report.js:800-809` |
| 10 | Report: the comment subhead reads "N comments on this round's results" even when the comments are on Workie's read. The label prints "On AI summary". Late comments lose their excerpt. | `GameReport.jsx:517-519`, `:522-524`; `create-report.js:458-466` |

## 2. Decisions

**D1. There are three sections, each with a real heading and its own action inside it.** The headings are 19px (the phone ladder's secondary rung, `PlayerSurface.css:113`), not a 12.8px label:

1. **Workie's read**: one card with a periwinkle edge (`--secondary`) and the Workie spark. Directly under the read, inside the card, is **Comment on Workie's read**, and under that is "Show 2 comments", which opens that read's comments in the card.
2. **The responses · 6**: a heading, then one card per response. Each card's foot has **Reply to this response**, and under it "Show 2 replies" opens that response's replies in the card.
3. **Anything else about this round?**: last, smaller, and worded as "something else". Its action is **Comment on the whole round**.

No action sits outside its section, and no action has the bare label "Comment". Every label names its object.

**D2. A reply is tied to one response, and you choose which on that response's card.** There is no button over the list. The anchor comes from the tap, as it does today (`FeedbackRoundPanel.jsx:44-50`), so ties cannot mis-file a reply.

**D3. The general comment stays, and it goes last, under "Anything else about this round?".** It is a real need ("something nobody said"), and it is where the host's "Said in the room" notes already land (`commentsClient.js:206`, `anchorKind: 'results'`). It is not offered as the default door.

**D4. The compose sheet says what it is about three ways at once.**
- The heading names the target in words: "Comment on Workie's read", "Reply to Priya Shah's response", "Comment on the whole round". On an anonymous round, where the server leaves names out, it reads "Reply to response 2".
- A quote shows the target: a periwinkle edge for Workie, and for a response its ballot number, author and three lines of text.
- The card on the page is outlined in amber while the sheet is open.

One line under the box gives the name rule: *"Your name is shown with this comment. Everyone in the session can read it, and the host may put it on the main screen."* Each part of that sentence is something the system does today: `namesShown` (`FeedbackRoundPanel.jsx:232-236`), the public `GET /comments`, and `featureComment` (`comments.js:864`). For a closed survey the line reads "Your name is not shown with this comment.", as shipped.

**D5. The sheet docks to the bottom of the shell and is not a Modal.** It is a flex child like `.plr-dock`, not `position: fixed`. The page above stays scrollable, which keeps the shipped reason for not using a modal (`FeedbackRoundPanel.jsx:196-202`). It has an X and a Cancel. Both go through one `requestClose()`, which asks "Discard your reply?" with **Keep writing** / **Discard** when text is in the box. Escape does the same. Tapping another target while text is in the box asks "Move your reply to Marcus Lee's response? Your words come with it." with **Move it** / **Keep it here**. That fixes the silent drop in fault 8. The per-round draft (issue #47) now also keeps its anchor.

**D6. After sending, the confirmation names the target and the comment appears under it.** The sheet closes and the card scrolls into view. Inside the card a `role="status"` line says "**Reply posted** under Priya Shah's response (response 2)." The card's replies open with yours last, marked "You · just now" with an amber edge. Focus goes back to the button that opened the sheet. Once you have posted, a banner at the top of the panel lists everywhere you have commented, each item a link. A late post keeps the shipped "marked as added later" sentence, attached to the same confirmation.

**D7. Comments live under the thing they are about.** Workie's comments are inside Workie's card. A response's replies are inside that response's card. Whole-round comments are in the last section. Threads are collapsed behind "Show N replies" so that other people's replies never push the next response off screen. A thread you posted in says so ("Show 1 reply (yours)") and opens after you post.

**D8. Response numbers are ballot numbers, printed as words.** Each card reads "Priya Shah", then "Response 2 · 6 votes, the most". The order already says the rank, and the number no longer sits in a circle where it could be read as one. This makes the panel agree with the results screen's "You wrote response 4" and removes the duplicate "1"s on a tie. It depends on B1 below.

**D9. Vocabulary.**
- You **reply** to a person's response, and you **comment** on Workie's read or the whole round.
- The way in on the results screen changes from **Feedback** to **Comment on this round**, with one line under it: "Reply to a response, or comment on Workie's read."
- The panel's bar reads "Round 3 · Comments". "Feedback" stays the host's word for the whole-room switch.
- "AI summary" becomes **Workie's read** everywhere a participant sees it.

**D10. Accessibility.**
- Headings run h1 "Comment on round 3", then h2 for each section.
- Each action's accessible name begins with its visible label (WCAG 2.5.3): "Comment on Workie's read", and "Reply to this response: The handoff from sales to implementation… (Priya Shah, response 2)".
- Thread toggles use `aria-expanded` and `aria-controls`.
- Every icon is `aria-hidden`.
- The sheet is `role="region"` labelled by its heading. The box's label is the heading, and its description is the name rule.
- The confirmation is a `role="status"` live region.
- Text is 13px at the smallest, which is the phone floor and above the house 12px floor. The box is 19px, the phone's input size, under which iOS zooms.
- Targets are 44px. Control outlines are 3.49:1 (WCAG 1.4.11).
- The text cuts (Workie's read to five lines, long responses to two) are visual only. The full text stays in the DOM, and "Read all" opens it in place.
- At 200% text the sheet is capped at the space above the keyboard and scrolls inside, with the quote shrinking first and the name rule never cut. Scroll-into-view respects `prefers-reduced-motion`.

### Measured contrast (composited; the phone has no black-lift)

| Pair | Ratio |
|---|---|
| `--text` #F4EDE4 on `--surface` #1B2942 | 12.53 |
| `--plr-muted` #B6C2D4 on `--surface` | 8.08 |
| `--plr-muted` on `--bg` #0F1A2E | 9.65 |
| `--text` on the Workie wash (#7CA7E6 at 10% over `--surface`) | 10.46 |
| `--plr-muted` on the Workie wash | 6.74 |
| `--secondary` #7CA7E6 (Workie edge, icon) on `--surface` | 5.91 |
| `--text` on the amber wash (your comment, banner) | 10.40 |
| `--text` on the green wash (sent confirmation) | 10.15 |
| `--plr-success-text` #6FD0A4 icon on the green wash | 6.31 |
| `--text` in the box (white at 8% over `--surface`) | 9.85 |
| placeholder `--plr-muted` in the box | 6.35 |
| `--bg` on `--primary` (Post) | 8.86 |
| control outline (muted at 55%) vs `--surface` / `--bg` | 3.49 / 3.79 |
| *Today:* the section heading (`--text` at 60% on `--bg`) | 6.10, which passes on contrast and fails on size |
| *Today:* white on the amber podium circle (`styles.css:11967-11972`) | **1.96**, a separate failure that D8 removes |

## 3. The coordinator's trace: which findings this design fixes

| Finding | Fixed by |
|---|---|
| Three targets, all labelled "Comment" | D1 and D9: every action names its object |
| Faint 0.8rem headings | D1: real 19px h2s |
| Button CSS vars defined only on the comment box, so the buttons render as plain text | Replaced with the new section actions, which are tokened on their own scope. If any `.rr-c__add` survives (in the host's read-only `PastRound` it does not render), move `--rr-c-*` up to `.past-round__body`. |
| Four children in a three-column grid | Cards replace the grid on the phone. The action has its own row in the card foot, and the thread toggle has the row below that. |
| "AI summary" vs "Workie's read" | D9; `anchorLabelFor` and `wallCreditFor` change their strings (frontend only) |
| The composer sits at the foot with a 12px "Commenting on" | D4, D5 |
| Switching target silently drops text | D5: "Move your reply…?" |
| Position, not a stable id | B1 below: **yes, replace it**, with the ballot number |
| The phone orders ties differently from the report | B1: the ballot number is the same on every surface, so tie order stops mattering for attachment |
| Report: "comments on this round's results", "On AI summary", late comments lose their excerpt | Section 5 and B3 |

## 4. Backend changes

**Per-response targeting needs no backend change.** It already exists. `anchorKind: 'response'` with a numeric `anchorRef` is in the closed set (`comment-keys.js:52`). It is validated and keyed as `COMMENT#nnn#response#<ref>#<id>` (`comments.js:390-404`), the ref is re-derived from the key (`:529-532`), and it is returned on the wire (`toWire`, `:312-335`). `summary` and `results` exist too, so all three sections post to the route as it stands.

Two changes are recommended, each small (B2 turned out to be frontend only):

**B1. Make the response anchor a stable id: the ballot number (recommended, needed for D8).**
- Today `anchorRef` is the row's position in whichever ranked list the phone built. That list is ordered by `rankedResultsFrom` (`PlayerPage.jsx:223-248`), and its tie order differs from `create-report.js:800-809`.
- The **ballot number** is the display position from `answer-order.js` (`displayOrder`/`displayToCanonical`). It is deterministic per session and round, it is the number the vote used, and it is the number the results screen already shows.
- `get-results` already keys `voteTallies` by it (it is remapped through `shownOrder`, near `get-results.js:976`), but `rankedResultsFrom` throws the key away with `Object.values`. The `leaderboard` and `answers` shapes carry no ballot number at all.
- Changes:
  - `get-results` adds `ballot` to `leaderboard` and `answers` rows.
  - `writeComment` accepts and stores `AnchorBasis: 'ballot'`. It passes it through `toWire`, and `create-report` emits it.
  - Readers place a `ballot` comment on the response with that ballot number. `create-report` already has `shownPlace` to map it.
- The sort key format is unchanged, still numeric.
- Rows written before the change carry no `AnchorBasis`. Readers place them by matching the stored `AnchorExcerpt` against the response text, and when nothing matches they list the row in the whole-round section with its stored quote. Nothing is lost or mis-filed.
- `tests/comment-keys.js` and `tests/round-comments.js` need cases for the new attribute.
- *Alternatives rejected:* the author's name would put personal data in a sort key and break on anonymous rounds. The canonical stored index never reaches the phone.

**B2. Withdrawn: no backend change is needed for fault 7.** I first took the empty list to mean a round nobody voted on. It doesn't: since 14 Oct 2026 `get-results.js:912-936` tallies every response at 0. Fault 7 is a frontend copy fix. In `PlayerPage.jsx:3588`, "Nobody voted on this round." becomes "No responses came in for this round." Under D1 that sentence sits inside the responses section with no action, so the two remaining actions cannot be mistaken for the responses'.

**B3. The report's late comments keep their excerpt (recommended).** `create-report.js:458-466` copies `anchorLabel` onto a late comment only on an attributed round, and never copies `anchorExcerpt`. It should add `anchorExcerpt` under the same rule, so a late reply in the report still says what it was about.

**Not proposed: participants editing or deleting their own comment.** No route exists for it. That fits "the composer says so before you post", but a talkative participant will ask for it (reviews.md, reviewer 2). It is listed as an open fork.

## 5. How it shows up for the host and in the report

All of this is frontend except where B1 and B3 are named.

- **The wall** (`FeedbackWall.jsx`, via `wallCreditFor`, `config/comments.js:131-145`): a featured comment is credited as "Dana Reyes **on Priya Shah's response**", "… **on Workie's read**" (was "on the summary") or "… **on the whole round**" (was "on the results"). The arrivals list (`RoomMeter.jsx:183-200`) stays unattributed text, as ruled on 2026-09-24.
- **The host's round review** (`PastRound`, the same `RoundReport` renderer with no `onComment`): it gets the same structure read-only. Workie's comments sit under Workie's read and each response's replies under its own response, and the host's "Said in the room" notes appear under "Anything else". The host never sees a reply action, as today.
- **Late list** (`LateList.jsx` / `ReportLate.jsx`): the item reads "On Workie's read", "On Priya Shah's response" or "On the whole round".
- **The report** (`GameReport.jsx:517-555`): a round's comments are grouped under three subheads that match the phone: **On Workie's read**, **On the responses** (each reply under "Response 2 — Priya Shah" with its stored quote, in ballot order), and **On the whole round**. The note becomes "N comments on this round", replacing "… on this round's results". Labels stored before the change ("AI summary", "Results") are shown by `anchorKind`, not by the stored string, so old reports read the same as new ones.

## 6. Forks, with recommendations

1. **Section order.** Workie's read first (folded to five lines) or responses first. *Recommend Workie first:* it is the last thing the room heard on the stage before the feedback beat, and the fold keeps the first response near the fold. If the owner thinks of the responses as the substance, the order flips without changing anything else.
2. **Keep the whole-round comment?** *Recommend keep*, last and worded as "Anything else" (D3). Dropping it strands the host's room notes and any "what nobody said" comment.
3. **Numbering.** *Recommend the ballot number* (D8, with B1). Keeping rank needs no backend change, but the panel would keep disagreeing with the results screen, and ties would still collide.
4. **A docked sheet or the shipped inline composer.** *Recommend the docked sheet* (D5). With the keyboard up on a 360 phone the target is off screen, so the sheet's own quote has to carry it.
5. **"Reply" or "comment" for responses.** *Recommend "reply"* (D9). It names a person's words. If the owner prefers one verb throughout, use "Comment on this response". Never use the bare "Comment".
6. **Threads collapsed or open.** *Recommend collapsed*, with "Open all replies" on the responses heading for people who want to read everything.
7. **B1 now or later.** If B1 waits, ship D1–D7 with rank numbers and the excerpt check as a guard. The bare-"Comment" ambiguity, which is the owner's complaint, is fixed either way.
8. **Edit or delete your own comment.** *Recommend not now.* It would be a new participant write and would need the same membership and ClientId checks as `writeComment`.

## 7. What changes in the in-app help when this ships

`config/help/player.js:663-675`, "Commenting on a round", says "Tap **Comment** on the part you want to talk about: the results, Workie's read, or one response." It becomes:
- **Reply to this response** on a response's card;
- **Comment on Workie's read** inside Workie's read;
- **Comment on the whole round** for anything else.

It must also mention the sheet's quote and the "Reply posted under …" confirmation. `:668` calls the entry button **Feedback**, which becomes **Comment on this round**. `player-surveys.js:239` quotes the shipped lead "Comment on the summary, on the results, or on any single response.", which needs rewording to match.
