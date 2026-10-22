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

const running = {
  id: 'host-running-engagements',
  title: 'Running the room',
  icon: 'Broadcast',
  summary: 'The session panel, choosing what to ask next, and going back over a round.',
  sections: [
    {
      id: 'session-panel',
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
      id: 'choosing-ask-next',
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
      id: 'going-back-over-round',
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
      id: 'in-report',
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
      id: 'players-tab',
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
      id: 'handing-name-over',
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
 * Running the room: the stage, the Session panel, late items, players.
 */
export const AREA = {
  id: 'host-running',
  guides: { host: [running, lateItems, playerManagement] },
};
