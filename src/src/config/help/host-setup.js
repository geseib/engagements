/**
 * THE HOST GUIDES: SETTING UP (help refresh Phase 2, W2, 22 Oct 2026).
 *
 * Everything a host does before the room arrives: the start screen, Create
 * engagement and its Advanced fold, Quick start, one or two screens, question
 * sets from the host's side, and the Sessions list. Running the room, two
 * screens in use, surveys, events and reports each have their own area file;
 * these guides name those guides rather than restating them (one fact, one
 * place).
 *
 * Every control named here is quoted from the surface it lives on, and the
 * file and line each claim was checked against is in the comment above its
 * section. Readers never see those citations.
 *
 * Old ids kept: host-quick-start (#the-shape, #step-1-create, #step-2-start,
 * #step-3-run-rounds, #step-4-results, #common-questions) and host-game-setup
 * (#choosing-question-set, #quick-start, #categories, #settings-before-you-start).
 * Nothing moved between guides, so no alias or section move was needed.
 */

const quickStart = {
  id: 'host-quick-start',
  title: 'Your first session',
  icon: 'RocketLaunch',
  summary: 'The start screen, and the path from nothing to a room playing.',
  sections: [
    /*
      The path (experience plan 4c). Create: components/GameSetupDialog.jsx
      (Create engagement, foot note "Nobody can join until you start it. You
      land on its Setup, ready to start."); a create lands on the session's
      Setup (components/SetupBeforeStart.jsx: "Created. Nobody can join until
      you start it.", Start / Open the survey, Edit, Invite, Main menu);
      Quick start is the dialog's lane (config/quickStart.js).
    */
    {
      id: 'the-shape',
      title: 'From nothing to a room playing',
      icon: 'Target',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Create the session', text: 'On the start screen (Home) choose **New engagement**: a title, a format and a question set. Nobody can join yet.' },
            { title: 'Start it', text: 'You land on the session\'s **Setup**, not started yet. Press **Start** there (or **Edit** first); Setup then puts the join code up and people join from their phones.' },
            { title: 'Run the rounds', text: 'You move the room on from your own screen; every phone follows. The Running the room guide covers this.' },
            { title: 'Read what the room said', text: 'Results after each round, What we heard from Workie, and the session report. See What we heard and Ask the room, and The session report.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'The fastest start',
          text: '**Quick start**, at the top of New engagement, creates a session with every default in one press and lands on its Setup. See Quick start in Setting a session up.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'A survey opens from its Setup',
          text: 'A survey lands on its Setup too, where **Open the survey** opens it to answers. The surveys guide covers the rest.',
        },
      ],
    },
    /*
      components/WelcomeScreen.jsx (Home, experience plan 4b): "Home" kicker,
      "Start an engagement" (h1), New engagement (the one New door since
      4c: Quick start, Build Room and Event live inside it); "Rejoin" (the host's live sessions with
      Rejoin, "Nothing of yours is running right now.", "Or type a session
      code" + Continue); "Recent sessions" (five SessionList rows) with "See
      all in Library & team" (/admin?section=games); WelcomeEvents; "Your
      library": Question sets / Reports / Library & team. Top line:
      ActiveOrgSwitcher, HostNotificationsBell, name, "Library & team",
      Sign out, HelpButton. The brand mark goes to / (Home) when signed in.
    */
    {
      id: 'start-screen',
      title: 'What is on the start screen',
      icon: 'House',
      blocks: [
        { t: 'p', text: 'The start screen is Home: where you land when no session is open, and where the mark at the top left takes you. It has five parts.' },
        {
          t: 'list',
          items: [
            { title: 'Start an engagement', text: '**New engagement** is the one way to start anything: a session, a survey, a Build Room or an event, with **Quick start** at its top.' },
            { title: 'Rejoin', text: 'Your sessions running now (started in the last day, not ended), each with **Rejoin**. For any other, type its code and press **Continue**.' },
            { title: 'Recent sessions', text: 'Your five newest, as rows of the list Library & team shows in full: one main button each, the rest under **⋯**. **See all** opens the full list.' },
            { title: 'Run an event', text: 'Your team\'s events when your plan includes them; otherwise it says which plan does. To make one, choose Event in New engagement.' },
            { title: 'Your library', text: '**Question sets**, and **Reports** (saved reports outlive their session). **Library & team** holds the rest: every session, your team and your plan.' },
          ],
        },
        {
          t: 'p',
          text: 'Along the top: the space you are working in (shown only if you belong to more than one; switching reloads the page with that space\'s sets and sessions), the bell, your name, **Library & team** (the console, called that for everyone), **Sign out**, and the help button, which also lets you report a problem or ask for a feature.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'An invitation waiting',
          text: 'When a team has invited you, a line above everything says so. **Accept** adds you to the team.',
        },
      ],
    },
    /*
      GameSetupDialog.jsx (the 30 Oct 2026 redesign, docs/design/new-engagement):
      three numbered steps — "Name it", "Pick a format" / "Format" (one radio
      group, FormatPicker.jsx), "Question set" (SetChooser.jsx) — then "Topics
      in this set" (SessionOptions.jsx SessionCategories, all on). The
      gameTypes table is derived from config/gameTypes.js and is pinned by
      helpSystem.test.jsx §7.
    */
    {
      id: 'step-1-create',
      title: 'Step 1: create the session',
      icon: 'Plus',
      blocks: [
        {
          t: 'steps',
          items: [
            'Choose **New engagement** on the start screen.',
            'Under **Name it**, type the session\'s name. The room sees it, so make it the name of the meeting.',
            'Pick a format, then a **Question set** of that format. Not sure which format? Press the kind of meeting under **Planning a…**, or open **Compare formats** to see how each one runs.',
            'Every topic in the set starts on. Switch off any you want to skip.',
            'Press **Create engagement**.',
          ],
        },
        { t: 'p', text: 'Every field, Background for Workie and the Advanced options are in Setting a session up.' },
        { t: 'h', text: 'The formats you can run' },
        { t: 'gameTypes' },
      ],
    },
    /*
      Where a create lands: SetupBeforeStart.jsx (Setup before Start: step 1
      can be chosen, 2 and 3 "after Start"; Start, Edit, Invite).
      Start: SessionHistoryPanel.jsx (Start, or "Start · two screens" /
      "Start · one screen" from the stored choice, config/sessionStart.js;
      two screens opens the room's window in the click, openPendingRoomWindow).
      Setup is the lobby (experience plan 2b): GameHostPage.jsx setupOn /
      setupStepFor, components/console/panels/SessionSetup.jsx, words in
      config/sessionSetup.js (C&A, events included since 2d). Join URL under Settings,
      "Players join at" (SessionSetupPanel.jsx Joining group).
    */
    {
      id: 'step-2-start',
      title: 'Step 2: start it, and let people in',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'p',
          text: 'A new session lands on its **Setup**, not started. **Edit** changes it first. Press **Start** when the room is ready (or later, on its row in your sessions list). Setup is then the lobby: three steps, each folding to one line, with **Your part now** naming the next move.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Where the room watches', text: 'One screen or two, asked until this browser has chosen. **Change** asks again.' },
            { title: 'Put the room\'s screen up', text: 'Two screens: **Open the room\'s window ↗**, then **Open** and **Full screen** tick. One screen: check the room can read it, and your phone\'s Remote address; then **Show the join code**.' },
            { title: 'The room joins', text: 'Only now does the join code go up, with how many are in, who just arrived and what round 1 is. Then **Start round 1**.' },
          ],
        },
        {
          t: 'list',
          items: [
            'People scan the QR, or go to the address on screen and type the four-digit code.',
            'People on a video call use the join link: **Copy join link**, under **⋯** on the session\'s row, copies it.',
            'Once chosen, Start says so: **Start · two screens** opens the room\'s window in the same click. If the browser blocks it, Setup opens at step 2. **One screen this time**, under the list, switches.',
            'A survey opens on its lobby with the code up.',
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'You do not have to wait for everybody',
          text: 'Start the first round when you have enough people. Latecomers join part-way and play from the round they arrive on.',
        },
      ],
    },
    /*
      Owned by host-running (W3): the stage per phase, the dock, the keys. Only
      the phase flows stay here, derived from config/gameTypes.js.
    */
    {
      id: 'step-3-run-rounds',
      title: 'Step 3: run the rounds',
      icon: 'Play',
      blocks: [
        { t: 'p', text: 'A Call & Answer round has three steps: people answer, the room votes, then the results.' },
        { t: 'phases', gameType: 'call-and-answer' },
        { t: 'p', text: 'Trivia has nothing to vote on, so it goes straight to the answer.' },
        { t: 'phases', gameType: 'trivia' },
        {
          t: 'p',
          text: 'You move the room on from Your part now, under the top bar, and the Session panel holds the players, the questions, past rounds and the settings. The Running the room guide covers each step, the buttons and the keys.',
        },
      ],
    },
    /*
      Owned by host-reports (W3/W5 area): What we heard, the report, Save
      report. Workie and What we heard are glossary words.
    */
    {
      id: 'step-4-results',
      title: 'Step 4: results and the report',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'p',
          text: 'After each round the room sees the results, then Workie writes What we heard: what the room said, questions worth asking next and next steps. The session report gathers every round, and you can save it to keep after the session expires.',
        },
        { t: 'p', text: 'What we heard and Ask the room covers the read; The session report covers the report and saving it.' },
      ],
    },
    {
      id: 'common-questions',
      title: 'Common questions',
      icon: 'Question',
      blocks: [
        {
          t: 'faq',
          items: [
            { q: 'Someone joined late. Is that a problem?', a: 'No. They play from the round they arrive on. They cannot score for rounds that already happened.' },
            { q: 'Someone lost their connection.', a: 'On the same phone and browser they reopen the link and tap **Rejoin as** their name; their answers and points come back with them. On another device the name is taken, and you hand it over: see Managing players › Handing a name over.' },
            { q: 'How many people can play?', a: 'Plenty. The discussion works best somewhere between 5 and 50; past that, reading answers out stops being possible.' },
            { q: 'Can I run the same set again?', a: 'Yes. Each session is a fresh room, and playing a set does not change it.' },
            { q: 'Can I go back to a round we already did?', a: 'Yes. The Rounds tab of the Session panel holds every round played, with its answers and What we heard.' },
            { q: 'I closed the tab mid-session.', a: 'Open the start screen (Home): your running session is under **Rejoin**; press **Rejoin**. Or type its code there and press **Continue**.' },
          ],
        },
      ],
    },
  ],
};

