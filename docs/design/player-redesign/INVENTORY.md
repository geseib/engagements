# The player's screen — full element inventory

**Subject:** `src/src/PlayerPage.jsx` (2,340 lines) and everything it renders.
**Date:** 2026-08-09 · **Branch:** `dev` · **Companion:** [`RATIONALE.md`](RATIONALE.md), [`index.html`](index.html)

This is the accounting that had to come before any design. It is modelled on §2 of
`docs/superpowers/specs/2026-08-08-host-screen-redesign-design.md`, which found the same fact
stated six times in one viewport on the host screen. The player's screen has fewer duplicates
than that — and four states that cannot render at all, one that renders a blank page, and one
whose only remedy for a lost connection is a button that destroys unsaved work.

Verdicts:

- **KEEP** — the player needs this, on their own device.
- **MOVE** — this is the room's, not the player's; it belongs on the shared screen.
- **REDUNDANT** — the same fact is already stated elsewhere in the same viewport.
- **CUT** — should not exist on this surface at all.
- **BROKEN** — does not do what it appears to do. Cited with the mechanism.
- **MISSING** — the state machine reaches it; no design does.

---

## 1. Persistent chrome — rendered in every joined state

| Element | Where | Verdict | Why |
|---|---|---|---|
| `player-info-external` → `player-name` | `:1574` | **KEEP**, reduced | Confirming *which* identity you are joined as is the one thing that matters when a room shares a phone or a name was mistyped. One line, not a bar. |
| `player-info-external` → `game-id` "Game: 4821" | `:1575` | **REDUNDANT** | You are already in. The code's only two jobs are getting in (join screen) and telling a neighbour how to get in — and the neighbour reads it off the projector, where the host spec (§5.1) pins it in every state. |
| `player-info-external` → `round-number` | `:1576–1581` | **KEEP** | Useful, but it renders only when `currentQuestion` is non-null, so it vanishes in exactly the states where a player is most disoriented — between rounds, and after a reconnect that has not yet re-fetched. |
| `websocket-indicator` — "Connected" / "Not Connected" | `:1582–1598` | **BROKEN** | `onClick={() => window.location.reload()}`, plus the same on `Enter` and `Space`. A full-page reload is offered as the remedy for a bad connection — to a player who may be mid-sentence in a textarea, whose contents are held in React state and nowhere else. The one moment the control is most likely to be pressed is the one moment it destroys work. The `title` attribute even invites it: *"Live connection is healthy — tap to reload"*. |
| `rejoin-notification` "Welcome back! Your previous game state has been restored." | `:1601–1605` | **BROKEN** | It claims a restoration it does not verify, disappears after 5s (`:479–484`), and says nothing about *what* was restored. See §7 — in the worst case it is displayed over a blank page. |
| Parallax hero — 3 external `.webp` layers from `cdn.prod.website-files.com` + the word "Engagements" | `:1608–1623` and again at `:1481–1496` | **CUT** | Three cross-origin images, `loading="eager"`, at the top of the DOM, on a conference Wi-Fi, above the question — on the smallest screen and the slowest connection in the building. It is also the same decorative hero the host spec already cut from the stage, and the same external CDN dependency the design spec already flags for removal. The player knows what app they are in: they scanned its QR code. |
| `IssueFab` (GitHub bug-report FAB) | `:2336` | **CUT** | A floating action button, permanently in the thumb zone, whose action is to file a GitHub issue. It is aimed at developers and sits on top of the only region a one-handed player can comfortably reach. |
| `setInterval(checkWebSocketMode, 1000)` | `:300–302` | **CUT** | A 1 Hz timer on every participant's phone for the whole session, polling `localStorage` for an admin toggle that cannot change on that device. Not visible, but it is on the player's battery. |
| ~167 `console.log` sites, 13 of them *per trivia option per render* | `:2046–2058` and throughout | **CUT** | `🎯 OPTION A DEBUG:` and twelve more lines, re-emitted for every option on every render of the results screen. |

---

## 2. The join screen (`!joined`)

