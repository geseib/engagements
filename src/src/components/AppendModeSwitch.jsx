import React from 'react';
import './AppendModeSwitch.css';

/**
 * WHERE THE NEW QUESTIONS GO, ASKED AGAIN AT THE TOP OF THE BUILDER.
 *
 * The Add questions dialog asks this first, but the owner, inside the builder:
 * "i only see how you add more questions to the categories that exists not how
 * to instead create questions for new categories." A choice made one screen
 * ago and not visible on this one is a choice nobody knows they made — so the
 * builder shows it, and lets it be changed without going back.
 *
 * One or the other per run; the reason is stated, because "why can't I do
 * both?" is the obvious next question.
 */
export default function AppendModeSwitch({ appendTo }) {
  if (!appendTo || !appendTo.setName) return null;
  const { mode, categories = [], onModeChange } = appendTo;
  const option = (value, title, body, disabled) => (
    <label className={`append-mode__opt${mode === value ? ' is-on' : ''}`}>
      <input
        type="radio"
        name="append-mode"
        value={value}
        checked={mode === value}
        disabled={disabled}
        onChange={() => onModeChange && onModeChange(value)}
      />
      <span>
        <b>{title}</b>
        <small>{body}</small>
      </span>
    </label>
  );
  return (
    <fieldset className="append-mode" data-testid="append-mode">
      <legend>Where do the new questions go?</legend>
      <div className="append-mode__opts">
        {option(
          'existing',
          'Into this set’s categories',
          categories.length ? categories.join(' · ') : 'This set has no categories yet.',
          categories.length === 0,
        )}
        {option(
          'new',
          'Into new categories',
          'Workie invents new category names, or you name them below. The existing ones are left alone.',
          categories.length >= 24,
        )}
      </div>
      <p className="append-mode__why">
        One or the other per run — mixing them leaves the new categories thin beside the old ones. Run it twice to do both.
      </p>
    </fieldset>
  );
}
