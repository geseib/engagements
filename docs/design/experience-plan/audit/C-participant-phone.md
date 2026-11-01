# Audit C: the participant's journey on a phone

*1 Nov 2026. Read-only audit. No application code changed. Scope: every screen a
participant sees, for every session type, from scanning the code to the session ending.
Every claim has a `file:line` reference. Where I infer something, I mark it **(inference)**.*

Owner context: *"we have 99% of the functionality, just not organized for a simple and
visually appealing experience."* This audit tests that claim against the participant side.
The short answer is that the claim holds. The **chrome** (the bar, the dock, the type ladder)
is mostly unified now, because `PlayerShell` is shared by PlayerPage, SurveyRunner,
BuildPlayer and the event page. The drift lives **inside** the stage. Each type and each
late addition (comments, follow-up questions, Build Room, events) brought its own words, its
own button style, its own heading level and its own idea of where the action goes.

Sources read: `src/src/PlayerPage.jsx` (4,831 lines), `components/PlayerShell.jsx`,
`components/PlayerSurface.css`, `JoinNameCollision.jsx`, `joinResult.js`,
`survey/SurveyRunner.jsx`, `buildroom/BuildPlayer.jsx` and `BuildPlayer.css`,
`event/EventAttendeePage.jsx`, `FeedbackRoundPanel.jsx/.css`, `FollowUpCard.jsx`,
`RootPage.jsx`, `JoinCodeEntry.jsx`, and on the server `game/join-game.js`,
`request-handover.js`, `grant-handover.js`, `handover.js`, `session-gate.js` and
`event-attendee.js`. I also read the prior design work in `docs/design/player-redesign/`
(INVENTORY, RATIONALE), `entry-redesign/`, `phone-comments/README.md`,
`ux-consistency-review-2026-10-08/review.md` and `AUDIT.md`.

---

## 0. The frame every screen shares

`PlayerShell` (`components/PlayerShell.jsx:41-139`) has three regions:

- **Bar.** A 4px phase strip, then the brand mark, `ctx` text, an optional category chip,
  the participant's name with an online dot, **Agenda** (only in an event) and **?**.
  See `:54-114`.
- **Stage.** The only region that scrolls (`:116-118`).
- **Dock.** Holds the primary action and sits outside the scroll. It is omitted entirely
  in rest and watch states (`:119`, header note `:20-24`).

The phone type ladder is 34 / 24 / 19 / 16 / 13 px (`PlayerSurface.css:103-108`). The
primary button `.plr-btn` is full width, at least 56px tall, amber, with a 14px radius
and 19px type (`PlayerSurface.css:518-553`).

This frame is sound and is the thing to build on. Everything below is measured against it.

---

## 1. The journey, screen by screen

### 1.1 Getting in (all types except an event)

| # | Screen | Where | Bar `ctx` | Primary action (place / label / style) |
|---|---|---|---|---|
| J1 | `/join`: 4-cell code entry | `RootPage.jsx:47-180` | none (own `entry-*` page, own header) | in page / **Join**, or **Try again** after a miss / `.entry-btn-primary` |
| J1′ | Marketing home: "Have a code?" | `JoinCodeEntry.jsx:14-73` | none (`jce-*`) | inline / **Join** / `.jce-go` |
| J2 | QR or link lands on `/play?gameId=` | `PlayerPage.jsx:632-670` | | |
| J3 | Join form: code and name | `PlayerPage.jsx:3239-3371` | "Join a session" | dock / **Join Game** / `.plr-btn` |
| J3a | Private: access code | `PlayerPage.jsx:3179-3236` | "Private session" | dock / **Join Game** + **Back** |
| J3b | Join refused (wrong code, not started, network) | inline `.plr-err` at `PlayerPage.jsx:3362-3367` | unchanged | the same **Join Game**, tapped again |
| J4 | Rejoin prompt (same browser, saved name) | `PlayerPage.jsx:3142-3170` | "Welcome back" | dock / **Rejoin as X** + **Join as someone else** |
| J5 | Name taken / name unverified | `PlayerPage.jsx:3093-3129`, `JoinNameCollision.jsx:117-187` | "Join a session" | dock / see §3 |
| J6 | Joined but type unknown | `PlayerPage.jsx:3460-3474` | "In the session" | none, "Loading the session…" |

