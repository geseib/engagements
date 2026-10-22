/**
 * THE ADMIN CONSOLE, AS A HOST OR A TEAM OWNER SEES IT (help refresh Phase 2, W8).
 *
 * Your space and teams: the console tour, Overview, question sets, sharing and
 * the public library, sessions and the events list, and the three browser
 * switches. Members, Activity, Plan & usage and Data & privacy are in
 * ./admin-team.js; AI builders, drafts and prompts are in ./ai.js (W9); the
 * Engage-staff screens are W10's (./admin-staff.js).
 *
 * Staff content moved to ./admin-staff.js (W10): the Engage row of
 * `admin-getting-started#console-sections` is a pointer now, the group table
 * of `#first-thing` is `admin-staff-accounts#kinds-of-account`, and
 * `admin-question-sets#moving-between-environments` moved whole (id kept,
 * HELP_SECTION_MOVES).
 *
 * Checked against the code at 47c35c9c and on dev (engage.dev, QA host, Your
 * space and two teams, 22 Oct 2026). Every **Label** exists in src/src.
 *
 * History: `AdminPage` mounts `<HelpButton section="ai-prompts">` beside the
 * prompt library; `HELP_ALIASES` in ./index.js is what makes that id resolve.
 */

/* ------------------------------------------------------------------ tour */

