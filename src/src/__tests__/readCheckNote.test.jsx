/**
 * THE READ CHECK'S NOTE: ONE SMALL LINE, FOR THE HOST ONLY.
 *
 * get-ai-summary.js checks Workie's read after it is written
 * (lambda-functions/game/read-check.js) and stores what is still left as
 * ReadCheck, returned only on the host's door (tests/ai-summary-read-check.js).
 * The host sees one line — "Workie used words the room's answers don't
 * support: …" — on the two-screen console's read, in the Session panel's
 * Workie section beside Redo, and on the phone remote. Never on the stage
 * (AISummaryStatus), /present, or a player's screen.
 *
 * rejects: a note with nothing to say; a note that is not the agreed line; the
 * note on the stage; the note fetched from anywhere but the host's door or
 * with bare fetch; a failed fetch that throws; a room-facing surface importing it.
 */
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen } from '@testing-library/react';
import ReadPanel from '../components/console/panels/ReadPanel';
import WorkieSettings from '../components/stage/WorkieSettings';
import AISummaryStatus from '../components/AISummaryStatus';
import ReadCheckNote from '../components/ReadCheckNote';
import { readCheckNote, fetchReadCheck } from '../utils/readCheckClient';

const RC38 = { checked: true, rewritten: true, first: 3, issues: [{ kind: 'number', token: '15-minute' }, { kind: 'claim', token: 'strongest' }] };
const LINE = 'Workie used words the room’s answers don’t support: “15-minute”, “strongest”. Redo or edit before it goes up.';
const READ = '## What we heard\nFour answers hold the line at Friday van departure.';

describe('the line', () => {
  test('names the words the check left, in the agreed sentence', () => {
    expect(readCheckNote(RC38)).toBe(LINE);
  });
  test('says nothing when nothing is left, or there was no check', () => {
    expect(readCheckNote(null)).toBeNull();
    expect(readCheckNote({ checked: true, rewritten: false, first: 0, issues: [] })).toBeNull();
    expect(readCheckNote({ checked: true, rewriteError: true, issues: [] })).toBeNull();
  });
  test('each word once, and at most four named', () => {
    const many = { issues: ['a1', 'a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map((token) => ({ kind: 'number', token })) };
    expect(readCheckNote(many)).toContain('“d4” and 2 more.');
    expect(readCheckNote(many).match(/a1/g)).toHaveLength(1);
  });
  test('the component renders the line, or nothing', () => {
    const { container, rerender } = render(<ReadCheckNote readCheck={RC38} />);
    expect(screen.getByTestId('read-check-note')).toHaveTextContent(LINE);
    rerender(<ReadCheckNote readCheck={{ issues: [] }} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('where it shows', () => {
  test('the two-screen console\'s read carries it', () => {
    render(<ReadPanel kicker="Round 1" markdown={READ} readCheck={RC38} />);
    expect(screen.getByTestId('read-check-note')).toHaveTextContent(LINE);
  });
  test('…and not while there is no read yet, or nothing to say', () => {
    const { rerender } = render(<ReadPanel kicker="Round 1" markdown="" readCheck={RC38} />);
    expect(screen.queryByTestId('read-check-note')).toBeNull();
    rerender(<ReadPanel kicker="Round 1" markdown={READ} readCheck={null} />);
    expect(screen.queryByTestId('read-check-note')).toBeNull();
  });
  test('the Session panel\'s Workie section carries it beside Redo (the one-screen place)', () => {
    render(<WorkieSettings showNextRound={false} onRedo={() => {}} readCheck={RC38} />);
    expect(screen.getByTestId('read-check-note')).toHaveTextContent(LINE);
    expect(screen.getByTestId('read-check-note')).toHaveClass('setup-note');
  });
  test('the stage never draws it, even when the insights carry one', () => {
    render(<AISummaryStatus insights={{ markdownResponse: READ, readCheck: RC38 }} />);
    expect(screen.getByText(/Friday van departure/)).toBeInTheDocument();
    expect(screen.queryByTestId('read-check-note')).toBeNull();
    expect(document.body.textContent).not.toMatch(/don’t support/);
  });
});

describe('where it comes from', () => {
  test('the host\'s door, through the caller\'s authFetch', async () => {
    const fetchFn = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ summary: 'x', readCheck: RC38 }) }));
    await expect(fetchReadCheck({ fetchFn, apiBase: 'https://api/', gameId: '7360', questionId: '001' })).resolves.toEqual(RC38);
    expect(fetchFn).toHaveBeenCalledWith('https://api/games/7360/ai-summary/host?questionId=001');
  });
  test('a refusal, a miss or a network error is silence, never a throw', async () => {
    await expect(fetchReadCheck({ fetchFn: async () => ({ ok: false, status: 404, json: async () => ({}) }), gameId: '1' })).resolves.toBeNull();
    await expect(fetchReadCheck({ fetchFn: async () => { throw new Error('offline'); }, gameId: '1' })).resolves.toBeNull();
    await expect(fetchReadCheck({ fetchFn: async () => ({ ok: true, json: async () => ({ summary: 'x' }) }), gameId: '1' })).resolves.toBeNull();
    await expect(fetchReadCheck({ gameId: '1' })).resolves.toBeNull();
  });

  const read = (rel) => readFileSync(join(__dirname, '..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  test('the host page and the phone fetch it with authFetch', () => {
    expect(read('GameHostPage.jsx')).toMatch(/fetchReadCheck\(\{\s*fetchFn:\s*authFetch/);
    expect(read('HostRemote.jsx')).toMatch(/fetchReadCheck\(\{\s*fetchFn:\s*authFetch/);
  });
  test('no room-facing surface imports it', () => {
    for (const rel of ['PlayerPage.jsx', 'components/AISummaryStatus.jsx', 'present/usePresentation.js', 'present/presentModel.js']) {
      const src = read(rel);
      expect(src).not.toMatch(/ReadCheckNote|readCheckClient|readCheck/);
    }
  });
});