| Element | Where | Verdict | Why |
|---|---|---|---|
| Parallax hero | `:1481–1496` | **CUT** | As above. |
| `<h1>Join Engagements</h1>` | `:1499` | **KEEP**, reworded | |
| `game-info` → "Game ID: 4821" + "💡 Save this URL to easily reconnect later!" | `:1500–1507` | **BROKEN as advice** | The hint appears *before* the URL contains a name — `?name=` is only appended after a successful join (`:1064–1069`). Saving the URL at the moment the hint is shown saves the wrong URL. And "save this URL" is not an action a phone user can perform without leaving the page. |
| Game ID `input` with `readOnly={gameIdFromUrl}` | `:1539–1547` | **KEEP**, reworked | A read-only text input styled identically to an editable one is a control that lies about being a control. Where the code came from the URL, it is a confirmation, not a field. |
| Name `input`, placeholder "Your Name" | `:1548–1555` | **KEEP** | No label anywhere on this form — placeholders only, which vanish on focus and are not labels. |
| Access-code branch | `:1508–1536` | **BROKEN** | Reached only *after* a failed join (`:1033–1036`), and the "Back" button clears `nameInput` (`:1530`) — so declining a private session throws away a name that was already typed and validated. |
| `alert('Failed to join game. Please check the game ID and try again.')` | `:1038`, `:1041`, `:1077`, `:1114`, `:1118` | **CUT** | Five of the eleven `alert()` calls in this file are on the join path. A native alert on a phone is a modal system dialog that looks like a browser error, cannot be styled, cannot be read by the field it refers to, and gives one undifferentiated message for *wrong code*, *session ended*, *session full* and *network down* — four failures with four different remedies. |
| Rejoin prompt — "Welcome back! Rejoin game 4821 as Priya?" | `:1453–1474` | **KEEP** | Genuinely good, and recent. It is the one place this screen already does the right thing: it asks rather than silently auto-joining. |

---

## 3. Waiting (`isWaitingState`)

| Element | Where | Verdict |
|---|---|---|
| `<h2>✅ You're in!</h2>` | `:1628` | **KEEP** (one of three) |
| `<p>Waiting for the game to start…</p>` | `:1629` | **REDUNDANT** |
| `status-indicator` → pulsing dot + "Ready to play" | `:1630–1633` | **REDUNDANT** — a third statement of *nothing is happening*, and the only animated element on the screen is the one that means "do nothing". |

`isWaitingState()` (`:94–98`) returns `true` for **any** state that is not `ASK#`/`VOTE#`/`RESULTS#`.
That is the whole defect surface of this branch: see §7.

---

## 4. ASK

| Element | Where | Verdict | Why |
|---|---|---|---|
| `field-badge` (category) + `school-name` | `:1640–1645` | **MOVE** | The host spec puts the category in the stage rail in every state. Repeating it on 40 phones buys nothing; it is the first thing to drop when width is short. |
| Title/detail branch — artwork, call-and-answer, trivia, `else` | `:1647–1695` | **BROKEN for poll and survey** | The chain is: *call-and-answer with image* → *call-and-answer* → *trivia* → `else`. Poll and survey fall into the `else` at `:1691–1695`, which renders `title` **only**. A poll question's `detail` — the background context that makes the question answerable, per the format in `CLAUDE.md` — is never shown to a single player. Two of five shipped game types have no ASK design. |
| `wavelength-topic` | `:1696–1702` | **KEEP** |
| `application-prompt` — the resolved instruction, in `<strong>` | `:1703–1705` | **KEEP** — and it is the one thing the host spec explicitly cut from the stage on the grounds that "every player already has it on their own phone at arm's length". That makes it load-bearing here. |
| Trivia options A–F, `div` + `onClick` | `:1710–1728` | **BROKEN as controls** | `<div className="category-item trivia-option" onClick=…>` — not a button, no `role`, no `tabIndex`, no `aria-checked`, not reachable by keyboard, not announced as selectable. The class name is `category-item`, borrowed from the admin category picker. |
| Trivia submit | `:1730–1738` | **KEEP** |
| Wavelength — 10 stacked `<input>`s, each with a `Word N` label **and** a `Word N` placeholder | `:1742–1760` | **CUT / redesign** | 20 strings for 10 values, ~900px of form on a 375px phone, no keyboard advance between fields, and a button that reads "Submit Words (3/10)" while being enabled at 1 — implying nine more are required. |
| Call-and-answer `answer-form` textarea | `:1817–1834` | **KEEP**, reworked |
| `mobile-input-overlay` — full-screen textarea | `:1774–1816` | **CUT** | It covers the question. A player composing an answer cannot see what they are answering. It also carries **three** submit affordances at once — an airplane icon top-right (`:1786`), a full-width button inside the form (`:1810`), and the underlying form's own button once dismissed — plus a close control that discards nothing but looks like it might. |
| Textarea `placeholder={instruction}` | `:1800`, `:1822` | **REDUNDANT** | The instruction is already rendered in full at `:1704`, immediately above. It is then repeated as placeholder text that disappears the moment the player starts typing — i.e. it is present exactly while it is not needed and absent exactly when it is. |
| `answer-submitted` — "Answer Submitted!" + "Waiting for other players…" | `:1838–1850` | **KEEP**, extended | It does not show what was submitted. `handleSubmitAnswer` clears `answerInput` (`:1172`), `selectedTriviaAnswer` (`:1173`) and `wavelengthWords` (`:1174`) on send, so the only record of what a player wrote is `mySubmittedAnswer` — which exists solely to match the anonymous ballot row (`:106–109`) and is never displayed. |
| `setHasAnswered(true)` immediately after `webSocketClient.sendCleanMessage(...)` | `:1165–1176` | **BROKEN** | Fire-and-forget. There is no acknowledgement and no error path: if the socket is closed the answer is dropped, the player is shown "Answer Submitted!", and `hasAnswered` locks them out of resubmitting for the rest of the round. The only thing that would correct it is `checkPlayerAnswer` — which runs on the *next* question. |

