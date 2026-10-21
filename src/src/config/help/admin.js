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
            ['Question sets, Sessions, Public library', 'Everyone in a team or space', 'The sets, what was run, and sets other organisations have published.'],
            ['Members', 'Teams', 'Who can build and run sessions here.'],
            ['Prompts', 'Team owners and admins, read-only', 'What the AI is told. Only Engage staff change prompts.'],
            ['Plan & usage, Data & privacy', 'Team owners and admins, and your own space', 'What this month costs; who has opened what, and how to take everything with you.'],
            ['Organisations, Observability, Plan requests, Discount codes, Shared library, Prompts, Public library, Moderation, Accounts, Archive', 'Engage staff, switched to Engage', 'Running the platform. A team\'s content is not reachable from here.'],
            ['Settings', 'Everyone, at the foot of the menu', 'Three switches, stored in this browser only.'],
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
          text: 'Check Accounts. Registration puts new people in the pending group and leaves them there — a host who has signed up and cannot create anything is almost always someone nobody moved into hosts.',
        },
        {
          t: 'table',
          head: ['Group', 'Can'],
          rows: [
            ['admins', 'Engage staff: the Engage sections of this console.'],
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
            { title: 'Editing', text: 'Engage staff edit prompts, switched to Engage. Team owners and admins can read them. A change applies to the next round that runs, not to summaries already generated.' },
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
      /*
        PROMPT VERSIONS AND UPDATES FROM THE REPO (owner, 2026-10-21;
        docs/design/prompt-versions/). What shipped: every content save is a
        new version; the editor's Versions tab lists them and makes one live;
        the library marks prompts the repo has a newer version of, and Review
        saves the repo's text as a new version. Nothing is deleted.
      */
      title: 'Versions, and updates from the repo',
      icon: 'ArrowCounterClockwise',
      blocks: [
        {
          t: 'p',
          text: 'Every save that changes what a prompt says is a new version. The version that was live is kept, word for word, and nothing is ever overwritten or deleted. Changing only the status or the name is not a new version.',
        },
        {
          t: 'list',
          items: [
            { title: 'The Versions tab', text: 'In the prompt editor, beside Edit. Each version says when it was saved, by whom, and how: Edited here, Uploaded a file, From the repo, Imported from the archive or Seeded default. Versions saved before version history began say "Before version history".' },
            { title: 'View and Compare with live', text: 'View shows that version\'s text. Compare with live puts it beside the live one, part by part.' },
            { title: 'Make live', text: 'Press it twice: the first press asks, the second makes that version live. The version that was live stays in the list, one press from live again. The next Workie read uses the live version; summaries already written keep what they were given.' },
          ],
        },
        { t: 'h', text: 'Updates from the repo' },
        {
          t: 'p',
          text: 'The prompt files kept in the repo — the demo sets\' Workies and the built-in defaults — travel with every deploy. The library compares each prompt with its file and says so in the State column: Repo has a newer version, Matches the repo, or Not in the repo. A notice above the table counts the ones the repo has newer, and Show only these lists just them. Nothing is updated by itself.',
        },
        {
          t: 'p',
          text: 'Review shows each part of the prompt — instructions, output format, sections and anything else the file carries — as changed or unchanged, with the words added and removed. Save as version N makes the repo\'s text a new version and makes it live; Not now changes nothing.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'Edited here since it was taken from the repo',
          text: 'When someone changed the live prompt here after it was last taken from the repo, Review says so. Saving still keeps their version in the history, so it can be made live again.',
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
            { title: 'Choose where it is saved', text: 'Your space, a team you belong to, or — for Engage staff — Engage\'s shared library. The builder shows the library it will use and lets you change it. Adding questions to a set always saves into that set\'s own library.' },
            { title: 'Generate', text: 'It runs on the server as a job. Close the builder whenever you like: everything it writes waits in a draft, and the bell in the top line tells you when it is ready.' },
            { title: 'Review, then accept', text: 'Keep or leave out each question, edit any of them, regenerate one category. Nothing is saved until you accept.' },
          ],
        },
      ],
    },
    {
      title: 'Drafts, the bell, and the review',
      icon: 'Bell',
      blocks: [
        {
          t: 'p',
          text: 'Every generation run — a new set, or questions added to an existing one — writes into a draft in the library it will be saved into. A draft is yours alone until you accept it: nobody else in the team sees it.',
        },
        {
          t: 'list',
          items: [
            { title: 'The bell', text: 'The bell in the top line counts what is waiting for you. A ready draft is there with a link straight to its review, whichever library you are in, and so are invitations, people waiting for approval and sets the content check sent back.' },
            { title: 'In the list', text: 'Question sets shows the drafts waiting in the library you are in, and a set with questions waiting to join it carries a "Review" tag. The tag goes away as soon as the draft is accepted, discarded or expires.' },
            { title: 'Stop', text: 'While it runs, Stop finishes the pass already being written and keeps it. Nothing after that is paid for.' },
            { title: 'Regenerate', text: 'Regenerate one category, or generate the questions that did not arrive, into the same draft. These are the only review buttons that call the model, and each says how big it is first. Reading, keeping, leaving out and editing cost nothing.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Thirty days, with a reminder',
          text: 'A draft waits thirty days. Five days before it runs out the bell lights up again. A discarded draft can be restored for seven days; an accepted one is kept for thirty as the record of what was accepted.',
        },
      ],
    },
    {
      title: 'Accepting, and taking it back',
      icon: 'ArrowCounterClockwise',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'A new set', text: 'Accept saves the set in the library the draft names, switched on (it needs a shelf for that) or left off if you untick it. It counts against your set allowance from then — never before.' },
            { title: 'Questions for an existing set', text: 'Accept writes ONE new version of the set with the kept questions. The previous version is kept, and Undo puts it back while the new one is still the live one. Sessions already running keep the version they started on.' },
            { title: 'Discard', text: 'Writes nothing to any set. Restore it from the list within seven days if you change your mind.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Public comes after',
          text: 'You cannot generate straight into the public library. Save the set in your space or a team first, then publish it from there — publishing runs its own check.',
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
            'Do the options actually differ, and is exactly one of them right?',
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
          text: 'Rows disappear on expiry — 90 days from creation, or 7 days once the session has started. Anything that matters gets its report saved; saved reports are listed under Reports.',
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
  blurb: 'The console: question sets, members, plans, prompts and the shared archive.',
  guides: [gettingStarted, questionSets, prompts, aiBuilders, gameManagement, settings],
};
