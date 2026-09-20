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