const gettingStarted = {
  id: 'admin-getting-started',
  title: 'The console: a tour',
  icon: 'Gear',
  summary: 'Which sections you see and why, switching between Your space and a team, and the Overview.',
  sections: [
    /*
      The nav is computed: config/consoleSections.js sectionsFor(). Personal:
      Overview, Question sets, Sessions, [Events], Public library, Prompts;
      then Account: Plan & usage, Data & privacy. Team owner/admin: the same
      content group (Prompts read-only) plus Team: Members, Activity, Plan &
      usage, Data & privacy. Team member: content group without Prompts, and
      Team: Members only. Settings is the foot (FOOT_SECTIONS). Events only
      when GET /orgs features.events is on. The Engage row is staff content
      (W10); the test in helpContent.test.js §… pins "moderation" here.
    */
    {
      id: 'console-sections',
      title: 'What is in the console, and who sees it',
      icon: 'Buildings',
      blocks: [
        {
          t: 'p',
          text: 'Open the console from **Question sets & team** on your start screen (Engage staff see **Admin console**). The menu on the left depends on where you are working (Your space or a team) and your role there.',
        },
        {
          t: 'table',
          head: ['Section', 'Who sees it', 'What it is for'],
          rows: [
            ['Overview, Question sets, Sessions, Public library', 'Everyone, in Your space and in every team', 'What needs you, your sets, what was run, and other organisations\' published sets.'],
            ['Events', 'Everyone, where events are turned on', 'One join code for a whole agenda.'],
            ['Prompts', 'Your space, and team owners and admins', 'What Workie is told, to read. Only Engage staff change prompts.'],
            ['Members', 'Teams: everyone sees it; owners and admins manage it', 'Who is in the team, and invitations.'],
            ['Activity', 'Team owners and admins', 'What the team ran, by month.'],
            ['Plan & usage, Data & privacy', 'Your space, and team owners and admins', 'What this month costs; encryption, the change log, and leaving.'],
            ['Settings', 'Everyone, at the foot of the menu', 'Three switches, stored in this browser only.'],
            ['Organisations, Accounts, Moderation and the other Engage sections', 'Engage staff, switched to Engage', 'Running the platform. See Engage staff: the console.'],
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'On a phone',
          text: 'The Overview and the switch between your spaces work on a phone. Other sections say **This screen needs a laptop or tablet.**',
        },
      ],
    },
    /*
      ScopeTabs.jsx: Personal (the personal org, title "Personal · <name>"),
      each team A-Z, "More teams" menu when they do not fit, "+ New team",
      "+ Personal space" only when you have none. AdminPage handleScopeSelect:
      setActiveOrgId + reload /admin, which lands on Overview. The choice is
      localStorage (auth/authFetch.js) and the host screens read the same key
      (ActiveOrgSwitcher on WelcomeScreen and HostRemote). CreateOrgDialog.jsx:
      "Create a team", Name, "Create team"; Engage approves new organisations
      by hand and the team runs on Free until then.
    */
    {
      id: 'switching-space',
      title: 'Switching between Your space and a team',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'p',
          text: 'The row along the top of the console says where you are working. **Personal** is Your space; each team you belong to has its own tab, and teams that do not fit are under **More teams**. A number on a tab is how many things wait for you there.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Pick a tab', text: 'The console reloads in that space and opens its Overview. Sets, sessions and members are always those of the space you picked.' },
            { title: 'It is remembered', text: 'This browser keeps your choice, and your host screens use the same one: a session you create is created in the space you last picked.' },
            { title: 'Start a team', text: '**+ New team** opens **Create a team**. Give it a name and press **Create team**. Engage approves new organisations by hand, usually within a day; until then the team runs on the free plan.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'No Your space?',
          text: 'If you have no space of your own, **+ Personal space** appears at the end of the row.',
        },
      ],
    },
    /*
      OverviewPanel.jsx + config/overviewAlerts.js. Heading "Needs you" with a
      count, empty state "Nothing needs you." Boxes: Team invitations (Accept),
      Sent back by the check (Open the set), "<plan>: N of M sessions used"
      (one short of the cap and at it), Your plan request (Withdraw), Reports
      deleted soon (REPORT_DAYS 7, Download), Awaiting approval (Approve),
      Invitation running out (Copy link, Revoke), Engage staff opened your
      content (Read the log). Tiles: owners/admins and Your space see the
      month; a member sees Question sets and Members and the line "Monthly
      numbers are shown to the team's owners and admins."
    */
    {
      id: 'overview',
      title: 'Overview: what needs you',
      icon: 'House',
      blocks: [
        {
          t: 'p',
          text: 'Every space opens on its Overview. **Needs you** lists what is waiting, one box each; open a box to act on it without leaving the page. When it is empty it says **Nothing needs you.**',
        },
        {
          t: 'list',
          items: [
            { title: 'Team invitations', text: 'A team has invited you. **Accept** joins it.' },
            { title: 'Sent back by the check', text: 'A set you shared was not published. **Open the set** shows what was flagged.' },
            { title: 'Sessions used', text: 'You are one session short of the free plan\'s monthly limit, or at it.' },
            { title: 'Reports deleted soon', text: 'A saved report reaches the end of its time within a week. **Download** it now.' },
            { title: 'Awaiting approval, Invitation running out', text: 'Team owners and admins: someone who joined by invitation is waiting to host, or an invitation is about to expire.' },
            { title: 'Engage staff opened your content', text: 'Staff changed something here. **Read the log** opens Data & privacy.' },
          ],
        },
        {
          t: 'p',
          text: 'Below, this month in numbers: sessions counted, participants, questions asked, and your plan. A team member sees the team\'s sets and members instead; the monthly numbers are for owners and admins.',
        },
      ],
    },
    /*
      Rewritten for team owners and admins (TeamPanel.jsx "Approve hosting",
      approve-member.js; only for members who joined by invitation, on a team
      whose plan is not Free: org-guards.js canApproveHosting). The group
      table moved to admin-staff-accounts#kinds-of-account (W10).
    */
    {
      id: 'first-thing',
      title: 'Someone cannot host yet',
      icon: 'UserCircle',
      blocks: [
        {
          t: 'p',
          text: 'A new Engage account starts in the pending group: it can sign in and nothing else. Someone who has signed up and cannot create a session is almost always still pending.',
        },
        {
          t: 'list',
          items: [
            { title: 'They joined your team by invitation', text: 'An owner or admin can let them host with **Approve hosting** in Members, once the team is on a paid plan. Engage can still refuse.' },
            { title: 'Anyone else', text: 'Engage staff approve them.' },
          ],
        },
      ],
    },
  ],
};

/* --------------------------------------------------------- question sets */

