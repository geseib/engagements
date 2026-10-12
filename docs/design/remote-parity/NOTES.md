# Host Remote parity: notes

Owner, 2026-10-12, on dev, running a Call & Answer session from the Host Remote on a phone. Five needs: two gaps (names, Workie's pages), two additions (the question, host notes) and one placement for later work (follow-up asks). Mockups: `index.html` beside this file. Read against `working/build-room-host-redesign` at `3845646e`. No product code changed.

How the Remote talks to the server matters for every item below. It holds **no WebSocket** (`HostRemote.jsx:57-80`). It polls `GET /games/{id}/host-state` every 2 s (`HostRemote.jsx:84`, `:373-415`, signed in), `GET /games/{id}/players` every 6 s (`:85`, `:422-440`, plain fetch) and the AI summary every 4 s while it waits (`:96`). Everything it learns, it learns at the next poll.

---

## 1. Names: Unlock, Let them take it, Not now, Lock again, Remove, Bring back

### What exists

| Control | Host screen (Call & Answer) | Build Room host | Remote |
|---|---|---|---|
| Players list: rank, name, points, tick | `SessionSetupPanel.jsx:543` (shared `PlayersList`) | `BuildSessionPanel.jsx` | `RemoteSessionPanel.jsx:210-256`, read-only |
| Remove | `GameHostPage.jsx:3305` `setPlayerRemoved`, wired `:7822` | `BuildSessionPanel.jsx:329` | **no** |
| Bring back (and the removed list) | `:7823`, `PlayersList.jsx:237-266` | yes | **no**, and the list is never drawn |
| Unlock name / Let them take it | `:3335` `grantNameHandover`, wired `:7824` | `:323-324` | **no** |
| Not now | **no** (`SessionSetupPanel` passes no `onRefuse`) | `:326` | **no** |
| Lock again | **no** (no `onLock`) | `:325` | **no** |
| "Asking to take this name" flag | only if the Players tab is open (`PlayersList.jsx:121-125`) | yes | **no** |
| Request strip | **no** | `HandoverStrip`, `BuildSessionPanel.jsx:112-139` | **no** |

So the Remote today offers **none** of the name controls. The owner's report says "on remote I can manage players, like remove them": that is not what the code does. The Remote's Players tab has no button on any row. The removing must have happened on the host screen.

The Remote **never shows a handover request**. The request does reach the Remote's data: `request-handover.js:109` stamps the row, `get-players.js:236` publishes `handover: { open, requested, requestedAt }` (`handover.js` `publicHandoverState`), and the Remote fetches that every 6 s. But `rosterListing` (`config/hostRemote.js:711-750`) maps each player to `{ name, score, answered, voted }` (`:722-731`) and hands `rosterRows` only `{ name, score }` (`:737`), so the handover state is dropped, and `removedPlayers` is never read at all.

### Root of the gap

**Missing UI only.** Every route exists and accepts the session's host from any device:

- `POST /games/{id}/players/{name}/remove` `{ removed }` (`remove-player.js`, Cognito + session-owner check at `:93`)
- `POST /games/{id}/players/{name}/handover` `{ bindToRequester }`, `{ lock: true }`, `{ refuse: true }` (`grant-handover.js`, Cognito, `:106`)

The Remote already signs its calls with `authFetch` and already polls the roster with the flags in it. No backend change, no template change.

### Smallest change

1. `config/hostRemote.js` `rosterListing`: pass `handover` through to `rosterRows` (which already turns it into `handoverRequested` / `handoverOpen`, `config/setupPanel.js:305-313`), and return `departed` from `removedPlayers`. Add `askingNow(roster)` for the strip.
2. `RemoteSessionPanel.jsx` Players tab: a **More** button per row that opens that row's actions in place, one row at a time (mockup A2). Verbs by state, as `PlayersList` does where `onLock`/`onRefuse` are wired: asking → Not now / Let them take it / Remove; unlocked → Lock again / Remove; plain → Unlock name / Remove. People asking first, under their own heading. Removed people below, with Bring back. Do not reuse `PlayersList` itself: its markup is the host panel's table-like grid with `setup-roster__*` classes; reuse its **rules** (one state, its own verbs) and its words.
3. `HostRemote.jsx`: a request strip above the status card when anyone is asking (mockup A1). One person: name, here or away, joined time, Not now / Let them take it. Two or more: a count and Open Players.
4. Every action: `authFetch`, then re-read `/players` at once (do not wait 6 s), and on a non-2xx show the server's own `message` in the existing `hr-flash` (mockup A1 frame 3).
5. Remove gets no confirm; the notice carries Bring back (mockup A3). Removal is soft and the host screen does not confirm either.

Optional, same change or next: wire `onLock` and `onRefuse` in `SessionSetupPanel` so the host screen has the verbs the Remote will have (open question 1), and give the host screen a strip outside the Build Room (open question 2).

### Risks

- **A request shows on both screens.** Whoever answers first wins; the server decides. Checked in `grant-handover.js`:
  - a late **Let them take it** after Not now: the request marker is gone, so `bindToRequester` with no `requestedBy` returns 409 "Nobody has asked to take over…" (`:244-253`). Nothing is opened.
  - a late **Not now** after a grant: the conditional update fails, 409 "That request has already changed. Look again." (`:216-225`).
  - a late **Lock again** after the name was taken: 409 "…is not unlocked, or has already been taken." (`:148-160`).
  - One real race remains: the grant reads `HandoverRequestedBy` and then writes without a condition on it (`:135`, `:270-281`), so if a *second* device asks between the read and the write, the grant binds to the first asker. Narrow (milliseconds) and the outcome is still a grant to someone who asked. Not worth fixing for this.
- **Staleness on the phone.** The host screen hears `playersChanged` / `handoverRequested` on its socket (`GameHostPage.jsx:2148-2171`); the phone only polls. A strip can stay up to 6 s after the host screen answered it. The 409 path above makes a tap in that window harmless, provided the phone shows the message and re-reads.
- **Remove while Unlocked.** Remove does not close an open grant. Same as the host screen today; leave it.
- **Design rule.** The shipped `.hr-btn--danger` colours its text `var(--danger)` (`HostRemote.css:473-477`), which engage-design forbids (4.38:1). The new Remove should use `--danger-text`; fix the existing class in the same change.

---

## 2. Walking Workie's pages from the Remote

### What exists

**Host / Stage** (one page, `GameHostPage.jsx`):
- The page index is `const [stagePage, setStagePage] = useState(null)` (`:429`), one index for RESULTS answers and for Workie's read, keyed `${hostPhase}#${round}` so it resets for free (`:405-428`, `:6736-6750`).
- Workie's read is cut by `prosePageSlice(markdown, index, proseBudgetFor(profile))` (`config/stagePaging.js:275`, `:530`). **The page count depends on the display profile** (Room, TV, Call, Table), which only this page knows.
- → turns the page before it advances (`interceptAdvance`, `:7069-7080`); ← steps back through pages, then to the tally (`onBackKey`, `:7089-7110`).
- The dock: with pages left the primary is **Next Page** and the status reads "Reading page N of M" (`config/hostControls.js:598-605`, `:662-664`), fed by `notesPage` / `notesPages` (`GameHostPage.jsx:6133-6143`).
- Auto-mode turns the same index (`:5664-5700`).
- Nothing is published. There is no route, no stored field and no socket frame for the page.

**Remote**:
- Knows the beat from `/host-state` `stageBeat` (`HostRemote.jsx:472`, `get-game-state.js:169-216`) and shows What we heard as lead, topics and next steps from the summary JSON (`HostRemote.jsx:1329-1353`, `fieldNotesFrom`). Not the pages; no position.
- Its primary on `field-notes` is **Next round** (`config/hostRemote.js:213-215`). So the phone's big button **skips every unread page**, the exact fault the host screen's → was changed to prevent ("host tend to skip the extra pages of the workie response", `GameHostPage.jsx:7061-7068`).

### Root of the gap

**Page state is local to the host page and cannot be driven remotely.** The beat and the spotlight had the same problem and were fixed the same way: a fact on the round's `ROUND#nnn` record, written by a host-only route, broadcast to host sockets, read back by `get-game-state` (`stage-beat.js`, `stage-focus.js:1-46`). The page is the one Stage decision left out.

### Smallest change

Extend `POST /games/{id}/stage-beat` rather than add a route (the stack is near its 500-resource ceiling; this adds nothing to the template):

1. **Store.** On `ROUND#nnn`, beside `StageBeat`: `StageNotesPage` (int), `StageNotesPages` (int, written only by the stage), `StageNotesRev` (int). UPDATE, never PUT, for `stage-focus.js`'s reason.
2. **Write, two shapes on the same route**, both only when the round is on `field-notes`:
   - the **stage** sends `{ beat: 'field-notes', questionNumber, notesPage, notesPages }` whenever it turns a page (key, dock, auto-mode) or its page count changes (profile switch, read arrives);
   - the **phone** sends `{ beat: 'field-notes', questionNumber, step: 'next' | 'prev' }`. The server applies the step to the stored page, clamped to `[0, pages - 1]`; with no stored count it refuses (409), because only the wall knows how much fits. The step never advances the round and never leaves the beat: that is the phone's ordinary Next round / Back to the scores.
   - `scoreboard.js` already pages from the phone this way (`config/scoreboard.js:36-37`, `step: 'next' | 'prev'`), so this is a known shape here.
3. **Tell.** Broadcast `stageBeatChanged` with `notesPage`, `notesPages`, `rev`. The host page applies it with `setStagePage({ key: 'FIELD_NOTES#' + round, index })` when the frame is for its round (`stageBeatFromFrame` already drops other rounds, `GameHostPage.jsx:2301-2307`) and `rev` is newer than the last applied. It never re-publishes what it received (the no-loop rule in `publishFocus`, `:6819-6823`).
4. **Read.** `get-game-state.js` returns `stageNotes: { page, pages }` beside `stageBeat`.
5. **Remote.** On `field-notes` with `pages > 1` (mockups B1, B2): position and dots from `stageNotes`, the page's text, **Next page** as the primary until the last page, then **Next round**; **Back a page**; a plain **Skip to next round**. With no count yet, today's behaviour, unchanged (mockup frame 9).
6. **Showing the page's text on the phone** (open question 8) needs the stage to publish its `profile` too, so the phone can call the same `prosePageSlice` on the same markdown with the same budget. Without it, show only position and dots.

### Risks

- **Two hosts paging at once.** The phone sends steps, the stage sends absolute pages; the server serialises both on one record and `rev` orders the frames. Two presses on two devices turn two pages, which is what two people pressing meant. The stage's own turn is optimistic (it does not wait for the round trip), so its echo carries the page it already shows: no flicker.
- **Who wins.** The server's record. Apply a frame only if its `rev` is newer.
- **The page count belongs to the wall.** If two host pages are open with different profiles, the last one to publish sets the count; the server clamps. Recommend: only a host page that is actually showing the Stage publishes `notesPages`. Say so in the code.
- **Auto-mode.** It turns pages through `setStagePageIndex` (`:6757-6761`); route that through the same publish so the phone follows. A phone press changes `stagePage`, which already restarts auto-mode's dwell timer (`:5711`).
- **The phone lags up to 2 s** (its state poll). It must draw the server's page, never its own guess, and its step is relative to the server's page, not the one it last drew.
- **Fit.** `fitKey` already includes the raw index (`:6739-6745`); a page applied from a frame refits as a key press does.

---

## 3. The question, in a folding section

### What exists

- The Remote shows the round as "Round 3 / Collecting responses" (`config/hostRemote.js:851-863`). The question's **title** appears only inside the Enlarge panel (`HostRemote.jsx:1476-1477` → `RemoteFocusPanel.jsx:73`).
- The phone **already holds** the rest. `/host-state` is the same handler as the public `/state` (`get-game-state.js`, template comment at `template-clean.yaml:3836-3847`), and its body carries `currentQuestionData` built at `get-game-state.js:302-347`: `title`, `detail`, `customInstructions` (the task), `category`, `image`, the trivia options and, from RESULTS, `correctAnswer`, plus a poll's options.
- **Background** (the question's author's notes for Workie) is not sent to any screen. By the 2026-09-25 decision it is "seen by Workie and admins only" (spec `docs/superpowers/specs/2026-09-25-question-background-design.md`).

### Root

**Missing UI only**, for title, detail and task. Background and an early trivia answer would each need one field added on the host branch of `get-game-state.js`.

### Smallest change

A folded section under the status card, folded by default, open state remembered per session in `localStorage` (mockups C1, frames 10-12). Reads `snapshot.currentQuestionData`; draws only the parts that have words. No new fetch for the three that exist. For trivia, the options; the answer marked once the server sends it.

### Risks

- `/host-state` and `/state` share one body. Anything added for the host must be added inside the host branch, with a test that the public body never gains it. `get-game-state.js:315-331` records the incident where the trivia answer leaked on the public route.
- Background on the Remote reverses part of a recorded decision; it is an owner call (open question 10).

---

## 4. Host notes from the Remote

### What exists

- **Players comment** through `POST /games/{id}/comments` (`comments.js:332` `writeComment`): public route; the name must be a joined `PLAYER#` row, with its `ClientId` when one is stamped (`:400-413`); the session must be on `RESULTS#<that round>` (`:436-441`); the anchor is one of `summary | results | response` (`comment-keys.js:53`, mirrored `src/src/config/comments.js:47`); up to 1000 characters; encrypted at rest; 30-day TTL; broadcasts `commentPosted`.
- Where they appear:
  - the room's feedback panel (`FeedbackRoundPanel.jsx`, read with `GET /comments`);
  - the Stage's arrivals strip during the feedback beat (`RoomMeter`), and the wall when the host features one (`POST /comments/{id}/feature`, Cognito, `comments.js:765`);
  - both reports, per round, under **Comments** (`create-report.js:250-277`; `GameReport.jsx:375-410`; `RoundReport.jsx:77`), with the anchor, the excerpt, the author (absent on a hidden-names round) and "Shown to the room" when featured.
- There is no separate "notes" section in either report. The round's Comments block is where a note would print.
- The host has no way to write one, on any screen.

### Root

**Missing route and UI.** The player route cannot serve the host: it requires a joined player name and the round's results to be on screen, and it is public, so it cannot know the caller is the host.

### Smallest change

1. **Route.** A new Cognito event on the existing comments function: `POST /games/{id}/comments/host`, checked with `callerMayDriveSession` like `/feature`. No new function (followups.js set the same precedent); one route, about two stack resources. Count them first.
2. **Row.** The same `COMMENT#nnn#…` key and shape, with `AuthorRole: 'host'`, no `playerName`, no `ClientId`. Any round the session has started (its `ROUND#` record exists), in any phase. Anchors: the existing three, valid once that round has results, plus a new `question` anchor for a note written while answers are coming in (open question 15). `question` added to the closed set in both copies in one change.
3. **Room.** An optional flag `shareWithRoom`. On: the note appears in that round's feedback panel labelled **Host**. Off: reports only. Never in the arrivals strip on its own; the host can Feature it, and the wall credits it to "Host". (Open question 13.)
4. **Report.** `create-report.js` passes `authorRole`; `GameReport` and `RoundReport` print host notes first in the round's Comments, labelled **Host note**, never with the account's name or email (mockup frame 15). Not affected by the round's hidden-names setting: the host is not a participant.
5. **Remote UI.** **Add a note** on the round view, in every phase (mockup C1/D1). A sheet: the round (default the one on the wall; earlier rounds from the list the Rounds tab already loads), About (question / results / Workie's read / a response; the last three greyed until that round has results), the text, the room switch, Post note. X and Cancel through one close that asks first when there is text.

### Risks

- A note posted in a round the room has left goes to the reports only; the switch must say so (mockup frame 14), not silently ignore it.
- A response anchor on a hidden-names round must not name the person on the phone's picker (the Remote already follows this for Enlarge, `HostRemote.jsx:1478-1490`).
- No delete exists for any comment. A host note posted by mistake stays. Adding a delete brings in the audit write the delete rule requires (owner, 2026-10-04). Open question 14.

---

## 5. Follow-up asks on the Remote (placement only, not designed here)

Backend on dev behind `FOLLOWUP_ASKS_ENABLED`: `lambda-functions/game/followups.js`, served by the comments function, host family `/games/{id}/followups/{proxy+}` (Cognito) and phone family `/followup-play/{proxy+}` (`template-clean.yaml:4189-4220`). No UI. The spec (`docs/design/ca-followup-asks/SPEC.md` §4.3 F1-F2, §12) already says: on the last page of What we heard the dock's second button becomes **Ask the room…** with a ready count, and the Host Remote offers the same, as a **sheet**; the smallest version gives the Remote only Show results, Cancel the question and Next round for a live ask.

Where it sits on the Remote (mockup E1): the plain button directly above the primary, in the dock, on the last page of the read. That spot exists only once item 2 lands, because today the Remote has no notion of "the last page".

Shared pieces the later build should use, so the host screen and the Remote do not drift:

- **The dock's decision.** `hostControls.js` (PLAN T14) decides the second button; the Remote's `primaryAction` (`config/hostRemote.js:177`) should read the same rule, not restate it. Add the `ask` beat to `BEATS_PAST_THE_READ_BACK` in the same change (PLAN T1).
- **The list and editor.** `FollowUpPanel.jsx` (PLAN T15) should take its container as a prop, drawer on the host page, sheet on the Remote, rather than the Remote growing its own copy.
- **The words.** `config/followUpWords.js` (PLAN T13), used by both.
- **Paging.** The ask beat follows `field-notes`; the page publish in item 2 decides when "last page" is true on both screens.

---

## Open questions (with a recommendation each)

1. **Host screen gains Not now and Lock again?** Yes: two props on `PlayersList` in `SessionSetupPanel`, same route, so the phone never offers a verb the projector lacks.
2. **Host screen request strip outside the Build Room?** Yes: in Call & Answer a request is visible today only if the Players tab is open. A one-line strip above the dock, never on the Stage the room reads, since it names a person.
3. **Both screens answer one request: who wins?** The server, first write. Show its sentence on the loser and re-read. No locks.
4. **Phone roster poll: keep 6 s?** Yes; re-read at once after any action.
5. **Remove: confirm or undo?** Undo (mockup A3).
6. **Paging: new route or the beat's?** Extend `/stage-beat`; no template change.
7. **Who counts pages?** The stage. The phone sends steps only.
8. **Page text on the phone?** Yes, if the stage also publishes its profile; otherwise position and dots only.
9. **RESULTS answer pages from the phone too?** Not now; same mechanism later, keyed by phase.
10. **Background on the Remote?** Yes for the session's host, Remote only, marked private, added on the host branch of `get-game-state.js` only. This changes the 2026-09-25 decision ("Workie and admins only"); owner to confirm.
11. **Trivia answer on the Remote during the round?** Yes, host branch only, with a test that the public `/state` never carries it before RESULTS.
12. **Host note: new route or the player route?** New Cognito event `POST /games/{id}/comments/host` on the comments function.
13. **Does a host note reach the room?** A switch, on by default while that round's results are up; the room's feedback panel shows it labelled Host. Never on the wall unless featured.
14. **Can a host note be deleted?** Not in the first version.
15. **A `question` anchor?** Yes, written only by the host route.
16. **Report label?** "Host note", first in the round's Comments, no name.
