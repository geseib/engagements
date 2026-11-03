/**
 * THE SESSION MENU, SIMPLIFIED (docs/design/session-menu; approved 3 Nov 2026,
 * "yes, add People and go with the recommendations").
 *
 * Pins the structure the owner approved: the sections per type and mode, the
 * People section in every version (private on one screen), Rounds so far with
 * the report first, one More options per section that names what it holds,
 * the event line instead of an Agenda tab, the foot's End session and Main
 * menu, the old deep links, and the phone Remote's End session (fork F8).
 * Behaviour only: jsdom has no layout, so nothing here measures.
 */
import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import RemoteSessionPanel from '../components/RemoteSessionPanel';
import { setupPanelTabs, sessionMenuSection, LEGACY_SECTIONS, categoriesSummary, eventPlace, moreOptionsSummary } from '../config/setupPanel';
import { remotePanelTabs, remotePanelTab } from '../config/hostRemote';
import { BUILD_MENU_TABS, buildMenuSection } from '../buildroom/BuildSessionPanel';
import { endSessionConfirm } from '../config/hostControls';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) }));
jest.mock('../utils/questionQueueClient', () => ({
  fetchUpNext: jest.fn(() => Promise.resolve({ ok: true, upNext: [], blocked: [], advisories: [] })),
  postQueueOp: jest.fn(),
}));

beforeEach(() => { try { window.localStorage.clear(); } catch (e) { /* none */ } });

const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);
const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

const PLAYERS = [
  { name: 'Priya', score: 120 },
  { name: 'Sam', score: 80, handover: { requested: true, requestedAt: new Date().toISOString() } },
];

const ROUND_SECTIONS = ['Up next', 'Rounds so far', 'People', 'Screens', 'Joining', 'How it runs'];
const SURVEY_SECTIONS = ['Close survey', 'Survey results', 'People', 'Screens', 'Joining', 'How it runs'];

