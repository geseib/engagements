/**
 * The workflow strip as drawn (session flow v3 §4.6): the laptop's full strip,
 * the one-screen slim strip, and the Remote's dots. Owner, 14 Oct: steps may be
 * pressed for LOOKING only, and on one screen not at all (open question 10).
 * Never on the wall or a participant's device.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkflowStrip from '../components/stage/WorkflowStrip';
import RemoteStepDots from '../components/RemoteStepDots';
import { stripFor } from '../config/workflowStrip';

const read = stripFor({
  gameType: 'call-and-answer', roundNoun: 'Round', hasQuestionSet: true, playerCount: 4,
  state: 'RESULTS#002', stageBeat: 'field-notes', notes: { page: 1, pages: 6, ready: true }, asksReady: 3, totalRounds: 6,
});

describe('the laptop strip, two screens', () => {
  test('shows the round, the live step with its page, and "Your part now" naming the main button', () => {
    render(<WorkflowStrip strip={read} mode="full" onView={() => {}} />);
    expect(screen.getByText('Round 2 of 6')).toBeInTheDocument();
    expect(screen.getByText('page 2 of 6')).toBeInTheDocument();
    expect(screen.getByText('3 ready')).toBeInTheDocument();
    expect(screen.getByText('Your part now')).toBeInTheDocument();
    expect(screen.getByText('Next page', { selector: '.wfs-action' })).toBeInTheDocument();
  });

  test('pressing a step asks to look at it, and the viewed step says so', () => {
    const onView = jest.fn();
    const { rerender } = render(<WorkflowStrip strip={read} mode="full" onView={onView} />);
    fireEvent.click(screen.getByRole('button', { name: /^Setup, done/ }));
    expect(onView).toHaveBeenCalledWith('setup');
    rerender(<WorkflowStrip strip={read} mode="full" onView={onView} viewing="setup" />);
    expect(screen.getByRole('button', { name: /^Setup, done/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Viewing')).toBeInTheDocument();
  });

  test('the live step is marked as the current step', () => {
    render(<WorkflowStrip strip={read} mode="full" onView={() => {}} />);
    expect(screen.getByRole('button', { name: /^What we heard, page 2 of 6, live/ })).toHaveAttribute('aria-current', 'step');
  });
});

describe('the slim strip, one screen', () => {
  test('nothing can be pressed and there is no "Your part now"', () => {
    render(<WorkflowStrip strip={read} mode="slim" onView={() => { throw new Error('pressed'); }} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText('Your part now')).not.toBeInTheDocument();
    expect(screen.getByText('What we heard')).toBeInTheDocument();
  });

  test('each step explains itself on hover', () => {
    render(<WorkflowStrip strip={read} mode="slim" />);
    expect(screen.getByText('Vote').closest('.wfs-step')).toHaveAttribute('title', expect.stringMatching(/rank/));
  });
});

describe('the Remote\'s dots', () => {
  test('one dot per step, the live step named, and the steps listed on a tap', () => {
    const { container } = render(<RemoteStepDots strip={read} />);
    expect(container.querySelectorAll('.hr-steps-dot')).toHaveLength(6);
    expect(container.querySelector('.hr-steps-dot.is-live')).toBeTruthy();
    expect(screen.getByText('R2 of 6')).toBeInTheDocument();
    expect(screen.getByText('What we heard · page 2 of 6')).toBeInTheDocument();
    const row = screen.getByRole('button', { name: 'Show the steps' });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Optional\. Ask the room a question/)).toBeInTheDocument();
  });
});

describe('never on the wall or a participant\'s device', () => {
  const src = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  test.each(['PlayerPage.jsx', 'present/PresentStage.jsx', 'present/PresentMoments.jsx'])('%s does not draw it', (file) => {
    expect(src(file)).not.toMatch(/WorkflowStrip|RemoteStepDots|workflowStrip/);
  });
});
