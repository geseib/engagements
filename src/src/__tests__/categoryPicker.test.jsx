/**
 * THE CATEGORY COMBOBOX — components/CategoryPicker.jsx
 *
 * The control's job is not "let someone pick a string". It is to make three
 * facts visible BEFORE Save that are currently invisible until after it:
 *
 *   - what the working copy will actually import (counts, tombstones and all),
 *   - that only the first 24 categories can ever be toggled by a host, and
 *   - that putting a question here can move somebody else's bit.
 *
 * So the assertions below are about what the control SAYS, not how it looks.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine: "the list is below the
 * input", "the list is visible", "the create row is at the bottom" are all
 * unfalsifiable here and would pass against any implementation. Position in the
 * option list is asserted as ORDER in the accessibility tree, which is real.
 *
 * NO LOGIC IS RE-ASSERTED HERE. `__tests__/questionCategories.test.js` already
 * pins the derivation against the real `upload-questions.js` handler. This file
 * only pins that the component asks that module and shows the answer.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CategoryPicker from '../components/CategoryPicker';
import Modal from '../components/Modal';

const { blankRow } = require('../utils/questionRows');

/** A working-copy row. `origin: 'loaded'` so tombstones survive. */
const row = (category, title, extra = {}) =>
  blankRow({ origin: 'loaded', category, title, ...extra });

/** n categories, one importable row each, in order. */
const manyRows = (n) =>
  Array.from({ length: n }, (_, i) => row(`Cat${String(i + 1).padStart(2, '0')}`, `q${i + 1}`));

/** Alpha(0), Alpha(1), Beta(2), Gamma(3) — the fixture the logic suite uses. */
const baseRows = () => [
  row('Alpha', 'a1'),
  row('Alpha', 'a2'),
  row('Beta', 'b1'),
  row('Gamma', 'g1'),
];

/** Controlled, because the picker is: the modal owns the draft category. */
function Harness({ rows, initial = '', onChange, ...rest }) {
  const [value, setValue] = useState(initial);
  return (
    <CategoryPicker
      rows={rows}
      value={value}
      label="Category"
      onChange={(name) => { setValue(name); if (onChange) onChange(name); }}
      {...rest}
    />
  );
}

const combobox = () => screen.getByRole('combobox');
const openList = () => fireEvent.click(combobox());
const optionTexts = () => screen.getAllByRole('option').map((o) => o.textContent);
const optionText = (prefix) => optionTexts().find((t) => t.startsWith(prefix));
const newRow = () => screen.getByRole('option', { name: /\+ New category/ });

/* ------------------------------------------------------------------ filtering */

describe('type to filter', () => {
  const rows = [
    row('Strategy', 's1'),
    row('Culture', 'c1'),
    row('Customer Ops', 'o1'),
    row('Risk', 'r1'),
  ];

  test('typing narrows the list to the categories that match', () => {
    // rejects: rendering every category regardless of what was typed. That is
    // the `<select>` the design note rejected wearing an input's clothes — at
    // the twenty categories these sets run to, an unfiltered list is a scroll,
    // and the scroll is the entire reason this is a combobox.
    render(<Harness rows={rows} />);
    openList();
    fireEvent.change(combobox(), { target: { value: 'cu' } });
    expect(optionTexts()).toEqual(['Culture · 1', 'Customer Ops · 1', '+ New category']);
  });

  test('the filter ignores case', () => {
    // rejects: a case-sensitive `includes`. Category names here are capitalised
    // and people type lower case; a miss sends the owner to `+ New category`,
    // and because the IMPORTER is case-sensitive (upload-questions.js:731 uses
    // `===`) "strategy" then becomes a SECOND category holding a second bit
    // position — the exact silent duplication this control exists to prevent.
    render(<Harness rows={rows} />);
    openList();
    fireEvent.change(combobox(), { target: { value: 'STRAT' } });
    expect(optionTexts()).toEqual(['Strategy · 1', '+ New category']);
  });

  test('a filter that matches nothing still offers + New category', () => {
    // rejects: filtering the pinned create row out along with the categories.
    // "I typed a name and nothing came back" is precisely when the owner needs
    // to create one, and it is the moment a naive `options.filter` removes it.
    render(<Harness rows={rows} />);
    openList();
    fireEvent.change(combobox(), { target: { value: 'Zzz' } });
    expect(optionTexts()).toEqual(['+ New category']);
    expect(screen.getByText(/No category here matches/)).toBeTruthy();
  });
});

