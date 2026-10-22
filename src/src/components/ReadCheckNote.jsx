import React from 'react';
import { readCheckNote } from '../utils/readCheckClient';

/**
 * The read check's one small line (utils/readCheckClient.js). HOST SURFACES
 * ONLY: the two-screen console's read, the Session panel's Workie section and
 * the phone remote. Never the stage, /present or a player's screen — the room
 * never sees what the host is asked to fix. Renders nothing when the check
 * left nothing.
 */
export default function ReadCheckNote({ readCheck = null, className = '' }) {
  const text = readCheckNote(readCheck);
  if (!text) return null;
  return (
    <p className={`read-check-note ${className}`.trim()} role="status" data-testid="read-check-note">
      {text}
    </p>
  );
}
