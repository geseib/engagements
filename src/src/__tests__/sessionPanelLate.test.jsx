/**
 * THE LATE LIST IN THE SESSION PANEL'S ROUNDS TAB (late items Task 4). One
 * screen and two both reach it: the dock's count, the rail's "Review them".
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import LW from '../config/lateWords';

const late = {
  rounds: [{ round: '002', roundNoun: 'Round', items: [
    { kind: 'comment', ref: '202610161000000-abc', round: '002', text: 'More on this', label: 'Not reviewed', who: 'Omar', arrivedDuring: 'ASK#003', reviewed: null },
  ] }],
  ended: false,
  commentsClosedAt: null,
  onShow: jest.fn(() => Promise.resolve({ ok: true })),
  onMarkReviewed: jest.fn(() => Promise.resolve({ ok: true })),
  onCloseComments: jest.fn(() => Promise.resolve({ ok: true })),
};

const renderPanel = (props = {}) => render(
  <SessionSetupPanel
    onClose={() => {}}
    wsConnected
    players={[]}
    gameState="ASK#003"
    categories={[]}
    categoryCounts={{ '1-8': [], '9-16': [], '17-24': [] }}
    categoryBitmasks={{ 'HostMask1-8': '00000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000' }}
    questions={[]}
    gameId="4821"
    profile="room"
    initialTab="history"
    {...props}
  />,
);

test('the Rounds tab carries the late list under its heading', () => {
  renderPanel({ late });
  expect(screen.getByRole('heading', { name: LW.heading })).toBeInTheDocument();
  expect(screen.getByText('More on this')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: LW.markReviewed }));
  expect(late.onMarkReviewed).toHaveBeenCalledWith(expect.objectContaining({ ref: '202610161000000-abc' }));
});

test('no late prop, no heading', () => {
  renderPanel();
  expect(screen.queryByRole('heading', { name: LW.heading })).toBeNull();
});
