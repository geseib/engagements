# Inventory of player screens and room screens, mapped to the help

This was read-only; I changed nothing. Paths are relative to `/home/user/engagements/src/src` unless they start with `lambda-functions/`. The Build Room's player page and wall are left out.

**About the dates.** Git history starts with a bulk commit, `ffceee0f` on 2026-10-15 (2852 files, message "Session flow v3, phase 3: one Ask the room composer…"). Wherever a table says **10-15***, the file has not changed since history began. The last change to the player help (`config/help/player.js`) was 2026-10-19 (Build Room). `host.js` changed 10-21 and `technical.js` 10-16.

**Help entry points.**
- **Phone:** every phone screen is drawn inside `components/PlayerShell.jsx` (10-15*). Its top bar always has a `HelpButton` with `section="player"`, so it shows even when a screen has no action buttons. It opens a menu with "Read the guides", "Report a bug", "Request a feature" and "Ask for help".
- **Room:** the room's window (`/present`) and the one-screen stage have no help entry, and that is deliberate: they show no controls.
- **Accessibility:** players have no theme or text-size setting. The shell is forced to `data-theme="dark"`, and `PlayerSurface.css` has no reduced-motion rule. No guide mentions any of this.

## 1. Player screens and states

PP is `PlayerPage.jsx`, last changed 10-17 ("Issue #35 fixes…"). The help column refers to the guides listed in section 3.

