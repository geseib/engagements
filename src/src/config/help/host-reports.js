/**
 * THE HOST GUIDES. (This header was shared by every host guide before the
 * Phase 0 split into area files; it still holds for each of them.)
 *
 * Only one of these existed. It had also drifted from the product in two ways
 * that mattered, both of which came from restating things the code already
 * knows: it told hosts that trivia runs a VOTE phase which is "automatic — no
 * voting needed" (there is no vote phase in `GAME_TYPES.trivia.phases` to
 * automate), and it named three question set types out of five. The phase
 * flows and the type table are `{ t: 'phases' }` and `{ t: 'gameTypes' }`
 * blocks now — derived from `config/gameTypes.js`, so the same drift cannot
 * happen twice.
 *
 * Every control named here is quoted from the surface it lives on. A host
 * reading this is looking at the panel while they read.
 */

const reporting = {
  id: 'host-reporting',
  title: 'Results and reports',
  icon: 'ChartBar',
  summary: 'The AI summary, the session report, and what happens to the data afterwards.',
  sections: [
    {
      id: 'what-we-heard',
      title: 'What the AI writes',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'p',
          text: 'After a round, the AI reads what the room actually said and writes a summary of it — themes, follow-up questions, and suggested next steps. It is generated from the responses in front of it, not from a template.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'The follow-up questions are the useful part',
          text: 'Read one out. It is usually a better prompt for discussion than anything you would think of while also running the session.',
        },
        {
          t: 'note',
          tone: 'info',
          title: '"Workie used words the room\'s answers don\'t support"',
          text: 'After Workie writes, Engage checks the read against what it was given: a number no answer, question or count contains (a "15-minute hold" nobody proposed), a claim about the room the vote does not show ("strongest", "unanimous", "everyone agreed" when the points were split), and a next step written as already decided ("The route lead will run…") when the room only ranked answers. If it finds any, Workie rewrites the read once. If words are still left, you see one small line naming them: on the console beside the read on two screens, in the Session panel\'s Workie section beside Redo on one screen, and on the phone remote. Redo, or edit what you say aloud, before the read goes up. Only you see the line; the wall, the room\'s window and the players never do.',
        },
        {
          t: 'p',
          text: 'Ask the room turns a follow-up into a question for the room: Ideas, Choose or Rate. For Rate you name the scale\'s two ends: pick a pair in "1 means" or "5 means" (Disagree to Agree, No to Yes, Low to High, Unlikely to Likely, Hard to Easy), or Custom to type your own. The phones, the wall and the report all show them.',
        },
        {
          t: 'p',
          text: 'On rounds that withhold something — the real title, the actual number, what happened next — the AI is given the withheld detail so it can compare the room\'s answers against it and reveal it afterwards. That only works if the question set filled the field in; if the AI promises a reveal that never comes, that is the set to fix, not the session.',
        },
      ],
    },
    {
      id: 'session-report',
      title: 'The session report',
      icon: 'FileText',
      blocks: [
        {
          t: 'p',
          text: 'Session report is at the top of the Rounds tab, above the rounds it summarises. It pulls the whole session together — every round, the responses, the scores and the AI summaries — in one document you can keep.',
        },
        {
          t: 'p',
          text: 'You can generate it at any point, during the session or after it. It is not a final action and running it does not end anything.',
        },
        {
          t: 'p',
          text: 'Answers and comments that arrived late appear under "Arrived late" in each round, with their labels. See Late answers and comments.',
        },
        {
          t: 'p',
          text: '**Save report** keeps it as a PDF: **Keep for 90 days**, or **Keep for 1 year**. A saved report outlives the session. Find it again under Reports on the welcome screen, with the link and passkey for anyone without an account.',
        },
      ],
    },
    {
      id: 'how-long-data-lasts',
      title: 'How long the data lasts',
      icon: 'CalendarBlank',
      blocks: [
        {
          t: 'note',
          tone: 'warn',
          title: 'Sessions expire',
          text: 'A session is kept for 90 days from creation, or for 7 days once it has started, whichever comes first. If the results matter, save the report while the session still exists.',
        },
      ],
    },
  ],
};

/**
 * The host-reports area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 * Results, What we heard, the session report, saved reports.
 */
export const AREA = {
  id: 'host-reports',
  guides: { host: [reporting] },
};
