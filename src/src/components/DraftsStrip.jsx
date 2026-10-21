import React from 'react';
import Icon from './Icon';
import {
  DRAFT_STATUS, waitingDrafts, restorableDrafts, draftNoun,
} from '../utils/draftsApi';

/**
 * AI DRAFTS WAITING IN THIS LIBRARY — the strip at the top of the sets list.
 *
 * The owner: "there needs to be notification in the system/alert somewhere
 * … this should also last even if it takes a few days before the admin gets
 * back." The bell says it everywhere; this says it where the sets are, with
 * the way in beside each one. Read from the server (GET
 * /admin/generation-drafts/list), so it is the same on every device and still
 * there days later — unlike the browser-memory strip it replaces.
 *
 * Pure: props in, `onOpen(draft)` out, in the `.qsets` idiom (no styles of
 * its own; QuestionSetsPanel.css's alert, chip and button).
 */
function describe(d) {
  const noun = draftNoun(d.engagementType);
  const name = d.title ? `“${d.title}”` : 'an untitled set';
  if (d.status === DRAFT_STATUS.GENERATING) {
    return `Writing ${d.produced || 0}${d.requested ? ` of ${d.requested}` : ''} ${noun} for ${d.mode === 'append' ? name : `a new set, ${name}`}…`;
  }
  if (d.status === DRAFT_STATUS.FAILED && !d.produced) {
    return `Generation for ${name} failed — nothing to review.`;
  }
  return d.mode === 'append'
    ? `${d.produced} ${noun} to add to ${name}`
    : `A new set, ${name}: ${d.produced} ${noun}`;
}

export default function DraftsStrip({ drafts = [], onOpen }) {
  const waiting = waitingDrafts(drafts);
  const running = (drafts || []).filter((d) => d.status === DRAFT_STATUS.GENERATING);
  const discarded = restorableDrafts(drafts);
  if (!waiting.length && !running.length && !discarded.length) return null;

  return (
    <div className="qsets-alert qsets-alert--success qsets-drafts" role="status" data-testid="drafts-strip">
      <Icon name="Sparkle" weight="duotone" size={16} color="currentColor" />
      <div className="qsets-grow">
        {waiting.length > 0 && (
          <b>
            {waiting.length === 1 ? 'An AI draft is' : `${waiting.length} AI drafts are`} waiting for your review.
            {' '}Nothing is saved until you accept.
          </b>
        )}
        <ul className="qsets-drafts-list">
          {[...running, ...waiting].map((d) => (
            <li key={d.draftId}>
              <span>{describe(d)}</span>
              {d.daysLeft != null && d.status !== DRAFT_STATUS.GENERATING && (
                <span className="qsets-dim"> · kept {d.daysLeft} more day{d.daysLeft === 1 ? '' : 's'}</span>
              )}
              <button type="button" className="qsets-btn qsets-btn--sm qsets-btn--primary" onClick={() => onOpen && onOpen(d)}>
                {d.status === DRAFT_STATUS.GENERATING ? 'Watch' : 'Review'}
              </button>
            </li>
          ))}
          {discarded.map((d) => (
            <li key={d.draftId} className="qsets-dim">
              <span>Discarded: {describe(d)}. Restorable for {d.daysLeft ?? 7} more day{d.daysLeft === 1 ? '' : 's'}.</span>
              <button type="button" className="qsets-btn qsets-btn--sm" onClick={() => onOpen && onOpen(d)}>Restore…</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
