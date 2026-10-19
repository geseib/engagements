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
import { PresentMoment, PhaseWipe } from '../present/PresentMoments';
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
  ['FEEDBACK', snap({ state: 'RESULTS#005', stageBeat: 'feedback' }), {}],
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
    expect(container.textContent).toMatch(/Scan to join/);
    expect(container.textContent).toMatch(/no app, no account/);
    expect(container.textContent).toMatch(/engage\.dev\.seibtribe\.us\/play/);
    expect(container.textContent).toMatch(/5479/);
    expect(container.textContent).toMatch(/5 in the room/);
    expect(container.querySelector('[data-qr]').getAttribute('data-qr')).toBe('https://engage.dev.seibtribe.us/play?gameId=5479');
  });
  // rejects (owner, 18 Oct 2026): "why is the title of the session tiny. the
  // link and room id can be under the QR code".
  it('the lobby leads with the session title and the event details; the address and code sit under the QR', () => {
    const [s0, r0] = EVERY[0].slice(1);
    const { container } = drawn({ ...s0, gameMetadata: { ...(s0.gameMetadata || {}), title: 'Q4 offsite' } }, { ...(r0 || {}), details: 'Two hours on the roadmap.' });
    const title = container.querySelector('h1.present-lobby-title');
    expect(title.textContent).toBe('Q4 offsite');
    expect(title.className).toMatch(/ui-heading--hero/);
    expect(container.querySelector('.present-lobby-details').textContent).toBe('Two hours on the roadmap.');
    // the title is the page: not repeated on the top line
    expect(container.querySelector('.present-top').textContent).not.toMatch('Q4 offsite');
    const join = container.querySelector('.present-lobby-join');
    const order = [...join.children].map((el) => el.className.split(' ').find((c) => /^present-(qr|join-url|code)$/.test(c))).filter(Boolean);
    expect(order).toEqual(['present-qr', 'present-join-url', 'present-code']);
  });
  it('the lobby draws no details line when there are none', () => {
    const { container } = drawn(...EVERY[0].slice(1));
    expect(container.querySelector('.present-lobby-details')).toBeNull();
  });
  it('answering and voting use the round\'s words and counts only', () => {
    expect(drawn(...EVERY[1].slice(1)).container.textContent).toMatch(/3 of 5 answered/);
    const v = drawn(...EVERY[2].slice(1)).container.textContent;
    expect(v).toMatch(/2 of 5 voted/);
    expect(v).toMatch(/on your phone, laptop or tablet/);
  });
  it('one answer up while voting: large, its number, the chips; no name, no points and no rank (frame 11)', () => {
    const { container } = drawn(...EVERY[3].slice(1));
    expect(container.querySelector('.present-badge').textContent).toBe('2');
    expect(container.textContent).toMatch(/Response 2 of 2/);
    expect(container.querySelector('.present-fit-text').textContent).toBe(NAMED[1].answer);
    const chips = [...container.querySelectorAll('.present-chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['1', '2']);
    expect(chips[1].className).toMatch(/is-current/);
    expect(chips[1].className).toMatch(/ui-badge--accent/);
    expect(chips[0].className).toMatch(/ui-badge--muted/);
    expect(container.textContent).not.toMatch(/Chen|Okafor|points/);
    expect(container.querySelector('.present-points, .present-rank, .present-ladder')).toBeNull();
    expect(container.querySelector('[data-mode="vote"]')).not.toBeNull();
  });
  it('voting opens on every answer, whole and numbered, when they fit (frame 4)', () => {
    const { container, model } = drawn(snap({ state: 'VOTE#005' }), { answers: NAMED });
    expect(model.overview).toBe(true);
    const cards = [...container.querySelectorAll('.present-answers .present-answer')];
    expect(cards.map((c) => c.querySelector('.present-answer-n').textContent)).toEqual(['1', '2']);
    expect(cards.map((c) => c.querySelector('.present-answer-text').textContent)).toEqual(NAMED.map((a) => a.answer));
    expect(cards[0].className).toMatch(/ui-card/);
    expect(container.querySelector('h1.present-reminder').textContent).toBe('What should we stop doing');
    expect(container.querySelector('.present-foot').textContent).toMatch(/2 of 5 voted/);
    expect(container.textContent).not.toMatch(/Chen|Okafor|points/);
  });
  it('the QR sits beside the moment, nothing taken off it (frames 9-10)', () => {
    const { container } = drawn(snap({ state: 'VOTE#005', stageFocus: { focus: 'none', index: null, join: true } }), { answers: NAMED });
    const wrap = container.querySelector('.present-with-join');
    expect(wrap).not.toBeNull();
    expect(wrap.querySelectorAll('.present-answer')).toHaveLength(2);
    const panel = wrap.querySelector('.present-joinpanel');
    expect(panel.textContent).toMatch(/Scan to join · no app, no account/);
    expect(panel.textContent).toMatch(/engage\.dev\.seibtribe\.us\/play/);
    expect(panel.querySelector('.present-code').textContent).toBe('5479');
    expect(panel.querySelector('[data-qr]').getAttribute('data-qr')).toBe('https://engage.dev.seibtribe.us/play?gameId=5479');
    // with no QR up there is no panel
    expect(drawn(snap({ state: 'VOTE#005' }), { answers: NAMED }).container.querySelector('.present-joinpanel')).toBeNull();
  });
  it('a lesson is up: the title leads, the lesson under it, the question in "Your turn"; no generic line on Room (frames 1-2)', () => {
    const Q2 = {
      title: 'THE IMPORTANCE OF THRESHOLDS', category: 'School of Architecture',
      detail: 'Describe how you apply thresholds in your work. Architect Christopher Alexander taught that thresholds are crucial for human comfort.',
      setCustomInstruction: 'Answer on your phone.',
    };
    const { container } = drawn(snap({ currentQuestionData: Q2 }), {});
    expect(container.querySelector('.present-eyebrow').textContent).toBe('School of Architecture');
    const title = container.querySelector('[data-rc-part="title"]');
    expect(title.getAttribute('data-rc')).toBe('lead');
    expect(title.textContent).toBe('The Importance of Thresholds');
    const story = container.querySelector('.present-rc-story');
    expect(story.textContent).toMatch(/^Architect Christopher Alexander/);
    expect(story.hasAttribute('data-drop')).toBe(false);
    const turn = container.querySelector('.present-turn');
    expect(turn.querySelector('.present-turn-ey').textContent).toBe('Your turn');
    expect(turn.querySelector('.present-turn-text').textContent).toBe('Describe how you apply thresholds in your work.');
    expect(container.textContent).not.toMatch(/Answer on your phone\./);
  });
  it('on Call the generic instruction is one slim line that may give way', () => {
    const Q3 = { title: 'Thresholds', detail: 'A lesson about doorways and how people pass through them.', setCustomInstruction: 'Answer on your phone.' };
    const { container } = drawn(snap({ currentQuestionData: Q3, stageProfile: 'call' }), {});
    const line = container.querySelector('[data-rc-part="task"]');
    expect(line.textContent).toBe('Answer on your phone.');
    expect(line.getAttribute('data-drop')).toBe('1');
    expect(container.querySelector('.present-turn')).toBeNull();
  });
  it('one result up: its place, the answer and a ladder with no numbers when names are hidden (frame 12)', () => {
    const [, s] = EVERY[5];
    const { container } = drawn({ ...s, authorsRevealed: false, stageFocus: { ...s.stageFocus, index: 1 } }, { results: { voteTallies: TALLIES } });
    expect(container.querySelector('.present-place').textContent).toBe('2nd');
    const rungs = [...container.querySelectorAll('.present-rung')];
    expect(rungs.map((r) => r.querySelector('.present-rung-n').textContent)).toEqual(['1', '2']);
    expect(rungs[0].className).toMatch(/is-top/);
    expect(rungs[1].className).toMatch(/is-current/);
    expect(container.querySelector('.present-rung-pts')).toBeNull();
    expect(container.textContent).not.toMatch(/Chen|Okafor|points/);
  });
  it('the results navigator names and scores a revealed round', () => {
    const { container } = drawn(...EVERY[5].slice(1));
    expect(container.textContent).toMatch(/Maya-Chen-7/);
    expect(container.textContent).toMatch(/8 vote points/);
    expect(container.textContent).toMatch(/Response 1 of 2/);
  });
  it('a featured comment replaces the prompt with a quote and its credit', () => {
    const { container } = drawn(snap({ state: 'RESULTS#005', stageBeat: 'feedback' }), {
      comments: [{ text: 'Name the customer.', featured: true, featuredAt: '2026-10-13T10:05:00Z', playerName: 'Said in the room', fromHost: true, anchorKind: 'results' }],
    });
    expect(container.querySelector('.present-quote blockquote').textContent).toBe('Name the customer.');
    expect(container.querySelector('.present-quote figcaption').textContent).toBe('Said in the room');
    expect(container.textContent).not.toMatch(/Provide feedback/);
  });
  it('the end: rounds played, the room, and the podium once the names are out (19 Oct 2026)', () => {
    const players = [{ playerName: 'Ada', totalScore: 12 }, { playerName: 'Ben', totalScore: 9 }, { playerName: 'Cleo', totalScore: 4 }];
    const { container } = drawn(snap({ state: 'ENDED', currentQuestion: 3, authorsRevealed: true }), { players });
    expect(container.querySelector('.present-hero').textContent).toBe('3 rounds played');
    expect(container.textContent).toMatch('5 in the room');
    const pods = [...container.querySelectorAll('.present-pod')];
    expect(pods.map((p) => p.querySelector('.present-pod-nm').textContent)).toEqual(['Ada', 'Ben', 'Cleo']);
    expect(container.querySelector('.present-podium').getAttribute('data-attribution')).toBe('revealed');
    const hidden = drawn(snap({ state: 'ENDED', currentQuestion: 3, authorsRevealed: false }), { players }).container;
    expect(hidden.querySelector('.present-podium')).toBeNull();
    expect(hidden.textContent).not.toMatch(/Ada|Ben|Cleo/);
  });
  it('a comment put up during results or the read shows on the wall, as on the stage', () => {
    const comments = [{ text: 'Name the customer.', featured: true, featuredAt: '2026-10-13T10:05:00Z', playerName: 'Said in the room', fromHost: true, anchorKind: 'results' }];
    const results = drawn(snap({ state: 'RESULTS#005', authorsRevealed: true }), { results: { voteTallies: TALLIES }, comments }).container;
    expect(results.querySelector('.present-quote blockquote').textContent).toBe('Name the customer.');
    const read = drawn(snap({ state: 'RESULTS#005', stageBeat: 'field-notes', stageNotes: { page: 0, pages: 2, rev: 1 } }), { summary: { markdownResponse: MD }, comments }).container;
    expect(read.querySelector('.present-quote blockquote').textContent).toBe('Name the customer.');
    const none = drawn(snap({ state: 'RESULTS#005', authorsRevealed: true }), { results: { voteTallies: TALLIES }, comments: [] }).container;
    expect(none.querySelector('.present-quote')).toBeNull();
  });
  it('feedback names its round and the title, not the question again (owner, 2026-10-13)', () => {
    const { container } = drawn(...EVERY.find(([m]) => m === 'FEEDBACK').slice(1));
    // WHAT THE ROOM SEES (owner, 17 Oct 2026, config/roomContent.js): on Room the
    // top line carries the round only; the session title rides it on Call.
    expect(container.querySelector('.ui-top-line').textContent).toMatch(/^Round 5\s*Feedback/);
    expect(container.querySelector('.present-eyebrow').textContent).toBe('Round 5 · Feedback');
    expect(container.querySelector('h1.present-hero')).toBeNull();
    // The round's title stays as the reminder, now a kicker; the ask leads.
    expect(container.querySelector('[data-rc-part="title"]').textContent).toBe('What should we stop doing');
    expect(container.querySelector('[data-rc-part="ask"][data-rc="lead"]')).not.toBeNull();
    const [, callSnap, callReads] = EVERY.find(([m]) => m === 'FEEDBACK');
    const call = drawn({ ...callSnap, stageProfile: 'call' }, callReads).container;
    expect(call.querySelector('.ui-top-line').textContent).toMatch(/Q4 Wrap up · Round 5\s*Feedback/);
    expect(container.textContent).not.toMatch(/Name one habit/);
    expect(container.textContent).toMatch(/Provide feedback on the round from your phone, laptop or tablet\./);
    expect(container.querySelector('.present-foot').textContent).toBe('Round 5');
  });
  it('the parts are the library\'s (skins P2): top line, eyebrow, heading, pips, badge, card, tally row, ground', () => {
    const canvasOf = (c) => c.querySelector('.present-canvas');
    const answering = drawn(...EVERY[1].slice(1)).container;
    expect(canvasOf(answering).classList.contains('ui-ground--wall')).toBe(true);
    expect(answering.querySelector('.present-top').classList.contains('ui-top-line')).toBe(true);
    expect(answering.querySelector('.present-eyebrow').classList.contains('ui-eyebrow')).toBe(true);
    // The title leads (owner, 18 Oct 2026, room-content-v2); the lesson sits under it.
    expect(answering.querySelector('[data-rc="lead"]').className).toMatch(/present-rc-lead/);
    expect(answering.querySelector('[data-rc-part="title"]').getAttribute('data-rc')).toBe('lead');
    expect(answering.querySelector('[data-rc-part="story"]').className).toMatch(/present-rc-story/);
    expect(answering.querySelector('.present-meter').className).toMatch(/ui-pips--meter/);
    // The voting reminder is a Heading at the primary step.
    const [, vSnap, vReads] = EVERY[2];
    const voting = drawn({ ...vSnap, stageProfile: 'call' }, vReads).container;
    expect(voting.querySelector('h1.present-h2').className).toMatch(/ui-heading--primary/);
    const nav = drawn(...EVERY[3].slice(1)).container;
    expect(nav.querySelector('.present-badge').className).toMatch(/ui-badge ui-badge--accent/);
    const overview = drawn(snap({ state: 'VOTE#005' }), { answers: NAMED }).container;
    expect(overview.querySelector('.present-answer').className).toMatch(/ui-card/);
    expect(overview.querySelector('.present-answer-n').className).toMatch(/ui-badge/);
    const tally = drawn(...EVERY[4].slice(1)).container;
    expect(tally.querySelectorAll('.present-trow.ui-trow').length).toBeGreaterThan(0);
    const read = drawn(...EVERY[6].slice(1)).container;
    expect(read.querySelector('.present-pages').className).toMatch(/ui-pips--pages/);
    const lobby = drawn(...EVERY[0].slice(1)).container;
    expect(lobby.querySelector('.present-code-label').className).toMatch(/ui-eyebrow--muted/);
  });
  it('the fitter finds the canvas inside the root (Ground takes no ref)', () => {
    const { container } = drawn(...EVERY[1].slice(1));
    expect(container.querySelector('.present-canvas').dataset.fit).toBe('ok');
    expect(container.querySelector('.present-canvas').style.getPropertyValue('--fit')).toBe('1');
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
      // The Build Room's window (B7); buildWallImports.test.js walks its imports.
      ...fs.readdirSync(path.join(SRC, 'present', 'buildwall')).map((f) => path.join(SRC, 'present', 'buildwall', f)),
      path.join(SRC, 'PresentPage.jsx'),
    ].filter((f) => /\.(js|jsx)$/.test(f) && !/presentControls\.js$/.test(f));
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(`${path.basename(file)}: ${/authFetch|\/host-state|\/answers\/host|ai-summary\/host/.test(text)}`)
        .toBe(`${path.basename(file)}: false`);
    }
  });
});

