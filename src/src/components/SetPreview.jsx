import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import Button from './ui/Button';
import { DialogHead, DialogFoot } from './ui/DialogParts';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { isUnreadableSet, UNREADABLE_REASON } from '../utils/unreadableSet';
import { setOwnerTag, setOwnerLabel, TEAM } from '../utils/setOwnerTag';
import { SET_TOPICS, setTopicLabel } from '../config/setTopics';
import { previewPath, previewFailure, setHeadline, groupByCategory } from '../config/setPreview';
import './SetPreview.css';

/**
 * A SET, BEFORE IT IS CHOSEN (owner, 7 Nov 2026: "add the set preview to the
 * new engagement dialog"). Read-only: the set's name, format, owner, topic,
 * tags and description, then its questions by category.
 *
 * A LAYER, NOT A MODAL IN THE MODAL. GameSetupDialog hangs it off its own
 * overlay through `afterContent`, a sibling of the create card exactly as
 * HostQuestionSetsDialog is, so the half-filled form underneath is never
 * unmounted. Modal's DOM-containment rule makes this the topmost dialog: Esc
 * and Tab are answered here, and the create card's own Esc stays quiet.
 *
 * TWO EXITS AND ONE ACTION: the X, Back and Esc all go through `onClose`;
 * **Use this set** (`onUse`, absent on an edit, whose set is fixed) chooses it
 * the way a row click does. Focus moves to the panel's heading on open and
 * Modal returns it to the Preview button that opened it.
 *
 * AN UNREADABLE SET IS NEVER FETCHED: the row's own refusal is all there is.
 */
const TITLE_ID = 'setpv-title';

export default function SetPreview({
  set,
  onClose,
  onUse = null,
  ownerLabels = {},
  teamName = '',
}) {
  const unreadable = isUnreadableSet(set);
  const [state, setState] = useState({ loading: !unreadable, error: '', questions: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (unreadable || !set) return undefined;
    let live = true;
    setState({ loading: true, error: '', questions: [] });
    (async () => {
      try {
        const res = await authFetch(adminApiUrl(previewPath(set)));
        if (!live) return;
        if (!res || !res.ok) { setState({ loading: false, error: previewFailure(res && res.status), questions: [] }); return; }
        const data = await res.json();
        if (!live) return;
        setState({ loading: false, error: '', questions: Array.isArray(data && data.questions) ? data.questions : [] });
      } catch {
        if (live) setState({ loading: false, error: previewFailure(0), questions: [] });
      }
    })();
    return () => { live = false; };
  }, [set, unreadable, attempt]);

  if (!set) return null;
  const { format, bluff } = setHeadline(set);
  const tag = setOwnerTag(set);
  const owner = tag === TEAM && teamName ? teamName : (ownerLabels[tag] || setOwnerLabel(set));
  const topic = set.topic && SET_TOPICS[set.topic] ? setTopicLabel(set.topic) : '';
  const tags = Array.isArray(set.tags) ? set.tags : [];
  const count = Number(set.totalQuestions || set.questionCount) || 0;
  const groups = groupByCategory(state.questions, set.engagementType);
  const shown = state.questions.length;
  const name = unreadable ? 'Unreadable set' : set.name;
  const sub = [format, bluff ? 'Bluff round set' : '', `${count} ${count === 1 ? 'question' : 'questions'}`, owner]
    .filter(Boolean).join(' · ');

  return (
    <Modal
      overlayClassName="ui-scrim setpv-scrim"
      contentClassName="ui-dialog ui-dialog--full setpv"
      labelledBy={TITLE_ID}
      theme="dark"
      onClose={onClose}
      closeOnBackdrop={false}
      initialFocus={`#${TITLE_ID}`}
    >
      <DialogHead
        titleId={TITLE_ID}
        title={name}
        titleProps={{ tabIndex: -1 }}
        eyebrow={bluff ? 'Preview · Bluff round set' : 'Preview'}
        eyebrowClassName="setpv-eyebrow"
        sub={sub}
        subClassName="setpv-sub"
        onClose={onClose}
        closeLabel="Back to Create engagement"
      />
      <div className="ui-dialog-body setpv-body" data-testid="set-preview">
        {unreadable ? (
          <p className="setpv-refusal" role="alert">{UNREADABLE_REASON}</p>
        ) : (
          <>
            {(topic || tags.length > 0 || set.description) && (
              <div className="setpv-meta">
                {(topic || tags.length > 0) && (
                  <p className="setpv-line">
                    {topic && <span className="setpv-dim">Topic: <b>{topic}</b></span>}
                    {tags.map((t) => <span key={t} className="setpv-tag">{t}</span>)}
                  </p>
                )}
                {set.description && <p className="setpv-desc">{set.description}</p>}
              </div>
            )}
            <div aria-live="polite" aria-busy={state.loading || undefined}>
              {state.loading && <p className="setpv-dim">Loading the questions…</p>}
              {!state.loading && state.error && (
                <div className="setpv-error" role="alert">
                  <p>{state.error}</p>
                  <Button size={36} onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
                </div>
              )}
              {!state.loading && !state.error && shown === 0 && (
                <p className="setpv-dim">This set has no questions yet.</p>
              )}
            </div>
            {!state.loading && !state.error && groups.map((g) => (
              <section key={g.name || 'all'} className="setpv-cat" aria-label={g.name || 'Questions'}>
                {g.name && (
                  <h3 className="setpv-cat-h">{g.name} <span className="setpv-dim">{g.items.length}</span></h3>
                )}
                <ol className="setpv-qs">
                  {g.items.map((q, i) => (
                    <li key={q.id || `${g.name}-${i}`} className="setpv-q">
                      {q.image && (
                        <img className="setpv-thumb" src={q.image} alt={q.title || 'Question image'} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      )}
                      <div className="setpv-qbody">
                        <p className="setpv-qtitle">
                          {q.title || 'Untitled question'}
                          {q.kind && <span className="setpv-kind">{q.kind}</span>}
                        </p>
                        {q.detail && <p className="setpv-qdetail">{q.detail}</p>}
                        {q.scaleNote && <p className="setpv-dim">Scale {q.scaleNote}</p>}
                        {q.options.length > 0 && (
                          <ul className="setpv-opts">
                            {q.options.map((o, j) => (
                              <li key={j} className={o.correct ? 'is-correct' : undefined}>
                                {o.letter && <b className="setpv-letter">{o.letter}</b>}
                                <span>{o.text}</span>
                                {o.correct && <span className="setpv-right"><Icon name="Check" size={14} /> Correct</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </>
        )}
      </div>
      <DialogFoot cancel={<Button size={44} onClick={onClose}>Back</Button>}>
        {onUse && !unreadable && <Button variant="primary" size={44} onClick={() => onUse(set)}>Use this set</Button>}
      </DialogFoot>
    </Modal>
  );
}
