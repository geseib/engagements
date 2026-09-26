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
 *
 * `page` / `pageSize` — Task 8's stage walk-through. "the open answers in
 * large type, paged, so a long list cycles page by page." The wall has no
 * click-through of its own (there is nowhere on a projector to send a host
 * to read more), so instead of a preview-plus-link it renders exactly one
 * page of the SAME list, and the caller (SurveyWalkthrough.jsx) pairs it with
 * `components/stage/Pager.jsx`, which already states "answers 1-3 of 20" and
 * owns the ↑/↓ key that turns the page — so this drops its own foot line
 * entirely in paged mode rather than printing a second, competing count.
 * Both props must be given together; either omitted falls back to the
 * unchanged preview behaviour, so every existing caller (the console cut
 * sheet, the paper report) is untouched.
 */
export default function TextResult({
  question, onOpenAnswers, previewCount = 3, page = null, pageSize = null,
}) {
  const texts = Array.isArray(question.texts) ? question.texts : [];
  const n = (question.result && question.result.n) || 0;
  const paged = Number.isInteger(page) && Number.isInteger(pageSize) && pageSize > 0;
  const shown = paged
    ? texts.slice(page * pageSize, page * pageSize + pageSize)
    : texts.slice(0, previewCount);

  return (
    <div className="svr-text">
      {shown.length > 0 && (
        <ul className="svr-textlist">
          {shown.map((t) => <li key={t.id}>{t.text}</li>)}
        </ul>
      )}
      {!paged && (
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
      )}
    </div>
  );
}
