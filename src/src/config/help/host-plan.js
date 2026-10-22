/*
  THE OWNER'S RULE, 2026-09-23: "the session only counts if at least 2
  questions get answered by 1 or more people. otherwise we chalk it up to test,
  or something was not correct and they likely will restart."
  The server side is lambda-functions/websocket/session-count.js; Plan & usage
  links here (components/BillingPanel.jsx, data-testid="bill-session-rule").

  Help refresh Phase 2 (W2, 22 Oct 2026): added what a host sees when a limit
  is reached (components/PlanLimitNotice.jsx, utils/planLimitCopy.js), events
  and stored sets as the other two things a plan counts (BillingPanel.jsx
  meter rows "Sessions run" / "Question sets stored", "counted when it first
  goes live", lambda-functions/game/pricing.js), and who can open Plan & usage
  (config/consoleSections.js: your own space, a team's owners and admins).
  The Plan & usage screen itself (requests, invoices, leaving a plan) is the
  admin team guides' to describe.
*/
const plan = {
  id: 'host-plan',
  title: 'What counts toward your plan',
  icon: 'CreditCard',
  summary: 'When a session counts, what is always free, what happens at a limit, and why nothing is ever stopped mid-session.',
  sections: [
    {
      id: 'session-counts',
      title: 'When a session counts',
      icon: 'CheckCircle',
      blocks: [
        {
          t: 'p',
          text: 'A session counts toward your plan once two of its questions have each been answered by at least one person. The moment it counts is the first answer to the second question anybody answers. After that it has counted, once, however many more questions you ask and however many people answer them.',
        },
        {
          t: 'list',
          items: [
            { title: 'Free', text: 'Creating a session, starting it, and people joining it.' },
            { title: 'Free', text: 'Showing questions nobody answers, and skipping them.' },
            { title: 'Free', text: 'A room answering just one question, however many people answer it.' },
            { title: 'Counts', text: 'The first answer to a second question. Skipped questions in between do not matter: skip 1 to 3, answer 4, skip 5, answer 6, and the session counts on 6.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Rehearse as much as you like',
          text: 'Scan the QR code, check your categories, run a question past a colleague. As long as you stop before a second question is answered, nothing is used.',
        },
      ],
    },
    {
      id: 'other-things-counted',
      title: 'Question sets and events',
      icon: 'Books',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Question sets stored', text: 'A set you or your team made counts while you keep it. Delete one you no longer use and its place is free straight away. Sets from Engage and the public library never count, however many you play.' },
            { title: 'Events', text: 'On a plan that includes events, an event is counted once, when it first goes live.' },
          ],
        },
      ],
    },
    {
      id: 'where-to-see-it',
      title: 'Where to see it',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'p',
          text: '**Plan & usage**, in the console, shows this month\'s sessions run (the sessions that counted) and question sets stored against what your plan includes. The allowance starts again at the beginning of each month.',
        },
        {
          t: 'p',
          text: 'You see it for Your space, and for a team you own or help run. A team\'s other members do not; ask an owner or admin.',
        },
      ],
    },
    {
      id: 'limit-reached',
      title: 'When a limit is reached',
      icon: 'Warning',
      blocks: [
        {
          t: 'p',
          text: 'On the free plan, a session past the month\'s allowance is refused when you create it, in Create engagement or Quick start. A note says what ran out and **Nothing was created.** A set past the allowance is refused when you save it, and nothing is saved.',
        },
        {
          t: 'list',
          items: [
            { title: 'If it is your space, or you own the team', text: 'The note offers a button to request the paid plan, or tells you to wait until the allowance starts again on the 1st (or, for sets, to delete one).' },
            { title: 'If you help run the team', text: 'Only the owner can change the plan. The note names them and links to **Plan & usage**.' },
            { title: 'If you host in a team', text: 'The note names the owners and admins to ask.' },
          ],
        },
        {
          t: 'p',
          text: 'On a paid plan nothing is refused: sessions and sets past the allowance are charged as Plan & usage shows.',
        },
      ],
    },
    {
      id: 'never-stopped-mid-session',
      title: 'Nothing is ever stopped mid-session',
      icon: 'ShieldCheck',
      blocks: [
        {
          t: 'p',
          text: 'A limit only ever stops you creating a new session. A session that is already running keeps taking answers, whatever the month\'s count says; nobody in the room is ever cut off.',
        },
      ],
    },
    {
      id: 'if-nothing-starts',
      title: 'If nothing starts',
      icon: 'Warning',
      blocks: [
        {
          t: 'p',
          text: 'If the first round has nothing to ask (none of the categories you chose has a question in it), the session is not started and not ended. You will see "Nothing to ask yet". Choose categories with questions in them and press Start again. None of that counts.',
        },
      ],
    },
  ],
};

/**
 * The host-plan area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 * What counts toward a plan.
 */
export const AREA = {
  id: 'host-plan',
  guides: { host: [plan] },
};