const questionSets = {
  id: 'admin-question-sets',
  title: 'Question sets',
  icon: 'Books',
  summary: 'Finding a set, whose it is, making one, editing it, versions and restoring, and Quickstart.',
  sections: [
    {
      id: 'what-a-set-is',
      title: 'What a set is',
      icon: 'Books',
      blocks: [
        {
          t: 'p',
          text: 'A question set holds the questions for one type of session, grouped by category. A session plays one set, and every set a host can choose when creating a session comes from here.',
        },
        { t: 'gameTypes' },
        {
          t: 'note',
          tone: 'info',
          title: 'Surveys',
          text: 'A survey set is a list of questions people answer at their own pace. Names (Anonymous, Who finished or Named) is chosen when the session is created and cannot change once the survey opens.',
        },
      ],
    },
    /*
      QuestionSetsPanel.jsx: "New set"; search placeholder "Search name,
      description, tags"; selects topic (All topics + 15 topics + Unfiled),
      type, status (Active/Inactive), owner (OWNER_OPTIONS), sort (… "Owner
      (yours first)"); count "N sets · M shown"; SetShelfBrowse "Browse topics
      and tags" (counts across all sets); nothing-matches state with one-click
      drops and "Clear all filters". Columns Set/Type/Qs/State/Who can see it
      (org consoles)/Updated.
    */
    {
      id: 'the-list',
      title: 'Finding a set',
      icon: 'MagnifyingGlass',
      blocks: [
        {
          t: 'p',
          text: 'Question sets lists every set you can use in this space: your own and your team\'s, Engage\'s shared sets and the public library\'s.',
        },
        {
          t: 'list',
          items: [
            { title: 'Search', text: 'Matches a set\'s name, description and tags.' },
            { title: 'Filters', text: 'Topic, type, status (Active or Inactive) and owner (Yours, Team, Engage, Public). Sort by newest, name, size, or **Owner (yours first)**.' },
            { title: 'Browse topics and tags', text: 'Opens every topic and tag in use, with counts. Click one to filter by it.' },
            { title: 'Nothing matches', text: 'The list names each filter that is hiding sets and how many it hides; click one to drop it, or **Clear all filters**.' },
          ],
        },
        {
          t: 'p',
          text: 'A set with no topic is **Unfiled**: nobody filtering by topic will find it. Give it one in the editor.',
        },
      ],
    },
    /*
      setOwnerTag.js (the word), canManage from admin/get-question-sets.js
      (the buttons): managed rows get Edit (Review on an unreviewed AI set),
      Share (org consoles) and Delete; others get Open and Copy. Team rows are
      manageable by any member (tenant.canManageScope minRole member).
      QuestionSetDeleteDialog: "Delete the set", "Keep it", "Deactivate it
      instead" (active sets only). handleCopySet: a copy counts against the
      set allowance.
    */
    {
      id: 'owner-tags',
      title: 'Whose set it is, and what you can do',
      icon: 'ListBullets',
      blocks: [
        {
          t: 'p',
          text: 'Every row carries an owner tag: Yours, Team, Engage or Public (see Words we use). It decides the buttons.',
        },
        {
          t: 'table',
          head: ['Tag', 'Buttons', 'What happens'],
          rows: [
            ['Yours, Team', '**Edit**, **Share**, **Delete**', 'You change the set itself. Anyone in a team can edit the team\'s sets.'],
            ['Engage, Public', '**Open**, **Copy**', 'Open reads it in the editor; saving there makes your own copy. Copy makes one straight away. The original never changes.'],
          ],
        },
        {
          t: 'p',
          text: 'A copy is a new set in this space, so it counts toward your plan\'s stored sets. On the free plan, if you are holding all your sets, delete one first.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'Deleting',
          text: 'Delete removes every question and version, and a past session\'s report may not rebuild without it. If you only want it out of hosts\' way, choose **Deactivate it instead**.',
        },
      ],
    },
    /*
      The State cell's chips (QuestionSetsPanel.jsx): Active/Inactive and
      Quickstart are toggles (toggle-question-set.js, toggle-quickstart.js,
      both requireSetManager); Not playable, Empty, Unreadable, "Review · N"
      (a draft waiting), "AI draft" (generated, off, unreviewed), AI, and the
      owner tag. The Quickstart menu is the host's (host-setup guide).
    */
    {
      id: 'quickstart',
      title: 'Switching a set on, off and onto Quickstart',
      icon: 'Lightning',
      blocks: [
        {
          t: 'p',
          text: 'The State column holds two switches. Click them on a set you can change; the click is the change, with no dialog and no save.',
        },
        {
          t: 'list',
          items: [
            { title: 'Active / Inactive', text: 'Only active sets are offered to hosts. Switching one off loses nothing.' },
            { title: 'Quickstart', text: 'Puts the set on the Quick start menu of the host\'s start screen, for everyone in this space. Keep that menu short enough to fit on one screen.' },
          ],
        },
        {
          t: 'p',
          text: 'Other tags in that column are information: **Empty** (no questions), **AI draft** (written by Workie, switched off and not reviewed yet: press **Review**), and Review · 4 (Workie\'s new questions waiting for you; click to review them).',
        },
      ],
    },
    /*
      NewSetDialog.jsx "New question set"; QuestionSetUploadPanel.jsx:
      "Engagement type"; routes "Generate with AI" (AI <type> builder),
      "Start from a template" (Download <type> template), "Use your own
      chatbot" (Copy AI authoring prompt), "Start from the artwork template"
      (Call & Answer only), "Manual builder"; survey: "Your own material"
      (Write it from my material), "A template" (5 named), "A file". Then
      "…then upload it here": file (.csv, .json for surveys), preflight in the
      browser, "Question set title *", Description, "Topic *", "Tags for this
      set", "Upload question set". Builders and drafts: ai.js (W9).
    */
    {
      id: 'new-set',
      title: 'Making a new set',
      icon: 'Plus',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Press New set', text: 'It opens **New question set**. Choose the **Engagement type** first: it decides the builder, the template and how your file is read.' },
            { title: 'Choose how to make it', text: '**Generate with AI** has Workie write a draft for you to review (see AI builders). **Start from a template** downloads a spreadsheet with the right columns. **Use your own chatbot** copies a prompt to paste, with the template, into another AI. A survey offers ready templates and **Write it from my material**.' },
            { title: 'Upload the file', text: 'Under **…then upload it here**, choose your CSV. Every row is checked in your browser first, and anything that would stop the import is listed before anything is sent.' },
            { title: 'Name it and file it', text: 'Fill in **Question set title *** and choose a **Topic *** so people can find it. Tags are optional. Press **Upload question set**.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Plan limits',
          text: 'On the free plan a new set counts toward the sets you may store. If you are full, the dialog says so and nothing is saved.',
        },
      ],
    },
    /*
      QuestionSetEditor.jsx ("Edit Question Set"): Details (Save Changes /
      Save details as my copy; saved in place, the AI banner says edits "are
      live for anyone hosting from it"), Workie ("Its voice", "How it sums up
      each round"), Questions (QuestionsPanel.jsx), Versions, Images
      (SetMediaPanel), × / Close / Cancel, "You have unsaved questions".
    */
    {
      id: 'editor',
      title: 'Editing a set',
      icon: 'PencilSimple',
      blocks: [
        {
          t: 'p',
          text: '**Edit** opens the set full screen. It has four panels, top to bottom.',
        },
        {
          t: 'list',
          items: [
            { title: 'Details', text: 'Title, description, topic and tags, the engagement type, instructions, and Workie: **Its voice** and **How it sums up each round**. **Save Changes** saves them in place, at once, for anyone hosting from the set.' },
            { title: 'Questions', text: '**Add a question**, **Add questions…** (from Workie, a file or by hand), or **Pull from another set**. Nothing is written until you save; one save makes one new version.' },
            { title: 'Versions', text: 'Every saved version, and which one is active.' },
            { title: 'Images', text: 'Upload a folder of pictures and see which questions point at one that is missing.' },
          ],
        },
        {
          t: 'p',
          text: 'Leave with the **×** or **Close** at the bottom. With unsaved questions it asks first: **Go back and save them** or **Close and lose the changes**.',
        },
      ],
    },
    /*
      QuestionsPanel.jsx saveLabel "Save as version N" / "Save as my own
      copy…"; "Discard changes"; "Download CSV"; "Replace every question from
      a CSV..." with a "Before you replace" preview. QuestionSetEditor.jsx
      Versions: "Promote" ("Engagements already in play keep the version they
      started with."), "Delete" (refused on the active version; "N in play"
      asks "Delete it anyway"/"Keep version N").
    */
    {
      id: 'versions-not-overwrites',
      title: 'Versions and restoring',
      icon: 'ArrowCounterClockwise',
      blocks: [
        {
          t: 'p',
          text: 'Saving questions never overwrites them. The button says Save as version 3, with the next number writes a new version and makes it active; the old one is kept. A session that is already running keeps the version it started with.',
        },
        {
          t: 'list',
          items: [
            { title: 'Unsaved changes', text: 'A bar says what you have changed. **Discard changes** puts the set back as it was saved.' },
            { title: 'Restore an older version', text: 'In Versions, press **Promote** on it. It becomes active again; sessions in play are not affected.' },
            { title: 'Delete a version', text: 'Not the active one. If sessions are playing it, you are asked first, because deleting it would break them.' },
            { title: 'Swap in a file', text: '**Replace every question from a CSV...** shows what will change before it replaces anything, and also makes a new version. **Download CSV** gives you the current questions.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Details are different',
          text: 'Title, topic, instructions and Workie\'s settings are not versioned: **Save Changes** changes them for everyone at once.',
        },
      ],
    },
    /*
      QuestionsPanel.jsx: panel note "This set belongs to someone else. Edit
      it freely; saving makes your own copy and leaves the original alone";
      saveLabel "Save as my own copy…"; QuestionSetEditor isSomebodyElses →
      "Save details as my copy"; noRoomForCopy refuses on arrival when the
      set allowance is full.
    */
    {
      id: 'copying',
      title: 'Changing a set that is not yours',
      icon: 'Copy',
      blocks: [
        {
          t: 'p',
          text: 'Engage\'s sets and public sets cannot be changed, but you can adapt them. Press **Open**, change what you like, and save: Details says **Save details as my copy** and Questions says **Save as my own copy…**. Either makes a new set in this space with your changes, and the original stays exactly as it was.',
        },
        {
          t: 'p',
          text: 'To take a copy without opening it, press **Copy** in the list. Either way the copy is yours from then on: it gets the Yours or Team tag, and Edit and Delete.',
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
          text: 'A question can carry a picture: the Picture field on the question editor. Art rounds are the obvious case: the image is the question, and the text asks what people make of it. Upload the files in the editor\'s Images panel.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Pair a picture with a reveal',
          text: 'A picture round is much better when each question also fills in the withheld detail (the real title, the artist, the year), so Workie can reveal it after everyone has answered. See the Builder guides.',
        },
      ],
    },
  ],
};

/* ---------------------------------------------- sharing and public library */

const publicLibrary = {
  id: 'admin-public-library',
  title: 'Sharing and the public library',
  icon: 'Broadcast',
  summary: 'Publishing a set for every organisation, the content check, what the Who can see it column says, and copying a public set.',
  sections: [
    /*
      QuestionSetsPanel rowCanShare (org consoles, canManage) → ShareSetDialog
      ("Share “…” publicly", "Submit for review", outcomes dl, "Close — this
      keeps running"); the editor's Versions "Share publicly"; Public library
      "Share a set" picker. Server: check-question-set.js requires owner or
      admin of the organisation ("Only an owner or admin of this organisation
      can submit a set for review."). Publishing copies the set
      ("pubshare-fine"). A Workie prompt of your own is not published with it.
    */
    {
      id: 'publishing',
      title: 'Sharing a set publicly',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'p',
          text: 'Sharing puts a copy of your set in the public library, where anyone using Engage can read it and copy it. In a team, only owners and admins can share; in Your space, you can.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Start it', text: 'Press **Share** on the set\'s row, **Share a set** in Public library, or **Share publicly** on a version in the editor.' },
            { title: 'Submit it', text: 'Read what will happen and press **Submit for review**. An automated check reads every question first; it usually takes under a minute. You can close the dialog and it keeps running.' },
            { title: 'Read the outcome', text: 'It passes and is published; or something is flagged and nothing is published; or the check is unsure and a person at Engage decides. The outcome shows on the set\'s row.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'The public copy is separate',
          text: 'Editing your set later does not change the public copy. To publish your changes, share the new version.',
        },
      ],
    },
    /*
      utils/shareState.js shareStateOf: Private, Shared vN, "Shared vN, yours
      is vM", Checking…, Didn't finish, Needs changes, Waiting for Engage,
      Checked, Everyone (Engage's sets), Public. SetReviewBanner.jsx: "What
      was flagged", "Resubmit", "Ask for a human review", "Tell Engage why
      (optional)", "Send". Overview box "Sent back by the check".
    */
    {
      id: 'who-can-see-it',
      title: 'The Who can see it column',
      icon: 'Eye',
      blocks: [
        {
          t: 'table',
          head: ['It says', 'Meaning'],
          rows: [
            ['**Private**', 'Only this space can see it.'],
            ['**Checking…**', 'The check is running. Nothing has changed yet.'],
            ['**Needs changes**', 'The check flagged it; nothing was published. Open the set to see why.'],
            ['**Waiting for Engage**', 'A person at Engage is looking at it.'],
            ['**Checked**', 'It passed the check and has not been published.'],
            ['Shared v3', 'Version 3 is in the public library. "Shared v3, yours is v5" means your later changes are not shared yet.'],
            ['**Everyone**, **Public**', 'Engage\'s own set, or another organisation\'s public set.'],
          ],
        },
      ],
    },
    {
      id: 'sent-back',
      title: 'When the check sends a set back',
      icon: 'Warning',
      blocks: [
        {
          t: 'p',
          text: 'Open the set. A banner at the top lists **What was flagged**, question by question, with the reason. Fix those questions in the Questions panel and save, then press **Resubmit**.',
        },
        {
          t: 'p',
          text: 'If you think the check is wrong, press **Ask for a human review**, say why if you like, and **Send**. A reviewer at Engage reads the set as the check saw it, and the outcome shows on the row.',
        },
      ],
    },
    /*
      PublicLibraryPanel.jsx mode="org": COPY.org note, "Share a set",
      row actions "Preview" (opens the editor; saving copies) and "Copy to my
      team" (the label is the same in Your space). No State column.
    */
    {
      id: 'using-public-sets',
      title: 'Using a public set',
      icon: 'Books',
      blocks: [
        {
          t: 'p',
          text: 'Public library lists sets that other organisations have shared and that passed the check, with who published each one. Your own shared sets appear there too.',
        },
        {
          t: 'list',
          items: [
            { title: '**Preview**', text: 'Read it in the editor. Saving from there makes your own copy.' },
            { title: '**Copy to my team**', text: 'Copies it into the space you are in now (in Your space too). The copy is yours to change.' },
          ],
        },
        {
          t: 'p',
          text: 'Public sets also appear in Question sets with the Public tag, so you do not have to copy one to host it.',
        },
      ],
    },
  ],
};

