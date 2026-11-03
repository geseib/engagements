import React, { useEffect, useId, useRef } from 'react';
import Modal from './Modal';
import Button from './ui/Button';
import Icon from './Icon';
import { DialogHead, DialogFoot, DialogCancel } from './ui/DialogParts';
import { ownQuestionWords as OQ } from '../config/consoleWords';
import './OwnQuestionComposer.css';

/**
 * ONE SCREEN: THE CHOICE BEFORE THE COMPOSER (impromptu ask README D8, frame 5;
 * reviews A-5). On one screen the laptop IS the room's screen, so "Write a
 * question" never draws the fields unasked. It opens this host-only choice:
 *
 *   The room can see this screen. What you type here is on it.   (first, as text)
 *   On your phone     — Open on my phone (Remote connected) / Connect your phone
 *   Write it here     — the room will see you type it
 *
 * Focus starts on the phone option. X, Cancel, Escape and the backdrop close it.
 */
export default function OwnQuestionChoice({
  remoteConnected = false,
  onOpenPhone = () => {},
  onConnectPhone = () => {},
  onWriteHere = () => {},
  onClose = () => {},
}) {
  const headId = useId();
  const firstRef = useRef(null);
  useEffect(() => { if (firstRef.current) firstRef.current.focus(); }, []);
  return (
    <Modal
      overlayClassName="oq-choice-scrim"
      contentClassName="oq-choice"
      onClose={onClose}
      labelledBy={headId}
      theme="dark"
    >
      <DialogHead
        title={OQ.title}
        titleId={headId}
        onClose={onClose}
        closeLabel={`${OQ.cancel}: ${OQ.title}`}
        closeProps={{ 'data-testid': 'own-choice-x' }}
      />
      <p className="oq-choice-lead" data-testid="own-choice-lead">
        <Icon name="Eye" weight="bold" size={16} color="currentColor" />
        <span><b>{OQ.oneScreenLead}</b> {OQ.oneScreenLeadRest}</span>
      </p>
      <div className="oq-choice-row">
        <Icon name="DeviceMobile" weight="bold" size={18} color="currentColor" />
        <span className="oq-choice-what">
          <span className="oq-choice-k">{OQ.onPhone}</span>
          <span className="oq-choice-l">{remoteConnected ? OQ.onPhoneLine : OQ.onPhoneLineOff}</span>
        </span>
        <Button
          ref={firstRef}
          variant="secondary"
          size={44}
          className="oq-commit--strong"
          onClick={remoteConnected ? onOpenPhone : onConnectPhone}
          data-testid="own-choice-phone"
        >
          {remoteConnected ? OQ.openOnPhone : OQ.connectPhone}
        </Button>
      </div>
      <div className="oq-choice-row">
        <Icon name="PencilSimple" weight="bold" size={18} color="currentColor" />
        <span className="oq-choice-what">
          <span className="oq-choice-k">{OQ.writeHere}</span>
          <span className="oq-choice-l">{OQ.writeHereLine}</span>
        </span>
        <Button variant="secondary" size={44} onClick={onWriteHere} data-testid="own-choice-here">{OQ.writeHere}</Button>
      </div>
      <DialogFoot cancel={<DialogCancel onClick={onClose} data-testid="own-choice-cancel">{OQ.cancel}</DialogCancel>} />
    </Modal>
  );
}
