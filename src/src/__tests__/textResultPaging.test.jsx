/**
 * TextResult's optional page/pageSize mode — Task 8 of the 2026-09-26 feature
 * sweep, "walk the room through survey results... text: the open answers in
 * large type, paged, so a long list cycles page by page."
 *
 * The console/report behaviour (a preview + "Read all N") is untouched —
 * kindResult.test.jsx already holds it — this only covers the NEW branch: when
 * a caller hands `page` and `pageSize`, TextResult renders that slice instead
 * of the preview, and drops the "Read all" foot line (SurveyWalkthrough.jsx
 * pairs this with its own Pager, which already states the position).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import TextResult from '../components/survey/results/TextResult';

const question = {
  qid: 'q1',
  result: { n: 5 },
  texts: [
    { id: 'a', text: 'First answer' },
    { id: 'b', text: 'Second answer' },
    { id: 'c', text: 'Third answer' },
    { id: 'd', text: 'Fourth answer' },
    { id: 'e', text: 'Fifth answer' },
  ],
};

describe('TextResult: default preview mode (page/pageSize unset)', () => {
  it('previews the first previewCount answers and offers Read all', () => {
    render(<TextResult question={question} previewCount={2} onOpenAnswers={() => {}} />);
    expect(screen.getByText('First answer')).toBeInTheDocument();
    expect(screen.getByText('Second answer')).toBeInTheDocument();
    expect(screen.queryByText('Third answer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read all 5' })).toBeInTheDocument();
  });
});

describe('TextResult: paged mode (page + pageSize given)', () => {
  it('renders only the slice for that page', () => {
    render(<TextResult question={question} page={0} pageSize={2} />);
    expect(screen.getByText('First answer')).toBeInTheDocument();
    expect(screen.getByText('Second answer')).toBeInTheDocument();
    expect(screen.queryByText('Third answer')).not.toBeInTheDocument();
  });

  it('a later page renders a different slice', () => {
    render(<TextResult question={question} page={2} pageSize={2} />);
    expect(screen.getByText('Fifth answer')).toBeInTheDocument();
    expect(screen.queryByText('First answer')).not.toBeInTheDocument();
  });

  it('drops the "Read all" foot line — the caller\'s own Pager states the position', () => {
    render(<TextResult question={question} page={0} pageSize={2} onOpenAnswers={() => {}} />);
    expect(screen.queryByRole('button', { name: /Read all/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/answers\./)).not.toBeInTheDocument();
  });
});
