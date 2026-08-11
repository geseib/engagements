import React from 'react';
import './RemoteCategoryList.css';
import Icon from './Icon';

/**
 * Which categories the running game may still draw from, on the host's phone.
 *
 * Rows come from `config/setupPanel.js:categoryRows` — THE one decode of the
 * category bitmask, deliberately reused rather than reimplemented. That module
 * exists because the decode had already been written twice, byte for byte, in
 * two places that could drift apart silently; the phone would have been a third.
 *
 * A row is only togglable when it is `live` — that is, when the game has the
 * `STATE#CATS` / `STATE#CATS#COUNTS` records the toggle endpoint updates. Before
 * a session starts those records do not exist, the stage panel is editing a
 * local Set instead, and a POST from here would have nothing to write. Disabled
 * with the reason printed, rather than a button that returns 200 and changes
 * nothing.
 */
export default function RemoteCategoryList({
  rows = [],
  live = false,
  busy = false,
  onToggle,
}) {
  if (rows.length === 0) {
    return <p className="hr-hint">No categories in this set.</p>;
  }

  return (
    <div className="hrc">
      {!live && (
        <p className="hr-hint hrc-hint">
          Categories become adjustable once the session has dealt its first round.
        </p>
      )}

      <ul className="hrc-list">
        {rows.map((row) => (
          <li key={row.position}>
            <button
              className={`hrc-row ${row.enabled ? 'is-on' : ''}`}
              type="button"
              // Exhausted AND off is the one combination the stage panel also
              // refuses: turning on a category with no questions left cannot
              // yield a round.
              disabled={!live || busy || (row.exhausted && !row.enabled)}
              aria-pressed={row.enabled}
              onClick={() => onToggle(row)}
            >
              <Icon
                name={row.enabled ? 'CheckCircle' : 'Circle'}
                weight={row.enabled ? 'fill' : 'bold'}
                size={20}
                color={row.enabled ? 'var(--success)' : 'var(--muted)'}
              />
              <span className="hrc-name">{row.name}</span>
              <span className="hrc-count">
                {row.exhausted ? 'none left' : `${row.remaining} left`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
