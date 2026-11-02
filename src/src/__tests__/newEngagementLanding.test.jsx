/**
 * ONE NEW DOOR, AND EVERY CREATED THING ON ITS OWN SETUP (experience plan
 * §3.1, §6 Phase 4 step 4c; §7 decision 7; audit E N1-N4, R1).
 *
 *   - Quick start is the fast lane inside New engagement (config/quickStart.js):
 *     one press, every default, said before the press; it creates like Create.
 *   - A created session lands on its own Setup (SetupBeforeStart), not
 *     started: Start (Open the survey) and Edit there, and Setup's own panel
 *     in its `before` state — step 1 can be chosen now, steps 2 and 3 wait
 *     for Start, no join code drawn.
 *   - "Reports" means saved PDFs everywhere: the saved list is "Reports", a
 *     report's link to the sessions list is "Your sessions" (the list's own name).
 *
 * The Build Room's fields and the event's day in the dialog are in
 * createOtherEngagements.test.jsx; the mounted page's journey (Home → New →
 * Quick start → Setup → Start) in hostRenderTransitions.test.jsx.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within } from '@testing-library/react';
import GameSetupDialog from '../components/GameSetupDialog';
import SetupBeforeStart from '../components/SetupBeforeStart';
import HostReportsDialog from '../components/HostReportsDialog';
import { quickFormat, quickSet, quickTitle, QUICK_DEFAULT_FORMAT } from '../config/quickStart';
import { setRefKey } from '../utils/setRef';
import { isHandoffFormat } from '../config/formatGuide';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ prompts: [], reports: [] }) })),
}));

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const SETS = [
  { id: 'retro', name: 'Retro basics', engagementType: 'call-and-answer', totalQuestions: 6, scope: 'platform' },
  { id: 'mine', name: 'My retro', engagementType: 'call-and-answer', totalQuestions: 4, scope: 'org', mine: true },
  { id: 'quick-ca', name: 'Warm-up', engagementType: 'call-and-answer', totalQuestions: 5, scope: 'platform', quickstart: true },
  { id: 'space', name: 'Space Trivia', engagementType: 'trivia', totalQuestions: 12, scope: 'platform' },
  { id: 'pulse', name: 'Team pulse', engagementType: 'survey', totalQuestions: 5, scope: 'platform', namesDefault: 'named' },
];

const base = (over = {}) => ({
  eventTitle: '',
  onEventTitleChange: jest.fn(),
  questionSets: SETS,
  personas: [],
  categories: [],
  activeCategoryIds: new Set(),
  onCancel: jest.fn(),
  onCreate: jest.fn(),
  onFormatChange: jest.fn(),
  onQuestionSetChange: jest.fn(),
  onChooseOther: jest.fn(),
  eventsAccess: { enabled: true, canCreate: true, offerPlanName: '' },
  ...over,
});
const radio = (name) => screen.getByRole('radio', { name });
const quickButton = () => screen.queryByRole('button', { name: /^quick start$/i });

describe('Quick start: what it picks (config/quickStart.js)', () => {
  const offered = ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey', 'build', 'event'];
  const isHandoff = isHandoffFormat;

  test('the format: chosen, else the last one, else Call & Answer; never a Build Room or an event', () => {
    expect(quickFormat({ chosen: 'trivia', lastFormat: 'poll', offered, isHandoff })).toBe('trivia');
    expect(quickFormat({ chosen: '', lastFormat: 'poll', offered, isHandoff })).toBe('poll');
    expect(quickFormat({ chosen: '', lastFormat: '', offered, isHandoff })).toBe(QUICK_DEFAULT_FORMAT);
    expect(quickFormat({ chosen: 'build', lastFormat: 'event', offered, isHandoff })).toBe('call-and-answer');
  });

  test('the set: picked, else used lately, else marked for Quick start, else ready-made, else the first; never unreadable', () => {
    const keyOf = setRefKey;
    const ca = { sets: SETS, format: 'call-and-answer', keyOf };
    expect(quickSet({ ...ca, chosenKey: setRefKey(SETS[1]) }).id).toBe('mine');
    expect(quickSet({ ...ca, recent: new Map([[setRefKey(SETS[1]), 5], [setRefKey(SETS[0]), 9]]) }).id).toBe('retro');
    expect(quickSet(ca).id).toBe('quick-ca');
    expect(quickSet({ ...ca, sets: SETS.filter((s) => !s.quickstart) }).id).toBe('retro');
    expect(quickSet({ ...ca, sets: [SETS[1]] }).id).toBe('mine');
    expect(quickSet({ ...ca, isUnreadable: (s) => s.id === 'quick-ca' }).id).toBe('retro');
    expect(quickSet({ ...ca, format: 'poll' })).toBeNull();
  });

  test('the title: the one typed, else "Quick <format>: <set>"', () => {
    expect(quickTitle('  Friday retro ', 'Call & Answer', 'Retro basics')).toBe('Friday retro');
    expect(quickTitle('', 'Call & Answer', 'Retro basics')).toBe('Quick Call & Answer: Retro basics');
  });
});

describe('Quick start: the fast lane inside New engagement', () => {
  test('on open it says what it will make, and one press creates it with every default', () => {
    const props = base();
    render(<GameSetupDialog {...props} />);
    const lane = screen.getByTestId('gsd-quick');
    expect(lane).toHaveTextContent('In a hurry? Call & Answer with “Warm-up”, every default. You land on its Setup, ready to start.');
    fireEvent.click(quickButton());
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(props.onCreate.mock.calls[0][0]).toEqual(expect.objectContaining({
      title: 'Quick Call & Answer: Warm-up',
      gameType: 'call-and-answer',
      setId: 'quick-ca',
      setScope: 'platform',
      categoryIds: [],
      randomizeQuestions: true,
      anonymousResponses: true,
      target: null,
      briefing: null,
      quick: true,
    }));
  });

  test('it follows the dialog: the title typed, the format chosen, the set picked', () => {
    const props = base({ eventTitle: 'Launch quiz' });
    render(<GameSetupDialog {...props} />);
    fireEvent.click(radio('Trivia'));
    expect(screen.getByTestId('gsd-quick')).toHaveTextContent('Trivia with “Space Trivia”');
    fireEvent.click(quickButton());
    expect(props.onCreate.mock.calls[0][0]).toEqual(expect.objectContaining({
      title: 'Launch quiz', gameType: 'trivia', setId: 'space',
    }));
  });

  test('a survey from the lane takes the set\'s own names rule and is never shuffled', () => {
    const props = base();
    render(<GameSetupDialog {...props} />);
    fireEvent.click(radio('Survey'));
    fireEvent.click(quickButton());
    const sent = props.onCreate.mock.calls[0][0];
    expect(sent).toEqual(expect.objectContaining({ gameType: 'survey', setId: 'pulse', names: 'named', randomizeQuestions: false }));
    expect('target' in sent).toBe(false);
  });

  test('a host\'s last format leads the lane; the format group itself still opens unchosen (round 4)', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="trivia" />);
    expect(screen.getByTestId('gsd-quick')).toHaveTextContent('Trivia with “Space Trivia”');
    expect(radio('Trivia')).toHaveAttribute('aria-checked', 'false');
  });

  test('no lane for a Build Room or an event, none in edit, and none with no set to start from', () => {
    const { unmount } = render(<GameSetupDialog {...base()} />);
    fireEvent.click(radio('Build Room'));
    expect(screen.queryByTestId('gsd-quick')).toBeNull();
    fireEvent.click(radio('Event'));
    expect(screen.queryByTestId('gsd-quick')).toBeNull();
    unmount();
    const edit = render(<GameSetupDialog {...base()} mode="edit" initialValues={{ title: 'x', gameType: 'trivia', questionSetId: 'space' }} />);
    expect(screen.queryByTestId('gsd-quick')).toBeNull();
    edit.unmount();
    render(<GameSetupDialog {...base({ questionSets: [] })} />);
    expect(screen.queryByTestId('gsd-quick')).toBeNull();
  });

  test('pressed while a create is in flight, it does nothing', () => {
    const props = base({ busy: true });
    render(<GameSetupDialog {...props} />);
    expect(quickButton()).toBeDisabled();
  });
});

describe('a created session lands on its own Setup, ready to Start', () => {
  const setup = (over = {}) => {
    const props = {
      title: 'Friday retro',
      code: '4821',
      formatLabel: 'Call & Answer',
      setName: 'Retro basics',
      startLabel: 'Start · two screens',
      onStart: jest.fn(),
      onEdit: jest.fn(),
      onInvite: jest.fn(),
      onMainMenu: jest.fn(),
      onChoose: jest.fn(),
      ...over,
    };
    render(<SetupBeforeStart {...props} />);
    return props;
  };

  test('its name, format, set and code; Start said for what it will do; Edit and Main menu', () => {
    const props = setup();
    const page = screen.getByTestId('setup-before-start');
    expect(page).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('heading', { level: 1, name: 'Friday retro' })).toBeInTheDocument();
    expect(page).toHaveTextContent('Call & Answer · Retro basics · Code 4821');
    expect(screen.getByRole('status')).toHaveTextContent('Created. Nobody can join until you start it. You can still edit it until then.');
    fireEvent.click(screen.getByRole('button', { name: /Start · two screens/ }));
    expect(props.onStart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /^Invite$/ }));
    expect(props.onInvite).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Main menu/ }));
    expect(props.onMainMenu).toHaveBeenCalledTimes(1);
    // ONE main button on the page (principle 4).
    expect(page.querySelectorAll('.ui-btn--action')).toHaveLength(1);
  });

  test('the body is Setup itself, before Start: step 1 open to choose, steps 2 and 3 wait, no join code', () => {
    const props = setup();
    const panel = screen.getByRole('region', { name: 'Setup' });
    expect(panel).toHaveAttribute('data-at', 'before');
    expect(panel.querySelector('[data-step="where"]')).toHaveAttribute('data-state', 'now');
    expect(panel.querySelector('[data-step="screen"]')).toHaveAttribute('data-state', 'later');
    expect(panel.querySelector('[data-step="joins"]')).toHaveAttribute('data-state', 'later');
    expect(within(panel).getAllByText('after Start')).toHaveLength(2);
    expect(screen.queryByTestId('setup-qr')).toBeNull();
    expect(panel).toHaveTextContent('Nothing yet. Nobody can join until you start it.');
    // Choosing where the room watches works before Start.
    fireEvent.click(within(panel).getAllByRole('button').find((b) => /two screens/i.test(b.textContent)));
    expect(props.onChoose).toHaveBeenCalledWith('two');
  });

  test('a choice already made folds step 1 with Change; 2 and 3 still wait for Start', () => {
    setup({ choice: 'classic', onChange: jest.fn() });
    const panel = screen.getByRole('region', { name: 'Setup' });
    expect(panel.querySelector('[data-step="where"]')).toHaveAttribute('data-state', 'done');
    expect(within(panel).getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(panel.querySelector('[data-step="screen"]')).toHaveAttribute('data-state', 'later');
  });

  test('a survey: Open the survey, no steps (it has no lobby), and the line says so', () => {
    setup({ survey: true, steps: false, startLabel: 'Open the survey', formatLabel: 'Survey' });
    expect(screen.getByRole('status')).toHaveTextContent('Created. Nobody can answer until you open it.');
    expect(screen.getByRole('button', { name: /Open the survey/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Setup' })).toBeNull();
    expect(screen.getByText(/A survey has no lobby/)).toBeInTheDocument();
  });

  test('a refused Start is said here; while starting, the buttons wait', () => {
    setup({ notice: 'It did not start: Nothing to ask yet.', busy: true });
    expect(screen.getByRole('alert')).toHaveTextContent('It did not start: Nothing to ask yet.');
    expect(screen.getByRole('button', { name: /Starting…/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Edit$/ })).toBeDisabled();
  });

  test('the page lands every round type and survey here, with Edit returning to it, and the live frame starts it', () => {
    const host = read('GameHostPage.jsx');
    expect(host).toMatch(/import SetupBeforeStart from '\.\/components\/SetupBeforeStart';/);
    expect(host).toMatch(/steps=\{SETUP_TYPES\.includes\(setupKind\)\}/);
    expect(host).toMatch(/startLabel=\{isSurveyType\(createdSetup\.gameType\) \? 'Open the survey' : startLabelFor\(roomScreenChoice\)\(setupRow\)\}/);
    // Start opens the room's window inside the press on two screens (startRow).
    expect(host).toMatch(/onStart=\{\(\) => startRow\(setupRow, createdSetup\.title/);
    // Saving an edit keeps the Setup and its new name.
    expect(host).toMatch(/setCreatedSetup\(\(prev\) => \(prev && prev\.gameId === String\(targetId\) \? \{ \.\.\.prev, title: form\.title \} : prev\)\)/);
  });
});

describe('"Reports" means saved PDFs everywhere (PLAN §3.6; audit E R1)', () => {
  test('the saved list is called Reports', () => {
    render(<HostReportsDialog onClose={jest.fn()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Reports' })).toBeInTheDocument();
  });

  test('a report\'s link to the sessions list says Your sessions (the list\'s own name), never "All session reports"', () => {
    const report = read('components', 'GameReport.jsx');
    expect(report).not.toMatch(/All session reports/);
    expect(report).toMatch(/> Your sessions\n/);
    for (const f of ['components/HostReportsDialog.jsx', 'components/GameReport.jsx', 'components/SessionHistoryPanel.jsx', 'components/WelcomeScreen.jsx']) {
      const text = read(...f.split('/')).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(text).not.toMatch(/\b(your reports|session reports)\b/i);
    }
  });
});
