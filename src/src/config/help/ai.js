/**
 * THE AI AREA (help refresh Phase 2, W9): the builders and Save into, drafts
 * and the bell, Workie, and the two prompt libraries. Two roles read it:
 * admin (all four guides) and builder (`builder-ai`).
 *
 * Every claim below was checked against the code on 22 Oct 2026; the sources
 * are in the comment above each section, never in the text. Words owned
 * elsewhere are linked by name, not restated: the glossary defines Workie,
 * draft and the bell; host-setup owns Workie's briefing and the session's
 * Advanced options; host-reports owns What we heard and Ask the room;
 * host-running owns the Session panel's Settings tab; admin-console owns the
 * New question set dialog and the set editor's Details.
 *
 * Checked on dev the same day with the QA host: the four builder forms, Save
 * into, the bell (empty, then with a ready draft), a 3-question trivia draft
 * generated into Your space, reviewed, and discarded, and both prompt
 * libraries read-only.
 *
 * History: `AdminPage` mounts `<HelpButton section="ai-prompts">` beside the
 * prompt library cards; `HELP_ALIASES` in ./index.js maps that to
 * `admin-ai-prompts`. Three sections left `admin-ai-builders` for `ai-drafts`
 * in Phase 2; `HELP_SECTION_MOVES` carries their old addresses.
 */

/* ======================================================== AI builders === */

