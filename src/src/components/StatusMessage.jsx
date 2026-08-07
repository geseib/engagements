import React from 'react';
import Icon from './Icon';
import { statusTone, statusIcon, statusColor } from '../utils/statusTone';

/**
 * Inline success/error/pending banner for the admin + upload panels.
 *
 * Tone is derived from the message text (see utils/statusTone.js) rather than
 * from an emoji embedded in the copy, which is how this used to work. Pass an
 * explicit `tone` when the caller already knows the outcome.
 */
export default function StatusMessage({ message, tone, className = 'status-message' }) {
  const text = String(message ?? '').trim();
  if (!text) return null;

  const resolved = tone || statusTone(text);
  const icon = statusIcon(resolved);

  return (
    <div className={`${className} ${resolved}`} role="status" aria-live="polite">
      {icon && (
        <Icon
          name={icon}
          weight={resolved === 'pending' ? 'bold' : 'fill'}
          size={16}
          color={statusColor(resolved)}
        />
      )}{' '}
      {text}
    </div>
  );
}
