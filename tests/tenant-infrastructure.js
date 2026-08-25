/**
 * THE INFRASTRUCTURE HALF OF TENANCY.
 *
 * Handler code can be perfect and the tenant boundary still absent, because
 * half of it lives in template-clean.yaml: which routes carry the authorizer,
 * which functions may decrypt, and the key policy condition that makes the
 * privacy page's promise true rather than aspirational.
 *
 * None of this is covered by the handler suites. A missing `Auth:` block, a
 * dropped key-policy statement or a `kms:Decrypt` grant quietly widened to
 * `Resource: '*'` all leave every other test green.
 *
 * rejects: an org/invite/usage route losing its authorizer; the
 * deny-without-tenant-context statement being removed or weakened; key rotation
 * being turned off; the key becoming deletable; GenerateDataKey spreading
 * beyond the one function that mints an org's key; the stream consumer or the
 * reconciler being unwired; TENANT_KMS_KEY_ID disappearing from Globals.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const {
  routesFromTemplate, findRoute, assertScannerWorks,
} = require('./helpers/template-routes');

const raw = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
// Comments quote the very statements being asserted about, in order to explain
// them. Strip before concluding anything from a string's presence — the same
// trap __tests__/undeclaredSetters.test.js documents.
const code = raw.replace(/^\s*#.*$/gm, '');

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail++; }
}

/** The text of one top-level resource block, bounded by the next one. */
function resourceBlock(name) {
  const start = code.indexOf(`\n  ${name}:\n`);
  assert.notStrictEqual(start, -1, `resource ${name} is not in the template`);
  const rest = code.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z][A-Za-z0-9]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

// ---------- 1. Every org, invite and usage route is authorized ----------
// The other half — that `requiredGroupsForRoute` names them rather than
// inheriting the trailing default — is pinned by tests/org-route-authorization.js.
// Both are required; either alone is a false fix.
console.log('\n1. the org, invite and usage routes carry the authorizer');
const routes = routesFromTemplate();
check('the scanner works', () => assertScannerWorks(routes));
for (const [method, p] of [
  ['POST', '/orgs'], ['GET', '/orgs'], ['GET', '/orgs/{orgId}'],
  ['GET', '/orgs/{orgId}/members'], ['GET', '/orgs/{orgId}/usage'],
  ['POST', '/orgs/{orgId}/invites'], ['DELETE', '/orgs/{orgId}/invites/{token}'],
  ['PUT', '/orgs/{orgId}/members/{sub}/role'], ['DELETE', '/orgs/{orgId}/members/{sub}'],
  ['POST', '/invites/{token}/accept'],
]) {
  check(`${method} ${p}`, () => {
    const hit = findRoute(routes, method, p);
    assert.ok(hit, 'route is missing from the template entirely');
    assert.strictEqual(hit.authorizer, 'CognitoAuthorizer',
      `authorizer was ${JSON.stringify(hit.authorizer)}`);
  });
}

// ---------- 2. The key policy statement that carries the promise ----------
console.log('\n2. the tenant key denies any decrypt that does not name a tenant');
const key = resourceBlock('TenantKey');
check('the key exists and rotates', () =>
  assert.ok(/EnableKeyRotation:\s*true/.test(key), 'key rotation is off'));
check('the key survives a stack delete', () => {
  assert.ok(/DeletionPolicy:\s*Retain/.test(key),
    'deleting the stack would destroy the key and every tenant\'s content with it');
  assert.ok(/UpdateReplacePolicy:\s*Retain/.test(key),
    'a template change that replaces the key would orphan every wrapped data key');
});
check('there is an explicit Deny, not merely an absent Allow', () =>
  assert.ok(/Effect:\s*Deny/.test(key),
    'the deny-without-tenant-context statement is gone — a decrypt with no orgId '
    + 'would be permitted, and CloudTrail would stop being a per-tenant read log'));
check('...and it is conditioned on the orgId encryption context being present', () =>
  assert.ok(/kms:EncryptionContext:orgId/.test(key),
    'the condition no longer names orgId, so the Deny matches nothing'));
check('...using Null true — "the key is absent", not a value comparison', () =>
  assert.ok(/'Null':/.test(key) && /'true'/.test(key),
    'a value comparison would let a caller pass any orgId they liked; Null:true '
    + 'is what makes supplying one MANDATORY'));
check('it denies both Decrypt and GenerateDataKey', () => {
  const deny = key.slice(key.indexOf('Effect: Deny'));
  assert.ok(/kms:Decrypt/.test(deny), 'Decrypt is not denied');
  assert.ok(/kms:GenerateDataKey/.test(deny),
    'GenerateDataKey is not denied, so a key could be minted with no tenant bound to it');
});

