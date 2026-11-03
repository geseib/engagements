/**
 * EVERYTHING IN THE INVENTORY STAYS REACHABLE (docs/design/session-menu
 * README §3, "Every control, classified, and where it goes").
 *
 * Each row below is one capability from the README's tables, with the new
 * home it was given: the section (a tab), whether it sits behind that
 * section's More options, and how to find it once there. The walk opens the
 * menu at its default, presses the section's tab, opens More options when the
 * row says so, and asserts the control is on screen. A capability that loses
 * its home fails here by name.
 *
 * Sign out and Admin are the README's two deliberate removals (fork F5: Home
 * has both); the last test pins that they are gone, not lost by accident.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import BuildSessionPanel from '../buildroom/BuildSessionPanel';
import RemoteSessionPanel from '../components/RemoteSessionPanel';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) }));
jest.mock('../utils/questionQueueClient', () => ({
  fetchUpNext: jest.fn(() => Promise.resolve({ ok: true, upNext: [], blocked: [], advisories: [] })),
  postQueueOp: jest.fn(),
}));

beforeEach(() => { try { window.localStorage.clear(); } catch (e) { /* none */ } });

const byTest = (id) => () => screen.queryAllByTestId(id)[0] || null;
const byText = (text) => () => screen.queryAllByText(text)[0] || null;
const byRole = (role, name) => () => screen.queryAllByRole(role, { name })[0] || null;
const byLabel = (text) => () => screen.queryAllByLabelText(text)[0] || null;

/* The full Call & Answer menu, two screens, mid-round: every prop a control needs. */
const caProps = (over = {}) => ({
  gameType: 'call-and-answer',
  gameState: 'ASK#003',
  wsConnected: true,
  players: [{ name: 'Priya', score: 10 }, { name: 'Sam', score: 5, handover: { requested: true, requestedAt: new Date().toISOString() } }],
  removedPlayers: [{ name: 'Jo', score: 2 }],
  categories: [{ name: 'Strategy', questionCount: 4 }, { name: 'Risk', questionCount: 2 }],
  activeCategoryIds: new Set(['Strategy']),
  questions: [{ id: 'c1#001', title: 'Browser question one', category: 'Strategy' }],
  questionQueue: ['c1#001', 'own:a1'],
  ownQuestions: [{ key: 'own:a1', title: 'My own one', status: 'queued' }],
  upNext: [{ questionId: 'c1#009', title: 'An automatic one', source: 'auto' }],
  upNextExcluded: [{ key: 'c1#007', title: 'Put away one' }],
  ownNotice: { text: 'Next round asks your question', undoKey: 'own:a1' },
  onOwnUndo: () => {},
  onWriteQuestion: () => {},
  onEditOwn: () => {},
  onRemoveOwn: () => {},
  goal: { progress: 'Question 3 of 5' },
  gameId: '7924',
  playUrl: 'https://example.test/play?gameId=7924',
  remoteUrl: 'https://example.test/remote?gameId=7924',
  remoteWho: { lead: 'Sign in as ', who: 'you', tail: '.' },
  roomScreen: 'two',
  onRoomScreenChange: () => {},
  presentHref: '/present?gameId=7924',
  scoreboardAvailability: { show: true, enabled: true, reason: '' },
  rounds: [{ number: 1, ordinal: 1, title: 'Round one title', answers: [], aiSummary: { summaryText: 'x' }, own: true }],
  late: { rounds: [{ round: 1, items: [{ id: 'l', reviewed: false, text: 'late' }] }], onShow: () => {}, onMarkReviewed: () => {} },
  workie: { roundNoun: 'question', personas: [], prompts: [], briefed: true, onRedo: () => {} },
  anonymousUntilReveal: true,
  peopleColumn: true,
  onRefuseHandover: () => {},
  onLockHandover: () => {},
  ...over,
});

/**
 * One row per README §3 capability: [capability, section tab, behind More?,
 * finder, optional extra step before finding].
 */
