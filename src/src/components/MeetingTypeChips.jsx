import React from 'react';
import Icon from './Icon';

/**
 * "PLANNING A…" (docs/design/new-engagement frames 1, 1b, 2). Meeting types,
 * because people say "retro", not "ideas and priorities". Each chip is a
 * suggestion: pressing it chooses a format, and the live line under it says
 * why in one sentence (config/formatGuide.js MEETING_TYPES). Any format can
 * still be picked.
 *
 * Toggle buttons (aria-pressed), not a radio group: pressing one is an action
 * that chooses a FORMAT, and the format group is the radio group. The pressed
 * chip carries a tick as well as its border.
 */
export default function MeetingTypeChips({ types = [], value = '', onPick, idPrefix = 'gsd-meet' }) {
  if (types.length === 0) return null;
  return (
    <div className="gsd-meet" role="group" aria-labelledby={`${idPrefix}-label`}>
      <span className="gsd-meet-label" id={`${idPrefix}-label`}>Planning a…</span>
      {types.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            className={`gsd-meet-chip${on ? ' is-on' : ''}`}
            aria-pressed={on}
            onClick={() => onPick?.(t)}
          >
            {on && <Icon name="Check" size={12} weight="bold" />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
