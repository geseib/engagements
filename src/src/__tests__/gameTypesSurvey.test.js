import { isPlayableGameType, notPlayableReason, UNPLAYABLE_GAME_TYPES, NOT_PLAYABLE_LABEL } from '../config/gameTypes';

/*
 * Surveys phase 1: a survey set can be made, imported, generated and edited,
 * but no session plays one until phase 2. The "Not playable" chip stays — and
 * its reason must stop saying the importer refuses surveys, because it no
 * longer does. docs/design/survey-redesign/IMPLEMENTATION-phase-0-1.md.
 */
describe('survey is authorable but not yet playable', () => {
  test('survey is still the one unplayable type', () => {
    expect(UNPLAYABLE_GAME_TYPES).toEqual(['survey']);
    expect(isPlayableGameType('survey')).toBe(false);
    expect(NOT_PLAYABLE_LABEL).toBe('Not playable');
  });

  test('the reason says what is true now: it can be built, not yet run', () => {
    const reason = notPlayableReason('survey');
    expect(reason).toMatch(/can be (made|built|authored)/i);
    expect(reason).toMatch(/no session (can )?(run|play)s? (one|it|a survey) yet/i);
    expect(reason).not.toMatch(/importer rejects/i);
  });

  test('playable types have no reason', () => {
    expect(notPlayableReason('trivia')).toBe('');
  });
});