const CA_INVENTORY = [
  ['Header: Connected', null, false, byText(/Connected/)],
  ['Header: help ?', null, false, byRole('button', /Help and feedback/)],
  ['Header: close ✕', null, false, byRole('button', /Close the Session menu|Close session menu|Close/)],
  ['Where the room watches (one / two)', 'Screens', false, byText('Where the room watches')],
  ['Room\'s window state and Open', 'Screens', false, byText('Room\'s window')],
  ['Room screen size', 'Screens', true, byText(/Room screen size|Screen size/)],
  ['Show / hide scoreboard', 'Screens', false, byTest('scoreboard-toggle')],
  ['Scoreboard style', 'Screens', true, byText('Scoreboard style')],
  ['Show how this works on the room\'s screen', 'Screens', true, byText(/Show how this works on the room/)],
  ['Keyboard shortcuts', 'Screens', true, byText(/open and close this menu/)],
  ['Phone QR, URL, who may sign in', 'Screens', false, byTest('phone-qr'), () => fireEvent.click(screen.getByTestId('connect-phone'))],
  ['"Changes wait for the next round" note', 'How it runs', false, () => document.querySelector('.setup-scope-note')],
  ['Write a question', 'Up next', false, byTest('queue-write')],
  ['Own-question status line with Undo', 'Up next', false, byTest('own-undo')],
  ['Categories: summary line', 'Up next', false, byTest('categories-summary')],
  ['Categories: switches', 'Up next', true, byTest('category-toggle')],
  ['Goal progress', 'Up next', true, byTest('goal-progress')],
  ['Running order', 'Up next', false, byText('Running order')],
  ['Row: ↑ ↓', 'Up next', false, byRole('button', /^Move .* earlier$/)],
  ['Row ⋯: Ask next', 'Up next', false, byTest('queue-row-menu-ask-next'), () => fireEvent.click(screen.getAllByTestId('queue-row-menu')[0])],
  ['Row ⋯: Ask now', 'Up next', false, byTest('queue-row-menu-ask-now'), () => fireEvent.click(screen.getAllByTestId('queue-row-menu')[0])],
  ['Row ⋯: Put aside for this session', 'Up next', false, byTest('queue-row-menu-put-aside'), () => fireEvent.click(screen.getAllByTestId('queue-row-menu')[0])],
  ['Row ⋯: Remove (out of the queue)', 'Up next', false, byTest('queue-row-menu-remove'), () => fireEvent.click(screen.getAllByTestId('queue-row-menu')[0])],
  ['Yours row ⋯: Edit', 'Up next', false, byTest('queue-own-menu-edit'), () => fireEvent.click(screen.getByTestId('queue-own-menu'))],
  ['Yours row ⋯: Remove', 'Up next', false, byTest('queue-own-menu-remove'), () => fireEvent.click(screen.getByTestId('queue-own-menu'))],
  ['Put-aside list with Restore', 'Up next', true, byRole('button', /Restore Put away one/)],
  ['Parked / advisory / Auto tags', 'Up next', false, byText('Auto')],
  ['Browser: search', 'Up next', false, byLabel('Search titles'), () => fireEvent.click(screen.getByTestId('up-next-choose'))],
  ['Browser: one Category select (incl. categories that are on)', 'Up next', false, byText('Categories that are on'), () => fireEvent.click(screen.getByTestId('up-next-choose'))],
  ['Browser: Hide asked, with the count', 'Up next', false, byTest('hide-asked'), () => fireEvent.click(screen.getByTestId('up-next-choose'))],
  ['Browser: correct answers line', 'Up next', false, byText('Correct answers are not on this screen.'), () => fireEvent.click(screen.getByTestId('up-next-choose'))],
  ['Browser row: Queue / Unqueue', 'Up next', false, byText(/^(Queue|Unqueue)$/), () => fireEvent.click(screen.getByTestId('up-next-choose'))],
  ['Browser row: Ask next', 'Up next', false, () => within(screen.getAllByTestId('browser-row')[0]).queryByText('Ask next'), () => fireEvent.click(screen.getByTestId('up-next-choose'))],
  ['Browser row ⋯: Ask now', 'Up next', false, byTest('browser-row-menu-ask-now'), () => { fireEvent.click(screen.getByTestId('up-next-choose')); fireEvent.click(screen.getAllByTestId('browser-row-menu')[0]); }],
  ['Browser: back to Up next', 'Up next', false, byTest('choose-back'), () => fireEvent.click(screen.getByTestId('up-next-choose'))],
  ['Session report', 'Rounds so far', false, byTest('open-report')],
  ['Late list: count, help, Review', 'Rounds so far', false, byTest('late-review')],
  ['Late list itself', 'Rounds so far', false, byTest('late-line'), () => fireEvent.click(screen.getByTestId('late-review'))],
  ['Rounds played (open a round), AI badge, Yours', 'Rounds so far', false, byText('Round one title')],
  ['Include items not reviewed in the report', 'Rounds so far', true, byTest('include-not-reviewed')],
  ['Names: show who wrote each response', 'How it runs', false, byTest('attribute-authors')],
  ['Name who is still waiting', 'How it runs', true, byTest('name-waiting')],
  ['Comments on the wall', 'How it runs', true, byTest('wall-comments')],
  ['Workie: voice, approach, briefing', 'How it runs', true, byTest('workie-briefed')],
  ['Workie: Redo the read (menu copy, fork F4)', 'How it runs', true, byTest('workie-redo')],
  ['Pace: auto-advance', 'How it runs', false, byTest('auto-mode')],
  ['Join URL and session code', 'Joining', false, byText('Session code 7924')],
  ['Copy join link', 'Joining', false, byText('Copy join link')],
  ['Show join code', 'Joining', false, byText('Show join code')],
  ['Invite… calendar blob', 'Joining', true, byText('Invite…')],
  ['People list with scores', 'People', false, byText('Priya')],
  ['Name request: Let them', 'People', false, byRole('button', /Let them: Sam/)],
  ['Name request: Not now', 'People', false, byRole('button', /Not now: Sam/)],
  ['Person ⋯: Move to a new device', 'People', false, byRole('menuitem', 'Move to a new device'), () => fireEvent.click(screen.getByRole('button', { name: 'More for Priya' }))],
  ['Person ⋯: Remove from session', 'People', false, byRole('menuitem', 'Remove from session'), () => fireEvent.click(screen.getByRole('button', { name: 'More for Priya' }))],
  ['Who left: Bring back', 'People', false, byRole('menuitem', 'Bring back'), () => fireEvent.click(screen.getByRole('button', { name: 'More for Jo' }))],
  ['End session (foot)', 'Joining', false, byTest('session-menu-end')],
  ['Main menu (foot), with the keeps-running hint', 'People', false, byTest('session-menu-main')],
];

