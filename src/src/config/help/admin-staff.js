/*
  ENGAGE STAFF: THE ENGAGE SECTIONS OF THE CONSOLE (help refresh Phase 2, W10).

  For accounts in the `admins` Cognito group working "as Engage" (the Engage
  tab of the scope row; config/consoleSections.js sectionsFor, PLATFORM_MODE).
  Five guides: the console and its queues; organisations, plans and codes;
  accounts; Engage's library, the public library and moderation; observability,
  Engage settings and the archive. Engage's prompt library is the AI guide's
  (./ai.js, admin-ai-prompts); this file names it and links there.

  Moved here from ./admin-console.js, ids kept (HELP_SECTION_MOVES in
  ./index.js): `admin-question-sets#moving-between-environments`. Also taken
  from there: the Engage row's detail in `admin-getting-started#console-sections`
  (a pointer stays) and the group table of `admin-getting-started#first-thing`
  (now `admin-staff-accounts#kinds-of-account`).

  Checked against the code at 6a5aa8f7. NOT checked on dev: the stored QA
  account is in `hosts` only on dev (its refreshed id token, 22 Oct 2026), so
  the Engage tab does not appear for it and every staff section was read from
  the code alone. Every **Label** exists in src/src.
*/

/* ------------------------------------------------------------ the console */

