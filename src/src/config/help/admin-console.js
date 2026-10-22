/**
 * THE ADMIN GUIDES. One of the six existed; the button that was supposed to
 * open it did not work.
 *
 * `AdminPage` mounts `<HelpButton section="ai-prompts">` beside the prompt
 * library, and the help system knew that id neither as a role nor as a guide —
 * so the most contextual help button in the product opened a box saying the
 * documentation was "currently under development", while `AdminAIPromptsDoc`
 * sat two files away, written and shipped. `HELP_ALIASES` in ./index.js is that
 * fix.
 */

const gettingStarted = {
  id: 'admin-getting-started',
  title: 'Getting started',
  icon: 'Gear',
  summary: 'The console\'s sections, who sees which, and what each of them owns.',
  sections: [
    {
      id: 'console-sections',
      title: 'What the console is for',
      icon: 'Buildings',
      blocks: [
        {
          t: 'p',
          text: 'The console shows what your role allows in the team or space you are working in. Engage staff switch to Engage, at the top of the console, for the Engage sections; the two are never on screen together.',
        },
        {
          t: 'table',
          head: ['Section', 'Who sees it', 'What lives there'],
          rows: [
            ['Overview, Question sets, Sessions, Public library', 'Everyone in a team or space', 'What is waiting on you, the sets, what was run, and sets other organisations have published.'],
            ['Events', 'Everyone in a team or space, where events are turned on', 'One join code for a whole agenda of sessions and breaks.'],
            ['Members', 'Teams', 'Who can build and run sessions here.'],
            ['Activity', 'Team owners and admins', 'What the team ran, by month.'],
            ['Prompts', 'Team owners and admins, and your own space, read-only', 'What the AI is told. Only Engage staff change prompts.'],
            ['Plan & usage, Data & privacy', 'Team owners and admins, and your own space', 'What this month costs; who has opened what, and how to take everything with you.'],
            ['Overview, Organisations, Observability, Plan requests, Discount codes, Shared library, Prompts, Public library, Moderation, Accounts, Archive, Engage settings', 'Engage staff, switched to Engage', 'Running the platform. A team\'s content is not reachable from here.'],
            ['Settings', 'Everyone, at the foot of the menu', 'Three switches, stored in this browser only.'],
          ],
        },
      ],
    },
    {
      id: 'first-thing',
      title: 'The first thing to do',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'p',
          text: 'Registration puts new people in the pending group and leaves them there — a host who has signed up and cannot create anything is almost always someone nobody moved into hosts. Team owners and admins approve someone they invited with **Approve hosting** in Members. Engage staff approve everyone else in Accounts.',
        },
        {
          t: 'table',
          head: ['Group', 'Can'],
          rows: [
            ['admins', 'Engage staff: the Engage sections of this console.'],
            ['hosts', 'Create and run sessions, and manage their own question sets.'],
            ['pending', 'Sign in and nothing else. Waiting for approval.'],
            ['Disabled (not a group)', 'Nothing: they cannot sign in. Reject and Disable in Accounts put people here, and the account is kept.'],
          ],
        },
      ],
    },
    {
      id: 'sessions-expire',
      title: 'Sessions expire',
      icon: 'CalendarBlank',
      blocks: [
        {
          t: 'note',
          tone: 'warn',
          title: '90 days, or 7 once started',
          text: 'Session data is kept 90 days from creation, or 7 days once the session has started, whichever comes first. The Sessions list is not an archive. Save the report while the session still exists; a saved report is kept 90 days or a year.',
        },
      ],
    },
  ],
};