| Screen / state | File(s) | Types | Key parts | Help coverage |
|---|---|---|---|---|
| Code-only entry `/join` | `components/RootPage.jsx`, `JoinCodeEntry.jsx`, `hooks/useJoinCode.js` (10-15*) | all | "Enter the 4-digit code", cleans up pasted links, sends event codes to `/play?event=`; error "Nothing is running under {code}…" | Joining › Getting in (partly; the error text is wrong, see S8) |
| Join form | PP 3128-3260 | all | Session code (locked when it came in a link, with "Use a different code"), Your name, a note about names (a different one for surveys), **Join Game** | Joining › Getting in |
| Private session | PP 3069-3126 | all | "This session is private.", access code, Join Game / Back | **NOT COVERED** |
| Rejoin prompt | PP 3032-3058 | all | "Welcome back." "Rejoin as {name}" / "Join as someone else" | **NOT COVERED** (the guide describes a different screen, S5) |
| Name taken / handover | `JoinNameCollision.jsx` (10-15*), PP 2984-3019 | all | "That name is taken." "Ask the host to hand it over" changes to "Take over the name"; "Pick a different name"; notes for asked, "The host said not now.", and refused | Joining › When your name is taken (the "not now" outcome is missing) |
| Name unverified | same | older sessions only | "Are you the {name} already here?" "Yes — rejoin…" / "No — I'm a different…" | Joining › If you lose the page (wrongly framed as the normal case) |
| Join errors | `components/joinResult.js`, `lambda-functions/game/session-gate.js` | all | not started, not found, wrong access code | Joining › Other things… (stale, S6-S8) |
| Loading the session | PP 3348-3362 | all | "Loading the session…" | NOT COVERED (minor) |
| Lobby (before the first round) | PP 4584-4626 | C&A, Trivia, Poll, Wavelength | "Joined as {name}." About this session, "If you lose this page", a look-up cue | Getting started (in general terms) |
| Between rounds | PP 4553-4582 | same | "Nothing to do here.", your total and standing | NOT COVERED |
| Answer: C&A text box | PP 3896-3943 | C&A (and artwork rounds) | question folds while typing, "Your task", character count, the names note, **Submit Answer** | Playing › Answering |
| Answer: Trivia | PP 3757-3815 | Trivia | options A to F, "{X} selected. You can change it until you submit." | Playing › Answering |
| Answer: Wavelength | PP 3816-3875 | Wavelength | 10 word fields, "Aim for ten…", "Submit Words (n/10)" | Playing › Answering (no guidance on aiming for the obvious word) |
| Answer: Poll (choice, rating, yes/no, open) | PP 3876-3895 and `survey/*Input.jsx` | Poll | the survey's own input controls | Playing › Answering |
| Answer held while offline | PP 3706-3752 | all round types | "Waiting for the connection.", "Change my answer" | NOT COVERED |
| Answer submitted | PP 3944-4008 | all round types | "Answer received." / "Answer Submitted!", what you sent, "This is locked for the round." | contradicted (S1) |
| Vote: waiting for the ballot | PP 4223-4235 | C&A | "The responses are coming up." | NOT COVERED |
| Vote: the ballot | PP 4052-4222, DetailedVotingMode ~2830-2920 | C&A | names-hidden line, Quick or Detailed vote, own answer marked "Yours" and rankable, "Send it anyway" for a late draft, slot bar, "Pick N more to submit" | Playing › Voting / Reading a long answer (S2, S3) |
| Read one answer in full | `components/AnswerSpotlight.jsx` (10-18) | C&A vote | Previous/Next, ← → keys, Esc | Playing › Reading a long answer |
| Vote submitted | PP 4014-4051 | C&A | "Votes Submitted!", your ballot, locked | NOT COVERED |
| Results: C&A | PP 4468-4516 | C&A | "You wrote response N", round, total and standing, "this page will not repeat them" | Scoring (in part) |
| Results: Trivia | PP 4329-4421 | Trivia | "Correct." / "Not this time.", your row and the correct row, score rows | Scoring › How points are earned |
| Results: Wavelength | PP 4423-4452 | Wavelength | "You sent N.", word chips, a score row showing +0 | not described (S12) |
| Results: Poll | PP 4454-4467 | Poll | your answer, look-up cue | not described |
| Feedback button on every results screen | PP 4518-4540 | all round types | "Feedback" opens the player's own comment panel | indirect (Playing › Answering, "A question for the room…" note) |
| Player's own feedback panel | PP 3498-3542, `FeedbackRoundPanel.jsx` (10-16) | all round types | the round's report, "Commenting on…", **Post comment**, notes for "next question is live" and "session has ended" | same note |
| Feedback round opened by the host | PP 4259-4290 | all round types | "The host is preparing this round for feedback." | NOT COVERED |
| Question for the room (Choose, Rate, Ideas) | `FollowUpCard.jsx` (10-16), `config/followUpWords.js`, PP 4238-4257 | C&A | the question, the right input, counts, sent late after results are up | partial (one sentence) |
| Held question for the room above the next round | `HeldFollowUp`, `utils/useHeldFollowUp.js` (10-16) | C&A | "Leave it" / "Done" | NOT COVERED |
| Banners | PP 3303-3341 | all | "Offline. Reconnecting…", "Kept, but late.", "Your last answer did not reach the room." | partial (S9; the missed-answer banner is not covered) |
| End screen | PP 3549-3612 | round types | "Thanks for playing", final score and standing, **Something to add?** round buttons, look-up cue, "Back to the agenda" when in an event | Playing › Answering (note) |
| Survey: not open yet, loading, failed to load | `survey/SurveyRunner.jsx` 387-421 (10-15*) | Survey | "The survey opens when your host is ready." | NOT COVERED |
| Survey: answering | SurveyRunner 519-611 | Survey | "N of M" progress, names promise above Q1 (Anonymous / Who finished / Named, `config/surveyNames.js`), needs an answer vs optional, Back, Next or Skip, autosave line, rank input | partial (one line; names, rank and autosave missing) |
| Survey: review, sent, closing soon, closed, ended | SurveyRunner 331-485 | Survey | "Check your answers", "Send my answers", "Change my answers", closing-soon timer, "The survey is closed." | partial |
| Survey: feedback after close | PP 3379-3391 | Survey | comment panel with no names | NOT COVERED |
| Event attendee page `/play?event=` | `components/event/EventAttendeePage.jsx` (10-15*) | event | Opening, missing; "Join the event" name step; agenda; "Back to live"; item change screen; Paused; Break "Back at…"; talk "Look up" with slides on the phone; "That's the day."; "Not you?"; "Agenda" button in the bar | **NOT COVERED** (no player text mentions events) |
| Event item: joining | PP 2949-2978 | event | "Getting you in…" / "Not in yet." Try again | NOT COVERED |
| Scoreboard on the phone | none (phone shows only total and standing) | — | — | Scoring › The scoreboard (describes the room's board) |

## 2. Room screens and moments

**Two screens (the room's window).** `/present` is `PresentPage.jsx` (10-18), `present/presentModel.js` (10-19), `present/PresentMoments.jsx` (10-19) and `present/PresentStage.jsx` (10-18). It exists **only for Call & Answer** (and Build): `config/surfaces.js:26` sets `TWO_SURFACE_TYPES = ['call-and-answer','build']`.

**One screen.** Trivia, Poll, Wavelength and Survey are always one screen. The room watches the host's stage in `GameHostPage.jsx` (10-19), built from `components/stage/*`.

| Moment | Two screens (`/present`) | One screen (stage) | Key parts | Help |
|---|---|---|---|---|
| Lobby | `PresentLobby` | GameHostPage `hostPhase==='LOBBY'` joinblock and QR | big title, Event Details, "N in the room", QR, "Scan to join / no app, no account", address, Session code | host Quick start › Step 2 |
| Answering | `PresentAnswering` and `RoomQuestion` | `QuestionCard`, `RoomMeter`, `CompletionFlag`, `PhaseBar`, `Rail` | title leads; lesson below it at secondary size, never dropped; "Your turn" band; "x of n answered" meter | host › Settings worth a look (room content paragraph) |
| Voting, overview | `PresentVoting` (all answers fit) | ballot list, `Pager` | every answer whole and numbered, no tally, no names | same |
| One vote response up | `VoteFocus` | stage focus | the answer large, number chips, no name | same ("click an answer… Esc") |
| Results tally | `PresentTally` | stage C&A results; Trivia `QuestionCard phase="REVEAL"`; `WavelengthConvergence`; `PollBoard` | "The room's pick", share bars, no points while names are hidden, "and N more", "Talk about it" | same, and Step 4 |
| One result up | `ResultFocus` | stage focus | its place (e.g. "2nd"), a ladder, credit only when names show | same |
| Workie's read, and waiting for it | `ReadPage`, `PresentQuiet` with "Workie is writing…" | field-notes beat | paged, "Page x of y" | host › Results and reports › What the AI writes |
| Feedback | `PresentFeedback` | `FeedbackWall` | "Provide feedback on the round from your phone, laptop or tablet." or the comment the host put up | host Late answers and comments (in part) |
| Question for the room, live and results | `PresentAsk` | `AskStage` | options or 1-5 scale; bars, average, or the ideas the host picked | partial (host side only) |
| Question focus | `PresentQuestionFocus` | stage | the question put back up during voting or results | host › Two screens (main area row) |
| QR side panel | `JoinPanel` via `withJoin` (only during ASK, VOTE, RESULTS; when there is nothing else to show it takes the whole wall) | `StageJoinPanel` (10-19) | QR, address, code beside the content | host › Settings ("Show the QR…") |
| Ended | `PresentEnded` (rounds played, room count, podium) or a quiet "Thank you" | `Podium`; `WavelengthSessionVocabulary` for Wavelength | — | NOT COVERED for the room |
| Survey | `/present` shows "This session shows on the host's screen." | `SurveyCollecting`, `SurveyClosed`, `SurveyWalkthrough` | QR stays up; counts only | host Step 3 (one line) |
| Scoreboard overlay | `Scoreboard` over any moment | `stage/scoreboard/*` (departure, olympic, tote) | Trivia and C&A only | host keys S and V |
| Phase wipe, strip, safety ask | `PhaseWipe`; strip with Back / Show QR (J) / Forward; "Next step" confirm | `PhaseBar` | — | NOT COVERED (on the room's window) |
| Placement and fill | `present/roomWindow.js` (10-18), `FillCue` "Click anywhere to fill the screen" | — | — | host › Two screens (Chrome/Edge note) ✓ |
| Display profiles room / tv / call / table | `config/displayProfile.js`, `PRESENT_LADDERS` | same | — | host Settings table ✓; technical uses the old name (S13) |
| Event stage | — | `components/event/EventStage.jsx` (10-15*) | agenda board, talk slides, breaks | NOT COVERED (only the F-key line) |

## 3. Player-facing guides and sections

**Player guides** (`config/help/player.js`, role "For players"):
- `player-getting-started` "Getting started": What you need; What a session looks like; Who sees your name.
- `player-joining` "Joining a session": Getting in; If you lose the page; When your name is taken; Other things the join screen might say.
- `player-playing` "Playing": Answering (includes the Build Room item, notes on answering late and on the question for the room and comments); Some rounds hold something back; Voting; Reading a long answer.
- `player-scoring` "Scoring": How points are earned; The scoreboard.

**Room-related help elsewhere:**
- `host.js`: Quick start (Step 2, Step 3 keys); Setting a session up › Settings worth a look (Screens, profiles, room content, Names); Running the room › Two screens: your laptop console.
- `technical.js`: Troubleshooting › Players cannot get in, Screens are not keeping up; Requirements › Players, Hosts, Running it on a video call.

## 4. Coverage gaps

1. **Events** are not covered at all: the attendee name step, agenda, Back to live, paused, break, talk slides, "Not you?", and the event stage.
2. **Private session** access code screen.
3. The **"Welcome back" rejoin prompt**.
4. **Handover "The host said not now."**
5. **Surveys**:
   - what the names setting promises (Anonymous, Who finished, Named);
   - needs an answer vs optional;
   - rank questions;
   - autosave, and the fact that answers count without pressing Send;
   - the closing-soon banner;
   - Check your answers;
   - the feedback round after the survey closes.
6. **States with nothing to do**: answer held while offline, "Your last answer did not reach the room", vote submitted, waiting for the ballot, between rounds.
7. **Feedback**: the results-screen Feedback button and the host-opened feedback round. Only an indirect note covers them.
8. **Wavelength and Poll results** on the phone, and Wavelength's "aim for the obvious word".
9. **Accessibility**: no theme or text size settings exist, and nothing says so.
10. **Help menu**: the guide never mentions the ? button itself or its Report a bug / Request a feature / Ask for help items.
11. **Which types get two screens**: no guide says the room's window is Call & Answer (and Build) only, or that a survey's `/present` reads "shows on the host's screen".
12. **Room's window details**: the ended screen, phase wipe, the strip (Back / Show QR (J) / Forward), the "Next step" safety ask, and the strip's note for people who can't drive the session.

## 5. Stale claims, with citations

I checked 22 claims. These are wrong or partly wrong:

| # | Help claim | What the code does |
|---|---|---|
| S1 | player.js:205-206 "You can change your answer until the round closes. Submitting is not final." | Answers lock after submit: PP 3991-3993 "This is locked for the round." Only an answer held while offline can be changed (PP 3748-3751). **Stale.** |
| S2 | player.js:258 "change your ranking as often as you like" | Only until **Submit Votes**; after that it says "locked for the round" (PP 4043-4045). **Partly stale.** |
| S3 | player.js:314-315 "You cannot vote for yourself. The ballot leaves your own answer out." | Your own row is marked "Yours"/"(Yours)" and **can be ranked** (PP 2850-2859, 4182). `lambda-functions/game/submit-vote.js` has no self-vote check. It also contradicts player.js:246. **Stale.** |
| S4 | player.js:112 "the session remembers you by name, not by browser tab" | Identity is a per-browser id (`joinResult.js` `getClientId`). The same name from another device gets "That name is taken" (`join-game.js` `nameConflictResponse`). **Stale.** |
| S5 | player.js:116 presents "Are you the Sam already here?" as the normal case after losing the page | That screen is only for `NAME_UNVERIFIED` (sessions from before identities were stamped; `JoinNameCollision.jsx` header). The normal case is "Welcome back. / Rejoin as {name}" (PP 3032-3058). **Stale.** |
| S6 | player.js:166 "not started… your screen will let you in by itself" | The server sends "This game has not been started yet. Please wait for the host to start the session." (`session-gate.js:64`). It is shown as a form error with no retry (PP 754-756). **Stale.** |
| S7 | player.js:167 and technical.js:28 "This session has ended" | The join gate never refuses an ended session (`session-gate.js` checks only exists, Started and access code). The player gets in and sees the end screen. **Stale.** |
| S8 | player.js:168 and technical.js:26 "We do not recognise that code" | `/play` shows "Game not found" (the 404 error string, `session-gate.js:50`). `/join` shows "Nothing is running under {code}. Check the screen at the front of the room." (`JoinCodeEntry.jsx:63`). **Stale.** |
| S9 | player.js:169 "You appear to be offline" | Actual text: "Offline. Reconnecting. This page catches up on its own…" (PP 3303-3311). **Stale wording.** |
| S10 | player.js:52 "The host can see how many people are done, but not what you wrote, until the round closes" | On two screens the host's console shows "responses as they land" (host.js:312, the Main area row). The host sees the words but not the names. **Stale.** |
| S11 | player.js:268 "Tap any answer to open it full-screen" | Only on the Detailed Vote ballot (PP 2866-2893). The results screen lists no answers ("this page will not repeat them", PP 4511-4512). **Needs scoping.** |
| S12 | player.js:298, 307 "Only Trivia and Call & Answer score… Wavelength: None" | Correct (`config/scoreboard.js:68`), but the phone's Wavelength results still show "This round +0 / Total" (PP 4446). This is a code-side inconsistency the refresh should know about. |
| S13 | technical.js Hosts list and video-call list: "Set the display profile" / "Share the browser window showing the session" | Renamed "Room screen size" (host.js:241). On two screens the thing to share is the room's window via "Open as a tab" (host.js:339). **Stale.** |
| S14 | player.js:93 "Four digits, shown next to the QR" | On the room's window and the stage lobby the code is **under** the QR, labelled "Session code" (PresentMoments 145-153). Minor. |

These checked out against the code:
- the join steps and "Join Game" (PP 3128-3260);
- names hidden while voting (PP 3237-3239, 4096-4099);
- the handover button labels;
- "Kept, but late." and "Send it anyway" (PP 3322, 4078);
- "The results are already up…" (`followUpWords.js:128`);
- "Something to add?", including the 24-hour window (PP 3572-3592);
- Rate ends Disagree/Agree (`followUpWords.js:28`);
- Trivia up to six options;
- the title and lesson leading with a "Your turn" band (`config/roomContent.js:302-327`; strictly the title leads and the lesson sits under it, never dropped);
- voting showing every answer, or one at a time when long (presentModel 298-337);
- no points while names are hidden (PresentTally);
- the QR side panel (presentModel `withJoin` 480-499; it appears only during ASK, VOTE and RESULTS);
- the click-to-fill cue (PresentPage `FILL_CUE`);
- the four profiles (`displayProfile.js:22`).