/**
 * THE CODE HAS A DOOR (2026-10-02, reported by the owner: the email says
 * "enter it on the sign-in screen", and there was nowhere to type it).
 *
 * /auth?mode=verify — the email's own link — and "Enter the code from your
 * email" on the sign-in form open the code step with no sign-up in hand, so it
 * asks for the address as well. Confirming lands on sign-in with the address
 * filled in.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockAuth = {};
jest.mock('../auth/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
jest.mock('../auth/googleSignIn', () => ({ startGoogleSignIn: jest.fn() }));
import AuthPage from '../auth/AuthPage';

beforeEach(() => {
  Object.keys(mockAuth).forEach((k) => delete mockAuth[k]);
  Object.assign(mockAuth, {
    currentUser: null, loading: false, error: null, newPasswordRequired: null,
    setError: jest.fn(), signOut: jest.fn(), signIn: jest.fn(), signUp: jest.fn(),
    confirmSignUp: jest.fn(async () => 'SUCCESS'), resendConfirmationCode: jest.fn(async () => ({})),
    forgotPassword: jest.fn(), refreshSession: jest.fn(),
  });
});

const typeCode = (code) => fireEvent.change(screen.getByLabelText(/Verification code, 6 digits/), { target: { value: code } });

test('the email\'s link opens the code step, asking for the address too', async () => {
  window.history.pushState({}, '', '/auth?mode=verify');
  render(<AuthPage />);
  expect(screen.getByRole('heading', { name: 'Enter your code' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dana@example.com' } });
  typeCode('123456');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(mockAuth.confirmSignUp).toHaveBeenCalledWith('dana@example.com', '123456'));
  expect(await screen.findByText('Email confirmed. Sign in to finish.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Host sign in' })).toBeInTheDocument();
  expect(document.getElementById('login-email').value).toBe('dana@example.com');
});

test('without a valid address it says so and confirms nothing', async () => {
  window.history.pushState({}, '', '/auth?mode=verify');
  render(<AuthPage />);
  typeCode('123456');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText('Type the email address you signed up with.')).toBeInTheDocument();
  expect(mockAuth.confirmSignUp).not.toHaveBeenCalled();
});

test('a new code goes to the typed address', async () => {
  window.history.pushState({}, '', '/auth?mode=verify&email=sam%40example.com');
  render(<AuthPage />);
  expect(screen.getByLabelText('Email').value).toBe('sam@example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Send another code' }));
  await waitFor(() => expect(mockAuth.resendConfirmationCode).toHaveBeenCalledWith('sam@example.com'));
});

test('the sign-in form has a way to the code step, and back', () => {
  window.history.pushState({}, '', '/auth');
  render(<AuthPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Enter the code from your email' }));
  expect(screen.getByRole('heading', { name: 'Enter your code' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
  expect(screen.getByRole('heading', { name: 'Host sign in' })).toBeInTheDocument();
});

test('the verification email links to the code step and says where a reset code goes', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'template-clean.yaml'), 'utf8');
  const block = template.slice(template.indexOf('VerificationMessageTemplate:'), template.indexOf('VerificationMessageTemplate:') + 2500);
  expect(block).toMatch(/\{####\}/);
  expect(block).toMatch(/https:\/\/\$\{DomainName\}\/auth\?mode=verify/);
  expect(block).toMatch(/Forgotten it\?/);
  expect(block).not.toMatch(/Enter it on the sign-in screen to finish/);
});
