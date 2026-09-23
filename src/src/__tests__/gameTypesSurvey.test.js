import {
  isPlayableGameType, notPlayableReason, UNPLAYABLE_GAME_TYPES, NOT_PLAYABLE_LABEL,
  PICKER_GAME_TYPES, GAME_TYPES, hasVotePhase,
} from '../config/gameTypes';

/*
 * Surveys phase 2: a session can PLAY a survey now — the host opens it, phones
 * answer at their own pace, the host closes it. So the one id that sat in
 * UNPLAYABLE_GAME_TYPES comes out, the create dialog's pill appears, and the
 * console's "Not playable" chip stops being drawn on survey sets.
 * docs/design/survey-redesign/IMPLEMENTATION-phase-2.md, Track D.
 */
describe('survey is playable', () => {
  test('no type is held back from the create dialog any more', () => {
    expect(UNPLAYABLE_GAME_TYPES).toEqual([]);
    expect(isPlayableGameType('survey')).toBe(true);
    expect(PICKER_GAME_TYPES.map((t) => t.id)).toContain('survey');
  });

  test('a playable type has no reason to print, survey included', () => {
    expect(notPlayableReason('survey')).toBe('');
    expect(notPlayableReason('trivia')).toBe('');
    // The chip's words survive for the day another type needs them.
    expect(NOT_PLAYABLE_LABEL).toBe('Not playable');
  });

  test('a survey runs COLLECTING then CLOSED — no rounds, no vote', () => {
    // rejects: the phase-1 table's ASK → VOTE → RESULTS, which described what
    // the code did to a survey by accident (it fell through to start-vote).
    expect(GAME_TYPES.survey.phases).toEqual(['COLLECTING', 'CLOSED']);
    expect(hasVotePhase('survey')).toBe(false);
  });
});
