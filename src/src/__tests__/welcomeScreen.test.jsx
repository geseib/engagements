/**
 * The host's front door, before any session exists.
 *
 * `GameHostPage` cannot be mounted in jsdom at all (it dies on the auth
 * provider), which is why this surface is its own component — the same move
 * that made GameSetupDialog, SessionSetupPanel and Podium testable. Everything
 * below renders the real component and drives the real controls.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine, so every width, offset
 * and computed box measures zero and passes unconditionally.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import WelcomeScreen from '../components/WelcomeScreen';
import { rowAction, clickRowAction, rowActionNames } from '../testUtils/sessionRows';

const admin = {
  attributes: { name: 'Dana Whitfield', email: 'dana@example.com' },
  groups: ['admins', 'hosts'],
};

const host = {
  attributes: { name: 'Sam Okafor', email: 'sam@example.com' },
  groups: ['hosts'],
};

function setup(props = {}) {
  const handlers = {
    onQuickStart: jest.fn(),
    onCreateEngagement: jest.fn(),
    onQuestionSets: jest.fn(),
    onSignOut: jest.fn(),
    onContinue: jest.fn(),
    onContinueGameIdChange: jest.fn(),
  };
  const utils = render(
    <WelcomeScreen currentUser={admin} continueGameId="" {...handlers} {...props} />
  );
  return { ...utils, ...handlers };
}

/** Every declared rule in WelcomeScreen.css, as text. jsdom computes no layout,
 *  so a class's appearance can only be asserted by reading what it declares. */
const CSS = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'components', 'WelcomeScreen.css'),
  'utf8'
);

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = CSS.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[2] : '';
}

/*
  ── THE ROW HAS ONE CHILD, AND THAT IS A LAYOUT CONTRACT jsdom CAN CHECK ────

  `.wel-main` is `display: flex` above 900px. Adding a second element child
  therefore adds a second flex ITEM, and both `.wel-shell` boxes carry
  `width: 100%; max-width: 62rem` — so they split the row. That is exactly what
  happened when the invitations prompt was added in its own shell beside the
  split: an EMPTY box (PendingInvites renders null when nothing is waiting) took
  the left half and pushed every visible thing on the screen into the right.

  jsdom has no layout engine and cannot see the consequence. It can count
  children, which is the cause — and the cause is the part a future edit would
  reintroduce.
*/
describe('the main row', () => {
  // rejects: a second child of `.wel-main`, which halves the row and shoves the
  // page sideways whether or not the new child renders anything.
  it('has exactly one child, so nothing can share the row with the split', () => {
    render(<WelcomeScreen currentUser={{ attributes: { name: 'Amara' } }} />);
    const main = document.querySelector('.wel-main');
    expect(main).toBeTruthy();
    expect(main.children).toHaveLength(1);
    expect(main.children[0]).toHaveClass('wel-shell');
    /* And NOT `.wel-stack`, which is the action-button group's class and caps
       width at 34rem — reusing it would squeeze the whole page while fixing the
       row. */
    expect(main.children[0]).not.toHaveClass('wel-stack');
  });

  // rejects: dropping the width constraint while restructuring — the shell is
  // what centres the content and caps its measure.
  it('that child is the shell, and the split lives inside it', () => {
    render(<WelcomeScreen currentUser={{ attributes: { name: 'Amara' } }} />);
    const shell = document.querySelector('.wel-main > .wel-shell');
    expect(shell.querySelector('.wel-split')).toBeTruthy();
  });
});

