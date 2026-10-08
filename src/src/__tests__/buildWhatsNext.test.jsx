/**
 * WHAT'S NEXT AND DECIDED — buildroom/BuildWhatsNext.jsx
 * (docs/design/build-room-host-flow H1, H5; build-room-combine-and-stage P1, P2).
 *
 * Between asks the host sees Claude's line and the moves, most likely first,
 * the lead one focused; the right column lists every decided ask with a tick,
 * and the ticked ones combine into one prompt the host edits.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useNextFocus } from '../buildroom/useNextFocus';
import { WhatsNext, DecidedList, decidedAnswer } from '../buildroom/BuildWhatsNext';

const NOW = Date.parse('2026-10-07T15:00:00.000Z');
const decided = [
  { askId: '001', prompt: 'What are we building?', status: 'decided', decidedAt: '2026-10-07T14:30:00Z', decision: { direction: 'An app', method: 'vote' } },
  { askId: '002', prompt: 'Who is it for?', status: 'decided', decidedAt: '2026-10-07T14:40:00Z', decision: { direction: 'Who is it for: Everyone', method: 'host' } },
];

test('What\'s next: the lead move is focused and says what it does', () => {
  const onMove = jest.fn();
  render(<WhatsNext room={{ asks: decided, ideas: [], agent: { connected: true }, log: [] }} now={NOW} ticked={new Set(['001', '002'])} onMove={onMove} />);
  const lead = screen.getByRole('button', { name: 'Combine' });
  expect(document.activeElement).toBe(lead);
  expect(lead).toHaveAttribute('data-next-primary');
  fireEvent.click(lead);
  expect(onMove).toHaveBeenCalledWith('combine');
  expect(screen.getByText('Claude is ready for the next step')).toBeInTheDocument();
  expect(screen.getByText('Combine 2 decided answers')).toBeInTheDocument();
});

test('What\'s next: every move is one row, and only the lead is the primary', () => {
  const onMove = jest.fn();
  render(<WhatsNext room={{ asks: [], ideas: [], agent: { connected: true }, log: [] }} now={NOW} ticked={new Set()} onMove={onMove} />);
  const list = screen.getByRole('list', { name: "What's next" });
  expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'Ask it' })).toHaveAttribute('data-next-primary');
  expect(screen.getByRole('button', { name: 'New ask' })).not.toHaveAttribute('data-next-primary');
  fireEvent.click(screen.getByRole('button', { name: 'Write' }));
  expect(onMove).toHaveBeenCalledWith('tell');
});

test('What\'s next never takes the focus from a box the host is typing in', () => {
  const box = document.createElement('textarea');
  document.body.appendChild(box);
  box.focus();
  render(<WhatsNext room={{ asks: [], ideas: [], agent: { connected: true }, log: [] }} now={NOW} ticked={new Set()} onMove={jest.fn()} />);
  expect(document.activeElement).toBe(box);
  box.remove();
});

test('Decided: one row per decided ask with a tick; the bar adds the ticked ones', () => {
  const setTicked = jest.fn();
  const onCombine = jest.fn();
  render(<DecidedList asks={decided} ticked={new Set(['001'])} setTicked={setTicked} used={{}} onCombine={onCombine} />);
  expect(screen.getByRole('checkbox', { name: /What are we building/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /Who is it for/ })).not.toBeChecked();
  expect(screen.getByText('Everyone')).toBeInTheDocument();
  expect(screen.getByText('Ask 1 · What are we building?')).toBeInTheDocument();
  expect(screen.getByText('By vote')).toBeInTheDocument();
  expect(screen.getByText("The host's pick")).toBeInTheDocument();
  expect(screen.getByText('1 ticked')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add to the prompt' }));
  expect(onCombine).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Who is it for/ }));
  expect([...setTicked.mock.calls[0][0]].sort()).toEqual(['001', '002']);
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(setTicked.mock.calls[1][0].size).toBe(0);
});

test('Decided: no bar while nothing is ticked, and oldest first', () => {
  render(<DecidedList asks={[...decided].reverse()} ticked={new Set()} setTicked={jest.fn()} used={{}} onCombine={jest.fn()} />);
  expect(screen.queryByRole('button', { name: 'Add to the prompt' })).toBeNull();
  const boxes = screen.getAllByRole('checkbox');
  expect(boxes[0]).toHaveAccessibleName(/What are we building/);
});

test('a used answer says In a prompt', () => {
  render(<DecidedList asks={decided} ticked={new Set()} setTicked={jest.fn()} used={{ '001': '2026-10-07T14:41:00Z' }} onCombine={jest.fn()} />);
  expect(screen.getByText(/In a prompt · \d{1,2}:\d{2}/)).toBeInTheDocument();
});

test('an empty Decided says so', () => {
  render(<DecidedList asks={[]} ticked={new Set()} setTicked={jest.fn()} used={{}} onCombine={jest.fn()} />);
  expect(screen.getByText(/Nothing decided yet/)).toBeInTheDocument();
});

test('decidedAnswer: the answer alone, never the question again', () => {
  expect(decidedAnswer(decided[0])).toBe('An app');
  expect(decidedAnswer(decided[1])).toBe('Everyone');
  expect(decidedAnswer({ prompt: 'Name the app', decision: { direction: 'Summit' } })).toBe('Summit');
});

test('What\'s next on the host\'s screen: Claude\'s line is not about the host', () => {
  const room = { asks: [], ideas: [], agent: { connected: true }, log: [{ by: 'agent', kind: 'progress', text: 'Header B is live.', createdAt: '2026-10-07T14:50:00Z' }] };
  render(<WhatsNext room={room} now={NOW} ticked={new Set()} onMove={jest.fn()} />);
  expect(screen.getByText('It finished: Header B is live.')).toBeInTheDocument();
  expect(screen.queryByText(/The host will choose/)).toBeNull();
});

test('What\'s next: a paused Claude points at the Continue prompt only when it is on the screen', () => {
  const room = { asks: [], ideas: [], agent: { connected: false, listening: false, lastSeenAt: '2026-10-07T14:40:00Z' }, log: [] };
  const { rerender } = render(<WhatsNext room={room} now={NOW} ticked={new Set()} onMove={jest.fn()} continueOn />);
  expect(screen.getByText('Copy the Continue prompt to pick it up.')).toBeInTheDocument();
  rerender(<WhatsNext room={room} now={NOW} ticked={new Set()} onMove={jest.fn()} />);
  expect(screen.queryByText(/Continue prompt/)).toBeNull();
});

test('Decided: ticking does not pull the focus when the lead move changes', () => {
  function Harness() {
    const [ticked, setTicked] = React.useState(new Set());
    return (
      <>
        <WhatsNext room={{ asks: decided, ideas: [], agent: { connected: true }, log: [] }} now={NOW} ticked={ticked} onMove={jest.fn()} />
        <DecidedList asks={decided} ticked={ticked} setTicked={setTicked} used={{}} onCombine={jest.fn()} />
      </>
    );
  }
  render(<Harness />);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ask it' }));
  const box = screen.getByRole('checkbox', { name: /What are we building/ });
  box.focus();
  fireEvent.click(box);
  expect(box).toBeChecked();
  expect(screen.getByRole('button', { name: 'Combine' })).toHaveAttribute('data-next-primary');
  expect(document.activeElement).toBe(box);
  fireEvent.click(box);
  expect(document.activeElement).toBe(box);
});

test('Decided: clicking anywhere on the row toggles the tick; the checkbox toggles once', () => {
  const setTicked = jest.fn();
  render(<DecidedList asks={decided} ticked={new Set()} setTicked={setTicked} used={{}} onCombine={jest.fn()} />);
  fireEvent.click(screen.getByText('An app'));
  expect([...setTicked.mock.calls[0][0]]).toEqual(['001']);
  fireEvent.click(screen.getByRole('checkbox', { name: /Who is it for/ }));
  expect(setTicked).toHaveBeenCalledTimes(2);
});

test('Decided: an ended session has no row click', () => {
  const setTicked = jest.fn();
  render(<DecidedList asks={decided} ticked={new Set()} setTicked={setTicked} used={{}} onCombine={jest.fn()} ended />);
  fireEvent.click(screen.getByText('An app'));
  expect(setTicked).not.toHaveBeenCalled();
});

describe('useNextFocus: a step that arrives under a dialog still gets the focus when it closes', () => {
  function Step({ stepKey }) {
    const ref = React.useRef(null);
    useNextFocus(ref, stepKey);
    return <div ref={ref}><button type="button" data-next-primary>Close and show results</button></div>;
  }
  test('Modal puts the focus back on the opener; the step takes it from there', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    const modal = document.createElement('div');
    modal.className = 'brm-modal';
    document.body.appendChild(modal);
    const { rerender } = render(<Step stepKey="a" />);
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Close and show results' }));
    modal.remove();
    opener.focus(); // what Modal does as it unmounts
    rerender(<Step stepKey="a" />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close and show results' }));
    opener.remove();
  });
  test('typing inside the dialog (Enter in its Question box) defers, never cancels', () => {
    const modal = document.createElement('div');
    modal.className = 'brm-modal';
    const input = document.createElement('input');
    input.type = 'text';
    modal.appendChild(input);
    document.body.appendChild(modal);
    input.focus();
    const { rerender } = render(<Step stepKey="c" />);
    expect(document.activeElement).toBe(input);
    modal.remove();
    rerender(<Step stepKey="c" />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close and show results' }));
  });
  test('but never while the host is typing', () => {
    const box = document.createElement('textarea');
    document.body.appendChild(box);
    const modal = document.createElement('div');
    modal.className = 'brm-modal';
    document.body.appendChild(modal);
    const { rerender } = render(<Step stepKey="b" />);
    modal.remove();
    box.focus();
    rerender(<Step stepKey="b" />);
    expect(document.activeElement).toBe(box);
    box.remove();
  });
});
