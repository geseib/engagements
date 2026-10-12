# What changes: the two drafted designs, and the build order

`AUDIT.md` is the evidence, `PRINCIPLES.md` the rules, `index.html` the screens. This file says what the two designs drafted before this audit must change to follow the rules, and in what order to build everything. Nothing here is built.

---

## 1. Revisions to `docs/design/remote-parity/`

| Item | Drafted | Revised | Rule |
|---|---|---|---|
| ASK primary in every mockup | "Close answers" | **Start voting**, from `roundWords.js`. "Close answers" was a third spelling of one act. | R6 |
| **A. Names** | Remote only; host-screen Not now / Lock again and a host-screen strip as open questions 1 and 2 | **Required, same change.** One verb table, `config/nameActions.js` (state → verbs → route body), read by `PlayersList` on the host screen and the Remote's Players rows. The request strip is one component in two skins: above the dock on the host screen, above the status card on the Remote; never on the Stage. Remove gives an undo notice on both. | R4, R9 |
| A2 way in | "Players & rounds" grid button | The status card's count ("See who is here") and Session › People. The grid goes. | R7 |
| **B. Workie's pages** | Server-held page via `/stage-beat`; skip as a body link "Skip to next round"; Back a page in the body | Mechanism unchanged. **The skip moves into the dock**, as the secondary above the primary (`hr-sec`), the same slot every moment uses. Back a page stays in the body card. The primary's label comes from `roundStep`. | R1, R3 |
| B, read still generating | Today's behaviour unchanged (frame 9) | **Show the read**, disabled, "Workie is writing", as the primary; **Next round** as the plain secondary. Same on the host screen (fixes the silent skip, `AUDIT.md` U1). | R3, R5 |
| **C. The question** | A fold under the status card | Kept, and it becomes **the round's own section** in every moment: question, task, Background (private), trivia options, and two actions at its foot: **Show on the wall** (replaces "Enlarge the question" in the focus panel) and **Add a note**. When the round has nothing left to do, the fold shows the **next** round's question. | R7, R10 |
| **D. Host note** | "Add a note" beside Players on the round view, every phase | At the **foot of the fold**, not in a grid. The sheet itself is unchanged. On the host screen: the Rounds tab's row for the round on the wall. | R10 |
| **E. Follow-up asks** | The plain button above the primary on the last page; list in a later build | Placement kept; it is the moment's secondary from `roundStep`. **The list (Send as it is) ships on the Remote in the first build**; Edit and send follows. | R1, R4 |
| Remote round view | Unchanged around the new pieces | Thirteen controls move behind **Session** (top right); the round view keeps the moment's card, the fold, and the dock (`index.html` §1, `AUDIT.md` §5). | R7 |
| Spotlight on the Remote | Unchanged | The focus panel's list of toggles becomes the **Results stepper** (`index.html` §4). | R4 |

## 2. Revisions to `docs/design/ca-followup-asks/`

