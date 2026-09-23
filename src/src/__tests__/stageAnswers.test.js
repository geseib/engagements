/**
 * The stage draws a round-phase's responses only once they are that round-
 * phase's. The owner, 2026-09-23: "it would be better to leave that space
 * blank until the data has loaded." See config/stageAnswers.js.
 *
 * The second half of this file reads GameHostPage.jsx as text, because that
 * file cannot be mounted in jsdom (its own header says so): it pins that the
 * page consults these rules where the flashes were, and that the two
 * create-flow flashes stay fixed.
 */
const fs = require('fs');
const path = require('path');
const {
  stageAnswersKey, stageAnswersReady, askFetchStillCurrent,
} = require('../config/stageAnswers');

describe('the key a response list is loaded for', () => {
  test('pads the round, whatever shape the state arrived in', () => {
    expect(stageAnswersKey('VOTE#3')).toBe('VOTE#003');
    expect(stageAnswersKey('VOTE#003')).toBe('VOTE#003');
    expect(stageAnswersKey('RESULTS#12')).toBe('RESULTS#012');
    expect(stageAnswersKey('ASK#001')).toBe('ASK#001');
  });
  test('anything that is not a round-phase has no key', () => {
    for (const s of ['CREATED', 'STARTED', 'ENDED', 'voting', '', null, undefined, 'VOTE#']) {
      expect(stageAnswersKey(s)).toBeNull();
    }
  });
});

describe('when the stage may draw responses', () => {
  // rejects: VOTE drawing ASK's leftover rows — the one-card flash.
  test('VOTE waits for VOTE’s own rows', () => {
    expect(stageAnswersReady('VOTE#003', null)).toBe(false);
    expect(stageAnswersReady('VOTE#003', 'ASK#003')).toBe(false);
    expect(stageAnswersReady('VOTE#003', 'VOTE#002')).toBe(false);
    expect(stageAnswersReady('VOTE#003', 'VOTE#003')).toBe(true);
  });
  // rejects: "No responses came in for this one" printed while they load.
  test('RESULTS waits for RESULTS’ own rows', () => {
    expect(stageAnswersReady('RESULTS#003', 'VOTE#003')).toBe(false);
    expect(stageAnswersReady('RESULTS#3', 'RESULTS#003')).toBe(true);
  });
  // rejects: gating ASK — responses arriving one at a time IS the ASK beat.
  test('ASK and the lobby never wait', () => {
    expect(stageAnswersReady('ASK#003', null)).toBe(true);
    expect(stageAnswersReady('STARTED', null)).toBe(true);
    expect(stageAnswersReady('CREATED', 'VOTE#001')).toBe(true);
  });
});

describe('when an ASK refetch may land', () => {
  test('only while the stage is still asking that round', () => {
    expect(askFetchStillCurrent('ASK#003', 3)).toBe(true);
    expect(askFetchStillCurrent('ASK#003', '003')).toBe(true);
    // rejects: a late refetch overwriting the rows VOTE or RESULTS is showing.
    expect(askFetchStillCurrent('VOTE#003', 3)).toBe(false);
    expect(askFetchStillCurrent('RESULTS#003', 3)).toBe(false);
    // rejects: the previous round's rows landing in the next round's ASK.
    expect(askFetchStillCurrent('ASK#004', 3)).toBe(false);
  });
});

describe('GameHostPage consults the rules where the flashes were', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  const body = (name) => {
    const start = src.indexOf(`const ${name} = async`);
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf('\n  const ', start + 10);
    return src.slice(start, next === -1 ? undefined : next);
  };

  // rejects: the 'voting' placeholder state. It is no round-phase, so the
  // stage fell back to the LOBBY — QR and all — while start-vote was in flight.
  test('opening the vote sets no placeholder state', () => {
    expect(src).not.toMatch(/setGameState\(\s*'voting'\s*\)/);
  });

  test('the VOTE and RESULTS stages draw responses only when ready', () => {
    const calls = src.match(/stageAnswersReady\(gameState, answersFor\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(src).toMatch(/const stageResponsesReady = stageAnswersReady\(gameState, answersFor\)/);
    expect((src.match(/stageResponsesReady/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  test('the ASK refetch checks it is still current before it lands', () => {
    expect(body('fetchAnswersForQuestion')).toMatch(/askFetchStillCurrent\(gameStateRef\.current/);
  });

  /*
    THE CREATE FLOW'S TWO FLASHES. React renders at every await, and each of
    these handlers used to hide the screen the host was looking at BEFORE
    awaiting a fetch — so the empty host stage showed for the length of it.
  */
  // rejects: hiding the welcome screen before the question sets are fetched.
  test('Create engagement keeps the welcome screen up until the dialog can show', () => {
    const fn = body('handleWelcomeNewGame');
    expect(fn.indexOf('await fetchQuestionSets()')).toBeGreaterThan(-1);
    expect(fn.indexOf('setShowWelcomeScreen(false)')).toBeGreaterThan(fn.indexOf('await fetchQuestionSets()'));
  });
  // rejects: closing the dialog before the session list is fetched.
  test('a created session keeps the dialog up until the session list can show', () => {
    const fn = body('handleStartNewGame');
    const closes = [...fn.matchAll(/setShowNewGameDialog\(false\)/g)].map((m) => m.index);
    expect(closes.length).toBeGreaterThan(0);
    const lastAwait = Math.max(fn.lastIndexOf('await fetchGamesList()'), fn.lastIndexOf('await openNewSurvey('));
    for (const at of closes) expect(at).toBeGreaterThan(lastAwait);
  });
});
