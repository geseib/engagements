import React, { useRef, useState } from 'react';
import Icon from './Icon';
import FormatPreview from './FormatPreview';

/**
 * THE FORMAT CHOICE — ONE RADIO GROUP, TWO SKINS (docs/design/new-engagement
 * README §3.8, frames 1, 3, 4, 10, 10b).
 *
 *   gallery  cards with a still preview, the name, one plain line and "Good
 *            for", for a host choosing for the first time (on a phone the
 *            picture is dropped and the cards become rows, frame 10)
 *   chips    one row, for a host who knows the formats (and once a set is
 *            picked in full mode)
 *
 * ONE WIDGET MODEL either way: role="radiogroup" with a roving tabindex — one
 * tab stop (the chosen option, or the first when none is chosen), the arrow
 * keys move AND choose, wrapping at the ends, Home and End go to the ends. In
 * the gallery ↑/↓ move by a row of cards and ←/→ by one (live dev test 3 L2).
 *
 * `collapseAfter` (a phone, frames 10/10b): only the first N formats — and the
 * chosen one, wherever it is — are drawn, with "More ▾" (a plain button, not
 * an option) for the rest.
 *
 * SELECTION IS NEVER COLOUR ALONE: a tick and a 2px border on the chosen
 * option, and the word "Chosen" on a card.
 */
export default function FormatPicker({
  options = [],
  value = '',
  onChange,
  skin = 'chips',
  disabled = false,
  labelledBy,
  idPrefix = 'gsd-fmt',
  collapseAfter = 0,
  /** Enter on an option: after choosing, the caller moves on (the set search). */
  onEnter = null,
  /* The gallery card under the pointer or focus, or null when neither is
     on a card: the side pane shows that format's storyboard while nothing is
     chosen (live check, round 3). */
  onPreview = null,
}) {
  const refs = useRef([]);
  const groupRef = useRef(null);
  const [plays, setPlays] = useState({});
  const [expanded, setExpanded] = useState(false);
  const replay = (id) => setPlays((p) => ({ ...p, [id]: (p[id] || 0) + 1 }));

  const collapsed = collapseAfter > 0 && !expanded && options.length > collapseAfter + 1;
  const shown = collapsed
    ? options.filter((o, i) => i < collapseAfter || o.id === value)
    : options;
  const hiddenLabels = collapsed ? options.filter((o) => !shown.includes(o)).map((o) => o.label) : [];
  const chosenIndex = shown.findIndex((o) => o.id === value);
  const tabStop = chosenIndex >= 0 ? chosenIndex : 0;

  const choose = (index) => {
    const option = shown[index];
    if (!option || disabled) return;
    if (option.id !== value) {
      onChange?.(option.id);
      replay(option.id);
    }
  };

  /** Cards in one row of the gallery, read from the layout (1 where there is none). */
  const columns = () => {
    if (skin !== 'gallery') return 1;
    const els = refs.current.filter(Boolean);
    if (els.length < 2) return 1;
    const top = els[0].getBoundingClientRect().top;
    const perRow = els.filter((el) => el.getBoundingClientRect().top === top).length;
    // jsdom has no layout: every top is 0, and a "row" of all of them is no row.
    return perRow >= els.length ? 1 : perRow;
  };

  const onKeyDown = (event, index) => {
    const n = shown.length;
    const step = (event.key === 'ArrowDown' || event.key === 'ArrowUp') ? columns() : 1;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + step) % n;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - step + n * step) % n;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = n - 1;
    else if (event.key === ' ' || (event.key === 'Enter' && !event.metaKey && !event.ctrlKey)) {
      event.preventDefault();
      choose(index);
      if (event.key === 'Enter') onEnter?.();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    choose(next);
    refs.current[next]?.focus?.();
  };

  const gallery = skin === 'gallery';
  refs.current = [];
  return (
    <div className={`gsd-fmt-wrap gsd-fmt-wrap--${skin}`}>
      <div
        ref={groupRef}
        className={`gsd-fmt-group gsd-fmt-group--${skin}`}
        role="radiogroup"
        aria-labelledby={labelledBy}
        onMouseLeave={gallery && onPreview ? () => onPreview(null) : undefined}
        onBlur={gallery && onPreview ? (event) => {
          if (!groupRef.current || !groupRef.current.contains(event.relatedTarget)) onPreview(null);
        } : undefined}
        aria-disabled={disabled || undefined}
      >
        {shown.map((option, i) => {
          const on = option.id === value;
          const nameId = `${idPrefix}-${option.id}-name`;
          const descId = `${idPrefix}-${option.id}-desc`;
          return (
            <React.Fragment key={option.id}>
              {/* Build Room and Event continue on their own page: a rule sets them apart in the chip row. */}
              {!gallery && option.handoff && i > 0 && !shown[i - 1].handoff && <span className="gsd-fmt-sep" aria-hidden="true" />}
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
                onMouseEnter={gallery ? () => { replay(option.id); onPreview?.(option.id); } : undefined}
                onFocus={gallery ? () => { replay(option.id); onPreview?.(option.id); } : undefined}
              >
                {gallery && (
                  <span className="gsd-fmt-art">
                    <FormatPreview format={option.id} play={plays[option.id] || 0} />
                  </span>
                )}
                <span className="gsd-fmt-top">
                  {!gallery && <span className="gsd-fmt-mark" aria-hidden="true">{on ? <Icon name="Check" size={13} weight="bold" /> : null}</span>}
                  {option.icon && <Icon name={option.icon} size={gallery ? 18 : 14} />}
                  <span className="gsd-fmt-name" id={nameId}>{option.label}</span>
                  {/* "last used", shown as "last" so seven chips fit one row (devtest O4). */}
                  {!gallery && option.lastUsed && <span className="gsd-fmt-last">last<span className="gsd-sr"> used</span></span>}
                  {/* "Chosen" in the name row, never over the preview (devtest 1 V8). */}
                  {gallery && on && <span className="gsd-fmt-chosen"><Icon name="Check" size={12} weight="bold" /> Chosen</span>}
                </span>
                {gallery && (
                  <span className="gsd-fmt-desc" id={descId}>
                    <span>{option.short}</span>
                    {option.handoff && <span className="gsd-fmt-own">Continues on its own page</span>}
                    {option.lastUsed && <span className="gsd-fmt-good">You used it last.</span>}
                  </span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </div>
      {collapsed && (
        <button
          type="button"
          className={`gsd-fmt-more gsd-fmt-more--${skin}`}
          aria-expanded="false"
          onClick={() => setExpanded(true)}
        >
          {gallery ? hiddenLabels.join(', ') : 'More'}
          <Icon name="CaretDown" size={14} />
        </button>
      )}
    </div>
  );
}
