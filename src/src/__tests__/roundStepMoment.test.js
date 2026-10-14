/**
 * R2: the moments are a closed set, read from server facts. An input this
 * build cannot read is UNKNOWN ("Waiting for the session"), never the lobby.
 */
import { momentOf, MOMENTS } from '../config/roundStep';

const STATES = {
  CREATED: 'LOBBY',
  STARTED: 'LOBBY',
  'ASK#003': 'ANSWERING',
  'VOTE#003': 'VOTING',
  ENDED: 'ENDED',
  'SURVEY#OPEN': 'OTHER',
  'SURVEY#CLOSED': 'OTHER',
};

describe('momentOf', () => {
  test.each(Object.entries(STATES))('%s -> %s', (state, moment) => {
    expect(momentOf({ state })).toBe(moment);
  });

  test.each([
    ['results', { focus: 'none', index: null }, 'RESULTS'],
    ['results', { focus: 'question', index: null }, 'RESULTS'],
    ['results', { focus: 'answer', index: 0 }, 'RESPONSES'],
    ['results', { focus: 'answer', index: 4, phase: 'RESULTS' }, 'RESPONSES'],
    ['field-notes', { focus: 'none' }, 'READ'],
    ['field-notes', { focus: 'answer', index: 1 }, 'READ'],
    ['feedback', { focus: 'none' }, 'FEEDBACK'],
    ['hologram', { focus: 'none' }, 'RESULTS'],
    [undefined, { focus: 'answer', index: 2 }, 'RESPONSES'],
  ])('RESULTS#003 on beat %s with focus %j -> %s', (stageBeat, focus, moment) => {
    expect(momentOf({ state: 'RESULTS#003', stageBeat, focus })).toBe(moment);
  });

  test('a VOTE-stamped focus does not make RESULTS a responses moment', () => {
    // The server already drops it (D5); the client must not resurrect it.
    expect(momentOf({ state: 'RESULTS#003', stageBeat: 'results', focus: { focus: 'answer', index: 2, phase: 'VOTE' } }))
      .toBe('RESULTS');
  });

  test('a beat left over from RESULTS never changes ASK or VOTE', () => {
    expect(momentOf({ state: 'ASK#004', stageBeat: 'field-notes' })).toBe('ANSWERING');
    expect(momentOf({ state: 'VOTE#004', stageBeat: 'feedback', focus: { focus: 'answer', index: 0 } })).toBe('VOTING');
  });

  test('the message spelling RESULT#003 reads as RESULTS', () => {
    expect(momentOf({ state: 'RESULT#003' })).toBe('RESULTS');
  });

  test.each([
    [null], [undefined], [{}], [{ state: '' }], [{ state: 'garbage' }], [{ state: 42 }], ['ASK#003'],
    [{ state: 'ASK#' }], [{ state: 'RESULTS#abc' }],
  ])('unreadable input %j is UNKNOWN, never LOBBY', (input) => {
    expect(momentOf(input)).toBe('UNKNOWN');
  });

  test('every answer is in the closed set', () => {
    for (const m of Object.values(STATES)) expect(MOMENTS).toContain(m);
    for (const m of ['RESULTS', 'RESPONSES', 'READ', 'FEEDBACK', 'UNKNOWN']) expect(MOMENTS).toContain(m);
  });
});
