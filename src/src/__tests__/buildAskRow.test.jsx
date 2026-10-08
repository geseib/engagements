/**
 * THE ASK PATH'S ACTION ROW (docs/design/build-room-batch-2-3, B1a-d).
 * Primary right-most, secondaries to its left, ghosts further left; the row
 * is pinned to the bottom of the open step; the hint slot holds the Space
 * words. Settle with a clear winner SENDS in one press. NO GEOMETRY (jsdom).
 */
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { AskPath } from '../buildroom/BuildAskPath';
import { settleSend, HOST_KINDS, defaultKind, decideBody } from '../buildroom/buildScreens';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({ __esModule: true, default: {} }));

const base = { askId: '004', kind: 'choice', prompt: 'How should it look and feel?', openedAt: '2026-10-07T14:51:00.000Z', source: 'host',
  options: [{ label: 'A', title: 'Calm' }, { label: 'B', title: 'Playful' }] };
const room = { playerCount: 12, asks: [], log: [] };
const won = { total: 11, options: [{ label: 'A', count: 4 }, { label: 'B', count: 7 }] };
const tie = { total: 8, tied: ['A', 'B'], options: [{ label: 'A', count: 4 }, { label: 'B', count: 4 }] };
const api = () => ({ askAction: jest.fn(() => Promise.resolve({})) });
const mount = (ask, props = {}) => render(
  <AskPath ask={ask} room={room} busy={props.busy || false} ended={false} run={(fn) => fn()} api={props.api || api()}
    pickId={props.pickId || null} onPick={props.onPick || jest.fn()} answering={props.answering || false}
    setAnswering={props.setAnswering || jest.fn()} onSent={props.onSent} draft={props.draft || null} />,
);
const row = () => document.querySelector('.brm-arow');
const rowButtons = () => within(row()).getAllByRole('button').map((b) => b.textContent.trim());
const primaryOf = () => row().querySelector('.brm-btn--primary');

afterEach(() => { document.body.innerHTML = ''; });

describe('the row is the same shape on every step', () => {
  test('Collect: Answer for the room, Spin the wheel, Show results; primary last; hint in words', () => {
    mount({ ...base, status: 'live', results: { total: 7, options: [] } });
    expect(rowButtons()).toEqual(['Answer for the room', 'Spin the wheel', 'Show results']);
    expect(primaryOf().textContent.trim()).toBe('Show results');
    expect(row().lastElementChild).toBe(primaryOf());
    expect(within(row()).getByText('Press Space to show results')).toBeInTheDocument();
    expect(row().className).toContain('is-pinned');
    expect(row().closest('.brm-path-body')).not.toBeNull();
  });

  test('Collect on an Ideas ask: Close without a vote, Answer for the room, then Open voting', () => {
    mount({ ...base, kind: 'suggest', options: [], status: 'live', answerCount: 3, responses: [], results: { total: 0 } });
    const b = rowButtons();
    expect(b[0]).toBe('Close without a vote');
    expect(b[b.length - 1]).toBe('Open voting');
    expect(primaryOf().textContent.trim()).toBe('Open voting');
  });

  test('steps to come are one line, not boxes', () => {
    mount({ ...base, status: 'live', results: { total: 7, options: [] } });
    expect(screen.getByText('Next: 3 Settle · 4 Send to Claude')).toBeInTheDocument();
    expect(document.querySelectorAll('.is-next')).toHaveLength(0);
  });

  test('a press is confirmed in the hint slot', async () => {
    const a = api();
    mount({ ...base, status: 'live', results: { total: 7, options: [] } }, { api: a });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show results' })); });
    expect(a.askAction).toHaveBeenLastCalledWith('004', { action: 'close' });
    expect(within(row()).getByText('Results are up')).toBeInTheDocument();
  });
});

