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
    openTab('Settings');
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
    // onViewReports is NOT here: it moved to the Rounds tab, and its own test
    // below asserts both that it is there and that Settings no longer has it.
    const handlers = {
      onShowJoinCode: jest.fn(),
      onSwitchGame: jest.fn(),
      onSignOut: jest.fn(),
      onShowHowToPlay: jest.fn(),
    };
    renderPanel(handlers);
    openTab('Settings');
    fireEvent.click(screen.getByRole('button', { name: /join code/i }));
    fireEvent.click(screen.getByRole('button', { name: /switch game/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    fireEvent.click(screen.getByRole('button', { name: /how this works/i }));
    for (const fn of Object.values(handlers)) expect(fn).toHaveBeenCalledTimes(1);
  });

  test('the session report lives on Rounds, above the list it summarises', () => {
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
    const { container } = renderPanel({ onViewReports });

    openTab('Settings');
    expect(screen.queryByRole('button', { name: /session report/i })).toBeNull();

    openTab('Rounds');
    const report = screen.getByRole('button', { name: /session report/i });
    fireEvent.click(report);
    expect(onViewReports).toHaveBeenCalledTimes(1);

    const panel = container.querySelector('.setup-history');
    const list = panel.querySelector('.setup-history__list, .setup-empty');
    expect(list).toBeTruthy();
    expect(report.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('report-a-problem is rendered where the caller puts it', () => {
    // The IssueFab pulls the auth'd API client in; the panel takes it as a
    // node so the panel itself stays renderable.
    renderPanel({ issueControl: <span>Report a problem</span> });
    openTab('Settings');
    expect(screen.getByText('Report a problem')).toBeInTheDocument();
  });
});

/**
 * THE TWO NAME DECISIONS THE OWNER MOVED OUT OF THE CODE.
 *
 * Both were rules the implementation applied by itself: author reveal was a
 * per-round button plus a per-round display toggle, and the waiting list was
 * withheld below five responses with no override at all. Both are now one
 * session-level setting each, in this tab, and the reasoning that used to be a
 * condition ships as copy beside them.
 *
 * The panel is presentational — the state and the setters are GameHostPage's —
 * so what is asserted here is what a host sees and what the control emits.
 * roomMeterWaiting.test.jsx holds the other end of the wire.
 */
describe('the Settings tab is where the names decisions are made', () => {
  const openNames = (props = {}) => {
    const result = renderPanel({ gameType: 'poll', ...props });
    openTab('Settings');
    return result;
  };

  test('the author setting is offered, off by default, and reads as a question about names', () => {
    // rejects: shipping the section with the box pre-ticked. Default hidden is
    // the owner's call and it is also the safe direction — turning it on cannot
    // be taken back.
    openNames();
    const box = screen.getByTestId('attribute-authors');
    expect(box.checked).toBe(false);
    expect(screen.getByLabelText(/show who wrote each response/i)).toBe(box);
  });

  test('ticking it emits the FLAG, not the checkbox — one flag, inverted once', () => {
    // THE TRAP THIS GUARDS. The stored per-game flag is `anonymousUntilReveal`
    // ("withhold the names"); the host-facing question is "show the names".
    // They are inverses, and the inversion happens exactly here.
    //
    // rejects: emitting the checkbox value straight through, which silently
    // means the opposite of what it says and would hand a room every author's
    // name the moment a host ticked a box labelled "show", then hide them when
    // it was cleared. Also rejects introducing a second boolean beside
    // `anonymousUntilReveal` to dodge the inversion.
    const onAnonymousUntilRevealChange = jest.fn();
    const { unmount } = openNames({ onAnonymousUntilRevealChange });
    fireEvent.click(screen.getByTestId('attribute-authors'));
    expect(onAnonymousUntilRevealChange).toHaveBeenCalledWith(false);
    unmount();

    // ...and back the other way, which is the direction a copy-paste gets wrong.
    onAnonymousUntilRevealChange.mockClear();
    openNames({ anonymousUntilReveal: false, onAnonymousUntilRevealChange });
    fireEvent.click(screen.getByTestId('attribute-authors'));
    expect(onAnonymousUntilRevealChange).toHaveBeenCalledWith(true);
  });

  test('the irreversible direction is named as irreversible, next to the control', () => {
    // THE GOVERNING PRINCIPLE: where a real trade-off exists, tell the host at
    // the point of decision instead of deciding for them. The two directions
    // genuinely differ — one reaches the server and one does not — and a host
    // standing in front of a room needs to know which is which BEFORE pressing.
    //
    // rejects: dropping the warning, and rejects the symmetric lie that it can
    // simply be toggled back.
    const { container } = openNames();
    const section = container.querySelector('.setup-settings');
    expect(section.textContent).toMatch(/cannot be taken back/i);
    expect(section.textContent).toMatch(/does not un-send/i);
  });

  test('the waiting-names setting is offered, ON by default, and says what it lists', () => {
    // DEFAULT ON, and that is the whole retirement of the five-response block.
    // The list is never up unless the host hovers or clicks the meter, so
    // defaulting on puts nothing on a wall by itself — while defaulting off
    // would rebuild the old block for the owner's own room, a team of four,
    // where the response count never reaches five.
    //
    // rejects: a default-off replacement, and rejects copy that leaves the
    // polarity ambiguous — a list of who HAS answered is the participation
    // league table this product refuses to draw.
    openNames();
    const box = screen.getByTestId('name-waiting');
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(screen.getByLabelText(/name who is still waiting/i)).toBe(box);
  });

  test('the caution states the risk AND the live count, and does not block anything', () => {
    // THE SENTENCE THAT REPLACED THE BLOCK. `MIN_ANONYMOUS_ANSWERS` used to
    // return null below five responses; it now words this.
    //
    // rejects: shipping the retirement with no explanation at all — the risk is
    // real and the host is the one who has to weigh it — and rejects a generic
    // disclaimer with no number in it, which is what a host learns to skip.
    const { container } = openNames({ answerCount: 2 });
    const caution = screen.getByTestId('waiting-caution');
    expect(caution.textContent).toMatch(/subtract one list from the other/i);
    expect(caution.textContent).toMatch(/\b2 responses\b/);
    expect(caution.dataset.strong).toBe('true');
    // ...and the control it sits under is still usable. rejects: a disabled
    // input, which is the old block wearing an explanation.
    expect(screen.getByTestId('name-waiting').disabled).toBe(false);
    expect(container.querySelector('.setup-note--warn')).not.toBeNull();
  });

  test('a round with responses to hide inside is cautioned differently', () => {
    // rejects: one flat warning for every round, which tells a host nothing
    // they can act on and trains them to ignore the one that matters.
    openNames({ answerCount: 12 });
    const caution = screen.getByTestId('waiting-caution');
    expect(caution.dataset.strong).toBe('false');
    expect(caution.textContent).toMatch(/\b12 responses\b/);
  });

  test('nothing about names is asked of a format that has no authorship', () => {
    // The file's own principle: an option that cannot do anything is a question
    // a host should not be asked. Trivia's response is a letter, so there is
    // nothing authored to attribute.
    //
    // rejects: rendering the section for every game type, which would offer a
    // trivia host a switch that changes nothing on screen.
    const { container } = renderPanel({ gameType: 'trivia' });
    openTab('Settings');
    expect(container.querySelector('[data-testid="attribute-authors"]')).toBeNull();
    expect(container.querySelector('.setup-settings').textContent).not.toMatch(/still waiting/i);
  });

  test('a session that already shows its authors is not asked about waiting names', () => {
    // rejects: leaving the second control on screen once the first makes it
    // moot. With the names up there is no subtraction to protect, so
    // waitingRoster ignores this setting entirely — and a switch that moves
    // nothing is exactly what this panel refuses to draw.
    const { container } = renderPanel({ gameType: 'poll', anonymousUntilReveal: false });
    openTab('Settings');
    expect(container.querySelector('[data-testid="attribute-authors"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="name-waiting"]')).toBeNull();
    expect(container.querySelector('[data-testid="waiting-caution"]')).toBeNull();
  });

  test('the caution goes quiet once this round\'s authors are out', () => {
    // rejects: a warning that stays on screen after the thing it protects is
    // already public. The round is revealed; there is no anonymity set left to
    // shrink, and a caution that is always up is a caution nobody reads.
    const { container } = renderPanel({
      gameType: 'poll', answerCount: 2, authorsRevealed: true,
    });
    openTab('Settings');
    expect(container.querySelector('[data-testid="name-waiting"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="waiting-caution"]')).toBeNull();
  });

  test('THE DISPLAY PROFILE IS NOT AN INPUT TO EITHER DECISION', () => {
    // THE OWNER'S RULING, verbatim: *"Don't use screen type for name reveal
    // decision. I often have a projector with a team of four. Just leave the
    // decision to the host."* A projector is not a proxy for room size,
    // audience or sensitivity.
    //
    // rejects: any implementation that pre-ticks, hides, disables or re-words
    // either control based on `profile` — the shortcut that looks thoughtful
    // and is exactly the inference the owner forbade. Asserted by rendering the
    // same panel on all four profiles and requiring identical answers.
    const seen = ['room', 'tv', 'call', 'table'].map((profile) => {
      const { container, unmount } = renderPanel({ gameType: 'poll', profile, answerCount: 2 });
      openTab('Settings');
      const section = container.querySelector('.setup-settings');
      const snapshot = {
        attribute: container.querySelector('[data-testid="attribute-authors"]').checked,
        waiting: container.querySelector('[data-testid="name-waiting"]').checked,
        caution: container.querySelector('[data-testid="waiting-caution"]').dataset.strong,
        text: section.textContent.replace(/Room — projector|TV — large panel|Call — screen share|Table — laptop/g, ''),
      };
      unmount();
      return snapshot;
    });
    seen.forEach((snapshot) => expect(snapshot).toEqual(seen[0]));
  });
});

/*
 * THE QUESTIONS TAB'S FILTERS AND TAGS.
 *
 *   "the question tab in the session, the unasked only filter does not work.
 *    also if the question are turned off with the top buttons there should be a
 *    way by default (a button that has enabled categories only however we can
 *    briefly call that button) also if the question has been asked, mark that
 *    quested as asked. and if turned off category, mark disabled. small tags
 *    loike are used in the admin question sets for active and ai those are nice
 *    tags."
 *
 * The unit tests in setupPanel.test.js pin the decisions. These pin that the
 * panel actually asks them — the filter bug was never in the filter, it was in
 * what the panel handed it, and no test of `filterBrowserRows` in isolation
 * could ever have caught that.
 */
describe('the question browser filters on what the host can see', () => {
  const rows = () => screen.getAllByTestId('browser-row');

  // rejects: THE REPORTED BUG, END TO END. `usedQuestionIds` carries the
  // prefixed id the game returns; the rows carry the bare id the browsing
  // endpoint publishes. Compare them raw and nothing is ever used, so the
  // filter drops nothing and the row never dims.
  test('a question asked this session is tagged and filtered, despite the id prefix', () => {
    renderPanel({ usedQuestionIds: ['QUESTION#q-2'] });
    openTab('Questions');

    expect(screen.getByText('Asked')).toBeInTheDocument();
    expect(rows()).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: /unasked only/i }));
    expect(rows()).toHaveLength(2);
    expect(screen.queryByText('Asked')).not.toBeInTheDocument();
  });

  // rejects: the tag arriving without the dimming, or vice versa. They are one
  // state and the row's class is what the stylesheet keys off.
  test('the asked row is marked in the DOM as well as in words', () => {
    const { container } = renderPanel({ usedQuestionIds: ['QUESTION#q-2'] });
    openTab('Questions');
    expect(container.querySelectorAll('.setup-qb__row.is-used')).toHaveLength(1);
  });

  /*
   * The file's shared mask is `11100000` — everything on, which is right for
   * the tests it was written for and useless here. These pass their own,
   * switching Competitive Response off, which makes q-2 the disabled question.
   * q-2 is also the one the asked tests above use, deliberately: the two tags
   * have to be able to coexist on one row.
   */
  const oneCategoryOff = {
    categoryBitmasks: {
      'HostMask1-8': '10100000',
      'HostMask9-16': '00000000',
      'HostMask17-24': '00000000',
    },
  };

  test('a question in a switched-off category is tagged Off', () => {
    renderPanel(oneCategoryOff);
    openTab('Questions');
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  // rejects: shipping the Off tag with no way to act on it — the owner asked
  // for the button, not just the label.
  test('"Enabled only" drops the switched-off questions', () => {
    renderPanel(oneCategoryOff);
    openTab('Questions');
    expect(rows()).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: /enabled only/i }));
    expect(rows()).toHaveLength(2);
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });

  // rejects: the two filters being exclusive. "Enabled and unasked" is the
  // literal question "what can I actually ask next".
  test('the two filters compose', () => {
    renderPanel({ ...oneCategoryOff, usedQuestionIds: ['QUESTION#q-1'] });
    openTab('Questions');
    fireEvent.click(screen.getByRole('button', { name: /enabled only/i }));
    fireEvent.click(screen.getByRole('button', { name: /unasked only/i }));
    // q-1 asked, q-2 off — only q-3 is both enabled and unasked.
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('Packaging the top tier')).toBeInTheDocument();
  });

  // rejects: offering a filter that cannot do anything. Before a game starts
  // there are no masks, nothing is switched off, and a button that filters
  // nothing while implying otherwise is worse than no button.
  test('"Enabled only" is not offered when there is no live mask to read', () => {
    renderPanel({ categories: [], categoryCounts: null, categoryBitmasks: null });
    openTab('Questions');
    expect(screen.queryByRole('button', { name: /enabled only/i })).not.toBeInTheDocument();
  });

  // rejects: marking every question disabled on the setup screen, which is what
  // an absent mask read as "nothing is enabled" would do.
  test('nothing is tagged Off before a game has started', () => {
    renderPanel({ categories: [], categoryCounts: null, categoryBitmasks: null });
    openTab('Questions');
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
    expect(rows()).toHaveLength(3);
  });
});