describe('the five ways out of this screen', () => {
  // Each of these rejects the same failure in a different control: a button
  // that renders and is wired to nothing. That is not hypothetical here — the
  // whole screen is being rebuilt from scratch, so every handler is a fresh
  // connection between a new element and an old page-level function.
  test('Quick start raises onQuickStart', () => {
    const { onQuickStart } = setup();
    fireEvent.click(screen.getByRole('button', { name: /quick start/i }));
    expect(onQuickStart).toHaveBeenCalledTimes(1);
  });

  test('New engagement raises onCreateEngagement', () => {
    const { onCreateEngagement } = setup();
    fireEvent.click(screen.getByRole('button', { name: /new engagement/i }));
    expect(onCreateEngagement).toHaveBeenCalledTimes(1);
  });

  test('See all opens Library & team\'s Sessions, in place', () => {
    // Experience plan 4b: the full list is the console's; Home shows five.
    setup({ sessions: [] });
    const link = screen.getByRole('link', { name: /see all/i });
    expect(link).toHaveAttribute('href', '/admin?section=games');
    expect(link).not.toHaveAttribute('target');
  });

  test('Sign out raises onSignOut', () => {
    const { onSignOut } = setup();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  test('Question sets raises onQuestionSets', () => {
    // rejects: the control shipping with no handler behind it. Until now the
    // host's set shelf had exactly one door — the picker inside the create
    // screen — so "fix the name on the set I made last week" meant starting an
    // engagement you did not want and abandoning it.
    const { onQuestionSets } = setup();
    fireEvent.click(screen.getByRole('button', { name: /question sets/i }));
    expect(onQuestionSets).toHaveBeenCalledTimes(1);
  });
});

/**
 * *"the button for game histroy should be more obviousd that its a button
 *  (doesnt need to be bigger though)"*
 *
 * Both halves are testable without a layout engine, because both are decided by
 * what the class declares rather than by what it measures: a visible rule is the
 * button-ness, and identical metrics are the not-bigger.
 */
describe('the library controls read as buttons', () => {
  test('neither is the borderless link style any more', () => {
    // rejects: leaving `wel-btn-quiet` on either control. That class is muted
    // text on a transparent 2px border with a -12px pull to sit flush under the
    // paragraph — which is how this file draws a text LINK, and it was read as
    // one.
    setup({ onReports: jest.fn() });
    for (const name of ['Question sets', 'Reports']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).toContain('wel-btn-line');
      expect(button.className).not.toContain('wel-btn-quiet');
    }
  });

  test('the style it carries declares a visible rule', () => {
    // rejects: a class that exists but draws nothing — `.wel-btn` sets
    // `border: 2px solid transparent`, so a `.wel-btn-line` that forgets to
    // name a colour is invisible and every assertion above still passes.
    const line = ruleFor('.wel-btn-line');
    expect(line).toMatch(/border-color:\s*var\(--wel-rule-strong\)/);
    expect(line).toMatch(/color:\s*var\(--text\)/);
  });

  test('and it is not one pixel bigger than the style it replaced', () => {
    // rejects: reaching for size to make the control obvious, which is the one
    // thing the owner ruled out. min-height, padding and font-size must match
    // `.wel-btn-quiet` exactly; only the rule and the ink may differ.
    const quiet = ruleFor('.wel-btn-quiet');
    const line = ruleFor('.wel-btn-line');
    const metric = (rule, prop) => (rule.match(new RegExp(`${prop}:\\s*([^;]+);`)) || [])[1];
    for (const prop of ['min-height', 'padding', 'font-size']) {
      expect(metric(line, prop)).toBe(metric(quiet, prop));
      expect(metric(line, prop)).toBeTruthy();
    }
  });
});

describe('continuing a session that is already running', () => {
  test('the field keeps digits only, and at most four of them', () => {
    // rejects: dropping the sanitiser and letting the raw value through, which
    // is what `maxLength` alone does — it caps length and admits letters, so a
    // pasted "Game 1234" reached handleContinueGame as "Game" and alerted.
    const { onContinueGameIdChange } = setup();
    fireEvent.change(screen.getByLabelText(/session code/i), {
      target: { value: '1a2b3c4d5' },
    });
    expect(onContinueGameIdChange).toHaveBeenCalledWith('1234');
  });

  test('Continue is dead until four digits are in', () => {
    // rejects: relaxing the guard back to `!continueGameId.trim()`, which let a
    // 1-digit code through to a window.alert.
    const { rerender } = setup({ continueGameId: '12' });
    expect(screen.getByRole('button', { name: /^continue/i })).toBeDisabled();

    rerender(
      <WelcomeScreen
        currentUser={admin}
        continueGameId="1234"
        onQuickStart={jest.fn()}
        onCreateEngagement={jest.fn()}
        onViewHistory={jest.fn()}
        onSignOut={jest.fn()}
        onContinue={jest.fn()}
        onContinueGameIdChange={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /^continue/i })).toBeEnabled();
  });

  test('with four digits in, Continue raises onContinue', () => {
    // rejects: an unwired submit — the one control on this screen whose button
    // is not the thing you press to leave, so it is the easiest to forget.
    const { onContinue } = setup({ continueGameId: '4821' });
    fireEvent.click(screen.getByRole('button', { name: /^continue/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  test('the painted cells show the code that is in the field', () => {
    // rejects: cells rendered from anything other than the value prop — local
    // state, or a forgotten binding — which leaves four empty boxes while the
    // host types and gives no feedback at all that the code went in.
    const { container } = setup({ continueGameId: '4821' });
    const cells = Array.from(container.querySelectorAll('.wel-cell'));
    expect(cells.map((c) => c.textContent)).toEqual(['4', '8', '2', '1']);
  });
});

describe('the one identity block in the product', () => {
  test('an admin is named and badged', () => {
    setup();
    expect(screen.getByText('Dana Whitfield')).toBeInTheDocument();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
  });

  test('an admin gets a way into the console', () => {
    // rejects: the one-directional link this screen shipped with. AdminShell
    // has carried a "Host ↗" link since it was written and nothing on the host
    // side pointed at /admin, so the only way in was to type the URL — on the
    // screen that prints an "Administrator" badge at you.
    //
    // Asserted as a LINK with an href, not as a button: middle-click and
    // "open in new tab" are the reason it is an anchor, and an onClick
    // handler would pass this if it were a <button>.
    setup();
    const links = screen.getAllByRole('link', { name: 'Library & team' });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => expect(link.getAttribute('href')).toBe('/admin'));
  });

  test('the console has one name, for staff and hosts alike (experience plan 4b)', () => {
    // rejects: the two names it had — "Admin console" for staff and "Question
    // sets & team" for everyone else (audit E S2). /admin accepts hosts.
    setup({ currentUser: host });
    expect(screen.getAllByRole('link', { name: 'Library & team' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/admin console/i)).toBeNull();
    expect(screen.queryByText(/question sets & team/i)).toBeNull();
  });

  test('a host without the admins group is named and not badged', () => {
    // rejects: printing the badge unconditionally, which tells every host they
    // are an administrator.
    setup({ currentUser: host });
    expect(screen.getByText('Sam Okafor')).toBeInTheDocument();
    expect(screen.queryByText('Administrator')).not.toBeInTheDocument();
  });

  test('the email address on the user object is never printed', () => {
    // rejects: reintroducing the address the panel rewrite deleted. The
    // fixture carries one, so this fails the moment the block prints it.
    const { container } = setup();
    expect(container.textContent).not.toContain('dana@example.com');
    expect(container.textContent).not.toContain('@');
  });

  test('with nobody signed in there is no identity block and no sign out', () => {
    // rejects: dropping the `currentUser &&` guard, which renders a block
    // naming "User" and a Sign out button for a session that has none.
    setup({ currentUser: null });
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Administrator')).not.toBeInTheDocument();
  });
});

/*
 * SITE SKINS (0b-1). The two hairlines read the --slate-rgb channel at their old
 * alphas, so they are the same pixels in every skin x theme. .wel-page declares
 * data-theme="dark" (WelcomeScreen.jsx), so the text it carries is dusk's.
 */
/* ------------------------------------------------------------ Home (4b) */

describe('Home: New, Rejoin, recent sessions, events and See all (experience plan 4b)', () => {
  const NOW = Date.now();
  const ago = (h) => new Date(NOW - h * 3600000).toISOString();
  const rows = [
    { gameId: '1001', title: 'Live now', gameType: 'call-and-answer', started: true, ended: false, byMe: true, createdAt: ago(2), lastPlayedAt: ago(1), questionSetId: 'a' },
    { gameId: '1002', title: 'Someone else running', gameType: 'trivia', started: true, ended: false, byMe: false, createdAt: ago(3) },
    { gameId: '1003', title: 'Done yesterday', gameType: 'poll', started: true, ended: true, byMe: true, createdAt: ago(20) },
    { gameId: '1004', title: 'Not yet', gameType: 'call-and-answer', started: false, byMe: true, createdAt: ago(1) },
    { gameId: '1005', title: 'Old unended', gameType: 'trivia', started: true, ended: false, byMe: true, createdAt: ago(80), lastPlayedAt: ago(70) },
    { gameId: '1006', title: 'Sixth', gameType: 'trivia', started: true, byMe: true, createdAt: ago(90) },
    { gameId: '1007', title: 'Seventh', gameType: 'trivia', started: true, byMe: true, createdAt: ago(100) },
    { kind: 'event', gameId: '4821', gameType: 'event', title: 'An event', createdAt: ago(0.5), started: false, items: [] },
  ];
  const handlers = () => ({
    onStart: jest.fn(), onEdit: jest.fn(), onOpen: jest.fn(), onReport: jest.fn(), onResults: jest.fn(),
    onInvite: jest.fn(), onCopyPlayerUrl: jest.fn(), onDelete: jest.fn(() => Promise.resolve()),
  });

  test('New is one button: the one amber action, with Quick start and the Build Room beneath it', () => {
    const { container } = setup({ sessions: rows });
    expect(container.querySelectorAll('.wel-action.is-primary')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /new engagement/i })).toHaveClass('is-primary');
    // Kept reachable until New folds them in (4c); neither is a second amber.
    expect(screen.getByRole('button', { name: /quick start/i })).not.toHaveClass('is-primary');
    expect(screen.getByRole('link', { name: /build room/i })).toHaveAttribute('href', '/build');
  });

  test('Rejoin lists the host\'s own running sessions, and Rejoin continues one', () => {
    const rowActions = handlers();
    setup({ sessions: rows, rowActions });
    const rejoin = screen.getByTestId('wel-rejoin');
    expect(within(rejoin).getByText('Live now')).toBeInTheDocument();
    // Not someone else's, not an ended one, not one idle for days, not unstarted.
    ['Someone else running', 'Done yesterday', 'Old unended', 'Not yet'].forEach((t) => {
      expect(within(rejoin).queryByText(t)).toBeNull();
    });
    fireEvent.click(within(rejoin).getByRole('button', { name: /rejoin live now/i }));
    expect(rowActions.onOpen).toHaveBeenCalledWith('1001', 'Live now');
  });

  test('with nothing running, Rejoin says so and keeps the code field', () => {
    setup({ sessions: [rows[3]] });
    expect(screen.queryByTestId('wel-rejoin')).toBeNull();
    expect(screen.getByText(/nothing of yours is running/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/session code, 4 digits/i)).toBeInTheDocument();
  });

  test('Recent sessions: the five newest, events left to their own section', () => {
    setup({ sessions: rows });
    const recent = screen.getByRole('table', { name: 'Recent sessions' });
    const titles = within(recent).getAllByTestId('session-row').map((r) => r.querySelector('.slist-nm').textContent);
    expect(titles).toEqual(['Not yet', 'Live now', 'Someone else running', 'Done yesterday', 'Old unended']);
    expect(within(recent).queryByText('An event')).toBeNull();
  });

  test('while the sessions load, Home says so rather than "no sessions"', () => {
    setup({ sessions: null });
    expect(screen.getByText(/loading your sessions/i)).toBeInTheDocument();
    expect(screen.queryByText(/no sessions yet/i)).toBeNull();
  });

  test('a host with none is told how to make one', () => {
    setup({ sessions: [] });
    expect(screen.getByText(/no sessions yet. press new engagement/i)).toBeInTheDocument();
  });

  test('the recent rows are the list\'s rows: one primary, the rest under ⋯, each wired', () => {
    const rowActions = handlers();
    setup({ sessions: rows, rowActions });
    const recent = screen.getByRole('table', { name: 'Recent sessions' });
    const notYet = within(recent).getByText('Not yet').closest('tr');
    expect(rowActionNames(notYet)).toEqual(['Start', 'Edit', 'Invite…', 'Copy join link', 'Delete…']);
    clickRowAction(notYet, /^Start/);
    expect(rowActions.onStart).toHaveBeenCalledWith('1004', 'Not yet');
    clickRowAction(notYet, /^Edit/);
    expect(rowActions.onEdit).toHaveBeenCalledWith('1004', 'Not yet');
    const done = within(recent).getByText('Done yesterday').closest('tr');
    clickRowAction(done, /^Report/);
    expect(rowActions.onReport).toHaveBeenCalledWith('1003', 'Done yesterday');
  });

  test('Start says how the room will watch, as the full list does (2b)', () => {
    setup({ sessions: rows, rowActions: handlers(), roomScreen: 'two' });
    const recent = screen.getByRole('table', { name: 'Recent sessions' });
    expect(rowAction(within(recent).getByText('Not yet').closest('tr'), /^Start/)).toHaveTextContent('Start · two screens');
  });

  test('the events section is still on Home', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'components', 'WelcomeScreen.jsx'), 'utf8');
    expect(src).toMatch(/<WelcomeEvents \/>/);
  });
});

