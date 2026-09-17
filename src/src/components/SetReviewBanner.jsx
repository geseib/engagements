import React, { useState } from 'react';
import Icon from './Icon';
import './SetReviewBanner.css';

/**
 * A SET THAT NEEDS CHANGES — docs/design/tenancy-redesign/06-share-rejected.html.
 *
 * Not a screen: the editor's state when the submitted version is flagged, was
 * rejected by a person, or was taken down (the staff note leads, spec §10.2).
 * The rejection NAMES the questions and QUOTES the finding's sentence — "two
 * of thirty is a five-minute edit; 'your set was rejected' is an abandoned
 * feature" (RATIONALE §3). The sentence is model-written text about the
 * author's own content; it is rendered as text, never markup.
 *
 * TOKEN-ONLY AND THEME-AGNOSTIC, deliberately. This sits inside the set
 * editor, which is still part-paper on the monolith stylesheet; declaring
 * `data-theme="dark"` here would make a dusk island in a paper form — the
 * defect the player shell just had removed, mirrored. Every pairing is asserted
 * on both grounds in __tests__/srevPalette.test.js.
 */
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const byQuestion = (findings) => {
  const map = new Map();
  for (const f of findings || []) {
    if (!f.questionId || f.questionId === '(set)') continue;
    if (!map.has(f.questionId)) map.set(f.questionId, []);
    map.get(f.questionId).push(f);
  }
  return [...map.entries()];
};
// Only a bare `q<digits>` id (e.g. "q014") gets the mockup's "Q14" short form.
// A real tenancy id like "c001#003" is returned verbatim — "Qc001#003" would
// be noise, not a label.
const label = (id) => (/^q0*\d+$/i.test(String(id)) ? `Q${String(id).replace(/^q0*/i, '')}` : String(id));

export default function SetReviewBanner({ entry, share, busy = false, onResubmit, onAppeal, onFocusQuestion }) {
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const review = entry && entry.review;
  const staffNote = share && share.note;
  const waiting = review === 'escalated' || review === 'appealed';
  const flagged = review === 'flagged' || (share && share.status === 'flagged');
  if (!waiting && !flagged) return null;

  if (waiting) {
    return (
      <section className="srev srev--waiting" role="status">
        <Icon name="UserCircle" weight="fill" size={18} color="var(--primary)" />
        <p>Waiting for a person at Engage to look at version {entry.version}. The outcome will show here.</p>
      </section>
    );
  }
  const questions = byQuestion(entry.reviewFindings);
  const setFindings = (entry.reviewFindings || []).filter((f) => f.questionId === '(set)');
  const total = Number(entry.questionCount) || 0;
  const passed = total ? total - questions.length : null;
  return (
    <section className="srev" role="status">
      <div className="srev-lead">
        <Icon name="Warning" weight="fill" size={18} color="var(--srev-flag-ink)" />
        <p>
          {staffNote && <><strong>From Engage:</strong> {staffNote} </>}
          <strong>This set was not published.</strong>{' '}
          {questions.length} of {total || '—'} questions were flagged{entry.checkedAt ? ` on ${day(entry.checkedAt)}` : ''}.
          Nothing was shared, and your copy is untouched — it is still private to your organisation and still usable in your own sessions.
        </p>
      </div>
      <h3 className="srev-h">What was flagged</h3>
      <ul className="srev-list">
        {questions.map(([id, findings]) => (
          <li key={id} className="srev-item">
            <div className="srev-item-head">
              <strong>{label(id)}</strong>
              {onFocusQuestion && (
                <button type="button" className="srev-btn srev-btn--sm" onClick={() => onFocusQuestion(id)}>Edit {label(id)}</button>
              )}
            </div>
            {findings.map((f, i) => (
              <p key={i} className="srev-why">{f.explanation || `Flagged for ${String(f.category || '').toLowerCase()}.`}</p>
            ))}
          </li>
        ))}
        {setFindings.map((f, i) => (
          <li key={`set-${i}`} className="srev-item">
            <div className="srev-item-head"><strong>The set's own text</strong></div>
            <p className="srev-why">{f.explanation || `The set's name, description or category names were flagged for ${String(f.category || '').toLowerCase()}.`}</p>
          </li>
        ))}
        {passed !== null && passed >= 0 && (
          <li className="srev-item srev-item--ok">
            <Icon name="Check" weight="bold" size={14} color="currentColor" /> The other {passed} questions passed. They are unchanged and need no attention.
          </li>
        )}
      </ul>
      <div className="srev-acts">
        {onResubmit && (
          <button type="button" className="srev-btn srev-btn--primary" disabled={busy} onClick={() => onResubmit(entry.version)}>Resubmit</button>
        )}
        {onAppeal && !asking && (
          <div className="srev-appeal">
            <p><strong>Think this is wrong?</strong> Ask a person to look at it. Automated review is deliberately cautious, and a set about safety is exactly the kind it gets wrong.</p>
            <button type="button" className="srev-btn" disabled={busy} onClick={() => setAsking(true)}>Ask for a human review</button>
          </div>
        )}
        {onAppeal && asking && (
          <div className="srev-appeal">
            <label htmlFor="srev-msg">Tell Engage why (optional)</label>
            <textarea id="srev-msg" className="srev-msg" maxLength={500} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="srev-acts">
              <button type="button" className="srev-btn" onClick={() => setAsking(false)}>Cancel</button>
              <button type="button" className="srev-btn srev-btn--primary" disabled={busy} onClick={() => onAppeal(entry.version, message.trim())}>Send</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