**There are three different code-entry widgets for one job.** J1 uses `/join` cells
(`RootPage.jsx:86-125`). J1′ uses the marketing `jce` cells (`JoinCodeEntry.jsx:26-56`).
J3 is a plain text input labelled "Session code" with the placeholder **"Game ID"**
(`PlayerPage.jsx:3262-3268`). The page heading says "Join the **session**." (`:3257`)
while the button directly under it says "Join **Game**" (`:3248`, `:3189`).

### 1.2 Call & Answer (and artwork)

| # | Screen | Where | `ctx` | Heading (rung) | Action |
|---|---|---|---|---|---|
| L1 | Lobby | `PlayerPage.jsx:4721-4764` | "In the session" | "Joined as X." (24) | none; "If you lose this page" card |
| A1 | Ask | `:4032-4078` | "Round 3" + category chip | the question as `<p class="plr-q">` (24) | dock / **Submit Answer** |
| A2 | Held while offline | `:3842-3888` | | "Waiting for the connection." | dock / **Change my answer** (ghost) |
| A3 | Receipt | `:4080-4143` | | "Answer received." / "Title received." (24) | none |
| V0 | Ballot not loaded yet | `:4359-4371` | "Voting · Round 3" | "The responses are coming up." | none |
| V1 | Ballot | `:4188-4358` | | "Rank your top three." | dock / slots + **Pick N more to submit** → **Submit Votes**; **Quick Vote / Detailed Vote** toggle in the stage (`:4244-4261`) |
| V2 | Vote receipt | `:4150-4187` | | "Votes Submitted!" | none |
| R1 | Results | `:4608-4654` + `:4666-4678` | "Round 3 · Results" | "You wrote response 4" (**34**, hero) | stage / **Feedback** (ghost, `:4669-4676`) |
| F1 | Own feedback panel | `:3610-3659` | "Round 3 · Feedback" | none of its own | stage / **Post comment** (`fbr__post`), X at top, **Close** / **Go to the question** ghost at the foot |
| F2 | Host-opened feedback | `:4395-4426` | same | same | same, but no X and no exit button |
| Q1 | Host's follow-up question | `:4374-4393`, `FollowUpCard.jsx:58-150` | "Round 3 · Question" | `h2.fu-q` | stage / `.plr-btn` inside the card (`FollowUpCard.jsx:141`) |
| B1 | Between rounds | `:4691-4720` | "In the session" | "Nothing to do here." | none |
| E1 | Ended | `:3666-3748` | "Session complete" | "Thanks for playing, X." (34) | none outside an event. In an event: dock / **Back to the agenda** (`:3742-3748`). **Something to add?** round list in the stage (`:3689-3728`) |

### 1.3 Trivia

The same as Call & Answer except for these screens:

- **A1:** option buttons A–F (`:3893-3951`), then dock **Submit Answer** with a "B
  selected…" note.
- **A3:** "Answer Submitted!" (`:4102`).
- **No vote.**
- **R1:** "You answered" / "B. Correct." at **24**, not 34 (`:4529-4561`), with two rows
  and the score.

### 1.4 Poll (typed polls since 27 Sep)

- **A1:** the survey's own input control (`:4012-4031`). No "Your task" block appears,
  although every other type shows one (`taskBlock` is left out at `:4019-4025`).
- **A3:** "Answer In!" (`:4104`).
- **No vote.**
- **R1:** "Your answer" / *the participant's free-text answer as the hero heading at 34px*
  (`:4602`). A typed paragraph is set at the size reserved for one object owning the
  screen.

### 1.5 Wavelength

- **A1:** ten stacked labelled inputs (`:3952-4011`). The dock reads **Submit Words
  (3/10)**, and the note beside it says "Fewer is fine". The INVENTORY flagged this
  label/note contradiction in August (`player-redesign/INVENTORY.md` §4) and it is still
  shipped at `:4008`.
- **A3:** "Words Submitted!" with chips.
- **R1:** "Your words" / "You sent 6." (24) with chips (`:4563-4592`).

