/*
  RUNNING AN EVENT (help refresh Phase 2, W6, 22 Oct 2026).

  Two guides: building the agenda (host-event-agenda) and running the day
  (host-event-day). Checked against the code and against dev on 22 Oct 2026
  (a small event, 4698, built, run and ended by the QA host in a team on a
  paid plan). Sources, by section:

    what-an-event-is   WelcomeEvents.jsx ("Run an event", "New event", "See how",
                       two shown, "N more in the console's Events list");
                       utils/eventsAccess.js (paid plan, any member);
                       agenda-rules.js MAX_ITEMS 16, MAX_ENGAGEMENTS 8, breaks
                       not counted. Billing is host-plan#other-things-counted.
    new-event          EventDetailsDialog.jsx (Name, Date, Starts, Time zone,
                       Place, Who can join, Reports for attendees, afterwards,
                       Create event, "The join code is chosen when you create
                       it."); GameSetupDialog.jsx EVENT_KIND "Continue to the
                       event" → GameHostPage newEventTitle → the same dialog.
                       Attendee reports are stored on the event; nothing yet
                       hands them to attendees, so the help names the choice only.
    the-agenda-page    HostEventAgenda.jsx (Main screen, Open the stage);
                       EventBuilder.jsx facts, Edit details, Run the event /
                       Open the stage / The stage, "Times are the plan, not a
                       timer", the foot.
    adding-items       EventBuilder.jsx MENU_ENGAGEMENTS, "Talks", "Just on the
                       agenda", the cap notes; agenda-rules TYPE_LABELS.
    session-items      EventItemDialog.jsx picker, "Title on the agenda",
                       Facilitator, Planned length, Goes after, Description,
                       the create dialog's own options (SessionOptions),
                       Add to agenda; Order / Set the running order
                       (config/runningOrder.js); "Use vN" on the row.
    talks-and-slides   EventItemDialog.jsx slides field (Choose a PDF, 50 MB,
                       Replace, Remove PDF); agenda-rules DECK_*.
    breaks-activities  EventItemDialog.jsx break and activity headings.
    changing-the-agenda EventBuilder.jsx reorder (grip, arrows, Alt+↑/↓), Edit
                       disabled once started; EventItemDialog "Remove from
                       agenda" / Keep it; "Delete event…" confirm and who may.
    finding-events     WelcomeEvents.jsx; SessionHistoryPanel.jsx event rows
                       (Edit, Open, Link; items Report, Continue, "Session
                       expired"); console Events list is admin-game-management.

    the-board          EventStage.jsx: rail chips (Starting soon, Live now,
                       Between items, The day is over), "N of M done", JOIN,
                       board rows (Open, Go live, Resume, Pause, End), dock
                       (EDIT AGENDA, QR, END EVENT), F for full screen.
    open-or-go-live    EventStage openItem/goLive; GameHostPage eventWaiting
                       ("Bring everyone here", "Preview — the phones are not
                       here yet"), previewRunningOrder.
    moving-through     EventStage plan (Go live: …, End …), run.js stepAside
                       (moving on finishes the live item; an open survey
                       pauses), End confirm ("End it", "Keep it"), survey refusal.
    session-on-the-day GameHostPage eventCode: lobby shows the event code,
                       Dock AGENDA, "Back to the agenda" as the leave primary,
                       no two-screen console or room-screen chooser in events.
    talks-on-the-day   EventStage deck: ← → PageUp PageDown, Full screen / F,
                       Space and click while full screen, Esc; the "Just
                       arrived? Open" join block and "Coming up".
    breaks-on-the-day  EventStage break: Back at, countdown, +5 min, End the break.
    ending-the-event   EventStage "End the event?" (Keep going / End the event),
                       run.js endEvent; "That's the day."
*/

/* ------------------------------------------------------ building the agenda */

