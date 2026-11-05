/**
 * The session setup panel, rendered directly.
 *
 * Everything below is a real render with real assertions; the only source-text
 * checks in this stream live in `setupPanelCallSite.test.js`, where they belong.
 *
 * CORRECTION, 2026-08-17. This block used to open "GameHostPage cannot be
 * mounted in jsdom, but an extracted panel can". The second half is the useful
 * half; the first was false and is gone. `GameHostPage.test.jsx` mounts the
 * page — one mocked `AuthProvider` was the whole obstacle. Extracting the panel
 * is still right, because a panel takes its props directly and a page has to be
 * driven into every state through five other screens.
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

// Imported AFTER jest.mock above, which jest hoists — the order is required,
// not accidental. (Was an `import/first` disable directive.)
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
/* The Session menu redesign (docs/design/session-menu): the old Rounds tab
   split into Up next (the categories under More options, the browser as the
   Choose from the set step), Rounds so far and How it runs; the phone folded
   into Screens; End session moved to the foot. */
const SECTIONS = ['Up next', 'Rounds so far', 'People', 'Screens', 'Joining', 'How it runs'];
const openMore = (section) => {
  const toggle = screen.getByTestId(`more-${section}-toggle`);
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
};
const openCats = () => { openTab('Up next'); openMore('up-next'); };
const openRemote = () => { openTab('Screens'); fireEvent.click(screen.getByTestId('connect-phone')); };

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
    for (const tab of SECTIONS) {
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
    for (const tab of SECTIONS) {
      openTab(tab);
      expect(container.querySelector('.setup-panel')).not.toBeNull();
    }
  });

  test('no section widens the panel: choosing a question is the picker now', () => {
    // rejects: the old wide Choose step coming back inside the menu. Every
    // pixel of panel is a pixel of projected stage the room loses.
    const { container } = renderPanel({ onChoose: () => {} });
    for (const tab of SECTIONS) {
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

describe('the People section', () => {
  const rowsOf = (container) => [...container.querySelectorAll('li.prow')];
  const cell = (row, slot) => row.querySelector(`.prow-${slot}`).textContent;

  test('lists every player, highest score first, with points', () => {
    // rejects: the review's recommendation to move the roster to the phone.
    // The owner ruled the opposite, and the reason holds: no points exist
    // until RESULTS, and entering RESULTS is what reveals, so a cumulative
    // list cannot attribute an unrevealed answer.
    const { container } = renderPanel();
    openTab('People');
    expect(rowsOf(container).map((r) => cell(r, 'name'))).toEqual(['Grace', 'Alan', 'Ada']);
    expect(rowsOf(container).map((r) => cell(r, 'fact'))).toEqual(['#1 · 9 pts', '#1 · 9 pts', '#3 · 3 pts']);
  });

  test('during ASK each row says whether that player has answered', () => {
    // rejects: dropping the per-round tick, which is the only thing that turns
    // a standings list into an operational one — who are we waiting on.
    const { container } = renderPanel({ gameState: 'ASK#001', playersWhoAnswered: ['Grace'] });
    openTab('People');
    const rows = rowsOf(container);
    expect(cell(rows[0], 'doing')).toBe('answered'); // Grace
    expect(cell(rows[1], 'doing')).toBe('waiting');  // Alan
  });

  test('during VOTE it reads the vote list, not the answer list', () => {
    // rejects: keying both phases off playersWhoAnswered — everyone has
    // answered by the time voting opens, so every tick would read done.
    const { container } = renderPanel({
      gameState: 'VOTE#001', playersWhoAnswered: ['Grace', 'Alan', 'Ada'], playersWhoVoted: ['Ada'],
    });
    openTab('People');
    const rows = rowsOf(container);
    expect(cell(rows.find((r) => cell(r, 'name') === 'Ada'), 'doing')).toBe('voted');
    expect(cell(rows.find((r) => cell(r, 'name') === 'Grace'), 'doing')).toBe('waiting');
  });

  test('with nobody in the room yet it says so rather than rendering nothing', () => {
    renderPanel({ players: [] });
    openTab('People');
    expect(screen.getByText(/nobody has joined/i)).toBeInTheDocument();
  });
});

describe('the Questions tab — categories', () => {
  test('each category shows its live remaining count', () => {
    // rejects: the mockup's static `7 left` badge. The shipped number is
    // computed from the bitmask and the per-category counts, and it moves.
    renderPanel();
    openCats();
    const chips = screen.getAllByTestId('category-toggle');
    expect(chips[0].textContent).toMatch(/Pricing Power/);
    expect(chips[0].textContent).toMatch(/7/);
    expect(chips[1].textContent).toMatch(/9/);
  });

  test('a category at zero is styled exhausted', () => {
    // rejects: dropping the state that stops a host enabling a category which
    // cannot yield a question.
    renderPanel();
    openCats();
    expect(screen.getAllByTestId('category-toggle')[2].className).toMatch(/exhausted/);
    expect(screen.getAllByTestId('category-toggle')[0].className).not.toMatch(/exhausted/);
  });

  test('every toggle is disabled while one is in flight', () => {
    // rejects: dropping isTogglingCategory, which lets a host fire three
    // overlapping writes at the bitmask and get whichever lands last.
    renderPanel({ isTogglingCategory: true });
    openCats();
    for (const chip of screen.getAllByTestId('category-toggle')) {
      expect(chip).toBeDisabled();
    }
  });

  test('toggling raises the row, so the caller need not re-derive the position', () => {
    // rejects: passing an index. The endpoint takes a 1-based position and an
    // off-by-one here toggles the neighbouring category.
    const onToggleCategory = jest.fn();
    renderPanel({ onToggleCategory });
    openCats();
    fireEvent.click(screen.getAllByTestId('category-toggle')[1]);
    expect(onToggleCategory).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Competitive Response', position: 2, enabled: true })
    );
  });

  test('"questions remaining" counts enabled categories only', () => {
    // rejects: summing every row, which prints a total the host cannot reach.
    // Here Packaging is enabled but empty and all three are on: 7 + 9 + 0.
    const { unmount } = renderPanel();
    openCats();
    expect(screen.getByTestId('questions-remaining').textContent).toMatch(/16/);
    unmount();

    renderPanel({
      categoryBitmasks: { ...categoryBitmasks, 'HostMask1-8': '10000000' },
    });
    openCats();
    // Only Pricing Power is on now, so Competitive Response's 9 must drop out.
    expect(screen.getByTestId('questions-remaining').textContent).toMatch(/\b7\b/);
  });
});

describe('the Questions tab — the door to the question picker', () => {
  /* The set's browser is the question picker now (docs/design/question-picker
     D3): Up next keeps a door, not a copy. Every browser behaviour that lived
     here moved to questionPicker.test.jsx with it. */
  test('Choose a question is a door that hands off, and draws no list', () => {
    const onChoose = jest.fn();
    const { container } = renderPanel({ onChoose });
    openTab('Up next');
    const door = screen.getByTestId('up-next-choose');
    expect(door).toHaveTextContent('Choose a question');
    fireEvent.click(door);
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByTestId('browser-row')).toHaveLength(0);
    expect(container.querySelector('.setup-panel')).not.toHaveClass('setup-panel--wide');
  });

  test('no handler, no door (a dead control is the one people reach for first)', () => {
    renderPanel();
    openTab('Up next');
    expect(screen.queryByTestId('up-next-choose')).toBeNull();
  });
});

describe('the Settings tab', () => {
  test('the QR encodes the remote, never the join link', () => {
    // rejects: the mix-up that walks a host's own phone into the player flow.
    renderPanel();
    openRemote();
    expect(screen.getByTestId('qr').getAttribute('data-value'))
      .toMatch(/\/remote\?gameId=/);
  });

  test('the word "join" appears nowhere in the remote section', () => {
    // rejects: filing the remote QR under a Join heading — the shipped bug
    // that sent a latecomer to a login for an account they will never have.
    const { container } = renderPanel();
    openRemote();
    const remote = container.querySelector('.setup-remote');
    expect(remote).toBeTruthy();
    expect(remote.textContent).not.toMatch(/join/i);
  });

  test('the remote url is also plain text, for the same-machine case', () => {
    renderPanel();
    openRemote();
    expect(screen.getByText('https://eng.example.us/remote?gameId=4821')).toBeInTheDocument();
  });

  test('the join link and Invite are both there, and different', () => {
    /*
      rejects: collapsing them. The invite is a whole document — title, type,
      question set, categories, joining instructions — and the join link is a
      url. The mockup only drew the link.

      `onInvite` OPENS A DIALOG now rather than copying straight to the
      clipboard, which is what makes this button and session history's the same
      mechanism. The panel still only says WHICH session; everything else is the
      dialog's.
    */
    const onCopyJoinLink = jest.fn();
    const onInvite = jest.fn();
    renderPanel({ onCopyJoinLink, onInvite });
    openTab('Joining');
    openMore('joining');
    fireEvent.click(screen.getByRole('button', { name: /copy join link/i }));
    fireEvent.click(screen.getByRole('button', { name: /invite/i }));
    expect(onCopyJoinLink).toHaveBeenCalledTimes(1);
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  test('the panel stops answering Escape while a dialog it opened is on top', () => {
    /*
      This panel's keydown is on `document` and hand-rolled, so `Modal`'s
      topmost-by-DOM-containment check cannot see it. Without the bail, one
      Escape inside the invite dialog closes the dialog AND the panel beneath
      it — and `\\` shuts the panel out from under an open dialog.
    */
    const onClose = jest.fn();
    renderPanel({ onClose, suppressKeys: true });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: '\\' });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('and answers it again once the dialog has gone', () => {
    const onClose = jest.fn();
    renderPanel({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('the display profile picker changes the profile', () => {
    const onProfileChange = jest.fn();
    renderPanel({ onProfileChange });
    openTab('Screens');
    openMore('screens');
    // "Display profile" was renamed "Room screen size" in the 16 Oct regroup (Screens group).
    fireEvent.change(screen.getByLabelText('Room screen size'), { target: { value: 'table' } });
    expect(onProfileChange).toHaveBeenCalledWith('table');
  });

  test('the four keyboard lines are printed', () => {
    // rejects: shipping accelerators nothing documents. \\ and Esc in
    // particular are undiscoverable otherwise.
    const { container } = renderPanel();
    openTab('Screens');
    openMore('screens');
    const keys = container.querySelector('.setup-keys');
    expect(keys.textContent).toMatch(/Space/);
    expect(keys.textContent).toMatch(/step back/i);
    expect(keys.textContent).toMatch(/\\/);
    expect(keys.textContent).toMatch(/Esc/);
  });

  test('the session actions are all present and raise their handlers', () => {
    // onViewReports is NOT here: it moved to the Rounds tab, and its own test
    // below asserts both that it is there and that Settings no longer has it.
    const handlers = {
      onShowJoinCode: jest.fn(),
      onSwitchGame: jest.fn(),
      onShowHowToPlay: jest.fn(),
    };
    renderPanel(handlers);
    openTab('Joining');
    fireEvent.click(screen.getByRole('button', { name: /join code/i }));
    /*
      "Back to Menu", not "Switch game". The button leaves the session and shows
      the host menu — it does NOT end the session, which stays live and
      rejoinable through Continue — so the label names the destination and
      claims nothing about the session's fate. ("Exit" was considered and
      rejected for claiming a consequence the button does not have.)
    */
    fireEvent.click(screen.getByRole('button', { name: /^Main menu$/ }));
    // No Sign out in the live menu (session-menu fork F5): Home has it.
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
    openTab('Screens');
    openMore('screens');
    fireEvent.click(screen.getByRole('button', { name: /how this works/i }));
    for (const fn of Object.values(handlers)) expect(fn).toHaveBeenCalledTimes(1);
  });

  /*
    TASK 4, 2026-09-26 BUG SWEEP — "A host can end a trivia, poll, call &
    answer or wavelength session." Before this, the only way out of a live
    session was the pool of questions running dry. The control lives beside
    Back to Menu, in the same Session block, because it is the same kind of
    act — a session-level decision, not a round one.
  */
  describe('End session', () => {
    test('appears for a started non-survey session, and raises onEndSession', () => {
      const onEndSession = jest.fn();
      renderPanel({ gameState: 'ASK#001', gameType: 'trivia', onEndSession });
      fireEvent.click(screen.getByRole('button', { name: /end session/i }));
      expect(onEndSession).toHaveBeenCalledTimes(1);
    });

    test('held for an open survey — its end is its own CLOSED phase\'s control', () => {
      const onEndSession = jest.fn();
      renderPanel({ gameState: 'SURVEY#OPEN', gameType: 'survey', onEndSession });
      expect(screen.getByRole('button', { name: /end session/i })).toBeDisabled();
      expect(onEndSession).not.toHaveBeenCalled();
    });

    // rejects: dev QA 2 Nov — two lobby sessions could not be ended.
    test('there before the session has started too: End session is in every phase', () => {
      const onEndSession = jest.fn();
      renderPanel({ gameState: 'CREATED', gameType: 'trivia', onEndSession });
      expect(screen.getByRole('button', { name: /end session/i }).getAttribute('title')).toMatch(/Nothing has been played yet/);
      fireEvent.click(screen.getByRole('button', { name: /end session/i }));
      expect(onEndSession).toHaveBeenCalledTimes(1);
    });

    test('absent once the session has already ended — the stage has its own way on', () => {
      renderPanel({ gameState: 'ENDED', gameType: 'trivia' });
      expect(screen.queryByRole('button', { name: /end session/i })).toBeNull();
    });
  });

  test('the session report lives on Rounds so far, above the list it summarises', () => {
    /*
      rejects: leaving it under "Display" in Settings, where it shipped —
      filed with the display-profile select and the join links, three items
      from the only list on this screen it describes.

      The owner: *"[move] the report button to the rounds page, at the top. as
      it fits well with that section."* Both halves are asserted: it is on the
      Rounds tab at all, and it comes BEFORE the rounds. Document order, not
      geometry — jsdom models the first and returns zeroes for the second.
    */
    const onViewReports = jest.fn();
    const rounds = [{ number: 1, ordinal: 1, title: 'Round one', answers: [] }];
    const { container } = renderPanel({ onViewReports, rounds });

    openTab('Screens');
    expect(screen.queryByRole('button', { name: /open the report/i })).toBeNull();

    openTab('Rounds so far');
    const report = screen.getByRole('button', { name: /open the report/i });
    fireEvent.click(report);
    expect(onViewReports).toHaveBeenCalledTimes(1);

    const panel = container.querySelector('.setup-history');
    const list = panel.querySelector('.setup-history__list');
    expect(list).toBeTruthy();
    expect(report.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('reporting is in the header `?`, on every tab — not slotted into this one', () => {
    // It was an `issueControl` node dropped into this tab's footer, which is how
    // a host could only report a bug from Settings. It is the help button's menu
    // now, and the help button is in the header whichever tab is open.
    renderPanel({});
    openTab('Screens');
    const help = document.querySelector('.setup-panel__help');
    expect(help).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(help);
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent.trim())).toEqual([
      'Read the guides', 'Report a bug', 'Request a feature', 'Ask for help',
    ]);
  });
});

