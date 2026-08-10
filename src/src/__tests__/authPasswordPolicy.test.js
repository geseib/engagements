/**
 * ONE password policy, shared by every form that asks for a password.
 *
 * Before this module there were three client validators and they disagreed
 * (RATIONALE.md §8.7):
 *
 *   RegisterForm.jsx        [@$!%*?&]                 only
 *   ForgotPasswordForm.jsx  [^A-Za-z0-9]              any non-alphanumeric
 *   PasswordChangeForm.jsx  [!@#$%^&*(),.?":{}|<>]
 *
 * so `Northeast#26` was rejected at signup and accepted at reset, and
 * `Northeast-26` was accepted at reset and rejected at both of the others.
 * Neither of the two strict sets is the real rule: the user pool declares
 * `RequireSymbols: true` (template-clean.yaml:2294), and Cognito's symbol set is
 * every printable ASCII non-alphanumeric. The permissive rule is therefore not
 * a guess or a lowest common denominator — it is the pool's actual policy, and
 * the two strict validators were rejecting passwords the server would take.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine, so every width, offset
 * and computed box measures zero and passes unconditionally.
 */
import { checkPassword, passwordMeetsPolicy, PASSWORD_RULES } from '../auth/passwordPolicy';

describe('the symbols the old validators disagreed about', () => {
  // These two are the whole reason this module exists. Each names a specific
  // regression: restoring RegisterForm's [@$!%*?&] breaks the first, restoring
  // PasswordChangeForm's [!@#$%^&*(),.?":{}|<>] breaks the second.
  it('accepts # as the symbol — RegisterForm used to reject this', () => {
    expect(passwordMeetsPolicy('Northeast#26')).toBe(true);
  });

  it('accepts - as the symbol — RegisterForm and PasswordChangeForm both used to reject this', () => {
    expect(passwordMeetsPolicy('Northeast-26')).toBe(true);
  });

  it('accepts the symbols the strict sets did allow, so the fix is a widening and not a swap', () => {
    expect(passwordMeetsPolicy('Northeast@26')).toBe(true);
    expect(passwordMeetsPolicy('Northeast!26')).toBe(true);
  });
});

describe('what the policy still refuses', () => {
  // Without these the module could return `true` unconditionally and every
  // test above would still pass. Each rejects one collapsed requirement.
  it('refuses a password under 8 characters', () => {
    expect(passwordMeetsPolicy('Nor#26a')).toBe(false);
  });

  it('refuses a password with no upper-case letter', () => {
    expect(passwordMeetsPolicy('northeast#26')).toBe(false);
  });

  it('refuses a password with no lower-case letter', () => {
    expect(passwordMeetsPolicy('NORTHEAST#26')).toBe(false);
  });

  it('refuses a password with no digit', () => {
    expect(passwordMeetsPolicy('Northeastern#')).toBe(false);
  });

  it('refuses a password with no symbol at all', () => {
    expect(passwordMeetsPolicy('Northeast26')).toBe(false);
  });

  it('refuses an empty password', () => {
    expect(passwordMeetsPolicy('')).toBe(false);
  });
});

describe('the checklist the forms render', () => {
  it('reports all five rules, so dropping one from the ladder fails here', () => {
    expect(PASSWORD_RULES).toHaveLength(5);
    expect(PASSWORD_RULES.map((rule) => rule.id).sort())
      .toEqual(['len', 'low', 'num', 'sym', 'up']);
  });

  it('every rule carries a label a user can read', () => {
    PASSWORD_RULES.forEach((rule) => {
      expect(typeof rule.label).toBe('string');
      expect(rule.label.length).toBeGreaterThan(0);
    });
  });

  // The checklist is live from the first keystroke, so a half-typed password
  // has to report per-rule rather than pass/fail. Rejects collapsing
  // `checkPassword` into a boolean.
  it('marks each rule separately for a partly-typed password', () => {
    const state = checkPassword('Nor');
    const byId = Object.fromEntries(state.map((rule) => [rule.id, rule.ok]));

    expect(byId.up).toBe(true);
    expect(byId.low).toBe(true);
    expect(byId.len).toBe(false);
    expect(byId.num).toBe(false);
    expect(byId.sym).toBe(false);
  });

  it('marks every rule met once the password satisfies the policy', () => {
    expect(checkPassword('Northeast#26').every((rule) => rule.ok)).toBe(true);
  });

  it('an empty password meets nothing', () => {
    expect(checkPassword('').some((rule) => rule.ok)).toBe(false);
  });
});
