/**
 * THE REVIEW TAG IN THE SET LIST, AND THE STRIP ABOVE IT.
 *
 * The owner, 2026-10-16: "once reviewed the review tag should turn off in the
 * question set list." And: "there needs to be notification in the
 * system/alert somewhere … this should also last even if it takes a few days."
 *
 * QuestionSetsPanel is pure props, so no mocks (see questionSetsPanel.test.jsx).
 *
 * // rejects: a "Review" tag that stays after the draft was accepted; an "AI
 * //          draft" tag on a set somebody already reviewed but left off; a
 * //          list that says nothing about drafts waiting in it.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import QuestionSetsPanel from '../components/QuestionSetsPanel';

const base = {
  engagementType: 'trivia', totalQuestions: 10, categoryCount: 2, active: true, quickstart: false,
  createdAt: '2026-10-01T10:00:00.000Z', canManage: true, scope: 'org', mine: true,
};
const SETS = [
  { ...base, id: 'history', name: 'History Quiz' },
  { ...base, id: 'fresh', name: 'Fresh From AI', isAIGenerated: true, active: false },
  { ...base, id: 'reviewed', name: 'Reviewed But Off', isAIGenerated: true, active: false, aiReviewedAt: '2026-10-20T10:00:00.000Z' },
];
const rowOf = (name) => screen.getByText(name).closest('tr');

test('a set with questions waiting to join it carries "Review · N", which opens that draft', () => {
  const onOpenDraft = jest.fn();
  const draft = { draftId: 'd1', status: 'ready', mode: 'append', targetSetId: 'history', produced: 20, engagementType: 'trivia', title: 'History Quiz' };
  render(<QuestionSetsPanel questionSets={SETS} drafts={[draft]} onOpenDraft={onOpenDraft} />);
  const chip = within(rowOf('History Quiz')).getByTestId('set-draft-chip');
  expect(chip).toHaveTextContent('Review · 20');
  fireEvent.click(chip);
  expect(onOpenDraft).toHaveBeenCalledWith(draft);
});

test('the tag turns off once the draft is decided', () => {
  const accepted = { draftId: 'd1', status: 'accepted', mode: 'append', targetSetId: 'history', produced: 20 };
  render(<QuestionSetsPanel questionSets={SETS} drafts={[accepted]} onOpenDraft={jest.fn()} />);
  expect(within(rowOf('History Quiz')).queryByTestId('set-draft-chip')).toBeNull();
});

test('"AI draft" means not reviewed yet — a reviewed set left off does not ask again', () => {
  render(<QuestionSetsPanel questionSets={SETS} />);
  expect(within(rowOf('Fresh From AI')).getByText('AI draft')).toBeInTheDocument();
  expect(within(rowOf('Fresh From AI')).getByRole('button', { name: 'Review' })).toBeInTheDocument();
  expect(within(rowOf('Reviewed But Off')).queryByText('AI draft')).toBeNull();
  expect(within(rowOf('Reviewed But Off')).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
});

test('the strip above the list names every draft waiting, a running one, and a discarded one to restore', () => {
  const onOpenDraft = jest.fn();
  const drafts = [
    { draftId: 'a', status: 'ready', mode: 'new', title: 'World Leaders', produced: 15, engagementType: 'call-and-answer', daysLeft: 26 },
    { draftId: 'b', status: 'generating', mode: 'append', title: 'History Quiz', targetSetId: 'history', produced: 4, requested: 20, engagementType: 'trivia' },
    { draftId: 'c', status: 'discarded', mode: 'new', title: 'Old Idea', produced: 5, engagementType: 'trivia', daysLeft: 6 },
  ];
  render(<QuestionSetsPanel questionSets={SETS} drafts={drafts} onOpenDraft={onOpenDraft} />);
  const strip = screen.getByTestId('drafts-strip');
  expect(strip).toHaveTextContent('An AI draft is waiting for your review. Nothing is saved until you accept.');
  expect(strip).toHaveTextContent('A new set, “World Leaders”: 15 questions');
  expect(strip).toHaveTextContent('kept 26 more days');
  expect(strip).toHaveTextContent('Writing 4 of 20 questions for “History Quiz”…');
  expect(strip).toHaveTextContent('Discarded: A new set, “Old Idea”: 5 questions. Restorable for 6 more days.');
  fireEvent.click(within(strip).getByRole('button', { name: 'Review' }));
  expect(onOpenDraft).toHaveBeenCalledWith(drafts[0]);
});

test('no drafts, no strip', () => {
  render(<QuestionSetsPanel questionSets={SETS} drafts={[]} />);
  expect(screen.queryByTestId('drafts-strip')).toBeNull();
});