| Item | Drafted | Revised | Rule |
|---|---|---|---|
| F1 | "Ask the room…" replaces Request feedback | Kept, without the ellipsis: **Ask the room** with the ready count. | R6 |
| F2 contents | Suggestions, Write your own, Comments on the read | Kept; the third is **Open comments on the read**, so it says what it does. The panel is the **one** way to ask the room anything after a read, on both host screens. | R4 |
| PLAN T13 words | `config/followUpWords.js` | Folded into **`config/roundWords.js`**. One words file for the round, not one per feature. | R6 |
| PLAN T14 dock | In `hostControls.js`, mirrored in `hostRemote.js` | In **`config/roundStep.js`**, read by both. | R1 |
| PLAN T15 panel | `FollowUpPanel.jsx` as a drawer | Takes its container as a prop: drawer on the host screen, sheet on the Remote, from the first build. | R4 |
| PLAN T18 Remote | Show results, Cancel, Next round only | Plus the suggestion list with **Send** (T21's list moves into the first build). Edit and send on the Remote stays second. | R4 |
| Beat name | `ask`, host phase `FOLLOW_UP` | Beat stays `ask` on the wire (the backend is on dev); the moment is called `ROOM_QUESTION` in `roundStep`, so it never reads as the round's own ASK. | R2 |
| All answered | Not specified | The primary gains the green ring and "Everyone has answered"; auto only with Auto on (open question 3). | R5 |
| Phone card F6 | The card, Send | Plus: the generic comment link hides while an ask is live; the now line says "A question for the room". | R8 |
| Grounding check | Drops agree statements not copied from one answer | **Measured on 5479: every round produced a sendable ask, but agree statements were sometimes fragments.** Add a fragment mark: a statement under 5 words, or one that starts with a conjunction or ends mid-clause, is marked "Reads as part of a sentence" and sorted below the other suggestions; under 4 words it is dropped. The editor shows the mark. | R3 (one clear choice) |

## 3. Build order

Smallest change with the biggest simplification first. Each step ships alone, behind the existing tests plus the ones named. Every step that touches the frontend runs `tests/*.js` too (backend tests read frontend source).

| # | Step | Files | Tests |
|---|---|---|---|
| 1 | **The read is never skipped by accident.** FIELD_NOTES with no read yet: primary "Show the read" disabled with the hint "Workie is writing", secondary Next round. Same on the Remote while `fieldNotesFrom` is not ready. | `src/src/config/hostControls.js` (`primaryFor` FIELD_NOTES, a `notesReady` input), `GameHostPage.jsx` (pass `notesReady`), `config/hostRemote.js` | `hostControls.test.js`, `hostRemote.test.js` |
| 2 | **Words and the noun.** `config/roundWords.js`; sentence case on every dock and Remote label; the Remote takes the set's noun (add `roundNoun` to the host branch of `get-game-state.js` if `/host-state` does not carry it); phone: drop "Application Submitted!" for "Sent", the Feedback button becomes "Comment on this round", "AI summary" becomes "What we heard". | `config/roundWords.js` (new), `hostControls.js`, `hostRemote.js`, `PlayerPage.jsx`, `components/RoundReport.jsx`, `lambda-functions/game/get-game-state.js` | a grep test (PRINCIPLES R6); `hostRemoteScreen.test.jsx` |
| 3 | **One decision function.** `config/roundStep.js` (`momentOf`, `roundStep`); `hostControlsFor` becomes its reader; the Remote's `primaryAction` is deleted and `HostRemote.jsx` reads `roundStep`. The Remote gains the dock's secondary slot (`hr-sec`), its ENDED primary (**Open session report**), and the feedback round (Request feedback / Back to what we heard) through `requestFor`, until step 9 replaces them. | `config/roundStep.js` (new), `hostControls.js`, `hostRemote.js`, `HostRemote.jsx`, `HostRemote.css` | `roundStepParity.test.js` (new, PRINCIPLES R1) |
| 4 | **The Remote's round view keeps three things.** Session button and sheet (the existing `RemoteSessionPanel` tabs plus the session controls); the status card's count opens People; the This round, Scoreboard and Session cards go; `hr-btn--primary` on toggles becomes the blue pressed style; `.hr-btn--danger` text to `--danger-text`. | `HostRemote.jsx`, `HostRemote.css`, `components/RemoteSessionPanel.jsx`, `components/RemoteScoreboardPanel.jsx`, `components/RemoteFocusPanel.jsx` | palette test (R3), `hostRemoteSession.test.jsx` |
| 5 | **One early-advance pattern; Skip behind Session.** The dock arms ("4 still answering. Press again to start voting.") instead of `showConfirmation` for start-vote and show-results; Skip moves to Session › This round on both, with a second press on both; Back to Menu leaves the lobby dock. `ConfirmDialog` stays for irreversible acts only (close survey, end session). | `components/HostActionBar.jsx`, `GameHostPage.jsx` (`handleFinishQuestion`, `handleShowResults`, SKIP), `hostControls.js` (secondaries), `components/stage/SessionSetupPanel.jsx` | `hostControls.test.js`; an arm test on `HostActionBar` |
| 6 | **Workie's pages from the Remote** (remote-parity B, revised). | `lambda-functions/game/stage-beat.js`, `get-game-state.js`, `GameHostPage.jsx` (publish on page turn and auto-mode), `config/hostRemote.js`, `HostRemote.jsx` | `tests/feedback-round-beat.js` extended; a new `tests/stage-notes-page.js` |
| 7 | **One response stepper.** `config/responseStepper.js` (position, next, back, stop, from `stageFocus`); the host's `AnswerSpotlight` publishes every step and shows "Response 2 of 9"; the Remote's Results card replaces the focus list. → pages unread response pages before What we heard (open question 13). | `config/responseStepper.js` (new), `components/AnswerSpotlight.jsx`, `utils/stepIndex.js` (label), `components/RemoteFocusPanel.jsx` → `RemoteStepCard.jsx`, `GameHostPage.jsx` (`interceptAdvance` for RESULTS) | `remoteFocusPanel.test.jsx` rewritten; `answerSpotlight` tests |
| 8 | **Names, one verb table, one strip** (remote-parity A, revised). | `config/nameActions.js` (new), `components/stage/PlayersList.jsx`, `SessionSetupPanel.jsx` (wire `onLock`, `onRefuse`), a shared `NameRequestStrip.jsx`, `config/hostRemote.js` (`rosterListing` passes `handover`, `departed`), `RemoteSessionPanel.jsx`, `HostRemote.jsx` | `hostRemote.test.js`, a strip test |
| 9 | **Ask the room** (ca-followup-asks Phase 4, revised): the panel in both containers, the beat, the Stage, the phone card, the Remote list with Send. | per PLAN T13-T18, with `roundWords.js` and `roundStep.js` in place of `followUpWords.js` and the two dock copies | per PLAN |
| 10 | **Participants always know what now.** One now line per moment; the phone shows the read's topics on What we heard (open question 8); the comment link hides while an ask is live. | `PlayerPage.jsx`, `config/roundWords.js`, `components/FeedbackRoundPanel.jsx` (pass `onSpotlight` or remove the badge's press) | `playerMomentLine.test.jsx` (new, R8) |
| 11 | **The round's section, and host notes** (remote-parity C and D, revised). | `HostRemote.jsx` (fold), `get-game-state.js` (host branch: Background, early trivia answer, if approved), `lambda-functions/game/comments.js` + `template-clean.yaml` (host route), `create-report.js`, `GameReport.jsx`, `RoundReport.jsx` | public-body test for `/state`; comments tests |
| 12 | **The green ring and the safe autos.** `alwaysAuto` beside `autoDecision`; the green ring on the primary when everyone is in (votes, answers, a room question); auto-close of a live ask on Next round (already in follow-ups T12). | `config/autoMode.js`, `HostActionBar.jsx`, `HostRemote.css` | `autoMode.test.js` (R5) |

