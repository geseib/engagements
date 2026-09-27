/**
 * ADD AN ENGAGEMENT OR A BREAK, EDIT OR REMOVE AN ITEM —
 * components/EventItemDialog.jsx (docs/design/agenda-redesign/03-add-item.html).
 *
 * rejects: sets of another type offered; a switched-off set offered; the
 * version sent differing from the one shown; a duplicate set added without
 * saying so; "Goes after" ignored; a cap refusal that closes the dialog or
 * drops the choices; a remove with no confirmation, or confirmed in a second
 * modal; a dialog with one exit.
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
  { id: 'fy27', scope: 'org', orgId: 'org_nw', name: 'FY27 plan — check-in', engagementType: 'quiz', activeVersion: 1, questionCount: 8, active: true },
  { id: 'friction', scope: 'org', orgId: 'org_nw', name: 'Friction finder', engagementType: 'call-and-answer', activeVersion: 5, questionCount: 4 },
  { id: 'offq', scope: 'platform', orgId: null, name: 'Switched off', engagementType: 'trivia', activeVersion: 1, active: false },
];
const ITEMS = [
  { itemId: 'it_00000001', order: 1, type: 'poll', title: 'Before we start', minutes: 8, description: '', state: 'planned' },
  { itemId: 'it_00000002', order: 2, type: 'break', title: 'Break', minutes: 15, description: '', state: 'planned' },
  { itemId: 'it_00000003', order: 3, type: 'trivia', title: 'FY27 plan quiz', minutes: 12, description: '', state: 'planned',
    setRef: { scope: 'org', orgId: 'org_nw', setId: 'fy27', version: 1 }, set: { name: 'FY27 plan — check-in', questionCount: 8, latestVersion: 1, missing: false } },
];
const base = (over = {}) => ({
  code: '5307', mode: 'add', type: 'trivia', items: ITEMS, sets: SETS,
  onClose: jest.fn(), onSaved: jest.fn(), onRemoved: jest.fn(), ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => false);
});

describe('adding an engagement', () => {
  it('offers only active sets of the chosen type, older spellings included', () => {
    render(<EventItemDialog {...base()} />);
    expect(screen.getByRole('heading', { name: 'Add Trivia' })).toBeInTheDocument();
    const rows = screen.getAllByTestId('set-row').map((r) => r.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/Customer knowledge — Q4.*v3 · latest.*10/);
    expect(rows[1]).toMatch(/FY27 plan — check-in/);
    expect(screen.queryByText('Friction finder')).toBeNull();
    expect(screen.queryByText('Switched off')).toBeNull();
  });

  it('says when a set is already on the agenda, by the item\'s number', () => {
    render(<EventItemDialog {...base()} />);
    expect(screen.getAllByTestId('set-row')[1]).toHaveTextContent('On this agenda · 2');
  });

  it('picking a set fills an untouched title, and sends the version it shows', async () => {
    api.addItem.mockResolvedValue({ item: {} });
    const p = base();
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    expect(screen.getByLabelText('Title on the agenda')).toHaveValue('Customer knowledge — Q4');
    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'How well do you know our customers?' } });
    fireEvent.change(screen.getByLabelText('Planned length'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Goes after'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Ten questions. Scored.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith('5307', {
      type: 'trivia', title: 'How well do you know our customers?', description: 'Ten questions. Scored.',
      minutes: 15, position: 1, setRef: { scope: 'org', orgId: 'org_nw', setId: 'custq4', version: 3 },
    });
  });

  it('appending after the last item (the default) omits position entirely', async () => {
    api.addItem.mockResolvedValue({ item: {} });
    const p = base();
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith('5307', {
      type: 'trivia', title: 'Customer knowledge — Q4', description: '', minutes: 15,
      setRef: { scope: 'org', orgId: 'org_nw', setId: 'custq4', version: 3 },
    });
  });

  it('asks for a set before sending anything', () => {
    render(<EventItemDialog {...base()} />);
    fireEvent.change(screen.getByLabelText('Title on the agenda'), { target: { value: 'Quiz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a question set');
    expect(api.addItem).not.toHaveBeenCalled();
  });

  // rejects: 03's last note broken — a co-host filled the last place.
  it('a cap refusal shows the server\'s sentence and keeps every choice', async () => {
    api.addItem.mockRejectedValue(new Error('This event has 8 engagements, the most one can hold. Remove one to add another.'));
    const p = base();
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This event has 8 engagements');
    expect(screen.getByLabelText('Customer knowledge — Q4')).toBeChecked();
    expect(screen.getByLabelText('Title on the agenda')).toHaveValue('Customer knowledge — Q4');
    expect(p.onSaved).not.toHaveBeenCalled();
  });

  it('both exits close a clean dialog; a chosen set is not dropped without asking', () => {
    const p = base();
    render(<EventItemDialog {...p} />);
    const exits = screen.getAllByRole('button', { name: 'Close' });
    expect(exits).toHaveLength(2);
    fireEvent.click(exits[0]);
    expect(p.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    fireEvent.click(exits[1]);
    expect(window.confirm).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('a refusal reloads the agenda behind the dialog (final review M2)', () => {
  const changed = () => Object.assign(
    new Error('The event changed while you were saving. Nothing was saved; reload it and try again.'),
    { status: 409, body: { code: 'agenda_changed' } },
  );
  const CO_HOST_FIRST = { itemId: 'it_0000000f', order: 1, type: 'break', title: 'Doors open', minutes: 10, description: '', state: 'planned' };

  it('a 409 asks the builder to reload, keeps the dialog open, and the retry places the item against the NEW agenda', async () => {
    api.addItem.mockRejectedValueOnce(changed()).mockResolvedValueOnce({ item: {} });
    const p = base({ type: 'break', onRefused: jest.fn() });
    const { rerender } = render(<EventItemDialog {...p} />);
    // "Goes after 1 · Before we start" — index 1 in the agenda as it was read.
    fireEvent.change(screen.getByLabelText('Goes after'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The event changed while you were saving');
    expect(p.onRefused).toHaveBeenCalledTimes(1);
    expect(api.addItem).toHaveBeenLastCalledWith('5307', expect.objectContaining({ position: 1 }));

    // The builder reloads: a co-host put a row at the top in the meantime.
    rerender(<EventItemDialog {...p} items={[CO_HOST_FIRST, ...ITEMS]} />);
    expect(screen.getByLabelText('Goes after')).toHaveDisplayValue('1 · Before we start');
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    // Still right after "Before we start", which is now the second row.
    expect(api.addItem).toHaveBeenLastCalledWith('5307', { type: 'break', title: 'Break', description: '', minutes: 15, position: 2 });
  });

  it('left at "after the last item", the retry still goes last on the reloaded agenda', async () => {
    api.addItem.mockRejectedValueOnce(changed()).mockResolvedValueOnce({ item: {} });
    const p = base({ type: 'break', onRefused: jest.fn() });
    const { rerender } = render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await screen.findByRole('alert');
    rerender(<EventItemDialog {...p} items={[...ITEMS, CO_HOST_FIRST]} />);
    expect(screen.getByLabelText('Goes after')).toHaveDisplayValue('Break · Doors open');
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenLastCalledWith('5307', { type: 'break', title: 'Break', description: '', minutes: 15 });
  });

  it('if the row it was to go after is gone, it says so and sends nothing', async () => {
    api.addItem.mockRejectedValueOnce(changed());
    const p = base({ type: 'break', onRefused: jest.fn() });
    const { rerender } = render(<EventItemDialog {...p} />);
    fireEvent.change(screen.getByLabelText('Goes after'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await screen.findByRole('alert');
    rerender(<EventItemDialog {...p} items={ITEMS.slice(1)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The item this was to go after is no longer on the agenda. Choose where it goes.');
    expect(api.addItem).toHaveBeenCalledTimes(1);
  });

  it('an edit or a remove refused with a 404 asks the builder to reload too, and says the server\'s sentence', async () => {
    const gone = Object.assign(new Error('That item is no longer on the agenda.'), { status: 404, body: { code: 'item_gone' } });
    api.updateItem.mockRejectedValueOnce(gone);
    api.removeItem.mockRejectedValueOnce(gone);
    const p = base({ mode: 'edit', type: 'trivia', item: ITEMS[2], onRefused: jest.fn() });
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That item is no longer on the agenda.');
    expect(p.onRefused).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove from agenda' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(p.onRefused).toHaveBeenCalledTimes(2));
    expect(p.onRemoved).not.toHaveBeenCalled();
  });

  it('a refusal that is not about the agenda (a 400) does not reload', async () => {
    api.addItem.mockRejectedValueOnce(Object.assign(new Error('That question set is switched off.'), { status: 400, body: {} }));
    const p = base({ onRefused: jest.fn() });
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByLabelText('Customer knowledge — Q4'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await screen.findByRole('alert');
    expect(p.onRefused).not.toHaveBeenCalled();
  });
});

describe('adding a break', () => {
  it('has no set, is called Break unless renamed, and goes where it is put', async () => {
    api.addItem.mockResolvedValue({ item: {} });
    const p = base({ type: 'break' });
    render(<EventItemDialog {...p} />);
    expect(screen.getByRole('heading', { name: 'Add a break' })).toBeInTheDocument();
    expect(screen.queryByTestId('set-row')).toBeNull();
    expect(screen.getByLabelText('Title on the agenda')).toHaveValue('Break');
    fireEvent.change(screen.getByLabelText('Goes after'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to agenda' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith('5307', { type: 'break', title: 'Break', description: '', minutes: 15, position: 0 });
  });
});

describe('editing and removing', () => {
  const edit = (over = {}) => base({ mode: 'edit', type: 'trivia', item: ITEMS[2], ...over });

  it('edits the words and the length, and names the set without offering to change it', async () => {
    api.updateItem.mockResolvedValue({ item: {} });
    const p = edit();
    render(<EventItemDialog {...p} />);
    expect(screen.getByRole('heading', { name: 'Edit Trivia' })).toBeInTheDocument();
    expect(screen.getByText('Plays FY27 plan — check-in · v1.')).toBeInTheDocument();
    expect(screen.queryByTestId('set-row')).toBeNull();
    expect(screen.queryByLabelText('Goes after')).toBeNull();
    fireEvent.change(screen.getByLabelText('Planned length'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
    expect(api.updateItem).toHaveBeenCalledWith('5307', 'it_00000003', { title: 'FY27 plan quiz', description: '', minutes: 20, ledBy: '' });
  });

  it('an item pinned to a deleted version does not claim to play it', () => {
    render(<EventItemDialog {...edit({ item: { ...ITEMS[2], set: { ...ITEMS[2].set, pinnedMissing: true } } })} />);
    expect(screen.getByText('Pinned to FY27 plan — check-in · v1, which is no longer in the set.')).toBeInTheDocument();
    expect(screen.queryByText(/^Plays /)).toBeNull();
  });

  it('removing asks in place, and Keep it keeps it', async () => {
    api.removeItem.mockResolvedValue({ removed: 'it_00000003' });
    const p = edit();
    render(<EventItemDialog {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove from agenda' }));
    expect(screen.getByTestId('remove-confirm')).toHaveTextContent('Remove “FY27 plan quiz” from the agenda?');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(api.removeItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from agenda' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(p.onRemoved).toHaveBeenCalledWith('it_00000003'));
    expect(api.removeItem).toHaveBeenCalledWith('5307', 'it_00000003');
  });
});
