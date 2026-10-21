/**
 * THE SEVEN HOST GUIDES.
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
            'Choose Create engagement on the welcome screen.',
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
          t: 'p',
          text: 'A poll is one question at a time, with the result live on the main screen. A survey has no rounds: you open it, people answer at their own pace, and you close it when the room is done.',
        },
        {
          t: 'keys',
          items: [
            { keys: 'Space  →', text: 'Advance to the next beat.' },
            { keys: '←', text: 'Step back a beat.' },
            { keys: '↑ ↓', text: 'Page through responses and the AI read-back when there is more than one page.' },
            { keys: 'U', text: 'Show or hide the names on the room meter, top right.' },
            { keys: 'S', text: 'Show or hide the scoreboard — Trivia and Call & Answer, once a round is scored.' },
            { keys: 'V', text: 'With the scoreboard up, change its look: departure board, Olympic board, tote board.' },
            { keys: '\\', text: 'Open and close the session panel.' },
            { keys: 'F', text: 'Full screen, and back again. Esc also leaves. On an event, with a talk\'s slides up, F presents the slides alone.' },
            { keys: 'Esc', text: 'Close whatever is open.' },
          ],
        },
        {
          t: 'p',
          text: 'If you advance early, the button asks in place instead of opening a dialog: the first press changes it to "Start voting anyway" (or "Show results anyway") and says who is still writing — "1 of 3 still writing", or "Nobody has answered yet". Press again within a few seconds to go ahead; wait and it settles back.',
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
            { title: 'What the room backed', text: 'The ideas first, ranked by the room\'s votes: each idea in full as the headline, a bar for how much the room backed it compared with the top idea, and a small credit line with the points and the name (the name only while names show). Long ideas shrink to fit; if they still do not fit, the wall shows the top ones and says "and N more ideas".' },
            { title: 'The scoreboard', text: 'Cumulative across the session, and no longer on the results screen: bring it up when you want it with S, or Show scoreboard in the People section on two screens.' },
            { title: 'The question', text: 'Press the question line above the cards (or "The question" row in the console) to put it back up on the wall.' },
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
        {
          t: 'p',
          text: 'A set you generate with AI — or questions you add to one — waits as a draft until you review and accept it. The set list shows drafts waiting at the top, the bell says when one is ready, and nothing is saved until you accept. The bell is on your start screen, in the two-screen console\'s top line and on your phone remote too, never on a screen the room sees; from a session it opens what it points to in a new tab, so the session stays where it is.',
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
        { t: 'h', text: 'Screens: where the room watches, and room screen size' },
        {
          t: 'p',
          text: 'The Screens group, first in Settings and at the top of Setup on the step strip, says whether the room watches this laptop (one screen) or a separate window (two screens), opens the room\'s window, and sets the room screen size (it used to be called Display profile). You can switch between one and two screens mid-session from Setup. Get the size right before people arrive — it is the difference between a readable session and a squinting one.',
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
        {
          t: 'p',
          text: 'The size also decides how much the room is shown. On every size the room sees only what it needs, large. When a question or lesson is up, the title and the lesson lead, and the question to answer sits in a "Your turn" band; the general instruction ("answer on your phone") is left off, because the top line already says where to answer. While voting the room sees every answer, numbered, or one at a time when they are long; at results the room\'s pick reads in full with the bars behind the answers, and no vote counts while names are hidden. Call, read on people\'s own screens, adds the general instruction. In a Build Room each option shows its detail, the tally stays hidden until the vote closes, a long ask pages, and Claude\'s status line is always there. Show the QR puts the join code in a panel beside what is up, instead of covering it; click an answer, or step with → and ←, to put one up, and Esc goes back to all of them. The same rule holds on one screen and on the room\'s window.',
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
            ['Settings', 'Four groups, most used first: Screens (one or two screens, the room\'s window, room screen size), Your phone as a remote, The rounds (names, pace, feedback, scoreboard style), and Joining. Session details and the keyboard shortcuts fold away below.'],
          ],
        },
      ],
    },
    {
      title: 'Two screens: your laptop console',
      icon: 'Monitor',
      blocks: [
        {
          t: 'p',
          text: 'When the room watches a separate window (Room\'s window ↗, dragged onto the projector), your laptop stops showing a copy of the wall. It shows your console: what you need for the step, and nothing the room needs.',
        },
        {
          t: 'table',
          head: ['Part', 'What it is for'],
          rows: [
            ['Top line', '← All sessions (in the lobby and at the end: back to your sessions; this one keeps running and Continue brings you back), the join code (press it to put the code on the wall), Room\'s window ↗, and whether that window is really up.'],
            ['The loop', 'The round\'s steps. Press one to look at it privately; the room stays where it is until you press Back to the room.'],
            ['Left rail', 'Round queue, People (with Show scoreboard / Hide scoreboard), Late & not reviewed, Session tools. The one that matters for the step opens by itself.'],
            ['Your part now', 'At the top of the centre: what to do next, the one count for the step, what the wall shows next, and the buttons.'],
            ['Main area', 'The lesson and the task while the room answers, responses as they land, the ballot in the room\'s order, results, Workie\'s read with Ask the room beside it. The part of the read the wall is showing is marked "On the wall". During voting and results, the first row, "The question", puts the question back up.'],
          ],
        },
        { t: 'h', text: 'Is the room\'s window up?' },
        {
          t: 'list',
          items: [
            { title: 'On, full screen', text: 'Connected, visible and full screen. You are ready.' },
            { title: 'Open, not full screen', text: 'Click the room\'s window once to fill the screen (or press F). The laptop says so under the status, as text.' },
            { title: 'Hidden', text: 'The window is minimised or behind another tab.' },
            { title: 'Not open', text: 'Press it to open one, then drag it onto the projector.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'One laptop, no second display',
          text: 'On a call, or with a projector that mirrors this laptop, use Open as a tab beside Room\'s window ↗ (on the top line and in Settings, Screens). It opens the room\'s window in a tab of this browser: share that tab on the call, or click it once to fill the screen on a mirrored projector (F does the same). The line under the status says so whenever no window is open.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Chrome or Edge with a second display: it opens there for you',
          text: 'With the projector or TV connected as a second display (extended, not mirrored), Room\'s window ↗ opens the window on that display and fills it. The first time, the browser asks to "manage windows on all your displays": allow it. Then click the room\'s window once and it goes full screen (it says so at the bottom until you do). Quick start shows where the room watches before you pick a set, and on two screens it opens the room\'s window as the session starts. In other browsers, or if you say no, it opens beside you: drag it onto the projector and press F.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Putting a response on the wall',
          text: 'Press a response in the main area and it goes up on the wall. Space, → and the clicker still move the room on afterwards.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'One screen is unchanged',
          text: 'If your laptop itself is on the projector, keep one screen: the room needs to see what you see, so the console stays out of the way.',
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
          text: 'Scan the QR under "Your phone as a remote" in the Settings tab. Your phone becomes the remote and the big screen stays on the room — so you can walk around instead of standing behind a laptop.',
        },
        { t: 'h', text: 'Who may sign in on the phone' },
        {
          t: 'p',
          text: 'On a team session, sign in on the phone as any host or admin of that team: it does not have to be the account on this laptop. On a personal account, sign in as you. Only your account can drive this session. The "Your phone as a remote" box names the team and who is signed in on this laptop now. It shows your email only while the room\'s window is up on two screens; otherwise the room might be watching this laptop, so it shows your name.',
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

/*
  LATE ITEMS (session flow v3 §4.4, phase 5): what arrives after its moment is
  kept and labelled, never lost. Words from config/lateWords.js.
*/
const lateItems = {
  id: 'host-late-items',
  title: 'Late answers and comments',
  icon: 'Clock',
  summary: 'What arrives after the room has moved on, where you find it, and how it reaches the report.',
  sections: [
    {
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
      title: 'Late & not reviewed',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: 'The list is in the Rounds tab and, on two screens, in the console\'s left rail. The status line counts what is waiting ("1 late answer kept", "3 late items not reviewed"). Each item says who and when, for example "during Round 3 · Voting".',
        },
        {
          t: 'table',
          head: ['Button or label', 'What it means'],
          rows: [
            ['Show on the wall', 'Puts it up for the room. Offered only for the round the wall is showing; it then reads "Reviewed with the room".'],
            ['Mark reviewed', 'You have read it yourself; it reads "Reviewed by the host".'],
            ['Not reviewed', 'Nobody has looked at it yet.'],
            ['Close comments', 'After the session ends, stops new comments before the 24 hours are up.'],
          ],
        },
      ],
    },
    {
      title: 'In the report',
      icon: 'FileText',
      blocks: [
        {
          t: 'p',
          text: 'Each round in the report has an "Arrived late" part with the items and their labels. Settings › Report › "Include items not reviewed" is on by default; turn it off and the report leaves those out and says how many. Redoing Workie\'s read reads late answers in too, and says so.',
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
          t: 'note',
          tone: 'info',
          title: '"Workie used words the room\'s answers don\'t support"',
          text: 'After Workie writes, Engage checks the read against what it was given: a number no answer, question or count contains (a "15-minute hold" nobody proposed), a claim about the room the vote does not show ("strongest", "unanimous", "everyone agreed" when the points were split), and a next step written as already decided ("The route lead will run…") when the room only ranked answers. If it finds any, Workie rewrites the read once. If words are still left, you see one small line naming them: on the console beside the read on two screens, in the Session panel\'s Workie section beside Redo on one screen, and on the phone remote. Redo, or edit what you say aloud, before the read goes up. Only you see the line; the wall, the room\'s window and the players never do.',
        },
        {
          t: 'p',
          text: 'Ask the room turns a follow-up into a question for the room: Ideas, Choose or Rate. For Rate you name the scale\'s two ends: pick a pair in "1 means" or "5 means" (Disagree to Agree, No to Yes, Low to High, Unlikely to Likely, Hard to Easy), or Custom to type your own. The phones, the wall and the report all show them.',
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
        {
          t: 'p',
          text: 'Answers and comments that arrived late appear under "Arrived late" in each round, with their labels. See Late answers and comments.',
        },
        {
          t: 'p',
          text: 'Save report keeps it as a PDF: Keep for 90 days, or Keep for 1 year. A saved report outlives the session. Find it again under Reports on the welcome screen, with the link and passkey for anyone without an account.',
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
          text: 'A session is kept for 90 days from creation, or for 7 days once it has started, whichever comes first. If the results matter, save the report while the session still exists.',
        },
      ],
    },
  ],
};

