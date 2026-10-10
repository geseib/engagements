/**
 * THE ASK AS FOUR STEPS — buildroom/BuildAskPath.jsx, buildroom/useNextFocus.js
 * (docs/design/build-room-host-flow, H2-H4).
 *
 * Ask, Collect, Settle, Send to Claude. Done steps fold to one line, the open
 * step has one primary move, and focus lands on it when the step changes:
 * never on a refetch of the same step, never while the host is typing, never
 * with a dialog open. NO GEOMETRIC ASSERTIONS — jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AskPath, settleSummary } from '../buildroom/BuildAskPath';
import { isTypingTarget } from '../buildroom/useNextFocus';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({ __esModule: true, default: {} }));

const base = { askId: '004', kind: 'choice', prompt: 'How should it look and feel?', openedAt: '2026-10-07T14:51:00.000Z', source: 'host',
  options: [{ label: 'A', title: 'Calm' }, { label: 'B', title: 'Playful' }] };
const room = { playerCount: 12, asks: [], log: [] };
const api = () => ({ askAction: jest.fn(() => Promise.resolve({})) });
const mount = (ask, props = {}) => render(<AskPath ask={ask} room={room} busy={false} ended={false} run={(fn) => fn()} api={props.api || api()} pickId={props.pickId || null} onPick={props.onPick || jest.fn()} answering={props.answering || false} setAnswering={props.setAnswering || jest.fn()} onSent={props.onSent} draft={props.draft} onDraft={props.onDraft} />);
const won = { total: 11, options: [{ label: 'A', count: 4 }, { label: 'B', count: 7 }] };

afterEach(() => { document.body.innerHTML = ''; });

test('Collect: Ask folded, Show results focused, the steps to come one line', () => {
  mount({ ...base, status: 'live', results: { total: 7, options: [{ label: 'A', count: 3 }, { label: 'B', count: 4 }] } });
  const steps = screen.getAllByRole('listitem');
  expect(steps).toHaveLength(2);
  expect(steps[0].className).toContain('is-done');
  expect(steps[1].className).toContain('is-now');
  const primary = screen.getByRole('button', { name: 'Show results' });
  expect(primary).toHaveAttribute('data-next-primary');
  expect(document.activeElement).toBe(primary);
});

test('Collect: Answer for the room and Spin the wheel sit beside the primary; each does its thing', () => {
  const a = api();
  mount({ ...base, status: 'live', results: { total: 7, options: [] } }, { api: a });
  fireEvent.click(screen.getByRole('button', { name: 'Show results' }));
  expect(a.askAction).toHaveBeenLastCalledWith('004', { action: 'close' });
  fireEvent.click(screen.getByRole('button', { name: 'Spin the wheel' }));
  expect(a.askAction).toHaveBeenLastCalledWith('004', { action: 'wheel' });
});

test('Collect on an Ideas ask still taking ideas: Open voting is the primary', () => {
  mount({ ...base, kind: 'suggest', options: [], status: 'live', responses: [], results: { total: 0 } });
  const primary = screen.getByRole('button', { name: 'Open voting' });
  expect(primary).toHaveAttribute('data-next-primary');
  expect(document.activeElement).toBe(primary);
});

test('Settle with a winner: Send B to Claude is focused; Change before sending picks B', () => {
  const onPick = jest.fn();
  mount({ ...base, status: 'results', results: won }, { onPick });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Send B to Claude' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change before sending' }));
  expect(onPick).toHaveBeenCalledWith('B', { confirmed: true });
});

test('Settle: clicking another option still goes through the confirm (onPick with no second argument)', () => {
  const onPick = jest.fn();
  mount({ ...base, status: 'results', results: won }, { onPick });
  fireEvent.click(screen.getByRole('button', { name: 'Choose this instead' }));
  expect(onPick).toHaveBeenCalledWith('A');
});

test('Settle with a tie: Spin the wheel is the focused move, Vote again beside it', () => {
  mount({ ...base, status: 'results', results: { total: 8, tied: ['A', 'B'], options: [{ label: 'A', count: 4 }, { label: 'B', count: 4 }] } });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Spin the wheel' }));
  expect(screen.getByRole('button', { name: 'Vote again' })).toBeInTheDocument();
});

test('Settle on a rating: Send 3.5 to Claude; Change before sending carries the average', () => {
  const onPick = jest.fn();
  mount({ ...base, kind: 'rating', options: [], status: 'results', results: { total: 2, rating: { avg: 3.5, count: 2, dist: [0, 0, 1, 1, 0] } } }, { onPick });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Send 3.5 to Claude' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change before sending' }));
  expect(onPick).toHaveBeenCalledWith('3.5', { confirmed: true });
});

test('Change before sending: Settle folds to what was chosen; the cursor is in the direction; Send is the primary', () => {
  mount({ ...base, status: 'results', results: won }, { pickId: 'B' });
  expect(screen.getByText("B \u00b7 the room's choice, 7 to 4")).toBeInTheDocument();
  expect(document.activeElement.tagName).toBe('TEXTAREA');
  expect(screen.getByRole('button', { name: 'Send B to Claude' })).toHaveAttribute('data-next-primary');
});

const landedA = { landed: 'A', spins: [{ landed: 'A' }], slices: [{ id: 'A', text: 'Calm' }, { id: 'B', text: 'Playful' }] };

test('the wheel landed: Settle stays open with the wheel, and Send A to Claude is the move', () => {
  const onPick = jest.fn();
  mount({ ...base, status: 'results', results: won, wheel: landedA }, { onPick });
  expect(screen.getAllByRole('listitem')[2].className).toContain('is-now');
  expect(screen.getByRole('region', { name: 'The wheel' })).toBeInTheDocument();
  const go = screen.getByRole('button', { name: 'Send A to Claude' });
  expect(go).toHaveAttribute('data-next-primary');
  expect(document.activeElement).toBe(go);
  fireEvent.click(screen.getByRole('button', { name: 'Change before sending' }));
  expect(onPick).toHaveBeenCalledWith('A', { confirmed: true });
});

test('going with where the wheel landed: Settle says so and Send opens with its pick', () => {
  mount({ ...base, status: 'results', results: won, wheel: landedA }, { pickId: 'A' });
  expect(screen.getByText('The wheel picked A')).toBeInTheDocument();
  expect(document.activeElement.value).toBe('How should it look and feel: Calm');
});

test('Change before sending: Space is never bound to Send; only Ctrl or Cmd Enter sends', () => {
  mount({ ...base, status: 'results', results: won }, { pickId: 'B' });
  const send = screen.getByRole('button', { name: 'Send B to Claude' });
  expect(send).toHaveAttribute('data-no-space');
  expect(screen.getByText('Ctrl Enter sends')).toBeInTheDocument();
  expect(screen.queryByRole('switch')).toBeNull();
});

test('a pick on a tie: the folded Settle still offers Spin the wheel and Vote again', () => {
  mount({ ...base, status: 'results', results: { total: 8, tied: ['A', 'B'], options: [{ label: 'A', count: 4 }, { label: 'B', count: 4 }] } }, { pickId: 'A' });
  fireEvent.click(screen.getByRole('button', { name: /A \u00b7 your pick/ }));
  expect(screen.getByRole('button', { name: 'Spin the wheel' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Vote again' })).toBeInTheDocument();
});

test('a live Ideas ask with fewer than two ideas has no Spin the wheel (as the Stage dock)', () => {
  const ideas = { ...base, kind: 'suggest', options: [], status: 'live', results: { total: 1 } };
  const { unmount } = mount({ ...ideas, answerCount: 1, responses: [{ respId: 'r1', text: 'One' }] });
  expect(screen.queryByRole('button', { name: 'Spin the wheel' })).toBeNull();
  unmount();
  mount({ ...ideas, answerCount: 2, responses: [{ respId: 'r1', text: 'One' }, { respId: 'r2', text: 'Two' }] });
  expect(screen.getByRole('button', { name: 'Spin the wheel' })).toBeInTheDocument();
});

test('a draft: typing reports it, and a draft for the same pick is where Send starts', () => {
  const onDraft = jest.fn();
  const { unmount } = mount({ ...base, status: 'results', results: won }, { pickId: 'B', onDraft });
  fireEvent.change(document.activeElement, { target: { value: 'Playful, big numbers' } });
  expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'Playful, big numbers', as: 'do-now', pickId: 'B', spoken: false }));
  unmount();
  mount({ ...base, status: 'results', results: won }, { pickId: 'B', draft: { direction: 'Playful, big numbers', as: 'keep', chosen: ['B'], pickId: 'B', spoken: false } });
  expect(document.activeElement.value).toBe('Playful, big numbers');
  expect(screen.getByRole('radio', { name: 'Keep in mind' })).toHaveAttribute('aria-checked', 'true');
});

test('a draft for another pick is not used', () => {
  mount({ ...base, status: 'results', results: won }, { pickId: 'B', draft: { direction: 'Old', as: 'do-now', chosen: ['A'], pickId: 'A', spoken: false } });
  expect(document.activeElement.value).toBe('How should it look and feel: Playful');
});

test('Send: Ctrl+Enter in the direction sends it, and the sent line is reported', async () => {
  const a = api();
  const onSent = jest.fn();
  mount({ ...base, status: 'results', results: won }, { pickId: 'B', api: a, onSent });
  await act(async () => { fireEvent.keyDown(document.activeElement, { key: 'Enter', ctrlKey: true }); });
  expect(a.askAction).toHaveBeenCalledWith('004', expect.objectContaining({ action: 'decide', direction: 'How should it look and feel: Playful', chosen: ['B'] }));
  expect(onSent).toHaveBeenCalledWith({ as: 'do-now', send: true, direction: 'How should it look and feel: Playful' });
});

test('a refetch with the same step does not move focus out of the direction', () => {
  const ask = { ...base, status: 'results', results: won };
  const { rerender } = mount(ask, { pickId: 'B' });
  const ta = document.activeElement;
  fireEvent.change(ta, { target: { value: 'Playful, big numbers' } });
  rerender(<AskPath ask={{ ...ask }} room={{ ...room }} busy={false} ended={false} run={(fn) => fn()} api={api()} pickId="B" onPick={jest.fn()} answering={false} setAnswering={jest.fn()} />);
  expect(document.activeElement).toBe(ta);
  expect(ta.value).toBe('Playful, big numbers');
});

test('a refetch while the host has tabbed to another control leaves the focus there', () => {
  const ask = { ...base, status: 'live', results: { total: 7, options: [] } };
  const { rerender } = mount(ask);
  const other = screen.getByRole('button', { name: 'Answer for the room' });
  other.focus();
  rerender(<AskPath ask={{ ...ask, results: { total: 8, options: [] } }} room={{ ...room }} busy={false} ended={false} run={(fn) => fn()} api={api()} pickId={null} onPick={jest.fn()} answering={false} setAnswering={jest.fn()} />);
  expect(document.activeElement).toBe(other);
});

test('a step change while the host is typing elsewhere leaves the cursor where it is', () => {
  const ask = { ...base, status: 'live', results: { total: 7, options: [] } };
  const outside = document.createElement('textarea');
  document.body.appendChild(outside);
  const { rerender } = mount(ask);
  outside.focus();
  rerender(<AskPath ask={{ ...ask, status: 'results', results: won }} room={room} busy={false} ended={false} run={(fn) => fn()} api={api()} pickId={null} onPick={jest.fn()} answering={false} setAnswering={jest.fn()} />);
  expect(document.activeElement).toBe(outside);
});

test('a step change with a dialog open does not move focus', () => {
  const ask = { ...base, status: 'live', results: { total: 7, options: [] } };
  const { rerender } = mount(ask);
  const dlg = document.createElement('div');
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  const btn = document.createElement('button');
  dlg.appendChild(btn);
  document.body.appendChild(dlg);
  btn.focus();
  rerender(<AskPath ask={{ ...ask, status: 'results', results: won }} room={room} busy={false} ended={false} run={(fn) => fn()} api={api()} pickId={null} onPick={jest.fn()} answering={false} setAnswering={jest.fn()} />);
  expect(document.activeElement).toBe(btn);
});

test('a step whose move is disabled while busy is focused once it is ready', () => {
  const ask = { ...base, status: 'live', results: { total: 7, options: [] } };
  const props = { room, ended: false, run: (fn) => fn(), api: api(), pickId: null, onPick: jest.fn(), answering: false, setAnswering: jest.fn() };
  const { rerender } = render(<AskPath ask={ask} busy {...props} />);
  rerender(<AskPath ask={{ ...ask, status: 'results', results: won }} busy {...props} />);
  rerender(<AskPath ask={{ ...ask, status: 'results', results: won }} busy={false} {...props} />);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Send B to Claude' }));
});

test('Answer for the room jumps to Send; Cancel returns to Collect', () => {
  const setAnswering = jest.fn();
  mount({ ...base, status: 'live', results: { total: 2, options: [] } }, { setAnswering });
  fireEvent.click(screen.getByRole('button', { name: 'Answer for the room' }));
  expect(setAnswering).toHaveBeenCalledWith(true);
});

test('answering: Send holds the spoken panel, and its Cancel goes back', () => {
  const setAnswering = jest.fn();
  mount({ ...base, status: 'live', results: { total: 2, options: [] } }, { setAnswering, answering: true });
  const steps = screen.getAllByRole('listitem');
  expect(steps[steps.length - 1].className).toContain('is-now');
  expect(screen.getByRole('region', { name: 'Answer for the room' })).toBeInTheDocument();
  expect(document.activeElement.tagName).toBe('TEXTAREA');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(setAnswering).toHaveBeenCalledWith(false);
});

test('the folded Ask opens to Edit wording and Discard; the folded Collect to Reopen', async () => {
  const a = api();
  mount({ ...base, status: 'results', results: won }, { api: a });
  expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Ask: How should it look and feel\?/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit wording' }));
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'How should it feel?' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save wording' })); });
  expect(a.askAction).toHaveBeenLastCalledWith('004', { action: 'edit', prompt: 'How should it feel?', detail: '' });
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(a.askAction).toHaveBeenLastCalledWith('004', { action: 'discard' });
  fireEvent.click(screen.getByRole('button', { name: /11 of 12 voted/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
  expect(a.askAction).toHaveBeenLastCalledWith('004', { action: 'reopen' });
});

test('an ended session shows the path with no moves', () => {
  render(<AskPath ask={{ ...base, status: 'results', results: won }} room={room} busy={false} ended run={(fn) => fn()} api={api()} pickId={null} onPick={jest.fn()} answering={false} setAnswering={jest.fn()} />);
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(document.querySelector('[data-next-primary]')).toBeNull();
});

describe('isTypingTarget', () => {
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstChild; };
  test.each([
    ['<input>', true], ['<input type="text">', true], ['<input type="checkbox">', false], ['<input type="radio">', false],
    ['<input type="button">', false], ['<textarea></textarea>', true], ['<select></select>', true], ['<button></button>', false], ['<a href="#x">x</a>', false],
  ])('%s → %s', (html, out) => { expect(isTypingTarget(el(html))).toBe(out); });
  test('contentEditable and nothing', () => {
    expect(isTypingTarget({ nodeType: 1, tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('settleSummary: an Ideas ask is worded by what the idea says, never its id', () => {
  const ideas = { askId: '7', kind: 'suggest', status: 'results', prompt: 'What stops a sign-up?',
    results: { total: 3, ranked: [{ respId: 'r2', text: 'Not seeing open shifts', votes: 2 }, { respId: 'r1', text: 'Having to make an account', votes: 1 }] } };
  test.each([
    [{}, 'r2', '"Not seeing open shifts" \u00b7 the room\'s choice, 2 to 1'],
    [{}, 'r1', '"Having to make an account" \u00b7 your pick, not "Not seeing open shifts"'],
    [{ wheel: { landed: 'r1' } }, null, 'The wheel picked "Having to make an account"'],
    [{ wheel: { landed: 'r1' } }, 'r2', '"Not seeing open shifts" \u00b7 your pick, not the wheel\'s "Having to make an account"'],
  ])('%j, pick %s', (over, pick, out) => {
    expect(settleSummary({ ...ideas, ...over }, pick, { settle: 'unused' })).toBe(out);
  });
  test('a Choose ask keeps the letters from askPathSummaries', () => {
    expect(settleSummary({ kind: 'choice' }, 'B', { settle: 'B \u00b7 your pick' })).toBe('B \u00b7 your pick');
  });
});
