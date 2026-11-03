import React, { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import Button from '../ui/Button';
import RowFlag from '../ui/RowFlag';
import NeedsActions from '../needs/NeedsActions';
import { NEEDS_ACTIONS } from '../../config/needsYou';
import './PersonRow.css';

/**
 * ONE PERSON ROW (docs/design/experience-plan/PLAN.md §3.2b; frame p-7).
 *
 * The same row in every list, five slots in a fixed order with fixed widths,
 * so the columns line up wherever a person is drawn:
 *
 *   status dot · name · doing now · the format's one fact · ⋯
 *
 * The name is the only flexible slot (one text node, ellipsis, the full name
 * on hover: engage-design hard rules 7 and 8). With no fact the slot stays
 * empty rather than collapsing. A name request turns the row amber and opens
 * one line inside it with Let them / Not now, the same pair as the Needs-you
 * line (either clears both, because both read the same list). ⋯ holds what
 * the format can do to a person, in this order: Rename, Move to a new device,
 * Lock name, then Remove from session in danger text, confirmed by a second
 * press in place (host standards §3).
 *
 * Data only; the caller passes what it can do (`menu`), and leaves out what
 * its format cannot (the Build Room has no Rename).
 */
export const PERSON_WORDS = Object.freeze({
  here: 'here',
  away: 'away',
  left: 'left',
  more: (name) => `More for ${name}`,
  rename: 'Rename',
  move: 'Move to a new device',
  lock: 'Lock name',
  remove: 'Remove from session',
  removeArmed: 'Press again to remove',
  wantsName: 'wants their name on a new device',
});

/** How long an armed Remove waits for its second press. */
export const REMOVE_ARM_MS = 6000;

function PersonMenu({ name, menu }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) { setOpen(false); setArmed(false); } };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      setArmed(false);
      if (button.current) button.current.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), REMOVE_ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  const press = (m) => {
    if (m.danger && !armed) { setArmed(true); return; }
    setArmed(false);
    setOpen(false);
    m.onSelect();
  };
  return (
    <span className="prow-more" ref={wrap}>
      {/* The primitive Button (PLAN §5.1), secondary, squared for one glyph. */}
      <Button
        ref={button}
        variant="secondary"
        size="sm"
        className="prow-more-toggle"
        aria-label={PERSON_WORDS.more(name)}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setArmed(false); }}
      >
        <Icon name="DotsThree" weight="bold" size={16} color="currentColor" />
      </Button>
      {open ? (
        <span className="prow-menu" role="menu" aria-label={PERSON_WORDS.more(name)}>
          {menu.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitem"
              className={`prow-item${m.danger ? ' is-danger' : ''}`}
              disabled={Boolean(m.disabled)}
              data-armed={m.danger && armed ? '' : undefined}
              onClick={() => press(m)}
            >
              {m.danger && armed ? PERSON_WORDS.removeArmed : m.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/*
  THE RAIL'S COMPACT DENSITY (docs/design/console-rail README D7; owner, 3 Nov
  2026, fork 6). In the 340px People column the 92px word slot left a name
  about 90px ("Priya Ra…"), so `density="rail"` draws the doing-now slot as a
  20px glyph: ✓ done, … still out, — not known yet (the names lag the count).
  Shape tells them apart, not colour; the word is the glyph's accessible name
  (role="img", aria-label) and its title. The full-width row (the Session
  menu, the phone remote) keeps the words.

  `factLive` (README D6): the score reads in text colour at Results and muted
  while the room answers or votes. `note` (rail only): a latecomer's "from
  item N", which has no slot at 20px, joins the name's one text node.
*/
export const DOING_GLYPH = Object.freeze({ done: '✓', wait: '…', unknown: '—' });

export default function PersonRow({
  name, status = 'here', doing = '', fact = '', menu = [], state = undefined,
  needsItem = null, onNeedsAct = null, needsBusy = false,
  density = 'full', mark = null, factLive = false, note = '',
}) {
  const asking = Boolean(needsItem && needsItem.kind === 'name-request');
  const rail = density === 'rail';
  const cls = ['prow', rail ? 'prow--rail' : '', asking ? 'is-asking' : ''].filter(Boolean).join(' ');
  const shown = rail && note ? `${name} · ${note}` : name;
  return (
    <li className={cls} data-status={status} data-state={state} data-testid={asking ? 'person-asking' : undefined}>
      <span className={`prow-dot is-${status}`} role="img" aria-label={PERSON_WORDS[status] || status} />
      <span className="prow-name" title={shown}>{shown}</span>
      {rail ? (
        mark && DOING_GLYPH[mark] ? (
          <span className={`prow-doing is-${mark}`} role="img" aria-label={doing} title={doing} data-testid="person-doing">{DOING_GLYPH[mark]}</span>
        ) : <span className="prow-doing" />
      ) : <span className="prow-doing">{doing}</span>}
      <span className={`prow-fact${factLive ? ' is-live' : ''}`}>{fact}</span>
      {menu.length ? <PersonMenu name={name} menu={menu} /> : <span className="prow-more" />}
      {asking ? (
        <span className="prow-needs">
          {/* The row flag (PLAN §5.1): an amber dot plus words. */}
          <RowFlag className="prow-flag" ago={needsItem.ago || ''}>{PERSON_WORDS.wantsName}</RowFlag>
          <NeedsActions item={needsItem} onAct={onNeedsAct} busy={needsBusy} only={[NEEDS_ACTIONS.LET, NEEDS_ACTIONS.NOT_NOW]} />
        </span>
      ) : null}
    </li>
  );
}
