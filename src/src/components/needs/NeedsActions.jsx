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
 * ahead (PLAN §4.4; host standards §3, press twice in place).
 *
 * `onAct(item, action)` is the page's; an action it cannot do is left out by
 * passing `only`.
 */
export default function NeedsActions({ item, onAct, busy = false, only = null, className = '' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  if (!item || typeof onAct !== 'function') return null;
  const actions = (item.actions || []).filter((a) => !only || only.includes(a));
  if (!actions.length) return null;
  const press = (a) => {
    if (a === NEEDS_ACTIONS.LET && item.armLet && !armed) { setArmed(true); return; }
    setArmed(false);
    onAct(item, a);
  };
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
    </span>
  );
}
