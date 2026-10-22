/*
  RUNNING A TEAM, AND YOUR OWN SPACE'S ACCOUNT (help refresh Phase 2, W8).

  Members, Activity, Plan & usage, Data & privacy: the sections under "Team"
  (owners and admins; a member sees Members only) and, in Your space, under
  "Account" (config/consoleSections.js sectionsFor). What counts toward a plan
  is host-plan (./host-plan.js); this file links to it rather than restating it.

  Checked against the code at 47c35c9c and on dev (engage.dev, QA host: owner
  of two teams and Your space, 22 Oct 2026). The QA account is an owner
  everywhere, so the member's view of Members was read from the code only.
*/

/* ---------------------------------------------------------------- members */

const members = {
  id: 'admin-members',
  title: 'Members',
  icon: 'UsersThree',
  summary: 'Inviting people to a team, letting them host, changing roles, and removing someone or leaving.',
  sections: [
    /*
      TeamPanel.jsx: roster "Members · N" (Person, Role, Joined), roles
      Owner/Admin/Member (INVITABLE_ROLES details), the member notice "You are
      a host in …", lock texts "An admin can change this" / "Only an owner can
      change an owner" / "the last owner". Personal spaces have no Members
      section (consoleSections.js).
    */
    {
      id: 'who-is-here',
      title: 'Who is in the team, and what each role can do',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'p',
          text: 'Members lists everyone in the team and the invitations not yet accepted. Everyone in a team sees it; only owners and admins can change it. Your space has no Members section.',
        },
        {
          t: 'table',
          head: ['Role', 'Can'],
          rows: [
            ['Member', 'Build question sets and run sessions with the team\'s sets. Sees Members, but not Activity, Plan & usage or Data & privacy.'],
            ['Admin', 'All of that, plus inviting and removing people, changing roles, and the team\'s plan and privacy screens.'],
            ['Owner', 'Everything an admin can do. Only an owner can change another owner, or request a paid plan. A team always keeps at least one owner.'],
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'A role here is not an Engage account',
          text: 'The same person can be an admin of one team and a member of another. Whatever they make in a team belongs to the team, not to them.',
        },
      ],
    },
    /*
      InviteDialog: "Invite someone" / "Invite the first person", "Email
      address" (must be the sign-in address), "Role" (Member, Admin; owner
      cannot be invited), "Send invitation"; 14-day expiry; the link row "If
      they have no account yet, send them this" with "Copy" and "Email it".
      Invitations table: "Resend" (same invitation, same expiry), "Revoke" →
      "Revoke it". The invitee sees it on their Overview (overviewAlerts
      "Team invitations", Accept) and their start screen.
    */
    {
      id: 'inviting',
      title: 'Inviting someone',
      icon: 'Plus',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Press Invite someone', text: 'Owners and admins see it at the top of Members.' },
            { title: 'Their address and role', text: 'Use the **Email address** they sign in with: accepting checks the two match. Choose **Member** or **Admin**.' },
            { title: 'Send it', text: 'Press **Send invitation**. If they have no Engage account yet, the dialog shows their link: **Copy** it or **Email it** to them.' },
            { title: 'They accept', text: 'Signed in with that address, they find the invitation on their start screen and their Overview. Nothing is created until they accept.' },
          ],
        },
        {
          t: 'p',
          text: 'An invitation expires after 14 days. Under **Invited, not joined yet**, **Resend** sends the same invitation again, with the same expiry; **Revoke** stops the link working. Nobody is removed by revoking, and you can invite the address again.',
        },
      ],
    },
    /*
      approveHosting: shown to owners/admins when the member joined by the
      team's invitation, is still awaiting host approval (" · cannot host
      yet" under their address), and the team is not on Free
      (org-guards.js canApproveHosting; never in a personal space). The
      roster note: "an owner or admin can approve those here, and Engage can
      still refuse." A new team is Free until its Organisation plan request
      is approved (create-org.js). An invitee with no account: /invite/{token}
      (InviteAcceptPage.jsx) sends them to sign in or register
      (auth/RegisterForm.jsx "Create account") and accepts on arrival.
    */
    {
      id: 'approve-hosting',
      title: 'Letting a new member host',
      icon: 'CheckCircle',
      blocks: [
        {
          t: 'p',
          text: 'Someone new to Engage cannot run sessions until they are approved. A newcomer opens the invitation link you sent, chooses **Create account** with the address you invited, and is in the team when they arrive. Their row then says cannot host yet, and an owner or admin can press **Approve hosting**. The Overview lists them under Awaiting approval too.',
        },
        {
          t: 'p',
          text: 'The button is missing until the team is on a paid plan, and a new team stays on the free plan until Engage approves its Organisation plan request. Until then, and for anyone who did not join by invitation, Engage staff approve hosting. Engage can still refuse.',
        },
      ],
    },
    /*
      "Make admin" / "Make member" (owners/admins; an owner row only for an
      owner; change-member-role.js keeps one owner). Remove/Leave →
      ConfirmDialog "Remove them" / "Leave it"; consequences: they lose access
      to the team's sets, sessions and reports; everything they made stays;
      their Engage account is untouched. The last owner is locked. There is no
      control to make someone an owner.
    */
    {
      id: 'roles-and-removing',
      title: 'Changing a role, removing someone, leaving',
      icon: 'UserCircle',
      blocks: [
        {
          t: 'list',
          items: [
            { title: '**Make admin** / **Make member**', text: 'Owners and admins change a member\'s or admin\'s role on their row. An owner\'s row can only be changed by an owner.' },
            { title: '**Remove**', text: 'Takes away their access to the team\'s sets, sessions and reports, after **Remove them**. Everything they made stays with the team, and their Engage account is untouched.' },
            { title: '**Leave**', text: 'On your own row, for anyone. Confirm with **Leave it**. What you made stays with the team.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'The last owner',
          text: 'A team\'s last owner cannot leave or be removed; their row says so.',
        },
      ],
    },
  ],
};

