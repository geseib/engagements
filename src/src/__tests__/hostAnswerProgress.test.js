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
  answeredCountFrom,
  answererIdsFrom,
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

describe('answeredCountFrom — the meter must move on an anonymous round', () => {
  test('CRITICAL: redacted rows still count, so "Answered 3 / 8" is reachable with no names', () => {
    // The live path on a hidden round: `playerAnswered` carries no name, so
    // playersWhoAnswered cannot grow, but the unconditional refetch fills
    // `answers` with one redacted row per responder. Counting only names left
    // the host's one progress number frozen between resyncs — it moved on a tab
    // focus or a socket reconnect, which is what "it goes up eventually" was.
    const rows = [{ answer: 'a' }, { answer: 'b' }, { answer: 'c' }];
    expect(answeredCountFrom([], rows)).toBe(3);
  });

  test('an attributed round is unchanged — the two sources agree', () => {
    expect(answeredCountFrom(['Ada', 'Grace'], [
      { playerName: 'Ada' }, { playerName: 'Grace' },
    ])).toBe(2);
  });

  test('the server participation list wins when the rows have not been fetched yet', () => {
    // restoreGameState sets playersWhoAnswered from answerProgress.answererIds
    // before any /answers call returns. Taking the rows alone would flash 0.
    expect(answeredCountFrom(['Ada', 'Grace', 'Hedy'], [])).toBe(3);
  });

  test('nobody has answered is zero, not NaN', () => {
    expect(answeredCountFrom([], [])).toBe(0);
    expect(answeredCountFrom(null, undefined)).toBe(0);
  });
});

/**
 * The names' OTHER source. `answeredNamesFrom` reads the /answers rows, which
 * carry nothing on a hidden round; this reads /state's participation list,
 * which is the only thing that can move the names there. The fixtures below are
 * the shapes get-game-state.js:398 actually emits — it assembles
 * `answerProgress` only under `?includeHostData=true` and only while the round
 * is in ASK#, so "no answerProgress" is a real and frequent payload rather than
 * a defensive hypothetical.
 */
describe('answererIdsFrom — the participation list a redacted frame cannot carry', () => {
  test('CRITICAL: a payload with no answerProgress says NOTHING, and must not blank the list', () => {
    // The round moved to VOTE while the refresh was in flight, or the caller
    // forgot includeHostData. Reading either as "nobody has answered" wipes the
    // names the server already supplied — the same clobber answeredNamesFrom's
    // doc-block warns about, arriving from the other direction.
    //
    // rejects: `return stateData?.answerProgress?.answererIds || []`, which is
    // the one-liner this function exists instead of.
    expect(answererIdsFrom({ state: 'VOTE#001' })).toBeNull();
    expect(answererIdsFrom({ answerProgress: { answersReceived: 3 } })).toBeNull();
    expect(answererIdsFrom({})).toBeNull();
    expect(answererIdsFrom(null)).toBeNull();
    expect(answererIdsFrom(undefined)).toBeNull();
  });

  test('an empty list IS an answer, and a different one', () => {
    // rejects: collapsing [] onto null. The server saying "nobody yet" is a
    // fact worth applying — it is how a round that was reset stops showing the
    // previous round's answerers.
    expect(answererIdsFrom({ answerProgress: { answererIds: [] } })).toEqual([]);
  });

  test('it returns the names, deduplicated and blank-free', () => {
    // rejects: passing the array through untouched. A duplicate inflates
    // answeredCountFrom (which takes a LENGTH) past the number of people who
    // actually answered, and a blank inflates waitingRoster's freshness check
    // — which would unblock a stale list, printing a name on the wall for
    // somebody who has already answered.
    expect(answererIdsFrom({
      answerProgress: { answererIds: ['Ada', 'Grace', 'Ada', '', null, 'Hedy'] },
    })).toEqual(['Ada', 'Grace', 'Hedy']);
  });

  test('the real shape, whole', () => {
    // Copied from get-game-state.js:398 rather than imagined — the landmine in
    // RESUME.md is eighteen green tests against a fixture nothing emits.
    expect(answererIdsFrom({
      state: 'ASK#001',
      answerProgress: { answersReceived: 2, totalPlayers: 8, answererIds: ['Ada', 'Grace'] },
    })).toEqual(['Ada', 'Grace']);
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
