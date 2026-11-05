/**
 * COMING BACK TO A SESSION THIS BROWSER HOLDS A SEAT IN (dev QA 5 Nov 2026).
 *
 * // rejects: dev QA 5 Nov — returning to /play?code=XXXX in the same browser
 * // showed a blank join form; typing the same name restored the seat. The
 * // page read `?gameId=` only, so a `?code=` link never looked for the seat.
 *
 *   - `/play?code=4821` and `/play?gameId=4821` both find the seat;
 *   - this tab's own seat: "Welcome back, Ada." with Rejoin as Ada;
 *   - only the browser's seat (a new tab): asked, never assumed (the 5 Nov
 *     rule): "Are you Ada?" with Rejoin as Ada / I'm someone else;
 *   - I'm someone else forgets both copies and opens the form;
 *   - a successful join keeps the seat in both copies.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlayerPage from '../PlayerPage';
import { readSeat, saveSeat, forgetSeat, sessionCodeFrom, seatKey } from '../utils/sessionSeat';

const API = window.API_BASE;
const CODE = '4821';

function fetchFor() {
  return jest.fn((url, opts = {}) => {
    const u = String(url);
    const reply = (body, ok = true) => Promise.resolve({
      ok, status: ok ? 200 : 404, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body,
    });
    if (u === `${API}games/${CODE}?role=player`) return reply({ gameId: CODE, gameType: 'call-and-answer' });
    if (u.endsWith('/players') && opts.method === 'POST') return reply({ success: true, playerName: 'Ada', isReconnection: true });
    if (u.includes('/state')) return reply({ state: 'CREATED', gameType: 'call-and-answer' });
    return reply({});
  });
}

const open = (search) => {
  global.fetch = fetchFor();
  window.history.pushState({}, '', `/play${search}`);
  render(<PlayerPage />);
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  global.fetch = jest.fn();
  window.history.pushState({}, '', '/');
});

describe('utils/sessionSeat', () => {
  test('the browser\'s copy is the seat; thisTab when this tab holds the same name', () => {
    expect(readSeat(CODE)).toBeNull();
    window.localStorage.setItem(seatKey(CODE), 'Ada');
    expect(readSeat(CODE)).toEqual({ name: 'Ada', thisTab: false });
    window.sessionStorage.setItem(seatKey(CODE), 'Ada');
    expect(readSeat(CODE)).toEqual({ name: 'Ada', thisTab: true });
    forgetSeat(CODE);
    expect(readSeat(CODE)).toBeNull();
    expect(window.sessionStorage.getItem(seatKey(CODE))).toBeNull();
  });
  test('saveSeat writes both copies', () => {
    saveSeat(CODE, 'Ada');
    expect(window.localStorage.getItem(seatKey(CODE))).toBe('Ada');
    expect(window.sessionStorage.getItem(seatKey(CODE))).toBe('Ada');
  });
  test('the code a /play link carries: ?gameId= as given, ?code= as four digits', () => {
    expect(sessionCodeFrom('?gameId=4821')).toBe('4821');
    expect(sessionCodeFrom('?code=4821')).toBe('4821');
    expect(sessionCodeFrom('?code=48')).toBeNull();
    expect(sessionCodeFrom('')).toBeNull();
  });
});

describe('the page offers the seat instead of a blank form', () => {
  test.each(['?code=4821', '?gameId=4821'])('%s, same tab: "Welcome back, Ada." and Rejoin', async (search) => {
    saveSeat(CODE, 'Ada');
    open(search);
    expect(await screen.findByTestId('rejoin-heading')).toHaveTextContent('Welcome back, Ada.');
    expect(screen.getByRole('button', { name: 'Rejoin as Ada' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Your Name/i)).toBeNull();
  });

  test('a new tab (only the browser holds it): asked as a question, with I\'m someone else', async () => {
    window.localStorage.setItem(seatKey(CODE), 'Ada');
    open('?code=4821');
    expect(await screen.findByTestId('rejoin-heading')).toHaveTextContent('Are you Ada?');
    expect(screen.getByRole('button', { name: 'Rejoin as Ada' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I’m someone else' })).toBeInTheDocument();
    expect(document.querySelector('.plr-lede').textContent).toMatch(/^This browser joined session 4821 as Ada\. If that is you/);
  });

  test('I\'m someone else: both copies forgotten, the form with no name', async () => {
    window.localStorage.setItem(seatKey(CODE), 'Ada');
    open('?code=4821');
    fireEvent.click(await screen.findByRole('button', { name: 'I’m someone else' }));
    expect(readSeat(CODE)).toBeNull();
    expect(await screen.findByPlaceholderText(/Your Name/i)).toHaveValue('');
  });

  test('Rejoin goes back in, and the seat is now this tab\'s too', async () => {
    window.localStorage.setItem(seatKey(CODE), 'Ada');
    open('?code=4821');
    fireEvent.click(await screen.findByRole('button', { name: 'Rejoin as Ada' }));
    await waitFor(() => expect(window.sessionStorage.getItem(seatKey(CODE))).toBe('Ada'));
    expect(readSeat(CODE)).toEqual({ name: 'Ada', thisTab: true });
  });

  test('no seat: the join form, the code from the link', async () => {
    open('?code=4821');
    expect(await screen.findByPlaceholderText(/Your Name/i)).toHaveValue('');
    expect(screen.queryByTestId('rejoin-heading')).toBeNull();
  });
});