const aiBuilders = {
  id: 'admin-ai-builders',
  title: 'AI builders',
  icon: 'MagicWand',
  summary: 'Having Workie write a question set, choosing where it is saved, and adding questions to a set you have.',
  sections: [
    /*
      QuestionSetUploadPanel.jsx:451-462 ("Generate with AI", button "AI <type>
      builder"); :729 survey "Write it from my material". AdminPage.jsx and
      HostQuestionSetsDialog.jsx:175-180 pick the builder: trivia, poll, survey,
      else the scenario builder (Call & Answer, Wavelength). Footer buttons:
      TriviaAIBuilder "Generate Trivia Questions", PollAIBuilder "Generate Poll
      Questions", AIScenarioBuilder "Generate Scenarios" (its Wavelength form
      too), SurveyAIBuilder "Write the survey". useDraftRun hands a finished run
      to DraftReview.
    */
    {
      id: 'what-builders-do',
      title: 'Generating a set',
      icon: 'MagicWand',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Open New question set', text: 'In the console\'s Question sets (or Your question sets on the host side), start a new set and pick the engagement type. Under **Generate with AI**, press the AI builder button for that type. For a survey the button is **Write it from my material**.' },
            { title: 'Check Save into', text: 'It is at the top of the form. See Choosing where it is saved, below.' },
            { title: 'Describe it', text: 'Fill in the form for that type (What each builder asks, below). Building with AI, in the builder guides, has advice on describing it well.' },
            { title: 'Generate', text: 'Press the button at the foot, for example **Generate Trivia Questions**. It runs on the server; you can close the builder straight away.' },
            { title: 'Review the draft', text: 'When it is done, the review opens, or the bell tells you it is ready. Nothing is saved until you accept. See Drafts and the bell.' },
          ],
        },
        {
          t: 'p',
          text: 'There is one builder per format: Trivia, Poll, Survey, and one for Call & Answer and Wavelength. Anyone who can make sets in a library can generate into it.',
        },
      ],
    },
    /*
      DestinationField.jsx: "Save into" with "Your space", "<team> (team)",
      "Engage — the shared library (staff)"; hint "Every organisation can use
      Engage's library"; "Public is not a choice here"; with no list loaded a
      sentence and "Choose another"; appending: "Adds to “…” in …".
      shared/generation-drafts.js callerLibrary + tenant.canManageScope: a
      team member may write into their team; Engage only for staff in Engage
      mode. Owner, 21 Oct 2026: "public sets for now are created after saved in
      the personal or team accounts."
    */
    {
      id: 'save-into',
      title: 'Choosing where it is saved',
      icon: 'Books',
      blocks: [
        {
          t: 'p',
          text: '**Save into** is at the top of every builder, set to the library you are working in. Change it before you generate:',
        },
        {
          t: 'table',
          head: ['Choice', 'Where the set goes'],
          rows: [
            ['Your space', 'Your own library. Only you use it.'],
            ['A team, shown as its name and (team)', 'That team\'s library, for everyone in the team. Every team you belong to is listed.'],
            ['Engage — the shared library (staff)', 'Engage staff only: the library every organisation can use.'],
          ],
        },
        {
          t: 'p',
          text: 'If the list has not loaded, the builder says it saves into the library you are working in now, with **Choose another** to load the list.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Public comes after',
          text: 'There is no public choice. Save the set in Your space or a team first, then publish it from there; publishing runs its own content check.',
        },
        {
          t: 'p',
          text: 'Adding questions to a set has no choice to make: the builder says **Adds to** that set, in its own library.',
        },
      ],
    },
    /*
      Labels read on dev 22 Oct 2026 and in code: TriviaAIBuilder (Topic/Subject *,
      Target Audience, Difficulty Level, Categories / Questions in each
      category (CountField SetSizeField, max 100), Number of Answer Choices
      4-6, Number of Correct Answers 1-3, Must Have Categories, Additional
      Requirements); PollAIBuilder (RoundKindPicker "What will the room do with
      each one?", Topic/Subject, Category, Target Audience, Complexity Level,
      count, "Kinds of poll question"); AIScenarioBuilder (direction + ideas or
      "Or start from a saved template", then Question Set Title,
      Context/Background, Target Audience, Categories, Must Have Categories,
      Level of Detail, Base Prompt & Additional Requirements; max 50);
      SurveyAIBuilder (outline/deck, "What do you want to find out?", "Kinds of
      question", "How many questions" 1-20, "Name it", "Anything else Workie
      must obey"). FileUploadPrompt: .txt/.pdf/.md/.docx, 5 MB.
    */
    {
      id: 'the-forms',
      title: 'What each builder asks',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'table',
          head: ['Builder', 'What you fill in'],
          rows: [
            ['Trivia', 'A topic, the audience, the difficulty, how many categories and questions in each (up to 100 in all), four to six answer choices, one to three correct answers, categories it must include, and anything else it must follow.'],
            ['Poll', '**What will the room do with each one?** (the direction), then a topic, a category, the audience, how many, and **Kinds of poll question**: pick from choices, rate, yes or no, open answer.'],
            ['Call & Answer and Wavelength', 'Call & Answer asks the direction first and offers ideas to start from; Wavelength offers topic cards. **Or start from a saved template** shows the saved templates. Then a title, context, audience, categories and how many in each (up to 50 in all), and the base prompt, which you may edit.'],
            ['Survey', 'The session\'s outline or deck, **What do you want to find out?**, **Kinds of question**, how many (up to 20), a name, and **Anything else Workie must obey**.'],
          ],
        },
        {
          t: 'p',
          text: 'Trivia, Poll, Call & Answer and Wavelength can also take a document (text, PDF, Markdown or Word, up to 5 MB) whose text is added to the instructions, and have **Let AI fill this in** to complete the form from what you have typed. Field locks are in Building with AI.',
        },
      ],
    },
    /*
      QuestionsPanel.jsx:1393 "Add questions…"; AddQuestionsDialog.jsx: "Write N
      more in each of its N categories" / "… in each of N new categories",
      "Write N more" (autoStart), "Upload a CSV instead", "Write one by hand",
      survey: "Survey questions are written by hand or uploaded — Workie does
      not draft them." BatchGuidanceField: one run's instruction, never stored.
      AppendModeSwitch "Where do the new questions go?".
    */
    {
      id: 'adding-questions',
      title: 'Adding questions to a set you have',
      icon: 'Plus',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Open the set and press Add questions…', text: 'It is in the set editor\'s Questions panel. The dialog shows each category and how many it holds.' },
            { title: 'Choose where they go', text: 'More in each of the set\'s categories, or a number of new categories. One or the other per run. Workie is told what the set is about (its name, description and AI context) and every category in it, and writes each question for the one category it fits, not one that belongs in another.' },
            { title: 'Press Write and the number', text: 'The builder opens with the numbers filled in and starts the run; if it waits, press its Generate button. Any guidance you type is for this run only.' },
            { title: 'Review', text: 'The questions wait in a draft. Accepting them saves one new version of the set.' },
          ],
        },
        {
          t: 'p',
          text: 'The same dialog offers **Upload a CSV instead** and **Write one by hand**. Workie does not write survey questions into an existing survey.',
        },
      ],
    },
    /*
      GenerationJobPanel.jsx DraftRunning: "N / M", "runs on the server", "IF YOU
      LEAVE", "Close — you'll be notified", "Stop" / "Stopping…", and the four
      promises. A failed or partial run: "Review the N and make a set", "Try
      again for the remaining N" (a second job). DraftsStrip "Watch".
    */
    {
      id: 'while-it-runs',
      title: 'While it runs',
      icon: 'Timer',
      blocks: [
        {
          t: 'p',
          text: 'The builder shows how many are written so far out of how many asked for. The run carries on on the server; the window only watches it.',
        },
        {
          t: 'list',
          items: [
            { title: 'Close it', text: 'Press the close button under If you leave, or close the builder. Everything written waits in a draft, and the bell tells you when it is ready, on any device.' },
            { title: 'Stop', text: 'Finishes the pass already being written and keeps it. Nothing after that is written.' },
            { title: 'Watch it again', text: 'While it is still writing, the draft is listed at the top of Question sets with **Watch**.' },
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
          text: 'If generated sets keep coming out wrong in the same way (too long, too formal, the wrong country), that is the generation prompt, not your description. Engage staff fix it once in **Question set generator prompts** under Prompts, and every later set follows it.',
        },
      ],
    },
  ],
};

/* ============================================= Drafts and the bell === */

