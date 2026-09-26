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
   * What CAN be exercised by mounting is the presenter's own defence in
   * depth: its listener is registered in the CAPTURE phase (`true` as the
   * third argument), which runs before ANY bubble-phase listener on the same
   * target — `HostActionBar`'s own Space/→ listener is bubble-phase — plus
   * `stopPropagation()`, so even the pathological case of both being mounted
   * at once cannot leak a key from one to the other, in either direction.
   *
   * FIX ROUND 1, I3: the fixture below now supplies `answerCount: 4` (not
   * only `answeredCount`) — `hostControlsFor`'s ASK primary is disabled when
   * `answerCount === 0` (config/hostControls.js), and the FIRST draft of this
   * test left it at its default of 0. A disabled primary means
   * `HostActionBar` registers NO listener at all (its own effect returns
   * early), so the original test's "onAction not called" passed whether or
   * not the presenter's isolation worked — a vacuous control. The CONTROL
   * test below proves the harness itself is capable of catching a leak
   * before trusting the isolation test that follows it.
   */
  const enabledPollAsk = () => hostControlsFor({
    gameType: 'poll', phase: 'ASK', playerCount: 4, answeredCount: 4, answerCount: 4, hasQuestionSet: true,
  });

  it('CONTROL: without the presenter, the dock\'s own listener does fire', () => {
    const onAction = jest.fn();
    render(<HostActionBar controls={enabledPollAsk()} onAction={onAction} />);
    fireEvent.keyDown(window, { key: ' ' });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('with the presenter mounted, the same key moves it and never reaches the dock', () => {
    const onAction = jest.fn();
    render(
      <>
        <SurveyWalkthrough results={results([ratingQ, choiceQ])} />
        <HostActionBar controls={enabledPollAsk()} onAction={onAction} />
      </>,
    );
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();

    // Already the last of two questions — I4: the keyboard's next is a no-op
    // here (only the Done button and Esc leave), and still never reaches the
    // dock underneath.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('the isolation holds across MULTIPLE presses, not only the first', () => {
    // The bug this guards against: re-arming the listener on every render
    // (no dependency array) moves it to the BACK of window's dispatch queue
    // relative to a sibling that stayed put, so a second or third press could
    // reach the OTHER listener first. Three questions, three presses.
    const onAction = jest.fn();
    render(
      <>
        <SurveyWalkthrough results={results([ratingQ, choiceQ, yesNoQ])} />
        <HostActionBar controls={enabledPollAsk()} onAction={onAction} />
      </>,
    );
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByText('Question 3')).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('SurveyWalkthrough: at the last result, the keyboard\'s next is a no-op (ruling I4)', () => {
  it('Space and ArrowRight do nothing and do not leave', () => {
    const onLeave = jest.fn();
    render(<SurveyWalkthrough results={results([choiceQ])} onLeave={onLeave} />);
    fireEvent.keyDown(window, { key: ' ' });
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onLeave).not.toHaveBeenCalled();
    // Still showing the same (only) question — nothing moved either.
    expect(screen.getByText('Most picked')).toBeInTheDocument();
  });

  it('the Done button leaves', () => {
    const onLeave = jest.fn();
    render(<SurveyWalkthrough results={results([choiceQ])} onLeave={onLeave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('Escape leaves', () => {
    const onLeave = jest.fn();
    render(<SurveyWalkthrough results={results([choiceQ])} onLeave={onLeave} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe('SurveyWalkthrough: stepping back into a text question (ruling M3)', () => {
  it('moving FORWARD into a text question always lands on page 1', () => {
    // profile=room pages 3 at a time; textQ has 7 answers -> 3 pages (0,1,2).
    render(<SurveyWalkthrough results={results([choiceQ, textQ])} profile="room" />);
    fireEvent.click(screen.getByRole('button', { name: 'Next result' })); // -> question 2 (text), page 1 of 3
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    expect(screen.getByText('Answer one')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous' })); // back to question 1
    expect(screen.getByText('Question 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next result' })); // forward into question 2 again
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    // Landed back on page 1, not page 3 — this presenter always enters a
    // text question fresh from the front when moving FORWARD into it.
    expect(screen.getByText('Answer one')).toBeInTheDocument();
  });

  it('moving BACKWARD into a text question lands on its LAST page', () => {
    render(<SurveyWalkthrough results={results([choiceQ, textQ, ratingQ])} profile="room" />);
    fireEvent.click(screen.getByRole('button', { name: 'Next result' })); // -> question 2 (text), page 1 of 3
    fireEvent.click(screen.getByRole('button', { name: 'Next result' })); // page 2 of 3
    fireEvent.click(screen.getByRole('button', { name: 'Next result' })); // page 3 of 3
    fireEvent.click(screen.getByRole('button', { name: 'Next result' })); // -> question 3 (rating)
    expect(screen.getByText('Question 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous' })); // back into question 2
    expect(screen.getByText('Question 2')).toBeInTheDocument();
    // The LAST page of the 3-page text question, not the first.
    expect(screen.getByText('Answer seven')).toBeInTheDocument();
    expect(screen.queryByText('Answer one')).not.toBeInTheDocument();
  });
});

/**
 * Fix round 1, ruling I2: RatingResult.jsx's own merged "N answered" line is
 * reverted (the cut sheet and the paper report stay byte-unchanged — they
 * already print the count once, in KindResult's header). Instead THIS
 * presenter prints one `.rule-note` line itself, under the recap, for every
 * kind — s-02/s-04's own "Pick one · 38 answered" / "38 answered · Not sure
 * 8%" shape, minus the kind-specific clauses this task does not ask for.
 */
describe('SurveyWalkthrough prints its own "N answered" line (ruling I2)', () => {
  it('choice', () => {
    render(<SurveyWalkthrough results={results([choiceQ])} />);
    expect(screen.getByText('38 answered.')).toBeInTheDocument();
  });

  it('rating', () => {
    render(<SurveyWalkthrough results={results([ratingQ])} />);
    expect(screen.getByText('38 answered.')).toBeInTheDocument();
    // RatingResult's own top-two line is untouched — still just the share.
    expect(screen.getByText(/76% said/)).toBeInTheDocument();
  });

  it('yes/no', () => {
    render(<SurveyWalkthrough results={results([yesNoQ])} />);
    expect(screen.getByText('38 answered.')).toBeInTheDocument();
  });

  it('rank', () => {
    render(<SurveyWalkthrough results={results([rankQ])} />);
    expect(screen.getByText('35 answered.')).toBeInTheDocument();
  });

  it('text', () => {
    render(<SurveyWalkthrough results={results([textQ])} />);
    expect(screen.getByText('7 answered.')).toBeInTheDocument();
  });

  it('is absent on an unanswered question — "No answers yet" stands alone', () => {
    const emptyQ = { ...choiceQ, result: { ...choiceQ.result, n: 0 } };
    render(<SurveyWalkthrough results={results([emptyQ])} />);
    expect(screen.queryByText(/answered\./)).not.toBeInTheDocument();
  });
});