### 1.6 Survey (its own runner, inside the same shell)

| # | Screen | Where | `ctx` | Action |
|---|---|---|---|---|
| S0 | Not open yet | `SurveyRunner.jsx:389-399` | "Survey" | none; "Joined as X." |
| S1 | Question n of N | `:557-611` | "3 of 8", plus a progress strip | dock / **Back** + **Next** / **Skip** / **Review** in a pair (`:574-592`) |
| S2 | Review | `:442-517` | "Survey" | dock / **Back** + **Send my answers** |
| S3 | Sent | `:424-439` | "Sent" | stage / **Change my answers** as a quiet link (`:431`) |
| S4 | Closed | `:370-385` | "Survey closed" | none |
| S5 | Feedback round (host-opened) | `PlayerPage.jsx:3491-3503` | "Feedback" | as F2 |
| S6 | Ended | `:355-367` | "Session complete" | none: "You can close this page." |

The bar's **category chip carries the survey's title** (`SurveyRunner.jsx:347-349`). In
games the same chip carries the question's category (`PlayerPage.jsx:3752`). One slot has
two meanings.

### 1.7 Build Room participant (`BuildPlayer`, inside the same shell)

| # | Screen | Where | Action |
|---|---|---|---|
| BR0 | "Joining the build…" | `BuildPlayer.jsx:1316-1324` | none |
| BR1 | Watch: "Claude is building" / "Waiting for Claude" | `:1485-1509` | stage / **Send an idea to the host** (`bpl-ideabtn`, `:1395-1399`) |
| BR2 | Ideas ask | `:259-300` | dock / **Suggest** (`.plr-btn`) |
| BR3 | Choose / Rate ask | `:372-441` | dock / **Pick A**, **Change to B**, **Rate 4** |
| BR4 | Ideas vote | `:497` | dock |
| BR5 | Results / Decided | `:1455-1479` | stage / various `bpl-send` |
| BR6 | Ended: "That's a wrap" (24) | `:1413-1424` | none |
| BR7 | Moved / removed | `:1294-1314` | none |

Build Room adds **Now · Ideas · History tabs** inside the stage (`:1347-1355`). It is the
only type with tabs. On Ideas and History the dock disappears (`:1404-1410`). Its
secondary buttons are a different component again: `.bpl-send` is blue-tinted with a 12px
radius at 16px (`BuildPlayer.css:600-629`), and `.bpl-ideabtn` is transparent with
periwinkle text (`:572-582`).

### 1.8 Event with several items (`EventAttendeePage`)

| # | Screen | Where | `ctx` | Action |
|---|---|---|---|---|
| EV0 | Opening / missing | `EventAttendeePage.jsx:316-344` | "Event" | quiet link **Type a different code** / **Try again** |
| EV1 | Name, once for the day | `:346-399` | event title | dock / **Join the event** |
| EV2 | Agenda (before / between / after) | `:525-588` | event title | dock / **Back to live · {item}** when something is live |
| EV3 | Switch beat ("Trivia · 2 of 5") | `:408-427` | "Title · 2 of 5" | none, and the strip is painted `phase="ask"` |
| EV4 | Item joining / not in | `PlayerPage.jsx:3057-3087` | "Joining" | dock / **Try again** on error |
| EV5 | The item itself | the PlayerPage, Survey or Build screens above, with **Agenda** in the bar (`PlayerShell.jsx:70-74`) | | |
| EV6 | Paused | `:445-468` | | dock / **Open the agenda** |
| EV7 | Talk / activity: "Look up" | `:492-522` | event title | none; **Show the slides here** link |
| EV8 | Break: "Back at 11:15" | `:475-489` | | none |
| EV9 | Item ended (game) | `PlayerPage.jsx:3666-3748` | "Session complete" | dock / **Back to the agenda** |
| EV10 | Day over: "That's the day." | `:530-532` | | none |

### 1.9 What is the same and what differs across types

