/**
 * THE REACT HALF OF `config/listControls.js` — one hook, two ownership modes.
 *
 * The three list screens split on who owns the filter state:
 *
 *   - QuestionSetsPanel and SessionsPanel own it themselves (plain useState);
 *   - PromptLibraryPanel is pure props — AIPromptManager and
 *     AIGenerationPromptEditor each hold the filters and pass
 *     `filters` / `onFilterChange` down, and that arrangement is load-bearing
 *     (the manager resets the category filter when the game type changes,
 *     from outside the panel).
 *
 * So the hook is CONTROLLED-OPTIONAL, the `<Modal>`/input convention: pass
 * `value` (+ `onChange`) and it computes over the parent's state and never
 * stores its own; omit them and it owns a useState seeded from
 * `initialListState(config)`. Either way the caller gets the same handles
 * back, so a screen can move between the modes without rewriting its markup.
 *
 * Everything it returns is computed by the pure module — the hook adds only
 * memoisation and state plumbing, and holds no second copy of any rule.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  activeFilterCount,
  applyListControls,
  clearAllPatch,
  clearPatch,
  computeDrops,
  initialListState,
} from '../config/listControls';

/**
 * @param items   the unfiltered array.
 * @param config  a listControls config. Make it referentially stable (module
 *                constant, or useMemo'd on its real inputs) — it keys the
 *                memoisation here.
 * @param options `{ value, onChange }` for parent-owned state, `initial` to
 *                seed the owned state, `labels` for drop-exit button text
 *                (`{ key: (value) => string }`).
 * @returns `{ state, set, shown, drops, activeFilterCount, clearOne, clearAll }`
 *          — `set` takes a patch (`{ type: 'trivia' }`) and either merges it
 *          into the owned state or hands the merged object to `onChange`.
 */
export default function useListControls(items, config, options = {}) {
  const { value, onChange, initial, labels } = options;

  const [ownState, setOwnState] = useState(() => ({ ...initialListState(config), ...initial }));
  const controlled = value != null;
  const state = controlled ? value : ownState;

  const set = useCallback(
    (patch) => {
      if (controlled) {
        if (onChange) onChange({ ...value, ...patch });
      } else {
        setOwnState((prev) => ({ ...prev, ...patch }));
      }
    },
    [controlled, onChange, value]
  );

  const shown = useMemo(() => applyListControls(items, config, state), [items, config, state]);
  const drops = useMemo(
    () => computeDrops(items, config, state, labels),
    [items, config, state, labels]
  );

  const clearOne = useCallback((key) => set(clearPatch(config, key)), [set, config]);
  const clearAll = useCallback(() => set(clearAllPatch(config)), [set, config]);

  return {
    state,
    set,
    shown,
    drops,
    activeFilterCount: activeFilterCount(config, state),
    clearOne,
    clearAll,
  };
}
