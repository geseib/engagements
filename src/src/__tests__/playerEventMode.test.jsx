/**
 * AN EVENT'S ITEM ON THE PLAYER PAGE — PlayerPage with `event` (events M4),
 * and the bar's Agenda door (PlayerShell + components/event/eventBar.js).
 *
 * rejects: a join form shown inside an event (the attendee joined the day
 * already); a join that sends a typed name instead of the attendee's token;
 * a refused token that strands the attendee instead of sending them back to
 * the event's name step; the event's frames dropped on the floor; an end
 * screen with no way back to the agenda; an Agenda door drawn outside an
 * event; "if you lose this page" pointing at the item's code, which asks for
 * a name and seats a stranger, instead of the event's.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PlayerPage from '../PlayerPage';
import { PlayerShell } from '../components/PlayerShell';
import { EventBarContext } from '../components/event/eventBar';

const handlers = {};
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
    onMessage: jest.fn((type, fn) => { handlers[type] = fn; }),
    offMessage: jest.fn(),
  },
}));

const GAME = '4821';

function serve({ join = { status: 200, body: { success: true, playerName: 'Priya Raman', attendee: true } }, state = 'CREATED' } = {}) {
  global.fetch.mockImplementation((url, options) => {
    const u = String(url);
    const method = (options && options.method) || 'GET';
    if (method === 'POST' && u.includes(`games/${GAME}/players`)) {
      return Promise.resolve({ ok: join.status < 300, status: join.status, json: async () => join.body });
    }
    if (u.includes(`games/${GAME}/state`)) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ state, gameType: 'trivia', currentQuestion: '001' }) });
    }
    if (u.includes(`games/${GAME}/players`)) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ players: [{ playerName: 'Priya Raman', totalScore: 30 }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

const eventProps = (extra = {}) => ({
  code: '5307', token: 'at_0123456789abcdef.secret', gameId: GAME,
  onAgenda: jest.fn(), onFrame: jest.fn(), onNotJoined: jest.fn(), ...extra,
});

beforeEach(() => {
  global.fetch.mockClear();
  localStorage.clear();
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  window.history.pushState({}, '', '/play?event=5307');
});

test('joins the item with the attendee\'s token and no form: nothing to type', async () => {
  serve();
  render(<PlayerPage event={eventProps()} />);
  expect(screen.queryByPlaceholderText(/Game ID/i)).not.toBeInTheDocument();

  await waitFor(() => {
    const post = global.fetch.mock.calls.find(([u, o]) => String(u).includes(`games/${GAME}/players`) && o && o.method === 'POST');
    expect(post).toBeTruthy();
    const body = JSON.parse(post[1].body);
    expect(body.attendeeToken).toBe('at_0123456789abcdef.secret');
    expect(body.playerName).toBe('');
  });
  await waitFor(() => expect(localStorage.getItem(`playerName_${GAME}`)).toBe('Priya Raman'));
  // The way back is the EVENT's code (no name asked), never the item's.
  await waitFor(() => expect(document.body.textContent).toMatch(/enter 5307 again/));
  expect(document.body.textContent).not.toMatch(/enter 4821/);
});

test('a token the event does not know sends the attendee back to the event\'s name step', async () => {
  serve({ join: { status: 401, body: { error: 'You have not joined this event yet.', code: 'NOT_JOINED' } } });
  const props = eventProps();
  render(<PlayerPage event={props} />);
  await waitFor(() => expect(props.onNotJoined).toHaveBeenCalled());
});

test('any other refusal is said, with Try again', async () => {
  serve({ join: { status: 403, body: { error: 'Game not started' } } });
  render(<PlayerPage event={eventProps()} />);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

test('the event\'s frames on this session\'s socket are handed to the event\'s page', async () => {
  serve();
  const props = eventProps();
  render(<PlayerPage event={props} />);
  await waitFor(() => expect(handlers.eventItemPaused).toBeDefined());
  act(() => { handlers.eventItemPaused({ itemId: 'it_00000003' }); });
  expect(props.onFrame).toHaveBeenCalledWith('eventItemPaused', { itemId: 'it_00000003' });
});

test('the end screen of an event\'s item offers the way back to the agenda', async () => {
  serve({ state: 'ENDED' });
  const props = eventProps();
  render(<PlayerPage event={props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Back to the agenda' }));
  expect(props.onAgenda).toHaveBeenCalled();
  expect(screen.getByText(/the next item starts here by itself/)).toBeInTheDocument();
});

test('the bar carries "Agenda" inside an event, and nothing outside one', () => {
  const onAgenda = jest.fn();
  const { unmount } = render(<PlayerShell ctx="x">body</PlayerShell>);
  expect(screen.queryByRole('button', { name: 'Agenda' })).not.toBeInTheDocument();
  unmount();
  render(
    <EventBarContext.Provider value={{ onAgenda }}>
      <PlayerShell ctx="x">body</PlayerShell>
    </EventBarContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));
  expect(onAgenda).toHaveBeenCalled();
});
