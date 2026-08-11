import React from 'react';
import MarkdownRenderer from './MarkdownRenderer';

/**
 * The Field Notes body: whichever of Workie's four states is true right now.
 *
 * WHY THIS IS A COMPONENT. It was inline in GameHostPage's FIELD_NOTES branch,
 * where it had exactly three states — writing, written, and a placeholder. The
 * placeholder ("Nothing to read back yet — this fills in once responses are in")
 * is what a host saw when the *trigger request itself failed*, which is a
 * sentence that is not true and offers nothing to do about it. Adding a fourth
 * state is the fix; making it a component is what lets the fourth state be
 * tested, because GameHostPage cannot be rendered in jsdom — it dies on the auth
 * provider — and six earlier fixes in this repo took the same route.
 *
 * FAILURE OUTRANKS EVERYTHING. A failure is shown even while an automatic retry
 * is pending: the honest thing to put in front of a room is "this went wrong and
 * I am trying again", not a spinner that hides the first half of that. `retrying`
 * only changes the button, never whether the message is there.
 *
 * Classes are the stage's own (`qdetail`, `notes`, `lead`, `btn`) — the failure
 * block introduces no styling of its own, so it inherits the stage's type scale
 * and stays legible from the back of a room.
 */
export default function AISummaryStatus({
  loading = false,
  insights = null,
  failure = null,
  retrying = false,
  onRetry = null,
}) {
  if (failure) {
    return (
      <div className="ai-summary-failure" role="alert">
        <p className="qdetail ai-summary-failure-headline"><b>{failure.headline}</b></p>
        <p className="qdetail ai-summary-failure-detail">{failure.detail}</p>
        {onRetry && (
          <button
            type="button"
            className="btn ghost ai-summary-retry-btn"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? 'Trying again…' : 'Try again'}
          </button>
        )}
      </div>
    );
  }

  if (loading) {
    return <p className="qdetail">Workie is reading the responses…</p>;
  }

  if (insights) {
    // `two` is the mockup's own two-column Field Notes grid (09-field-notes):
    // width is the cheapest lever on the stage, and this state needs it most.
    // It only applies to the structured path, which has two children to split.
    // The markdown path is ONE child, so a two-column grid would squeeze it
    // into half the stage; stage.css splits that one with CSS columns instead.
    return (
      <div className={`notes${insights.markdownResponse ? '' : ' two'}`}>
        {insights.markdownResponse ? (
          <MarkdownRenderer content={insights.markdownResponse} className="notes-md" />
        ) : (
          <>
            {/* Markdown, not a bare string: the structured path still carries
                the model's **bold** in its summary text, and a <p> printed the
                asterisks on the wall. */}
            <MarkdownRenderer content={insights.summary} className="lead" />
            <ol>
              {(insights.discussionTopics || []).map((topic, idx) => (
                <li key={idx}><b>{idx + 1}</b><span>{topic}</span></li>
              ))}
              {(insights.nextSteps || []).map((step, idx) => (
                <li key={`n${idx}`}><b>→</b><span>{step}</span></li>
              ))}
            </ol>
          </>
        )}
      </div>
    );
  }

  return (
    <p className="qdetail">
      Nothing to read back yet — this fills in once responses are in.
    </p>
  );
}
