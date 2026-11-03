import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import HW from '../../config/hostWords';
import Icon from '../Icon';
import Button from '../ui/Button';

/**
 * THE JOIN CODE ON THE HOST'S OWN LAPTOP (owner, 3 Nov 2026): "the qr code
 * should also pop up in the host screen when they hover or click on the room
 * code. in case they or have someone walk up and need it. they don't have to
 * look at other screen."
 *
 * Two screens only (ConsoleTop draws the plain toggle on one screen, where
 * the laptop IS the room's screen). The top bar's Join slot is now two things,
 * kept apart on purpose:
 *
 *   - the code itself: hover or focus shows a card under it, ON THIS LAPTOP —
 *     the join QR, the code large and the address; a click pins the card open
 *     (with a close button), Escape or the close button shuts it. None of this
 *     touches the room's window.
 *   - "Show on the room's screen" inside the card: the one join toggle it
 *     always was (POST /stage-focus {join}, J does the same), aria-pressed.
 *
 * The QR is the lobby's (StageJoinPanel's QRCodeSVG) with the page's playUrl.
 */
export default function JoinCodeChip({
  code, playUrl, joinUrl, onRoomToggle, roomPressed = false, buttonProps = null,
}) {
  const [peek, setPeek] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  // Closing hands focus back to the code; that focus must not re-open it.
  const quiet = useRef(false);
  const cardId = useId();
  const open = peek || pinned;
  const disabled = Boolean(buttonProps && buttonProps.disabled);

  const close = useCallback((refocus = false) => {
    setPinned(false);
    setPeek(false);
    if (refocus && triggerRef.current) {
      quiet.current = true;
      triggerRef.current.focus();
      quiet.current = false;
    }
  }, []);

  // Escape shuts the card, and is spent: nothing behind it also closes.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      const inside = wrapRef.current && wrapRef.current.contains(document.activeElement);
      close(inside);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  // A pinned card closes on a click anywhere else on the laptop.
  useEffect(() => {
    if (!pinned) return undefined;
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pinned, close]);

  const onBlur = (event) => {
    if (pinned) return;
    if (wrapRef.current && wrapRef.current.contains(event.relatedTarget)) return;
    setPeek(false);
  };

  const { title: _ignoredTitle, ...restButtonProps } = buttonProps || {};
  return (
    <span
      ref={wrapRef}
      className={`hc-join${roomPressed ? ' is-up' : ''}`}
      data-slot="join"
      onMouseEnter={() => { if (!disabled) setPeek(true); }}
      onMouseLeave={() => setPeek(false)}
      onBlur={onBlur}
    >
      <Button
        ref={triggerRef}
        variant="secondary"
        size={36}
        className="hc-code"
        aria-label={`${HW.join} ${code}. ${HW.joinLaptopHint}${roomPressed ? ` ${HW.joinOnRoomScreen}.` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        title={buttonProps && buttonProps.title ? buttonProps.title : HW.joinLaptopHint}
        onFocus={() => { if (!disabled && !quiet.current) setPeek(true); }}
        onClick={() => {
          if (disabled) return;
          setPinned((p) => !p);
          setPeek(false);
        }}
        {...restButtonProps}
      >
        <Icon name="QrCode" weight="bold" size={16} color="currentColor" />
        <>{HW.join} <b>{code}</b></>
        {roomPressed ? (
          <span className="hc-join-up" title={HW.joinOnRoomScreen} aria-hidden="true">
            <Icon name="Monitor" weight="bold" size={14} color="currentColor" />
          </span>
        ) : null}
      </Button>
      {open ? (
        <div
          id={cardId}
          className={`hc-joincard${pinned ? ' is-pinned' : ''}`}
          role="dialog"
          aria-label={HW.joinCardLabel}
          data-testid="join-card"
        >
          {pinned ? (
            <button type="button" className="hc-joincard-x" aria-label={HW.joinCardClose} onClick={() => close(true)}>
              <Icon name="X" weight="bold" size={16} color="currentColor" />
            </button>
          ) : null}
          <div className="hc-joincard-qr" role="img" aria-label={HW.joinQrLabel}>
            <QRCodeSVG value={playUrl || ''} size={200} level="M" includeMargin={false} />
          </div>
          <p className="hc-joincard-code">{code}</p>
          <p className="hc-joincard-url">{joinUrl}</p>
          <Button
            variant="secondary"
            size={36}
            className="hc-joincard-room"
            aria-pressed={Boolean(roomPressed)}
            onClick={onRoomToggle}
          >
            <Icon name="Monitor" weight="bold" size={16} color="currentColor" />
            {roomPressed ? HW.joinOffRoomScreen : HW.joinShowOnRoomScreen}
          </Button>
        </div>
      ) : null}
    </span>
  );
}
