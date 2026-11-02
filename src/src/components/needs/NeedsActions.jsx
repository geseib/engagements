import React, { useEffect, useState } from 'react';
import Button from '../ui/Button';
import { ACTION_WORDS, NEEDS_ACTIONS } from '../../config/needsYou';
import './NeedsYou.css';

/** How long an armed "Let them anyway" waits for its second press. */
export const ARM_MS = 6000;

/**
 * THE BUTTONS A NEEDS-YOU ITEM CARRIES (PLAN §4.2 "Actions"), the same pair
 * wherever the item is drawn: the Needs-you line, a People row, the bell's
 * This session, the phone Remote's card. Outlined, never orange: the room's
 * next step keeps the one orange button (PLAN §4.4). "See in People" is a
 * text link, because it moves the eye, not the session.
 *
 * LET THEM ARMS IN PLACE when the item says the first device is still
 * answering (`item.armLet`, from get-players `deviceConnected`): the first
 * press turns it into "Let them anyway", a second within six seconds goes
 * ahead (PLAN §4.4; host standards §3, press twice in place). While armed
 * a line says why: "Sam's first device is still open. Press again to move
 * the name." (dev QA 2 Nov).
 *
 * `onAct(item, action)` is the page's; an action it cannot do is left out by
 * passing `only`.
 */
export default function NeedsActions({
  item, onAct, busy = false, only = null, className = '',
  /* The armed state, when the caller draws the note itself (the Needs-you
     line, whose fixed height has no room for a second line): `armed` and
     `onArmedChange` together, with `showNote={false}`. */
  armed: armedProp, onArmedChange = null, showNote = true,
}) {
  const [armedOwn, setArmedOwn] = useState(false);
  const controlled = armedProp !== undefined;
  const armed = controlled ? Boolean(armedProp) : armedOwn;
  const setArmed = (v) => {
    if (!controlled) setArmedOwn(v);
    if (typeof onArmedChange === 'function') onArmedChange(v);
  };
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item || typeof onAct !== 'function') return null;
  const actions = (item.actions || []).filter((a) => !only || only.includes(a));
  if (!actions.length) return null;
  const press = (a) => {
    if (a === NEEDS_ACTIONS.LET && item.armLet && !armed) { setArmed(true); return; }
    if (armed) setArmed(false);
    onAct(item, a);
  };
  /* WHY THE SECOND PRESS (dev QA 2 Nov: "Let them" seemed broken). Said in
     words beside the armed button, in a polite live region that is there
     before it fills, so a screen reader hears it too. */
  const arms = showNote && item.armLet && actions.includes(NEEDS_ACTIONS.LET);
  return (
    <span className={['ny-acts', className].filter(Boolean).join(' ')}>
      {actions.map((a) => {
        if (a === NEEDS_ACTIONS.SEE) {
          return (
            <button key={a} type="button" className="ny-link" disabled={busy} onClick={() => press(a)}>
              {ACTION_WORDS[a]}
            </button>
          );
        }
        const word = a === NEEDS_ACTIONS.LET && armed ? ACTION_WORDS.letArmed : ACTION_WORDS[a];
        return (
          <Button
            key={a}
            size="sm"
            variant="quiet"
            disabled={busy}
            onClick={() => press(a)}
            aria-label={item.name ? `${word}: ${item.name}` : undefined}
            data-armed={a === NEEDS_ACTIONS.LET && armed ? '' : undefined}
          >
            {word}
          </Button>
        );
      })}
      {arms ? (
        <span className="ny-armed" aria-live="polite" data-testid="needs-armed-note">
          {armed ? ACTION_WORDS.armedNote(item.name) : ''}
        </span>
      ) : null}
    </span>
  );
}
