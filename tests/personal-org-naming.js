/**
 * WHAT A PERSON'S OWN SPACE IS CALLED.
 *
 * On dev the auto-provisioned org came out named
 *
 *     Google_113956208956782440356
 *
 * which is the Cognito USERNAME of a federated identity. `callerName` falls
 * back to `username`, and for anyone who signed in with Google, Facebook,
 * Amazon or Apple that username is `<Provider>_<opaque numeric id>` — a machine
 * key, not a name. It then became the heading of the switcher chip, the org
 * list, and every screen that names the active organisation.
 *
 * It is worth more than a cosmetic fix because it is the FIRST thing a new
 * account sees about the product, and because the same value is the org's
 * `slug`.
 *
 * // rejects: reading a federated username as a human name, in any of the four
 * //          provider spellings Cognito produces.
 */
const assert = require('assert');
const { personalOrgName, looksFederated } = require('../lambda-functions/admin/orgs/shared/personal-org');

let checks = 0;
const is = (actual, expected, why) => { checks += 1; assert.strictEqual(actual, expected, why); };

/** An authorizer context shaped like the real one. */
const ev = (lambda, claims = {}) => ({
  requestContext: { authorizer: { lambda, claims } },
});

/* ── 1. THE FEDERATED USERNAMES, WHICH ARE THE BUG ──────────────────────── */

for (const u of [
  'Google_113956208956782440356',
  'Facebook_10160123456789012',
  'SignInWithApple_001234.abcdef0123456789.0123',
  'LoginWithAmazon_amzn1.account.AGXYZ123',
]) {
  is(looksFederated(u), true, `${u} is a provider username, not a name`);
}

/* Names that merely contain an underscore or a digit are NOT federated. A
   pattern loose enough to catch those would rename real people. */
for (const u of [
  'amara_reyes', 'George Seib', 'j.doe', 'Anne-Marie O\'Neill', 'user123',
]) {
  is(looksFederated(u), false, `${u} is a person`);
}

/* ── 2. WHAT THE SPACE IS ACTUALLY CALLED ───────────────────────────────── */

is(
  personalOrgName(ev({ name: 'Amara Reyes', username: 'Google_1139', email: 'a@b.com' })),
  'Amara Reyes',
  'a real display name wins outright',
);

is(
  personalOrgName(ev({ username: 'Google_113956208956782440356', email: 'george.seib@gmail.com' })),
  'George Seib',
  'a federated username falls through to the email, titleised',
);

is(
  personalOrgName(ev({ username: 'Google_113956208956782440356', email: 'gseib@example.com' })),
  'Gseib',
  'a one-word local part is still capitalised',
);

is(
  personalOrgName(ev({ username: 'amara', email: 'a@b.com' })),
  'amara',
  'an ordinary username is left exactly as the person wrote it',
);

is(
  personalOrgName(ev({})),
  'Personal',
  'nothing to go on at all still yields a name, never an empty string',
);

/* An email local part can carry separators; they become spaces, and the result
   is capped like any other name. */
is(
  personalOrgName(ev({ email: 'anne-marie.oneill@example.com' })),
  'Anne Marie Oneill',
  'dots and hyphens in a local part read as word breaks',
);

console.log(`personal-org-naming: ${checks} assertions passed`);
