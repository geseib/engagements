// Realistic report payload, shaped as create-report.js returns it (call-and-answer).
const players = [
  ['Priya Raman', 34, '2026-10-28T15:02:10Z'], ['Marcus Hale', 29, '2026-10-28T15:02:31Z'],
  ['Elena Sokolova', 27, '2026-10-28T15:03:02Z'], ['Tom Becker', 22, '2026-10-28T15:03:20Z'],
  ['Aisha Okafor', 19, '2026-10-28T15:03:44Z'], ['Jun Watanabe', 15, '2026-10-28T15:04:05Z'],
  ['Grace Liu', 12, '2026-10-28T15:04:40Z'], ['Dev Malhotra', 8, '2026-10-28T15:05:12Z'],
].map(([playerName, totalScore, joinedAt]) => ({ playerName, totalScore, joinedAt }));

const rank = (r) => (r === 1 ? '🥇 1st Place' : r === 2 ? '🥈 2nd Place' : r === 3 ? '🥉 3rd Place' : `${r}th Place`);
const ans = (list) => list.map(([answerText, playerName, f, s, t], i, all) => {
  const totalScore = f * 3 + s * 2 + t;
  return { answerText, playerName, firstPlace: f, secondPlace: s, thirdPlace: t, totalScore,
    voteBreakdown: `${f} first, ${s} second, ${t} third` };
}).sort((a, b) => b.totalScore - a.totalScore).map((a, i) => ({ ...a, rank: i + 1, rankDisplay: rank(i + 1) }));

export const reportData = {
  gameId: '4417',
  eventTitle: 'Platform Team Offsite — Big Bets',
  gameType: 'call-and-answer',
  roundNoun: null,
  eventDetails: 'Half-day offsite for the platform engineering group. We are deliberately setting today\'s constraints aside to find out what the team would build if staffing and budget were not the question.',
  questionSetData: { description: 'Three rounds. Answer on your phone, read everyone\'s answers, then vote for your top three. Be specific — a named thing beats a category.' },
  players,
  questions: [
    {
      questionNumber: 1,
      questionData: {
        title: 'If we had unlimited people and resources, what should we build?',
        detail: 'Forget the roadmap and the headcount plan for a minute. If money and people were not the constraint, what is the one thing this team should build — and why would it matter?',
        category: 'Big Bets',
      },
      aiSummary: { markdownResponse: `## Summary
The room split between **delight** and **drudgery**. The winning answer — a one-week tech-debt remover sold as a service — was the only one that named a customer who would pay, and it collected first-place votes from five of eight people.

## What the room said
- The tech-debt remover read as a joke and was voted as a strategy: three people argued in comments that it is already what the platform team does, unbilled.
- The grass-seeding robot was the most *concrete* idea and the only one with a physical-world customer.
- The Rube Goldberg machine and the AI fax machine were voted as morale, not as bets.

## Discussion Questions
1. If the tech-debt remover is what we already do, why is it invisible on the roadmap?
2. What would a one-week fixed-scope engagement have to exclude to be sellable?

## Recommended Next Steps
1. Write a one-page offer for a fixed one-week debt sprint and test it with two internal teams.
2. Track debt work as its own line so its value is visible next quarter.` },
      answers: ans([
        ['A for-hire one-week enterprise tech-debt remover', 'Elena Sokolova', 5, 2, 1],
        ['A grass-seeding robot', 'Marcus Hale', 2, 3, 2],
        ['An AI-enabled fax machine', 'Tom Becker', 1, 2, 3],
        ['A Rube Goldberg machine', 'Priya Raman', 0, 1, 2],
      ]),
      comments: [
        { commentId: 'c1', anchorLabel: 'Response 1 — Elena Sokolova', anchorExcerpt: 'A for-hire one-week enterprise tech-debt remover', text: 'Only half a joke. We do this every quarter for free and nobody budgets for it.', playerName: 'Aisha Okafor', featured: true },
        { commentId: 'c2', anchorLabel: 'Summary', anchorExcerpt: 'The room split between delight and drudgery.', text: 'The fax machine got votes because it was funny. Do not read it as demand.', playerName: 'Jun Watanabe' },
      ],
    },
    {
      questionNumber: 2,
      questionData: {
        title: 'The Work We Would Show First',
        detail: 'A serious buyer gets one thing from us before they decide anything, and it is not the roadmap - it is a piece of work that already exists. Pick the one you would put in front of them, and say what it proves that a claim could not.',
        category: 'Proof',
      },
      aiSummary: { markdownResponse: `## Summary
Almost every answer pointed at the **deploy pipeline**, not a product feature. The room believes its strongest proof is operational: things ship safely and often.

## Recommended Next Steps
1. Turn the pipeline dashboard into a two-minute walkthrough a buyer can watch.` },
      answers: ans([
        ['The zero-downtime migration runbook — it proves we finish hard things without an outage.', 'Priya Raman', 4, 2, 1],
        ['Our deploy dashboard: 40 releases a week, nobody paged.', 'Grace Liu', 3, 2, 2],
        ['The incident review archive, because it shows how we learn.', 'Dev Malhotra', 1, 3, 2],
      ]),
      comments: [],
    },
    {
      questionNumber: 3,
      questionData: {
        title: 'The Sentence We Would Lead With',
        detail: 'One sentence, in the words a customer would use rather than ours, saying what this team is for. Not a mission statement - the sentence you would actually say if you had ten seconds and one chance.',
        category: 'Positioning',
      },
      aiSummary: null,
      answers: ans([
        ['We make the boring parts of shipping disappear.', 'Marcus Hale', 4, 1, 2],
        ['Your engineers ship features; we make sure they land.', 'Elena Sokolova', 2, 3, 1],
      ]),
      comments: [],
    },
  ],
};
