/**
 * R1 + R3: one decision function. Every (round type x moment) has exactly one
 * primary, at most one secondary, and every label comes from roundWords.
 */
import { roundStep, MOMENTS, MORE_IDS } from '../config/roundStep';
import RW from '../config/roundWords';

const TYPES = ['call-and-answer', 'trivia', 'poll', 'wavelength'];
const ROUND_MOMENTS = ['LOBBY', 'ANSWERING', 'VOTING', 'VOTE_RESPONSES', 'RESULTS', 'RESPONSES', 'READ', 'FEEDBACK', 'ENDED', 'UNKNOWN', 'OTHER'];

/** Every string roundWords can produce for the arguments roundStep uses. */
function knownLabels(noun) {
  const fixed = Object.values(RW).filter((v) => typeof v === 'string');
  const made = [RW.startFirst(noun), RW.nextRound(noun), RW.skipRound(noun)];
  for (let i = 1; i <= 12; i += 1) for (let n = 1; n <= 12; n += 1) made.push(RW.showResponse(i, n));
  return new Set([...fixed, ...made]);
}

const CTX = {
  roundNoun: 'Round',
  playerCount: 5,
  answerCount: 5,
  hasQuestionSet: true,
  progress: { received: 5, total: 5, allIn: true },
  notes: { page: 0, pages: 1, ready: true },
  focus: { focus: 'answer', index: 0, part: 0, parts: 1 },
};

describe('roundStep: shape', () => {
  test('the closed set covers every moment the test walks', () => {
    for (const m of ROUND_MOMENTS) expect(MOMENTS).toContain(m);
  });

  for (const gameType of TYPES) {
    for (const moment of ROUND_MOMENTS) {
      test(`${gameType} x ${moment}: one primary, at most one secondary, words from roundWords`, () => {
        const step = roundStep(moment, { ...CTX, gameType });
        const labels = knownLabels('Round');
        expect(step.primary).toBeTruthy();
        expect(typeof step.primary.id).toBe('string');
        expect(labels.has(step.primary.label)).toBe(true);
        expect(Array.isArray(step.secondary)).toBe(false);
        if (step.secondary) expect(labels.has(step.secondary.label)).toBe(true);
        expect(typeof step.status.text).toBe('string');
        expect(typeof step.next).toBe('string');
        expect(step.next.length).toBeGreaterThan(0);
        expect(step.more).toEqual(MORE_IDS);
      });
    }
  }
});

