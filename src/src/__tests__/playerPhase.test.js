/**
 * THE PHONE'S MONOTONIC PHASE GUARD, WITH A SURVEY'S STATES IN IT.
 *
 * `stateRank` is what stops a slow `GET /state` from clobbering a newer phase a
 * websocket frame already delivered. It ranked every state it did not know as
 * -1 — deliberately, so `CREATED`/`STARTED` can never overwrite a live round.
 * A survey's states (`SURVEY#OPEN`, `SURVEY#CLOSED`) have no digits after `#`,
 * so they fell into that -1 too, and -1 is not below -1: a stale `STARTED`
 * arriving after `SURVEY#OPEN` would have been accepted and put an answering
 * phone back on the lobby. IMPLEMENTATION-phase-2.md §2: OPEN 1, CLOSED 2,
 * ENDED max.
 */
import { stateRank, SURVEY_OPEN, SURVEY_CLOSED, isSurveyState } from '../utils/playerPhase';

/** The guard as PlayerPage applies it: accept `next` unless it ranks below what is held. */
function guard(sequence) {
  let held = -1;
  let shown = null;
  for (const next of sequence) {
    const r = stateRank(next);
    if (r < held) continue;
    held = r;
    shown = next;
  }
  return shown;
}

describe('the survey states rank', () => {
  test('the contract spellings', () => {
    expect(SURVEY_OPEN).toBe('SURVEY#OPEN');
    expect(SURVEY_CLOSED).toBe('SURVEY#CLOSED');
  });

  test('OPEN 1, CLOSED 2, ENDED above everything', () => {
    expect(stateRank('SURVEY#OPEN')).toBe(1);
    expect(stateRank('SURVEY#CLOSED')).toBe(2);
    expect(stateRank('ENDED')).toBe(Number.MAX_SAFE_INTEGER);
    expect(stateRank('ENDED')).toBeGreaterThan(stateRank('SURVEY#CLOSED'));
  });

  // rejects: the shipped guard, where a survey state and STARTED both ranked -1
  test('a stale STARTED can never overwrite SURVEY#OPEN', () => {
    expect(stateRank('STARTED')).toBeLessThan(stateRank('SURVEY#OPEN'));
    expect(guard(['SURVEY#OPEN', 'STARTED'])).toBe('SURVEY#OPEN');
    expect(guard(['SURVEY#OPEN', 'CREATED'])).toBe('SURVEY#OPEN');
  });

  test('a stale OPEN cannot reopen a closed survey, nor a closed one an ended session', () => {
    expect(guard(['SURVEY#CLOSED', 'SURVEY#OPEN'])).toBe('SURVEY#CLOSED');
    expect(guard(['ENDED', 'SURVEY#CLOSED', 'SURVEY#OPEN'])).toBe('ENDED');
  });

  test('the forward path is accepted step by step', () => {
    expect(guard(['CREATED', 'SURVEY#OPEN'])).toBe('SURVEY#OPEN');
    expect(guard(['SURVEY#OPEN', 'SURVEY#CLOSED'])).toBe('SURVEY#CLOSED');
    expect(guard(['SURVEY#OPEN', 'SURVEY#CLOSED', 'ENDED'])).toBe('ENDED');
  });
});

describe('the round ranks did not move', () => {
  test('ASK < VOTE < RESULTS within a round, and a later round beats an earlier one', () => {
    expect(stateRank('ASK#001')).toBe(10);
    expect(stateRank('VOTE#001')).toBe(11);
    expect(stateRank('RESULTS#001')).toBe(12);
    expect(stateRank('RESULT#001')).toBe(12);   // the websocket spelling
    expect(stateRank('ASK#002')).toBeGreaterThan(stateRank('RESULTS#001'));
  });

  test('CREATED, STARTED, END and nothing', () => {
    expect(stateRank('CREATED')).toBe(-1);
    expect(stateRank('STARTED')).toBe(-1);
    expect(stateRank('END')).toBe(Number.MAX_SAFE_INTEGER);
    expect(stateRank('')).toBe(-1);
    expect(stateRank(null)).toBe(-1);
    expect(stateRank(undefined)).toBe(-1);
  });
});

test('isSurveyState names the two survey states and nothing else', () => {
  expect(isSurveyState('SURVEY#OPEN')).toBe(true);
  expect(isSurveyState('SURVEY#CLOSED')).toBe(true);
  expect(isSurveyState('ENDED')).toBe(false);
  expect(isSurveyState('ASK#001')).toBe(false);
  expect(isSurveyState(undefined)).toBe(false);
});

test('PlayerPage reads the rank from here rather than keeping its own copy', () => {
  const fs = require('fs');
  const path = require('path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'PlayerPage.jsx'), 'utf8');
  expect(page).toMatch(/from '\.\/utils\/playerPhase'/);
  expect(page).not.toMatch(/const stateRank = \(/);
});
