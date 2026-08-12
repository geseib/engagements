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

/**
 * FIELD NOTES PAGES, which is the state the first pager missed.
 *
 * VOTE and RESULTS page a list of answer cards. This is one continuous
 * document, so there were no items to slice and the summary ran off the bottom
 * of `.content{overflow:hidden}` — the owner's *"still some cutoff and no way
 * to scroll down… most apparent in the ai feedback page results."*
 *
 * No geometry anywhere: jsdom reports every box as zero, so "does page one fit"
 * would pass with the whole feature deleted. What is asserted is which text is
 * on screen, what the pager line says, and what the keys do.
 */
const section = (heading, n) =>
  [`## ${heading}`, ...Array.from({ length: n }, (u, i) =>
    `${i + 1}. ${'word '.repeat(20).trim()}`)].join('\n\n');

const THREE_SECTIONS = [
  section('Summary', 3), section('Discussion Questions', 3), section('Next Steps', 3),
].join('\n\n');

describe('AISummaryStatus paging', () => {
  it('shows one section at a time and names it on the pager line', () => {
    // THE FIX ITSELF. rejects: rendering the whole summary and drawing a pager
    // over it, which is the shortest edit that makes the feature look present.
    const { container, rerender } = render(
      <AISummaryStatus insights={{ markdownResponse: THREE_SECTIONS }}
        profile="room" page={0} onPage={() => {}} />
    );
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.queryByText('Next Steps')).not.toBeInTheDocument();
    expect(container.querySelector('.pgr-label').textContent)
      .toBe('Summary · page 1 of 3 · ↑ ↓ to page');

    rerender(<AISummaryStatus insights={{ markdownResponse: THREE_SECTIONS }}
      profile="room" page={2} onPage={() => {}} />);
    expect(screen.getByText('Next Steps')).toBeInTheDocument();
    expect(screen.queryByText('Summary')).not.toBeInTheDocument();
    expect(container.querySelector('.pgr-label').textContent)
      .toBe('Next Steps · page 3 of 3 · ↑ ↓ to page');
  });

  it('the page keys turn the page', () => {
    // rejects: rendering the position and binding nothing — the version that
    // passes every assertion above and leaves the owner exactly where he was.
    // The keys are the only route a host driving from a clicker has.
    const onPage = jest.fn();
    render(<AISummaryStatus insights={{ markdownResponse: THREE_SECTIONS }}
      profile="room" page={0} onPage={onPage} />);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it('an overlay that takes SPACE away takes the page keys away too', () => {
    // rejects: dropping `enabled` on the way through to Pager, or inventing a
    // second suppression rule here beside shortcutsSuppressed. A pinned QR
    // covers the summary being paged.
    const onPage = jest.fn();
    render(<AISummaryStatus insights={{ markdownResponse: THREE_SECTIONS }}
      profile="room" page={0} onPage={onPage} enabled={false} />);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(onPage).not.toHaveBeenCalled();
  });

  it('the budget comes from the display profile', () => {
    // rejects: a constant budget. The owner's report names the large displays,
    // and TV's ladder is the one that holds least — a literal is the version
    // that goes on cutting TV off. TV must need at least as many pages as Room
    // for the same summary.
    const pagesAt = (profile) => {
      const { container, unmount } = render(
        <AISummaryStatus insights={{ markdownResponse: section('Next Steps', 12) }}
          profile={profile} page={0} onPage={() => {}} />
      );
      const n = container.querySelectorAll('.pip').length;
      unmount();
      return n;
    };
    expect(pagesAt('tv')).toBeGreaterThan(pagesAt('table'));
  });

  it('a summary that fits gets no pager at all', () => {
    // rejects: an unconditional pager. One page is not a page: a line of stage
    // spent telling a room about a control that would do nothing.
    const { container } = render(
      <AISummaryStatus insights={{ markdownResponse: '## Summary\n\nShort.' }}
        profile="room" page={0} onPage={() => {}} />
    );
    expect(container.querySelector('[data-pager]')).toBeNull();
  });

  it('without an onPage nothing is sliced and nothing is drawn', () => {
    // rejects: slicing unconditionally. A caller with no state to hold the
    // index would get a silently truncated summary and no way to reach the
    // rest — strictly worse than the overflow this replaces.
    const { container } = render(
      <AISummaryStatus insights={{ markdownResponse: THREE_SECTIONS }} profile="room" />
    );
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('Next Steps')).toBeInTheDocument();
    expect(container.querySelector('[data-pager]')).toBeNull();
  });

  it('pages the structured shape by its points, keeping the lead on every page', () => {
    // The legacy shape is already a LIST, so it takes the answer cards' own
    // per-profile budget — 09-field-notes.html draws exactly three points at
    // Room. The lead is the thesis and lives in the OTHER column of `.notes.two`,
    // so keeping it costs the points no vertical stage.
    //
    // rejects: paging the lead away with the points, which leaves page 2 as
    // claims with no claim.
    const insights = {
      summary: 'Split decision.',
      discussionTopics: ['q1', 'q2', 'q3', 'q4'],
      nextSteps: ['s1'],
    };
    const { container, rerender } = render(
      <AISummaryStatus insights={insights} profile="room" page={0} onPage={() => {}} />
    );
    expect(screen.getByText('Split decision.')).toBeInTheDocument();
    expect(screen.getByText('q1')).toBeInTheDocument();
    expect(screen.queryByText('s1')).not.toBeInTheDocument();
    expect(container.querySelector('.pgr-label').textContent)
      .toBe('Notes 1–3 of 5 · page 1 of 2 · ↑ ↓ to page');

    rerender(<AISummaryStatus insights={insights} profile="room" page={1} onPage={() => {}} />);
    expect(screen.getByText('Split decision.')).toBeInTheDocument();
    expect(screen.getByText('s1')).toBeInTheDocument();
  });

  it('numbers the structured points absolutely, not per page', () => {
    // THE POSITIONAL-LABEL TRAP IN ITS FIELD NOTES FORM. Page two's first
    // question must be "4", not "1" — the host and the session report both call
    // it 4, and the same trap on the answer cards is what pageSlice's `offset`
    // exists for.
    //
    // rejects: `slice.items.map((p, idx) => <b>{idx + 1}</b>)`, which is the
    // shortest edit that makes paging appear to work.
    const { container } = render(
      <AISummaryStatus
        insights={{ summary: 's', discussionTopics: ['q1', 'q2', 'q3', 'q4', 'q5'] }}
        profile="room" page={1} onPage={() => {}}
      />
    );
    const marks = [...container.querySelectorAll('.notes ol li b')].map((b) => b.textContent);
    expect(marks).toEqual(['4', '5']);
  });
});