const eventAgenda = {
  id: 'host-event-agenda',
  title: 'Building an event',
  icon: 'CalendarBlank',
  summary: 'Make an event, then build its agenda: sessions, talks with slides, activities and breaks, in the order you will run them.',
  sections: [
    {
      id: 'what-an-event-is',
      title: 'What an event is, and who can make one',
      icon: 'CalendarBlank',
      blocks: [
        {
          t: 'p',
          text: 'An event is one join code for a whole agenda. People join once with that code and their phones follow the agenda all day, into each item as you start it.',
        },
        {
          t: 'list',
          items: [
            { title: 'Who', text: 'Any member of a space or team on a paid plan. On the free plan, **Run an event** on your start screen says which plan brings events, with **See how**.' },
            { title: 'How much it holds', text: 'Up to 16 items, of which up to 8 are sessions people answer. Breaks are listed but not counted.' },
            { title: 'What it costs', text: 'An event is counted once, when it first goes live: see What counts toward your plan.' },
          ],
        },
      ],
    },
    {
      id: 'new-event',
      title: 'Making a new event',
      icon: 'PencilSimple',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Start it', text: 'Press **New event** under **Run an event** on your start screen. Or, in **Create engagement**, pick the Event format and press **Continue to the event**; your title comes with you.' },
            { title: 'Say when and where', text: 'Give it a **Name**, a **Date**, a start time (**Starts**) and a **Time zone**. **Place** is optional and shows on the agenda.' },
            { title: 'Choose the reports default', text: 'Under **Reports for attendees, afterwards**, pick **Full**, **Anonymous** or **Not shared**: the default for every item\'s report.' },
            { title: 'Create it', text: 'Press **Create event**. Engage chooses the four-digit join code, and the agenda page opens, empty.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Who can join',
          text: '**Anyone with the code** is the way in: people type their own name, as they would for a session.',
        },
        {
          t: 'p',
          text: 'The date can be up to a year ahead. To change any of this later, press **Edit details** on the agenda page.',
        },
      ],
    },
    {
      id: 'the-agenda-page',
      title: 'The agenda page',
      icon: 'ListNumbers',
      blocks: [
        {
          t: 'p',
          text: 'This is where you build the day. Across the top are the event\'s facts: the date, the start time and time zone, the place, who can join, the **Join code**, and how many have **Joined** so far.',
        },
        {
          t: 'list',
          items: [
            { title: '**Edit details**', text: 'Change the name, date, time, place or the reports default.' },
            { title: '**Run the event**', text: 'Opens the event\'s stage in a new tab, so the agenda stays open here. Once the event is running it reads **Open the stage**. **Open the stage** at the top right goes there in this tab.' },
            { title: '**Add item**', text: 'Adds to the agenda; see the next section.' },
            { title: '**Main screen**', text: 'Back to your start screen.' },
          ],
        },
        {
          t: 'p',
          text: 'Each row\'s time is the start plus the lengths of everything before it, so moving or resizing one item retimes the rest. Times are the plan, not a timer: you start each item yourself. The line under the table gives the planned end, the total length and how many items and sessions you have used.',
        },
      ],
    },
    {
      id: 'adding-items',
      title: 'Adding items',
      icon: 'Plus',
      blocks: [
        {
          t: 'p',
          text: 'Press **Add item** and choose a kind. Each opens a short form; press **Add to agenda** to save it.',
        },
        {
          t: 'table',
          head: ['Kind', 'What it is'],
          rows: [
            ['**Survey**, **Trivia**, **Call & Answer**, **Poll**, **Wavelength**', 'A session the room answers, played from one of your question sets. These are the up-to-8 sessions.'],
            ['Under **Talks**', 'A talk, with its slides as a PDF if you like. The stage shows them a slide at a time.'],
            ['**Activity**', 'Anything else on the day with nothing to answer: networking, lunch with a speaker, an open discussion.'],
            ['**Break**', 'A return time on the agenda. Not counted toward the 16 items.'],
          ],
        },
        {
          t: 'p',
          text: 'When the agenda is full, the menu says why and greys out what no longer fits; breaks can still be added.',
        },
        {
          t: 'p',
          text: 'Every form has a **Title on the agenda**, a **Planned length** in minutes, **Goes after** (where it lands), and a **Description**. The title, the description and the leader\'s name are what the room and every phone see.',
        },
      ],
    },
    {
      id: 'session-items',
      title: 'Adding a session',
      icon: 'GameController',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Pick the set', text: 'The form lists your question sets of that kind, with each one\'s version and question count. Search to narrow it. A set already on this agenda says **On this agenda**.' },
            { title: 'Name it', text: '**Title on the agenda** starts as the set\'s name. It is also the session\'s name on the stage. **Facilitator** is optional.' },
            { title: 'Set its options', text: 'Categories, Workie\'s briefing (Call & Answer) and the Advanced choices are the same as when you create a session: see Setting a session up.' },
            { title: 'Add it', text: 'Press **Add to agenda**.' },
          ],
        },
        {
          t: 'list',
          items: [
            { title: '**Order**', text: 'On a Trivia, Call & Answer, Poll or Wavelength row. Opens that session\'s stage in a new tab with the Session panel on its running order, so you choose which questions come first before anyone joins. Changing the set\'s options afterwards clears that order.' },
            { title: 'Use v and a number', text: 'Appears on a row when its question set has a newer version than the one the item plays. Nothing changes until you press it.' },
          ],
        },
      ],
    },
    {
      id: 'talks-and-slides',
      title: 'Talks and their slides',
      icon: 'FilePdf',
      blocks: [
        {
          t: 'p',
          text: 'Add a talk from under **Talks** in the **Add item** menu. Give it a title, a **Presenter** if you know who, a length and a description.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Save your slides as a PDF', text: 'PowerPoint, Keynote and Google Slides all save as PDF. One PDF per talk, up to 50 MB.' },
            { title: 'Add it', text: 'Press **Choose a PDF**. Engage reads it, counts its pages and uploads it while you watch. **Add to agenda** (or **Save**) waits until the upload is done.' },
            { title: 'Change it later', text: 'Open the talk with **Edit**: **Replace** swaps the file, **Remove PDF** takes it off. Neither happens until you save.' },
          ],
        },
        {
          t: 'p',
          text: 'The talk\'s row then says how many slides it has. Showing them on the day: Running an event on the day.',
        },
      ],
    },
    {
      id: 'breaks-activities',
      title: 'Breaks and activities',
      icon: 'Clock',
      blocks: [
        {
          t: 'list',
          items: [
            { title: '**Break**', text: 'A length and an optional title (it is called Break if you leave it blank). The agenda shows when people are due back. Breaks have no number in the agenda and do not count toward its 16 items.' },
            { title: '**Activity**', text: 'A title, an optional **Led by** name, a length and a description. It sits on the agenda with nothing to answer, and counts as one of the 16 items.' },
          ],
        },
        {
          t: 'p',
          text: 'On the day a break shows a countdown to its return time, and an activity or a talk tells phones to look up.',
        },
      ],
    },
    {
      id: 'changing-the-agenda',
      title: 'Reordering, editing and removing',
      icon: 'DotsSixVertical',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Move an item', text: 'Drag its row by the grip, press the up and down arrows on the row, or focus the row and press Alt+↑ or Alt+↓. Every time after it moves with it.' },
            { title: '**Edit**', text: 'Change the title, length, description or leader. The set itself cannot change: remove the item and add the other set. Once an item has started it cannot be edited.' },
            { title: '**Remove from agenda**', text: 'In the item\'s **Edit** form. It asks first (**Keep it** or **Remove**), and the times after it move up.' },
            { title: '**Delete event…**', text: 'At the foot of the page. It takes the agenda, the join code and the sessions its items ran; saved reports are kept. It cannot be undone. Only the host who made the event, or a team owner or admin, can delete it or remove its items.' },
          ],
        },
      ],
    },
    {
      id: 'finding-events',
      title: 'Finding your events again',
      icon: 'MagnifyingGlass',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Start screen', text: '**Run an event** lists up to two events that are running or still to come, each with **Open** (its stage). Past events are not listed there.' },
            { title: 'Sessions', text: 'An event is one row labelled Event, with **Edit** (the agenda), **Open** (the stage) and **Link** (copies the attendees\' join link). Click its name to see its items; a session item has **Report** and **Continue**.' },
            { title: 'The console', text: 'The Events list shows every event in the space or team: see Sessions and events.' },
          ],
        },
      ],
    },
  ],
};

