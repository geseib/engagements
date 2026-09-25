/**
 * Copy for HomePage, transcribed from the owner-approved mockup
 * docs/design/marketing-redesign/01-home.html. Every string here should be
 * traceable to that file; HTML entities (&rsquo; &mdash; &middot; &ldquo;
 * &rdquo; &rarr;) are decoded to their real characters.
 *
 * Refreshed 2026-09-22 against docs/design/refresh-2026-09-22/RATIONALE.md
 * section 1 (ranked changes 1, 3 and finding 6): the headline is carried as
 * four authored lines; only two kickers survive (#top and #summit); the
 * problem statements lose their 01/02/03; each mode says its fact once, in
 * the list, rather than in a paragraph and again as the first list item.
 *
 * REWORDED 2026-09-25 against docs/design/front-page-copy-2026-09-25/COPY.md
 * (the owner approved the "Proposed" column of home.html there). Two things
 * changed at once, and COPY.md gives the reason for every string:
 *
 *   - Plain words, by Orwell's rules: no stale figures ("climbed toward",
 *     "what landed", "the strongest ideas rise"), active voice, everyday
 *     words for jargon ("shapes of round", "pose a prompt", "phase").
 *   - Claims the product does not make good were corrected, checked against
 *     the code: answers go up on the screen when the vote opens, not as they
 *     arrive; each player ranks a top three, scored 3/2/1, so the counts are
 *     points, not votes; names come back at the results; the trivia
 *     explanation is not on the screen; slide decks are refused (PDF, Word or
 *     text only); staff can decrypt a team's sets, so the note says nobody
 *     outside the team can open them in the app; new hosts wait for
 *     approval. People take part on a phone, laptop or tablet.
 *
 * The library claim in `material.lead` names only what Engage's shared
 * library holds on dev, test AND prod: "Historic World Leaders" (Lincoln's
 * cabinet of rivals, among fifty) and "(Demo) Lessons from Different
 * Schools", whose SourceAttribution names Don Norman's The Design of Everyday
 * Things. Change that sentence if either set leaves the shared library.
 */