// ---------- 3. Who may decrypt, and who may mint ----------
// The set of functions that can read customer content must stay something you
// can enumerate from this file. A Resource:'*' grant, or GenerateDataKey
// spreading past org creation, are both silent widenings.
console.log('\n3. the crypto grants are narrow');
// COUNTING REFERENCES WAS THE WRONG SHAPE OF CHECK, and it was wrong within the
// hour. It asserted "exactly 2" — the key policy's Deny plus OrgsFunction — and
// went red the moment `OrgsListFunction` legitimately gained the grant, because
// that is where a PERSONAL organisation is provisioned and personal orgs need
// keys too. A magic number encodes today's topology, not the rule.
//
// The rule is: a function may mint IF AND ONLY IF it reaches an org-creating
// path. That is a property of the require graph, and
// tests/kms-grants-match-code.js derives it from source rather than from a
// list. What is checked here is the part that file cannot see — that org
// creation can mint at all, and that nothing outside those two paths does.
check('the org-creating functions can mint a data key', () => {
  for (const fn of ['OrgsFunction', 'OrgsListFunction']) {
    assert.ok(/kms:GenerateDataKey/.test(resourceBlock(fn)),
      `${fn} creates organisations but cannot mint a data key, so every set and `
      + 'session in the orgs it creates fails to encrypt');
  }
});
check('and nothing else does', () => {
  // Named minters plus the key policy's own Deny statement.
  const allowed = new Set(['OrgsFunction', 'OrgsListFunction', 'TenantKey']);
  const offenders = [];
  for (const m of code.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):\s*$/gm)) {
    const name = m[1];
    if (allowed.has(name)) continue;
    let block;
    try { block = resourceBlock(name); } catch { continue; }
    if (/kms:GenerateDataKey/.test(block)) offenders.push(name);
  }
  assert.deepStrictEqual(offenders, [],
    'GenerateDataKey has spread beyond the two paths that create organisations');
});
check('no kms action is granted on Resource "*"', () => {
  // Every grant must name the key by ARN. The key POLICY uses Resource:'*'
  // legitimately — inside a key policy that means "this key" — so only the
  // function grants are checked.
  const fnGrants = code.split('TenantKeyAlias')[1] || '';
  assert.ok(!/Action:\s*\[\s*kms:[^\]]*\]\s*\n\s*Resource:\s*['"]\*['"]/.test(fnGrants),
    'a function may decrypt with any key in the account');
});

// ---------- 4. Metering is actually wired ----------
console.log('\n4. metering is wired to the stream and the clock');
const stream = resourceBlock('UsageStreamFunction');
check('the stream consumer reads the table stream', () => {
  assert.ok(/Type:\s*DynamoDB/.test(stream), 'no DynamoDB event source');
  // MATCH THE `Stream:` PROPERTY, NOT MERELY THE STRING. This block also
  // contains `StreamName: !Select [3, !Split ['/', !GetAtt GameTable.StreamArn]]`
  // in its IAM policy, so a loose search for `GameTable.StreamArn` is satisfied
  // by the permission even when the event source has been pointed somewhere
  // else entirely. Verified: repointing the event alone left the loose check
  // green.
  assert.ok(/\n\s*Stream:\s*!GetAtt GameTable\.StreamArn\s*\n/.test(stream),
    'the event source is not the table stream — the consumer is subscribed to '
    + 'something else, or to nothing, and stored-set billing silently stops');
});
check('the table still emits both images, which the consumer needs', () =>
  assert.ok(/StreamViewType:\s*NEW_AND_OLD_IMAGES/.test(code),
    'a REMOVE would arrive with no old image and a deleted set would never be counted'));
check('the reconciler runs on a schedule', () => {
  const rec = resourceBlock('UsageReconcileFunction');
  assert.ok(/Type:\s*Schedule/.test(rec), 'the backstop never runs');
  assert.ok(/Schedule:\s*cron\(/.test(rec), 'no cron expression');
});

// ---------- 5. The env var every crypto call site needs ----------
console.log('\n5. TENANT_KMS_KEY_ID reaches every function');
check('it is set in Globals, not per function', () => {
  const globals = code.slice(code.indexOf('Globals:'), code.indexOf('\nResources:'));
  assert.ok(/TENANT_KMS_KEY_ID:\s*!Ref TenantKey/.test(globals),
    'tenant-crypto.js throws "TENANT_KMS_KEY_ID is not set" by name; per-function '
    + 'wiring means a function that acquires a decrypt path later fails on a '
    + 'missing variable, which looks like a code bug rather than a policy gap');
});

// ---------- 6. The authorizer can still read memberships ----------
console.log('\n6. the authorizer can resolve an organisation at all');
const auth = resourceBlock('AuthorizerFunction');
check('it has the table name', () =>
  assert.ok(/TABLE_NAME:\s*!Ref GameTable/.test(auth)));
check('and read access to it', () =>
  assert.ok(/DynamoDBReadPolicy/.test(auth),
    'authorizer.js fails SOFT on a read error — a missing policy presents as '
    + '"the org features quietly do nothing", visible only in a console.error'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
