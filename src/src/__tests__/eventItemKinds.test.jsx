/**
 * PRESENTATIONS, ACTIVITIES AND WHO LEADS AN ITEM — components/EventItemDialog.jsx
 * (04-add-presentation.html; events M1b Task 10, and its slides since 27 Sep
 * 2026 — presentationSlidesDialog.test.jsx drives the upload).
 *
 * The owner: presentations "could be just placeholders", "a custom choice",
 * and "enter the facilitator/speaker/presenter".
 *
 * rejects: a presentation offered a set picker, or not offered its slides; a
 * PDF copy still promised for later; a "look up" behaviour the dialog cannot
 * keep (final review
 * Minor 3 — that is roadmap M3/M5); a leader field on a break; an empty name
 * sent on an add, or held back on an edit (so it could never be cleared); a
 * name longer than the server takes sent at all; an engagement's title that
 * does not say it names the session.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EventItemDialog from '../components/EventItemDialog';

jest.mock('../utils/eventsApi', () => ({
  addItem: jest.fn(),
  updateItem: jest.fn(),
  removeItem: jest.fn(),
}));
const api = require('../utils/eventsApi');

const SETS = [
  { id: 'custq4', scope: 'org', orgId: 'org_nw', name: 'Customer knowledge — Q4', engagementType: 'trivia', activeVersion: 3, questionCount: 10, active: true },
];
const ITEMS = [
  { itemId: 'it_00000001', order: 1, type: 'poll', title: 'Before we start', minutes: 8, description: '', ledBy: '', state: 'planned' },
];
const base = (over = {}) => ({
  code: '5307', mode: 'add', type: 'presentation', items: ITEMS, sets: SETS,
  onClose: jest.fn(), onSaved: jest.fn(), onRemoved: jest.fn(), ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => false);
  api.addItem.mockResolvedValue({ item: {} });
  api.updateItem.mockResolvedValue({ item: {} });
});

describe('a presentation (04)', () => {
  it('is titled, led by its presenter, timed and described, and offers its slides as one PDF', async () => {
    const p = base();
    render(<EventItemDialog {...p} />);
    expect(screen.getByRole('heading', { name: 'Add a presentation' })).toBeInTheDocument();
    expect(screen.queryByTestId('set-row')).toBeNull();
    // 27 Sep 2026: the PDF is no longer "later" — it is the slides, optional.
    expect(screen.queryByText(/comes later/)).toBeNull();
    expect(screen.getByRole('button', { name: /Choose a PDF/ })).toBeInTheDocument();
    expect(screen.getByText(/PowerPoint, Keynote and Google Slides all save as PDF/)).toBeInTheDocument();
    // final review Minor 3: nothing in M1b makes a phone, laptop or tablet say
    // "look up" — that is roadmap M3/M5. The dialog must not promise it.
    expect(screen.queryByText(/says\s+.look up.$/)).toBeNull();
    expect(screen.queryByText(/look up/i)).toBeNull();
    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'The FY27 plan' } });
    fireEvent.change(screen.getByLabelText(/^Presenter/), { target: { value: 'Marcus Oyelaran' } });
    fireEvent.change(screen.getByLabelText('Planned length'), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith('5307', {
      type: 'presentation', title: 'The FY27 plan', description: '', minutes: 35, ledBy: 'Marcus Oyelaran',
    });
  });

  it('with nobody named, the add sends no ledBy at all', async () => {
    const p = base();
    render(<EventItemDialog {...p} />);
    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'The FY27 plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith('5307', { type: 'presentation', title: 'The FY27 plan', description: '', minutes: 15 });
  });
});

describe('an activity', () => {
  it('is headed "Add an activity", led by "Led by", and needs a title', async () => {
    render(<EventItemDialog {...base({ type: 'custom' })} />);
    expect(screen.getByRole('heading', { name: 'Add an activity' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Led by/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give the item a title for the agenda.');
    expect(api.addItem).not.toHaveBeenCalled();
  });

  it('editing sends the name even when it was cleared, so it can be removed', async () => {
    const lunch = { itemId: 'it_0000000c', order: 2, type: 'custom', title: 'Lunch', minutes: 45, description: '', ledBy: 'Dana Whitfield', state: 'planned' };
    const p = base({ mode: 'edit', type: 'custom', item: lunch });
    render(<EventItemDialog {...p} />);
    expect(screen.getByRole('heading', { name: 'Edit activity' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Led by/)).toHaveValue('Dana Whitfield');
    fireEvent.change(screen.getByLabelText(/^Led by/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_0000000c', { title: 'Lunch', description: '', minutes: 45, ledBy: '' });
  });
});

describe('who leads an engagement, and what its title names', () => {
  it('a Facilitator field sits beside the title, and the title says it names the session', () => {
    render(<EventItemDialog {...base({ type: 'trivia' })} />);
    expect(screen.getByLabelText(/^Facilitator/)).toBeInTheDocument();
    expect(screen.getByLabelText('Title on the agenda')).toHaveAccessibleDescription('Also the session’s name on the stage when you start it.');
  });

  it('the name field takes no more than the server keeps (80 characters)', () => {
    render(<EventItemDialog {...base({ type: 'custom' })} />);
    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'Networking' } });
    const field = screen.getByLabelText(/^Led by/);
    expect(field).toHaveAttribute('maxLength', '80');
  });
});

describe('a break is led by nobody', () => {
  it('has no leader field, and its title names no session', () => {
    render(<EventItemDialog {...base({ type: 'break' })} />);
    expect(screen.queryByLabelText(/^(Facilitator|Presenter|Led by)/)).toBeNull();
    expect(screen.queryByText('Also the session’s name on the stage when you start it.')).toBeNull();
  });
});
