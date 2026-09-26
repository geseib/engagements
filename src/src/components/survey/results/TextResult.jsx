import React from 'react';

/**
 * AN OPEN-ANSWER QUESTION'S RESULTS — a short preview of the words people
 * wrote, and a way to the full list (31-open-text.html). No theme grouping
 * here: that reading is Workie's (Phase 4, `SURVEY#ANALYSIS`), out of this
 * task's scope — this shows exactly what the frozen aggregate holds, the
 * plain list of answers.
 *
 * Presentational — see RatingResult.jsx's header for the shared contract.
 * `onOpenAnswers`, if given, is called with the question's `qid`; the host
 * console wires it to SurveyOpenAnswersPanel, the report (Task 4) need not
 * pass it at all.
 */
export default function TextResult({ question, onOpenAnswers, previewCount = 3 }) {
  const texts = Array.isArray(question.texts) ? question.texts : [];
  const n = (question.result && question.result.n) || 0;
  const preview = texts.slice(0, previewCount);

  return (
    <div className="svr-text">
      {preview.length > 0 && (
        <ul className="svr-textlist">
          {preview.map((t) => <li key={t.id}>{t.text}</li>)}
        </ul>
      )}
      <p className="svr-foot">
        {n} {n === 1 ? 'answer' : 'answers'}.
        {onOpenAnswers && n > 0 && (
          <>
            {' '}
            <button type="button" className="svr-link" onClick={() => onOpenAnswers(question.qid)}>
              Read all {n}
            </button>
          </>
        )}
      </p>
    </div>
  );
}
