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
  summary: 'The console, its six sections, and what each of them owns.',
  sections: [
    {
      title: 'What the console is for',
      icon: 'Buildings',
      blocks: [
        {
          t: 'p',
          text: 'Hosts run sessions. Admins look after the things sessions are made of — the question sets, the prompts the AI uses, the people allowed to host, and the shared archive.',
        },
        {
          t: 'table',
          head: ['Section', 'What lives there'],
          rows: [
            ['Question sets', 'Every set on this environment. Create, edit, import, delete.'],
            ['Sessions', 'What hosts have actually run.'],
            ['Prompts', 'Generation prompts build questions; analysis prompts are what the AI says afterwards.'],
            ['Archive', 'A shared store that all three environments read and write.'],
            ['Users', 'Registration lands people in pending. Somebody has to move them.'],
            ['Settings', 'Three switches, stored in this browser only.'],
          ],
        },
      ],
    },
    {
      title: 'The first thing to do',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'p',
          text: 'Check Users. Registration puts new people in the pending group and leaves them there — a host who has signed up and cannot create anything is almost always someone nobody moved into hosts.',
        },
        {
          t: 'table',
          head: ['Group', 'Can'],
          rows: [
            ['admins', 'Everything, including this console.'],
            ['hosts', 'Create and run sessions, and manage their own question sets.'],
            ['pending', 'Sign in and nothing else. Waiting for an admin.'],
          ],
        },
      ],
    },
    {
      title: 'Sessions expire',
      icon: 'CalendarBlank',
      blocks: [
        {
          t: 'note',
          tone: 'warn',
          title: '90 days, or 7 after last play',
          text: 'Session data is kept 90 days from creation and 7 days after it was last played, whichever comes first. The Sessions list is not an archive — anything worth keeping needs its report generated while the session still exists.',
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
          title: 'Survey sets are marked "Not playable"',
          text: 'The importer rejects survey uploads and no session runs a survey, so a survey set can be authored but never played. The console shows them rather than hiding them — hiding one would make it unreachable in the only place that can delete it.',
        },
      ],
    },
    {
      title: 'Versions, not overwrites',
      icon: 'FloppyDisk',
      blocks: [
        {
          t: 'p',
          text: 'Editing a set creates a new version rather than changing the one already in use. A session that is running is never altered underneath the host running it, and a set that produced last quarter\'s results still produced them.',
        },
        {
          t: 'p',
          text: 'For hosts the same rule shows up as two different buttons: "New version" on a set they own, "Fork" on a house set. Both give them something they can edit without touching what everyone else is playing.',
        },
      ],
    },
    {
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
      title: 'Moving sets between environments',
      icon: 'Package',
      blocks: [
        {
          t: 'p',
          text: 'The archive is shared: dev, test and prod all read and write the same store. That is how a set built on dev reaches prod — export it to the archive from one, import it on the other.',
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

const prompts = {
  id: 'admin-ai-prompts',
  title: 'Prompts',
  icon: 'Sparkle',
  summary: 'The two kinds of prompt, their statuses, and the difference between Retire and Copy to archive.',
  sections: [
    {
      title: 'Two kinds, one library',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Generation prompts', text: 'Used by the AI builders to write questions. They shape what a generated set looks like.' },
            { title: 'Analysis prompts', text: 'Used during a session to summarise what the room said. They shape what the AI reads out after a round.' },
          ],
        },
        {
          t: 'p',
          text: 'Both live in the same library and are filtered by type, kind of session, category and status.',
        },
      ],
    },
    {
      title: 'Statuses',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'table',
          head: ['Status', 'Means'],
          rows: [
            ['Active', 'In use, and offered wherever a prompt of its type is chosen.'],
            ['Draft', 'Being worked on. Not offered.'],
            ['Archived', 'Retired. Out of the list and out of the way.'],
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Some older rows say "inactive"',
          text: 'They are shown as Draft, because that is what they behave as — not retired, just not finished. There is nothing to migrate.',
        },
      ],
    },
    {
      /*
        THE TWO BUTTONS PEOPLE CONFLATE, and the reason this section exists: the
        owner asked for a copy-to-archive that does NOT remove the prompt from
        the list, precisely because the previous single button did both and the
        word "Archive" was doing double duty.
      */
      title: 'Retire and Copy to archive are different things',
      icon: 'Package',
      blocks: [
        {
          t: 'table',
          head: ['Action', 'What it does', 'What it does not do'],
          rows: [
            [
              'Copy to archive',
              'Puts a copy of the prompt in the shared archive so another environment can import it.',
              'Does not remove it, change its status, or stop it being used. Your list is unchanged.',
            ],
            [
              'Retire',
              'Stops the prompt being offered and takes it out of this list.',
              'Does not put anything in the archive. Copy it first if you want it to survive.',
            ],
          ],
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'Retiring a default does not stop it running',
          text: 'The lookup that picks a default prompt does not read status, so a retired default is still the default. Point the default at something else first, then retire.',
        },
      ],
    },
    {
      title: 'What an analysis prompt must produce',
      icon: 'FileText',
      blocks: [
        {
          t: 'p',
          text: 'The results screen expects three sections, under exactly these headings. Get them wrong and the output renders as one undifferentiated block of markdown.',
        },
        {
          t: 'code',
          text: `## Summary
What the room said, and what it adds up to.

## Discussion Questions
1. First question worth asking out loud
2. Second
3. Third

## Next Steps
1. Something to do this week
2. Something to do this month
3. Something longer term`,
        },
      ],
    },
    {
      title: 'Placeholders',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'p',
          text: 'A prompt body carries placeholders that are substituted with real session data at the moment it runs. They are written in curly braces — {question}, not [question] and not (question).',
        },
        { t: 'h', text: 'The ones most prompts want' },
        {
          t: 'variables',
          names: [
            'question', 'questionInfo', 'playerResponses', 'totalParticipants',
            'playerRankings', 'roundScores', 'cumulativeScores', 'eventTitle',
          ],
        },
        { t: 'h', text: 'Trivia and rounds with a reveal' },
        {
          t: 'variables',
          names: ['correctAnswer', 'correctCount', 'answerDetails', 'reveal', 'difficulty'],
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'Use the editor\'s list, not a remembered name',
          text: 'A placeholder nothing recognises is not an error — it is passed straight through, so the room sees a literal {totalScores} in the AI\'s summary. The editor lists every placeholder valid for the kind of session the prompt is for, with an example of what it substitutes to. That list is the spec.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Turn on debug to see what was actually sent',
          text: 'Settings → Show AI Prompts in Debug Mode prints the fully substituted prompt above the AI output, in the results page and the AI-ify dialog. It is the fastest way to find out why the AI said something odd.',
        },
      ],
    },
    {
      title: 'Managing them',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Default', text: 'Each kind of session has a default prompt — the one used when nothing more specific is linked.' },
            { title: 'Active or draft', text: 'Only active prompts are offered where a prompt is chosen. Draft keeps a prompt without putting it in front of anyone.' },
            { title: 'Editing', text: 'Prompts can be edited at any time. The change applies to the next round that runs, not to summaries already generated.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'One prompt per context, not per type',
          text: 'A team retrospective and a training session can both be Call & Answer and want completely different analysis. Separate prompts cost nothing.',
        },
      ],
    },
    {
      title: 'When the output is wrong',
      icon: 'Wrench',
      blocks: [
        {
          t: 'faq',
          items: [
            { q: 'The formatting comes out strange', a: 'The three headings are not exactly "## Summary", "## Discussion Questions" and "## Next Steps".' },
            { q: 'A placeholder appeared as literal text', a: 'That name is not in the catalogue. Check it against the editor\'s list — several plausible-sounding names do not exist.' },
            { q: 'The analysis is generic', a: 'The prompt is not saying who the room is or what the session is for. Generic instructions produce generic output.' },
            { q: 'The prompt is not offered at setup', a: 'It is draft or retired, or it is for a different kind of session.' },
          ],
        },
      ],
    },
  ],
};

