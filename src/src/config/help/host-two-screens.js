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
                       build); GameHostPage.jsx useConsole (two screens, no
                       eventCode); config/roomScreen.js ROOM_WORDS, SCREEN_WORDS;
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
    laptop-console     components/console/HostConsole.jsx, ConsoleTop.jsx,
                       ConsoleFooter.jsx; config/consoleWords.js; WorkflowStrip
                       labels config/workflowStrip.js; StepView.jsx;
                       GameHostPage.jsx dockControls (Back to the room),
                       consoleOnBackKey. "All sessions" runs handleSwitchGame,
                       which shows the start screen (its tooltip says "your
                       sessions": defect noted, not described).
    console-rail       components/console/ConsoleRail.jsx; config/consoleRail.js
                       (which section opens per moment).
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
                       expanded-QR overlay (click anywhere closes, the address
                       copies); presentModel.js withJoin (ASK, VOTE, RESULTS
                       only); JoinPanel; StageJoinPanel.jsx and joinPanelAllowed
                       (one screen); SessionSetupPanel "Put the join code back
                       on the stage"; HostRemote.jsx Join code panel.
    drive-from-window  present/presentControls.js (keys armed only for a host
                       who may drive; STRIP_MS 3 s; CONFIRM_MS 8 s; Enter/Esc);
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
  summary: 'Call & Answer on two screens: opening the room\'s window, what the room sees, your laptop console, the join code, video calls, and your phone as a remote.',
  sections: [
    {
      id: 'when-two-screens',
      title: 'When to use two screens',
      icon: 'Monitor',
      blocks: [
        {
          t: 'p',
          text: 'Two screens is for Call & Answer sessions outside events. The room watches the room\'s window on a display of its own, and your laptop shows your console: the next step, the responses, Workie\'s read and the controls, none of which the room sees. Every other kind of session, and every event, runs on one screen, where the room watches the stage on your laptop.',
        },
        {
          t: 'list',
          items: [
            { title: 'Where you choose', text: 'The lobby asks **Where will the room watch?**; Quick start shows **Where the room watches** above the sets when a Call & Answer set is listed; during a session it is in Settings, under Screens. This browser remembers your choice.' },
            { title: 'Changing your mind', text: 'Switch between **One screen** and **Two screens** in Settings, under Screens. It applies at once, to this laptop and the room\'s window; the round carries on.' },
            { title: 'When to stay on one screen', text: 'If the room sees this laptop itself (a mirrored display, or the laptop is all there is), keep one screen: the room would otherwise see your console.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Build Room',
          text: 'A Build Room has its own two-screen console with its own controls. Its guide covers it.',
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
            { title: 'Connect the room\'s display', text: 'Plug in the TV or the room\'s screen as a second display, set to extend your desktop rather than mirror it.' },
            { title: 'Open it', text: 'Press **Room\'s window ↗** on the console\'s top line (or **Open ↗** in Settings, under Screens). Quick start on two screens opens it for you as the session starts.' },
            { title: 'Put it on the room\'s display', text: 'In Chrome or Edge with a second display, it opens there and fills it. The first time, the browser asks to manage windows on all your displays: allow it. In other browsers, or if you say no, it opens beside you: drag it across.' },
            { title: 'Fill the screen', text: 'Click the room\'s window once. While it shows **Click anywhere to fill the screen**, that click makes it full screen. F does the same anywhere, and F again leaves full screen.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'If nothing opened',
          text: 'The browser blocked the window. Press **Room\'s window ↗** on the top line, or allow pop-ups for Engage.',
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
          text: 'Set **Room screen size** in Settings, under Screens, or in Setup on the console\'s strip. On two screens it changes the room\'s window straight away, so set it before people arrive and check from the back of the room.',
        },
        {
          t: 'list',
          items: [
            { title: 'Room, TV, Table', text: 'Only what the room needs, as large as it fits.' },
            { title: 'Call', text: 'For a shared screen read on people\'s own displays. It carries a little more: for example a set\'s general instruction as a small line under the question.' },
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
            ['Answering', 'The category, the title, the lesson under it, and the question itself in a **Your turn** band. A count of who has answered, never a name.'],
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
      id: 'room-sees-after',
      title: 'What the room sees after the results',
      icon: 'Eye',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'One response up', text: 'At results, its place and a short ladder showing where it sits. During voting, its number among all of them, never a name.' },
            { title: 'The question back up', text: 'The lesson and **Your turn** again, during voting or results.' },
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
            ['Top line', '← **All sessions** (in the lobby and at the end) takes you to the start screen; the session keeps running, and Rejoin a session there brings you back. Then the session\'s name, **Join** and the code, **Room\'s window ↗** with its status, and the bell.'],
            ['The strip', '**Setup**, then the round (**Answer**, **Vote**, **What we heard**, **Ask**), then **Finish**. LIVE marks where the room is. Press a step to look at it privately: the room stays where it is, and **Back to the room** (or ←) returns. Setup holds Screens and **All settings**.'],
            ['**Your part now**', 'What to do next in one sentence, the count for the step, what the room\'s window shows next, and the buttons. The main button is on the right; Space presses it.'],
            ['Left rail', 'Round queue, People, Late & not reviewed and Session tools (see The left rail).'],
            ['Main area', 'What the step needs, from the lobby to the report (see The main area).'],
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
            { title: 'Round queue', text: 'The rounds played, the one now and what comes next. **Rounds and questions** opens the Rounds tab of the Session panel.' },
            { title: 'People', text: 'Who is here, and while the room answers or votes, who has and who has not. The names stay on your laptop. **Show scoreboard** puts the standings over the room\'s window and **Hide scoreboard** takes them down; before the first round is scored the button waits. **All players** opens the Players tab.' },
            { title: 'Late & not reviewed', text: 'How many late answers and comments wait, the first three with **Mark reviewed** and, where it can be shown now, a button to show it to the room. **Review them** opens the full list in the Rounds tab (see Late answers and comments).' },
            { title: 'Session tools', text: 'Whether the console is connected, and **Questions**, **Rounds** and **Settings**, which open the Session panel at that tab.' },
          ],
        },
        {
          t: 'p',
          text: 'The section that matters for the moment opens by itself. What you open or close stays as you left it until the moment changes.',
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
            { title: 'Lobby', text: 'The code and who has joined.' },
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
            { keys: 'S', text: 'Show or hide the scoreboard; Esc closes it.' },
            { keys: '\\', text: 'Open or close the Session panel.' },
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
            { title: 'Two screens', text: 'Press **Join** and the code on the top line, or J. During a round the room\'s window shows the QR, the address and the code beside what is up, and squeezes the rest to fit; your laptop shows the code large. Click anywhere on the laptop, or press J, to take it down everywhere; click the address to copy it. In the lobby the room\'s window shows it already.' },
            { title: 'From your phone', text: '**Join code**, then **Display on screen** (and **Take it off the screen**).' },
            { title: 'One screen', text: 'During a round, J, the code on the stage\'s rail, or **Put the join code back on the stage** in Settings, under Joining, puts the QR in a panel beside the round; J again hides it. Outside a round the code covers the stage until you click.' },
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
          text: 'Not signed in, or signed in as someone else, the keys do nothing and the window says why.',
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
            { title: 'Open the room\'s window as a tab', text: 'With no second display, press **Open as a tab** (beside **Room\'s window ↗** while no window is open, and in Settings, under Screens). It opens the room\'s window in a tab of this browser.' },
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
            { title: 'Open it', text: 'In the Session panel\'s Settings tab (on the console: Session tools, then **Settings**), scan the QR under **Your phone as a remote** with your own phone. Or go to the address shown there, or to /remote and type the session code, then **Connect**.' },
            { title: 'Sign in', text: 'On a team session, as any host or admin of that team; it does not have to be the account on this laptop. On a personal account, as you. The box under the QR names who is signed in on this laptop. It shows your email only while the room\'s window is up on two screens; otherwise the room might be watching this laptop, so it shows your name.' },
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
            { title: 'This round', text: '**Choose next question**, and a button that puts the question or one response up large for the room.' },
            { title: 'Scoreboard', text: '**Show the scoreboard** or **Hide the scoreboard**, its next page, and its look.' },
            { title: 'Session', text: '**Players & rounds** (the **Players**, **Rounds** and **Questions** tabs), **Categories**, **Join code**, and **Back to Menu**, which returns the phone to the code screen; the session keeps running.' },
            { title: 'Feedback round', text: 'How many comments have come in, and **Said in the room**, to add something said aloud to the round\'s comments.' },
          ],
        },
        {
          t: 'p',
          text: 'Settings stay on the laptop: the phone has no Settings tab.',
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