| Aspect | Same everywhere | Differs |
|---|---|---|
| **Header** | Shell bar, name, dot, ?, Agenda in events | `ctx` grammar changes from screen to screen: "Round 3", "Voting · Round 3", "Round 3 · Results", "Round 3 · Feedback", "3 of 8", "Sent", room title (Build), "Title · 2 of 5" (event). The category chip means category in games and the session title in a survey. |
| **Status strip** | 4px | `ask`/`vote`/`join`/`done` are styled (`PlayerSurface.css:209-211`, `:1461`). Game ENDED never sets `done` (`PlayerPage.jsx:3666-3669`), so its strip stays neutral, while survey ENDED/CLOSED (`SurveyRunner.jsx:356,372`) and the event's end (`EventAttendeePage.jsx:539`) go green. The event switch beat paints the *ask* colour on a screen with nothing to answer (`:411`). |
| **Primary button** | `.plr-btn` in the dock for join, ask, vote, survey and Build asks | The action leaves the dock for comments (`fbr__post`, 8px radius, 44px, 15px: `FeedbackRoundPanel.css:235-250`), the follow-up question (`FollowUpCard.jsx:141`, in the stage), Results → **Feedback** (`PlayerPage.jsx:4669`), ended **Something to add?** (`:3706-3722`), survey **Change my answers** (`SurveyRunner.jsx:431`), and Build `bpl-send` / `bpl-ideabtn`. |
| **Typography** | Phone ladder 34/24/19/16/13 | The comment panel runs the **laptop** ladder 12/13/15 (`FeedbackRoundPanel.css:58-60`). The results heading is 34 for C&A and poll (`:4641`, `:4602`) but 24 for trivia and wavelength (`:4532`, `:4578`). The question is a `<p>` in games (`:3797`), an `<h1>` in a survey (`SurveyRunner.jsx:607`) and an `<h2>` in Build (`BuildPlayer.jsx:192`). |
| **Colour** | Dusk, amber reserved for the task | Build introduces a blue tint for secondary actions (`BuildPlayer.css:607`). The follow-up and comment panels run their own scope tokens. |
| **Waiting** | "This page will change on its own" is a good repeated phrase | Seven headings say "nothing to do" in different ways: "Joined as X." (lobby), "Nothing to do here." (between rounds, and the event agenda at `EventAttendeePage.jsx:530`), "The responses are coming up." (`:4364`), "The host is preparing this round for feedback." (laptop-ladder 15px, `FeedbackRoundPanel.jsx:206`), "The host will be back." (paused), "Waiting for Claude" (Build), "Back at 11:15" (break). |
| **Receipts** | "Submitted" label + card | Heading tone varies: "Answer Submitted!", "Words Submitted!", "Answer In!", "Answer received.", "Title received.", "Votes Submitted!" (`:4102-4107`, `:4165`), "Thanks, X — that's everything." (survey). Lock rules differ too. Games say "This is locked for the round" (`:4128`). A survey can change until it closes (`SurveyRunner.jsx:429`). Build offers **Change to B** (`BuildPlayer.jsx:375`). A poll is locked. |
| **Results** | "Personal half only; the room's result is on the main screen" (LookUpCue) | Four different body shapes, three heading sizes, and **Feedback** on game results only. A survey's results reach the phone only if the host opens a feedback round. Build shows the room's results on the phone (`BuildPlayer.jsx:1469`), which breaks the "phone is the personal half" rule every other type follows. |
| **Ending** | "That's a wrap" eyebrow | "Thanks for playing" (games) vs "Thanks for taking part" (survey) vs a "That's a wrap" heading (Build) vs "That's the day." (event). **Final score** shows for poll and wavelength (see P6). **Something to add?** appears only on game ends. |

---

## 2. Inconsistencies, dead ends and recovery

### 2.1 One concept, several words

