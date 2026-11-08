/**
 * ANOTHER GOOGLE ACCOUNT (owner, 2026-11-04: on Safari "it won't let me pick a
 * different host user").
 *
 * The pools run Cognito's classic hosted UI, which does not pass
 * `prompt=select_account` on to Google, so Google returns the one account the
 * browser is signed in to without asking. The sign-in form says so and points
 * at Google's own account list, which is the one place another account can be
 * added or chosen.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const mockAuth = {};
jest.mock('../auth/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../auth/googleSignIn', () => ({
  startGoogleSignIn: jest.fn(),
  GOOGLE_ACCOUNT_CHOOSER_URL: 'https://accounts.google.com/AccountChooser',
}));
import LoginForm from '../auth/LoginForm';
import { startGoogleSignIn } from '../auth/googleSignIn';

beforeEach(() => {
  Object.keys(mockAuth).forEach((k) => delete mockAuth[k]);
  Object.assign(mockAuth, { error: null, setError: jest.fn(), signIn: jest.fn() });
  startGoogleSignIn.mockReset();
});

test('"Use a different Google account" opens the steps, with Google\'s account list in a new tab', () => {
  render(<LoginForm onToggleMode={() => {}} />);
  const toggle = screen.getByRole('button', { name: 'Use a different Google account' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('region', { name: 'Use a different Google account' })).toBeNull();

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panel = screen.getByRole('region', { name: 'Use a different Google account' });
  expect(panel).toHaveTextContent(/Safari/);
  const link = screen.getByRole('link', { name: 'Open your Google accounts' });
  expect(link).toHaveAttribute('href', 'https://accounts.google.com/AccountChooser');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));

  // Opening the steps is not a sign-in; Continue with Google still is.
  expect(startGoogleSignIn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
  expect(startGoogleSignIn).toHaveBeenCalledWith('login');

  fireEvent.click(toggle);
  expect(screen.queryByRole('region', { name: 'Use a different Google account' })).toBeNull();
});
