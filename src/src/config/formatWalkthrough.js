/**
 * HOW EACH FORMAT RUNS, AS A STORYBOARD (docs/design/new-engagement README
 * rounds 2 and 3).
 *
 * The owner, 30 Oct 2026, on the round-2 walkthrough: "what about rather
 * than having to click through prev and next if you just scrolled through
 * the stages. with an image and description." So each format is a short run
 * of STAGES the host scrolls through — a picture and a plain description
 * each — ending with what you get. Nothing to click.
 *
 * ONE CONCRETE THREAD PER FORMAT. Call & Answer carries the owner's own
 * example from the ask to the report; the others carry one of the same
 * spirit. Every behaviour is checked against config/gameTypes.js and the help
 * (host-running.js, host-reports.js, host-surveys.js, build-room.js,
 * host-events.js, player.js): phones rank their top three, names are hidden
 * while voting and go up with the results, comments carry the writer's name,
 * a poll has no right answer and no names, Wavelength has no winners, a
 * survey opens as it is created, an event holds up to 16 items. The stages
 * describe the defaults (names hidden until the vote closes).
 *
 *   stages  [{ title, text, art: { stage, phone } }]
 *   get     { text, art: { stage } }  — the last card, "What you get"
 *
 * `art` is data for components/FormatWalkthrough.jsx's picture: a `kind` and
 * the few words it draws. Pictures are boxes, never images.
 */
import { BUILD_KIND, EVENT_KIND } from './engagementKinds';

const ASK = 'If we had unlimited people and resources, what should we build?';
const RESPONSES = [
  'A Rube Goldberg machine',
  'A grass-seeding robot',
  'An AI-enabled fax machine',
  'A for-hire one-week enterprise tech-debt remover',
];
const CA_CHIP = 'Round 1 · Big ideas';

const OCTOPUS = 'How many hearts does an octopus have?';
const ROOM_NAME = 'What should we call the new meeting room?';
const DRAWER = 'Things you find in a junk drawer';