| Concept | Words in use | Where |
|---|---|---|
| The thing you joined | session / game | "Join the session." vs **Join Game** (`PlayerPage.jsx:3257` / `:3248`); placeholder "Game ID" (`:3268`); server says "Game not found" / "This game has not been started" (`session-gate.js:51,63`) |
| Commenting | Feedback / Comment / Something to add? | Results button **Feedback** (`:4675`); panel lead "Tap **Comment**" (`FeedbackRoundPanel.jsx:214`); bar "Round 3 · Feedback"; ended section "Something to add?" (`:3691`); phone-comments D9 already proposes one vocabulary |
| Workie's output | AI summary / Workie's read / the summary | `phone-comments/README.md` fault 5; panel lead says "on the summary" (`FeedbackRoundPanel.jsx:214`) |
| Sending | Submit Answer / Submit Words / Submit Votes / Send my answers / Post comment / Suggest / Pick A / Rate 4 / Send | the dock labels listed in §1 |
| Device | "this phone" in participant copy, against the owner's P6 rule (`ux-consistency-review-2026-10-08/review.md:119-121`) | `PlayerPage.jsx:3161` ("This phone joined session…"), `:3879`, `:3446`, `:4748`; Build `words.js:762-769` ("on your phone") |
| The way back | "Keep this page open — the same code and name will bring you back" | `:3251`, `:3349`, `:4752-4755`. This is true only on the **same browser**. See §3. |

### 2.2 Primary actions that move

- **Join, ask, vote, survey and Build asks put the action in the dock.** The comment
  composer's **Post comment** sits in the stage, under a report that can run long
  (`FeedbackRoundPanel.jsx:233-280`). Its exit appears twice: an X at the top (`:3622-3629`)
  and a ghost `.plr-btn` at the foot of the stage (`:3655-3657`). The host-opened variant
  (F2, `:4419-4425`) has **neither** exit.
- **Results → Feedback** is a ghost `.plr-btn` appended into the stage after the LookUpCue
  (`:4666-4678`). On a long trivia result it sits below the fold. That breaks the shell's own
  rule, "scrolling to act is not fine" (`PlayerShell.jsx:14-16`).
- **The follow-up question's** Send is a `.plr-btn` inside the card, in the stage
  (`FollowUpCard.jsx:141`), and the page passes no `dock` for it (`PlayerPage.jsx:4382-4393`).
- **Build Room:** the dock vanishes when the participant switches to Ideas or History
  (`BuildPlayer.jsx:1407`). On the watch screen the only action, **Send an idea to the
  host**, is a periwinkle in-stage button below the feed.
- **The vote screen** puts a mode toggle (**Quick Vote / Detailed Vote**) between the
  question and the ballot (`:4244-4261`). The design deleted it (RATIONALE §6.1). It was
  kept only to preserve a test (`:4237-4243`).

### 2.3 Styles that look like different apps

- **The comment panel** is a laptop surface pasted into a phone: 12/13/15 px
  (`FeedbackRoundPanel.css:58-60`), 8px-radius buttons, and section headings at 12.8px
  uppercase 60% opacity (phone-comments fault 1). Its "Comment" buttons render as unstyled
  16px text because their tokens are scoped to a sibling (phone-comments fault 2,
  `RoundReport.css:50-62` vs `:160-176`).
- **Build Room** has tabs, blue-tint buttons, eyebrow "Ideas · Ask 3", and an `h2` question.
  It reads as a second product inside the same frame.
- **The three join pages** (§1.1) are three visual languages for four digits.
- **Results heading sizes** jump between 34 and 24 by type (§1.9).

### 2.4 States that leave a participant unsure what to do

- **Poll and wavelength end with "Final score 0".** The ENDED screen prints Final score
  unconditionally (`PlayerPage.jsx:3676-3679`). The results screen gates the same rows on
  `hasScoreboard(gameType)` (`:4446`) precisely because "+0 / Total 0 there read as a wrong
  answer" (`:4442-4445`). The end screen never got that fix.
- **"Thanks for playing"** appears on a poll's end (`:3673`).
- **The survey inside an event says "You can close this page."** (`SurveyRunner.jsx:360`).
  The event's own rule is the opposite: "Keep this page open: the next item starts here by
  itself" (`PlayerPage.jsx:3735-3736`). SurveyRunner gets no `event` prop (`:3529-3537`), so
  it cannot know. A survey is an event item type (`agenda-rules.js:49`).
- **A survey item's end has no Back to the agenda dock.** The game end has one
  (`:3742-3748`). Only the bar's small Agenda button is left.
- **The vote screen before the ballot loads** ("The responses are coming up.", `:4359-4371`)
  carries no question, so a late joiner does not know what is coming **(inference** from the
  branch body).