/* WHAT THE RESPONSES ANSWER (walk of dev eed66685, owner 18 Oct 2026): while the
   room votes on or reads the responses, the wall's context line is the lesson
   ("The question"), not the instructions; the task only when there is no lesson. */
describe('the context line while voting and at the results', () => {
  it.each([[2, 'VOTING'], [3, 'VOTE_RESPONSE'], [4, 'RESULTS']])('%s %s: the lesson as "The question"', (i) => {
    const { container } = drawn(...EVERY[i].slice(1));
    const line = container.querySelector('.present-task');
    if (!line) return; // a profile may give the line way for space
    expect(line.textContent).toBe(`The question${Q.detail}`);
  });
  it('with no lesson the task stays, as "The task"', () => {
    const s = snap({ state: 'VOTE#005', currentQuestionData: { ...Q, detail: '', customInstructions: 'Use STAR.' } });
    const model = presentModel(s, {});
    expect(model.taskLabel).toBe('The task');
    expect(model.task).toBe('Use STAR.');
  });
});

/* rejects (walk of dev eed66685): the "Results · Look up" wipe replayed over
   Workie's first page when the read landed after "Workie is writing". */
describe('the phase wipe', () => {
  it('plays into the results once, and not again for the read', () => {
    const { container, rerender } = render(<PhaseWipe moment="VOTING" />);
    rerender(<PhaseWipe moment="RESULTS" />);
    expect(container.querySelector('.present-wipe')).not.toBeNull();
    const fresh = render(<PhaseWipe moment="RESULTS" />);
    fresh.rerender(<PhaseWipe moment="READ_WAIT" />);
    fresh.rerender(<PhaseWipe moment="READ" />);
    fresh.rerender(<PhaseWipe moment="FEEDBACK" />);
    expect(fresh.container.querySelector('.present-wipe')).toBeNull();
  });
});
