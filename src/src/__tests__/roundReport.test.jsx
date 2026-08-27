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
