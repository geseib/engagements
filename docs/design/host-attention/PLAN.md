# Host attention: one count per step, and who to nudge

Design only, 4 Nov 2026. No application code changed. Read against `main` at `316f5408`.

The owner, verbatim:

> "The host screen still is a bit overbearing and the screen shows the wrong info and
> inconsistently how many have answered. We would like to know just like the big screen used
> to — which I kinda miss: 2 of 2, or 2/2 answered, 2/2 voted. I no longer have an easy way to
> see who I need to pester. I need an agent to really think through the mechanics of how a
> host would operate in a session of say 5 or 15 participants."

The screenshot: a Call & Answer round on two screens, in the **Ask · LIVE** step (a question
for the room, sent after What we heard), two people, Ges and Bob. It says "All 2 answered"
(Your part now), "1 answered / 0 voted" (tile 1), "2 of 2 answered" (under the question), and
"Took 10:30:37" (tile 2). The People rail shows Ges 3 and Bob 0 with no sign of who has
answered.

**The short version.** The three counts disagree because they count two different questions
from three different sources, and the time is wrong because it subtracts a server timestamp
from the moment this browser tab happened to first see the results. Under the defects is a
design gap: the console states the count, but never says *who* is outstanding in a place the
host actually looks. The fix is one function that answers "how far along is the room, and
who is still out?" for whatever step is live. Every surface reads it, and the console says
the answer once, in tile 1, with names.

---

## 1. What a host actually does, minute by minute

### 1.1 Call & Answer, two screens, 5 people

