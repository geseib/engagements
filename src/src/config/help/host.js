/**
 * THE FIVE HOST GUIDES.
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

const quickStart = {
  id: 'host-quick-start',
  title: 'Quick start',
  icon: 'RocketLaunch',
  summary: 'From nothing to a room full of people playing, in about five minutes.',
  sections: [
    {
      title: 'The shape of it',
      icon: 'Target',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Create the session', text: 'Pick a question set, give it a title.' },
            { title: 'Start it', text: 'That opens the doors. The QR code goes up on the screen.' },
            { title: 'Run the rounds', text: 'You drive. Everyone\'s screen follows yours.' },
            { title: 'Read the results', text: 'Scores, the best answers, and an AI summary of what the room said.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'The fastest possible start',
          text: 'The welcome screen has a Quick start menu of ready-made sessions. One tap and you are at step 3 with a room that can already join.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Coming back to a session',
          text: 'Everything you have made is under Sessions on the welcome screen — edit a session before anyone joins, start it when the room is ready, continue one you left part-way, or read the report of one already played.',
        },
      ],
    },
    {
      title: 'Step 1 — Create',
      icon: 'Plus',
      blocks: [
        {
          t: 'steps',
          items: [
            'Choose Create session on the welcome screen.',
            'Give it an event title — this is what the room sees on the big screen.',
            'Pick the kind of session, and a question set of that kind.',
            'Narrow it by category if you want a subset of the questions.',
          ],
        },
        { t: 'h', text: 'The kinds you can run' },
        { t: 'gameTypes' },
        {
          t: 'note',
          tone: 'info',
          title: 'A set belongs to one kind',
          text: 'The set list filters to the kind you picked, so you cannot accidentally run a trivia set as a poll. If the list looks empty, the kind is probably not the one you meant.',
        },
      ],
    },
    {
      title: 'Step 2 — Start, and get people in',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'p',
          text: 'A session you have created is not joinable yet. Start it, and the join QR appears.',
        },
        {
          t: 'list',
          items: [
            'People scan the QR from wherever they are sitting.',
            'Anyone who cannot scan can type the four-digit code instead.',
            'Remote attendees on a video call use the join URL — it is under Settings, "Players join at".',
            'Names appear on your Players tab as they arrive.',
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'You do not have to wait for everybody',
          text: 'Start the questions when you have enough people. Latecomers join mid-session and play from the round they arrive on.',
        },
      ],
    },
    {
      title: 'Step 3 — Run the rounds',
      icon: 'Play',
      blocks: [
        {
          t: 'p',
          text: 'Open-answer rounds run three beats. Read the question out, let people write, then move the room on.',
        },
        { t: 'phases', gameType: 'call-and-answer' },
        { t: 'p', text: 'Trivia is shorter — there is nothing to vote on, so it goes straight to the answer.' },
        { t: 'phases', gameType: 'trivia' },
        {
          t: 'keys',
          items: [
            { keys: 'Space  →', text: 'Advance to the next beat.' },
            { keys: '←', text: 'Step back a beat.' },
            { keys: '↑ ↓', text: 'Page through responses and the AI read-back when there is more than one page.' },
            { keys: 'U', text: 'Show or hide the names on the room meter, top right.' },
            { keys: '\\', text: 'Open and close the session panel.' },
            { keys: 'Esc', text: 'Close whatever is open.' },
          ],
        },
        {
          t: 'p',
          text: 'If you advance early, a dialog checks first — ← keeps the round where it is, → goes ahead anyway. The keys are printed on its buttons.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'Do not rush the ASK beat',
          text: 'The Players tab shows you who has answered and who has not. Move on when the list is short, not when the first person finishes.',
        },
      ],
    },
    {
      title: 'Step 4 — Results',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'The answers', text: 'Ranked by the room\'s votes, with names attached once voting has closed.' },
            { title: 'The scoreboard', text: 'Cumulative across the session.' },
            { title: 'The AI summary', text: 'Themes, follow-up questions and suggested next steps, written from what the room actually said.' },
          ],
        },
        {
          t: 'p',
          text: 'Stay on results as long as the conversation is good. Nothing times out, and the AI\'s follow-up questions are usually the best thing on the screen for prompting discussion.',
        },
      ],
    },
    {
      title: 'Common questions',
      icon: 'Question',
      blocks: [
        {
          t: 'faq',
          items: [
            { q: 'Someone joined late — is that a problem?', a: 'No. They play from the round they arrived on and appear on the scoreboard immediately. They cannot score for rounds that already happened.' },
            { q: 'Someone lost their connection.', a: 'They reopen the link and enter the same name. Their answers and points come back with them.' },
            { q: 'How many people can play?', a: 'Technically a lot. In practice the discussion is best somewhere between 5 and 50 — past that, reading answers out loud stops being possible.' },
            { q: 'Can I run the same set again?', a: 'Yes. Each session is a fresh room; the set is unchanged by being played.' },
            { q: 'Can I go back to a round we already did?', a: 'Yes — the Rounds tab holds every round played, with its answers and its AI summary.' },
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
  summary: 'Question sets, categories, quick start, and the settings worth changing before anyone arrives.',
  sections: [
    {
      title: 'Choosing a question set',
      icon: 'Books',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'House sets', text: 'Provided for everyone. You cannot edit them, but you can fork one and edit your copy.' },
            { title: 'Your own sets', text: 'Ones you created or forked. Editing one of these creates a new version rather than overwriting what you have already played.' },
          ],
        },
        {
          t: 'p',
          text: 'The Edit button says what it will do: "New version" on a set you own, "Fork" on a house set. Neither ever changes a set out from under a session that is running.',
        },
      ],
    },
    {
      title: 'Quick start',
      icon: 'Lightning',
      blocks: [
        {
          t: 'p',
          text: 'The welcome screen\'s Quick start menu is a shortlist of sets you can launch in one tap, for when somebody says "have we got ten minutes of something".',
        },
        {
          t: 'p',
          text: 'You control what is on it. In your set list, click a set\'s quickstart tag to put it on the menu or take it off — the tag\'s tooltip reads "Show this set in the host\'s quickstart menu". No dialog, no save button; the click is the change.',
        },
      ],
    },
    {
      title: 'Categories',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: 'Sets are tagged by category, and you can play a subset. Pick the categories at setup, or toggle them mid-session from the Questions tab — the count beside each one tells you how many unasked questions it still has.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Turning a category off mid-session',
          text: 'It only affects what comes next. Rounds already played stay in the results and in the report.',
        },
      ],
    },
    {
      title: 'Settings worth a look before you start',
      icon: 'Monitor',
      blocks: [
        { t: 'h', text: 'Display profile' },
        {
          t: 'p',
          text: 'Sets the type size for the room you are actually in. Get this right before people arrive — it is the difference between a readable session and a squinting one.',
        },
        {
          t: 'table',
          head: ['Profile', 'For'],
          rows: [
            ['Room — projector', 'A projected screen with the audience at some distance.'],
            ['TV — large panel', 'A wall-mounted panel. The largest type of the four.'],
            ['Call — screen share', 'You are sharing your screen on a video call.'],
            ['Table — laptop', 'A few people around one laptop.'],
          ],
        },
        { t: 'h', text: 'Names' },
        {
          t: 'list',
          items: [
            { title: 'Show who wrote each response', text: 'Off by default on voted rounds — answers stay anonymous until voting closes, so people vote on the answer and not the author.' },
            { title: 'Name who is still waiting', text: 'Whether the room sees who has not answered yet. Gentle nudge, or public pressure, depending on the room.' },
          ],
        },
        { t: 'h', text: 'Controls on your phone' },
        {
          t: 'p',
          text: 'A second QR code, this one for you. Scan it with your own phone and you can run the session from your hand while walking around. You will be asked to sign in — it is a host control, not a player screen.',
        },
      ],
    },
  ],
};

const running = {
  id: 'host-running-engagements',
  title: 'Running the room',
  icon: 'Broadcast',
  summary: 'The session panel, the phone remote, and going back over a round.',
  sections: [
    {
      title: 'The session panel',
      icon: 'Gear',
      blocks: [
        {
          t: 'p',
          text: 'Everything you need mid-session is behind one panel. Press \\ to open and close it, or use the SETUP control on the dock.',
        },
        {
          t: 'table',
          head: ['Tab', 'What it is for'],
          rows: [
            ['Players', 'Who is here, who has answered, and the two things you can do about a person.'],
            ['Questions', 'Categories, and choosing what to ask next instead of taking the next one in order.'],
            ['Rounds', 'Everything already played, plus the session report.'],
            ['Settings', 'Display profile, names, join links, your phone remote, and the keyboard shortcuts.'],
          ],
        },
      ],
    },
    {
      title: 'Choosing what to ask next',
      icon: 'Shuffle',
      blocks: [
        {
          t: 'p',
          text: 'You do not have to take the questions in order. The Questions tab lists them with an asked/unasked tag, a search box for titles, and a "Choose the next question" action — useful when the conversation has gone somewhere and you want to follow it.',
        },
      ],
    },
    {
      title: 'Running it from your phone',
      icon: 'DeviceMobile',
      blocks: [
        {
          t: 'p',
          text: 'Scan the "Controls on your phone" QR from the Settings tab. Your phone becomes the remote and the big screen stays on the room — so you can walk around instead of standing behind a laptop.',
        },
        { t: 'h', text: 'What the phone gives you' },
        {
          t: 'list',
          items: [
            { title: 'The round view', text: 'Advance the beat, see how many have answered, and jump to the big-screen pad.' },
            { title: 'Players', text: 'Everyone in the room, in score order — the same list as the desktop panel.' },
            { title: 'Rounds', text: 'Everything played so far, so you can look up what someone said in round two without turning round.' },
            { title: 'Questions', text: 'The set, and what to ask next.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Still to answer',
          text: 'During an ASK beat the phone names who the room is waiting on, and the names disappear as people submit. It is the fastest way to know whether to wait another thirty seconds or move on.',
        },
        {
          t: 'p',
          text: 'The phone has no Settings tab, deliberately: the join QR, the categories and Switch game are all on the round view already, one tap away.',
        },
      ],
    },
    {
      title: 'Going back over a round',
      icon: 'ArrowCounterClockwise',
      blocks: [
        {
          t: 'p',
          text: 'The Rounds tab lists every round played, newest work at the top. An AI badge marks the ones with a summary you can read out. Open one and you get its question, every response, and the summary.',
        },
        { t: 'h', text: 'Reading one response at a time' },
        {
          t: 'p',
          text: 'Each response carries a number. Press the number and that response opens full-screen at a size the back of the room can read.',
        },
        {
          t: 'keys',
          items: [
            { keys: '1 – 9', text: 'Open that response. Press another digit to jump straight to it.' },
            { keys: '← →', text: 'Previous and next response — the way to reach the tenth and beyond.' },
            { keys: 'Esc', text: 'Back to the round.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Why the arrows matter',
          text: 'There is no 10 key. Past nine responses the digits run out, so the arrows walk the whole list however long it is — and a digit past the end of a short round does nothing rather than closing the dialog on you.',
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
    {
      title: 'The Players tab',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: 'Everyone in the room, in score order. During a round each row shows whether that person has answered yet, so you can see at a glance who you are waiting on.',
        },
        {
          t: 'p',
          text: 'Each row carries two actions. Both are about people, not about scores — neither one can take points away from anybody.',
        },
      ],
    },
    {
      /*
        THE FEATURE'S OWN RATIONALE, IN THE HOST'S WORDS RATHER THAN THE
        implementer's. The owner's reason for the host being in the loop at all:
        *"they need the choice though because they may have just mistakenly
        picked the same name."*
      */
      title: 'Handing a name over',
      icon: 'Handshake',
      blocks: [
        {
          t: 'p',
          text: 'Someone tries to join as "Sam", and Sam is taken. That is two completely different situations and only you can tell them apart:',
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
          text: 'Which is why the site will not resolve it on its own. It asks you.',
        },
        { t: 'h', text: 'How it works' },
        {
          t: 'steps',
          items: [
            { title: 'They ask', text: 'On their screen they tap "Ask the host to hand it over". Their row on your Players tab now reads "asking to take this name".' },
            { title: 'You decide', text: 'Usually out loud, in the room: "Sam, is that you on the iPad?" Press "Let them take it".' },
            { title: 'The row says "unlocked for one handover"', text: 'They tap "Take over the name" and they are in, with everything that name has scored.' },
          ],
        },
        { t: 'h', text: 'Unlocking without being asked' },
        {
          t: 'p',
          text: 'If nobody has asked, the same button reads "Unlock name". Use it when the conversation happened in the room rather than on a screen — someone says "I have lost my page", and you open the name for them before they get as far as asking.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'One handover, then it locks again',
          text: 'The unlock is spent by the first device that takes it. If the same person needs it again — third device, another browser — you unlock again. That is the protection: an open name is open for a moment, not for the session.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'When it was just a coincidence',
          text: 'Do nothing. The other Sam already has "Pick a different name" in front of them, which is the correct outcome, and it needs no action from you.',
        },
      ],
    },
    {
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

const reporting = {
  id: 'host-reporting',
  title: 'Results and reports',
  icon: 'ChartBar',
  summary: 'The AI summary, the session report, and what happens to the data afterwards.',
  sections: [
    {
      title: 'What the AI writes',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'p',
          text: 'After a round, the AI reads what the room actually said and writes a summary of it — themes, follow-up questions, and suggested next steps. It is generated from the responses in front of it, not from a template.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'The follow-up questions are the useful part',
          text: 'Read one out. It is usually a better prompt for discussion than anything you would think of while also running the session.',
        },
        {
          t: 'p',
          text: 'On rounds that withhold something — the real title, the actual number, what happened next — the AI is given the withheld detail so it can compare the room\'s answers against it and reveal it afterwards. That only works if the question set filled the field in; if the AI promises a reveal that never comes, that is the set to fix, not the session.',
        },
      ],
    },
    {
      title: 'The session report',
      icon: 'FileText',
      blocks: [
        {
          t: 'p',
          text: 'Session report is at the top of the Rounds tab, above the rounds it summarises. It pulls the whole session together — every round, the responses, the scores and the AI summaries — in one document you can keep.',
        },
        {
          t: 'p',
          text: 'You can generate it at any point, during the session or after it. It is not a final action and running it does not end anything.',
        },
      ],
    },
    {
      title: 'How long the data lasts',
      icon: 'CalendarBlank',
      blocks: [
        {
          t: 'note',
          tone: 'warn',
          title: 'Sessions expire',
          text: 'A session is kept for 90 days from creation, and for 7 days after it was last played. If the results matter, generate the report and save it — do not plan to come back for it in six months.',
        },
      ],
    },
  ],
};

export const HOST_ROLE = {
  id: 'host',
  title: 'For hosts',
  icon: 'GameController',
  blurb: 'Running a session in front of a room.',
  guides: [quickStart, gameSetup, running, playerManagement, reporting],
};