export const HOME = {
  hero: {
    kicker: 'For offsites, workshops and retros',
    // Four short lines the two-column hero can hold; under 720px they flow as
    // one sentence (HomePage.css `.mk-rise > span`).
    headlineLines: ['Bring your team', 'a new idea.', 'Hear what everyone', 'makes of it.'],
    lead: 'Each round gives the team something to work through: a lesson from a hard book, a choice a leader in history faced, or a problem of your own. Everyone answers on a phone, laptop or tablet, and the room votes on the answers. When you finish, the report is ready.',
    ctaPrimary: 'Create a host account',
    ctaSecondary: 'Sign in',
  },
  problem: {
    title: 'Most meetings hear from a few people and forget what they decided.',
    items: [
      {
        title: 'A few people decide',
        text: 'The same three people talk. Others in the room know the answer and never find a moment to say it.',
      },
      {
        title: 'Ideas leave with the people',
        text: 'Someone fills the whiteboard, two people photograph it, and nobody types it up.',
      },
      {
        title: 'Nobody remembers what you decided',
        text: 'Six weeks later, everyone remembers it differently, and nobody can say why you chose it.',
      },
    ],
  },
  modes: {
    title: 'Trivia to check what people know. Call and answer to hear what they think.',
    lead: 'Both run on the screen at the front of the room while everyone answers on their own phone, laptop or tablet. You can also run polls, surveys and Wavelength, a word game.',
    items: [
      {
        id: 'trivia',
        tag: 'Trivia',
        heading: 'Open with a quiz, or check what people remember.',
        list: [
          // Not "four options, one right answer, revealed with its
          // explanation": trivia takes 4–6 options, and the explanation never
          // reaches the front screen (game/get-question.js withholds it).
          'Multiple-choice questions, each with a right answer.',
          'No vote here: people answer, then you show the results.',
          // The stage shows a top-three podium (config/podium.js); each phone
          // shows its own place (PlayerPage.jsx).
          'After each question the top three go up on the screen, and every player sees their own place.',
        ],
        slots: ['trivia-host', 'trivia-player'],
      },
      {
        id: 'poll',
        tag: 'Call and answer',
        heading: 'Ask an open question, collect every idea, then vote.',
        list: [
          'Everyone types an answer at the same time, so you hear from people who rarely speak up.',
          'Then each person ranks the three answers they like best.',
          'The results go up on the screen, followed by an AI summary of what the room said.',
        ],
        slots: ['poll-host', 'poll-player'],
        flip: true,
      },
    ],
  },
  material: {
    title: 'Bring your own material, or borrow a lesson from a book or from history.',
    lead: 'Start from our library, with lessons from books such as The Design of Everyday Things and from leaders such as Lincoln, each turned into a question about your own work. Or upload your own documents and let the AI draft a set. You decide which questions run.',
    steps: [
      {
        n: 1,
        title: 'Add your material',
        text: 'Upload a PDF, Word or text file, or describe the subject. Or skip the AI and write every question yourself.',
      },
      {
        n: 2,
        title: 'The AI drafts a set',
        text: 'Trivia questions with answers and explanations, or open questions for call and answer, each with a category.',
      },
      {
        n: 3,
        title: 'You review and edit',
        text: 'Preview each question as the room will see it, then change or delete anything. Nothing runs until you start a session.',
      },
      {
        n: 4,
        title: 'It stays in your library',
        text: 'Your library is private and encrypted. You can also copy a set another team has shared and make it your own.',
      },
    ],
    note: {
      strong: 'Private stays private.',
      text: 'We encrypt the text of your questions, and nobody outside your team can open your sets in the app. A set reaches the public library only when an admin on your team shares it, and we check every one first.',
    },
  },
  room: {
    title: 'The whole room answers. Then the whole room votes.',
    tally: {
      question: 'What should we stop doing?',
      meta: '20 people answered, then each ranked their top three.',
      // Points, because that is what the results and the report show: a
      // first choice scores 3, a second 2, a third 1 (game/get-results.js).
      // Twenty ranked ballots hand out 120, and these rows add up to it.
      unit: 'points',
      rows: [
        { text: 'Parallel discovery on three products at once', points: 52, width: 82, cool: false },
        { text: 'The weekly status meeting nobody reads', points: 44, width: 69, cool: false },
        { text: 'Hand-built release notes', points: 24, width: 38, cool: true },
        { text: 'Two-week estimates on unscoped work', points: 0, width: 2, cool: true },
      ],
      note: 'The answer nobody picked stays in the report too. You may want it next quarter.',
    },
    lead: 'Everyone writes at the same time, so nobody has to wait for a turn to speak.',
    list: [
      // Not "as they are submitted": during ASK the stage shows the question
      // and a count; the answers go up when the vote opens.
      'When you move to the vote, every answer goes up on the front screen.',
      // Anonymous-until-reveal is on by default and ends at the results
      // (config/anonymity.js, game/get-results.js).
      'By default, names stay hidden until the results, so people vote on what was said, not on who said it.',
      'A high score means the room liked an answer. It does not mean the answer is right.',
    ],
  },
  summit: {
    kicker: 'The report',
    title: 'Nobody has to write it up afterwards.',
    lead: 'The session records every answer, vote and comment as it goes. At the end, open the report, print it, or save it as a PDF to share.',
    link: 'See a full sample report, with notes →',
  },
  photos: {
    room: {
      src: '/assets/hero/room-looking-up-1024.webp',
      alt: 'A room of people looking up from their phones toward a screen out of frame',
      caption: 'Looking up for the result.',
    },
    sheet: {
      src: '/assets/hero/summit-held-768.webp',
      alt: 'Two hands from opposite sides of a dark table holding one printed session report flat',
      caption: 'Two people, one report.',
    },
  },
  start: {
    title: 'Bring a problem. Leave with a decision everyone had a say in.',
    ctaPrimary: 'Create a host account',
    ctaSecondary: 'See how it works',
    fine: 'Players never need an account. Hosts sign up, and we approve each new host.',
  },
};
