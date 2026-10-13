import React from 'react';
import NumberBadge from './NumberBadge';
import './Card.css';

/**
 * CARD (docs/design/themes/SPEC.md §6, unit L5): a bordered surface,
 * optionally selected, optionally badged.
 *
 *   <Card>Plain content</Card>
 *   <Card selected>The one being shown</Card>
 *   <Card badge={6} head={<b>Priya</b>}>The full response…</Card>
 *
 * Props
 *   selected   true: --accent border plus the skin's --select-mark, and the
 *              class `is-selected`. The mark is never painted otherwise.
 *   badge      a number (or short text) shown as a NumberBadge at the head of
 *              the card, or a ready element rendered as given. Omit for none.
 *   head       what sits beside the badge in the head row (a name, a title).
 *              Shown only with a badge; without one, put it in children.
 *   as         the element, default 'div' ('li', 'article', 'button'…).
 *   className  appended; every other prop passes through to the element.
 *
 * Sizes are the caller's (Card.css lists the custom properties). Colours are
 * the skin's.
 */
export default function Card({ selected = false, badge, head, as: Tag = 'div', className = '', children, ...rest }) {
  const hasBadge = badge !== undefined && badge !== null && badge !== false && badge !== '';
  const cls = ['ui-card', selected ? 'is-selected' : '', className].filter(Boolean).join(' ');
  return (
    <Tag className={cls} {...rest}>
      {hasBadge ? (
        <div className="ui-card-head">
          {React.isValidElement(badge) ? badge : <NumberBadge n={badge} />}
          {head !== undefined && head !== null ? <div className="ui-card-head-text">{head}</div> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}
