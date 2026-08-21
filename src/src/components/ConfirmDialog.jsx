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
 */
export default function ConfirmDialog({
  title, message, confirmText = 'Proceed', onConfirm, onCancel,
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
      if (event.key === 'ArrowRight' && !event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        onConfirm?.();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onConfirm, onCancel]);

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
            {`${confirmText} `}
            <kbd aria-hidden="true">→</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