describe('the brand mark stays in the app (experience plan 4b; audit E S3)', () => {
  test('signed in, it goes Home — not to the marketing page', () => {
    setup();
    expect(screen.getByRole('link', { name: /engagements/i })).toHaveAttribute('href', '/');
  });

  test('signed out (previews and tests only), it keeps the marketing home', () => {
    setup({ currentUser: null });
    expect(screen.getByRole('link', { name: /engagements/i })).toHaveAttribute('href', '/home');
  });
});

describe('the welcome tokens, for every skin x theme', () => {
  const H = require('../testing/skinHarness');
  const CSS = H.css('components/WelcomeScreen.css');
  describe.each(H.CASES)('%s / %s', (skin, theme) => {
    const v = (name) => H.scopeVar(CSS, '.wel-page {', name, { skin, theme });
    test.each([['--wel-rule', 0.2], ['--wel-rule-strong', 0.34]])('%s is rgba(155,168,190,%s), as before', (name, alpha) => {
      const c = H.parseColor(v(name));
      expect(c.rgb).toEqual([155, 168, 190]);
      expect(c.a).toBeCloseTo(alpha, 5);
    });
  });
  describe.each(H.SKINS.filter((s) => H.CASES.some(([k]) => k === s)))('%s, dusk', (skin) => {
    const role = (n) => H.role(n, { skin, theme: 'dark' });
    test.each(['--bg', '--surface'])('text and muted on %s clear AA', (ground) => {
      expect(H.on(role('--text'), [role('--bg'), role(ground)])).toBeGreaterThanOrEqual(H.AA);
      expect(H.on(role('--muted'), [role('--bg'), role(ground)])).toBeGreaterThanOrEqual(H.AA);
    });
  });
});