/* --------------------------------------------------------------------- counts */

describe('the counts come from the working copy', () => {
  /**
   * Four rows carry "Strategy" and only two of them will ever reach the
   * importer: one is tombstoned (`rowsToCsv` drops it) and one has no title
   * (`upload-questions.js:493` skips it). So the naive count is 4, the stored
   * count from the last save would be whatever it was then, and the truth is 2.
   */
  const mixed = () => [
    row('Strategy', 's1'),
    row('Strategy', 's2', { removed: true }),
    row('Strategy', '', { title: '' }),
    row('Strategy', 's4'),
    row('Culture', 'c1'),
  ];

  test('the count is what will import, not how many rows carry the name', () => {
    // rejects: `rows.filter((r) => r.category === name).length`, and equally
    // `set.categoryCount` (QuestionSetEditor.jsx:303,539) or
    // GET /question-sets/{setId}/categories — every one of which says 4 here.
    // A combobox reading "Strategy · 4" over a working copy that will save 2 is
    // a new lie in the one panel whose design is about telling the truth about
    // unsaved state.
    render(<Harness rows={mixed()} />);
    openList();
    expect(optionTexts()).toEqual(['Strategy · 2', 'Culture · 1', '+ New category']);
  });

  test('an unsaved edit moves the count immediately', () => {
    // THE test a stale source cannot pass. rejects: deriving once at mount and
    // holding it — the shape any cached, fetched or last-saved count has. The
    // rows change under this component on every add and remove in the panel
    // around it, and a count that does not follow is stale within one gesture.
    const { rerender } = render(<Harness rows={mixed()} />);
    openList();
    expect(optionText('Strategy')).toBe('Strategy · 2');

    rerender(<Harness rows={[...mixed(), row('Strategy', 's5')]} />);
    expect(optionText('Strategy')).toBe('Strategy · 3');
  });

  test('tombstoning a category’s last live row removes it from the list', () => {
    // rejects: a count that follows the working copy while the LIST does not.
    // A fully-tombstoned category never reaches the CSV, so it holds no bit
    // position and everything after it moves up; offering it as a choice would
    // promise a position Save will not create.
    const { rerender } = render(<Harness rows={[row('Solo', 'x1'), row('Keep', 'k1')]} />);
    openList();
    expect(optionTexts()).toEqual(['Solo · 1', 'Keep · 1', '+ New category']);

    rerender(<Harness rows={[row('Solo', 'x1', { removed: true }), row('Keep', 'k1')]} />);
    expect(optionTexts()).toEqual(['Keep · 1', '+ New category']);
  });
});

/* ------------------------------------------------------------ inline creation */

