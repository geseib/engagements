import React from 'react';
import { countWords } from '../utils/promptWorkbench';

/**
 * One half of a prompt, before and after, with its word count each side —
 * the workbench's rewrite (AIPromptAdvisor.jsx) and an uploaded file
 * (PromptImportReview.jsx) are read the same way. The count is on the heading
 * because "shorter" is the first question anyone asks of a rewrite.
 */
export default function PromptBeforeAfter({ title, before, after, testId, changedWord = 'rewritten' }) {
  const was = String(before ?? '');
  const now = String(after ?? '');
  return (
    <section className="result-section pmgr-rewrite-half" data-testid={testId}>
      <h4>
        {title}
        <span className="pmgr-advice-group-note">
          {' — '}{was === now ? 'unchanged' : changedWord}
          {' · '}{countWords(was)} → {countWords(now)} words
        </span>
      </h4>
      <div className="pmgr-rewrite-pair">
        <div className="pmgr-rewrite-side">
          <h5>Before</h5>
          <pre data-testid={`${testId}-before`}>{was}</pre>
        </div>
        <div className="pmgr-rewrite-side">
          <h5>After</h5>
          <pre data-testid={`${testId}-after`}>{now}</pre>
        </div>
      </div>
    </section>
  );
}
