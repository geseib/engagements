/*
  THE OWNER'S RULE, 2026-09-23: "the session only counts if at least 2
  questions get answered by 1 or more people. otherwise we chalk it up to test,
  or something was not correct and they likely will restart."
  The server side is lambda-functions/websocket/session-count.js; Plan & usage
  links here (components/BillingPanel.jsx, data-testid="bill-session-rule").
*/
const plan = {
  id: 'host-plan',
  title: 'What counts toward your plan',
  icon: 'CreditCard',
  summary: 'When a session counts, what is always free, and why nothing is ever stopped mid-session.',
  sections: [
    {
      id: 'session-counts',
      title: 'When a session counts',
      icon: 'CheckCircle',
      blocks: [
        {
          t: 'p',
          text: 'A session counts toward your plan once two of its questions have each been answered by at least one person. The moment it counts is the first answer to the second question anybody answers. After that it has counted, once — however many more questions you ask and however many people answer them.',
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
      id: 'where-to-see-it',
      title: 'Where to see it',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'p',
          text: 'Plan & usage, in the console, shows this month\'s sessions run — the sessions that counted — against what your plan includes. The allowance starts again at the beginning of each month.',
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
          text: 'A limit only ever stops you creating a new session. A session that is already running keeps taking answers, whatever the month\'s count says — nobody in the room is ever cut off.',
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
          text: 'If the first round has nothing to ask — none of the categories you chose has a question in it — the session is not started and not ended. You will see "Nothing to ask yet". Choose categories with questions in them and press Start again. None of that counts.',
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
