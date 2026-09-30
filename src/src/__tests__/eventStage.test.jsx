/**
 * THE EVENT'S STAGE — components/event/EventStage.jsx (/host/event/<code>;
 * events M3, reworked 27 Sep 2026: the agenda is the host's board).
 *
 * rejects: Open moving the phones (it is the host's screen only); Open on an
 * engagement nobody has opened that does not make its preview session first;
 * Go live that does not bring everyone AND the host's screen to the item; a
 * live engagement on arrival that pulls the host off the agenda; a talk's or
 * a break's screen with no way back to the agenda, or no "Bring everyone
 * here" while it is not live; a break with no countdown or no +5 min; a row
 * missing the actions that fit its state; ending the event, or an item from
 * its row, without a confirmation that says what it does; a dock that offers
 * to Resume an earlier item, or the first unplayed row rather than what
 * follows the item live last; a refusal swallowed instead of said;
 * a board that takes more or fewer columns than its height needs, or goes
 * dense while the width still holds full rows; a "Coming up" list that keeps
 * a row its column cannot hold.
 *
 * The fit tests stub the three measurements the fitters read (jsdom lays
 * nothing out) and assert what the fitters decide — never a position. That
 * the decisions fit a real screen was measured in Chromium at 1280×720,
 * 1366×768, 1024×768, 768×1024, 1180×820 and 1920×1080 (27 Sep 2026).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import EventStage from '../components/event/EventStage';

jest.mock('../utils/eventsApi', () => ({
  getEvent: jest.fn(),
  runEvent: jest.fn(),
}));
jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
jest.mock('qrcode.react', () => ({ QRCodeSVG: ({ value }) => <svg data-testid="qr" data-value={value} /> }));
jest.mock('../hooks/useStageFit', () => () => {});

const api = require('../utils/eventsApi');
const { navigateTo } = require('../auth/navigate');

const CODE = '5307';
const EVENT = {
  code: CODE, title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: '2026-10-09T09:00', timeZone: 'Europe/London',
  endsAt: '10:05', state: 'SCHEDULED', liveItemId: '', attendeeCount: 12,
};
const item = (n, type, title, extra = {}) => ({
  itemId: `it_0000000${n}`, order: n, type, title, description: '', ledBy: '', minutes: 15,
  at: `9:${n}0`, until: `9:${n}5`, state: 'planned', ...extra,
});
const DAY = [
  item(1, 'trivia', 'How well do you know our customers?', { description: 'Ten questions.' }),
  item(2, 'presentation', 'FY26 in review', { ledBy: 'Dana Whitfield' }),
  item(3, 'break', 'Break', { description: 'Coffee on the landing.' }),
  item(4, 'call-and-answer', 'What slows us down?'),
];
const view = (event = {}, items = DAY) => ({ event: { ...EVENT, ...event }, items });
const rowOf = (title) => [...document.querySelectorAll('.ag-r')].find((li) => li.querySelector('.ag-r-tt').textContent === title);

beforeEach(() => {
  jest.clearAllMocks();
  window.history.pushState({}, '', `/host/event/${CODE}`);
});

test('the board: every item on one line, with Open, and Go live where it has not started', async () => {
  api.getEvent.mockResolvedValue(view());
  render(<EventStage code={CODE} />);

  expect(await screen.findByText('Starting soon')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
  const trivia = rowOf('How well do you know our customers?');
  expect(within(trivia).getByRole('button', { name: /^Open/ })).toBeInTheDocument();
  expect(within(trivia).getByRole('button', { name: /^Go live/ })).toBeInTheDocument();
  expect(screen.getByText('12 joined')).toBeInTheDocument();
  // The dock's one obvious step: the first item, live.
  expect(screen.getByRole('button', { name: 'Go live: trivia' })).toBeInTheDocument();
});

test('Open on an engagement nobody has opened makes its preview and goes to its stage — nothing else moves', async () => {
  api.getEvent.mockResolvedValue(view());
  api.runEvent.mockResolvedValue({ ...view({}, [{ ...DAY[0], gameId: '4821' }, ...DAY.slice(1)]), gameId: '4821' });
  render(<EventStage code={CODE} />);

  fireEvent.click(within(await screen.findByText('How well do you know our customers?').then((el) => el.closest('li'))).getByRole('button', { name: /^Open/ }));
  await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'prepare', DAY[0].itemId));
  expect(api.runEvent).not.toHaveBeenCalledWith(CODE, 'start', expect.anything());
  await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/host?gameId=4821&event=5307'));
});

test('Open on an engagement that already has a session goes straight to its stage, and writes nothing', async () => {
  api.getEvent.mockResolvedValue(view({}, [{ ...DAY[0], gameId: '4821' }, ...DAY.slice(1)]));
  render(<EventStage code={CODE} />);
  fireEvent.click(within(rowOf(await screen.findByText('How well do you know our customers?').then((el) => el.textContent))).getByRole('button', { name: /^Open/ }));
  expect(navigateTo).toHaveBeenCalledWith('/host?gameId=4821&event=5307');
  expect(api.runEvent).not.toHaveBeenCalled();
});

test('Go live brings everyone: the item starts, the wipe runs, and the host\'s stage follows', async () => {
  api.getEvent.mockResolvedValue(view());
  const live = { ...DAY[0], state: 'live', gameId: '4821' };
  api.runEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: live.itemId }, [live, ...DAY.slice(1)]));
  jest.useFakeTimers();
  try {
    render(<EventStage code={CODE} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(within(rowOf('How well do you know our customers?')).getByRole('button', { name: /^Go live/ }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(api.runEvent).toHaveBeenCalledWith(CODE, 'start', DAY[0].itemId);
    expect(screen.getByRole('status')).toHaveTextContent(/Trivia.*no code needed/);
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(navigateTo).toHaveBeenCalledWith('/host?gameId=4821&event=5307');
  } finally {
    jest.useRealTimers();
  }
});

test('a live engagement on arrival does NOT pull the host off the agenda', async () => {
  const live = { ...DAY[3], state: 'live', gameId: '6120' };
  api.getEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: live.itemId }, [...DAY.slice(0, 3), live]));
  render(<EventStage code={CODE} />);
  expect(await screen.findByText('Live now')).toBeInTheDocument();
  expect(navigateTo).not.toHaveBeenCalled();
  const row = rowOf('What slows us down?');
  expect(within(row).getByRole('button', { name: /^Pause/ })).toBeInTheDocument();
  expect(within(row).getByRole('button', { name: /^End/ })).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: /^Go live/ })).toBeNull();
});

test('Open on a talk shows its screen as a preview — "Bring everyone here", and AGENDA back', async () => {
  api.getEvent.mockResolvedValue(view());
  const liveTalk = { ...DAY[1], state: 'live' };
  api.runEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: liveTalk.itemId }, [DAY[0], liveTalk, DAY[2], DAY[3]]));
  render(<EventStage code={CODE} />);

  fireEvent.click(within(rowOf(await screen.findByText('FY26 in review').then((el) => el.textContent))).getByRole('button', { name: /^Open/ }));
  expect(await screen.findByText('Preview')).toBeInTheDocument();
  expect(screen.getByText('Preview — the phones are not here yet')).toBeInTheDocument();
  expect(api.runEvent).not.toHaveBeenCalled();
  expect(window.location.search).toBe(`?focus=${DAY[1].itemId}`);

  fireEvent.click(screen.getByRole('button', { name: 'Bring everyone here' }));
  await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'start', DAY[1].itemId));
  expect(await screen.findByText('Now presenting')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Back to the agenda/ }));
  expect(await screen.findByText('Live now')).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

test('a live break: its screen counts down to the planned return, with +5 min', async () => {
  const brk = { ...DAY[2], state: 'live', endsAt: new Date(Date.now() + 9 * 60000).toISOString() };
  window.history.pushState({}, '', `/host/event/${CODE}?focus=${brk.itemId}`);
  api.getEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: brk.itemId }, [{ ...DAY[0], state: 'done' }, { ...DAY[1], state: 'done' }, brk, DAY[3]]));
  api.runEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: brk.itemId }, [DAY[0], DAY[1], brk, DAY[3]]));
  render(<EventStage code={CODE} />);

  expect(await screen.findByRole('timer')).toHaveTextContent(/^(8:5\d|9:00)$/);
  fireEvent.click(screen.getByRole('button', { name: '+5 min' }));
  await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'extend', brk.itemId));
  expect(screen.getByRole('button', { name: 'Go live: Call & Answer' })).toBeInTheDocument();
});

test('a paused item offers Resume and End, and a refusal is said', async () => {
  const paused = { ...DAY[0], state: 'paused', gameId: '4821' };
  api.getEvent.mockResolvedValue(view({ state: 'LIVE' }, [paused, ...DAY.slice(1)]));
  api.runEvent.mockRejectedValue(Object.assign(new Error('The survey is still collecting.'), { status: 409 }));
  render(<EventStage code={CODE} />);

  const row = rowOf(await screen.findByText('How well do you know our customers?').then((el) => el.textContent));
  expect(within(row).getByRole('button', { name: /^Resume/ })).toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: /^End/ }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'End it' }));
  await waitFor(() => expect(document.querySelector('.dock .status')).toHaveTextContent('The survey is still collecting.'));
});

// rejects (QA drive 29 Sep 2026, finding #25): End on a row taking effect at
// once, one stray tap from ending an item for the whole room.
test('End on a row asks first, in the page; Keep it changes nothing, End it ends the item', async () => {
  const live = { ...DAY[3], state: 'live', gameId: '6120' };
  api.getEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: live.itemId }, [...DAY.slice(0, 3), live]));
  api.runEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: '' }, [...DAY.slice(0, 3), { ...live, state: 'done' }]));
  const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true);
  try {
    render(<EventStage code={CODE} />);
    await screen.findByText('Live now');
    const row = rowOf('What slows us down?');

    fireEvent.click(within(row).getByRole('button', { name: /^End/ }));
    let dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('End What slows us down?');
    expect(dialog).toHaveTextContent(/cannot be taken live again/);
    expect(api.runEvent).not.toHaveBeenCalled();
    // SPACE does not take the dock's step behind the dialog.
    fireEvent.keyDown(window, { key: ' ' });
    expect(api.runEvent).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.runEvent).not.toHaveBeenCalled();

    fireEvent.click(within(rowOf('What slows us down?')).getByRole('button', { name: /^End/ }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'End it' }));
    await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'end', live.itemId));
    expect(api.runEvent).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.confirm).not.toHaveBeenCalled();
  } finally {
    confirmSpy.mockRestore();
  }
});

// rejects (QA drive 29 Sep 2026, finding #2): the dock suggesting "Resume
// <the opening talk>" after every item had run, and the first unplayed row
// of the day rather than what follows the item the room saw last.
describe('the dock walks the day forward', () => {
  test('the next planned item after the one live last — not a paused one, not an earlier skipped one', async () => {
    const items = [
      { ...DAY[0], state: 'planned' },
      { ...DAY[1], state: 'paused', startedAt: '2026-10-09T09:01:00Z', liveAt: '2026-10-09T09:01:00Z' },
      { ...DAY[2], state: 'done', startedAt: '2026-10-09T09:05:00Z', liveAt: '2026-10-09T09:05:00Z' },
      { ...DAY[3], state: 'planned' },
    ];
    api.getEvent.mockResolvedValue(view({ state: 'LIVE' }, items));
    api.runEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: DAY[3].itemId }, items));
    render(<EventStage code={CODE} />);
    await screen.findByText('Between items');
    expect(screen.getByRole('button', { name: 'Go live: Call & Answer' })).toBeInTheDocument();
    expect(within(document.querySelector('.dock')).queryByRole('button', { name: /Resume/ })).toBeNull();
  });

  test('a resume counts as the most recent: what follows IT comes next', async () => {
    const items = [
      { ...DAY[0], state: 'done', startedAt: '2026-10-09T09:00:00Z', liveAt: '2026-10-09T09:30:00Z' },
      { ...DAY[1], state: 'planned' },
      { ...DAY[2], state: 'done', startedAt: '2026-10-09T09:10:00Z', liveAt: '2026-10-09T09:10:00Z' },
      { ...DAY[3], state: 'planned' },
    ];
    api.getEvent.mockResolvedValue(view({ state: 'LIVE' }, items));
    render(<EventStage code={CODE} />);
    await screen.findByText('Between items');
    expect(screen.getByRole('button', { name: 'Go live: FY26 in review' })).toBeInTheDocument();
  });

  test('while an item is live, the step is the item after it', async () => {
    const live = { ...DAY[1], state: 'live', startedAt: '2026-10-09T09:05:00Z' };
    api.getEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: live.itemId }, [DAY[0], live, DAY[2], DAY[3]]));
    render(<EventStage code={CODE} />);
    await screen.findByText('Live now');
    expect(screen.getByRole('button', { name: 'Go live: the break' })).toBeInTheDocument();
  });

  test('nothing left planned: End the event — never Resume on an earlier paused item', async () => {
    const items = [
      { ...DAY[0], state: 'paused', startedAt: '2026-10-09T09:00:00Z' },
      { ...DAY[1], state: 'done', startedAt: '2026-10-09T09:05:00Z' },
      { ...DAY[2], state: 'done', startedAt: '2026-10-09T09:10:00Z' },
      { ...DAY[3], state: 'done', startedAt: '2026-10-09T09:20:00Z' },
    ];
    api.getEvent.mockResolvedValue(view({ state: 'LIVE' }, items));
    render(<EventStage code={CODE} />);
    await screen.findByText('Between items');
    expect(within(document.querySelector('.dock')).queryByRole('button', { name: /Resume/ })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'End the event' })[0]);
    expect(await screen.findByRole('dialog')).toHaveTextContent(/nobody new can join/);
  });

  test('a live talk\'s "Go live: <next>" is one start: the server ends the talk in the same step', async () => {
    const talk = { ...DAY[1], state: 'live' };
    window.history.pushState({}, '', `/host/event/${CODE}?focus=${talk.itemId}`);
    api.getEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: talk.itemId }, [{ ...DAY[0], state: 'done' }, talk, DAY[2], DAY[3]]));
    const brk = { ...DAY[2], state: 'live', endsAt: new Date(Date.now() + 15 * 60000).toISOString() };
    api.runEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: brk.itemId }, [{ ...DAY[0], state: 'done' }, { ...talk, state: 'done' }, brk, DAY[3]]));
    render(<EventStage code={CODE} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Go live: the break' }));
    await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'start', DAY[2].itemId));
    expect(api.runEvent).toHaveBeenCalledTimes(1);
    expect(api.runEvent).not.toHaveBeenCalledWith(CODE, 'end', expect.anything());
  });
});

test('the join QR opens large for latecomers, and closes', async () => {
  api.getEvent.mockResolvedValue(view());
  render(<EventStage code={CODE} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Show the join QR code' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByTestId('qr')).toHaveAttribute('data-value', expect.stringMatching(/\/play\?event=5307$/));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

// rejects: a run sheet with no times — the event API sends none, and the stage
// printed a field nothing filled (seen in Chromium, 27 Sep 2026).
test('the board works the planned times out itself when the agenda arrives without them', async () => {
  const bare = DAY.map(({ at, until, ...rest }) => rest);
  api.getEvent.mockResolvedValue(view({}, bare));
  render(<EventStage code={CODE} />);
  await screen.findByText('FY26 in review');
  const times = [...document.querySelectorAll('.ag-r-at')].map((n) => n.textContent);
  expect(times).toEqual(['9:00', '9:15', '9:30', '9:45']);
});

// rejects: a host with no way from the stage to the agenda but the console
// (27 Sep 2026: "there is still no way to create an agenda for the host").
test('EDIT AGENDA goes to the agenda on the host\'s side; an ended event goes back to it too', async () => {
  api.getEvent.mockResolvedValue(view());
  const { unmount } = render(<EventStage code={CODE} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit the agenda' }));
  expect(navigateTo).toHaveBeenCalledWith(`/host/event/${CODE}/agenda`);
  unmount();
  navigateTo.mockClear();
  api.getEvent.mockResolvedValue(view({ state: 'ENDED' }, DAY.map((i) => ({ ...i, state: 'done' }))));
  render(<EventStage code={CODE} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Back to the agenda' }));
  expect(navigateTo).toHaveBeenCalledWith(`/host/event/${CODE}/agenda`);
});

test('ending the event asks first, and says what it does', async () => {
  api.getEvent.mockResolvedValue(view({ state: 'LIVE' }, DAY.map((i) => ({ ...i, state: 'done' }))));
  api.runEvent.mockResolvedValue(view({ state: 'ENDED' }, DAY.map((i) => ({ ...i, state: 'done' }))));
  render(<EventStage code={CODE} />);

  await screen.findByText('Between items');
  // Everything has run: the dock's step and END EVENT both end it.
  fireEvent.click(screen.getAllByRole('button', { name: 'End the event' })[0]);
  const confirm = await screen.findByRole('dialog');
  expect(confirm).toHaveTextContent(/nobody new can join/);
  expect(api.runEvent).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole('button', { name: 'End the event' }));
  await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'end-event', undefined));
  expect(await screen.findByText('The day is over')).toBeInTheDocument();
});

/** Stubs clientHeight/clientWidth/offsetHeight/scrollHeight by class name. */
function stubLayout(sizes) {
  const by = (el, table) => {
    const hit = Object.keys(table).find((c) => el.classList && el.classList.contains(c));
    return hit ? table[hit](el) : 0;
  };
  const spies = [
    jest.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function clientHeight() { return by(this, sizes.clientHeight || {}); }),
    jest.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function clientWidth() { return by(this, sizes.clientWidth || {}); }),
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function offsetHeight() { return by(this, sizes.offsetHeight || {}); }),
    jest.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function scrollHeight() { return by(this, sizes.scrollHeight || {}); }),
  ];
  return () => spies.forEach((spy) => spy.mockRestore());
}
const rounds = (n) => Array.from({ length: n }, (_, i) => ({ ...item(1, 'trivia', `Round ${i + 1}`), itemId: `it_${String(i + 1).padStart(8, '0')}`, order: i + 1 }));

