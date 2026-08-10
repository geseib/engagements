/**
 * The session setup panel, rendered directly.
 *
 * `GameHostPage` cannot be mounted in jsdom, but an extracted panel can —
 * `gameSetupDialog.test.jsx` is the proof. So everything below is a real render
 * with real assertions, and the only source-text checks in this stream live in
 * `setupPanelCallSite.test.js`, where they belong.
 *
 * jsdom has no layout engine. There is not a single geometric assertion here,
 * because every one of them would return zero and pass unconditionally. That
 * the panel clears the dock (audit A6) and does not re-trigger the fitter are
 * browser checks, and they are named as such in the report.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

// Captures what the QR is actually asked to encode. The component renders a
// real QRCodeSVG in the app; nothing about its value is readable from the DOM.
jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

// eslint-disable-next-line import/first
import SessionSetupPanel from '../components/stage/SessionSetupPanel';

const players = [
  { name: 'Ada', score: 3, email: 'ada@example.com' },
  { name: 'Grace', score: 9 },
  { name: 'Alan', score: 9 },
];

const categories = [
  { name: 'Pricing Power' },
  { name: 'Competitive Response' },
  { name: 'Packaging' },
];

const categoryCounts = { '1-8': [7, 9, 0], '9-16': [], '17-24': [] };
const categoryBitmasks = {
  'HostMask1-8': '11100000',
  'HostMask9-16': '00000000',
  'HostMask17-24': '00000000',
};

const questions = [
  {
    id: 'q-1',
    title: 'Which pricing change produced the largest margin gain?',
    category: 'Pricing Power',
    difficulty: 'Hard',
    optionA: 'A 5% list increase',
    optionB: 'Seat-based to usage-based billing',
    correctAnswer: 'Seat-based to usage-based billing',
    answerDetails: 'Because usage tracks value.',
  },
  {
    id: 'q-2',
    title: 'A competitor cuts list price 20%. Your first move?',
    category: 'Competitive Response',
  },
  { id: 'q-3', title: 'Packaging the top tier', category: 'Packaging' },
];

const renderPanel = (props = {}) => render(
  <>
    <button type="button" className="dock-more">SETUP</button>
    <SessionSetupPanel
      onClose={() => {}}
      wsConnected
      players={players}
      gameState="LOBBY"
      categories={categories}
      categoryCounts={categoryCounts}
      categoryBitmasks={categoryBitmasks}
      questions={questions}
      gameId="4821"
      playUrl="https://eng.example.us/play?gameId=4821"
      remoteUrl="https://eng.example.us/remote?gameId=4821"
      profile="room"
      {...props}
    />
  </>
);

const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

describe('the panel as a surface', () => {
  test('its root carries the class the SPACE guard keys off', () => {
    // rejects: renaming the class. HostActionBar ignores SPACE whose target is
    // inside `.setup-panel`; rename it here and the guard silently stops
    // working, with every other test in this file still green — a host tabs to
    // `Ask next`, presses Space, and the round advances instead.
    const { container } = renderPanel();
    expect(container.querySelector('.setup-panel')).toBeTruthy();
  });

  test('the word "Console" appears nowhere on screen', () => {
    // rejects: reintroducing the proper noun user testing deliberately killed.
    const { container } = renderPanel();
    expect(container.textContent.toLowerCase()).not.toContain('console');
  });

  test('connection status is in the header, not behind a tab', () => {
    // rejects: filing it under Settings. It is the first thing a host looks at
    // when the room stops updating, and it is the only WS status on the page.
    const { container } = renderPanel({ wsConnected: false });
    const header = container.querySelector('.setup-panel__header');
    expect(within(header).getByText(/connecting/i)).toBeInTheDocument();

    const { container: c2 } = renderPanel({ wsConnected: true });
    expect(within(c2.querySelector('.setup-panel__header')).getByText(/connected/i))
      .toBeInTheDocument();
  });

  test('it never prints an email address', () => {
    // rejects: the two identity blocks the old panels carried, which rendered
    // the signed-in name, email and Administrator badge twice over. The room
    // can watch this panel.
    const { container } = renderPanel({ currentUser: { attributes: { email: 'host@example.com' } } });
    for (const tab of ['Players', 'Questions', 'Settings']) {
      openTab(tab);
      expect(container.textContent).not.toContain('@example.com');
    }
  });

  test('.setup-panel resolves on every tab, including the wide one', () => {
    // THE SPACE GUARD DEPENDS ON THIS SELECTOR. HostActionBar ignores a
    // spacebar whose `event.target.closest('.setup-panel')` matches — so if
    // the Questions tab's width modifier ever REPLACED the base class instead
    // of joining it, the guard would silently fail open on the one tab with a
    // search box and an Ask-next button on it, and pressing Space there would
    // advance the round.
    //
    // rejects: `className={tab === 'questions' ? 'setup-panel--wide' : 'setup-panel'}`,
    // which looks equivalent and is not. setupPanelCallSite.test.js asserts the
    // source; this asserts the rendered element is really reachable.
    const { container } = renderPanel();
    for (const tab of ['Players', 'Questions', 'Settings']) {
      openTab(tab);
      expect(container.querySelector('.setup-panel')).not.toBeNull();
    }
  });

  test('only the Questions tab widens the panel', () => {
    // rejects: widening unconditionally. Every pixel of panel is a pixel of
    // projected stage the room loses, and Players and Settings are short rows
    // that would just sit in an empty column.
    const { container } = renderPanel();

    openTab('Questions');
    expect(container.querySelector('.setup-panel')).toHaveClass('setup-panel--wide');

    for (const tab of ['Players', 'Settings']) {
      openTab(tab);
      expect(container.querySelector('.setup-panel')).not.toHaveClass('setup-panel--wide');
    }
  });
});

describe('closing', () => {
  test('the ✕ closes it', () => {
    const onClose = jest.fn();
    renderPanel({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  test('Escape closes it', () => {
    const onClose = jest.fn();
    renderPanel({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  test('backslash closes it — the same key that opens it', () => {
    // rejects: an open-only accelerator, which leaves the host reaching for
    // the mouse to undo a keystroke.
    const onClose = jest.fn();
    renderPanel({ onClose });
    fireEvent.keyDown(document, { key: '\\' });
    expect(onClose).toHaveBeenCalled();
  });

  test('a click on the scrim closes it', () => {
    const onClose = jest.fn();
    const { container } = renderPanel({ onClose });
    fireEvent.click(container.querySelector('.setup-panel-scrim'));
    expect(onClose).toHaveBeenCalled();
  });

  test('focus returns to the control that opened it', () => {
    // rejects: unmounting without restoring focus, which drops the keyboard
    // host at the top of the document mid-session. activeElement is real in
    // jsdom, so this is an honest assertion.
    const setup = document.createElement('button');
    setup.className = 'dock-more';
    setup.textContent = 'SETUP';
    document.body.appendChild(setup);
    setup.focus();
    expect(document.activeElement).toBe(setup);

    const { unmount } = render(
      <SessionSetupPanel onClose={() => {}} players={[]} categories={[]} questions={[]} />
    );
    unmount();
    expect(document.activeElement).toBe(setup);
    setup.remove();
  });

  test('focus is trapped while it is open', () => {
    // rejects: letting Tab walk out of the panel and onto the dock's primary
    // action, where the next Space or Enter advances a live round.
    const { container } = renderPanel();
    const panel = container.querySelector('.setup-panel');
    const focusables = panel.querySelectorAll('button, input, select, [tabindex="0"]');
    const firstEl = focusables[0];
    const lastEl = focusables[focusables.length - 1];

    // ASSERTED AS A MOVE, NOT AS CONTAINMENT. jsdom implements no default Tab
    // behaviour, so "focus is still inside the panel" is true whether or not
    // the trap exists — deleting the handler left that version of this test
    // green. Only the wrap-around is evidence the handler ran.
    lastEl.focus();
    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(document.activeElement).toBe(firstEl);

    firstEl.focus();
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastEl);
  });
});

describe('the Players tab', () => {
  test('lists every player, highest score first, with points', () => {
    // rejects: the review's recommendation to move the roster to the phone.
    // The owner ruled the opposite, and the reason holds: no points exist
    // until RESULTS, and entering RESULTS is what reveals, so a cumulative
    // list cannot attribute an unrevealed answer.
    renderPanel();
    openTab('Players');
    const names = screen.getAllByTestId('roster-name').map((n) => n.textContent);
    expect(names).toEqual(['Grace', 'Alan', 'Ada']);
    expect(screen.getAllByTestId('roster-score').map((s) => s.textContent))
      .toEqual(['9 pts', '9 pts', '3 pts']);
  });

  test('during ASK each row says whether that player has answered', () => {
    // rejects: dropping the per-round tick, which is the only thing that turns
    // a standings list into an operational one — who are we waiting on.
    renderPanel({ gameState: 'ASK#001', playersWhoAnswered: ['Grace'] });
    openTab('Players');
    const rows = screen.getAllByTestId('roster-row');
    expect(rows[0]).toHaveAttribute('data-done', 'true');   // Grace
    expect(rows[1]).toHaveAttribute('data-done', 'false');  // Alan
  });

  test('during VOTE it reads the vote list, not the answer list', () => {
    // rejects: keying both phases off playersWhoAnswered — everyone has
    // answered by the time voting opens, so every tick would read done.
    renderPanel({
      gameState: 'VOTE#001', playersWhoAnswered: ['Grace', 'Alan', 'Ada'], playersWhoVoted: ['Ada'],
    });
    openTab('Players');
    const rows = screen.getAllByTestId('roster-row');
    expect(rows.find((r) => within(r).queryByText('Ada'))).toHaveAttribute('data-done', 'true');
    expect(rows.find((r) => within(r).queryByText('Grace'))).toHaveAttribute('data-done', 'false');
  });

  test('with nobody in the room yet it says so rather than rendering nothing', () => {
    renderPanel({ players: [] });
    openTab('Players');
    expect(screen.getByText(/nobody has joined/i)).toBeInTheDocument();
  });
});

describe('the Questions tab — categories', () => {
  test('each category shows its live remaining count', () => {
    // rejects: the mockup's static `7 left` badge. The shipped number is
    // computed from the bitmask and the per-category counts, and it moves.
    renderPanel();
    openTab('Questions');
    const chips = screen.getAllByTestId('category-toggle');
    expect(chips[0].textContent).toMatch(/Pricing Power/);
    expect(chips[0].textContent).toMatch(/7/);
    expect(chips[1].textContent).toMatch(/9/);
  });

  test('a category at zero is styled exhausted', () => {
    // rejects: dropping the state that stops a host enabling a category which
    // cannot yield a question.
    renderPanel();
    openTab('Questions');
    expect(screen.getAllByTestId('category-toggle')[2].className).toMatch(/exhausted/);
    expect(screen.getAllByTestId('category-toggle')[0].className).not.toMatch(/exhausted/);
  });

  test('every toggle is disabled while one is in flight', () => {
    // rejects: dropping isTogglingCategory, which lets a host fire three
    // overlapping writes at the bitmask and get whichever lands last.
    renderPanel({ isTogglingCategory: true });
    openTab('Questions');
    for (const chip of screen.getAllByTestId('category-toggle')) {
      expect(chip).toBeDisabled();
    }
  });

  test('toggling raises the row, so the caller need not re-derive the position', () => {
    // rejects: passing an index. The endpoint takes a 1-based position and an
    // off-by-one here toggles the neighbouring category.
    const onToggleCategory = jest.fn();
    renderPanel({ onToggleCategory });
    openTab('Questions');
    fireEvent.click(screen.getAllByTestId('category-toggle')[1]);
    expect(onToggleCategory).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Competitive Response', position: 2, enabled: true })
    );
  });

  test('"questions remaining" counts enabled categories only', () => {
    // rejects: summing every row, which prints a total the host cannot reach.
    // Here Packaging is enabled but empty and all three are on: 7 + 9 + 0.
    const { unmount } = renderPanel();
    openTab('Questions');
    expect(screen.getByTestId('questions-remaining').textContent).toMatch(/16/);
    unmount();

    renderPanel({
      categoryBitmasks: { ...categoryBitmasks, 'HostMask1-8': '10000000' },
    });
    openTab('Questions');
    // Only Pricing Power is on now, so Competitive Response's 9 must drop out.
    expect(screen.getByTestId('questions-remaining').textContent).toMatch(/\b7\b/);
  });
});

describe('the Questions tab — the browser', () => {
  test('the whole set is listed, not one category', () => {
    // rejects: the shipped design's worst structural decision — the only way
    // in was a per-category magnifier that scoped the fetch to one category,
    // so a host could never see the whole set at once.
    renderPanel();
    openTab('Questions');
    expect(screen.getAllByTestId('browser-row')).toHaveLength(3);
  });

  test('no correct answer, and no option text, reaches the screen', () => {
    // rejects: rendering the mockup's option block. The fixture records its
    // answer as the option's own TEXT — the variant that makes a row carrying
    // the options carry the answer — and every display profile shares this
    // surface with the room.
    const { container } = renderPanel();
    openTab('Questions');
    expect(container.textContent).not.toContain('Seat-based to usage-based billing');
    expect(container.textContent).not.toContain('A 5% list increase');
    expect(container.textContent).not.toContain('Because usage tracks value.');
    // rejects: the shipped browser's `correct-answer` row, which printed
    // "Correct: OptionB" under the options on a surface the room can see.
    expect(container.querySelector('.correct-answer')).toBeNull();
    expect(container.textContent).not.toMatch(/Correct:/);
  });

  test('it still says what a host needs to choose by', () => {
    renderPanel();
    openTab('Questions');
    const row = screen.getAllByTestId('browser-row')[0];
    expect(row.textContent).toMatch(/Which pricing change/);
    expect(row.textContent).toMatch(/Pricing Power/);
    expect(row.textContent).toMatch(/Hard/);
    expect(row.textContent).toMatch(/Multiple choice/);
    expect(screen.getAllByTestId('browser-row')[1].textContent).toMatch(/Free-text response/);
  });

  test('search narrows the list and the count says so', () => {
    // rejects: shipping the search box without the count. "Showing 1 of 3" is
    // what tells a host the list is filtered rather than short.
    renderPanel();
    openTab('Questions');
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'packaging' } });
    expect(screen.getAllByTestId('browser-row')).toHaveLength(1);
    expect(screen.getByTestId('browser-count').textContent).toMatch(/1 of 3/);
  });

  test('a category chip filters the list without disabling the category', () => {
    // rejects: reusing the on/off toggle as the filter. Narrowing what you are
    // reading and removing a category from the game are different acts, and
    // conflating them takes a pool away from a host who only wanted to look.
    const onToggleCategory = jest.fn();
    renderPanel({ onToggleCategory });
    openTab('Questions');
    fireEvent.click(screen.getByRole('button', { name: 'Competitive Response' }));
    expect(screen.getAllByTestId('browser-row')).toHaveLength(1);
    expect(onToggleCategory).not.toHaveBeenCalled();
  });

  test('used questions stay in the list, dimmed, and offer Ask again', () => {
    // rejects: hiding them. "Did I already use this?" is the question a host
    // asks most, and hiding the row hides the answer to it.
    renderPanel({ usedQuestionIds: ['q-2'] });
    openTab('Questions');
    const rows = screen.getAllByTestId('browser-row');
    expect(rows).toHaveLength(3);
    expect(rows[1].className).toMatch(/is-used/);
    expect(within(rows[1]).getByRole('button', { name: /ask again/i })).toBeInTheDocument();
    expect(within(rows[0]).getByRole('button', { name: /ask next/i })).toBeInTheDocument();
  });

  test('"Unasked only" hides them, on request', () => {
    renderPanel({ usedQuestionIds: ['q-2'] });
    openTab('Questions');
    fireEvent.click(screen.getByRole('button', { name: /unasked only/i }));
    expect(screen.getAllByTestId('browser-row')).toHaveLength(2);
  });

  test('choosing a question raises the original, not the projection', () => {
    // rejects: handing back `browserRow`'s output, which has no `id` the
    // next-question endpoint would accept and none of the fields the round
    // needs.
    const onSelectQuestion = jest.fn();
    renderPanel({ onSelectQuestion });
    openTab('Questions');
    fireEvent.click(within(screen.getAllByTestId('browser-row')[0]).getByRole('button', { name: /ask next/i }));
    expect(onSelectQuestion).toHaveBeenCalledWith(questions[0]);
  });

  test('while questions are loading it says so', () => {
    // rejects: dropping the spinner the shipped modal had. Fetching is remote.
    renderPanel({ questions: [], loadingQuestions: true });
    openTab('Questions');
    expect(screen.getByText(/loading questions/i)).toBeInTheDocument();
  });

  test('an empty set gets an empty state, not a blank panel', () => {
    renderPanel({ questions: [], loadingQuestions: false });
    openTab('Questions');
    expect(screen.getByText(/no questions/i)).toBeInTheDocument();
  });
});

describe('the Settings tab', () => {
  test('the QR encodes the remote, never the join link', () => {
    // rejects: the mix-up that walks a host's own phone into the player flow.
    renderPanel();
    openTab('Settings');
    expect(screen.getByTestId('qr').getAttribute('data-value'))
      .toMatch(/\/remote\?gameId=/);
  });

  test('the word "join" appears nowhere in the remote section', () => {
    // rejects: filing the remote QR under a Join heading — the shipped bug
    // that sent a latecomer to a login for an account they will never have.
    const { container } = renderPanel();
    openTab('Settings');
    const remote = container.querySelector('.setup-remote');
    expect(remote).toBeTruthy();
    expect(remote.textContent).not.toMatch(/join/i);
  });

  test('the remote url is also plain text, for the same-machine case', () => {
    renderPanel();
    openTab('Settings');
    expect(screen.getByText('https://eng.example.us/remote?gameId=4821')).toBeInTheDocument();
  });

  test('the join link and Copy Invite are both there, and different', () => {
    // rejects: collapsing them. Copy Invite is a calendar blob; the join link
    // is a url. The mockup only drew the link.
    const onCopyJoinLink = jest.fn();
    const onCopyInvite = jest.fn();
    renderPanel({ onCopyJoinLink, onCopyInvite });
    openTab('Settings');
    fireEvent.click(screen.getByRole('button', { name: /copy join link/i }));
    fireEvent.click(screen.getByRole('button', { name: /copy invite/i }));
    expect(onCopyJoinLink).toHaveBeenCalledTimes(1);
    expect(onCopyInvite).toHaveBeenCalledTimes(1);
  });

  test('the display profile picker changes the profile', () => {
    const onProfileChange = jest.fn();
    renderPanel({ onProfileChange });
    openTab('Settings');
    fireEvent.change(screen.getByLabelText(/display/i), { target: { value: 'table' } });
    expect(onProfileChange).toHaveBeenCalledWith('table');
  });

  test('the four keyboard lines are printed', () => {
    // rejects: shipping accelerators nothing documents. \\ and Esc in
    // particular are undiscoverable otherwise.
    const { container } = renderPanel();
    openTab('Settings');
    const keys = container.querySelector('.setup-keys');
    expect(keys.textContent).toMatch(/Space/);
    expect(keys.textContent).toMatch(/step back/i);
    expect(keys.textContent).toMatch(/\\/);
    expect(keys.textContent).toMatch(/Esc/);
  });

  test('the session actions are all present and raise their handlers', () => {
    const handlers = {
      onShowJoinCode: jest.fn(),
      onViewReports: jest.fn(),
      onSwitchGame: jest.fn(),
      onSignOut: jest.fn(),
      onShowHowToPlay: jest.fn(),
    };
    renderPanel(handlers);
    openTab('Settings');
    fireEvent.click(screen.getByRole('button', { name: /join code/i }));
    fireEvent.click(screen.getByRole('button', { name: /session report/i }));
    fireEvent.click(screen.getByRole('button', { name: /switch game/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    fireEvent.click(screen.getByRole('button', { name: /how this works/i }));
    for (const fn of Object.values(handlers)) expect(fn).toHaveBeenCalledTimes(1);
  });

  test('report-a-problem is rendered where the caller puts it', () => {
    // The IssueFab pulls the auth'd API client in; the panel takes it as a
    // node so the panel itself stays renderable.
    renderPanel({ issueControl: <span>Report a problem</span> });
    openTab('Settings');
    expect(screen.getByText('Report a problem')).toBeInTheDocument();
  });
});