describe('roundStep: the rules', () => {
  test('LOBBY starts round 1 with the set noun; back to menu is the secondary', () => {
    const s = roundStep('LOBBY', { ...CTX, gameType: 'trivia', roundNoun: 'Lesson' });
    expect(s.primary).toMatchObject({ id: 'start', label: 'Start lesson 1', disabled: false });
    expect(s.secondary).toMatchObject({ id: 'leave', label: 'Back to menu' });
  });

  test('LOBBY with nobody in the room or no set is disabled with a reason', () => {
    expect(roundStep('LOBBY', { ...CTX, playerCount: 0 }).primary).toMatchObject({ disabled: true, hint: RW.someoneMustJoin });
    expect(roundStep('LOBBY', { ...CTX, hasQuestionSet: false }).primary).toMatchObject({ disabled: true, hint: RW.chooseSetFirst });
  });

  test('ANSWERING on a voting type opens the vote; on a no-vote type it shows results', () => {
    expect(roundStep('ANSWERING', { ...CTX, gameType: 'call-and-answer' }).primary)
      .toMatchObject({ id: 'open-vote', label: 'Start voting' });
    for (const t of ['trivia', 'poll', 'wavelength']) {
      expect(roundStep('ANSWERING', { ...CTX, gameType: t }).primary)
        .toMatchObject({ id: 'reveal-from-ask', label: 'Show results' });
    }
  });

  test('ANSWERING not all in: the primary carries an arm with the count', () => {
    const s = roundStep('ANSWERING', { ...CTX, gameType: 'call-and-answer', progress: { received: 1, total: 5, allIn: false } });
    expect(s.primary.arm).toEqual({ text: '4 still answering. Press again to start voting.' });
    const t = roundStep('ANSWERING', { ...CTX, gameType: 'trivia', progress: { received: 3, total: 5, allIn: false } });
    expect(t.primary.arm).toEqual({ text: '2 still answering. Press again to show results.' });
  });

  test('ANSWERING all in: no arm', () => {
    expect(roundStep('ANSWERING', { ...CTX, gameType: 'call-and-answer' }).primary.arm).toBeUndefined();
  });

  test('ANSWERING with no answers is disabled', () => {
    const s = roundStep('ANSWERING', { ...CTX, answerCount: 0, progress: { received: 0, total: 5, allIn: false } });
    expect(s.primary).toMatchObject({ disabled: true, hint: RW.nobodyAnswered });
  });

  test('VOTING not all in arms; the secondary shows the responses (owner, 2026-10-13), Skip when there are none', () => {
    const s = roundStep('VOTING', { ...CTX, gameType: 'call-and-answer', progress: { received: 4, total: 5, allIn: false } });
    expect(s.primary).toMatchObject({ id: 'reveal', label: 'Show results', arm: { text: '1 still voting. Press again to show results.' } });
    // Response 1 is already on the wall; the secondary steps to response 2.
    expect(s.secondary).toMatchObject({ id: 'next-response', label: 'Next response', index: 1, part: 0 });
    expect(roundStep('VOTING', { ...CTX, answerCount: 0 }).secondary).toMatchObject({ id: 'skip', label: 'Skip this round' });
    expect(roundStep('ANSWERING', CTX).secondary).toMatchObject({ id: 'skip' });
  });

  test('RESULTS: What we heard, with Show response 1 of N when there are answers', () => {
    const s = roundStep('RESULTS', { ...CTX, answerCount: 9 });
    expect(s.primary).toMatchObject({ id: 'field-notes', label: 'What we heard' });
    expect(s.secondary).toMatchObject({ id: 'show-response', label: 'Show response 1 of 9', index: 0 });
    expect(roundStep('RESULTS', { ...CTX, answerCount: 0 }).secondary).toBeNull();
  });

  test('RESPONSES walks parts, then responses, then What we heard; Stop showing is the secondary', () => {
    const mid = roundStep('RESPONSES', { ...CTX, answerCount: 3, focus: { focus: 'answer', index: 0, part: 0, parts: 1 } });
    expect(mid.primary).toMatchObject({ id: 'next-response', label: 'Next response', index: 1 });
    expect(mid.secondary).toMatchObject({ id: 'stop-showing', label: 'Stop showing' });

    const part = roundStep('RESPONSES', { ...CTX, answerCount: 3, focus: { focus: 'answer', index: 1, part: 0, parts: 2 } });
    expect(part.primary).toMatchObject({ id: 'next-part', label: 'Next part', index: 1, part: 1, parts: 2 });

    const lastPart = roundStep('RESPONSES', { ...CTX, answerCount: 3, focus: { focus: 'answer', index: 2, part: 1, parts: 2 } });
    expect(lastPart.primary).toMatchObject({ id: 'field-notes', label: 'What we heard' });

    const last = roundStep('RESPONSES', { ...CTX, answerCount: 3, focus: { focus: 'answer', index: 2 } });
    expect(last.primary).toMatchObject({ id: 'field-notes', label: 'What we heard' });
    expect(last.status.text).toBe('Showing response 3 of 3');
  });

  test('READ not ready never skips by accident: Show the read, disabled, and Next round as the secondary', () => {
    const s = roundStep('READ', { ...CTX, notes: { page: 0, pages: 1, ready: false } });
    expect(s.primary).toMatchObject({ id: 'show-read', label: 'Show the read', disabled: true, hint: 'Workie is writing' });
    expect(s.secondary).toMatchObject({ id: 'next', label: 'Next round' });
  });

  test('READ with pages ahead: Next page, Next round as the plain secondary', () => {
    const s = roundStep('READ', { ...CTX, roundNoun: 'Lesson', notes: { page: 0, pages: 3, ready: true } });
    expect(s.primary).toMatchObject({ id: 'notes-page', label: 'Next page' });
    expect(s.secondary).toMatchObject({ id: 'next', label: 'Next lesson' });
    expect(s.status.text).toBe('Reading page 1 of 3');
  });

  test('READ on its last page: Next round, Request feedback', () => {
    const s = roundStep('READ', { ...CTX, notes: { page: 2, pages: 3, ready: true } });
    expect(s.primary).toMatchObject({ id: 'next', label: 'Next round' });
    expect(s.secondary).toMatchObject({ id: 'request-feedback', label: 'Request feedback' });
  });

  test('READ with readiness unknown behaves as ready (a surface that cannot tell must not grey the round)', () => {
    expect(roundStep('READ', { ...CTX, notes: { page: 0, pages: 1 } }).primary.id).toBe('next');
  });

  test('FEEDBACK: Next round, Back to what we heard', () => {
    const s = roundStep('FEEDBACK', CTX);
    expect(s.primary).toMatchObject({ id: 'next', label: 'Next round' });
    expect(s.secondary).toMatchObject({ id: 'close-feedback', label: 'Back to what we heard' });
  });

  test('ENDED: Open session report, Back to menu', () => {
    const s = roundStep('ENDED', CTX);
    expect(s.primary).toMatchObject({ id: 'report', label: 'Open session report', disabled: false });
    expect(s.secondary).toMatchObject({ id: 'leave', label: 'Back to menu' });
  });

  test('UNKNOWN waits, disabled, with the waiting status; never the lobby', () => {
    const s = roundStep('UNKNOWN', CTX);
    expect(s.primary).toMatchObject({ id: 'wait', disabled: true });
    expect(s.status.text).toBe('Waiting for the session');
    expect(s.secondary).toBeNull();
  });

  test('the goal line takes the RESULTS status with the notice tone', () => {
    const s = roundStep('RESULTS', { ...CTX, goalLine: 'That is your 5' });
    expect(s.status).toEqual({ text: 'That is your 5', tone: 'notice' });
  });

  test('counts are pending until everyone is in', () => {
    expect(roundStep('ANSWERING', { ...CTX, progress: { received: 2, total: 5, allIn: false } }).status)
      .toEqual({ text: '2 of 5 answered', tone: 'pending' });
    expect(roundStep('VOTING', { ...CTX, answerCount: 0 }).status).toEqual({ text: 'All 5 voted', tone: 'success' });
    expect(roundStep('VOTING', { ...CTX, answerCount: 3 }).status)
      .toEqual({ text: 'All 5 voted · Showing response 1 of 3', tone: 'success' });
  });

  test('every primary and secondary carries an intent for the host page', () => {
    for (const m of ROUND_MOMENTS) {
      const s = roundStep(m, { ...CTX, gameType: 'call-and-answer', answerCount: 3 });
      expect(typeof s.primary.intent).toBe('string');
      if (s.secondary) expect(typeof s.secondary.intent).toBe('string');
    }
  });
});