- **The LookUpCue** sends every watch screen to "the main screen". A participant on a
  survey link or a call has none **(inference:** nothing in the cue's callers checks for a
  room).

### 2.5 Dead ends

- **Join before the host starts.** The server answers 403 "This game has not been started
  yet. Please wait for the host…" (`session-gate.js:57-66`). The form shows it inline
  (`PlayerPage.jsx:3362`) and nothing retries. The participant has to guess when to tap
  **Join Game** again. Nothing in PlayerPage handles `not-started` beyond showing the
  message.
- **Wrong code on the in-page form shows "Game not found".** `classifyJoinFailure`
  prefers `payload.error` over its friendly default (`joinResult.js:273-279`), and
  `session-gate.js:51` sends only `{error:'Game not found'}`. The friendly sentence "No
  session with that code. Check the main screen…" never shows.
- **Name-taken loop.** See §3. After "asked", the ask button never comes back.
- **The old device after a takeover** in any non-Build session stays on the session screen
  with no notice (§3.5).

### 2.6 Recovery paths and how easy they are to find

| Situation | What happens | How easy to find |
|---|---|---|
| Lost connection mid-answer | Amber banner (`:3415-3424`); the answer is held and sent on reconnect (`:3842-3888`, `:2575-2584`) | Good |
| Lost connection mid-**vote** | Votes go over HTTP with no hold. The failure is a native `alert()` (`:2750`), as is "Voting has closed. Moving to results..." (`:2726`) | Poor. A system dialog reads as a crash (review F23) |
| Answer submit throws | `alert('Failed to submit answer…')` (`:2591`) | Poor |
| Round closed while offline | "Your last answer did not reach the room" banner (`:3442-3453`) | Good |
| Reload, same browser | Rejoin prompt (`:3142-3170`) | Good |
| **New device, same session** | Name taken → ask the host (§3) | **Hidden.** Every on-screen hint says "same code and name will bring you back" (`:3251`, `:4752-4755`). Only the help guide says otherwise (`config/help/player.js:834`) |
| New device, **event** | Name step again, which mints a second attendee. The item seats them as **"Chris 2"** (`event-attendee.js:66`; `join-game.js` joinAsAttendee seat loop), and earlier answers and score do not follow **(inference** from the seat logic). No takeover is offered. | Invisible until results or the leaderboard |
| Late join | Lands on whatever state is live. C&A results say "You didn't send a response this round" (`:4637`) | Acceptable |
| Looking at the agenda mid-item | Session stays mounted and hidden; **Back to live** (`EventAttendeePage.jsx:291-297`, `:544-548`) | Good |

---

## 3. Taking over a name, or moving device: the participant's side, end to end

### 3.1 How they get there

- **Device B opens a link with `?name=Chris`.** The URL gains `?name=` only after a
  successful join (`:839-842`). The page auto-joins (`:647-661`) and is refused with 409
  `NAME_TAKEN`, because B's `clientId` differs. The clientId is per browser per session in
  localStorage (`joinResult.js:209-245`, `join-game.js:82-91`).
- **Or B types the code and "Chris".** The result is the same refusal.
- **A private tab or cleared storage on the *same* phone** also gets a new clientId and
  lands here **(inference** from `getClientId`).

### 3.2 What they see

1. **"That name is taken."** at 24px, with the server sentence: *"Someone in this session
   is already answering as "Chris". Add a last initial or pick another name so the host can
   tell you apart."* (`JoinNameCollision.jsx:171-177`, `join-game.js:104-105`). The sentence
   assumes they are a *different* person. Nothing on screen says "if this is you on another
   device…", although the dock offers exactly that.
2. **Dock:** **Ask the host to hand it over** (amber) and **Pick a different name** (ghost)
   (`JoinNameCollision.jsx:144-157`).
3. **After the ask** (`PlayerPage.jsx:2838-2856`): the note reads *"Asked the host to hand
   "Chris" over. When they say go ahead, tap Take over the name."* (`JoinNameCollision.jsx:94`).
   The amber button becomes **Take over the name**. The stage advances to `asked` **even if
   the request failed** (`:2849-2855`, deliberately).
