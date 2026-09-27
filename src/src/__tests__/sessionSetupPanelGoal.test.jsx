/**
 * THE GOAL IN THE HOST'S SESSION PANEL — components/stage/SessionSetupPanel.jsx,
 * the Questions tab (events M1b, Task 5). "Question 3 of 5" is the host's; the
 * rail the room reads never shows it.
 *
 * rejects: progress missing when there is a goal; a line drawn when there is
 * none; the goal's own results not marked as reached.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

import SessionSetupPanel from '../components/stage/SessionSetupPanel';

const renderPanel = (props = {}) => render(
  <SessionSetupPanel
    onClose={() => {}}
    wsConnected
    players={[]}
    gameState="ASK#003"
    categories={[{ name: 'Pricing Power' }]}
    categoryCounts={{ '1-8': [7], '9-16': [], '17-24': [] }}
    categoryBitmasks={{ 'HostMask1-8': '10000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000' }}
    questions={[]}
    gameId="4821"
    profile="room"
    {...props}
  />,
);
const openQuestions = () => fireEvent.click(screen.getByRole('tab', { name: 'Questions' }));

test('with a goal, the Questions tab says where the session stands', () => {
  renderPanel({ goal: { progress: 'Question 3 of 5', reached: false, line: '' } });
  openQuestions();
  expect(screen.getByTestId('goal-progress')).toHaveTextContent('Question 3 of 5');
});

test('on the goal\'s own results it says the goal is reached', () => {
  renderPanel({ goal: { progress: 'Question 5 of 5', reached: true, line: 'That’s your 5.' } });
  openQuestions();
  expect(screen.getByTestId('goal-progress')).toHaveTextContent('Question 5 of 5 · goal reached');
});

test('with no goal, nothing is drawn', () => {
  renderPanel({ goal: { progress: '', reached: false, line: '' } });
  openQuestions();
  expect(screen.queryByTestId('goal-progress')).toBeNull();
  renderPanel();
  expect(screen.queryAllByTestId('goal-progress')).toHaveLength(0);
});
