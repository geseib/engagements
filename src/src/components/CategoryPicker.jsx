import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  MAX_MASKABLE_CATEGORIES,
  addQuestionImpact,
  canAddCategory,
  categoryIdForPosition,
  deriveCategories,
  normalizeCategoryName,
  splitByReachability,
} from '../utils/questionCategories';
import './CategoryPicker.css';

/**
 * THE CATEGORY COMBOBOX — the picker the add/edit-question modal uses.
 *
 * ── WHY A COMBOBOX AND NOT A `<select>` ────────────────────────────────────
 *
 * `docs/design/admin-container-rule.md` ("Categories"): sets run five to twenty
 * categories, so a plain select is a scroll. Type to filter, counts on every
 * row, `+ New category` pinned at the bottom and created INLINE — never a
 * second modal, because this component renders INSIDE `Modal.jsx` and a modal
 * opened from a modal is the shell proliferation that document exists to stop.
 *
 * ── THIS FILE OWNS NO LOGIC ────────────────────────────────────────────────
 *
 * Every fact it shows — the counts, the 24 cap, which categories a host can
 * actually toggle, and whether this placement moves somebody else's bit — comes
 * from `utils/questionCategories.js`, which is mutation-tested against the REAL
 * `upload-questions.js` handler. Nothing here re-derives, re-counts or
 * re-thresholds. A second implementation of "what will Save produce" is a
 * second thing to drift, and the drift is invisible: the panel keeps rendering,
 * it just stops being true.
 *
 * ── THE THREE THINGS IT HAS TO SAY OUT LOUD ────────────────────────────────
 *
 * 1. **The counts are the working copy's, not the last save's.** They come from
 *    `deriveCategories(rows)`, so a tombstoned row stops counting the moment it
 *    is tombstoned. `set.categoryCount` is a stale integer from the last save
 *    (`QuestionSetEditor.jsx:303,539`) and `GET /question-sets/{setId}/categories`
 *    serves the PERSISTED version, which the admin editor deliberately never
 *    calls (`QuestionSetEditor.jsx:530-535`). Either one would have this
 *    combobox reading "Strategy · 12" over a working copy holding 14 — a new lie
 *    in a panel whose whole design is about telling the truth about unsaved
 *    state.
 *
 * 2. **The cap is refused WITH ITS REASON.** Host toggles are packed into three
 *    eight-bit masks, so category 25 never reaches a mask
 *    (`schema-compliant-manager.js:211`, `bitPosition <= 24`, no else branch).
 *    Nothing in the backend refuses a 25th today — it is accepted, stored and
 *    silently inert. Refusing it here without saying why would be the same
 *    silence with a nicer face, so the message names the mechanism and the
 *    consequence.
 *
 * 3. **An already-over-cap set is shown honestly.** Because nothing ever
 *    refused the 25th, sets past the cap exist in the wild. Their extra
 *    categories are rendered, marked unreachable, and counted in a summary —
 *    not hidden, and not quietly rendered as if they worked.
 *
 * ── AND THE HAZARD BEHIND ALL THREE: SILENT REINDEXING ─────────────────────
 *
 * Category identity is positional and the position is first appearance in the
 * CSV, re-derived from scratch on every save. So placing this question above an
 * existing category's first appearance moves that category's bit — no new
 * category required, and the ↑/↓ row buttons can already do it today. The
 * component warns from `addQuestionImpact`, and it warns LOUDER when a category
 * falls out of the masks entirely (`evicted`) than when bits merely shuffle
 * (`moved`): shuffled bits are wrong toggles, an eviction is a category no host
 * can ever reach again. It steers to `safeInsertIndex` rather than blocking,
 * because the placement is legal and the owner may mean it.
 *
 * ── ESCAPE, AND THE MODAL UNDERNEATH ───────────────────────────────────────
 *
 * `Modal.jsx` listens for Escape on `document` and answers only for the
 * innermost modal. This component's Escape closes the DROPDOWN, so when the
 * dropdown is open the key must not also close the dialog around it: the
 * keydown handler calls `stopPropagation` on the native event, which stops the
 * bubble before it reaches the document listener. When the dropdown is shut the
 * key is left alone and the modal closes as it always did. One Escape per open
 * layer, innermost first.
 */

