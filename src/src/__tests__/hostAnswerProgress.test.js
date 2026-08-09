/**
 * What the host page DECIDES when the wire goes quiet about who answered.
 *
 * Nothing tested the host's own decisions before this file, and that is how the
 * branch shipped a host who could not start voting on an anonymous round: the
 * `playerAnswered` handler gated everything — including the answers refetch
 * that enables the ASK primary — on a `playerName` that message.js deliberately
 * strips while a round is hidden.
 *
 * These are pure-logic tests on purpose. GameHostPage cannot be mounted in
 * jsdom (it dies on the auth provider), so the decisions live in
 * config/anonymity.js and are asserted here directly.
 */
import {
  playerAnsweredActions,
  answeredNamesFrom,
  stageLabelFor,
  displayLabelFor,
} from '../config/anonymity';

describe('playerAnsweredActions — the redacted frame must still enable voting', () => {
  test('CRITICAL 1: a hidden round refetches answers even though no name arrived', () => {
    // This is the exact frame message.js emits while a round is hidden:
    // playerName stripped, questionNumber kept.
    const actions = playerAnsweredActions({ questionNumber: '001', gameId: '1234' });

    expect(actions.refetchQuestion).toBe('001');
    expect(actions.markAnswered).toBeNull();
  });

  test('an attributed frame both marks the player and refetches', () => {
    const actions = playerAnsweredActions({ playerName: 'Ada', questionNumber: 3 });

    expect(actions.markAnswered).toBe('Ada');
    expect(actions.refetchQuestion).toBe(3);
  });

  test('a frame with no question number asks for no refetch, rather than for question "undefined"', () => {
    expect(playerAnsweredActions({ playerName: 'Ada' }).refetchQuestion).toBeNull();
  });

  test('an empty name is treated as no name, not as a player called ""', () => {
    expect(playerAnsweredActions({ playerName: '', questionNumber: '002' }).markAnswered).toBeNull();
  });

  test('a missing frame does not throw — a malformed socket message must not kill the handler', () => {
    expect(playerAnsweredActions(undefined)).toEqual({ markAnswered: null, refetchQuestion: null });
  });
});

describe('answeredNamesFrom — the roster ticks must survive a redacted payload', () => {
  test('IMPORTANT 2: a fully redacted round yields no names, so the caller writes nothing', () => {
    const rows = [{ answer: 'a' }, { answer: 'b' }];

    // Not [undefined, undefined] — that list ticks nobody AND clobbers the
    // correct answererIds the server already handed the host.
    expect(answeredNamesFrom(rows)).toEqual([]);
  });

  test('an attributed round yields every name, in ballot order', () => {
    const rows = [
      { playerName: 'Ada', answer: 'a' },
      { playerName: 'Grace', answer: 'b' },
    ];
    expect(answeredNamesFrom(rows)).toEqual(['Ada', 'Grace']);
  });

  test('a partially attributed payload keeps the names it has', () => {
    expect(answeredNamesFrom([{ playerName: 'Ada' }, {}, { playerName: 'Grace' }]))
      .toEqual(['Ada', 'Grace']);
  });

  test('nothing at all is an empty list, not a throw', () => {
    expect(answeredNamesFrom(null)).toEqual([]);
    expect(answeredNamesFrom(undefined)).toEqual([]);
  });
});

describe('stageLabelFor — the stage toggle must actually hide the names', () => {
  const row = { playerName: 'Ada', answer: 'loves the ocean' };

  test('IMPORTANT 5: a row that carries its author is still hidden when the stage says hidden', () => {
    // The RESULTS payload always carries names (voting closed), so a toggle
    // that only flips a flag and leaves displayLabelFor reading the row hides
    // nothing at all — which is what "‹ Hide again" used to do.
    expect(displayLabelFor(row, 1)).toBe('Ada');
    expect(stageLabelFor(row, 1, { authorsHidden: true })).toBe('Response 2');
  });

  test('showing again returns the author, not a placeholder', () => {
    expect(stageLabelFor(row, 1, { authorsHidden: false })).toBe('Ada');
  });

  test('with no opinion from the stage it defers to the row, exactly like displayLabelFor', () => {
    expect(stageLabelFor(row, 0)).toBe('Ada');
    expect(stageLabelFor({ answer: 'x' }, 0)).toBe('Response 1');
  });

  test('a redacted row stays redacted even when the stage is showing authors', () => {
    expect(stageLabelFor({ answer: 'x' }, 2, { authorsHidden: false })).toBe('Response 3');
  });
});
