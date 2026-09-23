/**
 * Event Details, on the screen the setup field promises it on.
 *
 * `create-game.js:37` has always stored it as `Details` and `get-game.js:102`
 * has always returned it to participants as `engagementInfo` — and until now
 * `grep engagementInfo src/src` found only the two SEND sites. Nothing rendered
 * it, so the host's help text ("shown to participants when they join") was
 * false for the whole life of the field.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PlayerPage from '../PlayerPage';
import { NAMES_MODES } from '../config/surveyNames';

const API = window.API_BASE;

/** A fetch that answers by URL, so the join path can reach the lobby. */
function routeFetch({ engagementInfo = '', gameOk = true } = {}) {
  return jest.fn((url, opts = {}) => {
    const u = String(url);
    const reply = (body, ok = true) => Promise.resolve({
      ok,
      status: ok ? 200 : 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => body,
    });

    if (u === `${API}games/TEST123?role=player`) {
      return gameOk
        ? reply({ gameId: 'TEST123', gameType: 'call-and-answer', engagementInfo })
        : reply({ error: 'Game not found' }, false);
    }
    if (u.endsWith('/players') && opts.method === 'POST') {
      return reply({ success: true, playerName: 'Ada' });
    }
    if (u.includes('/state')) return reply({ state: 'CREATED', gameType: 'call-and-answer' });
    return reply({});
  });
}

async function joinAs(name = 'Ada') {
  render(<PlayerPage />);
  fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: 'TEST123' } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
  await screen.findByText(/Waiting for the game to start/i);
}

describe('what a participant sees when they join', () => {
  // A successful join writes `playerName_<gameId>`, and the next render would
  // otherwise open on the rejoin prompt rather than the join form.
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { global.fetch = jest.fn(); });

  // rejects: the shipped state, where the host types a session brief, the
  // backend stores it, the API returns it, and no participant ever sees it.
  test('shows the session details the host typed', async () => {
    global.fetch = routeFetch({ engagementInfo: 'Half a day on pricing strategy.' });
    await joinAs();
    expect(await screen.findByText('Half a day on pricing strategy.')).toBeInTheDocument();
  });

  // rejects: an always-rendered card, which would put an empty labelled box on
  // every lobby — the majority case, since the field is optional.
  test('shows nothing at all when the host left it blank', async () => {
    global.fetch = routeFetch({ engagementInfo: '' });
    await joinAs();
    expect(screen.queryByText(/about this session/i)).toBeNull();
  });

  // rejects: letting a failed or 404 lookup take the lobby down with it. The
  // brief is a nicety; being in the room is not.
  test('still reaches the lobby when the lookup fails', async () => {
    global.fetch = routeFetch({ gameOk: false });
    await joinAs();
    expect(screen.getByText(/Waiting for the game to start/i)).toBeInTheDocument();
    expect(screen.queryByText(/about this session/i)).toBeNull();
  });

  // rejects: fetching the host view, which returns the access code
  // (get-game.js:79) to a participant.
  test('asks for the participant view of the game, never the host view', async () => {
    global.fetch = routeFetch({ engagementInfo: 'Anything.' });
    await joinAs();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`${API}games/TEST123?role=player`);
    });
    const hostCalls = global.fetch.mock.calls.filter(([u]) => String(u).includes('role=host'));
    expect(hostCalls).toEqual([]);
  });
});

