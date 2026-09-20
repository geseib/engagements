/**
 * FIXTURE. An invented session, shaped like the report the product actually
 * produces but not read from it — transcribed from the owner-approved
 * mockups docs/design/marketing-redesign/01-home.html (the home page's
 * trimmed report) and 04-reports.html (the fuller, pinned/annotated version
 * of the SAME session — same event, same question, same answers, same
 * standings). This file carries the union so both pages can read one fixture:
 * HomePage's <SampleReport /> renders it plainly; /reports's <SampleReport
 * callouts /> (Task 10) additionally numbers the six spots 04-reports.html
 * pins, in the order that file pins them.
 *
 * Shape:
 * SAMPLE_REPORT = {
 *   event: string,              // report title, e.g. "Q3 planning — what we stop, what we start"
 *   date: string,                // e.g. "Thursday 18 September"
 *   players: number,             // participant count
 *   questionsCount: number,      // total questions run in the session
 *   code: string,                // the session's join code, as shown in the report meta line
 *   round: {
 *     index: number,             // which question this block is, 1-based
 *     mode: string,              // "call and answer" | "trivia"
 *     prompt: string,
 *     answers: [{
 *       text: string,
 *       votes: number,           // 0 is valid and must render — the zero-vote answer is deliberate
 *       width: number,           // 0-100, the vote-meter's percentage width
 *       by: string,              // author, optionally "· “a quote”" appended — as the mockup writes it in one span
 *     }],
 *     summary: string,
 *     discussionQuestions: [string],
 *     nextSteps: [string],
 *   },
 *   standings: [{ rank: number, name: string, correct: string, points: string }],
 * }
 *
 * REPORT_LABELS holds the sheet's own fixed labels (headings, table columns,
 * footer button text) — the words on the paper that are not part of the
 * session's data, transcribed from the same two mockups.
 */
export const REPORT_LABELS = {
  kicker: 'Session report',
  standingsHeading: 'Final standings — trivia rounds',
  summaryHeading: 'Summary, discussion and next steps',
  discussionLabel: 'Questions worth taking further:',
  nextStepsLabel: 'Next steps:',
  standingsCols: { rank: '#', player: 'Player', correct: 'Correct', points: 'Points' },
  footNote: 'Every answer, every vote and every comment is kept — not only the ones that won.',
  exportLabel: 'Export PDF',
  shareLabel: 'Copy shareable link',
  meta: (r) => `${r.date} · ${r.players} participants · ${r.questionsCount} questions · code ${r.code}`,
  questionHeading: (r) => `Question ${r.round.index} · ${r.round.mode}`,
  votesLabel: (n) => `${n} votes`,
};

export const SAMPLE_REPORT = {
  event: 'Q3 planning — what we stop, what we start',
  date: 'Thursday 18 September',
  players: 20,
  questionsCount: 6,
  code: '4821',
  round: {
    index: 3,
    mode: 'call and answer',
    prompt: 'What should we stop doing in the next quarter?',
    answers: [
      {
        text: 'Parallel discovery on three products at once',
        votes: 9,
        width: 82,
        by: 'Priya N. · “We are three deep on everything and finished on nothing.”',
      },
      {
        text: 'The weekly status meeting nobody reads',
        votes: 7,
        width: 64,
        by: 'Tomas B. · comment from Jo R.: “Four of us do read it — keep it, shorten it.”',
      },
      {
        text: 'Hand-built release notes',
        votes: 4,
        width: 36,
        by: 'Alina K. · “Forty minutes a week, every week.”',
      },
      {
        // Deliberately kept at zero votes: an answer nobody voted for is still
        // in the tally and still in the report, never quietly dropped.
        text: 'Two-week estimates on unscoped work',
        votes: 0,
        width: 2,
        by: 'Sam O.',
      },
    ],
    summary: 'The room agreed on one thing far more strongly than on anything else: too much discovery is running at once. Two of the four answers describe recurring process cost rather than product work, which suggests the quarter’s real constraint is attention, not capacity.',
    discussionQuestions: [
      'If only one product could be in discovery next quarter, which one, and what happens to the other two?',
      'The status meeting drew both a stop vote and a defence. Who is it for?',
    ],
    nextSteps: [
      'Name one product as the discovery focus before the next planning session.',
      'Decide who owns release notes, or decide to stop writing them.',
    ],
  },
  standings: [
    { rank: 1, name: 'Alina K.', correct: '9 of 10', points: '1,340' },
    { rank: 2, name: 'Tomas B.', correct: '8 of 10', points: '1,205' },
    { rank: 3, name: 'Priya N.', correct: '8 of 10', points: '1,118' },
  ],
};
