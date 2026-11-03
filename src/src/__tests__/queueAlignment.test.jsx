/**
 * THE RUNNING ORDER'S ACTION COLUMNS ARE FIXED — QueueList + styles.css.
 *
 * The owner, on dev (3 Nov 2026): the Yours row's Edit, ↑, ↓ and 🗑 sat in
 * different columns from the automatic rows' Ask next, Ask now, ↑, ↓ and hide,
 * so the arrows did not line up down the list. Every row with actions now
 * draws the same five cells into the same named grid tracks, and a row
 * without one of them keeps the cell empty.
 *
 * NO GEOMETRY HERE: jsdom has no layout engine. What is pinned is the cell
 * structure in the DOM and the grid declaration as stylesheet TEXT
 * (comment-stripped). The pixel check is a Playwright harness run by hand.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import QueueList from '../components/stage/QueueList';

const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector) {
  const at = CSS.indexOf(`${selector} {`);
  if (at === -1) return '';
  return CSS.slice(at, CSS.indexOf('}', at));
}

const COLS = ['primary', 'up', 'down', 'drop', 'out'];
const own = { key: 'own:a1', title: 'Who is our customer', status: 'queued' };
const fn = () => {};

const renderAll = (props = {}) => render(
  <QueueList
    queue={['own:a1', 'c009#001']}
    questions={[{ id: 'c009#001', title: 'A set question', category: 'Catalogue' }]}
    upNext={[
      { source: 'own', questionId: 'own:a1', title: own.title, round: 2 },
      { source: 'queued', questionId: 'QUESTION#c009#001', title: 'A set question', round: 3 },
      { source: 'auto', questionId: 'QUESTION#c001#001', title: 'Auto one', round: 4 },
      { source: 'auto', questionId: 'QUESTION#c002#001', title: 'Auto two', round: 5 },
    ]}
    excludedRows={[{ key: 'c003#001', title: 'Vetoed' }]}
    ownQuestions={[own]}
    onMove={fn}
    onRemove={fn}
    onAutoMove={fn}
    onDisable={fn}
    onRestore={fn}
    onAskNext={fn}
    onAskNow={fn}
    onEditOwn={fn}
    onRemoveOwn={fn}
    base={1}
    nowRound={{ title: 'On screen', key: 'c000#001' }}
    {...props}
  />,
);

const cellsOf = (acts) => [...acts.children].map((c) => c.getAttribute('data-col'));
const cell = (row, col) => row.querySelector(`[data-col="${col}"]`);

describe('every row draws the same five cells, in the same order', () => {
  test('Yours, queued, automatic and disabled rows alike', () => {
    renderAll();
    const acts = screen.getAllByTestId('queue-acts');
    // 2 queued + 2 auto + 1 disabled.
    expect(acts).toHaveLength(5);
    for (const a of acts) expect(cellsOf(a)).toEqual(COLS);
  });

  test('the Yours row: Edit in the primary cell, its arrows in ↑ ↓, the bin in drop', () => {
    renderAll();
    const yours = screen.getAllByTestId('queue-row').find((r) => r.getAttribute('data-own') === 'true');
    expect(cell(yours, 'primary')).toContainElement(screen.getByTestId('queue-own-edit'));
    expect(cell(yours, 'up').querySelector('button')).toHaveAccessibleName(/earlier/i);
    expect(cell(yours, 'down').querySelector('button')).toHaveAccessibleName(/later/i);
    expect(cell(yours, 'drop')).toContainElement(screen.getByTestId('queue-own-remove'));
    // rejects: collapsing the cell a Yours row has nothing for.
    expect(cell(yours, 'out')).toBeInTheDocument();
    expect(cell(yours, 'out')).toBeEmptyDOMElement();
  });

  test('an automatic row: asks in primary, arrows in ↑ ↓, hide in drop, out kept empty', () => {
    renderAll();
    const auto = screen.getAllByTestId('queue-auto-row')[0];
    expect(cell(auto, 'primary').querySelectorAll('.setup-ask')).toHaveLength(2);
    expect(cell(auto, 'up').querySelector('button')).toHaveAccessibleName(/earlier/i);
    expect(cell(auto, 'down').querySelector('button')).toHaveAccessibleName(/later/i);
    expect(cell(auto, 'drop').querySelector('button')).toHaveAccessibleName(/disable/i);
    expect(cell(auto, 'out')).toBeEmptyDOMElement();
  });

  test('a disabled arrow keeps its cell: the first row\'s ↑ and the last row\'s ↓', () => {
    renderAll();
    const yours = screen.getAllByTestId('queue-row')[0];
    const up = cell(yours, 'up').querySelector('button');
    expect(up).toBeDisabled();
    const autos = screen.getAllByTestId('queue-auto-row');
    const lastDown = cell(autos[autos.length - 1], 'down').querySelector('button');
    expect(lastDown).toBeDisabled();
  });

  test('which tracks exist is a fact about the list, set once on the section', () => {
    const { container } = renderAll();
    const section = container.querySelector('.setup-q');
    for (const c of ['setup-q--c-asks', 'setup-q--c-move', 'setup-q--c-drop', 'setup-q--c-out']) {
      expect(section.classList.contains(c)).toBe(true);
    }
  });

  test('the phone list (no arrows) keeps the same five cells', () => {
    const { container } = renderAll({ variant: 'touch', onMove: null, onAutoMove: null, onDisable: null, onRestore: null });
    for (const a of screen.getAllByTestId('queue-acts')) expect(cellsOf(a)).toEqual(COLS);
    expect(container.querySelector('.setup-q').classList.contains('setup-q--c-move')).toBe(false);
  });
});

describe('the stylesheet: fixed, named grid tracks', () => {
  test('the action group is a grid with named primary, up, down, drop and out tracks', () => {
    const acts = block('.setup-q__acts');
    expect(acts).toMatch(/display:\s*grid/);
    expect(acts).toMatch(/grid-template-columns:\s*\[primary\][^;]*\[up\][^;]*\[down\][^;]*\[drop\][^;]*\[out\]/);
    // rejects: a flex row, where an absent button collapses its slot.
    expect(acts).not.toMatch(/display:\s*flex/);
  });

  test('each cell is placed in its named track', () => {
    for (const c of ['primary', 'up', 'down', 'drop', 'out']) {
      expect(block(`.setup-q__cell--${c}`)).toMatch(new RegExp(`grid-column:\\s*${c}\\b`));
    }
  });

  test('track widths are fixed lengths, never auto or content-sized', () => {
    expect(block('.setup-q--c-asks')).toMatch(/--setup-q-primary:\s*\d+px/);
    expect(block('.setup-q--c-edit')).toMatch(/--setup-q-primary:\s*\d+px/);
    for (const c of ['move', 'drop', 'out']) {
      expect(block(`.setup-q--c-${c}`)).toMatch(/var\(--setup-q-track\)/);
    }
    expect(block('.setup-q')).toMatch(/--setup-q-track:\s*\d+px/);
    expect(block('.setup-q__acts')).not.toMatch(/max-content|min-content|\bauto\b/);
  });

  test('the primary column fits "Ask next · Ask now" and right-aligns by margin (hard rule 9)', () => {
    // 159px measured in Chromium with Inter at 13px/700; the track leaves room.
    const w = Number(/--setup-q-primary:\s*(\d+)px/.exec(block('.setup-q--c-asks'))[1]);
    expect(w).toBeGreaterThanOrEqual(160);
    expect(block('.setup-q__cell--primary > :first-child')).toMatch(/margin-left:\s*auto/);
    expect(block('.setup-q__cell--primary')).not.toMatch(/justify-content:\s*flex-end/);
  });

  test('no cell is hidden or collapsed', () => {
    expect(CSS).not.toMatch(/\.setup-q__cell[^{]*\{[^}]*display:\s*none/);
  });

  test('the phone keeps the tracks, at 44px targets', () => {
    expect(block('.setup-q--touch')).toMatch(/--setup-q-btn:\s*44px/);
    expect(block('.setup-q--touch .setup-q__acts')).toMatch(/grid-column:\s*1\s*\/\s*-1/);
  });
});
