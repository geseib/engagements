import { NAMES_MODES, NAMES_DEFAULT, namesMode, namesPayloadFor } from '../config/surveyNames';

/*
 * Names: the one setting that decides what a survey records about people.
 * Owner, 2026-09-23: "anon, record just that they completed, attribute. name
 * concisely." docs/design/survey-redesign/IMPLEMENTATION-phase-2.md, Step 0.
 */
describe('the three Names values', () => {
  test('Anonymous, Who finished, Named — in that order, Anonymous the default', () => {
    expect(NAMES_MODES.map((m) => [m.id, m.label])).toEqual([
      ['anonymous', 'Anonymous'], ['finished', 'Who finished'], ['named', 'Named'],
    ]);
    expect(NAMES_DEFAULT).toBe('anonymous');
  });

  test('each says what the host gets, what the phone promises, what the wall says, and what it does', () => {
    for (const m of NAMES_MODES) {
      for (const k of ['hostLine', 'phoneLine', 'wallLine', 'does']) expect(m[k]).toMatch(/\S/);
    }
  });

  test('the phone lines are the mockups\' words (p-01, p-11, p-12)', () => {
    expect(namesMode('anonymous').phoneLead).toBe('Anonymous.');
    expect(namesMode('anonymous').phoneLine).toBe('Your host sees totals and the words you write — never who wrote them.');
    expect(namesMode('finished').phoneLine).toBe('Your host sees that you finished — not what you answered.');
    expect(namesMode('named').phoneLead).toBe('Named.');
    expect(namesMode('named').phoneLine).toBe('Your host sees your name with your answers. The room and any shared results never do.');
  });

  test('no line promises a name on the wall', () => {
    for (const m of NAMES_MODES) expect(`${m.wallLine} ${m.does}`).not.toMatch(/names? (appear|show) on the wall/i);
  });

  test('an unknown value reads as the default', () => {
    expect(namesMode('whatever').id).toBe('anonymous');
    expect(namesMode(undefined).id).toBe('anonymous');
  });
});

describe('namesPayloadFor — what the create call sends', () => {
  test('a survey sends its Names value', () => {
    expect(namesPayloadFor({ gameType: 'survey', names: 'named' })).toEqual({ names: 'named' });
    expect(namesPayloadFor({ gameType: 'survey' })).toEqual({ names: 'anonymous' });
  });
  test('every other type sends nothing', () => {
    expect(namesPayloadFor({ gameType: 'trivia', names: 'named' })).toEqual({});
    expect(namesPayloadFor({ gameType: 'call-and-answer' })).toEqual({});
  });
});
