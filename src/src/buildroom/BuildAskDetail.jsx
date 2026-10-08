/**
 * A PAST ASK, OPENED FROM HISTORY (docs/design/build-room-history-and-stage-decide R1).
 *
 * The choices as the room saw them (each with its mockup, bar and count), the
 * result, the one picked and how, what Claude was told, and how it got there.
 * Read-only: nothing here changes the decision. Room-safe, like all of
 * History: no player names, no host notes, no ClaudeNote.
 *
 * `entry` and `held` come from the page (the sending row; the For Claude, later list).
 * A picture opens the mockup viewer (onViewMockup(label)); the viewer's Back
 * returns here, because this window stays open behind it.
 */
import React from 'react';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import BuildImage from './BuildImage';
import { claudeKindLabel, decisionChain } from './buildScreens';

const KIND_WORD = { choice: 'Choose', suggest: 'Ideas', rating: 'Rate' };
const askNo = (askId) => Number(askId) || askId;
const clockOf = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
};

/** "Picked · the room's choice, 7 to 4": how the pick came about, in a few words. */
function pickWords(ask, count, others) {
  const method = (ask.decision && ask.decision.method) || 'vote';
  if (method === 'wheel') return "Picked · the wheel's choice";
  if (method === 'host') return "Picked · the host's pick";
  if (method === 'spoken') return 'Picked · said out loud';
  return others === null ? "Picked · the room's choice" : `Picked · the room's choice, ${count} to ${others}`;
}

function ChoiceCards({ ask, onViewMockup }) {
  const res = (ask.results && ask.results.options) || [];
  const chosen = (ask.decision && ask.decision.chosen) || [];
  const top = Math.max(1, ...res.map((o) => Number(o.count) || 0));
  return (
    <div className="brm-pa-cards">
      {(ask.options || []).map((o) => {
        const r = res.find((x) => x.label === o.label) || { count: 0 };
        const count = Number(r.count) || 0;
        const picked = chosen.includes(o.label);
        const others = res.filter((x) => x.label !== o.label).map((x) => Number(x.count) || 0);
        return (
          <div key={o.label} className={`brm-pa-card${picked ? ' is-pick' : ''}`} data-pick={picked ? 'true' : 'false'}>
            {o.imageId && <BuildImage imageId={o.imageId} alt={`Choice ${o.label}: ${o.title}`} className="brm-shot brm-pa-img" linked={false} onOpen={() => onViewMockup(o.label)} />}
            <div className="brm-pa-cb">
              <span className="brm-pa-letter" aria-hidden="true">{o.label}</span>
              <b className="brm-pa-title">{o.title}</b>
              <b className="brm-pa-count">{count}</b>
              <span className="brm-pa-bar" aria-hidden="true"><span style={{ width: `${Math.round((count / top) * 100)}%` }} /></span>
              {picked && <span className="brm-pa-tag">{pickWords(ask, count, res.length >= 2 ? Math.max(...others) : null)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IdeaRows({ ask }) {
  const ranked = (ask.results && ask.results.ranked) || [];
  const chosen = (ask.decision && ask.decision.chosen) || [];
  if (!ranked.length) return <p className="brm-empty">No ideas were put to a vote.</p>;
  return (
    <ol className="brm-pa-ideas">
      {ranked.map((r) => {
        const picked = chosen.includes(r.respId);
        return (
          <li key={r.respId} className={`brm-pa-idea${picked ? ' is-pick' : ''}`} data-pick={picked ? 'true' : 'false'}>
            <span className="brm-pa-ideatext">{r.text}</span>
            <b className="brm-pa-count">{r.votes || 0}</b>
            {picked && <span className="brm-pa-tag">{pickWords(ask, r.votes || 0, null)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function RatingSummary({ ask }) {
  const rating = (ask.results && ask.results.rating) || { avg: null, count: 0, dist: [0, 0, 0, 0, 0] };
  const max = Math.max(1, ...(rating.dist || []));
  return (
    <div className="brm-pa-rating">
      <div className="brm-pa-avg"><b>{rating.avg === null || rating.avg === undefined ? '–' : rating.avg}</b><span>average of {rating.count || 0}</span></div>
      <div className="brm-pa-dist">
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="brm-pa-distrow">
            <span>{n}</span>
            <span className="brm-pa-bar" aria-hidden="true"><span style={{ width: `${Math.round((((rating.dist || [])[n - 1] || 0) / max) * 100)}%` }} /></span>
            <b>{(rating.dist || [])[n - 1] || 0}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AskDetail({ ask, entry = null, held = false, onClose, onViewMockup }) {
  const d = ask.decision || {};
  const recordedOnly = d.sentToAgent === false;
  const chain = decisionChain(ask);
  // `entry` is the row that told Claude (the newest for this ask that went to it),
  // else the decision's own row; it knows the kind and the time. `held` is the page's
  // own For Claude, later list: held until it is sent, however the row reads.
  const kindLine = !held && entry && entry.as ? claudeKindLabel(entry.as) : '';
  const sentAt = (entry && entry.createdAt) || ask.decidedAt || d.decidedAt;
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--ask" onClose={onClose} closeOnBackdrop={false} labelledBy="brm-pa-q">
      <div className="brm-pa-head">
        <div>
          <div className="brm-pa-eb">Ask {askNo(ask.askId)} · {KIND_WORD[ask.kind] || 'Ask'} · decided {clockOf(ask.decidedAt || d.decidedAt)}</div>
          <h2 className="brm-pa-q" id="brm-pa-q">{ask.prompt}</h2>
        </div>
        <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost brm-push" onClick={onClose} aria-label="Close this window"><Icon name="X" size={16} /></button>
      </div>
      <div className="brm-pa-body">
        {ask.kind === 'choice' && <ChoiceCards ask={ask} onViewMockup={onViewMockup} />}
        {ask.kind === 'suggest' && <IdeaRows ask={ask} />}
        {ask.kind === 'rating' && <RatingSummary ask={ask} />}
        {ask.revotedAs && <p className="brm-hint">Voted again as ask {askNo(ask.revotedAs)}.</p>}
        <div className={`brm-pa-told${held ? ' is-held' : ''}`}>
          {recordedOnly ? <b>Recorded only, not sent to Claude</b>
            : held ? <b>Held for Claude, not sent yet</b>
              : <b>Claude was told</b>}
          {d.direction && <p className="brm-pa-dir">{`"${d.direction}"`}</p>}
          {!recordedOnly && (
            <span className="brm-pa-meta">
              {[kindLine, held ? '' : `sent ${clockOf(sentAt)}`, !held && d.deliveredAt ? 'Claude has it' : ''].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
        {chain.length > 0 && (
          <p className="brm-story-chain" aria-label="How it was decided">
            {chain.map((c, i) => (
              <React.Fragment key={c}>
                {i > 0 && <span className="brm-story-arrow" aria-hidden="true">→</span>}
                <span className="brm-story-step">{c}</span>
              </React.Fragment>
            ))}
          </p>
        )}
      </div>
      <div className="brm-pa-foot">
        {ask.kind === 'choice' && (ask.options || []).some((o) => o.imageId) && <span className="brm-hint">Click a mockup to look closer.</span>}
        <button type="button" className="brm-btn brm-btn--ghost brm-push" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
