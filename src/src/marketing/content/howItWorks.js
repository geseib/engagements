/**
 * Copy for /how-it-works, transcribed verbatim from
 * docs/design/marketing-redesign/02-how-it-works.html (entities decoded).
 *
 * @typedef {Object} HowStep
 * @property {number} n - 1..6, the step's position in the tour.
 * @property {string} title - the step's own heading (the mockup's <h3> text).
 * @property {string[]} text - one or more paragraphs, in the mockup's order.
 * @property {string} slot - the CLIPS entry (content/clips.js) this step's device draws from.
 * @property {string} [still] - overrides which ClipStill drawing renders while the slot has no recording.
 * @property {{href: string, label: string}} [link] - an inline link appended after the last paragraph.
 */

/** @type {HowStep[]} */
export const HOW_STEPS = [
  {
    n: 1,
    title: 'Create a session from a set',
    text: [
      'Pick a question set from your library and start a session. You get a four-digit code and a QR code to put on the screen at the front of the room.',
      'The session pins the version of the set it started with, so editing the set tomorrow does not rewrite what happened today.',
    ],
    slot: 'builder',
  },
  {
    n: 2,
    title: 'Everyone joins by QR or code',
    text: [
      'Players scan the QR code, or type the four digits at the join page. No account, no app, no install.',
      'Names appear on the front screen as people arrive, so you can see the room fill and know when to begin.',
    ],
    slot: 'join-qr',
  },
  {
    n: 3,
    title: 'Ask',
    text: [
      'The question goes up on the front screen and onto every phone at the same moment. Trivia shows four options; call and answer shows a box to write in.',
      'You can see how many people have answered before you move on, so nobody is cut off mid-sentence.',
    ],
    slot: 'trivia-host',
    still: 'tour-ask',
  },
  {
    n: 4,
    title: 'Vote',
    text: [
      'Call and answer adds a vote phase: the answers the room just wrote go back to the room, and everyone picks the ones they want to carry forward.',
      'Trivia does not have this phase. It goes straight from the question to the answer.',
    ],
    slot: 'poll-player',
    still: 'tour-vote',
  },
  {
    n: 5,
    title: 'Results',
    text: [
      'Trivia reveals the right answer with its explanation and moves the standings. Call and answer reveals the vote breakdown, answer by answer.',
      'This is the moment the room talks. The screen gives everyone the same thing to talk about.',
    ],
    slot: 'poll-host',
    still: 'tour-results',
  },
  {
    n: 6,
    title: 'The report',
    text: [
      'End the session and the report is already written: every answer, every vote, every comment, the AI summary, and the final standings.',
      'Export it as a PDF or share the link.',
    ],
    slot: 'report',
    link: { href: '/reports', label: 'See what is in a report →' },
  },
];

export const HOW_PAGE = {
  kicker: 'How it works',
  title: 'Six steps, from a question set to a report.',
  lead: 'You run the session from one screen. Everyone else uses the phone already in their hand.',
  profiles: {
    kicker: 'Running it in the room you have',
    title: 'Four display profiles, and a phone as the remote.',
    lead: 'The same session, laid out for the screen it is actually on. These are facilitator conveniences, not different products.',
    items: [
      { name: 'Room', text: 'A projector at the front, read from the back row.' },
      { name: 'TV', text: 'A wall screen in a smaller space.' },
      { name: 'Call', text: 'Shared over a video call, sized for a window.' },
      { name: 'Table', text: 'A laptop on the table between a few people.' },
    ],
    note: 'You can also drive the session from your own phone while the front screen shows the room view, so you are not stood behind a laptop for an hour.',
  },
  cta: {
    title: 'Try it with your next session.',
    primary: 'Create a host account',
    secondary: { label: 'See four sessions in detail', href: '/use-cases' },
  },
};
