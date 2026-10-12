# Two surfaces: presentation and control

**Status: APPROVED by the owner, 2026-10-12** ("these mockups look pretty good"), with one change below. The open questions at the end are taken as the recommendations unless the owner says otherwise. Published prototype: https://claude.ai/artifact/QY1rU3LTCekLsXaduDoJBj (private); source in `prototype.html`.

## Owner ruling, 2026-10-12: the navigator during voting
"The only thing missing is the ability to view them during voting. I think the host could show these, always with the names redacted and randomized 'Response 1', and would not show any score at this point."

- During VOTE the host may show responses on the presentation with the same navigator.
- Names always hidden, whatever the round's names setting. No points, no ranks, no vote counts.
- Order and numbers are the voting order the phones show (the seeded per-round shuffle, `answer-order.js`), so "Response 3" on the wall is "Response 3" on every ballot.
- Results keep tally order with names and points as allowed (unchanged).
- This replaces open question 11's recommendation ("no navigator during voting").

---

# Two surfaces for a Call & Answer round: notes

Prototype: `two-surface.html` (same folder). One shared state drives three surfaces: the **Presentation** (what the room or Zoom sees), the **Dashboard** (the host's laptop) and the **Remote** (phone, tablet or laptop). Real content from session 5479, round 5. Supersedes the single-screen prototype the owner rejected on 2026-10-12 (content scrolled on the projected screen; the Ask the room drawer covered the Stage).

## 1. What exists today (studied)

- **The host page is the Stage.** `GameHostPage.jsx` (8,156 lines) draws the projected Stage and the host's dock and drawers in one window. Paging state is local to it: `stagePage` (`GameHostPage.jsx:429`), used for responses (`:6734-6751`) and Workie's read (`:6131`).
- **Display profiles** Room / TV / Call / Table are four literal ladders on the root (`styles/stage.css:43-86`), chosen in `config/displayProfile.js:22-26` (`PROFILES`, `FLOORS`). TV may not shrink below Room (`stage.css`, `--fit-min:.78`). The prototype uses these ladders resolved at 1080 px tall.
- **Paging budgets already exist**: `config/stagePaging.js:81-88` (`PAGE_SIZE` room 3, tv 2, call 3, table 5) and `:266-273` (`PROSE_BUDGET` 18/12/18/30 lines). They are line estimates; the prototype measures instead.
- **A second window exists, from the wrong end.** The Remote opens the host page in a new window (`HostRemote.jsx:1067-1071`, `window.open(.../host?gameId=...)`) and drives it by `postMessage` (`HostRemote.jsx:1057-1064`, received at `GameHostPage.jsx:1156`), behind a **Big screen** button (`HostRemote.jsx:1622`). If that window reloads, the link is lost ("The big screen is not open from this remote"). No `BroadcastChannel`, no `/present` route.
- **Server-held stage facts already exist**: `/stage-focus` (one response on the wall, `HostRemote.jsx:653-666`, `config/stageFocus.js:27-162`) and `/stage-beat` (`config/hostControls.js:84` `STAGE_BEATS`). These are what make a follower window possible.
- **AnswerSpotlight** (`components/AnswerSpotlight.jsx:87`, Previous/Next at `:251-262`, "2 of 4" from `positionLabel`, `:222`) is a host-screen overlay on the Stage.

## 2. Approaches considered

1. **One window, cleaned up.** Keep the Stage as the host page; hide the dock better. Rejected: the owner's premise is that the host screen is what the room sees, so every control and every draft is one mistake from the wall. It cannot meet "never shows controls".
2. **Presentation window + phone remote required.** Clean, but makes a phone mandatory and leaves a host with a laptop and a projector managing a session on a 6-inch screen.
3. **Presenter view (chosen).** Split the page in two: a **Presentation** that only follows the session and has no controls, and a **Dashboard** that runs it. The Remote is the same Dashboard, condensed. Any of the three can be present or absent; all read one server state.

Why 3: it is the pattern hosts already know from Keynote and PowerPoint, it covers all three setups with the same two pieces, and it fixes the Zoom case for free (share the Presentation window only). It also matches R1 (one decision function): the Presentation draws only from server facts, and every control surface reads `roundStep()`.

## 3. The surface model

**Presentation.** A 16:9 page at `/present?gameId=…`, full screen on the projector or shared as a window in Zoom. It:
- never scrolls, never shows a control, a cursor, a draft, a name request, a waiting list or a host note;
- draws only from server facts: moment, beat, page, focused response and part, live ask. It holds no state of its own, so a reload or a dropped network lands on the same moment;
- uses the profile's ladder and fits by measurement: shrink the whole moment to the profile's floor (`--fit-min`), then drop the one optional block (the Background paragraph), then page. Long things are always paged, never scrolled or clipped.

**Dashboard.** The host page on the laptop: everything needed to run and manage the session. It shows a live preview of the Presentation, so the host always knows what the room sees.

**Remote.** The Dashboard's moments, words and next step, condensed for a phone, tablet or laptop. Same `roundStep()`.

### The three setups

| Setup | Room sees | Host runs it from |
|---|---|---|
| (a) Laptop + projector as an extended display | Presentation, full screen on the projector | Dashboard on the laptop (Remote optional, for walking about) |
| (b) One screen, mirrored to the projector or shared to Zoom | Presentation, full screen | Remote on a phone; or keys only (below) |
| (c) Zoom window share | The Presentation window, shared alone | Dashboard in another window on the same screen |

**Opening it: a Present button** in the Dashboard header. It opens `/present?gameId=…` as a real link (`<a target="_blank">`, as `styles.css:737-741` argues) with a hint to drag it to the second screen and press F (full screen); where the browser offers the Window Management API, it places the window on the external display directly. While open, the header shows "Presenting on screen 2"; pressing it closes the window. Because the Presentation follows the server, it needs no handshake: reopening the link, or opening it on a different computer wired to the projector, just works. The `postMessage` channel and the Remote's Big screen button retire.

**One screen, no phone.** The Presentation itself takes Space, → and ← (a clicker works), and moving the mouse shows a small strip for three seconds: status, secondary, primary. The room sees that strip, so it is the fallback, not the design. Hover the Presentation in the prototype's "One screen + phone" setup to see it.

**Recommended default: (a), Dashboard + Present.** Opening a session from the console opens the Dashboard; the lobby's one primary is **Present** until a Presentation is connected, then **Start round 1**. The Remote is offered (QR in the Dashboard's Session) for hosts who walk the room, and is the recommended control for (b).

