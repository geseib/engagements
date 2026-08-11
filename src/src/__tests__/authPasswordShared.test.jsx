/**
 * The three forms that take a password must agree about what a password is.
 *
 * `authPasswordPolicy.test.js` proves the shared module is right. This file
 * proves the forms actually USE it: a module nobody imports fixes nothing, and
 * the defect being fixed was never in one validator, it was in the disagreement
 * between three. So each form here is driven with the two passwords the old
 * validators split on and asserted to reach its Cognito call.
 *
 *   Northeast#26  -- RegisterForm's [@$!%*?&] rejected it
 *   Northeast-26  -- RegisterForm AND PasswordChangeForm rejected it
 *
 * These are behavioural, not source assertions: the forms render in jsdom (they
 * do not depend on GameHostPage's provider), so the real control is typed into
 * and the real submit handler runs.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine, so every width, offset
 * and computed box measures zero and passes unconditionally.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import RegisterForm from '../auth/RegisterForm';
import PasswordChangeForm from '../auth/PasswordChangeForm';
import ForgotPasswordForm from '../auth/ForgotPasswordForm';

const mockAuth = {
  signUp: jest.fn(),
  completeNewPassword: jest.fn(),
  forgotPassword: jest.fn(),
  confirmPassword: jest.fn(),
  error: null,
  setError: jest.fn(),
  loading: false,
  newPasswordRequired: { userAttributes: {}, requiredAttributes: [] },
  currentUser: null,
};

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

beforeEach(() => {
  Object.values(mockAuth).forEach((v) => typeof v?.mockReset === 'function' && v.mockReset());
  mockAuth.signUp.mockResolvedValue({});
  mockAuth.completeNewPassword.mockResolvedValue({});
  mockAuth.forgotPassword.mockResolvedValue({});
  mockAuth.confirmPassword.mockResolvedValue(true);
});

const type = (field, value) => fireEvent.change(field, { target: { value } });

describe.each([
  ['Northeast#26', 'a hash'],
  ['Northeast-26', 'a hyphen'],
])('a password whose symbol is %s (%s)', (password) => {
  it('is accepted by the register form', async () => {
    render(<RegisterForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />);

    type(screen.getByLabelText(/your name/i), 'Alexandra Vasquez-Kowalski');
    type(screen.getByLabelText(/email/i), 'alexandra@example.com');
    type(screen.getByLabelText(/^password$/i), password);
    // The confirm field is registration-only; see confirmPasswordOnRegister.test.jsx.
    type(screen.getByLabelText(/confirm password/i), password);
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockAuth.signUp).toHaveBeenCalledWith(
        'alexandra@example.com',
        password,
        'Alexandra Vasquez-Kowalski'
      );
    });
  });

  it('is accepted by the forced password-change form', async () => {
    render(<PasswordChangeForm />);

    type(screen.getByLabelText(/new password/i), password);
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));

    await waitFor(() => {
      expect(mockAuth.completeNewPassword).toHaveBeenCalledWith(password);
    });
  });

  it('is accepted by the password-reset form', async () => {
    render(<ForgotPasswordForm onToggleMode={jest.fn()} initialEmail="alexandra@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: /send the code/i }));
    const code = await screen.findByLabelText(/code from the email/i);

    type(code, '407190');
    type(screen.getByLabelText(/new password/i), password);
    fireEvent.click(screen.getByRole('button', { name: /set the new password/i }));

    await waitFor(() => {
      expect(mockAuth.confirmPassword).toHaveBeenCalledWith(
        'alexandra@example.com',
        '407190',
        password
      );
    });
  });
});

describe('the forms still refuse a password the pool would refuse', () => {
  // Without these, "uses the shared module" could be satisfied by deleting
  // validation altogether, and every test above would still pass.
  it('the register form does not sign up a password with no symbol', async () => {
    render(<RegisterForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />);

    type(screen.getByLabelText(/your name/i), 'Alexandra Vasquez-Kowalski');
    type(screen.getByLabelText(/email/i), 'alexandra@example.com');
    type(screen.getByLabelText(/^password$/i), 'Northeast26');
    // Filled and MATCHING on purpose. Leaving it blank would block the submit
    // on the confirm rule instead, and this test would pass with the symbol
    // rule deleted -- coverage that asserts nothing.
    type(screen.getByLabelText(/confirm password/i), 'Northeast26');
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(mockAuth.signUp).not.toHaveBeenCalled());
  });

  it('the forced password-change form does not submit a password under 8 characters', async () => {
    render(<PasswordChangeForm />);

    type(screen.getByLabelText(/new password/i), 'Nor#26a');
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));

    await waitFor(() => expect(mockAuth.completeNewPassword).not.toHaveBeenCalled());
  });
});

describe('the live checklist', () => {
  // RATIONALE §8.3: the rules are shown from the first keystroke, not as an
  // error after submitting. Rejects reverting to submit-time-only validation,
  // and rejects the strength meter coming back beside it (two statements of
  // one thing).
  it('shows every rule as soon as the register form is on screen', () => {
    render(<RegisterForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />);

    expect(screen.getByText(/8 characters or more/i)).toBeInTheDocument();
    expect(screen.getByText(/an upper-case letter/i)).toBeInTheDocument();
    expect(screen.getByText(/a lower-case letter/i)).toBeInTheDocument();
    expect(screen.getByText(/a number/i)).toBeInTheDocument();
    expect(screen.getByText(/a symbol/i)).toBeInTheDocument();
  });

  it('marks the rules a half-typed password already meets, and only those', () => {
    render(<RegisterForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />);
    type(screen.getByLabelText(/^password$/i), 'Nor');

    // The met/unmet state has to be readable by something other than colour,
    // so it is on the list item itself rather than in a class name only.
    expect(screen.getByText(/an upper-case letter/i).closest('li'))
      .toHaveAttribute('data-met', 'true');
    expect(screen.getByText(/8 characters or more/i).closest('li'))
      .toHaveAttribute('data-met', 'false');
  });
});