const drafts = {
  id: 'ai-drafts',
  title: 'Drafts and the bell',
  icon: 'Bell',
  summary: 'Where generated questions wait, how to review, accept or discard them, and what the bell tells you.',
  sections: [
    /*
      shared/generation-drafts.js header: every builder run writes into a draft
      in the library it will be saved into; "ONLY ITS CREATOR, until it is
      accepted"; once accepted it is an ordinary set or version and the
      library's own rules apply. DraftReview "A new set in <library>. It is
      saved only when you accept." / "Adds to “…” in …".
    */
    {
      id: 'what-a-draft-is',
      title: 'What happens to what Workie writes',
      icon: 'NotePencil',
      blocks: [
        {
          t: 'p',
          text: 'Every generation run, for a new set or for questions added to one, writes into a draft in the library it will be saved into. Nothing in any set changes, and no set is made, until you accept the draft.',
        },
        {
          t: 'list',
          items: [
            { title: 'Who sees it', text: 'Only you, the person who started it, until it is accepted. Nobody else in the team sees it, not even its owners and admins.' },
            { title: 'After you accept', text: 'It is an ordinary set (or a new version of one) in that library, and everyone the library is shared with sees it as they see any other set.' },
            { title: 'Where it is kept', text: 'On the server, so you can leave and come back on another device, days later.' },
          ],
        },
      ],
    },
    /*
      NotificationsBell.jsx (count of unread, "Mark all read" only when stored
      entries are unread, "Close", empty text, "Reminder · N days left"); reads
      on load, on focus (once a minute at most), every 5 minutes and on open.
      admin/orgs/my-notifications.js live entries: sets sent back by the content
      check; team owners/admins: people waiting to be approved to host,
      invitations running out or expired, plan's sessions used up; invitations
      to you; staff: accounts waiting, plan requests, sets in Moderation.
      shared/generation-drafts.js notifyCreator: ready / "N of M" / failed.
      notificationsApi destinationOf; HostNotificationsBell newTab on session pages.
    */
    {
      id: 'the-bell',
      title: 'The bell',
      icon: 'Bell',
      blocks: [
        {
          t: 'p',
          text: 'The bell shows how many things are waiting for you. Press it to see the list; press an entry to go straight there. If the entry belongs to another library, the console switches to it first.',
        },
        {
          t: 'table',
          head: ['Entry', 'Who gets it', 'Goes to'],
          rows: [
            ['Questions ready to review (or some of them, or a run that failed)', 'Whoever started the run', 'That draft\'s review'],
            ['Claude\'s question set is not saved (from a Build Room)', 'The Build Room\'s host', 'That Build Room'],
            ['An invitation to join a team', 'The person invited', 'Overview'],
            ['Sets sent back by the content check', 'Everyone in that team or space', 'Question sets'],
            ['People waiting to be approved to host; invitations running out', 'Team owners and admins', 'Members'],
            ['The plan\'s sessions for this month are used up', 'Team owners and admins', 'Plan & usage'],
            ['Accounts waiting for approval, plan requests, sets waiting in Moderation', 'Engage staff', 'That Engage section'],
          ],
        },
        {
          t: 'p',
          text: 'A draft\'s entry is read once you open it; **Mark all read** clears those at once. A Build Room entry for Claude\'s question set arrives already read and turns into a reminder two days before the session ends; it goes when you save or remove the set. The others stay in the count until the thing is dealt with. On a session\'s two-screen console or phone remote, an entry opens the console in a new tab so the session stays put.',
        },
      ],
    },
    /*
      DraftsStrip.jsx: "An AI draft is waiting for your review. Nothing is saved
      until you accept." Rows: "Writing N of M …", "A new set, “…”: N questions",
      "N questions to add to “…”", "kept N more days"; Review / Watch;
      "Discarded: … Restorable for N more days." Restore…
      QuestionSetsPanel.jsx:635 "Review · N" tag on the target set.
    */
    {
      id: 'finding-a-draft',
      title: 'Finding a draft again',
      icon: 'MagnifyingGlass',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'At the top of Question sets', text: 'A line lists each draft waiting in the library you are in, with how many days it is kept: **Review** for a finished one, **Watch** for one still being written, **Restore…** for one you discarded.' },
            { title: 'On the set', text: 'A set with questions waiting to join it carries a Review tag with the number; click it to review them.' },
            { title: 'In the bell', text: 'From any library, and from the host\'s screens.' },
          ],
        },
        {
          t: 'p',
          text: 'Switch library in the console to see the drafts waiting in another one.',
        },
      ],
    },
    /*
      DraftReview.jsx: heading "N questions to review"; destination line;
      "Generated <date> · kept for N more days · used N output tokens · written
      with the <name> prompt"; category checkbox "keep N of M"; per-item
      checkbox, Edit (Title, Question/Detail, options with the correct one) /
      Save edit / Cancel; defects marked; "Regenerate this category", "Generate
      the remaining N into this draft" (not for surveys), the regen panel with
      a token estimate, "Guidance for this pass (optional)", "Write them";
      Stop while generating; "Decide later". Every change saved as you go.
    */
    {
      id: 'drafts-bell-review',
      title: 'Reviewing a draft',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: 'The review lists every question by category, says where it will be saved, and how many days it is kept. Everything you do here is saved as you go, so **Decide later** loses nothing.',
        },
        {
          t: 'list',
          items: [
            { title: 'Keep or leave out', text: 'Untick a question to leave it out, or untick a category to leave out all of it.' },
            { title: 'Edit', text: 'Change the title, the text and, for trivia, the options and which one is correct. **Save edit** keeps it; the question is marked edited.' },
            { title: 'Problems', text: 'A question with something wrong, such as no correct answer, is marked. You are asked before accepting one.' },
            { title: 'Regenerate this category', text: 'Writes new questions in place of that category\'s, told the draft\'s other categories so the new ones stay in this one. If fewer arrived than you asked for, it offers to generate the rest into this draft. Each says how big it is first and takes optional guidance; press **Write them**. Not offered for surveys.' },
            { title: 'Stop', text: 'While questions are still being written, stops after the current pass and keeps what it wrote.' },
          ],
        },
        {
          t: 'p',
          text: 'Only the regenerate buttons call the model again. Reading, keeping, leaving out and editing cost nothing.',
        },
      ],
    },
    /*
      DraftReview.jsx: new set footer "Set name", "Shelf" (Choose a shelf…),
      pre-filled since 23 Oct 2026 with the run's suggested topic
      (admin/shared/draft-topic.js: asked of the model in the run's own call,
      keywords when it gives none) and marked "(suggested)", hint "Suggested
      from the questions. Change it if the set belongs on another shelf.";
      "Tags" chips (Remove tag x, "Add a tag"), pre-filled with suggested tags;
      "Switch it on now" (ticked; needs a shelf: "Choose a shelf to switch it
      on, or untick Switch it on now to save it off." — only when no shelf is
      chosen, so not with a suggestion). Adding to a set with no topic: "Shelf
      for “<set>” (suggested)", "Leave it unfiled"; filed after the version is
      saved (edit-question-set). "Accept N of M — save
      the set in <library>"; append "Accept N of M — saves version N"; done:
      "Version N saved", "Undo — back to version N", "Open the set", "Done";
      undo message "Back on version N. The version this draft made is kept in
      Versions." Undo only while the new version is live
      (admin/generation-drafts.js:302-306). PlanLimitNotice: "Nothing was saved.
      The draft is still here." A taken name is refused. Editor open with
      unsaved edits blocks accepting (QuestionsPanel.jsx:1876).
    */
    {
      id: 'accepting-taking-back',
      title: 'Accepting, and taking it back',
      icon: 'ArrowCounterClockwise',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'A new set', text: 'Check **Set name** and the **Shelf** (the set\'s topic, which people browse and filter by). Workie suggests a shelf and a few **Tags** from the questions, marked **(suggested)**; choose another shelf or remove and add tags if they are not right. Leave **Switch it on now** ticked to make it live at once (it needs a shelf) or untick it to save it switched off. Then press Accept. A name already used in that library is refused; change it and accept again.' },
            { title: 'Questions for a set you have', text: 'Accept saves one new version of the set with the questions you kept. If the set has no shelf yet, the review suggests one (**Shelf for** the set); accepting files it there too, or choose **Leave it unfiled**. A set that already has a shelf keeps it. The version before is kept, and **Undo** puts it back while the new one is still the live one. Sessions already running keep the version they started on.' },
            { title: 'Later', text: 'Every version is in the set\'s Versions, so you can go back to one there too (see Question sets).' },
          ],
        },
        {
          t: 'p',
          text: 'A new set counts against your plan\'s set allowance from the moment you accept it, never before. If the plan is full, nothing is saved and the draft stays. If the set editor has unsaved changes, save or discard them before accepting into that set.',
        },
      ],
    },
    /*
      DraftReview.jsx: "Discard draft" → "Discard N questions? You can restore
      it for 7 days." Discard / Keep it; then "Draft discarded … Nothing was
      saved", "Restore it", "Done"; "Restored. It is back for review."
      Checked on dev 22 Oct 2026.
    */
    {
      id: 'discarding',
      title: 'Discarding, and getting it back',
      icon: 'Trash',
      blocks: [
        {
          t: 'p',
          text: 'Press **Discard draft**, then **Discard** to confirm, or **Keep it** to change your mind. Nothing is written to any set.',
        },
        {
          t: 'p',
          text: 'For seven days the draft is still listed at the top of Question sets as discarded. Press **Restore…** there, then **Restore it**, and it is back for review as it was.',
        },
      ],
    },
    /*
      shared/generation-drafts.js TTL block: generating/ready/failed 30 days from
      the last run finishing; discarded 7; accepted 30. notifications.js
      REMIND_DAYS_BEFORE = 5 ("Reminder · N days left").
    */
    {
      id: 'how-long-kept',
      title: 'How long drafts are kept',
      icon: 'Clock',
      blocks: [
        {
          t: 'table',
          head: ['A draft that is', 'Is kept for'],
          rows: [
            ['Waiting for review (or failed)', '30 days from when its last run finished. Five days before the end, the bell reminds you.'],
            ['Discarded', '7 days, so you can restore it.'],
            ['Accepted', '30 days, as the record of what was accepted. The set itself is kept like any other set.'],
          ],
        },
      ],
    },
    {
      id: 'reviewing-output',
      title: 'What to check before you accept',
      icon: 'MagnifyingGlass',
      blocks: [
        {
          t: 'note',
          tone: 'warn',
          title: 'Generated is not checked',
          text: 'A generated trivia question can be confidently wrong, and it will be wrong in front of a room with a scoreboard attached. Read every answer key before you accept.',
        },
        {
          t: 'list',
          items: [
            'Do the options actually differ, and is exactly one of them right?',
            'Is the reveal filled in on rounds that promise one?',
            'Are the categories ones you want, rather than near-duplicates?',
            'Does the tone match the room it is for?',
          ],
        },
      ],
    },
  ],
};

