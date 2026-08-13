import React from 'react';
import Icon from './Icon';
import './RoundKindPicker.css';
import {
  ROUND_KIND_LIST,
  ROUND_KINDS,
  MAX_ROUND_KIND_BRIEF,
  resolveRoundKind,
  roundKindGaps,
} from '../config/roundKinds';

/**
 * WHAT WILL THE ROOM DO? — the direction control.
 *
 * This is the second of the two questions that used to be conflated into one.
 * The topic cards answer *what is this set about*; this answers *what is the
 * room asked to do with each item*. Bolting a dropdown beside the topic cards
 * was the shape the owner sketched; it is not enough on its own, because the
 * two controls are answering genuinely different questions and the picker has
 * to make that separation visible or the operator will read it as a sixth
 * topic.
 *
 * WHY THE COPY IS AS LONG AS IT IS. Someone opening this for the first time has
 * to pick correctly with no context, and the pair that will be got wrong is
 * APPLY vs IMPROVE: mechanically they are identical — hand the room a passage,
 * ask for work on it — and they differ only by who wrote the passage. So each
 * card states what you HAND them, not only what the room does, and the selected
 * card expands into a "pick this when" line written around the ownership
 * distinction. A one-line dropdown cannot carry that and the wrong choice is
 * expensive: it is the whole reason the reported defect exists.
 *
 * A11y and testability, one decision serving both: this is a real radiogroup of
 * real radio inputs with visible labels, not clickable divs. jsdom has no layout
 * engine, so every assertion about this component is about roles, names and
 * checked state — never about where anything sits.
 */
function RoundKindPicker({
  value,
  onChange,
  brief = '',
  onBriefChange,
  instruction = '',
  onInstructionChange,
  idPrefix = 'round-kind',
  headingId,
}) {
  const selected = resolveRoundKind(value);
  const kind = ROUND_KINDS[selected];
  const isCustom = selected === 'custom';
  // Only the custom path can be incomplete — it carries no house direction and
  // no house instruction, so the operator supplies both. Naming the missing
  // box beats disabling a button and saying nothing.
  const gaps = roundKindGaps(selected, { brief, instruction: onInstructionChange ? instruction : 'n/a' });

  return (
    <div className="round-kind-picker">
      <div
        className="round-kind-options"
        role="radiogroup"
        aria-labelledby={headingId}
        aria-label={headingId ? undefined : 'What the room does with each item'}
      >
        {ROUND_KIND_LIST.map((option) => {
          const inputId = `${idPrefix}-${option.id}`;
          const active = option.id === selected;
          return (
            <label
              key={option.id}
              htmlFor={inputId}
              className={`round-kind-option${active ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                id={inputId}
                name={idPrefix}
                value={option.id}
                checked={active}
                onChange={() => onChange(option.id)}
                className="round-kind-radio"
              />
              <span className="round-kind-option-icon" aria-hidden="true">
                <Icon
                  name={option.icon}
                  weight={active ? 'fill' : 'duotone'}
                  size={20}
                  color={active ? 'var(--rkp-accent)' : 'var(--rkp-muted)'}
                />
              </span>
              <span className="round-kind-option-body">
                <span className="round-kind-option-label">{option.label}</span>
                <span className="round-kind-option-blurb">{option.blurb}</span>
              </span>
            </label>
          );
        })}
      </div>

      {/* The selected kind, unpacked. `handThem` leads because it is the field
          that separates Apply from Improve, and it is the one a first-time
          reader needs in front of them at the moment of choosing. */}
      <div className="round-kind-detail" data-kind={selected}>
        <dl className="round-kind-facts">
          <div className="round-kind-fact">
            <dt>You hand them</dt>
            <dd>{kind.handThem}</dd>
          </div>
          <div className="round-kind-fact">
            <dt>The work is</dt>
            <dd>{kind.theWork}</dd>
          </div>
        </dl>
        <p className="round-kind-when">
          <Icon name="Info" weight="fill" size={14} color="var(--rkp-muted)" /> {kind.pickWhen}
        </p>
      </div>

      {isCustom && (
        <div className="round-kind-custom">
          <div className="form-group">
            <label htmlFor={`${idPrefix}-brief`}>What should this round do?</label>
            <textarea
              id={`${idPrefix}-brief`}
              value={brief}
              onChange={(e) => onBriefChange && onBriefChange(e.target.value)}
              rows="3"
              maxLength={MAX_ROUND_KIND_BRIEF}
              placeholder="e.g. Hand them two competing proposals and ask which one they would fund, and what they would cut to pay for it."
              className="form-textarea"
            />
            <small className="help-text">
              This goes to the generator in place of the house direction, word for word.
              It steers the shape of every question. {brief.length}/{MAX_ROUND_KIND_BRIEF} characters.
            </small>
          </div>

          {onInstructionChange && (
            <div className="form-group">
              <label htmlFor={`${idPrefix}-instruction`}>What is the room told?</label>
              <input
                id={`${idPrefix}-instruction`}
                type="text"
                value={instruction}
                onChange={(e) => onInstructionChange(e.target.value)}
                placeholder="e.g. Pick one and say what you would cut to pay for it."
                className="form-input"
              />
              <small className="help-text">
                Shown on screen while they answer. The four named kinds supply their own;
                this one is yours to write, because a generic line is what made the old
                sets confusing.
              </small>
            </div>
          )}

          {gaps.length > 0 && (
            <p className="round-kind-gap" role="status">
              <Icon name="Warning" weight="fill" size={14} color="var(--rkp-accent)" />{' '}
              {gaps.includes('brief') && 'The generator has no direction to follow until you describe the round. '}
              {gaps.includes('instruction') && 'The room will be shown no instruction until you write one.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default RoundKindPicker;
