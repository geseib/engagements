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
const PRIVATE = [/wants their name on a new device/, /Sam Okafor/, /We never write the handoff down/, /Omar Haddad/, /Plainspoken coach/, /Tensions first/, /synergy/, /The secret next question/];
/* Each section of the redesigned menu (docs/design/session-menu), with its
   More options opened too: nothing private may sit behind an expander
   unrevealed either. */
const SECTIONS = ['Up next', 'Rounds so far', 'People', 'Screens', 'Joining', 'How it runs'];
const openAllMore = () => {
  for (const t of document.querySelectorAll('[data-testid$="-toggle"][aria-controls^="smenu-more-"]')) {
    if (t.getAttribute('aria-expanded') !== 'true') fireEvent.click(t);
  }
};

test('one screen: no section renders a private part until it is shown, More options open or not', () => {
  renderPanel({ oneScreen: true });
  const seen = [];
  for (const name of SECTIONS) {
    tab(name);
    seen.push(document.body.textContent);
    openAllMore();
    seen.push(document.body.textContent);
  }
  tab('Up next');
  fireEvent.click(screen.getByTestId('up-next-choose'));
  seen.push(document.body.textContent);
  const all = seen.join('\n');
  PRIVATE.forEach((re) => expect([String(re), re.test(all)]).toEqual([String(re), false]));
  // What the room may see instead: a count, and the way to show it.
  expect(all).toMatch(/1 name request/);
  expect(all).toMatch(/1 late item to review/);
  expect(all).toMatch(/The room can see this screen/);
});

// The owner's change to the redesign (3 Nov 2026): on one screen the People
// section keeps its privacy — the names are behind "Show on this screen", or
// on the phone (experience plan §3.3; privateParts "scores-roster").
test('one screen: People is a count, and the names wait behind Show on this screen', () => {
  renderPanel({ oneScreen: true, initialTab: 'players' });
  const gate = screen.getByTestId('private-people');
  expect(gate).toHaveTextContent('2 people · 1 name request');
  expect(document.querySelector('.prow-name')).toBeNull();
  fireEvent.click(within(gate).getByRole('button', { name: 'Show on this screen' }));
  fireEvent.click(within(gate).getByRole('button', { name: 'Show it' }));
  expect([...document.querySelectorAll('.prow-name')].map((n) => n.textContent)).toEqual(expect.arrayContaining(['Priya', 'Sam Okafor']));
});

// Owner, 4 Nov 2026: the one-screen People choice is kept for the session,
// until the host changes it — the panel closing must not reset it.
test('one screen: showing People is kept for the session, across the panel closing, until Hide', () => {
  window.localStorage.clear();
  const first = renderPanel({ oneScreen: true, initialTab: 'players' });
  const gate = screen.getByTestId('private-people');
  fireEvent.click(within(gate).getByRole('button', { name: 'Show on this screen' }));
  fireEvent.click(within(gate).getByRole('button', { name: 'Show it' }));
  first.unmount();

  const again = renderPanel({ oneScreen: true, initialTab: 'players' });
  expect(screen.getByTestId('private-people-shown')).toBeInTheDocument();
  expect(document.querySelector('.prow-name')).not.toBeNull();
  fireEvent.click(within(screen.getByTestId('private-people-shown')).getByRole('button', { name: 'Hide' }));
  again.unmount();

  renderPanel({ oneScreen: true, initialTab: 'players' });
  expect(screen.getByTestId('private-people')).toBeInTheDocument();
  expect(document.querySelector('.prow-name')).toBeNull();
  window.localStorage.clear();
});

test('Show on this screen asks first, then shows that one part', () => {
  renderPanel({ oneScreen: true, initialTab: 'history' });
  fireEvent.click(screen.getByTestId('late-review'));
  const gate = screen.getByTestId('private-late');
  fireEvent.click(within(gate).getByRole('button', { name: 'Show on this screen' }));
  expect(gate).toHaveTextContent('The room will see this. Show it?');
  expect(document.body.textContent).not.toMatch(/We never write the handoff down/);
  fireEvent.click(within(gate).getByRole('button', { name: 'Show it' }));
  expect(document.body.textContent).toMatch(/We never write the handoff down/);
});

test('two screens (a private laptop): everything shows, with Not now and the asker first', () => {
  renderPanel({ oneScreen: false, initialTab: 'players' });
  const rows = [...document.querySelectorAll('li.prow')];
  expect(rows[0]).toHaveTextContent('Sam Okafor');
  expect(rows[0]).toHaveAttribute('data-testid', 'person-asking');
  expect(within(rows[0]).getByRole('button', { name: 'Not now: Sam Okafor' })).toBeInTheDocument();
  tab('Rounds so far');
  fireEvent.click(screen.getByTestId('late-review'));
  expect(document.body.textContent).toMatch(/We never write the handoff down/);
  tab('Up next');
  fireEvent.click(screen.getByTestId('up-next-choose'));
  expect(document.body.textContent).toMatch(/The secret next question/);
});

test('Not now reaches the page for a round type (it was Build Room only)', () => {
  const onRefuseHandover = jest.fn();
  renderPanel({ initialTab: 'players', onRefuseHandover });
  fireEvent.click(within(screen.getByTestId('person-asking')).getByRole('button', { name: 'Not now: Sam Okafor' }));
  expect(onRefuseHandover).toHaveBeenCalledWith('Sam Okafor');
});
