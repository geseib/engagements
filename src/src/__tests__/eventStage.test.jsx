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
  sessionExists: jest.fn(async () => true),
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
  await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/host?gameId=4821&event=5307'));
  expect(api.sessionExists).toHaveBeenCalledWith('4821');
  expect(api.runEvent).not.toHaveBeenCalled();
});

/* THE OWNER'S EVENT 9630 (31 Oct 2026): its items' sessions were deleted 7
   days after they ran, and Open/Resume sent the host to a 404 and on to the
   main menu. */
describe('an item whose session expired', () => {
  const ran = [{ ...DAY[0], state: 'done', gameId: '8912' }, DAY[1], DAY[2], { ...DAY[3], state: 'paused', gameId: '1430' }];

  test('Open asks first: a session that is gone marks the row Expired, says why, and does not navigate', async () => {
    api.getEvent.mockResolvedValue(view({}, ran));
    api.sessionExists.mockResolvedValueOnce(false);
    render(<EventStage code={CODE} />);
    fireEvent.click(within(rowOf(await screen.findByText(DAY[0].title).then((el) => el.textContent))).getByRole('button', { name: /^Open/ }));
    const row = await waitFor(() => {
      const r = rowOf(DAY[0].title);
      expect(within(r).getByText('Expired')).toBeInTheDocument();
      return r;
    });
    expect(within(row).queryByRole('button', { name: /^Open/ })).toBeNull();
    expect(within(row).getByRole('button', { name: /^Run .* again/ })).toBeInTheDocument();
    expect(screen.getByText(`${DAY[0].title}: this session’s answers were removed 7 days after it ran. Its report is under Reports if one was saved.`)).toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  test('Resume on a paused item whose session is gone is Expired too, and never resumes', async () => {
    api.getEvent.mockResolvedValue(view({}, ran));
    api.sessionExists.mockResolvedValueOnce(false);
    render(<EventStage code={CODE} />);
    fireEvent.click(within(rowOf(await screen.findByText(DAY[3].title).then((el) => el.textContent))).getByRole('button', { name: /^Resume/ }));
    await waitFor(() => expect(within(rowOf(DAY[3].title)).getByText('Expired')).toBeInTheDocument());
    expect(api.runEvent).not.toHaveBeenCalled();
  });

  test('Run it again prepares a fresh session and goes to its stage', async () => {
    api.getEvent.mockResolvedValue(view({}, ran));
    api.sessionExists.mockResolvedValueOnce(false);
    api.runEvent.mockResolvedValue({ ...view({}, [{ ...ran[0], gameId: '5550' }, ...ran.slice(1)]), gameId: '5550' });
    render(<EventStage code={CODE} />);
    fireEvent.click(within(rowOf(await screen.findByText(DAY[0].title).then((el) => el.textContent))).getByRole('button', { name: /^Open/ }));
    fireEvent.click(await waitFor(() => within(rowOf(DAY[0].title)).getByRole('button', { name: /^Run .* again/ })));
    await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'prepare', DAY[0].itemId));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/host?gameId=5550&event=5307'));
  });

  test('sent back by the host page (?expired=), the board marks the item and says why, and tidies the address', async () => {
    window.history.pushState({}, '', `/host/event/${CODE}?expired=8912`);
    api.getEvent.mockResolvedValue(view({}, ran));
    render(<EventStage code={CODE} />);
    await waitFor(() => expect(within(rowOf(DAY[0].title)).getByText('Expired')).toBeInTheDocument());
    expect(screen.getByText(/this session’s answers were removed 7 days after it ran/)).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(api.sessionExists).not.toHaveBeenCalled();
  });
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
    // The first go-live starts the event, so it asks (owner, 31 Oct 2026).
    const ask = screen.getByRole('dialog', { name: 'Start the event?' });
    expect(api.runEvent).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Start the event' }));
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
  // Nothing has started yet, so bringing everyone here starts the event: it asks.
  const ask = await screen.findByRole('dialog', { name: 'Start the event?' });
  expect(ask).toHaveTextContent(/FY26 in review/);
  expect(api.runEvent).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole('button', { name: 'Start the event' }));
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
  // Everything has run: the dock's step ends it (EXIT offers the same end).
  fireEvent.click(screen.getAllByRole('button', { name: 'End the event' })[0]);
  const confirm = await screen.findByRole('dialog');
  expect(confirm).toHaveTextContent(/nobody new can join/);
  expect(api.runEvent).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole('button', { name: 'End the event' }));
  await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'end-event', undefined));
  expect(await screen.findByText('The day is over')).toBeInTheDocument();
});

