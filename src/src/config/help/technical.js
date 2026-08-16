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
      title: 'Players cannot get in',
      icon: 'Lock',
      blocks: [
        {
          t: 'table',
          head: ['What they see', 'What it means'],
          rows: [
            ['"This session has not started yet"', 'It was created but not started. Created sessions are not joinable. Press Start.'],
            ['"We do not recognise that code"', 'Wrong four digits — a 0 read as an 8 across a room is the usual cause. Check against the host screen.'],
            ['"That name is taken"', 'Another device holds that name. Either pick a different one or ask the host to hand it over.'],
            ['"This session has ended"', 'It is over. Nothing left to join.'],
            ['The QR does nothing', 'Some camera apps will not open a link from a QR without a tap. Read out the four-digit code instead.'],
          ],
        },
      ],
    },
    {
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
            { title: 'Reload the affected screen', text: 'A player reloads and rejoins with the same name; nothing is lost.' },
            { title: 'Fall back to polling', text: 'On a network that blocks WebSockets, the admin Settings section has a switch to poll over HTTP instead. Slower, but it works through most guest wifi.' },
          ],
        },
      ],
    },
    {
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
      title: 'Signing in',
      icon: 'UserCircle',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Signed in but cannot create anything', text: 'The account is in the pending group. An admin has to move it to hosts.' },
            { title: 'Password reset never arrives', text: 'An account that signs in with Google has no password to reset. Use the Google button. Same for an account created by an admin that has never exchanged its temporary password.' },
            { title: 'Access denied on the admin console', text: 'The console requires the admins group. Hosts do not get it.' },
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
      title: 'Data that has vanished',
      icon: 'CalendarBlank',
      blocks: [
        {
          t: 'note',
          tone: 'warn',
          title: 'Sessions expire on a timer',
          text: '90 days from creation, or 7 days after last play — whichever comes first. A session that has gone is gone. Generate the report while the session still exists.',
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
      title: 'Hosts',
      icon: 'Monitor',
      blocks: [
        {
          t: 'list',
          items: [
            'A laptop driving the big screen, signed in as a host.',
            'Optionally a phone as the remote — scan the "Controls on your phone" QR from the Settings tab.',
            'A screen the back of the room can read. Set the display profile to match it before people arrive.',
          ],
        },
      ],
    },
    {
      title: 'The network',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'p',
          text: 'Live updates use a WebSocket. Most networks allow it; some corporate guest networks do not, and the fallback to HTTP polling is a switch in the admin Settings section.',
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
      title: 'Running it on a video call',
      icon: 'Airplane',
      blocks: [
        {
          t: 'list',
          items: [
            'Set the display profile to "Call — screen share".',
            'Share the browser window showing the session.',
            'Put the join URL in the chat as well as the QR — nobody can scan a QR that is inside their own screen share.',
            'People still join on their own devices, exactly as they would in a room.',
          ],
        },
      ],
    },
  ],
};

export const TECHNICAL_ROLE = {
  id: 'technical',
  title: 'Technical',
  icon: 'Wrench',
  blurb: 'When something is not working.',
  guides: [troubleshooting, requirements],
};
