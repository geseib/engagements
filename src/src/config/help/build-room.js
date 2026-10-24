/*
  THE BUILD ROOM, FOR THE HOST (help refresh Phase 2, W7, 22 Oct 2026).

  Phase 2 split the one guide (`host-build-room`, a 1,400-word "During and
  after" section) into task guides. `host-build-room` keeps its id and its
  first two sections (`what-it-is`, `before-start`); `connecting-claude` moved
  to ./build-room-claude.js and `during-after` was spread over the guides
  below (index.js HELP_SECTION_MOVES sends both old addresses on).

  Claims are taken from the code, checked on dev on 22 Oct with a session of
  our own (create, opening, an Ideas ask with one phone, decide, send, wrap
  up, report, two screens, end):
    the create page            buildroom/BuildRoomPage.jsx BuildCreate;
                               components/WelcomeScreen.jsx (the Build Room
                               door); GameSetupDialog.jsx (Set up the Build Room)
    the Host screen, header    BuildRoomPage.jsx RoomHeader/HeaderTools,
                               AgentChip, ConnectionChip; config/roomScreen.js
                               (Where will the room watch?)
    the Session panel          buildroom/BuildSessionPanel.jsx (Players filters
                               Here/Away/Builders; Settings groups Screens, The
                               room, Claude, Crew, This session)
    the opening                buildroom/BuildOpening.jsx (nine steps, Start
                               building, the draft brief)
    asking                     BuildRoomPage.jsx AskComposer, ReadyLibrary,
                               ReviewCard (Claude's questions); readyQuestions.js;
                               buildScreens.js CLAUDE_KINDS
    the ask path               BuildAskPath.jsx; screens/AskStage.jsx (Pick
                               this, Going to Claude, Hide); words.js
    votes and the wheel        VoteFromIdeasDialog; WheelPanel; BuildWheel.jsx;
                               lambda-functions/game/build-room.js wheelAction
                               (a random person spins; the host may too)
    sending                    BuildRoomPage.jsx DecidePanel; words.js decideWhy*
    Consider and the marks     BuildConsider.jsx, sentMarks.js, words.js consider*
    between asks               BuildWhatsNext.jsx; buildScreens.js
                               whatsNextMoves; BuildRoomPage.jsx Composer
    Later, Points, run list    BuildLater.jsx; BuildPoints.jsx,
                               BuildPointsResults.jsx, BuildPointStage.jsx;
                               BuildRun.jsx
    held posts                 BuildHeldPosts.jsx; build-store.js reviewAgentPosts
    the brief, the crew        BriefPanel; BuildCrew.jsx, BuildPlayerCrew.jsx
    codes and screens          BuildRoomPage.jsx toggleCodes (J), screens/
                               BuildStageScreen.jsx, QrZoom.jsx,
                               BuildBuildScreen.jsx, BuildHistoryScreen.jsx
    sharing the demo           BuildWifiShare.jsx, words.js share* remote*;
                               engage-mcp.mjs (.engage/share.json, the gateway,
                               the remote share)
    two screens                BuildConsole.jsx, buildConsole.js,
                               components/console/ConsoleTop.jsx;
                               present/buildwall/ (wallRoom.js: names only with
                               List names on)
    wrap up and report         WrapUpPanel, EndDialog; BuildReport.jsx (Version
                               history = Claude's commits); engage-mcp.mjs
                               CLOSE_STEPS (README, DECISIONS.md, NEXT.md, tag)
  The dock's button for the room's window is not named here: its label is a
  retired word (decision 1).
*/

/* ------------------------------------------------------------ setting up */

