/**
 * THE ATTENDEE'S PAGE — components/event/EventAttendeePage.jsx
 * (/play?event=<code>; events M2–M4; docs/design/agenda-redesign p-05a,
 * p-05, p-07, p-09).
 *
 * rejects: a name asked for twice — on a reload, or on moving to the next
 * item; a token kept after the event said it does not know it; a live
 * engagement that does not open by itself, or opens without the attendee's
 * token; a paused item left on the item's screens; "Agenda" that unmounts the
 * live session (answers lost by looking away) — or REMOUNTS it, which joins
 * again, opens a second socket and misses what the room was sent meanwhile
 * (the switch beat → play → agenda → back each did, until 27 Sep 2026);
 * the item's own end screen ("the next item starts by itself") left up after
 * the host ends the whole day; "Not you?" that keeps the old
 * token; an unknown code answered with a name form.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import EventAttendeePage from '../components/event/EventAttendeePage';

jest.mock('../PlayerPage', () => {
  const ReactInner = require('react');
  return function PlayerPageStub({ event }) {
    global.__playerEvent = event;
    // Counts MOUNTS: every mount of the real page joins and opens a socket.
    ReactInner.useEffect(() => { global.__playerMounts += 1; }, []);
    return ReactInner.createElement('div', { 'data-testid': 'player' }, `session ${event && event.gameId}`);
  };
});

jest.mock('../utils/attendeeApi', () => {
  const actual = jest.requireActual('../utils/attendeeApi');
  return {
    ...actual,
    getAgenda: jest.fn(),
    getNow: jest.fn(),
    joinEvent: jest.fn(),
    whoAmI: jest.fn(),
  };
});
const api = require('../utils/attendeeApi');

const CODE = '5307';
const EVENT = {
  code: CODE, title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: '2026-10-09T09:00',
  timeZone: 'Europe/London', endsAt: '10:05', state: 'SCHEDULED', liveItemId: '', rev: 'r0',
};
const item = (n, type, title, extra = {}) => ({
  itemId: `it_0000000${n}`, type, title, description: '', ledBy: '', minutes: 15, at: `9:${n}0`, until: `9:${n}5`, state: 'planned', ...extra,
});
const DAY = [
  item(1, 'survey', 'Before we start', { description: 'Five quick questions.' }),
  item(2, 'presentation', 'FY26 in review', { ledBy: 'Dana Whitfield' }),
  item(3, 'trivia', 'How well do you know our customers?'),
  item(4, 'break', 'Break', { description: 'Coffee on the landing.' }),
];
const agenda = (event = {}, items = DAY) => ({ event: { ...EVENT, ...event }, items });

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  global.__playerEvent = null;
  global.__playerMounts = 0;
  api.getNow.mockResolvedValue({ code: CODE, state: 'SCHEDULED', liveItemId: '', live: null, rev: 'r0' });
});

describe('joining once', () => {
  test('no token: the name step, then the agenda before the day, every item "Not started"', async () => {
    api.getAgenda.mockResolvedValue(agenda());
    api.joinEvent.mockResolvedValue({ token: 'at_0123456789abcdef.tok', attendee: { name: 'Priya Raman' } });
    render(<EventAttendeePage code={CODE} />);

    const name = await screen.findByLabelText('Your name');
    fireEvent.change(name, { target: { value: '  Priya Raman ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join the event' }));

    await screen.findByText('Before we start');
    expect(api.joinEvent).toHaveBeenCalledWith(CODE, 'Priya Raman');
    expect(JSON.parse(window.localStorage.getItem(`engage.event.${CODE}`))).toEqual({
      token: 'at_0123456789abcdef.tok', name: 'Priya Raman',
    });
    expect(screen.getAllByText('Not started')).toHaveLength(3); // the break carries no word
    expect(screen.getByText('Five quick questions.')).toBeInTheDocument();
    expect(screen.getByText('Presentation · Dana Whitfield')).toBeInTheDocument();
  });

  test('a reload with the token goes straight to the agenda: no name asked', async () => {
    window.localStorage.setItem(`engage.event.${CODE}`, JSON.stringify({ token: 'tok', name: 'Priya Raman' }));
    api.getAgenda.mockResolvedValue(agenda());
    api.whoAmI.mockResolvedValue({ attendee: { name: 'Priya Raman' } });
    render(<EventAttendeePage code={CODE} />);

    await screen.findByText('Before we start');
    expect(api.whoAmI).toHaveBeenCalledWith(CODE, 'tok');
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
    expect(screen.getByText(/In as Priya Raman/)).toBeInTheDocument();
  });

  test('a token the event no longer knows is forgotten, and the name is asked again', async () => {
    window.localStorage.setItem(`engage.event.${CODE}`, JSON.stringify({ token: 'old', name: 'Priya' }));
    api.getAgenda.mockResolvedValue(agenda());
    api.whoAmI.mockRejectedValue(Object.assign(new Error('You have not joined this event yet.'), { status: 401 }));
    render(<EventAttendeePage code={CODE} />);

    await screen.findByLabelText('Your name');
    expect(window.localStorage.getItem(`engage.event.${CODE}`)).toBeNull();
  });

  test('"Not you?" forgets this browser\'s place and asks for a name', async () => {
    window.localStorage.setItem(`engage.event.${CODE}`, JSON.stringify({ token: 'tok', name: 'Priya' }));
    api.getAgenda.mockResolvedValue(agenda());
    api.whoAmI.mockResolvedValue({ attendee: { name: 'Priya' } });
    render(<EventAttendeePage code={CODE} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Not you?' }));
    await screen.findByLabelText('Your name');
    expect(window.localStorage.getItem(`engage.event.${CODE}`)).toBeNull();
  });

  test('an unknown code says so, and offers a different code rather than a name form', async () => {
    api.getAgenda.mockRejectedValue(Object.assign(new Error('No event has that code.'), { status: 404 }));
    render(<EventAttendeePage code={CODE} />);
    await screen.findByText(`Nothing is running with ${CODE}.`);
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Type a different code' })).toHaveAttribute('href', '/join');
  });
});

describe('following the day', () => {
  const joined = () => window.localStorage.setItem(`engage.event.${CODE}`, JSON.stringify({ token: 'tok', name: 'Priya Raman' }));
  const liveTrivia = { ...DAY[2], state: 'live', gameId: '4821' };

  test('arriving while an engagement is live lands in it, joined by token', async () => {
    joined();
    api.whoAmI.mockResolvedValue({ attendee: { name: 'Priya Raman' } });
    api.getAgenda.mockResolvedValue(agenda({ state: 'LIVE', liveItemId: liveTrivia.itemId }, [DAY[0], DAY[1], liveTrivia, DAY[3]]));
    render(<EventAttendeePage code={CODE} />);

    expect(await screen.findByTestId('player')).toHaveTextContent('session 4821');
    expect(global.__playerEvent).toMatchObject({ code: CODE, token: 'tok', gameId: '4821' });
    expect(typeof global.__playerEvent.onAgenda).toBe('function');
  });

  test('"Agenda" hides the live session without leaving it, and "Back to live" shows it again', async () => {
    joined();
    api.whoAmI.mockResolvedValue({ attendee: { name: 'Priya Raman' } });
    api.getAgenda.mockResolvedValue(agenda({ state: 'LIVE', liveItemId: liveTrivia.itemId }, [DAY[0], DAY[1], liveTrivia, DAY[3]]));
    render(<EventAttendeePage code={CODE} />);
    await screen.findByTestId('player');

    act(() => { global.__playerEvent.onAgenda(); });
    const player = screen.getByTestId('player');
    expect(player.closest('[hidden]')).not.toBeNull();
    expect(screen.getByText('Now')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Back to live/ }));
    expect(screen.getByTestId('player').closest('[hidden]')).toBeNull();
    expect(global.__playerMounts).toBe(1);
  });

  // rejects (QA drive 29 Sep 2026, finding #2): phones listing every item the
  // host had moved on from — a closed survey included — as Paused. Moving on
  // now ends them (run.js stepAside), and the agenda says Done.
  test('items the host moved on from read Done on the agenda — a closed survey too — never Paused', async () => {
    joined();
    api.whoAmI.mockResolvedValue({ attendee: { name: 'Priya Raman' } });
    const closedSurvey = { ...DAY[0], state: 'done', gameId: '3310' };
    const talk = { ...DAY[1], state: 'done' };
    api.getAgenda.mockResolvedValue(agenda({ state: 'LIVE', liveItemId: liveTrivia.itemId }, [closedSurvey, talk, liveTrivia, DAY[3]]));
    render(<EventAttendeePage code={CODE} />);
    await screen.findByTestId('player');

    act(() => { global.__playerEvent.onAgenda(); });
    expect(screen.getAllByText('Done')).toHaveLength(2);
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.queryByText('Paused')).toBeNull();
    const surveyRow = screen.getByText('Before we start').closest('li');
    expect(surveyRow).toHaveTextContent('Done');
    expect(surveyRow.className).toMatch(/evp-it--done/);
  });

  test('the host pauses the item: the paused screen, answers kept, the agenda one tap away', async () => {
    joined();
    api.whoAmI.mockResolvedValue({ attendee: { name: 'Priya Raman' } });
    api.getAgenda.mockResolvedValueOnce(agenda({ state: 'LIVE', liveItemId: liveTrivia.itemId }, [DAY[0], DAY[1], liveTrivia, DAY[3]]));
    render(<EventAttendeePage code={CODE} />);
    await screen.findByTestId('player');

    api.getAgenda.mockResolvedValue(agenda({ state: 'LIVE', liveItemId: '', rev: 'r1' }, [DAY[0], DAY[1], { ...liveTrivia, state: 'paused' }, DAY[3]]));
    await act(async () => { await global.__playerEvent.onFrame('eventItemPaused', { itemId: liveTrivia.itemId }); });

    await screen.findByText('The host will be back.');
    expect(screen.getByRole('button', { name: 'Open the agenda' })).toBeInTheDocument();
    // Still mounted, behind the paused screen: nothing is lost.
    expect(screen.getByTestId('player').closest('[hidden]')).not.toBeNull();
    expect(global.__playerMounts).toBe(1);
  });

  test('when the host starts an item, the page switches by itself after one beat', async () => {
    jest.useFakeTimers();
    try {
      joined();
      api.whoAmI.mockResolvedValue({ attendee: { name: 'Priya Raman' } });
      api.getAgenda.mockResolvedValueOnce(agenda());
      render(<EventAttendeePage code={CODE} />);
      await act(async () => { await Promise.resolve(); });
      await screen.findByText('Before we start');

      api.getNow.mockResolvedValue({ code: CODE, state: 'LIVE', liveItemId: liveTrivia.itemId, live: { itemId: liveTrivia.itemId, type: 'trivia', state: 'live', gameId: '4821' }, rev: 'r1' });
      api.getAgenda.mockResolvedValue(agenda({ state: 'LIVE', liveItemId: liveTrivia.itemId, rev: 'r1' }, [DAY[0], DAY[1], liveTrivia, DAY[3]]));
      await act(async () => { jest.advanceTimersByTime(4100); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });

      expect(await screen.findByText('You’re in as Priya Raman. No code needed.')).toBeInTheDocument();
      await act(async () => { jest.advanceTimersByTime(1300); });
      expect(screen.getByTestId('player').closest('[hidden]')).toBeNull();
      // Mounted under the beat, and the SAME page once the beat lifts.
      expect(global.__playerMounts).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the host ends the day mid-item: the phone shows the day\'s end, not "the next item starts by itself"', async () => {
    joined();
    api.whoAmI.mockResolvedValue({ attendee: { name: 'Priya Raman' } });
    api.getAgenda.mockResolvedValueOnce(agenda({ state: 'LIVE', liveItemId: liveTrivia.itemId }, [DAY[0], DAY[1], liveTrivia, DAY[3]]));
    render(<EventAttendeePage code={CODE} />);
    await screen.findByTestId('player');

    api.getAgenda.mockResolvedValue(agenda({ state: 'ENDED', liveItemId: '', rev: 'r9' }, [DAY[0], DAY[1], { ...liveTrivia, state: 'done' }, DAY[3]]));
    await act(async () => { await global.__playerEvent.onFrame('eventEnded', {}); });

    expect(await screen.findByText('That’s the day.')).toBeInTheDocument();
    // The finished item's screen is not drawn over it (hidden, or let go).
    const player = screen.queryByTestId('player');
    expect(player === null || player.closest('[hidden]') !== null).toBe(true);
  });

  test('a live break says when to be back and what is next', async () => {
    joined();
    api.whoAmI.mockResolvedValue({ attendee: { name: 'Priya Raman' } });
    const brk = { ...DAY[3], state: 'live', endsAt: '2026-10-09T09:28:00.000Z' };
    const after = item(5, 'call-and-answer', 'What slows us down?', { ledBy: 'Sam' });
    api.getAgenda.mockResolvedValue(agenda({ state: 'LIVE', liveItemId: brk.itemId }, [DAY[0], DAY[1], DAY[2], brk, after]));
    render(<EventAttendeePage code={CODE} />);

    await screen.findByText('Back at 10:28');
    expect(screen.getByText(/Coffee on the landing/)).toBeInTheDocument();
    expect(screen.getByText('Call & Answer · What slows us down?')).toBeInTheDocument();
  });
});
