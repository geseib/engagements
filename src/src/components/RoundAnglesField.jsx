import React from 'react';
import { normalizeGameType } from '../config/gameTypes';
import { ROUND_ANGLES, ANGLE_GAME_TYPES } from '../config/roundAngles';

/**
 * A Workie's own round-angle weights (spec:
 * docs/superpowers/specs/2026-09-24-workie-round-angles-design.md).
 *
 * `value` is the override — `{ race: 60 }` — or null/undefined for the house
 * mix. An empty box uses that angle's house weight (shown as the
 * placeholder); 0 turns the angle off. `onChange(null)` means "back to the
 * house mix", which the save sends as `angleWeights: null` to clear it.
 *
 * Renders inside the editor's existing `.pmgr` form, with its own classes
 * (`form-group`, `form-row`, `form-help`, `btn-secondary`) — no new sheet.
 */
export default function RoundAnglesField({ gameType, value, onChange }) {
  if (!ANGLE_GAME_TYPES.includes(normalizeGameType(gameType))) return null;

  const current = value && typeof value === 'object' ? value : {};
  const hasOverride = Object.keys(current).length > 0;

  const setAngle = (key, raw) => {
    const next = { ...current };
    if (raw === '') {
      delete next[key];
    } else {
      const n = Number(raw);
      // Refused, not rounded: the server refuses 1.5 and 101 too, and a box
      // that silently turned 1.5 into 1 would save something nobody typed.
      if (!Number.isInteger(n) || n < 0 || n > 100) return;
      next[key] = n;
    }
    onChange(Object.keys(next).length ? next : null);
  };

  return (
    <div className="form-group round-angles-group">
      <label>Round angles</label>
      <small className="form-help">
        Each round, Workie picks one angle to talk about, at random by these weights. The same
        angle never runs two rounds in a row, and the final round leans toward the race. Leave a
        box empty for the house weight shown; 0 turns an angle off.
      </small>
      <div className="form-row">
        {ROUND_ANGLES.map((a) => (
          <div className="form-group" key={a.key}>
            <label htmlFor={`round-angle-${a.key}`} title={a.help}>{a.label}</label>
            <input
              id={`round-angle-${a.key}`}
              data-angle={a.key}
              type="number"
              min="0"
              max="100"
              step="1"
              inputMode="numeric"
              placeholder={String(a.house)}
              value={Object.prototype.hasOwnProperty.call(current, a.key) ? String(current[a.key]) : ''}
              onChange={(e) => setAngle(a.key, e.target.value)}
            />
          </div>
        ))}
      </div>
      <button type="button" className="btn-secondary" disabled={!hasOverride} onClick={() => onChange(null)}>
        Use the house mix
      </button>
    </div>
  );
}