const buildRoom = {
  id: 'host-build-room',
  title: 'Build Room: what it is and setting one up',
  icon: 'Wrench',
  summary: 'Build something with your Claude Code while the room suggests and votes. You decide. Start here.',
  sections: [
    {
      id: 'what-it-is',
      title: 'What a Build Room is',
      icon: 'Wrench',
      blocks: [
        {
          t: 'p',
          text: 'A session where the room and your own Claude Code build something together. Claude Code runs on your laptop and joins the room. People join with the four-digit code on laptops, tablets and phones. Claude asks the room for ideas, choices and ratings; the room answers; you shape each answer and decide what Claude builds next.',
        },
        {
          t: 'list',
          items: [
            'Connecting Claude Code: the plugin, the start command, coming back after a break.',
            'Running a Build Room: the opening, asking, voting, the wheel, sending Claude a direction, and the lists that hold what waits.',
            'Sharing the demo: letting people open what Claude built on their own devices.',
            'Build Room on two screens: the room\'s window and your laptop console.',
            'Wrapping up: the wrap-up, ending, the report and where the code is.',
            'People in the room have their own guide under For players: In a Build Room.',
          ],
        },
      ],
    },
    {
      id: 'before-start',
      title: 'Before you start',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'list',
          items: [
            'Claude Code, on the laptop you will host from. Claude builds there, in a new folder.',
            'Node 18 or later, and git, on that laptop. The New Build Room page says so too.',
            'The Engage plugin for Claude Code. The Connect Claude Code window installs it with one command; see Connecting Claude Code.',
            'A plan for the room: one screen, where the room watches your laptop, or two screens, where the room watches a window of its own. See Build Room on two screens.',
          ],
        },
      ],
    },
    {
      id: 'setting-up',
      title: 'Setting one up',
      icon: 'PencilSimple',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Open the New Build Room page', text: 'Choose **Build Room** on your start screen. In **Create engagement**, Build Room is one of the formats too: **Set up the Build Room** goes to the same page.' },
            { title: 'Give it a title', text: 'It names the session for the room and in the report.' },
            { title: 'Say who sets the goal', text: 'Under What to build: **The room decides** (the room picks what to make in the opening, and Claude waits for it), or I\'ve set the goal (write it; Claude builds toward it, and the opening starts from who it is for). With the room deciding, the goal is an optional starting idea. It shows to the room and at the top of the report.' },
            { title: 'Who can join', text: '**Anyone with the code**, or **Private: an access code as well**.' },
            { title: 'Review Claude\'s questions', text: 'On to start with: Claude\'s questions wait for you before the room sees them. You can switch it in the room.' },
            { title: 'Create room', text: '**Create room** opens the Host screen. People can join straight away.' },
          ],
        },
      ],
    },
    {
      id: 'first-look',
      title: 'What you see first',
      icon: 'Monitor',
      blocks: [
        {
          t: 'p',
          text: 'The Host screen is yours. Across the top: **Main menu**, the title, the four screens (Host, Stage, Build, History), **Room\'s window ↗**, then Claude\'s status (Waiting for Claude Code until it connects), the connection (Live), Join with the code, how many have joined, and **SESSION**.',
        },
        {
          t: 'list',
          items: [
            { title: 'Where will the room watch?', text: 'Asked once per browser: **Use two screens** or **Use one screen**. **Help me pick** asks three questions. Change it later in the Session panel, Settings, Screens.' },
            { title: 'How a Build Room works', text: 'The four steps, and **Connect Claude Code**. Start there.' },
            { title: 'The opening', text: 'Frames the build with the room before Claude writes code. See Running a Build Room.' },
          ],
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'On one screen the room sees your laptop',
          text: 'Switch to Stage (press 2) before the room looks. The Host screen shows Claude\'s questions, the room\'s ideas with names, and your notes.',
        },
      ],
    },
    {
      id: 'session-panel',
      title: 'The Session panel in a Build Room',
      icon: 'SlidersHorizontal',
      blocks: [
        { t: 'p', text: '**SESSION** in the header, or \\, opens it. It has two tabs.' },
        {
          t: 'list',
          items: [
            { title: 'Players', text: 'Who has joined, filtered by **Here**, **Away** and **Builders**. Handing a name to another device and removing someone work as in any session: see Managing players.' },
            { title: 'Settings: Screens', text: 'Where the room watches, the room\'s window and its status, room screen size, and **New link** for a link shared by mistake.' },
            { title: 'Settings: The room', text: 'The join code, **Copy join link**, the demo\'s code once it is shared, and **List names on the room meter** (off: the Stage shows only the count).' },
            { title: 'Settings: Claude', text: 'Claude\'s status, **Connect Claude Code**, which plugin is running, a switch that opens Claude\'s questions without your review, and **Check Claude\'s posts before the room sees them**.' },
            { title: 'Settings: Crew and This session', text: '**Open to a crew**. Then **Back to the opening** (once building has started), **Wrap up**, **Report** and **End session**.' },
          ],
        },
      ],
    },
  ],
};

/* ---------------------------------------------------------------- running */

