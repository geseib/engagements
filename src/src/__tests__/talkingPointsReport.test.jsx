/** The report's Build Room section: findings with sources, votes, the run list, points shown. */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import TalkingPointsReport from '../components/TalkingPointsReport';

const data = {
  counts: { fromClaude: 6, fromBuilders: [{ name: "Priya's Claude", n: 1 }], researchRequests: 1, ideaRequests: 0, votes: 1, runs: 1 },
  requests: [{
    id: '001', kind: 'research', subject: 'Accessible colour contrast', for: 'Claude', status: 'done', askedAt: '2026-10-09T15:05:00.000Z', ideas: [],
    findings: [{ id: '1', text: 'Body text needs 4.5:1.', sources: [{ title: 'WCAG 2.2', url: 'https://www.w3.org/x', site: 'w3.org' }], shownAt: '2026-10-09T15:08:00.000Z', by: 'Claude', fromBuilder: false }],
  }],
  votes: [{ id: 'a1', prompt: 'Which next?', maxPicks: 3, voted: 3, picks: 5, options: [
    { label: 'A', text: 'Keyboard support', votes: 3, by: 'Claude', fromBuilder: false, isFinding: false, outcome: 'run item 1, done', movedForward: true },
    { label: 'B', text: 'Colour each lot', votes: 1, by: "Priya's Claude", fromBuilder: true, isFinding: false, outcome: 'saved for later', movedForward: false },
  ] }],
  run: { status: 'finished', items: [
    { k: 1, text: 'Keyboard support', by: 'Claude', fromBuilder: false, state: 'done', doneAt: '2026-10-09T15:38:00.000Z', note: 'Arrow keys move the slider.' },
    { k: 2, text: 'Colour each lot', by: "Priya's Claude", fromBuilder: true, state: 'skipped', note: '' },
  ] },
  shown: [{ text: 'The header shows dollars.', kind: 'talk', by: 'Claude', fromBuilder: false, shownAt: '2026-10-09T15:14:00.000Z', ideasSent: 2 }],
};

describe('TalkingPointsReport', () => {
  it('renders nothing without data', () => {
    const { container } = render(<TalkingPointsReport data={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows findings with a source link, the vote table, the run list and shown points', () => {
    render(<TalkingPointsReport data={data} />);
    expect(screen.getByRole('heading', { name: 'Talking points and research' })).toBeInTheDocument();
    expect(screen.getByText(/6 points from Claude and 1 point from Priya's Claude/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /WCAG 2.2/ });
    expect(link).toHaveAttribute('href', 'https://www.w3.org/x');
    expect(screen.getByText('Moved forward · run item 1, done')).toBeInTheDocument();
    expect(screen.getByText('Saved for later')).toBeInTheDocument();
    expect(screen.getByText('Skipped, to Later')).toBeInTheDocument();
    expect(screen.getByText(/Arrow keys move the slider/)).toBeInTheDocument();
    expect(screen.getByText(/2 ideas sent about it/)).toBeInTheDocument();
    const row = screen.getAllByText('Colour each lot', { selector: 'td' })[0].closest('tr');
    expect(within(row).getByText("Priya's Claude")).toBeInTheDocument();
  });
});
