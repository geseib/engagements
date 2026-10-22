/**
 * THE TWO TECHNICAL GUIDES, which the old footer linked to from every screen
 * and which had never been written — so the two most prominent links in the
 * help modal both landed on "currently under development".
 *
 * Troubleshooting is ordered by who is asking, not by subsystem. Somebody
 * opening this in the middle of a session does not know whether their problem
 * is a WebSocket or a question set; they know whose screen is wrong.
 */

const troubleshooting = {
  id: 'technical-troubleshooting',
  title: 'Troubleshooting',
  icon: 'Wrench',
  summary: 'What is actually wrong, arranged by whose screen is showing it.',
  sections: [
    {
      id: 'players-cannot-get-in',
      title: 'Players cannot get in',
      icon: 'Lock',
      blocks: [
        {
          t: 'table',
          head: ['What they see', 'What it means'],
          /*
            Wording from lambda-functions/game/session-gate.js (403 not started,
            404 "Game not found") and JoinCodeEntry.jsx:63 (/join). The gate
            never refuses an ended session, so there is no "ended" message: the
            player gets in and sees the closing screen.
          */
          rows: [
            ['"This game has not been started yet"', 'It was created but not started. Created sessions are not joinable. Press **Start**, then they press **Join Game** again.'],
            ['"Game not found", or "Nothing is running under…"', 'Wrong four digits — a 0 read as an 8 across a room is the usual cause. Check against the room\'s screen.'],
            ['"That name is taken"', 'Another device holds that name. Either pick a different one or ask the host to hand it over.'],
            ['The QR does nothing', 'Some camera apps will not open a link from a QR without a tap. Read out the four-digit code instead.'],
          ],
        },
      ],
    },
    {
      id: 'screens-not-keeping-up',
      title: 'Screens are not keeping up',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'p',
          text: 'Screens follow the host over a live connection. When that connection cannot be made, updates arrive late or not at all — the symptom is a player screen still showing the previous round.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Check the connection badge', text: 'The session panel header says Connected or Connecting…. Stuck on Connecting is the tell.' },
            { title: 'Reload the affected screen', text: 'A player reloads, taps **Rejoin as** their name, and nothing is lost.' },
            { title: 'Try another network', text: 'Some guest wifi blocks live connections. A player who stays stuck can switch to mobile data. The polling switch in the admin console\'s Settings only changes the browser it is set in, so it will not fix a room.' },
          ],
        },
      ],
    },
    {
      id: 'ai-not-useful',
      title: 'The AI did not say anything useful',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'table',
          head: ['Symptom', 'Where to look'],
          rows: [
            ['No summary at all', 'The set has no analysis prompt linked, or the linked prompt is not Active.'],
            ['It promised a reveal and never revealed', 'The question\'s answer-details field is empty. The AI never had the detail to reveal.'],
            ['Every set comes out the same wrong way', 'The generation prompt, not the request. Fix it once in Prompts.'],
            ['Something inexplicable', 'Turn on Show AI Prompts in Debug Mode and read the prompt that was actually sent, placeholders and all.'],
          ],
        },
      ],
    },
    {
      id: 'signing-in',
      title: 'Signing in',
      icon: 'UserCircle',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Signed in but cannot create anything', text: 'The account is in the pending group. An admin has to move it to hosts.' },
            { title: 'Password reset never arrives', text: 'An account that signs in with Google has no password to reset. Use the Google button. Same for an account created by an admin that has never exchanged its temporary password.' },
            { title: 'A console section is missing', text: 'The console shows what your role in the team allows. Plan & usage and Data & privacy are for team owners and admins; the Engage sections need the admins group and the switcher on Engage.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Players never sign in',
          text: 'If a player is being asked to sign in, they have followed a host link rather than a join link. The join link is the one under "Players join at".',
        },
      ],
    },
    {
      id: 'data-vanished',
      title: 'Data that has vanished',
      icon: 'CalendarBlank',
      blocks: [
        {
          t: 'note',
          tone: 'warn',
          title: 'Sessions expire on a timer',
          text: '90 days from creation, or 7 days once it has started — whichever comes first. A session that has gone is gone. Save its report while it still exists: a saved report is kept 90 days or a year, under Reports.',
        },
      ],
    },
  ],
};

const requirements = {
  id: 'technical-requirements',
  title: 'What you need to run it',
  icon: 'ClipboardText',
  summary: 'Devices, browsers, network, and the room itself.',
  sections: [
    {
      id: 'players',
      title: 'Players',
      icon: 'DeviceMobile',
      blocks: [
        {
          t: 'list',
          items: [
            'Any phone, tablet or laptop with a current browser.',
            'A network — anything that loads a web page.',
            'A camera, if they want to scan the QR rather than type four digits.',
            'No account, no install, no app.',
          ],
        },
      ],
    },
    {
      id: 'hosts',
      title: 'Hosts',
      icon: 'Monitor',
      blocks: [
        {
          t: 'list',
          items: [
            'A laptop signed in as a host, connected to the screen the room watches.',
            'Optionally a phone as the remote — scan the QR under "Your phone as a remote" in the Settings tab.',
            'A screen the back of the room can read. Set **Room screen size** under Screens in the Settings tab to match it before people arrive.',
          ],
        },
      ],
    },
    {
      id: 'network',
      title: 'The network',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'p',
          text: 'Live updates use a WebSocket. Most networks allow it; some corporate guest networks do not. No setting fixes this for a whole room; a phone that stays stuck can switch to mobile data.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Test the room, not the platform',
          text: 'If the venue is new, join from your own phone on the guest wifi before the room fills up. That is the thing that fails, and it fails in a way you can fix in two minutes if you find out early.',
        },
      ],
    },
    {
      id: 'video-call',
      title: 'Running it on a video call',
      icon: 'Airplane',
      blocks: [
        {
          t: 'list',
          items: [
            'Set **Room screen size** to "Call — screen share" (Settings tab, under Screens).',
            'On two screens, choose **Open as a tab** to open the room\'s window in a tab, and share that tab. On one screen, share the browser window showing the stage.',
            'Put the join URL in the chat as well as the QR — nobody can scan a QR that is inside their own screen share.',
            'People still join on their own devices, exactly as they would in a room.',
          ],
        },
      ],
    },
  ],
};

/**
 * The technical area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'technical',
  guides: { technical: [troubleshooting, requirements] },
};
