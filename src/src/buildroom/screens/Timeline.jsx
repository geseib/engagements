/**
 * THE TIMELINE: the host's (edit, delete) and the wall's (no host notes, no
 * bookkeeping, no idea authors). Moved from BuildRoomPage.jsx in B6; with
 * `host` false it renders no control.
 */
import React, { useState } from 'react';
import DeleteReasonField from '../../components/DeleteReasonField';
import BuildImage from '../BuildImage';
import { W } from '../words';
import { claudeKindLabel } from '../buildScreens';
import { safeHref } from '../links';
import {
  byLabel, clockTime, entryTone, SafeLink, continueCommand,
} from './common';

/** Said on a Delete or Remove this host may not press (the owner's delete rule, 2026-10-04). */
export const NOT_YOURS = 'Only the host who created this room, or an owner or admin of its team, can delete from it.';

function TimelineEntry({ entry, host, stopped = false, busy, ended, run, api, deleteAs }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const asStaff = deleteAs === 'platform-admin';
  const [text, setText] = useState(entry.text);
  const save = async () => {
    const ok = await run(() => api.logAction(entry.logId, { action: 'edit', text }));
    if (ok !== undefined) setEditing(false);
  };
  return (
    <li className={`brm-tl-${entryTone(entry)}`}>
      <span className="brm-tm">{clockTime(entry.createdAt)}</span>
      <span className="brm-dot" aria-hidden="true" />
      <div className="brm-tl-body">
        {editing ? (
          <div className="brm-tl-edit">
            <textarea className="brm-input brm-ta brm-ta--sm" aria-label="Edit entry" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
            <div className="brm-row brm-gap">
              <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => { setEditing(false); setText(entry.text); }}>Cancel</button>
              <button type="button" className="brm-btn brm-btn--sm" disabled={busy || !text.trim()} onClick={save}>Save</button>
            </div>
          </div>
        ) : (
          <>
            <span className="brm-by">{byLabel(entry)}</span>
            <span className="brm-tl-text">{entry.text}</span>
            {entry.detail && !['direction', 'image'].includes(entry.kind) && <span className="brm-tl-detail">{entry.detail}</span>}
            {entry.kind === 'image' && <BuildImage imageId={entry.detail} alt={entry.text} className="brm-shot brm-shot--tl" />}
            {safeHref(entry.link) && <SafeLink className="brm-lnk brm-block" href={entry.link}>{entry.link}</SafeLink>}
            {host && entry.held && <span className="brm-tl-flag">{W.laterHeld}</span>}
            {host && entry.forAgent && <span className="brm-tl-flag">{entry.as && entry.as !== 'do-now' ? `${claudeKindLabel(entry.as)} · ` : ''}{entry.deliveredAt ? 'Claude has it' : stopped ? `Waiting for Claude · run ${continueCommand()}` : 'Waiting for Claude'}</span>}
          </>
        )}
        {host && !editing && (
          <span className="brm-tl-acts">
            {confirming ? (
              <>
                <span className="brm-hint">Delete this entry?</span>
                {asStaff && (
                  <DeleteReasonField id={`brm-reason-${entry.logId}`} value={reason} onChange={setReason} scope="brm" labelClass="brm-lbl" inputClass="brm-input brm-ta brm-ta--sm" hintClass="brm-hint" />
                )}
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setConfirming(false)}>Keep</button>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--dangersolid" disabled={busy || (asStaff && !reason.trim())} onClick={() => run(() => api.logAction(entry.logId, { action: 'delete', ...(asStaff ? { reason: reason.trim() } : {}) }))}>Delete</button>
              </>
            ) : (
              <>
                <button type="button" className="brm-btn brm-btn--sm brm-btn--link" aria-label={`Edit "${entry.text}"`} onClick={() => setEditing(true)}>Edit</button>
                {!ended && <button type="button" className="brm-btn brm-btn--sm brm-btn--link brm-danger" aria-label={`Delete "${entry.text}"`} disabled={deleteAs === ''} title={deleteAs === '' ? NOT_YOURS : undefined} onClick={() => { setReason(''); setConfirming(true); }}>Delete</button>}
              </>
            )}
          </span>
        )}
      </div>
    </li>
  );
}

const WALL_HIDDEN_KINDS = ['note', 'ask', 'direction'];

const WALL_DETAIL_HIDDEN_KINDS = ['decision', 'idea'];

export function Timeline({ log, host, stopped = false, busy, ended, run, api, deleteAs }) {
  // The host logs from the one composer (Composer), not from a form here.
  // Newest first: in a live room the latest thing Claude or the room did is
  // what everyone looks for, and the panel scrolls.
  // On the wall (Present) the timeline is the room's, as on the phones: no host
  // notes, no system bookkeeping (the asks table says it), and no detail on a
  // decision or an idea — that is the host's note or the idea's author.
  const shown = (host ? log : log
    .filter((l) => !WALL_HIDDEN_KINDS.includes(l.kind))
    .map((l) => (WALL_DETAIL_HIDDEN_KINDS.includes(l.kind) ? { ...l, detail: '' } : l))
    .map((l) => (l.kind === 'help' ? { ...l, text: `${l.name || 'A builder'} asked for help`, detail: '' } : l)))
    .slice().reverse();
  return (
    <section className="brm-panel brm-tlpanel" aria-labelledby="brm-tl-h">
      <h2 className="brm-h5" id="brm-tl-h">Timeline</h2>
      {shown.length ? (
        <ul className="brm-tl">
          {shown.map((entry) => (
            <TimelineEntry key={`${entry.logId}:${entry.editedAt || ''}`} entry={entry} host={host} stopped={stopped} busy={busy} ended={ended} run={run} api={api} deleteAs={deleteAs} />
          ))}
        </ul>
      ) : (
        <div className="brm-empty">Claude&apos;s progress, the room&apos;s decisions and what people say out loud collect here.</div>
      )}
    </section>
  );
}
