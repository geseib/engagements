/**
 * THE ROUND ARTIFACT, ON ITS OWN.
 *
 * The owner asked that in a feedback round every participant hold *"a copy of
 * the feedback report (the same item that is avail when you click the previous
 * round in the session rounds screen"*. That item is `PastRound` — but
 * `PastRound` is a `<Modal>`, and a modal is the wrong container for a
 * participant's primary surface: it owns Escape, a focus trap and a scroll
 * lock, and it carries a close button that would strand the participant on an
 * empty page. `RemoteSessionPanel` already establishes that this codebase does
 * not put a modal over a phone's primary surface.
 *
 * So the BODY is extracted and both surfaces render it:
 *
 *     PastRound  = <Modal> + head + <RoundReport/> + prev/next nav   (host)
 *     PlayerPage = <RoundReport/> inline, in the player's shell       (room)
 *
 * One renderer in two containers — which is what "reuse it rather than build a
 * second renderer" actually requires.
 *
 * The class names are deliberately unchanged. `src/src/styles.css:11651-11855`
 * styles this markup, and `sessionHistory.test.jsx` asserts against it; if that
 * suite moves, the extraction changed the host's DOM and the extraction is what
 * is wrong.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RoundReport from '../components/RoundReport';

/** Comments as `create-report.js` emits them, and as GET /comments returns them. */
const COMMENTS = [
  {
    commentId: 'c1', anchorKind: 'summary', anchorRef: '',
    anchorLabel: 'AI summary', anchorExcerpt: 'The room wants to defend price',
    text: 'It misses that nobody proposed telling a customer why.',
    playerName: 'Dana Whitfield', submittedAt: '2026-08-27T10:00:00.000Z',
  },
  {
    commentId: 'c2', anchorKind: 'response', anchorRef: '1',
    anchorLabel: 'Response 2 — Sam Ortiz', anchorExcerpt: 'Re-price the onboarding package',
    text: 'This is the only one that touches the customer conversation.',
    playerName: 'Lee Chen', submittedAt: '2026-08-27T10:01:00.000Z',
  },
  {
    commentId: 'c3', anchorKind: 'results', anchorRef: '',
    anchorLabel: 'Results', anchorExcerpt: '', text: 'Two of these are the same move.',
    playerName: 'Dana Whitfield', submittedAt: '2026-08-27T10:02:00.000Z',
  },
];

/** A round in the shape `config/sessionHistory.js` normalises to. */
function aRound(over = {}) {
  return {
    number: '003',
    ordinal: 3,
    title: 'Competitive response',
    detail: 'Our largest competitor cut list price 20% this morning.',
    image: '',
    school: '',
    options: [],
    answerDetails: '',
    answers: [
      { rank: 1, answer: 'Freeze all discretionary discounting for thirty days.', playerName: 'Dana Whitfield', totalScore: 7 },
      { rank: 1, answer: 'Re-price the onboarding package as a paid engagement.', playerName: 'Sam Ortiz', totalScore: 7 },
      { rank: 3, answer: 'Call our ten largest accounts before they hear it from the rep.', playerName: 'Lee Chen', totalScore: 4 },
    ],
    aiSummary: {
      summaryText: 'The room wants to defend price, but nobody proposed telling a customer why.',
      discussionQuestions: ['Who are we prepared to lose?'],
      nextSteps: ['Publish the win/loss reasons weekly.'],
      personaName: 'Workie',
    },
    ...over,
  };
}

describe('the three sections', () => {
  test('renders the question, the responses and the AI summary', () => {
    render(<RoundReport round={aRound()} />);
    expect(screen.getByText('Competitive response')).toBeInTheDocument();
    expect(screen.getByText('Responses')).toBeInTheDocument();
    expect(screen.getByText('AI summary')).toBeInTheDocument();
    expect(screen.getByText(/The room wants to defend price/)).toBeInTheDocument();
  });

  test('says so plainly when nobody responded', () => {
    // A round with no responses is a real outcome. An empty list reads as a
    // load that failed and sends the reader looking for a bug.
    render(<RoundReport round={aRound({ answers: [] })} />);
    expect(screen.getByText('Nobody responded to this round.')).toBeInTheDocument();
  });

  test('says so plainly when there is no summary', () => {
    render(<RoundReport round={aRound({ aiSummary: null })} />);
    expect(screen.getByText('No summary was generated for this round.')).toBeInTheDocument();
  });
});

