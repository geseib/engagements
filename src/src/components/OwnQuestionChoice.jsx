import React from 'react';
import PrivateChoice from './PrivateChoice';
import { ownQuestionWords as OQ } from '../config/consoleWords';

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
 * The shape is PrivateChoice's, shared with the question picker's (D9).
 */
const WORDS = Object.freeze({
  title: OQ.title,
  cancel: OQ.cancel,
  lead: OQ.oneScreenLead,
  leadRest: OQ.oneScreenLeadRest,
  onPhone: OQ.onPhone,
  onPhoneLine: OQ.onPhoneLine,
  onPhoneLineOff: OQ.onPhoneLineOff,
  openOnPhone: OQ.openOnPhone,
  connectPhone: OQ.connectPhone,
  here: OQ.writeHere,
  hereLine: OQ.writeHereLine,
});

export default function OwnQuestionChoice({
  remoteConnected = false,
  onOpenPhone = () => {},
  onConnectPhone = () => {},
  onWriteHere = () => {},
  onClose = () => {},
}) {
  return (
    <PrivateChoice
      words={WORDS}
      testIdPrefix="own-choice"
      hereIcon="PencilSimple"
      remoteConnected={remoteConnected}
      onOpenPhone={onOpenPhone}
      onConnectPhone={onConnectPhone}
      onHere={onWriteHere}
      onClose={onClose}
    />
  );
}
