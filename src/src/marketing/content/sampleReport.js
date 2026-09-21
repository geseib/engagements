/**
 * FIXTURE. An invented session, shaped like the report the product actually
 * produces but not read from it. Both owner-approved mockups draw a report
 * sheet for the SAME session (same event, same question, same answers, same
 * standings) but the two sheets are not identical — 01-home.html shows a
 * trimmed sheet, 04-reports.html shows a fuller, pinned/annotated one. This
 * file exports BOTH, verbatim from their own mockup:
 *
 *   SAMPLE_REPORT_HOME — docs/design/marketing-redesign/01-home.html's
 *     `.mk-report` block, exactly. HomePage renders this one.
 *   SAMPLE_REPORT      — docs/design/marketing-redesign/04-reports.html's
 *     `.mk-report` block, exactly. /reports (Task 10) renders this one, with
 *     `callouts`.
 *
 * Where a row is character-for-character identical in both mockups (three of
 * the four answers, the first three standings rows, the header/standings
 * labels, the question prompt, the summary paragraph), it is defined ONCE
 * below as a shared constant and referenced from both views' arrays — so the
 * two views cannot drift apart on a string that is supposed to be the same
 * in both. Where the mockups differ — the question heading ("Question 3 ·
 * call and answer" vs "Question 3 of 6 · call and answer"), the second
 * answer's byline (04-reports adds a comment from Jo R.), the summary
 * block's heading and its lists (home has one unlabelled list of three next
 * steps; the full sheet splits a "Questions worth taking further" list from
 * a two-item "Next steps" list and drops home's third item), the standings
 * (full adds two more rows), and the footer (home has a note span and two
 * links; full has three links and no note) — each view carries its own.
 *
 * Shape (both views share this shape; a view that lacks a block simply omits
 * that optional field rather than supplying an empty placeholder):
 *
 * ReportView = {
 *   kicker: string,                  // "Session report"
 *   event: string,                   // the report's own title
 *   meta: string,                    // the one-line date/participants/questions/code summary
 *   round: {
 *     questionHeading: string,
 *     prompt: string,
 *     answers: [{ text, votes, width, votesText, by }],
 *       // votes: number (0 is valid and must render — the zero-vote answer
 *       //   is deliberate); width: 0-100, the meter's percentage width;
 *       // votesText: the exact "N votes" string as the mockup writes it;
 *       // by: author, with "· “a quote”" appended where the mockup does —
 *       //   one string, as the mockup writes it in one span.
 *     summaryHeading: string,
 *     summary: string,
 *     discussionLabel?: string,      // full view only
 *     discussionQuestions?: string[],// full view only
 *     nextStepsLabel?: string,       // full view only (home's list has no label)
 *     nextSteps: string[],
 *   },
 *   standingsHeading: string,
 *   standingsCols: { rank, player, correct, points },
 *   standings: [{ rank, name, correct, points }],
 *   footer: {
 *     links: [{ label }],            // rendered as inert labels, no href — see SampleReport.jsx
 *     note?: string,                 // home view only
 *   },
 * }
 */

// ---- rows identical in both mockups -----------------------------------
const KICKER = 'Session report';
const EVENT = 'Q3 planning — what we stop, what we start';
const META = 'Thursday 18 September · 20 participants · 6 questions · code 4821';
const PROMPT = 'What should we stop doing in the next quarter?';
const SUMMARY = 'The room agreed on one thing far more strongly than on anything else: too much discovery is running at once. Two of the four answers describe recurring process cost rather than product work, which suggests the quarter’s real constraint is attention, not capacity.';
const STANDINGS_HEADING = 'Final standings — trivia rounds';
const STANDINGS_COLS = { rank: '#', player: 'Player', correct: 'Correct', points: 'Points' };

const ANSWER_DISCOVERY = {
  text: 'Parallel discovery on three products at once',
  votes: 9,
  width: 82,
  votesText: '9 votes',
  by: 'Priya N. · “We are three deep on everything and finished on nothing.”',
};
const ANSWER_RELEASE_NOTES = {
  text: 'Hand-built release notes',
  votes: 4,
  width: 36,
  votesText: '4 votes',
  by: 'Alina K. · “Forty minutes a week, every week.”',
};
// Deliberately kept at zero votes: an answer nobody voted for is still in
// the tally and still in the report, never quietly dropped.
const ANSWER_ESTIMATES = {
  text: 'Two-week estimates on unscoped work',
  votes: 0,
  width: 2,
  votesText: '0 votes',
  by: 'Sam O.',
};
const NEXT_STEP_DISCOVERY_FOCUS = 'Name one product as the discovery focus before the next planning session.';
const NEXT_STEP_RELEASE_NOTES_OWNER = 'Decide who owns release notes, or decide to stop writing them.';