export const FORMAT_WALKTHROUGH = Object.freeze({
  'call-and-answer': {
    stages: [
      {
        title: 'The ask',
        text: `You put the question up: “${ASK}” People join with the code on the screen, and their phones show the question with a box to answer in.`,
        art: {
          stage: { kind: 'question', chip: CA_CHIP, title: ASK, count: '0', of: 'of 18 answered' },
          phone: { kind: 'answer', q: ASK },
        },
      },
      {
        title: 'Everyone answers',
        text: 'Each person types an answer on their phone and sends it. The screen counts them in, “14 of 18 answered”, and nobody can see who wrote what.',
        art: {
          stage: { kind: 'question', chip: CA_CHIP, title: ASK, count: '14', of: 'of 18 answered', dots: [14, 18] },
          phone: { kind: 'answer', q: ASK, typed: RESPONSES[1], note: 'Nobody sees who wrote it' },
        },
      },
      {
        title: 'The responses, and the vote',
        text: 'When you press Start voting, every answer goes up numbered, with no names: the Rube Goldberg machine, the grass-seeding robot, the AI-enabled fax machine and the tech-debt remover. Everyone reads them all and ranks their top three on their phone.',
        art: {
          stage: { kind: 'vote', chip: CA_CHIP, title: 'Vote for the best response', items: RESPONSES },
          phone: { kind: 'rank', q: 'Rank your top three.', ranks: [2, 0, 3, 1] },
        },
      },
      {
        title: 'The results, ranked',
        text: 'The answers come back in order of their vote points, the room’s pick first. Names go up with the results: Priya’s tech-debt remover wins, and the robot comes second.',
        art: {
          stage: {
            kind: 'results',
            chip: CA_CHIP,
            label: 'The room’s pick',
            rows: [[RESPONSES[3], 'Priya · 31 points'], [RESPONSES[1], 'Sam · 24'], [RESPONSES[0], 'Ade · 17']],
          },
          phone: { kind: 'points', q: 'You wrote response 2', pts: '24 points', note: '2nd of 18' },
        },
      },
      {
        title: 'Workie’s read',
        text: 'Workie, Engage’s AI assistant, sums up what the room said in a few lines: practical before shiny, with a soft spot for the absurd.',
        art: {
          stage: { kind: 'read', chip: CA_CHIP, k: 'What we heard · Workie', text: 'The room would clear tech debt before building gadgets, but the Rube Goldberg machine kept its fans.' },
          phone: null,
        },
      },
      {
        title: 'Comments',
        text: 'Ask for comments and people add theirs on their phones, about Workie’s read, the results or any answer. Each carries the writer’s name, and you choose which go up on the screen.',
        art: {
          stage: { kind: 'comments', chip: CA_CHIP, title: 'What do you make of it?', quote: '“Can the fax machine fax the tech-debt remover?” — Jordan', count: '7', of: 'comments' },
          phone: { kind: 'answer', q: 'Comment on what we heard', typed: 'Can the fax machine fax…', note: 'Shown with your name' },
        },
      },
    ],
    get: {
      text: 'The report: the question, every answer ranked by its vote points with who wrote it, Workie’s read and every comment. Save it and it stays after the session expires.',
      art: { stage: { kind: 'report', title: 'Session report · Big ideas', rows: ['Round 1 · ' + ASK, 'What we heard', 'Comments · 7'] } },
    },
  },

  trivia: {
    stages: [
      {
        title: 'You ask',
        text: `The question and its four options go up: “${OCTOPUS}” 1, 2, 3 or 8. Phones show A, B, C and D to tap.`,
        art: { stage: { kind: 'options', title: OCTOPUS, labels: ['A 1', 'B 2', 'C 3', 'D 8'] }, phone: { kind: 'abcd' } },
      },
      {
        title: 'Everyone picks',
        text: 'Each person taps an answer and locks it in. The screen counts who has answered, so you know when to reveal.',
        art: { stage: { kind: 'count', title: OCTOPUS, count: '14', of: '/18' }, phone: { kind: 'abcd', picked: 'C' } },
      },
      {
        title: 'You reveal',
        text: 'Three is right. The right option is marked, the others dim, and each shows how much of the room chose it. Phones say right or wrong.',
        art: { stage: { kind: 'options', title: OCTOPUS, labels: ['A 1', 'B 2', 'C 3', 'D 8'], right: 'C 3' }, phone: { kind: 'abcd', picked: 'C', result: 'Right' } },
      },
      {
        title: 'The scoreboard',
        text: 'Press S and the scoreboard goes up. Phones show each person’s points and place.',
        art: { stage: { kind: 'scores', rows: [['Priya', '40'], ['Sam', '35'], ['Ade', '30']] }, phone: { kind: 'points', q: 'Your score', pts: '30 points', note: '3rd of 18' } },
      },
    ],
    get: {
      text: 'The scores, and which questions the room knew or missed.',
      art: { stage: { kind: 'report', title: 'Session report · Friday quiz', rows: ['Scores', 'Questions the room knew', 'Questions the room missed'] } },
    },
  },

  poll: {
    stages: [
      {
        title: 'You ask',
        text: `A quick question goes up, “${ROOM_NAME}”, with its options: The Think Tank, Room 101 or The Fax Lounge. A poll can also be a rating, a yes or no, or a few words.`,
        art: { stage: { kind: 'options', title: ROOM_NAME, labels: ['The Think Tank', 'Room 101', 'The Fax Lounge'] }, phone: { kind: 'choice', opts: ['The Think Tank', 'Room 101', 'The Fax Lounge'] } },
      },
      {
        title: 'Results fill in live',
        text: 'People pick on their phones and the bars fill in as they do. There is no right answer and no names.',
        art: { stage: { kind: 'bars', title: ROOM_NAME, bars: [['Fax Lounge', 64], ['Think Tank', 40], ['Room 101', 18]] }, phone: { kind: 'choice', opts: ['The Think Tank', 'Room 101', 'The Fax Lounge'], picked: 2 } },
      },
      {
        title: 'Show results',
        text: 'The board freezes for everyone to read: The Fax Lounge it is. Then the next question.',
        art: { stage: { kind: 'bars', title: ROOM_NAME, bars: [['Fax Lounge', 72], ['Think Tank', 44], ['Room 101', 20]], done: true }, phone: null },
      },
    ],
    get: {
      text: 'Each result, as the room answered it.',
      art: { stage: { kind: 'report', title: 'Session report · Team pulse', rows: [ROOM_NAME, 'How was the week?', 'Anything else?'] } },
    },
  },

  wavelength: {
    stages: [
      {
        title: 'You give a subject',
        text: `The subject goes up: “${DRAWER}”. Phones show it with ten boxes for words.`,
        art: { stage: { kind: 'subject', term: DRAWER }, phone: { kind: 'boxes', q: DRAWER } },
      },
      {
        title: 'Everyone writes words',
        text: 'People write the obvious words, the ones the rest will think of too. Nothing shows on the screen until everyone is in.',
        art: { stage: { kind: 'count', title: DRAWER, count: '14', of: '/18' }, phone: { kind: 'boxes', q: DRAWER, typed: ['batteries', 'rubber bands'] } },
      },
      {
        title: 'The shared words',
        text: 'Spellings and plurals count together. Batteries is on every list and stands out; the rest show how many said them.',
        art: { stage: { kind: 'cloud', words: [['batteries', '×18', true], ['rubber bands', '11'], ['takeaway menus', '7'], ['a mystery key', '4']] }, phone: null },
      },
      {
        title: 'End of the session',
        text: 'The screen shows the words the whole room shared. Nobody scores, and nobody wins.',
        art: { stage: { kind: 'shared', words: ['batteries', 'rubber bands', 'sticky tape'] }, phone: null },
      },
    ],
    get: {
      text: 'Where the team already thinks alike, and where it doesn’t.',
      art: { stage: { kind: 'report', title: 'Session report · Team words', rows: [DRAWER, 'Words the room shared', 'Words only some wrote'] } },
    },
  },

  survey: {
    stages: [
      {
        title: 'Open it',
        text: 'Pressing Open the survey creates it and opens it at once: say, the offsite feedback form. The join code and QR go up, and people join with either.',
        art: { stage: { kind: 'qr', code: '4821' }, phone: null },
      },
      {
        title: 'People answer in their own time',
        text: 'Everyone works through the questions on their own phone, “Rate the coffee, 1 to 5” included, at their own pace. The screen shows how far the room has got.',
        art: { stage: { kind: 'progress', label: '23 of 36 finished', pct: 64 }, phone: { kind: 'form', done: 2 } },
      },
      {
        title: 'Warn, then close',
        text: 'A two-minute warning goes to every phone, then you close it.',
        art: { stage: { kind: 'progress', label: '2 minutes left', pct: 92, warn: true }, phone: { kind: 'points', q: 'Two minutes left', pts: '2:00', note: 'Finish your answers' } },
      },
      {
        title: 'Read it back',
        text: 'See the results yourself, walk the room through them, then Workie’s summary. The coffee scored a 2.',
        art: { stage: { kind: 'bars', title: 'Rate the coffee, 1 to 5', bars: [['1–2', 58], ['3', 30], ['4–5', 12]], done: true }, phone: null },
      },
    ],
    get: {
      text: 'The answers added up, with names only if you chose that.',
      art: { stage: { kind: 'report', title: 'Survey report · Offsite feedback', rows: ['Answers added up', 'Workie’s summary', 'Names: only if you chose them'] } },
    },
  },

  [BUILD_KIND]: {
    stages: [
      {
        title: 'Set it up',
        text: 'On the Build Room page: the title, the goal, say a sign-up page for the office bake-off (or let the room decide), and connect your Claude Code.',
        art: { stage: { kind: 'connected', title: 'Bake-off sign-up page', ok: 'Claude Code connected' }, phone: null },
      },
      {
        title: 'Claude asks the room',
        text: 'Claude asks for ideas, a choice between options or mockups, or a rating: “Which sign-up page: A, a big photo of cakes, or B, a short form?” You check each question before it goes out.',
        art: { stage: { kind: 'mockups', cap: 'Which sign-up page?' }, phone: { kind: 'choice', opts: ['Page A', 'Page B'] } },
      },
      {
        title: 'The room answers',
        text: 'People answer on phones, tablets or laptops, with the four-digit code, and the answers come in on the screen.',
        art: { stage: { kind: 'mockups', cap: 'Which sign-up page?', pick: 'A', bars: true }, phone: { kind: 'choice', opts: ['Page A', 'Page B'], picked: 0 } },
      },
      {
        title: 'You decide',
        text: 'You turn the room’s answer into a direction, “Build B, with A’s cake photo on top”, and Claude builds it. Then the next question.',
        art: { stage: { kind: 'direction', k: 'Direction for Claude', text: 'Build B, with A’s cake photo on top.' }, phone: null },
      },
    ],
    get: {
      text: 'Something built, every decision the room made, and a report.',
      art: { stage: { kind: 'report', title: 'Build report · Bake-off sign-up', rows: ['What was built', 'Every decision the room made', 'Each question and its answers'] } },
    },
  },

  [EVENT_KIND]: {
    stages: [
      {
        title: 'Plan the day',
        text: 'Name, date, start time and place, then the agenda, up to 16 items: Welcome at 9:00, Trivia at 9:20, a break, then a Call & Answer round.',
        art: { stage: { kind: 'agenda', items: [['09:00', 'Welcome'], ['09:20', 'Trivia'], ['09:45', 'Break'], ['10:00', 'Call & Answer']] }, phone: null },
      },
      {
        title: 'One code all day',
        text: 'People join once with one code, and their phones follow the agenda.',
        art: { stage: { kind: 'qr', code: '4821' }, phone: null },
      },
      {
        title: 'You start each item',
        text: 'Start each item when it is due. Phones go straight into it: the quiz, a poll, the Call & Answer round, a talk or a break.',
        art: { stage: { kind: 'agenda', items: [['09:00', 'Welcome', 'done'], ['09:20', 'Trivia', 'now'], ['09:45', 'Break'], ['10:00', 'Call & Answer']] }, phone: { kind: 'abcd' } },
      },
      {
        title: 'Each item reports',
        text: 'Every session on the agenda keeps its own report, gathered under the event.',
        art: { stage: { kind: 'report', title: 'Friday offsite', rows: ['09:20 Trivia', '10:00 Call & Answer', '11:00 Poll'] }, phone: null },
      },
    ],
    get: {
      text: 'Each item’s report, gathered under the event.',
      art: { stage: { kind: 'report', title: 'Event · Friday offsite', rows: ['Trivia report', 'Call & Answer report', 'Poll report'] } },
    },
  },
});

/** The storyboard for a format id, or null. */
export function walkthroughFor(id) {
  return FORMAT_WALKTHROUGH[id] || null;
}