describe('Settle with a clear winner sends in one press', () => {
  test('Spin the wheel, Change before sending, Send B to Claude (primary, last)', () => {
    mount({ ...base, status: 'results', results: won });
    expect(rowButtons()).toEqual(['Spin the wheel', 'Change before sending', 'Send B to Claude']);
    expect(primaryOf()).toHaveAttribute('data-next-primary');
    expect(row().lastElementChild).toBe(primaryOf());
    expect(within(row()).getByText('Press Space to send, as Do now')).toBeInTheDocument();
    expect(document.activeElement).toBe(primaryOf());
  });

  test('a line under the board names exactly what Claude will be told', () => {
    mount({ ...base, status: 'results', results: won });
    expect(screen.getByText('Claude will be told, as Do now: "How should it look and feel: Playful"')).toBeInTheDocument();
    expect(screen.getByText('Next: 4 Change before sending')).toBeInTheDocument();
  });

  test('the line follows the question\'s own kind', () => {
    mount({ ...base, claudeGets: 'keep', status: 'results', results: won });
    expect(screen.getByText(/Claude will be told, as Keep in mind:/)).toBeInTheDocument();
    expect(within(row()).getByText('Press Space to send, as Keep in mind')).toBeInTheDocument();
  });

  test('Send B posts the decision once with the room\'s choice, then reports it', async () => {
    const a = api();
    const onSent = jest.fn();
    mount({ ...base, status: 'results', results: won }, { api: a, onSent });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send B to Claude' })); });
    expect(a.askAction).toHaveBeenCalledTimes(1);
    expect(a.askAction).toHaveBeenCalledWith('004', {
      action: 'decide', direction: 'How should it look and feel: Playful', chosen: ['B'], note: '', sendToAgent: true, method: 'vote', as: 'do-now',
    });
    expect(onSent).toHaveBeenCalledWith({ as: 'do-now', send: true, direction: 'How should it look and feel: Playful' });
  });

  test('a double press sends once', async () => {
    let release;
    const a = { askAction: jest.fn(() => new Promise((r) => { release = r; })) };
    mount({ ...base, status: 'results', results: won }, { api: a });
    const b = screen.getByRole('button', { name: 'Send B to Claude' });
    await act(async () => { fireEvent.click(b); fireEvent.click(b); });
    expect(a.askAction).toHaveBeenCalledTimes(1);
    await act(async () => { release({}); });
  });

  test('Change before sending opens step 4 with the room\'s choice', () => {
    const onPick = jest.fn();
    mount({ ...base, status: 'results', results: won }, { onPick });
    fireEvent.click(screen.getByRole('button', { name: 'Change before sending' }));
    expect(onPick).toHaveBeenCalledWith('B', { confirmed: true });
  });

  test('a rating says its average; an Ideas ask says the top idea', () => {
    const { unmount } = mount({ ...base, kind: 'rating', options: [], status: 'results', results: { total: 2, rating: { avg: 3.5, count: 2, dist: [0, 0, 1, 1, 0] } } });
    expect(primaryOf().textContent.trim()).toBe('Send 3.5 to Claude');
    unmount();
    mount({ ...base, kind: 'suggest', options: [], status: 'results', results: { total: 3, ranked: [{ respId: 'r2', text: 'Not seeing open shifts', votes: 2 }, { respId: 'r1', text: 'Account', votes: 1 }] } });
    expect(primaryOf().textContent.trim()).toBe('Send the top idea to Claude');
  });
});

