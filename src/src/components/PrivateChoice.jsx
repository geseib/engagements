import React, { useEffect, useId, useRef } from 'react';
import Modal from './Modal';
import Button from './ui/Button';
import Icon from './Icon';
import { DialogHead, DialogFoot, DialogCancel } from './ui/DialogParts';
import './OwnQuestionComposer.css';

/**
 * ONE SCREEN: ASK BEFORE ANYTHING PRIVATE IS DRAWN (experience plan principle
 * 3; impromptu ask D8; question picker D9). On one screen the laptop IS the
 * room's screen, so a door that would draw something the room has not seen
 * (the composer's fields, the set's upcoming questions) opens this host-only
 * choice first:
 *
 *   <lead>                                    (first, as text)
 *   On your phone   — Open on my phone (Remote connected) / Connect your phone
 *   Here            — the room will see it
 *
 * The phone comes first and has focus, so Enter picks it. X, Cancel, Escape
 * and the backdrop close it. Asked every time (question picker F5): nothing
 * here is remembered. `words` names everything; `testIdPrefix` keeps each
 * caller's own test ids (`own-choice-*`, `picker-choice-*`).
 */
export default function PrivateChoice({
  words,
  testIdPrefix = 'private-choice',
  hereIcon = 'Eye',
  remoteConnected = false,
  onOpenPhone = () => {},
  onConnectPhone = () => {},
  onHere = () => {},
  onClose = () => {},
}) {
  const headId = useId();
  const firstRef = useRef(null);
  useEffect(() => { if (firstRef.current) firstRef.current.focus(); }, []);
  const t = (id) => `${testIdPrefix}-${id}`;
  return (
    <Modal
      overlayClassName="oq-choice-scrim"
      contentClassName="oq-choice"
      onClose={onClose}
      labelledBy={headId}
      theme="dark"
    >
      <DialogHead
        title={words.title}
        titleId={headId}
        onClose={onClose}
        closeLabel={`${words.cancel}: ${words.title}`}
        closeProps={{ 'data-testid': t('x') }}
      />
      <p className="oq-choice-lead" data-testid={t('lead')}>
        <Icon name="Eye" weight="bold" size={16} color="currentColor" />
        <span><b>{words.lead}</b> {words.leadRest}</span>
      </p>
      <div className="oq-choice-row">
        <Icon name="DeviceMobile" weight="bold" size={18} color="currentColor" />
        <span className="oq-choice-what">
          <span className="oq-choice-k">{words.onPhone}</span>
          <span className="oq-choice-l">{remoteConnected ? words.onPhoneLine : words.onPhoneLineOff}</span>
        </span>
        <Button
          ref={firstRef}
          variant="secondary"
          size={44}
          className="oq-commit--strong"
          onClick={remoteConnected ? onOpenPhone : onConnectPhone}
          data-testid={t('phone')}
        >
          {remoteConnected ? words.openOnPhone : words.connectPhone}
        </Button>
      </div>
      <div className="oq-choice-row">
        <Icon name={hereIcon} weight="bold" size={18} color="currentColor" />
        <span className="oq-choice-what">
          <span className="oq-choice-k">{words.here}</span>
          <span className="oq-choice-l">{words.hereLine}</span>
        </span>
        <Button variant="secondary" size={44} onClick={onHere} data-testid={t('here')}>{words.hereButton || words.here}</Button>
      </div>
      <DialogFoot cancel={<DialogCancel onClick={onClose} data-testid={t('cancel')}>{words.cancel}</DialogCancel>} />
    </Modal>
  );
}