/* --------------------------------------------------------------- activity */

const activity = {
  id: 'admin-activity',
  title: 'Activity',
  icon: 'ChartLineUp',
  summary: 'What a team ran, month by month: counts only, for owners and admins.',
  sections: [
    /*
      UsageStatsPanel.jsx: month stepper (‹ ›, "Previous month"/"Next
      month"), "Download CSV", "Counting since …" / "Counting starts with the
      next session", tiles and the "By type" table (Created, Started, Counted,
      Questions, Participants, Kept today), "Members", "Your question sets,
      all time" (Used in sessions, Questions asked, Copied, Downloaded; hint:
      Engage's and the Public library's sets are not listed), "Last six
      months". Owners/admins only (consoleSections.js activity).
    */
    {
      id: 'reading-activity',
      title: 'Reading the numbers',
      icon: 'ChartLineUp',
      blocks: [
        {
          t: 'p',
          text: 'Activity shows what the team ran in one month, as counts: nothing anyone wrote or answered. Step between months with the arrows beside the month\'s name.',
        },
        {
          t: 'list',
          items: [
            { title: 'By type', text: 'Sessions created, started and counted toward the plan, questions asked and participants, for each kind of session. Events are listed below it.' },
            { title: 'Members', text: 'The same counts for each person in the team.' },
            { title: 'Your question sets, all time', text: 'How often each of the team\'s sets was used, copied and downloaded. Engage\'s and public sets are not listed.' },
            { title: 'Last six months', text: 'Sessions counted, questions and participants, month by month.' },
          ],
        },
        {
          t: 'p',
          text: 'Counting started on the date the page gives. Earlier months show only the sessions the plan counted. **Download CSV** saves the month you are looking at.',
        },
      ],
    },
  ],
};

/* ----------------------------------------------------------- plan & usage */

