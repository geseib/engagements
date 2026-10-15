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
import StepView from '../components/stage/StepView';
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

describe('looking at another step (session flow v3 §4.8)', () => {
  test('the amber bar says where the room is, and Back to the room returns', () => {
    const onBack = jest.fn();
    render(<WorkflowStrip strip={read} mode="full" onView={() => {}} viewing="setup" viewingWhere="round 2, What we heard, page 2 of 6" onBack={onBack} />);
    expect(screen.getByRole('status')).toHaveTextContent('Viewing Setup · the room is still on round 2, What we heard, page 2 of 6');
    expect(screen.queryByText('Your part now')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the room' }));
    expect(onBack).toHaveBeenCalled();
  });

  test('Setup shows the settings with their scope (owner: everything from the next round) and opens All settings', () => {
    const onAll = jest.fn();
    const setup = read.steps.find((s) => s.id === 'setup');
    render(<StepView step={setup} facts={{ title: 'Relay expansion', twoScreens: true, presenting: true, setName: 'Hard Books', playerCount: 4 }} onAllSettings={onAll} />);
    expect(screen.getByText('Relay expansion')).toBeInTheDocument();
    expect(screen.getAllByText(/From the next round/)).toHaveLength(3);
    expect(screen.getByText(/never change from the settings/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All settings' }));
    expect(onAll).toHaveBeenCalled();
  });

  test('a done step says what happened; a later one says it has not happened yet', () => {
    const answer = read.steps.find((s) => s.id === 'answer');
    const { rerender } = render(<StepView step={answer} facts={{ playerCount: 4, answered: 3 }} />);
    expect(screen.getByText('3 of 4 answered this round.')).toBeInTheDocument();
    rerender(<StepView step={read.steps.find((s) => s.id === 'ask')} facts={{}} />);
    expect(screen.getByText(/has not happened yet/)).toBeInTheDocument();
  });

  test('the host page swaps the main button for Back to the room and stops the arrows paging while looking', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(page).toMatch(/controls=\{dockControls\}/);
    expect(page).toMatch(/intent: HOST_INTENTS\.BACK_TO_ROOM/);
    expect(page).toMatch(/hostPhase !== 'FIELD_NOTES' \|\| viewing\) return false/);
    expect(page).toMatch(/const viewing = twoSurfaces && workflow/);
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

describe('the external review of test (15 Oct)', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  test('pressing Ask in the strip opens the composer on the ready questions', () => {
    expect(page).toMatch(/if \(id === 'ask' && workflow\.live !== 'ask'[\s\S]{0,300}setAskComposer\(/);
  });
  test('a live question shows one live mark, not "live · Live"', () => {
    const live = stripFor({
      gameType: 'call-and-answer', roundNoun: 'Round', state: 'RESULTS#002', stageBeat: 'ask', roomAsk: { status: 'open' },
    });
    expect(live.steps.find((x) => x.id === 'ask').sub).toBe('');
  });
  test('the voice note says "active this round" once the next round starts', () => {
    expect(page).toMatch(/is active this round\./);
  });
  test('the phone says "Answer received." for a Call & Answer response', () => {
    const player = fs.readFileSync(path.join(__dirname, '..', 'PlayerPage.jsx'), 'utf8');
    expect(player).toMatch(/'Answer received\.'/);
    expect(player).not.toMatch(/Application Submitted!/);
  });
});

