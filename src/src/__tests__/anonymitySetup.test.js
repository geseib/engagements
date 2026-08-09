/**
 * The setup control's *decisions*, tested as pure logic.
 *
 * Rendering GameHostPage in jsdom currently fails on the auth provider (see the
 * five stale suites in the handoff), so this asserts the two rules that matter
 * and that a component test would otherwise re-derive: which game types offer
 * the option at all, and what the create payload carries.
 */
import { hostRunsVotePhase } from '../config/hostControls';
import {
  anonymityApplies, createPayloadFor, displayLabelFor, isRedacted, standingsVisible,
} from '../config/anonymity';

describe('which formats offer anonymous responses', () => {
  // Not a new taxonomy — exactly the set that holds a vote.
  test.each(['call-and-answer', 'poll', 'survey'])('%s offers it', (type) => {
    expect(anonymityApplies(type)).toBe(true);
  });

  // An option that cannot do anything is a question a host should not be asked,
  // so these hide it rather than showing it disabled.
  test.each(['trivia', 'wavelength'])('%s hides it', (type) => {
    expect(anonymityApplies(type)).toBe(false);
  });

  test('it tracks hostRunsVotePhase rather than a second list', () => {
    for (const t of ['call-and-answer', 'poll', 'survey', 'trivia', 'wavelength']) {
      expect(anonymityApplies(t)).toBe(hostRunsVotePhase(t));
    }
  });
});

describe('the create payload', () => {
  test('defaults to anonymous when the host never touches setup', () => {
    expect(createPayloadFor({ gameType: 'call-and-answer' }).anonymousUntilReveal).toBe(true);
  });

  test('carries an explicit opt-out', () => {
    expect(createPayloadFor({ gameType: 'call-and-answer', anonymousResponses: false })
      .anonymousUntilReveal).toBe(false);
  });

  // The backend defaults ON for any value that is not exactly false, so a
  // non-voting type must send `false` explicitly rather than omitting the key —
  // otherwise a trivia game is silently "anonymous" with nothing to anonymise.
  test('a non-voting type sends false explicitly, not undefined', () => {
    const payload = createPayloadFor({ gameType: 'trivia' });
    expect(payload.anonymousUntilReveal).toBe(false);
  });
});

describe('how an answer is labelled', () => {
  const anon = { answer: 'a splendid answer' };
  const named = { playerName: 'Ada', answer: 'a splendid answer' };

  test('a redacted row is labelled by position, 1-based', () => {
    expect(displayLabelFor(anon, 0)).toBe('Response 1');
    expect(displayLabelFor(anon, 2)).toBe('Response 3');
  });

  test('an attributed row is labelled by name', () => {
    expect(displayLabelFor(named, 0)).toBe('Ada');
  });

  // Omit-not-null is the backend contract; this is the client half of it.
  test('the absence of playerName is what marks a row redacted', () => {
    expect(isRedacted(anon)).toBe(true);
    expect(isRedacted(named)).toBe(false);
  });

  test('a literal null never renders as the string "null"', () => {
    expect(displayLabelFor({ playerName: null, answer: 'x' }, 0)).toBe('Response 1');
  });

  test('an empty-string name is treated as redacted, not as a blank label', () => {
    expect(displayLabelFor({ playerName: '', answer: 'x' }, 1)).toBe('Response 2');
  });
});

describe('standings before the reveal', () => {
  test('hidden while an anonymous round is unrevealed', () => {
    expect(standingsVisible({ gameType: 'call-and-answer', authorsRevealed: false })).toBe(false);
  });
  test('shown once revealed', () => {
    expect(standingsVisible({ gameType: 'call-and-answer', authorsRevealed: true })).toBe(true);
  });
  test('always shown for a format with no anonymity', () => {
    expect(standingsVisible({ gameType: 'trivia', authorsRevealed: false })).toBe(true);
  });
});
