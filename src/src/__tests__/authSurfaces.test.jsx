/**
 * The defects these screens shipped with, each pinned by the assertion that
 * would catch it coming back.
 *
 * Everything here renders the real component. Where a claim is about CSS rather
 * than DOM it reads the stylesheet with comments stripped first, because a
 * source assertion that matches its own explanatory comment asserts nothing.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine, so every width, offset
 * and computed box measures zero and passes unconditionally. "Is the panel on
 * the right" is therefore not testable here and is argued in AuthPage.jsx
 * instead.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import LoginForm from '../auth/LoginForm';
import RegisterForm from '../auth/RegisterForm';
import ForgotPasswordForm from '../auth/ForgotPasswordForm';
import PasswordChangeForm from '../auth/PasswordChangeForm';
import VerificationForm from '../auth/VerificationForm';
import PendingApproval from '../auth/PendingApproval';

const mockAuth = {
  signIn: jest.fn(),
  signUp: jest.fn(),
  signOut: jest.fn(),
  forgotPassword: jest.fn(),
  confirmPassword: jest.fn(),
  confirmSignUp: jest.fn(),
  resendConfirmationCode: jest.fn(),
  completeNewPassword: jest.fn(),
  error: null,
  setError: jest.fn(),
  loading: false,
  newPasswordRequired: { userAttributes: { email: 'dana@example.com' }, requiredAttributes: [] },
  currentUser: { attributes: { name: 'Dana Whitfield', email: 'dana@example.com' }, groups: ['pending'] },
};

jest.mock('../auth/AuthContext', () => ({ useAuth: () => mockAuth }));

beforeEach(() => {
  mockAuth.error = null;
  mockAuth.currentUser = {
    attributes: { name: 'Dana Whitfield', email: 'dana@example.com' },
    groups: ['pending'],
  };
  Object.values(mockAuth).forEach((v) => typeof v?.mockReset === 'function' && v.mockReset());
  mockAuth.forgotPassword.mockResolvedValue({});
});

// ---------------------------------------------------------------------------

describe('promises nothing keeps', () => {
  // There is no SES resource, no sendEmail call and no notification pipeline
  // anywhere in lambda-functions/. Both of these reject re-adding a sentence
  // that tells someone to stop checking and wait for a mail that never comes.
  it('the register form does not promise an email on approval', () => {
    render(<RegisterForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />);
    expect(document.body.textContent).not.toMatch(/receive an email/i);
    expect(document.body.textContent).not.toMatch(/email (you )?once .*approved/i);
  });

  it('the pending screen does not promise an email on approval', () => {
    render(<PendingApproval email="dana@example.com" name="Dana Whitfield" onSignOut={jest.fn()} />);
    expect(document.body.textContent).not.toMatch(/receive an email/i);
    expect(document.body.textContent).not.toMatch(/email notification/i);
  });

  // Rejects restoring the SLA. Nothing backs it: no queue, no timer, and on a
  // small deployment "our team" is one colleague. It used to appear twice.
  it('the pending screen quotes no turnaround time', () => {
    render(<PendingApproval email="dana@example.com" name="Dana Whitfield" onSignOut={jest.fn()} />);
    expect(document.body.textContent).not.toMatch(/24[-–—]48/);
    expect(document.body.textContent).not.toMatch(/\bhours\b/i);
  });

  // `refreshSession` does not exist anywhere in this codebase, so a Check again
  // button would throw on click. Rejects adding the button back without the
  // function -- and the second half rejects deleting the honest instruction
  // that replaced it.
  it('the pending screen offers no Check again button, and says what to do instead', () => {
    render(<PendingApproval email="dana@example.com" name="Dana Whitfield" onSignOut={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /check again/i })).toBeNull();
    expect(screen.getByText(/sign out and back in to check/i)).toBeInTheDocument();
  });
});

describe('what the pending screen offers instead', () => {
  // The two things a blocked person can actually act on. Each rejects dropping
  // one of the blocks that replaced three cards of filler.
  it('gives a working session-code field on the page itself', () => {
    render(<PendingApproval email="dana@example.com" name="Dana Whitfield" onSignOut={jest.fn()} />);
    const field = screen.getByLabelText(/session code/i);

    fireEvent.change(field, { target: { value: '4821' } });
    expect(field).toHaveValue('4821');
    expect(screen.getByRole('button', { name: /^join$/i })).toBeEnabled();
  });

  it('leaves Join disabled until the code is four digits', () => {
    render(<PendingApproval email="dana@example.com" name="Dana Whitfield" onSignOut={jest.fn()} />);
    expect(screen.getByRole('button', { name: /^join$/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '482' } });
    expect(screen.getByRole('button', { name: /^join$/i })).toBeDisabled();
  });

  // `/auth?status=pending` sets this mode straight off the URL, so the screen
  // is reachable with no signed-in user at all -- and it rendered "Host access
  // request — this account, ." with a dangling separator when it was. The line
  // is meant to be pasted into Slack; punctuation for a field that is not there
  // is exactly the kind of thing someone sends without noticing.
  it('leaves no dangling punctuation when there is no user to name', () => {
    // `currentUser` MUST be cleared too. The component falls back to it when
    // the props are empty, so leaving the shared mock in place fills both
    // blanks from Dana Whitfield and the empty state is never reached -- the
    // first version of this test passed against the very bug it was written
    // for, which is the whole reason the falsification pass exists.
    mockAuth.currentUser = null;
    render(<PendingApproval email="" name="" onSignOut={jest.fn()} />);
    const line = screen.getByText(/host access request/i).textContent;

    expect(line).not.toMatch(/,\s*\./);
    expect(line).not.toMatch(/—\s*,/);
    expect(line.trim()).not.toMatch(/[,—]$/);
  });

  it('does not print an Email row it has no address for', () => {
    mockAuth.currentUser = null;
    const { container } = render(<PendingApproval email="" name="" onSignOut={jest.fn()} />);

    // A label with nothing beside it reads as a value that failed to load.
    container.querySelectorAll('dd').forEach((cell) => {
      expect(cell.textContent.trim()).not.toBe('');
    });
    expect(screen.queryByText(/^Email$/)).toBeNull();
  });

  it('names only the fields it has', () => {
    mockAuth.currentUser = null;
    render(<PendingApproval email="dana@example.com" name="" onSignOut={jest.fn()} />);
    const line = screen.getByText(/host access request/i).textContent;

    expect(line).toContain('dana@example.com');
    expect(line).not.toMatch(/,\s*\./);
    expect(line).not.toMatch(/—\s*,/);
  });

  it('shows a copyable request line carrying the name and the address', () => {
    render(<PendingApproval email="dana@example.com" name="Dana Whitfield" onSignOut={jest.fn()} />);
    const line = screen.getByText(/host access request/i);

    expect(line).toHaveTextContent('Dana Whitfield');
    expect(line).toHaveTextContent('dana@example.com');
    expect(screen.getByRole('button', { name: /copy this/i })).toBeInTheDocument();
  });
});

describe('the account-enumeration fix', () => {
  // RATIONALE §8.4. AuthContext used to map UserNotFoundException to "No
  // account found with this email address." at an unauthenticated endpoint.
  // The user-visible property is what matters, so it is asserted end to end:
  // an address with no account must be indistinguishable from one that has.
  it('an unknown address reaches the code step and is told the same thing', async () => {
    const notFound = Object.assign(new Error('User does not exist.'), {
      code: 'UserNotFoundException',
    });
    mockAuth.forgotPassword.mockRejectedValue(notFound);

    render(<ForgotPasswordForm onToggleMode={jest.fn()} initialEmail="nobody@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: /send the code/i }));

    await screen.findByLabelText(/code from the email/i);
    expect(screen.getByText(/if there is an account for/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/no account found/i);
  });

  it('a real failure that is not enumeration still stops and says so', async () => {
    const limited = Object.assign(new Error('Attempt limit exceeded.'), {
      code: 'LimitExceededException',
    });
    mockAuth.forgotPassword.mockRejectedValue(limited);
    mockAuth.error = 'Too many attempts. Please wait a while before trying again.';

    render(<ForgotPasswordForm onToggleMode={jest.fn()} initialEmail="dana@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: /send the code/i }));

    // Rejects "advance on every error", which would pass the enumeration test
    // above while sending someone to a code step for a code that was never
    // sent. The wait is on a POSITIVE fact -- the request finished and the form
    // is still asking for an email. Waiting on the absence of the code field
    // instead passes on the first tick, before the rejected promise has been
    // handled, and so asserts nothing: that is how this test was first written
    // and the mutation walked straight past it.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send the code/i })).toBeInTheDocument();
      expect(mockAuth.forgotPassword).toHaveBeenCalledWith('dana@example.com');
    });
    expect(screen.queryByLabelText(/code from the email/i)).toBeNull();
  });

  it('the AuthContext no longer maps UserNotFoundException on the reset path', () => {
    const source = stripComments(read('../auth/AuthContext.jsx'));
    const resetBlock = source.slice(source.indexOf('const forgotPassword'));
    expect(resetBlock).not.toMatch(/No account found with this email address/);
  });
});

describe('the sign-in error names the address', () => {
  // Today Cognito's raw string reaches the user: a product that never asks for
  // a username saying "Incorrect username or password." Rejects dropping the
  // echo, which is the thing worth checking when a sign-in fails.
  it('echoes the address that was rejected', () => {
    mockAuth.error = 'That password does not match';
    render(<LoginForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'alexandra@northeast-commercial.example.com' },
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('That password does not match');
    expect(alert).toHaveTextContent('alexandra@northeast-commercial.example.com');
  });

  // An OAuth failure arrives as an opaque string on the URL, not as one of the
  // mapped Cognito sentences, and those are not written to be completed by an
  // address. Rejects "always append", which produces "Something went wrong
  // dana@example.com".
  it('does not append the address to an opaque error carried in from the URL', () => {
    render(
      <LoginForm
        onToggleMode={jest.fn()}
        onSuccess={jest.fn()}
        initialError="Google sent us back without finishing."
      />
    );

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'dana@example.com' } });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Google sent us back without finishing.');
    expect(alert.querySelector('h3').textContent).not.toContain('dana@example.com');
  });

  it('names the one cause the message cannot otherwise explain', () => {
    mockAuth.error = 'That password does not match';
    render(<LoginForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/no password on that account/i);
  });
});

describe('the routes off the sign-in form', () => {
  // These two reject a control that renders and is wired to nothing.
  //
  // THEY DO NOT REJECT THE BUG THAT ACTUALLY HAPPENED HERE, and saying so is
  // the point. "Forgotten it?" was rendered INSIDE the password <label>; in
  // Chrome the label's activation behaviour forwarded the click to the input
  // and the handler never ran -- the button looked right and did nothing. jsdom
  // does not implement that forwarding, so `fireEvent.click` on the button
  // calls the handler directly and BOTH of these pass with the bug present.
  // Verified by putting the nesting back and re-running. The test below, which
  // asserts the structure rather than the click, is the one that catches it.
  it('Forgotten it? asks for the reset form', () => {
    const onToggleMode = jest.fn();
    render(<LoginForm onToggleMode={onToggleMode} onSuccess={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /forgotten it\?/i }));
    expect(onToggleMode).toHaveBeenCalledWith('forgot');
  });

  it('Create a host account asks for the register form', () => {
    const onToggleMode = jest.fn();
    render(<LoginForm onToggleMode={onToggleMode} onSuccess={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /create a host account/i }));
    expect(onToggleMode).toHaveBeenCalledWith('register');
  });

  // A label may not contain another focusable control. Rejects putting the
  // trailing link back inside the label, which is how the bug above happened.
  it('puts no focusable control inside a label element', () => {
    const { container } = render(<LoginForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />);
    expect(container.querySelectorAll('label button, label a, label input')).toHaveLength(0);
  });
});

describe('the audit findings that had no test', () => {
  const surfaces = [
    ['sign in', <LoginForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />],
    ['register', <RegisterForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />],
    ['verify', <VerificationForm email="dana@example.com" name="Dana" onToggleMode={jest.fn()} onSuccess={jest.fn()} />],
    ['reset', <ForgotPasswordForm onToggleMode={jest.fn()} />],
    ['forced change', <PasswordChangeForm />],
    ['pending', <PendingApproval email="dana@example.com" name="Dana" onSignOut={jest.fn()} />],
  ];

  // Check E7: the audit found three panels a user can land on with no heading.
  it.each(surfaces)('%s has exactly one h1', (_name, element) => {
    const { container } = render(element);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  // Check E5: the audit found THREE password fields with no label at all.
  //
  // Only the surfaces that actually HAVE a password field are listed. Running
  // this over all six would have been the trap it is meant to catch: `verify`
  // and `pending` have no password input, so the forEach body would never run
  // and those two cases would pass with the labelling deleted.
  const withPasswords = [
    ['sign in', <LoginForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />, 1],
    ['register', <RegisterForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />, 1],
    ['forced change', <PasswordChangeForm />, 1],
  ];

  it.each(withPasswords)('%s gives every password field an accessible name', (_n, element, count) => {
    const { container } = render(element);
    const fields = container.querySelectorAll('input[type="password"]');

    expect(fields).toHaveLength(count);
    fields.forEach((field) => {
      const labelled =
        field.getAttribute('aria-label') ||
        (field.id && container.querySelector(`label[for="${field.id}"]`));
      expect(labelled).toBeTruthy();
    });
  });

  // Check E8: no text input under 16px, or iOS Safari zooms the page on focus
  // and the user has to pinch back out. Asserted on the token, since jsdom
  // resolves no custom properties.
  it('sets the shared input size at 17px', () => {
    const css = stripComments(read('../auth/auth.css'));
    expect(css).toMatch(/--au-t-body:\s*17px/);
  });

  // Check E6: red means destructive in this system, and a rejected password is
  // not destructive. Rejects reaching for --danger on an error state.
  it('uses no --danger anywhere in the au- system', () => {
    const css = stripComments(read('../auth/auth.css'));
    const auBlock = css.slice(css.indexOf('.au-page {'));
    expect(auBlock).not.toMatch(/--danger/);
  });
});

// ---------------------------------------------------------------------------

function read(relative) {
  return fs.readFileSync(path.join(__dirname, relative), 'utf8');
}

/**
 * Source assertions must run against code, not against the prose explaining it.
 * Every claim above would otherwise be satisfiable by a comment -- which has
 * happened in this codebase before.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
