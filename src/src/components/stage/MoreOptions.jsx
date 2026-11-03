import React, { useState } from 'react';
import Icon from '../Icon';
import { moreOptionsSummary } from '../../config/setupPanel';

/**
 * ONE "MORE OPTIONS" PER SECTION (docs/design/session-menu README D2).
 *
 * Each Session menu section opens on a short default view, then this one line.
 * Closed, it names what it holds ("More options · Category switches · Put
 * aside this session (1) · Goal"), built from the labels of the groups inside
 * it (`groups`), so the line can never lie about its contents: an expander
 * that does not say what is inside is a hiding place. One per section, never
 * nested.
 *
 * Once opened it stays open for the rest of the session, per section, in this
 * viewer's browser (localStorage, every touch wrapped: a private window or
 * blocked storage just starts closed). `open` / `onOpenChange` make it
 * controlled, for Up next's "Change", which opens it on the category switches.
 */
export const MORE_WORDS = Object.freeze({
  more: 'More options',
  fewer: 'Fewer options',
});

const KEY = (section) => `engage.sessionMenu.more.${section}`;

function readStored(section) {
  try { return window.localStorage.getItem(KEY(section)) === '1'; } catch (e) { return false; }
}

/** Whether this viewer left a section's More options open (for a controlled one). */
export const moreOptionsStored = readStored;

export function writeStored(section, open) {
  try {
    if (open) window.localStorage.setItem(KEY(section), '1');
    else window.localStorage.removeItem(KEY(section));
  } catch (e) { /* storage blocked: the expander still works for this view */ }
}

export default function MoreOptions({
  section,
  groups = [],
  open: openProp,
  onOpenChange = null,
  children,
}) {
  const [openOwn, setOpenOwn] = useState(() => readStored(section));
  const controlled = openProp !== undefined;
  const open = controlled ? Boolean(openProp) : openOwn;
  const summary = moreOptionsSummary(groups);
  if (!summary) return null;
  const toggle = () => {
    const next = !open;
    if (!controlled) setOpenOwn(next);
    writeStored(section, next);
    if (typeof onOpenChange === 'function') onOpenChange(next);
  };
  const bodyId = `smenu-more-${section}`;
  return (
    <div className={`smenu-more${open ? ' is-open' : ''}`} data-testid={`more-${section}`}>
      <button
        type="button"
        className="smenu-more__toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        data-testid={`more-${section}-toggle`}
      >
        <Icon name={open ? 'CaretUp' : 'CaretDown'} weight="bold" size={13} color="currentColor" />
        <span className="smenu-more__k">{open ? MORE_WORDS.fewer : MORE_WORDS.more}</span>
        {!open ? <span className="smenu-more__s" data-testid={`more-${section}-summary`}>{summary}</span> : null}
      </button>
      {open ? (
        <div className="smenu-more__body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
