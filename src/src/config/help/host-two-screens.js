/**
 * THE HOST GUIDES. (This header was shared by every host guide before the
 * Phase 0 split into area files; it still holds for each of them.)
 *
 * Only one of these existed. It had also drifted from the product in two ways
 * that mattered, both of which came from restating things the code already
 * knows: it told hosts that trivia runs a VOTE phase which is "automatic — no
 * voting needed" (there is no vote phase in `GAME_TYPES.trivia.phases` to
 * automate), and it named three question set types out of five. The phase
 * flows and the type table are `{ t: 'phases' }` and `{ t: 'gameTypes' }`
 * blocks now — derived from `config/gameTypes.js`, so the same drift cannot
 * happen twice.
 *
 * Every control named here is quoted from the surface it lives on. A host
 * reading this is looking at the panel while they read.
 */

/*
  SPLIT FROM host-running-engagements (help refresh Phase 0, 22 Oct 2026):
  `laptop-console` and `phone-remote` moved here; HELP_SECTION_MOVES in
  ./index.js keeps the old guide#section addresses resolving. Both ids are
  kept (screens.js points host-console and host-remote at them).

  REWRITTEN IN PHASE 2 (workstream W4, 22 Oct 2026), task first, one screen per
  section. Checked against the code at 47c35c9c and against dev
  (engage.dev.seibtribe.us) with a Call & Answer Quick start on two screens:
  lobby, answering, voting, results, What we heard, the end, and the phone
  remote. Sources, by section:

    when-two-screens   config/surfaces.js TWO_SURFACE_TYPES (call-and-answer,
                       build, trivia and poll since 2g); ONE_SCREEN_WHY
                       (Wavelength's reason, ScreensGroup `why`);
                       config/surfaces.js consoleFor / CONSOLE_TYPES
                       (two screens, Call & Answer, in an event too since 2d;
                       Trivia and Poll since 2g);
    trivia-poll        presentModel.js triviaModel / pollModel,
                       PresentMoments.jsx PresentTriviaQuestion,
                       PresentTriviaReveal, PresentPoll; console
                       panels/FormatPanels.jsx; ConsolePulse `correct`;
                       config/consoleRail.js personFactsFor; get-game-state.js
                       hostAnswer (host door only); workflowStrip.js TYPE_STEPS.
                       config/roomScreen.js ROOM_WORDS, SCREEN_WORDS;
                       QuickstartMenu.jsx (the choice shows when a C&A set is
                       listed); SessionSetupPanel "Screens · applies now".
    open-room-window   present/roomWindow.js (placement on the other display,
                       Window Management permission, placed=1, one window
                       name); PresentPage.jsx useClickToFill, FILL_CUE;
                       hooks/useFullscreenKey.js (F toggles);
                       QuickstartMenu.jsx openPendingRoomWindow, quickBlocked;
                       present/usePresentation.js (public reads, no sign-in).
    window-status      config/presentStatus.js STATES, FILL_ONCE, STALE_MS (90 s);
                       components/stage/RoomWindowStatus.jsx (note line, Open as
                       a tab only when closed and not placing).
    room-size          ScreensGroup.jsx (Room screen size); GameHostPage.jsx
                       setProfile posts the size to the session on two screens;
                       presentModel.js profileOf; config/roomContent.js (Call is
                       the one verbose size).
    room-sees-round    present/presentModel.js, present/PresentMoments.jsx
                       (PresentLobby, PresentAnswering/RoomQuestion,
                       PresentVoting/VoteFocus, PresentTally, PhaseWipe);
                       config/roomContent.js decisions table; TALLY_WHOLE 6.
    room-sees-after    PresentMoments.jsx ResultFocus, PresentQuestionFocus,
                       ReadPage, READ_WAIT, PresentFeedback, PresentAsk,
                       PresentEnded; PresentPage.jsx Scoreboard overlay;
                       config/roundStep.js momentOf (a round's results stay up
                       until the next round starts).
    laptop-console     components/console/HostConsole.jsx, ConsoleTop.jsx
                       (the top bar's slots, config/hostWords.js TOP_SLOTS),
                       ConsoleFooter.jsx, ConsolePulse.jsx
                       (config/consolePulse.js); config/consoleWords.js;
                       WorkflowStrip labels config/workflowStrip.js;
                       StepView.jsx; GameHostPage.jsx dockControls (Back to
                       the room), consoleOnBackKey, sessionMenuWhere (the
                       Session menu portalled into HostConsole's sheet host).
                       Main menu runs requestLeave (asks first with people in
                       the room), then handleSwitchGame.
    console-rail       components/console/ConsoleRail.jsx; config/consoleRail.js
                       (which section opens per moment; railSummaries: each
                       header open and closed, "top:", the Needs-you mark;
                       peopleRows sorts who is still out first; who is out
                       by name is the room tile's, config/roomProgress.js);
                       components/people/PersonRow.jsx density="rail" (✓ / …
                       glyph, score muted until Results); hooks/useArrival.js
                       (the one fade, shared with NeedsYouLine.jsx).
                       docs/design/console-rail.
    console-people     the same files: PersonRow density="rail", railSummaries
                       (people), ConsoleRail's useArrival opening People once.
    console-main       GameHostPage.jsx consolePanel; panels/SimplePanels.jsx,
                       ResponsesPanel.jsx, ReadPanel.jsx.
    putting-up         ResponsesPanel.jsx (The question / The results / All
                       answers rows); GameHostPage.jsx openSpotlight,
                       putQuestionOnWall; FeedbackPanel; roundWords nextResponse,
                       showResponse.
    console-keys       HostActionBar (Space, →, ←); GameHostPage.jsx J handler
                       (two screens), useScoreboardKeys, useSessionPanelKey,
                       useFullscreenKey; roundWords arm texts.
    join-code          GameHostPage.jsx qrMode pinned → /stage-focus {join};
                       components/console/JoinCodeChip.jsx (two screens: hover,
                       focus or click shows the QR card on the laptop; its
                       "Show on the room's screen" is the room's toggle);
                       expanded-QR overlay (click anywhere closes, the address
                       copies); presentModel.js withJoin (ASK, VOTE, RESULTS
                       only); JoinPanel; StageJoinPanel.jsx and joinPanelAllowed
                       (one screen); SessionSetupPanel "Show join code";
                       ConsoleTop's Join toggles (no overlay on the console);
                       HostRemote.jsx Join code panel.
    drive-from-window  present/presentControls.js (keys armed only for a host
                       who may drive; STRIP_MS 3 s; CONFIRM_MS 8 s; Enter/Esc;
                       J; S/V/Esc/Space/arrows on the scoreboard, POST
                       /scoreboard, since 3 Nov 2026); useFullscreenKey F;
                       present/presentKeys.js; PresentPage.jsx strip and the
                       "Next step" card. Seen on dev: → on the card started
                       round 2.
    video-call         RoomWindowLink.jsx RoomWindowTab; roomScreen.js openTab,
                       openTabHint, noSecondDisplay; ScreensGroup DISPLAY_PROFILES.
    phone-remote       GameHostPage.jsx remoteUrl (/remote?gameId=);
                       SessionSetupPanel "Your phone as a remote";
                       config/remoteSignIn.js; HostRemote.jsx code entry
                       (Connect), access gate (Sign in as someone else, Enter a
                       different code, the team switcher).
    remote-controls    HostRemote.jsx (header, RemoteStepDots, Still to
                       answer/vote, What we heard pager, This round, Session
                       card, dock "Tap again to confirm", Feedback round with
                       RoomNote "Said in the room"); RemoteScoreboardPanel.jsx;
                       config/hostRemote.js remotePanelTabs.

  WORDS NOT QUOTED ON PURPOSE: several labels still use retired words ("On the
  wall now", "Show on the wall", the phone's "Show on the big screen", the
  size "Room — projector"). The guide describes those controls instead of
  quoting them (STRUCTURE.md §5).
*/
const twoScreens = {
  id: 'host-two-screens',
  title: 'Two screens and your phone',
  icon: 'Monitor',
  summary: 'Call & Answer, Trivia and Poll on two screens: opening the room\'s window, what the room sees, your laptop console, the join code, video calls, and your phone as a remote.',
  sections: [
    {
      id: 'when-two-screens',
      title: 'When to use two screens',
      icon: 'Monitor',
      blocks: [
        {
          t: 'p',
          text: 'Two screens is for Call & Answer, Trivia and Poll sessions, on their own or as an item in an event. The room watches the room\'s window on a display of its own, and your laptop shows your console: the next step, the responses or the answer, Workie\'s read and the controls, none of which the room sees.',
        },
        {
          t: 'table',
          head: ['Format', 'Screens'],
          rows: [
            ['Call & Answer, Trivia, Poll', 'One screen or two: you choose.'],
            ['Build Room', 'One screen or two, with its own console (its guide covers it).'],
            ['Wavelength', 'One screen for now. The room\'s window has no Write and Reveal moments yet; Settings says so under Screens.'],
            ['Survey', 'One screen: people answer in their own time, so there is no round for a room to watch.'],
          ],
        },
        {
          t: 'list',
          items: [
            { title: 'Where you choose', text: 'Setup\'s first step asks **Where will the room watch?** when you start a session, until this browser has chosen, and a new session\'s Setup asks it before Start; during a session press **Change** in Setup, or use Settings, under Screens. This browser remembers your choice.' },
            { title: 'Changing your mind', text: 'Switch between **One screen** and **Two screens** in the Screens section. It applies at once, to this laptop and the room\'s window; the round carries on.' },
            { title: 'When to stay on one screen', text: 'If the room sees this laptop itself (a mirrored display, or the laptop is all there is), keep one screen: the room would otherwise see your console.' },
          ],
        },
      ],
    },
    {
      id: 'open-room-window',
      title: 'Opening the room\'s window',
      icon: 'ArrowSquareOut',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Connect the room\'s display', text: 'Plug in the room\'s TV or display as a second display, set to extend your desktop rather than mirror it.' },
            { title: 'Open it', text: 'Setup\'s step 2 makes it the one orange button, **Open the room\'s window ↗**. **Room\'s window ↗** on the top bar (or **Open ↗** in the Session menu, under Screens) does the same at any time. **Start · two screens** on your sessions list, and Quick start on two screens, open it for you as the session starts.' },
            { title: 'Put it on the room\'s display', text: 'In Chrome or Edge with a second display, it opens there and fills it. The first time, the browser asks to manage windows on all your displays: allow it. In other browsers, or if you say no, it opens beside you: drag it across.' },
            { title: 'Fill the screen', text: 'Click the room\'s window once. While it shows **Click anywhere to fill the screen**, that click makes it full screen. F does the same anywhere, and F again leaves full screen.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'If nothing opened',
          text: 'The browser blocked the window. Setup stays on step 2 and says so: press **Open the room\'s window ↗** there, or allow pop-ups for Engage.',
        },
        {
          t: 'p',
          text: 'The room\'s window needs no sign-in and shows only what the room may see. A reload, a dropped connection or a second copy on another computer comes back on the same moment.',
        },
      ],
    },
    {
      id: 'window-status',
      title: 'Is the room\'s window up?',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'p',
          text: 'Beside **Room\'s window ↗** the console says what it can know: whether a window is connected, visible and full screen. It cannot see the display itself, so look at the room: when people can read the join code, you are ready.',
        },
        {
          t: 'list',
          items: [
            { title: 'On, full screen', text: 'Connected, visible and full screen.' },
            { title: 'Open, not full screen', text: 'Click the room\'s window once, or press F on it. The line under the status says so.' },
            { title: 'Hidden', text: 'The window is minimised, or another tab is in front of it.' },
            { title: 'Not open', text: 'Press it to open one. On a laptop with no second display, **Open as a tab** appears beside it (see Running it on a video call).' },
          ],
        },
        {
          t: 'p',
          text: 'A window that stops checking in for a minute and a half counts as not open.',
        },
      ],
    },
    {
      id: 'room-size',
      title: 'Sizing it for the room',
      icon: 'CornersOut',
      blocks: [
        {
          t: 'p',
          text: 'Set **Room screen size** in the Session menu, under Screens, or in Setup on the console\'s strip. On two screens it changes the room\'s window straight away, so set it before people arrive and check from the back of the room.',
        },
        {
          t: 'list',
          items: [
            { title: 'Room, TV, Table', text: 'Only what the room needs, as large as it fits.' },
            { title: 'Call', text: 'For a shared screen read on people\'s own displays. It carries a little more: for example the session\'s title in the top line.' },
          ],
        },
      ],
    },
    {
      id: 'room-sees-round',
      title: 'What the room sees during a round',
      icon: 'Eye',
      blocks: [
        {
          t: 'table',
          head: ['Moment', 'On the room\'s window'],
          rows: [
            ['Lobby', 'The session\'s title large, its details under it, how many are in the room, and on the right the QR, the address and the **Session code**.'],
            ['Answering', 'The category, the title and the lesson under it, as large as they fit. How to answer is on every phone, not here. A count of who has answered, never a name.'],
            ['Voting', 'When every answer fits, all of them, whole and numbered, with how many have voted. When they do not fit, one answer at a time with its number. No names, no tally.'],
            ['Results', '**What the room backed**: **The room\'s pick** in full, the others with a bar for their backing against the pick, and **Talk about it**, a question to discuss. Names and points show only in a round that shows names. When there are too many to fit, the rest fold into "and N more answers".'],
          ],
        },
        {
          t: 'p',
          text: 'When the round moves on, a band crosses the screen naming the new step: Answering, Voting, or Results with "Look up".',
        },
      ],
    },
    {
      id: 'trivia-poll',
      title: 'Trivia and Poll on two screens',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'table',
          head: ['Moment', 'On the room\'s window', 'On your console'],
          rows: [
            ['Trivia, answering', 'The question and its lettered options, nothing marked, and a count of who has answered.', 'The options with how many picked each, and the answer in a locked line: "B is correct. Only you see this." **Correct so far** counts the right answers.'],
            ['Trivia, the answer', 'The right option marked **Correct**, the rest quiet, how the room split across them, and how many got it.', 'The same options, the answer, and a tick or a cross by each person\'s score under People.'],
            ['Poll', 'The board, filling in as people answer, then still at the results.', 'The same board.'],
          ],
        },
        {
          t: 'p',
          text: 'The answer reaches no phone and not the room\'s window until you press **Show results**. The scoreboard is the strip\'s **Scores** step: show it with S, or under People.',
        },
      ],
    },
    {
      id: 'room-sees-after',
      title: 'What the room sees after the results',
      icon: 'Eye',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'One response up', text: 'At results, its place and a short ladder showing where it sits. During voting, its number among all of them, never a name.' },
            { title: 'The question back up', text: 'The title and the lesson again, during voting or results.' },
            { title: 'What we heard', text: '**Workie is writing** until the read arrives, then Workie\'s read a page at a time ("Page 1 of 4"), the same page your console marks.' },
            { title: 'Feedback', text: 'The round\'s title and "Provide feedback on the round from your phone, laptop or tablet.", or the comment you put up.' },
            { title: 'A question for the room', text: 'The question with its options or scale and a count; then bars for Choose, the average for Rate, and for Ideas only the ideas you pick.' },
            { title: 'The scoreboard', text: 'Over whatever is up, while you show it.' },
            { title: 'Between rounds', text: 'The last thing you showed stays up until you start the next round.' },
            { title: 'The end', text: '**Session complete**, the rounds played, how many were in the room, the podium where the session names people, and **Thank you**.' },
          ],
        },
      ],
    },
    {
      id: 'laptop-console',
      title: 'Your laptop console',
      icon: 'Monitor',
      blocks: [
        {
          t: 'p',
          text: 'On two screens your laptop shows the console instead of the stage. Read it top down.',
        },
        {
          t: 'table',
          head: ['Part', 'What it is for'],
          rows: [
            ['Top bar', 'Always in this order: **Main menu** (the start screen; the session keeps running, and Rejoin brings you back), the session\'s name, **Join** and the code, the room\'s window, one button with its status (press it to bring the window forward), **Not hearing the room** only while the connection is down, the bell (**Needs you**), **?**, and **Session menu**.'],
            ['The strip', '**Setup**, then the round (**Answer**, **Vote**, **What we heard**, and **Ask** once you can ask the room a question), then **Finish**. LIVE marks where the room is. Press a step to look at it privately; **Back to the room** (or ←) returns. Setup is the lobby\'s own panel.'],
            ['**Your part now**', 'What to do next in one sentence, what the room\'s window shows next, and the buttons. The main button is on the right; Space presses it. **Skip this round** is behind **⋯** just left of it.'],
            ['The Needs-you line', 'One quiet line when nothing needs you, or the amber bar with what does and its buttons.'],
            ['The room tile', 'How the room is doing and who is still out (see The room tile).'],
            ['Left rail', 'From round 1: round queue, People and Late & not reviewed (see The left rail).'],
            ['Main area', 'What the step needs, from the lobby to the report (see The main area).'],
          ],
        },
      ],
    },
    /* components/console/ConsolePulse.jsx, config/consolePulse.js pulseFor,
       config/roomProgress.js (owner, 5 Nov 2026, cut 5). */
    {
      id: 'console-room-tile',
      title: 'The room tile',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'The count', text: 'How many have answered (or voted), with a bar, and how long it has been open ("open 1:24"), or the time left with **+1 min**. It turns green once with **Everyone\'s in**.' },
            { title: 'Who is still out', text: 'Their names when six or fewer are out ("Waiting on Hannah, Ravi"), else how many ("9 still writing"). Anyone whose phone or laptop is away is listed apart ("away: Tom"): they are not typing, so you can move on.' },
            { title: 'Beside it', text: 'While the room votes, the answered count ("✓ 15/15 answered"). After the round, the round\'s record ("15/15 answered · 12/15 voted"). Someone who joins after a step has closed does not count against it.' },
            { title: 'Joiners', text: 'People who joined since the round opened show here only when there are some ("+1 joined · Bob").' },
          ],
        },
      ],
    },
    {
      id: 'console-rail',
      title: 'The left rail',
      icon: 'ListBullets',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Round queue', text: 'The rounds played, the one now and what comes next. A question you wrote is marked **Yours**. **Choose a question** (C), or a round not yet played, opens the question picker. **Write a question** opens the composer in **Up next**; **All rounds** opens the Session menu\'s **Up next**.' },
            { title: 'People', text: 'Who is here and who has answered (see The People column). **Show scoreboard** puts the standings over the room\'s window and **Hide scoreboard** takes them down; before the first round is scored the button waits. The link at the foot opens everyone, and who left, in the Session menu.' },
            { title: 'Late & not reviewed', text: 'Only while something waits: how many late answers and comments, the first three with **Mark reviewed** and, where it can be shown now, a button to show it to the room. **Review them** opens the Session menu\'s **Rounds so far**, where **Review** opens the full list (see Late answers and comments).' },
            { title: 'Session menu', text: 'Top right. It opens over the room tile and the main area, never over Your part now, and holds Up next, Rounds so far, People, Screens, Joining and How it runs, with **End session…** and **Main menu** at its foot. The People column\'s **All N, and who left** opens its People section.' },
          ],
        },
        {
          t: 'p',
          text: 'An arrow on each header points right when closed, down when open. The section that matters for the moment opens by itself. What you open or close stays as you left it until the moment changes.',
        },
      ],
    },
    {
      id: 'console-people',
      title: 'The People column',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Each row', text: 'A ✓ when the person has answered or voted, … while they have not (a screen reader says the word). While the room answers or votes, the people still out come first. Someone whose page has closed reads **away**, muted, as soon as it closes. Each row\'s ⋯ (shown when you point at the row or Tab to it; always on a touch screen) has **Move to a new device** and **Remove from session**.' },
            { title: 'Scores', text: 'In Call & Answer and Trivia, each person\'s score, once someone has scored: grey while the room answers or votes, bright from **Show results**. Trivia puts a ✓ or ✗ in front once the answer is out. Poll, Wavelength and Survey show no score.' },
            { title: 'Closed', text: 'Fold People and its header says "6 here"; who you wait for is in the room tile. At results it says who leads ("top: Priya, 40").' },
            { title: 'Other closed headers', text: 'The round queue adds the next round ("2 of 21 · next: Pricing"), or the first in the lobby. Late & not reviewed, when it is there, shows a small dot and "2 to review" (never amber: it can wait).' },
            { title: 'When someone asks', text: 'A name request opens People once, with the person lifted to the top and **Let them** / **Not now** on their row. You can close it again: the header then wears the same amber as the Needs-you line, with the name ("● Sam needs you"). Both fade in together once; they never flash.' },
          ],
        },
      ],
    },
    {
      id: 'console-main',
      title: 'The main area, step by step',
      icon: 'TextAlignLeft',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Setup (the lobby)', text: 'Three steps: where the room watches, the room\'s window (open, full screen, and the size), and the room joining. The join code goes up only at step 3, with how many are in, who arrived in the last minute, named, and what round 1 is. There is no left rail and no room tile until round 1; the rail appears with it. **Setup** on the strip opens the same panel during the session, with the joining folded to one line.' },
            { title: 'Answering', text: 'The title, the lesson and the question, then the responses as they arrive, newest first. While names are hidden they read Response 1, Response 2. **For you** shows the question\'s background notes, which only you see.' },
            { title: 'Voting', text: '**The ballot, in the order the room sees it**: every response as Response 1, 2 and so on, never a name.' },
            { title: 'Results', text: 'The responses ranked, with names and points where the round shows them.' },
            { title: 'What we heard', text: '**Workie\'s read**, whole, with the page the room is on marked and scrolled into view. **Ask the room** opens beside it, and the room keeps seeing the read while you write.' },
            { title: 'Feedback', text: '**Comments as they land**.' },
            { title: 'The end', text: '**Open session report**.' },
          ],
        },
      ],
    },
    {
      id: 'putting-up',
      title: 'Putting something up for the room',
      icon: 'ArrowSquareOut',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'A response', text: 'During voting or results, press a response in the main area: it goes up large on the room\'s window, and the console marks it.' },
            { title: 'The question', text: 'The first row during voting, **The question**, puts the question back up. At results that row is **The results** and brings the ranked results back.' },
            { title: 'All the answers', text: 'While voting shows every answer at once, the console marks **All answers**.' },
            { title: 'One after another', text: 'The second button steps through them (**Next response** during voting, Show response 1 of 4 at results), and Space or → still moves the round on.' },
            { title: 'A comment', text: 'In the feedback round, press a comment to put it up; press it again to take it down.' },
          ],
        },
      ],
    },
    {
      id: 'console-keys',
      title: 'Keys on the laptop',
      icon: 'Lightning',
      blocks: [
        {
          t: 'keys',
          items: [
            { keys: 'Space or →', text: 'Press the main button in **Your part now**. In Workie\'s read it turns the page first. A clicker does the same.' },
            { keys: '←', text: 'One step back: a page of the read, or from feedback back to the read. While you look at another step, back to the room.' },
            { keys: 'J', text: 'Show or hide the join code (see Showing the join code mid-session).' },
            { keys: 'S', text: 'Show or hide the scoreboard; Esc closes it. Works from the room\'s window too.' },
            { keys: 'V', text: 'Change the scoreboard\'s look while it is up. Works from the room\'s window too.' },
            { keys: '\\', text: 'Open or close the Session panel.' },
            { keys: 'C', text: 'Choose a question (Call & Answer, Trivia and Poll): the question picker opens over the main area. Esc or **Done** goes back. On one screen it asks first, with your phone first.' },
            { keys: 'Q', text: 'Write a question of your own (Call & Answer): the Session menu opens at **Up next** with the composer.' },
            { keys: 'F', text: 'Full screen for the window you are in, and back.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Moving on early',
          text: 'If some people are still writing or voting, the first press says how many ("1 of 3 still writing. Press again to start voting.") and the second press goes on.',
        },
      ],
    },
    {
      id: 'join-code',
      title: 'Showing the join code mid-session',
      icon: 'LinkSimple',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'On your laptop', text: 'Point at **Join** and the code on the top bar, or tab to it: a card under it shows the QR, the code and the address on your laptop alone, for someone who walks up. Click the code to keep the card open; Esc or its close button shuts it. The room\'s window does not change.' },
            { title: 'Two screens', text: 'Press **Show on the room\'s screen** in that card, or J. During a round the room\'s window shows the QR, the address and the code beside what is up, and squeezes the rest to fit; **Join** stays pressed on your laptop while it is up, and nothing covers your console. Press **Take it off the room\'s screen**, or J, to take it down. In the lobby the room\'s window shows it already.' },
            { title: 'From your phone', text: '**Join code**, then **Show join code** (and **Take it off the screen**).' },
            { title: 'One screen', text: 'During a round, J, the code on the stage\'s rail, or **Show join code** in the Session menu, under Joining, puts the QR in a panel beside the round; J again hides it. Outside a round the code covers the stage until you click.' },
          ],
        },
      ],
    },
    {
      id: 'drive-from-window',
      title: 'Driving from the room\'s window',
      icon: 'Play',
      blocks: [
        {
          t: 'p',
          text: 'If the computer showing the room\'s window is signed in as a host of this session, you can drive from it, with its keys or a clicker. Space, → or the clicker steps forward and ← steps back through what is up: each response, part by part, and the pages of Workie\'s read. Moving the mouse shows **‹ Back**, **Show QR (J)** and **Forward ›** for a few seconds.',
        },
        {
          t: 'p',
          text: 'With nothing left to step through, Forward asks first: a **Next step** card names the round\'s next move, such as Start voting. → or Enter goes on; ←, Esc or **← Stay here** stays; the card goes away by itself after a few seconds.',
        },
        {
          t: 'p',
          text: 'The scoreboard keys work here too: S shows or hides it, and while it is up V changes its look, ← and → (or the clicker) turn its pages, and Esc or Space take it down. J shows or hides the join code and F fills the screen, as on the laptop. \\, Q and + stay on the laptop.',
        },
        {
          t: 'p',
          text: 'Not signed in, or signed in as someone else, the keys do nothing and the window says why. Anyone else watching the room\'s window cannot change it.',
        },
      ],
    },
    {
      id: 'video-call',
      title: 'Running it on a video call',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Open the room\'s window as a tab', text: 'With no second display, press **Open as a tab** (beside **Room\'s window ↗** while no window is open, and in the Session menu, under Screens). It opens the room\'s window in a tab of this browser.' },
            { title: 'Share that tab', text: 'Share the tab, not your whole screen, in the call. Your console stays in its own tab, private to you.' },
            { title: 'Size it for a call', text: 'Set **Room screen size** to Call.' },
          ],
        },
        {
          t: 'p',
          text: 'With a display that mirrors your laptop, the same tab can fill that display: click it once, or press F.',
        },
      ],
    },
    {
      id: 'phone-remote',
      title: 'Your phone as a remote',
      icon: 'DeviceMobile',
      blocks: [
        {
          t: 'p',
          text: 'Your phone can run the session while you walk the room, on one screen or two. It does not drive a Build Room.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Open it', text: 'In the Session menu\'s **Screens** (on the console: **Session menu**, top right), press **Connect your phone** under **Your phone as a remote** and scan the QR with your own phone. On one screen it is first in Screens. Or go to the address shown there, or to /remote and type the session code, then **Connect**.' },
            { title: 'Sign in', text: 'On a team session, as any host or admin of that team; it does not have to be the account on this laptop. On a personal account, as you. Only your account can drive this session. The box under the QR names who is signed in on this laptop. It shows your email only while the room\'s window is up on two screens; otherwise the room might be watching this laptop, so it shows your name.' },
            { title: 'If the phone refuses', text: 'Press **Sign in as someone else**, pick the session\'s team if the phone offers a team switcher, or **Enter a different code**.' },
          ],
        },
      ],
    },
    {
      id: 'remote-controls',
      title: 'What the phone gives you',
      icon: 'DeviceMobile',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'The main button', text: 'At the bottom, the same next move as your laptop, with the second move above it. An early move asks you to tap again.' },
            { title: 'Who the room is waiting on', text: 'While the room answers or votes, **Still to answer** or **Still to vote** names who has not yet, and the names go as people submit. It never shows who wrote what.' },
            { title: 'What we heard', text: 'Which page the room is on, **Back a page**, and Workie\'s points with Ask the room beside them.' },
            { title: 'This round', text: '**Show the question** puts the question back up; **Show the room** puts one response up.' },
            { title: 'Scoreboard', text: '**Show the scoreboard** or **Hide the scoreboard**, its next page, and its look.' },
            { title: 'Session', text: 'Three doors with the laptop\'s names: **Up next** (the running order, **Choose a question**, **Write a question**, the categories), **Rounds so far** (the report first) and **People**. Then **Join code**, **Room\'s screen**, and **Main menu**, which returns the phone to the code screen; the session keeps running.' },
            { title: 'Choose a question', text: 'The laptop\'s picker as a sheet, from **Up next** or the round\'s **Change**. **Ask next** returns with **Undo**.' },
            { title: 'End session', text: '**End session…** at the foot of those tabs asks **End this session?** in place.' },
            { title: 'Feedback round', text: 'How many comments have come in, and **Said in the room**, to add something said aloud to the round\'s comments.' },
          ],
        },
        {
          t: 'p',
          text: 'The Session menu\'s set-once sections stay on the laptop: the phone has no Screens, Joining or How it runs section.',
        },
      ],
    },
  ],
};

/**
 * The host-two-screens area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 * The room's window, the two-screen console, the phone remote.
 */
export const AREA = {
  id: 'host-two-screens',
  guides: { host: [twoScreens] },
};