## 4. The presentation rules

1. 16:9, one page per moment, never scrolls. Every text block that can grow is measured, not estimated.
2. Fit order: whole-moment shrink to `--fit-min` (Room/Call/Table .55, TV .78) → drop the optional block → page.
3. Nothing host-only ever reaches it: drafts and suggested asks, who has not answered, name requests, host notes and Background (when the host keeps it private), the Session list.
4. Names appear only when the round's names setting allows; otherwise "Response 6". Counts are always fine.
5. One position indicator per paged thing, at the foot, same place every time: "Response 6 of 8", "Page 2 of 4".
6. Sample data in the prototype is labelled "Sample" on the screen itself.

## 5. The response navigator

The owner's sketch `[1-5] < 6. full text > [7-8]  Viewing 6 of 8`, made into a rule:

- **Centre:** the focused response as a card: number badge, name and vote points (or "Response 6 · name hidden"), the full text.
- **Flanks:** the two nearest neighbours each side as mini cards (number + name, or the first words when names are hidden), and everything further as **one range chip**: "1–27 · 27 responses". Left stack reads top to bottom from earliest, so the eye runs 1 → N.
- **Scale:** 4 → no range chips; 8 at #6 → `[1–3] 4 5 | 6 | 7 8`; 20 at #10 → `[1–7] 8 9 | 10 | 11 12 [13–20]`; 60 at #30 → `[1–27] 28 29 | 30 | 31 32 [33–60]`. The flank never grows past three items, so the card size never changes.
- **Foot:** a track (one tick per response up to 24; a bar with a marker above that) and "Response 6 of 8".
- **Long answers:** text starts at the profile's primary size and shrinks to its secondary size, the smallest a room should read in runs. Past that, the answer splits by sentence into parts, "Part 1 of 2" in the card, and → turns the part before the response. The prototype's sample #6 shows this (two parts on Room and TV).
- **Order:** the tally's order (most points first), so stepping 1 → N walks down the results the room just saw.
- **Results tally** (the moment before): top five with name, first words and points; more than six collapse to "and 15 more responses".
- **Voting:** responses are not listed on the screen (60 cannot fit, and an enlarged one tilts the vote, CHANGES Q15); the screen shows the question and the voted count; the answers are on each device.