describe('the sections, per type and mode', () => {
  test('config: round types and surveys, with or without a People column or an event', () => {
    for (const opts of [{}, { peopleColumn: true }, { event: true }, { event: true, peopleColumn: true }]) {
      expect(setupPanelTabs(opts).map((t) => t.label)).toEqual(ROUND_SECTIONS);
      expect(setupPanelTabs({ ...opts, survey: true }).map((t) => t.label)).toEqual(SURVEY_SECTIONS);
    }
  });

  test.each([
    ['call-and-answer', false], ['call-and-answer', true],
    ['trivia', false], ['trivia', true],
    ['poll', false], ['wavelength', true],
  ])('%s (one screen: %s) draws the six round sections', (gameType, oneScreen) => {
    render(<SessionSetupPanel gameType={gameType} oneScreen={oneScreen} gameState="ASK#002" />);
    expect(tabNames()).toEqual(ROUND_SECTIONS);
  });

  test('a survey: Close survey · Survey results · People · Screens · Joining · How it runs', () => {
    render(<SessionSetupPanel gameType="survey" gameState="SURVEY#OPEN" />);
    expect(tabNames()).toEqual(SURVEY_SECTIONS);
  });

  test('an event item has no Agenda tab and no End session tab', () => {
    render(<SessionSetupPanel event={{ onAgenda: () => {} }} />);
    expect(tabNames()).toEqual(ROUND_SECTIONS);
    expect(screen.queryByRole('tab', { name: /agenda/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /end session/i })).toBeNull();
  });

  test('the Build Room: Claude · Asks so far · People · Screens · Joining', () => {
    expect(BUILD_MENU_TABS.map((t) => t.label)).toEqual(['Claude', 'Asks so far', 'People', 'Screens', 'Joining']);
  });

  test('the phone Remote: Up next · Rounds so far · People', () => {
    expect(remotePanelTabs().map((t) => t.label)).toEqual(['Up next', 'Rounds so far', 'People']);
  });

  test('it opens on Up next during play (fork F7), Rounds so far once ended', () => {
    const { unmount } = render(<SessionSetupPanel gameState="ASK#002" />);
    expect(screen.getByRole('tab', { name: 'Up next' })).toHaveAttribute('aria-selected', 'true');
    unmount();
    render(<SessionSetupPanel gameState="ENDED" />);
    expect(screen.getByRole('tab', { name: 'Rounds so far' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('People, in every version of the menu', () => {
  test.each([
    ['two screens, console with a People column', { peopleColumn: true }],
    ['one screen', { oneScreen: true }],
    ['an event item', { event: { onAgenda: () => {} } }],
    ['a survey', { gameType: 'survey', gameState: 'SURVEY#OPEN' }],
  ])('%s has a People section', (_, props) => {
    render(<SessionSetupPanel players={PLAYERS} {...props} />);
    expect(screen.getByRole('tab', { name: 'People' })).toBeInTheDocument();
  });

  test('the rows are the rail\'s person row, with a name request\'s Let them / Not now, and who left with Bring back', () => {
    const onGrant = jest.fn();
    const onRefuse = jest.fn();
    const onRestore = jest.fn();
    const { container } = render(
      <SessionSetupPanel
        players={PLAYERS}
        removedPlayers={[{ name: 'Jo', score: 20 }]}
        initialTab="people"
        onGrantHandover={onGrant}
        onRefuseHandover={onRefuse}
        onRestorePlayer={onRestore}
      />,
    );
    expect(container.querySelectorAll('li.prow').length).toBe(3);
    const asker = screen.getByTestId('person-asking');
    expect(within(asker).getByText('Sam')).toBeInTheDocument();
    fireEvent.click(within(asker).getByRole('button', { name: /Let them: Sam/ }));
    expect(onGrant).toHaveBeenCalledWith('Sam', true);
    fireEvent.click(within(asker).getByRole('button', { name: /Not now: Sam/ }));
    expect(onRefuse).toHaveBeenCalledWith('Sam');
    const left = screen.getByTestId('people-left');
    fireEvent.click(within(left).getByRole('button', { name: 'More for Jo' }));
    fireEvent.click(within(left).getByRole('menuitem', { name: 'Bring back' }));
    expect(onRestore).toHaveBeenCalledWith('Jo');
  });

  test('⋯ holds Move to a new device and Remove from session (pressed twice), and Lock name while a name is open', () => {
    const onGrant = jest.fn();
    const onRemove = jest.fn();
    const onLock = jest.fn();
    const future = Math.floor(Date.now() / 1000) + 600;
    render(
      <SessionSetupPanel
        players={[{ name: 'Priya', score: 1 }, { name: 'Ola', score: 0, handover: { open: true, expiresAt: future } }]}
        initialTab="people"
        onGrantHandover={onGrant}
        onRemovePlayer={onRemove}
        onLockHandover={onLock}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More for Priya' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to a new device' }));
    expect(onGrant).toHaveBeenCalledWith('Priya', false);
    fireEvent.click(screen.getByRole('button', { name: 'More for Priya' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from session' }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Press again to remove' }));
    expect(onRemove).toHaveBeenCalledWith('Priya');
    fireEvent.click(screen.getByRole('button', { name: 'More for Ola' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Lock name' }));
    expect(onLock).toHaveBeenCalledWith('Ola');
  });

  test('one screen: the list waits behind Show on this screen, as a count with no names', () => {
    render(<SessionSetupPanel players={PLAYERS} removedPlayers={[{ name: 'Jo', score: 20 }]} initialTab="people" oneScreen />);
    const gate = screen.getByTestId('private-people');
    expect(gate).toHaveTextContent('2 people · 1 left · 1 name request');
    expect(gate).toHaveTextContent(/phone/);
    expect(screen.queryByText('Priya')).toBeNull();
    expect(screen.queryByText('Sam')).toBeNull();
    fireEvent.click(within(gate).getByRole('button', { name: 'Show on this screen' }));
    fireEvent.click(screen.getByRole('button', { name: /Show it/ }));
    expect(screen.getByText('Priya')).toBeInTheDocument();
  });

  test('on the console the rail\'s "All N, and who left" (players) opens this section', () => {
    render(<SessionSetupPanel players={PLAYERS} peopleColumn initialTab="players" />);
    expect(screen.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Rounds so far: the report first, then every round', () => {
  const rounds = [
    { number: 2, ordinal: 2, title: 'Where do we lose deals?', answers: [], aiSummary: { summaryText: 'x' } },
    { number: 1, ordinal: 1, title: 'Warm-up', answers: [] },
  ];

  test('before round 1 it says so and draws no dead report button (review R5)', () => {
    render(<SessionSetupPanel initialTab="history" />);
    expect(screen.getByTestId('history-empty')).toHaveTextContent('The report and each round appear here once a round has been played.');
    expect(screen.queryByTestId('open-report')).toBeNull();
  });

  test('the report card comes first, then each round, which reopens', () => {
    const onViewReports = jest.fn();
    const onOpenRound = jest.fn();
    render(<SessionSetupPanel initialTab="history" rounds={rounds} onViewReports={onViewReports} onOpenRound={onOpenRound} />);
    const report = screen.getByTestId('session-report');
    expect(report).toHaveTextContent('Rounds 1–2 so far');
    const order = report.compareDocumentPosition(screen.getByText('Where do we lose deals?'));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByTestId('open-report'));
    expect(onViewReports).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Warm-up'));
    expect(onOpenRound).toHaveBeenCalledWith(1);
  });

  test('the late line counts, and Review opens the list in place', () => {
    const late = { rounds: [{ round: 1, items: [{ id: 'a', reviewed: false, text: 'late words' }] }], onShow: () => {}, onMarkReviewed: () => {} };
    render(<SessionSetupPanel initialTab="history" rounds={rounds} late={late} />);
    expect(screen.getByTestId('late-line')).toHaveTextContent('1 late item to review');
    fireEvent.click(screen.getByTestId('late-review'));
    expect(screen.getByTestId('late-review')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('More options: one per section, naming what it holds', () => {
  test('the closed line is built from its groups, so it cannot lie', () => {
    expect(moreOptionsSummary([{ label: 'A' }, null, { label: 'B' }])).toBe('A · B');
  });

  test.each([
    ['up-next', ['Category switches', 'Put aside this session (1)', 'Goal']],
    ['history', ['Late items in the report']],
    ['screens', ['Screen size', 'Scoreboard look', 'Show how this works', 'Keys']],
    ['joining', ['Calendar invite']],
  ])('%s names its groups closed and shows them open', (section, groups) => {
    render(
      <SessionSetupPanel
        initialTab={section}
        categories={[{ name: 'Strategy', questionCount: 4 }]}
        activeCategoryIds={new Set(['Strategy'])}
        upNextExcluded={[{ key: 'q1', title: 'Put away' }]}
        goal={{ progress: 'Question 3 of 5' }}
        scoreboardAvailability={{ show: true, enabled: true }}
        rounds={[{ number: 1, ordinal: 1, title: 'R1', answers: [] }]}
      />,
    );
    expect(screen.getByTestId(`more-${section}-summary`)).toHaveTextContent(groups.join(' · '));
    fireEvent.click(screen.getByTestId(`more-${section}-toggle`));
    expect(screen.getByTestId(`more-${section}-toggle`)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByTestId(`more-${section}-summary`)).toBeNull();
  });

  test('How it runs: Names and Pace by default; who is waiting, wall comments and Workie in More', () => {
    render(<SessionSetupPanel initialTab="run" gameType="call-and-answer" workie={{ briefed: true, personas: [], prompts: [] }} />);
    expect(screen.getByTestId('attribute-authors')).toBeInTheDocument();
    expect(screen.getByTestId('auto-mode')).toBeInTheDocument();
    expect(screen.queryByTestId('wall-comments')).toBeNull();
    expect(screen.getByTestId('more-run-summary')).toHaveTextContent('Who is still waiting · Comments on the wall · Workie\'s voice and approach');
    fireEvent.click(screen.getByTestId('more-run-toggle'));
    expect(screen.getByTestId('name-waiting')).toBeInTheDocument();
    expect(screen.getByTestId('wall-comments')).toBeInTheDocument();
    expect(screen.getByTestId('workie-settings')).toBeInTheDocument();
  });

  test('once opened it stays open for the session (this viewer), and survives blocked storage', () => {
    const { unmount } = render(<SessionSetupPanel initialTab="joining" />);
    fireEvent.click(screen.getByTestId('more-joining-toggle'));
    unmount();
    render(<SessionSetupPanel initialTab="joining" />);
    expect(screen.getByTestId('more-joining-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  test('Up next\'s Categories line: "4 of 6 on · N questions left", and Change opens the switches', () => {
    const rows = [
      { name: 'A', enabled: true, remaining: 3 }, { name: 'B', enabled: false, remaining: 2 },
    ];
    expect(categoriesSummary(rows)).toBe('1 of 2 on · 3 questions left');
    render(<SessionSetupPanel categories={[{ name: 'A', questionCount: 3 }, { name: 'B', questionCount: 2 }]} activeCategoryIds={new Set(['A'])} />);
    expect(screen.getByTestId('categories-summary')).toHaveTextContent('Categories · 1 of 2 on · 3 questions left');
    expect(screen.queryAllByTestId('category-toggle')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('categories-change'));
    expect(screen.getAllByTestId('category-toggle')).toHaveLength(2);
  });
});

describe('the event line, instead of an Agenda tab', () => {
  test('"This event · item 3 of 6 · the room is on item 2", Bring everyone here and ‹ Agenda, in every section', () => {
    const onAgenda = jest.fn();
    const onBringHere = jest.fn();
    expect(eventPlace({ n: 3, total: 6, roomOn: 2 })).toBe('item 3 of 6 · the room is on item 2');
    expect(eventPlace({ n: 3, total: 6, roomOn: 3 })).toBe('item 3 of 6');
    render(<SessionSetupPanel event={{ onAgenda, onBringHere, n: 3, total: 6, roomOn: 2 }} />);
    for (const name of ROUND_SECTIONS) {
      openTab(name);
      const line = screen.getByTestId('session-menu-event');
      expect(line).toHaveTextContent('This event · item 3 of 6 · the room is on item 2');
    }
    fireEvent.click(screen.getByTestId('session-menu-bring'));
    expect(onBringHere).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));
    expect(onAgenda).toHaveBeenCalled();
  });

  test('no Bring everyone here while the room is on this item; no line outside an event', () => {
    const { unmount } = render(<SessionSetupPanel event={{ onAgenda: () => {}, onBringHere: null, n: 2, total: 4 }} />);
    expect(screen.queryByTestId('session-menu-bring')).toBeNull();
    unmount();
    render(<SessionSetupPanel />);
    expect(screen.queryByTestId('session-menu-event')).toBeNull();
  });
});

describe('the foot: End session and Main menu, in every section (fork F2)', () => {
  test('a round type: both in every section, End session raises the page\'s confirmed action', () => {
    const onEndSession = jest.fn();
    const onSwitchGame = jest.fn();
    render(<SessionSetupPanel gameState="ASK#002" onEndSession={onEndSession} onSwitchGame={onSwitchGame} />);
    for (const name of ROUND_SECTIONS) {
      openTab(name);
      const foot = screen.getByTestId('session-menu-foot');
      expect(within(foot).getByTestId('session-menu-end')).toHaveTextContent('End session…');
      expect(within(foot).getByTestId('session-menu-main')).toHaveTextContent('Main menu');
    }
    fireEvent.click(screen.getByTestId('session-menu-end'));
    expect(onEndSession).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('session-menu-main'));
    expect(onSwitchGame).toHaveBeenCalledTimes(1);
  });

  test('Main menu carries the "keeps running" hint; no Sign out or Admin in the live menu (fork F5)', () => {
    render(<SessionSetupPanel gameState="ASK#002" />);
    expect(screen.getByTestId('session-menu-main').getAttribute('title')).toMatch(/session/i);
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
    expect(screen.queryByText(/Admin ↗/)).toBeNull();
  });

  test('in the lobby too; not once ended', () => {
    const { unmount } = render(<SessionSetupPanel gameState="CREATED" />);
    expect(screen.getByTestId('session-menu-end')).toBeInTheDocument();
    unmount();
    render(<SessionSetupPanel gameState="ENDED" />);
    expect(screen.queryByTestId('session-menu-end')).toBeNull();
    expect(screen.getByTestId('session-menu-main')).toBeInTheDocument();
  });

  test('a survey: held until it is closed, then the survey\'s own end', () => {
    const onAct = jest.fn();
    const end = { id: 'end-survey', label: 'End the session' };
    const { unmount } = render(<SessionSetupPanel gameType="survey" gameState="SURVEY#OPEN" surveyActs={{ close: { label: 'Close' }, end: null, onAct }} />);
    expect(screen.getByTestId('session-menu-end')).toBeDisabled();
    expect(screen.getByTestId('session-menu-end').getAttribute('title')).toMatch(/Close the survey first/);
    unmount();
    render(<SessionSetupPanel gameType="survey" gameState="SURVEY#CLOSED" surveyActs={{ close: null, end, closed: true, onAct }} />);
    fireEvent.click(screen.getByTestId('session-menu-end'));
    expect(onAct).toHaveBeenCalledWith(end);
  });
});

describe('old deep links and section ids still land on the right section', () => {
  const tabs = setupPanelTabs();
  test.each([
    ['players', 'people'], ['questions', 'up-next'], ['history', 'history'], ['settings', 'run'],
    ['running-order', 'up-next'], ['agenda', 'up-next'], ['rounds', 'up-next'], ['joining', 'joining'],
    ['screens', 'screens'], ['phone', 'screens'], ['remote', 'screens'], ['end', 'up-next'],
  ])('%s → %s', (asked, lands) => {
    expect(sessionMenuSection(asked, tabs)).toBe(lands);
    expect(LEGACY_SECTIONS[asked] || asked).toBeDefined();
  });

  test('a survey reads Up next as Close survey and Rounds so far as Results', () => {
    const survey = setupPanelTabs({ survey: true });
    expect(sessionMenuSection('questions', survey)).toBe('close');
    expect(sessionMenuSection('history', survey)).toBe('results');
    expect(sessionMenuSection('', survey, { ended: true })).toBe('results');
  });

  test('remote and phone open Screens with the phone\'s QR showing', () => {
    render(<SessionSetupPanel initialTab="remote" remoteUrl="https://x/remote?gameId=1" />);
    expect(screen.getByRole('tab', { name: 'Screens' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('phone-qr')).toBeInTheDocument();
  });

  test('a rendered landing: settings opens How it runs, nonsense opens Up next', () => {
    const { unmount } = render(<SessionSetupPanel initialTab="settings" />);
    expect(screen.getByRole('tab', { name: 'How it runs' })).toHaveAttribute('aria-selected', 'true');
    unmount();
    render(<SessionSetupPanel initialTab="nonsense" />);
    expect(screen.getByRole('tab', { name: 'Up next' })).toHaveAttribute('aria-selected', 'true');
  });

  test('the Build Room and the phone map their old ids too', () => {
    expect(buildMenuSection('players')).toBe('people');
    expect(buildMenuSection('settings')).toBe('claude');
    expect(buildMenuSection('settings', 'room')).toBe('joining');
    expect(buildMenuSection('claude', 'screens')).toBe('screens');
    expect(buildMenuSection('claude', 'report')).toBe('asks');
    expect(remotePanelTab('players')).toBe('people');
    expect(remotePanelTab('questions')).toBe('up-next');
    expect(remotePanelTab('history')).toBe('history');
  });
});

describe('the phone Remote: End session with the laptop\'s confirm (fork F8)', () => {
  test('asked in place with endSessionConfirm\'s words; Keep it running backs out', async () => {
    const onEndSession = jest.fn(() => Promise.resolve({ ended: true }));
    render(<RemoteSessionPanel gameId="1234" initialTab="people" onEndSession={onEndSession} />);
    fireEvent.click(screen.getByTestId('remote-end'));
    const words = endSessionConfirm();
    expect(screen.getByText(words.title)).toBeInTheDocument();
    expect(screen.getByText(words.message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it running' }));
    expect(onEndSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('remote-end'));
    await act(async () => { fireEvent.click(screen.getByTestId('remote-end-confirm')); });
    expect(onEndSession).toHaveBeenCalledTimes(1);
  });

  test('a refusal is said in place', async () => {
    const onEndSession = jest.fn(() => Promise.resolve({ ended: false, error: 'Not allowed' }));
    render(<RemoteSessionPanel gameId="1234" initialTab="people" onEndSession={onEndSession} />);
    fireEvent.click(screen.getByTestId('remote-end'));
    await act(async () => { fireEvent.click(screen.getByTestId('remote-end-confirm')); });
    expect(screen.getByRole('alert')).toHaveTextContent('The session did not end: Not allowed');
  });

  test('no foot without the handler (a survey, an ended session)', () => {
    render(<RemoteSessionPanel gameId="1234" initialTab="people" />);
    expect(screen.queryByTestId('remote-end-foot')).toBeNull();
  });
});