const aiBuilders = {
  id: 'admin-ai-builders',
  title: 'AI builders',
  icon: 'MagicWand',
  summary: 'Generating a question set, and checking it before anyone plays it.',
  sections: [
    {
      title: 'What the builders do',
      icon: 'MagicWand',
      blocks: [
        {
          t: 'p',
          text: 'Describe the set you want and the AI writes the questions. There is a builder per kind of session, because a trivia question and a wavelength prompt are not the same object.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Describe it', text: 'Theme, audience, tone, how many questions.' },
            { title: 'Let it fill the form', text: 'The assistant can fill the metadata fields from your description. Lock any field you have already decided and it will be left alone.' },
            { title: 'Generate', text: 'Longer sets run as a job — you do not have to sit and watch it.' },
            { title: 'Review before you ship it', text: 'Read the questions. This is the step people skip.' },
          ],
        },
      ],
    },
    {
      title: 'Reviewing what came back',
      icon: 'MagnifyingGlass',
      blocks: [
        {
          t: 'note',
          tone: 'warn',
          title: 'Generated is not checked',
          text: 'Trivia is where this bites: a generated question can be confidently wrong, and it will be wrong in front of a room with a scoreboard attached. Read every answer key before a generated trivia set is played.',
        },
        {
          t: 'list',
          items: [
            'Do the four options actually differ, and is exactly one of them right?',
            'Is the withheld detail filled in on rounds that promise a reveal?',
            'Are the categories ones you actually want, or twenty near-duplicates?',
            'Does the tone match the room it is for?',
          ],
        },
      ],
    },
    {
      title: 'Generation prompts shape the output',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'p',
          text: 'If generated sets keep coming out wrong in the same way — too long, too American, too corporate, always four options when you wanted three — that is the generation prompt, not the request. Fix it once in Prompts and every future set inherits it.',
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
      title: 'The Sessions list',
      icon: 'GameController',
      blocks: [
        {
          t: 'p',
          text: 'Every session on this environment: who ran it, what set it used, when, and how far it got. Useful for "did that offsite actually happen" and for finding a report someone has lost.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'It is not a backup',
          text: 'Rows disappear on expiry — 90 days from creation, 7 days after last play. Anything that matters gets its report generated and saved elsewhere.',
        },
      ],
    },
    {
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

export const ADMIN_ROLE = {
  id: 'admin',
  title: 'For admins',
  icon: 'Gear',
  blurb: 'Question sets, prompts, users and the shared archive.',
  guides: [gettingStarted, questionSets, prompts, aiBuilders, gameManagement, settings],
};
