/**
 * A SURVEY ON THE PHONE, END TO END AGAINST THE ROUTE CONTRACT.
 *
 * The backend is being built in parallel (Track A), so every request here is
 * answered by a fake that speaks docs/design/survey-redesign/
 * IMPLEMENTATION-phase-2.md §2 "THE CONTRACT" and nothing else:
 *
 *   GET  /games/{id}/survey           → {state, names, title, openedAt, warnedAt, questions}
 *   PUT  /games/{id}/survey/answers   {qid, value, respondentId?, player?}
 *   POST /games/{id}/survey/submit    {respondentId?, player?}  → 422 {code, missing}
 *   POST /games/{id}/survey/mine      {respondentId?, player?}  → 404 no row yet
 *
 * Refusals carry `{error, code}` (lambda-functions/game/survey-answers.js), and
 * the phone branches on the CODE, never on the status alone: a 409 is
 * `SURVEY_CLOSED` (closed) or `NOT_OPEN` (not yet), and a lost optimistic lock
 * is `CONFLICT` — 409 from the first backend, 503 (with `BUSY`) from the
 * second — which means "try again", never "closed".
 *
 * What is pinned is the phone's half: the Names promise on question 1 and
 * nowhere else, the required/optional rule at Next, one PUT per answer carrying
 * the right identity for the Names mode, ONE save in flight per phone with the
 * latest value per question winning, resume at the first unanswered question,
 * the review list, Send, and the closed / ended / closing-soon screens.
 *
 * No geometry: jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import SurveyRunner from '../components/survey/SurveyRunner';
import PlayerPage from '../PlayerPage';
import webSocketClient from '../WebSocketClient';
import { NAMES_MODES } from '../config/surveyNames';

jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ensureConnected: jest.fn(),
    isConnected: () => false,
    sendCleanMessage: jest.fn(),
    onConnectionStatusChange: jest.fn(),
    onReconnected: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

const API = window.API_BASE;
const GAME = '4821';
const RESPONDENT = /^r_[A-Za-z0-9_-]{22}$/;
const OPENED = '2026-09-23T10:00:00.000Z';
/** Where a phone keeps its respondent id: per join code AND per opening. */
const RESP_KEY = `surveyResp_${GAME}_${OPENED}`;

const Q1 = {
  qid: 'c001#001', n: 1, kind: 'rating', required: true,
  title: 'How useful was today’s session for your work?', detail: '',
  scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful',
};
const Q2 = {
  qid: 'c001#002', n: 2, kind: 'rating', required: false,
  title: 'How likely are you to recommend this session to a colleague?', detail: '',
  scale: '0-10', lowLabel: 'Not at all likely', highLabel: 'Extremely likely',
};
const Q3 = {
  qid: 'c001#003', n: 3, kind: 'choice', required: true,
  title: 'Which part was most valuable to you?', detail: '',
  options: ['Live demo', 'Case studies', 'Pricing roadmap'], allowMultiple: false, allowOther: false, shuffle: false,
};
const Q4 = {
  qid: 'c001#004', n: 4, kind: 'text', required: false,
  title: 'What was the best part of the presentation?', detail: '',
  textLength: 'long', maxLength: 500, placeholder: '',
};
const QUESTIONS = [Q1, Q2, Q3, Q4];

/** A Storage double — so each test starts with no respondent and no clientId. */
function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

const reply = (status, body) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/**
 * The fake backend. `put` / `submit` / `mine` may be overridden per test with a
 * function of the parsed body that returns `[status, body]` or a Promise of it.
 */
function makeServer(over = {}) {
  const server = {
    names: 'anonymous',
    state: 'SURVEY#OPEN',
    title: 'Q3 All-Hands',
    openedAt: OPENED,
    warnedAt: null,
    questions: QUESTIONS,
    mine: null,                         // null → 404 (no row yet)
    put: () => [200, { saved: true, rev: 1, answered: 1, complete: false }],
    submit: () => [200, { complete: true }],
    ...over,
  };
  server.puts = [];
  server.submits = [];
  server.mines = [];
  // How many PUTs are on the wire at once, and the most there ever were.
  server.putsOpen = 0;
  server.maxPutsOpen = 0;
  server.fetchFn = jest.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const answer = (r) => Promise.resolve(r).then(([status, b]) => reply(status, b));
    if (u === `${API}games/${GAME}/survey` && method === 'GET') {
      if (server.state === 'CREATED') {
        return reply(409, { error: 'This survey is not open yet.', code: 'NOT_OPEN', state: 'CREATED' });
      }
      const payload = {
        state: server.state, names: server.names, openedAt: server.openedAt,
        warnedAt: server.warnedAt, questions: server.questions,
      };
      if (server.title !== undefined) payload.title = server.title;
      return reply(200, payload);
    }
    if (u === `${API}games/${GAME}/survey/answers` && method === 'PUT') {
      server.puts.push(body);
      server.putsOpen += 1;
      server.maxPutsOpen = Math.max(server.maxPutsOpen, server.putsOpen);
      return Promise.resolve(server.put(body, server.puts.length))
        .then(([status, b]) => { server.putsOpen -= 1; return reply(status, b); });
    }
    if (u === `${API}games/${GAME}/survey/submit` && method === 'POST') {
      server.submits.push(body);
      return answer(server.submit(body));
    }
    if (u === `${API}games/${GAME}/survey/mine` && method === 'POST') {
      server.mines.push(body);
      if (!server.mine) return reply(404, { error: 'No answers yet.' });
      return reply(200, server.mine);
    }
    return reply(404, {});
  });
  return server;
}

