/**
 * The bluff round's words and reads (config/bluffRound.js;
 * docs/design/bluff-round/README.md). The server decides; these say it.
 */
import {
  isBluffRound, bluffHolderCard, bluffStageLine, ballotSize, bluffIdentityQuery,
  bluffRevealLines, bluffRoundPoints, BLUFF_WORDS,
} from '../config/bluffRound';
import { presentModel } from '../present/presentModel';
import { advancedSummary } from '../config/setupDefaults';
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

/* ---- the room's window (src/present), QA 2026-11-07 ---------------------- */

const Q = { title: 'A Very Serious Desk', detail: '', category: 'Kitchen', bluff: { active: true, minPlayers: 3 } };
const snap = (over = {}) => ({
  gameId: '8928', gameType: 'call-and-answer', gameMetadata: { title: 'Bluff QA' },
  state: 'ASK#003', currentQuestion: 3, currentQuestionData: Q, stageBeat: 'results',
  stageFocus: { focus: 'none', index: null, part: 0, parts: 1, phase: null, rev: 0 },
  stageNotes: { page: 0, pages: null }, stageProfile: null, scoreboard: { open: false },
  authorsRevealed: true, roomCounts: { joined: 4, answered: 1, voted: 0 }, ...over,
});
const RESULTS = {
  voteTallies: {
    0: { playerName: 'Bruno', answerText: 'A desk that locks itself', totalScore: 6, firstPlace: 3, bluffRole: 'bluff' },
    1: { playerName: 'Cleo', answerText: 'It folds out into a bed', totalScore: 1, firstPlace: 1, bluffRole: 'real' },
    2: { playerName: 'Ada', answerText: 'A typewriter alarm', totalScore: 0, firstPlace: 0, bluffRole: 'bluff' },
  },
  bluff: {
    realAnswer: 'A desk that folds out into a full-size bed', holderName: 'Cleo', holderAnswered: true,
    holderAnswer: 'It folds out into a bed', realBallot: 2, topBluffers: [{ name: 'Bruno', fooled: 3 }],
    spotters: ['Dmitri'], points: { Bruno: 6, Cleo: 1, Dmitri: 1 },
  },
};

describe('the bluff round on the room\'s window', () => {
  test('answering and voting say a bluff is in play, never who', () => {
    const ask = presentModel(snap());
    expect(ask.bluffLine).toBe(BLUFF_WORDS.stageOn);
    const vote = presentModel(snap({ state: 'VOTE#003' }));
    expect(vote.bluffLine).toBe(BLUFF_WORDS.stageOn);
    expect(JSON.stringify([ask, vote])).not.toMatch(/Cleo|Bruno|holder/);
  });

  test('results: the real answer and its ballot number, no name, no points, bluff labels, no talk line', () => {
    const m = presentModel(snap({ state: 'RESULTS#003' }), { results: RESULTS });
    expect(m.bluffReveal).toEqual({ realAnswer: 'A desk that folds out into a full-size bed', realBallot: 2 });
    expect(m.hidden).toBe(true);
    m.rows.forEach((r) => { expect(r.named).toBe(false); expect(r.points).toBeNull(); expect(r.credit).toBeNull(); });
    expect(m.rows.find((r) => r.real).pickLabel).toBe(BLUFF_WORDS.realLabel);
    expect(m.rows[0].pickLabel).toBe(BLUFF_WORDS.fooledLabel);
    expect(m.talk).toBe('');
    expect(m.heading).toBe(BLUFF_WORDS.eyebrow);
    expect(JSON.stringify(m.rows)).not.toMatch(/Cleo|Bruno|Ada/);
  });

  test('a normal round keeps its names, points and talk line', () => {
    const plain = { voteTallies: { 0: { playerName: 'Bruno', answerText: 'x', totalScore: 3, firstPlace: 1 } } };
    const m = presentModel(snap({ state: 'RESULTS#003', currentQuestionData: { title: 'T' } }), { results: plain });
    expect(m.rows[0].named).toBe(true);
    expect(m.rows[0].pickLabel).toBeUndefined();
    expect(m.bluffReveal).toBeNull();
  });
});

describe('the phone\'s "This round" in a bluff round', () => {
  test('is the player\'s own points, spotting included; null outside a bluff round', () => {
    expect(bluffRoundPoints(RESULTS, 'Dmitri')).toBe(1);
    expect(bluffRoundPoints(RESULTS, 'Ada')).toBe(0);
    expect(bluffRoundPoints({ voteTallies: {} }, 'Ada')).toBeNull();
  });
});

describe('the Advanced line names the bluff round', () => {
  test('on as the set has it: named among the defaults; moved off the set: named as a change', () => {
    const on = advancedSummary({ gameType: 'call-and-answer', bluffRound: true, bluffDefault: true });
    expect(on.brief).toMatch(/bluff round on/);
    const off = advancedSummary({ gameType: 'call-and-answer', bluffRound: false, bluffDefault: true });
    expect(off.brief).toMatch(/Changed: .*bluff round off/);
    const none = advancedSummary({ gameType: 'call-and-answer' });
    expect(none.brief).not.toMatch(/bluff/);
  });
});