4. **Waiting.** The phone shows nothing: no spinner, no live update, no timer. The phone
   **never learns** that the host unlocked the name. It has no socket before joining, and
   no polling. The flow depends on the host **saying "go ahead" out loud**.
5. **They tap Take over the name** (`:2869-2890`). This is a join retry with
   `claimExisting`.
   - The host granted within the last 5 minutes (`grant-handover.js:42,312`;
     `handover.js:44-50`): the participant is in, with Chris's answers and score.
   - Not granted: *"The host has not unlocked "Chris" yet. Ask them out loud, then try
     again."* (`JoinNameCollision.jsx:102`).
   - The host pressed Not now: *"The host said not now."* (`:97`). The button **still
     reads Take over the name**, which only fails again.

### 3.3 What the host sees (and why they may not)

- The request pings the host socket with `handoverRequested` (`request-handover.js:126-132`).
  The host page's only reaction is to **refetch the player list** (`GameHostPage.jsx:2846-2848`).
  There is no toast, bell or badge.
- The flag "Asking to take this name" appears on the row in the roster
  (`stage/PlayersList.jsx:126-129`), inside the Session setup panel
  (`SessionSetupPanel.jsx:617`). A host running the stage who does not have that panel open
  sees nothing **(inference:** I found no other handler).