test('the board takes the columns its height needs, and full rows while the width holds them', async () => {
  // 461px of board, 55px rows: eight to a column, so nine items take two.
  const restore = stubLayout({
    clientHeight: { 'ag-grid': () => 461 }, clientWidth: { 'ag-grid': () => 1199 }, offsetHeight: { 'ag-r': () => 55 },
  });
  try {
    api.getEvent.mockResolvedValue(view({}, rounds(9)));
    render(<EventStage code={CODE} />);
    await screen.findByText('Round 9');
    const grid = document.querySelector('.ag-grid');
    await waitFor(() => expect(grid.style.getPropertyValue('--ag-cols')).toBe('2'));
    expect(grid.style.getPropertyValue('--ag-rows')).toBe('5');
    expect(grid.hasAttribute('data-dense')).toBe(false);
  } finally {
    restore();
  }
});

test('past the width it goes dense, then narrow, and still takes every column it needs — nothing is cut off', async () => {
  // 800px wide holds one full-row column; eighteen items need three.
  const restore = stubLayout({
    clientHeight: { 'ag-grid': () => 461 }, clientWidth: { 'ag-grid': () => 800 }, offsetHeight: { 'ag-r': () => 55 },
  });
  try {
    api.getEvent.mockResolvedValue(view({}, rounds(18)));
    render(<EventStage code={CODE} />);
    await screen.findByText('Round 18');
    const grid = document.querySelector('.ag-grid');
    await waitFor(() => expect(grid.style.getPropertyValue('--ag-cols')).toBe('3'));
    expect(grid.style.getPropertyValue('--ag-rows')).toBe('6');
    expect(grid.hasAttribute('data-dense')).toBe(true);
    expect(grid.hasAttribute('data-narrow')).toBe(true);
  } finally {
    restore();
  }
});

test('"Coming up" gives up rows to its "and N more" line until the column holds every row whole', async () => {
  // 60px a row in a 400px column: six rows at most, the "more" line included.
  const restore = stubLayout({
    clientHeight: { 'ag-wall': () => 400 },
    scrollHeight: { 'ag-wall': (el) => el.querySelectorAll('li').length * 60 },
  });
  try {
    const day = rounds(10);
    window.history.pushState({}, '', `/host/event/${CODE}?focus=${day[0].itemId}`);
    api.getEvent.mockResolvedValue(view({}, day));
    render(<EventStage code={CODE} />);
    const wall = await screen.findByText('Coming up').then((h) => h.closest('aside'));
    await waitFor(() => expect(wall.querySelectorAll('li')).toHaveLength(6));
    expect(within(wall).getByText(/^and 4 more, until/)).toBeInTheDocument();
  } finally {
    restore();
  }
});
