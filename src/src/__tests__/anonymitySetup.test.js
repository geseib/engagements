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
  anonymityApplies, anonymityActive, authorsHiddenNow, createPayloadFor, displayLabelFor, isRedacted, standingsVisible,
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

describe('whether this game actually withheld authorship', () => {
  test('a voting format with the flag on (or unset) is active', () => {
    expect(anonymityActive({ gameType: 'call-and-answer', anonymousUntilReveal: true })).toBe(true);
    expect(anonymityActive({ gameType: 'call-and-answer' })).toBe(true); // default ON
  });
  test('a voting format with the flag explicitly off is not active', () => {
    expect(anonymityActive({ gameType: 'call-and-answer', anonymousUntilReveal: false })).toBe(false);
  });
  test('a format with no anonymity is never active, regardless of the flag', () => {
    expect(anonymityActive({ gameType: 'trivia', anonymousUntilReveal: true })).toBe(false);
  });
});

describe('standings before the reveal', () => {
  test('hidden while an anonymous round is unrevealed', () => {
    expect(standingsVisible({
      gameType: 'call-and-answer', anonymousUntilReveal: true, authorsRevealed: false,
    })).toBe(false);
  });
  test('shown once revealed', () => {
    expect(standingsVisible({
      gameType: 'call-and-answer', anonymousUntilReveal: true, authorsRevealed: true,
    })).toBe(true);
  });
  test('always shown for a format with no anonymity', () => {
    expect(standingsVisible({
      gameType: 'trivia', anonymousUntilReveal: true, authorsRevealed: false,
    })).toBe(true);
  });
  // IMPORTANT 2: a host who explicitly turned anonymity off for this game never
  // had anything to hide, so standings must not wait on a reveal that will
  // never meaningfully happen for this round.
  test('shown for a voting format when this game turned anonymity off, unrevealed or not', () => {
    expect(standingsVisible({
      gameType: 'call-and-answer', anonymousUntilReveal: false, authorsRevealed: false,
    })).toBe(true);
  });
});

/*
 * ARE THE AUTHORS STILL HIDDEN, RIGHT NOW — the predicate three call sites
 * re-derived by hand and got wrong the same way.
 *
 * Reported live, on a call-and-answer session with the default anonymity on:
 * *"it doesnt reveal names at the results for the round, and it doesnt show the
 * top 3 place overall. this used to be there before"*. The RESULTS stage asked
 * `anonymityActive` alone — the first half of `anonymous UNTIL reveal` — which
 * is true for every round of that session including the ones already revealed.
 * So the names never came back and `podiumEntries` bailed at its anonymity
 * gate, for the whole game, on the one format that has a podium.
 *
 * The server had already sent every author by then: closing a round writes
 * AuthorsRevealed unconditionally (get-results.js's enterResultsState). Only the
 * client was still hiding.
 */
describe('whether the authors are hidden right now', () => {
  // rejects: THE REPORTED BUG. `anonymityActive` is true here and must not be
  //          the answer — the round has been revealed, which is the whole
  //          second half of the setting's name.
  test('a revealed round is not hidden, even on an anonymous session', () => {
    expect(authorsHiddenNow({
      gameType: 'call-and-answer', anonymousUntilReveal: true, authorsRevealed: true,
    })).toBe(false);
  });

  // rejects: revealing early. Before the round closes there is a real ballot on
  //          the stage and the promise made to the room still stands.
  test('an unrevealed round on an anonymous session is hidden', () => {
    expect(authorsHiddenNow({
      gameType: 'call-and-answer', anonymousUntilReveal: true, authorsRevealed: false,
    })).toBe(true);
  });

  // rejects: reading a missing flag as a reveal. A payload that says nothing
  //          about the reveal has not reported one, and the safe reading of
  //          silence is that the names are still down.
  test('an absent flag is not a reveal', () => {
    expect(authorsHiddenNow({ gameType: 'call-and-answer', anonymousUntilReveal: true }))
      .toBe(true);
    expect(authorsHiddenNow({
      gameType: 'call-and-answer', anonymousUntilReveal: true, authorsRevealed: 'yes',
    })).toBe(true);
  });

  // rejects: gating a format that never hid anything. Trivia's answer is a
  //          letter — there is no authorship to withhold and no reveal to wait
  //          for, so a trivia podium must never depend on one.
  test('a format with no anonymity is never hidden', () => {
    expect(authorsHiddenNow({
      gameType: 'trivia', anonymousUntilReveal: true, authorsRevealed: false,
    })).toBe(false);
  });

  // rejects: the two drifting apart. The scores go wherever the names go is one
  //          rule asked from both directions, not two rules that resemble each
  //          other — and the call sites that hardcoded one of them are exactly
  //          how they came apart.
  test('standingsVisible is its exact negation, on every combination', () => {
    for (const gameType of ['call-and-answer', 'trivia', 'poll', 'wavelength']) {
      for (const anonymousUntilReveal of [true, false, undefined]) {
        for (const authorsRevealed of [true, false, undefined]) {
          const args = { gameType, anonymousUntilReveal, authorsRevealed };
          expect(standingsVisible(args)).toBe(!authorsHiddenNow(args));
        }
      }
    }
  });
});

import { ownAnswerIndex } from '../config/anonymity';

describe('a player finding their own answer in an anonymous ballot', () => {
  // A player sees their own answer attributed to themselves. Correct, and not
  // a leak (§5.6.7 item 6) — but the payload is redacted, so the only way to
  // find it is to match the text they submitted.
  const ballot = [{ answer: 'first' }, { answer: 'mine' }, { answer: 'third' }];

  test('matches on the submitted text', () => {
    expect(ownAnswerIndex(ballot, 'mine')).toBe(1);
  });

  test('returns -1 when the player has not answered', () => {
    expect(ownAnswerIndex(ballot, 'not submitted')).toBe(-1);
  });

  test('tolerates surrounding whitespace', () => {
    expect(ownAnswerIndex(ballot, '  mine  ')).toBe(1);
  });

  test('returns -1 for an empty submission rather than matching row 0', () => {
    expect(ownAnswerIndex(ballot, '')).toBe(-1);
    expect(ownAnswerIndex(ballot, null)).toBe(-1);
  });
});
