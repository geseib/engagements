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
import { render, screen, fireEvent } from '@testing-library/react';
import WelcomeScreen from '../components/WelcomeScreen';

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
    onViewHistory: jest.fn(),
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

  test('Create engagement raises onCreateEngagement', () => {
    const { onCreateEngagement } = setup();
    fireEvent.click(screen.getByRole('button', { name: /create engagement/i }));
    expect(onCreateEngagement).toHaveBeenCalledTimes(1);
  });

  test('Sessions raises onViewHistory', () => {
    // The control was "Session history" until the owner asked whether that was
    // the right name — it was not: the list's first job is sessions that have
    // not happened yet. The handler keeps its historical name; the label the
    // host reads is what changed.
    const { onViewHistory } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^sessions$/i }));
    expect(onViewHistory).toHaveBeenCalledTimes(1);
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
    const { container } = setup();
    for (const name of ['Question sets', 'Sessions']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).toContain('wel-btn-line');
      expect(button.className).not.toContain('wel-btn-quiet');
    }
    expect(container.querySelector('.wel-aside-more .wel-btn-quiet')).toBeNull();
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
    const link = screen.getByRole('link', { name: /admin console/i });
    expect(link.getAttribute('href')).toBe('/admin');
  });

  test('a host who is not an admin is not offered the console', () => {
    // rejects: rendering it unconditionally. The route is admin-gated in
    // App.jsx and again in the authorizer, so this would not be an escalation
    // — it would be an invitation to an Access Denied screen.
    setup({ currentUser: host });
    expect(screen.queryByRole('link', { name: /admin console/i })).not.toBeInTheDocument();
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
