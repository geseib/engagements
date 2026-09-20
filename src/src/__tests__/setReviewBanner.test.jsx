import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SetReviewBanner from '../components/SetReviewBanner';

const FLAGGED = {
  version: 2, review: 'flagged', checkedAt: '2026-08-19T10:00:00.000Z', questionCount: 30, reasons: [],
  reviewFindings: [
    { questionId: 'q014', category: 'VIOLENCE', band: 'HIGH', explanation: 'Asking a room to describe injuries in detail is what was flagged, not the safety topic.' },
    { questionId: 'q022', category: 'HATE', band: 'HIGH', explanation: 'The question invites an answer about a category of people rather than a practice.' },
  ],
};
test('renders nothing for a version with nothing to say', () => {
  const { container } = render(<SetReviewBanner entry={{ version: 2, review: 'passed', reviewFindings: [] }} share={null} />);
  expect(container).toBeEmptyDOMElement();
});
test('a flagged version says what was not published, names each question with its sentence, and counts the rest', () => {
  const onFocusQuestion = jest.fn();
  render(<SetReviewBanner entry={FLAGGED} share={{ status: 'flagged', version: 2 }} onFocusQuestion={onFocusQuestion} onResubmit={() => {}} onAppeal={() => {}} />);
  expect(screen.getByRole('status')).toHaveTextContent(/this set was not published/i);
  expect(screen.getByRole('status')).toHaveTextContent(/2 of 30 questions were flagged on 19 Aug/i);
  expect(screen.getByRole('status')).toHaveTextContent(/nothing was shared, and your copy is untouched/i);
  expect(screen.getByText(/injuries in detail/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /edit q14/i }));
  expect(onFocusQuestion).toHaveBeenCalledWith('q014');
  expect(screen.getByText(/the other 28 questions passed/i)).toBeInTheDocument();
});
test('Resubmit and Ask for a human review call back with the version and the message', () => {
  const onResubmit = jest.fn(); const onAppeal = jest.fn();
  render(<SetReviewBanner entry={FLAGGED} share={{ status: 'flagged', version: 2 }} onResubmit={onResubmit} onAppeal={onAppeal} onFocusQuestion={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /resubmit/i }));
  expect(onResubmit).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByRole('button', { name: /ask for a human review/i }));
  fireEvent.change(screen.getByRole('textbox', { name: /tell engage why/i }), { target: { value: 'It is a clinical safety set.' } });
  fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
  expect(onAppeal).toHaveBeenCalledWith(2, 'It is a clinical safety set.');
});
test('a staff note leads the banner; waiting states say so and offer no appeal', () => {
  const first = render(<SetReviewBanner entry={{ ...FLAGGED, review: 'flagged' }} share={{ status: 'flagged', version: 2, note: 'Q14 needs the injury detail removed.' }} onResubmit={() => {}} onAppeal={() => {}} onFocusQuestion={() => {}} />);
  expect(screen.getByRole('status').textContent.indexOf('Q14 needs')).toBeLessThan(screen.getByRole('status').textContent.indexOf('not published'));
  first.unmount();
  render(<SetReviewBanner entry={{ ...FLAGGED, review: 'appealed' }} share={{ status: 'appealed', version: 2 }} />);
  expect(screen.getByText(/waiting for a person at Engage/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /ask for a human review/i })).toBeNull();
});