const staffConsole = {
  id: 'admin-staff-console',
  title: 'Engage staff: the console',
  icon: 'ShieldCheck',
  summary: 'Working as Engage, what each staff section is for, what staff cannot see, and the queues on the Overview and in the bell.',
  sections: [
    /*
      ScopeTabs.jsx: the Engage entry (role word "Staff") after the teams, only
      for staff (overviewAlerts.scopeList staff). Choosing it sets the active
      org to PLATFORM_MODE ('~platform'), remembered in localStorage like any
      scope (AdminPage handleScopeSelect). sectionsFor(mode PLATFORM_MODE): one
      group "Engage", in this order, Overview first (the landing section).
      Subtitles: consoleSections.js SECTION.*.
    */
    {
      id: 'engage-mode',
      title: 'Working as Engage',
      icon: 'ShieldCheck',
      blocks: [
        {
          t: 'p',
          text: 'Engage staff are the accounts that are Engage admins. For them the row along the top of the console ends with **Engage**, marked Staff. Pick it to work as Engage rather than in Your space or a team: the console reloads with one menu, Engage, and opens on its Overview. This browser remembers the choice, as it does for any space.',
        },
        {
          t: 'table',
          head: ['Section', 'What it is for'],
          rows: [
            ['Overview', 'What waits on staff, and the platform in numbers.'],
            ['Organisations', 'Every team and personal space: approve, suspend, reinstate, billing.'],
            ['Observability', 'How Engage is used, in totals.'],
            ['Plan requests', 'New teams and plan changes waiting for a decision.'],
            ['Discount codes', 'Codes a team owner can name when they request a plan.'],
            ['Shared library', 'Engage\'s own question sets, which every organisation reads.'],
            ['Prompts', 'Engage\'s prompt library, the only place a prompt is changed (see Prompts).'],
            ['Public library', 'What organisations have published: score cards and taking a set down.'],
            ['Moderation', 'Sets the content check held for a person.'],
            ['Accounts', 'Approving people who signed up; making staff, disabling, deleting.'],
            ['Archive', 'Backups shared by dev, test and prod.'],
            ['Engage settings', 'The Claude models and the site look, for everyone.'],
          ],
        },
      ],
    },
    /*
      PlatformOrgsPanel.jsx .porgs-note ("There is no “view their sets”
      button…"); platform-orgs.js header (tenant.canManageScope gives staff no
      scope inside an org). UserManagement.jsx um-note--roles. Logs:
      manage-users.js recordAudit into the person's personal space;
      platform-orgs.js recordAudit on the org; StaffStatsDrill.jsx
      "Viewing as Engage staff. This visit is recorded in …'s audit log";
      overviewAlerts.staffOpenedBox ("Engage staff opened your content").
    */
    {
      id: 'what-you-cannot-see',
      title: 'What being staff does not give you',
      icon: 'Lock',
      blocks: [
        {
          t: 'p',
          text: 'Being Engage staff does not open any organisation\'s question sets, sessions, answers or reports. They are encrypted with that organisation\'s own key, and nothing in the Engage menu reads them. Organisations has no button to view a team\'s sets, on purpose.',
        },
        {
          t: 'p',
          text: 'What staff do is recorded where the people affected can read it. A change to an account goes in that person\'s log; approving, suspending or reinstating an organisation goes in its log; opening a team\'s numbers from Observability is recorded in that team\'s log. A team sees staff entries on its Overview and in Data & privacy.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Hosting as yourself',
          text: 'To run sessions or build sets of your own, switch back to **Personal** or a team in the same row. Anything made while working as Engage belongs to Engage.',
        },
      ],
    },
    /*
      OverviewPanel.jsx platform scope: heading "Needs Engage", empty "Nothing
      needs Engage."; boxes from overviewAlerts.js accountsBox ("Accounts
      awaiting approval", actions Reject / Approve as host), planQueueBox
      ("Plan requests", Decide → DecideRequestDialog), moderationBox ("Sets
      waiting in Moderation", Review), claudeBox ("Claude 5.5 is chosen but not
      connected", link Engage settings); tiles from platform/observability.
      Bell: my-notifications.js platformEntries (platform.accounts,
      platform.plan-requests, platform.moderation), each linking to its
      section in Engage; NotificationsBell.jsx: live entries stay unread while
      the thing waits; "Mark all read".
    */
    {
      id: 'needs-engage',
      title: 'What waits on staff: the Overview and the bell',
      icon: 'Bell',
      blocks: [
        {
          t: 'p',
          text: 'Engage\'s Overview lists, under **Needs Engage**, each queue that has something in it. When nothing waits it says **Nothing needs Engage.**',
        },
        {
          t: 'list',
          items: [
            { title: '**Accounts awaiting approval**', text: 'People who registered and cannot host yet. **Approve as host** or **Reject** from the box, or open Accounts.' },
            { title: '**Plan requests**', text: '**Decide** opens the same decision as Plan requests does.' },
            { title: '**Sets waiting in Moderation**', text: '**Review** opens the set.' },
            { title: '**Claude 5.5 is chosen but not connected**', text: 'Every AI call on this tier is being answered by the Bedrock models. See Engage settings.' },
          ],
        },
        {
          t: 'p',
          text: 'Below the boxes are the platform\'s numbers, as in Observability. The bell carries the same three queues, one entry each (for example, 2 accounts waiting for approval); a click switches to Engage and opens that section. Such an entry stays unread for as long as something waits; **Mark all read** does not clear it.',
        },
      ],
    },
  ],
};

/* ------------------------------------------ organisations, plans and codes */