describe('what one press sends is always what the line says (fix round 1)', () => {
  const winner = { ...base, status: 'results', results: won };

  test('I1: a preset of Later does not send as Do now: the primary is Save for later', async () => {
    const a = api();
    const onSent = jest.fn();
    mount({ ...winner, claudeGets: 'later' }, { api: a, onSent });
    expect(rowButtons()).toEqual(['Spin the wheel', 'Change before sending', 'Save for later']);
    expect(primaryOf()).toHaveAttribute('data-next-primary');
    expect(within(row()).getByText('Press Space to save for later')).toBeInTheDocument();
    expect(screen.getByText('Goes on your Later list: "How should it look and feel: Playful". Claude hears nothing until you send it.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(primaryOf()); });
    expect(a.askAction).toHaveBeenCalledWith('004', expect.objectContaining({ action: 'decide', chosen: ['B'], sendToAgent: true, as: 'later' }));
    expect(onSent).toHaveBeenCalledWith({ as: 'later', send: true, direction: 'How should it look and feel: Playful' });
  });

  test('I2: an opening-step question is Keep in mind: the line says so and the body carries it', async () => {
    const a = api();
    mount({ ...winner, openingStep: 'kind' }, { api: a });
    expect(screen.getByText(/^Claude will be told, as Keep in mind:/)).toBeInTheDocument();
    expect(within(row()).getByText('Press Space to send, as Keep in mind')).toBeInTheDocument();
    await act(async () => { fireEvent.click(primaryOf()); });
    expect(a.askAction.mock.calls[0][1]).toMatchObject({ as: 'keep' });
    expect(defaultKind({ openingStep: 'kind' })).toBe('keep');
    expect(defaultKind({ claudeGets: 'ask', openingStep: 'kind' })).toBe('ask');
    expect(defaultKind({})).toBe('do-now');
  });

  test('I2: decideBody always carries `as` when sending, and none when only recording', () => {
    expect(decideBody(base, { direction: 'x', chosen: [] })).toMatchObject({ as: 'do-now' });
    expect(decideBody({ ...base, claudeGets: 'keep' }, { direction: 'x', chosen: [] })).toMatchObject({ as: 'keep' });
    expect(decideBody(base, { direction: 'x', chosen: [], send: false })).not.toHaveProperty('as');
  });

  test('I3: one press honours a kept draft for this pick: its words and its kind', async () => {
    const a = api();
    const draft = { direction: 'Playful, big numbers', as: 'keep', chosen: ['B'], pickId: 'B', spoken: false };
    mount(winner, { api: a, draft });
    expect(screen.getByText('Claude will be told, as Keep in mind: "Playful, big numbers"')).toBeInTheDocument();
    await act(async () => { fireEvent.click(primaryOf()); });
    expect(a.askAction).toHaveBeenCalledWith('004', expect.objectContaining({ direction: 'Playful, big numbers', chosen: ['B'], as: 'keep' }));
  });

  test('I3: a draft for another pick, a spoken one, or an empty one is ignored', () => {
    const d = { direction: 'Old', as: 'keep', chosen: ['A'], pickId: 'A', spoken: false };
    const { unmount } = mount(winner, { draft: d });
    expect(screen.getByText(/"How should it look and feel: Playful"/)).toBeInTheDocument();
    unmount();
    mount(winner, { draft: { ...d, pickId: 'B', direction: '   ' } });
    expect(screen.getByText(/"How should it look and feel: Playful"/)).toBeInTheDocument();
  });

  test('M3: the set\'s note rides on the line; M4: an Ask Claude kind reads as a question', () => {
    const { unmount } = mount({ ...winner, claudeNote: 'Fix the most common reason.' });
    expect(screen.getByText('Claude will be told, as Do now: "How should it look and feel: Playful" With it, from the set: "Fix the most common reason."')).toBeInTheDocument();
    unmount();
    mount({ ...winner, claudeGets: 'ask' });
    expect(screen.getByText('Claude will be asked about: "How should it look and feel: Playful"')).toBeInTheDocument();
  });
});

describe('Settle with a tie, and after the wheel', () => {
  test('a tie: Vote again, then Spin the wheel as the primary; nothing sends', () => {
    mount({ ...base, status: 'results', results: tie });
    expect(rowButtons()).toEqual(['Vote again', 'Spin the wheel']);
    expect(primaryOf().textContent.trim()).toBe('Spin the wheel');
    expect(screen.queryByRole('button', { name: /^Send / })).toBeNull();
  });

  test('no votes: Spin the wheel alone', () => {
    mount({ ...base, status: 'results', results: { total: 0, options: [{ label: 'A', count: 0 }, { label: 'B', count: 0 }] } });
    expect(rowButtons()).toEqual(['Spin the wheel']);
  });

  const landed = (spins) => ({ landed: 'A', spins, slices: [{ id: 'A', text: 'Calm' }, { id: 'B', text: 'Playful' }] });

  test('the wheel landed: Spin again, Change before sending, Send A to Claude; one Spin again on screen', () => {
    mount({ ...base, status: 'results', results: won, wheel: landed([{ spinId: 's1', landed: 'A' }]) });
    expect(rowButtons()).toEqual(['Spin again', 'Change before sending', 'Send A to Claude']);
    expect(screen.getAllByRole('button', { name: 'Spin again' })).toHaveLength(1);
    expect(screen.getByText(/Claude will be told, as Do now: .*Calm/)).toBeInTheDocument();
  });

  test('while the wheel turns: "The wheel is turning…", disabled, and no Send', () => {
    const ask = { ...base, status: 'results', results: won, wheel: landed([{ spinId: 's1', landed: 'A' }]) };
    const props = { room, ended: false, run: (fn) => fn(), api: api(), pickId: null, onPick: jest.fn(), answering: false, setAnswering: jest.fn(), busy: false };
    const { rerender } = render(<AskPath ask={ask} {...props} />);
    rerender(<AskPath ask={{ ...ask, wheel: landed([{ spinId: 's1', landed: 'A' }, { spinId: 's2', landed: 'B' }]) }} {...props} />);
    const turning = screen.getByRole('button', { name: 'The wheel is turning…' });
    expect(turning).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Send . to Claude/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Spin again' })).toBeDisabled();
  });
});

describe('Change before sending (step 4)', () => {
  const open = (props = {}) => mount({ ...base, status: 'results', results: won }, { pickId: 'B', ...props });

  test('titled for what it is; three kinds; no on/off switch; the row is Record only, Save for later, Send B', () => {
    open();
    expect(screen.getAllByRole('listitem').some((li) => /Change before sending/.test(li.textContent))).toBe(true);
    const kinds = within(screen.getByRole('radiogroup', { name: 'Claude gets it as' })).getAllByRole('radio').map((r) => r.textContent);
    expect(kinds).toEqual(['Do now', 'Keep in mind', 'Ask Claude']);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(rowButtons()).toEqual(['Record only', 'Save for later', 'Send B to Claude']);
    expect(primaryOf().textContent.trim()).toBe('Send B to Claude');
    expect(primaryOf()).toHaveAttribute('data-no-space');
    expect(within(row()).getByText('Ctrl Enter sends')).toBeInTheDocument();
  });

  test('Save for later is a decision with kind later; Record only sends nothing to Claude', async () => {
    const a = api();
    const onSent = jest.fn();
    open({ api: a, onSent });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save for later' })); });
    expect(a.askAction).toHaveBeenLastCalledWith('004', expect.objectContaining({ action: 'decide', sendToAgent: true, as: 'later', chosen: ['B'] }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record only' })); });
    expect(a.askAction).toHaveBeenLastCalledWith('004', expect.objectContaining({ action: 'decide', sendToAgent: false }));
    expect(a.askAction.mock.calls[1][1]).not.toHaveProperty('as');
  });

  test('a spoken answer has no letter: Send to Claude', () => {
    mount({ ...base, status: 'live', results: { total: 2, options: [] } }, { answering: true });
    expect(primaryOf().textContent.trim()).toBe('Send to Claude');
  });
});

describe('settleSend and HOST_KINDS', () => {
  test('settleSend: the room\'s pick, its sentence, its button', () => {
    expect(settleSend({ ...base, status: 'results', results: won })).toEqual({ id: 'B', chosen: ['B'], direction: 'How should it look and feel: Playful', button: 'Send B to Claude' });
    expect(settleSend({ ...base, status: 'results', results: tie })).toBeNull();
  });
  test('HOST_KINDS has no Later', () => {
    expect(HOST_KINDS.map((k) => k.key)).toEqual(['do-now', 'keep', 'ask']);
  });
});
