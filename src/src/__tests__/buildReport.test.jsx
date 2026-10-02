/**
 * THE BUILD ROOM REPORT — buildroom/BuildReport.jsx.
 *
 * Fed HostState computed by the real lambda-functions/game/build-store.js
 * (`roomFromRows` → `hostView`), so the report reads exactly what GET
 * build/state sends. Pins the sections and their order of facts, that host
 * notes stay out, that links render only when http(s), and that Print calls
 * window.print. No geometric assertions.
 */
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import BuildReport from '../buildroom/BuildReport';

const S = require('../../../lambda-functions/game/build-store');

const T = (m) => `2026-10-02T19:${String(m).padStart(2, '0')}:00.000Z`;

function state() {
  const rows = [
    {
      SK: 'BUILD#STATE',
      Rev: 12,
      Outcome: {
        summary: 'A one-page sign-up site with the shift calendar first.',
        built: ['Shift calendar', 'Three-field form'],
        links: [{ label: 'Repo', url: 'https://github.com/eastside/signup' }, { label: 'Bad', url: 'javascript:alert(1)' }],
        nextSteps: ['Add Spanish copy'],
        by: 'agent',
        updatedAt: T(58),
      },
    },
    {
      SK: 'BUILD#ASK#001', AskId: '001', Kind: 'choice', Prompt: 'Which header first?', Status: 'decided', Source: 'agent',
      Options: [{ label: 'A', title: 'Bold banner' }, { label: 'B', title: 'Calm photo' }],
      DecidedAt: T(20), Decision: { direction: 'Go with B, keep A\'s logo', chosen: ['B'], note: 'Bigger button on phones' },
    },
    { SK: 'BUILD#ANS#001#Ana', AskId: '001', PlayerName: 'Ana', Choice: ['B'], Why: 'Dates first' },
    { SK: 'BUILD#ANS#001#Sam', AskId: '001', PlayerName: 'Sam', Choice: ['A'] },
    {
      SK: 'BUILD#ASK#002', AskId: '002', Kind: 'suggest', Prompt: 'What stops a sign-up?', Status: 'decided', Source: 'host',
      MaxPicks: 3, DecidedAt: T(30), Decision: { direction: 'No account, three fields only', chosen: [], note: '' },
    },
    { SK: 'BUILD#RESP#002#r1', AskId: '002', RespId: 'r1', Text: 'Making an account', PlayerName: 'Ana', Source: 'player', CreatedAt: T(25) },
    { SK: 'BUILD#VOTE#002#Sam', AskId: '002', PlayerName: 'Sam', RespIds: ['r1'] },
    {
      SK: 'BUILD#ASK#003', AskId: '003', Kind: 'rating', Prompt: 'How close are we?', Status: 'results', Source: 'host',
      Scale: { min: 1, max: 5, lowLabel: '', highLabel: '' },
    },
    { SK: 'BUILD#ANS#003#Ana', AskId: '003', PlayerName: 'Ana', Rating: 4 },
    { SK: 'BUILD#ASK#004', AskId: '004', Kind: 'suggest', Prompt: 'A discarded ask', Status: 'discarded', Source: 'agent' },
    { SK: 'BUILD#LOG#1#a', LogId: '1-a', Kind: 'progress', Text: 'Plan: list, form, reminder', By: 'agent', CreatedAt: T(5) },
    { SK: 'BUILD#LOG#2#b', LogId: '2-b', Kind: 'note', Text: 'Private: chase Dee', By: 'host', CreatedAt: T(6) },
    { SK: 'BUILD#LOG#3#c', LogId: '3-c', Kind: 'showing', Text: 'Header B live', By: 'agent', Link: 'https://preview.example/b', CreatedAt: T(40) },
    { SK: 'BUILD#IDEA#1#i', IdeaId: '1-i', PlayerName: 'Jordan', Text: 'A parking map', Status: 'promoted', CreatedAt: T(41) },
    { SK: 'BUILD#IDEA#2#j', IdeaId: '2-j', PlayerName: 'Sam', Text: 'Dark mode', Status: 'dismissed', CreatedAt: T(42) },
  ];
  return S.hostView({
    gameId: '4821',
    meta: { Title: 'Volunteer sign-up', Details: 'Pick a Saturday shift in under a minute.' },
    sessionState: 'ENDED',
    room: S.roomFromRows(rows),
    players: ['Ana', 'Jordan', 'Sam'],
    now: T(59),
  });
}

const section = (name) => screen.getByRole('heading', { name }).closest('section');