const organisations = {
  id: 'admin-staff-organisations',
  title: 'Organisations, plans and discount codes',
  icon: 'Buildings',
  summary: 'Approving, suspending and reinstating an organisation, its billing ledger, deciding plan requests, and discount codes.',
  sections: [
    /*
      PlatformOrgsPanel.jsx: counts line (teams, personal spaces, waiting,
      suspended), "Staff activity…", columns Organisation (Personal tag,
      "since Mon YYYY") / Plan (Team or Free) / Members / Status (Active,
      Pending, Suspended). Row: Approve (pending → active), Reinstate
      (suspended → active), Billing…, Activity… (AuditLogDialog for the org),
      Suspend (active teams only; one click, no confirm). platform-orgs.js:
      personal spaces refused ("A personal space cannot be suspended. Disable
      the account instead."); the audit entry is written first or nothing
      changes (503). create-org.js: a new team is written 'active' on Free and
      files a new-organisation plan request. What a suspension does to the
      team's members is not enforced anywhere in the code at 6a5aa8f7, so the
      help says only what the screen shows.
    */
    {
      id: 'organisations',
      title: 'The Organisations list',
      icon: 'Buildings',
      blocks: [
        {
          t: 'p',
          text: 'Organisations lists every team and personal space on this tier, teams first: its name and how long it has existed, its plan, how many members it has and its status (Active, Pending or Suspended). The line at the top counts them.',
        },
        {
          t: 'list',
          items: [
            { title: '**Approve**', text: 'On a Pending organisation: makes it Active.' },
            { title: '**Suspend**', text: 'On an active team: marks it Suspended. It takes effect on the click, with no confirmation. A personal space cannot be suspended: to stop a person, disable their account in Accounts.' },
            { title: '**Reinstate**', text: 'On a Suspended organisation: makes it Active again.' },
            { title: '**Billing…**', text: 'The organisation\'s billing ledger (next section).' },
            { title: '**Activity…** and **Staff activity…**', text: 'Activity… is one organisation\'s log of who changed what. Staff activity…, at the top, lists every staff action across organisations.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'New teams do not wait here',
          text: 'A new team starts at once, Active, on the free plan. Its request for the paid plan arrives in Plan requests. Each status change is written to the organisation\'s log first; if that cannot be done, nothing changes.',
        },
      ],
    },
    /*
      OrgBillingDrawer.jsx: "<org> — billing", "<period>, if it ended today"
      (AdjustedBill), "Adjustments" (AdjustmentsLedger, Revoke per row),
      "Grant an adjustment" → GrantAdjustmentDialog: KINDS Credit / Months at
      a discount / Special rate / Extra allowance, "Applies from", "Reason
      (required — the customer reads it)", a preview "<period>, with this
      grant", the button names the grant. RevokeDialog "Revoke this
      adjustment?": "The row stays on their ledger, marked revoked with your
      reason." Dialog copy: "they see it on Plan & usage".
    */
    {
      id: 'billing',
      title: 'An organisation\'s billing',
      icon: 'CreditCard',
      blocks: [
        {
          t: 'p',
          text: '**Billing…** opens the organisation\'s ledger: this period\'s bill as it would be if the period ended today, and every adjustment ever granted, with who granted it, when and why.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Press Grant an adjustment', text: 'Choose the kind: **Credit** (an amount in their favour that carries forward until spent), **Months at a discount** (a percentage or amount off, for some months), **Special rate** (a different base price, for a while) or **Extra allowance** (more included sessions or sets, no money).' },
            { title: 'Fill it in', text: 'Set the amount, the months and **Applies from**. The dialog shows this period with the grant before anything is written.' },
            { title: 'Give a reason and grant it', text: 'A reason is required: the customer reads it on their Plan & usage screen. The button says what it will grant.' },
          ],
        },
        {
          t: 'p',
          text: 'To take one back, press **Revoke** on its row and give a reason. The row stays on their ledger, marked revoked with your reason.',
        },
      ],
    },
    /*
      PlanRequestsPanel.jsx: "Show" select (Waiting default, Approved,
      Declined, Withdrawn, All), columns Organisation (sub "new organisation"
      or type · requester), Asked, Plan (from → to), Code, Note; "Decide…" →
      DecideRequestDialog: Decision Approve ("plan changes now") / Decline
      ("nothing changes; they can ask again"), "Note to the customer
      (required)", "Shown to them word for word on their Plan & usage screen,
      and kept in their plan history with your name." The primary button is
      the decision's name. plan-requests.js decide: a named code is redeemed
      in the same transaction; a code that cannot be redeemed refuses the
      approval (409) and the dialog shows the error. The nav badge counts
      waiting requests.
    */
    {
      id: 'plan-requests',
      title: 'Deciding a plan request',
      icon: 'CreditCard',
      blocks: [
        {
          t: 'p',
          text: 'Plan requests lists what organisations have asked for: a new team asking for the paid plan, or an owner asking to change plan. Each row shows who asked and when, the plan they are on and the one they want, any discount code they named, and their note. **Show** picks Waiting (the default), Approved, Declined, Withdrawn or All.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Press Decide…', text: 'It opens the request with their note.' },
            { title: 'Choose', text: '**Approve** changes their plan now. **Decline** changes nothing, and they can ask again.' },
            { title: 'Write to them', text: 'The **Note to the customer** is required. They read it word for word on their Plan & usage screen, and it is kept in their plan history with your name.' },
            { title: 'Confirm', text: 'The button is named for your decision.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'A code they named',
          text: 'It is applied when you approve, as an adjustment on their ledger. If it can no longer be used (retired, expired or used up), the approval is refused and the dialog says why: decline and tell them, or ask them to request again without it.',
        },
      ],
    },
    /*
      DiscountCodesPanel.jsx: count, "New code"; columns Code (chip Expired /
      Used up / Retired), Gives, Valid ("to …" / "no end"), Uses ("N of M" or
      "N, no cap"), Note; "Retire" with confirm ("Nobody can redeem it after
      this; teams that already used it keep their discount."). NewCodeDialog
      "New discount code": Code (letters, digits and dashes), Gives (% off / $
      off, for N months; empty months = ongoing), "Valid until (optional)",
      "Max uses" ("One redemption per team, whatever the cap. Blank for no
      cap."), "Note (staff only)", a preview against the list month, button
      "Create <CODE>".
    */
    {
      id: 'discount-codes',
      title: 'Discount codes',
      icon: 'FlagCheckered',
      blocks: [
        {
          t: 'p',
          text: 'A team owner can name a discount code when they request a plan. It is applied when the request is approved, as a row on that team\'s ledger. Discount codes lists every code with what it gives, until when, and how many times it has been used.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Press New code', text: 'It opens **New discount code**.' },
            { title: 'Fill it in', text: '**Code** is what the customer types: letters, digits and dashes. **Gives** is a percentage or an amount off, for a number of months; leave the months empty for ongoing. **Valid until** is optional. **Max uses** can be left blank for no cap; a team can use a code only once. The **Note** is for staff only.' },
            { title: 'Check and create', text: 'A preview shows what a team would be charged. The create button carries the code\'s name.' },
          ],
        },
        {
          t: 'p',
          text: '**Retire** stops a code being used, after you confirm; teams that already used it keep their discount. Codes are retired, never deleted. A code also stops on its own when it expires or is used up.',
        },
      ],
    },
  ],
};