const running = {
  id: 'build-room-running',
  title: 'Running a Build Room',
  icon: 'Wrench',
  summary: 'The opening, asking the room, votes and the wheel, sending Claude a direction, and the lists that hold what waits.',
  sections: [
    {
      id: 'the-host-screen',
      title: 'Finding your way',
      icon: 'Monitor',
      blocks: [
        {
          t: 'p',
          text: 'On one screen the Host screen has three columns. On the left, Now: the open ask or the opening, What\'s next between asks, and Add something. In the middle, Waiting for you: Claude\'s questions, the room\'s ideas and Claude\'s held posts, with Later and Points below. On the right, folds: The opening, Decided, Timeline, Asks, Screenshots, Room brief and History. On two screens the laptop shows the console instead; see Build Room on two screens.',
        },
        {
          t: 'keys',
          items: [
            { keys: '1', text: 'The Host screen' },
            { keys: '2 3 4', text: 'Stage, Build, History' },
            { keys: 'P', text: 'Host and back' },
            { keys: 'Space', text: 'The lead move: the orange button' },
            { keys: 'Ctrl Enter', text: 'Sends what you wrote (Cmd Enter on a Mac)' },
            { keys: '\\', text: 'The Session panel' },
            { keys: 'J', text: 'The join code on and off' },
            { keys: 'Esc', text: 'Closes a panel' },
          ],
        },
      ],
    },
    {
      id: 'the-opening',
      title: 'The opening: framing the build',
      icon: 'ListNumbers',
      blocks: [
        {
          t: 'p',
          text: 'Before Claude writes code, the opening fills the build brief in nine steps: Making, For, The problem, Good looks like, We will know, Never, First build, Tools and style, and Look and feel. Claude plans, but writes no code yet.',
        },
        {
          t: 'list',
          items: [
            'For each step, **Ask the room**, **Answer it yourself**, or **Skip this step**. On the first, **Ask the room to pick** from a list (**Edit the list** to change it), **Spin the wheel**, or **Pick for the room**. Tools and style is yours to answer.',
            'Click a line in The opening, on the right, to work on that step. Claude reads each answer as it lands.',
            '**Ask Claude to draft the brief** has Claude write a headline and a short summary in the room\'s words. Edit it, then **Use this draft**.',
            'A button beside Start building shows the brief to the room.',
            '**Start building** whenever you like, even with steps open: Claude gets the brief as it is. **Back to the opening**, in the Session panel, returns to the steps and tells Claude to pause.',
          ],
        },
      ],
    },
    {
      id: 'opening-by-kind',
      title: 'The opening follows what you are making',
      icon: 'ListNumbers',
      blocks: [
        { t: 'p', text: 'Once the room says what it is making, a game, a training site, a document or a dashboard asks the next steps in its own words. A game asks "Who is playing, and where are they when they play?" instead of who it is for.' },
        {
          t: 'list',
          items: [
            'A done step offers follow-up questions to ask the room next. They follow what you are making too.',
            'Your own sets can add follow-ups: an Ideas question in a category named "Opening: For" (or any step\'s name) is offered after that step. Claude sees them as well.',
          ],
        },
      ],
    },
    {
      id: 'asking-the-room',
      title: 'Asking the room',
      icon: 'Question',
      blocks: [
        { t: 'p', text: 'Claude asks at its decision points, and you can ask too: **Ask the room**, in Add something or in What\'s next, opens one window.' },
        {
          t: 'list',
          items: [
            { title: 'Three kinds', text: '**Ideas**: people suggest, then vote. **Choose**: two to six lettered options, each with an optional preview link. **Rate**: 1 needs work, 5 great. With Choose and Rate, people can add why.' },
            { title: 'Ready questions', text: 'On the left: the questions of every set you can use that is tagged build-room, with how many have been asked here. Pick one to fill in the form.' },
            { title: 'Ready questions for each kind of build', text: 'Tag a set for-game, for-training, for-document, for-dashboard, for-website, for-app, for-tool or for-explore as well, and once the room has said what it is making (the opening\'s first step) that set comes first, then sets with no for- tag; sets for other kinds fold under **Other sets**. Before the room decides, every set shows. Claude gets the matching set\'s questions too and asks from them first, still through you.' },
            { title: 'Claude gets it as', text: '**Do now** (Claude stops and does it), **Keep in mind** (a standing rule; Claude keeps going), or **Ask Claude** (Claude answers and keeps building). **Note for Claude (private)** goes with the answer.' },
            { title: 'Save as a draft', text: 'Keeps it in Waiting for you instead of opening it.' },
          ],
        },
      ],
    },
    {
      id: 'questions-from-claude',
      title: 'Ask Claude for questions',
      icon: 'Sparkle',
      blocks: [
        { t: 'p', text: 'In Ask the room\'s ready questions, **Ask Claude for questions** asks your Claude to write a question set for this kind of build, by section. Say what it should cover, or leave it blank. Needs plugin 1.26.0.' },
        {
          t: 'list',
          items: [
            { title: 'Where it lands', text: 'Claude keeps it in the project under build-room/questions and sends it. It appears first in the ready questions, marked **From Claude**, and you can ask from it straight away.' },
            { title: 'Keeping it', text: '**Save to my sets** puts it in your bell as a draft: a Call and Answer set for its Ideas questions, a Poll set for its Choose and Rate ones, tagged for its kind. Keep, change or leave each question, then accept it to have it in every session.' },
            { title: 'If you do not save it', text: 'It goes when the session does, seven days after it started; the file stays in the project. Two days before, your bell reminds you, and the reminder opens the room. Saving or removing the set clears it.' },
          ],
        },
      ],
    },
    {
      id: 'claudes-questions',
      title: 'Claude\'s questions',
      icon: 'ChatCircleText',
      blocks: [
        { t: 'p', text: 'With review on, a question from Claude waits in Waiting for you, and the room sees nothing yet. On it:' },
        {
          t: 'list',
          items: [
            '**Edit question** changes the words or the options. Renaming an option keeps its letter.',
            '**Open to the room** opens it. While another ask is open, **Open next** opens it as soon as that one closes, and **Not next** keeps it waiting.',
            '**Answer for the room** records what the room already said out loud.',
            '**Ask Claude for mockups**, for a Choose question whose options have no picture yet.',
            '**Discard** drops it.',
          ],
        },
        { t: 'p', text: 'When Claude\'s mockups for a Choose question are all in, a **Claude\'s mockups are ready** card shows above what you are running, with the pictures. **Put to the room now** opens it (asking first if an ask is open); **Next, after this ask** opens it when the open ask closes, and leads during the opening. On the Stage the dock shows **Mockups ready**.' },
        { t: 'p', text: 'To let Claude\'s questions open straight away, switch review off in the Session panel, Settings, Claude.' },
      ],
    },
    {
      id: 'ask-path',
      title: 'Running an ask',
      icon: 'ArrowRight',
      blocks: [
        {
          t: 'p',
          text: 'An open ask runs down numbered steps in the Now column: the ask, the room answering, Settle, then **Change before sending**. The step\'s main button is the orange one; Space presses it, and the line beside it says what it will do. Showing results while people are still answering asks you to press again.',
        },
        {
          t: 'list',
          items: [
            { title: 'While the room answers', text: 'Answers arrive as they come, with names that only you see. For Ideas: **Open voting** when ideas slow, or **Close without a vote**. For Choose and Rate: **Show results** when answers stop. **Answer for the room** records an answer said out loud.' },
            { title: 'Settle', text: 'The room\'s choice leads, marked **Going to Claude**, with the line saying exactly what Claude will be told. Click another option to pick it instead. **Hide** takes an idea off what the room sees.' },
            { title: 'Change before sending', text: 'Opens the direction to edit before it goes. See Sending Claude a direction.' },
          ],
        },
      ],
    },
    {
      id: 'votes-and-wheel',
      title: 'Votes, ties and the wheel',
      icon: 'Shuffle',
      blocks: [
        {
          t: 'list',
          items: [
            'An Ideas vote is an approval vote: each person picks up to three, and may pick their own.',
            'To vote on ideas sent to you, tick them in Waiting for you or Later and put them to a vote (two to six; you set the picks per person). From one idea, **Put to a vote with other ideas** opens the vote and lets you add others from the queue there.',
            'Your vote (optional) sits under an open Choose or Rate, and under an Ideas vote once the room votes. It counts as one person, and you can change it or take it back until the results show. The room\'s screens say only that the count includes the host, never which way; skip it and the round runs the same.',
            'A tie says so: **Spin the wheel**, **Vote again** between the tied options, or click one.',
            '**Spin the wheel** is offered wherever the room could vote, and closes an open ask first. Someone in the room is picked to spin it on their phone; you can spin too. **Someone else spins** passes the turn, and **Spin again** spins once more.',
            'Every screen sees the wheel land on the same option, which then leads. You can still pick another.',
          ],
        },
      ],
    },
    {
      id: 'sending',
      title: 'Sending Claude a direction',
      icon: 'PaperPlaneTilt',
      blocks: [
        { t: 'p', text: 'Direction for Claude is the sentence Claude builds from. It starts from the question and the room\'s answer.' },
        {
          t: 'list',
          items: [
            'Change the words if you like. If you changed the room\'s words, say why in the Why line: Claude reads it, and History keeps it for the room.',
            '**Fold in from the room** adds a runner-up idea or a reason people gave. What the room said (optional) records a remark made out loud.',
            'Claude gets it as **Do now**, **Keep in mind** or **Ask Claude**.',
            '**Send to Claude**, or Ctrl Enter, sends it. **Save for later** puts it on your Later list; Claude hears nothing. **Record only** keeps the decision on record without telling Claude.',
            '**Don\'t show the room** keeps the words from the room: Claude gets every word, the room\'s screens and History say only that you sent Claude a direction. Yours keep them, marked not shown to the room.',
          ],
        },
        {
          t: 'p',
          text: 'Once sent, **Sent to Claude** leads the Stage, the room\'s window and phones until the next ask opens, with the room\'s pick it came from and Claude\'s status under it. Never your Why.',
        },
        {
          t: 'p',
          text: 'Claude picks it up when it next checks in. If Claude Code has stopped, a notice offers the continue command (see Connecting Claude Code).',
        },
      ],
    },
    {
      id: 'consider',
      title: 'Consider: one idea, your call',
      icon: 'Lightbulb',
      blocks: [
        {
          t: 'p',
          text: '**Consider** sits on every idea in an open Ideas ask as it arrives, on the reasons people give with a pick or a rating, on every option once a vote has closed, and on each idea in Waiting for you. It opens one panel; the ask carries on. Esc closes it and keeps what you typed.',
        },
        {
          t: 'list',
          items: [
            { title: 'Queue for the room', text: 'Keeps the room\'s words. As a **Yes or no** question or a **Feedback** question it waits in Waiting for you as a new ask, and opens when you open it. **Add to a vote** marks it Queued for the room until you put it to a vote with others. While an Ideas ask is open, **Add to the open Ideas ask** joins it.' },
            { title: 'Send to Claude', text: 'Starts from the room\'s words; change them if you like and say why. **Send to Claude now**, or **Later** to keep it on your Later list.' },
          ],
        },
      ],
    },
    {
      id: 'one-idea',
      title: 'An idea in Waiting for you',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'list',
          items: [
            'Under **Ask the room**: **Put to a vote with other ideas**, **Add to the open Ideas ask** while one is open, or else **Ask the room for ideas about this**, which opens a new Ideas ask with the idea in its question for you to edit.',
            'The menu\'s last choice fills the Stage with the idea, without a name, for a short while.',
            'Reply to the person who sent it (Reply to Joe): only you and they see it, not the room and not Claude. **Got it, thanks** is one press. Their phone says The host replied, and they can answer; the card then says Joe answered. Ask the room for ideas about this uses their latest answer. An answer to an idea you acknowledged puts it back on your list.',
            '**Save for later**, **Acknowledge** and **Dismiss** take it off the list. Each fate, and **Restore**, adds a line to your Timeline saying whose idea it was and what became of it. Only you see those lines; Claude and the room do not.',
          ],
        },
      ],
    },
    {
      id: 'ask-claude',
      title: 'Ask Claude for mockups or a walkthrough',
      icon: 'Image',
      blocks: [
        {
          t: 'list',
          items: [
            '**Mockups…** in Points, or Ask Claude for mockups of this under an idea\'s Ask the room: Claude draws two or three different ways to do it. Each is a quick screen, not the finished thing.',
            'They come back to you first, in Waiting for you, marked Mockups you asked for; each picture appears as Claude makes it. The room sees nothing until you open them as a vote. **Ask for new mockups** sets them aside and asks again, with what should be different if you say.',
            '**Walkthrough** asks Claude to step the room through the demo, one screen at a time, three to six steps.',
            'Both need plugin 1.27.0 or later; with an older one the window says to update it first.',
          ],
        },
      ],
    },
    {
      id: 'marks-and-history',
      title: 'Sent to Claude marks and History',
      icon: 'CheckCircle',
      blocks: [
        {
          t: 'p',
          text: 'Anything that reached Claude says so where you see it: in the ideas, in Waiting for you, on a vote\'s options, in Asks and in Decided. The mark reads **Sent to Claude**, **Sent to Claude, reworded**, or **Sent to Claude, for later**; **Queued for the room** means it waits to be put to the room. Click a mark to open History at that entry.',
        },
        {
          t: 'p',
          text: 'History shows every idea from the room that was used, and every ask the room saw, and what happened: chosen by the room or not, sent as written, reworded by the host, kept for later, or not sent. Where you changed the room\'s words it shows them struck through, then what Claude got, then your why. It never shows who sent an idea; a phone marks its own ideas as yours. Made so far counts by the same rule.',
        },
      ],
    },
    {
      id: 'between-asks',
      title: 'Between asks',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'What\'s next', text: 'With no ask open, the likely moves, most likely first; Space presses the first. Among them: **Connect Claude Code**, open Claude\'s question, put new ideas to a vote, **Ask the room**, Tell Claude, **Preview the work** and **Copy the Continue prompt**.' },
            { title: 'Combine', text: 'Tick decided asks in Decided, then press **Combine** in What\'s next (or **Add to the prompt**): their answers go into one prompt in Add something, yours to edit before you send it.' },
            { title: 'Add something', text: 'Type an idea, a note or what the room said. **Send to Claude** (its arrow picks Do now, Keep in mind or Ask Claude), **Save for later**, or log it as Room said, a host note that is never shown, or a milestone, with Also tell Claude if Claude should hear it, then **Log it**.' },
            { title: 'Claude\'s status', text: 'The chip in the header says what Claude is doing. When Claude Code has stopped it reads last seen, and a click copies the continue command.' },
          ],
        },
      ],
    },
    {
      id: 'later',
      title: 'The Later list',
      icon: 'Clock',
      blocks: [
        {
          t: 'list',
          items: [
            'Later, in the middle column, holds what you held back: room ideas you saved, and directions you saved for later. Claude has not heard them, and the room never sees the list.',
            'Each item has **Send to Claude now** (as Do now), **Ask the room**, and **Remove**.',
            'Tick two to six and What\'s next offers to put them to a vote.',
            'History shows an item only once it has left the list.',
          ],
        },
      ],
    },
    {
      id: 'points',
      title: 'Talking points',
      icon: 'ListBullets',
      blocks: [
        { t: 'p', text: 'Points, beside Later, holds talking points, research findings and ideas from Claude. The room sees none of them until you show one.' },
        {
          t: 'list',
          items: [
            '**Research…** asks Claude to look something up, with sources. **Ideas…** asks for four to eight ideas on a subject. Both come back here.',
            '**Show on Stage** puts one point up for the room to talk over; phones get a box to send ideas about it. **Take it down** when you are done: with two or more ideas in, you are offered a vote on them first.',
            'Tick one to send it to Claude, or two to eight to put them to a vote. Ctrl Enter presses the row\'s main button; Space never does. **Save for later** moves them to Later.',
            'At a points vote\'s results, click rows to choose what Claude gets, then send them, **Save the rest for later**, or **Work through in turn**.',
          ],
        },
      ],
    },
    {
      id: 'run-list',
      title: 'Working through a list',
      icon: 'ListNumbers',
      blocks: [
        {
          t: 'list',
          items: [
            '**Work through in turn** gives Claude the chosen items one at a time: it builds one, commits it, reports it done, and waits for you.',
            'The run list shows each item as Done, Claude is on it, or Next. The Next button sends the next item; Space presses it once Claude has reported the current one done.',
            'Sending earlier asks first whether to send anyway or **Wait for Claude**.',
            'Skip moves an item to Later. **Stop** ends the list, and the rest go to Later. Drag a waiting item, or use the arrow keys, to reorder.',
            'The room follows the list on the Stage and on their phones.',
          ],
        },
      ],
    },
    {
      id: 'claudes-posts',
      title: 'Releasing Claude\'s posts',
      icon: 'Eye',
      blocks: [
        {
          t: 'p',
          text: 'With **Check Claude\'s posts before the room sees them** on, Claude\'s updates, answers and screenshots wait in Waiting for you. **Release to the room** puts one on the phones and the stage or the room\'s window at the time it happened; **Keep to myself** keeps it off them for good; **Release all** lets several through. Your Timeline marks what the room has not been shown. Claude\'s mockups appear when their ask opens, and its live line about what it is doing always shows.',
        },
        { t: 'p', text: 'To let posts straight through, switch it off in the Session panel, Settings, Claude.' },
      ],
    },
    {
      id: 'room-brief',
      title: 'The room brief',
      icon: 'Note',
      blocks: [
        {
          t: 'p',
          text: 'Room brief, on the right, holds Who it is for and a Keep in mind list. Directions sent as Keep in mind land there, and you can add or remove lines yourself. Claude rereads the brief when it changes.',
        },
      ],
    },
    {
      id: 'crew',
      title: 'Opening the room to a crew',
      icon: 'UsersThree',
      blocks: [
        { t: 'p', text: 'People who brought a laptop with Claude Code can build parts with you, each on their own branch of the same repository. Up to 8 builders; everyone else follows on their phone.' },
        {
          t: 'steps',
          items: [
            'In the Session panel, Settings, Crew: **Open to a crew**.',
            'Claude shares the repository. If it has not, the window says so and gives the command to type into Claude Code.',
            'Builders join with the code as usual, tap **I have Claude Code** on their phone, and type the line it shows into their own Claude Code.',
            'They take tasks and share early looks. Early looks wait for you: you decide what the room sees, and only you merge.',
            'Run crew code is Off unless you switch it on. On, your Claude may install and run builders\' code on your laptop to review or merge it.',
            '**Close the crew** when you are done. Builders can no longer share or take tasks; their work stays.',
          ],
        },
      ],
    },
    {
      id: 'join-code',
      title: 'Showing the join code',
      icon: 'Target',
      blocks: [
        {
          t: 'p',
          text: 'Join in the header, the code on the Stage\'s left rail, or J puts the join code in a panel beside what is on the Stage, on this screen and on the room\'s window, without covering it. While the demo is shared on the Wi-Fi, its code sits under the join code. J takes them down again, and so does Join; so does Esc, on the Stage and on the two-screen console. On the Stage, click a code in the panel to enlarge it on your own screen; the enlarged join code copies its link.',
        },
      ],
    },
    {
      id: 'room-screens',
      title: 'What the room sees: Stage, Build and History',
      icon: 'Monitor',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Stage', text: 'The moment: the open ask, results, the wheel, a point, the run list, the brief or the crew board, with a line on what Claude is doing. The buttons along the bottom are yours and stay where they are: **← Host** takes you home in one press (its number says how many things wait for you), **SESSION**, and the main move, which Space presses.' },
            { title: 'Build', text: 'The build so far: Claude\'s latest screenshot.' },
            { title: 'History', text: 'What the room gave and what reached Claude, as above.' },
          ],
        },
        { t: 'p', text: 'None of them shows a name unless **List names on the room meter** is on.' },
      ],
    },
  ],
};