describe('+ New category, created in place', () => {
  const rows = [row('Strategy', 's1')];

  test('the row becomes a text input and no second dialog is opened', () => {
    // THE container rule: "never open a second modal from inside a modal"
    // (docs/design/admin-container-rule.md). rejects: reaching for a nested
    // dialog — this control renders INSIDE Modal.jsx, and a second Modal would
    // take the Escape key and the focus trap off the dialog the owner is
    // filling in. The listbox staying mounted is the "in place" half.
    render(<Harness rows={rows} />);
    openList();
    fireEvent.click(newRow());
    expect(screen.getByLabelText('New category name')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  test('it prefills with whatever was already typed', () => {
    // rejects: opening an empty box. The owner reaches `+ New category` by
    // typing a name that did not match; making them type it a second time is
    // how the two spellings diverge, and two spellings are two bit positions.
    render(<Harness rows={rows} />);
    openList();
    fireEvent.change(combobox(), { target: { value: 'Operations' } });
    fireEvent.click(newRow());
    expect(screen.getByLabelText('New category name')).toHaveValue('Operations');
  });

  test('the created name is handed back and the list closes', () => {
    const onChange = jest.fn();
    render(<Harness rows={rows} onChange={onChange} />);
    openList();
    fireEvent.click(newRow());
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: '  Ops  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));

    // rejects: handing back the raw cell. The importer trims every cell
    // (upload-questions.js:453), so "  Ops  " and "Ops" are ONE category there
    // and would be two here — an untrimmed name promises a position that Save
    // will not create.
    expect(onChange).toHaveBeenCalledWith('Ops');
    expect(combobox()).toHaveValue('Ops');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  test('Enter in the inline row commits it', () => {
    const onChange = jest.fn();
    render(<Harness rows={rows} onChange={onChange} />);
    openList();
    fireEvent.click(newRow());
    const box = screen.getByLabelText('New category name');
    fireEvent.change(box, { target: { value: 'Ops' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('Ops');
  });

  test('a nameless category is refused', () => {
    // rejects: committing ''. A blank category makes the row unimportable
    // (upload-questions.js:493 needs BOTH title and category) and it would be
    // accepted silently — the row simply never appears after Save.
    const onChange = jest.fn();
    render(<Harness rows={rows} onChange={onChange} />);
    openList();
    fireEvent.click(newRow());
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/needs a name/);
  });
});

/* ------------------------------------------------------------------- the cap */

describe('the 24 cap, refused with its reason', () => {
  test('at 24 categories creation is refused and the refusal says why', () => {
    // rejects: a disabled row with no explanation, a tooltip, or — worst and
    // current — silent acceptance. Nothing in upload-questions.js,
    // edit-question-set.js or csvPreflight.js refuses a 25th today: it is
    // stored, counted and untoggleable forever. "Limit reached" would be the
    // same silence with a nicer face, so the mechanism (three eight-bit masks)
    // and the consequence (nobody can toggle it) both have to be on screen.
    render(<Harness rows={manyRows(24)} />);
    openList();
    const created = newRow();
    expect(created).toHaveAttribute('aria-disabled', 'true');
    expect(created.textContent).toMatch(/only the first 24 can ever be turned on by a host/);
    expect(created.textContent).toMatch(/nobody could toggle it/);
    expect(created.textContent).toMatch(/three eight-bit masks/);
  });

  test('the refused row does not open the inline input', () => {
    // rejects: showing the reason and letting the creation through anyway — a
    // warning that does not stop anything is how the 25th category gets made.
    const onChange = jest.fn();
    render(<Harness rows={manyRows(24)} onChange={onChange} />);
    openList();
    fireEvent.click(newRow());
    expect(screen.queryByLabelText('New category name')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('at 23 categories the 24th may still be created', () => {
    // rejects: an off-by-one that fires a category early. Position 23 is the
    // last one `schema-compliant-manager.js:211` writes into a mask, so the
    // 24th is legitimate and refusing it would be as wrong as allowing the 25th.
    render(<Harness rows={manyRows(23)} />);
    openList();
    expect(newRow()).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(newRow());
    expect(screen.getByLabelText('New category name')).toBeTruthy();
  });

  test('an existing category is still choosable at the cap', () => {
    // rejects: gating SELECTION on the cap instead of CREATION. Reusing a
    // category costs no bit position, and a picker that refuses to let anyone
    // file a question at 24 categories would make every such set unusable.
    const onChange = jest.fn();
    render(<Harness rows={manyRows(24)} onChange={onChange} />);
    openList();
    fireEvent.click(screen.getByRole('option', { name: /Cat07/ }));
    expect(onChange).toHaveBeenCalledWith('Cat07');
  });
});

/* ---------------------------------------------------------- already over cap */

describe('a set that is already over the cap', () => {
  test('the categories past 24 are shown, and shown as unreachable', () => {
    // rejects: hiding them, truncating the list at 24, or rendering them like
    // every other row. Sets over the cap exist in the wild precisely because
    // nothing ever refused one; the owner cannot fix what the picker pretends
    // is fine. Cat24 is asserted CLEAN in the same breath, so a flag applied to
    // everything cannot pass this.
    render(<Harness rows={manyRows(27)} />);
    openList();
    expect(optionText('Cat24 ·')).toBe('Cat24 · 1');
    expect(optionText('Cat25 ·')).toMatch(/unreachable — no host can toggle it/);
    expect(optionText('Cat27 ·')).toMatch(/unreachable/);
  });

  test('the summary counts them and names them', () => {
    // rejects: a per-row flag with no total. Three separate marks scattered
    // down a 27-row list do not add up to "this set is three categories over
    // what a host can reach", which is the sentence the owner has to act on.
    render(<Harness rows={manyRows(27)} />);
    const summary = screen.getByText(/sit past the 24 bits the host masks hold/);
    expect(summary.textContent).toMatch(/3 of this set’s 27 categories/);
    expect(summary.textContent).toMatch(/Cat25, Cat26, Cat27/);
  });

  test('an in-range set says nothing about reachability', () => {
    // rejects: a summary that always renders, which trains the owner to ignore
    // the one that matters.
    render(<Harness rows={manyRows(24)} />);
    expect(screen.queryByText(/sit past the 24 bits/)).toBeNull();
  });
});

/* --------------------------------------------------------- the reindex warning */

describe('the reindex warning', () => {
  test('an unsafe placement names every bit it moves, and is not an alert', () => {
    // rejects: a warning that fires only for NEW categories. Gamma already
    // exists; placing a second Gamma row above Gamma's own first appearance
    // moves Gamma's bit AND everything it jumps over, with no new category
    // involved — the same reindex the ↑/↓ row buttons can already cause today.
    // The ids are named because "positions changed" is not actionable and
    // "Alpha c001 → c002" is.
    render(<Harness rows={baseRows()} initial="Gamma" insertIndex={0} />);
    const note = screen.getByRole('status');
    expect(note.textContent).toMatch(/Alpha c001 → c002/);
    expect(note.textContent).toMatch(/Beta c002 → c003/);
    expect(note.textContent).toMatch(/Gamma c003 → c001/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a safe placement is silent', () => {
    // rejects: warning on every add. Gamma at index 3 is past Beta's first
    // appearance and moves nothing, and a warning that is always on screen is
    // one the owner stops reading before the one that matters arrives.
    render(<Harness rows={baseRows()} initial="Gamma" insertIndex={3} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('appending is silent even for a category that is new', () => {
    // rejects: treating "new category" as the trigger rather than "positions
    // moved". Appending is the placement the design note mandates and it is
    // safe by construction.
    render(<Harness rows={baseRows()} initial="Delta" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('an eviction is louder than a move, and says what is lost', () => {
    // rejects: collapsing `evicted` into `moved`. A moved bit points at the
    // wrong category and the owner can still fix it; an evicted one points at
    // nothing — Cat24 falls off the end of `schema-compliant-manager.js:211`'s
    // final branch, which has no else, so no host can ever toggle it again. The
    // ROLE is the assertion that carries: `alert` interrupts, `status` does not,
    // and an implementation that gives both outcomes the same role fails here
    // and in the moved test above at the same time.
    render(<Harness rows={manyRows(25)} initial="Cat25" insertIndex={0} />);
    const note = screen.getByRole('alert');
    expect(note.textContent).toMatch(/pushes Cat24 past the 24 host-mask bits/);
    expect(note.textContent).toMatch(/No host could ever toggle it again/);
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('it offers the safe placement rather than blocking the unsafe one', () => {
    // rejects: disabling the choice. The placement is legal and the owner may
    // mean it; the fix is to hand back `safeInsertIndex` — 3 here, just past
    // Beta's first appearance, NOT a blind rows.length — so one click undoes it.
    const onInsertIndexChange = jest.fn();
    render(
      <Harness
        rows={baseRows()}
        initial="Gamma"
        insertIndex={0}
        onInsertIndexChange={onInsertIndexChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /where nothing moves/ }));
    expect(onInsertIndexChange).toHaveBeenCalledWith(3);
  });

  test('with no way to move the row, it states the impact and offers nothing', () => {
    // rejects: rendering a steer button the parent cannot honour, which is a
    // control that silently does nothing when pressed.
    render(<Harness rows={baseRows()} initial="Gamma" insertIndex={0} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /where nothing moves/ })).toBeNull();
  });
});

/* ------------------------------------------------------- keyboard and ARIA */

describe('it behaves like a combobox', () => {
  const rows = [row('Alpha', 'a1'), row('Beta', 'b1')];

  test('it reports whether it is expanded and which option is active', () => {
    // rejects: a listbox with no aria-activedescendant. Focus never leaves the
    // input, so without it a screen reader user arrowing down hears nothing
    // change and has no way to know what Enter will pick.
    render(<Harness rows={rows} />);
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(combobox(), { key: 'ArrowDown' });
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');
    const [alpha, beta] = screen.getAllByRole('option');
    expect(combobox().getAttribute('aria-activedescendant')).toBe(alpha.id);

    fireEvent.keyDown(combobox(), { key: 'ArrowDown' });
    expect(combobox().getAttribute('aria-activedescendant')).toBe(beta.id);
  });

  test('Enter chooses the active option', () => {
    const onChange = jest.fn();
    render(<Harness rows={rows} onChange={onChange} />);
    fireEvent.keyDown(combobox(), { key: 'ArrowDown' });
    fireEvent.keyDown(combobox(), { key: 'ArrowDown' });
    fireEvent.keyDown(combobox(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('Beta');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  test('the arrow keys reach the pinned create row', () => {
    // rejects: keeping `+ New category` outside the arrow sequence — a button
    // below the list, say — which makes creating a category mouse-only while
    // choosing one is not.
    render(<Harness rows={rows} />);
    fireEvent.keyDown(combobox(), { key: 'ArrowUp' });
    expect(combobox().getAttribute('aria-activedescendant')).toBe(newRow().id);
    fireEvent.keyDown(combobox(), { key: 'Enter' });
    expect(screen.getByLabelText('New category name')).toBeTruthy();
  });
});

/* ------------------------------------------------ Escape, inside a real Modal */

describe('Escape, with Modal.jsx underneath', () => {
  const mountInModal = (props = {}) => {
    const onClose = jest.fn();
    render(
      <Modal overlayClassName="ov" contentClassName="ct" onClose={onClose} label="Add a question">
        <Harness rows={[row('Alpha', 'a1'), row('Beta', 'b1')]} {...props} />
      </Modal>
    );
    return onClose;
  };

  test('Escape closes the dropdown and leaves the dialog open; the next one closes the dialog', () => {
    // THE interaction. Modal.jsx listens for Escape on `document` and answers
    // for the innermost dialog, so a keydown that bubbles out of this input
    // reaches it. rejects: letting it bubble while the list is open — one press
    // would take the dropdown AND the half-filled question form with it. And
    // rejects the over-correction of swallowing Escape unconditionally, which
    // leaves a dialog with no keyboard way out at all: the SECOND press here is
    // what pins that, and it is the half a `stopPropagation()` with no `if
    // (!open)` guard fails.
    const onClose = mountInModal();
    openList();
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.keyDown(combobox(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(combobox(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Escape out of the inline create row lands back on the list', () => {
    // One press per open layer, innermost first. rejects: an Escape in the
    // create box that closes the whole dropdown (losing the filter the owner
    // typed) or falls through to the dialog.
    const onClose = mountInModal();
    openList();
    fireEvent.click(newRow());
    fireEvent.keyDown(screen.getByLabelText('New category name'), { key: 'Escape' });

    expect(screen.queryByLabelText('New category name')).toBeNull();
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('the dialog still traps Tab around the combobox', () => {
    // rejects: this control taking over the Tab key. Modal.jsx owns the trap
    // and answers only for the innermost dialog; a keydown handler here that
    // stopped Tab as well as Escape would punch a hole in it, and the hole
    // leads to the live host controls behind the dialog.
    const onClose = mountInModal();
    combobox().focus();
    fireEvent.keyDown(combobox(), { key: 'Tab' });
    expect(document.activeElement).toBe(combobox());
    expect(onClose).not.toHaveBeenCalled();
  });
});
