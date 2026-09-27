/**
 * THE BUILDER WITH EVERY KIND — components/EventBuilder.jsx (02, 02b; events
 * M1b Task 12): the add menu with presentations and activities, the 16-item
 * cap said where you add, the rows that name who leads each item and an
 * engagement's goal, and "Use vN" that had to reset a category list.
 *
 * rejects: a counted kind left open at 16 items, or closed without its
 * reason; Break closed by a cap that does not count it; presentations and
 * activities closed by the engagement cap; a row that hides its leader or
 * its goal; a category reset nobody is told about.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
jest.mock('../utils/sessionSetupApi', () => ({
  listPersonas: jest.fn(async () => []),
  listSetCategories: jest.fn(async () => []),
}));
const api = require('../utils/eventsApi');

const EVENT = {
  code: '5307', title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: '2026-10-09T09:00',
  timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 0, engagementCount: 0, breakCount: 0,
  attendeeReports: 'full',
};
const eng = (n, extra = {}) => ({
  itemId: `it_000000${String(n).padStart(2, '0')}`, order: n, type: 'trivia', title: `Quiz ${n}`, description: '', ledBy: '',
  minutes: 10, state: 'planned', setRef: { scope: 'org', orgId: 'org_nw', setId: `set${n}`, version: 2 },
  set: { name: `Set ${n}`, questionCount: 50, latestVersion: 2, missing: false }, ...extra,
});
const talk = (n, extra = {}) => ({
  itemId: `it_000000${String(n).padStart(2, '0')}`, order: n, type: 'presentation', title: `Talk ${n}`, description: '',
  ledBy: '', minutes: 20, state: 'planned', ...extra,
});
const serve = (items) => api.getEvent.mockResolvedValue({ event: EVENT, items });
const mount = async () => {
  render(<EventBuilder code="5307" sets={[]} />);
  await waitFor(() => expect(screen.getAllByTestId('agenda-row').length).toBeGreaterThan(0));
};
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /add item/i }));
const item = (name) => screen.getByRole('menuitem', { name: new RegExp(`^${name}`) });
const lines = () => screen.getAllByTestId('agenda-row').map((r) => (r.querySelector('.evb-sub') || {}).textContent || '');

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => false);
  api.updateItem.mockResolvedValue({ item: {} });
});

describe('the caps, said where you add', () => {
  it('at 16 items every counted kind is closed with the items sentence; Break stays open', async () => {
    serve([...Array.from({ length: 8 }, (_, i) => eng(i + 1)), ...Array.from({ length: 8 }, (_, i) => talk(i + 9))]);
    await mount();
    openMenu();
    const reason = document.getElementById('evb-capwhy');
    expect(reason).toHaveTextContent(rules.CAP_SENTENCES.items);
    expect(reason).toHaveTextContent('Breaks can still be added.');
    for (const name of ['Trivia', 'Survey', 'Presentation', 'Activity']) {
      expect(item(name)).toHaveAttribute('aria-disabled', 'true');
      expect(item(name)).toHaveAttribute('aria-describedby', 'evb-capwhy');
    }
    expect(item('Break')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(item('Presentation'));
    expect(screen.queryByRole('heading', { name: 'Add a presentation' })).toBeNull();
  });

  it('at 8 engagements the note says presentations and activities still fit, and they stay open', async () => {
    serve(Array.from({ length: 8 }, (_, i) => eng(i + 1)));
    await mount();
    openMenu();
    expect(document.getElementById('evb-capwhy')).toHaveTextContent('Presentations and activities still fit.');
    expect(item('Poll')).toHaveAttribute('aria-disabled', 'true');
    expect(item('Presentation')).not.toHaveAttribute('aria-disabled');
    expect(item('Activity')).not.toHaveAttribute('aria-disabled');
  });
});

describe('the rows', () => {
  it('lead with who leads the item, and an engagement says its goal against the pinned size', async () => {
    serve([
      eng(1, { ledBy: 'Priya Raman', settings: { target: 5 } }),
      eng(2),
      talk(3, { ledBy: 'Marcus Oyelaran' }),
      { itemId: 'it_00000004', order: 4, type: 'custom', title: 'Lunch', description: '', ledBy: '', minutes: 45, state: 'planned' },
    ]);
    await mount();
    expect(lines()).toEqual([
      'Priya Raman · Set 1 · v2 · 5 of 50 questions',
      'Set 2 · v2 · 50 questions',
      'Marcus Oyelaran',
      '',
    ]);
    expect(screen.getAllByTestId('agenda-row')[3]).toHaveTextContent('Activity');
  });
});

describe('"Use vN" and the categories', () => {
  it('a version change that reset a narrowed category list says so', async () => {
    serve([eng(1, { setRef: { scope: 'org', orgId: 'org_nw', setId: 'set1', version: 1 }, set: { name: 'Set 1', questionCount: 50, latestVersion: 2, missing: false } })]);
    api.updateItem.mockResolvedValue({ item: {}, categoriesReset: true });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Use v2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('v2 is in use, with every category on. Open the item to narrow them again.');
  });

  it('a goal the new version cannot meet is refused in the server\'s words', async () => {
    serve([eng(1, { setRef: { scope: 'org', orgId: 'org_nw', setId: 'set1', version: 1 }, set: { name: 'Set 1', questionCount: 50, latestVersion: 2, missing: false } })]);
    api.updateItem.mockRejectedValue(Object.assign(
      new Error('Your goal of 40 is more than v2’s 30 questions. Lower the goal, then use v2.'),
      { status: 400, body: { code: 'goal_over' } },
    ));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Use v2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your goal of 40 is more than v2’s 30 questions.');
  });
});