/* ---------------------------------------------------------------- accounts */

const accounts = {
  id: 'admin-staff-accounts',
  title: 'Accounts',
  icon: 'UserCircle',
  summary: 'Approving people who signed up, what each kind of account can do, and making someone staff, disabling or deleting an account.',
  sections: [
    /*
      UserManagement.jsx: "Waiting for approval" ("Registration puts people
      here. Nothing else does."), "Oldest has waited N days", rows: "Signed up
      … · <Google|Cognito> · email confirmed / not confirmed"; "Approve as
      host" (→ hosts), "Admin" (→ admins), "Reject" with confirm ("They move to
      Disabled and cannot sign in. The account is kept, so this can be undone
      from the members list. Nothing is deleted."). Empty: "Nobody is
      waiting." Team-route approval: TeamPanel "Approve hosting" (admin-team.js,
      admin-members guide).
    */
    {
      id: 'approving',
      title: 'Approving someone who signed up',
      icon: 'CheckCircle',
      blocks: [
        {
          t: 'p',
          text: 'A new account lands in **Waiting for approval** at the top of Accounts. Until someone decides, it can sign in and do nothing else. Each person shows when they signed up, how they sign in, and whether their email is confirmed; the oldest wait is shown at the top.',
        },
        {
          t: 'list',
          items: [
            { title: '**Approve as host**', text: 'The usual answer. They can create and run sessions.' },
            { title: '**Admin**', text: 'Approves them as an Engage admin instead: Engage staff (see the next section).' },
            { title: '**Reject**', text: 'Asks first, then moves them to Disabled: they cannot sign in. The account is kept, so it can be restored from the members list below.' },
          ],
        },
        {
          t: 'p',
          text: 'Someone who joined a team by invitation can also be let in by that team\'s owners or admins, from the team\'s Members (see Members).',
        },
      ],
    },
    /*
      Moved from admin-getting-started#first-thing (the group table), with the
      words the screen uses: ROLE_META Engage admin / Host / Disabled /
      Pending; um-note--roles ("Engage admin is Engage staff … It grants no
      access to any organisation’s question sets, sessions or reports").
      Disabled is Cognito's account flag, not a group (manage-users.js).
    */
    {
      id: 'kinds-of-account',
      title: 'What each kind of account can do',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'table',
          head: ['Account', 'Can'],
          rows: [
            ['Host', 'Create and run sessions, and manage their own question sets. What an ordinary account needs.'],
            ['Pending', 'Sign in and nothing else. Waiting for approval.'],
            ['Engage admin', 'Engage staff: the Engage sections of this console. No access to any organisation\'s sets, sessions or reports.'],
            ['Disabled', 'Nothing: they cannot sign in. The account is kept.'],
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Not a team admin',
          text: 'An Engage admin is unrelated to an admin of a team. A team role is given in that team\'s Members and means nothing anywhere else.',
        },
      ],
    },
    /*
      UserManagement.jsx Members: "Members · N", search "Search name, email,
      username", filter Active / Admins / Hosts / Disabled with counts; columns
      Person / Role / Signed in with / Joined; MOVE_VERB for the roles the
      person is not in (Make Engage admin / Make host / Disable, no confirm);
      the bin ("Remove <name>") with confirm ("They lose access immediately
      and would have to register again from scratch. Sessions they hosted and
      any question sets they uploaded are not affected."). um-cap: 60 accounts.
      manage-users.js: lockoutRefusal (last Engage admin; own disable/delete),
      the audit entry first or nothing changes (503), a move to hosts/admins
      re-enables a disabled account (AdminEnableUser).
    */
    {
      id: 'changing-access',
      title: 'Changing or removing an account',
      icon: 'UserCircle',
      blocks: [
        {
          t: 'p',
          text: 'Below the queue, Members lists every approved account. Search by name, email or username, and filter with **Active**, **Admins**, **Hosts** or **Disabled**. Each row offers only the moves that apply to that person:',
        },
        {
          t: 'list',
          items: [
            { title: '**Make Engage admin**', text: 'Makes them Engage staff, with every Engage section.' },
            { title: '**Make host**', text: 'Makes them a host. On a disabled account it also lets them sign in again.' },
            { title: '**Disable**', text: 'They cannot sign in. Nothing is deleted.' },
            { title: 'The bin', text: 'Deletes the account, after you confirm. They lose access at once and would have to register again. Sessions they hosted and sets they uploaded are not affected.' },
          ],
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'What Engage refuses',
          text: 'It will not remove the last Engage admin (make someone else one first), and you cannot disable or delete your own account. Every change is written to the person\'s own log first; if that cannot be done, nothing changes.',
        },
        {
          t: 'p',
          text: 'The list holds at most 60 accounts, and the search and filters work on those.',
        },
      ],
    },
  ],
};