describe('the Regenerate control belongs to the host, not the room', () => {
  test('renders when a handler is supplied', () => {
    render(<RoundReport round={aRound()} onRegenerate={jest.fn()} />);
    expect(screen.getByRole('button', { name: /Regenerate summary/ })).toBeInTheDocument();
  });

  /*
    The participant must not be offered a control that re-runs a Bedrock call
    for the whole room. Gating on the handler existing — rather than rendering a
    dead button — is the same rule the design system states for dialog exits: a
    dead control is the one people reach for first.
  */
  test('is absent when no handler is supplied', () => {
    render(<RoundReport round={aRound()} />);
    expect(screen.queryByRole('button', { name: /Regenerate|Generate/ })).toBeNull();
  });

  test('is given the round number, not the index', () => {
    const onRegenerate = jest.fn();
    render(<RoundReport round={aRound()} onRegenerate={onRegenerate} />);
    fireEvent.click(screen.getByRole('button', { name: /Regenerate summary/ }));
    // '003' — the zero-padded string the ai-summary endpoint wants as its
    // questionId. A bare 3 would 404 there.
    expect(onRegenerate).toHaveBeenCalledWith('003');
  });
});

describe('opening one response', () => {
  test('every row is reachable, not only the podium', () => {
    render(<RoundReport round={aRound()} />);
    // Three rows, three controls. A fourth-place response with no way to open
    // it would be a response nobody can read, since the row shows a snippet.
    expect(screen.getByRole('button', { name: /Read response 1 in full/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Read response 2 in full/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Read response 3 in full/ })).toBeInTheDocument();
  });

  /*
    THE PRINTED NUMBER AND THE OPENED ROW ARE DIFFERENT NUMBERS, and ties are
    where they diverge. The first two rows both carry rank 1, so both badges
    read "1". A handler keyed on the badge opens the first of them from either
    row. The expected value here is the row's POSITION, written out by hand.
  */
  test('fires the row position, not the printed rank, on a tie', () => {
    const onSpotlight = jest.fn();
    render(<RoundReport round={aRound()} onSpotlight={onSpotlight} />);
    fireEvent.click(screen.getByRole('button', { name: /Read response 2 in full/ }));
    expect(onSpotlight).toHaveBeenCalledWith(1);
  });

  test('names the author in the accessible name, which the badge cannot', () => {
    render(<RoundReport round={aRound()} />);
    expect(screen.getByRole('button', { name: 'Read response 2 in full, by Sam Ortiz' })).toBeInTheDocument();
  });
});

describe('commenting on a section', () => {
  test('nothing is commentable without a handler', () => {
    // The host's review dialog is read-only. An affordance that did nothing
    // would be the control people reach for first.
    render(<RoundReport round={aRound()} comments={COMMENTS} />);
    expect(screen.queryByRole('button', { name: /Comment on/ })).toBeNull();
  });

  test('the three sections the owner named become commentable', () => {
    render(<RoundReport round={aRound()} onComment={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Comment on the AI summary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comment on the results' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comment on response 1' })).toBeInTheDocument();
  });

  test('the question is not commentable', () => {
    /*
      The owner named three sections: "the summary, the results, a specific user
      response". The question is the prompt the room was GIVEN, not something
      the room heard, and it is left out on purpose rather than by oversight.
    */
    render(<RoundReport round={aRound()} onComment={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /Comment on the question/ })).toBeNull();
  });

  test('a summary anchor carries no position', () => {
    const onComment = jest.fn();
    render(<RoundReport round={aRound()} onComment={onComment} />);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on the AI summary' }));
    expect(onComment).toHaveBeenCalledWith(expect.objectContaining({
      anchorKind: 'summary', anchorRef: '', anchorLabel: 'AI summary',
    }));
  });

  /*
    THE TIE AGAIN. Rows 1 and 2 both carry rank 1, so both badges print "1". An
    anchor derived from the badge files every comment on the second response
    against the first — silently, and only on ties.
  */
  test('a response anchor is the row position, never the printed rank', () => {
    const onComment = jest.fn();
    render(<RoundReport round={aRound()} onComment={onComment} />);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on response 2' }));
    expect(onComment).toHaveBeenCalledWith(expect.objectContaining({
      anchorKind: 'response',
      anchorRef: '1',
      anchorLabel: 'Response 2 — Sam Ortiz',
    }));
  });

  test('the anchor carries an excerpt of what is being commented on', () => {
    /*
      Stored on the comment row at write time. From day 8 the raw ANSWER rows
      have expired and create-report rebuilds `answers` empty, so this excerpt
      is the only surviving copy of what the room was discussing — and in the
      session report it is what makes a comment readable at all, because the
      round is not on screen beside it.
    */
    const onComment = jest.fn();
    render(<RoundReport round={aRound()} onComment={onComment} />);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on response 1' }));
    const anchor = onComment.mock.calls[0][0];
    expect(anchor.anchorExcerpt).toContain('Freeze all discretionary discounting');
    expect(anchor.anchorExcerpt.length).toBeLessThanOrEqual(141);
  });
});