/*
  A STAFF RE-CHECK IS NOT THE AUTHOR'S BUSINESS, and this banner is the author's.

  Engage staff can re-run the content check on the version the public library is
  serving (the score card's "Run the check again"). That writes its verdict onto
  the organisation's own REVIEW row — which is what `entry.review` is — and
  deliberately writes NO share stamp, because nothing about the author's share
  changed: the library is still serving their set.

  Read from `entry.review` alone this banner told them a person at Engage was
  looking at a version nobody had asked about, or that their set "was not
  published" while it was live in the library, and offered them Resubmit and
  "Ask for a human review" — an appeal that would knock their own published set
  out of its published state.
*/
test('a version the library is still serving says nothing here, whatever a staff re-check made of it', () => {
  for (const review of ['escalated', 'flagged', 'appealed']) {
    const { container, unmount } = render(
      <SetReviewBanner
        entry={{ ...FLAGGED, review, published: { publicSetId: 'orgacme-safety', publicVersion: 1 } }}
        share={{ status: 'published', version: 2, publicSetId: 'orgacme-safety', publicVersion: 1 }}
        onResubmit={() => {}}
        onAppeal={() => {}}
        onFocusQuestion={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    unmount();
  }
});

// rejects: suppressing on the review row's own say-so, or on the PUBLISHED
// marker. The organisation submitting an already-published version for a check
// of their own moves their share stamp off `published` (check-question-set.js
// writes `checking`, then the worker writes the outcome) while the marker from
// the earlier publish is still there — so that answer IS theirs to read.
test('an answer to the author\'s own submission still shows, published marker or not', () => {
  render(
    <SetReviewBanner
      entry={{ ...FLAGGED, published: { publicSetId: 'orgacme-safety', publicVersion: 1 } }}
      share={{ status: 'flagged', version: 2 }}
      onResubmit={() => {}}
      onAppeal={() => {}}
      onFocusQuestion={() => {}}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent(/this set was not published/i);
  expect(screen.getByRole('button', { name: /ask for a human review/i })).toBeInTheDocument();
});

/*
  ── WHAT THE CHECK MEASURED, ON THE AUTHOR'S OWN SET ───────────────────────

  The owner: an author gets a status and a sentence, and "Violence: LOW on 11
  of 30 questions" answers "why was mine held?" in a way a sentence cannot.
  `reviewTally` and `reviewObserved` are the same measurement the staff score
  card reads (admin/shared/review-card.js, one projection), carried by
  get-set-versions.js to the library the row is in.
*/
const NONE_SEEN = { worst: null, low: 0, medium: 0, high: 0 };
const TALLY = {
  scope: 'full',
  questions: 30,
  setTextChecked: true,
  setTextUnread: false,
  spotless: 19,
  unread: 0,
  categories: {
    VIOLENCE: { worst: 'LOW', low: 11, medium: 0, high: 0 },
    SEXUAL: NONE_SEEN,
    HATE: { worst: 'HIGH', low: 0, medium: 0, high: 1 },
    INSULTS: NONE_SEEN,
    MISCONDUCT: NONE_SEEN,
  },
};
const OBSERVED = [
  { questionId: 'q022', category: 'HATE', band: 'HIGH', intervened: true, explanation: 'The question invites an answer about a category of people.' },
  { questionId: 'q003', category: 'VIOLENCE', band: 'LOW', intervened: false, explanation: 'A crash is named, not described.' },
];
const MEASURED = { ...FLAGGED, reviewTally: TALLY, reviewObserved: OBSERVED };

test('the author is told what the check measured, category by category', () => {
  render(<SetReviewBanner entry={MEASURED} share={{ status: 'flagged', version: 2 }} onResubmit={() => {}} onAppeal={() => {}} />);
  expect(screen.getByTestId('srev-summary')).toHaveTextContent(/30 questions and the set's own text checked/i);
  expect(screen.getByTestId('srev-summary')).toHaveTextContent(/19 with nothing in any category/i);
  const rows = screen.getAllByTestId('srev-cat').map((r) => r.textContent);
  expect(rows).toHaveLength(5);
  expect(rows[0]).toMatch(/violence or injury/i);
  expect(rows[0]).toMatch(/low/);
  expect(rows[0]).toMatch(/11 at low/);
  // Every category, "none" written out — a category left off the list reads as
  // one the check did not look at.
  expect(rows.join(' ')).toMatch(/sexual content/i);
  expect(rows.filter((r) => /none/i.test(r))).toHaveLength(3);
});

// rejects: a near miss the check let through being invisible to the author,
// which is the half `findings` has never carried.
test('an observation the check let through is named, and says it did not hold the set', () => {
  render(<SetReviewBanner entry={MEASURED} share={{ status: 'flagged', version: 2 }} onResubmit={() => {}} />);
  const seen = screen.getByTestId('srev-seen');
  expect(seen).toHaveTextContent(/Q3/);
  expect(seen).toHaveTextContent(/A crash is named, not described/);
  expect(seen).toHaveTextContent(/let through/i);
  // What held the set is above, in "What was flagged"; it is not repeated here.
  expect(seen).not.toHaveTextContent(/Q22/);
});

// rejects: a version checked before measuring existed drawing an empty block
// that reads as "measured, and nothing found".
test('a version with no measurement draws no measurement block', () => {
  render(<SetReviewBanner entry={FLAGGED} share={{ status: 'flagged', version: 2 }} onResubmit={() => {}} />);
  expect(screen.queryByTestId('srev-summary')).toBeNull();
  expect(screen.queryByTestId('srev-cat')).toBeNull();
});

// rejects: a set held for a person telling the author only that somebody is
// looking — which was the whole of the waiting state.
test('a version waiting on a person still shows what the check measured', () => {
  render(<SetReviewBanner entry={{ ...MEASURED, review: 'escalated' }} share={{ status: 'escalated', version: 2 }} />);
  expect(screen.getByText(/waiting for a person at Engage/i)).toBeInTheDocument();
  expect(screen.getByTestId('srev-summary')).toHaveTextContent(/30 questions/);
});

/*
  ── ENGAGE'S OWN SHARED SET IS NOT SOMEBODY'S SUBMISSION ───────────────────

  A platform set is served to every organisation and belongs to none. Its check
  publishes nothing and unpublishes nothing, so "this set was not published",
  "nothing was shared" and "your copy is still private to your organisation"
  are three false statements, and Resubmit and the appeal are two actions with
  nobody to perform them.
*/
test("Engage's own set never claims to be somebody's held submission", () => {
  render(
    <SetReviewBanner entry={MEASURED} scope="platform" share={null} onResubmit={() => {}} onAppeal={() => {}} onFocusQuestion={() => {}} />,
  );
  const banner = screen.getByRole('status');
  expect(banner).not.toHaveTextContent(/not published/i);
  expect(banner).not.toHaveTextContent(/nothing was shared/i);
  expect(banner).not.toHaveTextContent(/private to your organisation/i);
  expect(banner).toHaveTextContent(/still being served to every organisation/i);
  expect(screen.queryByRole('button', { name: /resubmit/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /ask for a human review/i })).toBeNull();
  // The measurement is the point of showing it at all.
  expect(screen.getByTestId('srev-summary')).toHaveTextContent(/30 questions/);
});

test("Engage's own set waiting on a person says the library is still serving it", () => {
  render(<SetReviewBanner entry={{ ...MEASURED, review: 'escalated' }} scope="platform" share={null} />);
  const banner = screen.getByRole('status');
  expect(banner).toHaveTextContent(/still being served to every organisation/i);
  expect(banner).not.toHaveTextContent(/waiting for a person at Engage to look at version/i);
});