/* ------------------------------------------------------ sessions, events */

const gameManagement = {
  id: 'admin-game-management',
  title: 'Sessions and events',
  icon: 'GameController',
  summary: 'What was run in this space, deleting sessions, the events list, and what to check when a host says it went wrong.',
  sections: [
    /*
      SessionsPanel.jsx; GET /games is scoped to the active organisation
      (get-games-list.js callerOrgId/gamesIndexPk). Columns Session (title,
      Set, host), Code, Type, State (Played / Never started; events Ended
      etc.), Players, Rounds, Created, Last played. Filters: type, state,
      sort (Recently played). Build Room rows: Open, Report. Event rows: Open,
      a disclosure listing items (Open session / Session expired).
    */
    {
      id: 'sessions-list',
      title: 'The Sessions list',
      icon: 'GameController',
      blocks: [
        {
          t: 'p',
          text: 'Sessions lists what was run in the space you are working in: its title, set and host, its code, type, whether it was **Played** or **Never started**, how many players and rounds, and when it was created and last played. Search by title, code or host, or filter by type and state.',
        },
        {
          t: 'list',
          items: [
            { title: 'Events', text: 'An event is one row. Click its name to see its items and open the session each one ran.' },
            { title: 'Build Room', text: 'Its row has **Open** and **Report**.' },
            { title: 'Other reports', text: 'A host opens a session\'s report from Sessions on their start screen; saved reports are under Reports there.' },
          ],
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'It is not an archive',
          text: 'Sessions disappear when they expire (see Data & privacy: How long things are kept). Save the report of anything that matters while the session still exists.',
        },
      ],
    },
    /*
      deleteRole (game/tenant.js): the host who created it, or an owner/admin
      of the team; otherwise the button is disabled with "Only the host who
      created it, or an owner or admin of this team, can delete it."
      "Delete all sessions…" only with a role for the whole list; type
      DELETE_ALL_PHRASE "delete all sessions". Question sets are not touched.
      Event delete: "Its agenda, its join code and the sessions its items ran
      go with it… Saved reports are kept." Staff give a reason (W10).
    */
    {
      id: 'deleting-sessions',
      title: 'Deleting sessions',
      icon: 'Trash',
      blocks: [
        {
          t: 'p',
          text: '**Delete** on a row removes that session with every answer, vote and player in it, after you confirm. The host who created it can delete it, and so can the team\'s owners and admins; for anyone else the button is greyed out.',
        },
        {
          t: 'p',
          text: 'Deleting an event takes its agenda, its join code and the sessions its items ran. Saved reports are kept.',
        },
        {
          t: 'p',
          text: '**Delete all sessions…** (owners and admins, and you in Your space) counts what will go, then asks you to type delete all sessions to confirm. A session running right now stops on the players\' phones. Question sets are never touched.',
        },
      ],
    },
    /*
      EventsPanel.jsx: plan gate TeamPlanOnly ("Events come with the <plan>",
      request button for the owner, "What the <plan> adds"); "New event" in
      the head and the empty state; search "Search events"; "Upcoming N" /
      "Past N"; columns Event, When, Items, Who can join ("Invite only" /
      "Anyone with the code"), Code, State (Draft, Scheduled, Running, Ended,
      "N joined"); "Open" → EventBuilder. Building and running: host-events (W6).
    */
    {
      id: 'events-list',
      title: 'The Events list',
      icon: 'CalendarBlank',
      blocks: [
        {
          t: 'p',
          text: 'Events puts a whole agenda (sessions, talks and breaks) behind one join code. Events come with a paid plan: on the free plan this page says which plan brings them, and the owner can request it there.',
        },
        {
          t: 'list',
          items: [
            { title: '**New event**', text: 'Name it first, then build its agenda.' },
            { title: '**Upcoming** and **Past**', text: 'Switch between events from today on and earlier ones. Search by title, place or code.' },
            { title: 'The row', text: 'When it is, how many items, who can join (invite only, or anyone with the code), its code, and its state: Draft (no items yet), Scheduled, Running or Ended, with how many joined.' },
            { title: '**Open**', text: 'Opens the event\'s agenda. Building it and running it on the day are in the host guides.' },
          ],
        },
      ],
    },
    /*
      "Nothing updated on screen": the console's polling switch changes only
      the browser it is set in, and players no longer poll (PlayerPage.jsx
      "REMOVED: HTTP polling"); the live connection and what to do are owned by
      technical-troubleshooting#screens-not-keeping-up (W11).
    */
    {
      id: 'when-it-went-wrong',
      title: 'When a host says it went wrong',
      icon: 'Wrench',
      blocks: [
        {
          t: 'list',
          items: [
            { title: '"Players could not join"', text: 'Check the session was started, not merely created. A created session is not joinable yet.' },
            { title: '"Nothing updated on screen"', text: 'Screens follow the host over a live connection, and some networks block it. See Troubleshooting: Screens are not keeping up. The switch in Settings changes only the browser it is set in, so it will not fix a room.' },
            { title: '"Workie said nothing"', text: 'Check the set\'s Workie settings in the editor, and that the prompt it uses is Active.' },
            { title: '"The reveal never happened"', text: 'The question\'s reveal field is empty. That is the set, not the session.' },
          ],
        },
      ],
    },
  ],
};

