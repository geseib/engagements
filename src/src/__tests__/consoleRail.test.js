import { consoleRailFor, CONSOLE_SECTIONS, peopleSummary, consolePeopleFor } from '../config/consoleRail';
import CW from '../config/consoleWords';

describe('which rail section opens by itself (spec §3.3)', () => {
  test.each([
    ['LOBBY', 'queue'], ['ANSWERING', 'people'], ['VOTING', 'people'], ['VOTE_RESPONSES', 'people'],
    ['RESULTS', 'people'], ['RESPONSES', 'people'], ['READ', 'late'], ['FEEDBACK', 'late'],
    ['ROOM_QUESTION', 'people'], ['ROOM_RESULTS', 'queue'], ['ENDED', 'queue'],
  ])('%s opens %s', (moment, section) => {
    expect(consoleRailFor(moment)).toBe(section);
  });
  test('an unknown moment opens nothing', () => {
    expect(consoleRailFor('UNKNOWN')).toBeNull();
  });
  // Session tools went (experience plan 2a): the Session menu and the top bar's connection replace it.
  test('the three sections, in order', () => {
    expect(CONSOLE_SECTIONS).toEqual(['queue', 'people', 'late']);
  });
});

describe('the People header says who is here; the count is the pulse\'s (2c)', () => {
  test('"N here" in every phase', () => {
    expect(peopleSummary({ moment: 'ANSWERING', players: 4, answered: 3, voted: 0 })).toBe('4 here');
    expect(peopleSummary({ moment: 'VOTING', players: 4, answered: 4, voted: 2 })).toBe('4 here');
    expect(peopleSummary({ moment: 'READ', players: 4, answered: 4, voted: 4 })).toBe('4 here');
    expect(peopleSummary({ moment: 'LOBBY', players: 1, answered: 0, voted: 0 })).toBe('1 here');
  });
});

describe('words', () => {
  test('sentence case and the device phrase', () => {
    for (const [k, v] of Object.entries(CW)) {
      if (typeof v !== 'string') continue;
      // Fragments are joined mid-line, so only a capital after the first
      // character is wrong, unless it follows ". " or is the word Workie.
      const rest = v.slice(1).replace(/\. [A-Z]/g, '. x').replace(/Workie/g, 'workie');
      expect([k, /[A-Z]/.test(rest)]).toEqual([k, false]);
      expect([k, /!/.test(v)]).toEqual([k, false]);
      if (/phone/.test(v)) expect([k, v]).toEqual([k, expect.stringMatching(/phone, laptop or tablet/)]);
    }
  });
});

describe('consolePeopleFor: never "still writing" beside someone who has answered', () => {
  const players = [{ name: 'Ada' }, { name: 'Omar' }, { name: 'Lin' }, { name: 'Bo' }];
  const anon = { gameType: 'call-and-answer', anonymousUntilReveal: true, authorsRevealed: false };

  // console-rail README D7: the names stay, only the status blanks ("—"); an
  // empty People section mid-round read as "everyone left".
  // rejects: the rows vanishing on a hidden round (consoleRail.js:110 before 3 Nov).
  test('a hidden round: 3 answers counted, no names on hand -> every name, status unknown', () => {
    expect(consolePeopleFor({ moment: 'ANSWERING', players, answeredNames: [], answeredCount: 3, ...anon }).map((p) => p.state)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
  });
  test('names that lag the count -> every name, status unknown, never a wrong tick (2 named, 3 counted)', () => {
    expect(consolePeopleFor({ moment: 'ANSWERING', players, answeredNames: ['Ada', 'Omar'], answeredCount: 3, ...anon })).toEqual(
      players.map((p) => ({ name: p.name, state: 'unknown' })),
    );
  });
  test('names that cover the count -> ticks and still writing', () => {
    expect(consolePeopleFor({ moment: 'ANSWERING', players, answeredNames: ['Ada', 'Omar'], answeredCount: 2, ...anon })).toEqual([
      { name: 'Ada', state: 'answered' }, { name: 'Omar', state: 'answered' },
      { name: 'Lin', state: 'writing' }, { name: 'Bo', state: 'writing' },
    ]);
  });
  test('voting reads the voters the same way', () => {
    expect(consolePeopleFor({ moment: 'VOTING', players, votedNames: ['Lin'], votedCount: 1, ...anon }).map((p) => p.state))
      .toEqual(['not-yet', 'not-yet', 'voted', 'not-yet']);
    expect(consolePeopleFor({ moment: 'VOTE_RESPONSES', players, votedNames: [], votedCount: 2, ...anon }).map((p) => p.state)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
  });
  test('other moments: everyone is here', () => {
    expect(consolePeopleFor({ moment: 'READ', players }).map((p) => p.state)).toEqual(['here', 'here', 'here', 'here']);
  });
});
