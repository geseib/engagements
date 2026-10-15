import { consoleRailFor, CONSOLE_SECTIONS, peopleSummary } from '../config/consoleRail';
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
  test('the four sections, in order', () => {
    expect(CONSOLE_SECTIONS).toEqual(['queue', 'people', 'late', 'tools']);
  });
});

describe('the People header says the one count for the moment', () => {
  test('answering, voting, otherwise who is here', () => {
    expect(peopleSummary({ moment: 'ANSWERING', players: 4, answered: 3, voted: 0 })).toBe('3 of 4 answered');
    expect(peopleSummary({ moment: 'VOTING', players: 4, answered: 4, voted: 2 })).toBe('2 of 4 voted');
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