const gameSetup = {
  id: 'host-game-setup',
  title: 'Setting a session up',
  icon: 'Gear',
  summary: 'Create engagement field by field, Advanced, Quick start, one or two screens, your question sets and your sessions list.',
  sections: [
    /*
      GameSetupDialog.jsx (the 30 Oct 2026 redesign, docs/design/new-engagement):
      heading "New engagement" | "Start a new engagement"; one layout (owner
      round 3, option A): the form, and "How <format> runs" beside it
      (FormatWalkthrough.jsx, config/formatWalkthrough.js), open by default;
      before a format is chosen it is quiet: one sentence and one example
      stage, "Example · Call & Answer, stage 1 of 6" (round 4, Fork 1 A). Its
      Hide folds it to a rail "Show how <format> runs" (formatGuide.js
      readHowHidden, localStorage); on a phone a fold under Format, closed
      until opened. A first-time host gets the gallery (text cards, Build
      Room and Event under "Bigger than one session"), a host with history
      chips. ROUND 4: sections appear as each decision is made — Name it and
      Format always; Question set once a format is chosen; the names line,
      Background for Workie and Advanced once a set is picked; nothing goes
      away again while the dialog is open. No step numbers. Keycaps on
      Create. Enter on a format chip focuses the set search. "Name it"
      (autofocus; Enter goes to the next empty decision), "Pick a format"
      gallery with "Planning a…" chips (config/formatGuide.js
      MEETING_TYPES), or "Format" chips; "Compare formats" top right; one
      radio group (arrows choose). "Question set": the recents list ("Used
      by you lately", "Browse all"), or for a host with none a line on what a
      set is and "Browse all N sets" beside the search; "Your question sets ·
      Make a new set" for a host who owns a set of the format, else "Make
      your own set"; the set is remembered per format while open. "Topics in
      this set" (all on, "Switch off any you want to skip.", "Loading this
      set's topics…", Retry). Names line "Names are hidden until the vote
      closes" + Change (Call & Answer), "Names: …" for a survey. "Background
      for Workie · Optional" and "Advanced · Defaults: …". Build Room /
      Event: "Next: the Build Room page" / "Next: the agenda" in the set's
      place with their fields (BuildRoomFields.jsx: "Build Room setup ·
      Optional"; EventFields.jsx: Date, Starts, "Time zone, place,
      reports"), Create the Build Room / Create the event; ⌘/Ctrl+Enter
      moves to that button. Quick start lane (config/quickStart.js) above
      Name it. Foot: "Still needed: …" until ready; Create
      pressed early (or ⌘/Ctrl+Enter) moves to the first gap. requestClose
      -> "Discard this engagement?" Keep editing / Discard. Unreadable sets
      offered, disabled.
    */
    {
      id: 'create-engagement',
      title: 'Create engagement, field by field',
      icon: 'Plus',
      blocks: [
        {
          t: 'p',
          text: 'Three decisions, then **Create engagement**: name it, pick a format, pick the questions. Each part appears once the one above it is done, and stays while the dialog is open: a format brings up **Question set**; a set brings up the names line, **Background for Workie** and **Advanced**. You always start at the format cards; your last one says **You used it last.**',
        },
        {
          t: 'list',
          items: [
            { title: 'Name it', text: 'What the room sees the session called, on the main screen and on phones. Required, but reveals nothing. Enter moves on.' },
            { title: 'Format', text: 'Call & Answer, Trivia, Poll, Wavelength or Survey. A card each the first time, chips later. Arrow keys choose; Enter moves on.' },
            { title: 'Build Room and Event', text: 'Under **Bigger than one session**. In Question set\'s place: a Build Room\'s settings, folded under **Build Room setup**, or an event\'s date and start. **Create the Build Room** opens the room; **Create the event** opens its agenda. Event needs a plan with events.' },
            { title: 'Question set', text: 'A search box with the sets you used lately under it: click one, or press Enter for the first. Type to search, or press **Browse all**. Once picked it is one line with **Change**. **Your question sets** opens sets you own; **Make a new set** or **Make your own set** opens the new-set panel.' },
          ],
        },
        {
          t: 'p',
          text: 'Close it with **Cancel**, the ×, or Esc. If you have filled anything in, it asks first: **Keep editing** or **Discard**.',
        },
      ],
    },
    /*
      GameSetupDialog.jsx: SessionCategories under the set ("Topics in this
      set", all on, "Loading this set's topics…", Retry); the names line; the
      foot notes; ⌘/Ctrl+Enter (config/formatGuide.js isCreateShortcut).
    */
    {
      id: 'create-topics-names',
      title: 'Topics, names and creating',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Topics in this set', text: 'Every topic on, each with its question count. Switch off any you want to skip; the line underneath says how many questions are in. Change the set and the topics are the new set\'s: while they load the button reads **Loading topics…**; if they cannot load, it says so and offers **Retry**.' },
            { title: 'Names', text: 'For Call & Answer a line says **Names are hidden until the vote closes**, then shown with the results. **Change** opens the setting under Advanced. A survey shows its Names choice the same way.' },
            { title: 'Background for Workie and Advanced', text: 'Two closed lines. Background for Workie (Call & Answer) is optional; Advanced names the defaults worth checking, or what you changed, in amber.' },
          ],
        },
        {
          t: 'p',
          text: 'Until the three decisions are made the button is outlined and the foot says what is **Still needed**. Pressing it early, or Ctrl+Enter (⌘+Enter on a Mac), takes you to the first thing missing. Once ready the foot says **Nobody can join until you start it. You land on its Setup, ready to start.**',
        },
        {
          t: 'p',
          text: 'The button is **Create engagement**, a survey included. Pressed while the topics load, it reads **Waiting for topics…** and creates when they arrive. On Build Room or Event, Ctrl+Enter moves to the button; Enter there creates. Every session lands on its own Setup with **Start** (**Open the survey**) and **Edit**.',
        },
      ],
    },
    /*
      FormatPicker.jsx (gallery / chips, one radio group), MeetingTypeChips.jsx
      ("Planning a…", config/formatGuide.js MEETING_TYPES), FormatCompare.jsx
      (the Format guide: the storyboard over seven format cards acting as
      tabs, one "Use …" button; one format at a time on a phone),
      FormatWalkthrough.jsx (How … runs: stage cards to scroll through, each
      a picture, a numbered title and a plain description, ending What you
      get; a row of numbered buttons jumps to a stage). Hide / Show:
      readHowHidden / writeHowHidden.
    */
    {
      id: 'choosing-a-format',
      title: 'Choosing a format',
      icon: 'ListBullets',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Planning a…', text: 'Press the kind of meeting (Retro, Brainstorm, Kick-off, Team check-in, Quiz, Feedback form, Offsite day) and it picks a format and says why. You can still pick any other.' },
            { title: 'How it runs', text: 'Beside the form, the chosen format as a storyboard to scroll through: each stage a picture of the room screen and a phone with a plain description, from the first question to what you get at the end. The numbers at the top jump to a stage. Before you choose, it shows one example stage, labelled as an example, and previews whichever card you point at or focus.' },
            { title: 'Compare formats', text: 'Opens the Format guide, wide: the storyboard on top and a short card for every format below. Pick a card to see how it runs, then press the Use button beside its name to go back to the form with it chosen. Your title and choices are kept.' },
          ],
        },
        {
          t: 'p',
          text: '**Hide**, on the storyboard, folds it to a slim strip at the side, and the form takes the room; press the strip to show it again. This browser remembers which you chose. On a phone the storyboard is a fold under Format, closed until you open it. Until you pick a format, the storyboard shows one example stage; nothing is chosen for you.',
        },
      ],
    },
    /*
      SetChooser.jsx (issue #41): search over name, description and tags; Whose
      sets: All / Yours / the team's name / Engage / Public, counted; Topic;
      Tag (several: any of them); Updated (Used by me lately, this week, this
      month, older than 3 months); Sort; chips with Clear all; "Used by you
      lately"; nothing matching offers each way out with its count, other
      formats, Make a new set; Switch team (more than one team) reloads.
      The same chooser picks an agenda item's set.
    */
    {
      id: 'finding-a-set',
      title: 'Finding a question set',
      icon: 'MagnifyingGlass',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Search', text: 'Finds a word in a set\'s name, description or tags. The arrow keys move through the list and Enter picks; Esc clears the search, then closes the list.' },
            { title: 'Whose sets', text: 'All, Yours, your team (by its name), Engage and Public, each with how many match. You see one team at a time: the one you are working in. **Switch team** appears when you belong to more than one, and reloads the page in that team.' },
            { title: 'Topic, Tag, Updated, Sort', text: 'Tag takes several at once: a set with any of them. Updated narrows to the sets you used lately, ones changed this week or this month, or older ones. Each filter in use shows above the list with an × to take it off; **Clear all** takes them all off.' },
            { title: 'Nothing matches', text: 'Each way out says how many sets it would find, including the same search in another format, then the ways to make your own (see When no set fits).' },
          ],
        },
        { t: 'p', text: 'In Create engagement the list takes the whole dialog while it is open; your title and format fold to one line with **Edit**, and **Keep the set I had** (or Esc) folds the list again. There Engage\'s sets read **Ready-made**. The same chooser picks an agenda item\'s set.' },
        { t: 'p', text: 'Sets tagged build-room are not listed here, in Quick start or in an agenda item: a Build Room asks them from its own ready questions. They stay in your question sets, where you change them.' },
      ],
    },
    /*
      SetChooser.jsx makeRoutes, wired in GameSetupDialog.jsx to
      HostQuestionSetsDialog initialRoute (manual / ai / template); a set the
      sets dialog newly reports for this format is picked (takeSets).
    */
    {
      id: 'no-set-fits',
      title: 'When no set fits',
      icon: 'PencilSimple',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Write your own questions', text: 'Opens your question sets with a new set started, for the format you are on.' },
            { title: 'Make a set with Workie', text: 'Opens Workie\'s builder: describe the meeting and Workie drafts questions for you to review.' },
            { title: 'Fill in a spreadsheet', text: 'Opens your question sets with the template ready to download, fill in and upload.' },
          ],
        },
        { t: 'p', text: 'A set you upload is picked for the engagement as soon as it is saved. One Workie drafts waits for your review first, then appears in the list.' },
      ],
    },
    /*
      SessionOptions.jsx SessionBriefing ("Call & Answer only") and
      BriefingField.jsx: "Brief Workie from a document — optional", Choose a
      document, "PDF, Word or text · up to 4 MB", "or write the key points
      yourself", "What Workie will know", 1,500 characters, Replace / Remove,
      "The document itself is not kept.", "People who join never see it.",
      names left out, first 50,000 characters, Create waits for it (:241).
    */
    {
      id: 'workie-briefing',
      title: 'Briefing Workie (Call & Answer)',
      icon: 'FileText',
      blocks: [
        {
          t: 'p',
          text: 'Workie is Engage\'s AI assistant: after each round it sums up what the room said. Give it the background to a Call & Answer session, such as a report, a review or a plan, and it uses it when it writes What we heard. It is optional, and people who join never see it.',
        },
        {
          t: 'steps',
          items: [
            'Under Background for Workie (one quiet line until you open it), press **Choose a document** (PDF, Word or text, up to 4 MB), or **or write the key points yourself**.',
            'Workie reads the document and writes a short briefing, usually in under 15 seconds. Keep filling in the rest meanwhile; **Create engagement** waits until it is done.',
            'Read the briefing under What Workie will know and edit it as you like, up to 1,500 characters. **Replace** or **Remove** it any time before you create.',
          ],
        },
        {
          t: 'p',
          text: 'The document itself is not kept, and the briefing Workie writes keeps roles, not people\'s names. A scanned PDF has no text to read, and for a long document Workie reads the first 50,000 characters; the screen says so in both cases, and you can add what matters in your own words.',
        },
      ],
    },
    /*
      SessionOptions.jsx: the <details> "Advanced" with a one-line summary
      (config/setupDefaults.js advancedSummary). Responses: "Anonymous
      responses" (only where the host runs a vote, config/anonymity.js ->
      Call & Answer), "Names" for a survey (config/surveyNames.js: Anonymous /
      Who finished / Named; "Fixed once the survey opens"). Questions:
      "Shuffle the question order" (not for a survey), "Goal" (blank plays
      until you end). Workie: "Workie's voice" (Adapt to the session
      (recommended)), "Summary approach", "Instructions for Workie" (500).
      What people see when they join: "Event details" (300).
      Names with anonymity off: phones' ballots (PlayerPage displayLabelFor)
      and the host's lists name authors from the start
      (SessionSetupPanel.jsx:1088-1091); the room's side never does during
      VOTE (config/navigatorOrder.js navigatorLabel).
    */
    {
      id: 'advanced',
      title: 'Advanced options',
      icon: 'SlidersHorizontal',
      blocks: [
        {
          t: 'p',
          text: '**Advanced** is folded at the foot of the form, once a question set is picked. Closed, its line names the defaults worth checking, or what you changed, in amber; open, it starts with every default in force. In an event agenda item the closed line lists them all. Open it to change:',
        },
        {
          t: 'list',
          items: [
            { title: 'Anonymous responses (Call & Answer)', text: 'On by default: until voting closes nobody, you included, sees who wrote which answer. Off, names show from the start on people\'s phones, ballots included, and in your own lists; the stage and the room\'s window never show names while the room votes.' },
            { title: 'Names (survey)', text: '**Anonymous**, **Who finished** or **Named**. People\'s phones tell them which before they answer, so it is fixed once the survey opens.' },
            { title: 'Shuffle the question order', text: 'On by default: questions are drawn at random from your categories. Off, they are asked in order, one category at a time.' },
            { title: 'Goal', text: 'How many questions you plan to ask. When the room reaches it you are told, and you can keep going. Blank plays until you end the session.' },
            { title: 'Workie', text: '**Workie\'s voice** (it adapts to the session unless you pick one), **Summary approach** (how Workie sums up each round) and **Instructions for Workie** (rules it follows every time it writes What we heard).' },
            { title: 'Event details', text: 'A sentence or two people see after they join. Workie reads it too.' },
          ],
        },
      ],
    },
    /*
      SessionHistoryPanel.jsx rowActions: Edit only while not started; the
      dialog in mode="edit": "Edit session", "Save changes", format and set
      disabled with "The format and question set are fixed once a session is
      created — create a new session to change either.", shuffle locked,
      categories live (an edit refuses none picked), "Discard your changes?".
    */
    {
      id: 'editing-a-session',
      title: 'Changing a session before it starts',
      icon: 'PencilSimple',
      blocks: [
        {
          t: 'p',
          text: 'Press **Edit** on the session\'s Setup, where a new session lands, or under **⋯** on its row in your sessions list. **Edit session** is the same form: change the title, the categories, Workie\'s briefing and the Advanced options, then **Save changes**, which takes you back where you were. Nobody can join while you do.',
        },
        {
          t: 'p',
          text: 'The format, the question set and the shuffle are fixed once a session is created; make a new session to change them. In an edit at least one category must stay picked. **Edit** disappears once the session has started; from then on you change categories and settings in the Session panel.',
        },
      ],
    },
    /*
      HostQuestionSetsDialog.jsx: title "Your question sets" (:435); your sets
      (canManage) with Format, Qs, Shelf columns; owner tag (setOwnerTag.js);
      "Not offered in the picker" / "Generated — review it, then switch it on";
      Draft chip; Edit questions | Review (:736), Rename (Name, Description,
      Save, Cancel), Delete; Quickstart chip. Others' sets: "N sets below were
      made by an administrator…", Copy and edit (:828). Footer Close.
      Saving questions makes a new version; sessions keep theirs
      (QuestionSetEditor.jsx:1000). Checked on dev 22 Oct 2026.
      Search (23 Oct 2026): one box over both lists, headings "Your sets" and
      "Everyone else's sets" with "N of M"; no match names the words and offers
      Clear the search; Esc clears before it closes.
    */
    {
      id: 'choosing-question-set',
      title: 'Your question sets',
      icon: 'Books',
      blocks: [
        {
          t: 'p',
          text: 'Open them with **Question sets** on the start screen, or **Your question sets** in Create engagement. Every set you can play is in the Create engagement list, except Build Room sets, which a Build Room asks from inside the room; this dialog is where you change them all.',
        },
        {
          t: 'p',
          text: 'The search box above the lists narrows both to sets with your words in the name, description or tags, and each list says how many of its sets match; Esc or **Clear the search** empties it.',
        },
        {
          t: 'list',
          items: [
            { title: 'Sets you can change', text: 'First, with their format, question count and whose they are (Yours or Team). **Edit questions** opens the questions; **Rename** changes the name and description; **Delete** removes the set. Saving questions makes a new version; a session already created keeps the questions it was created with.' },
            { title: 'Everyone else\'s sets', text: 'Engage\'s and other organisations\' published sets, listed below. Play them as they are, or press **Copy and edit** to take your own copy; the original stays untouched.' },
          ],
        },
        {
          t: 'p',
          text: 'A set marked Not offered in the picker is switched off and is not in the Create engagement list. An unfinished set, one Workie wrote that nobody has reviewed yet, is marked **Draft** and offers **Review** instead of **Edit questions**.',
        },
      ],
    },
    /*
      HostQuestionSetsDialog.jsx: New question set / Hide new set (:847) ->
      QuestionSetUploadPanel ("How do you want to make it?": Generate with AI,
      Start from a template, Use your own chatbot, artwork template, Manual
      builder; survey: Your own material, A template; "…then upload it here").
      DraftsStrip.jsx: "An AI draft is waiting for your review. Nothing is
      saved until you accept." Review / Watch / Restore…; Review AI draft
      modal. Generation itself is the AI guides' (admin-ai-builders).
    */
    {
      id: 'making-a-set',
      title: 'Making a set, and reviewing an AI draft',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'p',
          text: 'In Your question sets press **New question set**, pick the format, and choose how to make it. Each way says when it is the right one: have Workie write it, download a template and fill it in, paste a prompt into your own chatbot, or write a few questions in the manual builder. Every format has a chatbot prompt: copy it, paste it with the template into Claude or ChatGPT, fill in the [BRACKETS], and **Go to upload** takes you back to the file chooser. A filled-in template is uploaded at the foot of the same panel.',
        },
        {
          t: 'p',
          text: 'What Workie writes waits as a draft. A line at the top of Your question sets says when a draft is waiting; press **Review** beside it (or **Watch** while it is still being written). **Review AI draft** shows every question; nothing is saved until you accept. The bell tells you too when a draft is ready.',
        },
        { t: 'p', text: 'The AI builders guide covers writing with Workie and reviewing a draft in detail; Writing questions covers the fields of a question.' },
      ],
    },
    /*
      Quick start, the lane inside New engagement (experience plan 4c):
      GameSetupDialog.jsx `gsd-quick`, config/quickStart.js (QUICK_WORDS,
      quickFormat, quickSet, quickTitle): "In a hurry? <format> with “<set>”,
      every default. You land on its Setup, ready to start." Format: chosen,
      else the last one, else Call & Answer; never Build Room or Event. Set:
      picked, else used lately, else marked quickstart, else Engage's, else
      the first. Title "Quick <format>: <set>" unless typed. All topics,
      shuffled (never a survey), names hidden. The Quickstart chip:
      HostQuestionSetsDialog.jsx.
    */
    {
      id: 'quick-start',
      title: 'Quick start',
      icon: 'Lightning',
      blocks: [
        {
          t: 'p',
          text: '**Quick start** sits at the top of **New engagement**, one line that says what it will make, such as *Call & Answer with “Retro basics”, every default*. One press creates it and lands on its Setup, ready to start. It uses the format you chose (else your last one, else Call & Answer), the set you picked (else one you used lately, else a set marked for Quick start, else a ready-made one) and your title (else *Quick <format>: <set>*). Every topic is on and the questions are shuffled. Build Rooms and events are not offered.',
        },
        {
          t: 'p',
          text: 'Where the room watches is asked on the Setup it lands on, before you press **Start**; on two screens the room\'s window opens with Start.',
        },
        {
          t: 'p',
          text: 'To make one of your sets the one Quick start reaches for, click its **Quickstart** tag in Your question sets; click again to take it off. A set that is switched off is never used.',
        },
      ],
    },
    /*
      config/surfaces.js TWO_SURFACE_TYPES (call-and-answer, build, trivia, poll), no tier
      default (F6); Setup's step 1 (SessionSetup.jsx, GameHostPage.jsx
      setupStepFor), C&A, Trivia and Poll since 2g (events too since 2d, once per event day:
      config/eventAgenda.js eventScreensSet), until this browser has chosen or
      Change reopens it; config/roomScreen.js ROOM_WORDS (Where will the
      room watch?, Two screens, One screen, Help me pick and its three
      questions, Keep this choice, "This browser remembers your choice.");
      SCREEN_WORDS (Screens, Where the room watches) in Settings.
    */
    {
      id: 'one-or-two-screens',
      title: 'Choosing one or two screens',
      icon: 'Monitor',
      blocks: [
        {
          t: 'p',
          text: 'A Call & Answer, Trivia or Poll session can run on one screen or two, on its own or inside an event. Wavelength and surveys run on one screen; Wavelength\'s Setup, and Screens in the Session menu, say why.',
        },
        {
          t: 'list',
          items: [
            { title: 'One screen', text: 'The room sees your laptop: the stage. Quick to set up, but the room sees everything on it.' },
            { title: 'Two screens', text: 'The room watches the room\'s window on a second display, such as a TV, and your laptop keeps your own controls, with Workie\'s notes kept private.' },
          ],
        },
        {
          t: 'p',
          text: 'The first time you start a Call & Answer, Trivia or Poll session, Setup asks **Where will the room watch?** as its first step, on every site. Pick one, or press **Help me pick** to answer three questions about your setup and get a recommendation. This browser remembers the choice, so next time Start skips that step. Quick start asks the same question as **Where the room watches**. To change it later, press **Change** beside it in Setup (**Setup** on the steps strip opens it during the session), or use the Session menu\'s Screens section.',
        },
        { t: 'p', text: 'Running on two screens, and placing the room\'s window, is in Two screens and your phone.' },
      ],
    },
    /*
      SessionOptions.jsx SessionCategories; live toggles in the Questions tab
      (SessionSetupPanel.jsx, toggle-category.js) with unasked counts.
    */
    {
      id: 'categories',
      title: 'Categories',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: 'A set is tagged by category, and a session can play only some of them. Pick them in Create engagement, change them in Edit before the session starts, or turn them on and off during the session in the Questions tab of the Session panel, where each one shows how many of its questions are still unasked.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Turning a category off mid-session',
          text: 'It only changes what comes next. Rounds already played stay in the results and in the report.',
        },
      ],
    },
    /*
      A checklist, not the settings themselves: Settings tab is
      host-running's, two screens and the phone are host-two-screens'.
      Room screen size: config/roomScreen.js:111 (glossary#room-screen-size).
      Names toggles: SessionSetupPanel.jsx The rounds group. Phone remote:
      "Your phone as a remote" (SessionSetupPanel.jsx).
    */
    {
      id: 'settings-before-you-start',
      title: 'Worth a look before people arrive',
      icon: 'Monitor',
      blocks: [
        {
          t: 'p',
          text: 'Once the session has started and before the first round, open the Session menu and check:',
        },
        {
          t: 'list',
          items: [
            { title: 'Screens', text: 'One screen or two, and the room screen size: Room, TV, Call or Table. The right size is the difference between readable and squinting.' },
            { title: 'Names', text: 'Under Rounds, How the rounds run: **Show who wrote each response from the start**, and **Name who is still waiting** for whether the room sees who has not answered yet.' },
            { title: 'Controls on your phone', text: '**Phone remote**: scan its QR with your own phone and run the session while you walk around. You sign in on the phone; it is a host control, not a player screen.' },
            { title: 'Joining', text: 'The join link, to paste into a video call\'s chat.' },
          ],
        },
        { t: 'p', text: 'The Session panel › Screens, joining, and how the rounds run explains each setting; Two screens and your phone covers the remote.' },
      ],
    },
    /*
      One list, components/SessionList.jsx (experience plan 4a), in Home's
      recent rows, the "Your sessions" dialog and Library & team › Sessions.
      Columns Session (title; set · code), Format, Status (Not started /
      Running / Ended / Closed / Played, with people · rounds), Date. Actions
      from config/sessionRows.js sessionActions: not started Start · Edit,
      Invite…, Copy join link, Delete…; running Continue · Report…; ended
      Report · Continue…; closed survey Survey results · Report, Continue…;
      Build Room Continue · Report; event Open · Edit the agenda. Search
      sessions, Type, State, Sort. Delete asks inline ("Keep it" / "Delete").
    */
    {
      id: 'sessions-list',
      title: 'Your sessions list',
      icon: 'ListBullets',
      blocks: [
        {
          t: 'p',
          text: 'Your sessions are one list wherever you meet them: five rows under **Recent sessions** on Home, and every session in Sessions, in **Library & team** (**See all** on Home opens it). Each row shows the session\'s title, its set and code, its format, its status (Not started, Running, Ended) with how many people and rounds, and a date. In the full list, search by title, code, host or set, and filter by type and state.',
        },
        {
          t: 'table',
          head: ['The session', 'Its main button', 'Under ⋯'],
          rows: [
            ['Not started', '**Start** (or **Start · two screens**) opens it to the room.', '**Edit** to change it first; **Invite…**; **Copy join link**; **Delete…**'],
            ['Running', '**Continue** goes back to it.', '**Report**; **Invite…**; **Copy join link**; **Delete…**'],
            ['Ended', '**Report** reads its report.', '**Continue**; **Invite…**; **Copy join link**; **Delete…**'],
            ['A closed survey', '**Survey results**, for its answers.', '**Report**; **Continue**; **Invite…**; **Copy join link**; **Delete…**'],
          ],
        },
        {
          t: 'p',
          text: 'A Build Room continues on its own page. An event has one row: **Open** goes to its stage and **Edit the agenda** is under **⋯**; press its name to see its items, each with **Continue** and, once played, **Report**, or **Session expired** when its session has gone. **Delete…** asks on the row itself and says what goes with it; **Delete** is only offered to the session\'s host or a team owner or admin. Saved reports are under **Reports** on Home: see The session report › Saving and sharing a report.',
        },
      ],
    },
  ],
};

/**
 * The host-setup area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 * The start screen, creating a session, Quick start, one or two screens,
 * question sets from the host side, the sessions list.
 */
export const AREA = {
  id: 'host-setup',
  guides: { host: [quickStart, gameSetup] },
};