/* ============================================================ Workie === */

const workie = {
  id: 'ai-workie',
  title: 'Workie',
  icon: 'Sparkle',
  summary: 'Where Workie works, what it reads, how to brief it, and the settings that shape what it says.',
  sections: [
    /*
      Glossary owns the definition (glossary#workie). Places: What we heard
      (host-what-we-heard), Ask the room (host-what-we-heard#ask-the-room), the
      builders (SurveyAIBuilder "Workie wrote N questions", AppendModeSwitch
      "Workie invents new category names"), the briefing (host-game-setup#
      workie-briefing). Engagement results prompts card: "What Workie says
      after a round".
    */
    {
      id: 'where-workie-works',
      title: 'Where Workie works',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'After a round', text: 'It writes What we heard: what the room said, questions worth asking next, and next steps. The host guide What we heard covers reading it, redoing it and turning a question into Ask the room. When a survey closes, it writes What we heard over the whole survey.' },
            { title: 'When you make a set', text: 'It writes the questions in the AI builders, and drafts single questions in the set editor. See AI builders.' },
            { title: 'Before a session', text: 'It turns a document you give it into a short briefing (Call & Answer).' },
          ],
        },
        {
          t: 'p',
          text: 'Workie only writes. It never scores anyone, and it never changes a set by itself: what it writes for a set waits in a draft until you accept it.',
        },
      ],
    },
    /*
      lambda-functions/game/get-ai-summary.js:3703-3731: the question, answers,
      votes and counts, late answers; contextUsed flags background (question
      "Background for Workie", QuestionsPanel.jsx:2291), setNote (the set's
      note: utils/workieSetNote.js from the builder brief, or "AI context
      instructions" on upload, QuestionSetUploadPanel.jsx:627), eventDetails,
      hostInstructions ("Instructions for Workie", SessionOptions.jsx:564),
      briefing. Reveal = answerDetails ({reveal}). WorkieContextHint "Workie
      had: question notes ✓ · set note — · …" on the phone remote and an
      opened round, never on the stage.
    */
    {
      id: 'what-workie-reads',
      title: 'What Workie reads',
      icon: 'Eye',
      blocks: [
        {
          t: 'p',
          text: 'When it writes What we heard, Workie is given the round itself: the question, every answer, the votes and how many took part. On top of that, whatever of these exists:',
        },
        {
          t: 'table',
          head: ['What', 'Where it is written'],
          rows: [
            ['Question notes', 'The question\'s **Background for Workie** field, in the set editor. Never shown to players.'],
            ['The reveal', 'The question\'s **Reveal (shown only after the round)** field.'],
            ['Set note', 'Written from the description you gave the AI builder, or the **AI context instructions** box when a set is uploaded.'],
            ['Event details', 'The event\'s details, when the session is part of an event.'],
            ['Host instructions', '**Instructions for Workie**, in the session\'s Advanced options.'],
            ['Briefing', 'The briefing made from a document, for Call & Answer.'],
          ],
        },
        {
          t: 'p',
          text: 'On your phone remote, under What we heard and in a round you open there, a small line says which of these Workie had, for example "Workie had: question notes ✓ · set note —". Only you see it.',
        },
      ],
    },
    /*
      Briefing is owned by host-game-setup#workie-briefing (BriefingField.jsx).
      Per-question background: QuestionsPanel.jsx "Facts and context Workie may
      use. Never shown to players." (600 chars).
    */
    {
      id: 'briefing-workie',
      title: 'Briefing Workie',
      icon: 'FileText',
      blocks: [
        {
          t: 'p',
          text: 'Workie can only connect what the room says to facts it has been given. Give it the facts in the place that fits:',
        },
        {
          t: 'list',
          items: [
            { title: 'For one session', text: 'Brief it from a document when you set up a Call & Answer session. Setting a session up, in the host guides, has the steps (Briefing Workie). Add rules it must follow in **Instructions for Workie**.' },
            { title: 'For one question, every time it is played', text: 'Write the facts in that question\'s **Background for Workie**, up to 600 characters.' },
            { title: 'For a reveal', text: 'Put the withheld detail in **Reveal (shown only after the round)**; Writing questions explains it.' },
          ],
        },
      ],
    },
    /*
      QuestionSetEditor.jsx:1534-1660 "Workie" group: "Its voice" (Adapt to the
      session (recommended); "A host's pick when they create the engagement
      wins for that session"), "How it sums up each round" (The standard way
      for this game type (recommended)). SessionOptions.jsx: "Workie's voice",
      "Summary approach", "Instructions for Workie". stage/WorkieSettings.jsx
      (host-session-panel#settings-tab): "Redo the read on screen", voice and
      approach from the next round. AdminPage.jsx:2468 "Show AI Prompts in
      Debug Mode".
    */
    {
      id: 'workie-settings',
      title: 'Workie\'s settings',
      icon: 'Gear',
      blocks: [
        {
          t: 'table',
          head: ['Where', 'What you set'],
          rows: [
            ['The set editor\'s Details, under Workie', '**Its voice** (the register it writes in) and **How it sums up each round** (which results prompt it follows). Both are optional and apply to every session of the set.'],
            ['Create engagement, Advanced', '**Workie\'s voice**, **Summary approach** and **Instructions for Workie** for that session. A voice chosen here wins over the set\'s.'],
            ['The Session panel\'s Settings tab, during a session', 'Redo the read, and change the voice and approach from the next round on.'],
          ],
        },
        {
          t: 'p',
          text: 'The approaches are the prompts in **Engagement results prompts** (see Prompts). Leaving everything on its recommended default is the right choice for most sets. To see exactly what Workie was sent, turn on **Show AI Prompts in Debug Mode** in the console\'s Settings.',
        },
      ],
    },
  ],
};

