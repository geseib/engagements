import React, { useRef, useState } from 'react';
import Icon from './Icon';
import FormatPreview from './FormatPreview';

/**
 * THE FORMAT CHOICE — ONE RADIO GROUP, TWO SKINS (docs/design/new-engagement
 * README §3.8, frames 1, 3, 4).
 *
 *   gallery  cards with a still preview, the name, one plain line and "Good
 *            for", for a host choosing for the first time
 *   chips    one row, for a host who knows the formats (and once a set is
 *            picked in full mode)
 *
 * ONE WIDGET MODEL either way: role="radiogroup" with a roving tabindex — one
 * tab stop (the chosen option, or the first when none is chosen), the arrow
 * keys move AND choose, wrapping at the ends, Home and End go to the ends. The
 * visual review asked for exactly this; the old pills were seven tab stops
 * with aria-pressed.
 *
 * SELECTION IS NEVER COLOUR ALONE: a tick and a 2px border on the chosen
 * option, and the word "Chosen" on a card.
 *
 * Each option: { id, label, icon, short, good, handoff, lastUsed }.
 * onChange(id) chooses; the picker plays a card's preview once on hover,
 * focus or choice.
 */
export default function FormatPicker({
  options = [],
  value = '',
  onChange,
  skin = 'chips',
  disabled = false,
  labelledBy,
  idPrefix = 'gsd-fmt',
}) {
  const refs = useRef([]);
  const [plays, setPlays] = useState({});
  const replay = (id) => setPlays((p) => ({ ...p, [id]: (p[id] || 0) + 1 }));
  const chosenIndex = options.findIndex((o) => o.id === value);
  const tabStop = chosenIndex >= 0 ? chosenIndex : 0;

  const choose = (index) => {
    const option = options[index];
    if (!option || disabled) return;
    if (option.id !== value) {
      onChange?.(option.id);
      replay(option.id);
    }
  };

  const onKeyDown = (event, index) => {
    const n = options.length;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % n;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + n) % n;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = n - 1;
    else if (event.key === ' ' || (event.key === 'Enter' && !event.metaKey && !event.ctrlKey)) {
      event.preventDefault();
      choose(index);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    choose(next);
    refs.current[next]?.focus?.();
  };

  const gallery = skin === 'gallery';
  return (
    <div
      className={`gsd-fmt-group gsd-fmt-group--${skin}`}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-disabled={disabled || undefined}
    >
      {options.map((option, i) => {
        const on = option.id === value;
        const nameId = `${idPrefix}-${option.id}-name`;
        const descId = `${idPrefix}-${option.id}-desc`;
        return (
          <React.Fragment key={option.id}>
            {/* Build Room and Event continue on their own page: a rule sets them apart in the chip row. */}
            {!gallery && option.handoff && i > 0 && !options[i - 1].handoff && <span className="gsd-fmt-sep" aria-hidden="true" />}
            <button
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-labelledby={nameId}
              aria-describedby={gallery ? descId : undefined}
              tabIndex={i === tabStop ? 0 : -1}
              disabled={disabled}
              className={`gsd-fmt gsd-fmt--${skin}${on ? ' is-on' : ''}`}
              data-format={option.id}
              onClick={() => choose(i)}
              onKeyDown={(event) => onKeyDown(event, i)}
              onMouseEnter={gallery ? () => replay(option.id) : undefined}
              onFocus={gallery ? () => replay(option.id) : undefined}
            >
              {gallery && (
                <span className="gsd-fmt-art">
                  <FormatPreview format={option.id} play={plays[option.id] || 0} />
                  {on && <span className="gsd-fmt-chosen"><Icon name="Check" size={12} weight="bold" /> Chosen</span>}
                </span>
              )}
              <span className="gsd-fmt-top">
                {!gallery && <span className="gsd-fmt-mark" aria-hidden="true">{on ? <Icon name="Check" size={13} weight="bold" /> : null}</span>}
                {option.icon && <Icon name={option.icon} size={gallery ? 18 : 15} />}
                <span className="gsd-fmt-name" id={nameId}>{option.label}</span>
                {!gallery && option.lastUsed && <span className="gsd-fmt-last">last used</span>}
              </span>
              {gallery && (
                <span className="gsd-fmt-desc" id={descId}>
                  <span>{option.short}</span>
                  {option.good && <span className="gsd-fmt-good">Good for: {option.good}</span>}
                  {option.handoff && <span className="gsd-fmt-own">Continues on its own page</span>}
                  {option.lastUsed && <span className="gsd-fmt-good">You used it last.</span>}
                </span>
              )}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