/* -------------------------------------------------------------- settings */

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
          text: 'These are local to the browser you set them in. Changing one here changes nothing for a host on another machine or for anyone in the room, and clearing site data resets them. They are for diagnosing, not for configuring Engage.',
        },
      ],
    },
    /*
      AdminPage.jsx Settings: "Enable WebSocket Mode (Real-time Updates)",
      stored as admin_websocket_mode in localStorage. The host page has it
      hardcoded on (GameHostPage useWebSocket true); PlayerPage reads the
      local switch and has no polling fallback any more ("REMOVED: HTTP
      polling"), so turning it off only stops a player screen in this
      browser from following. The panel's own copy still promises polling.
    */
    {
      id: 'real-time-communication',
      title: 'Real-time communication',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'p',
          text: 'Leave **Enable WebSocket Mode (Real-time Updates)** on. Host and player screens follow the session over a live connection, and the switch changes only this browser: your host screens stay on the live connection whatever it says, and a player screen opened in this browser stops following the session when it is off.',
        },
        {
          t: 'p',
          text: 'If a room is not keeping up, the answer is in Troubleshooting: Screens are not keeping up.',
        },
      ],
    },
    {
      id: 'debug-settings',
      title: 'Debug settings',
      icon: 'Bug',
      blocks: [
        {
          t: 'list',
          items: [
            { title: '**Show AI Prompts in Debug Mode**', text: 'Shows the prompt actually sent to the model above Workie\'s output, with every placeholder filled in. When Workie says something inexplicable, this is where the explanation is.' },
            { title: '**Prompt Improvement Debug Mode**', text: 'On the host\'s results page, a side panel shows every prompt variable and the value it had. For improving prompts.' },
          ],
        },
      ],
    },
  ],
};

/**
 * The admin-console area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'admin-console',
  guides: { admin: [gettingStarted, questionSets, publicLibrary, gameManagement, settings] },
};
