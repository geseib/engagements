import React, { forwardRef } from 'react';
import Icon from '../Icon';
import Button from './Button';
import './Dialog.css';

/**
 * THE ONE DIALOG HEAD AND FOOT (experience plan §5.1 "Dialog", Phase 5 step 5b).
 *
 *   <Modal … labelledBy="x-title" onClose={requestClose}>
 *     <DialogHead titleId="x-title" title="End this session?" onClose={requestClose} />
 *     <div className="ui-dialog-body">…</div>
 *     <DialogFoot cancel={<Button size={44} onClick={requestClose}>Keep it running</Button>}>
 *       <Button variant="danger" size={44} onClick={end}>End session</Button>
 *     </DialogFoot>
 *   </Modal>
 *
 * Every `Modal` caller draws its head and its foot with these, so every dialog
 * closes the same way:
 *
 *   HEAD  an optional leading icon, an optional eyebrow, the title at one rung, an optional sub line, any
 *         head controls the dialog keeps (`children`, before the close), and ONE
 *         close button: the Icon X, never a "×" or "✕" text glyph. The X renders
 *         only when `onClose` is a function, so a dialog never shows a dead X
 *         (engage-design hard rule 2). `closeDisabled` is for the deliberate case
 *         (a delete in flight, whose outcome only this dialog can report).
 *   FOOT  the way back on the LEFT (`cancel`), the action on the RIGHT
 *         (`children`): "Cancel left, the action right" (§5.1, frame p-5). The
 *         right group is pushed by margin-left: auto and wraps, never
 *         justify-content: flex-end (hard rule 9).
 *
 * Class names are additive: `className`, `titleClassName` and `closeClassName`
 * keep a dialog's own scoped classes beside the shared ones, so the scoped
 * stylesheets and the tests that read them keep working while the markup is
 * one. Behaviour (Escape, Tab trap, focus restore) stays in components/Modal.
 */
const cx = (...c) => c.filter(Boolean).join(' ');

export const DialogClose = forwardRef(function DialogClose(
  { onClose, label = 'Close', disabled = false, className = '', size = 18, ...rest }, ref,
) {
  if (typeof onClose !== 'function') return null;
  return (
    <button
      ref={ref}
      type="button"
      className={cx('ui-dialog-x', className)}
      aria-label={label}
      onClick={onClose}
      disabled={disabled}
      {...rest}
    >
      <Icon name="X" weight="bold" size={size} color="currentColor" />
    </button>
  );
});

export function DialogHead({
  title, titleId, sub = null, eyebrow = null, onClose, closeLabel = 'Close', closeDisabled = false,
  className = '', titleClassName = '', closeClassName = '', titlesClassName = '', subClassName = '',
  as: TitleTag = 'h2', children = null, closeProps = null, icon = null, eyebrowClassName = '',
  titleProps = null, closeRef = null,
}) {
  return (
    <header className={cx('ui-dialog-head', className)}>
      {icon}
      <div className={cx('ui-dialog-titles', titlesClassName)}>
        {eyebrow ? <p className={cx('ui-dialog-eyebrow', eyebrowClassName)}>{eyebrow}</p> : null}
        <TitleTag id={titleId} className={cx('ui-dialog-title', titleClassName)} {...(titleProps || {})}>{title}</TitleTag>
        {sub ? <p className={cx('ui-dialog-sub', subClassName)}>{sub}</p> : null}
      </div>
      {children}
      <DialogClose
        ref={closeRef}
        onClose={onClose}
        label={closeLabel}
        disabled={closeDisabled}
        className={closeClassName}
        {...(closeProps || {})}
      />
    </header>
  );
}

export function DialogFoot({ cancel = null, children = null, className = '', endClassName = '', ...rest }) {
  return (
    <footer className={cx('ui-dialog-foot', className)} {...rest}>
      {cancel ? <div className="ui-dialog-foot-start">{cancel}</div> : null}
      {children ? <div className={cx('ui-dialog-foot-end', endClassName)}>{children}</div> : null}
    </footer>
  );
}

/** The usual way back in a foot: secondary, 44px (§5.1). */
export function DialogCancel({ onClick, children = 'Cancel', ...rest }) {
  return (
    <Button variant="secondary" size={44} onClick={onClick} {...rest}>{children}</Button>
  );
}
