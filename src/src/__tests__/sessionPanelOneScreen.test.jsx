/**
 * THE SESSION PANEL ON ONE SCREEN IS PUBLIC (experience plan §2 principle 3,
 * Phase 1e; audit B §2.3 hazards 1-4 and 7).
 *
 * // rejects: GitHub #48, Workie's read-check warning shown to the room while
 * //          One screen was pressed (GameHostPage called the panel "the only
 * //          host-only place" on one screen; it is drawn over the stage).
 * // rejects: late answers with their authors, a name request with its name,
 * //          Workie's voice and briefing, and the upcoming question titles on
 * //          the room's screen without a deliberate "Show on this screen".
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

import SessionSetupPanel from '../components/stage/SessionSetupPanel';

const late = {
  rounds: [{ round: '002', roundNoun: 'Round', items: [
    { kind: 'answer', ref: 'a1', round: '002', text: 'We never write the handoff down', label: 'Not reviewed', who: 'Omar Haddad', arrivedDuring: 'ASK#003', reviewed: null },
  ] }],
  ended: false,
  commentsClosedAt: null,
  onShow: jest.fn(), onMarkReviewed: jest.fn(), onCloseComments: jest.fn(),
};
const workie = {
  roundNoun: 'Round',
  personaId: 'p1',
  personas: [{ id: 'p1', name: 'Plainspoken coach' }],
  onPersona: () => {},
  promptId: 'x1',
  prompts: [{ id: 'x1', name: 'Tensions first' }],
  onPrompt: () => {},
  briefed: true,
  onRedo: () => {},
  readCheck: { flagged: ['synergy'], note: 'Workie used words the answers do not support: synergy.' },
};
const players = [
  { name: 'Priya', playerName: 'Priya', score: 3, handover: {} },
  { name: 'Sam Okafor', playerName: 'Sam Okafor', score: 0, handover: { requested: true, requestedAt: new Date().toISOString() } },
];
const questions = [{ id: 'QUESTION#c001#004', title: 'The secret next question', category: 'Strategy', optionA: 'a', optionB: 'b' }];

const renderPanel = (props = {}) => render(
  <SessionSetupPanel
    onClose={() => {}}
    wsConnected
    players={players}
    gameState="ASK#003"
    categories={[{ name: 'Strategy', questionCount: 4 }]}
    categoryCounts={{ '1-8': [], '9-16': [], '17-24': [] }}
    categoryBitmasks={{ 'HostMask1-8': '00000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000' }}
    questions={questions}
    gameId="4821"
    profile="room"
    late={late}
    workie={workie}
    onGrantHandover={() => {}}
    onRefuseHandover={() => {}}
    onLockHandover={() => {}}
    {...props}
  />,
);
const tab = (name) => fireEvent.click(screen.getByRole('tab', { name }));
const PRIVATE = [/Asking to take this name/, /We never write the handoff down/, /Omar Haddad/, /Plainspoken coach/, /Tensions first/, /synergy/, /The secret next question/];

test('one screen: no tab renders a private part until it is shown', () => {
  renderPanel({ oneScreen: true });
  const seen = [];
  for (const name of ['Screens', 'Phone remote', 'Rounds', 'Joining', 'People', 'End session']) {
    tab(name);
    seen.push(document.body.textContent);
  }
  const all = seen.join('\n');
  PRIVATE.forEach((re) => expect([String(re), re.test(all)]).toEqual([String(re), false]));
  // What the room may see instead: a count, and the way to show it.
  expect(all).toMatch(/1 name request/);
  expect(all).toMatch(/1 late item to review/);
  expect(all).toMatch(/The room can see this screen/);
});

test('one screen: the roster still shows (owner, 25 Sep), without anyone\'s flag', () => {
  renderPanel({ oneScreen: true, initialTab: 'players' });
  expect(screen.getAllByTestId('roster-name').map((n) => n.textContent)).toEqual(expect.arrayContaining(['Priya', 'Sam Okafor']));
  expect(screen.queryByTestId('handover-flag')).toBeNull();
  expect(screen.queryByTestId('asking-heading')).toBeNull();
});

test('Show on this screen asks first, then shows that one part', () => {
  renderPanel({ oneScreen: true, initialTab: 'history' });
  const gate = screen.getByTestId('private-late');
  fireEvent.click(within(gate).getByRole('button', { name: 'Show on this screen' }));
  expect(gate).toHaveTextContent('The room will see this. Show it?');
  expect(document.body.textContent).not.toMatch(/We never write the handoff down/);
  fireEvent.click(within(gate).getByRole('button', { name: 'Show it' }));
  expect(document.body.textContent).toMatch(/We never write the handoff down/);
});

test('two screens (a private laptop): everything as it was, plus Not now and the asker lifted', () => {
  renderPanel({ oneScreen: false, initialTab: 'players' });
  expect(screen.getByTestId('asking-heading')).toBeInTheDocument();
  const asking = screen.getByTestId('asking-list');
  expect(asking).toHaveTextContent('Sam Okafor');
  expect(within(asking).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  tab('Rounds');
  expect(document.body.textContent).toMatch(/We never write the handoff down/);
  expect(document.body.textContent).toMatch(/The secret next question/);
});

test('Not now reaches the page for a round type (it was Build Room only)', () => {
  const onRefuseHandover = jest.fn();
  renderPanel({ initialTab: 'players', onRefuseHandover });
  fireEvent.click(within(screen.getByTestId('asking-list')).getByRole('button', { name: 'Not now' }));
  expect(onRefuseHandover).toHaveBeenCalledWith('Sam Okafor');
});
