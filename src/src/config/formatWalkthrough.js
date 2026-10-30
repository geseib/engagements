/**
 * HOW EACH FORMAT RUNS, STEP BY STEP (docs/design/new-engagement README
 * "Round 2 — owner feedback", frames 2-04 and 2-05).
 *
 * The owner, 30 Oct 2026: "the preview doesnt shed light as to what happens".
 * So the side pane and the Format guide walk through a session instead: per
 * step what YOU do, what PHONES show and what the ROOM SCREEN shows, ending
 * with what you get. The words are the designer's, checked against the help
 * (host-running.js, host-reports.js, player.js): phones rank their top three,
 * names are hidden while voting and go up with the results, comments come
 * after Workie's read and carry the writer's name, Wavelength has no winners,
 * a survey opens as it is created, an event holds up to 16 items.
 *
 * Each step describes the DEFAULTS (names hidden until the vote closes). A
 * blank `phones` or `room` means that screen has nothing to show at that step
 * (setting up a Build Room or an event happens on its own page); the
 * walkthrough leaves the row out rather than invent one.
 *
 *   steps  [{ title, you, phones, room, art: { stage, phone } }]
 *   get    { text, art: { stage } }  — the last dot, "What you get"
 *
 * `art` is data for components/FormatWalkthrough.jsx's picture: a `kind` and
 * the few words it draws. Pictures are boxes, never images, and each is the
 * step's end state, so nothing depends on animation.
 */
import { BUILD_KIND, EVENT_KIND } from './engagementKinds';

const CHIP = 'Round 1 · Architecture';
const QUESTION = 'Build a Threshold, Not a Door';
const ANSWERS = [
  'A staging step before prod that people can actually linger in',
  'Onboarding: a week of reading before the first ticket',
  'Design reviews that happen in the hallway first',
  'Hallway reviews before formal ones',
  'A “threshold” week for new tools',
];

