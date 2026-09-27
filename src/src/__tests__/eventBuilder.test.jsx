/**
 * ONE EVENT'S AGENDA, RENDERED — components/EventBuilder.jsx
 * (docs/design/agenda-redesign/02-builder.html, 02b-cap-reached.html).
 *
 * The fixture is the design's own day (content.py): 9:00, lengths 8, 30, 15,
 * 20, a 15-minute break, 35, 12, 20, 8 — eight engagements, one break,
 * ending 11:43. It is exactly at the engagement cap, which is 02b.
 *
 * rejects: times that do not follow a move; a keyboard reorder that is not
 * saved, or that loses focus; a failed save that leaves the rows moved; "Use
 * v3" offered when no newer version exists, or applied without a click; the
 * cap's kinds disabled with no reason, or the reason at the disabled
 * opacity's mercy; Break closed at the engagement cap; Presentation and Survey
 * offered as if they worked; the foot counting a break.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import EventBuilder from '../components/EventBuilder';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';

jest.mock('../utils/eventsApi', () => ({
  deleteEvent: jest.fn(),
  getEvent: jest.fn(),
  reorderItems: jest.fn(),
  updateItem: jest.fn(),
  addItem: jest.fn(),
  removeItem: jest.fn(),
  createEvent: jest.fn(),
  updateEvent: jest.fn(),
}));
const api = require('../utils/eventsApi');

const EVENT = {
  code: '5307', title: 'Q4 Kickoff', place: 'Harbour Room, 4th floor', startsAt: '2026-10-09T09:00',
  timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 8, engagementCount: 8, breakCount: 1,
  attendeeReports: 'full',
};
const eng = (n, type, title, minutes, setName, version, latest) => ({
  itemId: `it_0000000${n}`, order: n, type, title, description: '', minutes, state: 'planned',
  setRef: { scope: 'org', orgId: 'org_nw', setId: `set${n}`, version },
  set: { name: setName, questionCount: 10, latestVersion: latest, missing: false },
});
const DAY = [
  eng(1, 'poll', 'Before we start', 8, 'Kickoff pulse', 3, 3),
  eng(2, 'wavelength', 'FY26 in one word', 30, 'One word', 1, 1),
  eng(3, 'trivia', 'How well do you know our customers?', 15, 'Customer knowledge — Q4', 2, 3),
  eng(4, 'call-and-answer', 'What’s slowing us down?', 20, 'Friction finder', 5, 5),
  { itemId: 'it_00000005', order: 5, type: 'break', title: 'Break', description: '', minutes: 15, state: 'planned' },
  eng(6, 'poll', 'Where should Q1 start?', 35, 'Q1 priorities', 1, 1),
  eng(7, 'trivia', 'FY27 plan quiz', 12, 'FY27 plan — check-in', 1, 1),
  eng(8, 'call-and-answer', 'What would you change first?', 20, 'First moves', 2, 2),
  eng(9, 'poll', 'How did today go?', 8, 'Day pulse', 4, 4),
];
const times = () => screen.getAllByTestId('agenda-at').map((c) => c.textContent);
const titles = () => screen.getAllByTestId('agenda-row').map((r) => r.querySelector('.evb-nm').textContent);
const serve = (items = DAY, event = EVENT) => api.getEvent.mockResolvedValue({ event, items });
const mount = async (props = {}) => {
  render(<EventBuilder code="5307" sets={[]} {...props} />);
  await waitFor(() => expect(screen.getAllByTestId('agenda-row').length).toBeGreaterThan(0));
};

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => false);
  serve();
  api.reorderItems.mockResolvedValue({ order: [] });
  api.updateItem.mockResolvedValue({ item: {} });
});

describe('the facts and the plan', () => {
  it('says each fact once, the code as the numeral, and hands the title up', async () => {
    const onTitle = jest.fn();
    await mount({ onTitle });
    const facts = screen.getByTestId('event-facts');
    expect(facts).toHaveTextContent('Fri 9 Oct 2026');
    expect(facts).toHaveTextContent('9:00 · Europe/London');
    expect(facts).toHaveTextContent('Harbour Room, 4th floor');
    expect(facts).toHaveTextContent('Anyone with the code');
    expect(facts.querySelector('.evb-code')).toHaveTextContent('5307');
    expect(onTitle).toHaveBeenCalledWith('Q4 Kickoff');
  });

  it('times are the start plus the running total — the design\'s day', async () => {
    await mount();
    expect(times()).toEqual(['9:00', '9:08', '9:38', '9:53', '10:13', '10:28', '11:03', '11:15', '11:35']);
    const foot = screen.getByTestId('agenda-foot');
    expect(foot).toHaveTextContent('Ends 11:43 · 2 h 43 min planned · 8 of 16 items · 8 of 8 engagements');
    expect(foot).toHaveTextContent('the most an event can hold');
    expect(foot).toHaveTextContent('1 break (not counted)');
  });

  it('a break is listed, unnumbered, with its return time', async () => {
    await mount();
    const row = screen.getAllByTestId('agenda-row')[4];
    expect(row).toHaveClass('evb-row--brk');
    expect(row.querySelector('.evb-no')).toHaveTextContent('–');
    expect(row).toHaveTextContent('Back at 10:28 · not counted, not billed');
    expect(screen.getAllByTestId('agenda-row')[5].querySelector('.evb-no')).toHaveTextContent('5');
  });

  it('an engagement says its set, the version it plays and its size', async () => {
    await mount();
    expect(screen.getAllByTestId('agenda-row')[2]).toHaveTextContent('Customer knowledge — Q4 · v2 · 10 questions');
  });
});

describe('reordering', () => {
  it('Alt+↓ on a focused row moves it, re-times the day, saves the order and keeps focus', async () => {
    await mount();
    const row = screen.getAllByTestId('agenda-row')[2];
    row.focus();
    fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true });
    expect(titles().slice(2, 4)).toEqual(['What’s slowing us down?', 'How well do you know our customers?']);
    expect(times().slice(2, 5)).toEqual(['9:38', '9:58', '10:13']);
    await waitFor(() => expect(api.reorderItems).toHaveBeenCalledWith('5307',
      ['it_00000001', 'it_00000002', 'it_00000004', 'it_00000003', 'it_00000005', 'it_00000006', 'it_00000007', 'it_00000008', 'it_00000009']));
    expect(document.activeElement).toBe(screen.getAllByTestId('agenda-row')[3]);
  });

  it('the ↑ and ↓ buttons move a row; the first cannot go up nor the last down', async () => {
    await mount();
    expect(screen.getByRole('button', { name: 'Move Before we start up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move How did today go? down' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move FY26 in one word up' }));
    expect(titles().slice(0, 2)).toEqual(['FY26 in one word', 'Before we start']);
    expect(times().slice(0, 2)).toEqual(['9:00', '9:30']);
    await waitFor(() => expect(api.reorderItems).toHaveBeenCalledTimes(1));
  });

  it('a row can be dragged to a new place, and starts the drag with a dataTransfer payload (Firefox needs it)', async () => {
    await mount();
    const rows = screen.getAllByTestId('agenda-row');
    const dataTransfer = { setData: jest.fn(), effectAllowed: '' };
    fireEvent.dragStart(rows[0], { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'it_00000001');
    expect(dataTransfer.effectAllowed).toBe('move');
    fireEvent.dragOver(rows[2]);
    fireEvent.drop(rows[2]);
    expect(titles().slice(0, 3)).toEqual(['FY26 in one word', 'How well do you know our customers?', 'Before we start']);
    await waitFor(() => expect(api.reorderItems).toHaveBeenCalled());
  });

  it('a refused save puts the rows back and says why', async () => {
    api.reorderItems.mockRejectedValue(Object.assign(new Error('The event changed while you were saving. Nothing was saved; reload it and try again.'), { body: {} }));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Move FY26 in one word up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The event changed while you were saving');
    expect(titles()[0]).toBe('Before we start');
  });

  it('a 409 agenda_changed reloads from the server (not just a local revert) and shows the plain sentence', async () => {
    api.reorderItems.mockRejectedValue(Object.assign(
      new Error('The event changed while you were saving. Nothing was saved; reload it and try again.'),
      { body: { code: 'agenda_changed' } },
    ));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Move FY26 in one word up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The event changed while you were saving');
    await waitFor(() => expect(api.getEvent).toHaveBeenCalledTimes(2));
    expect(titles()[0]).toBe('Before we start');
  });

  it('a second move attempted while a save is pending sends only one request', async () => {
    let resolveReorder;
    api.reorderItems.mockImplementation(() => new Promise((resolve) => { resolveReorder = resolve; }));
    await mount();
    const up = screen.getByRole('button', { name: 'Move How well do you know our customers? up' });
    fireEvent.click(up);
    fireEvent.click(up);
    expect(api.reorderItems).toHaveBeenCalledTimes(1);
    resolveReorder({ order: [] });
    await waitFor(() => expect(api.reorderItems).toHaveBeenCalledTimes(1));
  });
});

describe('the pinned version', () => {
  it('"Use v3" is offered only where a newer version exists, and applies on a click', async () => {
    await mount();
    const offers = screen.getAllByRole('button', { name: /^Use v\d+$/ });
    expect(offers.map((b) => b.textContent)).toEqual(['Use v3']);
    expect(within(screen.getAllByTestId('agenda-row')[2]).getByRole('button', { name: 'Use v3' })).toBe(offers[0]);
    expect(api.updateItem).not.toHaveBeenCalled();
    fireEvent.click(offers[0]);
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', { version: 3 }));
    await waitFor(() => expect(api.getEvent).toHaveBeenCalledTimes(2));
  });

  it('a set that is gone says so on its row', async () => {
    serve([{ ...DAY[0], set: { missing: true, name: null, questionCount: 0, latestVersion: null } }]);
    await mount();
    expect(screen.getByText('This question set is no longer available')).toHaveClass('evb-sub--bad');
  });

  // Final review M1: the count beside "v2" is v2's, which the server now
  // sends (describeSet looks the pin up in versions[]).
  it('the row states the pinned version\'s own count, beside the offer of the newer one', async () => {
    serve([{ ...DAY[2], set: { ...DAY[2].set, questionCount: 7, pinnedMissing: false } }]);
    await mount();
    const row = screen.getAllByTestId('agenda-row')[0];
    expect(row).toHaveTextContent('Customer knowledge — Q4 · v2 · 7 questions');
    expect(within(row).getByRole('button', { name: 'Use v3' })).toBeInTheDocument();
  });

  it('a pinned version that was deleted says so in plain words, and "Use v3" is still offered', async () => {
    serve([{ ...DAY[2], set: { ...DAY[2].set, questionCount: 0, pinnedMissing: true } }]);
    await mount();
    const row = screen.getAllByTestId('agenda-row')[0];
    const line = row.querySelector('.evb-sub');
    expect(line).toHaveTextContent('Customer knowledge — Q4 · v2 is no longer in the set');
    expect(line).toHaveClass('evb-sub--bad');
    expect(row).not.toHaveTextContent('0 questions');
    fireEvent.click(within(row).getByRole('button', { name: 'Use v3' }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', { version: 3 }));
  });

  it('a deleted pin is offered the set\'s current version even when that one is older', async () => {
    // v4 was pinned and later deleted; v2 was promoted back to be the one that plays.
    serve([{ ...DAY[2], setRef: { ...DAY[2].setRef, version: 4 }, set: { ...DAY[2].set, latestVersion: 2, questionCount: 0, pinnedMissing: true } }]);
    await mount();
    const row = screen.getAllByTestId('agenda-row')[0];
    expect(row).toHaveTextContent('v4 is no longer in the set');
    expect(within(row).getByRole('button', { name: 'Use v2' })).toBeInTheDocument();
  });

  it('a failed "Use vN" reloads the agenda and says why (a stale row should not linger)', async () => {
    api.updateItem.mockRejectedValue(new Error('That item has already started.'));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Use v3' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That item has already started.');
    await waitFor(() => expect(api.getEvent).toHaveBeenCalledTimes(2));
  });

  it('"Use vN" disables while its own request is out, so a slow network cannot fire it twice', async () => {
    let resolveUpdate;
    api.updateItem.mockImplementation(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    await mount();
    const useV3 = screen.getByRole('button', { name: 'Use v3' });
    fireEvent.click(useV3);
    expect(useV3).toBeDisabled();
    resolveUpdate({ item: {} });
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
  });

  // rejects: only the pinning row's button looking disabled while a pin is out
  // — a SECOND row's "Use vN", clicked in that window, silently does nothing
  // because savingRef/pinningRef never sees it (Task 14 re-review carry-over).
  it('every row\'s "Use vN" is disabled while any pin request is out, not only the pinning row\'s', async () => {
    let resolveUpdate;
    api.updateItem.mockImplementation(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    serve([
      eng(1, 'poll', 'Before we start', 8, 'Kickoff pulse', 1, 2),
      DAY[2],
    ]);
    await mount();
    const offers = screen.getAllByRole('button', { name: /^Use v\d+$/ });
    expect(offers.map((b) => b.textContent)).toEqual(['Use v2', 'Use v3']);
    fireEvent.click(offers[0]);
    expect(offers[0]).toBeDisabled();
    expect(offers[1]).toBeDisabled();
    resolveUpdate({ item: {} });
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));
  });
});

describe('the add menu (02, 02b)', () => {
  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /add item/i }));
  const item = (name) => screen.getByRole('menuitem', { name: new RegExp(`^${name}`) });

  it('at 8 engagements the kinds are aria-disabled (still focusable) with the reason above them; Break stays open', async () => {
    await mount();
    openMenu();
    const reason = document.getElementById('evb-capwhy');
    expect(reason).toHaveTextContent(rules.CAP_SENTENCES.engagements);
    expect(reason).toHaveTextContent('Breaks can still be added.');
    for (const name of ['Trivia', 'Call & Answer', 'Poll', 'Wavelength']) {
      const btn = item(name);
      expect(btn).toHaveAttribute('aria-disabled', 'true');
      expect(btn).not.toBeDisabled(); // native disabled would drop it from the tab order
      expect(btn).toHaveAttribute('aria-describedby', 'evb-capwhy');
    }
    expect(item('Break')).toBeEnabled();
    expect(item('Break')).not.toHaveAttribute('aria-disabled');
  });

  it('activating an aria-disabled kind does nothing, and the menu stays open', async () => {
    await mount();
    openMenu();
    fireEvent.click(item('Trivia'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add Trivia' })).toBeNull();
  });

  it('below the cap an engagement kind opens its dialog, and the menu closes', async () => {
    serve(DAY.slice(0, 3));
    await mount();
    openMenu();
    expect(document.getElementById('evb-capwhy')).toBeNull();
    fireEvent.click(item('Trivia'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Add Trivia' })).toBeInTheDocument();
  });

  it('Presentation and Survey are listed, aria-disabled, and say they are coming', async () => {
    serve(DAY.slice(0, 3));
    await mount();
    openMenu();
    expect(item('Presentation')).toHaveAttribute('aria-disabled', 'true');
    expect(item('Presentation')).not.toBeDisabled();
    expect(item('Presentation')).toHaveTextContent('Coming soon.');
    expect(item('Survey')).toHaveAttribute('aria-disabled', 'true');
    expect(item('Survey')).not.toBeDisabled();
    expect(item('Survey')).toHaveTextContent('Coming soon.');
  });

  it('Escape closes the menu and sends focus back to Add item (never the page)', async () => {
    await mount();
    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /add item/i }));
  });

  it('Edit opens the item\'s own dialog', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit FY27 plan quiz' }));
    expect(screen.getByRole('heading', { name: 'Edit Trivia' })).toBeInTheDocument();
  });

  it('closing an add dialog opened from the menu returns focus to Add item (never the page)', async () => {
    await mount();
    openMenu();
    fireEvent.click(item('Break'));
    expect(screen.getByRole('heading', { name: 'Add a break' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /add item/i }));
  });

  it('saving an item added from the menu returns focus to Add item', async () => {
    api.addItem.mockResolvedValue({ item: {} });
    await mount();
    openMenu();
    fireEvent.click(item('Break'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /add item/i })));
  });

  // Final review M2: the dialog's items must not stay stale after a refusal.
  it('an item dialog refused with agenda_changed reloads the agenda behind it and stays open', async () => {
    serve(DAY.slice(0, 3));
    api.addItem.mockRejectedValueOnce(Object.assign(
      new Error('The event changed while you were saving. Nothing was saved; reload it and try again.'),
      { status: 409, body: { code: 'agenda_changed' } },
    ));
    await mount();
    openMenu();
    fireEvent.click(item('Break'));
    const reloaded = [{ itemId: 'it_0000000f', order: 1, type: 'break', title: 'Doors open', description: '', minutes: 10, state: 'planned' }, ...DAY.slice(0, 3)];
    serve(reloaded);
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    expect(await screen.findByText('The event changed while you were saving. Nothing was saved; reload it and try again.')).toBeInTheDocument();
    await waitFor(() => expect(api.getEvent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(titles()[0]).toBe('Doors open'));
    expect(screen.getByRole('heading', { name: 'Add a break' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Goes after')).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['At the start', 'Break · Doors open', '1 · Before we start', '2 · FY26 in one word', '3 · How well do you know our customers?']);
  });

  it('removing an item focuses the row that now sits in its place', async () => {
    api.removeItem.mockResolvedValue({ removed: 'it_00000003' });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit How well do you know our customers?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from agenda' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit Trivia' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByTestId('agenda-row')[3]));
  });

  it('removing the last item falls back to focusing Add item', async () => {
    api.removeItem.mockResolvedValue({ removed: 'it_00000009' });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit How did today go?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from agenda' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /add item/i })));
  });

  it('an empty agenda says what to do, and the foot still adds up', async () => {
    serve([]);
    render(<EventBuilder code="5307" sets={[]} />);
    expect(await screen.findByTestId('agenda-empty')).toHaveTextContent('Nothing on the agenda yet.');
    expect(screen.getByTestId('agenda-foot')).toHaveTextContent('Ends 9:00 · 0 min planned · 0 of 16 items');
  });
});

describe('an item that could not be read (final review M4)', () => {
  const UNREADABLE = {
    itemId: 'it_0000000b', order: 2, type: 'poll', title: '', description: '', minutes: 12, state: 'planned',
    decryptFailed: true, setRef: { scope: 'org', orgId: 'org_nw', setId: 'set2', version: 1 },
    set: { name: 'Kickoff pulse', questionCount: 10, latestVersion: 3, missing: false },
  };

  it('says so on its row, keeps its time and length, and offers Remove rather than Edit or "Use vN"', async () => {
    serve([DAY[0], UNREADABLE, DAY[2]]);
    await mount();
    const row = screen.getAllByTestId('agenda-row')[1];
    expect(row.querySelector('.evb-nm')).toHaveTextContent('This item could not be read');
    expect(row.querySelector('.evb-sub--bad')).toHaveTextContent('Its title and description could not be opened.');
    expect(row).toHaveTextContent('12 min');
    expect(times()).toEqual(['9:00', '9:08', '9:20']);
    expect(within(row).queryByRole('button', { name: /^Use v/ })).toBeNull();
    expect(within(row).queryByRole('button', { name: /^Edit/ })).toBeNull();
    expect(within(row).getByRole('button', { name: 'Remove item 2, which could not be read' })).toHaveTextContent('Remove');
  });

  it('Remove opens the one dialog, which removes it after an inline confirm', async () => {
    serve([DAY[0], UNREADABLE, DAY[2]]);
    api.removeItem.mockResolvedValue({ removed: 'it_0000000b' });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 2, which could not be read' }));
    expect(screen.getByRole('heading', { name: 'This item could not be read' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Title on the agenda')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from agenda' }));
    expect(screen.getByTestId('remove-confirm')).toHaveTextContent('Remove this item from the agenda?');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.removeItem).toHaveBeenCalledWith('5307', 'it_0000000b'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'This item could not be read' })).toBeNull());
  });
});

describe('crossing midnight', () => {
  it('a time that wraps past midnight carries a next-day mark, matching the builder\'s clock format', async () => {
    serve([eng(1, 'poll', 'Late night pulse', 45, 'Late pulse', 1, 1)], { ...EVENT, startsAt: '2026-10-09T23:30' });
    await mount();
    expect(times()[0]).toBe('23:30');
    expect(screen.getByTestId('agenda-foot')).toHaveTextContent('Ends 0:15 (+1 day)');
  });
});

describe('edit details (final review M3)', () => {
  const openDetails = () => fireEvent.click(screen.getByRole('button', { name: /edit details/i }));
  const changed = () => Object.assign(
    new Error('The event changed while you were saving. Nothing was saved; reload it and try again.'),
    { status: 409, body: { code: 'agenda_changed' } },
  );

  // rejects: the whole form sent from a tab opened before a co-host's edit,
  // which put back every field that co-host had changed.
  it('sends only what the host changed, so a field a co-host changed meanwhile is not put back', async () => {
    api.updateEvent.mockResolvedValue({ ...EVENT, title: 'Q4 Kickoff, day one' });
    await mount();
    openDetails();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Q4 Kickoff, day one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateEvent).toHaveBeenCalledWith('5307', { title: 'Q4 Kickoff, day one' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Event details' })).toBeNull());
    expect(screen.getByTestId('event-facts')).toHaveTextContent('Fri 9 Oct 2026');
  });

  it('a new start time sends the start; nothing changed sends nothing', async () => {
    api.updateEvent.mockResolvedValue({ ...EVENT, startsAt: '2026-10-09T10:30' });
    await mount();
    openDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Event details' })).toBeNull());
    expect(api.updateEvent).not.toHaveBeenCalled();
    openDetails();
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '10:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateEvent).toHaveBeenCalledWith('5307', { startsAt: '2026-10-09T10:30' }));
  });

  it('agenda_changed: the plain sentence in the dialog, the event reloaded behind it, and the retry sends the change again', async () => {
    api.updateEvent.mockRejectedValueOnce(changed()).mockResolvedValueOnce({ ...EVENT, title: 'Renamed', startsAt: '2026-10-16T09:00' });
    await mount();
    openDetails();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    serve(DAY, { ...EVENT, startsAt: '2026-10-16T09:00' }); // a co-host moved the date meanwhile
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The event changed while you were saving. Nothing was saved; reload it and try again.');
    await waitFor(() => expect(api.getEvent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('event-facts')).toHaveTextContent('Fri 16 Oct 2026'));
    expect(screen.getByLabelText('Name')).toHaveValue('Renamed');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateEvent).toHaveBeenLastCalledWith('5307', { title: 'Renamed' }));
  });
});

describe('deleting the event (final review I1)', () => {
  const startDelete = () => fireEvent.click(screen.getByRole('button', { name: 'Delete event…' }));

  it('asks inline — never a second dialog — saying what goes and that it cannot be undone; Keep it does nothing', async () => {
    const onDeleted = jest.fn();
    await mount({ onDeleted });
    startDelete();
    const confirm = screen.getByTestId('delete-confirm');
    expect(confirm).toHaveTextContent('Delete “Q4 Kickoff”? Its agenda and its join code, 5307, go with it. This cannot be undone.');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByTestId('delete-confirm')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete event…' })).toBeInTheDocument();
    expect(api.deleteEvent).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('Delete event calls deleteEvent and hands the place back to the list', async () => {
    api.deleteEvent.mockResolvedValue({ deleted: '5307' });
    const onDeleted = jest.fn();
    await mount({ onDeleted });
    startDelete();
    fireEvent.click(within(screen.getByTestId('delete-confirm')).getByRole('button', { name: 'Delete event' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('5307'));
    expect(api.deleteEvent).toHaveBeenCalledWith('5307');
  });

  it('a refusal shows the server\'s own sentence where the host acted, and reloads the agenda', async () => {
    api.deleteEvent.mockRejectedValue(Object.assign(
      new Error('This event has an item that has started, so it cannot be deleted.'),
      { status: 409, body: { code: 'not_planned' } },
    ));
    const onDeleted = jest.fn();
    await mount({ onDeleted });
    startDelete();
    fireEvent.click(within(screen.getByTestId('delete-confirm')).getByRole('button', { name: 'Delete event' }));
    const zone = screen.getByTestId('event-delete');
    expect(await within(zone).findByRole('alert')).toHaveTextContent('This event has an item that has started, so it cannot be deleted.');
    await waitFor(() => expect(api.getEvent).toHaveBeenCalledTimes(2));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByTestId('delete-confirm')).toBeNull();
  });

  it('while the delete is out, neither button can fire it again', async () => {
    let resolveDelete;
    api.deleteEvent.mockImplementation(() => new Promise((resolve) => { resolveDelete = resolve; }));
    await mount({ onDeleted: jest.fn() });
    startDelete();
    const go = within(screen.getByTestId('delete-confirm')).getByRole('button', { name: /Delet/ });
    fireEvent.click(go);
    expect(go).toBeDisabled();
    expect(within(screen.getByTestId('delete-confirm')).getByRole('button', { name: 'Keep it' })).toBeDisabled();
    fireEvent.click(go);
    expect(api.deleteEvent).toHaveBeenCalledTimes(1);
    await act(async () => { resolveDelete({ deleted: '5307' }); });
  });
});

describe('who can join', () => {
  it('reads event.access when present, and falls back to "Anyone with the code"', async () => {
    serve(DAY, { ...EVENT, access: undefined });
    await mount();
    expect(screen.getByTestId('event-facts')).toHaveTextContent('Anyone with the code');
  });
});

describe('unmount safety (Fix round 1 #1, round 2 #1)', () => {
  // rejects: a load already in flight when the place is left calling onTitle
  // or touching state after this instance is gone — the caller's onTitle is
  // AdminPage.jsx's own setEventPlace, which does not know or care whether
  // ITS caller (this component) still exists.
  it('a load that resolves after unmount does not call onTitle', async () => {
    let resolveGet;
    api.getEvent.mockImplementation(() => new Promise((resolve) => { resolveGet = resolve; }));
    const onTitle = jest.fn();
    const { unmount } = render(<EventBuilder code="5307" sets={[]} onTitle={onTitle} />);
    expect(screen.getByText('Loading the event…')).toBeInTheDocument();

    unmount();
    resolveGet({ event: EVENT, items: DAY });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(onTitle).not.toHaveBeenCalled();
  });

  /*
    Fix round 2 #1: move() and pinLatest() called load() on a refusal (which
    already no-ops once the instance is gone) and then set the server's error
    message UNCONDITIONALLY — the same gap load() itself used to have.

    Two signals, since `error` itself is internal state with nothing left to
    read once the instance is unmounted (React 18 does not warn on a setState
    call against an unmounted component, so that alone proves nothing):
      - onTitle IS observable — move()/pinLatest()'s catch calls load(), and
        load() calls onTitle on a successful reload. serve()'s default mock
        makes that reload succeed, so onTitle fires here UNLESS load()'s own
        mountedRef guard (Fix round 1 #1) holds through this call path too —
        which round 1 only ever exercised via the mount effect, never via
        move()/pinLatest() calling it from a catch block. This IS genuine
        coverage of that path, even though it does not by itself prove the
        NEW `stillCurrent` check added below.
      - a console.error spy, the most sensitive instrument black-box RTL has
        left for "something about this state update was not clean".
  */
  it('a reorder refusal that resolves after unmount logs nothing, throws nothing, and does not call onTitle', async () => {
    let rejectReorder;
    api.reorderItems.mockImplementation(() => new Promise((_resolve, reject) => { rejectReorder = reject; }));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onTitle = jest.fn();
    const { unmount } = render(<EventBuilder code="5307" sets={[]} onTitle={onTitle} />);
    await waitFor(() => expect(screen.getAllByTestId('agenda-row').length).toBeGreaterThan(0));
    onTitle.mockClear(); // drop the initial load()'s own call, made while still mounted
    fireEvent.click(screen.getByRole('button', { name: 'Move FY26 in one word up' }));
    await waitFor(() => expect(api.reorderItems).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      rejectReorder(new Error('The new order was not saved.'));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(onTitle).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('a pin refusal that resolves after unmount logs nothing, throws nothing, and does not call onTitle', async () => {
    let rejectUpdate;
    api.updateItem.mockImplementation(() => new Promise((_resolve, reject) => { rejectUpdate = reject; }));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onTitle = jest.fn();
    const { unmount } = render(<EventBuilder code="5307" sets={[]} onTitle={onTitle} />);
    await waitFor(() => expect(screen.getAllByTestId('agenda-row').length).toBeGreaterThan(0));
    onTitle.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Use v3' }));
    await waitFor(() => expect(api.updateItem).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      rejectUpdate(new Error('That item has already started.'));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(onTitle).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
