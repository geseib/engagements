/**
 * RUNNING THE ROOM ON ONE SCREEN (help refresh Phase 2, workstream W3).
 *
 * The host is standing in front of a room with the laptop on the screen the
 * room watches. These guides answer "what do I press now, and what will the
 * room see?" for the stage, the dock, the Session panel, each type, late
 * items and players. Two screens, the room's window and the phone remote are
 * the host-two-screens guide's (W4); What we heard, Ask the room, the
 * feedback round and the report are host-reports.js.
 *
 * Every label is quoted from the code; citations sit above each section.
 * Checked on dev (engage.dev, 22 Oct 2026): a one-screen Call & Answer quick
 * start with two bot players, lobby → answer → vote → results → What we
 * heard → Ask the room → comments → End session → ended → report.
 *
 * The dock's words come from config/roundWords.js through config/roundStep.js
 * (one decision function shared with the phone remote); a label built from the
 * round noun ("Start round 2", "Skip this round") is quoted in plain quotes,
 * not marked, because it is not a literal in the code.
 */

/*
  THE GUIDE FOR THE STAGE ITSELF.
  Rail: components/stage/Rail.jsx (phase chip, title, "Round 1 of 12", JOIN +
  code: hover/focus previews the QR, click pins it). Step strip:
  components/stage/WorkflowStrip.jsx, slim on one screen (hover explains, never
  pressed), steps RW.stepSetup … stepFinish. Room meter:
  components/stage/RoomMeter.jsx (U, REVEAL_LABEL "Already joined", "Still to
  answer", "Still to vote"). Dock: components/stage/Dock.jsx, statuses in
  GameHostPage.jsx ~7895 ("Ready when you are", "Safe to move on", "Some are
  still answering").
*/
const running = {
  id: 'host-running-engagements',
  title: 'Running the room',
  icon: 'Broadcast',
  summary: 'The stage on one screen: getting people in, each step of a round, the dock and its keys, the scoreboard, and ending.',
  sections: [
    {
      id: 'the-stage',
      title: 'Finding your way around the stage',
      icon: 'Monitor',
      blocks: [
        {
          t: 'p',
          text: 'On one screen the room sees your laptop, so everything on it is large and nothing private is shown. Running on two screens instead? Your laptop shows a console and the room watches the room\'s window: see Two screens and your phone.',
        },
        {
          t: 'list',
          items: [
            { title: 'The top line', text: 'Where the session is (Lobby, Answering, Voting, Results), its title, the round ("Round 1 of 12"), and JOIN with the address and code. Point at the code to show the join QR; click it to keep the QR up.' },
            { title: 'The step strip', text: 'Setup, then the round\'s steps (Answer, Vote, What we heard, Ask), then Finish. The live step is marked. Point at a step to read what it is; on one screen the steps are not buttons.' },
            { title: 'The room meter', text: 'Top right: how many have answered or voted. Click the number, or press U, to list who is still to answer (unless the Names setting holds that back), and again to hide it.' },
            { title: 'The dock', text: 'Along the bottom: a status line on the left, the main button with “or press Space” beside it (a reminder, not a button), sometimes a second button, and **SESSION** for the Session panel.' },
          ],
        },
      ],
    },
    /*
      GameHostPage.jsx ~8515 (LOBBY: "Scan to join · no app, no account", QR,
      address, "Session code"/"Event code"); meter heading "In the room" (~7411)
      and its list "Already joined"; lobby primary RW.startFirst with hint
      RW.someoneMustJoin; secondary RW.backToMenu. The "Where will the room
      watch?" chooser (C&A, until chosen) is W4's. J on one screen toggles the
      QR side panel during a round (~1325, StageJoinPanel). Settings › Joining:
      SessionSetupPanel.jsx ~1211.
    */
    {
      id: 'lobby',
      title: 'Getting people in',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'p',
          text: 'The lobby shows **Scan to join · no app, no account**, the QR, the join address and the four-digit code. People scan or type the code on any phone, laptop or tablet; nobody needs an account. On a Call & Answer session the lobby may first ask where the room will watch (one screen or two).',
        },
        {
          t: 'list',
          items: [
            'The room meter counts who is in. Click it, or press U, to see the names under "Already joined" and spot who is missing.',
            'The dock says **Ready when you are** once someone has joined. The main button, "Start round 1", stays grey until then.',
            '**Back to menu** leaves the lobby; the session stays as it is.',
          ],
        },
        { t: 'h', text: 'Letting latecomers in' },
        {
          t: 'p',
          text: 'People can join at any point. During a round press J to show the QR and code in a panel beside the question, and J again to hide it. In the Session panel, Settings › **Joining** has **Copy join link**, **Invite…** and **Put the join code back on the stage**.',
        },
      ],
    },
    /*
      ASK: QuestionCard (title leads, the lesson under it, "Your turn" band from
      the question's own instruction; title "Show the full question" expands).
      Meter "Answered x / n". Primary RW.startVoting (C&A) or RW.showResults
      (no-vote types, hostRunsVotePhase); disabled with RW.nobodyAnswered;
      early press arms in place (RW.armVote/armResults, RW.anyway). Secondary
      "Skip this round" (RW.skipRound) with skipConfirm in hostControls.js:
      "The room loses this round: answers and votes so far are not counted."
    */
    {
      id: 'answering',
      title: 'While the room answers',
      icon: 'Play',
      blocks: [
        {
          t: 'p',
          text: 'The question goes up with its title first, any background under it, and a "Your turn" band when the question says what to do. Click the title to show the whole question in a larger window. Read it out; the room answers on their own devices.',
        },
        {
          t: 'list',
          items: [
            'The meter counts the answers ("Answered 1 / 4"). The dock says "Some are still answering", then **Safe to move on** when everyone is in.',
            'The main button is **Start voting** for Call & Answer and **Show results** for the other types. It stays grey until someone has answered.',
            'Pressed early, it does not open a dialog: it changes to "Start voting anyway" and says who is still writing ("1 of 3 still writing"). Press again within a few seconds to go on; wait and it settles back.',
            '"Skip this round" asks first: the room loses the round, and its answers are not counted.',
          ],
        },
      ],
    },
    /*
      VOTE (Call & Answer only: hostControls TYPES_THAT_SKIP_VOTE). GameHostPage
      ~8622: kicker "Vote for the best response" ("Vote for the best title"
      with a picture), question recap, every answer numbered, no name or points
      while voting (navigatorLabel phase VOTE). Click → AnswerSpotlight
      ("Previous"/"Next", ← →, Esc). Pager ↑/↓ (config/stagePaging.js). Dock:
      primary RW.showResults with in-place arm; secondary RW.nextResponse.
    */
    {
      id: 'voting',
      title: 'The vote (Call & Answer)',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: '**Start voting** puts up **Vote for the best response**, the question, and every answer with a number, so people can name one out loud. No names and no points show on the stage while the room votes, whatever the Names setting. With **Show who wrote each response from the start** on, the phones\' ballots and your own lists do carry names.',
        },
        {
          t: 'list',
          items: [
            'Click an answer to show it large for reading out. ← and → step through the answers (and the parts of a long one); Esc goes back.',
            'More answers than fit? ↑ and ↓ turn the page.',
            'The meter counts votes. **Next response** on the dock shows the answers one at a time.',
            '**Show results** closes the vote. Pressed early it asks in place, like **Start voting**.',
          ],
        },
      ],
    },
    /*
      RESULTS for Call & Answer: RESULTS_PICK "The room's pick" (GameHostPage
      :193), runners with rank (placeLabel) and fill bar, credit RW.backedCredit
      only while standings show (standingsVisible), "and N more answers",
      "Talk about it" (roomContent talk). StageQuestionRecap puts the question
      back. Secondary RW.showResponse → RW.nextResponse → RW.stopShowing;
      primary RW.whatWeHeard. No podium on results.
    */
    {
      id: 'results',
      title: 'Showing the results',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'p',
          text: 'For Call & Answer the answer the room backed most leads under **The room\'s pick**, and the rest follow in order, each with a bar for how much it was backed. Once names are shown, a small line gives the points and who wrote it ("5 points — Ada"). If not everything fits, the stage says "and 3 more answers". A **Talk about it** line may suggest what to discuss. Trivia, Poll and Wavelength look different: see Each type on the stage.',
        },
        {
          t: 'list',
          items: [
            'Click an answer to read it in full, or use "Show response 1 of 6" on the dock, then **Next response**, then **Stop showing**.',
            'Click the question line above the answers to put the question back up.',
            'Stay as long as the conversation is good; nothing times out.',
            '**What we heard** moves on to Workie\'s read of the round: see What we heard and Ask the room.',
          ],
        },
      ],
    },
    /*
      Dock.jsx (status, SPACE cap, SESSION "Session panel — backslash key",
      its count when someone asks for a name, the late-count link). Keys:
      HostActionBar (Space/→ advance, ← back through pages and beats:
      GameHostPage consoleOnBackKey), Pager ↑/↓, RoomMeter U, GameHostPage J,
      useFullscreenKey F, config/scoreboard.js S/V/Esc, useSessionPanelKey \.
      The panel's own list (SessionSetupPanel ~1309) leaves out U, J, F, ↑/↓.
    */
    {
      id: 'dock-and-keys',
      title: 'The dock and the keys',
      icon: 'DotsSixVertical',
      blocks: [
        {
          t: 'p',
          text: 'The dock always holds the one button that moves the room on, and Space or → presses it. A grey button says why it cannot act yet. When late answers or comments are waiting, the status line ends with a count you can click to open the list. **SESSION** shows a number when someone is asking to take over a name.',
        },
        {
          t: 'keys',
          items: [
            { keys: 'Space  →', text: 'The main button. While Workie\'s read has more pages, → turns the page first.' },
            { keys: '←', text: 'Back a page of the read, then back a step (comments to the read, the read to the results).' },
            { keys: '↑ ↓', text: 'Page through the answers when they do not all fit.' },
            { keys: 'U', text: 'Show or hide the names on the room meter.' },
            { keys: 'J', text: 'Show or hide the join QR and code.' },
            { keys: 'S', text: 'Show or hide the scoreboard (Trivia and Call & Answer).' },
            { keys: 'V', text: 'Change the scoreboard\'s look while it is up.' },
            { keys: '\\', text: 'Open and close the Session panel.' },
            { keys: 'F', text: 'Full screen, and back again. Esc also leaves.' },
            { keys: 'Esc', text: 'Close whatever is open.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Presenter clickers work',
          text: 'A clicker sends → and ←, so it advances, turns the read\'s pages and steps back. Keys never fire while you are typing in a box or working in the Session panel.',
        },
      ],
    },
    /*
      config/scoreboard.js: BOARD_TYPES trivia and call-and-answer; disabled
      reason NOT_SCORED_YET "Scores appear after the first round"; keys S
      toggle, ←/→ pages, V style, Esc/Space close; STYLE_LABELS. Players tab
      button setupPanel.js scoreboardButton ("Show scoreboard on screen" /
      "Hide scoreboard"). Scoreboard.jsx close button "Close scoreboard".
    */
    {
      id: 'scoreboard',
      title: 'Showing the scoreboard',
      icon: 'Trophy',
      blocks: [
        {
          t: 'p',
          text: 'Trivia and Call & Answer keep a running score. The standings are not on the results; bring them up when you want them, once the first round is scored ("Scores appear after the first round" until then).',
        },
        {
          t: 'list',
          items: [
            'Press S, or **Show scoreboard on screen** on the Players tab of the Session panel. S again, Esc, Space or the board\'s close button takes it down.',
            '← and → page through a long board.',
            'V changes its look: **Departure board**, **Olympic board** or **Tote board**. The default is set under **Scoreboard style** in Settings.',
          ],
        },
      ],
    },
    /*
      End: SessionSetupPanel fold "Session: back to menu, end it, sign out",
      "End session" (canEndSession: not survey, not lobby, not ended);
      endSessionConfirm "End this session?" / "Ending closes the session for
      every phone, laptop or tablet in the room, right now." Leave dialog
      GameHostPage ~9440 ("Leave this session?", "Stay in the session").
      ENDED: RW.sessionComplete, RW.roundsPlayed, RW.endedInRoom, Podium (top 3
      with points, "Most backed" for C&A / "Top score", only when standings
      show); Wavelength's shared words instead. Primary RW.openReport,
      secondary RW.backToMenu. Rail "Session 5212 · closed". Comments 24h:
      lateWords closeExplain.
    */
    {
      id: 'ending',
      title: 'Ending the session',
      icon: 'FlagCheckered',
      blocks: [
        {
          t: 'p',
          text: 'Stop whenever you like. Open the Session panel, Settings, the fold **Session: back to menu, end it, sign out**, and press **End session**. It asks first (**End this session?**): ending closes the session on every device in the room straight away.',
        },
        {
          t: 'p',
          text: 'The stage then shows **Session complete**, how many rounds were played and how many people were in the room. Where scores count and names are shown, the top three follow, led by **Most backed** (Call & Answer) or "Top score". Wavelength shows the words the whole room shared instead.',
        },
        {
          t: 'list',
          items: [
            '**Open session report** is the main button: see The session report.',
            'People can still add comments to rounds for a while afterwards: see Late answers and comments › What is kept.',
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Back to menu does not end anything',
          text: '**Back to Menu** in the same fold, or **Back to menu** on the dock, takes you to your start screen and leaves the session live. With people in the room it asks first (**Leave this session?**); **Stay in the session** is the safe answer. Come back to it with Continue under Sessions.',
        },
      ],
    },
  ],
};

/*
  THE SESSION PANEL (components/stage/SessionSetupPanel.jsx; tabs from
  config/setupPanel.js: Players, Questions, Rounds, Settings). Opened by
  SESSION on the dock or \ (useSessionPanelKey); header "Session setup",
  "Connected"/"Connecting…", Help, ✕; Esc or \ closes. Sections moved here
  from host-running-engagements in Phase 2 keep their ids (HELP_SECTION_MOVES).
*/
const sessionPanel = {
  id: 'host-session-panel',
  title: 'The Session panel',
  icon: 'SlidersHorizontal',
  summary: 'Its four tabs: who is here, what to ask next, the rounds played, and the session\'s settings.',
  sections: [
    {
      id: 'session-panel',
      title: 'Opening the panel',
      icon: 'Gear',
      blocks: [
        {
          t: 'p',
          text: 'Press **SESSION** on the dock, or \\, to open the panel over the right of the stage; \\ or Esc closes it. Its header reads **Session setup** and says **Connected** while live updates are reaching you. The room can see the panel on one screen, so it never shows correct answers.',
        },
        {
          t: 'table',
          head: ['Tab', 'What it is for'],
          rows: [
            ['**Players**', 'Who is here in score order, who has answered this round, the scoreboard button, and handing a name over or removing someone: see Managing players.'],
            ['**Questions**', 'Categories on or off, the running order, and choosing the next question.'],
            ['**Rounds**', 'The session report, late answers and comments, and every round played.'],
            ['**Settings**', 'Screens, your phone as a remote, how the rounds run, joining, and ending the session.'],
          ],
        },
      ],
    },
    /*
      Questions tab: SessionSetupPanel ~633 (Categories, "N left", on/off,
      "N questions remaining"), QueueList.jsx ("Running order", "Nothing queued
      — automatic order below", "Coming up — automatic order", Disabled this
      session, queue full), browser ("Choose the next question", search,
      chips All / categories / "Unasked only" / "Enabled only", tags Asked /
      Off / Queued #n, buttons Queue/Unqueue, Ask next, Ask now / Ask again
      now with their titles). Lobby "Set the running order" (runningOrder.js)
      in an event preview only.
    */
    {
      id: 'choosing-ask-next',
      title: 'Choosing what to ask next',
      icon: 'Shuffle',
      blocks: [
        {
          t: 'p',
          text: 'Questions come in order unless you choose. The **Questions** tab has three parts.',
        },
        {
          t: 'list',
          items: [
            { title: '**Categories**', text: 'Each category with how many questions it has left. Press one to switch it off or on for the rounds still to come.' },
            { title: '**Running order**', text: 'What comes next: your queued questions first, then the automatic order. Move a question earlier or later, take it out of the queue, or disable it for this session (it can be restored).' },
            { title: '**Choose the next question**', text: 'Every question in the set, with a title search and filters (**Unasked only**, **Enabled only**, one category). Tags say **Asked**, Off or Queued.' },
          ],
        },
        {
          t: 'table',
          head: ['Button', 'What it does'],
          rows: [
            ['**Queue**', 'Adds it to the end of the running order. The round on screen carries on.'],
            ['**Ask next**', 'Puts it at the top of the running order. It is asked when the current round ends.'],
            ['**Ask now**', 'Puts it on the stage, or the room\'s window, straight away; the round on screen ends. For a question already asked it reads **Ask again now**.'],
          ],
        },
      ],
    },
    /*
      Rounds tab: SessionSetupPanel ~939 ("Session report" button, LateList
      under "Late & not reviewed", round rows with "AI" badge "Has an AI
      summary"); PastRound.jsx (1–9, ← →, Esc, no 10 key; a digit past the end
      does nothing).
    */
    {
      id: 'going-back-over-round',
      title: 'Going back over a round',
      icon: 'ArrowCounterClockwise',
      blocks: [
        {
          t: 'p',
          text: 'The **Rounds** tab starts with **Session report** (see The session report) and **Late & not reviewed** (see Late answers and comments), then lists every round played. An AI badge marks a round with Workie\'s read. Open a round to see its question, every response and the read.',
        },
        { t: 'h', text: 'Reading one response at a time' },
        {
          t: 'p',
          text: 'Each response carries a number. Press the number and that response opens at a size the back of the room can read.',
        },
        {
          t: 'keys',
          items: [
            { keys: '1 – 9', text: 'Open that response. Press another digit to jump straight to it.' },
            { keys: '← →', text: 'Previous and next response, the way to reach the tenth and beyond.' },
            { keys: 'Esc', text: 'Back to the round.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Why the arrows matter',
          text: 'There is no 10 key. Past nine responses the arrows walk the whole list, and a digit past the end of a short round does nothing rather than closing the window on you.',
        },
      ],
    },
    /*
      Settings tab: SessionSetupPanel ~993-1322. Scope labels "Applies now" /
      "From the next round" and RW.view.settingsScope. Groups: Screens
      (ScreensGroup: W4), "Your phone as a remote" (W4), "The rounds" (Names:
      "Show who wrote each response from the start" + "cannot be taken back";
      "Name who is still waiting"; Feedback: wall comments; Report: "Include
      items not reviewed"; WorkieSettings: "Redo the read on screen", Voice /
      Approach (next round); Pace: "Auto-advance when everyone has responded";
      Scoreboard style), "Joining", the two folds.
    */
    {
      id: 'settings-tab',
      title: 'The Settings tab',
      icon: 'SlidersHorizontal',
      blocks: [
        {
          t: 'p',
          text: 'Each setting says whether it applies now or from the next round; the question on screen, its answers and its votes never change.',
        },
        {
          t: 'list',
          items: [
            { title: 'Screens', text: 'One screen or two, the room\'s window, and room screen size: see Two screens and your phone.' },
            { title: '**Your phone as a remote**', text: 'A QR for your own phone (you sign in on it): see Two screens and your phone.' },
            { title: 'Names', text: '**Show who wrote each response from the start**. Off (the default), answers are numbered until voting closes, then show their writers. Turning it on cannot be taken back. **Name who is still waiting** lets the room meter list who has not answered.' },
            { title: 'Feedback and Report', text: 'Whether the room meter shows comments as they arrive, and **Include items not reviewed** in the report.' },
            { title: 'Workie', text: '**Redo the read on screen**, and the voice and approach Workie uses from the next round.' },
            { title: 'Pace', text: '**Auto-advance when everyone has responded** moves on by itself after a short beat. Opening anything pauses it.' },
            { title: 'Scoreboard', text: '**Scoreboard style**, for Trivia and Call & Answer.' },
            { title: '**Joining**', text: 'The join address and code, **Copy join link**, **Invite…** and **Put the join code back on the stage**.' },
          ],
        },
        {
          t: 'p',
          text: 'Two folds close the tab. **Session: back to menu, end it, sign out** (see Ending the session) also has **Show how this works on the stage →**, which explains the session to the room. **Keyboard shortcuts** lists the main keys.',
        },
      ],
    },
  ],
};

/*
  EACH TYPE ON THE STAGE. Phases: config/hostControls.js TYPES_THAT_SKIP_VOTE
  (trivia, wavelength, poll, survey skip the vote). Trivia RESULTS:
  QuestionCard REVEAL (correct option marked "Correct", each option's share
  in %). Poll: PollBoard live at ASK ("Answers fill in here as they
  arrive."), the same board at RESULTS. Wavelength: WavelengthConvergence
  (matching sentence, then ranked words, landed words full weight, others
  dimmer with counts); ENDED WavelengthSessionVocabulary ("Where the room was
  already agreed"), no scoreboard (BOARD_TYPES). Two screens: C&A only
  (config/surfaces.js). What we heard follows every round type's results
  (roundStep RESULTS); Ask the room is C&A only (GameHostPage asksEnabled).
*/
const byType = {
  id: 'host-stage-by-type',
  title: 'Each type on the stage',
  icon: 'GameController',
  summary: 'What Call & Answer, Trivia, Poll and Wavelength put on the stage, round by round.',
  sections: [
    {
      id: 'call-and-answer',
      title: 'Call & Answer',
      icon: 'ChatCircleText',
      blocks: [
        { t: 'phases', gameType: 'call-and-answer' },
        {
          t: 'p',
          text: 'The room writes, votes for the best answers, and sees the ranking: see The vote and Showing the results in Running the room. It is the only type with a vote, the only one that can run on two screens, and the only one with Ask the room after Workie\'s read, where it is offered (What we heard and Ask the room › Asking the room a quick question). How points are earned is in the players\' Scoring guide.',
        },
      ],
    },
    {
      id: 'trivia',
      title: 'Trivia',
      icon: 'Lightbulb',
      blocks: [
        { t: 'phases', gameType: 'trivia' },
        {
          t: 'p',
          text: 'The question goes up with its options. There is nothing to vote on, so **Show results** goes straight to the answer: the correct option is marked **Correct**, the others are dimmed, and every option shows the share of the room that chose it. The scoreboard is there with S.',
        },
      ],
    },
    {
      id: 'poll',
      title: 'Poll',
      icon: 'ChartBar',
      blocks: [
        { t: 'phases', gameType: 'poll' },
        {
          t: 'p',
          text: 'A poll question is a choice, a rating, yes or no, or an open question. Its options go up as soon as it is asked and the bars fill in as the room answers. **Show results** freezes the same board. A poll has no scoreboard.',
        },
      ],
    },
    {
      id: 'wavelength',
      title: 'Wavelength',
      icon: 'Waves',
      blocks: [
        { t: 'phases', gameType: 'wavelength' },
        {
          t: 'p',
          text: 'Everyone lists words for the prompt. At **Show results** the stage first says it is matching the room\'s words (plurals, spellings and abbreviations count together), then shows them ranked: words on every list stand out, the rest are dimmer with how many people said them. There is no scoreboard. At the end the stage shows the words the whole room shared across the session.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'And surveys?',
          text: 'A survey has no rounds: you open it, people answer at their own pace, and you close it. See Running a survey.',
        },
      ],
    },
  ],
};

/*
  LATE ITEMS (session flow v3 §4.4, phase 5): what arrives after its moment is
  kept and labelled, never lost. Words from config/lateWords.js. "Show on the
  wall" is the button's real label (LW.show), quoted once.
*/
const lateItems = {
  id: 'host-late-items',
  title: 'Late answers and comments',
  icon: 'Clock',
  summary: 'What arrives after the room has moved on, where you find it, and how it reaches the report.',
  sections: [
    {
      id: 'what-is-kept',
      title: 'What is kept',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Late answer', text: 'An answer to a round that arrived after the round moved on. Kept with its round; not in the vote if voting had started.' },
            { title: 'Late answer to a question', text: 'An answer to a question for the room sent after you showed its results. Kept, but not in the count the room saw.' },
            { title: 'Comment added later', text: 'Once a round\'s results have been shown, people can keep commenting on it, until 24 hours after the session ends. After the end, each phone\'s closing screen lists the rounds under "Something to add?" until you close comments.' },
          ],
        },
      ],
    },
    {
      id: 'late-not-reviewed',
      title: 'Late & not reviewed',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: 'The list is in the Rounds tab and, on two screens, in the console\'s left rail. The dock\'s status line counts what is waiting ("1 late answer kept", "3 late items not reviewed"); click the count to open the list. Each item says who and when, for example "during Round 3 · Voting".',
        },
        {
          t: 'table',
          head: ['Button or label', 'What it means'],
          rows: [
            ['**Show on the wall**', 'Puts it up for the room. Offered only while the room is on that item\'s round; it then reads "Reviewed with the room".'],
            ['**Mark reviewed**', 'You have read it yourself; it reads "Reviewed by the host".'],
            ['Not reviewed', 'Nobody has looked at it yet.'],
            ['**Close comments**', 'After the session ends, stops new comments before their time runs out.'],
          ],
        },
      ],
    },
    {
      id: 'in-report',
      title: 'In the report',
      icon: 'FileText',
      blocks: [
        {
          t: 'p',
          text: 'Each round in the report has an "Arrived late" part with the items and their labels. Settings › Report › **Include items not reviewed** is on by default; turn it off and the report leaves those out and says how many. Redoing Workie\'s read reads late answers in too, and says so.',
        },
      ],
    },
  ],
};

