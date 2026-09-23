/**
 * Copy for /reports, transcribed verbatim from
 * docs/design/marketing-redesign/04-reports.html (entities decoded), with one
 * exception: the lead's second sentence. The mockup itself claimed the sample
 * sheet is "a real one," which is false — SampleReport renders fixture data
 * from content/sampleReport.js, not a real session. Per the controller
 * ruling of 2026-09-20, the mockup was corrected in place (see the HTML
 * comment beside `.mk-lead` in 04-reports.html) and this file carries the
 * corrected sentence, not the original.
 *
 * @typedef {Object} ReportsPageCopy
 * @property {string} kicker
 * @property {string} title
 * @property {string} lead - also the sheet's own "this is a sample" notice
 *   (ruling: this lead IS the visible note the sheet needs; no second one).
 * @property {{kicker: string, title: string}} sharing - heading for the
 *   export/sharing cards section.
 * @property {{kicker: string, title: string, lead: string, note: string}} anonymity
 * @property {{title: string, primary: string, secondary: {label: string, href: string}}} cta
 */

/** @type {ReportsPageCopy} */
export const REPORTS_PAGE = {
  kicker: 'The summit',
  title: 'What a session leaves behind.',
  lead: 'The report is written as the session runs. This is a sample from an invented session, with the six things it captures marked.',
  sharing: {
    kicker: 'Getting it out',
    title: 'Export and sharing',
  },
  anonymity: {
    kicker: 'Anonymity',
    title: 'Names can be hidden for a whole session.',
    lead: 'Set it when you create the session. Answers, votes and comments are then recorded without the name attached, on the screen and in the report.',
    note: 'It is a per-session choice, not a per-answer one, so nobody has to decide in the moment whether this particular sentence is safe to sign. A session that starts anonymous stays anonymous.',
  },
  cta: {
    title: 'Run one session. Read the report. Decide from there.',
    primary: 'Create a host account',
    secondary: { label: 'How it works', href: '/how-it-works' },
  },
};

/**
 * The six numbered callouts beside the sample sheet, numbered to match the
 * `.mk-pin` marks `<SampleReport callouts />` draws on it (SampleReport.jsx,
 * built in Task 7). Order and numbering are the mockup's own.
 *
 * @typedef {Object} ReportCallout
 * @property {number} n
 * @property {string} title
 * @property {string} text
 */

/** @type {ReportCallout[]} */
export const REPORT_CALLOUTS = [
  {
    n: 1,
    title: 'Every question, in order',
    text: 'Each question as it ran, with which of the two shapes of round it was.',
  },
  {
    n: 2,
    title: 'Every answer',
    text: 'All of them, not a shortlist. An answer nobody voted for is still here.',
  },
  {
    n: 3,
    title: 'The vote count per answer',
    text: 'How many people voted for it. A vote count, described as a vote count — it is not a score and not a rating.',
  },
  {
    n: 4,
    title: 'Comments',
    text: 'What people wrote about an answer, kept beside the answer it was about.',
  },
  {
    n: 5,
    title: 'The AI summary',
    text: 'A written summary of the session with discussion questions and next steps. It reads the answers and the votes; nothing else.',
  },
  {
    n: 6,
    title: 'Final standings',
    text: 'From the trivia rounds only. Call and answer has no right answer, so it has no score.',
  },
];

/**
 * The three export/sharing cards. Transcribed as-is from the mockup; every
 * claim here is one the product actually makes good on: a PDF named for the
 * event and date, a clean print, and a saved link the host chooses to keep
 * temporarily or permanently.
 *
 * @typedef {Object} ReportSharingCard
 * @property {string} title
 * @property {string} text
 */

/** @type {ReportSharingCard[]} */
export const REPORT_SHARING = [
  {
    title: 'PDF',
    text: 'The whole report as one file, laid out for reading rather than for a browser window. The file is yours to circulate however you circulate things.',
  },
  {
    title: 'Print',
    text: 'A print sheet for the people who want it on the table at the next meeting.',
  },
  {
    title: 'A saved link',
    text: 'A saved copy, kept for 90 days or a year — you choose which when you save it — and a link with a passkey for someone who has no account.',
  },
];
