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
      The path. Create: components/GameSetupDialog.jsx (Create engagement,
      foot note "Nobody can join until you start it."); after a create the
      Sessions list opens (GameHostPage.jsx handleStartNewGame, ~5850);
      Start: SessionHistoryPanel.jsx rowActions/onStart; Quick start:
      QuickstartMenu.jsx ("Creates the session and starts it in one press.").
    */
    {
      id: 'the-shape',
      title: 'From nothing to a room playing',
      icon: 'Target',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Create the session', text: 'On the start screen choose **Create engagement**: a title, a format and a question set. Nobody can join yet.' },
            { title: 'Start it', text: 'Your sessions list opens. Press **Start** on the new session: the join code and QR go up, and people join from their phones.' },
            { title: 'Run the rounds', text: 'You move the room on from your own screen; every phone follows. The Running the room guide covers this.' },
            { title: 'Read what the room said', text: 'Results after each round, What we heard from Workie on Call & Answer rounds, and the session report. See Results and reports.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'The fastest start',
          text: '**Quick start** on the start screen creates a session and starts it in one press. See Quick start in Setting a session up.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'A survey starts as you create it',
          text: 'For a survey the last button says **Open the survey**: it creates the session and opens it to answers at once. The surveys guide covers the rest.',
        },
      ],
    },
    /*
      components/WelcomeScreen.jsx: "Start an engagement" (h1), Create
      engagement / Quick start / Build Room (:205-236), WelcomeEvents
      ("Run an event", New event, See how; draws nothing without events),
      "Rejoin a session" (:249), "Your library": Question sets / Sessions /
      Reports (:291-330). Top line: ActiveOrgSwitcher (null with one space),
      HostNotificationsBell, name, "Admin console" | "Question sets & team"
      (:131), Sign out, HelpButton. PendingInvites above the split (Accept).
      Checked on dev 22 Oct 2026 (QA host, one space: switcher shows it).
    */
    {
      id: 'start-screen',
      title: 'What is on the start screen',
      icon: 'House',
      blocks: [
        { t: 'p', text: 'The start screen is where you land when no session is open. It has three parts.' },
        {
          t: 'list',
          items: [
            { title: 'Start an engagement', text: '**Create engagement** sets one up field by field. **Quick start** launches a ready-made set straight into a live room. **Build Room** opens the Build Room\'s own setup. Below them, **Run an event** lists your team\'s events when your plan includes them; otherwise it says which plan does.' },
            { title: 'Rejoin a session', text: 'Type a running session\'s four-digit code and press **Continue** to get back to it, for example after a reload.' },
            { title: 'Your library', text: '**Question sets** opens your question sets, **Sessions** every session you have created or run, and **Reports** the reports you saved, which stay after the session has expired.' },
          ],
        },
        {
          t: 'p',
          text: 'Along the top: the space you are working in (shown only if you belong to more than one; switching reloads the page with that space\'s sets and sessions), the bell, your name, **Question sets & team** (or **Admin console** for an administrator), **Sign out**, and the help button, which also lets you report a problem or ask for a feature.',
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
      GameSetupDialog.jsx: Event title (:409), Format pills from
      PICKER_GAME_TYPES (:424), Question set filtered by format (:206),
      Categories (SessionOptions.jsx SessionCategories). The gameTypes table is
      derived from config/gameTypes.js and is pinned by helpSystem.test.jsx §7.
    */
    {
      id: 'step-1-create',
      title: 'Step 1: create the session',
      icon: 'Plus',
      blocks: [
        {
          t: 'steps',
          items: [
            'Choose **Create engagement** on the start screen.',
            'Type an **Event title**. The room sees it, so make it the name of the meeting.',
            'Pick a **Format**, then a **Question set** of that format.',
            'Pick categories if you want only some of the questions. None picked means all of them.',
            'Press **Create engagement**.',
          ],
        },
        { t: 'p', text: 'Every field, Workie\'s briefing and the Advanced options are in Setting a session up.' },
        { t: 'h', text: 'The formats you can run' },
        { t: 'gameTypes' },
      ],
    },
    /*
      Start: SessionHistoryPanel.jsx (Start, title "puts it on the stage and
      players can join"); chooser: GameHostPage.jsx:7075 showRoomScreen (C&A,
      not events, until this browser has chosen); join URL under Settings,
      "Players join at" (SessionSetupPanel.jsx Joining group).
    */
    {
      id: 'step-2-start',
      title: 'Step 2: start it, and let people in',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'p',
          text: 'A created session waits in your sessions list. Press **Start** on its row when the room is ready: the session opens with its join code and QR on screen.',
        },
        {
          t: 'list',
          items: [
            'People scan the QR, or go to the address on screen and type the four-digit code.',
            'People on a video call use the join link: **Link** on the session\'s row copies it.',
            'Call & Answer asks once where the room will watch: one screen or two. See Choosing one or two screens.',
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
          text: 'You move the room on from the bottom of your screen, and the Session panel holds the players, the questions, past rounds and the settings. The Running the room guide covers each step, the buttons and the keys.',
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
          text: 'After each round the room sees the results. On Call & Answer rounds Workie writes What we heard: what the room said, questions worth asking next and next steps. The session report gathers every round, and you can save it to keep after the session expires.',
        },
        { t: 'p', text: 'Results and reports covers all of it.' },
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
            { q: 'Someone lost their connection.', a: 'They reopen the link and enter the same name. Their answers and points come back with them.' },
            { q: 'How many people can play?', a: 'Plenty. The discussion works best somewhere between 5 and 50; past that, reading answers out stops being possible.' },
            { q: 'Can I run the same set again?', a: 'Yes. Each session is a fresh room, and playing a set does not change it.' },
            { q: 'Can I go back to a round we already did?', a: 'Yes. The Rounds tab of the Session panel holds every round played, with its answers and What we heard.' },
            { q: 'I closed the tab mid-session.', a: 'Open the start screen, type the session\'s code under **Rejoin a session** and press **Continue**, or press **Continue** on its row in **Sessions**.' },
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
      GameSetupDialog.jsx: heading "New engagement" | "Start a new engagement"
      (:389); Format pills incl. Build Room and Event (OTHER_FORMATS, :18-26,
      Event only while events are on: "Events come with the …" + See plans);
      the blurb under the pills; Question set select filtered by format,
      "Your question sets" / "Make a question set" (:519); SessionCategories
      ("None picked, so all N are in"); Create engagement / Open the survey /
      Set up the Build Room / Continue to the event (:19-22, :663); the foot
      note; requestClose -> "Discard this engagement?" Keep editing / Discard.
      Unreadable sets are offered but disabled (:492).
    */
    {
      id: 'create-engagement',
      title: 'Create engagement, field by field',
      icon: 'Plus',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Event title', text: 'What the room sees the session called. Required.' },
            { title: 'Format', text: 'Call & Answer, Trivia, Poll, Wavelength or Survey, with a line under the buttons saying what each is. Build Room and Event are here too: pick one and the button becomes **Set up the Build Room** or **Continue to the event**, which takes your title to that screen.' },
            { title: 'Question set', text: 'Only sets of the chosen format are listed, with their question counts. Changing the format clears the set. **Your question sets** opens your sets, to fix or make one without leaving; it says **Make a question set** when you have none of that format.' },
            { title: 'Categories', text: 'Appears once a set is picked, with each category\'s question count. None picked means all of them; the line underneath says how many questions are in.' },
          ],
        },
        {
          t: 'p',
          text: 'Call & Answer also has Workie\'s briefing (below), and every format has **Advanced**. The foot says **Nobody can join until you start it.** The button is **Create engagement**, or **Open the survey** for a survey, which opens it to answers straight away.',
        },
        {
          t: 'p',
          text: 'Close it with **Cancel**, the ×, or Esc. If you have filled anything in, it asks first: **Keep editing** or **Discard**.',
        },
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
          text: 'Give Workie the background to a Call & Answer session, such as a report, a review or a plan, and it uses it when it writes What we heard. It is optional, and people who join never see it.',
        },
        {
          t: 'steps',
          items: [
            'Under Workie\'s briefing, press **Choose a document** (PDF, Word or text, up to 4 MB), or **or write the key points yourself**.',
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
    */
    {
      id: 'advanced',
      title: 'Advanced options',
      icon: 'SlidersHorizontal',
      blocks: [
        {
          t: 'p',
          text: '**Advanced** is folded at the foot of the form. Its one line says what is in force, any change first, so you can leave it closed. Open it to change:',
        },
        {
          t: 'list',
          items: [
            { title: 'Anonymous responses (Call & Answer)', text: 'On by default: until voting closes nobody, you included, sees who wrote which answer. Off, every answer carries its author\'s name from the moment voting opens.' },
            { title: 'Names (survey)', text: '**Anonymous**, **Who finished** or **Named**. People\'s phones tell them which before they answer, so it is fixed once the survey opens.' },
            { title: 'Shuffle the question order', text: 'On by default: questions are drawn at random from your categories. Off, they are asked in order, one category at a time.' },
            { title: 'Goal', text: 'How many questions you plan to ask. When the room reaches it you are told, and you can keep going. Blank plays until you end the session.' },
            { title: 'Workie', text: '**Workie\'s voice** (it adapts to the session unless you pick one), **Summary approach** (how Workie sums up each round) and **Instructions for Workie** (rules it follows in every summary).' },
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
          text: 'Press **Edit** on the session\'s row in your sessions list. **Edit session** is the same form: change the title, the categories, Workie\'s briefing and the Advanced options, then **Save changes**. Nobody can join while you do.',
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
    */
    {
      id: 'choosing-question-set',
      title: 'Your question sets',
      icon: 'Books',
      blocks: [
        {
          t: 'p',
          text: 'Open them with **Question sets** on the start screen, or **Your question sets** in Create engagement. Every set you can play is in the Create engagement list; this dialog is where you change them.',
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
          text: 'A set marked Not offered in the picker is switched off and is not in the Create engagement list. A set Workie wrote that nobody has read yet is marked Draft and offers **Review** instead of **Edit questions**.',
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
          text: 'In Your question sets press **New question set**, pick the format, and choose how to make it. Each way says when it is the right one: have Workie write it, download a template and fill it in, paste a prompt into your own chatbot, or write a few questions in the manual builder. A filled-in template is uploaded at the foot of the same panel.',
        },
        {
          t: 'p',
          text: 'What Workie writes waits as a draft. A line at the top of Your question sets says when a draft is waiting; press **Review** beside it (or **Watch** while it is still being written). **Review AI draft** shows every question; nothing is saved until you accept. The bell tells you too when a draft is ready.',
        },
        { t: 'p', text: 'The AI builders guide covers writing with Workie and reviewing a draft in detail; Writing questions covers the fields of a question.' },
      ],
    },
    /*
      QuickstartMenu.jsx: "Pick a set and go", "Creates the session and starts
      it in one press." Sets: quickstart && active, sections for Call &
      Answer, Trivia, Wavelength, Poll (no Survey, no Build Room); title
      "Quick <kind>: <set>"; all categories, shuffled; QuickScreens "Where the
      room watches" only when a Call & Answer set is listed; PlanLimitNotice.
      The chip: HostQuestionSetsDialog.jsx:673-693, title "Click to offer this
      set on the quickstart menu"; inactive sets stay off the menu (:683).
      Checked on dev 22 Oct 2026.
    */
    {
      id: 'quick-start',
      title: 'Quick start',
      icon: 'Lightning',
      blocks: [
        {
          t: 'p',
          text: '**Quick start** on the start screen opens **Pick a set and go**: the sets on the quick start menu, grouped by format (Call & Answer, Trivia, Wavelength and Poll; surveys and Build Rooms are not offered). One press on a set creates the session and starts it, with all its categories and the questions shuffled, titled after the set. There is nothing else to fill in; change settings afterwards in the Session panel.',
        },
        {
          t: 'p',
          text: 'When a Call & Answer set is listed, **Where the room watches** sits at the top: choose **One screen** or **Two screens** before you press a set. On two screens the room\'s window opens as the session starts.',
        },
        {
          t: 'p',
          text: 'To put one of your sets on the menu, click its **Quickstart** tag in Your question sets; click again to take it off. The click is the change. A set that is switched off stays off the menu. Administrators choose the rest of the menu in the console.',
        },
      ],
    },
    /*
      config/surfaces.js:26 TWO_SURFACE_TYPES (call-and-answer, build);
      GameHostPage.jsx:7075 chooser in the lobby, C&A only, not events, until
      this browser has chosen; config/roomScreen.js ROOM_WORDS (Where will the
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
          text: 'A Call & Answer session can run on one screen or two. Every other format, and every session inside an event, runs on one screen.',
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
          text: 'The first time you start a Call & Answer session, the lobby asks **Where will the room watch?** Pick one, or press **Help me pick** to answer three questions about your setup and get a recommendation. This browser remembers the choice. Quick start asks the same question as **Where the room watches**. To change it later, use Screens at the top of the Session panel\'s Settings tab.',
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
          text: 'Once the session has started and before the first round, open the Session panel\'s Settings tab and check:',
        },
        {
          t: 'list',
          items: [
            { title: 'Screens', text: 'One screen or two, and the room screen size: Room, TV, Call or Table. The right size is the difference between readable and squinting.' },
            { title: 'Names', text: 'Under The rounds: **Show who wrote each response from the start**, and **Name who is still waiting** for whether the room sees who has not answered yet.' },
            { title: 'Controls on your phone', text: '**Your phone as a remote**: scan its QR with your own phone and run the session while you walk around. You sign in on the phone; it is a host control, not a player screen.' },
            { title: 'Joining', text: 'The join link, to paste into a video call\'s chat.' },
          ],
        },
        { t: 'p', text: 'Running the room explains each setting; Two screens and your phone covers the remote.' },
      ],
    },
    /*
      SessionHistoryPanel.jsx: "Your sessions" / "Edit one to set it up, or
      start it when the room is ready."; Search sessions ("Title, code, host
      or set…"), Type; columns Session, Code, Type, State (Played / Not
      started), Players, Rounds, Created, Last played; flags On stage /
      Latest; rowActions (:109-140): not started Edit + Start; started Report
      + Continue; closed survey Report + Results + Continue; Build Room
      Continue + Report; event Edit agenda / Open; every row Link, Invite….
      Checked on dev 22 Oct 2026.
    */
    {
      id: 'sessions-list',
      title: 'Your sessions list',
      icon: 'ListBullets',
      blocks: [
        {
          t: 'p',
          text: '**Sessions** on the start screen lists every session you have created or run, newest first, with its code, type, state (Not started or Played), players, rounds and dates. Search by title, code, host or set, or filter by **Type**.',
        },
        {
          t: 'table',
          head: ['The session', 'Its buttons'],
          rows: [
            ['Not started', '**Edit** to change it, **Start** to open it to the room.'],
            ['Played', '**Continue** to go back to it, **Report** to read its report.'],
            ['A closed survey', '**Results** as well, for its answers.'],
            ['Every row', '**Link** copies the join link; **Invite…** opens an invitation to send.'],
          ],
        },
        {
          t: 'p',
          text: 'A Build Room continues on its own page. An event has one row; open it to see its items. Saved reports are under **Reports** on the start screen, covered in Results and reports.',
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