| Time | What is happening | What the host needs at a glance | What the host does |
|---|---|---|---|
| 0:00 | Presses **Start round 3**. The question is on the wall. | That it went out: "0/5 answered", the clock running. | Reads the question aloud, frames it. |
| 0:20–1:30 | People are typing. | The count climbing. Names are not needed yet; nobody is late at 0:40. | Waits. Glances at the laptop maybe every 15 s. |
| 1:30 | 3/5 in. | **Who** the last two are, and whether they are **away** (phone locked, tab closed) or just slow. | "Ana, Raj, a minute more?" If Raj's phone is away: "Raj, you've dropped out, rejoin with 1913." |
| 2:10 | 5/5. | One unmistakable "everyone's in". | Presses **Start voting**. |
| 2:15–3:00 | Voting. Faster than answering. | "3/5 voted · waiting on Lee, Sam". | Nudges by name, or presses Show results twice to go without them. |
| 3:00 | Results, responses, What we heard (Workie's read, paged). | Nothing about counts. Its own page and the next button. A record of how the round went ("5/5 answered · 4/5 voted") is enough. | Talks through the read. |
| 6:00 | **Ask the room** (optional follow-up): a choose, rate or ideas question. | The same thing again, **for this question**: "1/5 answered · waiting on Ana, Raj, Lee, Sam". | Nudges, then **Show results**. |

At 5 people the names matter from the first minute. With five, the host knows everyone, and
"waiting on Raj" is the most useful sentence the console can say.

### 1.2 The same, 15 people

The shape is the same. What changes is **when names become useful**:

- From 0 to about 10 in, a list of names is noise. "6/15 answered" plus the clock is
  everything the host should look at, and the host's job is to wait.
- The **tail** is where facilitation happens. With 4 or fewer out, "waiting on Ana, Raj, Lee,
  Tom" is something you can say out loud. With 9 out, nobody reads a list of nine names
  to a room.
- **Away is a different action from slow.** At 15, two or three phones will sleep each round.
  "13/15 answered · waiting on Ana · away: Tom, Kim" tells the host to move on: Tom and Kim
  are not typing. Mixing them in one list makes the host wait for people who cannot answer.
- **Latecomers** who joined after answering closed are not owed an answer to that step. They
  must not sit in the denominator ("14/15") as if they were holding the room up.
- 15 rows of ✓/… in the rail is a scan, not a glance. The People rail is for finding a
  person. The "still to answer" sentence is for the decision.

### 1.3 The other formats

| Format | Steps that collect | Notes for the host |
|---|---|---|
| **Trivia** | Question (answer) → Reveal | Time-boxed and quick. The count and the tail's names matter. "Correct so far" is host-only (tile 3). No vote. |
| **Poll** | Ask (answer) → Results | A tap, not typing. The tail is short and names matter at once. |
| **Survey** | Open for days: finished / partway / not started | Not watched minute by minute. "Who hasn't finished" is for the **Remind** button and for a word at the next meeting. |
| **Call & Answer follow-up** (the Ask step) | Answer the room's question | The step in the screenshot. Its own count and its own outstanding list, not the round's. |

### 1.4 One screen

On one screen the laptop **is** the room's screen (experience plan §3.3, principle 3). Counts
are public-safe ("count only"). Names of who is outstanding go up only when the host
deliberately reveals them; the owner approved this on the stage meter (`RoomMeter.jsx`
doc-block: "names WHO IS STILL WAITING — on demand, never unprompted"). Otherwise they live
on the phone Remote. The host's need is the same as on two screens; only *where* the names
may appear changes.

### 1.5 What follows for the screen

1. **One number per step, said once, in one place**, and always about the step that is live
   now: "2/2 answered", "1/2 voted", or the room question's "1/2 answered".
2. **The steps already done this round sit beside it, small**: "✓ 2/2 answered · 1/2 voted".
   This is what the owner misses.
3. **Who is still out, by name, when few are**, with **away** people split off. Past a
   threshold, the count only.
4. **Everyone's in, once, unmistakably.**
5. Nothing else on the screen competes for that glance: no second count, no clock that is
   wrong, no tile that says nothing most of the time.

---

## 2. Every number on the screenshot, traced

`GHP` is `src/src/GameHostPage.jsx`. The moment is `ROOM_QUESTION`: the state is still
`RESULTS#002` with `stageBeat === 'ask'` (`config/roundStep.js:106-109`). The step bar maps
it to `ask` (`config/workflowStrip.js:31`). The ticks on Answer, Vote and What we heard are
**correct**: those steps are done, and Ask comes after them (`workflowStrip.js:50-54`).

| On screen | Says | Computed by | Counts |
|---|---|---|---|
| Your part now, status | **All 2 answered** | `roundStep` `statusFor('ROOM_QUESTION')` (`roundStep.js:397-403`) from `roomAsk = { answered: roundAsks.shown.tally.n, total: players.length }` (`GHP:7804-7806`). Rendered through `withoutRoomCount` (`GHP:9526`). | The **room question's** answers |
| Tile 1, THIS ROUND | **1 answered / 0 voted** | `pulseFor` 'after' branch (`config/consolePulse.js:163-164`), because `ROOM_QUESTION: 'after'` (`consolePulse.js:83`). It is fed `answered={answeredCount}` and `voted={playersWhoVoted.length}` (`GHP:9037-9038`). | The **original round's** answers and votes |
| Tile 2, TIME | **Took 10:30:37** | `pulseFor` 'after' (`consolePulse.js:180-187`): `end − opened`, where `opened = currentQuestion.startedAt` (server) and `end = seenFor('VOTE') ?? seenFor('RESULTS')` (`GHP:9001-9007, 9041-9042`) | Answering time of the **original round**, measured from a page-local stamp |
| Tile 3, SINCE THIS ROUND OPENED | **+1 joined · Bob** | `arrivalsSince(players, pulseOpenedAt)` (`consolePulse.js:111-119`, `GHP:9043`) | Joins since the original round opened |
| Under the question | **2 of 2 answered on their phone, laptop or tablet** | `AskStage` (`components/stage/AskStage.jsx:22-23, 45`), `FW.answeredOn(tally.n, players.length)` (`config/followUpWords.js:112`), mounted at `GHP:9376` | The **room question's** answers |
| People rail | "2 here", rows with no mark | `consolePeopleFor` → `peopleRows` (`config/consoleRail.js:247-276`). Outside ANSWERING and VOTING every row is `state: 'here'` (`:254-257`). `railSummaries` adds "waiting on" only for `ROUNDING` moments (`:97, :161-174`). | Nothing about progress |

### 2.1 The defects

**D1. Tile 1 counts the wrong question during Ask the room.** `pulsePhase` maps
`ROOM_QUESTION` to `'after'` (`consolePulse.js:83`). So while the room answers a live
question, tile 1 shows the closed main round's summary. Your part now and the content area
count the live question. `everyoneIn` is forced to `null` outside
ANSWERING/VOTING/VOTE_RESPONSES (`GHP:9039`), so the room question never shows Everyone's in
on the tile either. This is the "1" against the two "2"s.

**D2. The count is stated two or three times in the same viewport.** `withoutRoomCount`
strips the count from the status only when `pulsePhase` is `answer` or `vote`
(`consolePulse.js:251`). In `ROOM_QUESTION` the status keeps "All 2 answered", and `AskStage`
prints "2 of 2 answered" a third time. This breaks engage-design hard rule 5 (one fact, once
per viewport), and here the repeats do not even agree with tile 1.

**D3. The vote count after voting is page memory, not data.** `playersWhoVoted` is filled by
`playerVoted` socket frames during VOTE (`GHP:3183-3191`) and by the restore path **only when
the state is `VOTE#`** (`GHP:3953-3955`). The `RESULTS#` restore (`GHP:3966` onward) never
sets it. So after a reload, a second tab, or a hand-back from the phone Remote, every
post-vote surface reads **0 voted**. The answered count after the round is
`answeredCountFrom(playersWhoAnswered, answers)` = the larger of the names list and the rows
(`config/anonymity.js:174-176`, `GHP:472`). At RESULTS that is the results rows, so "1
answered" is plausibly true (Ges answered, Bob joined later). The "0 voted" cannot be
trusted either way.

**D4. "This round: 1 answered" has no denominator** (`consolePulse.js:164`: `of:
'answered'`). It reads like a live count, and it does not say how many could have answered.
The owner asks for "2/2".

**D5. The time is measured against this tab's memory.** `phaseSeenAt` stamps each state the
first time **this page** sees it, using the laptop's `Date.now()` (`GHP:529-530, 557-560`),
and it is cleared on load. `pulseOpenedAt` is the server's `currentQuestion.startedAt`
(`GHP:9007`; written by `next-question.js:1322/1354`, returned at
`get-game-state.js:352`). After a reload during RESULTS, `seenFor('VOTE')` is null and
`seenFor('RESULTS')` is **the moment the page loaded**. So "Took" becomes "time from round 2
opening until this tab was opened", here 10 h 30 m 37 s. Two more faults compound it:

- It mixes clocks: a server ISO stamp minus a laptop `Date.now()`, while the ticking tiles
  use `serverNowMs()` (`ConsolePulse.jsx:48`).
- The server **already** stores the stamp the client needs: `PhaseStartedAt`, written at ASK
  (`next-question.js`) and at VOTE (`websocket/start-vote.js`; `round-timer.js:12-16`), and returned as
  `phaseStartedAt` on the host door (`get-game-state.js:608`). The client never reads it
  (`grep phaseStartedAt src/src` finds no reader). Nothing stamps RESULTS server-side.
- Even when correct, "Took" here is the wrong fact for the moment. The live thing is the
  room question, whose own `sentAt` is on the wire (`lambda-functions/game/followups.js:99`).

To confirm on the owner's session: compare the `QUESTION#002#REF` row's `StartedAt` with
when the console tab was last loaded. The gap should be 10:30:37 give or take the
laptop–server skew.

**D6. No per-person marks during Ask the room, and no names to make them from.** Rows carry
✓/… only in ANSWERING and VOTING (`consoleRail.js:254-257`). For the room question the host
wire carries only `tally: { n }` (`followups.js:85-103`; "never a name",
`followup-kinds.js:280-286`). Yet each answer row's key **is** the player's name
(`FOLLOWUP#nnn#ASK#id#A#<name>`, `followup-keys.js:49-51`). The Build Room already ships the
equivalent `answeredBy` list (`buildroom/buildConsole.js:265-283`).

**D7. The "waiting on" names are drawn where the host never sees them.** The People
header's clause appears **only while People is closed** (`consoleRail.js:166`, `!open.people`).
But People **opens itself** in ANSWERING, VOTING and ROOM_QUESTION (`consoleRail.js:13-20`,
`ConsoleRail.jsx:146`). In practice the host gets the names only after folding People shut
by hand, which nobody discovers. With People open, the only signal is a 20px ✓ or … glyph
per row (`PersonRow.jsx:123, 138-141`), which is a scan of N rows, not a sentence. This is the
owner's "I no longer have an easy way to see who I need to pester."

**D8. Away is never shown on the console.** The rail hard-codes `status="here"` on every row
(`ConsoleRail.jsx:256`). `get-players` returns `deviceConnected` per person
(`lambda-functions/game/get-players.js:130-150, 266`), and `needsYou.js:236-240` and the Build
Room (`buildConsole.js:277`) already read it. The C&A console does not.

**D9. Progress is computed in at least eight places with two denominators.**

| Where | Numerator | Denominator |
|---|---|---|
| Pulse tile 1 (`consolePulse.js:148-167`) | `answeredCount` / `playersWhoVoted.length` | `players.length` |
| roundStep status, via `snapshotFromHostPage` (`config/hostControls.js:774-799`) | the same | `players.length` |
| `everybodyIn` (`GHP:8778-8782`, `roomIsComplete` `hostControls.js:281-288`) | the same | `players.length` |
| One-screen dock sentence (`GHP:8789-8792`) | qualitative, "Some are still answering" | n/a |
| One-screen meter (`GHP:8289-8303`) | the same | `players.length` |
| Room question (`GHP:7804-7806`, `AskStage.jsx:45`) | `tally.n` | `players.length` |
| Phone Remote (`config/hostRemote.js:504-540, 587-633`) | server `answersReceived` / `answererIds` | server `totalPlayers` (deduped, removed excluded); **ASK/VOTE only**, so nothing for the room question |
| Room's window (`present/presentModel.js:315, 392, 527`) | `countsOf(snapshot, …)` | server |

They agree only by luck. The phone Remote shows nothing at all during the room question.

**D10. The page knows too little to answer "who is out of a closed step".** A denominator
of `players.length` *now* counts anyone who joined after the step closed (Bob, tile 3) as
someone who did not answer.

---

## 3. What the big screen used to show, and what replaced it

- **One screen (the stage, and the projector layout).** `RoomMeter` still shows
  **"Answered 2 / 2"** and **"Voted 1 / 2"** (`GHP:8289-8303`). The names of who is waiting
  reveal on demand. This is the "big screen" the owner remembers, and on one screen it
  still exists.
- **Two screens, the console's People header.** Until `bbefa1c6` (1 Nov 2026, experience
  plan 2c) it read **"1 of 2 answered" / "1 of 2 voted"**
  (`peopleSummary`, removed in that commit's `config/consoleRail.js` hunk). 2c moved the
  count to pulse tile 1 under hard rule 5, and the header became "N here".
- **`b22b9614`** (3 Nov, console-rail design) added "waiting on Marcus" to the **closed**
  People header. The owner asked for "5/6" there (`docs/design/console-rail/reviews.md:9-13`).
  The design argued for names instead (F1), and the owner accepted ("Looks good").
  **This plan does not re-propose a count in the rail header.** It moves the names to where
  they are seen (D7).
- **The room's window** (`/present`) still draws "x of n answered" pips (`PresentMoments.jsx:61-79`).

So on two screens, what disappeared is the **pair**: the done step's count beside the live
one ("2/2 answered · 1/2 voted"). The tile shows only the live step, and after the round it
shows a summary with no denominators and an unreliable vote count (D3, D4). The names moved to a
place that is only visible when closed (D7).

---

## 4. The design

### 4.1 One function: `roomProgressFor`

New: `src/src/config/roomProgress.js`. It is pure and has no React.

```js
/**
 * How far along is the room, step by step, and who is still out?
 * @returns {{
 *   live: 'answer'|'vote'|'ask'|'survey'|null,      // the step collecting now, if any
 *   steps: Array<{
 *     id: 'answer'|'vote'|'ask'|'survey',
 *     verb: 'answered'|'voted'|'finished',
 *     done: number, of: number, all: boolean,         // all: of > 0 && done >= of
 *     closed: boolean,
 *     known: boolean,          // false when names lag the count (hidden round)
 *     waiting: string[],       // still out AND here, roster order (never re-sorted)
 *     away: string[],          // still out AND no page open (deviceConnected === false)
 *     after: string[],         // joined after this step closed: not owed, not in `of`
 *     openedAt: string|null, closedAt: string|null,   // SERVER stamps only
 *   }>,
 *   byName: Record<string, { answer?: 'done'|'out', vote?: 'done'|'out', ask?: 'done'|'out', away: boolean }>,
 * }}
 */
export function roomProgressFor({
  moment,            // roundStep moment
  gameType,
  roster,            // get-players rows: name, joinedAt, deviceConnected (removed already excluded)
  answer,            // { names, count, openedAt, closedAt }
  vote,              // { names, count, openedAt, closedAt } | null for no-vote formats
  ask,               // { status, answeredBy, n, sentAt, closedAt } | null  (the room question)
  survey,            // surveyRoomCounts + names | null
  hidden,            // authorsHiddenNow(...), for the waitingRoster freshness guard
}) { … }

/** The words, from one place: "2/2 answered", "All 2 voted", "1/2 answered". */
export function progressWords(step) { … }
/** "Waiting on Ana, Raj" / "3 still to answer" / "" — the threshold lives here. */
export function waitingWords(step, { maxNames = WAITING_NAMES_MAX } = {}) { … }
export const WAITING_NAMES_MAX = 6;
```

The rules it owns, so nobody re-derives them:

- **The denominator** is the roster as `get-players` returns it: deduplicated, removed people
  excluded (`player-presence.js`), the room's window excluded. That is the same population
  the server's `totalPlayers` counts. For a **closed** step, people whose `joinedAt` is after
  the step's `closedAt` go to `after`, not into `of`. Bob joining during What we heard does
  not turn "2/2 answered" into "2/3".
- **The numerator never trails the names.** It is the `waitingRoster` freshness guard
  (`anonymity.js:500-528`): if the names on hand cover fewer people than the count, `known`
  is false and the names stay empty. The count is still shown; it never says something
  wrong.
- **Away** = still out and `deviceConnected === false`. A row with `deviceConnected`
  undefined (not read yet) counts as here, as `buildConsole.js:277` already does.
- **Order**: roster order, always. Rows never re-sort (console-rail D7).
- **Stamps are server stamps.** `answer.openedAt` = REF `StartedAt`, `vote.openedAt` =
  `PhaseStartedAt` at VOTE, `ask.sentAt`/`closedAt` from the ask. Never `phaseSeenAt`.

Everything that today states progress reads this function: pulse tile 1, the rail rows and
header, Your part now's status, `roundStep`'s status and `allIn` (through the snapshot),
`everybodyIn`, the one-screen meter and dock sentence, `AskStage`'s count line, and the
phone Remote (§4.7). `roundStepParity.test.js` keeps holding the host and the Remote equal,
now because both feed the same function.

### 4.2 Tile 1 becomes "The room", for whatever step is live

```
┌ THE ROOM · ANSWER THE ROOM'S QUESTION ─────────────┐
│  1/2  answered                        ▓▓▓▓▓░░░░░   │   30px numeral: the live step
│  ✓ 2/2 answered · ✓ 2/2 voted                       │   15px: this round's earlier steps
│  Waiting on Bob                                     │   15px, text colour: the nudge line
└─────────────────────────────────────────────────────┘
```

| Moment | Big line | Step line | Nudge line |
|---|---|---|---|
| ANSWERING | **3/5** answered | — | Waiting on Ana, Raj · away: Tom |
| VOTING / VOTE_RESPONSES | **3/5** voted | ✓ 5/5 answered | Waiting on Lee, Sam |
| RESULTS, RESPONSES, READ, FEEDBACK | **5/5** answered (the round's record) | 4/5 voted | (none; nobody is owed anything) |
| ROOM_QUESTION | **1/2** answered (the room's question) | ✓ 2/2 answered · ✓ 2/2 voted | Waiting on Bob |
| ROOM_RESULTS | **2/2** answered | the round's two | — |
| Trivia ANSWERING | **9/15** answered | — | 6 still to answer |
| Trivia, tail | **13/15** answered | — | Waiting on Ana · away: Tom |
| Poll | as Trivia | — | as Trivia |
| Survey COLLECTING | **21/42** finished | 15 partway · 6 not started | 21 still to finish (names on demand, §4.6) |
| LOBBY | **6** here | — | (the joiners line moves here, §4.4) |

- **The nudge line** is `waitingWords`: every name when 1–6 are out; past 6, the count only
  ("9 still to answer"). The full list is in the tile's accessible name and `title=` (rail
  review A2). Six, not the rail's twelve, because this is a line that is said aloud, and six
  names is about one breath. **Away** people follow after a separator ("· away: Tom, Kim")
  and are counted inside the threshold.
- **Everyone's in**: the tile's existing green state and the 600 ms settle
  (console-rail D4/D5). The nudge line becomes "Everyone's in". Room-question moments get it
  too (fixes the `GHP:9039` null).
- The **eyebrow names the step** in the strip's own words (`stepLabelFor`), so "this round"
  can never be confused with the room's question.
- One numeral per panel (session-start D3) still holds: the step line and nudge line are
  15px.

### 4.3 Everything else stops counting

- **Your part now's status**: `withoutRoomCount` strips the count in every moment where a
  step collects, `ROOM_QUESTION` included (`consolePulse.js:251`). Better: `roundStep` keeps
  emitting the count for the dock and the Remote, and the console passes `{ count: false }`
  instead of regex-stripping it.
- **AskStage on the console** drops "2 of 2 answered on their phone…" (`AskStage.jsx:45`)
  behind a `showCount` prop, false on the console and true on one screen and the wall.
- **The People header**: the closed "waiting on" clause goes (tile 1 now says it, always in
  view). This reverses the *placement* of console-rail F1(b), not its substance: names, not
  a count, are still the rail's contribution. **Owner question Q2.**

### 4.4 The time and since tiles: say less, and say it right

- **Time** reads server stamps only (§4.1). Live step: "Open 1:24" from that step's
  `openedAt` (room question: `sentAt`). After the round: "Took 2:14 · voting 1:21" only
  when both server stamps exist; otherwise "Round closed". It is never computed from a page
  stamp. `phaseSeenAt` goes.
- **Since this round opened** is the weakest tile. Most rounds it says "No one new". The
  late count it carries is already the Needs-you line's. Recommended (**Q3**): fold joiners
  into tile 1 ("Bob joined after answering closed", from `steps[].after`, only when
  non-empty). Keep tile 3 only where a format puts something private there (Trivia's
  "Correct so far", 2g). The pulse becomes two tiles for C&A and Poll and the content area
  moves up about 110px. This removes an "always-on" tile that competes with the count.

### 4.5 The People rail: marks in every collecting step, and away

- `peopleRows` reads `roomProgressFor(...).byName` for the **live** step. Marks show in
  ANSWERING, VOTING, VOTE_RESPONSES, **ROOM_QUESTION** and **COLLECTING** (survey:
  ✓ finished, … partway or not started). After a step, no glyph: the round's record is
  tile 1's.
- Each row's status dot reads `deviceConnected`: `here` / `away`
  (`PersonRow` already draws `is-away`, `PersonRow.jsx:31, 136`). Remove the hard-coded
  `status="here"` (`ConsoleRail.jsx:256`).
- Rows stay in roster order. No filter, no re-sort: the outstanding list is tile 1's job.
  The rail is for finding Raj to move his device or remove him.
- The header goes back to plain "N here" while a step collects; "top: Priya, 40" stays at
  Results.

### 4.6 One screen

The laptop is the room's screen, so:

- The meter (`GHP:8289-8303`) reads `progressWords` for the live step, **including the room
  question** (today it is null in that beat and only `AskStage` counts). It adds the step
  line small ("✓ 5/5 answered") during voting. Counts are public-safe.
- Names only through the existing on-demand reveal (`RoomMeter` `waiting`, owner-approved)
  and on the phone Remote. Away is **never** shown on one screen. "Tom's phone is away" is
  a private fact about a person.
- The dock sentence "Some are still answering" (`GHP:8789-8792`) becomes `waitingWords`
  without names: "2 still to answer".

### 4.7 The phone Remote

`roundProgress` / `waitingOn` (`hostRemote.js:504-633`) gain the room question (today
`applicable: false` outside ASK/VOTE), from the host-state snapshot carrying the live ask's
`answeredBy`. They become thin adapters over `roomProgressFor` so the phone and the laptop
cannot drift (`roundStepParity` extended).

### 4.8 What makes the screen "overbearing", and what this plan removes

On the screenshot, between the top bar and the question there are: Your part now (with a
count), a full-height "Nothing needs you now" line, three tiles each with a 24–30px headline
(one wrong, one absurd, one stale), then the question with a fourth count line. The host's
eye has five candidates for "how is the room doing", and they disagree.

After this plan: one count with its step line and nudge line, Your part now without a count,
the content without a count, two tiles instead of three (Q3), and the time either right or
absent.

The calm Needs-you line ("Nothing needs you now.") is fixed-height by design (experience
plan principle 1: "so nothing below it ever moves"). This plan keeps it and asks **Q4**
whether its calm state can shrink to a 1-line, 32px muted strip.

### 4.9 Privacy and anonymity checks

- **Who has not acted is not authorship** (`RoomMeter.jsx` doc-block; `hostRemote.js:564-575`).
  On the private console, naming who **has** answered (the ✓ marks) was already accepted in
  console-rail D7.
- **Room-question names (`answeredBy`)** go on the **host door only** (`hostRound`,
  `followups.js:137-165`), never the phone or wall wire. They are sorted in **roster/join
  order, never arrival order**. Ideas are listed oldest first (`followup-store.js:391-398`),
  so an arrival-ordered `answeredBy` would let the host pair a name with an idea by
  position. A backend test must hold that.
- On a hidden C&A round the socket frame carries no name (`GHP:3158-3170`). `known: false`
  keeps the count and blanks the names rather than guessing (the existing guard).

---

## 5. Implementation plan, in order

Every step keeps the suite green on its own. Baselines per CLAUDE.md: backend
`node tests/<file>.js`, frontend `cd src && npm test && npm run lint && npm run build`.

### Step 1: The function, with no UI change (½ day)

- **New** `src/src/config/roomProgress.js`: `roomProgressFor`, `progressWords`,
  `waitingWords`, `WAITING_NAMES_MAX`. Reuses `waitingRoster`'s guard (`anonymity.js:500`)
  and `rosterNames`.
- **New** `src/src/__tests__/roomProgress.test.js`:
  - the screenshot as a fixture (ROOM_QUESTION, 2 here, round answered 1, ask 2/2) gives
    live 'ask', 2/2, step line "2/2 answered · …";
  - a latecomer after `closedAt` goes to `after`, not `of`;
  - away is split from waiting and stays inside the threshold;
  - more than 6 out gives a count, with the full list in the long form;
  - names lagging the count gives `known: false`, empty names, and the count intact;
  - roster order is kept;
  - no-vote formats (Trivia, Poll) have no vote step;
  - survey uses finished/partway.

### Step 2: Server stamps and names (backend, 1 day)

- `lambda-functions/game/get-game-state.js`: on the host door, add `roundTimes: { askOpenedAt
  (REF StartedAt), voteOpenedAt, resultsAt }` for the current round. Persist `VoteOpenedAt`
  and `RevealedAt` on STATE when VOTE and RESULTS open (`lambda-functions/websocket/start-vote.js`;
  the RESULTS transitions at `lambda-functions/game/get-results.js:256` and
  `lambda-functions/websocket/message.js:391`), beside the existing `PhaseStartedAt`, which the
  next phase overwrites. Mirror in `websocket/` where the copies are held equal.
  Also carry `votingProgress.votersIds` at RESULTS (today only during VOTE), so a reload
  restores the vote count (D3).
- `lambda-functions/game/followups.js` `hostWire`: add `answeredBy: string[]` for a **live**
  ask, from `parseFollowUpSk(row.SK).playerName` over `answerRows`, sorted by the roster's
  join order.
- Tests: `tests/round-times.js` (stamps written once per phase, returned on the host door
  only, absent from `/state`); extend the followups test with "`answeredBy` on the host
  wire only, never on the phone wire" and "`answeredBy` order is not idea order".

### Step 3: Feed the console from the function (1 day)

- `src/src/GameHostPage.jsx`:
  - build `progress = roomProgressFor(...)` once, beside `consoleMoment` (`~:8919`);
  - pass it to `ConsolePulse` (replacing `answered`/`voted`/`everyoneIn`/`openedAt`/`voteAt`/`resultsAt`,
    `:9034-9055`), to `consolePeopleFor` (`:8975-8992`) and to `snapshotFromHostPage`
    (`:7776`, replacing `answeredCount`/`votedCount`/`roomAsk.answered`);
  - `everybodyIn` (`:8778`) becomes `progress.steps[live].all`;
  - the `RESULTS#` restore (`:3966`) sets `playersWhoVoted` from `votingProgress.votersIds`.
- `src/src/config/consolePulse.js`: `pulseFor` takes `progress` and renders §4.2. Delete
  the 'after' summary branch (`:163-164`). Time reads server stamps (§4.4). `ROOM_QUESTION`
  maps to a collecting phase. `withoutRoomCount` covers `ROOM_QUESTION`, or is replaced by
  a `count: false` option on roundStep's status.
- `src/src/components/console/ConsolePulse.jsx`: the step line and the nudge line; the
  accessible name carries the full list; `aria-live` stays polite on the nudge line, at most
  once every 5 s (session-start review L2).
- `src/src/config/consoleRail.js`: `peopleRows` reads `progress.byName` for the live step,
  ROOM_QUESTION and COLLECTING included. The closed "waiting on" clause is removed (subject
  to Q2).
- `src/src/components/console/ConsoleRail.jsx:256`: `status` from `deviceConnected`.
- `src/src/components/stage/AskStage.jsx`: `showCount` prop; false on the console
  (`GHP:9376`).
- **Delete**: `phaseSeenAt` and its stamping effect (`GHP:522-530, 557-560`), `seenFor`
  (`:9001-9006`), `PULSE_WORDS.thisRound` and the 'after' room branch, and `RAIL_WORDS.waitingOn`'s
  header use (if Q2 is yes).
- Tests to move: `consolePulse.test.js`, `consolePulseTimer.test.jsx`, `consoleRail.test.js`,
  `consoleRailDesign.test.jsx`, `roundStep*.test.js`, `roundStepParity.test.js`.
- **New** `consoleProgressOnce.test.jsx`: render the console in each collecting moment
  and assert that exactly one element states the count, and that it matches
  `progressWords`. This is the hard rule 5 guard that would have caught D1/D2.

### Step 4: One screen and the Remote (1 day)

- `GHP:8289-8303` meter and `:8789-8792` dock sentence from `progress`, room question
  included. Never away on one screen; test it in the one-screen privacy suite.
- `src/src/config/hostRemote.js`: `roundProgress` and `waitingOn` as adapters over
  `roomProgressFor`, room question included. `hostRemoteWaitingList.test.jsx` extended.
- `roundStepParity.test.js`: add the ROOM_QUESTION fixture.

### Step 5: Tile 3 and the calm line (after Q3/Q4, ½ day)

- If Q3 is yes: `ConsolePulse` draws two tiles for C&A and Poll, and the joiners move into
  tile 1. `consolePulsePalette.test.js` updated (no geometric assertions, hard rule 13).

### Step 6: Help, README and notes (part of the test push, per CLAUDE.md)

- `src/src/config/help/host-two-screens.js:328, 341-351`: People no longer says "waiting on"
  in the closed header. Describe the Room tile's step line and nudge line, and away.
- `config/help/host-*.js` for one screen (meter on the room question) and the Remote.
- Run `node scripts/help-drift.js`. `helpContent.test.js` must pass. Add a
  `RELEASE_NOTES.md` entry with "What to look at": (1) start a C&A round on dev with two phones,
  answer on one: tile reads 1/2 · Waiting on <name>; (2) vote: "✓ 2/2 answered" above
  "1/2 voted"; (3) reload the console at Results: the counts and "Took" survive; (4) send a
  room question: tile, rail ✓ and Remote agree, and no second count appears anywhere.

---

## 6. Questions for the owner

1. **The nudge threshold.** Names when 6 or fewer are out, the count above that. Is six
   right for your rooms? (The rail used 12 for a header that is read, not said.)
2. **Names move from the closed People header to tile 1.** You accepted "waiting on Marcus"
   in the closed header on 3 Nov. It is rarely seen there because People opens itself
   while the room answers. Move it to tile 1 (always in view) and drop it from the header?
3. **Two tiles, not three, for Call & Answer and Poll?** "Since this round opened" mostly
   says "No one new". Joiners would show in the Room tile only when there are some.
4. **The calm Needs-you line.** Keep it at full height (nothing moves when something
   arrives), or shrink its calm state to a slim strip?
5. **After the round, which record?** "5/5 answered · 4/5 voted" (recommended), or nothing,
   so the tile is blank once nobody is owed anything?
6. **Away on the private console.** Show "away: Tom" (recommended; it is the difference
   between waiting and moving on)? It is never shown on one screen.
7. **A latecomer and the open step.** Someone who joins while answering is still open is
   owed an answer and counts in "of" (recommended). Someone who joins after it closed does
   not. Agree?