/*
  A SURVEY'S JOIN SCREENS SAID A GAME'S THINGS. The name field's help promised
  "the scoreboard" and "rounds where the room votes", and the rejoin prompt
  "your answers and your score" — none of which a survey has. The join screen
  now reads the session brief (GET /games/{id}?role=player: `gameType`, and for
  a survey `names`) as soon as it knows a code, and a survey's copy says what
  is true: what the name is for, in the Names value's own words
  (config/surveyNames.js — never retyped). Every other type's copy is
  unchanged, byte for byte.
*/
describe('the join screens speak the session\'s own terms', () => {
  const CODE = '4821';
  const GAME_HELP = 'Used for the scoreboard and to get you back in if you lose this page. On rounds '
    + 'where the room votes, your name is not shown next to your answer until voting closes.';
  const GAME_REJOIN = `This phone joined session ${CODE} as Ada. Rejoining brings your answers and your score back with you.`;
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
  const nameHelp = () => text(document.getElementById('plr-name-help'));
  const briefUrl = `${API}games/${CODE}?role=player`;

  function briefFetch(brief, { ok = true } = {}) {
    return jest.fn((url) => {
      const reply = (body, good = true) => Promise.resolve({
        ok: good, status: good ? 200 : 404, json: async () => body,
      });
      if (String(url) === briefUrl) return ok ? reply({ gameId: CODE, ...brief }) : reply({ error: 'Game not found' }, false);
      return reply({});
    });
  }
  /** The page opened from a join link, as the QR code opens it. */
  function openFromLink(brief, opts) {
    global.fetch = briefFetch(brief, opts);
    window.history.pushState({}, '', `/play?gameId=${CODE}`);
    render(<PlayerPage />);
  }
  /** Let the brief land, however it answered. */
  async function briefLanded() {
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(briefUrl));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  beforeEach(() => { window.localStorage.clear(); window.history.pushState({}, '', '/play'); });
  afterEach(() => { global.fetch = jest.fn(); window.history.pushState({}, '', '/'); });

  // rejects: a survey told its name is for a scoreboard and for voting rounds.
  test.each(NAMES_MODES.map((m) => [m.label, m]))('a survey (%s): what the name is for, in the Names value\'s own words', async (_label, mode) => {
    openFromLink({ gameType: 'survey', names: mode.id });
    const expected = `Used to get you back in if you lose this page. ${mode.phoneLead ? `${mode.phoneLead} ` : ''}${mode.phoneLine}`;
    await waitFor(() => expect(nameHelp()).toBe(expected));
    expect(nameHelp()).not.toMatch(/scoreboard|round|score/i);
  });

  // rejects: guessing a Names value the brief did not carry.
  test('a survey whose brief carries no Names value: neutral, nothing claimed', async () => {
    openFromLink({ gameType: 'survey', names: null });
    await waitFor(() => expect(nameHelp()).toBe('Used to get you back in if you lose this page.'));
  });

  test('a typed four-digit code reads the brief too', async () => {
    global.fetch = briefFetch({ gameType: 'survey', names: 'finished' });
    render(<PlayerPage />);
    expect(nameHelp()).toBe(GAME_HELP);
    fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: CODE } });
    await waitFor(() => expect(nameHelp()).toMatch(/^Used to get you back in if you lose this page\. Your host sees that you finished/));
  });

  // rejects: rewording every type's join screen to fit the survey.
  test.each(['call-and-answer', 'trivia', 'poll', 'wavelength'])('%s keeps its copy, byte for byte', async (gameType) => {
    openFromLink({ gameType, names: null });
    await briefLanded();
    expect(nameHelp()).toBe(GAME_HELP);
    expect(document.querySelector('#plr-name-help b').textContent).toBe('not');
  });

  test('a brief that fails leaves the copy as it was', async () => {
    openFromLink({}, { ok: false });
    await briefLanded();
    expect(nameHelp()).toBe(GAME_HELP);
  });

  describe('the rejoin prompt', () => {
    const rejoinLine = () => text(document.querySelector('.plr-lede'));
    function returnTo(brief) {
      window.localStorage.setItem(`playerName_${CODE}`, 'Ada');
      openFromLink(brief);
    }

    // rejects: promising a survey's respondent their score back.
    test('a survey: your answers come back — no score', async () => {
      returnTo({ gameType: 'survey', names: 'anonymous' });
      await screen.findByRole('button', { name: /Rejoin as Ada/ });
      await waitFor(() => expect(rejoinLine()).toBe(`This phone joined session ${CODE} as Ada. Rejoining brings your answers back with you.`));
      expect(rejoinLine()).not.toMatch(/score/i);
    });

    test.each(['call-and-answer', 'trivia'])('%s keeps its sentence, byte for byte', async (gameType) => {
      returnTo({ gameType, names: null });
      await screen.findByRole('button', { name: /Rejoin as Ada/ });
      await briefLanded();
      expect(rejoinLine()).toBe(GAME_REJOIN);
    });
  });
});
