import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './RemoteQuestionBrowser.css';
import Icon from './Icon';
import { remoteQuestionRow, filterRemoteRows } from '../config/hostRemote';
import { authFetch } from '../auth/authFetch';

/**
 * The host's phone browsing the question set — `17-remote.html`, right phone.
 *
 * IT IS A PANE NOW, NOT A SCREEN, and that is the only thing about it that has
 * changed. It used to render its own `.hr` root, its own bar and its own dock,
 * with "Back to the round" filling the thumb arc — so for as long as the host
 * was reading four options they could not advance the round. The owner asked
 * for two more lists beside this one ("the players, the rounds, the
 * questions"), which would have made that trade three times as often, so the
 * chrome moved out to `RemoteSessionPanel`: one bar with one way back, one
 * dock that goes on carrying the primary action, three tabs under it.
 *
 * THE ASYMMETRY WITH THE STAGE BROWSER IS THE FEATURE, not a bug to reconcile.
 * `config/setupPanel.js:browserRow` strips the options out of every row on
 * purpose, because the stage's browser renders on the projector and a set that
 * records `correctAnswer` as the option's own TEXT would put the answer on the
 * wall. This browser renders on a phone in the host's hand, so it carries the
 * options AND the CORRECT flag. The mockup states the rule in one line and it is
 * printed at the foot of the list rather than left in a spec:
 *
 *   "Correct answers appear here and nowhere else. The stage lists the same
 *    questions without them."
 *
 * It owns one fetch — `GET question-sets/{setId}/questions`, the same endpoint
 * `GameHostPage.fetchQuestionsForBrowsing` calls, whole set in one request so
 * the search filters client-side and costs nothing. Asking is delegated to the
 * remote, which owns the cooldown and the error flash.
 */

const apiBase = () => window.API_BASE || '';

export default function RemoteQuestionBrowser({
  setId,
  unaskedCount = null,
  busy = false,
  onAsk,
}) {
  const [questions, setQuestions] = useState(null);
  const [setName, setSetName] = useState('');
  const [search, setSearch] = useState('');
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(null);

  useEffect(() => {
    if (!setId) return undefined;

    let cancelled = false;
    (async () => {
      try {
        // authFetch: this route now carries the Cognito authorizer. The phone
        // remote is a host surface and is signed in, so the token is there —
        // a plain fetch here would 401 the browser and render 'unavailable'.
        const res = await authFetch(`${apiBase()}question-sets/${setId}/questions`);
        if (cancelled) return;
        if (!res.ok) { setFailed(true); setQuestions([]); return; }
        const data = await res.json();
        if (cancelled) return;
        setQuestions(Array.isArray(data.questions) ? data.questions : []);
        setSetName(data.setName || '');
      } catch {
        if (!cancelled) { setFailed(true); setQuestions([]); }
      }
    })();

    return () => { cancelled = true; };
  }, [setId]);

  const rows = useMemo(
    () => (questions || []).map(remoteQuestionRow).filter((row) => row.id !== undefined),
    [questions]
  );
  const shown = useMemo(() => filterRemoteRows(rows, search), [rows, search]);

  const ask = useCallback(async (row) => {
    if (busy || asking) return;
    setAsking(row.id);
    try {
      await onAsk(row);
    } finally {
      setAsking(null);
    }
  }, [busy, asking, onAsk]);

  // "Strategic Pricing Plays · 31 unasked". The count is the SERVER's
  // `categoryCounts.totalRemaining` — how many questions the game can still
  // reach — and is simply absent when the game has not started and no counts
  // exist yet, rather than being back-filled with the list length, which would
  // report every asked question as unasked.
  const kicker = [
    setName || 'Question set',
    typeof unaskedCount === 'number' ? `${unaskedCount} unasked` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="hrq">
      {/* The set's own name and how much of it is left, kept from the screen
          this used to be: a host who opened the browser to choose needs to know
          which set they are choosing FROM, and "31 unasked" is the number that
          says whether choosing is even necessary. */}
      <p className="hrq-kicker">{kicker}</p>

      <label className="hrq-search">
        <Icon name="MagnifyingGlass" weight="bold" size={18} color="var(--muted)" />
        <input
          type="search"
          value={search}
          placeholder="Search titles…"
          aria-label="Search questions"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      {questions === null && <p className="hr-hint">Reading the question set…</p>}

      {failed && (
        <p className="hr-flash hr-flash--error" role="alert">
          <Icon name="Warning" weight="fill" size={18} color="currentColor" />
          Could not read the question set.
        </p>
      )}

      {questions !== null && !failed && shown.length === 0 && (
        <p className="hr-hint">
          {rows.length === 0 ? 'This set has no questions.' : 'Nothing matches that search.'}
        </p>
      )}

      {shown.map((row) => (
        <article className="hrq-card" key={row.id}>
          <h2 className="hrq-title">{row.title}</h2>
          {(row.category || row.difficulty) && (
            <p className="hrq-meta">
              {[row.category, row.difficulty].filter(Boolean).join(' · ')}
            </p>
          )}
          {row.detail && <p className="hrq-detail">{row.detail}</p>}

          {row.options.length > 0 && (
            <ol className="hrq-opts">
              {row.options.map((option) => (
                <li key={option.letter} className={option.correct ? 'is-right' : ''}>
                  <b>{option.letter}</b>
                  <span>
                    {option.text}
                    {option.correct && <em className="hrq-correct">Correct</em>}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {/* The set claims an answer that matches none of its own options.
              Said out loud: the host is about to read these to a room. */}
          {row.answerUnresolved && (
            <p className="hrq-unresolved">
              This set does not say which option is right.
            </p>
          )}

          <button
            className="hr-btn hr-btn--ghost hrq-ask"
            type="button"
            disabled={busy || asking !== null}
            onClick={() => ask(row)}
          >
            {asking === row.id ? 'Working…' : 'Ask this next'}
          </button>
        </article>
      ))}

      {shown.length > 0 && (
        <p className="hr-wait-private hrq-private">
          <b>Private</b> Correct answers appear here and nowhere else. The stage lists the
          same questions without them.
        </p>
      )}
    </div>
  );
}