describe('showing the comments', () => {
  test('each renders under the section it is about', () => {
    const { container } = render(<RoundReport round={aRound()} comments={COMMENTS} />);
    const summary = container.querySelector('.past-round__summary');
    const results = container.querySelector('.past-round__results');
    expect(summary.textContent).toContain('nobody proposed telling a customer why');
    expect(results.textContent).toContain('This is the only one that touches');
    expect(results.textContent).toContain('Two of these are the same move.');
    // And not the other way round.
    expect(summary.textContent).not.toContain('Two of these are the same move.');
  });

  test('they are labelled as comments, so nobody reads one as a response', () => {
    // The owner: "clearly called out as comments".
    render(<RoundReport round={aRound()} comments={COMMENTS} />);
    expect(screen.getAllByText('Comments').length).toBeGreaterThan(0);
  });

  test('each is attributed to whoever wrote it', () => {
    // Scoped to the comment block: "Lee Chen" is also a RESPONSE author in this
    // fixture, and that ambiguity is the point — a comment's byline and a
    // response's byline must be separately addressable, or a reader cannot tell
    // which of the two they are looking at either.
    const { container } = render(<RoundReport round={aRound()} comments={COMMENTS} />);
    const bylines = [...container.querySelectorAll('.rr-c__who')].map((n) => n.textContent);
    expect(bylines).toContain('Lee Chen');
    expect(bylines).toContain('Dana Whitfield');
  });

  test('a comment from a redacted round is labelled by position, not blank', () => {
    /*
      `playerName` is ABSENT, never null, on a round the server redacted. A
      renderer that prints `{c.playerName}` shows nothing at all there, which
      reads as a bug rather than as anonymity.
    */
    render(<RoundReport round={aRound()} comments={[
      { commentId: 'x', anchorKind: 'summary', anchorRef: '', text: 'Said anonymously' },
    ]} />);
    expect(screen.getByText('Comment 1')).toBeInTheDocument();
  });

  test('a section with no comments says nothing at all', () => {
    // No empty "Comments" heading over nothing — that is a section that looks
    // like it failed to load.
    render(<RoundReport round={aRound()} comments={[]} />);
    expect(screen.queryByText('Comments')).toBeNull();
  });

  test('a comment on a response that no longer exists is still readable', () => {
    /*
      From day 8 the report's `answers` array rebuilds empty. The comment must
      not vanish with it, and must not render against nothing: the stored anchor
      label and excerpt are what carry it.
    */
    render(<RoundReport round={aRound({ answers: [] })} comments={[COMMENTS[1]]} />);
    expect(screen.getByText(/This is the only one that touches/)).toBeInTheDocument();
    expect(screen.getByText(/Response 2 — Sam Ortiz/)).toBeInTheDocument();
    // The excerpt is what makes the label mean something once the response
    // itself is gone — without it "Response 2 — Sam Ortiz" names a response
    // the reader cannot see, on a round with no responses on the page at all.
    expect(screen.getByText(/Re-price the onboarding package/)).toBeInTheDocument();
  });

  test('the excerpt is absent, gracefully, on a comment stored before this feature carried one', () => {
    // COMMENTS[2] carries anchorLabel but anchorExcerpt: '' — the shape of a
    // comment written before excerpts existed. It must still render (the label
    // and text alone are a complete comment), just with no excerpt node.
    const { container } = render(<RoundReport round={aRound()} comments={[COMMENTS[2]]} />);
    expect(screen.getByText('Two of these are the same move.')).toBeInTheDocument();
    expect(container.querySelector('.rr-c__excerpt')).toBeNull();
  });
});
