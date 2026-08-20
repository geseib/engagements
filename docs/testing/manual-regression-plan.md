# Manual regression plan — host stage, queue, sessions, players, Workie

**Where:** https://engage.dev.seibtribe.us (dev). Sign in as the admin/host account.
**Setup:** Two browser windows side by side —

- **Host window:** a laptop browser, signed in, kept on the host stage.
- **Player window:** a phone, or an incognito window ~400px wide, used as the player. No sign-in needed.

**Question set:** any **call-and-answer** set with at least 3 categories and ~10+ questions. Call-and-answer runs the full ASK → VOTE → RESULTS → What We Heard cycle, which several scenarios below depend on (voting, anonymity, Workie). Do not use trivia or wavelength for the main run — they skip the vote phase.

**Session naming:** create throwaway sessions titled `QA 2026-08-20` (and `QA 2026-08-20 B` where a second one is needed) so they are easy to find and ignore later.

**Display profile:** leave it on **Room — projector** unless a step says otherwise. The answer-list page size on Room is 3, which the paging tests rely on.

Scenarios marked **[REGRESSION]** pin a bug fixed recently — a failure there is a reintroduction, not a new bug. Run the sections in order; later sections assume a session exists from earlier ones. Budget: 60–90 minutes.

Keys used in this plan: `Space` `→` `←` `↑` `↓` `\` `Esc` `Enter`.

---

## 1. Session lifecycle

### T1 — Create a session from scratch
**Steps:**
1. On the welcome screen, click **Create engagement**.
2. Confirm the dialog offers: Event title, Format pills (with a one-line blurb under the selected pill), Question set dropdown plus a "Your question sets" / "Make a question set" link, Anonymous responses (checked by default, with the two-card preview), Shuffle the question order, Event details (300-char counter), AI context (500-char counter), and Workie's voice defaulting to "Adapt to the session (recommended)".
3. Confirm **Create engagement** is disabled while title or set is missing.
4. Enter title `QA 2026-08-20`, pick your call-and-answer set. A category grid appears with per-category question counts. Leave all categories selected.
5. Fill Event details with one sentence (e.g. "QA run for the August release.") and AI context with: `Add a Star Wars character's perspective to each summary section.` (used again in section 7.)
6. Click **Create engagement**.

