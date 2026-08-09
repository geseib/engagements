/**
 * The setup control's *decisions*, tested as pure logic.
 *
 * Rendering GameHostPage in jsdom currently fails on the auth provider (see the
 * five stale suites in the handoff), so this asserts the two rules that matter
 * and that a component test would otherwise re-derive: which game types offer
 * the option at all, and what the create payload carries.
 */
import { hostRunsVotePhase } from '../config/hostControls';
import { anonymityApplies, createPayloadFor } from '../config/anonymity';

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
