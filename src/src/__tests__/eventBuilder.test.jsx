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
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EventBuilder from '../components/EventBuilder';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';

jest.mock('../utils/eventsApi', () => ({
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
const serve = (items = DAY) => api.getEvent.mockResolvedValue({ event: EVENT, items });
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

  it('a row can be dragged to a new place', async () => {
    await mount();
    const rows = screen.getAllByTestId('agenda-row');
    fireEvent.dragStart(rows[0]);
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
});

describe('the add menu (02, 02b)', () => {
  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /add item/i }));
  const item = (name) => screen.getByRole('menuitem', { name: new RegExp(`^${name}`) });

  it('at 8 engagements the kinds are disabled with the reason above them; Break stays open', async () => {
    await mount();
    openMenu();
    const reason = document.getElementById('evb-capwhy');
    expect(reason).toHaveTextContent(rules.CAP_SENTENCES.engagements);
    expect(reason).toHaveTextContent('Breaks can still be added.');
    for (const name of ['Trivia', 'Call & Answer', 'Poll', 'Wavelength']) {
      expect(item(name)).toBeDisabled();
      expect(item(name)).toHaveAttribute('aria-describedby', 'evb-capwhy');
    }
    expect(item('Break')).toBeEnabled();
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

  it('Presentation and Survey are listed, disabled, and say they are coming', async () => {
    serve(DAY.slice(0, 3));
    await mount();
    openMenu();
    expect(item('Presentation')).toBeDisabled();
    expect(item('Presentation')).toHaveTextContent('Coming soon.');
    expect(item('Survey')).toBeDisabled();
    expect(item('Survey')).toHaveTextContent('Coming soon.');
  });

  it('Escape closes the menu', async () => {
    await mount();
    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Edit opens the item\'s own dialog', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit FY27 plan quiz' }));
    expect(screen.getByRole('heading', { name: 'Edit Trivia' })).toBeInTheDocument();
  });

  it('an empty agenda says what to do, and the foot still adds up', async () => {
    serve([]);
    render(<EventBuilder code="5307" sets={[]} />);
    expect(await screen.findByTestId('agenda-empty')).toHaveTextContent('Nothing on the agenda yet.');
    expect(screen.getByTestId('agenda-foot')).toHaveTextContent('Ends 9:00 · 0 min planned · 0 of 16 items');
  });
});