/*
  THE OWNER'S RULE, 2026-09-23: "the session only counts if at least 2
  questions get answered by 1 or more people. otherwise we chalk it up to test,
  or something was not correct and they likely will restart."
  The server side is lambda-functions/websocket/session-count.js; Plan & usage
  links here (components/BillingPanel.jsx, data-testid="bill-session-rule").
*/
const plan = {
  id: 'host-plan',
  title: 'What counts toward your plan',
  icon: 'CreditCard',
  summary: 'When a session counts, what is always free, and why nothing is ever stopped mid-session.',
  sections: [
    {
      title: 'When a session counts',
      icon: 'CheckCircle',
      blocks: [
        {
          t: 'p',
          text: 'A session counts toward your plan once two of its questions have each been answered by at least one person. The moment it counts is the first answer to the second question anybody answers. After that it has counted, once — however many more questions you ask and however many people answer them.',
        },
        {
          t: 'list',
          items: [
            { title: 'Free', text: 'Creating a session, starting it, and people joining it.' },
            { title: 'Free', text: 'Showing questions nobody answers, and skipping them.' },
            { title: 'Free', text: 'A room answering just one question, however many people answer it.' },
            { title: 'Counts', text: 'The first answer to a second question. Skipped questions in between do not matter: skip 1 to 3, answer 4, skip 5, answer 6, and the session counts on 6.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Rehearse as much as you like',
          text: 'Scan the QR code, check your categories, run a question past a colleague. As long as you stop before a second question is answered, nothing is used.',
        },
      ],
    },
    {
      title: 'Where to see it',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'p',
          text: 'Plan & usage, in the console, shows this month\'s sessions run — the sessions that counted — against what your plan includes. The allowance starts again at the beginning of each month.',
        },
      ],
    },
    {
      title: 'Nothing is ever stopped mid-session',
      icon: 'ShieldCheck',
      blocks: [
        {
          t: 'p',
          text: 'A limit only ever stops you creating a new session. A session that is already running keeps taking answers, whatever the month\'s count says — nobody in the room is ever cut off.',
        },
      ],
    },
    {
      title: 'If nothing starts',
      icon: 'Warning',
      blocks: [
        {
          t: 'p',
          text: 'If the first round has nothing to ask — none of the categories you chose has a question in it — the session is not started and not ended. You will see "Nothing to ask yet". Choose categories with questions in them and press Start again. None of that counts.',
        },
      ],
    },
  ],
};