async function walk(props, [, section, more, find, step]) {
  render(<SessionSetupPanel {...props} />);
  if (section) fireEvent.click(screen.getByRole('tab', { name: section }));
  if (more) {
    const toggle = document.querySelector('[data-testid$="-toggle"][aria-controls^="smenu-more-"]');
    expect(toggle).not.toBeNull();
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  }
  if (step) step();
  return find();
}

describe('Call & Answer, two screens: every control in the README inventory', () => {
  test.each(CA_INVENTORY.map((row) => [row[0], row]))('%s', async (_, row) => {
    const props = caProps(row[0].startsWith('"Changes wait') ? { settingsRoundLive: true } : {});
    if (row[0] === 'Workie: Redo the read (menu copy, fork F4)') props.gameState = 'RESULTS#003';
    const el = await walk(props, row);
    expect(el).not.toBeNull();
  });

  test('"Changes wait for the next round" leads How it runs while a round is live', () => {
    render(<SessionSetupPanel {...caProps({ settingsRoundLive: true })} initialTab="run" />);
    expect(document.querySelector('.setup-scope-note')).not.toBeNull();
  });

  test('Main menu\'s tooltip carries "Leave without ending"\'s explanation', () => {
    render(<SessionSetupPanel {...caProps()} />);
    expect(screen.getByTestId('session-menu-main').getAttribute('title')).toMatch(/session/i);
  });
});

