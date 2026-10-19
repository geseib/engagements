/**
 * AN EARLY ADVANCE ASKS IN PLACE (walk on dev, session 3343, W3; controller
 * ruling 16 Oct 2026). "Proceed to voting? Only 2 of 3 players have
 * answered…" was the old light confirm modal, out of place on the dusk
 * console. roundStep now arms the primary in place, the way Start round N
 * mid-read does: the first press turns "Start voting" into "Start voting
 * anyway" with "1 of 3 still writing. Press again to start voting." above it;
 * a second press within six seconds proceeds. The host page asks no more.
 * rejects: the modal coming back; one press advancing a room that is still
 * writing; an armed button that never lets go.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HostActionBar from '../components/HostActionBar';
import { roundStep } from '../config/roundStep';

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const host = stripComments(fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8'));
const bodyOf = (name) => {
  const start = host.indexOf(`const ${name} = async`);
  return host.slice(start, host.indexOf('\n  };\n', start));
};

test('the host page no longer asks with a modal before voting or results', () => {
  expect(host).not.toMatch(/Proceed to Voting/);
  expect(bodyOf('handleFinishQuestion')).not.toMatch(/showConfirmation/);
  expect(bodyOf('handleShowResults')).not.toMatch(/showConfirmation/);
});

test('first press arms "Start voting anyway" with the count; the second, within 6 s, acts', () => {
  jest.useFakeTimers();
  const step = roundStep('ANSWERING', {
    gameType: 'call-and-answer', roundNoun: 'Round', playerCount: 3, answerCount: 2,
    progress: { received: 2, total: 3, allIn: false },
  });
  const onAction = jest.fn();
  const controls = { primary: step.primary, secondary: null, status: step.status };
  render(<HostActionBar controls={controls} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: /Start voting/ }));
  expect(onAction).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Start voting anyway/ })).toBeInTheDocument();
  expect(screen.getByRole('alert').textContent).toBe('1 of 3 still writing. Press again to start voting.');
  fireEvent.click(screen.getByRole('button', { name: /Start voting anyway/ }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'open-vote' }));
  // Armed and left alone, it lets go after six seconds.
  fireEvent.click(screen.getByRole('button', { name: /Start voting/ }));
  act(() => { jest.advanceTimersByTime(6100); });
  expect(screen.queryByRole('button', { name: /anyway/ })).toBeNull();
  jest.useRealTimers();
});

// review #38 (test 5b908b65, session 7360): Show results pressed with 2 of 4
// voted armed the button; the last ballots landed, the same button dropped its
// `arm`, and the bar read the warning from nothing: "Cannot read properties of
// undefined (reading 'text')", a blank host page. It now lets go instead.
test('an armed button that stops needing a second press lets go, and the bar keeps drawing', () => {
  const early = roundStep('VOTING', {
    gameType: 'call-and-answer', roundNoun: 'Round', playerCount: 4, answerCount: 4,
    progress: { received: 2, total: 4, allIn: false },
  });
  const allIn = roundStep('VOTING', {
    gameType: 'call-and-answer', roundNoun: 'Round', playerCount: 4, answerCount: 4,
    progress: { received: 4, total: 4, allIn: true },
  });
  expect(early.primary.arm).toBeTruthy();
  expect(allIn.primary.id).toBe(early.primary.id);
  expect(allIn.primary.arm).toBeFalsy();
  const onAction = jest.fn();
  const { rerender, container } = render(<HostActionBar controls={{ primary: early.primary, secondary: null, status: early.status }} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: early.primary.label }));
  expect(onAction).not.toHaveBeenCalled();
  expect(container.querySelector('.host-action-bar__armed')).not.toBeNull();
  // The last ballots land: same button, no arm. No crash, no stale warning.
  rerender(<HostActionBar controls={{ primary: allIn.primary, secondary: null, status: allIn.status }} onAction={onAction} />);
  expect(container.querySelector('.host-action-bar__armed')).toBeNull();
  // One press now acts.
  fireEvent.click(screen.getByRole('button', { name: allIn.primary.label }));
  expect(onAction).toHaveBeenCalledTimes(1);
});