/* --------------------------------------------------------------- sharing */

const sharing = {
  id: 'build-room-sharing',
  title: 'Sharing the demo',
  icon: 'ArrowSquareOut',
  summary: 'Let people open what Claude built on their own phones and laptops: on this Wi-Fi, or from anywhere.',
  sections: [
    {
      id: 'share-demo',
      title: 'Sharing it on this Wi-Fi',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'p',
          text: 'When Claude first shows the app running, the Host screen asks once: Let everyone try it. **Share demo** lets people on this Wi-Fi open this laptop\'s app on their own devices; no one else can. Nothing is shared until you press it, and **Not now** leaves the offer in the header\'s Share demo chip.',
        },
        {
          t: 'list',
          items: [
            'Phones get **Open the demo**. The share panel counts who opened it, and **Show on the Stage** puts its code beside the join code.',
            'Test it first from another device: guest Wi-Fi often blocks this. If it fails for you it fails for the room; they still see Claude\'s screenshots.',
            '**Stop sharing** ends it. So does ending the session.',
            'Only one Claude Code window shares a room at a time. If the count looks wrong, update the plugin from Connect Claude Code.',
          ],
        },
      ],
    },
    {
      id: 'what-the-share-opens',
      title: 'What the share opens',
      icon: 'LinkSimple',
      blocks: [
        {
          t: 'list',
          items: [
            'Open the build and the code go to the page Claude showed. The room can open only the pages Claude linked and what those pages load; a folder\'s file list is never shown.',
            'The share panel names each server: Demo, Mockups, or App 1 and App 2 when nothing says.',
            'To name them yourself, put a file .engage/share.json in the project folder with "demo", "mockups" and a "label". It wins over Claude\'s guess.',
            'Every page a session serves names the session, so two rooms on one laptop are easy to tell apart.',
            'These need an up-to-date plugin: update it from Connect Claude Code and restart Claude Code.',
          ],
        },
      ],
    },
    {
      id: 'people-not-here',
      title: 'People who are not in the room',
      icon: 'Globe',
      blocks: [
        {
          t: 'p',
          text: 'In the Share demo panel, **Also open it to people who are not here** lets everyone in the session open the demo from anywhere, with the same Open the demo button. It is off until you turn it on.',
        },
        {
          t: 'list',
          items: [
            'It goes through Cloudflare, who can see the demo. It closes when you turn it off or the session ends.',
            'Each person\'s button carries their own key. The panel lists who opened it, on how many devices, and whether on this network or elsewhere. **Remove**, beside anyone on more than one device, ends that person\'s link.',
            'The first time, the laptop downloads a small tool from Cloudflare, and some company networks block it.',
            'Update the plugin first: the Session panel, Settings, Claude says which plugin is running.',
          ],
        },
      ],
    },
  ],
};

