/**
 * TRIVIA AND POLL ON THE ROOM'S WINDOW (experience plan 2g; PLAN §3.3 "The
 * room sees": Trivia "the options, nothing marked and no split, until Show the
 * answer"; Poll "the live board").
 *
 * rejects: a mark, a share or the word "Correct" on the wall while the room
 * answers, even when the input (wrongly) carries an answer; a name on the
 * reveal or the board; the lobby, the scoreboard and the end losing their
 * every-type moments for these two types.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import PresentStage from '../present/PresentStage';
import { PresentMoment, PhaseWipe } from '../present/PresentMoments';
import { presentModel } from '../present/presentModel';

jest.mock('qrcode.react', () => ({ QRCodeSVG: ({ value }) => <svg data-qr={value} /> }));
afterEach(cleanup);

const TRIVIA_Q = {
  title: 'Fastest growth', questionDetail: 'Which region grew fastest last quarter?', category: 'Our customers',
  optionA: 'North America', optionB: 'Southeast Asia', optionC: 'Western Europe', optionD: 'Latin America',
};
const snap = (over = {}) => ({
  gameId: '3150', gameType: 'trivia', gameMetadata: { title: 'Friday quiz' },
  state: 'ASK#004', currentQuestion: 4, currentQuestionData: TRIVIA_Q,
  stageBeat: 'results', stageFocus: { focus: 'none', index: null, part: 0, parts: 1, phase: null, rev: 0 },
  stageNotes: { page: 0, pages: null, rev: 0 }, scoreboard: { open: false },
  roomCounts: { joined: 12, answered: 11, voted: 0 }, ...over,
});
const RESULTS = {
  gameType: 'trivia',
  answers: [
    { playerName: 'Priya-Shah-9', answer: 'B', isCorrect: true },
    { playerName: 'Sam-Okafor-9', answer: 'B', isCorrect: true },
    { playerName: 'Ana-Gomez-9', answer: 'A', isCorrect: false },
    { playerName: 'Lee-Park-9', answer: 'C', isCorrect: false },
  ],
};
const draw = (model) => render(<PresentStage profile={model.profile}><PresentMoment model={model} /></PresentStage>);

describe('Trivia, answering: the options, nothing marked', () => {
  it('the model is TRIVIA_QUESTION with the lettered options and the count, and no answer', () => {
    const m = presentModel(snap(), {});
    expect(m.moment).toBe('TRIVIA_QUESTION');
    expect(m.options).toEqual([
      { letter: 'A', text: 'North America' }, { letter: 'B', text: 'Southeast Asia' },
      { letter: 'C', text: 'Western Europe' }, { letter: 'D', text: 'Latin America' },
    ]);
    expect(m.counts).toMatchObject({ done: 11, of: 12 });
    expect(m.prompt).toBe('Which region grew fastest last quarter?');
  });
  it('even an input that carries the answer (it never should) draws nothing marked and no split', () => {
    const m = presentModel(snap({ currentQuestionData: { ...TRIVIA_Q, correctAnswer: 'OptionB' } }), { results: RESULTS });
    expect(JSON.stringify(m)).not.toMatch(/correct|share|OptionB/i);
    const { container } = draw(m);
    expect(container.querySelectorAll('.present-opt')).toHaveLength(4);
    expect(container.querySelector('.is-correct, .is-dim, .present-opt-fill, .present-opt-pct, .present-opt-flag')).toBeNull();
    expect(container.textContent).not.toMatch(/Correct/);
    expect(container.textContent).toMatch(/11 of 12 answered/);
  });
  it('a gapped question is lettered A, B, C as the phones letter it', () => {
    const m = presentModel(snap({ currentQuestionData: { title: 'Gap', optionA: 'One', optionC: 'Three', optionD: 'Four' } }), {});
    expect(m.options.map((o) => `${o.letter}=${o.text}`)).toEqual(['A=One', 'B=Three', 'C=Four']);
  });
});

describe('Trivia, the reveal', () => {
  const at = (over = {}) => snap({ state: 'RESULTS#004', currentQuestionData: { ...TRIVIA_Q, correctAnswer: 'OptionB' }, ...over });
  it('marks the right option with the word, quiets the rest, and fills each with its share', () => {
    const m = presentModel(at(), { results: RESULTS });
    expect(m.moment).toBe('TRIVIA_REVEAL');
    expect(m.options.map((o) => [o.letter, o.correct, o.share])).toEqual([['A', false, 25], ['B', true, 50], ['C', false, 25], ['D', false, 0]]);
    expect(m.gotIt).toBe(2);
    const { container } = draw(m);
    const right = container.querySelector('.present-opt.is-correct');
    expect(right.textContent).toMatch(/Southeast Asia/);
    expect(right.textContent).toMatch(/Correct/);
    expect(container.querySelectorAll('.present-opt.is-dim')).toHaveLength(3);
    expect(container.textContent).toMatch(/2 of 4 got it/);
  });
  it('never names a person: the shares are counted from the letters alone', () => {
    const m = presentModel(at(), { results: RESULTS });
    expect(JSON.stringify(m)).not.toMatch(/-9/);
    expect(draw(m).container.textContent).not.toMatch(/Priya|Sam|Ana|Lee/);
  });
  it('before the results read lands: unmarked, and the foot says the answer is coming', () => {
    const m = presentModel(at(), {});
    expect(m.loading).toBe(true);
    const { container } = draw(m);
    expect(container.querySelector('.is-correct, .present-opt-pct')).toBeNull();
    expect(container.textContent).toMatch(/The answer is coming up/);
  });
  it('Workie\'s read and feedback stay every type\'s moments', () => {
    expect(presentModel(at({ stageBeat: 'field-notes' }), {}).moment).toBe('READ_WAIT');
    expect(presentModel(at({ stageBeat: 'feedback' }), {}).moment).toBe('FEEDBACK');
  });
});

describe('Trivia: the lobby, the scoreboard and the end are every type\'s', () => {
  it('the lobby', () => {
    const m = presentModel(snap({ state: 'CREATED', currentQuestion: 0, currentQuestionData: null }), { origin: 'https://engage.test' });
    expect(m.moment).toBe('LOBBY');
    expect(draw(m).container.textContent).toMatch(/Scan to join/);
  });
  it('the scoreboard rides over the reveal', () => {
    const m = presentModel(snap({ state: 'RESULTS#004', scoreboard: { open: true, rev: 2 } }), { results: RESULTS });
    expect(m.moment).toBe('TRIVIA_REVEAL');
    expect(m.scoreboard).toMatchObject({ open: true });
  });
  it('the end', () => {
    expect(presentModel(snap({ state: 'ENDED' }), { players: [] }).moment).toBe('ENDED');
  });
});

describe('Poll: the live board', () => {
  const POLL = { kind: 'choice', options: ['Monday', 'Wednesday', 'Thursday', 'Friday'] };
  const psnap = (over = {}) => snap({
    gameType: 'poll', state: 'ASK#002', currentQuestion: 2,
    currentQuestionData: { title: 'Best day to meet in person?', category: 'Offsite', poll: POLL }, ...over,
  });
  const TALLY = { kind: 'choice', n: 18, counts: [4, 9, 0, 5], other: 0, texts: [] };
  it('ASK: POLL_ASK, the board live from the room read, the count at the foot', () => {
    const m = presentModel(psnap(), { poll: { question: POLL, tally: TALLY, round: '002' } });
    expect(m.moment).toBe('POLL_ASK');
    expect(m.live).toBe(true);
    const { container } = draw(m);
    expect(container.querySelector('.svw[data-poll-kind="choice"]')).not.toBeNull();
    expect(container.textContent).toMatch(/Wednesday/);
    expect(container.textContent).toMatch(/18 answered so far/);
  });
  it('ASK before the first read: every option at nought, the question from /state', () => {
    const m = presentModel(psnap(), {});
    expect(m.question).toEqual(POLL);
    expect(draw(m).container.textContent).toMatch(/Answers fill in here as they arrive/);
  });
  it('a board read for another round is not drawn under this question', () => {
    const m = presentModel(psnap(), { poll: { question: POLL, tally: TALLY, round: '001' } });
    expect(m.tally).toBeNull();
  });
  it('RESULTS: POLL_RESULTS, the same board, still', () => {
    const m = presentModel(psnap({ state: 'RESULTS#002' }), { poll: { question: POLL, tally: TALLY, round: '002' } });
    expect(m.moment).toBe('POLL_RESULTS');
    expect(m.live).toBe(false);
    const { container } = draw(m);
    expect(container.textContent).toMatch(/18 answered\./);
    expect(container.querySelector('.svw[data-live]')).toBeNull();
  });
});

describe('the phase wipe', () => {
  it('Trivia and Poll wipe as answering and results', () => {
    const { container, rerender } = render(<PhaseWipe moment="LOBBY" />);
    rerender(<PhaseWipe moment="TRIVIA_QUESTION" />);
    expect(container.querySelector('.present-wipe.is-ask')).not.toBeNull();
    rerender(<PhaseWipe moment="TRIVIA_REVEAL" />);
    expect(container.querySelector('.present-wipe.is-results')).not.toBeNull();
  });
});