---

## 5. VOTE

| Element | Where | Verdict | Why |
|---|---|---|---|
| `{gameState.startsWith('VOTE#') && answers.length > 0 && …}` | `:1855` | **BROKEN — renders nothing** | See §7.1. This is the most severe defect in the file. |
| `<h2>Vote for the Best Applications</h2>` + explanatory `<p>` | `:1857–1869` | **REDUNDANT** | Two lines saying "it is time to vote" above a screen that is visibly a ballot. |
| Artwork image | `:1871–1878` | **KEEP** on artwork rounds |
| **The question being voted on** | — | **MISSING** | `currentQuestion` is loaded (`:732`) and never rendered in this branch. A player who joined late, or who has been discussing something else for two minutes, votes on six answers to a question the phone will not show them. |
| **Any anonymity explanation** | — | **MISSING** | Rows are labelled `Response 1…N` by `displayLabelFor` (`config/anonymity.js:50`), and nothing anywhere on this screen says why. The room-facing sentence — *"Nobody sees who wrote what — the host included — until voting closes."* — exists for the stage and has no counterpart here. A numbered row with no explanation reads as a bug, or as the app having lost the names. |
| `voting-mode-toggle` — "Quick Vote" / "Detailed Vote" | `:1884–1897` | **CUT** | Two complete, separately-maintained voting UIs for one task, and a decision the player is asked to make before they have seen either. This is the player-side equivalent of the host's `answer-navigator`: a job created by the UI for the UI. |
| Quick Vote — three `<select>` elements | `:1901–1939` | **CUT** | Four compounding problems. (a) The placeholder reads **`Pick player...`** (`:1913`) — on a ballot whose entire premise is that there are no players attached to it. (b) Answers are truncated to **20 characters** (`:1921–1923`), which for the sample content is roughly three words; `title={answer.answer}` restores the rest on hover, and phones do not hover. (c) A native `<select>` on iOS is a full-screen wheel, so the ballot is invisible while you choose from it. (d) The response *numbers* — the handles a facilitator reads aloud — are not visible at all until the wheel is open. |
| Quick Vote option label `"{truncated}" - {displayLabelFor(answer, idx)}` | `:1932` | **KEEP** the number, fix the punctuation | Renders as `"We could publish one de..." - Response 4`. |
| `DetailedVotingMode` cards | `:1373–1449` | **KEEP as the basis** | This is the better of the two modes and should be the only one. Its `answer-author` line renders `- Response 1` (`:1408`) — a hyphen-prefixed attribution line for an unattributed row. |
| `(Yours)` marker | `:1408`, `:1932` | **KEEP** | Correct and not a leak (`anonymity.js:154`). Matched by submitted text via `ownAnswerIndex`. |
| Self-ranking | — | **UNRESOLVED** | Nothing excludes a player's own response from their ballot, and `requiredRanks = Math.min(3, answers.length)` (`:1229`) counts it. In a room of three, a player *must* rank themselves to submit. See OPEN-QUESTIONS. |
| `alert('Please select answers for all N positions.')` | `:1235` | **CUT** | A modal system dialog as validation for a form that could simply say what is missing. |
| Paging | — | **MISSING** | Every response is rendered, always. Twenty responses is twenty cards or a twenty-item wheel. |
| `vote-submitted` — "Votes Submitted!" + "Waiting for results…" | `:1964–1967` | **KEEP**, extended | Does not show what was voted for. |

---

## 6. RESULTS