/*
  THE BUILD ROOM. Claims are taken from the code, not the plan:
  WelcomeScreen.jsx (the door and its one line), buildroom/words.js (needLine,
  installNote, shareWho, wrapUpSaved), buildroom/pluginTier.js (one plugin per
  tier) and buildroom/buildHostApi.js (the two commands the Connect window
  shows). Words the room sees on its own screens live in words.js, not here.
  17 Oct: what the share opens (build-lan.js lanScopes, the plugin's gateway,
  .engage/share.json, plugin 1.20.0), the room's window (BuildSessionPanel's
  Screens group, present/buildwall/), the still dock (buildControls.js), and
  History's marks (buildScreens.js contributionsOf, askOutcome).
  17 Oct: releasing Claude's posts (build-store.js reviewAgentPosts, the
  queue's BuildHeldPosts.jsx, BuildSessionPanel's Claude group, plugin 1.21.0).
  19 Oct: Consider and the sent marks (buildroom/BuildConsider.jsx, sentMarks.js,
  build-room.js considerItem, build-store.js inboxText adds the why).
  19 Oct: the console on two screens (BuildConsole.jsx, buildConsole.js,
  BuildConsoleAsk.jsx; buildControls' decideInline; build-store's answeredBy).
*/
const buildRoom = {
  id: 'host-build-room',
  title: 'Build Room',
  icon: 'Wrench',
  summary: 'Build something with your Claude Code while the room suggests and votes. You decide.',
  sections: [
    {
      title: 'What it is',
      icon: 'Wrench',
      blocks: [
        {
          t: 'p',
          text: 'Claude Code runs on your laptop and joins the room. People join with the four-digit code on laptops, tablets and phones. Claude asks the room for ideas, choices and ratings; the room answers; you decide what Claude builds next.',
        },
      ],
    },
    {
      title: 'Before you start',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'list',
          items: [
            'Claude Code, on the laptop you will host from.',
            'Node 18 or later, and git, on that laptop.',
            'The Engage plugin for Claude Code. Each site has its own: engage on engage.seibtribe.us, engage-test on the test site, engage-dev on the dev site.',
          ],
        },
      ],
    },
    {
      title: 'Connecting Claude',
      icon: 'Terminal',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Open Build Room', text: 'From the welcome screen. Name the build, and say who sets the goal: the room, or you.' },
            { title: 'Install the plugin', text: 'The Connect window shows one command. Run it in a terminal, once per laptop. Run it again when the room says the plugin is out of date.' },
            { title: 'Start Claude Code', text: 'Mint a key, and the start command is copied. Paste it into a terminal: it makes a new folder under ~/build-room, with git, starts Claude Code there and kicks off. Claude reads the room, says what it plans, and starts.' },
            { title: 'Coming back', text: 'Closed Claude Code, or restarted the laptop? Open Connect Claude Code: it shows one paste that opens Claude Code in the same folder and picks up where it left off, with no new key. Out of date, the same paste updates the plugin first. On another laptop, press Show all the steps.' },
          ],
        },
      ],
    },
    {
      title: 'During and after',
      icon: 'FlagCheckered',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Share demo', text: 'When Claude first shows the app, the Build Room asks once whether to share it. Share demo lets people on this Wi-Fi open this laptop\'s app on their phones, laptops and tablets; no one else can. Nothing is shared until you press it. Guest Wi-Fi often blocks this; test it from another device first. Anyone who cannot reach it still sees the screenshots. Only one Claude Code window shares a room at a time; if the count jumps, update the plugin from Connect.' },
            { title: 'What the share opens', text: 'Open the build and the QR go to the page Claude showed, not its folder. The room can open only the pages Claude linked and what those pages load; a folder\'s file list is never shown. The share panel names each server: Demo, Mockups, or App 1 and 2 when nothing says. To name them yourself, put a file .engage/share.json in the project folder with "demo", "mockups" and a "label"; it wins over Claude\'s guess. Each session takes its Wi-Fi ports from a block worked out from its code, and every page it serves names the session, so two rooms on one laptop are easy to tell apart. These need plugin 1.20.0: update it from Connect and restart Claude Code.' },
            { title: 'People who are not in the room', text: 'In the Share demo panel, Also open it to people who are not here lets everyone in the session open the demo from anywhere, on Zoom or another network, with the same Open the demo button. It is off until you turn it on. Each person\'s button carries their own key; the panel lists who opened it and on how many devices, and Remove ends one person\'s link. It goes through Cloudflare, who can see the demo, and closes when you turn it off or the session ends. The first time, the laptop downloads a small tool, and some company networks block it. Update the plugin from Connect first (Settings, then Claude, says which plugin is running).' },
            { title: 'The room\'s window', text: 'Room\'s window ↗ on the header or the console\'s top line (and PRESENT in the Stage\'s dock) opens Stage, Build or History in a window of its own for the projector, on the second display in Chrome; beside it, whether that window is open and full screen. Click the room\'s window once to fill the screen (or press F). It needs no sign-in and never shows a name. With no second display, Open as a tab opens it in a tab you can share on a call. The first time, the Host screen asks Where will the room watch? (Help me pick answers three questions); Two screens opens the window there and then. Session, Settings, Screens shows the choice and changes it, and has New link: use it if the link was shared by mistake, since it cuts off every window opened with the old one (press it twice).' },
            { title: 'Two screens: your laptop console', text: 'When you chose Two screens, or the room\'s window is open, the laptop is yours alone and shows the console, laid out as Call & Answer\'s. The top line has the session, Join (it puts the code on the wall), Share demo, Room\'s window ↗ and whether it is on, and The room sees: Stage, Build, History, which, like 2, 3, 4 and P, change only the room\'s window; See it here shows that screen on the laptop, and 1 comes back. Under it the strip shows where the ask is: Opening, then Ask, Collect, Settle, Send to Claude, then Wrap up; between asks it stays, dimmed, and says what is happening instead (Between asks, The run list · 2 of 4 done). Your part now, at the top of the middle, says what to do next and holds the main button: Space presses it, and a move made early asks you to press again. Between asks it says No main move now, and What\'s next below has the likely moves. On a result the decide panel is already open beside the board: change the words or pick another option there, and Send in Your part now sends it; the second button is Spin the wheel. On the left, four sections: Waiting for you (Claude\'s questions and the room\'s ideas, with every action; open it in the middle for more room), People (who has answered, by name, while the room answers or votes, never what they chose), Later with Points inside, and Session (Connect Claude, the plugin, the crew, Build and History to look at privately, the Session panel, wrap up, the report, end). On the right: Now, then Decided, Timeline, Asks, Screenshots and Room brief. ← All sessions leaves; the session keeps running. One screen is unchanged.' },
            { title: 'Showing the join code', text: 'Join at the top of the Host screen, the code on the Stage\'s left rail, or J puts the join QR in a panel beside what is on the Stage, on this screen and on the room\'s window, without covering it. While the demo is shared on the Wi-Fi its code sits under the join code. Press again, or Esc, to take them down. Click a code in the panel to enlarge it on your own screen and copy the link.' },
            { title: 'The Stage\'s buttons', text: 'The buttons along the bottom stay where they are. Space presses the main one; a move made early, such as Show results while people are still answering, asks you to press again. Host takes you back to the Host screen in one press; its number says how many things wait for you.' },
            { title: 'Consider', text: 'Consider sits on every idea in an open Ideas ask as it arrives, on the reasons people give with a pick or a rating, on every option once a vote has closed, and on each idea in Waiting for you. It opens one panel with two doors, and the ask carries on as normal. Queue for the room keeps the room\'s words and waits in Waiting for you: as a yes or no question, as a feedback question, or marked Queued for the room until you put it to a vote with others. Send to Claude starts from the room\'s words; change them if you like, and say why in the Why line. Claude reads the why with the direction, and History keeps it for the room to see. Send to Claude now, or Later to keep it on your Later list. Esc closes the panel and keeps what you typed. Sending a decided ask has the same Why line, in Direction for Claude on the Host screen and in Change before sending on the Stage.' },
            { title: 'Sent to Claude marks', text: 'Anything that reached Claude says so where you see it: in the ideas, in Waiting for you, on a vote\'s options, in Asks and in Decided. The mark reads Sent to Claude, Sent to Claude, reworded, or Sent to Claude, for later; Queued for the room means it waits to be put to the room. Click a mark to open History at that entry, highlighted: in the side column on the Host screen, or on the History screen.' },
            { title: 'History', text: 'History shows every idea from the room that was used, and every ask the room saw. Each says what happened: chosen by the room or not, sent to Claude as written, reworded by the host, kept for later, or not sent. When you changed the room\'s words, the entry shows them struck through, then what Claude got, then your why, with how many people liked it. It never shows who sent an idea; a phone marks its own ideas as yours. Made so far counts the ideas used by the same rule.' },
            { title: 'Releasing Claude\'s posts', text: 'Claude\'s updates, answers and screenshots wait in Waiting for you before the room sees them: Release to the room puts one on the phones and the room\'s screens at the time it happened, Keep to myself keeps it off them for good, and Release all lets several through at once. Your Timeline marks what the room has not been shown. Claude\'s mockups appear when their ask opens, and its live "Claude is" line always shows. To let posts straight through, turn off Check Claude\'s posts before the room sees them in Session, Settings, Claude. Claude learns of this with plugin 1.21.0.' },
            { title: 'Wrap up', text: 'A summary, what was built, links and next steps, written by Claude or by you, saved into the report. Check the report, then end the session.' },
            { title: 'Save report', text: 'Keeps the report as a PDF, as for any session. The code stays in the project folder on your laptop.' },
          ],
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
  guides: [quickStart, gameSetup, running, lateItems, playerManagement, reporting, buildRoom, plan],
};
