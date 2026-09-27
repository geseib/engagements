/**
 * EVERY SESSION OPTION ON AN ENGAGEMENT ITEM — components/EventItemDialog.jsx
 * rendering the create dialog's own options (components/SessionOptions.jsx),
 * events M1b Task 11.
 *
 * The owner: "It would also be nice if all of the options that you get when
 * setting up each engagement is avail, and finally there should be a target
 * number of items."
 *
 * rejects: options offered before a set is chosen (nothing to bound the goal
 * by); a category list read from the wrong library; a goal larger than the
 * pinned version sent; an option the format does not have sent; an edit that
 * forgets the item's options; a briefing still being drafted lost to Add; a
 * changed option dropped without asking.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import EventItemDialog from '../components/EventItemDialog';

jest.mock('../utils/eventsApi', () => ({
  addItem: jest.fn(),
  updateItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../utils/sessionSetupApi', () => ({
  listPersonas: jest.fn(async () => [{ personaId: 'coach', name: 'Coach' }]),
  listSetCategories: jest.fn(async () => [{ name: 'Leadership', questionCount: 4 }, { name: 'Ops', questionCount: 6 }]),
}));
const api = require('../utils/eventsApi');
const lists = require('../utils/sessionSetupApi');

const SETS = [
  { id: 'custq4', scope: 'org', orgId: 'org_nw', name: 'Customer knowledge — Q4', engagementType: 'trivia', activeVersion: 3, questionCount: 10, active: true },
  { id: 'salesq1', scope: 'org', orgId: 'org_nw', name: 'Sales pulse — Q1', engagementType: 'trivia', activeVersion: 2, questionCount: 6, active: true },
  { id: 'friction', scope: 'org', orgId: 'org_nw', name: 'Friction finder', engagementType: 'call-and-answer', activeVersion: 5, questionCount: 4, active: true },
  { id: 'kickoff', scope: 'platform', orgId: null, name: 'Kickoff pulse', engagementType: 'survey', activeVersion: 1, questionCount: 5, active: true },
];
const base = (over = {}) => ({
  code: '5307', mode: 'add', type: 'trivia', items: [], sets: SETS,
  onClose: jest.fn(), onSaved: jest.fn(), onRemoved: jest.fn(), ...over,
});
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => false);
  api.addItem.mockResolvedValue({ item: {} });
  api.updateItem.mockResolvedValue({ item: {} });
});

describe('adding an engagement', () => {
  it('offers the options once a set is chosen, reading its categories from its own library at the version about to be pinned', async () => {
    render(<EventItemDialog {...base()} />);
    expect(screen.queryByTestId('item-session-options')).toBeNull();
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    expect(await screen.findByRole('button', { name: /Ops/ })).toBeInTheDocument();
    expect(lists.listSetCategories).toHaveBeenCalledWith('custq4', 'org', 3);
    expect(lists.listPersonas).toHaveBeenCalledWith('trivia');
    expect(screen.getByLabelText('Goal')).toBeInTheDocument();
    expect(screen.getByText('of 10 questions')).toBeInTheDocument();
  });

  // fix round 1: a stale response from a set picked and then un-picked must
  // never overwrite what the LATER pick's own fetch returns.
  it('a category fetch from a set no longer chosen never overwrites the one now chosen', async () => {
    // mockImplementationOnce TWICE, never the persistent mockImplementation —
    // that would leak this pending-promise stand-in into every later test in
    // this file and hang them once the two calls below are made.
    const resolvers = [];
    const standIn = () => new Promise((resolve) => { resolvers.push(resolve); });
    lists.listSetCategories.mockImplementationOnce(standIn).mockImplementationOnce(standIn);
    render(<EventItemDialog {...base()} />);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    fireEvent.click(screen.getByLabelText('Sales pulse — Q1'));
    expect(resolvers).toHaveLength(2);
    // Resolve the LATER pick's fetch first, then the abandoned one's — late.
    await act(async () => { resolvers[1]([{ name: 'FromSales', questionCount: 3 }]); });
    await act(async () => { resolvers[0]([{ name: 'FromCustomer', questionCount: 9 }]); });
    expect(await screen.findByRole('button', { name: /FromSales/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /FromCustomer/ })).toBeNull();
  });

  it('what the host chooses is sent as the item\'s settings, and only the keys trivia has', async () => {
    const p = base();
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    fireEvent.click(await screen.findByRole('button', { name: /Ops/ }));
    await screen.findByRole('option', { name: 'Coach' });
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /shuffle the question order/i }));
    fireEvent.change(screen.getByLabelText("Workie's voice"), { target: { value: 'coach' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith('5307', expect.objectContaining({
      settings: {
        randomizeQuestions: false, categoryIds: ['Ops'], target: 5,
        personaId: 'coach', promptId: '', aiContext: '', eventDetails: '',
      },
    }));
  });

  it('a goal larger than the set stops Add and says why', async () => {
    const p = base();
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    await settle();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This set has 10 questions, so the goal can be 10 at most.');
    expect(api.addItem).not.toHaveBeenCalled();
  });

  it('Call & Answer offers the briefing and anonymous responses', async () => {
    render(<EventItemDialog {...base({ type: 'call-and-answer' })} />);
    fireEvent.click(screen.getByLabelText('Friction finder'));
    await settle();
    expect(screen.getByRole('heading', { name: /Workie’s briefing/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /anonymous responses/i })).toBeChecked();
  });

  it('a survey offers Names and no goal, and sends its Names', async () => {
    const p = base({ type: 'survey' });
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByLabelText('Kickoff pulse'));
    await settle();
    expect(screen.queryByLabelText('Goal')).toBeNull();
    expect(lists.listSetCategories).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Names' })).getAllByRole('radio')[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem.mock.calls[0][1].settings).toEqual({
      names: 'named', personaId: '', promptId: '', aiContext: '', eventDetails: '',
    });
  });
});

describe('editing an engagement', () => {
  const ITEM = {
    itemId: 'it_00000003', order: 1, type: 'trivia', title: 'FY27 plan quiz', minutes: 12, description: '', ledBy: '', state: 'planned',
    setRef: { scope: 'org', orgId: 'org_nw', setId: 'custq4', version: 2 },
    set: { name: 'Customer knowledge — Q4', questionCount: 8, latestVersion: 3, missing: false },
    settings: { randomizeQuestions: true, categoryIds: ['Ops'], target: 4, personaId: 'coach', promptId: '', aiContext: 'Be brief.', eventDetails: '' },
  };

  it('seeds from the item\'s own settings, bounded by the PINNED version, and sends them back', async () => {
    const p = base({ mode: 'edit', item: ITEM });
    render(<EventItemDialog {...p} />);
    await screen.findByRole('button', { name: /Ops/ });
    // fix round 1: v2 is what this item PLAYS — custq4's own activeVersion is
    // 3, and the categories must come from the pin, never the newer version.
    expect(lists.listSetCategories).toHaveBeenCalledWith('custq4', 'org', 2);
    expect(screen.getByLabelText('Goal')).toHaveValue('4');
    expect(screen.getByText('of 8 questions')).toBeInTheDocument();
    expect(screen.getByLabelText('Instructions for Workie')).toHaveValue('Be brief.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', expect.objectContaining({ settings: ITEM.settings }));
  });

  it('a changed option is not dropped without asking', async () => {
    const p = base({ mode: 'edit', item: ITEM });
    render(<EventItemDialog {...p} />);
    await settle();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '6' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]);
    expect(window.confirm).toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
  });

  // fix round 1: toggling a category off and back on is not a change — the
  // sent (and compared) categoryIds are SORTED, not left in toggle order,
  // which would otherwise move a re-added category to the end of the array.
  it('toggling a category off and back on is not a change, and does not reorder what is sent', async () => {
    const BOTH = { ...ITEM, settings: { ...ITEM.settings, categoryIds: ['Leadership', 'Ops'] } };
    const p = base({ mode: 'edit', item: BOTH });
    render(<EventItemDialog {...p} />);
    const leadership = await screen.findByRole('button', { name: /Leadership/ });
    fireEvent.click(leadership); // remove Leadership — left with just Ops
    fireEvent.click(leadership); // add it back — insertion order is now Ops, Leadership
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]);
    expect(window.confirm).not.toHaveBeenCalled(); // sorted, so this reads as unchanged
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', expect.objectContaining({
      settings: expect.objectContaining({ categoryIds: ['Leadership', 'Ops'] }),
    }));
  });

  // fix round 1: an empty list on an edit is not "every category" or a
  // silent voice swap — the item's own choices are kept, said plainly, and
  // sent back unchanged.
  it('a categories or personas fetch that comes back empty keeps the item\'s own choices and says so', async () => {
    lists.listSetCategories.mockResolvedValueOnce([]);
    lists.listPersonas.mockResolvedValueOnce([]);
    const p = base({ mode: 'edit', item: ITEM });
    render(<EventItemDialog {...p} />);
    await settle();
    expect(screen.getByText('This item plays only the categories chosen before; the list could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('This item plays the voice chosen before; the list of voices could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', expect.objectContaining({ settings: ITEM.settings }));
  });

  // fix round 1: neither fetch is anyone's business for an item whose words
  // could not be opened — its options are never shown.
  it('fetches neither list for an item whose words could not be read', async () => {
    const p = base({ mode: 'edit', item: { ...ITEM, decryptFailed: true } });
    render(<EventItemDialog {...p} />);
    await settle();
    expect(lists.listPersonas).not.toHaveBeenCalled();
    expect(lists.listSetCategories).not.toHaveBeenCalled();
  });
});