/** How many `moved` entries the warning names before it starts counting. */
const MOVED_SHOWN = 4;

export default function CategoryPicker({
  /**
   * The editor's working copy — the ONLY input every displayed fact is derived
   * from. Not a category list and not a count: an unsaved tombstone has to be
   * able to change what this renders, and only the rows know about it.
   */
  rows = [],
  /** The chosen category name. Controlled, so the modal owns the draft. */
  value = '',
  /** Called with a category name on select and on inline create. */
  onChange,
  /**
   * Where the row carrying this category will be spliced into `rows`. Drives
   * the reindex warning, which is otherwise unanswerable — the same category is
   * safe at one index and destructive at another. Omitted means "append", which
   * is the placement that never moves anything.
   */
  insertIndex,
  /**
   * Optional. Its presence is what turns the warning from a statement into an
   * offer: given it, the warning can hand back `safeInsertIndex` so the owner
   * fixes the placement in one click instead of being told to go and reorder
   * rows themselves. Without it the warning is advisory, which is still better
   * than blocking a placement the owner may genuinely mean.
   */
  onInsertIndexChange,
  /** id for the text input, so a `<label htmlFor>` already on screen names it. */
  id,
  /** id of the element naming this control. Wins over `label`, as in Modal.jsx. */
  labelledBy,
  /** ...or the name itself, when there is no label element to point at. */
  label,
}) {
  const generatedId = useId();
  const inputId = id || `${generatedId}-input`;
  const listId = `${generatedId}-list`;
  const optionId = (index) => `${generatedId}-opt-${index}`;
  const newOptionId = `${generatedId}-opt-new`;

  const [open, setOpen] = useState(false);
  // `null` means "not filtering" — the input shows the chosen value. A plain ''
  // cannot mean that: it is also what the owner types when they clear the box.
  const [filterText, setFilterText] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [createError, setCreateError] = useState('');

  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const createRef = useRef(null);

  /* ------------------------------------------------ everything derived, once */

  const categories = useMemo(() => deriveCategories(rows), [rows]);
  const { unreachable, overBy } = useMemo(() => splitByReachability(categories), [categories]);
  const canAdd = canAddCategory(categories);

  const query = filterText === null ? '' : filterText.trim();
  const filtered = useMemo(() => {
    if (!query) return categories;
    const needle = query.toLowerCase();
    return categories.filter((c) => c.name.toLowerCase().includes(needle));
  }, [categories, query]);

  // The `+ New category` row is the last option, so the whole list is one
  // arrow-key sequence rather than a list plus a button nobody can reach.
  const optionCount = filtered.length + 1;
  const active = Math.min(activeIndex, optionCount - 1);
  const activeIsNew = active === filtered.length;

  /**
   * What happens if this category lands at this index. Recomputed from the rows
   * rather than remembered, because the rows change underneath this component
   * every time a question is added or removed.
   */
  const impact = useMemo(() => {
    const name = normalizeCategoryName(value);
    if (!name) return null;
    return addQuestionImpact(rows, { category: name, insertIndex });
  }, [rows, value, insertIndex]);

  const capRefusal = `This set already has ${categories.length} categories. `
    + `Host toggles are packed into three eight-bit masks — HostMask1-8, HostMask9-16, `
    + `HostMask17-24 — so only the first ${MAX_MASKABLE_CATEGORIES} can ever be turned on `
    + `by a host. A ${categories.length + 1}th would be saved, but nobody could toggle it `
    + `and its questions would never reach a live session.`;

  /* --------------------------------------------------------------- behaviour */

  const closeList = useCallback(() => {
    setOpen(false);
    setCreating(false);
    setCreateError('');
    setFilterText(null);
  }, []);

  const choose = useCallback((name) => {
    if (onChange) onChange(name);
    closeList();
  }, [onChange, closeList]);

  const startCreating = useCallback(() => {
    if (!canAdd) {
      // The refusal is already on screen; repeating it into the live region is
      // what makes the click feel answered rather than swallowed.
      setCreateError(capRefusal);
      return;
    }
    setCreateError('');
    setDraftName(query);
    setCreating(true);
  }, [canAdd, capRefusal, query]);

  const commitCreate = useCallback(() => {
    const name = normalizeCategoryName(draftName);
    if (!name) {
      setCreateError('A category needs a name before it can be added.');
      return;
    }
    // Re-asked at commit time and not trusted to the disabled row: reusing an
    // existing name is always allowed, even over the cap, and only a genuinely
    // new one costs a bit position.
    const isNew = !categories.some((c) => c.name === name);
    if (isNew && !canAdd) {
      setCreateError(capRefusal);
      return;
    }
    choose(name);
  }, [draftName, categories, canAdd, capRefusal, choose]);

  const cancelCreating = useCallback(() => {
    setCreating(false);
    setCreateError('');
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Focus follows the inline row into existence, so `+ New category` is one
  // gesture and not "click, then find the box".
  useEffect(() => {
    if (creating && createRef.current) createRef.current.focus();
  }, [creating]);

  // A dropdown with no way to dismiss it but Escape would sit open over the
  // rest of the dialog. Mousedown rather than click so the list is gone before
  // whatever was clicked reacts.
  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) closeList();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open, closeList]);

  const activateOption = useCallback((index) => {
    if (index >= filtered.length) {
      startCreating();
      return;
    }
    choose(filtered[index].name);
  }, [filtered, startCreating, choose]);

  const onInputKeyDown = (event) => {
    if (event.key === 'Escape') {
      // Only when there is something of ours to close. A shut dropdown leaves
      // the key alone so Modal.jsx's document listener closes the dialog.
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      closeList();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((active + 1) % optionCount);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(optionCount - 1);
        return;
      }
      setActiveIndex((active - 1 + optionCount) % optionCount);
      return;
    }
    if (event.key === 'Enter') {
      if (!open) return;
      event.preventDefault();
      activateOption(active);
    }
  };

  const onCreateKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitCreate();
      return;
    }
    if (event.key === 'Escape') {
      // Cancels the inline row and stops there: the dropdown is still open and
      // the dialog is still open, and each gets its own press.
      event.preventDefault();
      event.stopPropagation();
      cancelCreating();
    }
  };

  /* ------------------------------------------------------------ the warning */

  const movedSummary = (moved) => {
    const shown = moved.slice(0, MOVED_SHOWN)
      .map((m) => `${m.name} ${categoryIdForPosition(m.from)} → ${categoryIdForPosition(m.to)}`)
      .join(', ');
    const rest = moved.length - MOVED_SHOWN;
    return rest > 0 ? `${shown}, and ${rest} more` : shown;
  };

  const renderImpact = () => {
    if (!impact) return null;
    const { moved, evicted } = impact.impact;
    if (!moved.length && !evicted.length) return null;

    const steer = onInsertIndexChange ? (
      <button
        type="button"
        className="btn-secondary btn-small qs-cat-steer"
        onClick={() => onInsertIndexChange(impact.safeInsertIndex)}
      >
        Put this question where nothing moves
      </button>
    ) : null;

    // An eviction is not a louder kind of move, it is a different outcome: a
    // moved bit points at the wrong category, an evicted one points at nothing
    // and can never be turned on again. Hence `alert` against `status`.
    if (evicted.length) {
      const names = evicted.map((e) => e.name).join(', ');
      return (
        <p className="qs-cat-impact qs-cat-impact--evicted" role="alert">
          <strong>
            Placing “{impact.name}” here pushes {names} past the 24 host-mask bits.
          </strong>{' '}
          No host could ever toggle {evicted.length === 1 ? 'it' : 'them'} again, and
          {evicted.length === 1 ? ' its' : ' their'} questions would never reach a live
          session started from this version. {moved.length} categor
          {moved.length === 1 ? 'y changes' : 'ies change'} position in all:{' '}
          {movedSummary(moved)}. {steer}
        </p>
      );
    }

    return (
      <p className="qs-cat-impact qs-cat-impact--moved" role="status">
        Placing “{impact.name}” here moves {moved.length} existing categor
        {moved.length === 1 ? 'y' : 'ies'} to different host-mask positions:{' '}
        {movedSummary(moved)}. A host toggle saved against the old position would turn on
        the wrong category. {steer}
      </p>
    );
  };

  /* ----------------------------------------------------------------- render */

  const naming = labelledBy
    ? { 'aria-labelledby': labelledBy }
    : (label ? { 'aria-label': label } : {});

  return (
    <div className="qs-cat-picker" ref={rootRef}>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        className="form-input qs-cat-input"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-activedescendant={
          open && !creating ? (activeIsNew ? newOptionId : optionId(active)) : undefined
        }
        value={filterText === null ? value : filterText}
        onChange={(event) => {
          const next = event.target.value;
          setFilterText(next);
          setActiveIndex(0);
          setOpen(true);
          setCreating(false);
          // EMPTYING THE BOX CLEARS THE CHOICE. Typing a name only filters —
          // free text minting a category on a fresh host-mask bit is the bug
          // this control exists to stop — but without this branch a category,
          // once set, could never be unset, and the required-field check
          // downstream would be unreachable on any set whose seed is non-empty.
          if (next === '' && value !== '' && onChange) onChange('');
        }}
        onKeyDown={onInputKeyDown}
        onClick={() => setOpen(true)}
        {...naming}
      />

      {open && (
        <ul className="qs-cat-list" id={listId} role="listbox" aria-label="Categories">
          {filtered.map((c, index) => (
            <li
              key={c.name}
              id={optionId(index)}
              role="option"
              aria-selected={c.name === value}
              className={[
                'qs-cat-option',
                index === active && !creating ? 'active' : '',
                c.reachable ? '' : 'unreachable',
              ].filter(Boolean).join(' ')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(c.name)}
            >
              <span className="qs-cat-name">{c.name} · {c.count}</span>
              {!c.reachable && (
                <span className="qs-cat-flag">unreachable — no host can toggle it</span>
              )}
            </li>
          ))}

          {filtered.length === 0 && (
            <li className="qs-cat-empty">No category here matches “{query}”.</li>
          )}

          {creating ? (
            <li className="qs-cat-create">
              <label className="qs-cat-create-label" htmlFor={`${generatedId}-new`}>
                New category name
              </label>
              <input
                ref={createRef}
                id={`${generatedId}-new`}
                type="text"
                className="form-input"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={onCreateKeyDown}
              />
              <button type="button" className="btn-primary btn-small" onClick={commitCreate}>
                Add category
              </button>
              <button type="button" className="btn-secondary btn-small" onClick={cancelCreating}>
                Cancel
              </button>
            </li>
          ) : (
            <li
              id={newOptionId}
              role="option"
              aria-selected={false}
              aria-disabled={!canAdd}
              className={[
                'qs-cat-option qs-cat-new',
                activeIsNew ? 'active' : '',
                canAdd ? '' : 'refused',
              ].filter(Boolean).join(' ')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={startCreating}
            >
              <span className="qs-cat-name">+ New category</span>
              {!canAdd && <span className="qs-cat-refusal">{capRefusal}</span>}
            </li>
          )}
        </ul>
      )}

      {createError && <p className="qs-cat-error" role="alert">{createError}</p>}

      {overBy > 0 && (
        <p className="qs-cat-overcap">
          {overBy} of this set’s {categories.length} categories —{' '}
          {unreachable.map((c) => c.name).join(', ')} — sit past the{' '}
          {MAX_MASKABLE_CATEGORIES} bits the host masks hold. They are stored and they
          count, but no host can toggle them, so their questions never reach a live session.
        </p>
      )}

      {renderImpact()}
    </div>
  );
}