/* ---------------------------- Engage's library, public library, moderation */

const content = {
  id: 'admin-staff-content',
  title: 'Engage\'s library, the public library and moderation',
  icon: 'Books',
  summary: 'Engage\'s shared library, the public library from the staff side, score cards and taking a set down, and the moderation queue.',
  sections: [
    /*
      consoleSections.js SECTION.platformsets ("Shared library", "Engage’s
      own question sets. Every organisation can read these and copy them;
      none can change them."). AdminPage: visibleSets filtered to scope
      platform; NewSetDialog scope 'platform'; QuestionSetsPanel gets no
      showVisibility/onShare in platform mode. DestinationField.jsx "Save
      into" option "Engage — the shared library (staff)".
      check-question-set.js: "There is no public copy of an Engage set".
    */
    {
      id: 'shared-library',
      title: 'The Shared library',
      icon: 'Books',
      blocks: [
        {
          t: 'p',
          text: 'Shared library holds Engage\'s own question sets. Every organisation can read them and copy them; none can change them. It is the Question sets list (see Question sets: Finding a set) showing Engage\'s sets only, and without sharing: Engage\'s sets are already everyone\'s, so they never go through the content check or into the public library.',
        },
        {
          t: 'list',
          items: [
            { title: 'Adding a set', text: '**New set** here makes the set in the shared library, not in Your space. In an AI builder, choose **Engage — the shared library (staff)** under **Save into**.' },
            { title: 'Keeping it tidy', text: 'An active set is offered to hosts in every organisation on this tier, so keep anything unfinished Inactive.' },
          ],
        },
      ],
    },
    /*
      PublicLibraryPanel.jsx mode="platform": COPY.platform; row actions
      "Score card" and "Unpublish" (UnpublishDialog: "Unpublish “…”?", "It
      is gone for everyone. The organisation keeps their copy and sees your
      note in their editor.", "Note to the organisation (required)", button
      disabled until a note is typed).
    */
    {
      id: 'staff-public-library',
      title: 'The public library, as staff',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'p',
          text: 'Public library in the Engage menu lists every set organisations have published and that passed review. Each row has **Score card** (next section) and **Unpublish**.',
        },
        {
          t: 'p',
          text: '**Unpublish** asks for a **Note to the organisation (required)**. Once you confirm, the set is gone from the library for everyone. The organisation keeps its own copy and sees your note in its editor.',
        },
      ],
    },
    /*
      ScoreCard.jsx (platform mode): "← Public library"; title, type,
      questions; "Take down" (TakedownDialog, required note); "Leave it
      serving" only when a staff re-check queued it (canLeave); "Timeline"
      (checked, "Sent to a person", Approved/Rejected by, unpublished…);
      "The latest check" with "Run the check again" (RecheckDialog: "It
      changes nothing anyone can see", "It does not undo a decision a person
      made", "If it comes out worse than it stands … Nothing is taken down.
      The listing goes to the queue", "usually finishes in under a minute.
      Leaving this card keeps it running"); "Verdict:", "Why a person was
      needed:", the per-category table (Category / Worst / Questions).
    */
    {
      id: 'score-card',
      title: 'Reading a score card',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: 'A score card is one published set\'s record. It opens from the staff Public library or from a Moderation row; **← Public library** goes back. It shows a **Timeline** of everything that happened to the set (checked, sent to a person, approved or rejected, unpublished), then **The latest check**: the verdict, why a person was needed if one was, and for each category the worst level the check saw and in how many questions.',
        },
        {
          t: 'list',
          items: [
            { title: '**Take down**', text: 'The same as Unpublish: a required note, gone for everyone, and the organisation keeps its copy.' },
            { title: '**Run the check again**', text: 'Re-checks the version the set came from. It publishes nothing, changes nothing anyone sees and does not undo a person\'s decision. If it comes out worse, nothing is taken down: the set goes to Moderation for a person. It usually takes under a minute and keeps running if you leave.' },
            { title: '**Leave it serving**', text: 'Shown when a re-check is waiting on a person. It clears that entry and changes nothing else.' },
          ],
        },
      ],
    },
    /*
      ModerationPanel.jsx: lede "The check escalates rather than guessing…",
      empty "Nothing is waiting — the check decided everything on its own.";
      columns Set / Organisation (Engage for a platform row) / Why it
      escalated (moderationRow.whyLabel: uncertain questions, Appealed,
      Reported, Declared, Images, Out of time…) / Waiting; row actions Score
      card (when published), Review, or Leave it serving (re-check rows and
      Engage's own sets). ReviewDialog: uncertain questions first, the set's
      own flagged text, "Note to the organisation (they read it on reject)",
      Close / Reject / Approve (Approve publishes: moderation-decide.js);
      "Already decided by …" when another reviewer won.
    */
    {
      id: 'moderation',
      title: 'The moderation queue',
      icon: 'FlagCheckered',
      blocks: [
        {
          t: 'p',
          text: 'Moderation lists the sets the content check would not decide on its own, with **Why it escalated** and how long each has waited: questions it was unsure about, an appeal from the organisation, a report, a content notice the author declared, images, or a check that ran out of time. The check is cautious, so many are fine.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Press Review', text: 'The set opens with the questions the check could not decide first, each with what it saw and why. If the set\'s own text was flagged, that text is shown too.' },
            { title: 'Decide', text: '**Approve** publishes it. **Reject** sends it back; write a note first, because the organisation reads it. **Close** leaves it waiting.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Rows without Review',
          text: 'A row for one of Engage\'s own sets, or one raised by a re-check of a set already in the library, offers **Leave it serving** instead (it clears the row and changes nothing) and, for a published set, its **Score card**. If another reviewer decided first, the dialog says so and the row goes.',
        },
      ],
    },
  ],
};