/* ----------------------------------------------------------- two screens */

const twoScreens = {
  id: 'build-room-two-screens',
  title: 'Build Room on two screens',
  icon: 'Monitor',
  summary: 'The room watches a window of its own while your laptop keeps the console, private.',
  sections: [
    {
      id: 'rooms-window',
      title: 'The room\'s window for a Build Room',
      icon: 'ArrowSquareOut',
      blocks: [
        {
          t: 'p',
          text: '**Room\'s window ↗**, in the header or on the console\'s top line, opens Stage, Build or History in a window of its own, on the second display in Chrome. Beside it, whether that window is open and full screen. Click the window once to fill the screen, or press F. With no second display, **Open as a tab** opens it in a tab you can share on a call. Placing and filling the window work as in any session: see Two screens and your phone.',
        },
        {
          t: 'list',
          items: [
            'The room sees: Stage, Build, History, like 2, 3, 4 and P, change only the room\'s window; your laptop stays where it is. **See it here** shows that screen on the laptop, and 1 comes back.',
            'The window needs no sign-in, has nothing to press, and shows no names unless **List names on the room meter** is on.',
            '**Show my typing to the room**, beside the send boxes, puts your words on the room\'s window\'s Stage as you write a direction, under The host is writing to Claude. Never the Why. It is off until you turn it on, and this browser remembers it for the session. It shows on the room\'s window opened from this laptop only; on another device the room sees the words once you send.',
            'Link shared by mistake? In the Session panel, Settings, Screens, press **New link** twice: it cuts off every window opened with the old link.',
          ],
        },
      ],
    },
    {
      id: 'console',
      title: 'Your laptop console',
      icon: 'SlidersHorizontal',
      blocks: [
        {
          t: 'p',
          text: 'With Two screens chosen, or the room\'s window open, the laptop shows the console. One screen is unchanged.',
        },
        {
          t: 'list',
          items: [
            { title: 'The top line', text: '← **All sessions** (the start screen; the session keeps running), the title, Join (shows the join code to the room; press it again, J or Esc takes it down), Share demo, **Room\'s window ↗** and its status, The room sees, **See it here**, the connection, and the bell.' },
            { title: 'The strip', text: 'Where the ask is: Opening, then Ask, Collect, Settle, Send to Claude, then Wrap up. Between asks it stays, dimmed, and says what is happening instead (Between asks, or the run list with how many are done).' },
            { title: 'Your part now', text: 'Top centre: what to do next, and the main button, which Space presses; a move made early asks you to press again. Between asks it says **No main move now**, and What\'s next below has the moves. On a result the decide panel is already open beside the board: change the words or pick another option there.' },
            { title: 'Mockups ready', text: 'When Claude\'s mockups are all in, a card under Your part now shows them, with **Put to the room now** and **Next, after this ask**. It never replaces the main button.' },
          ],
        },
      ],
    },
    {
      id: 'console-sides',
      title: 'The console\'s side columns',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Left', text: 'Waiting for you (open it in the middle for more room), People (who has answered, by name, while the room answers or votes, never what they chose), Later with Points inside, and Session.' },
            { title: 'Session', text: 'Connect Claude, Claude\'s plugin, **Copy the Continue prompt** while Claude is away, the crew, Build and History to look at privately, the Session panel, **Back to the opening**, **Wrap up**, **Report** and **End session**.' },
            { title: 'Right', text: 'Now, then Decided, Timeline, Asks, Screenshots, Room brief and History.' },
          ],
        },
      ],
    },
  ],
};