| Element | Where | Verdict | Why |
|---|---|---|---|
| `results-heading` "Round 3 Results" | `:1974–1978` | **REDUNDANT** with the round chip at `:1576`. |
| **Trivia** `trivia-question-recap` | `:1982–1984` | **KEEP** |
| **Trivia** `trivia-options-results` — every option, correct tick, wrong cross, "(Your Choice)" | `:1986–2095` | **KEEP**, reduced | The correct-answer matching logic is 60 lines of format-guessing across five spellings (`:1992–2032`) because the payload's `correctAnswer` may be `"OptionA"`, `"A"`, the option text, or an array. That is a data problem wearing a UI costume. Rendering *all six* options again is also more than the question "did I get it right" needs. |
| **Trivia** wrong answer uses `--danger` red | `:2089` | **CUT the colour** | Warm Summit reserves red for destructive. A wrong trivia answer is not destructive; and colour is doing the work alone but for a 16px icon. |
| **Trivia** `player-results-summary` — round score, speed-bonus breakdown, total, ranking | `:2097–2141` | **KEEP** | Note `playerScoreInfo?.roundScore > 0` (`:2098`) hides the round line entirely when you score nothing, so the most common case for a wrong answer is silence where the explanation should be. |
| **Wavelength** `wavelength-common-words` — every word said by 2+ players, with counts | `:2156–2199` | **MOVE** | This is the word cloud, re-derived on the phone, in a list. The cloud is the room's result and it is already on the stage (host spec §6). |
| **Wavelength** `wavelength-your-words` | `:2201–2221` | **KEEP** — the personal half, and the only part the stage cannot show. |
| **Wavelength** `wavelength-stats` — "Total Responses", "Unique Words" | `:2223–2245` | **CUT** | Session telemetry rendered to participants. |
| **Call-and-answer** `player-results-summary` | `:2249–2286` | **KEEP** |
| **Call-and-answer** — *the player's own response, and what it earned* | — | **MISSING** | The player sees a rank and a score and never learns which numbered response was theirs, how many votes it got, or that it was read out. This is the payoff of the entire anonymity feature and the phone does not mention it. |
| `results-message` — "Check the main screen for detailed results and AI insights!" | `:2288–2290` | **KEEP the intent, CUT the phrasing** | The only "look up" cue in the product, and it appears once, in one branch, phrased as an apology for what this screen does not have. |
| `status-indicator` "Ready for next question" | `:2294–2297` | **REDUNDANT** |
| Poll / survey RESULTS | — | **BROKEN** | Falls into the call-and-answer branch, so a poll — a format with no right answer and, arguably, no score — shows "This Round: +0 points" and a competitive ranking. |

---

## 7. The states that are broken or do not exist

### 7.1 A player who has voted and reloads sees a blank page

This is the worst defect in the file and it is two lines, far apart.

```js
// :713–723 — loadVotingData
const hasAlreadyVoted = await checkPlayerVote(gameId, playerName, questionNumber);
setHasVoted(hasAlreadyVoted);
if (hasAlreadyVoted) {
  …
  return;                    // returns BEFORE setAnswers(...) is ever reached
}
```

```js
// :1855 — the render guard
{gameState.startsWith('VOTE#') && answers.length > 0 && (
```

`answers` initialises to `[]` (`:115`). On a fresh mount — a reload, an iOS tab eviction, a
phone that slept and came back to a cold page — `checkGameState` sees `VOTE#003`,
`loadVotingData` finds the player has already voted, and returns without loading the ballot.
`answers` stays `[]`, so the guard is false and **the entire VOTE branch renders nothing**.
Not the "Votes Submitted!" panel either: that lives *inside* the same guard, at `:1963–1968`.

What the player gets is the persistent chrome, the parallax hero, and empty space. The
"Welcome back! Your previous game state has been restored." banner may well be showing over
it. The brief's requirement — *"rejoining mid-round must work and must not lose an answer
already submitted"* — is not met today for the single most likely rejoin.

Mockup [22](22-rejoin.html) is the designed replacement.

### 7.2 A finished session shows the lobby

`isWaitingState('ENDED')` is `true` (`:94–98`: anything that is not `ASK#`/`VOTE#`/`RESULTS#`).
So when the host ends the session the player's screen renders:

> ✅ **You're in!**
> Waiting for the game to start…
> ● Ready to play

behind a dismissible modal (`:2304–2333`). Dismiss the modal and that lobby screen is where
the player stays, permanently, telling them the game has not begun. This is the exact defect
the host spec records at its §2.7 — the same `isWaitingState` shape, the same consequence,
on the other surface. Neither was fixed by the other's fix.

