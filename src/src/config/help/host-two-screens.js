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
  these two sections moved here verbatim so the two-screen and phone-remote
  workstream edits its own file. HELP_SECTION_MOVES in ./index.js keeps the old
  guide#section addresses resolving.
*/
const twoScreens = {
  id: 'host-two-screens',
  title: 'Two screens and your phone',
  icon: 'Monitor',
  summary: 'The room\'s window, your laptop console, and running the session from your phone.',
  sections: [
    {
      id: 'laptop-console',
      title: 'Two screens: your laptop console',
      icon: 'Monitor',
      blocks: [
        {
          t: 'p',
          text: 'Two screens is for Call & Answer, outside events. When the room watches a separate window (Room\'s window ↗, dragged onto the projector), your laptop stops showing a copy of the wall. It shows your console: what you need for the step, and nothing the room needs.',
        },
        {
          t: 'table',
          head: ['Part', 'What it is for'],
          rows: [
            ['Top line', '← All sessions (in the lobby and at the end: back to the start screen; this one keeps running and Continue brings you back), the join code (press it to put the code on the wall), Room\'s window ↗, and whether that window is really up.'],
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
            { title: 'Open, not full screen', text: 'Click the room\'s window once to fill the screen (or press F). The laptop says so under the status.' },
            { title: 'Hidden', text: 'The window is minimised or behind another tab.' },
            { title: 'Not open', text: 'Press it to open one.' },
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
          text: 'With the projector or TV connected as a second display (extended, not mirrored), Room\'s window ↗ opens the window on that display and fills it. The first time, the browser asks to "manage windows on all your displays": allow it. Then click the room\'s window once and it goes full screen. With a Call & Answer set on it, Quick start shows where the room watches before you pick one, and on two screens it opens the room\'s window as the session starts. In other browsers, or if you say no, it opens beside you: drag it onto the projector and press F.',
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
      id: 'phone-remote',
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
            { title: 'The round view', text: 'Advance the beat, see how many have answered, and choose the next question.' },
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
          text: 'The phone has no Settings tab, deliberately: **Join code**, **Categories** and **Back to Menu** are on its Session card, one tap away.',
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
