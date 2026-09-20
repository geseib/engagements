/**
 * Copy for HomePage, transcribed from the owner-approved mockup
 * docs/design/marketing-redesign/01-home.html. Every string here should be
 * traceable to that file; HTML entities (&rsquo; &mdash; &middot; &ldquo;
 * &rdquo; &rarr;) are decoded to their real characters.
 */
export const HOME = {
  hero: {
    kicker: 'Base camp',
    headline: 'Turn your team’s own material into decisions everyone climbed toward.',
    lead: 'Build question sets from what your team already has. Run them as trivia to warm the room up, or as call and answer to collect every idea and put it to a vote. Everyone plays from their phone. The session ends with a report.',
    ctaPrimary: 'Create a host account',
    ctaSecondary: 'Sign in',
  },
  problem: {
    kicker: 'The climb starts here',
    title: 'Most sessions lose the thing they were for.',
    items: [
      {
        n: '01',
        title: 'A few voices decide',
        text: 'The same three people talk. The quiet half of the room has the answer and no way into the conversation.',
      },
      {
        n: '02',
        title: 'Ideas leave with the people',
        text: 'Written on a whiteboard, photographed by two of them, typed up by nobody.',
      },
      {
        n: '03',
        title: 'Nobody remembers what was decided',
        text: 'Six weeks later the decision is folklore, and the reasoning that produced it is gone.',
      },
    ],
  },
  modes: {
    kicker: 'Two ways to play',
    title: 'One set of questions, two shapes of round.',
    lead: 'Both run on the screen at the front of the room while everyone answers on their own phone.',
    items: [
      {
        id: 'trivia',
        tag: 'Trivia',
        heading: 'Warm the room up, or check what landed.',
        text: 'A question, four options, one right answer. The room answers, the answer is revealed with its explanation, and the standings move.',
        list: [
          'Ask, then results. Trivia has no vote phase.',
          'Each question carries its own category, difficulty and explanation.',
          'Running standings after every question.',
        ],
        slots: ['trivia-host', 'trivia-player'],
      },
      {
        id: 'poll',
        tag: 'Call and answer',
        heading: 'Pose a prompt, collect every idea, then vote.',
        text: 'Everyone writes at once, so the room hears from the people it usually does not. Then the room reads the answers and votes on them.',
        list: [
          'Ask, vote, results — three phases you move through.',
          'Every answer is kept, not only the ones that won votes.',
          'The vote breakdown is kept per answer and goes into the report.',
        ],
        slots: ['poll-host', 'poll-player'],
        flip: true,
      },
    ],
  },
  material: {
    kicker: 'Your own material',
    title: 'The questions come from your work, not from a quiz pack.',
    lead: 'Hand the builder the strategy document, the retro notes, the deck you are about to present. It drafts a set. You decide what runs.',
    steps: [
      {
        n: 1,
        title: 'Supply the material',
        text: 'Documents and topics you already have. Or write the questions yourself — the builder is a convenience, not a requirement.',
      },
      {
        n: 2,
        title: 'A set is drafted',
        text: 'The AI builders turn it into trivia questions or call-and-answer prompts, each with its category and its detail.',
      },
      {
        n: 3,
        title: 'You review and edit',
        text: 'Preview the set as a player will see it, change anything, drop anything. Nothing runs until you start a session with it.',
      },
      {
        n: 4,
        title: 'It is stored where it belongs',
        text: 'In your organisation’s private library, encrypted. Or take a starting point from the moderated public library.',
      },
    ],
    note: {
      strong: 'Private stays private.',
      text: 'An organisation’s sets are encrypted and are readable only inside that organisation. The public library is separate, moderated, and nothing reaches it without being published on purpose.',
    },
  },
  room: {
    kicker: 'The room reacts',
    title: 'Answers arrive live. The team votes. The strongest ideas rise.',
    tally: {
      question: 'What should we stop doing?',
      meta: '20 people answered. 20 votes cast.',
      rows: [
        { text: 'Parallel discovery on three products at once', votes: 9, width: 82, cool: false },
        { text: 'The weekly status meeting nobody reads', votes: 7, width: 64, cool: false },
        { text: 'Hand-built release notes', votes: 4, width: 36, cool: true },
        { text: 'Two-week estimates on unscoped work', votes: 0, width: 2, cool: true },
      ],
      note: 'The answer with no votes is kept too. A session that quietly discards it is a session you cannot go back to.',
    },
    lead: 'Everyone writes at the same time, so the room does not have to take turns to be heard.',
    list: [
      'Answers appear on the front screen as they are submitted.',
      'The room reads them, then votes — on what was actually said, not on who said it loudest.',
      'The count is a vote count. It is not a quality score and the report never calls it one.',
      'Names can be hidden for a whole session if the subject needs it.',
    ],
  },
  summit: {
    kicker: 'The summit',
    title: 'Everyone leaves with the same page.',
    lead: 'The report is written as the session runs. Nobody has to type the whiteboard up afterwards.',
    link: 'See a full report, annotated →',
  },
  start: {
    kicker: 'Ready when you are',
    title: 'Bring your own material. Leave with a decision.',
    ctaPrimary: 'Create a host account',
    ctaSecondary: 'See how it works',
    fine: 'Players never need an account. Hosts sign in once.',
  },
};
