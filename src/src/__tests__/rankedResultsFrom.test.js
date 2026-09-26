/**
 * THE ROUND'S RANKED RESPONSES — fix round 1, item 3; extended fix round 2,
 * item 1.
 *
 * The player's own feedback panel used to snapshot the page's raw `answers`
 * state, which for Call & Answer is the VOTE-TIME ballot (no ranks) and is
 * `[]` after a reload during RESULTS (`loadResultsData` never repopulates
 * `answers` for this game type — only trivia's branch does), so the panel
 * printed "Nobody responded to this round" for a round that had responses.
 * Fetching fresh from `get-results` fixed Call & Answer with votes and trivia
 * — but missed two shapes, which fix round 2's re-review found: wavelength
 * (every round said nobody responded, though the payload always carries
 * `answers`) and Call & Answer with ZERO votes (the server's own early
 * return there carries no response text at all, which is a DIFFERENT claim
 * from "nobody responded" and must say so, not fall through to it silently).
 *
 * `rankedResultsFrom` and `feedbackAnswersStatusFrom` are pure functions
 * exported from PlayerPage.jsx (the same pattern `rankHolding` already uses)
 * specifically so this can be a real behavioural test rather than a
 * source-regex one: PlayerPage.jsx itself CAN be imported and even mounted in
 * this repo's test harness (see voteSwitching.test.jsx, PlayerPage.test.jsx),
 * so a named export is testable directly with no mount needed at all.
 */
import { rankedResultsFrom, feedbackAnswersStatusFrom } from '../PlayerPage';

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

  test('ZERO VOTES: the array is empty, but this is NOT "nobody responded" — see feedbackAnswersStatusFrom below', () => {
    // Renamed from "genuinely empty" (fix round 2, item 1): get-results.js's
    // own early return for zero votes carries no response text at all
    // ({message, totalVotes: 0, winners: [], voteTallies: {}}), so this is
    // "we don't know", not "nobody responded" — a claim this function alone
    // cannot make, which is exactly why feedbackAnswersStatusFrom exists.
    expect(rankedResultsFrom({ voteTallies: {} })).toEqual([]);
  });
});

describe('WAVELENGTH: data.answers is one row per submission, genuinely unranked', () => {
  test('every submission is shown, numbered in submission order', () => {
    // Round 1 missed this shape entirely: `rankedResultsFrom` checked only
    // `leaderboard` and `voteTallies`, so every wavelength round's panel said
    // nobody responded — even though get-results.js's wavelength handler
    // always returns one row per submission.
    const data = {
      gameType: 'wavelength',
      answers: [
        { playerName: 'Ada', name: 'Ada', answer: 'ocean, tide, moon', words: ['ocean', 'tide', 'moon'] },
        { playerName: 'Grace', name: 'Grace', answer: 'compile, debug', words: ['compile', 'debug'] },
      ],
      wordAnalysis: { totalAnswers: 2 },
      teamScore: 4,
    };
    expect(rankedResultsFrom(data)).toEqual([
      { answer: 'ocean, tide, moon', playerName: 'Ada', rank: 1 },
      { answer: 'compile, debug', playerName: 'Grace', rank: 2 },
    ]);
  });

  test('a wavelength round with no submissions is genuinely empty, not falsely so', () => {
    expect(rankedResultsFrom({ gameType: 'wavelength', answers: [] })).toEqual([]);
  });

  test('leaderboard is still checked first, so a trivia payload never falls through to this branch', () => {
    // Trivia's own response also carries an `answers` array (parallel to its
    // `leaderboard`) — order of the checks inside rankedResultsFrom matters,
    // or trivia would silently lose its real ranks to array order instead.
    const data = {
      leaderboard: [{ rank: 1, playerName: 'Ada', answer: 'OptionB' }],
      answers: [{ playerName: 'Ada', answer: 'OptionB' }],
    };
    expect(rankedResultsFrom(data)).toEqual([{ answer: 'OptionB', playerName: 'Ada', rank: 1 }]);
  });

  test('null or undefined input does not throw', () => {
    expect(rankedResultsFrom(null)).toEqual([]);
    expect(rankedResultsFrom(undefined)).toEqual([]);
  });
});

describe('feedbackAnswersStatusFrom — WHY the list is empty, when it is (fix round 2, item 1)', () => {
  test('trivia and wavelength are both "ok", however many rows they carry', () => {
    expect(feedbackAnswersStatusFrom({ leaderboard: [] })).toBe('ok');
    expect(feedbackAnswersStatusFrom({ leaderboard: [{ rank: 1 }] })).toBe('ok');
    expect(feedbackAnswersStatusFrom({ answers: [] })).toBe('ok');
    expect(feedbackAnswersStatusFrom({ answers: [{ answer: 'x' }] })).toBe('ok');
  });

  test('Call & Answer WITH votes is "ok"', () => {
    expect(feedbackAnswersStatusFrom({ voteTallies: { 0: { answerText: 'x', totalScore: 1 } } })).toBe('ok');
  });

  test('Call & Answer with ZERO votes is "no-data", not "ok"', () => {
    expect(feedbackAnswersStatusFrom({ voteTallies: {} })).toBe('no-data');
    expect(feedbackAnswersStatusFrom({
      message: 'No votes found for this question', totalVotes: 0, winners: [], voteTallies: {},
    })).toBe('no-data');
  });

  test('an unrecognised or missing shape is "no-data", the conservative default', () => {
    expect(feedbackAnswersStatusFrom({})).toBe('no-data');
    expect(feedbackAnswersStatusFrom(null)).toBe('no-data');
    expect(feedbackAnswersStatusFrom(undefined)).toBe('no-data');
  });
});