function renderRunner(server, props = {}) {
  const storage = props.storage || memoryStorage();
  const utils = render(
    <SurveyRunner
      gameId={GAME}
      playerName="Ada"
      apiBase={API}
      fetchFn={server.fetchFn}
      state="SURVEY#OPEN"
      storage={storage}
      {...props}
    />,
  );
  return { ...utils, storage };
}

const heading = (q) => screen.findByRole('heading', { name: q.title });
const primary = () => screen.getByRole('button', { name: /^(Next|Skip|Review)$/ });

async function answerRating(label) {
  fireEvent.click(screen.getByRole('radio', { name: label }));
}

/* ======================================================================= */
describe('the Names promise', () => {
  test.each(NAMES_MODES.map((m) => [m.label, m]))('%s: phoneLine above question 1, and on no other', async (_label, mode) => {
    const server = makeServer({ names: mode.id });
    const { container } = renderRunner(server);
    await heading(Q1);
    const promise = container.querySelector('p.plr-anon');
    expect(promise).not.toBeNull();
    expect(promise.textContent.replace(/\s+/g, ' ').trim())
      .toBe(`${mode.phoneLead ? `${mode.phoneLead} ` : ''}${mode.phoneLine}`);
    if (mode.phoneLead) expect(promise.querySelector('b').textContent).toBe(mode.phoneLead);
    // It sits ABOVE the question, as p-01 / p-11 / p-12 draw it.
    const title = screen.getByRole('heading', { name: Q1.title });
    expect(promise.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await answerRating('4 of 5');
    fireEvent.click(primary());
    await heading(Q2);
    expect(container.querySelector('p.plr-anon')).toBeNull();
  });
});

/* ======================================================================= */
describe('Next, Skip and Back', () => {
  test('a required question holds Next, and says why', async () => {
    const server = makeServer();
    renderRunner(server);
    await heading(Q1);
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();
    expect(next).toHaveAccessibleDescription(/needs an answer/i);
    expect(screen.getByText(/needs an answer/i, { selector: '.plr-qno *, .plr-qno' })).toBeInTheDocument();
    await answerRating('3 of 5');
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('an optional question offers Skip until it is answered, then Next', async () => {
    const server = makeServer();
    renderRunner(server);
    await heading(Q1);
    await answerRating('4 of 5');
    fireEvent.click(primary());
    await heading(Q2);
    expect(screen.getByText(/optional/, { selector: '.plr-qno *, .plr-qno' })).toBeInTheDocument();
    const skip = screen.getByRole('button', { name: 'Skip' });
    expect(skip).toBeEnabled();
    await answerRating('8 of 10');
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  test('Back is there but unavailable on question 1, and returns from question 2', async () => {
    const server = makeServer();
    renderRunner(server);
    await heading(Q1);
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    await answerRating('4 of 5');
    fireEvent.click(primary());
    await heading(Q2);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await heading(Q1);
    expect(screen.getByRole('radio', { name: '4 of 5' })).toHaveAttribute('aria-checked', 'true');
  });

  /*
    A NEW QUESTION IS SAID ALOUD. Next and Back replace the whole screen, so
    the button that was pressed goes with it and the focus used to fall to
    <body> — a screen reader said nothing, and a keyboard user started again
    from the top. The new screen's heading takes the focus (tabIndex -1: a
    target, not a Tab stop), so the question is what is announced.
  */
  test('Next and Back move the focus to the new question\'s heading', async () => {
    const server = makeServer();
    renderRunner(server);
    await heading(Q1);
    await answerRating('4 of 5');
    const next = primary();
    next.focus();
    fireEvent.click(next);
    const h2 = await heading(Q2);
    await waitFor(() => expect(document.activeElement).toBe(h2));
    expect(h2).toHaveAttribute('tabindex', '-1');
    const back = screen.getByRole('button', { name: 'Back' });
    back.focus();
    fireEvent.click(back);
    const h1 = await heading(Q1);
    await waitFor(() => expect(document.activeElement).toBe(h1));
  });

  test('reaching the review moves the focus to its heading too', async () => {
    const server = makeServer({ mine: { answers: { [Q1.qid]: 4, [Q2.qid]: 8, [Q3.qid]: [0] }, answered: [], complete: false, rev: 3 } });
    renderRunner(server);
    await heading(Q4);
    fireEvent.click(primary());
    const review = await screen.findByRole('heading', { name: 'Check your answers' });
    await waitFor(() => expect(document.activeElement).toBe(review));
  });

  test('the first screen does not steal the focus on load', async () => {
    const server = makeServer();
    renderRunner(server);
    await heading(Q1);
    expect(document.activeElement).toBe(document.body);
  });

  test('the bar carries the session\'s own name from GET /survey', async () => {
    const server = makeServer({ title: 'Q3 All-Hands' });
    const { container } = renderRunner(server);
    await heading(Q1);
    expect(container.querySelector('.plr-cat')).toHaveTextContent('Q3 All-Hands');
  });

  test.each([
    ['absent', undefined],
    ['null', null],
    ['blank', '   '],
  ])('a title that is %s leaves the bar clean — no empty chip, no "undefined"', async (_l, title) => {
    const server = makeServer({ title });
    const { container } = renderRunner(server);
    await heading(Q1);
    expect(container.querySelector('.plr-cat')).toBeNull();
    expect(container.querySelector('.plr-bar').textContent).not.toMatch(/undefined|null/);
  });

  test('the bar says where you are, and the strip fills as you go', async () => {
    const server = makeServer();
    const { container } = renderRunner(server);
    await heading(Q1);
    expect(container.querySelector('.plr-ctx').textContent).toBe('1 of 4');
    expect(container.querySelector('.plr-strip').style.getPropertyValue('--plr-progress')).toBe('0%');
    await answerRating('4 of 5');
    fireEvent.click(primary());
    await heading(Q2);
    expect(container.querySelector('.plr-ctx').textContent).toBe('2 of 4');
    expect(container.querySelector('.plr-strip').style.getPropertyValue('--plr-progress')).toBe('25%');
  });
});

/* ======================================================================= */
describe('every answer is saved as it is given', () => {
  test('Anonymous: one PUT with the qid, the value and a respondent id — no name, no clientId', async () => {
    const server = makeServer({ names: 'anonymous' });
    const { storage } = renderRunner(server);
    await heading(Q1);
    await answerRating('4 of 5');
    await waitFor(() => expect(server.puts).toHaveLength(1));
    const [body] = server.puts;
    expect(body).toEqual({ qid: Q1.qid, value: 4, respondentId: expect.stringMatching(RESPONDENT) });
    expect(body.respondentId).toBe(storage.data.get(RESP_KEY));
    expect(JSON.stringify(body)).not.toMatch(/Ada/);
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  test('Who finished: the respondent id AND the player, so the server can mark who finished', async () => {
    const server = makeServer({ names: 'finished' });
    const { storage } = renderRunner(server);
    await heading(Q1);
    await answerRating('5 of 5');
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0]).toEqual({
      qid: Q1.qid,
      value: 5,
      respondentId: expect.stringMatching(RESPONDENT),
      player: { name: 'Ada', clientId: storage.data.get(`playerClient_${GAME}`) },
    });
    expect(server.puts[0].respondentId).not.toBe(server.puts[0].player.clientId);
  });

  test('Named: the player only — no respondent id is minted at all', async () => {
    const server = makeServer({ names: 'named' });
    const { storage } = renderRunner(server);
    await heading(Q1);
    await answerRating('2 of 5');
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0]).toEqual({
      qid: Q1.qid, value: 2, player: { name: 'Ada', clientId: storage.data.get(`playerClient_${GAME}`) },
    });
    expect([...storage.data.keys()].some((k) => k.startsWith('surveyResp_'))).toBe(false);
  });

  test('one save in flight per question, and the latest value wins', async () => {
    let release;
    const server = makeServer({
      put: (_b, n) => (n === 1
        ? new Promise((resolve) => { release = () => resolve([200, { saved: true, rev: 1 }]); })
        : [200, { saved: true, rev: 2 }]),
    });
    renderRunner(server);
    await heading(Q1);
    await answerRating('2 of 5');
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await answerRating('3 of 5');
    await answerRating('4 of 5');
    expect(server.puts).toHaveLength(1);
    await act(async () => { release(); });
    await waitFor(() => expect(server.puts).toHaveLength(2));
    expect(server.puts.map((b) => b.value)).toEqual([2, 4]);
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  test('words are saved on a pause, once — not on every key', async () => {
    const server = makeServer({ mine: { answers: { [Q1.qid]: 4, [Q2.qid]: 8, [Q3.qid]: [0] }, answered: [Q1.qid, Q2.qid, Q3.qid], complete: false, rev: 3 } });
    renderRunner(server);
    await heading(Q4);
    const box = screen.getByRole('textbox', { name: 'Your answer' });
    fireEvent.change(box, { target: { value: 'The' } });
    fireEvent.change(box, { target: { value: 'The demo' } });
    fireEvent.change(box, { target: { value: 'The demo, live' } });
    expect(server.puts).toHaveLength(0);
    await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 2000 });
    expect(server.puts[0]).toMatchObject({ qid: Q4.qid, value: 'The demo, live' });
  });

  test('leaving the box saves at once', async () => {
    const server = makeServer({ mine: { answers: { [Q1.qid]: 4, [Q2.qid]: 8, [Q3.qid]: [0] }, answered: [], complete: false, rev: 3 } });
    renderRunner(server);
    await heading(Q4);
    const box = screen.getByRole('textbox', { name: 'Your answer' });
    fireEvent.change(box, { target: { value: 'Pace' } });
    fireEvent.blur(box);
    await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 300 });
    expect(server.puts[0].value).toBe('Pace');
  });

  test('a failed save says so, keeps trying, and says Saved when it lands', async () => {
    const server = makeServer({ put: (_b, n) => (n === 1 ? [503, { error: 'busy' }] : [200, { saved: true }]) });
    renderRunner(server);
    await heading(Q1);
    await answerRating('4 of 5');
    expect(await screen.findByText('Not saved – retrying')).toBeInTheDocument();
    await waitFor(() => expect(server.puts).toHaveLength(2), { timeout: 3000 });
    expect(server.puts[1].value).toBe(4);
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  test('a save refused because the survey closed puts the closed screen up', async () => {
    const server = makeServer({
      put: () => [409, { error: 'This survey has closed.', code: 'SURVEY_CLOSED', state: 'SURVEY#CLOSED' }],
    });
    renderRunner(server);
    await heading(Q1);
    await answerRating('4 of 5');
    expect(await screen.findByRole('heading', { name: /The survey is closed/ })).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  /*
    A LOST OPTIMISTIC LOCK IS "TRY AGAIN", NOT "CLOSED". The server retries its
    own conditional write three times and then answers CONFLICT — 409 on the
    first backend, 503 (or BUSY, a transaction conflict) on the second. The
    phone that read every 409 as closed put the closed screen up in front of a
    person whose survey was still open.
  */
  test.each([
    ['409 CONFLICT', 409, 'CONFLICT'],
    ['503 CONFLICT', 503, 'CONFLICT'],
    ['503 BUSY', 503, 'BUSY'],
  ])('%s is retried and lands — never the closed screen', async (_label, status, code) => {
    const server = makeServer({
      put: (_b, n) => (n === 1
        ? [status, { error: 'Another save for this person landed at the same moment. Try again.', code }]
        : [200, { saved: true, rev: 2 }]),
    });
    renderRunner(server);
    await heading(Q1);
    await answerRating('4 of 5');
    expect(await screen.findByText('Not saved – retrying')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /The survey is closed/ })).toBeNull();
    await waitFor(() => expect(server.puts).toHaveLength(2), { timeout: 3000 });
    expect(server.puts[1]).toMatchObject({ qid: Q1.qid, value: 4 });
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: /The survey is closed/ })).toBeNull();
    expect(screen.getByRole('heading', { name: Q1.title })).toBeInTheDocument();
  });

  test('a save refused as NOT_OPEN keeps the answer and keeps trying — it is not closed', async () => {
    const server = makeServer({
      put: (_b, n) => (n === 1
        ? [409, { error: 'This survey is not open yet.', code: 'NOT_OPEN', state: 'CREATED' }]
        : [200, { saved: true, rev: 1 }]),
    });
    renderRunner(server);
    await heading(Q1);
    await answerRating('3 of 5');
    expect(await screen.findByText('Not saved – retrying')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /The survey is closed/ })).toBeNull();
    await waitFor(() => expect(server.puts).toHaveLength(2), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  /*
    THE CAUSE OF THE CONFLICTS, REMOVED. Every answer is a conditional write
    of the SAME row (one row per person), so two PUTs from one phone race each
    other for the lock. One save in flight per PHONE, later ones queued with
    the latest value per question winning, means this phone never fights
    itself.
  */
  test('rapid answers to three questions never put two PUTs on the wire at once', async () => {
    const server = makeServer({
      put: () => new Promise((resolve) => { setTimeout(() => resolve([200, { saved: true }]), 25); }),
    });
    renderRunner(server);
    await heading(Q1);
    await answerRating('4 of 5');
    fireEvent.click(primary());
    await heading(Q2);
    await answerRating('8 of 10');
    fireEvent.click(primary());
    await heading(Q3);
    fireEvent.click(screen.getByRole('radio', { name: /Case studies/ }));
    await waitFor(() => expect(server.puts).toHaveLength(3), { timeout: 2000 });
    expect(server.maxPutsOpen).toBe(1);
    expect(server.puts.map((b) => [b.qid, b.value])).toEqual([[Q1.qid, 4], [Q2.qid, 8], [Q3.qid, [1]]]);
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  test('queued behind a slow save, a question changed twice sends only its latest value', async () => {
    let release;
    const server = makeServer({
      put: (_b, n) => (n === 1
        ? new Promise((resolve) => { release = () => resolve([200, { saved: true }]); })
        : [200, { saved: true }]),
    });
    renderRunner(server);
    await heading(Q1);
    await answerRating('4 of 5');
    await waitFor(() => expect(server.puts).toHaveLength(1));
    fireEvent.click(primary());
    await heading(Q2);
    await answerRating('6 of 10');
    await answerRating('9 of 10');
    expect(server.puts).toHaveLength(1);
    await act(async () => { release(); });
    await waitFor(() => expect(server.puts).toHaveLength(2));
    expect(server.puts[1]).toMatchObject({ qid: Q2.qid, value: 9 });
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(server.puts).toHaveLength(2);
  });
});

/* ======================================================================= */
describe('coming back to it', () => {
  test('a reload asks for this phone’s own row and resumes at the first unanswered question', async () => {
    const server = makeServer({
      mine: { answers: { [Q1.qid]: 4, [Q2.qid]: 8 }, answered: [Q1.qid, Q2.qid], complete: false, rev: 2 },
    });
    const { container, storage } = renderRunner(server);
    await heading(Q3);
    expect(container.querySelector('.plr-ctx').textContent).toBe('3 of 4');
    // POST, with the identity in the body — never in a URL or a log line.
    expect(server.mines).toEqual([{ respondentId: storage.data.get(RESP_KEY) }]);
    const mineCall = server.fetchFn.mock.calls.find(([u]) => String(u).endsWith('/survey/mine'));
    expect(mineCall[1].method).toBe('POST');
    expect(String(mineCall[0])).not.toMatch(/r_/);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await heading(Q2);
    expect(screen.getByRole('radio', { name: '8 of 10' })).toHaveAttribute('aria-checked', 'true');
  });

  test('the same respondent id comes back on the same phone', async () => {
    const storage = memoryStorage();
    storage.setItem(RESP_KEY, 'r_AAAAAAAAAAAAAAAAAAAAAA');
    const server = makeServer();
    renderRunner(server, { storage });
    await heading(Q1);
    expect(server.mines[0]).toEqual({ respondentId: 'r_AAAAAAAAAAAAAAAAAAAAAA' });
  });

  // rejects: a respondent keyed by join code alone. Codes are reused, and a
  // phone that answered the last survey on this code would otherwise file
  // this one's answers — and resume its row — under the same id.
  test('a reused join code is a new session: last opening\'s id is not reused', async () => {
    const storage = memoryStorage();
    storage.setItem(RESP_KEY, 'r_AAAAAAAAAAAAAAAAAAAAAA');
    storage.setItem(`surveyResp_${GAME}`, 'r_BBBBBBBBBBBBBBBBBBBBBB');
    const server = makeServer({ openedAt: '2026-10-02T14:30:00.000Z' });
    renderRunner(server, { storage });
    await heading(Q1);
    const used = server.mines[0].respondentId;
    expect(used).toMatch(RESPONDENT);
    expect(used).not.toBe('r_AAAAAAAAAAAAAAAAAAAAAA');
    expect(used).not.toBe('r_BBBBBBBBBBBBBBBBBBBBBB');
    expect(storage.data.get(`surveyResp_${GAME}_2026-10-02T14:30:00.000Z`)).toBe(used);
    await answerRating('4 of 5');
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0].respondentId).toBe(used);
  });

  test('no row yet starts at question 1', async () => {
    const server = makeServer({ mine: null });
    renderRunner(server);
    await heading(Q1);
  });

  test('a row already sent opens on the sent screen', async () => {
    const server = makeServer({
      mine: { answers: { [Q1.qid]: 4, [Q3.qid]: [1] }, answered: [Q1.qid, Q3.qid], complete: true, rev: 4 },
    });
    renderRunner(server);
    expect(await screen.findByRole('heading', { name: 'Thanks, Ada — that’s everything.' })).toBeInTheDocument();
  });

  test('before the host opens it, a waiting screen — and it loads when the survey opens', async () => {
    const server = makeServer({ state: 'CREATED' });
    const { rerender } = renderRunner(server, { state: 'CREATED' });
    expect(await screen.findByText(/opens when your host is ready/i)).toBeInTheDocument();
    server.state = 'SURVEY#OPEN';
    rerender(
      <SurveyRunner gameId={GAME} playerName="Ada" apiBase={API} fetchFn={server.fetchFn} state="SURVEY#OPEN" storage={memoryStorage()} />,
    );
    await heading(Q1);
  });
});

/* ======================================================================= */
describe('checking and sending', () => {
  async function reachReview(server) {
    renderRunner(server);
    await heading(Q2);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await heading(Q3);
    fireEvent.click(primary());
    await heading(Q4);
    fireEvent.click(primary());
    return screen.findByRole('heading', { name: 'Check your answers' });
  }
  const threeOfFour = () => makeServer({
    mine: { answers: { [Q1.qid]: 4, [Q3.qid]: [1], [Q4.qid]: 'The live demo' }, answered: [Q1.qid, Q3.qid, Q4.qid], complete: false, rev: 3 },
  });

  test('the review lists every question, the skipped optional as skipped', async () => {
    const server = threeOfFour();
    await reachReview(server);
    const list = screen.getByRole('list', { name: 'Your answers' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent(Q1.title);
    expect(rows[0]).toHaveTextContent('4 out of 5');
    expect(rows[1]).toHaveTextContent(Q2.title);
    expect(rows[1]).toHaveTextContent('Skipped — optional');
    expect(within(rows[1]).getByRole('button', { name: 'Answer question 2' })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('Case studies');
    expect(within(rows[2]).getByRole('button', { name: 'Change question 3' })).toBeInTheDocument();
    expect(rows[3]).toHaveTextContent('“The live demo”');
    expect(screen.getByText(/One was optional and you skipped it/)).toBeInTheDocument();
    expect(screen.getByText(/Anything can change until your host closes the survey/)).toBeInTheDocument();
  });

  test('Answer on a skipped row goes to that question, and comes back to the list', async () => {
    const server = threeOfFour();
    await reachReview(server);
    fireEvent.click(screen.getByRole('button', { name: 'Answer question 2' }));
    await heading(Q2);
    await answerRating('9 of 10');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('heading', { name: 'Check your answers' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('9 out of 10');
  });

  test('Send marks it sent and lands on the rest-volume done screen with no dock', async () => {
    const server = threeOfFour();
    await reachReview(server);
    fireEvent.click(screen.getByRole('button', { name: 'Send my answers' }));
    expect(await screen.findByRole('heading', { name: 'Thanks, Ada — that’s everything.' })).toBeInTheDocument();
    expect(server.submits).toEqual([{ respondentId: expect.stringMatching(RESPONDENT) }]);
    expect(document.querySelector('.plr-dock')).toBeNull();
    expect(document.querySelector('.plr').getAttribute('data-volume')).toBe('rest');
    expect(screen.queryByRole('button', { name: /Send/ })).toBeNull();
    // The way back in is on the page, not in a dock.
    fireEvent.click(screen.getByRole('button', { name: 'Change my answers' }));
    expect(await screen.findByRole('heading', { name: 'Check your answers' })).toBeInTheDocument();
  });

  test('Send in Named carries the player and no respondent id', async () => {
    const server = makeServer({
      names: 'named',
      mine: { answers: { [Q1.qid]: 4, [Q3.qid]: [1], [Q4.qid]: 'x' }, answered: [], complete: false, rev: 3 },
    });
    const storage = memoryStorage();
    renderRunner(server, { storage });
    await heading(Q2);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    fireEvent.click(primary());
    fireEvent.click(primary());
    fireEvent.click(await screen.findByRole('button', { name: 'Send my answers' }));
    await screen.findByRole('heading', { name: 'Thanks, Ada — that’s everything.' });
    expect(server.submits).toEqual([{ player: { name: 'Ada', clientId: storage.data.get(`playerClient_${GAME}`) } }]);
  });

  test('a words answer still being typed is saved before the send goes', async () => {
    const server = threeOfFour();
    renderRunner(server);
    await heading(Q2);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    fireEvent.click(primary());
    await heading(Q4);
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Changed my mind' } });
    fireEvent.click(primary());
    fireEvent.click(await screen.findByRole('button', { name: 'Send my answers' }));
    await screen.findByRole('heading', { name: 'Thanks, Ada — that’s everything.' });
    const order = server.fetchFn.mock.calls
      .map(([u, o]) => `${(o && o.method) || 'GET'} ${String(u).replace(API, '')}`)
      .filter((l) => /survey\/(answers|submit)/.test(l));
    expect(order[order.length - 1]).toBe(`POST games/${GAME}/survey/submit`);
    expect(server.puts.map((b) => b.value)).toContain('Changed my mind');
  });

  test('if the server says a required answer is missing, the phone goes to it and says so', async () => {
    const server = threeOfFour();
    server.submit = () => [422, { error: 'Some required questions have no answer yet.', code: 'MISSING', missing: [Q3.qid] }];
    await reachReview(server);
    fireEvent.click(screen.getByRole('button', { name: 'Send my answers' }));
    await heading(Q3);
    expect(screen.getByText(/needs an answer before you can send/i)).toBeInTheDocument();
  });

  test.each([
    ['503 BUSY', 503, 'BUSY'],
    ['503 CONFLICT', 503, 'CONFLICT'],
    ['409 CONFLICT', 409, 'CONFLICT'],
  ])('a Send refused with %s is tried again, and lands — never the closed screen', async (_l, status, code) => {
    const server = threeOfFour();
    server.submit = () => (server.submits.length === 1
      ? [status, { error: 'Another save for this person landed at the same moment. Try again.', code }]
      : [200, { complete: true }]);
    await reachReview(server);
    fireEvent.click(screen.getByRole('button', { name: 'Send my answers' }));
    expect(await screen.findByRole('heading', { name: 'Thanks, Ada — that’s everything.' }, { timeout: 3000 })).toBeInTheDocument();
    expect(server.submits).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: /The survey is closed/ })).toBeNull();
  });

  test('a Send refused because the survey closed puts the closed screen up', async () => {
    const server = threeOfFour();
    server.submit = () => [409, { error: 'This survey has closed.', code: 'SURVEY_CLOSED', state: 'SURVEY#CLOSED' }];
    await reachReview(server);
    fireEvent.click(screen.getByRole('button', { name: 'Send my answers' }));
    expect(await screen.findByRole('heading', { name: /The survey is closed/ })).toBeInTheDocument();
  });

  test('nothing answered: Send waits, and says what it needs', async () => {
    const server = makeServer({ questions: [Q2, Q4] });
    renderRunner(server);
    await heading(Q2);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await heading(Q4);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByRole('heading', { name: 'Check your answers' });
    const send = screen.getByRole('button', { name: 'Send my answers' });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription('Answer at least one question to send.');
    // Answering one lets it go.
    fireEvent.click(screen.getByRole('button', { name: 'Answer question 1' }));
    await heading(Q2);
    await answerRating('7 of 10');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('heading', { name: 'Check your answers' });
    expect(screen.getByRole('button', { name: 'Send my answers' })).toBeEnabled();
  });

  test('a 422 NOTHING_ANSWERED that arrives anyway is said plainly, and Send stays usable', async () => {
    const server = threeOfFour();
    server.submit = () => [422, { error: 'Nothing has been answered yet.', code: 'NOTHING_ANSWERED', missing: [] }];
    await reachReview(server);
    fireEvent.click(screen.getByRole('button', { name: 'Send my answers' }));
    expect(await screen.findByText('Answer at least one question to send.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Check your answers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send my answers' })).toBeEnabled();
  });
});

/* ======================================================================= */
describe('when the host moves on', () => {
  /*
    THE WARNING COUNTS DOWN FROM WHEN IT WAS GIVEN. It said "Two minutes
    left." whatever the time: a phone that reloaded fifteen minutes after the
    warning read "two minutes" off GET /survey's warnedAt and was told a close
    that had long been due was still two minutes away. Now the minutes are
    worked out from warnedAt (+ the warning's own minutes, two by default)
    against the clock, and past that it says so. A fixed clock: Date.now.
  */
  const WARNED = '2026-09-23T10:20:00.000Z';
  const at = (iso) => jest.spyOn(Date, 'now').mockReturnValue(Date.parse(iso));
  afterEach(() => { jest.restoreAllMocks(); });

  test('the warning is a status banner, and says how long is left', async () => {
    at('2026-09-23T10:20:05.000Z');
    const server = makeServer();
    renderRunner(server, { warning: { minutes: 2, warnedAt: WARNED } });
    await heading(Q1);
    const banner = screen.getByRole('status');
    expect(banner).toHaveClass('plr-banner');
    expect(banner).toHaveTextContent(/Two minutes left/);
  });

  test('a minute and ten seconds in, it says one minute', async () => {
    at('2026-09-23T10:21:10.000Z');
    const server = makeServer();
    renderRunner(server, { warning: { minutes: 2, warnedAt: WARNED } });
    await heading(Q1);
    expect(screen.getByRole('status')).toHaveTextContent(/One minute left/);
  });

  test('the warning\'s own minutes are used when it carries them', async () => {
    at('2026-09-23T10:20:05.000Z');
    const server = makeServer();
    renderRunner(server, { warning: { minutes: 5, warnedAt: WARNED } });
    await heading(Q1);
    expect(screen.getByRole('status')).toHaveTextContent(/Five minutes left/);
  });

  test('a warning given before this phone loaded comes from GET /survey, and is counted from then', async () => {
    at('2026-09-23T10:20:30.000Z');
    const server = makeServer({ warnedAt: WARNED });
    renderRunner(server);
    await heading(Q1);
    expect(screen.getByRole('status')).toHaveTextContent(/Two minutes left/);
  });

  test('a phone that reloads fifteen minutes after the warning is not told "two minutes"', async () => {
    at('2026-09-23T10:35:00.000Z');
    const server = makeServer({ warnedAt: WARNED });
    renderRunner(server);
    await heading(Q1);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/Closing any moment/);
    expect(banner).not.toHaveTextContent(/minutes? left/);
  });

  test('a warning frame with no warnedAt counts from when it arrived', async () => {
    at('2026-09-23T10:20:00.000Z');
    const server = makeServer();
    renderRunner(server, { warning: { minutes: 2, warnedAt: null } });
    await heading(Q1);
    expect(screen.getByRole('status')).toHaveTextContent(/Two minutes left/);
  });

  test('SURVEY#CLOSED puts up the closed screen: nothing to answer, no dock', async () => {
    const server = makeServer();
    const { rerender } = renderRunner(server);
    await heading(Q1);
    await answerRating('4 of 5');
    rerender(
      <SurveyRunner gameId={GAME} playerName="Ada" apiBase={API} fetchFn={server.fetchFn} state="SURVEY#CLOSED" storage={memoryStorage()} warning={{ minutes: 2 }} />,
    );
    expect(await screen.findByRole('heading', { name: /The survey is closed/ })).toBeInTheDocument();
    expect(screen.getByText(/Everything you answered counts/)).toBeInTheDocument();
    expect(document.querySelector('.plr-dock')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    // A closed survey has nothing left two minutes from now.
    expect(screen.queryByText(/Two minutes left/)).toBeNull();
  });

  test('ENDED says goodbye and shows no score', async () => {
    const server = makeServer();
    renderRunner(server, { state: 'ENDED' });
    expect(await screen.findByRole('heading', { name: /Thanks for taking part, Ada/ })).toBeInTheDocument();
    expect(screen.queryByText(/score/i)).toBeNull();
    expect(document.querySelector('.plr-dock')).toBeNull();
  });
});

/* ======================================================================= */
describe('in the player page', () => {
  function pageFetch(server) {
    return jest.fn((url, opts = {}) => {
      const u = String(url);
      const method = opts.method || 'GET';
      if (u.startsWith(`${API}games/${GAME}/survey`)) return server.fetchFn(url, opts);
      if (u === `${API}games/${GAME}/players` && method === 'POST') return reply(200, { success: true, playerName: 'Ada' });
      if (u === `${API}games/${GAME}/state`) return reply(200, { state: server.state, gameType: 'survey' });
      return reply(200, {});
    });
  }

  const handler = (type) => {
    const calls = webSocketClient.onMessage.mock.calls.filter(([t]) => t === type);
    return calls.length ? calls[calls.length - 1][1] : null;
  };

  beforeEach(() => {
    window.localStorage.clear();
    webSocketClient.onMessage.mockClear();
    webSocketClient.offMessage.mockClear();
  });

  async function joinSurvey(server) {
    global.fetch = pageFetch(server);
    const utils = render(<PlayerPage />);
    fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: GAME } });
    fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
    await heading(Q1);
    return utils;
  }

  test('a survey session draws the survey, not the lobby', async () => {
    const server = makeServer();
    await joinSurvey(server);
    expect(screen.queryByText(/Waiting for the game to start/i)).toBeNull();
    expect(document.querySelector('.plr-anon')).not.toBeNull();
  });

  test('surveyClosingSoon raises the warning; surveyClosed closes; gameEnded ends with no score', async () => {
    const server = makeServer();
    await joinSurvey(server);

    // The frame's warnedAt is "now" on this phone's clock.
    const now = new Date().toISOString();
    await act(async () => { handler('surveyClosingSoon')({ gameId: GAME, minutes: 2, warnedAt: now }); });
    // The mocked socket never reports a connection, so the offline banner is up
    // too: find the warning among the status banners rather than assuming one.
    const warning = screen.getAllByRole('status').find((el) => /Two minutes left/.test(el.textContent));
    expect(warning).toHaveClass('plr-banner');

    await act(async () => {
      handler('surveyClosed')({ gameId: GAME, newState: 'SURVEY#CLOSED', n: 3, finished: 2, closedAt: '2026-09-23T10:22:00.000Z' });
    });
    expect(await screen.findByRole('heading', { name: /The survey is closed/ })).toBeInTheDocument();

    await act(async () => { handler('gameEnded')({ gameId: GAME, state: 'ENDED' }); });
    expect(await screen.findByRole('heading', { name: /Thanks for taking part, Ada/ })).toBeInTheDocument();
    expect(screen.queryByText(/Final score/i)).toBeNull();
  });

  test('a stale STARTED from a slow /state cannot pull an open survey back to the lobby', async () => {
    const server = makeServer();
    await joinSurvey(server);
    server.state = 'STARTED';
    await act(async () => { handler('gameStateChanged')({}); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByRole('heading', { name: Q1.title })).toBeInTheDocument();
  });

  test('the survey handlers come off with the socket', async () => {
    const server = makeServer();
    const { unmount } = await joinSurvey(server);
    unmount();
    const off = webSocketClient.offMessage.mock.calls.map(([t]) => t);
    expect(off).toEqual(expect.arrayContaining(['surveyClosingSoon', 'surveyClosed']));
  });

  /*
    NO TYPE IS CLAIMED BEFORE THE SERVER SAYS ONE. PlayerPage defaulted the
    game type to 'call-and-answer', so a phone joining a survey that was already
    open read "Waiting for the game to start. The host will begin the first
    round." — for ~1.9 s on dev — until /state answered. While the type is
    unknown the page now says only that it is loading.
  */
  describe('before /state has said what the session is', () => {
    // A successful join rewrites the URL to carry the code and the name, and
    // the next page would auto-join from it; each test here starts at the form.
    beforeEach(() => { window.history.pushState({}, '', '/play'); });

    /** The page's fetch, with /state held until `answer(body)` is called. */
    function heldState(server, { brief = null } = {}) {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const inner = pageFetch(server);
      global.fetch = jest.fn((url, opts = {}) => {
        const u = String(url);
        if (u === `${API}games/${GAME}/state`) return held.then(({ status, body }) => reply(status, body));
        if (brief && u === `${API}games/${GAME}?role=player`) return reply(200, brief);
        return inner(url, opts);
      });
      return { answer: (body, status = 200) => act(async () => { release({ status, body }); }) };
    }
    async function join() {
      render(<PlayerPage />);
      fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: GAME } });
      fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: 'Ada' } });
      fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
      await screen.findByText(/Loading the session/i);
    }

    test('no lobby sentence while it is unknown; the survey once /state says survey', async () => {
      const server = makeServer();
      const state = heldState(server);
      await join();
      expect(screen.queryByText(/Waiting for the game to start/i)).toBeNull();
      expect(screen.queryByText(/first round/i)).toBeNull();
      expect(screen.queryByText(/your score/i)).toBeNull();
      await state.answer({ state: 'SURVEY#OPEN', gameType: 'survey' });
      await heading(Q1);
      expect(screen.queryByText(/Loading the session/i)).toBeNull();
      expect(screen.queryByText(/Waiting for the game to start/i)).toBeNull();
    });

    // rejects: reading a failed /state's empty body as "call-and-answer" — the
    // same wrong lobby, reached by a flaky network instead of a slow one.
    test('a /state that fails says nothing about the type: still loading, no lobby', async () => {
      const state = heldState(makeServer());
      await join();
      await state.answer({ error: 'Internal Server Error' }, 500);
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(screen.getByText(/Loading the session/i)).toBeInTheDocument();
      expect(screen.queryByText(/Waiting for the game to start/i)).toBeNull();
    });

    // The brief the join screen reads (for its copy) is the server naming the
    // type too — GameType never changes — so a join it already knew about goes
    // straight to the survey instead of waiting on /state.
    test('a survey the join screen already knew about opens without waiting for /state', async () => {
      heldState(makeServer(), { brief: { gameId: GAME, gameType: 'survey', names: 'anonymous' } });
      render(<PlayerPage />);
      fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: GAME } });
      await waitFor(() => expect(document.getElementById('plr-name-help').textContent).toMatch(/^Used to get you back in/));
      fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: 'Ada' } });
      fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
      await heading(Q1);
      expect(screen.queryByText(/Loading the session/i)).toBeNull();
      expect(screen.queryByText(/Waiting for the game to start/i)).toBeNull();
    });

    test('a trivia session gets its lobby exactly as before, once /state says trivia', async () => {
      const state = heldState(makeServer());
      await join();
      await state.answer({ state: 'CREATED', gameType: 'trivia' });
      expect(await screen.findByText('Waiting for the game to start. The host will begin the first round.')).toBeInTheDocument();
      expect(screen.queryByText(/Loading the session/i)).toBeNull();
    });
  });
});