/* ============================================================ Prompts === */

const prompts = {
  id: 'admin-ai-prompts',
  title: 'Prompts',
  icon: 'Sparkle',
  summary: 'The two prompt libraries: what each is for, finding a prompt, statuses, editing, versions and updates from the repo.',
  sections: [
    /*
      AdminPage.jsx:1970-2056: the chooser cards "Question set generator
      prompts" and "Engagement results prompts", "Open the library", the back
      button "Prompts". consoleSections.js: Prompts in Your space, for team
      owners and admins, and for staff; promptsReadOnlyFor: writable only for
      staff in Engage mode. PromptReadOnlyView "Engage’s AI prompts. Only Engage
      staff can change them." and View.
    */
    {
      id: 'two-kinds-one-library',
      title: 'Two libraries',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Question set generator prompts', text: 'The instruction the AI builders follow when they write a set. One per engagement type and scenario: lessons learned, interview prep, general knowledge, opinion polls and so on.' },
            { title: 'Engagement results prompts', text: 'What Workie follows when it writes What we heard after a round. Each engagement type has one default; a set can choose its own.' },
          ],
        },
        {
          t: 'p',
          text: 'Prompts shows the two as cards; press one to open its library, and **Prompts** at the top to come back.',
        },
        {
          t: 'p',
          text: 'Prompts is in Your space and, in a team, for its owners and admins. There they are to read: press **View** on a row to see a prompt in full. Only Engage staff, working as Engage, change prompts.',
        },
      ],
    },
    /*
      PromptLibraryPanel.jsx:430-511: engagement type, scenario (generator) or
      category (results), status, owner (All owners, then only the owners the
      library holds among Your team, Engage, Public) and sort (Default order, Owner
      (team first)) — both drawn only when there are two owners to choose
      between; search, count "N prompts · N shown"; no-match: one-click
      "Removing any one of these gets you results", "Clear all filters".
      Columns Prompt, Type, Scenario/Category, Owner (Engage / Your team /
      Public), (Version), State.
    */
    {
      id: 'finding-a-prompt',
      title: 'Finding a prompt',
      icon: 'MagnifyingGlass',
      blocks: [
        {
          t: 'p',
          text: 'Each library is a table: the prompt\'s name and description, its engagement type, its scenario (generator prompts) or category (results prompts), whose it is (**Owner**: Engage, Your team or Public), and its state. Above it you can filter by:',
        },
        {
          t: 'list',
          items: [
            'Engagement type, and then the scenario or category within it.',
            'Status: Active, Draft or Archived.',
            'Owner, when the library holds prompts from more than one: Your team, Engage or Public, offering only the ones there are. **Owner (team first)** sorts your team\'s own prompts to the top.',
            'Words, in **Search prompts...**.',
          ],
        },
        {
          t: 'p',
          text: 'When nothing matches, the library lists which filter to remove to get results, or **Clear all filters**.',
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
            ['Archived', 'Retired. Not offered, but still in the list, marked Archived. Choose a status in the filter to hide it.'],
          ],
        },
        {
          t: 'p',
          text: 'A Default chip marks the prompt used for its engagement type when a set has none of its own. Staff switch a prompt between Active and Draft with its status chip.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Some older rows say "inactive"',
          text: 'They are shown as Draft, because that is what they behave as. There is nothing to migrate.',
        },
      ],
    },
    /*
      Results library only: AIPromptManager passes onCopyToArchive and onDelete;
      AIGenerationPromptEditor passes neither. PromptLibraryPanel.jsx:804-826;
      the Retire dialog (AIPromptManager.jsx:1928-2009) "Open it and set Draft
      instead", "Retire it"; a retired default still runs (get-ai-summary.js
      findDefaultPromptId never reads status). A retired prompt is NOT dropped
      from the list, whatever the row's tooltip and the Retire dialog say:
      delete-ai-prompt.js sets status 'archived', fetchPrompts reads every
      status and the Status filter defaults to all. Seen on dev 23 Oct 2026:
      an Archived generator prompt listed under All Status.
    */
    {
      id: 'retire-or-copy',
      title: 'Retire and Copy to archive are different things',
      icon: 'Package',
      blocks: [
        {
          t: 'p',
          text: 'Both are on each row of **Engagement results prompts**, for Engage staff.',
        },
        {
          t: 'table',
          head: ['Action', 'What it does', 'What it does not do'],
          rows: [
            ['**Copy to archive**', 'Puts a copy of the prompt in the shared archive so another environment can import it.', 'Does not remove it, change its status, or stop it being used.'],
            ['**Retire**', 'Stops the prompt being offered and marks it Archived; it stays in the list. It can be set back to Active from the editor.', 'Does not copy it to the archive. Copy it first if another environment needs it.'],
          ],
        },
        {
          t: 'p',
          text: 'Retire asks first, says how many sets use the prompt, and offers **Open it and set Draft instead** if you only want hosts to stop choosing it.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'Retiring a default does not stop it running',
          text: 'The default is picked by its default flag, not its status, so a retired or Draft default still runs. Make another prompt of that type the default first; that same save takes the flag off this one.',
        },
      ],
    },
    /*
      AIPromptManager.jsx editor head: "Improve or simplify…", "Download for an
      agent", "Upload a revised file" (a Workie file, up to 1 MB); "Create New
      Prompt"; "Populate Default Prompts" → "Rewrite the built-in prompts?"
      (matches by name, writes the built-in text as a new version, keeps each
      type's default). AIGenerationPromptEditor.jsx: Edit, Create New Prompt,
      fields Game Type, Name, Description, Base Prompt, Context/Audience/
      Category Template, Output Format, Status, "Default prompt for this type",
      Sample Categories, placeholders, Tags; "Save Changes". A change applies to
      the next run; finished summaries keep theirs.
    */
    {
      id: 'managing-them',
      title: 'Editing prompts (Engage staff)',
      icon: 'NotePencil',
      blocks: [
        {
          t: 'p',
          text: 'Switch to Engage in the console, open a library and press **Edit** on a row, or **Create New Prompt**. A change applies to the next set generated or the next round summed up; what was already written keeps what it was given.',
        },
        {
          t: 'list',
          items: [
            { title: 'Generator prompts', text: 'Name, engagement type and scenario, the base prompt, templates for the context, audience and categories the builder fills in, the output format, status, and **Default prompt for this type**.' },
            { title: 'Results prompts', text: 'What the AI is given and what it writes, with the placeholders below. The editor also offers **Improve or simplify…** (Workie suggests changes, and runs its checks on them; **Improve** on the row opens it there), **Download for an agent** and **Upload a revised file**, so another AI can work on the prompt as a file.' },
            { title: 'Populate Default Prompts', text: 'Writes the built-in results prompts. A prompt with the same name gets the built-in text as a new version; each type keeps its current default.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'One prompt per purpose, not per type',
          text: 'A team retrospective and a training session can both be Call & Answer and want completely different results. Separate prompts cost nothing.',
        },
      ],
    },
    {
      id: 'analysis-output',
      title: 'What a results prompt must produce',
      icon: 'FileText',
      blocks: [
        {
          t: 'p',
          text: 'The results screen expects three sections, under exactly these headings. Get them wrong and the output shows as one undivided block.',
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
          text: 'A prompt carries placeholders that are filled with the session\'s data when it runs. They are written in curly braces: {question}, not [question] and not (question).',
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
          text: 'A placeholder nothing recognises is not an error: it is passed through, and the room sees the literal braces in What we heard. The editor lists every placeholder valid for the prompt\'s engagement type, with an example of what it becomes.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'See what was actually sent',
          text: 'Settings › **Show AI Prompts in Debug Mode** prints the filled-in prompt above Workie\'s output. It is the fastest way to find out why Workie said something odd.',
        },
      ],
    },
    /*
      PROMPT VERSIONS (owner, 2026-10-21; docs/design/prompt-versions/). Only in
      the results library's editor, for staff (AIPromptManager showTabs needs
      versionsApi; AIGenerationPromptEditor has none). PromptVersionsPanel.jsx:
      sources "Edited here", "Uploaded a file", "From the repo", "Imported from
      the archive", "Seeded default", "Before version history"; View, Compare
      with live, Make live (press twice: "Make vN live again?"); refuses while
      the Edit tab has unsaved edits.
    */
    {
      id: 'versions',
      title: 'Versions',
      icon: 'ArrowCounterClockwise',
      blocks: [
        {
          t: 'p',
          text: 'In **Engagement results prompts**, for Engage staff, every save that changes what a prompt says is a new version. Nothing is overwritten or deleted. Changing only the status or the name is not a new version.',
        },
        {
          t: 'list',
          items: [
            { title: 'The Versions tab', text: 'In the prompt editor, beside Edit. Each version says when it was saved, by whom and how: Edited here, Uploaded a file, From the repo, Imported from the archive or Seeded default. Older ones say Before version history.' },
            { title: 'View and Compare with live', text: '**View** shows that version\'s text. **Compare with live** puts it beside the live one, part by part.' },
            { title: 'Make live', text: 'Press **Make live**, then press again to confirm. The version that was live stays in the list. The next round Workie sums up uses the new live version.' },
          ],
        },
        {
          t: 'p',
          text: 'Save or discard unsaved edits in the Edit tab before making another version live. Generator prompts have no versions: a save changes them in place.',
        },
      ],
    },
    /*
      utils/repoPromptMatch.js: "Repo has a newer version", "Matches the repo",
      "Not in the repo"; PromptLibraryPanel.jsx:549-566 notice "N prompts have a
      newer version in the repo, from the deploy of …", "Show only these" /
      "Show all prompts"; row "Review". PromptRepoReview.jsx: "Newer version in
      the repo", parts changed/unchanged with words added and removed, "Edited
      here since it was taken from the repo;", "Save as version N", "Not now".
      Hidden when read-only.
    */
    {
      id: 'repo-review',
      title: 'Updates from the repo (Engage staff)',
      icon: 'GitBranch',
      blocks: [
        {
          t: 'p',
          text: 'Some results prompts are also kept as files that arrive with each release: the built-in defaults and the demo sets\' Workie prompts. The library compares each prompt with its file in the State column: Repo has a newer version, Matches the repo, or Not in the repo. Nothing is updated by itself.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Find them', text: 'A notice above the table counts the prompts with a newer file. **Show only these** lists just them.' },
            { title: 'Press Review on the row', text: 'Each part of the prompt is shown as changed or unchanged, with the words added and removed.' },
            { title: 'Decide', text: '**Save as version** saves the file\'s text as a new version and makes it live. **Not now** changes nothing.' },
          ],
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'Edited here since it was taken from the repo',
          text: 'Review says so when someone changed the prompt here after it last came from the repo. Saving still keeps their version in the history.',
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
            { q: 'A placeholder appeared as literal text', a: 'That name is not in the editor\'s list. Several plausible-sounding names do not exist.' },
            { q: 'The results are generic', a: 'The prompt is not saying who the room is or what the session is for, or Workie was given no notes. See What Workie reads, in the Workie guide.' },
            { q: 'The prompt is not offered on a set', a: 'It is Draft or retired, or it is for a different engagement type.' },
          ],
        },
      ],
    },
  ],
};