const STANDING_ALINA = { rank: 1, name: 'Alina K.', correct: '9 of 10', points: '1,340' };
const STANDING_TOMAS = { rank: 2, name: 'Tomas B.', correct: '8 of 10', points: '1,205' };
const STANDING_PRIYA = { rank: 3, name: 'Priya N.', correct: '8 of 10', points: '1,118' };

// No `href`: these render as inert labels (a picture of a button), not real
// links — see SampleReport.jsx's footer comment for why.
const EXPORT_LINK = { label: 'Export PDF' };
const SHARE_LINK = { label: 'Copy shareable link' };

// ---- rows that differ between the two mockups --------------------------
const ANSWER_STATUS_MEETING_HOME = {
  text: 'The weekly status meeting nobody reads',
  votes: 7,
  width: 64,
  votesText: '7 votes',
  by: 'Tomas B.',
};
const ANSWER_STATUS_MEETING_FULL = {
  text: 'The weekly status meeting nobody reads',
  votes: 7,
  width: 64,
  votesText: '7 votes',
  by: 'Tomas B. · comment from Jo R.: “Four of us do read it — keep it, shorten it.”',
};

/** docs/design/marketing-redesign/01-home.html's `.mk-report` block, verbatim. */
export const SAMPLE_REPORT_HOME = {
  kicker: KICKER,
  event: EVENT,
  meta: META,
  round: {
    questionHeading: 'Question 3 · call and answer',
    prompt: PROMPT,
    answers: [ANSWER_DISCOVERY, ANSWER_STATUS_MEETING_HOME, ANSWER_RELEASE_NOTES, ANSWER_ESTIMATES],
    summaryHeading: 'Summary and next steps',
    summary: SUMMARY,
    nextSteps: [
      NEXT_STEP_DISCOVERY_FOCUS,
      NEXT_STEP_RELEASE_NOTES_OWNER,
      'Revisit the status meeting with the four people who said they read it.',
    ],
  },
  standingsHeading: STANDINGS_HEADING,
  standingsCols: STANDINGS_COLS,
  standings: [STANDING_ALINA, STANDING_TOMAS, STANDING_PRIYA],
  footer: {
    links: [EXPORT_LINK, SHARE_LINK],
    note: 'Every answer, every vote and every comment is kept — not only the ones that won.',
  },
};

/** docs/design/marketing-redesign/04-reports.html's `.mk-report` block, verbatim. */
export const SAMPLE_REPORT = {
  kicker: KICKER,
  event: EVENT,
  meta: META,
  round: {
    questionHeading: 'Question 3 of 6 · call and answer',
    prompt: PROMPT,
    answers: [ANSWER_DISCOVERY, ANSWER_STATUS_MEETING_FULL, ANSWER_RELEASE_NOTES, ANSWER_ESTIMATES],
    summaryHeading: 'Summary, discussion and next steps',
    summary: SUMMARY,
    discussionLabel: 'Questions worth taking further:',
    discussionQuestions: [
      'If only one product could be in discovery next quarter, which one, and what happens to the other two?',
      'The status meeting drew both a stop vote and a defence. Who is it for?',
    ],
    nextStepsLabel: 'Next steps:',
    nextSteps: [NEXT_STEP_DISCOVERY_FOCUS, NEXT_STEP_RELEASE_NOTES_OWNER],
  },
  standingsHeading: STANDINGS_HEADING,
  standingsCols: STANDINGS_COLS,
  standings: [
    STANDING_ALINA,
    STANDING_TOMAS,
    STANDING_PRIYA,
    { rank: 4, name: 'Jo R.', correct: '7 of 10', points: '1,002' },
    { rank: 5, name: 'Sam O.', correct: '7 of 10', points: '968' },
  ],
  footer: {
    links: [EXPORT_LINK, { label: 'Print' }, SHARE_LINK],
  },
};