/* ------------------------------------- observability, settings, archive */

const platform = {
  id: 'admin-staff-platform',
  title: 'Observability, Engage settings and the archive',
  icon: 'SlidersHorizontal',
  summary: 'How Engage is used, in numbers; the Claude models and the site look for everyone; and backing up and moving sets between dev, test and prod.',
  sections: [
    /*
      ObservabilityPanel.jsx: subtitle "Totals only — nothing a team wrote is
      read to make them"; "Refresh"; tiles Accounts / Organisations / Question
      sets / Stored reports; PlatformStatsBlock (StaffStatsDrill.jsx) "Teams
      this month", tabs Teams / Engage sets / Public sets, "Download CSV",
      a team drill ("Viewing as Engage staff. This visit is recorded in …'s
      audit log. Counts only."); "By month" (Created, Started, Counted,
      Questions, Per session, Answers), "By category"; "What each number
      means" (DEFINITIONS).
    */
    {
      id: 'observability',
      title: 'Observability: Engage in numbers',
      icon: 'ChartLineUp',
      blocks: [
        {
          t: 'p',
          text: 'Observability shows how Engage is being used, in totals only: nothing a team wrote is read to make them. **Refresh** reads them again.',
        },
        {
          t: 'list',
          items: [
            { title: 'Right now', text: 'Accounts, organisations, question sets and stored reports.' },
            { title: 'This month, by team', text: 'Every team, most counted first. Open one to see its numbers; the visit is recorded in that team\'s log. **Engage sets** and **Public sets** list sets by use instead. **Download CSV** takes the month away.' },
            { title: '**By month** and **By category**', text: 'Sessions created, started and counted, questions asked and answers given, month by month and by question category.' },
          ],
        },
        {
          t: 'p',
          text: '**What each number means**, at the foot, defines every column. Counted is the number a plan counts: sessions where two questions were answered.',
        },
      ],
    },
    /*
      Engage settings = ClaudeModelsPanel.jsx + SiteSkinPanel.jsx; subtitle
      "Every change is written to the audit log." Claude: "Claude models",
      "Now: …", switch "Anthropic 5.5" (no confirm), the map with "In use",
      NOT_CONNECTED (switch disabled), foot "A change reaches every function
      within a minute. A call that fails on the Anthropic API is answered by
      the Bedrock model." Site look: radio list with "In use", "Why (written
      to the audit log)" optional, "Use <look> for everyone", "Preview <look>
      in this browser" / "End preview", "A running … or stage keeps its look
      until it is reloaded."
    */
    {
      id: 'engage-settings',
      title: 'Engage settings',
      icon: 'SlidersHorizontal',
      blocks: [
        {
          t: 'p',
          text: 'Two settings that change Engage for everyone on this tier. Every change is written to the audit log. (The **Settings** at the foot of the menu is different: three switches for this browser only.)',
        },
        {
          t: 'list',
          items: [
            { title: '**Claude models**', text: 'The **Anthropic 5.5** switch. On, which is the default, Engage\'s AI calls go to the newer Claude models on the Anthropic API, and a call that fails there is answered by the Bedrock model. Off, every call stays on Bedrock. **In use** marks the model answering now. A change reaches everything within a minute. If this tier has no Anthropic connection, the switch is greyed out and says so.' },
            { title: '**Site look**', text: 'The look every page wears. Choose one and try it in this browser only with its Preview button (**End preview** stops it), then press the button that applies it for everyone. A reason is optional and goes in the audit log. A stage or room\'s window that is already open keeps its look until it is reloaded.' },
          ],
        },
      ],
    },
    /*
      ArchivePanel.jsx: "Archive", "One shared store, all environments.";
      "Export from <tier>…" → "Back up from <tier>" ("Engage and public
      content only. Organisation content is encrypted per organisation and is
      never archived."; sets and Engage prompts, "Export N sets/prompts");
      filters Environment / Content type / Engagement type, search; columns
      Item / From / Type / Size / Exported; row "Download", "Delete" →
      "Delete the backup" ("removes it for dev, test and prod alike. The set
      it was made from is not touched."); select rows → "Import N selected" →
      "Restore N backups into <tier>?" ("A set that already exists gets a new
      version and switches to it…", "An active Engage set is live for every
      organisation the moment it is restored."). Down state: "The archive did
      not answer" with the CSV-by-hand fallback.
    */
    {
      id: 'archive',
      title: 'The archive',
      icon: 'Package',
      blocks: [
        {
          t: 'p',
          text: 'Archive is one store shared by dev, test and prod: each reads it and can restore from it. It holds backups of Engage\'s sets and prompts and of public sets. A team\'s or personal space\'s content is encrypted for that organisation and is never archived. Each row says which environment it came from; filter by environment, content type or engagement type, or search.',
        },
        {
          t: 'list',
          items: [
            { title: 'Back up', text: 'Press Export from, followed by this environment\'s name, pick the sets and prompts, and export them.' },
            { title: 'Restore', text: 'Tick rows, press Import … selected, and confirm. A set that already exists here gets a new version and switches to it; the old version stays in its history. An active Engage set is live for every organisation the moment it is restored.' },
            { title: '**Download** and **Delete**', text: 'Download saves a backup as a file. Delete asks first (**Delete the backup**) and removes it for every environment; the set it was made from is not touched.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'When the archive does not answer',
          text: 'Nothing is wrong with this environment\'s sets. To move a set meanwhile, download its CSV from the editor\'s Questions and upload it in the other environment.',
        },
      ],
    },
    /*
      Moved from admin-question-sets (W8's guide), id kept; HELP_SECTION_MOVES
      in ./index.js. Corrected on the move: the linked prompt is the set's
      Workie (results) prompt, not a generation prompt, and with no match the
      set uses the type's default. archive-prompt-link.js: the prompt link travels as a
      `prompt:<name>` tag and is re-resolved by name on import; no match
      imports the set unlinked (it falls back to the type's default).
    */
    {
      id: 'moving-between-environments',
      title: 'Moving sets between environments',
      icon: 'Package',
      blocks: [
        {
          t: 'p',
          text: 'The Archive section is shared: dev, test and prod all read and write the same store. That is how one of Engage\'s sets built on dev reaches prod: export it to the archive from one, import it on the other. A team\'s or a personal space\'s sets do not go through the archive.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'A set carries its prompt by name',
          text: 'A prompt is known by a different id in each environment, so the link between a set and its Workie prompt travels by the prompt\'s name. Import the prompt before the set, or the set arrives with no prompt linked and Workie uses the default for its type.',
        },
      ],
    },
  ],
};

/**
 * The admin-staff area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'admin-staff',
  guides: { admin: [staffConsole, organisations, accounts, content, platform] },
};
