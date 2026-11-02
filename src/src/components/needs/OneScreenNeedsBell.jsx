import React, { useRef, useState } from 'react';
import Modal from '../Modal';
import { DialogHead, DialogFoot } from '../ui/DialogParts';
import Icon from '../Icon';
import Button from '../ui/Button';
import SessionNeedsList from './SessionNeedsList';
import { NEEDS_WORDS } from '../../config/needsYou';
import './NeedsYou.css';

/**
 * THE BELL ON THE STAGE (PLAN §3.3, §4.3; owner decisions 1 and 4).
 *
 * The one-screen stage had no bell on purpose: the room reads that laptop,
 * and the account inbox names drafts, people and teams. So this is not the
 * account inbox. It is this session's Needs you, and on one screen it is a
 * COUNT, never a name: the button shows how many Now items wait (a dot for
 * Soon), and pressing it opens a sheet that starts "The room can see this
 * screen", lists each item by its kind ("A name request"), and offers "Show
 * on this screen" (after "The room will see this. Show it?") or the phone.
 * No account entries are ever read or drawn here.
 *
 * `oneScreen` false (a private laptop showing the stage, as an event item on
 * two screens does): the same sheet, named, with each item's buttons.
 *
 * On the host stage it sits in the top bar's Needs-you slot (`variant="top"`,
 * experience plan 2h); the dock shape (`dock-more`) stays for any dock.
 *
 * COMPACT, AND ABSENT WHEN NOTHING WAITS (owner, 2 Nov 2026: "the bottom bar
 * became 2 lines"). A bell and the count, no word: the word NEEDS YOU was the
 * widest item in the dock and pushed it onto a second line. The name is in
 * the aria-label and title ("Needs you, 1 waiting"). With nothing waiting,
 * Now or Soon, the dock draws nothing here; a sheet already open stays open
 * until it is closed, so an item handled from it does not yank it away.
 */
/*
 * IN THE TOP BAR (`variant="top"`, experience plan 2h). The one-screen stage
 * draws the console's top bar, and this is its Needs-you slot: ALWAYS THERE
 * (the slot never moves), the word "Needs you" and a count, never a name, in
 * the bar's own outlined shape (`.hc-needsbtn`). `open` / `onOpenChange` let
 * the page own the sheet, so the public Needs-you line's Open
 * (components/needs/PublicNeedsLine.jsx) opens this same sheet rather than a
 * second one.
 */
export default function OneScreenNeedsBell({
  needs, onAct, busy = false, error = '', oneScreen = true, remoteConnected = false, onConnectPhone = null,
  variant = 'dock', open: openProp, onOpenChange = null,
}) {
  const [openOwn, setOpenOwn] = useState(false);
  const controlled = typeof openProp === 'boolean';
  const open = controlled ? openProp : openOwn;
  const setOpen = (next) => {
    if (!controlled) setOpenOwn(next);
    if (typeof onOpenChange === 'function') onOpenChange(next);
  };
  const buttonRef = useRef(null);
  const top = variant === 'top';
  const nowCount = needs ? needs.nowCount : 0;
  const soon = needs ? needs.soonCount > 0 : false;
  const label = nowCount
    ? `${NEEDS_WORDS.title}, ${nowCount} waiting`
    : (soon ? `${NEEDS_WORDS.title}, something to review` : NEEDS_WORDS.title);
  const close = () => {
    setOpen(false);
    if (buttonRef.current && typeof buttonRef.current.focus === 'function') buttonRef.current.focus();
  };
  const act = (item, action) => {
    // "See in People" has no People here; on one screen the list is on the phone.
    if (action === 'see') { close(); }
    onAct(item, action);
  };
  if (!top && !nowCount && !soon && !open) return null;
  const cls = top
    ? `hc-needsbtn${nowCount ? ' is-lit' : ''}`
    : `dock-more dock-needs${nowCount ? ' dock-more--lit' : ''}`;
  const n = top ? 'hc-needs-n' : 'dock-more-n';
  /* On the top bar it is ui/Button, secondary at 36px, like the bar's other
     buttons (experience plan §5.1, step 5a); on the stage dock, the dock's own. */
  const Trigger = top ? Button : 'button';
  const triggerLook = top ? { variant: 'secondary', size: 36 } : { type: 'button' };
  return (
    <>
      <Trigger
        ref={buttonRef}
        {...triggerLook}
        className={cls}
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        data-testid="needs-bell"
      >
        <Icon name="Bell" weight={nowCount ? 'fill' : 'bold'} size={16} color="currentColor" />
        {top ? <span aria-hidden="true">{NEEDS_WORDS.title}</span> : null}
        {nowCount > 0 ? <span className={n} data-testid="needs-bell-count">{nowCount}</span> : null}
        {!nowCount && soon ? <span className={n} data-testid="needs-bell-dot" aria-hidden="true">•</span> : null}
      </Trigger>
      {open ? (
        <Modal
          overlayClassName="ny ny-scrim"
          contentClassName="ny-sheet"
          label={NEEDS_WORDS.title}
          onClose={close}
          theme="dark"
        >
          <DialogHead className="ny-sheet-head" title={<>{oneScreen ? NEEDS_WORDS.roomCanSee : NEEDS_WORDS.title}</>} titleClassName="ny-sheet-title" onClose={close} closeLabel="Close Needs you" closeClassName="ny-x" />
          {oneScreen ? <p className="ny-k">{NEEDS_WORDS.thisSession}</p> : null}
          <SessionNeedsList
            needs={needs}
            onAct={act}
            busy={busy}
            error={oneScreen ? '' : error}
            oneScreen={oneScreen}
            remoteConnected={remoteConnected}
            onConnectPhone={onConnectPhone ? () => { setOpen(false); onConnectPhone(); } : null}
          />
          <DialogFoot className="ny-sheet-foot">
            <Button variant="secondary" size={44} onClick={close}>Close</Button>
          </DialogFoot>
        </Modal>
      ) : null}
    </>
  );
}
