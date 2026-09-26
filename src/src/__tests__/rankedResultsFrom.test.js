/**
 * THE ROUND'S RANKED RESPONSES — fix round 1, item 3.
 *
 * The player's own feedback panel used to snapshot the page's raw `answers`
 * state, which for Call & Answer is the VOTE-TIME ballot (no ranks) and is
 * `[]` after a reload during RESULTS (`loadResultsData` never repopulates
 * `answers` for this game type — only trivia's branch does), so the panel
 * printed "Nobody responded to this round" for a round that had responses.
 *
 * `rankedResultsFrom` is a pure function exported from PlayerPage.jsx (the
 * same pattern `rankHolding` already uses) specifically so this can be a real
 * behavioural test rather than a source-regex one: PlayerPage.jsx itself CAN
 * be imported and even mounted in this repo's test harness (see
 * voteSwitching.test.jsx, PlayerPage.test.jsx), so a named export is testable
 * directly with no mount needed at all.
 */
import { rankedResultsFrom } from '../PlayerPage';

describe('trivia: data.leaderboard is already ranked', () => {
  test('is used as-is, mapped to the flat shape RoundReport reads', () => {
    const data = {
      leaderboard: [
        { rank: 1, playerName: 'Ada', answer: 'OptionB', isCorrect: true, pointsEarned: 10 },
        { rank: 2, playerName: 'Grace', answer: 'OptionA', isCorrect: false, pointsEarned: 0 },
      ],
    };
    expect(rankedResultsFrom(data)).toEqual([
      { answer: 'OptionB', playerName: 'Ada', rank: 1 },
      { answer: 'OptionA', playerName: 'Grace', rank: 2 },
    ]);
  });
});

describe('Call & Answer: data.voteTallies is an OBJECT, not an array', () => {
  test('is converted to a ranked array, highest score first', () => {
    const data = {
      voteTallies: {
        0: { answerText: 'Freeze discounting.', playerName: 'Dana', totalScore: 3 },
        1: { answerText: 'Re-price the package.', playerName: 'Sam', totalScore: 7 },
      },
    };
    expect(rankedResultsFrom(data)).toEqual([
      { answer: 'Re-price the package.', playerName: 'Sam', rank: 1 },
      { answer: 'Freeze discounting.', playerName: 'Dana', rank: 2 },
    ]);
  });

  test('a tie shares the same rank, the way create-report.js ranks answers (1, 1, 3 — not 1, 1, 2)', () => {
    const data = {
      voteTallies: {
        0: { answerText: 'A', playerName: 'Ada', totalScore: 5 },
        1: { answerText: 'B', playerName: 'Grace', totalScore: 5 },
        2: { answerText: 'C', playerName: 'Katherine', totalScore: 2 },
      },
    };
    const ranked = rankedResultsFrom(data);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(ranked.map((r) => r.answer)).toEqual(['A', 'B', 'C']);
  });

  test('a round nobody responded to is genuinely empty, not falsely so', () => {
    expect(rankedResultsFrom({ voteTallies: {} })).toEqual([]);
  });
});

describe('anything else — wavelength, or "no votes found" — has no ranked rows to offer', () => {
  test('a response with neither leaderboard nor voteTallies returns an empty list', () => {
    expect(rankedResultsFrom({ message: 'No votes found for this question', totalVotes: 0 })).toEqual([]);
  });

  test('null or undefined input does not throw', () => {
    expect(rankedResultsFrom(null)).toEqual([]);
    expect(rankedResultsFrom(undefined)).toEqual([]);
  });
});