Steps 1 and 2 are a day each and change what the host sees in every round. Step 3 is the one that makes the rest cheap: after it, steps 6, 7 and 9 each land on both host screens by changing one function.

## 4. Open questions, with a recommendation each

1. **The "More" place is called Session on both host screens.** The host dock already has a SESSION button (`Dock.jsx:175-182`, key `\`). *Recommend yes;* do not introduce a second word.
2. **Everyone has voted: show results without a press, when Auto is off?** *Recommend no.* The green ring and "Everyone has voted" make it one obvious press; the reveal is the host's moment, and an unasked reveal while the host is talking looks like a fault. Revisit after a session with the ring.
3. **Everyone has answered a room question: show results by itself?** *Recommend no without Auto, yes with Auto* (4 s grace). It loses nothing, but people may still be reading the question on the wall.
4. **Everyone has answered (ASK): open voting by itself?** *Recommend no;* same reason as 2, and a late joiner would miss the round.
5. **Workie's read is ready while the room is on the tally: move to What we heard by itself?** *Recommend no;* say "Workie's read is ready" in the status instead. The tally is where hosts talk.
6. **Replace the host screen's "Proceed to Voting?" modal with the arm pattern?** *Recommend yes.* One pattern on both screens; the modal also took → as yes, so a clicker already went through in two presses. Keep `ConfirmDialog` for irreversible acts.
7. **Skip moves behind Session on the host screen, and gains a confirm there?** *Recommend yes.* It is the only control on the ASK dock that loses a round, it does not confirm today, and it sits beside the button pressed every round.
8. **Participants see the read's discussion topics on What we heard?** *Recommend yes, topics only,* not the read itself (relay pilot finding 12 keeps the read on the main screen). Today the phone does not change at all.
9. **Detailed ballot as the default?** It is 5 taps to Quick's 7. *Recommend measure first* in one session; owner call.
10. **The Remote gets the Ask the room list in the first follow-up build?** *Recommend yes, with Send as it is;* Edit and send second. Choosing on the phone is how a host keeps the suggestions off the projector (SPEC risk 1).
11. **Request feedback disappears as a dock button; comments on the read live inside Ask the room?** *Recommend yes.* The participant's own Comment link already works on any results (owner ruling, 26 Sep), so the feedback round only adds the wall.
12. **Feature a comment from the Remote?** *Recommend yes, in step 9,* inside the panel's comments view; the same press as the host's meter.
13. **→ on the tally turns unread response pages first, as it does on the read?** *Recommend yes,* so one key means one thing. Risk: hosts used to → jumping to the read; the dock's status shows "Responses page 1 of 2" so the change is visible.
14. **The Remote's ENDED screen offers Open session report?** *Recommend yes,* the same primary as the host screen.
15. **The response stepper in VOTE?** *Recommend no.* Names are hidden and the room is choosing; one response enlarged during a vote tilts it. Enlarging the question stays available in every moment.
16. **Agree statements that read as fragments: mark or drop?** *Recommend mark under 5 words and sort last, drop under 4.* The 5479 run showed every round still had a sendable ask without them.
17. **The host dock's small line names who is still answering?** *Recommend only when the round's names setting allows it,* the same rule as the meter's U key. The Remote keeps its always-named list (owner ruling: who has not acted is a different fact from who wrote what), which stays a deliberate, documented difference.
18. **Back to Menu leaves the lobby dock?** *Recommend yes;* it stays in Session. The lobby is where a host most often realises they opened the wrong session (`hostControls.js:855-864`), so Session must be visible there; it is.
