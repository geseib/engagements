/**
 * RESULTS, IDEAS FIRST (owner, 16 Oct 2026, docs/design/results-ideas-first
 * version A): "the voting is less about the people and more about getting the
 * best or most relevant ideas to the top of the conversation."
 *
 * On the room's window the idea is the headline, in full; a rank and a share
 * bar say how much the room backed it; the points and, only when the round
 * shows names, "— Name" are a small credit line; the top row is outlined. The
 * heading reads "What the room backed" and the foot keeps the counts.
 *
 * rejects: the person's name as the headline; the idea cut to its first
 * words; a name or points in a round whose names are hidden.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import PresentStage from '../present/PresentStage';
import { PresentMoment } from '../present/PresentMoments';
import { presentModel } from '../present/presentModel';

jest.mock('qrcode.react', () => ({ QRCodeSVG: ({ value }) => <svg data-qr={value} /> }));
afterEach(cleanup);

const LONG = 'Set the thermostat rule before the meeting starts, not halfway through it, and say it out loud so everyone hears';
const snap = (over = {}) => ({
  gameId: '5479', gameType: 'call-and-answer', gameMetadata: { title: 'Q4' },
  state: 'RESULTS#002', currentQuestion: 2,
  currentQuestionData: { title: 'Temperature control', setCustomInstruction: 'How could you adapt this lesson to your work?' },
  stageBeat: 'results', stageFocus: { focus: 'none', index: null, part: 0, parts: 1, phase: null, rev: 0 },
  stageNotes: { page: 0, pages: null, rev: 0 }, scoreboard: { open: false }, authorsRevealed: true,
  roomCounts: { joined: 3, answered: 3, voted: 3 }, ...over,
});
const TALLIES = {
  0: { playerName: 'Ben', answerText: 'Cool the room when the argument heats up', totalScore: 6 },
  1: { playerName: 'Ada', answerText: LONG, totalScore: 8 },
  2: { playerName: 'Cleo', answerText: 'Name the temperature out loud', totalScore: 4 },
};
const reads = { results: { voteTallies: TALLIES } };

describe('presentModel RESULTS: ideas first', () => {
  it('each row carries the idea in full, its share of the top, and the top flag', () => {
    const m = presentModel(snap(), reads);
    expect(m.heading).toBe('What the room backed');
    expect(m.rows.map((r) => r.idea)).toEqual([LONG, 'Cool the room when the argument heats up', 'Name the temperature out loud']);
    expect(m.rows.map((r) => r.share)).toEqual([1, 0.75, 0.5]);
    expect(m.rows.map((r) => r.top)).toEqual([true, false, false]);
  });
  it('named round: the credit is the points, then "— Name"', () => {
    const m = presentModel(snap(), reads);
    expect(m.rows[0].credit).toBe('8 points — Ada');
  });
  it('hidden round: no credit, no points, no name anywhere; the share bar stays', () => {
    const m = presentModel(snap({ authorsRevealed: false }), reads);
    expect(m.rows.every((r) => r.credit === null && r.points === null)).toBe(true);
    expect(JSON.stringify(m.rows)).not.toMatch(/Ada|Ben|Cleo/);
    expect(m.rows.map((r) => r.share)).toEqual([1, 0.75, 0.5]);
  });
  it('the task line rides with the tally', () => {
    expect(presentModel(snap(), reads).task).toBe('How could you adapt this lesson to your work?');
  });
});

describe('PresentTally draws version A', () => {
  const draw = (s) => {
    const model = presentModel(s, reads);
    return render(<PresentStage profile={model.profile} fitKey="k"><PresentMoment model={model} /></PresentStage>).container;
  };
  it('the idea is the headline in full, the name only a credit, the top row outlined', () => {
    const c = draw(snap());
    const rows = [...c.querySelectorAll('.present-trow')];
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.present-idea').textContent).toBe(LONG);
    expect(rows[0].classList.contains('is-top')).toBe(true);
    expect(rows[1].classList.contains('is-top')).toBe(false);
    expect(rows[0].querySelector('.ui-trow-sub').textContent).toBe('8 points — Ada');
    expect(rows[0].querySelector('.ui-trow-bar').style.width).toBe('100%');
    expect(rows[1].querySelector('.ui-trow-bar').style.width).toBe('75%');
    expect(rows[0].querySelector('.ui-trow-rank').textContent).toBe('1');
  });
  it('the heading reads "What the room backed"; the foot keeps the counts', () => {
    const c = draw(snap());
    expect(c.querySelector('.present-top').textContent).toMatch('What the room backed');
    expect(c.querySelector('.present-foot').textContent).toBe('3 responses · 3 voted');
  });
  it('hidden round: no credit line and no points cell text', () => {
    const c = draw(snap({ authorsRevealed: false }));
    expect(c.querySelector('.ui-trow-sub')).toBeNull();
    expect(c.textContent).not.toMatch(/Ada|points/);
  });
});