const planUsage = {
  id: 'admin-plan-usage',
  title: 'Plan & usage',
  icon: 'CreditCard',
  summary: 'Reading this month\'s usage, asking for a paid plan, leaving one, and billing history.',
  sections: [
    /*
      BillingPanel.jsx: head "<plan> · billing period …" or "Your own space ·
      free · …"; "This month" / "This period"; meters "Sessions run", "Question
      sets stored" (Free: 5 and 5, pricing.js PERSONAL_PLAN); "Events run";
      link "How sessions are counted" → /help/host-plan; "What this period
      costs"; storage is charged on the highest number of sets held at once,
      Engage and public sets are free. Who: Your space, team owners/admins.
    */
    {
      id: 'this-month',
      title: 'Reading this month',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'p',
          text: 'Plan & usage is in Your space and, in a team, for owners and admins. The line under the title says the plan and the period.',
        },
        {
          t: 'list',
          items: [
            { title: 'On the free plan', text: 'Two meters: sessions run this month and question sets stored, each against what the plan includes. The allowance starts again each month.' },
            { title: 'On a paid plan', text: 'What you have used this period and what it costs so far, line by line.' },
          ],
        },
        {
          t: 'p',
          text: 'Only sets stored in this space count. Engage\'s sets and public sets are free to use however often you like. When a session counts is in the host guide What counts toward your plan (the **How sessions are counted** link).',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Nothing stops mid-session',
          text: 'A limit only stops you creating a new session. A session already created can still be started, and a room already in front of you keeps working to the end.',
        },
      ],
    },
    /*
      PlanRequestDialog.jsx: "Request the <plan>" (owner, or Your space:
      AdminPage onRequestPlan), "Discount code (optional)" applied on
      approval, "Anything Engage should know? (optional)", "Send the
      request", "Not now"; "No card. No charge." simulated billing.
      PlanRequestStrip: requested / approved / "Not this time." / "Request
      withdrawn"; "Withdraw", "Request again". Personal → Standard plan, team
      → Organisation plan (pricing.js upgradePlanFor). Creating a team files
      the request itself (CreateOrgDialog). Events need the paid plan.
    */
    {
      id: 'requesting-plan',
      title: 'Asking for a paid plan',
      icon: 'CreditCard',
      blocks: [
        {
          t: 'p',
          text: 'A paid plan removes the free plan\'s limits and brings events. Your space can ask for the Standard plan; a team\'s owner can ask for the Organisation plan. The page shows what each costs.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Request it', text: 'Press the request button at the top of Plan & usage (or on the Events page).' },
            { title: 'Add a code if you have one', text: 'A **Discount code** is applied when the request is approved, never before. Press **Send the request**.' },
            { title: 'Wait for Engage', text: 'Engage decides by hand, usually within a day. The decision, with any note, shows at the top of Plan & usage. **Withdraw** takes the request back while it waits.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'No card, no charge',
          text: 'Billing is simulated for now: each month has an invoice saying what would have been charged, and nothing is taken. A new team\'s request is sent when the team is created.',
        },
      ],
    },
    /*
      LeavePlanDialog.jsx: "Leave the <plan>" (owner/admin or Your space, on a
      paid plan); moves to free at once; sets over the free allowance must be
      deleted ("Delete it") or ticked "Make public" with a topic; held until
      the public library accepts a copy; "Not now". The session note: a new
      session waits if this month is over the free allowance.
    */
    {
      id: 'leaving-plan',
      title: 'Leaving a paid plan',
      icon: 'ArrowLeft',
      blocks: [
        {
          t: 'p',
          text: 'Owners and admins (and you, in Your space) can leave a paid plan from Plan & usage. The space moves to the free plan the moment you leave: no request, nothing to wait for.',
        },
        {
          t: 'p',
          text: 'The free plan keeps only a few stored sets, so the dialog lists yours. If you hold more than it keeps, delete some, or tick **Make public** to give them to the public library. A set you make public stays until the library accepts a copy, then leaves your space. When you are within the limit, leave.',
        },
        {
          t: 'p',
          text: 'If this month\'s sessions are already over the free allowance, a new session waits until next month. A session already running is never stopped.',
        },
      ],
    },
    /*
      InvoicePanel.jsx BillingHistory ("No closed months yet"; Period, Plan,
      List, Applied, Would have been charged; "Invoice") and Invoice ("Print /
      save as PDF", "Simulated · not a receipt", every number opens the row it
      came from). BillingPanel "Recent periods", "Adjustments on your account"
      (granted by Engage or redeemed by you).
    */
    {
      id: 'billing-history',
      title: 'Billing history and invoices',
      icon: 'FileText',
      blocks: [
        {
          t: 'p',
          text: '**Billing history** lists every closed month, free months included, with what would have been charged. An invoice is written on the 1st of the next month. **Invoice** opens one: what you used, the list price, anything applied to it, and the total. Every number on it opens the record it came from. **Print / save as PDF** keeps a copy.',
        },
        {
          t: 'p',
          text: 'Credits Engage has granted, and discount codes you have redeemed, are listed under **Adjustments on your account**. They cannot be changed from this screen.',
        },
      ],
    },
  ],
};

/* --------------------------------------------------------- data & privacy */

