/**
 * The confirm-password field, on registration and NOWHERE ELSE.
 *
 * This is a deliberate divergence from `docs/design/entry-redesign/`, which
 * draws one password field on all three password-setting forms. The owner ruled
 * on 2026-08-11 that registration gets a second field and reset and change do
 * not: a typo at registration creates an account with a password nobody can
 * reproduce and is discovered later, at a sign-in that fails for no visible
 * reason, while a typo at reset or change is undone by running the same flow
 * again. `RegisterForm.jsx`'s header carries the reasoning. These tests are the
 * enforcement, and they enforce BOTH halves — the field being here, and the
 * field not being on the other two.
 *
 * Every test below names the change it rejects, and every one of them was run
 * against a broken implementation and watched to fail before being kept.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine, so every width, offset
 * and computed box measures zero and passes unconditionally.
 *
 * NO `waitFor` ON AN ABSENCE. A `waitFor` that asserts something is missing
 * passes on its first tick, before any promise settles. The "not announced yet"
 * assertions here are synchronous, immediately after the keystroke that would
 * have raised the message.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import RegisterForm from '../auth/RegisterForm';
import ForgotPasswordForm from '../auth/ForgotPasswordForm';
import PasswordChangeForm from '../auth/PasswordChangeForm';

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

jest.mock('../auth/AuthContext', () => ({ useAuth: () => mockAuth }));

beforeEach(() => {
  Object.values(mockAuth).forEach((v) => typeof v?.mockReset === 'function' && v.mockReset());
  mockAuth.signUp.mockResolvedValue({});
  mockAuth.completeNewPassword.mockResolvedValue({});
  mockAuth.forgotPassword.mockResolvedValue({});
  mockAuth.confirmPassword.mockResolvedValue(true);
});

const GOOD = 'Northeast#26';
const TYPO = 'Northeast#25';

const type = (field, value) => fireEvent.change(field, { target: { value } });

const renderRegister = () => {
  const utils = render(<RegisterForm onToggleMode={jest.fn()} onSuccess={jest.fn()} />);
  const password = screen.getByLabelText(/^password$/i);
  const confirm = screen.getByLabelText(/confirm password/i);
  const submit = screen.getByRole('button', { name: /create account/i });
  return { ...utils, password, confirm, submit };
};

/** Everything except the password pair, so only the pair can block a submit. */
const fillIdentity = () => {
  type(screen.getByLabelText(/your name/i), 'Alexandra Vasquez-Kowalski');
  type(screen.getByLabelText(/email/i), 'alexandra@example.com');
};

// ---------------------------------------------------------------------------

