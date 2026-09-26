import React, { useMemo, useState } from 'react';
import Icon from './Icon';
import KindResult from './survey/results/KindResult';
import SurveyOpenAnswersPanel from './SurveyOpenAnswersPanel';
import { namesMode } from '../config/surveyNames';
import './SurveyResultsPanel.css';

/**
 * THE SURVEY'S RESULTS — mockup 30
 * (docs/design/survey-redesign/30-results.html), the raw tallies cut the
 * brief describes: "average score, % and count for choices, list of feedback
 * with open text," one KindResult per question. NOT built here, per the task
 * brief's explicit scope: Workie's read (Phase 4, the "Workie's read" panel
 * and the per-card notes), CSV export and Share results (Phase 4/5), and the
 * report section (Task 4, a different surface reusing the same KindResult
 * components).
 *
 * A "Read all N" on a text question's card opens SurveyOpenAnswersPanel
 * (mockup 31) for that one question; its Back returns here without losing
 * the fetch that got the host here.
 *
 * SHELL PATTERN LIFTED FROM GameReport.jsx: `results` is already-fetched
 * (GameHostPage does the GET the way `generateReportForGame` does the POST
 * for the report), `status`/`error` mirror its loading/error/ready
 * contract, and `onClose`/`onRetry` are callbacks, not routes — this panel
 * never calls the network itself.
 *
 * `title` (fix round 2, Task 3 review): the session's own title, if the
 * caller has it cheaply — `GET /games/{id}/survey-results` returns no title
 * of its own (survey-host.js `results()`'s response is counts, kind fields
 * and texts only), and this panel is now reachable for ANY closed survey
 * from the Sessions list, not only the one on stage. Shown in the toolbar,
 * in every status, so a host who opened the wrong survey — or retried after
 * a failed fetch — sees which session they are looking at rather than a
 * silently-plausible page of someone else's numbers.
 */
export default function SurveyResultsPanel({
  results,
  status = 'ready',
  error = null,
  title = '',
  onClose,
  onRetry = null,
}) {
  const [openQid, setOpenQid] = useState(null);

  const openQuestion = useMemo(() => {
    if (!openQid || !results || !Array.isArray(results.questions)) return null;
    return results.questions.find((q) => q.qid === openQid) || null;
  }, [openQid, results]);

  if (openQuestion) {
    return <SurveyOpenAnswersPanel question={openQuestion} onBack={() => setOpenQid(null)} />;
  }

  const ready = status === 'ready' && results;
  const questions = ready && Array.isArray(results.questions) ? results.questions : [];
  const n = ready ? Number(results.n) || 0 : 0;

  return (
    <div className="svrp-page" data-theme="dark">
      <div className="svrp-toolbar">
        <button type="button" className="svrp-tool svrp-tool--back" onClick={onClose}>
          <Icon name="ArrowLeft" weight="bold" size={16} /> Back to session
        </button>
        {title ? <span className="svrp-toolbar-title">{title}</span> : null}
      </div>

      {status === 'loading' && (
        <div className="svrp-state" role="status" aria-live="polite">
          <div className="svrp-spinner" aria-hidden="true" />
          <h2>Loading the results</h2>
          <p>Every open reads the frozen tallies fresh.</p>
        </div>
      )}

      {status === 'error' && (
        <div className="svrp-state svrp-state--error" role="alert">
          <Icon name="WarningCircle" weight="duotone" size={44} color="var(--danger)" />
          <h2>The results could not be loaded</h2>
          <p>{error || 'Something went wrong on the way to the survey record.'}</p>
          <div className="svrp-state-actions">
            {onRetry && (
              <button type="button" className="svrp-tool svrp-tool--primary" onClick={onRetry}>
                <Icon name="ArrowsClockwise" weight="bold" size={16} /> Try again
              </button>
            )}
            <button type="button" className="svrp-tool" onClick={onClose}>Back to session</button>
          </div>
        </div>
      )}

      {ready && (
        <div className="svrp-body">
          <header className="svrp-head">
            <div>
              <h1>Survey results</h1>
              <p className="svrp-sub">
                <span className="svrp-names-chip">
                  <Icon name="UsersThree" weight="bold" size={13} />
                  Names: {namesMode(results.names).label}
                </span>
              </p>
            </div>
            <div className="svrp-kpis">
              <div className="svrp-kpi">
                <b>{results.finished || 0}</b>
                <span>finished{n !== results.finished ? ` of ${n} who answered something` : ''}</span>
              </div>
            </div>
          </header>

          {n === 0 ? (
            <p className="svrp-empty">No answers yet.</p>
          ) : (
            <div className="svrp-grid">
              {questions.map((q) => (
                <KindResult
                  key={q.qid}
                  question={q}
                  onOpenAnswers={q.kind === 'text' ? setOpenQid : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
