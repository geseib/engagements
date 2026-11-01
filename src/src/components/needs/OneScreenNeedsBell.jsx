import React, { useRef, useState } from 'react';
import Modal from '../Modal';
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
 * It sits in the dock, shaped like SESSION (`dock-more`), just before it.
 */
export default function OneScreenNeedsBell({
  needs, onAct, busy = false, error = '', oneScreen = true, remoteConnected = false, onConnectPhone = null,
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
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
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`dock-more${nowCount ? ' dock-more--lit' : ''}`}
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        data-testid="needs-bell"
      >
        <Icon name="Bell" weight={nowCount ? 'fill' : 'bold'} size={16} color="currentColor" />
        <span className="dock-more-lbl">NEEDS YOU</span>
        {nowCount > 0 ? <span className="dock-more-n" data-testid="needs-bell-count">{nowCount}</span> : null}
        {!nowCount && soon ? <span className="dock-more-n" data-testid="needs-bell-dot" aria-hidden="true">•</span> : null}
      </button>
      {open ? (
        <Modal
          overlayClassName="ny ny-scrim"
          contentClassName="ny-sheet"
          label={NEEDS_WORDS.title}
          onClose={close}
          theme="dark"
        >
          <header className="ny-sheet-head">
            <h2 className="ny-sheet-title">{oneScreen ? NEEDS_WORDS.roomCanSee : NEEDS_WORDS.title}</h2>
            <button type="button" className="ny-x" aria-label="Close Needs you" onClick={close}>
              <Icon name="X" weight="bold" size={14} color="currentColor" />
            </button>
          </header>
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
          <footer className="ny-sheet-foot">
            <Button variant="quiet" onClick={close}>Close</Button>
          </footer>
        </Modal>
      ) : null}
    </>
  );
}