- `HostRemote.jsx` (the host's phone remote) has no handover handling at all.
- The Build Room solved this for itself. It puts a `HandoverStrip` on the host's main
  screen, with Let them / Not now / See (`BuildRoomPage.jsx:1417,1590`;
  `BuildSessionPanel.jsx:135-157`). The games host page has no equivalent.
- **Not now** is wired only in the Build Room. Everywhere else the host has only **Unlock
  name / Let them take it** and **Remove** (`PlayersList.jsx:111-114`). So in a game the
  participant can never reach the `declined` state.

### 3.4 If the host never sees it

- The participant stays on "That name is taken." indefinitely.
- Each tap of **Take over the name** returns "has not unlocked yet".
- The button never goes back to **Ask the host…**, because `asked = handoverStage !==
  'idle'` (`JoinNameCollision.jsx:142`). They cannot re-send the ping without first choosing
  **Pick a different name** and retyping the same name, which resets to idle (`:2820-2824`,
  `:777-786`).
- If the host unlocks and the participant taps more than 5 minutes later, the grant has
  expired. The screen still says "not unlocked yet", so the participant blames the host.
- The only real way out is the one the screen tells you to avoid: **Pick a different
  name**. That loses their answers and score.

### 3.5 What happens to the old device

- **Build Room:** the old device gets "This name is on another device now. Join again with
  another name." (`BuildPlayer.jsx:1294-1299`).
- **Every other type:** PlayerPage registers no `playerRemoved` / `moved` message
  (`PlayerPage.jsx:958-1160`). The old phone keeps showing the live session under the same
  name. The websocket answer handlers do not check `ClientId` (no match for `ClientId` under
  `lambda-functions/websocket/`), so **(inference)** the old device can keep answering as
  "Chris" and race the new one.

### 3.6 The `name-unverified` branch

This branch covers sessions created before identity stamping. It asks "Are you the Chris
already here?" with **Yes — rejoin as Chris** / **No — I'm a different Chris**
(`JoinNameCollision.jsx:129-139`). This is the simple self-serve flow participants actually
need. The `name-taken` branch cannot offer it, for good reason, but it should *look* like
the same family of screen. Today the step it adds is invisible.

---

## 4. Top 10 problems, ranked by impact on participants

| # | Problem | Evidence | Fix direction (one line) |
|---|---|---|---|
| **P1** | **Moving device is a hidden, open-loop flow.** Every hint promises "same code and name brings you back", which is false on a new device. The ask reaches the host only as a roster flag. The phone never learns of the grant. The ask button never returns. The 5-minute grant expires silently. | `:3251`, `:4752-4755`; `GameHostPage.jsx:2846-2848`; `JoinNameCollision.jsx:142`; `grant-handover.js:42` | Make it a waiting state that updates itself (poll or socket for the grant, then join automatically), port Build's `HandoverStrip` so the games host sees the ask, and change the copy to "on another device? ask the host". |
| **P2** | **The old device is never told** that its name moved (non-Build), and may keep answering. | `PlayerPage.jsx:958-1160`; vs `BuildPlayer.jsx:1294-1299` | Port Build's "This name is on another device now" screen to every type. |
| **P3** | **Comments look and behave like a different app**: laptop type ladder, in-stage Post, no exit on the host-opened variant, ambiguous "Comment" buttons, and the button called "Feedback". | `FeedbackRoundPanel.css:58-60,235-250`; `PlayerPage.jsx:4419-4425,4675`; phone-comments faults 1-10 | Ship the phone-comments D1-D10 on the phone ladder, with Post in the dock and one name ("Comment on this round"). |
| **P4** | **The primary action moves.** Dock for ask and vote. In-stage for Feedback, follow-up Send, Something to add?, Change my answers, and Build's idea button. Below the fold on long results. | `:4669`, `FollowUpCard.jsx:141`, `:3706`, `SurveyRunner.jsx:431`, `BuildPlayer.jsx:1395` | One rule: whatever the participant can do next lives in the dock, every type, every phase. |
| **P5** | **The event's promise breaks on survey items**: "You can close this page" mid-event, and no Back to the agenda. A new device in an event silently becomes "Chris 2". | `SurveyRunner.jsx:360`; `PlayerPage.jsx:3529-3537`; `event-attendee.js:66` | Pass `event` to SurveyRunner and BuildPlayer and share one item-ended screen; offer "Is this you?" on an event name match. |
| **P6** | **End screens disagree and mislead**: Final score 0 on poll and wavelength, "Thanks for playing" on a poll, Something to add? only for games, strip colour differs. | `:3676-3679` vs `:4446`; `:3673`; `:3666-3669` vs `SurveyRunner.jsx:356` | One ended screen per session with type-aware rows (score only where `hasScoreboard`), the same comment door, and `phase="done"`. |
| **P7** | **Joining has three widgets and two nouns**: `/join` cells, marketing cells, and a plain "Game ID" field under "Join Game". The wrong-code message reads "Game not found". | `RootPage.jsx:86-125`; `JoinCodeEntry.jsx:26-56`; `PlayerPage.jsx:3248,3268`; `joinResult.js:273-279` | Reuse one code component everywhere, say "session" throughout, and let the client's friendly 404 copy win. |
| **P8** | **Joining early dead-ends**: "not started yet, please wait" with no auto-retry. | `session-gate.js:57-66`; `PlayerPage.jsx:3362` | Treat not-started as a lobby: hold the name and join automatically when the host starts. |
| **P9** | **Vote errors are native `alert()`s, and votes are not held offline**, unlike answers. | `:2591`, `:2674`, `:2687`, `:2698`, `:2726`, `:2750` | Hold votes like answers, and report status in the dock (`StatusMessage`), never `alert()`. |
| **P10** | **The same moment gets different words, sizes and headings across types**: six receipt headings, results at 34 vs 24, the question as `p` / `h1` / `h2`, seven "waiting" phrasings, Build's blue-tint buttons and tabs, and a vote-mode toggle the design had deleted. | §1.9 table; `:4102-4107`, `:4602`/`:4641` vs `:4532`/`:4578`; `:3797`, `SurveyRunner.jsx:607`, `BuildPlayer.jsx:192`; `BuildPlayer.css:600-629`; `:4244-4261` | Write a phone screen grammar (eyebrow, h1 at one rung, one card, dock) with a fixed word list, and apply it to every type. |

---

### Notes for whoever acts on this

- None of this needs new features. Every fix above re-organises something that already
  exists, which is consistent with the owner's "99%" reading.
- The two prior design sets (`player-redesign/`, `phone-comments/`) are mostly still right.
  The drift happened because the features added after August (typed polls, comments,
  follow-ups, events, Build Room) were each built to their own local pattern rather than
  the player-redesign grammar.
- Items marked **(inference)** should be checked by driving the flow on dev before they are
  scheduled. That applies especially to §3.5 (the old device answering) and the event
  "Chris 2" seat.