/* ===================================================== builder: with AI === */

/**
 * BUILDING WITH AI — for whoever writes the questions. Field locks and the
 * form helper are here (FieldLock.jsx, AIFormAssist.jsx: Trivia, Poll and the
 * scenario builder; not Survey); drafting one question is QuestionsPanel's
 * "Draft this with AI". Drafts and Save into are owned by the admin guides
 * above and linked by name.
 */
const ai = {
  id: 'builder-ai',
  title: 'Building with AI',
  icon: 'MagicWand',
  summary: 'When to write by hand and when to use AI, getting a usable set out of a builder, and what to check before anyone plays it.',
  sections: [
    /*
      Routes: QuestionSetUploadPanel "Generate with AI", "Start from a template",
      "Use your own chatbot", "Manual builder"; QuestionsPanel "Add a question",
      "Add questions…", "Draft this with AI".
    */
    {
      id: 'by-hand-or-ai',
      title: 'By hand or with AI',
      icon: 'Lightbulb',
      blocks: [
        {
          t: 'table',
          head: ['You have', 'Use'],
          rows: [
            ['A topic and no material', 'An AI builder (**Generate with AI** in New question set). It writes the whole set into a draft.'],
            ['A set, and want more of it', '**Add questions…** in the set editor. Workie writes more in the same voice.'],
            ['One question to write', '**Add a question**, and **Draft this with AI** in it if you want a first go.'],
            ['Material and your own AI', 'A template, or the prompt to paste into your own chatbot, then upload the file.'],
            ['Three or four questions in mind', 'Write them by hand. See Writing questions.'],
          ],
        },
      ],
    },
    {
      id: 'describing-it',
      title: 'Describing what you want',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'p',
          text: 'The builders do much better with constraints than with adjectives. "Fun questions about technology" gets exactly what you would expect. Say who the room is, what you want them arguing about, and how long you have.',
        },
        {
          t: 'list',
          items: [
            'Who is in the room: a team, a conference, a family at Christmas.',
            'What the session is for: warm-up, retrospective, teaching something.',
            'The tone, in words you would use to a person.',
            'How many questions, and roughly how long each should take.',
          ],
        },
        {
          t: 'p',
          text: 'What you describe also becomes the set\'s note to Workie, so it shapes What we heard as well as the questions.',
        },
      ],
    },
    /*
      AIFormAssist.jsx: "Let AI fill this in" / "Hide the AI helper", the plan
      "locked — left alone", "empty — will be filled in", "yours — will be
      refined"; "Fill in the rest"; held proposals "These came back rewritten,
      not refined." with "Keep mine"; per-field "Undo <field>"; "AI wrote …".
      FieldLock.jsx padlock beside the label. Seed field: Topic/Subject
      (trivia, poll), Context/Background (scenario). Not in SurveyAIBuilder.
    */
    {
      id: 'field-locks',
      title: 'Let AI fill in the form, and lock fields',
      icon: 'Lock',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Write the one field it works from', text: 'Topic/Subject in Trivia and Poll, Context/Background in Call & Answer and Wavelength.' },
            { title: 'Lock what you have decided', text: 'Press the padlock beside a field\'s label. A locked field is never changed.' },
            { title: 'Press Let AI fill this in', text: 'The panel lists each field: locked (left alone), empty (will be filled in) or yours (will be refined). Press **Fill in the rest**.' },
            { title: 'Check what it wrote', text: 'It says which fields it wrote, with an undo for each. If it rewrote something of yours rather than refining it, it changes nothing and shows both: choose **Keep mine** or the AI\'s.' },
          ],
        },
        {
          t: 'p',
          text: 'This only fills in the form; nothing is generated until you press Generate. The survey builder has no helper and no locks.',
        },
      ],
    },
    /*
      QuestionsPanel.jsx:2075-2128: "Draft this with AI", "What should this
      question be about?", "Draft it", the note on what the generator is given
      ("Writing alongside these"), trivia writes A-D only; "AI drafted this."
      provenance and the ai-drafted tag.
    */
    {
      id: 'one-question',
      title: 'Drafting one question with AI',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'p',
          text: 'In the question form, press **Draft this with AI**, say in **What should this question be about?** what you want, and press **Draft it**. It fills in the form; nothing is in the set until you press Done and save the set.',
        },
        {
          t: 'p',
          text: 'It is given the set\'s description and instructions, the other questions in the chosen category (listed under Writing alongside these), and the titles already used. For trivia it writes options A to D; E and F are yours to add. A tag marks the question as drafted by AI; delete it if you rewrite the question as your own.',
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
          text: 'A set is not generated while you wait. It runs on the server and writes into a draft that only you see, so you can close the builder and get on with something else. The bell tells you when it is ready. Drafts and the bell, in the admin guides, covers reviewing, accepting and discarding.',
        },
        {
          t: 'p',
          text: 'Before it starts, check **Save into**: Your space, a team, or Engage for Engage staff. Public is not a choice; publish a set once it is saved.',
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
            'Exactly one option is right, and the others are plausible.',
            'The **Reveal (shown only after the round)** field is filled in, especially on any round meant to end in a reveal.',
            'The categories are a usable handful, not twenty near-synonyms.',
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
          text: 'Repeated, consistent problems come from the generation prompt rather than your description: too long, too formal, always four options when you asked for three. Ask Engage staff to fix the prompt once in Prompts, and every later set follows it.',
        },
      ],
    },
  ],
};

/**
 * The ai area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'ai',
  guides: { admin: [aiBuilders, drafts, workie, prompts], builder: [ai] },
};