export const FORMAT_WALKTHROUGH = Object.freeze({
  'call-and-answer': {
    steps: [
      {
        title: 'You ask a question',
        you: 'Press Start, then put the first question up. People join with the code on screen.',
        phones: 'The question, and a box to write an answer.',
        room: 'The question, the join code and how many have answered.',
        art: {
          stage: { kind: 'question', chip: CHIP, title: QUESTION, count: '0', of: 'of 18 answered' },
          phone: { kind: 'answer', q: QUESTION },
        },
      },
      {
        title: 'Everyone answers on their phone',
        you: 'Watch the count. Move on when enough answers are in.',
        phones: 'They type an answer and send it. Nobody sees who wrote it.',
        room: '“14 of 18 answered”. The answers stay hidden for now.',
        art: {
          stage: { kind: 'question', chip: CHIP, title: QUESTION, count: '14', of: 'of 18 answered', dots: [14, 18] },
          phone: { kind: 'answer', q: QUESTION, typed: 'A staging step before prod', note: 'Nobody sees who wrote it' },
        },
      },
      {
        title: 'Everyone reads all the answers and votes',
        you: 'Press Start voting.',
        phones: 'Every answer, numbered, with no names. Each person ranks their top three.',
        room: 'Every answer with its number, no names, so people can say “look at six”.',
        art: {
          stage: { kind: 'vote', chip: CHIP, title: 'Vote for the best response', items: ANSWERS },
          phone: { kind: 'rank', q: 'Rank your top three.', ranks: [1, 0, 3, 2, 0] },
        },
      },
      {
        title: 'The results, ranked, and Workie’s read',
        you: 'Show the results, then Workie’s read of what the room said.',
        phones: '“You wrote response 3”, the points it earned and their place.',
        room: 'The room’s pick first, the rest ranked. Names go up with the results.',
        art: {
          stage: {
            kind: 'results',
            chip: CHIP,
            label: 'The room’s pick',
            rows: [[ANSWERS[0], 'Priya · 9 points'], [ANSWERS[1], 'Sam · 4'], [ANSWERS[2], 'Ade · 2']],
            read: 'The room wants a pause before things go live.',
          },
          phone: { kind: 'points', q: 'You wrote response 3', pts: '+2 points', note: '7th of 18' },
        },
      },
      {
        title: 'Comments, then the next question',
        you: 'Ask for comments on the read, or start the next round.',
        phones: 'People comment on the read, the results or any answer. Comments carry their name.',
        room: '“What do you make of it?” and any comment you choose to put up.',
        art: {
          stage: { kind: 'comments', chip: CHIP, title: 'What do you make of it?', quote: '“A staging step only works if someone owns it.” — Jordan', count: '7', of: 'comments' },
          phone: { kind: 'answer', q: 'Comment on what we heard', typed: 'A staging step only works if…', note: 'Shown with your name' },
        },
      },
    ],
    get: {
      text: 'The report: every answer ranked by the room’s votes, with who wrote it; Workie’s read; every comment. Save it and it stays after the session expires.',
      art: { stage: { kind: 'report', title: 'Session report · Team retro', rows: ['Round 1 · ' + QUESTION, 'What we heard', 'Comments · 7'] } },
    },
  },

  trivia: {
    steps: [
      {
        title: 'You ask',
        you: 'Put the question up.',
        phones: 'A, B, C and D to tap.',
        room: 'The question and its four options.',
        art: { stage: { kind: 'options', title: 'Which planet has the most moons?' }, phone: { kind: 'abcd' } },
      },
      {
        title: 'Everyone picks',
        you: 'Watch the count, then reveal the answer.',
        phones: 'Each person taps an answer and locks it in.',
        room: 'The screen counts who has answered.',
        art: { stage: { kind: 'count', title: 'Which planet has the most moons?', count: '14', of: '/18' }, phone: { kind: 'abcd', picked: 'C' } },
      },
      {
        title: 'You reveal',
        you: 'Reveal the answer.',
        phones: 'Right or wrong.',
        room: 'The right answer is marked and the others dim, with how many chose each.',
        art: { stage: { kind: 'options', title: 'Which planet has the most moons?', right: 'C' }, phone: { kind: 'abcd', picked: 'C', result: 'Right' } },
      },
      {
        title: 'Scores',
        you: 'Press S for the scoreboard.',
        phones: 'Their points and place.',
        room: 'The scoreboard.',
        art: { stage: { kind: 'scores', rows: [['Priya', '40'], ['Sam', '35'], ['Ade', '30']] }, phone: { kind: 'points', q: 'Your score', pts: '30 points', note: '3rd of 18' } },
      },
    ],
    get: {
      text: 'Scores, and which questions the room knew or missed.',
      art: { stage: { kind: 'report', title: 'Session report · Friday quiz', rows: ['Scores', 'Questions the room knew', 'Questions the room missed'] } },
    },
  },

  poll: {
    steps: [
      {
        title: 'You ask',
        you: 'Ask a choice, a rating, yes or no, or an open question.',
        phones: 'Its options, straight away.',
        room: 'The question and its options.',
        art: { stage: { kind: 'options', title: 'Best day to meet in person?', labels: ['Mon', 'Wed', 'Fri', 'None'] }, phone: { kind: 'choice', opts: ['Monday', 'Wednesday', 'Friday'] } },
      },
      {
        title: 'Results fill in live',
        you: 'Watch the result build.',
        phones: 'People answer on their phones. No names, no right answer.',
        room: 'The bars fill in as people answer.',
        art: { stage: { kind: 'bars', title: 'Best day to meet in person?', bars: [['Monday', 70], ['Wednesday', 40], ['Friday', 18]] }, phone: { kind: 'choice', opts: ['Monday', 'Wednesday', 'Friday'], picked: 0 } },
      },
      {
        title: 'Show results',
        you: 'Show results, then the next question.',
        phones: 'The result, as the room answered.',
        room: 'The board freezes for everyone to read.',
        art: { stage: { kind: 'bars', title: 'Best day to meet in person?', bars: [['Monday', 82], ['Wednesday', 46], ['Friday', 20]], done: true }, phone: { kind: 'points', q: 'Monday', pts: '58%', note: 'of the room' } },
      },
    ],
    get: {
      text: 'Each result, as the room answered it.',
      art: { stage: { kind: 'report', title: 'Session report · Team pulse', rows: ['Best day to meet in person?', 'How was the week?', 'Anything else?'] } },
    },
  },

  wavelength: {
    steps: [
      {
        title: 'You give a subject',
        you: 'Put the subject up.',
        phones: 'The subject and ten word boxes.',
        room: 'The subject.',
        art: { stage: { kind: 'subject', term: 'Onboarding' }, phone: { kind: 'boxes', q: 'Onboarding' } },
      },
      {
        title: 'Everyone writes words',
        you: 'Wait until everyone is in.',
        phones: 'They go for the obvious words the rest will think of too.',
        room: 'How many have answered. Nothing else shows until everyone is in.',
        art: { stage: { kind: 'count', title: 'Onboarding', count: '14', of: '/18' }, phone: { kind: 'boxes', q: 'Onboarding', typed: ['docs', 'buddy'] } },
      },
      {
        title: 'The shared words',
        you: 'Show the words.',
        phones: '',
        room: 'Spellings and plurals count together. Words on every list stand out; the rest show how many said them.',
        art: { stage: { kind: 'cloud', words: [['docs', '×6', true], ['buddy', '4'], ['laptop', '3'], ['wiki', '2']] }, phone: null },
      },
      {
        title: 'End of the session',
        you: 'End the session.',
        phones: '',
        room: 'The words the whole room shared. Nobody scores.',
        art: { stage: { kind: 'shared', words: ['docs', 'buddy', 'access'] }, phone: null },
      },
    ],
    get: {
      text: 'Where the team already thinks alike, and where it doesn’t.',
      art: { stage: { kind: 'report', title: 'Session report · Team words', rows: ['Onboarding', 'Words the room shared', 'Words only some wrote'] } },
    },
  },

  survey: {
    steps: [
      {
        title: 'Open it',
        you: 'Press Open the survey: it is created and opened at once.',
        phones: 'People join with the code or the QR.',
        room: 'The join code and QR.',
        art: { stage: { kind: 'qr', code: '4821' }, phone: null },
      },
      {
        title: 'People answer in their own time',
        you: 'Watch how far the room has got.',
        phones: 'Every question, on their own phone, at their own pace.',
        room: 'How many have finished.',
        art: { stage: { kind: 'progress', label: '23 of 36 finished', pct: 64 }, phone: { kind: 'form', done: 2 } },
      },
      {
        title: 'Warn, then close',
        you: 'Send a two-minute warning, then close it.',
        phones: 'The warning, on every phone.',
        room: 'The warning, then the survey closes.',
        art: { stage: { kind: 'progress', label: '2 minutes left', pct: 92, warn: true }, phone: { kind: 'points', q: 'Two minutes left', pts: '2:00', note: 'Finish your answers' } },
      },
      {
        title: 'Read it back',
        you: 'See the results yourself, walk through them with the room, then Workie’s summary.',
        phones: '',
        room: 'The results, as you walk through them.',
        art: { stage: { kind: 'bars', title: 'How was the offsite?', bars: [['Great', 76], ['Fine', 40], ['Poor', 12]], done: true }, phone: null },
      },
    ],
    get: {
      text: 'The answers added up, with names only if you chose that.',
      art: { stage: { kind: 'report', title: 'Survey report · Offsite feedback', rows: ['Answers added up', 'Workie’s summary', 'Names: only if you chose them'] } },
    },
  },

  [BUILD_KIND]: {
    steps: [
      {
        title: 'Set it up',
        you: 'On the Build Room page: the title, the goal (or let the room decide), and connect your Claude Code.',
        phones: '',
        room: '',
        art: { stage: { kind: 'connected', title: 'Food bank sign-up', ok: 'Claude Code connected' }, phone: null },
      },
      {
        title: 'Claude asks the room',
        you: 'Check each question Claude writes before it goes out.',
        phones: 'Ideas to suggest, a choice between options or mockups, or a rating.',
        room: 'Claude’s question and the options.',
        art: { stage: { kind: 'mockups', cap: 'Which sign-up page?' }, phone: { kind: 'choice', opts: ['Page A', 'Page B'] } },
      },
      {
        title: 'The room answers',
        you: 'Watch the answers come in.',
        phones: 'On phones, tablets or laptops, with the four-digit code.',
        room: 'The answers as they come in.',
        art: { stage: { kind: 'mockups', cap: 'Which sign-up page?', pick: 'A', bars: true }, phone: { kind: 'choice', opts: ['Page A', 'Page B'], picked: 0 } },
      },
      {
        title: 'You decide',
        you: 'Turn the room’s answer into a direction and Claude builds it. Then the next question.',
        phones: '',
        room: 'The direction you sent to Claude.',
        art: { stage: { kind: 'direction', k: 'Direction for Claude', text: 'Build page A, with B’s big button.' }, phone: null },
      },
    ],
    get: {
      text: 'Something built, every decision the room made, and a report.',
      art: { stage: { kind: 'report', title: 'Build report · Food bank sign-up', rows: ['What was built', 'Every decision the room made', 'Each question and its answers'] } },
    },
  },

  [EVENT_KIND]: {
    steps: [
      {
        title: 'Plan the day',
        you: 'Name, date, start time and place, then the agenda: up to 16 items.',
        phones: '',
        room: '',
        art: { stage: { kind: 'agenda', items: [['09:00', 'Welcome'], ['09:20', 'Trivia'], ['09:45', 'Break'], ['10:00', 'Call & Answer']] }, phone: null },
      },
      {
        title: 'One code all day',
        you: 'Open the event.',
        phones: 'People join once. Their phones follow the agenda.',
        room: 'The join code and QR.',
        art: { stage: { kind: 'qr', code: '4821' }, phone: null },
      },
      {
        title: 'You start each item',
        you: 'Start each item when it is due.',
        phones: 'Straight into it: a quiz, a poll, a Call & Answer round, a talk or a break.',
        room: 'The item that is on now.',
        art: { stage: { kind: 'agenda', items: [['09:00', 'Welcome', 'done'], ['09:20', 'Trivia', 'now'], ['09:45', 'Break'], ['10:00', 'Call & Answer']] }, phone: { kind: 'abcd' } },
      },
      {
        title: 'Each item reports',
        you: 'Read each session’s report, gathered under the event.',
        phones: '',
        room: '',
        art: { stage: { kind: 'report', title: 'Platform Offsite', rows: ['09:20 Trivia', '10:00 Call & Answer', '11:00 Poll'] }, phone: null },
      },
    ],
    get: {
      text: 'Each item’s report, gathered under the event.',
      art: { stage: { kind: 'report', title: 'Event · Platform Offsite', rows: ['Trivia report', 'Call & Answer report', 'Poll report'] } },
    },
  },
});

/** The walkthrough for a format id, or null. */
export function walkthroughFor(id) {
  return FORMAT_WALKTHROUGH[id] || null;
}

/** How long Play holds each step (README round 2, decision 4). */
export const PLAY_MS = 8000;
