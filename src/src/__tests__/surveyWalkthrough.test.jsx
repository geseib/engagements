/**
 * SurveyWalkthrough — Task 8 of the 2026-09-26 feature sweep: "we just need
 * the ability to see each question individually in a large format we can
 * cycle through." Fixtures mirror kindResult.test.jsx's own (the same
 * per-kind shapes survey-aggregate.js documents), so a reader who already
 * knows those numbers recognises them here.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import HostActionBar from '../components/HostActionBar';
import { hostControlsFor } from '../config/hostControls';
import SurveyWalkthrough from '../components/stage/SurveyWalkthrough';

const ratingQ = {
  qid: 'c001#001', n: 1, kind: 'rating', title: 'How useful was today’s session for your work?',
  scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful',
  result: { kind: 'rating', scale: '1-5', n: 38, counts: [1, 2, 6, 15, 14], mean: 4.03, topTwo: 76 },
  texts: [],
};

const choiceQ = {
  qid: 'c001#002', n: 2, kind: 'choice', title: 'Which part of the presentation was most valuable?',
  options: ['Live demo', 'Customer stories', 'Roadmap', 'Q&A', 'Hiring update'],
  result: { kind: 'choice', n: 38, counts: [14, 11, 7, 4, 2], other: 0, otherIds: [] },
  texts: [],
};

const yesNoQ = {
  qid: 'c001#003', n: 3, kind: 'yesno', title: 'Was the length about right?',
  unsure: true,
  result: {
    kind: 'yesno', n: 38, counts: { yes: 24, no: 11, unsure: 3 },
    whys: { yes: [], no: ['c001#003:0'], unsure: [] },
  },
  texts: [{ id: 'c001#003:0', text: 'Cut the roadmap section in half.' }],
};

const rankQ = {
  qid: 'c001#004', n: 4, kind: 'rank', title: 'Rank these topics for the next all-hands',
  options: ['Customer stories', 'Product roadmap', 'Team wins'],
  result: {
    kind: 'rank', n: 35, avgPlace: [2.1, 2.3, 2.9],
    firsts: [13, 12, 5], placeHist: [[13, 5, 3], [12, 6, 2], [5, 8, 4]], unplaced: [17, 15, 18],
  },
  texts: [],
};

// A NAME PLANTED WHERE A CARELESS READER MIGHT REACH FOR IT, AND WHERE THE
// COMPONENTS NEVER READ. `author`/`playerName` are not fields the real
// aggregate ever carries (survey-aggregate.js freezes ids and text only) —
// this fixture plants them anyway, to prove structurally that a stray name
// on the payload cannot leak onto the stage: TextResult/YesNoResult only ever
// read `.text`.
const SEEDED_NAME = 'Aleksandra Wiśniewska';
const textQ = {
  qid: 'c001#005', n: 5, kind: 'text', title: 'What was the best part of the presentation?',
  result: { kind: 'text', n: 7 },
  texts: [
    { id: 't0', text: 'Answer one', author: SEEDED_NAME },
    { id: 't1', text: 'Answer two', playerName: SEEDED_NAME },
    { id: 't2', text: 'Answer three' },
    { id: 't3', text: 'Answer four' },
    { id: 't4', text: 'Answer five' },
    { id: 't5', text: 'Answer six' },
    { id: 't6', text: 'Answer seven' },
  ],
};

const results = (questions) => ({ n: 38, finished: 38, names: 'named', questions });

describe('SurveyWalkthrough: one question at a time', () => {
  it('renders question 1 of M, with "Question 1 of 4" in the rail', () => {
    render(<SurveyWalkthrough results={results([ratingQ, choiceQ, yesNoQ, rankQ])} title="Q3 All-Hands" />);
    expect(screen.getByText('4.03')).toBeInTheDocument();
    expect(screen.getByText('Question 1')).toBeInTheDocument();
    expect(screen.getByText('of 4')).toBeInTheDocument();
    expect(screen.getByText('How useful was today’s session for your work?')).toBeInTheDocument();
  });

  it('renders the right kind for a choice question', () => {
    render(<SurveyWalkthrough results={results([choiceQ])} />);
    expect(screen.getByText('Most picked')).toBeInTheDocument();
    expect(screen.getByText('Live demo')).toBeInTheDocument();
  });

  it('renders the right kind for a yes/no question, whys included', () => {
    render(<SurveyWalkthrough results={results([yesNoQ])} />);
    expect(screen.getByText(/Yes 63%/)).toBeInTheDocument();
    expect(screen.getByText('Cut the roadmap section in half.')).toBeInTheDocument();
  });

  it('renders the right kind for a rank question', () => {
    render(<SurveyWalkthrough results={results([rankQ])} />);
    expect(screen.getByText('Customer stories')).toBeInTheDocument();
    expect(screen.getByText('2.1')).toBeInTheDocument();
  });

  it('renders the right kind for a text question, and no seeded name reaches the DOM', () => {
    const { container } = render(<SurveyWalkthrough results={results([textQ])} />);
    expect(screen.getByText('Answer one')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(SEEDED_NAME);
  });

  it('says "No answers yet" for an unanswered question rather than an empty chart', () => {
    const emptyQ = { ...choiceQ, result: { ...choiceQ.result, n: 0 } };
    render(<SurveyWalkthrough results={results([emptyQ])} />);
    expect(screen.getByText('No answers yet.')).toBeInTheDocument();
  });

  it('a survey with no questions at all says so, with no "Question 0 of 0" in the rail', () => {
    render(<SurveyWalkthrough results={results([])} />);
    expect(screen.getByText('No questions to show.')).toBeInTheDocument();
    expect(screen.queryByText(/Question 0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/of 0/)).not.toBeInTheDocument();
  });
});

describe('SurveyWalkthrough: cycling', () => {
  const four = [ratingQ, choiceQ, yesNoQ, rankQ];

  it('Next moves to question 2, Previous returns to question 1', () => {
    render(<SurveyWalkthrough results={results(four)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next result' }));
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    expect(screen.getByText('Most picked')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('Question 1')).toBeInTheDocument();
  });

  it('Previous is disabled on question 1', () => {
    render(<SurveyWalkthrough results={results(four)} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('Space and ArrowRight move forward; ArrowLeft moves back', () => {
    render(<SurveyWalkthrough results={results(four)} />);
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('Question 3')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('Question 2')).toBeInTheDocument();
  });

  it('Escape leaves', () => {
    const onLeave = jest.fn();
    render(<SurveyWalkthrough results={results(four)} onLeave={onLeave} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('the last question\'s Next reads Done, and pressing it leaves', () => {
    const onLeave = jest.fn();
    render(<SurveyWalkthrough results={results([choiceQ])} onLeave={onLeave} />);
    const btn = screen.getByRole('button', { name: 'Done' });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('Next on a non-last question never reads Done', () => {
    render(<SurveyWalkthrough results={results(four)} />);
    expect(screen.getByRole('button', { name: 'Next result' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });
});

describe('SurveyWalkthrough: the text kind pages a long list', () => {
  it('shows a Pager over the answers, and paging does not move to the next question', () => {
    render(<SurveyWalkthrough results={results([textQ, choiceQ])} profile="room" />);
    // profile=room pages 3 at a time (config/stagePaging.js) — 7 answers is 3 pages.
    expect(screen.getByText('Answer one')).toBeInTheDocument();
    expect(screen.queryByText('Answer four')).not.toBeInTheDocument();
    const pager = document.querySelector('[data-pager]');
    expect(pager).not.toBeNull();
    expect(pager.dataset.pages).toBe('3');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByText('Answer four')).toBeInTheDocument();
    expect(screen.queryByText('Answer one')).not.toBeInTheDocument();
    // Still question 1 — paging the text list is not the same as Next.
    expect(screen.getByText('Question 1')).toBeInTheDocument();
  });

  it('Next still advances past a paged text question once its pages are exhausted', () => {
    render(<SurveyWalkthrough results={results([textQ, choiceQ])} profile="room" />);
    fireEvent.click(screen.getByRole('button', { name: 'Next result' })); // page 2
    fireEvent.click(screen.getByRole('button', { name: 'Next result' })); // page 3
    expect(screen.getByText('Question 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next result' })); // question 2
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    expect(screen.getByText('Most picked')).toBeInTheDocument();
  });
});

describe('SurveyWalkthrough: the keys do not reach the stage\'s other handlers', () => {
  /**
   * IN PRODUCTION THIS IS ALREADY GUARANTEED BY MOUNTING ALONE. GameHostPage
   * renders the presenter as an early return, the same shape `showReport` /
   * `showSurveyResults` use (see SurveyWalkthrough.jsx's own header) — so
   * while it is up, `<Stage>` and `HostActionBar` are simply not in the tree,
   * and HostActionBar's own `window` keydown listener never gets registered
   * at all. `__tests__/surveyWalkthroughWiring.test.js` reads GameHostPage.jsx
   * as source to hold that placement and the `useScoreboardKeys` / auto-mode
   * gating that goes with it, since GameHostPage cannot mount in jsdom.
   *
   * What CAN be exercised by mounting is the presenter's own belt-and-braces:
   * its listener calls `stopImmediatePropagation()` (the same guard
   * `useScoreboardKeys`'s own close branch takes), which stops a listener
   * registered AFTER it on `window` from ever running for that keystroke —
   * so even if some future surface's own listener ended up mounted at the
   * same time, it could not also react to the same press. The presenter is
   * mounted FIRST, deliberately, so its handler is the one dispatch reaches
   * first; a listener registered before it is not something this component
   * can defend against, which is exactly why the real defence is the early
   * return, proven separately above.
   */
  it('stopImmediatePropagation keeps a later-registered listener from also firing', () => {
    const onAction = jest.fn();
    const controls = hostControlsFor({ gameType: 'poll', phase: 'ASK', playerCount: 4, answeredCount: 4, hasQuestionSet: true });
    render(
      <>
        <SurveyWalkthrough results={results([ratingQ, choiceQ])} />
        <HostActionBar controls={controls} onAction={onAction} />
      </>,
    );
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();

    // Already the last of two questions — ArrowRight leaves rather than
    // stepping past the end, and still never reaches the dock underneath.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });
});
