import React, { useMemo, useState } from 'react';
import Icon from './Icon';
import './SurveyResultsPanel.css';

/**
 * ONE QUESTION'S OPEN ANSWERS, IN FULL — mockup 31
 * (docs/design/survey-redesign/31-open-text.html), reached from that
 * question's KindResult card ("Read all N") on SurveyResultsPanel.
 *
 * NO THEME GROUPING. `31-open-text.html`'s left rail (a theme picked out by
 * Workie, with a representative quote) is Phase 4's read
 * (`SURVEY#ANALYSIS`) — out of this task's scope, per the brief. This shows
 * exactly what `GET /games/{id}/survey-results` freezes: every answer, in
 * the order the aggregate numbered them (a content hash, never arrival
 * order — survey-aggregate.js "TEXT IDS CARRY NO ORDER"), with a client-side
 * search over the words. No minimum group size: however few answers there
 * are, every one of them is here (the owner's ruling, 26 Sep 2026).
 *
 * Presentational: `question` is one entry already fetched by the panel above
 * it. No fetching, no name anywhere — the aggregate this reads never carried
 * one.
 */
export default function SurveyOpenAnswersPanel({ question, onBack }) {
  const [search, setSearch] = useState('');
  const texts = useMemo(
    () => (Array.isArray(question && question.texts) ? question.texts : []),
    [question]
  );
  const n = (question && question.result && question.result.n) || texts.length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return texts;
    return texts.filter((t) => t.text.toLowerCase().includes(q));
  }, [texts, search]);

  return (
    <div className="svrp-page" data-theme="dark">
      <div className="svrp-toolbar">
        <button type="button" className="svrp-tool svrp-tool--back" onClick={onBack}>
          <Icon name="ArrowLeft" weight="bold" size={16} /> Back to results
        </button>
      </div>

      <div className="svrp-body">
        <header className="svrp-head">
          <h1>{(question && question.title) || 'Open answers'}</h1>
          <p className="svrp-sub">{n} {n === 1 ? 'answer' : 'answers'}</p>
        </header>

        {texts.length === 0 ? (
          <p className="svrp-empty">No answers yet.</p>
        ) : (
          <section className="svrp-panel">
            <header className="svrp-panel-head">
              <p className="svrp-panel-note">
                {shown.length === texts.length ? `${texts.length} answers` : `${shown.length} of ${texts.length} answers`}
              </p>
              <div className="svrp-search">
                <Icon name="MagnifyingGlass" weight="bold" size={14} />
                <input
                  className="svrp-search-input"
                  type="search"
                  placeholder="Search answers"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search answers"
                />
              </div>
            </header>
            {shown.length === 0 ? (
              <p className="svrp-empty">No answer matches that search.</p>
            ) : (
              <ul className="svrp-answerlist">
                {shown.map((t) => <li key={t.id}>{t.text}</li>)}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
