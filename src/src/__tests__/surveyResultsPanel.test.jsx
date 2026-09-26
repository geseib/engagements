/**
 * SurveyResultsPanel and SurveyOpenAnswersPanel — the host's results screens,
 * mockups 30 and 31 (Task 3 of the 2026-09-26 feature sweep).
 *
 * Presentational, mounted the way GameReport.jsx's own tests would: `results`
 * arrives already-fetched, exactly the shape
 * `GET /games/{id}/survey-results` (survey-host.js `results()`) sends.
 *
 * NO GEOMETRIC ASSERTIONS — jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SurveyResultsPanel from '../components/SurveyResultsPanel';

const results = {
  gameId: '4821',
  n: 2,
  finished: 1,
  names: 'anonymous',
  openedAt: '2026-09-22T14:10:00.000Z',
  closedAt: '2026-09-22T15:42:00.000Z',
  questions: [
    {
      qid: 'c001#001', n: 1, kind: 'rating', title: 'How useful was today?', required: true,
      scale: '1-5',
      result: { kind: 'rating', scale: '1-5', n: 2, counts: [0, 0, 0, 1, 1], mean: 4.5, topTwo: 100 },
      texts: [],
    },
    {
      qid: 'c001#002', n: 2, kind: 'text', title: 'What would you change?', required: false,
      result: { kind: 'text', n: 2, answerIds: ['c001#002:0', 'c001#002:1'] },
      texts: [
        { id: 'c001#002:0', text: 'More time for questions' },
        { id: 'c001#002:1', text: 'Nothing, it was great' },
      ],
    },
  ],
};

const emptyResults = {
  gameId: '9999',
  n: 0,
  finished: 0,
  names: 'anonymous',
  questions: [
    { qid: 'c001#001', n: 1, kind: 'rating', title: 'How useful?', required: true, result: { kind: 'rating', n: 0, counts: [0, 0, 0, 0, 0], mean: null, topTwo: null }, texts: [] },
  ],
};

describe('SurveyResultsPanel', () => {
  it('shows a loading state', () => {
    render(<SurveyResultsPanel results={null} status="loading" onClose={() => {}} />);
    expect(screen.getByText('Loading the results')).toBeInTheDocument();
  });

  it('shows an error state, with Try again wired to onRetry', () => {
    const onRetry = jest.fn();
    render(<SurveyResultsPanel results={null} status="error" error="503 BUSY" onRetry={onRetry} onClose={() => {}} />);
    expect(screen.getByText('The results could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('503 BUSY')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Back to session calls onClose', () => {
    const onClose = jest.fn();
    render(<SurveyResultsPanel results={results} status="ready" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Back to session/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Fix round 2: the panel is now reachable for any closed survey from the
  // Sessions list, and GET /games/{id}/survey-results returns no title of
  // its own — so the caller's `title` is the only way a host can tell which
  // session this is. Shown in every status, not only once ready, so it is
  // visible during the exact moment (a failed fetch, about to retry) the
  // bug this fixes made confusing.
  describe('the session title (fix round 2)', () => {
    it('shows the given title during loading', () => {
      render(<SurveyResultsPanel results={null} status="loading" title="Pulse check" onClose={() => {}} />);
      expect(screen.getByText('Pulse check')).toBeInTheDocument();
    });

    it('shows the given title in the error state, right where Try again is', () => {
      render(<SurveyResultsPanel results={null} status="error" title="Pulse check" onRetry={() => {}} onClose={() => {}} />);
      expect(screen.getByText('Pulse check')).toBeInTheDocument();
    });

    it('shows the given title once ready', () => {
      render(<SurveyResultsPanel results={results} status="ready" title="Pulse check" onClose={() => {}} />);
      expect(screen.getByText('Pulse check')).toBeInTheDocument();
    });

    it('shows nothing extra when no title is given', () => {
      const { container } = render(<SurveyResultsPanel results={results} status="ready" onClose={() => {}} />);
      expect(container.querySelector('.svrp-toolbar-title')).toBeNull();
    });
  });

  it('renders one KindResult card per question, and the Names mode', () => {
    render(<SurveyResultsPanel results={results} status="ready" onClose={() => {}} />);
    expect(screen.getByText('How useful was today?')).toBeInTheDocument();
    expect(screen.getByText('What would you change?')).toBeInTheDocument();
    expect(screen.getByText(/Names: Anonymous/)).toBeInTheDocument();
  });

  // rejects: no minimum group size, and no crash on a wholly unanswered survey.
  it('an empty, closed survey (n:0) says "No answers yet" and skips the grid', () => {
    render(<SurveyResultsPanel results={emptyResults} status="ready" onClose={() => {}} />);
    expect(screen.getByText('No answers yet.')).toBeInTheDocument();
    expect(screen.queryByText('How useful?')).not.toBeInTheDocument();
  });

  it('"Read all N" on a text question opens the open-answers page for that question, and Back returns', () => {
    render(<SurveyResultsPanel results={results} status="ready" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Read all 2' }));

    // Now on the open-answers page: the question's own title as the heading,
    // both full answers, and the results grid is gone.
    expect(screen.getByRole('heading', { name: 'What would you change?' })).toBeInTheDocument();
    expect(screen.getByText('More time for questions')).toBeInTheDocument();
    expect(screen.getByText('Nothing, it was great')).toBeInTheDocument();
    expect(screen.queryByText('How useful was today?')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Back to results/ }));
    expect(screen.getByText('How useful was today?')).toBeInTheDocument();
    expect(screen.getByText('What would you change?')).toBeInTheDocument();
  });

  it('a search on the open-answers page narrows the list', () => {
    render(<SurveyResultsPanel results={results} status="ready" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Read all 2' }));
    fireEvent.change(screen.getByPlaceholderText('Search answers'), { target: { value: 'great' } });
    expect(screen.getByText('Nothing, it was great')).toBeInTheDocument();
    expect(screen.queryByText('More time for questions')).not.toBeInTheDocument();
  });
});
