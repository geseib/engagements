/**
 * The Field Notes body — the thing the host is actually looking at.
 *
 * GameHostPage cannot be rendered in jsdom (it dies on the auth provider), which
 * is why this surface was extracted. The one assertion that matters most here:
 * a FAILED summary and a summary that has not started yet must not look the
 * same. They did — both fell through to "Nothing to read back yet" — and that is
 * how a host spent a session waiting on a request that never left the browser.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AISummaryStatus from '../components/AISummaryStatus';
import { classifyAISummaryFailure } from '../utils/aiSummaryRecovery';

const offline = classifyAISummaryFailure({
  error: new TypeError('Failed to fetch'), online: false,
});
const rejected = classifyAISummaryFailure({ status: 404, online: true });

describe('AISummaryStatus', () => {
  // rejects: deleting the failure branch, or leaving the placeholder in its
  // place. This is the defect itself.
  it('does not show the empty-state placeholder when the summary failed', () => {
    render(<AISummaryStatus failure={offline} onRetry={() => {}} />);

    expect(screen.queryByText(/nothing to read back yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(offline.headline)).toBeInTheDocument();
    expect(screen.getByText(offline.detail)).toBeInTheDocument();
  });

  // rejects: showing a spinner over a failure. "Reading the responses…" is a
  // claim that work is happening; after a failed trigger, none is.
  it('shows the failure rather than the spinner when both are set', () => {
    render(<AISummaryStatus loading failure={offline} onRetry={() => {}} />);

    expect(screen.queryByText(/reading the responses/i)).not.toBeInTheDocument();
    expect(screen.getByText(offline.headline)).toBeInTheDocument();
  });

  // rejects: dropping the retry control, leaving the host informed but stuck.
  it('offers a retry the host can press, and reports the press', () => {
    const onRetry = jest.fn();
    render(<AISummaryStatus failure={offline} onRetry={onRetry} />);

    const button = screen.getByRole('button', { name: /try again/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // rejects: leaving the button live during an automatic retry, which lets a
  // host queue a second trigger on top of the one already in flight.
  it('locks the retry while an automatic attempt is already running', () => {
    render(<AISummaryStatus failure={offline} retrying onRetry={() => {}} />);

    const button = screen.getByRole('button', { name: /trying again/i });
    expect(button).toBeDisabled();
  });

  // rejects: printing one generic "AI generation failed" for every cause. The
  // room's wifi and a server refusal are different problems with different fixes.
  it('says something different for offline than for a server refusal', () => {
    const { unmount } = render(<AISummaryStatus failure={offline} />);
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
    unmount();

    render(<AISummaryStatus failure={rejected} />);
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(screen.getByText(/404/)).toBeInTheDocument();
  });

  // rejects: a silent banner. A host watching the room, not the laptop, needs
  // this announced rather than merely drawn.
  it('marks the failure as an alert', () => {
    render(<AISummaryStatus failure={offline} />);
    expect(screen.getByRole('alert')).toHaveTextContent(offline.headline);
  });

  it('shows the spinner line while the summary is genuinely being written', () => {
    render(<AISummaryStatus loading />);
    expect(screen.getByText(/reading the responses/i)).toBeInTheDocument();
  });

  // rejects: breaking the extraction — the states that already worked must
  // still work, in both of Field Notes' two shapes.
  it('renders a markdown summary in the single-column shape', () => {
    const { container } = render(
      <AISummaryStatus insights={{ markdownResponse: '## Summary\n\nMTV, **1988**.' }} />
    );

    expect(screen.getByText(/MTV/)).toBeInTheDocument();
    // `two` is the structured grid; a one-child markdown body must not get it,
    // or it is squeezed into half the stage.
    expect(container.querySelector('.notes')).not.toHaveClass('two');
  });

  it('renders a structured summary with its topics and next steps', () => {
    const { container } = render(
      <AISummaryStatus insights={{
        summary: 'Split decision.',
        discussionTopics: ['Who watched MTV?'],
        nextSteps: ['Next question.'],
      }} />
    );

    expect(screen.getByText('Split decision.')).toBeInTheDocument();
    expect(screen.getByText('Who watched MTV?')).toBeInTheDocument();
    expect(screen.getByText('Next question.')).toBeInTheDocument();
    expect(container.querySelector('.notes')).toHaveClass('two');
  });

  it('falls back to the placeholder only when nothing has happened yet', () => {
    render(<AISummaryStatus />);
    expect(screen.getByText(/nothing to read back yet/i)).toBeInTheDocument();
  });
});