/*
  THE GUARD RAILS (owner, 31 Oct 2026): "if i accidentally press space bar it
  starts the event … there is no exit of the event only end event … we really
  need guard rails on if they really want to start or end events."
*/
describe('asking before the room moves, and EXIT', () => {
  const space = () => fireEvent.keyDown(window, { key: ' ' });

  // rejects: one stray SPACE starting the event.
  test('SPACE before anything has started asks, and Not yet leaves everything where it was', async () => {
    api.getEvent.mockResolvedValue(view());
    render(<EventStage code={CODE} />);
    await screen.findByText('Starting soon');
    space();
    const ask = await screen.findByRole('dialog', { name: 'Start the event?' });
    expect(ask).toHaveTextContent(/How well do you know our customers\?/);
    // A second SPACE with the ask open is not a yes.
    space();
    expect(api.runEvent).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Not yet' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.runEvent).not.toHaveBeenCalled();
  });

  // rejects: a preview's SPACE moving the room mid-event, unasked.
  test('mid-event, going live from a preview asks, and says the live item ends', async () => {
    const liveTalk = { ...DAY[1], state: 'live' };
    api.getEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: liveTalk.itemId }, [{ ...DAY[0], state: 'done' }, liveTalk, DAY[2], DAY[3]]));
    render(<EventStage code={CODE} />);
    fireEvent.click(within(rowOf(await screen.findByText('Break').then((el) => el.textContent))).getByRole('button', { name: /^Open/ }));
    await screen.findByText('Preview');
    space();
    const ask = await screen.findByRole('dialog', { name: 'Bring everyone here?' });
    expect(ask).toHaveTextContent(/FY26 in review ends/);
    expect(api.runEvent).not.toHaveBeenCalled();
  });

  // rejects: a guard on the ordinary step — moving on mid-event stays one step.
  test('mid-event, the dock\'s next item goes live straight away', async () => {
    const live = { ...DAY[0], state: 'live', gameId: '4821' };
    api.getEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: live.itemId }, [live, ...DAY.slice(1)]));
    api.runEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: DAY[1].itemId }, [{ ...live, state: 'done' }, { ...DAY[1], state: 'live' }, DAY[2], DAY[3]]));
    render(<EventStage code={CODE} />);
    await screen.findByText('Live now');
    space();
    await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'start', DAY[1].itemId));
    expect(screen.queryByRole('dialog', { name: /Start the event|Bring everyone/ })).toBeNull();
  });

  // rejects: END EVENT as the only way off the stage.
  test('EXIT asks: Leave goes to the console\'s Events and ends nothing', async () => {
    api.getEvent.mockResolvedValue(view({ state: 'LIVE' }, [{ ...DAY[0], state: 'done' }, ...DAY.slice(1)]));
    render(<EventStage code={CODE} />);
    await screen.findByText('Between items');
    expect(screen.queryByRole('button', { name: /END EVENT/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Exit/ }));
    const ask = await screen.findByRole('dialog', { name: 'Leave the stage, or end the event?' });
    expect(ask).toHaveTextContent(/people can still join/);
    fireEvent.click(within(ask).getByRole('button', { name: /^Leave/ }));
    expect(navigateTo).toHaveBeenCalledWith('/admin?section=events');
    expect(api.runEvent).not.toHaveBeenCalled();
  });

  test('EXIT\'s End the event ends it, saying what that does first', async () => {
    api.getEvent.mockResolvedValue(view({ state: 'LIVE' }, [{ ...DAY[0], state: 'done' }, ...DAY.slice(1)]));
    api.runEvent.mockResolvedValue(view({ state: 'ENDED' }, [{ ...DAY[0], state: 'done' }, ...DAY.slice(1)]));
    render(<EventStage code={CODE} />);
    await screen.findByText('Between items');
    fireEvent.click(screen.getByRole('button', { name: /^Exit/ }));
    const ask = await screen.findByRole('dialog', { name: 'Leave the stage, or end the event?' });
    expect(ask).toHaveTextContent(/nobody new can join/);
    fireEvent.click(within(ask).getByRole('button', { name: 'End the event' }));
    await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'end-event', undefined));
  });

  test('Stay closes EXIT\'s ask and changes nothing; an ended event\'s EXIT just leaves', async () => {
    api.getEvent.mockResolvedValue(view());
    const { unmount } = render(<EventStage code={CODE} />);
    await screen.findByText('Starting soon');
    fireEvent.click(screen.getByRole('button', { name: /^Exit/ }));
    const ask = await screen.findByRole('dialog');
    expect(ask).toHaveTextContent(/Nothing has started/);
    fireEvent.click(within(ask).getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(navigateTo).not.toHaveBeenCalled();
    unmount();

    api.getEvent.mockResolvedValue(view({ state: 'ENDED' }, DAY.map((i) => ({ ...i, state: 'done' }))));
    render(<EventStage code={CODE} />);
    await screen.findByText('The day is over');
    fireEvent.click(screen.getByRole('button', { name: /^Exit/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(navigateTo).toHaveBeenCalledWith('/admin?section=events');
  });
});

/*
  WHEN IT GOES, AND RUNNING IT AGAIN (owner, 31 Oct 2026: "resume events should
  be an option as long as its within the ttl timeframes. Do we mark info around
  when events expire").
*/
describe('kept until, and reopening an ended event', () => {
  const later = new Date(Date.now() + 30 * 86400000).toISOString();
  const gone = new Date(Date.now() - 86400000).toISOString();

  test('the board says when the event is kept until', async () => {
    api.getEvent.mockResolvedValue(view({ expiresAt: '2027-01-09T00:00:00.000Z' }));
    render(<EventStage code={CODE} />);
    expect(await screen.findByText(/Kept until Sat 9 Jan 2027/)).toBeInTheDocument();
  });

  test('an ended event still kept offers REOPEN, which asks, says what it does, then reopens', async () => {
    const done = DAY.map((i) => ({ ...i, state: 'done' }));
    api.getEvent.mockResolvedValue(view({ state: 'ENDED', expiresAt: later }, done));
    api.runEvent.mockResolvedValue(view({ state: 'LIVE', expiresAt: later }, done));
    render(<EventStage code={CODE} />);
    await screen.findByText('The day is over');
    fireEvent.click(screen.getByRole('button', { name: 'Reopen the event' }));
    const ask = await screen.findByRole('dialog', { name: 'Reopen the event?' });
    expect(ask).toHaveTextContent(/join again/);
    expect(ask).toHaveTextContent(/What finished stays finished/);
    expect(api.runEvent).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Reopen the event' }));
    await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'reopen-event', undefined));
    expect(await screen.findByText('Between items')).toBeInTheDocument();
  });

  // rejects: a reopen the server will refuse — the ttl is past.
  test('an ended event past its date offers no REOPEN', async () => {
    api.getEvent.mockResolvedValue(view({ state: 'ENDED', expiresAt: gone }, DAY.map((i) => ({ ...i, state: 'done' }))));
    render(<EventStage code={CODE} />);
    await screen.findByText('The day is over');
    expect(screen.queryByRole('button', { name: 'Reopen the event' })).toBeNull();
  });

  test('Not now closes the ask and reopens nothing', async () => {
    api.getEvent.mockResolvedValue(view({ state: 'ENDED', expiresAt: later }, DAY.map((i) => ({ ...i, state: 'done' }))));
    render(<EventStage code={CODE} />);
    await screen.findByText('The day is over');
    fireEvent.click(screen.getByRole('button', { name: 'Reopen the event' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.runEvent).not.toHaveBeenCalled();
  });
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