const playerManagement = {
  id: 'host-player-management',
  title: 'Managing players',
  icon: 'UsersThree',
  summary: 'Handing a name over, removing someone who left, and what neither of those destroys.',
  sections: [
    /*
      components/stage/PlayersList.jsx:107-170. The Session panel passes no
      onLock/onRefuse (SessionSetupPanel.jsx ~613), so its rows show Unlock
      name | Let them take it, and Remove; the Build Room's panel adds Not now
      and Lock again (BuildSessionPanel.jsx:416-420; grant-handover.js).
    */
    {
      id: 'players-tab',
      title: 'The Players tab',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: 'Everyone in the room, in score order, with their points. During a round each row shows whether that person has answered yet, so you can see at a glance who you are waiting on.',
        },
        {
          t: 'p',
          text: 'Each row carries two actions: **Unlock name** (it reads **Let them take it** when someone is asking) and **Remove**. In a Build Room a row can also show **Not now**, to turn down someone asking for the name, or **Lock again**, to close an unlock nobody has taken yet. All of them are about people, not about scores; none can take points away from anybody.',
        },
      ],
    },
    {
      /*
        THE FEATURE'S OWN RATIONALE, IN THE HOST'S WORDS RATHER THAN THE
        implementer's. The owner's reason for the host being in the loop at all:
        *"they need the choice though because they may have just mistakenly
        picked the same name."* Labels: components/stage/PlayersList.jsx.
      */
      id: 'handing-name-over',
      title: 'Handing a name over',
      icon: 'Handshake',
      blocks: [
        {
          t: 'p',
          text: 'Someone tries to join as "Sam", and Sam is taken. Only you can tell which of two things happened:',
        },
        {
          t: 'list',
          items: [
            'It really is Sam, on a new phone or a browser that lost the page.',
            'It is a second Sam who happened to pick the same name.',
          ],
        },
        {
          t: 'p',
          text: 'So the site will not resolve it on its own. It asks you.',
        },
        { t: 'h', text: 'How it works' },
        {
          t: 'steps',
          items: [
            { title: 'They ask', text: 'On their screen they tap **Ask the host to hand it over**. Their row on your Players tab now reads "asking to take this name", and **SESSION** on the dock shows a count.' },
            { title: 'You decide', text: 'Usually out loud: "Sam, is that you on the iPad?" Press **Let them take it**.' },
            { title: 'The row says "unlocked for one handover"', text: 'They tap **Take over the name** and they are in, with everything that name has scored.' },
          ],
        },
        { t: 'h', text: 'Unlocking without being asked' },
        {
          t: 'p',
          text: 'If nobody has asked, the same button reads **Unlock name**. Use it when someone says "I have lost my page", before they get as far as asking.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'One handover, then it locks again',
          text: 'The unlock is spent by the first device that takes it. If the same person needs it again, you unlock again. An open name is open for a moment, not for the session.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'When it was just a coincidence',
          text: 'Do nothing (in a Build Room, press **Not now**). The other Sam already has "Pick a different name" in front of them, which is the correct outcome.',
        },
      ],
    },
    {
      id: 'removing-someone',
      title: 'Removing someone who left',
      icon: 'Trash',
      blocks: [
        {
          t: 'p',
          text: 'People leave halfway through — a call, a train, a meeting that overran. Their name stays in the room and the counts keep waiting for an answer that is not coming.',
        },
        {
          t: 'p',
          text: 'Remove takes them out of the live counts. "3 of 4 answered" becomes "3 of 3", and the room stops being held up by an empty chair.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'Remove is not delete, and it is not a penalty',
          text: 'Everything they contributed stays. Their answers stay in the rounds they played, their votes still count towards the scores those rounds produced, and they are still in the session report at the end. You are saying "stop waiting for this person", not "this person was never here".',
        },
        {
          t: 'faq',
          items: [
            { q: 'They came back. Now what?', a: 'They rejoin with the same name and pick up where they were, score intact.' },
            { q: 'Does the room see that I removed someone?', a: 'Only in that the counts get smaller. There is no announcement.' },
            { q: 'Will they still be in the report?', a: 'Yes — with everything they answered and every point they scored.' },
          ],
        },
      ],
    },
  ],
};

/**
 * The host-running area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 * Running the room on one screen: the stage, the Session panel, each type,
 * late items, players.
 */
export const AREA = {
  id: 'host-running',
  guides: { host: [running, sessionPanel, byType, lateItems, playerManagement] },
};
