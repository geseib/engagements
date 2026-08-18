import React from 'react';
import Icon from './Icon';

/**
 * THE FILTER BAR — the presentational third of the list-controls mechanism
 * (config/listControls.js is the logic, hooks/useListControls.js the state).
 *
 * NO STYLESHEET OF ITS OWN, ON PURPOSE. Every selector in this repo is
 * namespaced under its screen's scope class (`.qsets`, `.sp`, `.um` — design
 * rule: never declare a bare `.btn`/`.chip`), and the sets and sessions bars
 * were already pixel-identical twins under different prefixes
 * (QuestionSetsPanel.css:134-156, SessionsPanel.css:99-121). So this component
 * takes the SCOPE as a prop and renders the class names verbatim — the
 * `Modal.jsx` precedent — and each screen's own stylesheet keeps styling it:
 *
 *   scope="qsets" → .qsets-filters / .qsets-search / .qsets-input /
 *                   .qsets-select / .qsets-count
 *
 * WHAT IS DECLARED VIA PROPS, so the markup cannot drift between screens:
 *
 *   - `search`:  `{ value, onChange(text), ariaLabel, placeholder }`, or
 *                omitted for a bar with no search box;
 *   - `selects`: `[{ key, value, onChange(value), ariaLabel,
 *                options: [{ value, label }] }]`, rendered in array order —
 *                a filter axis and a sort select are the same control here,
 *                the caller decides what the change means;
 *   - `count`:   the "41 sets · 3 shown" line;
 *   - `children`: a trailing slot, so a screen can keep another control in
 *                the bar (SessionsPanel's Delete-all lives beside its list
 *                deliberately — see that file).
 *
 * Every control keeps a DISTINCT aria-label: three unlabeled comboboxes in a
 * row are indistinguishable to a screen reader and to every test that has to
 * address them.
 *
 * PromptLibraryPanel does NOT render through this component: its controls use
 * the legacy global classes (`.filter-select`/`.search-input`) and their DOM
 * order is addressed positionally by three tests — see its header, which
 * refuses the rename. It shares the logic and hook halves only.
 */
export default function ListControls({ scope, search, selects = [], count, children }) {
  return (
    <div className={`${scope}-filters`}>
      {search && (
        <div className={`${scope}-search`}>
          <Icon name="MagnifyingGlass" weight="bold" size={14} color="var(--muted)" />
          <input
            type="search"
            className={`${scope}-input`}
            aria-label={search.ariaLabel}
            placeholder={search.placeholder}
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
          />
        </div>
      )}

      {selects.map((select) => (
        <select
          key={select.key || select.ariaLabel}
          className={`${scope}-input ${scope}-select`}
          aria-label={select.ariaLabel}
          value={select.value}
          onChange={(event) => select.onChange(event.target.value)}
        >
          {select.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ))}

      {count != null && <span className={`${scope}-count`}>{count}</span>}

      {children}
    </div>
  );
}