const dataPrivacy = {
  id: 'admin-data-privacy',
  title: 'Data & privacy',
  icon: 'Lock',
  summary: 'How long sessions, reports and drafts are kept, what is encrypted, the change log, and leaving.',
  sections: [
    /*
      MOVED HERE from admin-getting-started#sessions-expire (HELP_SECTION_MOVES
      in ./index.js). The rule: session-ttl.js (created never started → 90
      days from creation; started → 7 days from the start, written by
      session-start.js). Reports: game/save-report.js, 90 days, or 365 with
      Keep for 1 year; the Overview warns 7 days ahead (REPORT_DAYS). Drafts:
      admin/shared/generation-drafts.js READY_DAYS 30, DISCARD_RESTORE_DAYS 7.
      Invitations: 14 days (TeamPanel). Change-log entries: a year
      (utils/auditCopy.js RETENTION_LINE). Question sets do not expire.
      The Sessions page subtitle says the same (consoleSections.js, AdminPage.jsx).
    */
    {
      id: 'sessions-expire',
      title: 'How long things are kept',
      icon: 'CalendarBlank',
      blocks: [
        {
          t: 'table',
          head: ['What', 'Kept for'],
          rows: [
            ['A session that was never started', '90 days from when it was created.'],
            ['A session that was started', '7 days from when it started. Its answers, votes and players go with it.'],
            ['A saved report', '90 days from saving, or a year if you chose **Keep for 1 year**. It outlives its session. The Overview warns you a week before one goes.'],
            ['An AI draft', 'See Drafts and the bell › How long drafts are kept.'],
            ['An invitation', '14 days, unless it is accepted or revoked.'],
            ['Change log entries', 'A year.'],
            ['Question sets', 'Until someone deletes them.'],
          ],
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'Save the report while you can',
          text: 'The Sessions list is not an archive. If a session\'s results matter, save its report before the session expires.',
        },
      ],
    },
    /*
      PrivacyPanel.jsx: "Encryption" (Your content / Not encrypted, from
      DEFAULT_ENCRYPTION), "Who has read your data" (AdminPage passes no
      accessLog: "There is no read log yet", and the one case where a reviewer
      opens a set), "Who changed what" (AuditLog, GET /orgs/{id}/audit; every
      change Engage staff make, with the reason). Opening the section clears
      the Overview's "Engage staff opened your content" box.
    */
    {
      id: 'whats-recorded',
      title: 'What is encrypted, and who changed what',
      icon: 'ShieldCheck',
      blocks: [
        {
          t: 'p',
          text: 'Data & privacy is in Your space and, in a team, for owners and admins.',
        },
        {
          t: 'list',
          items: [
            { title: 'Encryption', text: 'Your sets, questions, answers, votes, Workie\'s writing, session titles and reports are encrypted with a key that belongs to this space alone. Identifiers, dates, counts, codes and category names are not.' },
            { title: 'Who has read your data', text: 'No read log is kept yet. The one time a person at Engage reads a set is when a set you share needs a human decision: the reviewer sees exactly what the check saw.' },
            { title: 'Who changed what', text: 'Every change made to this space or team, including every change Engage staff make, with who made it and the reason they gave.' },
          ],
        },
      ],
    },
    /*
      PrivacyPanel "Leaving": "Export everything" and "Delete <name>" render
      disabled because AdminPage mounts PrivacyPanel without onExport or
      onDelete (checked on dev: both disabled=true). Described as they are;
      the Export note still says "Available at any time". No private contact
      route exists in the app: the help menu's Report a bug / Request a
      feature / Ask for help all post to admin/create-github-issue (public
      GitHub issues), so none is named here.
    */
    {
      id: 'leaving',
      title: 'Taking your data, or deleting a space',
      icon: 'Package',
      blocks: [
        {
          t: 'p',
          text: 'Under Leaving, **Export everything** (every set, session, response and report as files) and Delete are shown, but neither can be pressed yet, although the note beside Export says it is available at any time. To take everything or to close a team, ask through your team\'s owner or your Engage contact.',
        },
        {
          t: 'p',
          text: 'Before then, you can download a set\'s questions with **Download CSV** in its editor, save session reports, and save Activity with **Download CSV**.',
        },
      ],
    },
  ],
};

/**
 * The admin-team area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'admin-team',
  guides: { admin: [members, activity, planUsage, dataPrivacy] },
};