## 6. Workie's read

Pages are the read's own sections; a section that does not fit splits by bullet with "continued" (TV splits "What the room voted" into two). Foot: "Workie's read", one segment per page (seen, current, ahead) and "Page 2 of 4". **Discussion topics** get their own page with large numerals; **Suggested next steps** is the last page. Order recommendation in open question 4.

## 7. Asking the room

Composed and chosen only on the Dashboard or the Remote. The suggestions are always visible on the Dashboard during What we heard (choosing one is safe: it changes nothing on the screen); on the last page the secondary **Ask the room (2 ready)** opens the choice. Choosing enters a control-only moment, **COMPOSE**: primary **Send to the room**, secondary **Back to the read**; the screen keeps the read's last page. Sent: the screen shows the statement ("Agree or disagree") or the question and options, with the answered count; **Show results** (arms if people are still answering) and **Cancel the question**. Results: counts as bars; **Next round**, **Ask another**. No drawer on any projected surface.

## 8. The Dashboard

Header: session name, round dots, the moment, **Present** / "Presenting on screen 2", **Session**.
Left column: **On the screen now** (live preview at the room's profile), the navigator row (‹ Response 6 of 8 · part 1 of 2 ›, or ‹ Page 2 of 4 ›), **Next on the screen** (one line from `roundStep().next`), and the question, folded (task, private Background, set).
Right column: the moment's working list, one at a time: lobby, the joined names; answering/voting, who is still to act (host-only); results/responses, the response table with **Show** per row (pressed "Showing" in blue); What we heard, the page list and the asks; a live ask, who has not answered; its results, the counts.
Footer (the dock): status line, at most one secondary (ghost), the one amber primary, always bottom right. Space/→ = primary, ← = back, Esc = stop showing / cancel / disarm.

## 9. The Remote

The same header, status, secondary and primary in the thumb zone (64 px primary), the same navigator row, a small "On the screen" preview, the folded question and the same moment panel, rendered by the same component in a narrower skin. Every moment has the same words on both. The Session button holds what R7 lists.

## 10. Every moment on three surfaces

| Moment | Room sees | Dashboard primary / secondary | Remote |
|---|---|---|---|
| Lobby | join URL, code 5479, QR, "5 joined" | Start round 5 (Present first, if not presenting) | same; names list |
| Answering | category, title, Background (droppable), task, "4 of 5 answered" | Start voting (arms: "1 still answering") | same; still-to-answer names |
| Voting | title, "N answers are on your device", "3 of 5 voted" | Show results (arms) | same |
| Results | tally, top 5 + "and N more" | Show response 1 of N / What we heard | same; response list with Show |
| Responses | navigator | Next response (Next part; on the last: What we heard) / Stop showing | same, with ‹ › |
| What we heard | page n of m | Next page; last page: Next round / Ask the room (2 ready) | same; page list |
| Ask the room (control only) | the read's last page, unchanged | Send to the room / Back to the read | same list, as a sheet |
| Room question | statement or question + options, answered count | Show results (arms) / Cancel the question | same |
| Its results | counts as bars | Next round / Ask another | same |
| Next round | "Round 6" | (prototype: Start over) | same |

## 11. Reconciling the earlier drafts

- **simplify-round:** kept whole. R1 `roundStep()` now also returns `next` (what the screen shows after the primary) for the Dashboard's "Next on the screen" line. R2 gains one control-only moment, `COMPOSE`, which the server does not need to know about (it has no screen state). R3 one orange: holds on all three surfaces; the Presentation has none. R4's response stepper is the navigator; R7 Session unchanged. R9 is now enforced by construction: the Presentation has no code path to names requests.
- **remote-parity:** Workie's page held on the server (§2) is a prerequisite here, as is the stage-focus part index (new). The Remote's **Big screen** button (`HostRemote.jsx:1622`) is replaced by the Present link; its focus panel by the navigator row.
- **ca-followup-asks:** F2 "drawer on the host screen" becomes the right column of the Dashboard and a sheet on the Remote; F4–F5 unchanged on the screen. The `ask` beat is unchanged on the wire.

## 12. What in the code would change (not built)

| Change | Files |
|---|---|
| New follower page: Stage moments only, no dock, no drawers, no keyboard except the one-screen fallback | `src/src/PresentPage.jsx` (new), router entry, `components/stage/Stage.jsx` (lifted out of `GameHostPage.jsx`) |
| Host page becomes the Dashboard: preview + panels + dock; the Stage moves out | `GameHostPage.jsx`, `components/stage/Dock.jsx`, `components/HostActionBar.jsx` |
| Server holds every screen fact: beat, page, focused response **and part**, live ask; the Presentation polls/subscribes | `lambda-functions/game/stage-beat.js`, `stage-focus` handler, `get-game-state.js` (public branch), `config/stageFocus.js` (add `part`) |
| Measured fitting and paging replace line budgets | `config/stagePaging.js` (keep `PAGE_SIZE` as the first guess), a `useFit` hook beside `Stage.jsx` |
| Navigator replaces the spotlight overlay | `components/AnswerSpotlight.jsx` → `components/stage/ResponseNavigator.jsx`; `utils/stepIndex.js` (window and range logic) |
| `roundStep()` with `next` and `COMPOSE` | `config/roundStep.js` (from simplify-round), `config/roundWords.js` |
| Remote: Big screen/postMessage retired; Present link in Session | `HostRemote.jsx:1057-1071`, `:1622`; `GameHostPage.jsx:1156` |
| Ask panel container: Dashboard column or Remote sheet | `FollowUpPanel.jsx` (per ca-followup-asks PLAN T15) |

## 13. Open questions, each with a recommendation

1. **Default setup.** Recommend (a): the Dashboard opens; Present is the lobby's primary until a Presentation connects. Owner call whether a session may start without one (recommend yes, with the status "Not presenting").
2. **One screen and no phone.** Recommend the keys + three-second strip fallback, and say in the lobby "For one screen, use your phone as the remote" with its QR. Alternative: require the phone. Not recommended; a host with a clicker should be able to run a round.
3. **Response order in the navigator.** Recommend tally order (most points first). Alternative: the order answers arrived. Tally order matches what the room just saw.
4. **Order of the read's pages.** Recommend: said, voted, next steps, **discussion topics last**, so the topics stay on the wall while the room talks and Ask the room follows naturally. The prototype keeps the read's own order to stay faithful to Workie's output.
5. **Smallest response text.** Recommend the profile's secondary size (Room 40 px) as the floor, then parts. The body size (30 px) fits more but reads as a wall from the back of a room.
6. **Background on the wall during answering.** Recommend shown, droppable first when space runs out (TV), and hidden entirely when the set marks it private.
7. **Who has not answered, on the Dashboard.** Recommend shown (host-only), as the Remote already does; the screen shows counts only (R9).
8. **Presentation sign-in.** Recommend the Presentation needs no sign-in: it shows only what the room already sees, so a join-code URL is enough. It must never receive names when the round hides them (server filters).
9. **Window placement API.** Recommend using it where available and falling back to drag + F; do not block on it.
10. **Show results when everyone has answered a room question.** Unchanged from CHANGES Q3: no without Auto, yes with Auto.
11. **Navigator during Voting.** Recommend no (CHANGES Q15); the screen shows the count only.
12. **Part as a server fact.** Recommend the focused response carries `part` on `/stage-focus`, so the Remote, Dashboard and Presentation agree on "Part 1 of 2". The part count is measured by the Presentation and published back, or computed from the same budget on every surface; recommend the Presentation publishes it, since only it knows its size.