const questionSets = {
  id: 'admin-question-sets',
  title: 'Question sets',
  icon: 'Books',
  summary: 'Creating, versioning, importing, and what quickstart does.',
  sections: [
    {
      id: 'what-a-set-is',
      title: 'What a set is',
      icon: 'Books',
      blocks: [
        {
          t: 'p',
          text: 'A named collection of questions of one kind, tagged by category. A session plays one set. Everything a host can choose at setup comes from here.',
        },
        { t: 'gameTypes' },
        {
          t: 'note',
          tone: 'info',
          title: 'Running a survey',
          text: 'A survey session collects answers at each person’s own pace: the host opens it, people answer on their phones, and the host closes it when the room is done. Names is chosen when the session is created — Anonymous, Who finished or Named — and cannot change once the survey opens, because it decides what is recorded, not just what is shown.',
        },
      ],
    },
    {
      id: 'versions-not-overwrites',
      title: 'Versions, not overwrites',
      icon: 'FloppyDisk',
      blocks: [
        {
          t: 'p',
          text: 'Saving the questions creates a new version rather than changing the one already in use. A session that is running is never altered underneath the host running it, and a set that produced last quarter\'s results still produced them. The set\'s **Details** are different: they are saved in place, for anyone hosting from it.',
        },
        {
          t: 'p',
          text: 'On a set you manage, the list offers **Edit**, and the Questions panel saves as the next version ("Save as version 4"). On a set that belongs to someone else it offers **Open** and **Copy**; saving it says **Save as my own copy…** and leaves the original alone.',
        },
      ],
    },
    {
      id: 'quickstart',
      title: 'Quickstart',
      icon: 'Lightning',
      blocks: [
        {
          t: 'p',
          text: 'Marking a set for quickstart puts it on the host welcome screen\'s Quick start menu — the one-tap list for when someone needs ten minutes of something now.',
        },
        {
          t: 'p',
          text: 'Click the set\'s quickstart tag in the list to toggle it. The click is the change; there is no dialog and no save. Hosts can do the same on their own set list.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Keep it short',
          text: 'A quickstart menu with thirty entries is a set list with extra steps. The value is that it fits on one screen.',
        },
      ],
    },
    {
      id: 'pictures-in-questions',
      title: 'Pictures in questions',
      icon: 'Image',
      blocks: [
        {
          t: 'p',
          text: 'A question can carry a picture — the Picture field on the question editor. Art rounds are the obvious case: the image is the question, and the text asks what people make of it.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Pair a picture with a reveal',
          text: 'A picture round is much better when the set also fills in the withheld detail — the real title, the artist, the year — so the AI can reveal it after everyone has committed to an answer. See the Builder guides.',
        },
      ],
    },
    {
      id: 'moving-between-environments',
      title: 'Moving sets between environments',
      icon: 'Package',
      blocks: [
        {
          t: 'p',
          text: 'Engage staff only. The Archive section is shared: dev, test and prod all read and write the same store. That is how one of Engage\'s sets built on dev reaches prod — export it to the archive from one, import it on the other. A team\'s or a personal space\'s sets do not go through the archive.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'A set carries its prompt by name',
          text: 'Prompt ids are per-environment, so the link between a set and its generation prompt is carried across by prompt NAME. Import the prompt before the set, or the set arrives with nothing linked.',
        },
      ],
    },
  ],
};

const gameManagement = {
  id: 'admin-game-management',
  title: 'Sessions',
  icon: 'GameController',
  summary: 'What hosts have run, and what you can tell from it.',
  sections: [
    {
      id: 'sessions-list',
      title: 'The Sessions list',
      icon: 'GameController',
      blocks: [
        {
          t: 'p',
          text: 'Every session run in the team or space you are working in: who ran it, what set it used, when, and how far it got. Useful for "did that offsite actually happen" and for finding a report someone has lost.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'It is not a backup',
          text: 'Rows disappear on expiry — 90 days from creation, or 7 days once the session has started. Anything that matters gets its report saved; saved reports are listed under Reports on the host welcome screen.',
        },
      ],
    },
    {
      id: 'when-it-went-wrong',
      title: 'When a host says it went wrong',
      icon: 'Wrench',
      blocks: [
        {
          t: 'list',
          items: [
            { title: '"Players could not join"', text: 'Check the session was started, not merely created. Created sessions are not joinable and the QR is not up yet.' },
            { title: '"Nothing updated on screen"', text: 'Real-time updates ride a WebSocket. On a restrictive network it falls back to polling — Settings has the switch.' },
            { title: '"The AI said nothing"', text: 'Check the set has an analysis prompt linked, and that the prompt is Active.' },
            { title: '"The reveal never happened"', text: 'The question\'s withheld-detail field is empty. That is the set, not the session.' },
          ],
        },
      ],
    },
  ],
};

const settings = {
  id: 'admin-settings',
  title: 'Settings',
  icon: 'Gear',
  summary: 'Three switches, and the important thing about all three.',
  sections: [
    {
      id: 'browser-only',
      title: 'They are stored in this browser only',
      icon: 'Warning',
      blocks: [
        {
          t: 'note',
          tone: 'warn',
          title: 'Nobody else gets your settings',
          text: 'These are local to the browser you set them in. Turning polling on here does not turn it on for a host on another machine, and clearing site data resets them. They are for diagnosing, not for configuring the platform.',
        },
      ],
    },
    {
      id: 'real-time-communication',
      title: 'Real-time communication',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'p',
          text: 'WebSocket is the default: the server pushes changes and screens follow the host without refreshing. Turn it off and the app polls over HTTP instead — slower and chattier, but it survives networks that block WebSockets. Corporate guest wifi is the usual reason to reach for it.',
        },
      ],
    },
    {
      id: 'debug-settings',
      title: 'Debug settings',
      icon: 'Bug',
      blocks: [
        {
          t: 'p',
          text: '"Show AI Prompts in Debug Mode" prints the prompt actually sent to the model above the AI output, in both the results page and the AI-ify dialog — with every placeholder already substituted. When the AI says something inexplicable, this is where the explanation is.',
        },
      ],
    },
  ],
};

/**
 * The admin-console area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 * Your space and teams: getting started, question sets, sessions, settings.
 */
export const AREA = {
  id: 'admin-console',
  guides: { admin: [gettingStarted, questionSets, gameManagement, settings] },
};
