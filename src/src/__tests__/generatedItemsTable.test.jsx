/**
 * GeneratedItemsTable — review as a list, with per-item reject (G6).
 *
 * Pure-props component: ZERO jest.mock calls, no geometric assertions.
 *
 * What it replaces: a one-item-at-a-time carousel behind Previous/Next, with no
 * way to drop a single generated item — `handleLoadIntoSystem` sent the whole
 * array, so one bad question meant importing it and fixing it later, or
 * discarding eighty-three good ones.
 *
 * The sharpest thing to hold in place is the INDEX. Rows carry their position
 * in the caller's array, and `onToggleExclude(index)` / `onEdit(index)` are how
 * the caller edits it. A filtered view that renumbered would exclude the wrong
 * item, silently, and the operator would find out in a session.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import GeneratedItemsTable from '../components/GeneratedItemsTable';

const QUESTIONS = [
  { title: 'Which system was retired first?', category: 'Engineering', difficulty: 'medium' },
  { title: 'What did the pricing memo change?', category: 'Commercial', difficulty: 'hard' },
  { title: 'Who chaired the committee?', category: 'Governance', difficulty: 'easy' },
  { title: 'In which month did they publish?', category: 'Engineering', difficulty: 'medium' },
];

const COLUMNS = [
  { header: 'Category', value: (q) => q.category, filterable: true },
  { header: 'Difficulty', value: (q) => q.difficulty },
];

const mount = (props = {}) => render(
  <GeneratedItemsTable
    items={QUESTIONS}
    requested={QUESTIONS.length}
    noun="questions"
    primary={(q) => q.title}
    columns={COLUMNS}
    {...props}
  />
);

/** The body rows, as [number, title] pairs. */
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row')
  .slice(1)
  .map((row) => within(row).getAllByRole('cell').slice(0, 2).map((c) => c.textContent.trim()));

describe('every generated item gets a row', () => {
  test('all four are listed, numbered from one', () => {
    // rejects: reverting to the carousel, which showed exactly one item and a
    // counter. Judging eighty-four questions through a one-item window is not
    // review, it is a data-entry task.
    mount();
    const rows = bodyRows();
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual(['1', 'Which system was retired first?']);
    expect(rows[3][0]).toBe('4');
  });

  test('the header states how many will actually be saved', () => {
    // rejects: a count that ignores the exclusions, which is the number the
    // operator is deciding about.
    mount({ excluded: new Set([1, 2]), onToggleExclude: jest.fn() });
    expect(screen.getByText(/4 generated · 2 will be saved/)).toBeInTheDocument();
  });
});

describe('per-item reject', () => {
  test('the exclude button hands back the item\'s real index', () => {
    // rejects: passing the position within the RENDERED rows. With no filter
    // applied the two agree, which is why the filtered case below exists too.
    const onToggleExclude = jest.fn();
    mount({ onToggleExclude });

    const thirdRow = within(screen.getByRole('table')).getAllByRole('row')[3];
    fireEvent.click(within(thirdRow).getByRole('button', { name: /Leave out/ }));

    expect(onToggleExclude).toHaveBeenCalledWith(2);
  });

  test('AFTER FILTERING, the index is still the item\'s own', () => {
    // rejects: `visible.map((row, i) => onToggleExclude(i))`. Filter to
    // Governance and the only row on screen is item #3; a renumbering bug
    // excludes item #1 instead and nothing on screen says so.
    const onToggleExclude = jest.fn();
    mount({ onToggleExclude });

    fireEvent.change(screen.getByLabelText(/Filter these 4 questions/i), {
      target: { value: 'chaired' },
    });

    const rows = bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['3', 'Who chaired the committee?']);

    fireEvent.click(within(screen.getByRole('table')).getAllByRole('row')[1]
      .querySelector('.git-ghost'));
    expect(onToggleExclude).toHaveBeenCalledWith(2);
  });

  test('an excluded row can be put back, and says which it is', () => {
    // rejects: making exclusion one-way, or hiding excluded rows outright —
    // a choice you cannot see is a choice you cannot reverse.
    const onToggleExclude = jest.fn();
    mount({ excluded: new Set([0]), onToggleExclude });

    const firstRow = within(screen.getByRole('table')).getAllByRole('row')[1];
    expect(firstRow).toHaveClass('git-out');
    fireEvent.click(within(firstRow).getByRole('button', { name: /Put back/ }));
    expect(onToggleExclude).toHaveBeenCalledWith(0);
  });

  test('Edit drills into the caller\'s editor at the right item', () => {
    // rejects: dropping the drill-in. The carousel editor is fine as a detail
    // view; it was only ever wrong as the only view.
    const onEdit = jest.fn();
    mount({ onEdit });
    const secondRow = within(screen.getByRole('table')).getAllByRole('row')[2];
    fireEvent.click(within(secondRow).getByRole('button', { name: /Edit/ }));
    expect(onEdit).toHaveBeenCalledWith(1);
  });
});

describe('the shortfall is named', () => {
  test('asking for 100 and getting 4 says so, with both numbers', () => {
    // rejects: silence about near-duplicate suppression. The server drops
    // near-duplicate titles with a console.warn and reports nothing, so this
    // difference is the only trace the operator ever gets.
    mount({ requested: 100 });
    expect(screen.getByText(/You asked for 100 and got 4\./)).toBeInTheDocument();
    expect(screen.getByText(/near-duplicate/i)).toBeInTheDocument();
  });

  test('a full batch says nothing about a shortfall', () => {
    // rejects: warning unconditionally, which trains the operator to ignore it.
    mount({ requested: 4 });
    expect(screen.queryByText(/You asked for/)).not.toBeInTheDocument();
  });
});

describe('flags name a real defect', () => {
  const flag = (q) => (q.category === 'Governance' ? 'No correct answer could be mapped.' : null);

  test('the reason is on the row, not just a colour', () => {
    // rejects: marking a row without saying what is wrong with it — the
    // operator cannot act on a highlight.
    mount({ flag });
    expect(screen.getByText('No correct answer could be mapped.')).toBeInTheDocument();
  });

  test('"Needs attention" filters to exactly the flagged rows', () => {
    // rejects: a segment that counts flagged rows but does not filter to them.
    mount({ flag });
    fireEvent.click(screen.getByRole('button', { name: /Needs attention 1/ }));
    const rows = bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe('3');
    expect(rows[0][1]).toContain('Who chaired the committee?');
  });

  test('with nothing flagged the segment is not offered', () => {
    // rejects: an always-present "Needs attention 0" button.
    mount();
    expect(screen.queryByRole('button', { name: /Needs attention/ })).not.toBeInTheDocument();
  });
});

describe('filters', () => {
  test('the category facet narrows the table', () => {
    // rejects: rendering the select without wiring it.
    mount();
    fireEvent.change(screen.getByLabelText(/Filter by category/i), { target: { value: 'Engineering' } });
    expect(bodyRows().map((r) => r[0])).toEqual(['1', '4']);
  });

  test('a filter that matches nothing offers its own way out', () => {
    // rejects: a dead end. The console's other empty state shipped with none,
    // and that is a named defect in the plan.
    mount();
    fireEvent.change(screen.getByLabelText(/Filter these 4 questions/i), { target: { value: 'zzz' } });
    expect(screen.getByText(/None of the 4 questions match that filter/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear the filters/ }));
    expect(bodyRows()).toHaveLength(4);
  });
});