test('title, goal and the meta line', () => {
  render(<BuildReport state={state()} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Volunteer sign-up' })).toBeInTheDocument();
  expect(screen.getByText('Pick a Saturday shift in under a minute.')).toBeInTheDocument();
  expect(screen.getByText(/3 people · Claude Code · 3 asks · 2 timeline entries/)).toBeInTheDocument();
  expect(screen.getByText(/Build Room report · /)).toBeInTheDocument();
});

test('What we built: summary, built, next steps, and only http(s) links', () => {
  render(<BuildReport state={state()} />);
  const s = section('What we built');
  expect(within(s).getByText('A one-page sign-up site with the shift calendar first.')).toBeInTheDocument();
  expect(within(s).getByText('Shift calendar')).toBeInTheDocument();
  expect(within(s).getByText('Add Spanish copy')).toBeInTheDocument();
  expect(within(s).getByRole('link', { name: 'Repo' })).toHaveAttribute('href', 'https://github.com/eastside/signup');
  expect(within(s).queryByRole('link', { name: 'Bad' })).toBeNull();
});

test('Decisions: each ask with its results, the direction and the note; discarded asks left out', () => {
  render(<BuildReport state={state()} />);
  const s = section('Decisions');
  expect(within(s).getByText(/Ask 1 · Which header first\?/)).toBeInTheDocument();
  expect(within(s).getByText('Calm photo')).toBeInTheDocument();
  expect(within(s).getAllByText('1 · 50%')).toHaveLength(2);
  expect(within(s).getByText('Go with B, keep A\'s logo', { exact: false })).toBeInTheDocument();
  expect(within(s).getByText('Bigger button on phones', { exact: false })).toBeInTheDocument();
  expect(within(s).getByText('Dates first', { exact: false })).toBeInTheDocument();
  expect(within(s).getByText('Making an account')).toBeInTheDocument();
  expect(within(s).getByText('1 votes')).toBeInTheDocument();
  expect(within(s).getByText(/Ask 3 · How close are we\?/)).toBeInTheDocument();
  expect(within(s).getByText('1 rated')).toBeInTheDocument();
  expect(within(s).queryByText(/A discarded ask/)).toBeNull();
});

test('Timeline: every entry but host notes, with links', () => {
  render(<BuildReport state={state()} />);
  const s = section('Timeline');
  expect(within(s).getByText('Plan: list, form, reminder')).toBeInTheDocument();
  expect(within(s).getByText('Header B live')).toBeInTheDocument();
  expect(within(s).getByRole('link', { name: 'https://preview.example/b' })).toBeInTheDocument();
  expect(screen.queryByText('Private: chase Dee')).toBeNull();
});

test('Ideas from the room and who took part', () => {
  render(<BuildReport state={state()} />);
  const ideas = section('Ideas from the room');
  expect(within(ideas).getByText('A parking map')).toBeInTheDocument();
  expect(within(ideas).getByText('Used')).toBeInTheDocument();
  expect(within(ideas).getByText('Dismissed')).toBeInTheDocument();
  const people = section('Who took part');
  ['Ana', 'Jordan', 'Sam'].forEach((name) => expect(within(people).getByText(name)).toBeInTheDocument());
});

test('Print / Save as PDF calls window.print, and Back calls onBack', () => {
  const print = jest.spyOn(window, 'print').mockImplementation(() => {});
  const onBack = jest.fn();
  render(<BuildReport state={state()} onBack={onBack} />);
  fireEvent.click(screen.getByRole('button', { name: /Print \/ Save as PDF/ }));
  expect(print).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Back to room/ }));
  expect(onBack).toHaveBeenCalled();
  print.mockRestore();
});

test('paper theme on its own root', () => {
  const { container } = render(<BuildReport state={state()} />);
  expect(container.firstChild).toHaveAttribute('data-theme', 'light');
  expect(container.firstChild).toHaveClass('brr');
});

test('an empty room still renders every section with an honest empty state', () => {
  const empty = S.hostView({
    gameId: '1111', meta: { Title: 'Empty' }, sessionState: 'STARTED', room: S.roomFromRows([]), players: [], now: T(1),
  });
  render(<BuildReport state={empty} />);
  expect(screen.getByText(/No wrap-up yet/)).toBeInTheDocument();
  expect(screen.getByText('The room was not asked anything.')).toBeInTheDocument();
  expect(screen.getByText('No ideas were sent.')).toBeInTheDocument();
  expect(screen.getByText('Nobody joined from a phone.')).toBeInTheDocument();
});