describe('the other types, by difference', () => {
  test('C&A event item: ‹ Agenda and Bring everyone here on the event line', () => {
    render(<SessionSetupPanel {...caProps({ event: { onAgenda: () => {}, onBringHere: () => {}, n: 2, total: 3 } })} />);
    expect(screen.getByRole('button', { name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByTestId('session-menu-bring')).toBeInTheDocument();
  });

  test('C&A one screen: private reveals for the order, late, Workie, people; Connect your phone first in Screens', () => {
    render(<SessionSetupPanel {...caProps({ oneScreen: true, roomScreen: 'classic' })} />);
    expect(screen.getByTestId('private-questions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    expect(screen.getByTestId('private-people')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Screens' }));
    const phone = screen.getByTestId('screens-phone');
    const screensGroup = screen.getByText('Where the room watches');
    expect(phone.compareDocumentPosition(screensGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('Trivia: no Names, no Write a question; Pace stays', () => {
    render(<SessionSetupPanel {...caProps({ gameType: 'trivia', onWriteQuestion: null })} />);
    expect(screen.queryByTestId('queue-write')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'How it runs' }));
    expect(screen.queryByTestId('attribute-authors')).toBeNull();
    expect(screen.getByTestId('auto-mode')).toBeInTheDocument();
  });

  test('Poll: no scoreboard', () => {
    render(<SessionSetupPanel {...caProps({ gameType: 'poll', scoreboardAvailability: { show: false } })} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Screens' }));
    expect(screen.queryByTestId('scoreboard-toggle')).toBeNull();
  });

  test('Wavelength: Screens says why it is one screen, with no chooser', () => {
    render(<SessionSetupPanel {...caProps({ gameType: 'wavelength', oneScreen: true })} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Screens' }));
    expect(document.querySelector('[data-row="where-fixed"]')).not.toBeNull();
  });

  test('Survey: Close survey with the warning, Survey results with the report card, After it closes in How it runs, End held', () => {
    const onAct = jest.fn();
    const close = { label: 'Close the survey' };
    const warn = { label: 'Two-minute warning' };
    render(<SessionSetupPanel {...caProps({ gameType: 'survey', gameState: 'SURVEY#OPEN', surveyActs: { close, warn, end: null, closed: false, onAct } })} />);
    fireEvent.click(screen.getByTestId('session-menu-close-survey'));
    expect(onAct).toHaveBeenCalledWith(close);
    expect(screen.getByText('Two-minute warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Survey results' }));
    expect(screen.getByTestId('session-report')).toHaveTextContent('ready once the survey closes');
    fireEvent.click(screen.getByRole('tab', { name: 'How it runs' }));
    expect(screen.getByText('After it closes')).toBeInTheDocument();
    expect(screen.getByTestId('session-menu-end')).toBeDisabled();
  });
});

/* ---------------------------------------------------------- Build Room -- */

const room = {
  gameId: '5531', playerCount: 2, wallKey: 'k', crew: null, ideas: [], settings: {}, plugin: { running: '1.4.0', latest: '1.4.0' },
  wall: { profile: 'room' }, lan: {}, opening: { phase: 'building' },
};
const roster = { players: [{ playerName: 'Priya', isConnected: true }, { playerName: 'Sam', isConnected: false, handover: { requested: true } }], removed: [{ playerName: 'Jo' }] };

function BuildHarness({ start = 'claude', handlers = {} }) {
  const [tab, setTab] = React.useState(start);
  const api = new Proxy({}, { get: () => async () => ({}) });
  return (
    <div className="brm">
      <BuildSessionPanel
        room={room} now={Date.now()} ended={false} busy={false} run={(fn) => fn()} api={api}
        roster={roster} reloadPlayers={() => {}} tab={tab} onTab={setTab} onClose={() => {}}
        slots={{ agentChip: <span>Claude chip</span>, autoSwitch: <span>Auto switch</span> }}
        continueSlot={<span>Continue prompt</span>}
        onConnect={() => {}} onUpdatePlugin={() => {}} onCrew={() => {}} onWrap={() => {}} onReport={() => {}}
        onEnd={handlers.onEnd || (() => {})} onShowCodes={() => {}} onLook={() => {}}
        listNames={false} onListNames={() => {}}
      />
    </div>
  );
}

const BUILD_INVENTORY = [
  ['Claude chip, Connect Claude Code, continue slot', 'Claude', false, byText('Connect Claude Code')],
  ['Auto switch', 'Claude', false, byText('Auto switch')],
  ['Posts release gate', 'Claude', false, () => document.querySelector('[data-capability="release-posts"]')],
  ['Plugin version', 'Claude', true, byTest('brm-plugin-ver')],
  ['Crew: Open to a crew', 'Claude', true, byText('Open to a crew')],
  ['Back to the opening', 'Claude', true, byText('Back to the opening')],
  ['Report', 'Asks so far', false, byText('Report')],
  ['Wrap up', 'Asks so far', false, byText('Wrap up')],
  ['History (from Asks so far)', 'Asks so far', false, () => document.querySelector('[data-capability="history"]')],
  ['People: the person rows, with Let them / Not now', 'People', false, byRole('button', /Let them: Sam/)],
  ['People: who left, Bring back', 'People', false, byRole('menuitem', 'Bring back'), () => fireEvent.click(screen.getByRole('button', { name: 'More for Jo' }))],
  ['Screens: choice and room\'s window', 'Screens', false, () => document.querySelector('[data-capability="screens"]')],
  ['Screens: size', 'Screens', true, () => document.getElementById('brm-wall-size')],
  ['Screens: New link', 'Screens', true, byText(/New link|new link/i)],
  ['Screens: Look here, privately (Build)', 'Screens', true, () => document.querySelector('[data-capability="build-screen"]')],
  ['Screens: keys line', 'Screens', true, () => document.querySelector('.brm-sp-keys')],
  ['Joining: join tile, copy, show on the Stage', 'Joining', false, byTest('brm-join-tile')],
  ['Joining: List names on the room meter', 'Joining', true, byRole('switch', 'List names on the room meter')],
  ['End session (foot)', 'People', false, byText('End session…')],
  ['Main menu (foot)', 'Screens', false, byText(/Main menu/)],
];

describe('the Build Room: every control in the README inventory', () => {
  test.each(BUILD_INVENTORY.map((row) => [row[0], row]))('%s', (_, [, section, more, find, step]) => {
    render(<BuildHarness />);
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${section}`) }));
    if (more) fireEvent.click(document.querySelector('[aria-controls^="smenu-more-"]'));
    if (step) step();
    expect(find()).not.toBeNull();
  });
});

/* -------------------------------------------------------- phone Remote -- */

describe('the phone Remote: every control in the README inventory', () => {
  const phone = (tab) => render(
    <RemoteSessionPanel
      gameId="7924" setId="s1" initialTab={tab} state="ASK#003" gameType="call-and-answer"
      questionQueue={{ queue: ['c1#001'], version: 1 }}
      roster={{ players: [{ playerName: 'Priya', totalScore: 10 }] }}
      onWriteQuestion={() => {}}
      categoryLine="1 of 2 on · 3 questions left"
      categoryPanel={<p>the switches</p>}
      onEndSession={async () => ({ ended: true })}
    />,
  );

  test('People tab: rank, score', () => { phone('people'); expect(screen.getByText('Priya')).toBeInTheDocument(); });
  test('Up next: running order, Write a question, Choose from the set', () => {
    phone('up-next');
    expect(screen.getByText('Running order')).toBeInTheDocument();
    expect(screen.getByTestId('remote-write')).toBeInTheDocument();
  });
  test('Up next: the Categories line, with Change opening the switches', () => {
    phone('up-next');
    expect(screen.getByTestId('remote-categories')).toHaveTextContent('1 of 2 on · 3 questions left');
    fireEvent.click(screen.getByTestId('remote-categories-change'));
    expect(screen.getByText('the switches')).toBeInTheDocument();
  });
  test('the old Players / Questions ids land on People / Up next', () => {
    const { unmount } = phone('players');
    expect(screen.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true');
    unmount();
    phone('questions');
    expect(screen.getByRole('tab', { name: 'Up next' })).toHaveAttribute('aria-selected', 'true');
  });
  test('End session at the foot of every tab', () => {
    for (const tab of ['up-next', 'history', 'people']) {
      const { unmount } = phone(tab);
      expect(screen.getByTestId('remote-end')).toBeInTheDocument();
      unmount();
    }
  });
});

test('the two deliberate removals (fork F5): no Sign out, no Admin in the live menu', () => {
  render(<SessionSetupPanel {...caProps()} isAdmin onSignOut={() => {}} />);
  for (const t of screen.getAllByRole('tab')) {
    fireEvent.click(t);
    expect(screen.queryByRole('button', { name: /^Sign out$/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Admin/ })).toBeNull();
  }
});
