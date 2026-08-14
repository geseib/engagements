import React from 'react';
import Icon from './Icon';

/**
 * The small lock/unlock icon on a field.
 *
 * The owner: *"unless locked, a small icon lock/unlock on cells."*
 *
 * It sits beside the field's own label and toggles one key in the builder's
 * `locked` set. That set is sent with the drafting request, so the lock is not
 * a decoration on top of a request that ignores it: the server never offers the
 * model a slot for a locked field, strips the key if it appears anyway, and
 * `utils/fieldDrafting.applyFieldDraft` refuses it a third time on the way back
 * into the form.
 *
 * A TOGGLE, ANNOUNCED AS ONE. `aria-pressed` is what tells a screen reader this
 * is a two-state control rather than an action, and the accessible name says
 * which field it governs — there are four or five of these on a form and "Lock"
 * five times over is unusable. The state is in the name too, because
 * `aria-pressed` alone is read out inconsistently and the icon is not read at
 * all.
 */
export default function FieldLock({ field, label, locked, onToggle }) {
  const isLocked = Boolean(locked);
  return (
    <button
      type="button"
      className={`field-lock${isLocked ? ' is-locked' : ''}`}
      aria-pressed={isLocked}
      aria-label={isLocked
        ? `${label} is locked — the AI helper will not change it. Unlock it.`
        : `${label} is unlocked — the AI helper may fill it in or refine it. Lock it.`}
      title={isLocked
        ? `Locked. The AI helper leaves ${label} alone.`
        : `Unlocked. The AI helper may propose ${label}.`}
      data-testid={`field-lock-${field}`}
      onClick={() => onToggle(field)}
    >
      <Icon
        name={isLocked ? 'Lock' : 'LockOpen'}
        weight={isLocked ? 'fill' : 'bold'}
        size={14}
        color="currentColor"
      />
    </button>
  );
}
