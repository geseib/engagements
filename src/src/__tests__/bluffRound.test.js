/**
 * The bluff round's words and reads (config/bluffRound.js;
 * docs/design/bluff-round/README.md). The server decides; these say it.
 */
import {
  isBluffRound, bluffHolderCard, bluffStageLine, ballotSize, bluffIdentityQuery,
  bluffRevealLines, BLUFF_WORDS,
} from '../config/bluffRound';
import { createGameBody } from '../config/createGame';
import { buildEditPayload, editableSnapshot } from '../utils/questionSetEditing';

describe('the bluff round on screen', () => {
  test('only an active bluff counts, and only the holder gets a card', () => {
    expect(isBluffRound({ bluff: { active: true } })).toBe(true);
    expect(isBluffRound({ bluff: { active: false, skipped: 'too-few-players' } })).toBe(false);
    expect(isBluffRound({})).toBe(false);
    expect(bluffHolderCard({ bluff: { active: true } })).toBeNull();
    expect(bluffHolderCard({ bluff: { active: true, yours: { realAnswer: 'Sunflowers', prompt: 'p' } } }))
      .toEqual({ realAnswer: 'Sunflowers', prompt: 'p' });
  });

  test('the stage line says a bluff is in play, or why not, and never a name', () => {
    expect(bluffStageLine({ bluff: { active: true } })).toBe(BLUFF_WORDS.stageOn);
    expect(bluffStageLine({ bluff: { active: false, skipped: 'too-few-players' } })).toMatch(/3 players/);
    expect(bluffStageLine({ bluff: { active: false, skipped: 'no-real-answer' } })).toMatch(/no real answer/);
    expect(bluffStageLine({})).toBe('');
  });

  test('a bluff ballot asks for one pick, from answers that are not yours', () => {
    expect(ballotSize(5, false, 2)).toBe(3);
    expect(ballotSize(5, true, 2)).toBe(1);
    expect(ballotSize(1, true, 0)).toBe(0);
    expect(ballotSize(2, true, null)).toBe(1);
  });

  test('the holder is recognised by name AND client id, encoded', () => {
    expect(bluffIdentityQuery('Ana B', 'c/1')).toBe('&playerName=Ana%20B&clientId=c%2F1');
    expect(bluffIdentityQuery('Ana', null)).toBe('');
  });

  test('the reveal reads in plain words', () => {
    const lines = bluffRevealLines({
      realAnswer: 'The Starry Night', holderName: 'Ben', holderAnswered: true, realBallot: 2,
      topBluffers: [{ name: 'Ada', fooled: 3 }], spotters: [],
    });
    expect(lines.holder).toBe('Ben had it: response 2.');
    expect(lines.fooled).toBe('Fooled the most: Ada (3 votes).');
    expect(lines.spotted).toBe('Nobody spotted it.');
    expect(bluffRevealLines({ active: false })).toBeNull();
  });
});

describe('the bluff round as an option', () => {
  test('the create body sends the host\'s choice for Call & Answer only', () => {
    expect(createGameBody({ gameType: 'call-and-answer', bluffRound: false }).bluffRound).toBe(false);
    expect(createGameBody({ gameType: 'call-and-answer', bluffRound: true }).bluffRound).toBe(true);
    expect('bluffRound' in createGameBody({ gameType: 'call-and-answer' })).toBe(false);
    expect('bluffRound' in createGameBody({ gameType: 'trivia', bluffRound: true })).toBe(false);
  });

  test('the set editor sends the switch only when it changed', () => {
    const original = editableSnapshot({ name: 'Art', bluffRound: true });
    expect(original.bluffRound).toBe(true);
    expect('bluffRound' in buildEditPayload('Art', { ...original }, original)).toBe(false);
    expect(buildEditPayload('Art', { ...original, bluffRound: false }, original).bluffRound).toBe(false);
  });
});
