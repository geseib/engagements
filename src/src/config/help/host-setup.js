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

const quickStart = {
  id: 'host-quick-start',
  title: 'Quick start',
  icon: 'RocketLaunch',
  summary: 'From nothing to a room full of people playing, in about five minutes.',
  sections: [
    {
      id: 'the-shape',
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
      id: 'step-1-create',
      title: 'Step 1 — Create',
      icon: 'Plus',
      blocks: [
        {
          t: 'steps',
          items: [
            'Choose **Create engagement** on the welcome screen.',
            'Give it an event title — this is what the room sees on the big screen.',
            'Pick a **Format**, and a **Question set** of that format.',
            'Narrow it by category if you want a subset of the questions.',
          ],
        },
        { t: 'h', text: 'The kinds you can run' },
        { t: 'gameTypes' },
        {
          t: 'note',
          tone: 'info',
          title: 'A set belongs to one kind',
          text: 'The set list filters to the format you picked, so you cannot accidentally run a trivia set as a poll. If the list looks empty, the format is probably not the one you meant.',
        },
      ],
    },
    {
      id: 'step-2-start',
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
      id: 'step-3-run-rounds',
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
      id: 'step-4-results',
      title: 'Step 4 — Results',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'What the room backed', text: 'The ideas first, ranked by the room\'s votes: each idea in full as the headline, a bar for how much the room backed it compared with the top idea, and, while names show, a small credit line with the points and the name. Long ideas shrink to fit; if they still do not fit, the room sees the top ones and "and N more answers".' },
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
      id: 'common-questions',
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
      id: 'choosing-question-set',
      title: 'Choosing a question set',
      icon: 'Books',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'House sets', text: 'Provided for everyone. You cannot edit them, but you can take your own copy and edit that.' },
            { title: 'Your own sets', text: 'Ones you created or copied. Editing one of these creates a new version rather than overwriting what you have already played.' },
          ],
        },
        {
          t: 'p',
          text: 'On a set you own, **Edit questions** changes its questions and **Rename** its name; an AI draft not yet reviewed shows **Review** instead. A house set offers **Copy and edit**, and the original stays untouched. None of these ever changes a set out from under a session that is running.',
        },
        {
          t: 'p',
          text: 'A set you generate with AI — or questions you add to one — waits as a draft until you review and accept it. The set list shows drafts waiting at the top, the bell says when one is ready, and nothing is saved until you accept. The bell is on your start screen, in the two-screen console\'s top line and on your phone remote too, never on a screen the room sees; from a session it opens what it points to in a new tab, so the session stays where it is.',
        },
      ],
    },
    {
      id: 'quick-start',
      title: 'Quick start',
      icon: 'Lightning',
      blocks: [
        {
          t: 'p',
          text: 'The welcome screen\'s Quick start menu is a shortlist of sets you can launch in one tap, for when somebody says "have we got ten minutes of something".',
        },
        {
          t: 'p',
          text: 'You control what is on it. In your set list, click a set\'s **Quickstart** tag to put it on the menu or take it off — the tag\'s tooltip reads "Click to offer this set on the quickstart menu". No dialog, no save button; the click is the change.',
        },
      ],
    },
    {
      id: 'categories',
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
      id: 'settings-before-you-start',
      title: 'Settings worth a look before you start',
      icon: 'Monitor',
      blocks: [
        { t: 'h', text: 'Screens: where the room watches, and room screen size' },
        {
          t: 'p',
          text: 'The Screens group, first in Settings (and, on two screens, at the top of Setup on the step strip), says whether the room watches this laptop (one screen) or a separate window (two screens), opens the room\'s window, and sets the room screen size. Two screens is for Call & Answer only, outside events. You can switch between one and two screens mid-session there. Get the size right before people arrive — it is the difference between a readable session and a squinting one.',
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
          text: 'In Call & Answer, the size also decides how much the room is shown. On every size the room sees only what it needs, large. When a question or lesson is up, the title and the lesson lead, and the question to answer sits in a "Your turn" band; the general instruction ("answer on your phone") is left off, because the top line already says where to answer. While voting the room sees every answer, numbered, or one at a time when they are long; at results the room\'s pick reads in full with the bars behind the answers, and no vote counts while names are hidden. Call, read on people\'s own screens, adds the general instruction. In a Build Room each option shows its detail, the tally stays hidden until the vote closes, a long ask pages, and Claude\'s status line is always there. Show the QR puts the join code in a panel beside what is up, instead of covering it; click an answer, or step with → and ←, to put one up, and Esc goes back to all of them.',
        },
        { t: 'h', text: 'Names' },
        {
          t: 'list',
          items: [
            { title: 'Show who wrote each response from the start', text: 'Off by default on voted rounds — answers stay anonymous until voting closes, so people vote on the answer and not the author.' },
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

/**
 * The host-setup area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 * Creating a session, Quick start, question sets from the host side.
 */
export const AREA = {
  id: 'host-setup',
  guides: { host: [quickStart, gameSetup] },
};