The modal itself offers **"Download Report"**, which calls `admin/reports/{gameId}` (`:1319`)
and `window.open`s the result. For a participant this is (a) usually a 404, handled by an
italic aside that says to *"ask the host to generate it"*, and (b) an admin endpoint offered
to an unauthenticated member of the public.

### 7.3 Between rounds does not exist

Same cause. After `RESULTS#003` the host has not yet started round 4; whatever intermediate
state the server reports is not `ASK#`/`VOTE#`/`RESULTS#`, so the phone says the game has not
started. There is no design for the longest and most valuable part of a session — the
discussion between rounds.

### 7.4 There is no offline state

`wsConnected` drives a two-word chip and nothing else. There is no banner, no queueing, no
statement of what is safe, and — as noted in §1 — the only affordance attached to it destroys
unsent text.

### 7.5 There is no "answer failed to send" state

Covered in §4. `handleSubmitAnswer` cannot fail visibly.

---

## 8. Dead code and unreachable branches

| Thing | Where | Note |
|---|---|---|
| `fetchPlayerRanking()` | `:510–548` | 39 lines. **Never called.** It is the only writer of `allPlayers` and `playerRanking`. |
| `allPlayers` | `:129` | Consequently always `[]`, and never read anyway. |
| `playerRanking` | `:127` | Consequently always `null`, which makes the `{playerRanking && playerScore > 0 && …}` blocks at `:2132–2140` and `:2275–2283` **unreachable** — a second, differently-computed "Your Ranking" line that can never render. |
| The two ranking computations | `:44–68` vs `:876–911` | `calculatePlayerRankings` reads `p.score`/`p.name`; `loadPlayerScoreInfo` reads `p.totalScore`/`p.playerName`. Two implementations of tie-handling over two different field spellings. Only the second one runs. |
| `isUserVoting`, `lastVoteInteraction` | `:121–122` | Written on every vote interaction (`:1187–1191`, `:1376–1378`), read nowhere. Residue of the removed polling system. |
| `useWebSocket` | `:142` | Comment says "Always use WebSocket"; a 1 Hz interval exists to let it change. |
| `if (currentQuestion?.id) { /* Vote changes are stored in component state only */ }` | `:1206–1209` | An empty conditional. |

---

## 9. The redundancy summary

The player's screen is not as crowded as the host's was, and it is worth saying so plainly:
this is a **thinness** problem more than a duplication problem. Still, in one viewport today:

- **"Nothing is happening"** is stated **three times** while waiting — heading, paragraph, and
  an animated status pill (`:1628`, `:1629`, `:1630–1633`) — and again as a fourth after
  submitting (`:1849`).
- **The instruction** is stated **twice** during call-and-answer ASK — once as content
  (`:1704`) and once as the textarea placeholder (`:1822`), where it vanishes on first
  keystroke.
- **The round number** is stated twice on RESULTS (`:1576`, `:1976`).
- **The submit action** is offered **three times** in the mobile composer overlay (`:1786`,
  `:1810`, and the form beneath it at `:1831`).
- **The score** is stated up to four ways on trivia RESULTS — round score, speed breakdown,
  total, ranking — plus two unreachable second renderings of the ranking.
- **The wavelength result** is stated **three times**: common words with counts, your words,
  and aggregate statistics — three views of one small dataset on the smallest screen in the
  building, while the same data is a word cloud on the projector.

And, against that, the things stated **zero** times: what you submitted, why the ballot has no
names, which response was yours, what happens when the connection drops, what happens when the
session ends, and what a poll question was actually about.

---

## 10. What the design deletes

Consolidated, so the diff is countable:

**Cut outright:** the parallax hero and its three CDN images (×2 screens) · `IssueFab` ·
the game-id chip · the reload-on-tap connection chip · the "Quick Vote" `<select>` mode ·
the mobile full-screen composer overlay · the wavelength common-words list and stats block ·
the "Download Report" button · the 1 Hz `localStorage` poll · all eleven `alert()` calls ·
the two redundant "nothing is happening" statements · the placeholder-as-instruction ·
`fetchPlayerRanking` and the unreachable ranking blocks · red for a wrong answer.

**Added, because it does not exist:** an ASK design for poll and survey · the question during
VOTE · the anonymity sentence on the ballot · a receipt after every submission · ballot paging ·
a between-rounds state · an ended state · an offline state · a send-failed state · a rejoin
state that says what it found · and a stated rule for when the phone should go quiet.
