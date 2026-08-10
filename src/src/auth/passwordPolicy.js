/**
 * The one password policy. Every form that asks for a password uses this.
 *
 * There used to be three client validators and they disagreed, so a password
 * could be valid at reset and rejected at signup (RATIONALE.md §8.7):
 *
 *   RegisterForm.jsx        (?=.*[@$!%*?&])            -- '#' and '-' rejected
 *   ForgotPasswordForm.jsx  [^A-Za-z0-9]               -- anything accepted
 *   PasswordChangeForm.jsx  [!@#$%^&*(),.?":{}|<>]     -- '-' rejected
 *
 * WHICH ONE IS RIGHT IS NOT A JUDGEMENT CALL, and it is worth writing down
 * because OPEN-QUESTIONS.md §7 records it as unresolved. The user pool declares
 * the policy itself, in template-clean.yaml:2289:
 *
 *     PasswordPolicy:
 *       MinimumLength: 8
 *       RequireUppercase: true
 *       RequireLowercase: true
 *       RequireNumbers: true
 *       RequireSymbols: true
 *
 * and Cognito's `RequireSymbols` is satisfied by any of
 * `^ $ * . [ ] { } ( ) ? " ! @ # % & / \ , > < ' : ; | _ ~ + = -` and space,
 * i.e. every printable ASCII non-alphanumeric. So the permissive rule below is
 * not a lowest common denominator chosen to keep the peace -- it is the pool's
 * real policy, and the two strict validators were rejecting in the browser
 * passwords the server would have accepted. Nothing here is stricter than
 * Cognito; a password this module passes and Cognito rejects would be a bug in
 * this file.
 *
 * The rules are ordered as they are read on screen, and the checklist is live
 * from the first keystroke rather than an error after submitting -- which is
 * also why `checkPassword` reports per rule instead of returning a boolean.
 */

export const PASSWORD_RULES = [
  { id: 'len', label: '8 characters or more', test: (pw) => pw.length >= 8 },
  { id: 'up', label: 'An upper-case letter', test: (pw) => /[A-Z]/.test(pw) },
  { id: 'low', label: 'A lower-case letter', test: (pw) => /[a-z]/.test(pw) },
  { id: 'num', label: 'A number', test: (pw) => /\d/.test(pw) },
  {
    id: 'sym',
    label: 'A symbol — ! ? # $ % or any other',
    test: (pw) => /[^A-Za-z0-9]/.test(pw),
  },
];

/** Per-rule state for the live checklist. */
export function checkPassword(password) {
  const pw = typeof password === 'string' ? password : '';
  return PASSWORD_RULES.map(({ id, label, test }) => ({ id, label, ok: test(pw) }));
}

/** True when every rule is met. */
export function passwordMeetsPolicy(password) {
  return checkPassword(password).every((rule) => rule.ok);
}
