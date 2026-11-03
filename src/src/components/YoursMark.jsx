import React from 'react';
import Icon from './Icon';
import { ownQuestionWords as OQ } from '../config/consoleWords';
import './YoursMark.css';

/**
 * "Yours": a round the host wrote during the session (impromptu ask, README
 * D5). Drawn everywhere a running order is: the Session menu's Rounds, the
 * rail, Setup's First up, the Remote, Rounds so far and the report. A pen and
 * the word, never colour alone. Host surfaces only: the room never sees it (F6).
 */
export default function YoursMark({ className = '' }) {
  return (
    <span className={['yours-mark', className].filter(Boolean).join(' ')} data-testid="yours-mark">
      <Icon name="PencilSimple" weight="bold" size={12} color="currentColor" aria-hidden="true" />
      {OQ.yours}
    </span>
  );
}