/* ---------------------------------------------------------------- wrap up */

const wrapUp = {
  id: 'build-room-wrap-up',
  title: 'Wrapping up a Build Room',
  icon: 'FlagCheckered',
  summary: 'The wrap-up, ending the session, the report, and where the code is afterwards.',
  sections: [
    {
      id: 'wrap-up',
      title: 'Writing the wrap-up',
      icon: 'NotePencil',
      blocks: [
        {
          t: 'p',
          text: 'The wrap-up leads the report and the phones\' last screen: a summary, what was built, links and next steps. Claude writes it when you run its wrap-up command (see Connecting Claude Code), or you write it yourself: **Wrap up** in the Session panel, then **Save wrap-up**. Either way you can edit it.',
        },
        {
          t: 'p',
          text: 'Claude\'s wrap-up also tidies the project: it brings the README and the list of decisions up to date, writes the next steps, commits and tags the work, and asks you before it stops any server, because the demo stops with it.',
        },
      ],
    },
    {
      id: 'ending',
      title: 'Ending the session',
      icon: 'XCircle',
      blocks: [
        {
          t: 'p',
          text: 'Once the wrap-up is saved the Host screen says: check the report, then end the session. **End session** asks first: the room and Claude stop, and you can still edit the report. **Keep it running** backs out.',
        },
        {
          t: 'p',
          text: 'Phones then show the wrap-up, the latest decision and the build so far. After the end Claude can still read the room and write the wrap-up, nothing else; the demo share closes.',
        },
      ],
    },
    {
      id: 'the-report',
      title: 'The report',
      icon: 'FileText',
      blocks: [
        { t: 'p', text: '**Report** (in the Session panel, or beside the wrap-up notice) opens it. **Back to room** returns.' },
        {
          t: 'list',
          items: [
            'What we built, then Decisions: each ask, how the room answered, and the direction Claude got.',
            'Screenshots along the way, and Version history: each commit Claude made on your laptop.',
            'Timeline, Unprompted ideas, and Who took part. With a crew, Who built what.',
            'Host notes are left out, because a report gets handed round.',
            '**Save report** keeps it as a PDF, listed in Reports, as for any session: see The session report › Saving and sharing a report.',
          ],
        },
      ],
    },
    {
      id: 'the-code',
      title: 'Where the code is',
      icon: 'Folder',
      blocks: [
        {
          t: 'p',
          text: 'The code stays on your laptop, in the project folder the start command made under ~/build-room. Claude commits each decision it builds, so the git history follows the session. Claude pushes nothing, except the base branch it shares when you open the room to a crew. Engage keeps the room\'s side: the decisions, the screenshots and the report.',
        },
      ],
    },
  ],
};

/**
 * The build-room area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 * Build Room for the host. Participants: ./build-room-participant.js; the Claude Code plugin: ./build-room-claude.js.
 */
export const AREA = {
  id: 'build-room',
  guides: { host: [buildRoom, running, sharing, twoScreens, wrapUp] },
};
