/**
 * "SET THE RUNNING ORDER" — QA drive 2026-09-29, finding #4
 * (docs/qa/2026-09-29-two-event-drive/README.md; config/runningOrder.js).
 *
 * The order a host chooses ahead of time lives in the item's stage, Session
 * → Questions, below the category switches, and nothing pointed there.
 *
 * rejects: an agenda row for trivia, Call & Answer, poll or wavelength with no
 * door to its running order; that door on a survey, a break, a talk, a
 * finished item or an ended event; an item with no session yet sent to a
 * stage that does not exist instead of being prepared by the board's own
 * Open; the edit dialog linking there without saying that saving afterwards
 * clears the order; a board that opens the item without landing on the
 * running order, or prepares twice on a reload; the Session panel opening on
 * Questions when nobody asked for it, or on Players when they did; a landing
 * that leaves the running order below the category switches.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EventBuilder from '../components/EventBuilder';
import EventItemDialog from '../components/EventItemDialog';
import EventStage from '../components/event/EventStage';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import {
  hasRunningOrder, offersRunningOrder, runningOrderHref, sessionStagePath, readPanelParam, readOrderParam,
} from '../config/runningOrder';

jest.mock('../utils/eventsApi', () => ({
  deleteEvent: jest.fn(),
  getEvent: jest.fn(),
  reorderItems: jest.fn(),
  updateItem: jest.fn(),
  addItem: jest.fn(),
  removeItem: jest.fn(),
  runEvent: jest.fn(),
}));
jest.mock('../utils/sessionSetupApi', () => ({
  listPersonas: jest.fn(async () => []),
  listSetCategories: jest.fn(async () => []),
}));
jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
jest.mock('qrcode.react', () => ({ QRCodeSVG: ({ value }) => <svg data-testid="qr" data-value={value} /> }));
jest.mock('../hooks/useStageFit', () => () => {});

const api = require('../utils/eventsApi');
const { navigateTo } = require('../auth/navigate');

const CODE = '5307';
const EVENT = {
  code: CODE, title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: '2026-10-09T09:00', timeZone: 'Europe/London',
  access: 'open', state: 'SCHEDULED', liveItemId: '', itemCount: 6, engagementCount: 5, breakCount: 1,
};
const row = (n, type, title, extra = {}) => ({
  itemId: `it_0000000${n}`, order: n, type, title, description: '', ledBy: '', minutes: 15, state: 'planned',
  ...(type === 'break' || type === 'presentation' ? {} : {
    setRef: { scope: 'org', orgId: 'org_nw', setId: `set${n}`, version: 1 },
    set: { name: `Set ${n}`, questionCount: 10, latestVersion: 1, missing: false },
  }),
  ...extra,
});
const DAY = [
  row(1, 'trivia', '80s trivia'),
  row(2, 'call-and-answer', 'What slows us down?', { gameId: '4821' }),
  row(3, 'poll', 'Where should Q1 start?'),
  row(4, 'wavelength', 'FY26 in one word'),
  row(5, 'survey', 'How did today go?'),
  row(6, 'break', 'Break'),
  row(7, 'presentation', 'FY26 in review'),
  row(8, 'trivia', 'Already played', { state: 'done', gameId: '4999' }),
];

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => false);
});

describe('the rule (config/runningOrder.js)', () => {
  test('question-based engagements only — never a survey', () => {
    ['trivia', 'call-and-answer', 'poll', 'wavelength'].forEach((t) => expect(hasRunningOrder(t)).toBe(true));
    ['survey', 'break', 'presentation', 'custom', ''].forEach((t) => expect(hasRunningOrder(t)).toBe(false));
  });

  test('not on a finished item, an unreadable one, or in an ended event', () => {
    expect(offersRunningOrder(DAY[0], EVENT)).toBe(true);
    expect(offersRunningOrder(DAY[7], EVENT)).toBe(false);
    expect(offersRunningOrder({ ...DAY[0], decryptFailed: true }, EVENT)).toBe(false);
    expect(offersRunningOrder(DAY[0], { ...EVENT, state: 'ENDED' })).toBe(false);
  });

  test('a session goes straight to its stage on Questions; none yet goes by the board, which prepares it', () => {
    expect(runningOrderHref(CODE, DAY[1])).toBe('/host?gameId=4821&event=5307&panel=questions');
    expect(runningOrderHref(CODE, DAY[0])).toBe('/host/event/5307?order=it_00000001');
    expect(sessionStagePath('4821', CODE)).toBe('/host?gameId=4821&event=5307');
  });

  test('?panel= reads only a panel the page knows, so an absent or odd one is harmless', () => {
    expect(readPanelParam('?gameId=4821&panel=questions')).toBe('questions');
    expect(readPanelParam('?gameId=4821')).toBe('');
    expect(readPanelParam('?panel=settings')).toBe('');
    expect(readPanelParam('')).toBe('');
    expect(readOrderParam('?order=it_00000001')).toBe('it_00000001');
    expect(readOrderParam('?focus=agenda')).toBe('');
  });
});

describe('the agenda builder', () => {
  const mount = async (event = EVENT, items = DAY) => {
    api.getEvent.mockResolvedValue({ event, items });
    render(<EventBuilder code={CODE} sets={[]} />);
    await waitFor(() => expect(screen.getAllByTestId('agenda-row').length).toBeGreaterThan(0));
  };
  const rowNamed = (title) => screen.getAllByTestId('agenda-row').find((r) => r.querySelector('.evb-nm').textContent === title);

  test('each question-based row has "Order", opening its running order in a new tab', async () => {
    await mount();
    const links = screen.getAllByTestId('agenda-running-order');
    expect(links).toHaveLength(4);
    const trivia = within(rowNamed('80s trivia')).getByRole('link', { name: 'Set the running order for 80s trivia' });
    expect(trivia).toHaveTextContent('Order');
    expect(trivia).toHaveAttribute('href', '/host/event/5307?order=it_00000001');
    expect(trivia).toHaveAttribute('target', '_blank');
    expect(within(rowNamed('What slows us down?')).getByTestId('agenda-running-order'))
      .toHaveAttribute('href', '/host?gameId=4821&event=5307&panel=questions');
    ['How did today go?', 'Break', 'FY26 in review', 'Already played'].forEach((title) => {
      expect(within(rowNamed(title)).queryByTestId('agenda-running-order')).toBeNull();
    });
    // Nothing is prepared from the builder itself: the board's Open does it.
    expect(api.runEvent).not.toHaveBeenCalled();
  });

  test('an ended event offers none', async () => {
    await mount({ ...EVENT, state: 'ENDED' });
    expect(screen.queryAllByTestId('agenda-running-order')).toHaveLength(0);
  });
});

describe('the item dialog', () => {
  const base = (over = {}) => ({
    code: CODE, mode: 'edit', type: 'trivia', item: DAY[0], items: DAY, sets: [],
    onClose: jest.fn(), onSaved: jest.fn(), onRemoved: jest.fn(), ...over,
  });

  test('editing a trivia item links to its running order, and says which changes clear it', () => {
    render(<EventItemDialog {...base()} />);
    const door = screen.getByTestId('item-running-order');
    const link = within(door).getByRole('link', { name: /Set the running order/ });
    expect(link).toHaveAttribute('href', '/host/event/5307?order=it_00000001');
    expect(link).toHaveAttribute('target', '_blank');
    expect(door).toHaveTextContent('Session → Questions');
    expect(door).toHaveTextContent(/question set or its session options afterwards starts its preview afresh and clears that order/);
    expect(door).toHaveTextContent(/title, description and length can change any time/);
  });

  test('not on a survey, and an add says where the door will be', () => {
    const { unmount } = render(<EventItemDialog {...base({ type: 'survey', item: DAY[4] })} />);
    expect(screen.queryByTestId('item-running-order')).toBeNull();
    unmount();
    render(<EventItemDialog {...base({ mode: 'add', item: null, type: 'poll' })} />);
    expect(screen.queryByTestId('item-running-order')).toBeNull();
    expect(screen.getByTestId('item-running-order-later')).toHaveTextContent('Order on its row');
  });
});

describe('the event board, arriving with ?order=', () => {
  test('an item with no session is prepared — the same call Open makes — and its stage opens on the running order', async () => {
    window.history.pushState({}, '', `/host/event/${CODE}?order=it_00000001`);
    api.getEvent.mockResolvedValue({ event: EVENT, items: DAY });
    api.runEvent.mockResolvedValue({ event: EVENT, items: [{ ...DAY[0], gameId: '4830' }, ...DAY.slice(1)], gameId: '4830' });
    render(<EventStage code={CODE} />);
    await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'prepare', 'it_00000001'));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/host?gameId=4830&event=5307&panel=questions'));
    expect(api.runEvent).toHaveBeenCalledTimes(1);
    // Taken out of the address: a reload is the board, not a second prepare.
    expect(window.location.search).not.toMatch(/order=/);
  });

  test('an item with a session goes straight there, writing nothing', async () => {
    window.history.pushState({}, '', `/host/event/${CODE}?order=it_00000002`);
    api.getEvent.mockResolvedValue({ event: EVENT, items: DAY });
    render(<EventStage code={CODE} />);
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/host?gameId=4821&event=5307&panel=questions'));
    expect(api.runEvent).not.toHaveBeenCalled();
  });

  test('a survey (no running order) leaves the host on the board', async () => {
    window.history.pushState({}, '', `/host/event/${CODE}?order=it_00000005`);
    api.getEvent.mockResolvedValue({ event: EVENT, items: DAY });
    render(<EventStage code={CODE} />);
    expect(await screen.findByText('How did today go?')).toBeInTheDocument();
    expect(window.location.search).not.toMatch(/order=/);
    expect(api.runEvent).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

describe('the Session panel', () => {
  const categories = [{ name: 'MTV & the Video Age' }, { name: 'Headlines' }];

  test('opens on Players as it always has', () => {
    render(<SessionSetupPanel categories={categories} />);
    expect(screen.getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true');
  });

  test('asked for the running order, it opens on Questions and brings the running order into view', () => {
    const scrolled = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this); };
    try {
      render(<SessionSetupPanel categories={categories} initialTab="questions" focusRunningOrder />);
      expect(screen.getByRole('tab', { name: 'Questions' })).toHaveAttribute('aria-selected', 'true');
      expect(scrolled.length).toBeGreaterThan(0);
      expect(scrolled[0]).toHaveClass('setup-q');
      expect(within(scrolled[0]).getByText('Running order')).toBeInTheDocument();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test('Questions chosen by hand does not jump to the running order', () => {
    const scrolled = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this); };
    try {
      render(<SessionSetupPanel categories={categories} />);
      fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));
      expect(scrolled).toHaveLength(0);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test('an unknown initial tab falls back to Players', () => {
    render(<SessionSetupPanel initialTab="nonsense" />);
    expect(screen.getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true');
  });
});
