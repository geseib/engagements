/**
 * THE NEEDS-YOU LINE (components/needs/NeedsYouLine.jsx; experience plan
 * §4.3, Phase 1a) and the socket frame that feeds it.
 *
 * // rejects: the owner's 1 Nov report, "this was nowhere visible for the host
 * //          in two screen mode": a name request now turns the line under the
 * //          main button amber, named, with Let them / Not now / See in People.
 * // rejects: a socket frame that only refetched (GameHostPage's old handler):
 * //          the line changes in the same render as the frame, before any
 * //          network answer.
 */
import React, { useState } from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import NeedsYouLine from '../components/needs/NeedsYouLine';
import { needsYou, markHandoverRequested } from '../config/needsYou';

const asker = (name, at = new Date().toISOString()) => ({ name, handover: { requested: true, requestedAt: at } });

describe('calm, soon or amber, at one height', () => {
  test('calm: "Nothing needs you now.", no buttons, a polite live region', () => {
    render(<NeedsYouLine needs={needsYou({})} onAct={() => {}} />);
    const line = screen.getByTestId('needs-line');
    expect(line).toHaveAttribute('data-level', 'calm');
    expect(line).toHaveTextContent('Nothing needs you now.');
    expect(within(line).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByTestId('needs-line-text')).toHaveAttribute('aria-live', 'polite');
  });

  test('amber: the name, the detail and the three answers; each reaches onAct', () => {
    const onAct = jest.fn();
    render(<NeedsYouLine needs={needsYou({ players: [asker('Sam')] })} onAct={onAct} />);
    const line = screen.getByTestId('needs-line');
    expect(line).toHaveAttribute('data-level', 'now');
    expect(line.className).toMatch(/is-now/);
    expect(line).toHaveTextContent('Sam wants their name on a new device');
    fireEvent.click(screen.getByRole('button', { name: 'Let them: Sam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now: Sam' }));
    fireEvent.click(screen.getByRole('button', { name: 'See in People' }));
    expect(onAct.mock.calls.map((c) => [c[0].name, c[1]])).toEqual([['Sam', 'let'], ['Sam', 'notnow'], ['Sam', 'see']]);
  });

  test('soon: the late item in plain words with Review, not amber', () => {
    const onAct = jest.fn();
    render(<NeedsYouLine needs={needsYou({ late: { notReviewed: 2, answers: 2 } })} onAct={onAct} />);
    const line = screen.getByTestId('needs-line');
    expect(line).toHaveAttribute('data-level', 'soon');
    expect(line.className).not.toMatch(/is-now/);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ kind: 'late' }), 'review');
  });

  test('a failed read: Retry and Redo on the line', () => {
    render(<NeedsYouLine needs={needsYou({ readFailure: { headline: 'Timed out' } })} onAct={() => {}} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeInTheDocument();
  });

  test('more than one: the first, and how many more', () => {
    render(<NeedsYouLine needs={needsYou({ players: [asker('Sam'), asker('Ana')], late: { notReviewed: 1, answers: 1 } })} onAct={() => {}} />);
    expect(screen.getByTestId('needs-line')).toHaveTextContent('+2 more in Needs you');
  });

  test("a refused grant shows the server's sentence, read aloud", () => {
    render(<NeedsYouLine needs={needsYou({ players: [asker('Sam')] })} onAct={() => {}} error="That request has already changed. Look again." />);
    expect(screen.getByRole('alert')).toHaveTextContent('That request has already changed. Look again.');
  });
});

describe('Let them arms in place while the first device still answers', () => {
  test('first press arms "Let them anyway", the second goes ahead; it disarms after six seconds', () => {
    jest.useFakeTimers();
    const onAct = jest.fn();
    const live = { name: 'Sam', deviceConnected: true, handover: { requested: true, requestedAt: new Date().toISOString() } };
    render(<NeedsYouLine needs={needsYou({ players: [live] })} onAct={onAct} />);
    fireEvent.click(screen.getByRole('button', { name: 'Let them: Sam' }));
    expect(onAct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Let them anyway: Sam' }));
    expect(onAct).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sam' }), 'let');
    fireEvent.click(screen.getByRole('button', { name: 'Let them: Sam' }));
    act(() => { jest.advanceTimersByTime(6100); });
    expect(screen.getByRole('button', { name: 'Let them: Sam' })).toBeInTheDocument();
    jest.useRealTimers();
  });
});

describe('the socket frame updates the line in the same render tick', () => {
  /* The page's handler, reduced to what it does to the line: flag the row
     from the frame, then refetch. The refetch here never resolves, so any
     change on screen came from the frame alone. */
  function Harness({ onFrame }) {
    const [players, setPlayers] = useState([{ name: 'Sam', handover: {} }, { name: 'Ana', handover: {} }]);
    onFrame.current = (data) => {
      setPlayers((prev) => markHandoverRequested(prev, data.playerName));
      return new Promise(() => {});
    };
    return <NeedsYouLine needs={needsYou({ players })} onAct={() => {}} />;
  }

  test('calm before the frame, amber and named right after it', () => {
    const onFrame = { current: null };
    render(<Harness onFrame={onFrame} />);
    expect(screen.getByTestId('needs-line')).toHaveAttribute('data-level', 'calm');
    act(() => { onFrame.current({ type: 'handoverRequested', playerName: 'Sam' }); });
    expect(screen.getByTestId('needs-line')).toHaveAttribute('data-level', 'now');
    expect(screen.getByTestId('needs-line')).toHaveTextContent('Sam wants their name on a new device');
  });

  test('GameHostPage flags the row from the frame before it refetches', () => {
    const host = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    const at = host.indexOf("webSocketClient.onMessage('handoverRequested'");
    const body = host.slice(at, at + 500);
    expect(body).toMatch(/setPlayers\(\(prev\) => markHandoverRequested\(prev, asker,/);
    expect(body.indexOf('markHandoverRequested')).toBeLessThan(body.indexOf('fetchPlayers('));
  });

  test('the console mounts the line under Your part now, and the bell gets the session', () => {
    const host = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(host).toMatch(/needs=\{<NeedsYouLine needs=\{needs\} onAct=\{onNeedsAct\}/);
    expect(host).toMatch(/bellSession: needsBell/);
  });
});