describe('the field exists here and only here', () => {
  // rejects: deleting the confirm field from RegisterForm — which is exactly
  // what an agent reading 11-register.html and finding two fields will try.
  it('registration asks for the password twice', () => {
    const { container } = renderRegister();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(2);
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  // rejects: adding a confirm field to ForgotPasswordForm. The ruling is a
  // SPLIT, so "restore it everywhere" is against it just as much as "remove it
  // everywhere". A reset typo costs a repeat of the flow, nothing more.
  it('the reset form asks for the new password once', async () => {
    const { container } = render(
      <ForgotPasswordForm onToggleMode={jest.fn()} initialEmail="alexandra@example.com" />
    );

    fireEvent.click(screen.getByRole('button', { name: /send the code/i }));
    // Wait for the password step to actually mount, or this counts the inputs
    // on the email step and passes for the wrong reason.
    await screen.findByLabelText(/new password/i);

    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
    expect(screen.queryByLabelText(/confirm/i)).toBeNull();
  });

  // rejects: adding a confirm field to PasswordChangeForm, same ruling.
  it('the forced-change form asks for the new password once', () => {
    const { container } = render(<PasswordChangeForm />);
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
    expect(screen.queryByLabelText(/confirm/i)).toBeNull();
  });
});

describe('a mismatch blocks the account from being created', () => {
  // rejects: dropping the `form.confirm !== form.password` branch from
  // validate(). Without it the field is decoration and the typo it exists to
  // catch reaches Cognito.
  it('does not call signUp when the two differ', async () => {
    const { password, confirm, submit } = renderRegister();
    fillIdentity();
    type(password, GOOD);
    type(confirm, TYPO);
    fireEvent.click(submit);

    // Positive assertion first: the refusal is visible, so this test cannot
    // pass by the form having failed for some unrelated reason.
    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });

  // rejects: treating an untouched confirm field as satisfied (e.g. `confirm &&
  // confirm !== password`), which would let a submit straight through and make
  // the whole field optional.
  it('does not call signUp when the second field was never filled in', async () => {
    const { password, submit } = renderRegister();
    fillIdentity();
    type(password, GOOD);
    fireEvent.click(submit);

    expect(await screen.findByText(/type the password a second time/i)).toBeInTheDocument();
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });

  // rejects: blocking submission unconditionally — the counterweight to the two
  // above, without which they are satisfied by a form that never submits.
  it('calls signUp with the password once the two agree', async () => {
    const { password, confirm, submit } = renderRegister();
    fillIdentity();
    type(password, GOOD);
    type(confirm, GOOD);
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockAuth.signUp).toHaveBeenCalledWith(
        'alexandra@example.com',
        GOOD,
        'Alexandra Vasquez-Kowalski'
      );
    });
  });

  // rejects: the confirm value leaking into the signUp call — `signUp(email,
  // password, name, confirm)` is the obvious slip when a field is added, and it
  // would put a second copy of the password into an API call that has no
  // parameter for it.
  //
  // HONEST LIMIT: this cannot reject `signUp(email, form.confirm, name)`,
  // because the submit only happens when the two strings are equal, so the two
  // versions are indistinguishable by construction. That mutation was run and
  // survived. It is unreachable rather than untested — but if the equality
  // check above is ever loosened, nothing here will notice.
  it('sends exactly one password to Cognito', async () => {
    const { password, confirm, submit } = renderRegister();
    fillIdentity();
    type(password, GOOD);
    type(confirm, GOOD);
    fireEvent.click(submit);

    await waitFor(() => expect(mockAuth.signUp).toHaveBeenCalled());
    expect(mockAuth.signUp.mock.calls[0]).toHaveLength(3);
    expect(mockAuth.signUp.mock.calls[0][1]).toBe(GOOD);
  });
});

