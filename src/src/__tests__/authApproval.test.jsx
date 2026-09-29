/**
 * SIGNING UP AND WAITING FOR APPROVAL, AS THE OWNER MET THEM (29 Sep 2026).
 *
 *   1. "if i dont keep the screen up, when i attempt to enter the setup code
 *      for the account … i cant, i need to reset the password again."
 *   2. On the "Not approved" screen, "i cant go to the main splash marketing
 *      page by clicking the top left logo", and once an admin approves the
 *      account "it [is] less obvious that they need to sign out and back in …
 *      1/ move this message to the top 2/ could this screen give a notice when
 *      the approval is done if you are on it?"
 *
 * rejects: a sign-in to an unconfirmed account that only says "check your
 * email" with nowhere to type the code; a confirmed code that leaves the person
 * signed out on a screen that cannot check; the password kept after it was
 * used; a waiting screen that never notices the approval, or asks for a sign
 * out; the check line anywhere but the top; polling while the tab is hidden or
 * after the answer is in; the logo pointing at `/`, which for anyone signed in
 * is the app — and so this screen again.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const mockAuth = {};
jest.mock('../auth/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
jest.mock('../auth/googleSignIn', () => ({ startGoogleSignIn: jest.fn() }));

const { navigateTo } = require('../auth/navigate');
import PendingApproval, { CHECK_MS } from '../auth/PendingApproval';
import LoginForm from '../auth/LoginForm';
import AuthPage from '../auth/AuthPage';
import AuthChrome from '../auth/AuthChrome';

const DANA = { attributes: { name: 'Dana Whitfield', email: 'dana@example.com' }, groups: ['pending'], status: 'pending' };
const APPROVED = { ...DANA, groups: ['hosts'], status: 'approved' };

function reset() {
  Object.keys(mockAuth).forEach((k) => delete mockAuth[k]);
  Object.assign(mockAuth, {
    currentUser: DANA,
    loading: false,
    error: null,
    newPasswordRequired: null,
    setError: jest.fn(),
    signOut: jest.fn(),
    signIn: jest.fn(),
    signUp: jest.fn(),
    confirmSignUp: jest.fn(async () => 'SUCCESS'),
    resendConfirmationCode: jest.fn(async () => ({})),
    forgotPassword: jest.fn(),
    refreshSession: jest.fn(async () => DANA),
  });
  navigateTo.mockReset();
}
beforeEach(() => {
  reset();
  window.history.pushState({}, '', '/auth');
});
afterEach(() => jest.useRealTimers());

const pending = () => render(<PendingApproval email="dana@example.com" name="Dana Whitfield" onSignOut={jest.fn()} />);

describe('the waiting screen notices the approval itself', () => {
  test('the check line is at the top — above the session code and the nudge — and asks for no sign out', () => {
    pending();
    const status = screen.getByTestId('approval-status');
    expect(status).toHaveTextContent('This page will tell you the moment you are approved.');
    expect(status).toHaveTextContent(`It checks every ${CHECK_MS / 1000} seconds while it is open`);
    expect(status).toHaveTextContent('No need to sign out and back in.');
    const code = screen.getByLabelText(/session code/i);
    // eslint-disable-next-line no-bitwise
    expect(status.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sign out and back in to check/i);
  });

  test('Check now asks Cognito, and says when it last did', async () => {
    pending();
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(mockAuth.refreshSession).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/last checked at/)).toBeInTheDocument();
    expect(screen.getByText('Not approved yet')).toBeInTheDocument();
  });

  test('approved: the top says so, with one button into the app — no sign out', async () => {
    mockAuth.refreshSession.mockResolvedValue(APPROVED);
    pending();
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    const status = await screen.findByText('Your account has been approved.');
    expect(status).toBeInTheDocument();
    expect(document.querySelector('.au-pill.is-good')).toHaveTextContent('Approved');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('You can host now.');
    expect(screen.queryByText('Not approved yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start hosting' }));
    // From /auth there is nothing behind the screen: the app's front door.
    expect(navigateTo).toHaveBeenCalledWith('/');
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  test('from a page the person was bounced off, Start hosting reloads that page', async () => {
    window.history.pushState({}, '', '/admin?section=events');
    mockAuth.refreshSession.mockResolvedValue({ ...DANA, groups: ['admins'] });
    pending();
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start hosting' }));
    expect(navigateTo).toHaveBeenCalledWith('/admin?section=events');
  });

  test('it checks by itself every 30 seconds, and stops once the answer is in', async () => {
    jest.useFakeTimers();
    pending();
    expect(mockAuth.refreshSession).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(CHECK_MS); });
    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(1);
    mockAuth.refreshSession.mockResolvedValue(APPROVED);
    await act(async () => { jest.advanceTimersByTime(CHECK_MS); });
    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Your account has been approved.')).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(CHECK_MS * 4); });
    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(2);
  });

  test('not while the tab is hidden; straight away when the person comes back to it', async () => {
    jest.useFakeTimers();
    let state = 'hidden';
    const spy = jest.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    try {
      pending();
      await act(async () => { jest.advanceTimersByTime(CHECK_MS * 3); });
      expect(mockAuth.refreshSession).not.toHaveBeenCalled();
      state = 'visible';
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(mockAuth.refreshSession).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  test('a check that fails says so, and the screen keeps waiting', async () => {
    mockAuth.refreshSession.mockRejectedValue(new Error('Network error'));
    pending();
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(/We could not check at .* — we will try again shortly\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeEnabled();
  });

  test('nobody signed in: no pretend check — a way to sign in instead', () => {
    mockAuth.currentUser = null;
    const onSignOut = jest.fn();
    render(<PendingApproval email="dana@example.com" name="" onSignOut={onSignOut} />);
    expect(screen.getByTestId('approval-status')).toHaveTextContent('Sign in to see whether you have been approved.');
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignOut).toHaveBeenCalled();
  });
});

describe('the logo', () => {
  test('goes to the marketing home, /home — never /, which for anyone signed in is the app', () => {
    render(<AuthChrome><p>x</p></AuthChrome>);
    const brand = document.querySelector('a.au-brand');
    expect(brand).toHaveAttribute('href', '/home');
  });
});

describe('a code never entered is not a dead end', () => {
  const unconfirmed = () => Object.assign(new Error('User is not confirmed.'), { code: 'UserNotConfirmedException' });

  const signInAs = (email, password) => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  };

  test('the sign-in form hands an unconfirmed account to the code step, with the password it was given', async () => {
    mockAuth.signIn.mockRejectedValue(unconfirmed());
    const onNeedsConfirmation = jest.fn();
    render(<LoginForm onToggleMode={jest.fn()} onSuccess={jest.fn()} onNeedsConfirmation={onNeedsConfirmation} />);
    signInAs(' dana@example.com ', 'Summit!2026');
    await waitFor(() => expect(onNeedsConfirmation).toHaveBeenCalledWith({ email: 'dana@example.com', password: 'Summit!2026' }));
  });

  test('a wrong password is not an unconfirmed account', async () => {
    mockAuth.signIn.mockRejectedValue(Object.assign(new Error('x'), { code: 'NotAuthorizedException' }));
    const onNeedsConfirmation = jest.fn();
    render(<LoginForm onToggleMode={jest.fn()} onSuccess={jest.fn()} onNeedsConfirmation={onNeedsConfirmation} />);
    signInAs('dana@example.com', 'wrong');
    await waitFor(() => expect(mockAuth.signIn).toHaveBeenCalled());
    expect(onNeedsConfirmation).not.toHaveBeenCalled();
  });

  test('back later: sign in → the code, with a way to get a new one → confirmed and signed straight in', async () => {
    mockAuth.currentUser = null;
    mockAuth.signIn
      .mockRejectedValueOnce(unconfirmed())
      .mockImplementationOnce(async () => { mockAuth.currentUser = DANA; return DANA; });
    render(<AuthPage />);
    signInAs('dana@example.com', 'Summit!2026');

    expect(await screen.findByRole('heading', { name: 'Confirm your email to finish' })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/When you created the account we sent a 6.digit code to da\*+@example\.com/);
    expect(screen.getByRole('button', { name: 'Send another code' })).toBeEnabled();
    expect(mockAuth.setError).toHaveBeenCalledWith(null);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(mockAuth.confirmSignUp).toHaveBeenCalledWith('dana@example.com', '123456'));
    await waitFor(() => expect(mockAuth.signIn).toHaveBeenCalledTimes(2));
    expect(mockAuth.signIn).toHaveBeenLastCalledWith('dana@example.com', 'Summit!2026');
    expect(await screen.findByText('Not approved yet')).toBeInTheDocument();
  });

  test('"Send another code" on that screen resends to the address that signed in', async () => {
    mockAuth.currentUser = null;
    mockAuth.signIn.mockRejectedValueOnce(unconfirmed());
    render(<AuthPage />);
    signInAs('dana@example.com', 'Summit!2026');
    fireEvent.click(await screen.findByRole('button', { name: 'Send another code' }));
    await waitFor(() => expect(mockAuth.resendConfirmationCode).toHaveBeenCalledWith('dana@example.com'));
  });

  test('if the sign-in after confirming fails, the waiting screen offers the sign-in', async () => {
    mockAuth.currentUser = null;
    mockAuth.signIn
      .mockRejectedValueOnce(unconfirmed())
      .mockRejectedValueOnce(new Error('Network error'));
    render(<AuthPage />);
    signInAs('dana@example.com', 'Summit!2026');
    fireEvent.change(await screen.findByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Sign in to see whether you have been approved.')).toBeInTheDocument();
  });
});
