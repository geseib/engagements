import React, { useRef, useState } from 'react';
import Icon from './Icon';

/**
 * THE FORMAT CHOICE — ONE RADIO GROUP, TWO SKINS (docs/design/new-engagement
 * README §3.8, frames 1, 3, 4, 10, 10b).
 *
 *   gallery  TEXT cards, three across — the name and one plain line — for a
 *            host choosing for the first time (round 4: the mini pictures
 *            are gone; the pane beside draws the same pictures larger and
 *            follows the card under the pointer or focus). Build Room and
 *            Event share the sixth cell as two quieter rows under "Bigger
 *            than one session". On a phone the cards become rows (frame 10).
 *   chips    one row, for a host who knows the formats (and once a set is
 *            picked in full mode)
 *
 * ONE WIDGET MODEL either way: role="radiogroup" with a roving tabindex — one
 * tab stop (the chosen option; when none is chosen, the option marked
 * `lastUsed`, else the first — revision 31 Oct: nothing is preselected, so
 * Tab into the group lands on the last-used format and Enter/Space picks
 * it), the arrow
 * keys move AND choose, wrapping at the ends, Home and End go to the ends. In
 * the gallery ↑/↓ move by a row of cards and ←/→ by one (live dev test 3 L2).
 *
 * `collapseAfter` (a phone, frames 10/10b): only the first N formats — and the
 * chosen one (or, with none chosen, the last-used one), wherever it is — are drawn, with "More ▾" (a plain button, not
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
  const [expanded, setExpanded] = useState(false);

  const collapsed = collapseAfter > 0 && !expanded && options.length > collapseAfter + 1;
  const shown = collapsed
    ? options.filter((o, i) => i < collapseAfter || o.id === value || (!value && o.lastUsed))
    : options;
  const hiddenLabels = collapsed ? options.filter((o) => !shown.includes(o)).map((o) => o.label) : [];
  const chosenIndex = shown.findIndex((o) => o.id === value);
  /* Nothing chosen (every new engagement opens so, revision 31 Oct): the tab
     stop is the last-used format, so Title → Tab → Enter is still one key per
     decision for a host who repeats their format. */
  const lastIndex = shown.findIndex((o) => o.lastUsed);
  let tabStop = 0;
  if (chosenIndex >= 0) tabStop = chosenIndex;
  else if (lastIndex >= 0) tabStop = lastIndex;

  const choose = (index) => {
    const option = shown[index];
    if (!option || disabled) return;
    if (option.id !== value) onChange?.(option.id);
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
        {(() => {
          const renderOption = (option, i) => {
            const on = option.id === value;
            const nameId = `${idPrefix}-${option.id}-name`;
            const descId = `${idPrefix}-${option.id}-desc`;
            /* A hand-off row in the gallery: a quieter row inside the shared
               cell, described by its line and the cell's shared note (A6). */
            const row = gallery && option.handoff;
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
                  aria-describedby={gallery ? (row ? `${descId} ${idPrefix}-own` : descId) : undefined}
                  tabIndex={i === tabStop ? 0 : -1}
                  disabled={disabled}
                  className={`gsd-fmt gsd-fmt--${row ? 'row' : skin}${on ? ' is-on' : ''}`}
                  data-format={option.id}
                  onClick={() => choose(i)}
                  onKeyDown={(event) => onKeyDown(event, i)}
                  onMouseEnter={gallery ? () => onPreview?.(option.id) : undefined}
                  onFocus={gallery ? () => onPreview?.(option.id) : undefined}
                >
                  <span className="gsd-fmt-top">
                    {!gallery && <span className="gsd-fmt-mark" aria-hidden="true">{on ? <Icon name="Check" size={13} weight="bold" /> : null}</span>}
                    {option.icon && <Icon name={option.icon} size={gallery && !row ? 18 : 14} />}
                    <span className="gsd-fmt-name" id={nameId}>{option.label}</span>
                    {/* "last used", shown as "last" so seven chips fit one row (devtest O4). */}
                    {!gallery && option.lastUsed && <span className="gsd-fmt-last">last<span className="gsd-sr"> used</span></span>}
                    {gallery && on && <span className="gsd-fmt-chosen"><Icon name="Check" size={12} weight="bold" /> Chosen</span>}
                  </span>
                  {gallery && (
                    <span className="gsd-fmt-desc" id={descId}>
                      <span>{row ? (option.tag || option.short) : option.short}</span>
                      {option.lastUsed && <span className="gsd-fmt-good">You used it last.</span>}
                    </span>
                  )}
                </button>
              </React.Fragment>
            );
          };
          if (!gallery) return shown.map(renderOption);
          const handoffs = shown.map((o, i) => [o, i]).filter(([o]) => o.handoff);
          return (
            <>
              {shown.map((o, i) => (o.handoff ? null : renderOption(o, i)))}
              {handoffs.length > 0 && (
                /* One cell, two radios of the SAME group: the roving tabindex
                   and the arrows reach them as before (review A6). */
                <div className="gsd-fmt-other" role="presentation">
                  <span className="gsd-fmt-other-k" aria-hidden="true">Bigger than one session</span>
                  {handoffs.map(([o, i]) => renderOption(o, i))}
                  <span className="gsd-fmt-other-note" id={`${idPrefix}-own`}>
                    <Icon name="ArrowRight" size={12} /> each continues on its own page
                  </span>
                </div>
              )}
            </>
          );
        })()}
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
