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

const prompts = {
  id: 'admin-ai-prompts',
  title: 'Prompts',
  icon: 'Sparkle',
  summary: 'The two kinds of prompt, their statuses, and the difference between Retire and Copy to archive.',
  sections: [
    {
      id: 'two-kinds-one-library',
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
      id: 'statuses',
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
      id: 'retire-or-copy',
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
      id: 'analysis-output',
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
      id: 'placeholders',
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
      id: 'managing-them',
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
      id: 'versions',
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
      id: 'output-wrong',
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
      id: 'what-builders-do',
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
      id: 'drafts-bell-review',
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
      id: 'accepting-taking-back',
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
      id: 'reviewing-output',
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
      id: 'generation-prompts',
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

/**
 * THE TWO BUILDER GUIDES — for whoever writes the questions, who may be an
 * admin, may be a host with their own set, and is doing a different job from
 * either while they are doing it.
 *
 * The reveal section is the reason this role's guides needed writing rather
 * than folding into Admin. The withheld-detail field is the single most
 * misunderstood thing in a question set: it shipped populated but untagged, so
 * the AI was told to reveal something the editor never offered a way to fill
 * in, and rooms watched the AI promise a reveal that never arrived.
 */

const ai = {
  id: 'builder-ai',
  title: 'Building with AI',
  icon: 'MagicWand',
  summary: 'Getting a usable set out of a generator, and what to check before anyone plays it.',
  sections: [
    {
      id: 'describing-it',
      title: 'Describing what you want',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'p',
          text: 'The generator is much better with constraints than with adjectives. "Fun questions about technology" produces exactly what you would expect. Say who the room is, what you want them arguing about, and how long you have.',
        },
        {
          t: 'list',
          items: [
            'Who is in the room — a team, a conference, a family at Christmas.',
            'What the session is actually for — warm-up, retrospective, teaching something.',
            'The tone, in words you would use to a person.',
            'How many questions, and roughly how long each should take.',
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Lock the fields you have already decided',
          text: 'The assistant can fill the metadata from your description, and a locked field is left alone. Lock the name and the category list, then let it regenerate the rest as many times as you like.',
        },
      ],
    },
    {
      id: 'runs-as-a-job',
      title: 'It runs as a job, into a draft',
      icon: 'Timer',
      blocks: [
        {
          t: 'p',
          text: 'A set is not generated while you wait. It runs on the server and writes into a draft, so you can close the dialog and get on with something else. The bell in the top line tells you when the draft is ready, on any device, and the draft waits thirty days for you to review it.',
        },
        {
          t: 'p',
          text: 'Before it starts, the builder shows where the set will be saved — your space, a team, or Engage for Engage staff — and lets you change it. Questions added to an existing set always go into that set\'s library. Public is not a choice here: publish a set once it is saved.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Nothing is saved until you accept',
          text: 'Not the set, and not a new version of one. If a set of the same name already exists when you accept, you are asked for another name; nothing you already have is replaced.',
        },
      ],
    },
    {
      id: 'before-anyone-plays',
      title: 'Before you let anyone play it',
      icon: 'MagnifyingGlass',
      blocks: [
        {
          t: 'note',
          tone: 'warn',
          title: 'Check the answer keys',
          text: 'A generated trivia question can be fluent and wrong. It will be wrong in front of a room, with points riding on it, and you will be the one arguing with somebody who knows the real answer.',
        },
        {
          t: 'list',
          items: [
            'Exactly one option is right, and the other three are plausible.',
            'The answer-details field is filled in, especially on any round meant to end in a reveal.',
            'The categories are a usable handful, not twenty synonyms.',
            'Nothing is subtly about the wrong country, decade or company.',
          ],
        },
      ],
    },
    {
      id: 'same-problem-every-time',
      title: 'If it keeps coming out wrong the same way',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'p',
          text: 'Repeated, consistent problems are the generation prompt rather than your description. Too long, too corporate, always four options when you asked for three — fix the prompt once in the Prompts section and every future set inherits the fix.',
        },
      ],
    },
  ],
};

/**
 * The ai area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 * AI: the builders, drafts and the bell, prompts, Workie. Two roles read it.
 */
export const AREA = {
  id: 'ai',
  guides: { admin: [prompts, aiBuilders], builder: [ai] },
};
