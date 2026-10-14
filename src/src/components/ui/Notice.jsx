import React from 'react';
import Icon from '../Icon';
import './Notice.css';

/**
 * Notice — an inline tinted banner (docs/design/themes/SPEC.md §6, PLAN Phase 1 unit L12).
 *
 *   <Notice tone="ok">Saved. The set is live for your team.</Notice>
 *   <Notice tone="danger" icon="XCircle" role="alert">Upload failed: the file is empty.</Notice>
 *
 * STYLING ONLY. It replaces StatusMessage's look, not its behaviour: StatusMessage still
 * derives the tone from its words (utils/statusTone.js) and owns role/aria-live. So
 * StatusMessage's own tone names are accepted as they are: success -> ok, error -> danger,
 * pending -> note.
 *
 * tone   'ok' | 'warn' | 'danger' | 'note' (default), or success | error | pending
 * icon   optional Phosphor name (components/Icon.jsx), drawn in the tone's colour,
 *        decorative (aria-hidden): the words carry the meaning
 * as     'div' (default) or any element/component
 *
 * Every other prop passes through (role, aria-live, id …); `className` is appended.
 * Size is the caller's (`--ui-size`, else the parent's).
 */
export const NOTICE_TONES = ['ok', 'warn', 'danger', 'note'];
const ALIASES = { success: 'ok', error: 'danger', pending: 'note' };

export function noticeTone(tone) {
  const t = ALIASES[tone] || tone;
  return NOTICE_TONES.includes(t) ? t : 'note';
}

export default function Notice({ tone = 'note', icon, as: As = 'div', className, children, ...rest }) {
  const t = noticeTone(tone);
  const cls = ['ui-notice', `ui-notice--${t}`, className].filter(Boolean).join(' ');
  return (
    <As className={cls} {...rest}>
      {icon ? (
        <span className="ui-notice-icon" aria-hidden="true">
          <Icon name={icon} weight="fill" size="1.15em" />
        </span>
      ) : null}
      <div className="ui-notice-body">{children}</div>
    </As>
  );
}
