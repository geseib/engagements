/**
 * THE CANVAS AND THE MOMENTS (two-surface PLAN 2.6, 2.7, 2.9, 2.11).
 *
 * The wall never shows a control, locks the page while mounted, carries the
 * session's profile, draws every moment in the round's words, keeps names and
 * points off the voting navigator, is a public route, and never reaches for
 * the host's authenticated reads.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, cleanup } from '@testing-library/react';
import PresentStage, { fitCanvas, PRESENT_LADDERS } from '../present/PresentStage';
import { PresentMoment } from '../present/PresentMoments';
import { presentModel } from '../present/presentModel';

jest.mock('qrcode.react', () => ({ QRCodeSVG: ({ value }) => <svg data-qr={value} /> }));

afterEach(cleanup);

const Q = { title: 'What should we stop doing', detail: 'Name one habit.', category: 'Retro' };
const snap = (over = {}) => ({
  gameId: '5479', gameType: 'call-and-answer', gameMetadata: { title: 'Q4 Wrap up' },
  state: 'ASK#005', currentQuestion: 5, currentQuestionData: Q, stageBeat: 'results',
  stageFocus: { focus: 'none', index: null, part: 0, parts: 1, phase: null, rev: 0 },
  stageNotes: { page: 0, pages: null, rev: 0 }, scoreboard: { open: false }, authorsRevealed: false,
  roomCounts: { joined: 5, answered: 3, voted: 2 }, ...over,
});
const NAMED = [
  { answer: 'Design our runbooks now.', playerName: 'Maya-Chen-7' },
  { answer: 'Usage pricing with shadow invoices.', playerName: 'Sam-Okafor-7' },
];
const TALLIES = {
  0: { playerName: 'Maya-Chen-7', answerText: NAMED[0].answer, totalScore: 8 },
  1: { playerName: 'Sam-Okafor-7', answerText: NAMED[1].answer, totalScore: 7 },
};
const MD = '## What the room said\n\n- one point\n\n## Discussion topics\n\n1. a topic';

const EVERY = [
  ['LOBBY', snap({ state: 'CREATED', currentQuestion: 0, currentQuestionData: null }), {}],
  ['ANSWERING', snap(), {}],
  ['VOTING', snap({ state: 'VOTE#005' }), {}],
  ['VOTE_RESPONSE', snap({ state: 'VOTE#005', stageFocus: { focus: 'answer', index: 1, part: 0, parts: 1, phase: 'VOTE', rev: 1 } }), { answers: NAMED }],
  ['RESULTS', snap({ state: 'RESULTS#005', authorsRevealed: true }), { results: { voteTallies: TALLIES } }],
  ['RESPONSES', snap({ state: 'RESULTS#005', authorsRevealed: true, stageFocus: { focus: 'answer', index: 0, part: 0, parts: 1, phase: 'RESULTS', rev: 1 } }), { results: { voteTallies: TALLIES } }],
  ['READ', snap({ state: 'RESULTS#005', stageBeat: 'field-notes', stageNotes: { page: 0, pages: 2, rev: 1 } }), { summary: { markdownResponse: MD } }],
  ['READ_WAIT', snap({ state: 'RESULTS#005', stageBeat: 'field-notes' }), {}],
  ['QUESTION_FOCUS', snap({ state: 'RESULTS#005', stageFocus: { focus: 'question', index: null, part: 0, parts: 1, phase: null, rev: 1 } }), {}],
  ['ENDED', snap({ state: 'ENDED' }), {}],
];

const drawn = (s, reads) => {
  const model = presentModel(s, { origin: 'https://engage.dev.seibtribe.us', ...reads });
  return { model, ...render(<PresentStage profile={model.profile} fitKey="k"><PresentMoment model={model} /></PresentStage>) };
};

describe('the canvas', () => {
  it('locks the page while mounted and carries the profile on the root and html', () => {
    const { container, unmount } = render(<PresentStage profile="tv"><p>x</p></PresentStage>);
    expect(document.documentElement.classList.contains('present-locked')).toBe(true);
    expect(document.documentElement.classList.contains('d-tv')).toBe(true);
    expect(container.querySelector('.present').getAttribute('data-profile')).toBe('tv');
    expect(container.querySelector('.present').getAttribute('data-theme')).toBe('dark');
    unmount();
    expect(document.documentElement.classList.contains('present-locked')).toBe(false);
    expect(document.documentElement.classList.contains('d-tv')).toBe(false);
  });
  it('an unknown profile is Room', () => {
    const { container } = render(<PresentStage profile="bogus"><p>x</p></PresentStage>);
    expect(container.querySelector('.present').getAttribute('data-profile')).toBe('room');
  });
  it('fitCanvas marks ok when nothing overflows (jsdom has no layout) and resets --fit', () => {
    const div = document.createElement('div');
    div.innerHTML = '<div class="present-main"><p data-drop="1" hidden>bg</p></div>';
    expect(fitCanvas(div, 'room')).toBe('ok');
    expect(div.style.getPropertyValue('--fit')).toBe('1');
    expect(div.querySelector('[data-drop]').hidden).toBe(false);
  });
  it('fitCanvas drops the optional block, then marks a miss, when the moment will not fit', () => {
    const div = document.createElement('div');
    div.innerHTML = '<div class="present-main"><p data-drop="1">bg</p></div>';
    const main = div.querySelector('.present-main');
    Object.defineProperty(main, 'scrollHeight', { get: () => 2000 });
    Object.defineProperty(main, 'clientHeight', { get: () => 900 });
    expect(fitCanvas(div, 'tv')).toBe('miss');
    expect(div.style.getPropertyValue('--fit')).toBe('0.78');
    expect(div.querySelector('[data-drop]').hidden).toBe(true);
    expect(div.dataset.fit).toBe('miss');
  });
  it('a long response shrinks from the primary size to no less than the floor', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p class="present-fit-text">long</p>';
    const t = div.querySelector('.present-fit-text');
    Object.defineProperty(t, 'scrollHeight', { get: () => 5000 });
    Object.defineProperty(t, 'clientHeight', { get: () => 400 });
    fitCanvas(div, 'room');
    expect(t.style.fontSize).toBe(`${PRESENT_LADDERS.room.floor}px`);
  });
  it('the fitter\'s ladders are present.css\'s ladders', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'present', 'present.css'), 'utf8');
    for (const [profile, l] of Object.entries(PRESENT_LADDERS)) {
      const sel = profile === 'room' || profile === 'call'
        ? '.present[data-profile="room"] .present-canvas'
        : `.present[data-profile="${profile}"] .present-canvas`;
      const start = css.indexOf(`${sel} {`) >= 0 ? css.indexOf(`${sel} {`) : css.indexOf(`${sel},`);
      const block = css.slice(start, css.indexOf('}', start));
      expect(block).toMatch(new RegExp(`--L-primary: ${l.primary}px`));
      expect(block).toMatch(new RegExp(`--L-secondary: ${l.secondary}px`));
      expect(block).toMatch(new RegExp(`--fit-min: ${String(l.fitMin).replace(/^0/, '')}`));
      expect(block).toMatch(new RegExp(`--floor: ${l.floor}px`));
    }
  });
});

describe('every moment', () => {
  it.each(EVERY)('%s draws, and shows no control', (moment, s, reads) => {
    const { model, container } = drawn(s, reads);
    expect(model.moment).toBe(moment);
    expect(container.querySelectorAll('button, a, [role="button"], input, select, textarea')).toHaveLength(0);
  });
  it.each(EVERY)('%s has at most one position indicator', (_m, s, reads) => {
    const { container } = drawn(s, reads);
    const text = container.textContent;
    const indicators = (text.match(/(Response \d+ of \d+|Page \d+ of \d+)/g) || []);
    expect(indicators.length).toBeLessThanOrEqual(1);
  });
  it('the lobby shows the code, the join address, the QR and the room count', () => {
    const { container } = drawn(...EVERY[0].slice(1));
    expect(container.textContent).toMatch(/Scan to join · no app, no account/);
    expect(container.textContent).toMatch(/engage\.dev\.seibtribe\.us\/play/);
    expect(container.textContent).toMatch(/5479/);
    expect(container.textContent).toMatch(/5 in the room/);
    expect(container.querySelector('[data-qr]').getAttribute('data-qr')).toBe('https://engage.dev.seibtribe.us/play?gameId=5479');
  });
  it('answering and voting use the round\'s words and counts only', () => {
    expect(drawn(...EVERY[1].slice(1)).container.textContent).toMatch(/3 of 5 answered/);
    const v = drawn(...EVERY[2].slice(1)).container.textContent;
    expect(v).toMatch(/2 of 5 voted/);
    expect(v).toMatch(/on your phone, laptop or tablet/);
  });
  it('the voting navigator has no name, no points and no rank', () => {
    const { container } = drawn(...EVERY[3].slice(1));
    expect(container.textContent).toMatch(/Response 2 · name hidden/);
    expect(container.textContent).not.toMatch(/Chen|Okafor|points/);
    expect(container.querySelector('.present-points, .present-rank')).toBeNull();
    expect(container.querySelector('[data-mode="vote"]')).not.toBeNull();
  });
  it('the results navigator names and scores a revealed round', () => {
    const { container } = drawn(...EVERY[5].slice(1));
    expect(container.textContent).toMatch(/Maya-Chen-7/);
    expect(container.textContent).toMatch(/8 vote points/);
    expect(container.textContent).toMatch(/Response 1 of 2/);
  });
  it('the read shows its page and "Page 1 of 2"', () => {
    const { container } = drawn(...EVERY[6].slice(1));
    expect(container.textContent).toMatch(/What the room said/);
    expect(container.textContent).toMatch(/Page 1 of 2/);
  });
});

describe('the route and its imports', () => {
  const SRC = path.join(__dirname, '..');
  it('/present is public: routed before any ProtectedRoute and outside one', () => {
    const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');
    const at = app.indexOf("path === '/present'");
    expect(at).toBeGreaterThan(0);
    const branch = app.slice(at, app.indexOf('}', at));
    expect(branch).not.toMatch(/ProtectedRoute/);
    expect(app.indexOf("path === '/present'")).toBeLessThan(app.indexOf("path.startsWith('/remote')"));
  });
  it('nothing the wall draws imports authFetch or reads a host door', () => {
    const files = [
      ...fs.readdirSync(path.join(SRC, 'present')).map((f) => path.join(SRC, 'present', f)),
      path.join(SRC, 'PresentPage.jsx'),
    ].filter((f) => /\.(js|jsx)$/.test(f) && !/presentControls\.js$/.test(f));
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(`${path.basename(file)}: ${/authFetch|\/host-state|\/answers\/host|ai-summary\/host/.test(text)}`)
        .toBe(`${path.basename(file)}: false`);
    }
  });
});
