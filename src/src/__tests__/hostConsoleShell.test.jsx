// src/src/__tests__/hostConsoleShell.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import HostConsole from '../components/console/HostConsole';
import { stripFor } from '../config/workflowStrip';

const strip = stripFor({ gameType: 'call-and-answer', roundNoun: 'Round', state: 'ASK#002', totalRounds: 6, progress: { received: 3, total: 4 } });
const controls = {
  primary: { id: 'open-vote', label: 'Start voting', intent: 'finish', icon: 'ListChecks' },
  secondary: { id: 'skip', label: 'Skip this round', intent: 'skip', icon: 'SkipForward' },
  status: { text: '3 of 4 answered', tone: 'pending' },
};
const props = (over = {}) => ({
  moment: 'ANSWERING',
  top: { title: 'Relay expansion', code: '7924', onJoin: jest.fn(), presentHref: '/present?gameId=7924', presentDetail: { open: true, fullscreen: true, visible: true, statusAt: new Date().toISOString() } },
  strip: { strip, mode: 'full', onView: jest.fn() },
  rail: {
    moment: 'ANSWERING',
    rounds: [{ n: 1, title: 'Churchill', state: 'done' }, { n: 2, title: 'Meiji', state: 'now' }],
    people: [{ name: 'Ada', state: 'answered' }, { name: 'Omar', state: 'writing' }],
    counts: { players: 4, answered: 3, voted: 0 },
    late: [], connected: true, onOpenSection: jest.fn(),
  },
  footer: { status: controls.status, part: strip.part, controls, onAction: jest.fn(), shortcutsEnabled: false },
  ...over,
});

test('top: name, join code, room\'s window and its status', () => {
  render(<HostConsole {...props()}><div>panel</div></HostConsole>);
  expect(screen.getByText('Relay expansion')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Join 7924/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Room's window/ })).toHaveAttribute('href', '/present?gameId=7924');
  expect(screen.getByText("Room's window: on, full screen")).toBeInTheDocument();
});

test('the loop is there without Your part now; the footer carries it with the buttons', () => {
  const { container } = render(<HostConsole {...props()}><div>panel</div></HostConsole>);
  expect(container.querySelector('.hc-loop .wfs-part')).toBeNull();
  expect(container.querySelector('.hc-foot').textContent).toMatch(/Your part now/);
  expect(screen.getByRole('button', { name: /Start voting/ })).toBeInTheDocument();
});

test('the rail opens the moment\'s section; the host\'s choice holds until the moment changes (Review Focus 4)', () => {
  const { rerender, container } = render(<HostConsole {...props()}><div /></HostConsole>);
  const open = () => [...container.querySelectorAll('.hc-rail details')].filter((d) => d.open).map((d) => d.dataset.section);
  expect(open()).toEqual(['people']);
  fireEvent.click(container.querySelector('.hc-rail details[data-section="people"] summary'));
  expect(open()).toEqual([]);
  rerender(<HostConsole {...props()}><div /></HostConsole>);
  expect(open()).toEqual([]);
  rerender(<HostConsole {...props({ moment: 'READ', rail: { ...props().rail, moment: 'READ' } })}><div /></HostConsole>);
  expect(open()).toEqual(['late']);
});

test('People says the one count; a section\'s link opens the session menu at its tab', () => {
  const p = props();
  const { container } = render(<HostConsole {...p}><div /></HostConsole>);
  expect(container.querySelector('[data-section="people"] summary').textContent).toMatch('3 of 4 answered');
  fireEvent.click(screen.getByRole('button', { name: 'All players' }));
  expect(p.rail.onOpenSection).toHaveBeenCalledWith('players');
});

test('the panel is drawn in the main area', () => {
  render(<HostConsole {...props()}><div data-testid="panel">panel</div></HostConsole>);
  expect(screen.getByTestId('panel').closest('.hc-main')).not.toBeNull();
});
