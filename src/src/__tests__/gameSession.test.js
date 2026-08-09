import fs from 'fs';
import path from 'path';
import {
  initialGameSession, gameSessionKeys, resetGameSession,
} from '../config/gameSession';

const HOST_PAGE = path.join(__dirname, '..', 'GameHostPage.jsx');

/** A setter map that records what it was called with, one entry per key. */
function recordingSetters(keys = gameSessionKeys()) {
  const calls = {};
  const setters = {};
  for (const key of keys) {
    setters[key] = (value) => {
      calls[key] = calls[key] || [];
      calls[key].push(value);
    };
  }
  return { setters, calls };
}

describe('initialGameSession', () => {
  it('hands out fresh collection instances every call', () => {
    const a = initialGameSession();
    const b = initialGameSession();

    // Two resets in a row must not end up sharing a Set/array/object, or one
    // game's categories would bleed into the next.
    expect(a.activeCategoryIds).not.toBe(b.activeCategoryIds);
    expect(a.questions).not.toBe(b.questions);
    expect(a.answers).not.toBe(b.answers);
    expect(a.aiSummaries).not.toBe(b.aiSummaries);

    a.activeCategoryIds.add('Leadership');
    a.questions.push({ id: '001' });
    expect(b.activeCategoryIds.size).toBe(0);
    expect(b.questions).toHaveLength(0);
  });

  it('starts with no round in play', () => {
    const s = initialGameSession();
    expect(s.gameState).toBe('CREATED');
    expect(s.questions).toEqual([]);
    expect(s.currentQuestionId).toBe('');
    expect(s.currentQuestionIndex).toBe(-1);
    expect(s.lessonNumber).toBe(0);
  });

  it('empties the room and everything derived from it', () => {
    const s = initialGameSession();
    expect(s.players).toEqual([]);
    expect(s.answers).toEqual([]);
    expect(s.playersWhoAnswered).toEqual([]);
    expect(s.votes).toEqual([]);
    expect(s.playersWhoVoted).toEqual([]);
    expect(s.currentQuestionVotes).toEqual([]);
    expect(s.aiSummaries).toEqual({});
    expect(s.currentAIInsights).toBeNull();
    expect(s.reportData).toBeNull();
  });

  it('drops the previous set\'s instruction and round noun', () => {
    // The host resolves both from the question set. Carrying them into a new
    // game is how a trivia session inherits "Lesson" and an art set's prompt.
    const s = initialGameSession();
    expect(s.selectedSetId).toBe('');
    expect(s.customInstruction).toBeNull();
    expect(s.setRoundNoun).toBeNull();
    expect(s.categories).toEqual([]);
    expect(s.activeCategoryIds.size).toBe(0);
  });

  it('closes every overlay the previous game left open', () => {
    // rejects: the shipped list, which registered showExpandedQR but not the
    // rail's qrMode. Pin the QR, Quick Start a new game, and it stayed
    // full-screen over the new lobby -- still suppressing SPACE, still
    // rendering a join code for a session that no longer exists.
    const s = initialGameSession();
    expect(s.showExpandedQR).toBe(false);
    expect(s.qrMode).toBeNull();
    expect(s.lessonExpanded).toBe(false);
    expect(s.instructionsVisible).toBe(false);
    expect(s.showQuestionBrowser).toBe(false);
  });

  it('clears questions and currentQuestionId together', () => {
    // Guards the 6cba1525 class of bug: the instruction resolver looks the live
    // question up by id, so one of these moving without the other makes an art
    // round show the generic call-and-answer prompt.
    const s = initialGameSession();
    const bothEmpty = s.questions.length === 0 && s.currentQuestionId === '';
    expect(bothEmpty).toBe(true);
  });
});

describe('resetGameSession', () => {
  it('puts every key back through its setter exactly once', () => {
    const { setters, calls } = recordingSetters();
    const applied = resetGameSession(setters);
    const initial = initialGameSession();

    for (const key of gameSessionKeys()) {
      expect(calls[key]).toHaveLength(1);
      expect(calls[key][0]).toEqual(initial[key]);
      expect(applied[key]).toEqual(initial[key]);
    }
  });

  it('applies overrides instead of the initial value', () => {
    const { setters, calls } = recordingSetters();

    const applied = resetGameSession(setters, {
      eventTitle: 'Quick Trivia: Space',
      currentGameType: 'trivia',
      selectedSetId: 'space',
    });

    expect(calls.eventTitle[0]).toBe('Quick Trivia: Space');
    expect(calls.currentGameType[0]).toBe('trivia');
    expect(calls.selectedSetId[0]).toBe('space');
    expect(applied.eventTitle).toBe('Quick Trivia: Space');
    // Everything not overridden still resets.
    expect(calls.questions[0]).toEqual([]);
    expect(calls.gameState[0]).toBe('CREATED');
  });

  it('never mutates a shared template between calls', () => {
    const first = resetGameSession(recordingSetters().setters);
    first.activeCategoryIds.add('Ops');
    first.questions.push({ id: 'x' });

    const second = resetGameSession(recordingSetters().setters);
    expect(second.activeCategoryIds.size).toBe(0);
    expect(second.questions).toEqual([]);
  });

  it('reports a missing setter loudly but still resets the rest', () => {
    const keys = gameSessionKeys().filter((k) => k !== 'questions');
    const { setters, calls } = recordingSetters(keys);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    resetGameSession(setters);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('questions'));
    expect(calls.gameState[0]).toBe('CREATED'); // the rest still happened
    spy.mockRestore();
  });
});

describe('GameHostPage wiring', () => {
  const source = fs.readFileSync(HOST_PAGE, 'utf8');

  // The host builds one `gameSessionSetters` map. If someone adds per-game
  // state to gameSession.js and forgets the setter (or vice versa), this fails
  // — which is the whole point of having the list in one place.
  const mapBody = source.match(/const gameSessionSetters = \{([\s\S]*?)\n {2}\};/);

  it('declares a gameSessionSetters map', () => {
    expect(mapBody).not.toBeNull();
  });

  it('supplies a setter for every per-game key, and no extras', () => {
    const mappedKeys = [...mapBody[1].matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
    expect(mappedKeys.slice().sort()).toEqual(gameSessionKeys().slice().sort());
  });

  it('routes every game entry point through the central reset', () => {
    // Each of these used to set gameId (or a handful of setters) directly,
    // which is how a switch could leave the previous game on screen.
    for (const fn of ['handleSwitchGame', 'handleContinueGame', 'selectGameFromHistory',
      'startGameFromHistory', 'handleStartNewGame']) {
      expect(source).toContain(fn);
    }
    // Quickstart, continue-by-id, history select, history start.
    expect((source.match(/switchToGame\(/g) || []).length).toBeGreaterThanOrEqual(5);
    // switchToGame is the only place outside it that assigns a new game id.
    const setGameIdCalls = (source.match(/setGameId\(/g) || []).length;
    expect(setGameIdCalls).toBeLessThanOrEqual(3);
  });

  it('keeps the dead handleNewGame reset handler out of the file', () => {
    expect(source).not.toMatch(/const handleNewGame\s*=/);
  });
});
