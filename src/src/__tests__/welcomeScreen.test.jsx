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
    onSignOut: jest.fn(),
    onContinue: jest.fn(),
    onContinueGameIdChange: jest.fn(),
  };
  const utils = render(
    <WelcomeScreen currentUser={admin} continueGameId="" {...handlers} {...props} />
  );
  return { ...utils, ...handlers };
}

describe('the four ways out of this screen', () => {
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

  test('Game history raises onViewHistory', () => {
    const { onViewHistory } = setup();
    fireEvent.click(screen.getByRole('button', { name: /game history/i }));
    expect(onViewHistory).toHaveBeenCalledTimes(1);
  });

  test('Sign out raises onSignOut', () => {
    const { onSignOut } = setup();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
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