/* ------------------------------------------------------------ on the day */

const eventDay = {
  id: 'host-event-day',
  title: 'Running an event on the day',
  icon: 'PlayCircle',
  summary: 'The event\'s stage: looking at an item, bringing everyone to it, moving through the agenda, talks, breaks, and ending the day.',
  sections: [
    {
      id: 'the-board',
      title: 'The event\'s stage',
      icon: 'Monitor',
      blocks: [
        {
          t: 'p',
          text: 'Open it with **Run the event** or **Open the stage** on the agenda page, or **Open** on your start screen. Put it on the screen the room sees: it is the agenda, large, with the join code along the top.',
        },
        {
          t: 'list',
          items: [
            { title: 'The top line', text: 'Where the day is (**Starting soon**, **Live now**, **Between items**), the event\'s name, how many items are done, and **JOIN** with the address and the event code.' },
            { title: 'The rows', text: 'Each item with its time and its state (**Live**, **Paused**, **Done**), and the buttons that fit it: **Open**, **Go live**, **Resume**, **Pause**, **End**.' },
            { title: 'The dock', text: 'The next step on its main button (Space presses it), **EDIT AGENDA**, **QR** (a large join code for the room) and **END EVENT**.' },
          ],
        },
        {
          t: 'p',
          text: 'Press F for full screen, and Esc to leave it. The stage checks for changes every ten seconds, so a second laptop on the same event keeps up.',
        },
      ],
    },
    {
      id: 'open-or-go-live',
      title: 'Looking at an item, and bringing everyone to it',
      icon: 'Eye',
      blocks: [
        {
          t: 'table',
          head: ['Button', 'Your screen', 'Phones'],
          rows: [
            ['**Open**', 'Goes to that item.', 'Stay where they are.'],
            ['**Go live**', 'Goes to that item.', 'Switch to it by themselves. Nobody types a code.'],
          ],
        },
        {
          t: 'p',
          text: '**Open** is for rehearsing and checking. Opening a session that has not run yet shows its lobby, its questions and its Session panel, with **Preview — the phones are not here yet** on the dock. From there, **Set the running order** chooses which questions come first.',
        },
        {
          t: 'p',
          text: 'When you are ready, press **Bring everyone here** on that item\'s dock (**Bring everyone back** on a paused one), or **Go live** on its row.',
        },
      ],
    },
    {
      id: 'moving-through',
      title: 'Moving through the agenda',
      icon: 'ArrowRight',
      blocks: [
        {
          t: 'p',
          text: 'The dock\'s main button is always the next step, such as "Go live: trivia" or "End the break". Space presses it.',
        },
        {
          t: 'list',
          items: [
            { title: 'Going live finishes what was live', text: 'When the next item goes live, the one before it is marked **Done**. A survey still collecting is the exception: it pauses instead, so you can come back, close it on its stage and end it.' },
            { title: '**Pause** and **Resume**', text: 'On a live row. Phones say the host will be back, and anything already sent is kept. **Resume** brings everyone back. A break has no pause.' },
            { title: '**End**', text: 'Asks first (**Keep it** or **End it**). An ended item cannot go live again; a session\'s report is kept in your session history.' },
          ],
        },
        {
          t: 'p',
          text: 'You can skip an item: going live on a later one leaves the skipped item planned, and you can still take it live afterwards.',
        },
      ],
    },
    {
      id: 'session-on-the-day',
      title: 'Running a session item',
      icon: 'GameController',
      blocks: [
        {
          t: 'p',
          text: 'A session item opens on its own stage and runs like any session: see Running the room. In an event it differs in three ways.',
        },
        {
          t: 'list',
          items: [
            { title: 'The event\'s code', text: 'Its lobby shows the event code, not a session code. Late arrivals join the event and land in this session.' },
            { title: '**AGENDA** on the dock', text: 'Back to the event\'s stage. It does not pause anything: the phones stay where they are.' },
            { title: 'At the end', text: 'When the session ends, the dock offers **Back to the agenda**.' },
          ],
        },
        {
          t: 'p',
          text: 'In an event every item runs on its stage; the two-screen console is not used.',
        },
      ],
    },
    {
      id: 'talks-on-the-day',
      title: 'Talks and slides on the day',
      icon: 'FilePdf',
      blocks: [
        {
          t: 'p',
          text: 'A talk with slides shows the current slide as large as the stage allows, with its title, the presenter, "Slide 3 of 12" and arrows beside it. Phones show the talk and can follow the slides.',
        },
        {
          t: 'keys',
          items: [
            { keys: '→ ← (or a clicker)', text: 'Next and previous slide. PageDown and PageUp do the same.' },
            { keys: 'F or **Full screen**', text: 'The slide alone fills the screen. There, Space, the arrows and a click also turn the slide.' },
            { keys: 'F or Esc', text: 'Leave full screen.' },
            { keys: 'Space', text: 'Outside full screen, the dock\'s next step.' },
          ],
        },
        {
          t: 'p',
          text: 'A talk without slides, or an activity, shows its title, who leads it and its description, with **Just arrived? Open** and the join code, and what is **Coming up**.',
        },
      ],
    },
    {
      id: 'breaks-on-the-day',
      title: 'Breaks on the day',
      icon: 'Clock',
      blocks: [
        {
          t: 'p',
          text: 'A live break shows **Back at** and the time, a countdown, and what is next. Phones show the same return time.',
        },
        {
          t: 'list',
          items: [
            { title: '**+5 min**', text: 'Moves the return time five minutes later.' },
            { title: '**End the break**', text: 'Ends it when there is nothing after it. Otherwise the dock offers the next item, which ends the break as it goes live.' },
          ],
        },
        {
          t: 'p',
          text: 'The countdown stops at 0:00; nothing moves on by itself.',
        },
      ],
    },
    {
      id: 'ending-the-event',
      title: 'Ending the event',
      icon: 'CheckCircle',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'End it', text: 'On the event\'s stage, press **END EVENT** on the dock, or the main button once nothing is left to go live.' },
            { title: 'Confirm', text: '**End the event?** says what happens: anything live or paused ends, nobody new can join, items that never started stay unplayed, and reports already made are kept. Press **End the event**, or **Keep going**.' },
          ],
        },
        {
          t: 'p',
          text: 'The stage then reads **The day is over**, and phones show "That\'s the day." A survey that is still collecting stops the end until you close it on its stage.',
        },
        {
          t: 'p',
          text: 'Each session item\'s report is in Sessions on your start screen, under the event\'s row: see The session report.',
        },
      ],
    },
  ],
};

/**
 * The host-events area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'host-events',
  guides: { host: [eventAgenda, eventDay] },
};
