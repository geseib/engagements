import React, { useEffect } from 'react';

/**
 * The host's confirmation dialog — "Skip to Next Question?", "Show Results?",
 * and every other are-you-sure the stage asks.
 *
 * EXTRACTED from GameHostPage's inline block for the standing reason: that
 * page cannot mount in jsdom, so a keyboard binding written inline there is a
 * binding nothing can test. Same classes as the inline version
 * (`expanded-qr-overlay` / `confirmation-modal`), so the stylesheet is
 * untouched.
 *
 * THE ARROWS ARE THE OWNER'S OWN GESTURE. This dialog only ever appears when
 * an advance was pressed early — the host's hand is already on the arrow
 * keys, because ArrowRight is what advances the round. So: *"i would like to
 * press left arrow to cancel and right arrow to skip ahead anyway (put those
 * arrows as hints on the buttons)."* Left backs out, right carries the
 * original intent through, and each button wears its key.
 *
 * WHY THIS CANNOT DOUBLE-FIRE THE ADVANCE. `showConfirmModal` is a term of
 * `shortcutsSuppressed`, so HostActionBar's window listener and the stage
 * pager are both already off while this is up. The listener here still stops
 * propagation on the keys it takes — document runs before window in the
 * bubble order — so the guarantee holds even if a future overlay rule drifts.
 *
 * `event.repeat` is refused on ArrowRight for the same reason HostActionBar
 * refuses it on the advance key: a held key must not confirm a question the
 * host has not finished reading. Escape cancels, as it does on every other
 * overlay. ArrowLeft may repeat harmlessly — cancelling twice is cancelling.
 *
 * `arrowConfirms={false}` IS FOR ACTS THAT CANNOT BE UNDONE. The argument
 * above holds for an early advance, which the host can step back from. It
 * inverts for "Close the survey": the dock binds → to that primary, and a
 * clicker's → pressed twice — a double click, or pressing on because the wall
 * did not seem to move — opened this dialog and then confirmed it, and a
 * closed survey does not reopen. With the prop false, ← and Escape still
 * cancel, → is swallowed (so it reaches neither this dialog's confirm nor the
 * dock behind it), and the → hint comes off the button: the only yes is a
 * deliberate press of the button itself — a click, or Enter / Space on it.
 */
export default function ConfirmDialog({
  title, message, confirmText = 'Proceed', onConfirm, onCancel, arrowConfirms = true,
}) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'Escape') {
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
  }, [onConfirm, onCancel, arrowConfirms]);

  return (
    <div className="expanded-qr-overlay" onClick={onCancel}>
      <div className="expanded-qr-content confirmation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirmation-header">
          <h2>{title}</h2>
        </div>
        <div className="confirmation-message">
          {message}
        </div>
        <div className="dialog-actions">
          <button
            className="btn-secondary"
            onClick={onCancel}
          >
            <kbd aria-hidden="true">←</kbd>
            {' Cancel'}
          </button>
          <button
            className="btn-primary"
            onClick={onConfirm}
          >
            {arrowConfirms ? `${confirmText} ` : confirmText}
            {arrowConfirms && <kbd aria-hidden="true">→</kbd>}
          </button>
        </div>
      </div>
    </div>
  );
}
