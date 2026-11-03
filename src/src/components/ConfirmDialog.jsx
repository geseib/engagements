import React, { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import Button from './ui/Button';
import { DialogHead, DialogFoot } from './ui/DialogParts';

/**
 * THE SMALL CONFIRM DIALOG — every are-you-sure in the app (experience plan
 * §5.1 "Dialog", Phase 5 step 5b). Built on `Modal`, so it owns nothing of
 * the behaviour every dialog shares: Escape cancels, Tab stays inside, focus
 * goes back to whatever opened it. Its head and foot are the shared ones
 * (ui/DialogParts): the title, the Icon X, the way back on the left and the
 * action on the right. Focus starts on the way back, so Enter on an unread
 * dialog is the safe answer.
 *
 * Two uses:
 *
 * 1. THE HOST STAGE'S EARLY ADVANCE ("Skip to Next Question?", "Show
 *    Results?"), drawn by GameHostPage with `arrowKeys` on (the default).
 *    The owner: *"i would like to press left arrow to cancel and right arrow
 *    to skip ahead anyway (put those arrows as hints on the buttons)."* The
 *    host's hand is already on the arrows, because ArrowRight is what
 *    advances the round: ← backs out, → carries the original intent through,
 *    and each button wears its key. `showConfirmModal` is a term of
 *    `shortcutsSuppressed`, so HostActionBar's window listener is already off
 *    while this is up; the listener here still stops propagation on the keys
 *    it takes (document runs before window in the bubble order). A held →
 *    (`event.repeat`) never confirms.
 *
 *    `arrowConfirms={false}` IS FOR ACTS THAT CANNOT BE UNDONE ("Close the
 *    survey"): ← and Escape still cancel, → is swallowed and its hint comes
 *    off the button, so the only yes is a deliberate press of the button.
 *
 * 2. A DECISION, in place of the browser's `window.confirm` (the ten decision
 *    confirms of step 5b): `useConfirm()` below returns an `ask()` that
 *    resolves true or false, and the dialog to render. No arrow keys there:
 *    those surfaces have no advance gesture to borrow.
 *
 * `danger` paints the action in the destructive look (filled --danger-deep);
 * the words should still state the consequence, not the severity
 * (engage-design hard rule 12).
 */
export default function ConfirmDialog({
  title, message, confirmText = 'Proceed', cancelText = 'Cancel', onConfirm, onCancel,
  arrowConfirms = true, arrowKeys = true, danger = false, theme = 'dark', busy = false,
}) {
  const titleId = useRef(`confirm-title-${Math.random().toString(36).slice(2, 9)}`).current;
  useEffect(() => {
    if (!arrowKeys) return undefined;
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        onCancel?.();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        if (arrowConfirms && !event.repeat) onConfirm?.();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onConfirm, onCancel, arrowConfirms, arrowKeys]);

  const cancel = () => { if (!busy) onCancel?.(); };
  return (
    <Modal
      overlayClassName="ui-scrim ui-scrim--top"
      contentClassName="ui-dialog ui-dialog--small ui-confirm confirmation-modal"
      onClose={cancel}
      labelledBy={titleId}
      theme={theme}
      initialFocus=".ui-confirm-cancel"
    >
      <DialogHead titleId={titleId} title={title} onClose={cancel} closeDisabled={busy} />
      {message ? <div className="ui-dialog-body ui-confirm-message">{message}</div> : null}
      <DialogFoot
        cancel={(
          <Button variant="secondary" size={44} className="ui-confirm-cancel" onClick={cancel} disabled={busy}>
            {arrowKeys ? <kbd aria-hidden="true">←</kbd> : null}
            {arrowKeys ? ` ${cancelText}` : cancelText}
          </Button>
        )}
      >
        <Button
          variant={danger ? 'danger' : 'primary'}
          size={44}
          className="ui-confirm-ok"
          onClick={() => onConfirm?.()}
          disabled={busy}
        >
          {arrowKeys && arrowConfirms ? `${confirmText} ` : confirmText}
          {arrowKeys && arrowConfirms ? <kbd aria-hidden="true">→</kbd> : null}
        </Button>
      </DialogFoot>
    </Modal>
  );
}

/**
 * A DECISION AS A PROMISE, in place of `window.confirm` (step 5b).
 *
 *   const [ask, confirmDialog] = useConfirm();
 *   const remove = async () => {
 *     if (!(await ask({ title: 'Delete this code?', confirmText: 'Delete', danger: true }))) return;
 *     …
 *   };
 *   return <>{…}{confirmDialog}</>;
 *
 * `ask(options)` opens the dialog and resolves true on the action, false on
 * Cancel, the X, Escape or the backdrop. A second ask while one is open
 * answers the first with false.
 */
export function useConfirm() {
  const [asking, setAsking] = useState(null);
  const pending = useRef(null);
  const settle = useCallback((answer) => {
    const resolve = pending.current;
    pending.current = null;
    setAsking(null);
    if (resolve) resolve(answer);
  }, []);
  const ask = useCallback((options = {}) => new Promise((resolve) => {
    if (pending.current) pending.current(false);
    pending.current = resolve;
    setAsking(options);
  }), []);
  useEffect(() => () => { if (pending.current) pending.current(false); }, []);
  const dialog = asking ? (
    <ConfirmDialog
      title={asking.title}
      message={asking.message}
      confirmText={asking.confirmText || 'OK'}
      cancelText={asking.cancelText || 'Cancel'}
      danger={Boolean(asking.danger)}
      theme={asking.theme || 'dark'}
      arrowKeys={false}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;
  return [ask, dialog];
}
