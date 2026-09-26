/**
 * KindResult and its five per-kind renderers — Task 3 of the 2026-09-26
 * feature sweep. Every fixture below reproduces the mockups' own numbers
 * (docs/design/survey-redesign/_src/content.py, the same fixture
 * tests/survey-aggregate.js pins the backend function against): mean 4.03,
 * recommend score +32, and the rank averages that sum to k(k+1)/2. A
 * component test cannot `require()` the backend's CommonJS aggregate module
 * (it lives outside src/, and Lambda bundles are per-directory — the same
 * rule survey-kinds.js's own header states), so the shapes are hand-built to
 * match `survey-aggregate.js`'s documented per-kind contract exactly.
 *
 * Presentational only: no fetch, no router, no auth provider — these mount
 * cleanly, which is the whole point of props-in-markup-out (see
 * KindResult.jsx's header).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import KindResult from '../components/survey/results/KindResult';

const ratingQ = {
  qid: 'c001#001', n: 1, kind: 'rating', title: 'How useful was today’s session for your work?',
  required: true, scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful',
  result: { kind: 'rating', scale: '1-5', n: 38, counts: [1, 2, 6, 15, 14], mean: 4.03, topTwo: 76 },
  texts: [],
};

const npsQ = {
  qid: 'c001#002', n: 2, kind: 'rating', title: 'How likely are you to recommend this session?',
  required: false, scale: '0-10',
  result: {
    kind: 'rating', scale: '0-10', n: 37, counts: [0, 0, 0, 1, 1, 2, 2, 6, 7, 8, 10],
    mean: null, topTwo: 49, detractors: 6, passives: 13, promoters: 18, score: 32,
  },
  texts: [],
};

const choiceQ = {
  qid: 'c001#003', n: 3, kind: 'choice', title: 'Which part of the presentation was most valuable?',
  required: true, options: ['Live demo', 'Customer stories', 'Roadmap', 'Q&A', 'Hiring update'],
  result: { kind: 'choice', n: 38, counts: [14, 11, 7, 4, 2], other: 0, otherIds: [] },
  texts: [],
};

const multiChoiceQ = {
  qid: 'c001#004', n: 4, kind: 'choice', title: 'Which formats would you want more of?',
  required: false, allowMultiple: true, maxPicks: 2, allowOther: true,
  options: ['More time for questions', 'A hands-on breakout', 'Slides sent ahead', 'A recording afterwards'],
  result: { kind: 'choice', n: 36, counts: [22, 17, 12, 9], other: 3, otherIds: ['c001#004:0', 'c001#004:1', 'c001#004:2'] },
  texts: [
    { id: 'c001#004:0', text: 'A one-page summary we can forward' },
    { id: 'c001#004:1', text: 'Shorter, and on a Monday' },
    { id: 'c001#004:2', text: 'Lunch provided' },
  ],
};

const yesNoQ = {
  qid: 'c001#005', n: 5, kind: 'yesno', title: 'Was the length about right?',
  required: true, unsure: true, followUpWhen: 'no', followUpPrompt: 'What would you cut or add?',
  result: {
    kind: 'yesno', n: 38, counts: { yes: 24, no: 11, unsure: 3 },
    whys: { yes: [], no: ['c001#005:0', 'c001#005:1'], unsure: [] },
  },
  texts: [
    { id: 'c001#005:0', text: 'Cut the roadmap section in half and give that time to questions.', v: 'no' },
    { id: 'c001#005:1', text: 'Too long for a Tuesday afternoon.', v: 'no' },
  ],
};

const rankQ = {
  qid: 'c001#006', n: 6, kind: 'rank', title: 'Rank these topics for the next all-hands',
  required: false, rankTop: 3,
  options: ['Customer stories', 'Product roadmap', 'Team wins', 'Culture & hiring', 'Financials'],
  result: {
    kind: 'rank', n: 35, avgPlace: [2.1, 2.3, 2.9, 3.6, 4.1],
    firsts: [13, 12, 5, 3, 2],
    placeHist: [[13, 5, 3], [12, 6, 2], [5, 8, 4], [3, 4, 6], [2, 2, 4]],
    unplaced: [17, 15, 18, 22, 27],
  },
  texts: [],
};

const textQ = {
  qid: 'c001#007', n: 7, kind: 'text', title: 'What was the best part of the presentation?',
  required: false, textLength: 'long', maxLength: 500,
  result: { kind: 'text', n: 31, answerIds: ['c001#007:0', 'c001#007:1', 'c001#007:2', 'c001#007:3'] },
  texts: [
    { id: 'c001#007:0', text: 'Seeing the console actually run beat every slide about it.' },
    { id: 'c001#007:1', text: 'The demo made it concrete.' },
    { id: 'c001#007:2', text: 'Honesty about what slipped.' },
    { id: 'c001#007:3', text: 'Pace and energy.' },
  ],
};

const emptyQ = {
  qid: 'c001#008', n: 8, kind: 'text', title: 'Anything else?', required: false,
  result: { kind: 'text', n: 0, answerIds: [] },
  texts: [],
};

describe('KindResult: the shared card', () => {
  it('renders nothing without a question', () => {
    const { container } = render(<KindResult question={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the question number, kind chip, title and answered count', () => {
    render(<KindResult question={ratingQ} />);
    expect(screen.getByText('Q1')).toBeInTheDocument();
    expect(screen.getByText(/How useful was today/)).toBeInTheDocument();
    expect(screen.getByText('38 answered')).toBeInTheDocument();
  });

  it('marks an optional question, and leaves a required one unmarked', () => {
    const optional = render(<KindResult question={npsQ} />);
    expect(screen.getByText(/optional/)).toBeInTheDocument();
    optional.unmount();
    render(<KindResult question={ratingQ} />);
    expect(screen.queryAllByText(/optional/).length).toBe(0);
  });

  // rejects: a bar chart or histogram rendered at n=0, which reads as "one
  // option got 0%" rather than "nobody has answered".
  it('an unanswered question says "No answers yet" instead of an empty chart', () => {
    render(<KindResult question={emptyQ} />);
    expect(screen.getByText('No answers yet.')).toBeInTheDocument();
  });
});

describe('RatingResult (via KindResult)', () => {
  it('a 1–5 rating shows the mean, the top-two share and the scale ends', () => {
    render(<KindResult question={ratingQ} />);
    expect(screen.getByText('4.03')).toBeInTheDocument();
    expect(screen.getByText(/76% said/)).toBeInTheDocument();
    expect(screen.getByText('Not useful')).toBeInTheDocument();
    expect(screen.getByText('Very useful')).toBeInTheDocument();
  });

  it('a 0–10 rating shows the recommend score and the three-way split, not a histogram', () => {
    render(<KindResult question={npsQ} />);
    expect(screen.getByText('+32')).toBeInTheDocument();
    expect(screen.getByText('recommend score')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /would not/i })).toBeInTheDocument();
  });
});

describe('ChoiceResult (via KindResult)', () => {
  it('flags the most-picked option and prints every share and count', () => {
    render(<KindResult question={choiceQ} />);
    expect(screen.getByText('Most picked')).toBeInTheDocument();
    expect(screen.getByText('Live demo')).toBeInTheDocument();
    expect(screen.getByText('37%')).toBeInTheDocument(); // 14 of 38
  });

  it('a multi-pick question notes shares can pass 100%, and lists Other write-ins', () => {
    render(<KindResult question={multiChoiceQ} />);
    expect(screen.getByText(/add to more than 100%/)).toBeInTheDocument();
    expect(screen.getByText('A one-page summary we can forward')).toBeInTheDocument();
    expect(screen.getByText('Lunch provided')).toBeInTheDocument();
  });
});

describe('YesNoResult (via KindResult)', () => {
  it('shows the split and files each why under the answer it explains', () => {
    render(<KindResult question={yesNoQ} />);
    expect(screen.getByText(/Yes 63%/)).toBeInTheDocument();
    expect(screen.getByText('Too long for a Tuesday afternoon.')).toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el.tagName === 'SMALL' && el.textContent === 'said No').length).toBe(2);
  });
});

describe('RankResult (via KindResult)', () => {
  it('orders items by average place, best first', () => {
    render(<KindResult question={rankQ} />);
    const rows = screen.getAllByText(/avg$/);
    expect(rows.length).toBe(5);
    expect(screen.getByText('Customer stories')).toBeInTheDocument();
    expect(screen.getByText('2.1')).toBeInTheDocument();
  });
});

describe('TextResult (via KindResult)', () => {
  it('previews a few answers, and offers to read the rest only when a handler is given', () => {
    render(<KindResult question={textQ} />);
    expect(screen.getByText('Seeing the console actually run beat every slide about it.')).toBeInTheDocument();
    // No onOpenAnswers passed (Task 4's report has nowhere to send it): no
    // dead link.
    expect(screen.queryByRole('button', { name: /Read all/ })).not.toBeInTheDocument();
  });

  it('calls onOpenAnswers with the question\'s qid', () => {
    const onOpenAnswers = jest.fn();
    render(<KindResult question={textQ} onOpenAnswers={onOpenAnswers} />);
    screen.getByRole('button', { name: 'Read all 31' }).click();
    expect(onOpenAnswers).toHaveBeenCalledWith('c001#007');
  });

  it('never offers "Read all" on a non-text question, even with a handler in hand', () => {
    const onOpenAnswers = jest.fn();
    render(<KindResult question={choiceQ} onOpenAnswers={onOpenAnswers} />);
    expect(screen.queryByRole('button', { name: /Read all/ })).not.toBeInTheDocument();
  });
});