describe('when the mismatch is allowed to speak', () => {
  // rejects: raising the message on every keystroke (i.e. dropping the
  // `matchChecked` gate). Half of a correctly-typed password does not match the
  // whole of the first one, so a live check calls a careful typist wrong on
  // every character. Synchronous assertion — see the header note about waitFor.
  it('says nothing while the second field is still being typed', () => {
    const { password, confirm } = renderRegister();
    type(password, GOOD);
    type(confirm, 'North');

    expect(screen.queryByText(/do not match/i)).toBeNull();
  });

  // rejects: removing the blur path and leaving the message to submit time
  // only, which makes the user press a button to find out about a typo that
  // was already knowable.
  it('says so once focus leaves the second field', () => {
    const { password, confirm } = renderRegister();
    type(password, GOOD);
    type(confirm, TYPO);
    expect(screen.queryByText(/do not match/i)).toBeNull(); // still silent

    fireEvent.blur(confirm);

    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  // rejects: removing the relatedTarget guard in `leftPasswordField`. Clicking
  // Show blurs the input, so without the guard someone five characters into the
  // confirm field who reaches for Show to check their typing is told the
  // passwords do not match — the worst possible moment for that sentence. The
  // blur-then-click pair is the order a browser fires them in.
  it('stays silent when the blur is only the field\'s own Show toggle taking focus', () => {
    const { password, confirm } = renderRegister();
    const [, confirmToggle] = screen.getAllByRole('button', { name: /show password/i });

    type(password, GOOD);
    type(confirm, 'North');
    fireEvent.blur(confirm, { relatedTarget: confirmToggle });
    fireEvent.click(confirmToggle);

    expect(screen.queryByText(/do not match/i)).toBeNull();
  });

  // rejects: leaving the message up while the user fixes it. It has to retract
  // the moment they start correcting, or it is contradicting them mid-keystroke
  // and the live region has a reason to re-announce.
  it('retracts as soon as the user starts correcting', () => {
    const { password, confirm } = renderRegister();
    type(password, GOOD);
    type(confirm, TYPO);
    fireEvent.blur(confirm);
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();

    type(confirm, `${TYPO}x`);

    expect(screen.queryByText(/do not match/i)).toBeNull();
  });

  // rejects: editing the FIRST field re-raising the message against a second
  // field the user has not returned to. Same gate, other direction.
  it('stays silent while the first field is being edited afterwards', () => {
    const { password, confirm } = renderRegister();
    type(password, GOOD);
    type(confirm, GOOD);
    fireEvent.blur(confirm);
    type(password, 'Northeast#2');

    expect(screen.queryByText(/do not match/i)).toBeNull();
  });
});

describe('the mismatch reaches a keyboard and a screen reader', () => {
  // rejects: rendering the message as loose text next to the field. Wired
  // through aria-describedby it is read out when the input takes focus; loose
  // text is invisible to anyone not looking at it.
  it('is named by the input it is about', () => {
    const { confirm } = renderRegister();
    type(screen.getByLabelText(/^password$/i), GOOD);
    type(confirm, TYPO);
    fireEvent.blur(confirm);

    const describedBy = confirm.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy)).toHaveTextContent(/do not match/i);
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
  });

  // rejects: mounting the message and its container together. A live region
  // inserted at the same moment as its first text is announced unreliably or
  // not at all — the region has to be in the tree beforehand, empty. This is
  // why PasswordField takes `liveHint`.
  it('lands in a live region that was already on the page', () => {
    const { container, password, confirm } = renderRegister();

    const region = container.querySelector('#reg-pw2-err[aria-live]');
    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();

    type(password, GOOD);
    type(confirm, TYPO);
    fireEvent.blur(confirm);

    expect(container.querySelector('#reg-pw2-err[aria-live]')).toHaveTextContent(/do not match/i);
  });

  // rejects: refusing the submit silently, or refusing it with the message
  // rendered somewhere the keyboard has to hunt for. The submit button is never
  // disabled — a dead button explains nothing — so the refusal has to hand
  // focus to the field that must change.
  it('takes focus to the second field when a submit is refused', async () => {
    const { password, confirm, submit } = renderRegister();
    fillIdentity();
    type(password, GOOD);
    type(confirm, TYPO);

    expect(confirm).not.toHaveFocus();
    fireEvent.click(submit);

    await waitFor(() => expect(confirm).toHaveFocus());
  });

  // rejects: disabling the Create account button while the two differ. A
  // disabled control is skipped by keyboard navigation and states no reason, so
  // the one thing that could explain the dead end is the thing you cannot reach.
  it('leaves the submit button enabled so the refusal can be reached', () => {
    const { password, confirm, submit } = renderRegister();
    type(password, GOOD);
    type(confirm, TYPO);
    fireEvent.blur(confirm);

    expect(submit).toBeEnabled();
  });
});

describe('the Show toggles are independent', () => {
  // rejects: linking the two toggles into one shared `visible` state. You only
  // ever need to see the field you are correcting, and unmasking both at once
  // doubles what is legible on a projected or shared screen for no gain.
  // Reads the type attribute, which is what masking actually is — not a class
  // name, and nothing geometric.
  it('revealing one field leaves the other masked', () => {
    const { password, confirm } = renderRegister();
    const [passwordToggle] = screen.getAllByRole('button', { name: /show password/i });

    fireEvent.click(passwordToggle);

    expect(password).toHaveAttribute('type', 'text');
    expect(confirm).toHaveAttribute('type', 'password');
  });

  // rejects: the confirm field losing its toggle altogether — which is how
  // "they are independent" could otherwise be satisfied.
  it('revealing the second field leaves the first masked', () => {
    const { password, confirm } = renderRegister();
    const toggles = screen.getAllByRole('button', { name: /show password/i });
    expect(toggles).toHaveLength(2);

    fireEvent.click(toggles[1]);

    expect(confirm).toHaveAttribute('type', 'text');
    expect(password).toHaveAttribute('type', 'password');
  });
});

describe('the second field does not repeat the first one\'s furniture', () => {
  // rejects: passing `showRules` to the confirm field. The five-rule checklist
  // is one statement of one thing (RATIONALE §8.3); printing it twice on one
  // screen is the same redundancy the strength meter was removed for.
  it('shows the rule checklist exactly once', () => {
    const { container } = renderRegister();
    expect(container.querySelectorAll('.au-rules')).toHaveLength(1);
    expect(screen.getAllByText(/8 characters or more/i)).toHaveLength(1);
  });
});
