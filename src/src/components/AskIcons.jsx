import React from 'react';
import Icon from './Icon';
import './AskIcons.css';
import FW, { KINDS } from '../config/followUpWords';

/**
 * ASK THE ROOM: THE ICONS BESIDE WORKIE'S READ (docs/design/followup-icons
 * mockup §1, PLAN B2). One small button per ask at the end of the point it
 * came from; each names its kind (Ideas, Choose, Rate) and opens the preview.
 * Host screens only: the wall and the phones never draw these.
 *
 *   entries  [{ index, ask, section, point }]
 *   onOpen   (entry) => void
 */
export default function AskIcons({ entries, onOpen, className = '' }) {
  if (!entries || !entries.length) return null;
  return (
    <span className={`askicons${className ? ` ${className}` : ''}`}>
      {entries.map((entry) => {
        const kind = KINDS[entry.ask.type] || KINDS.ideas;
        return (
          <button
            key={entry.index}
            type="button"
            className="askicon"
            data-kind={entry.ask.type}
            aria-label={FW.openIcon(kind.label, entry.section || FW.afterTheRead, entry.point || '')}
            title={entry.ask.question || entry.ask.statement || kind.label}
            onClick={(e) => { e.stopPropagation(); onOpen(entry); }}
          >
            <Icon name={kind.icon} size={14} weight="bold" />
            <span>{kind.label}</span>
          </button>
        );
      })}
    </span>
  );
}