**Expected:** You land on the stage lobby with the session title on screen, a join QR, status "Waiting for players to join…", the primary button "Start First Question" (or the set's round noun) disabled with the hint "At least one player has to join first", and a **Back to Menu** secondary button on the dock.

### T2 — Create pre-populated with the last-used set
**Steps:**
1. From the lobby, dock **Back to Menu** (no players yet, so no confirmation should appear).
2. Click **Create engagement** again.

**Expected:** The Question set dropdown is already set to the set you just used; the category grid is already showing. Cancel with the × or Escape — nothing is created and no confirmation is asked.

### T3 — Edit a session before it starts (fields AND categories)
**Steps:**
1. Welcome screen → **Sessions**. Find the `QA 2026-08-20` row (state "Not started").
2. Click **Edit** (it should be the visually primary button on the row).
3. Confirm Format pills, Question set and Shuffle are **disabled** with the note that they are fixed once a session is created — visible but not editable.
4. Deselect **every** category. Confirm the helper reads "Select at least one category…" and **Save changes** does nothing when clicked.
5. Re-select all but one category, change the title to `QA 2026-08-20 edited`, tweak Event details, and pick a named Workie voice. Click **Save changes**.
6. Reopen **Edit** on the same row.

**Expected:** Every change persisted: new title, the deselected category still off, the details and voice as saved. The disabled fields still show the original format/set. Close without saving (×) — no warning, and no changes lost from step 5.

### T4 — Start and play one full round end-to-end
**Steps:**
1. In Sessions, click **Start** on the `QA 2026-08-20 edited` row.
2. Player window: scan the QR or open the copied player link (row's **Link** button), join with the name `Ana`.
3. Host: confirm `Ana` appears and the status becomes "1 player ready"; the primary button enables.
4. Press `Space` to start the first round. Player answers the question.
5. Host: status reads "1 of 1 answered" / "All 1 answered". Press `Space` → **Start Voting**. Player votes.
6. Press `Space` → **Show Results**. Tally appears. Press `Space` → **What We Heard** (Workie summary).
7. Press `Space` on the summary's last page → next round begins.

**Expected:** Each press advances exactly one beat, the player's phone follows every transition without a manual refresh, and the deselected category from T3 never supplies a question (check the category label on each question against the categories you left on).

### T5 — Back to Menu mid-session: the leave guard, Stay default
**Steps:**
1. Mid-round with `Ana` still joined, press `\` to open the session panel, go to Settings, and click **Back to Menu** (or use the dock's Back to Menu if visible).
2. A dialog "Leave this session?" opens. Without clicking anything, press `Enter`.
3. Reopen the leave route and press `Esc`.
4. Reopen once more and click the **Back to Menu** button inside the dialog.

**Expected:** The dialog says 1 person is in the room and that the session stays live. `Enter` **stays** (Stay in the session holds focus — "default no"), `Esc` stays, and only the explicit Back to Menu click leaves. After leaving, the player's screen keeps working.

### T6 — [REGRESSION] Leave and return to the SAME session
Pin for the "returning to the session you just left returned a wiped one" fix (sessionEpoch).
**Steps:**
1. From the welcome screen (just after T5), re-enter the **same** session: type its 4-digit code into "Rejoin a session" and Continue — or Sessions → **Continue** on its row.
2. Open the session panel → Questions tab.

**Expected:** The session comes back whole: categories present with correct on/off states and counts, the question browser populated, `Ana` still on the Players tab, and the current round exactly where you left it. The failure mode being pinned: blank categories, no questions, "not able to start session".

### T7 — Leave to a DIFFERENT session and back
**Steps:**
1. Create a second session `QA 2026-08-20 B` (any set), Start it, then Back to Menu (guard permitting).
2. Continue session A (`QA 2026-08-20 edited`). Verify it is intact as in T6.
3. Back to Menu, Continue session B.

**Expected:** Each switch shows only the target session's title, question, categories and players — never a mix. No flash of session A's content while session B loads.

### T8 — [REGRESSION] Creating a session must not destroy the one on stage
Pin for "creating a session deleted the one on stage" and the colliding-id overwrite fix.
**Steps:**
1. With session A live and `Ana` joined, leave to the menu and create a brand-new session `QA 2026-08-20 C`.
2. Watch the player window (still in session A) while C is created.
3. Go to Sessions and Continue session A.

**Expected:** `Ana`'s screen never errors or resets during C's creation. Session A still lists in Sessions with its rounds/players intact and Continue restores it fully.

### T9 — Continue a played session / ended-session exit
**Steps:**
1. In session A, keep advancing rounds until the set (with your category selection) runs out and the stage reaches its end state.
2. Read the dock.
3. Click **Open Session Report**; close it.
4. Click **Back to Menu**.

**Expected:** The end screen says "All rounds played" — it must NOT say "Waiting for players to join…". The primary is **Open Session Report** and the report opens with every round, responses, scores and summaries. Back to Menu from ENDED leaves **without** the leave-guard dialog. In Sessions the row now reads "Played" with **Report** and **Continue** buttons.

---

## 2. Settings changes mid-session

Use a fresh session `QA 2026-08-20 mid` with all categories on and one player joined.

### T10 — Category toggles mid-session govern the automatic picks
**Steps:**
1. `\` → Questions tab. Note the Categories list with per-category unasked counts.
2. Switch one category **off**. Watch the "Running order" panel's "Coming up" (Auto) rows.
3. Play two rounds.
4. Switch it back on.

**Expected:** After the toggle, no Auto row and no served round comes from the off category; the preview refreshes within a couple of seconds of the toggle (it re-fetches, no reload needed). Rounds already played from that category stay in Rounds/results. Switching it back on returns its questions to the Auto walk.

### T11 — [REGRESSION] A queued one-off from a switched-off category is still served, labeled "Category off"
Pin for "it should not skip it. assume it's a 1 off". **Steps:**
1. Questions tab: find a question in category X, click **Queue**.
2. Toggle category X **off**.
3. Look at the Running order row for the queued question.
4. End the current round (advance to the next round).

**Expected:** The queued row keeps its position, keeps its **Next** flag, and gains a **"Category off"** tag — it is not moved to a blocked/parked state. The next round **asks that exact question**. After it, automatic picks still avoid category X.

### T12 — Anonymity setting, before and during
**Steps:**
1. During ASK/VOTE with anonymity ON (the default from create), look at the projector's answer cards and the player's own screen.
2. Close voting → RESULTS.
3. `\` → Settings tab: find the anonymity control, switch it so answers are named from the moment voting opens, and play another round to VOTE.

**Expected:** With anonymity on: answers show as "Response 1", "Response 2" (no names) through ASK and VOTE, and names + points appear once voting closes. After flipping the setting: the next round's answers are attributed as soon as voting opens.

### T13 — Workie voice/persona switch mid-game
**Steps:**
1. Reach a **What We Heard** screen. Find the persona/voice picker on that screen (or Settings tab).
2. Switch from the current voice to a clearly different persona (e.g. The Session Advisor).
3. Regenerate / advance to the next round's What We Heard.

**Expected:** The next summary is unmistakably in the new register (e.g. Session Advisor names disagreement and assigns an owner). The choice sticks for the rest of the session. No error, no blank summary.

### T14 — Event details and AI instructions reach both the player and Workie
**Steps:**
1. Confirm the Event details sentence from create/edit appears on the **player's** post-join landing screen.
2. Read the next What We Heard summary.

**Expected:** The summary visibly reflects the session facts (the event details) and the AI-context instruction — for the full per-section check see T39–T42.

---

## 3. Running order / queue

Stay in `QA 2026-08-20 mid`, session panel → Questions tab. The queue section is headed **Running order**.

### T15 — Empty queue explains itself; queue several questions
**Steps:**
1. With nothing queued, read the Running order section.
2. Queue three different questions with each row's **Queue** button.

**Expected:** Empty state reads "**Queue** adds a question to the running order — it waits until you end the current round. **Ask next** puts it on screen straight away." plus "Nothing queued". After queueing: "3 queued", numbered rows 1–3, row #1 carries a **Next** flag, each row shows its category, and each browser row now shows "Queued #n" with its button flipped to **Unqueue**. Below the queue, "Then, automatically" lists the Auto-tagged rows with their categories.

### T16 — Reorder with ↑ ↓; buttons stay aligned
**Steps:**
1. On queued row 2, click the ↑ button. Then click ↓ on row 1.
2. Look at the edges: row 1's ↑ and the last queued row's ↓.
3. Compare the four-button column on queued rows with the four buttons on Auto rows.

**Expected:** Moves swap adjacent rows; the **Next** flag follows whatever is genuinely first. Edge buttons are **disabled, not missing** (the column never changes width). Queued rows and Auto rows show the same four aligned slots — on Auto rows the fourth (X) is present but inert with the tooltip "Not in the queue — nothing to move out."

### T17 — Moving an AUTO row makes the whole displayed plan manual
**Steps:**
1. Clear the queue (X on every queued row) so only "Coming up" Auto rows show.
2. Click ↑ or ↓ on the second Auto row (hover first: its tooltip warns the whole listed order becomes manual).

**Expected:** After a moment every previously displayed Auto row re-renders as a numbered **queued** row (fully editable, no Auto tag), with your move applied. The queue count now equals the number of rows that were displayed.

### T18 — Disable a question; it is never asked; it is restorable
**Steps:**
1. Note the title of the current #1 (Next) row. Click its **eye-slash** (Disable) button.
2. Find the "**Disabled this session**" section below the running order.
3. Play a few rounds (or scan the whole preview).
4. Click the **eye** (Restore) button on the disabled row.

**Expected:** The question moves out of the queue/plan into "Disabled this session" with the tag "Will not be asked". It never appears in Up Next and is never served while disabled. Restore returns it to play — it reappears in the automatic order.

### T19 — Move a queued row back out (X)
**Steps:**
1. Queue a question, then click its **X** button (tooltip: "Take it out of the queue. It goes back to the automatic order…").

**Expected:** The row leaves the numbered queue and the question shows up again among the Auto rows (position decided by the automatic walk) — it is not disabled and not lost.

### T20 — Queue full at 24
**Steps:**
1. Queue questions until the count approaches the cap (from 20 up the count should read "n queued of 24").
2. Reach 24 and try to queue one more; also try an Auto-row move.

**Expected:** At 24 the line "The queue is full at 24. Remove one to add another." appears; further queue attempts are refused (the Auto move shows an alert naming the 24 limit). Removing one re-enables queueing. Clear the queue afterwards.

### T21 — [REGRESSION] Preview equals serve; nothing is asked twice
Pins "the running order listed is not actually used" and "items you queue up and ask … get asked again". **Steps:**
1. Queue 2 questions and write down the first **4** rows of the running order (2 queued + first 2 Auto), in order.
2. Play 4 rounds without touching the panel.
3. Keep playing several more rounds while watching for repeats.

**Expected:** The 4 rounds ask exactly the 4 noted questions, in that order. A queued question, once asked, disappears from the queue and is **never asked again** later by the automatic walk — no question title repeats anywhere in the session.

### T22 — Ask next vs Queue
**Steps:**
1. Mid-ASK, pick an unasked question in the browser and click **Ask next**.
2. Answer the confirmation ("Skip to Selected Question?") with Skip.
3. Separately, Queue a question mid-ASK and confirm nothing happens until you end the round.

**Expected:** Ask next interrupts — after confirmation the chosen question goes on screen immediately, abandoning the current round. Queue never interrupts: the round in progress continues and the queued question arrives only at the next end-of-round.

---

## 4. Keyboard / stage mechanics

### T23 — Space and → advance; holding a key does not double-advance
**Steps:**
1. On the results tally, tap `Space` once; on the next beat tap `→` once.
2. On a results tally, **hold** `Space` down for two seconds.

**Expected:** Each tap advances exactly one beat. Holding the key advances **once** only (auto-repeat is ignored) — it must not blow through What We Heard into the next round.

### T24 — [REGRESSION] → pages inside the Workie readback before advancing
Pin for "hosts tend to skip the extra pages of the workie response by hitting the right arrow". **Steps:**
1. Reach What We Heard on a round with enough responses that the summary spans multiple pages (the pager line shows "page 1 of N"; if N = 1, switch display profile to **TV** in Settings to shrink the page budget, then retest).
2. Press `→` repeatedly.

**Expected:** Each `→` turns a page (Summary → Discussion Questions → Next Steps…), the pager shows the section name and page count; only on the **last** page does `→` start the next round. Clicking the dock's **Next** button, by contrast, advances immediately from any page.

### T25 — [REGRESSION] ← steps back — pages, then back to results
**Steps:**
1. On page 2+ of What We Heard, press `←`.
2. On page 1, press `←` again.
3. If you have the phone remote open, watch it during step 2.

**Expected:** `←` first pages backwards; on the first page it returns the stage to the RESULTS tally (and the remote follows the step back). From the tally, `Space` re-opens What We Heard.

### T26 — ↑ ↓ page long answer lists
**Steps:**
1. Run a round with 4+ answers (join a second player, or answer as several people via multiple incognito windows). On the vote/results answer list, read the pager line.
2. Press `↓` then `↑`.

**Expected:** On Room profile only 3 responses show per page with a line like "Responses 1–3 of 4 · page 1 of 2 · ↑ ↓ to page". `↓`/`↑` turn pages; the response numbering continues across pages (page 2 starts at "Response 4", matching the numbers on players' phones — never restarting at 1).

### T27 — Keys go dead while an overlay is open; the Space chip disappears
**Steps:**
1. On any advanceable beat, note the small **Space** chip beside the dock's primary button.
2. Open the expanded/pinned QR (or the Sessions overlay, or a confirmation dialog). Press `Space` and `→`.
3. Close the overlay.

**Expected:** While the overlay is open the Space chip is **gone** and the keys do nothing — the round does not advance. Closing it brings the chip back and the keys work again.

### T28 — Keys decline typing targets and the session panel
**Steps:**
1. Open the session panel (`\`), click into the question search box, and press `Space` and `→`.
2. Tab to a button inside the panel and press `Space`.

**Expected:** Typing gets the characters; the round never advances from a key that landed inside the panel or a text field. The focused panel button activates normally (the accelerator does not steal it).

### T29 — Key legend line matches the phase
**Steps:**
1. Compare the small key-hint line under the dock buttons across beats: plain rounds vs What We Heard.

**Expected:** On What We Heard the hint reads "→ next page · ← back · at the end, → starts the next round". On other beats there is no misleading paging hint. The primary button's tooltip says "Space or → also advances".

---

## 5. Sessions list

Welcome screen → **Sessions**.

### T30 — Two-button rows and alignment
**Steps:**
1. Find one "Not started" row and one "Played" row and compare their action buttons.

**Expected:** Not started: **Edit** (primary) + **Start**. Played: **Report** + **Continue** (primary). Never three verbs, never an "Open". Every row also carries **Link** and **Invite…** on a second line, so the buttons form a fixed 2×2 grid that lines up down the whole table — no staggering between rows.

### T31 — Link and Invite
**Steps:**
1. Click **Link** on any row; paste the clipboard into the player window.
2. Click **Invite…**.

**Expected:** Link copies a working player URL for that specific session code. Invite opens its share/invite flow for that session (title included).

### T32 — Search
**Steps:**
1. Type part of a session title in "Search sessions"; then a 4-digit code; then gibberish.

**Expected:** Rows filter live on title/code/host/set; the count reads "n of m". Gibberish shows "No session matches that search." — distinct from the no-sessions-at-all message. Clearing the box restores all rows.

### T33 — On stage / Latest flags, state and counts
**Steps:**
1. With a session open on the stage, open Sessions and find that row; also find the newest row.

**Expected:** The session currently loaded is flagged **On stage**; the newest row (when not the current one) is flagged **Latest** — never both on one row. State chips are words ("Played" / "Not started"). Player/round counts show a number or an em dash — never a misleading `0` for a row whose counts could not be read.

---

## 6. Players

Use a live session with the QR up.

### T34 — Join by QR; player count on stage
**Steps:**
1. Player window: scan/open the QR, join as `Ben`.
2. Host: check the stage's player count and the Players tab.

**Expected:** `Ben` appears in the Players tab within a couple of seconds, and the on-stage player count increments. The lobby status updates ("2 players ready").

### T35 — Answer and vote
**Steps:**
1. Start a round. Have each player answer; watch the host's "n of m answered" counter.
2. Open voting; have players vote; watch "n of m voted".

**Expected:** Counters track submissions live. During voting a player cannot identify authors (anonymity on). Votes drive the results ranking and scores.

### T36 — Host removes a player
**Steps:**
1. Mid-ASK with one player deliberately not answering, Players tab → **Remove** on that player.
2. Check the answered counter and, after the round, the results and Rounds tab.
3. Have the removed player rejoin with the same name.

**Expected:** The counter shrinks (e.g. "1 of 2" → "1 of 1") and the room is no longer held up. Everything they contributed **stays** — past answers, votes, points, and their place in the report. Rejoining with the same name restores them with score intact.

### T37 — Name takeover flow
**Steps:**
1. In a second player window, try to join with an already-taken name (`Ana`).
2. On that screen, tap "Ask the host to hand it over".
3. Host Players tab: the row reads "asking to take this name" — click **Let them take it**.
4. Row now reads "unlocked for one handover". New device: tap "Take over the name".
5. Try joining with `Ana` from a **third** window.

**Expected:** The new device gets in as `Ana` with her score. The unlock is spent by that one handover: the third window is blocked again (offered "pick a different name" / ask-the-host, not a silent takeover). Also verify the host can pre-emptively **Unlock name** without a request.

---

## 7. Workie output quality spot-checks

Run against a session created with AI context `Add a Star Wars character's perspective to each summary section.` and a real Event details sentence (from T1). Read at least two What We Heard summaries.

### T38 — [REGRESSION] Host AI instructions influence EVERY section
**Steps:**
1. Read each section of the summary (default shape: Summary, Discussion Questions, Next Steps) and check each one for the Star Wars perspective.

**Expected:** **Every** section — not just the first — contains at least one sentence delivering the instruction. An instruction honored in one section and dropped in the rest is the pinned failure.

### T39 — Event details are reflected
**Steps:**
1. Look for the session's stated purpose woven into the summary's content.

**Expected:** The reply reads as being about *this* session — the event details sharpen at least one point. A summary that could be about any meeting fails.

### T40 — No canned openers
**Steps:**
1. Read the first words of every section across both summaries.

**Expected:** No section opens with "Overall", "It's clear that", "Great discussion", "In summary", or a restatement of the question just shown. Sections start with something specific from the room's actual answers. No sign-off, no "here's what I'll do" narration, at most one exclamation mark per reply.

### T41 — [REGRESSION] The reply starts with its first heading
**Steps:**
1. Look at the very top of the rendered summary, and at the pager's section names.

**Expected:** The first thing in the reply is its first `##` section heading — no title line, preamble or greeting above it. The headings match the promised set exactly (the pager names them), and no raw markdown characters (stray `|`, `#`, `**`) reach the projector.

---

## Wrap-up

- Return every category toggle to on and clear any leftover queue in the QA sessions.
- The `QA 2026-08-20*` sessions can be left to expire (90-day TTL) or ignored.
- Log any failure with: scenario id, the session's 4-digit code, and what the screen said vs the Expected line.

**41 scenarios, T1–T41. Regression pins: T6 (same-session return wipe), T8 (create deleted the session on stage), T11 (queued one-off from an off category), T21 (preview vs serve / re-asked questions), T24–T25 (arrow keys inside What We Heard), T38 and T41 (Workie instruction authority and heading start).**
