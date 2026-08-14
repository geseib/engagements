import React from 'react';
import { render, screen } from '@testing-library/react';

/**
 * The other half of "Create a host account".
 *
 * The root page asserting that it navigates to `/auth?mode=register` proves
 * nothing on its own -- that is exactly the shape of defect this codebase keeps
 * shipping: a correct destination computed and then ignored at the far end. This
 * file is the far end.
 */
jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({ currentUser: null, loading: false, newPasswordRequired: false }),
}));
jest.mock('../auth/LoginForm', () => () => <div data-testid="login-form" />);
jest.mock('../auth/RegisterForm', () => () => <div data-testid="register-form" />);
jest.mock('../auth/VerificationForm', () => () => <div data-testid="verify-form" />);
jest.mock('../auth/ForgotPasswordForm', () => () => <div data-testid="forgot-form" />);
jest.mock('../auth/PendingApproval', () => () => <div data-testid="pending" />);
jest.mock('../auth/PasswordChangeForm', () => () => <div data-testid="password-change" />);

// Imported AFTER jest.mock above, which jest hoists — the order is required,
// not accidental. (Was an `import/first` disable directive; no import plugin
// is configured, and a directive for an unknown rule is itself an error.)
import AuthPage from '../auth/AuthPage';

const goTo = (path) => window.history.pushState({}, '', path);
afterEach(() => goTo('/'));

test('/auth?mode=register opens the register form', () => {
  // rejects: AuthPage reading only `status`, so the root page's register link
  // lands on the sign-in form and the link is a lie
  goTo('/auth?mode=register');
  render(<AuthPage />);
  expect(screen.getByTestId('register-form')).toBeInTheDocument();
});

test('/auth still opens the sign-in form', () => {
  // rejects: making register the default while wiring the param up
  goTo('/auth');
  render(<AuthPage />);
  expect(screen.getByTestId('login-form')).toBeInTheDocument();
});

test('/auth?status=pending still wins', () => {
  // rejects: an unguarded mode param that overrides the pending screen and
  // shows a fresh signup form to someone who already has an account waiting
  goTo('/auth?status=pending&mode=register');
  render(<AuthPage />);
  expect(screen.getByTestId('pending')).toBeInTheDocument();
});
